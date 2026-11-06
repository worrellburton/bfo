/**
 * The shared JSON tree (lib/tree.ts) for signed-in users. Any approved user
 * but "Email only" may read; owners, admins and members may write. Partners
 * (invited owners) read only the entities they've been given, nothing else.
 *
 * GET ?path=assets                 → { value, updated }  a whole collection keyed by id, and each row's updated_at
 * GET ?path=assets/x/documents     → { value }       any node (null when missing)
 * GET ?path=assets&view=index      → { rows: [{ id, updated_at }] }   for change polling
 * GET ?path=assets&ids=a,b         → { rows: [{ id, data, updated_at }] }
 * GET ?path=assets/x&view=activity[&before=iso] → { activity }  what happened to it, newest first (staff only)
 * POST { ops: [{ op: "set"|"update", path, value }], source?: "scan" } → { rows }  the rows touched (data null = removed)
 *
 * The write rules (lib/tree.ts): members record new entities and fill in
 * blanks, but changing an owner, or a legal name, form, tax class or EIN
 * already on record, or deleting an entity, takes an owner or admin (403
 * owner_or_admin). An EIN must look like one, never like an SSN (400
 * bad_ein), and belong to one entity (409 ein_in_use). A change of owner is
 * stamped with when and by whom, and goes to the audit trail. Notes are
 * stamped with their author; only the author or an owner or admin may change
 * or delete one, and deleting keeps it (deletedAt) rather than removing it.
 * `source: "scan"` marks the write as the document scan's in the entity's
 * activity, run by the person who started it.
 *
 * Every collection is copied out of Firebase on the first request after deploy,
 * and an entity's old Firebase files are moved when it is read (lib/firebase-bridge.ts).
 *
 * Env: SUPABASE_URL and SUPABASE_SERVICE_KEY; Firebase's public web config
 * for the one-way copy (lib/firebase-bridge.ts).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readActivity } from "../lib/activity.js";
import { audit } from "../lib/audit.js";
import { canWrite, currentUser, fail, handleError, isAdmin, isPartner, sb, type AppUser } from "../lib/auth.js";
import { accessibleAssetIds } from "../lib/entity-access.js";
import { importAll, migrateFirebaseFiles } from "../lib/firebase-bridge.js";
import {
  applyOps,
  collectionValue,
  einForms,
  einProblem,
  MAX_BODY_BYTES,
  noteRules,
  ownerStamps,
  parseOps,
  parsePath,
  readCollection,
  readIndex,
  readRows,
  rowKey,
  simulate,
  structuralChanges,
  structuralRefusal,
  touchedRows,
  valueAt,
  type Collection,
  type Json,
} from "../lib/tree.js";

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
    const me = await currentUser(req, { allowPartner: true });
    if (!me) return fail(res, 401, "unauthorized");
    const only = isPartner(me) ? new Set(await accessibleAssetIds(me.id)) : null;
    return req.method === "GET" ? await read(req, res, only) : await write(req, res, me);
  } catch (err) {
    return handleError(res, err);
  }
}

/** `only`: the entity ids a partner may read (null: everything). */
async function read(req: VercelRequest, res: VercelResponse, only: Set<string> | null) {
  const path = parsePath(param(req, "path"));
  if (!path || !path.length) return fail(res, 400, "bad_path");
  const collection = path[0] as Collection;
  if (param(req, "view") === "activity") {
    if (only || collection !== "assets" || path.length !== 2) return fail(res, only ? 403 : 400, only ? "forbidden" : "bad_path");
    return res.status(200).json({ activity: await readActivity(path[1], param(req, "before") || undefined) });
  }
  if (only) return readOwn(req, res, path, only);
  // Every collection is copied out of Firebase on the first request of any kind, so
  // nothing is left behind in a page nobody has opened yet. Done once, it's a few small reads.
  await importAll();

  if (collection === "assets") {
    await migrateFirebaseFiles(path.length >= 2 ? { assetId: path[1], budgetMs: FILES_BUDGET_MS.one } : { budgetMs: FILES_BUDGET_MS.all }).catch((err) =>
      console.error("firebase-bridge: file move failed", err),
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

/** Staff-only parts of an entity record, never sent to a partner. */
const STAFF_ONLY = ["notes", "contracts", "verification"];
const forPartner = <T extends { data: unknown }>(r: T): T =>
  r.data && typeof r.data === "object" ? { ...r, data: Object.fromEntries(Object.entries(r.data as Record<string, unknown>).filter(([k]) => !STAFF_ONLY.includes(k))) } : r;

/** A partner's read: their entities, and only under assets. */
async function readOwn(req: VercelRequest, res: VercelResponse, path: string[], only: Set<string>) {
  if (path[0] !== "assets") return fail(res, 403, "forbidden");
  if (path.length === 1) {
    const view = param(req, "view");
    const wanted = param(req, "ids")
      ? param(req, "ids")
          .split(",")
          .filter((id) => only.has(id))
      : [...only];
    const rows = (await readRows("assets", wanted.slice(0, 500))).map(forPartner);
    if (view === "index") return res.status(200).json({ rows: rows.map((r) => ({ id: r.id, updated_at: r.updated_at })) });
    if (param(req, "ids")) return res.status(200).json({ rows });
    return res.status(200).json({ value: collectionValue(rows), updated: Object.fromEntries(rows.map((r) => [r.id, r.updated_at])) });
  }
  if (!only.has(path[1]) || STAFF_ONLY.includes(path[2])) return fail(res, 403, "forbidden");
  const row = (await readRows("assets", [path[1]])).map(forPartner)[0];
  return res.status(200).json({ value: row ? valueAt(row.data, path.slice(2)) : null });
}

async function write(req: VercelRequest, res: VercelResponse, me: AppUser) {
  if (!canWrite(me)) return fail(res, 403, "forbidden");
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

  // Read what the write touches, and judge the rows as they'll be.
  const touched = touchedRows(ops);
  const ids = (c: Collection) => touched.filter((t) => t.collection === c).map((t) => t.id);
  const assetIds = ids("assets");
  const noteIds = ids("notes");
  const before = new Map<string, Json>();
  for (const [c, list] of [
    ["assets", assetIds],
    ["notes", noteIds],
  ] as const) {
    if (list.length) for (const r of await readRows(c, list)) before.set(rowKey(c, r.id), r.data);
  }
  const after = simulate(before, ops);
  const name = me.name || me.email || me.phone || null;
  const now = new Date();

  const changes = structuralChanges(before, after, assetIds);
  const refusal = structuralRefusal(changes, isAdmin(me));
  if (refusal) return fail(res, 403, "owner_or_admin", refusal);
  for (const c of changes) {
    if (c.field !== "ein" || !c.to || c.deleted) continue;
    const problem = einProblem(c.to);
    if (problem) return fail(res, 400, "bad_ein", problem);
    const forms = einForms(c.to);
    const holders =
      (await sb<{ id: string; name: string | null }[]>(`tree_nodes?collection=eq.assets&select=id,name:data->>name&data->>ein=in.(${encodeURIComponent(forms.map((f) => `"${f}"`).join(","))})`)) ?? [];
    const other = holders.find((h) => h.id !== c.id && !changes.some((x) => x.id === h.id && (x.field === "ein" || x.deleted)));
    if (other) return fail(res, 409, "ein_in_use", `${c.to} is already ${other.name || "another entity"}'s EIN.`);
  }
  const stamped = ownerStamps(changes, after, { id: me.id, name }, now);
  if (!Array.isArray(stamped)) return fail(res, 400, "bad_effective_date", stamped.error);

  const notes = noteRules(before, after, noteIds, { id: me.id, name, admin: isAdmin(me) }, now);
  if (notes.refusal) return fail(res, notes.refusal.status, notes.refusal.code, notes.refusal.message);

  const actor =
    (body as { source?: unknown }).source === "scan" ? { id: me.id, name: `Document scan, started by ${name ?? "staff"}`, source: "system" as const } : { id: me.id, name, source: "user" as const };
  const rows = await applyOps([...ops, ...stamped, ...notes.stamps], actor, before);

  // The record people and counsel read: owner changes, and notes deleted or restored.
  const label = (id: string) => {
    const r = after.get(rowKey("assets", id)) ?? before.get(rowKey("assets", id));
    return r && typeof r === "object" && !Array.isArray(r) && typeof r.name === "string" ? r.name : null;
  };
  for (const c of changes) {
    if (c.field !== "ownerId" || c.created || c.deleted) continue;
    const row = after.get(rowKey("assets", c.id));
    const effective = row && typeof row === "object" && !Array.isArray(row) && typeof row.ownerEffective === "string" ? row.ownerEffective : null;
    const to = c.to ? (label(c.to) ?? "another entity") : "no owner on record";
    await audit({
      actor: me,
      action: "entity.owner_change",
      target: { type: "entity", id: c.id, label: label(c.id) },
      summary: `Recorded ${label(c.id) ?? "an entity"} as owned by ${to}${effective ? `, effective ${effective}` : ""}`,
      detail: { from: c.from || null, to: c.to || null, effective },
    });
  }
  for (const e of notes.events) {
    await audit({
      actor: me,
      action: e.kind === "delete" ? "note.delete" : "note.restore",
      target: { type: "note", id: e.id, label: e.title },
      summary: `${e.kind === "delete" ? "Deleted" : "Restored"} the note “${e.title}”`,
    });
  }
  return res.status(200).json({ rows });
}
