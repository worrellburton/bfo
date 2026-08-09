import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  CODE_RESEND_MS,
  CODE_TTL_MS,
  fail,
  generateCode,
  guard,
  handleError,
  hashCode,
  normalizeIdentifier,
  sb,
  sendLoginCode,
  type AppUser,
} from "../../lib/auth";

const MAX_CODES_PER_HOUR = 5;

function mask(kind: "phone" | "email", value: string): string {
  if (kind === "phone") return `••• ••• ${value.slice(-4)}`;
  const [local, domain] = value.split("@");
  const head = local.slice(0, 2);
  return `${head}${"•".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["POST"])) return;

  try {
    const raw = (req.body?.identifier ?? req.body?.phone ?? req.body?.email ?? "") as string;
    const identifier = normalizeIdentifier(raw);
    if (!identifier) {
      return fail(res, 400, "invalid_identifier", "Enter a valid phone number or email address.");
    }

    const column = identifier.kind === "phone" ? "phone" : "email";
    const existing = await sb<AppUser[]>(
      `app_users?${column}=eq.${encodeURIComponent(identifier.value)}&select=*&limit=1`
    );
    let user = existing?.[0];

    if (user?.status === "denied") {
      return fail(res, 403, "access_denied", "This account does not have access to BFO.");
    }

    // Unknown numbers/addresses are allowed to request a code — they land in
    // the Users page as "incoming" for an owner or admin to approve.
    if (!user) {
      const created = await sb<AppUser[]>("app_users", {
        method: "POST",
        prefer: "return=representation",
        body: [{ [column]: identifier.value, role: "member", status: "incoming" }],
      });
      user = created?.[0];
    }

    // Throttle: one code per identifier every CODE_RESEND_MS, and a cap per hour.
    const recent = await sb<Array<{ created_at: string }>>(
      `login_codes?identifier=eq.${encodeURIComponent(identifier.value)}` +
        `&created_at=gte.${new Date(Date.now() - 60 * 60 * 1000).toISOString()}` +
        `&select=created_at&order=created_at.desc`
    );
    const newest = recent?.[0] ? new Date(recent[0].created_at).getTime() : 0;
    const sinceNewest = Date.now() - newest;
    if (newest && sinceNewest < CODE_RESEND_MS) {
      res.setHeader("Retry-After", String(Math.ceil((CODE_RESEND_MS - sinceNewest) / 1000)));
      return fail(res, 429, "too_soon", "Hold on a moment before requesting another code.");
    }
    if ((recent?.length ?? 0) >= MAX_CODES_PER_HOUR) {
      return fail(res, 429, "rate_limited", "Too many codes requested. Try again in an hour.");
    }

    const code = generateCode();
    const inserted = await sb<Array<{ id: string }>>("login_codes", {
      method: "POST",
      prefer: "return=representation",
      body: [
        {
          identifier: identifier.value,
          code_hash: hashCode(identifier.value, code),
          expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
        },
      ],
    });

    try {
      await sendLoginCode(identifier, code);
    } catch (err) {
      // Don't leave a pending code behind that would throttle the retry.
      await sb(`login_codes?id=eq.${inserted[0].id}`, { method: "DELETE" }).catch(() => {});
      throw err;
    }

    return res.status(200).json({
      sent: true,
      kind: identifier.kind,
      identifier: identifier.value,
      masked: mask(identifier.kind, identifier.value),
      expiresIn: Math.round(CODE_TTL_MS / 1000),
    });
  } catch (err) {
    return handleError(res, err);
  }
}
