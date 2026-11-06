/**
 * Delete an entity document for good. Documents are kept: removing one from
 * the library moves it to the entity's Removed list (a tree write, logged in
 * Activity), where it can be restored. Only from there, after it has been
 * kept RETENTION_DAYS, and only when the entity isn't on legal hold, can an
 * owner or admin delete it permanently, with a reason (lib/entity-archive.ts).
 *
 * POST { assetId, docId, reason } → { ok: true }
 *   409 retention | legal_hold | not_removed, 400 reason_required,
 *   502 storage_failed (nothing is changed when the file couldn't be deleted).
 *
 * Who may call it: owners and admins (403 owner_or_admin); a partner gets
 * 403 through currentUser. The file is deleted from storage first; the
 * entry leaves Removed only once it's gone, so the record never claims a
 * deletion that didn't happen. Each purge goes to the audit trail.
 *
 * Env: SUPABASE_URL and SUPABASE_SERVICE_KEY.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { audit } from "../../lib/audit.js";
import { currentUser, fail, guard, handleError, isAdmin } from "../../lib/auth.js";
import { purgeRefusal, removedPath } from "../../lib/entity-archive.js";
import { applyOps, readRows } from "../../lib/tree.js";

const BUCKET = "documents";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Supabase env vars not set");
  return createClient(url, key);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["POST"])) return;
  try {
    // currentUser throws PartnerRefused for a partner; handleError answers 403.
    const user = await currentUser(req);
    if (!user) return fail(res, 401, "unauthorized");

    const { assetId, docId, reason } = (req.body || {}) as { assetId?: unknown; docId?: unknown; reason?: unknown };
    if (typeof assetId !== "string" || !/^[A-Za-z0-9._-]+$/.test(assetId)) return fail(res, 400, "bad_asset");
    if (typeof docId !== "string" || !/^[^.$#[\]/]{1,768}$/.test(docId)) return fail(res, 400, "bad_document");
    const why = typeof reason === "string" ? reason.trim().slice(0, 500) : "";

    const row = (await readRows("assets", [assetId]))[0];
    const refusal = purgeRefusal(row?.data ?? null, docId, { admin: isAdmin(user), reason: why, now: Date.now() });
    if (refusal) return fail(res, refusal.status, refusal.code, refusal.message);

    const data = (row!.data ?? {}) as Record<string, any>;
    const doc = data.removedDocuments?.[docId] ?? {};
    const path = removedPath(data, assetId, docId);
    if (path) {
      const { error } = await getSupabase().storage.from(BUCKET).remove([path]);
      if (error) return fail(res, 502, "storage_failed", "The file couldn't be deleted from storage, so nothing was changed. Try again.");
    }
    await applyOps([{ op: "set", path: ["assets", assetId, "removedDocuments", docId], value: null }], { id: user.id, name: user.name || user.email || user.phone || null, source: "user" });
    await audit({
      actor: user,
      action: "document.purge",
      target: { type: "document", id: docId, label: typeof doc.name === "string" ? doc.name : null },
      summary: `Deleted “${typeof doc.name === "string" ? doc.name : "a document"}” for good from ${typeof data.name === "string" ? data.name : "an entity"}`,
      detail: { assetId, reason: why, hadFile: !!path },
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return handleError(res, err);
  }
}
