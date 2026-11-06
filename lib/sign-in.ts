/**
 * Sign-in's shared server steps: holding a code's row before anything is
 * counted or sent, the caps that stop SMS pumping, the plain answers an
 * anonymous caller gets when something isn't theirs to fix, and the
 * retention purge for sign-in records (lib/terms.ts RETENTION, stated in the
 * Privacy notice). Used by api/auth/request-code.ts, verify-code.ts and
 * complete-profile.ts, so adding a phone after sign-in passes the same
 * checks as signing in.
 *
 * HTTP surface: none; a library for those endpoints.
 * Who may call it: the sign-in endpoints, before or after their own checks.
 * Env: SIGNIN_HOURLY_CAP (optional; codes sent to everyone per hour, default
 * 60), SUPABASE_URL and SUPABASE_SERVICE_KEY (through sb()).
 *
 * Pure parts (clientIp, deviceOf, isMissingColumn, publicRefusal,
 * purgePaths, lastFour) are exported on their own and tested.
 */

import { audit } from "./audit.js";
import { CODE_RESEND_MS, ConfigError, sb } from "./auth.js";
import { countRows } from "./db-pages.js";
import { log } from "./log.js";
import { RETENTION } from "./terms.js";

/** Codes one number may ask for in an hour. */
export const MAX_CODES_PER_HOUR = 5;
/** Codes one address may ask for in ten minutes, whatever numbers it tries. */
export const MAX_CODES_PER_IP = 5;
export const IP_WINDOW_MS = 10 * 60 * 1000;
/** The role a verified stranger waits with: they can change nothing until someone chooses otherwise. */
export const WAITING_ROLE = "viewer" as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Codes sent to everyone together per hour (SIGNIN_HOURLY_CAP), default 60. */
export function hourlyCap(raw: string | undefined = process.env.SIGNIN_HOURLY_CAP): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 60;
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

/** The browser or app that signed in, for the record (user agent, clipped). */
export function deviceOf(headers: Record<string, string | string[] | undefined>): string | null {
  const ua = headers["user-agent"];
  const raw = (Array.isArray(ua) ? ua[0] : ua)?.trim();
  return raw ? raw.slice(0, 160) : null;
}

/** "•• 0142": a number as the trail keeps it when it isn't on an account. */
export function lastFour(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `•• ${digits.slice(-4)}`;
}

/** Whether a failed write names a column the database doesn't have yet (its migration not applied). */
export function isMissingColumn(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /PGRST204|42703|column .* does not exist|Could not find the '[^']+' column/i.test(msg);
}

/**
 * Runs a write; if the database is missing any of the `optional` columns (a
 * migration written but not applied yet), writes again without them. The
 * write itself still happens, so sign-in never breaks on a pending migration.
 */
export async function writeWithOptional<T>(write: (body: Record<string, unknown>) => Promise<T>, body: Record<string, unknown>, optional: readonly string[]): Promise<T> {
  try {
    return await write(body);
  } catch (err) {
    if (!optional.some((k) => k in body) || !isMissingColumn(err)) throw err;
    log.warn("sign-in", "written without columns the database doesn't have yet", { columnsMissing: true });
    return write(Object.fromEntries(Object.entries(body).filter(([k]) => !optional.includes(k))));
  }
}

export type Held = { id: string; created_at: string };
export type Refusal = { status: number; error: string; message: string; retryAfter?: number };

/**
 * Write the code's row before anything is counted or sent, held back
 * (consumed, so verify-code passes over it) until the code is out. Each cap
 * counts the rows written before it, so a burst of parallel requests can't
 * all pass a count taken before any of them was written. `purpose` "profile"
 * rows (a phone added after sign-in) count toward the caps but can never be
 * used to sign in. `consent` is the disclosure version the person saw.
 */
export async function holdCode(identifier: string, ip: string | null, purpose: "sign_in" | "profile", consent: string | null): Promise<Held> {
  const body = { identifier, code_hash: purpose === "profile" ? "profile" : "pending", consumed: true, expires_at: new Date().toISOString(), ip, consent_version: consent };
  const rows = await writeWithOptional(
    (b) =>
      sb<Held[]>("login_codes?select=id,created_at", {
        method: "POST",
        prefer: "return=representation",
        body: [b],
      }),
    body,
    ["consent_version"],
  );
  const held = rows?.[0];
  if (!held) throw new Error("sign-in: the code's row wasn't written");
  return held;
}

/** Take a held row out again: the request sent nothing. */
export async function release(held: Held): Promise<void> {
  await sb(`login_codes?id=eq.${held.id}`, { method: "DELETE" }).catch((err) => console.error("sign-in: couldn't release a held code row", err));
}

/**
 * The caps, in order: a global ceiling per hour (cycling fresh numbers can't
 * run up the SMS bill), one address asking for many numbers, then one number
 * asking too often. None of them looks at accounts, so a refusal says nothing
 * about who has one. countRows throws when it can't count, so an unknown
 * count never lets a code through. Null when the code may go.
 */
