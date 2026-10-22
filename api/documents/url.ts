import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, fail, guard, handleError, isPartner } from "../../lib/auth.js";
import { DOCUMENTS_BUCKET, documentStoragePath, readableEntity, recordReferencesPath, SIGNED_URL_TTL_S } from "../../lib/document-path.js";
import { accessibleAssetIds } from "../../lib/entity-access.js";
import { storageSignedUrl } from "../../lib/storage.js";
import { readRows } from "../../lib/tree.js";

/**
 * A short-lived signed link to one entity document, for the signed-in user.
 *
 * GET ?path=<assets/<assetId>/…>[&download=<file name>] → { url, expiresIn }
 *
 * `path` may also be a stored document URL (public or signed); only the
 * bucket path in it is used. Staff see every entity's documents; a partner
 * only those of the entities they've been given, and only files the entity
 * record still shows them. Works whether the "documents" bucket is public or
 * private: the link is signed with the service key either way.
 */

function param(req: VercelRequest, name: string): string {
  const v = req.query?.[name];
  return String((Array.isArray(v) ? v[0] : v) ?? "");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET"])) return;
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const me = await currentUser(req, { allowPartner: true });
    if (!me) return fail(res, 401, "unauthorized");

    const path = documentStoragePath(param(req, "path"));
    if (!path) return fail(res, 400, "invalid_path");

    const partnerAssets = isPartner(me) ? await accessibleAssetIds(me.id) : null;
    const assetId = readableEntity(me.role, path, partnerAssets);
    if (!assetId) return fail(res, 403, "forbidden");
    if (partnerAssets) {
      const row = (await readRows("assets", [assetId]))[0];
      if (!row || !recordReferencesPath(row.data, path)) return fail(res, 403, "forbidden");
    }

    const download = param(req, "download").replace(/[\u0000-\u001f\u007f"\\/]+/g, " ").trim().slice(0, 200) || undefined;
    const url = await storageSignedUrl(path, SIGNED_URL_TTL_S, DOCUMENTS_BUCKET, download);
    if (!url) return fail(res, 404, "not_found");
    return res.status(200).json({ url, expiresIn: SIGNED_URL_TTL_S });
  } catch (err) {
    return handleError(res, err);
  }
}
