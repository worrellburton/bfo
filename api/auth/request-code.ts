import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  CODE_RESEND_MS,
  CODE_TTL_MS,
  fail,
  guard,
  handleError,
  normalizeIdentifier,
  sb,
  signInAllowed,
  verifyStart,
  type AppUser,
} from "../../lib/auth.js";
import { countRows } from "../../lib/db-pages.js";

const MAX_CODES_PER_HOUR = 5;
/** Codes one address may ask for in ten minutes, whatever numbers it tries. */
const MAX_CODES_PER_IP = 5;
const IP_WINDOW_MS = 10 * 60 * 1000;

/** Codes sent to everyone together per hour (SIGNIN_HOURLY_CAP), default 60. */
function hourlyCap(): number {
  const n = Number(process.env.SIGNIN_HOURLY_CAP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 60;
}

function hourAgo(): string {
  return new Date(Date.now() - 60 * 60 * 1000).toISOString();
}

/**
 * The caller's address, from the proxy headers Vercel sets (the first
 * x-forwarded-for entry is the client's). Null when nothing there looks like
 * an address, in which case only the per-number and global caps apply.
 */
export function clientIp(headers: Record<string, string | string[] | undefined>): string | null {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const raw = (one(headers["x-real-ip"]) || one(headers["x-forwarded-for"]).split(",")[0]).trim();
  return /^[0-9a-f.:]{3,45}$/i.test(raw) ? raw.toLowerCase() : null;
}

function mask(kind: "phone" | "email", value: string): string {
  if (kind === "phone") return `••• ••• ${value.slice(-4)}`;
  const [local, domain] = value.split("@");
  const head = local.slice(0, 2);
  return `${head}${"•".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["POST"])) return;

  let held: { id: string; created_at: string } | undefined;
  let sent = false;
  try {
    const raw = (req.body?.identifier ?? req.body?.phone ?? req.body?.email ?? "") as string;
    const identifier = normalizeIdentifier(raw);
    if (!identifier) {
      return fail(res, 400, "invalid_identifier", "Enter a valid phone number.");
    }
    // Sign-in is by phone only; an email stays on the profile as contact info.
    if (identifier.kind !== "phone") {
      return fail(res, 400, "phone_only", "Sign in with your phone number.");
    }
    // Both checks below run before the account lookup and answer the same for
    // every number, so they say nothing about who has an account.
    if (!signInAllowed(identifier.value)) {
      return fail(res, 400, "unsupported_country", "Sign-in codes can't be sent to numbers in that country.");
    }
    // The code's row goes in before anything is counted or sent, held back
    // (consumed, so verify-code passes over it) until the code is out. Each
    // limit counts the rows written before it, so a burst of parallel
    // requests can't all pass a count taken before any of them was written.
    // A request that sends nothing takes its row out again (finally, below).
    const ip = clientIp(req.headers ?? {});
    held = (
      await sb<Array<{ id: string; created_at: string }>>("login_codes?select=id,created_at", {
        method: "POST",
        prefer: "return=representation",
        body: [{ identifier: identifier.value, code_hash: "pending", consumed: true, expires_at: new Date().toISOString(), ip }],
      })
    )?.[0];
    if (!held) throw new Error("request-code: the code's row wasn't written");
    const upTo = encodeURIComponent(held.created_at);

    // A global ceiling on codes sent, so cycling through fresh numbers (each
    // within its own per-number limit) can't run up the SMS bill. This
    // request's row counts too. countRows throws when it can't count, so an
    // unknown count never lets a code through.
    const sentLastHour = await countRows("login_codes", `created_at=gte.${encodeURIComponent(hourAgo())}&created_at=lte.${upTo}`);
    if (sentLastHour > hourlyCap()) {
      console.error(`request-code: global cap reached (${sentLastHour} codes in the last hour)`);
      res.setHeader("Retry-After", "600");
      return fail(res, 429, "busy", "Sign-in is busy right now. Try again in a few minutes.");
    }

    // One address asking for codes to many numbers is the other shape of SMS
    // pumping. Counted before the account lookup, so it says nothing about
    // who has an account.
    if (ip) {
      const windowStart = encodeURIComponent(new Date(Date.now() - IP_WINDOW_MS).toISOString());
      const fromIp = await countRows("login_codes", `ip=eq.${encodeURIComponent(ip)}&created_at=gte.${windowStart}&created_at=lt.${upTo}`);
      if (fromIp >= MAX_CODES_PER_IP) {
        console.error(`request-code: per-address cap reached (${fromIp} codes in ten minutes)`);
        res.setHeader("Retry-After", "600");
        return fail(res, 429, "rate_limited", "Too many codes requested from this connection. Try again in ten minutes.");
      }
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

    // Throttle: one code per identifier every CODE_RESEND_MS, and a cap per
    // hour — counting the codes requested before this one.
    const recent = await sb<Array<{ created_at: string }>>(
      `login_codes?identifier=eq.${encodeURIComponent(identifier.value)}` +
        `&created_at=gte.${hourAgo()}&created_at=lt.${upTo}` +
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

    // Bird Verify generates, delivers and checks the code; we keep only its
    // verification id, namespaced so verify-code knows which path to take.
    const verificationId = await verifyStart(identifier);
    sent = true;
    await sb(`login_codes?id=eq.${held.id}`, {
      method: "PATCH",
      body: {
        code_hash: `bird:${verificationId}`,
        consumed: false,
        expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
      },
    });

    return res.status(200).json({
      sent: true,
      kind: identifier.kind,
      identifier: identifier.value,
      masked: mask(identifier.kind, identifier.value),
      expiresIn: Math.round(CODE_TTL_MS / 1000),
    });
  } catch (err) {
    return handleError(res, err);
  } finally {
    if (held && !sent) {
      await sb(`login_codes?id=eq.${held.id}`, { method: "DELETE" }).catch((err) => console.error("request-code: couldn't release a held code row", err));
    }
  }
}
