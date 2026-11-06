/**
 * The shared JSON tree (public.tree_nodes): what the app used to keep in
 * Firebase Realtime Database. A path is "collection/id/…", so "assets" is
 * every entity, "assets/x" one entity and "assets/x/documents/d" one of its
 * documents. The pure pieces (paths, reading a value out of rows, checking
 * operations, and the rules on what a write may change) are exported on
 * their own so they're tested without a network.
 *
 * HTTP surface: none; a library. api/tree.ts serves it to the browser, and
 * the Palm and state-record jobs write through applyOps.
 * Who may call it: server code, after its own role check. The write rules
 * here (structuralRefusal, noteRules) are applied by api/tree.ts.
 * Env: SUPABASE_URL and SUPABASE_SERVICE_KEY (through sb() in lib/auth.ts).
 */

import { describeChange, logActivity, type Actor } from "./activity.js";
import { sb } from "./auth.js";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type TreeRow = { collection: string; id: string; data: Json; updated_at: string };
export type TreeOp = { op: "set" | "update"; path: string[]; value: Json };

/**
 * Collections the app keeps in the tree. Anything else is refused. "agents" (the
 * old Office page's model agents, each holding a provider API key) is left out
 * on purpose: those rows must never be served to a browser.
 */
export const COLLECTIONS = ["assets", "estate-map", "frameworks", "notes"] as const;
export type Collection = (typeof COLLECTIONS)[number];

const SEGMENT_RE = /^[^.$#[\]/\u0000-\u001f\u007f]{1,768}$/;
const MAX_DEPTH = 32;
const MAX_OPS = 200;
/** One request's operations, serialised (an entity with every document is well under this). */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

const isCollection = (s: string): s is Collection => (COLLECTIONS as readonly string[]).includes(s);

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

// ── What a write ends up changing ───────────────────────────────────────

/** "collection/id": the key the write rules use for a row. */
export const rowKey = (collection: string, id: string) => `${collection}/${id}`;

const isObj = (v: Json | undefined): v is { [k: string]: Json } => !!v && typeof v === "object" && !Array.isArray(v);

/** `data` with `value` at `sub` (null removes, Firebase style); copies on the way down, never mutates. */
function setIn(data: Json, sub: string[], value: Json): Json {
  if (!sub.length) return value;
  const base: { [k: string]: Json } = isObj(data) ? { ...data } : {};
  const [k, ...rest] = sub;
  const next = setIn(base[k] ?? null, rest, value);
  if (next === null) delete base[k];
  else base[k] = next;
  return Object.keys(base).length ? base : null;
}

/**
 * The rows as they'll be once `ops` are applied to `before` (keyed by
 * rowKey; a missing key is a row that isn't there). Pure: it mirrors what
 * tree_apply does, so a write can be judged before it's sent.
 */
export function simulate(before: Map<string, Json>, ops: TreeOp[]): Map<string, Json> {
  const after = new Map(before);
  const put = (path: string[], value: Json) => {
    if (path.length < 2) return;
    const key = rowKey(path[0], path[1]);
    const next = setIn(after.get(key) ?? null, path.slice(2), value);
    if (next === null) after.delete(key);
    else after.set(key, next);
  };
  for (const o of ops) {
    if (o.op === "set") put(o.path, o.value);
    else for (const [k, v] of Object.entries(o.value as { [k: string]: Json })) put([...o.path, ...k.split("/").filter(Boolean)], v);
  }
  return after;
}

/** Fields that say what an entity is and who owns it: changing one once it's on record is an owner's or admin's call. */
export const STRUCTURAL_FIELDS = ["ownerId", "name", "type", "llcType", "ein"] as const;
export type StructuralField = (typeof STRUCTURAL_FIELDS)[number];

const FIELD_WORDS: Record<StructuralField, string> = { ownerId: "owner", name: "legal name", type: "legal form", llcType: "tax classification", ein: "EIN" };

const filled = (v: Json | undefined) => v !== null && v !== undefined && String(v).trim() !== "";
const norm = (v: Json | undefined) => (filled(v) ? String(v).trim() : "");

export type EntityChange = {
  id: string;
  field: StructuralField;
  from: string;
  to: string;
  /** The entity is new in this write (recording one that exists). */
  created: boolean;
  /** The entity is removed in this write. */
  deleted: boolean;
};

/** The structural fields this write changes, entity by entity. */
export function structuralChanges(before: Map<string, Json>, after: Map<string, Json>, ids: string[]): EntityChange[] {
  const out: EntityChange[] = [];
  for (const id of ids) {
    const b = before.get(rowKey("assets", id));
    const a = after.get(rowKey("assets", id));
    const created = b === undefined && a !== undefined;
    const deleted = b !== undefined && a === undefined;
    for (const field of STRUCTURAL_FIELDS) {
      const from = norm(isObj(b) ? b[field] : undefined);
      const to = norm(isObj(a) ? a[field] : undefined);
      if (from !== to) out.push({ id, field, from, to, created, deleted });
    }
  }
  return out;
}

/**
 * Why someone who isn't an owner or an admin may not make these changes, or
 * null. Members record new entities and fill in blanks (a scan does the
 * same); changing an owner, or a legal name, form, tax class or EIN that's
 * already on record, or deleting an entity, is an owner's or admin's call.
 */
export function structuralRefusal(changes: EntityChange[], admin: boolean): string | null {
  if (admin) return null;
  for (const c of changes) {
    if (c.created) continue;
    if (c.deleted) return "Only an owner or an admin can delete an entity.";
    if (c.field === "ownerId") return "Only an owner or an admin can change who owns an entity.";
    if (c.from) return `Only an owner or an admin can change an entity's ${FIELD_WORDS[c.field]} once it's on record.`;
  }
  return null;
}

/** An EIN's shape, checked when one is recorded: 9 digits, and never a Social Security number. */
export function einProblem(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{3}-\d{2}-\d{4}$/.test(s)) return "That looks like a Social Security number. An EIN is written 12-3456789.";
  if (s.replace(/[\s-]/g, "").length !== 9 || !/^\d{2}-?\s?\d{7}$/.test(s)) return "An EIN is 9 digits, written 12-3456789.";
  return null;
}

