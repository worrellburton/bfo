import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, sbFetch as db } from "../../lib/auth.js";
import { storageUpload } from "../../lib/storage.js";

/**
 * Upload a receipt/document file for a transaction into the private storage
 * bucket. The client sends the file as base64 JSON; we store the bytes and
 * record a book_txn_receipt pointing at the object path (served later through
 * a short-lived signed URL, never a public link).
 */
export const config = { api: { bodyParser: { sizeLimit: "8mb" } } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });

  const txnId = String(req.body?.transaction_id ?? "").trim();
  const filename = String(req.body?.filename ?? "file").trim().slice(0, 120) || "file";
  const contentType = String(req.body?.content_type ?? "application/octet-stream").slice(0, 100);
  const base64 = String(req.body?.data_base64 ?? "");
  if (!txnId) return res.status(400).json({ error: "missing_transaction_id" });
  if (!base64) return res.status(400).json({ error: "no_file" });

  // Decode + size-guard (~5MB of actual bytes).
  const bytes = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ""), "base64");
  if (!bytes.length) return res.status(400).json({ error: "empty_file" });
  if (bytes.length > 3 * 1024 * 1024) return res.status(413).json({ error: "too_large", message: "Files must be under 3 MB." });

  try {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${txnId}/${Date.now()}-${safe}`;
    await storageUpload(path, new Uint8Array(bytes), contentType);
    const r = await db("book_txn_receipt", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ transaction_id: txnId, path, label: filename, content_type: contentType, source: "upload" }),
    });
    if (!r.ok) return res.status(500).json({ error: "record_failed" });
    return res.json({ receipt: ((await r.json()) as any[])[0] ?? null });
  } catch (err: any) {
    console.error("receipt upload error:", err.message);
    return res.status(500).json({ error: "upload_failed", message: err.message?.slice(0, 200) });
  }
}
