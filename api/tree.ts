import type { VercelRequest, VercelResponse } from "@vercel/node";
import { canWrite, currentUser, fail, handleError } from "../lib/auth.js";
import { importAll, migrateFirebaseFiles } from "../lib/firebase-bridge.js";
import {
  applyOps,
  collectionValue,
  MAX_BODY_BYTES,
  parseOps,
  parsePath,
  readCollection,
  readIndex,
  readRows,
  valueAt,
  type Collection,
} from "../lib/tree.js";

/**
 * The shared JSON tree (lib/tree.ts) for signed-in users. Any approved user
 * but "Email only" may read; owners, admins and members may write.
 *
 * GET ?path=assets                 → { value, updated }  a whole collection keyed by id, and each row's updated_at
 * GET ?path=assets/x/documents     → { value }       any node (null when missing)
 * GET ?path=assets&view=index      → { rows: [{ id, updated_at }] }   for change polling
 * GET ?path=assets&ids=a,b         → { rows: [{ id, data, updated_at }] }
 * POST { ops: [{ op: "set"|"update", path, value }] } → { rows }  the rows touched (data null = removed)
 *
 * Every collection is copied out of Firebase on the first request after deploy,
 * and an entity's old Firebase files are moved when it is read (lib/firebase-bridge.ts).
 */

export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

/** Files are moved as entities are read: all of one entity's, or a few seconds' worth across the lot. */
const FILES_BUDGET_MS = { one: 20_000, all: 5_000 };

function param(req: VercelRequest, name: string): string {
  const v = req.query?.[name];
  return String((Array.isArray(v) ? v[0] : v) ?? "");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") return fail(res, 405, "method_not_allowed");
  try {
    const me = await currentUser(req);
    if (!me) return fail(res, 401, "unauthorized");
    return req.method === "GET" ? await read(req, res) : await write(req, res, canWrite(me));
  } catch (err) {
    return handleError(res, err);
  }
}

async function read(req: VercelRequest, res: VercelResponse) {
  const path = parsePath(param(req, "path"));
  if (!path || !path.length) return fail(res, 400, "bad_path");
  const collection = path[0] as Collection;
  // Every collection is copied out of Firebase on the first request of any kind, so
  // nothing is left behind in a page nobody has opened yet. Done once, it's a few small reads.
  await importAll();

  if (collection === "assets") {
    await migrateFirebaseFiles(path.length >= 2 ? { assetId: path[1], budgetMs: FILES_BUDGET_MS.one } : { budgetMs: FILES_BUDGET_MS.all }).catch((err) =>
      console.error("firebase-bridge: file move failed", err)
    );
  }

  const view = param(req, "view");
  if (path.length === 1 && view === "index") return res.status(200).json({ rows: await readIndex(collection) });
  const ids = param(req, "ids");
  if (path.length === 1 && ids) {
    const list = ids.split(",").filter(Boolean).slice(0, 500);
    return res.status(200).json({ rows: await readRows(collection, list) });
  }
  if (path.length === 1) {
    const rows = await readCollection(collection);
    return res.status(200).json({ value: collectionValue(rows), updated: Object.fromEntries(rows.map((r) => [r.id, r.updated_at])) });
  }
  const row = (await readRows(collection, [path[1]]))[0];
  return res.status(200).json({ value: row ? valueAt(row.data, path.slice(2)) : null });
}

async function write(req: VercelRequest, res: VercelResponse, allowed: boolean) {
  if (!allowed) return fail(res, 403, "forbidden");
  let body = req.body ?? {};
  if (typeof body === "string") {
    if (body.length > MAX_BODY_BYTES) return fail(res, 413, "too_large");
    try {
      body = JSON.parse(body);
    } catch {
      return fail(res, 400, "bad_json");
    }
  }
  const ops = parseOps(body);
  if (!Array.isArray(ops)) return fail(res, 400, ops.error, ops.message);
  await importAll();
  return res.status(200).json({ rows: await applyOps(ops) });
}
