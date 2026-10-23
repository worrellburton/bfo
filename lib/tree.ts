import { describeChange, logActivity, type Actor } from "./activity.js";
import { sb } from "./auth.js";

/**
 * The shared JSON tree (public.tree_nodes): what the app used to keep in
 * Firebase Realtime Database. A path is "collection/id/…", so "assets" is
 * every entity, "assets/x" one entity and "assets/x/documents/d" one of its
 * documents. The pure pieces (paths, reading a value out of rows, checking
 * operations) are exported on their own so they're tested without a network.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type TreeRow = { collection: string; id: string; data: Json; updated_at: string };
export type TreeOp = { op: "set" | "update"; path: string[]; value: Json };

/** Collections the app keeps in the tree. Anything else is refused. */
export const COLLECTIONS = ["assets", "estate-map", "frameworks", "notes", "agents"] as const;
export type Collection = (typeof COLLECTIONS)[number];

const SEGMENT_RE = /^[^.$#[\]/\u0000-\u001f\u007f]{1,768}$/;
const MAX_DEPTH = 32;
const MAX_OPS = 200;
/** One request's operations, serialised (an entity with every document is well under this). */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

export const isCollection = (s: string): s is Collection => (COLLECTIONS as readonly string[]).includes(s);

/** "a/b//c/" → ["a","b","c"], or null when a segment isn't allowed. The root is []. */
export function parsePath(raw: unknown): string[] | null {
  if (typeof raw !== "string") return null;
  const segments = raw.split("/").filter((s) => s !== "");
  if (segments.length > MAX_DEPTH) return null;
  for (const s of segments) if (!SEGMENT_RE.test(s)) return null;
  if (segments.length && !isCollection(segments[0])) return null;
  return segments;
}

/** The value at `sub` inside `data` (Firebase style: missing is null). */
export function valueAt(data: Json, sub: string[]): Json {
  let cur: Json = data;
  for (const k of sub) {
    if (cur === null || typeof cur !== "object") return null;
    cur = Array.isArray(cur) ? (cur[Number(k)] ?? null) : (cur[k] ?? null);
  }
  return cur === undefined ? null : cur;
}

/**
 * Firebase orders a node's children by key: integer-like keys first in
 * numeric order, then the rest in string order. Lists in the app are built
 * from Object.entries, so the rows go into the object in that order.
 */
export function compareKeys(a: string, b: string): number {
  const na = /^-?\d+$/.test(a) ? Number(a) : null;
  const nb = /^-?\d+$/.test(b) ? Number(b) : null;
  if (na !== null && nb !== null) return na - nb || a.localeCompare(b);
  if (na !== null) return -1;
  if (nb !== null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A whole collection as one object, keyed by row id in Firebase's order. */
export function collectionValue(rows: Pick<TreeRow, "id" | "data">[]): Json {
  if (!rows.length) return null;
  const out: { [k: string]: Json } = {};
  for (const r of [...rows].sort((x, y) => compareKeys(x.id, y.id))) out[r.id] = r.data;
  return out;
}

/** Only plain JSON (no undefined, functions, or NaN), within reason. */
function isJson(v: unknown, depth = 0): v is Json {
  if (depth > 64) return false;
  if (v === null) return true;
  if (typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => isJson(x, depth + 1));
  if (typeof v === "object") return Object.values(v as object).every((x) => isJson(x, depth + 1));
  return false;
}

/** The ops in a request body, checked, or a reason they're refused. */
export function parseOps(body: unknown): TreeOp[] | { error: string; message: string } {
  const raw = (body as { ops?: unknown })?.ops;
  if (!Array.isArray(raw) || !raw.length) return { error: "bad_ops", message: "Send a list of operations." };
  if (raw.length > MAX_OPS) return { error: "bad_ops", message: `Up to ${MAX_OPS} operations at a time.` };
  const ops: TreeOp[] = [];
  for (const item of raw as Array<Record<string, unknown>>) {
    const op = item?.op;
    if (op !== "set" && op !== "update") return { error: "bad_op", message: "Each operation is a set or an update." };
    const path = parsePath(item.path);
    if (!path) return { error: "bad_path", message: `"${String(item.path).slice(0, 80)}" isn't a path in the tree.` };
    const value = item.value === undefined ? null : item.value;
    if (!isJson(value)) return { error: "bad_value", message: "Values must be plain JSON." };
    if (op === "update") {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return { error: "bad_value", message: "An update takes an object of fields." };
      for (const key of Object.keys(value)) {
        // tree_apply splits the key as it is (string_to_array): an empty segment ("/a", "a//b") would be a field named "".
        const full = key.split("/").includes("") ? null : parsePathLoose([...path, ...key.split("/")]);
        if (!full) return { error: "bad_path", message: `"${key}" isn't a field path.` };
      }
    }
    // Writing the whole tree, or replacing a whole collection, is never what the app means.
    if (op === "set" && path.length < 2) return { error: "bad_path", message: "Set a row or a field, not a whole collection." };
    if (op === "update" && path.length === 0 && Object.keys(value as object).some((k) => k.split("/").filter(Boolean).length < 2)) {
      return { error: "bad_path", message: "Set a row or a field, not a whole collection." };
    }
    ops.push({ op, path, value });
  }
  return ops;
}

/** Like parsePath for an already-split path (an update key may add segments). */
function parsePathLoose(segments: string[]): string[] | null {
  const clean = segments.filter((s) => s !== "");
  if (clean.length > MAX_DEPTH || !clean.length) return null;
  for (const s of clean) if (!SEGMENT_RE.test(s)) return null;
  return isCollection(clean[0]) ? clean : null;
}

/** The (collection, id) rows an operation can change — what the caller is sent back. */
export function touchedRows(ops: TreeOp[]): { collection: Collection; id: string }[] {
  const seen = new Set<string>();
  const out: { collection: Collection; id: string }[] = [];
  const add = (c: string, id: string) => {
    if (!isCollection(c) || seen.has(`${c}/${id}`)) return;
    seen.add(`${c}/${id}`);
    out.push({ collection: c, id });
  };
  for (const o of ops) {
    const paths = o.op === "update" ? Object.keys(o.value as object).map((k) => [...o.path, ...k.split("/").filter(Boolean)]) : [o.path];
    for (const p of paths) if (p.length >= 2) add(p[0], p[1]);
  }
  return out;
}

// ── Supabase ─────────────────────────────────────────────────────────────

const enc = encodeURIComponent;

const PAGE = 1000;

/** Every row of one collection: PostgREST serves at most 1,000 a request, so page by id (unique within it). */
async function readPaged<T>(query: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = (await sb<T[]>(`${query}&order=id&limit=${PAGE}&offset=${offset}`)) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export async function readCollection(collection: Collection): Promise<TreeRow[]> {
  return readPaged<TreeRow>(`tree_nodes?collection=eq.${enc(collection)}&select=collection,id,data,updated_at`);
}

export async function readRows(collection: Collection, ids: string[]): Promise<TreeRow[]> {
  if (!ids.length) return [];
  const list = ids.map((id) => `"${id.replace(/[\\"]/g, (c) => `\\${c}`)}"`).join(",");
  return (await sb<TreeRow[]>(`tree_nodes?collection=eq.${enc(collection)}&id=in.(${enc(list)})&select=collection,id,data,updated_at`)) ?? [];
}

export async function readIndex(collection: Collection): Promise<{ id: string; updated_at: string }[]> {
  return readPaged<{ id: string; updated_at: string }>(`tree_nodes?collection=eq.${enc(collection)}&select=id,updated_at`);
}

/**
 * Apply operations in one transaction, then return the rows they touched (null data = gone).
 * With an actor, each entity it changes gets the change in its activity (lib/activity.ts).
 */
export async function applyOps(ops: TreeOp[], actor?: Actor): Promise<Array<TreeRow | { collection: Collection; id: string; data: null; updated_at: null }>> {
  const touched = touchedRows(ops);
  const assetIds = actor ? touched.filter((t) => t.collection === "assets").map((t) => t.id) : [];
  const before = assetIds.length ? new Map((await readRows("assets", assetIds)).map((r) => [r.id, r.data])) : null;
  await sb("rpc/tree_apply", { method: "POST", body: { ops } });
  const byCollection = new Map<Collection, string[]>();
  for (const t of touched) byCollection.set(t.collection, [...(byCollection.get(t.collection) ?? []), t.id]);
  const found = new Map<string, TreeRow>();
  for (const [collection, ids] of byCollection) for (const r of await readRows(collection, ids)) found.set(`${collection}/${r.id}`, r);
  if (actor && before) await recordActivity(assetIds, before, found, actor);
  return touched.map((t) => found.get(`${t.collection}/${t.id}`) ?? { ...t, data: null, updated_at: null });
}

async function recordActivity(ids: string[], before: Map<string, Json>, after: Map<string, TreeRow>, actor: Actor): Promise<void> {
  const asRec = (v: Json | undefined) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : null);
  const pairs = ids.map((id) => ({ id, b: asRec(before.get(id)), a: asRec(after.get(`assets/${id}`)?.data) }));
  // An owner shows by name: look up the ones that changed.
  const ownerIds = [...new Set(pairs.filter((p) => p.b?.ownerId !== p.a?.ownerId).flatMap((p) => [p.b?.ownerId, p.a?.ownerId]))].filter((v): v is string => typeof v === "string" && !!v);
  const names = new Map((ownerIds.length ? await readRows("assets", ownerIds).catch(() => []) : []).map((r) => [r.id, (r.data as { name?: string } | null)?.name ?? null]));
  for (const p of pairs) await logActivity(p.id, actor, describeChange(p.b, p.a, (id) => names.get(id) ?? null));
}
