/**
 * The shared audit trail: one append-only row per consequential action, in
 * public.audit_log (migration 20261106_audit_log.sql). Who changed someone's
 * access, archived an entity, deleted mail or a signature request, or changed
 * many transactions at once, and when. Books keeps its own field-level
 * history (lib/books/audit.ts), which the bank sync reads; this log is the
 * cross-area record people and counsel read.
 *
 * HTTP surface: none; a library for api/ handlers and crons.
 * Who may call it: server code, after the endpoint's own role check.
 * Env: SUPABASE_URL and SUPABASE_SERVICE_KEY (through sb() in lib/auth.ts).
 *
 * One line from any endpoint, after the action succeeds:
 *
 *   await audit({ actor: user, action: "entity.archive", target: { type: "entity", id, label: name }, summary: `Archived ${name}` });
 *
 * It never throws into the caller's request. A write that fails (the table
 * not applied yet, the database down) is logged as a warning with booleans
 * only, and audit() resolves false.
 *
 * Never put a secret, an SSN, a verification code or a message body in an
 * entry: auditRow() drops keys with those names and masks SSN-shaped text,
 * but the caller is the first line.
 */

import type { AppUser } from "./auth.js";
import { sb } from "./auth.js";
import { log } from "./log.js";

/** Who acted: a signed-in person, or the system on its own schedule. */
export type AuditActor = Pick<AppUser, "id" | "name" | "role"> | "system" | "cron" | "webhook";

export type AuditEntry = {
  actor: AuditActor | null;
  /** "<area>.<verb>": user.role_change, entity.archive, mail.delete, signature.delete, books.bulk_update. */
  action: string;
  /** The record acted on: its kind, id and name at the time. */
  target?: { type: string; id: string; label?: string | null } | null;
  /** How many records a bulk action touched. */
  count?: number | null;
  /** One plain sentence: "Deleted 3 messages from the office inbox". */
  summary: string;
  /** Ids, counts, before and after of ordinary fields. Never secrets or bodies. */
  detail?: Record<string, unknown> | null;
};

export type AuditRow = {
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  actor_kind: "user" | "system" | "cron" | "webhook";
  action: string;
  area: string;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  count: number | null;
  summary: string;
  detail: Record<string, unknown> | null;
};

/** Keys whose values never belong in the trail, whatever the caller passes. */
const FORBIDDEN = /^(ssn|itin|tin|taxid|password|passcode|secret|token|tokenhash|apikey|api_key|authorization|cookie|otp|code|verificationcode|body|html|text|raw)$/i;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const MAX_STRING = 500;
const MAX_DETAIL = 8000;
const ACTION = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A detail value made safe to keep: forbidden keys dropped, SSN-shaped text masked, strings clipped, depth limited. */
export function scrubDetail(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return clip(value.replace(SSN, "•••-••-••••"), MAX_STRING);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= 4) return "[nested]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubDetail(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN.test(k)) continue;
      out[k] = scrubDetail(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** The row audit() writes, or null when the entry can't be kept (no action or summary). Pure, so it's tested. */
export function auditRow(e: AuditEntry): AuditRow | null {
  const action = (e.action ?? "").trim();
  const summary = (e.summary ?? "").trim();
  if (!ACTION.test(action) || !summary) return null;
  const actor = e.actor;
  const person = actor && typeof actor === "object" ? actor : null;
  let detail = e.detail ? (scrubDetail(e.detail) as Record<string, unknown>) : null;
  if (detail && JSON.stringify(detail).length > MAX_DETAIL) detail = { truncated: true, keys: Object.keys(detail).slice(0, 40) };
  return {
    actor_id: person?.id ?? null,
    actor_name: person?.name ?? null,
    actor_role: person?.role ?? null,
    actor_kind: person ? "user" : typeof actor === "string" ? actor : "system",
    action,
    area: action.split(".")[0],
    target_type: e.target?.type ?? null,
    target_id: e.target?.id ?? null,
    target_label: e.target?.label ? clip(e.target.label.replace(SSN, "•••-••-••••"), 200) : null,
    count: typeof e.count === "number" && Number.isFinite(e.count) ? Math.round(e.count) : null,
    summary: clip(summary.replace(SSN, "•••-••-••••"), MAX_STRING),
    detail,
  };
}

/** Whether a failed write means the table isn't there yet (the migration not applied). */
export function isMissingTable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /PGRST205|42P01|does not exist|Could not find the table/i.test(msg);
}

/** Record one action. Never throws; resolves false when nothing was written. */
export async function audit(e: AuditEntry): Promise<boolean> {
  let row: AuditRow | null = null;
  try {
    row = auditRow(e);
  } catch {
    row = null;
  }
  if (!row) {
    log.warn("audit", "entry not written", { written: false, valid: false });
    return false;
  }
  try {
    await sb("audit_log", { method: "POST", body: row, prefer: "return=minimal" });
    return true;
  } catch (err) {
    log.warn("audit", "entry not written", { written: false, valid: true, tableMissing: isMissingTable(err), action: row.action });
    return false;
  }
}
