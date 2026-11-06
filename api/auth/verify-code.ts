/**
 * Sign-in, step two: check the 6-digit code and open a session.
 *
 * HTTP: POST { identifier, code } →
 *   200 { verified, status: "approved", token, expiresAt, user } (signed in),
 *   200 { verified, status: "incoming", token: null } (waiting for approval),
 *   403 not_allowed (a number the office has refused), 401/429 for a wrong,
 *   expired or used-up code.
 * Who may call it: anyone holding a code from request-code. Only after the
 * code is right does the answer depend on the account: a number with no
 * account becomes a request to join (role viewer, verified), and a refused
 * one gets the same plain refusal whatever the reason.
 * Every outcome is written to the audit trail (lib/audit.ts) with the
 * device and network address: who signed in and when, wrong codes,
 * lock-outs, waiting and refused sign-ins.
 * Env: BIRD_ACCESS_KEY (through verifyCheck), SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit } from "../../lib/audit.js";
import { MAX_CODE_ATTEMPTS, SESSION_TTL_MS, fail, guard, handleError, hashCode, normalizeIdentifier, publicUser, safeEqual, sb, verifyCheck, type AppUser } from "../../lib/auth.js";
import { clientIp, deviceOf, lastFour, publicRefusal, purgeStale, refuse, WAITING_ROLE } from "../../lib/sign-in.js";

type CodeRow = {
  id: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  consumed: boolean;
};

const UUID = /^[0-9a-f-]{36}$/i;

/** The one answer for every number the office has refused, removed or turned off. */
export const NOT_ALLOWED = "This number can't sign in. Contact the office.";

/**
 * Spend one attempt on a code, atomically. The row is written only when it
 * still holds the attempts count this request read, is unconsumed and has
 * attempts left — so two guesses racing on the same row can't both pass a
 * check taken before either wrote. Returns false when the write matched
 * nothing: another guess got there first, or the code is used up.
 */
async function spendAttempt(row: CodeRow, extra: Record<string, unknown> = {}): Promise<boolean> {
  const updated = await sb<Array<{ id: string }>>(`login_codes?id=eq.${encodeURIComponent(row.id)}&consumed=is.false` + `&attempts=eq.${row.attempts}&attempts=lt.${MAX_CODE_ATTEMPTS}&select=id`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { attempts: row.attempts + 1, ...extra },
  });
  return Array.isArray(updated) && updated.length > 0;
}

/** The fields the client reads beyond publicUser: whether the current Terms were agreed to (absent when the column isn't there yet). */
export function signedInUser(user: AppUser) {
  const extra = user as AppUser & { terms_version?: string | null };
  return { ...publicUser(user), verifiedAt: user.verified_at, ...("terms_version" in extra ? { termsVersion: extra.terms_version ?? null } : {}) };
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

    const headers = req.headers ?? {};
    const where = { ip: clientIp(headers), device: deviceOf(headers) };
    const column = identifier.kind === "phone" ? "phone" : "email";
    const accountFor = async () => (await sb<AppUser[]>(`app_users?${column}=eq.${encodeURIComponent(identifier.value)}&select=*&limit=1`))?.[0];
    /** A failed attempt, on the record: against the account if there is one, else against the number's last four. */
    const record = async (action: "auth.code_wrong" | "auth.locked_out", summary: string) => {
      const user = await accountFor().catch(() => undefined);
      await audit({
        actor: user ?? null,
        action,
        target: user ? { type: "user", id: user.id, label: user.name ?? lastFour(identifier.value) } : { type: "phone", id: lastFour(identifier.value) },
        summary: `${summary} for ${user?.name ?? lastFour(identifier.value)}`,
        detail: where,
      });
    };

    const rows = await sb<CodeRow[]>(
      `login_codes?identifier=eq.${encodeURIComponent(identifier.value)}` + `&consumed=is.false&select=id,code_hash,expires_at,attempts,consumed` + `&order=created_at.desc&limit=1`,
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
          await record("auth.locked_out", "Too many wrong sign-in codes");
          return fail(res, 429, "too_many_attempts", "Too many attempts. Request a new code.");
        }
        await record("auth.code_wrong", "Wrong sign-in code");
        return fail(res, 401, "wrong_code", "That code isn't right.");
      }
    } else if (!safeEqual(row.code_hash, hashCode(identifier.value, code))) {
      // The attempt counts only if this request is the one that moved the
      // counter; a guess that lost the race is refused outright.
      if (!(await spendAttempt(row))) {
        await record("auth.locked_out", "Too many wrong sign-in codes");
        return fail(res, 429, "too_many_attempts", "Too many attempts. Request a new code.");
      }
      const left = MAX_CODE_ATTEMPTS - (row.attempts + 1);
      await record(left > 0 ? "auth.code_wrong" : "auth.locked_out", left > 0 ? "Wrong sign-in code" : "Too many wrong sign-in codes");
      return fail(res, 401, "wrong_code", left > 0 ? "That code isn't right." : "Too many attempts. Request a new code.");
    }

    // One-time use: the same write that spends the attempt consumes the code,
    // so a second request carrying the right code finds nothing to consume.
    if (!(await spendAttempt(row, { consumed: true }))) {
      return fail(res, 429, "too_many_attempts", "Too many attempts. Request a new code.");
    }

    const now = new Date().toISOString();
    let user = await accountFor();

    // A number the office doesn't know, proved by its code: a request to join,
    // for an owner or admin to approve. It can change nothing until they do.
    if (!user) {
      const created = await sb<AppUser[]>("app_users", {
        method: "POST",
        prefer: "return=representation",
        body: [{ [column]: identifier.value, role: WAITING_ROLE, status: "incoming", verified_at: now }],
      });
      user = created?.[0];
      if (user) {
        await audit({
          actor: user,
          action: "user.request",
          target: { type: "user", id: user.id, label: lastFour(identifier.value) },
          summary: `${lastFour(identifier.value)} asked to join BFO`,
          detail: where,
        });
      }
      return res.status(200).json({ verified: true, status: "incoming", token: null });
    }

    await sb(`app_users?id=eq.${user.id}`, {
      method: "PATCH",
      body: { verified_at: user.verified_at ?? now, ...(user.status === "approved" ? { last_login_at: now } : {}) },
    });
    const who = { type: "user", id: user.id, label: user.name ?? lastFour(identifier.value) };

    // Refused, removed or turned off: one plain answer, whatever the reason.
    if (user.status === "denied") {
      await audit({ actor: user, action: "auth.sign_in_refused", target: who, summary: `Sign-in refused for ${who.label}: no access`, detail: where });
      return fail(res, 403, "not_allowed", NOT_ALLOWED);
    }

    // Verified, but an owner or admin still has to let them in.
    if (user.status !== "approved") {
      await audit({ actor: user, action: "auth.sign_in_waiting", target: who, summary: `${who.label} signed in and is waiting for approval`, detail: where });
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
    await audit({ actor: user, action: "auth.sign_in", target: who, summary: `${who.label} signed in`, detail: where });
    await purgeStale();

    return res.status(200).json({
      verified: true,
      status: user.status,
      token: session.token,
      expiresAt: session.expires_at,
      user: signedInUser({ ...user, last_login_at: now }),
    });
  } catch (err) {
    const plain = publicRefusal(err);
    if (plain) {
      console.error("verify-code: the code couldn't be checked", { configError: true });
      return refuse(res, plain);
    }
    return handleError(res, err);
  }
}
