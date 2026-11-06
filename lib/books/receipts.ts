import { audit } from "../audit.js";
import { sbFetch as db } from "../auth.js";
import { storageSignedUrl } from "../storage.js";
import { writeLog } from "./audit.js";
import { isMissingColumn, readEntityMap, readLocks, writeTolerant } from "./db.js";
import { isLocked } from "./ledger.js";
import { fail, ok, type Query, type Reply, type WriteCtx } from "./types.js";

/**
 * Receipts attached to a transaction (a link, or a file in Storage uploaded
 * through api/books/upload-receipt) and the history they're shown beside.
 * A receipt is evidence: removing one keeps the record and the stored file,
 * with who removed it, when and why, and is refused in a closed period.
 *
 * HTTP surface: none here; api/books/data.ts routes add_receipt,
 * delete_receipt and ?report=history to these.
 * Who may call it: reading, anyone signed in; adding and removing, anyone
 * who can write (the router checks).
 * Env: SUPABASE_URL and SUPABASE_SERVICE_KEY (through sbFetch); the storage
 * bucket's settings (lib/storage.ts) for signed links.
 */

const RECEIPT_EXTRAS = ["uploaded_by", "uploaded_by_name", "removed_at", "removed_by", "removed_by_name", "removed_reason"];

export async function addReceipt({ body, user }: WriteCtx): Promise<Reply> {
  const txnId = String(body.transaction_id ?? "").trim();
  const url = String(body.url ?? "").trim();
  const label = body.label != null ? String(body.label).trim().slice(0, 120) : null;
  if (!txnId) return fail(400, { error: "missing_transaction_id" });
  if (!/^https?:\/\/.{3,}/i.test(url)) return fail(400, { error: "bad_url" });
  const r = await writeTolerant(
    db,
    "book_txn_receipt",
    "POST",
    { transaction_id: txnId, url: url.slice(0, 1000), label, uploaded_by: user.id, uploaded_by_name: user.name ?? null },
    RECEIPT_EXTRAS,
    { Prefer: "return=representation" },
  );
  if (!r.ok) return fail(500, { error: "receipt_failed" });
  const receipt = ((await r.json()) as Array<Record<string, unknown>>)[0] ?? null;
  await writeLog([{ transaction_id: txnId, field: "receipt", old_value: null, new_value: label || url.slice(0, 200), source: "receipt", actor: user.id, actor_name: user.name ?? null }]);
  return ok({ receipt });
}

/**
 * Remove a receipt from a transaction. The record and the stored file are
 * kept (removed_at, removed_by, the reason); a closed period refuses it.
 * Before the ledger migration there is nowhere to keep that, so it refuses
 * rather than delete evidence.
 */
export async function deleteReceipt({ body, user }: WriteCtx): Promise<Reply> {
  const id = Number(body.id);
  if (!Number.isInteger(id)) return fail(400, { error: "bad_id" });
  const reason = body.reason ? String(body.reason).trim().slice(0, 300) : null;
  const rowRes = await db(`book_txn_receipt?id=eq.${id}&select=id,transaction_id,label,url,path&limit=1`);
  const row = rowRes.ok ? (((await rowRes.json()) as Array<{ id: number; transaction_id: string; label: string | null; url: string | null; path: string | null }>)[0] ?? null) : null;
  if (!row) return fail(404, { error: "not_found" });

  const txnRes = await db(`book_transactions?transaction_id=eq.${encodeURIComponent(row.transaction_id)}&select=date,account_id&limit=1`);
  const txn = txnRes.ok ? (((await txnRes.json()) as Array<{ date: string; account_id: string }>)[0] ?? null) : null;
  if (txn) {
    const [locks, entities] = await Promise.all([readLocks(db), readEntityMap(db)]);
    if (isLocked({ date: txn.date, entity_id: entities.get(txn.account_id)?.id ?? null }, locks)) {
      return fail(409, { error: "period_closed", message: "That transaction is in a closed period, so its receipts stay. An admin can reopen the period." });
    }
  }

  const r = await db(`book_txn_receipt?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ removed_at: new Date().toISOString(), removed_by: user.id, removed_by_name: user.name ?? null, removed_reason: reason }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    if (isMissingColumn(text)) return fail(409, { error: "needs_migration", message: "Removing a receipt needs a database update that hasn't been applied yet, so it stays attached for now." });
    return fail(500, { error: "receipt_failed", message: "Couldn't remove that receipt." });
  }
  await writeLog([{ transaction_id: row.transaction_id, field: "receipt", old_value: row.label || row.url || row.path, new_value: null, source: "receipt", actor: user.id, actor_name: user.name ?? null }]);
  await audit({
    actor: user,
    action: "books.receipt_remove",
    target: { type: "book_txn_receipt", id: String(id), label: row.label },
    summary: `Removed a receipt from a transaction (kept on file)`,
    detail: { transaction_id: row.transaction_id, reason },
  });
  return ok({ removed: true });
}

type LogEntry = { id: number; transaction_id: string; field: string; old_value: string | null; new_value: string | null; source: string | null; changed_at: string; actor: string | null; actor_name?: string | null };

/**
 * One transaction's history and receipts. Each history entry names the
 * person (by the name on record then, or now); receipts in use come first,
 * removed ones after, with who removed them.
 */
export async function historyReport(query: Query): Promise<Reply> {
  const txnId = String(query.transaction_id ?? "").trim();
  if (!txnId) return fail(400, { error: "missing_transaction_id" });
  const enc = encodeURIComponent(txnId);
  const [logRes, recRes] = await Promise.all([db(`book_txn_log?transaction_id=eq.${enc}&order=changed_at.desc&limit=500`), db(`book_txn_receipt?transaction_id=eq.${enc}&order=uploaded_at.desc`)]);
  const log = logRes.ok ? ((await logRes.json()) as LogEntry[]) : [];
  const rawReceipts = recRes.ok ? ((await recRes.json()) as Array<Record<string, unknown> & { path?: string | null; url?: string | null; removed_at?: string | null }>) : [];

  // Names for entries written before actor_name existed.
  const ids = [...new Set(log.filter((e) => e.actor && !e.actor_name && /^[0-9a-f-]{36}$/i.test(e.actor)).map((e) => e.actor as string))];
  const names = new Map<string, string>();
  if (ids.length) {
    const u = await db(`app_users?id=in.(${ids.map((i) => `"${i}"`).join(",")})&select=id,name`);
    if (u.ok) for (const p of (await u.json()) as Array<{ id: string; name: string | null }>) if (p.name) names.set(p.id, p.name);
  }
  const named = log.map((e) => ({ ...e, actor_name: e.actor_name ?? (e.actor ? (names.get(e.actor) ?? null) : null) }));

  // Storage-backed receipts are private: a short-lived signed link; an
  // outside link keeps its url. A removed receipt's file is still kept.
  const receipts = await Promise.all(
    rawReceipts.map(async (r) => ({
      ...r,
      url: r.path ? await storageSignedUrl(r.path).catch((err) => (console.error("books: couldn't sign a receipt link", err), null)) : r.url,
    })),
  );
  return ok({ log: named, receipts: receipts.filter((r) => !r.removed_at), removed_receipts: receipts.filter((r) => !!r.removed_at) });
}
