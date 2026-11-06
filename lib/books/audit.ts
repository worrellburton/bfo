import { sbFetch } from "../auth.js";
import { fetchAll } from "../db-pages.js";
import { isMissingColumn, without } from "./db.js";
import { isHandEdit, logRowsFor, type Actor, type LogRow } from "./ledger.js";

/**
 * The field-level change history behind every Books change: who changed
 * which field of which transaction, from what to what, when, and how
 * ("edit", "batch", "rule:<id>", "vendor", "undo", "import", "receipt").
 * One row per field per transaction, in book_txn_log (append-only once
 * migration 20261107 is applied). The nightly bank sync reads it to know
 * which rows a person decided, so a write here is part of the change, not a
 * nicety. Bulk changes are recorded here as well as in the shared audit log
 * (lib/audit.ts), which says who did what in one line.
 *
 * HTTP surface: none; a library for the Books endpoints.
 * Who may call it: server code, after the endpoint's own role check.
 * Env: SUPABASE_URL and SUPABASE_SERVICE_KEY (through sbFetch).
 */

type Db = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * Write history rows, 500 at a time, retrying a failed write once. A
 * database without the actor_name column yet gets the rows without it.
 * Returns false when a write failed even after the retry, so the caller
 * can tell the person (the sync could otherwise undo the change).
 */
export async function writeLog(rows: LogRow[], db: Db = sbFetch): Promise<boolean> {
  if (!rows.length) return true;
  let all = true;
  for (let i = 0; i < rows.length; i += 500) {
    let part: Array<Record<string, unknown>> = rows.slice(i, i + 500);
    let ok = false;
    let detail = "";
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const r = await db("book_txn_log", { method: "POST", body: JSON.stringify(part) });
        if (r.ok) {
          ok = true;
          break;
        }
        detail = `${r.status}: ${(await r.text()).slice(0, 300)}`;
        if (isMissingColumn(detail)) part = without(part, ["actor_name"]);
      } catch (err) {
        detail = err instanceof Error ? err.message : String(err);
      }
    }
    if (!ok) {
      all = false;
      console.error(`BOOKS HISTORY WRITE FAILED: ${part.length} change(s) are not protected from the next bank sync`, { source: rows[i]?.source, detail });
    }
  }
  return all;
}

/**
 * Record field-level changes: one row per field that actually changed on
 * each transaction. `before` maps each id to its values before the change;
 * without it only the new values are logged (never invented old ones).
 */
export async function logChanges(transaction_ids: string[], before: Map<string, Record<string, unknown>> | Record<string, unknown> | null, patch: Record<string, unknown>, source: string, actor: Actor | string | null, db: Db = sbFetch): Promise<boolean> {
  const who: Actor = typeof actor === "string" ? { id: actor, name: null } : actor;
  const map = before instanceof Map ? before : before ? new Map(transaction_ids.map((id) => [id, before])) : null;
  return writeLog(logRowsFor(transaction_ids, map, patch, source, who), db);
}

/** Whether a transaction has a hand edit on record, i.e. the sync keeps what a person set. */
export async function hasHistory(transaction_id: string, db: Db = sbFetch): Promise<boolean> {
  const r = await db(`book_txn_log?transaction_id=eq.${encodeURIComponent(transaction_id)}&select=field,source&limit=50`);
  if (!r.ok) throw new Error(`DB error: ${(await r.text()).slice(0, 300)}`);
  return ((await r.json()) as Array<{ field: string; source: string | null }>).some(isHandEdit);
}

/** The ids among `ids` that a person changed by hand (a history entry not from the sync). */
export async function editedAmong(ids: string[], db: Db = sbFetch): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const list = ids
      .slice(i, i + 200)
      .map((id) => `"${id.replace(/"/g, "")}"`)
      .join(",");
    // Many fields per row can run past one 1,000-row page: read them all.
    const rows = await fetchAll<{ transaction_id: string; field: string; source: string | null }>(`book_txn_log?transaction_id=in.(${list})&select=transaction_id,field,source&order=id.asc`, db);
    for (const e of rows) if (isHandEdit(e)) out.add(e.transaction_id);
  }
  return out;
}

/** The answer when a change saved but its history row didn't. */
export const HISTORY_FAILED = {
  error: "history_failed",
  message: "Saved, but the change history couldn't record it, so the next bank sync could undo it. Try again in a moment.",
};