export async function capsRefusal(held: Held, identifier: string, ip: string | null): Promise<Refusal | null> {
  const upTo = encodeURIComponent(held.created_at);
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const sentLastHour = await countRows("login_codes", `created_at=gte.${encodeURIComponent(hourAgo)}&created_at=lte.${upTo}`);
  if (sentLastHour > hourlyCap()) {
    console.error(`sign-in: global cap reached (${sentLastHour} codes in the last hour)`);
    return { status: 429, error: "busy", message: "Sign-in is busy right now. Try again in a few minutes.", retryAfter: 600 };
  }

  if (ip) {
    const windowStart = encodeURIComponent(new Date(Date.now() - IP_WINDOW_MS).toISOString());
    const fromIp = await countRows("login_codes", `ip=eq.${encodeURIComponent(ip)}&created_at=gte.${windowStart}&created_at=lt.${upTo}`);
    if (fromIp >= MAX_CODES_PER_IP) {
      console.error(`sign-in: per-address cap reached (${fromIp} codes in ten minutes)`);
      return { status: 429, error: "rate_limited", message: "Too many codes requested from this connection. Try again in ten minutes.", retryAfter: 600 };
    }
  }

  const recent = await sb<Array<{ created_at: string }>>(
    `login_codes?identifier=eq.${encodeURIComponent(identifier)}` + `&created_at=gte.${hourAgo}&created_at=lt.${upTo}` + `&select=created_at&order=created_at.desc`,
  );
  const newest = recent?.[0] ? new Date(recent[0].created_at).getTime() : 0;
  const sinceNewest = Date.now() - newest;
  if (newest && sinceNewest < CODE_RESEND_MS) {
    return { status: 429, error: "too_soon", message: "Hold on a moment before requesting another code.", retryAfter: Math.ceil((CODE_RESEND_MS - sinceNewest) / 1000) };
  }
  if ((recent?.length ?? 0) >= MAX_CODES_PER_HOUR) {
    return { status: 429, error: "rate_limited", message: "Too many codes requested. Try again in an hour." };
  }
  return null;
}

/**
 * What a caller is told when sending or checking a code fails for a reason
 * that isn't theirs (a provider or configuration problem). The detail stays
 * in the server log; nobody signing in sees provider names or settings.
 * Null for errors this doesn't cover (handleError answers those).
 */
export function publicRefusal(err: unknown): Refusal | null {
  if (!(err instanceof ConfigError)) return null;
  if (/too many codes/i.test(err.message)) return { status: 429, error: "rate_limited", message: "Too many codes were requested for this number. Wait a minute and try again." };
  if (/didn't accept that address or number/i.test(err.message)) return { status: 400, error: "invalid_identifier", message: "That number can't receive a code. Check it and try again." };
  return { status: 503, error: "unavailable", message: "Sign-in isn't available right now. Try again later." };
}

/** Answer with a refusal (and its Retry-After). */
export function refuse(res: { setHeader?: (k: string, v: string) => unknown; status: (c: number) => { json: (j: unknown) => unknown } }, r: Refusal) {
  if (r.retryAfter) res.setHeader?.("Retry-After", String(r.retryAfter));
  return res.status(r.status).json({ error: r.error, message: r.message });
}

/**
 * What the retention purge deletes, as PostgREST paths: sign-in codes (and
 * the addresses they came from) after 90 days, and a request to join that no
 * one approved after 30 days. Only rows that never had access: no approval,
 * no mailbox, still waiting. A removed or revoked person is never purged.
 */
export function purgePaths(now: Date): string[] {
  const codesBefore = new Date(now.getTime() - RETENTION.loginCodesDays * DAY_MS).toISOString();
  const waitingBefore = new Date(now.getTime() - RETENTION.waitingRequestDays * DAY_MS).toISOString();
  return [
    `login_codes?created_at=lt.${encodeURIComponent(codesBefore)}&select=id`,
    `app_users?status=eq.incoming&approved_at=is.null&mail_address=is.null&created_at=lt.${encodeURIComponent(waitingBefore)}&select=id`,
  ];
}

const PURGE_EVERY_MS = 6 * 60 * 60 * 1000;
let lastPurge = 0;

/**
 * Run the retention purge, at most every six hours per running instance. It
 * rides on sign-ins (which happen daily), so no scheduled job is needed for
 * it; it never throws into the request that carried it.
 */
export async function purgeStale(now = new Date()): Promise<void> {
  if (now.getTime() - lastPurge < PURGE_EVERY_MS) return;
  lastPurge = now.getTime();
  try {
    const [codes, waiting] = purgePaths(now);
    const removedCodes = await sb<Array<{ id: string }>>(codes, { method: "DELETE", prefer: "return=representation" });
    const removedWaiting = await sb<Array<{ id: string }>>(waiting, { method: "DELETE", prefer: "return=representation" });
    const n = removedWaiting?.length ?? 0;
    if (n > 0) {
      await audit({
        actor: "system",
        action: "user.request_expired",
        count: n,
        summary: `Deleted ${n === 1 ? "1 request" : `${n} requests`} to join that no one approved within ${RETENTION.waitingRequestDays} days`,
        detail: { codesDeleted: removedCodes?.length ?? 0 },
      });
    }
  } catch (err) {
    log.warn("sign-in", "retention purge didn't finish", { purged: false, columnsMissing: isMissingColumn(err) });
  }
}

/** For tests: let the next purgeStale() run. */
export function resetPurgeClock() {
  lastPurge = 0;
}
