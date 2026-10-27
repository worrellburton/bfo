import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  MAX_CODE_ATTEMPTS,
  SESSION_TTL_MS,
  fail,
  guard,
  handleError,
  hashCode,
  normalizeIdentifier,
  publicUser,
  safeEqual,
  sb,
  verifyCheck,
  type AppUser,
} from "../../lib/auth.js";

type CodeRow = {
  id: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  consumed: boolean;
};

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Spend one attempt on a code, atomically. The row is written only when it
 * still holds the attempts count this request read, is unconsumed and has
 * attempts left — so two guesses racing on the same row can't both pass a
 * check taken before either wrote. Returns false when the write matched
 * nothing: another guess got there first, or the code is used up.
 */
async function spendAttempt(row: CodeRow, extra: Record<string, unknown> = {}): Promise<boolean> {
  const updated = await sb<Array<{ id: string }>>(
    `login_codes?id=eq.${encodeURIComponent(row.id)}&consumed=is.false` +
      `&attempts=eq.${row.attempts}&attempts=lt.${MAX_CODE_ATTEMPTS}&select=id`,
    { method: "PATCH", prefer: "return=representation", body: { attempts: row.attempts + 1, ...extra } }
  );
  return Array.isArray(updated) && updated.length > 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["POST"])) return;

  try {
    const raw = (req.body?.identifier ?? req.body?.phone ?? req.body?.email ?? "") as string;
    const identifier = normalizeIdentifier(raw);
    const code = String(req.body?.code ?? "").replace(/\D/g, "");

    if (!identifier) return fail(res, 400, "invalid_identifier");
    if (code.length !== 6) {
      return fail(res, 400, "invalid_code", "Enter the 6-digit code.");
    }

    const rows = await sb<CodeRow[]>(
      `login_codes?identifier=eq.${encodeURIComponent(identifier.value)}` +
        `&consumed=is.false&select=id,code_hash,expires_at,attempts,consumed` +
        `&order=created_at.desc&limit=1`
    );
    const row = rows?.[0];
    if (!row || !UUID.test(row.id)) {
      return fail(res, 400, "no_code", "Request a new code.");
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return fail(res, 400, "code_expired", "That code expired. Request a new one.");
    }
    if (row.attempts >= MAX_CODE_ATTEMPTS) {
      return fail(res, 429, "too_many_attempts", "Too many attempts. Request a new code.");
    }

    if (row.code_hash.startsWith("bird:")) {
      // Bird Verify holds the code; it identifies the verification by recipient.
      const outcome = await verifyCheck(identifier, code);
      if (outcome !== "verified") {
        const counted = await spendAttempt(row, outcome === "expired" || outcome === "spent" ? { consumed: true } : {});
        if (outcome === "expired") {
          return fail(res, 400, "code_expired", "That code expired. Request a new one.");
        }
        if (outcome === "spent" || !counted) {
          return fail(res, 429, "too_many_attempts", "Too many attempts. Request a new code.");
        }
        return fail(res, 401, "wrong_code", "That code isn't right.");
      }
    } else if (!safeEqual(row.code_hash, hashCode(identifier.value, code))) {
      // The attempt counts only if this request is the one that moved the
      // counter; a guess that lost the race is refused outright.
      if (!(await spendAttempt(row))) {
        return fail(res, 429, "too_many_attempts", "Too many attempts. Request a new code.");
      }
      const left = MAX_CODE_ATTEMPTS - (row.attempts + 1);
      return fail(
        res,
        401,
        "wrong_code",
        left > 0 ? "That code isn't right." : "Too many attempts. Request a new code."
      );
    }

    // One-time use: the same write that spends the attempt consumes the code,
    // so a second request carrying the right code finds nothing to consume.
    if (!(await spendAttempt(row, { consumed: true }))) {
      return fail(res, 429, "too_many_attempts", "Too many attempts. Request a new code.");
    }

    const column = identifier.kind === "phone" ? "phone" : "email";
    const users = await sb<AppUser[]>(
      `app_users?${column}=eq.${encodeURIComponent(identifier.value)}&select=*&limit=1`
    );
    const user = users?.[0];
    if (!user) return fail(res, 404, "no_user", "No account for that number.");

    const now = new Date().toISOString();
    await sb(`app_users?id=eq.${user.id}`, {
      method: "PATCH",
      body: { verified_at: user.verified_at ?? now, last_login_at: now },
    });

    // Verified, but an owner or admin still has to let them in.
    if (user.status !== "approved") {
      return res.status(200).json({ verified: true, status: user.status, token: null });
    }

    const sessions = await sb<Array<{ token: string; expires_at: string }>>("app_sessions", {
      method: "POST",
      prefer: "return=representation",
      body: [
        {
          user_id: user.id,
          expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
        },
      ],
    });
    const session = sessions?.[0];

    return res.status(200).json({
      verified: true,
      status: user.status,
      token: session.token,
      expiresAt: session.expires_at,
      user: publicUser({ ...user, last_login_at: now }),
    });
  } catch (err) {
    return handleError(res, err);
  }
}
