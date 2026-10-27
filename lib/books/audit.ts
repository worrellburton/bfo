import { sbFetch as db } from "../auth.js";

/**
 * The immutable change history behind every Books edit. The nightly bank
 * sync reads it to know which rows were hand-edited, so a write here is part
 * of the edit, not a nicety.
 */

/**
 * Record field-level changes to the immutable audit log — one row per field
 * that actually changed. The log is also how the nightly bank sync knows a
 * row was hand-edited (and keeps its vendor/account/type), so a lost write
 * here lets the next sync quietly undo the edit. Returns false when the write
 * failed even after one retry, so the caller can tell the person.
 */
export async function logChanges(
  transaction_ids: string[],
  before: Record<string, unknown> | null,
  patch: Record<string, unknown>,
  source: string,
  actor: string | null
): Promise<boolean> {
  const rows: any[] = [];
  for (const id of transaction_ids) {
    for (const [field, next] of Object.entries(patch)) {
      const prev = before ? before[field] : undefined;
      // For batch edits we don't hold each row's old value — log new only.
      if (before && String(prev ?? "") === String(next ?? "")) continue;
      rows.push({
        transaction_id: id,
        field,
        old_value: prev === undefined ? null : prev === null ? null : String(prev),
        new_value: next === null ? null : String(next),
        source,
        actor,
      });
    }
  }
  if (!rows.length) return true;
  let detail = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await db("book_txn_log", { method: "POST", body: JSON.stringify(rows) });
      if (r.ok) return true;
      detail = `${r.status}: ${(await r.text()).slice(0, 300)}`;
    } catch (err) {
      detail = err instanceof Error ? err.message : String(err);
    }
  }
  console.error(
    `BOOKS AUDIT LOG WRITE FAILED: ${transaction_ids.length} edited row(s) are not protected from the next bank sync`,
    { source, transaction_ids: transaction_ids.slice(0, 20), detail }
  );
  return false;
}

/** Whether a transaction has any audit history, i.e. the sync treats it as hand-edited. */
export async function hasHistory(transaction_id: string): Promise<boolean> {
  const r = await db(`book_txn_log?transaction_id=eq.${encodeURIComponent(transaction_id)}&select=transaction_id&limit=1`);
  if (!r.ok) throw new Error(`DB error: ${(await r.text()).slice(0, 300)}`);
  return ((await r.json()) as unknown[]).length > 0;
}

/** The answer when an edit saved but its audit row didn't. */
export const HISTORY_FAILED = {
  error: "history_failed",
  message: "Saved, but the change history couldn't record it, so the next bank sync could undo it. Try again in a moment.",
};
