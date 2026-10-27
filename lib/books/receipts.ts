import { sbFetch as db } from "../auth.js";
import { storageRemove, storageSignedUrl } from "../storage.js";
import { fail, ok, type Query, type Reply, type WriteCtx } from "./types.js";

/**
 * Receipts attached to a transaction — a document URL, or an object in
 * Storage uploaded through api/books/upload-receipt — and the audit trail
 * they're shown beside.
 */

// ── Receipts: attach / remove a document URL on a transaction ────────────

export async function addReceipt({ body }: WriteCtx): Promise<Reply> {
  const txnId = String(body.transaction_id ?? "").trim();
  const url = String(body.url ?? "").trim();
  const label = body.label != null ? String(body.label).trim().slice(0, 120) : null;
  if (!txnId) return fail(400, { error: "missing_transaction_id" });
  if (!/^https?:\/\/.{3,}/i.test(url)) return fail(400, { error: "bad_url" });
  const r = await db("book_txn_receipt", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ transaction_id: txnId, url: url.slice(0, 1000), label }),
  });
  if (!r.ok) return fail(500, { error: "receipt_failed" });
  return ok({ receipt: ((await r.json()) as any[])[0] ?? null });
}

export async function deleteReceipt({ body }: WriteCtx): Promise<Reply> {
  const id = Number(body.id);
  if (!Number.isInteger(id)) return fail(400, { error: "bad_id" });
  // Remove the stored object too, if this receipt is storage-backed.
  const rowRes = await db(`book_txn_receipt?id=eq.${id}&select=path&limit=1`);
  const path = rowRes.ok ? ((await rowRes.json()) as any[])[0]?.path : null;
  if (path) await storageRemove(path);
  await db(`book_txn_receipt?id=eq.${id}`, { method: "DELETE" });
  return ok({ deleted: true });
}

// ── One transaction's audit trail + attached receipts ────────────────────

export async function historyReport(query: Query): Promise<Reply> {
  const txnId = String(query.transaction_id ?? "").trim();
  if (!txnId) return fail(400, { error: "missing_transaction_id" });
  const enc = encodeURIComponent(txnId);
  const [logRes, recRes] = await Promise.all([
    db(`book_txn_log?transaction_id=eq.${enc}&order=changed_at.desc&limit=200`),
    db(`book_txn_receipt?transaction_id=eq.${enc}&order=uploaded_at.desc`),
  ]);
  const log = logRes.ok ? await logRes.json() : [];
  const rawReceipts = recRes.ok ? ((await recRes.json()) as any[]) : [];
  // Storage-backed receipts are private — hand back a short-lived signed
  // URL; externally-linked ones keep their url as-is.
  const receipts = await Promise.all(
    rawReceipts.map(async (r) => ({
      ...r,
      url: r.path
        ? await storageSignedUrl(r.path).catch((err) => (console.error("books: couldn't sign a receipt link", err), null))
        : r.url,
    }))
  );
  return ok({ log, receipts });
}