/** The forms an EIN may be stored in, to find another entity that already has it. */
export function einForms(raw: string): string[] {
  const d = raw.replace(/\D/g, "");
  return d.length === 9 ? [`${d.slice(0, 2)}-${d.slice(2)}`, d] : [raw.trim()];
}

/**
 * What the server adds to a write that changes an owner: when, and by whom.
 * The effective date is the writer's (`ownerEffective`, YYYY-MM-DD); the
 * stamp is the server's, so it can't be back-dated.
 */
export function ownerStamps(changes: EntityChange[], after: Map<string, Json>, by: { id: string; name: string | null }, now: Date): TreeOp[] | { error: string } {
  const out: TreeOp[] = [];
  for (const c of changes) {
    if (c.field !== "ownerId" || c.deleted) continue;
    const row = after.get(rowKey("assets", c.id));
    const eff = isObj(row) ? row.ownerEffective : undefined;
    if (eff != null && eff !== "" && (typeof eff !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(eff))) return { error: "The effective date must be a date (YYYY-MM-DD)." };
    out.push({ op: "update", path: ["assets", c.id], value: { ownerChangedAt: now.toISOString(), ownerChangedBy: { id: by.id, name: by.name } } });
  }
  return out;
}

export type NoteRuling = {
  refusal?: { status: number; code: string; message: string };
  /** Writes the server adds: the author and time on a new note, who deleted and when. */
  stamps: TreeOp[];
  /** Deletions and restorations, for the audit trail. */
  events: { kind: "delete" | "restore"; id: string; title: string }[];
};

/**
 * The rules for notes. A new note is stamped with its author and the
 * server's time. Notes are kept: delete sets deletedAt (and the server adds
 * who), and a hard delete is refused. Only the note's author, or an owner
 * or admin, may change or delete it, and nobody may change its author or date.
 */
export function noteRules(
  before: Map<string, Json>,
  after: Map<string, Json>,
  ids: string[],
  me: { id: string; name: string | null; admin: boolean },
  now: Date,
): NoteRuling {
  const stamps: TreeOp[] = [];
  const events: NoteRuling["events"] = [];
  const by = { id: me.id, name: me.name };
  for (const id of ids) {
    const b = before.get(rowKey("notes", id));
    const a = after.get(rowKey("notes", id));
    if (b === undefined && a === undefined) continue;
    if (b === undefined) {
      stamps.push({ op: "update", path: ["notes", id], value: { createdBy: by, createdAt: now.getTime(), deletedAt: null, deletedBy: null } });
      continue;
    }
    if (a === undefined) return { stamps: [], events: [], refusal: { status: 409, code: "notes_are_kept", message: "Notes are kept. Deleting one moves it to Deleted." } };
    const author = isObj(b) && isObj(b.createdBy) ? b.createdBy.id : null;
    if (!me.admin && author !== me.id) {
      return { stamps: [], events: [], refusal: { status: 403, code: "not_your_note", message: "Only the person who wrote a note, or an owner or admin, can change or delete it." } };
    }
    const same = (k: string) => JSON.stringify(isObj(b) ? (b[k] ?? null) : null) === JSON.stringify(isObj(a) ? (a[k] ?? null) : null);
    if (!same("createdBy") || !same("createdAt") || !same("deletedBy")) {
      return { stamps: [], events: [], refusal: { status: 400, code: "note_history", message: "A note's author, date and deletion record can't be changed." } };
    }
    if (!same("deletedAt")) {
      const deleting = isObj(a) && filled(a.deletedAt);
      stamps.push({ op: "update", path: ["notes", id], value: deleting ? { deletedAt: now.getTime(), deletedBy: by } : { deletedAt: null, deletedBy: null } });
      events.push({ kind: deleting ? "delete" : "restore", id, title: isObj(b) && typeof b.title === "string" ? b.title : "a note" });
    }
  }
  return { stamps, events };
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
export async function applyOps(
  ops: TreeOp[],
  actor?: Actor,
  /** The touched entities as they were, when the caller has already read them (rowKey → data; missing = not there). */
  known?: Map<string, Json>,
): Promise<Array<TreeRow | { collection: Collection; id: string; data: null; updated_at: null }>> {
  const touched = touchedRows(ops);
  const assetIds = actor ? touched.filter((t) => t.collection === "assets").map((t) => t.id) : [];
  const before = !assetIds.length
    ? null
    : known
      ? new Map(assetIds.flatMap((id) => (known.has(rowKey("assets", id)) ? [[id, known.get(rowKey("assets", id))!] as const] : [])))
      : new Map((await readRows("assets", assetIds)).map((r) => [r.id, r.data]));
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
  // Activity still logs without owner names; the read failing is worth knowing, not worth failing the write.
  const names = new Map(
    (ownerIds.length ? await readRows("assets", ownerIds).catch((err) => (console.error("tree: couldn't read owner names for activity", err), [] as TreeRow[])) : []).map((r) => [
      r.id,
      (r.data as { name?: string } | null)?.name ?? null,
    ]),
  );
  for (const p of pairs)
    await logActivity(
      p.id,
      actor,
      describeChange(p.b, p.a, (id) => names.get(id) ?? null),
    );
}
