import { authFetch } from "./auth";

/**
 * The shared JSON tree (/api/tree, lib/tree.ts) with the small Firebase
 * Realtime Database surface the app grew up on: ref → get / onValue, and
 * update / set / push / remove. Every page keeps working as it did; only
 * the transport changed.
 *
 * Each collection ("assets", "notes", …) is loaded once and cached, with one
 * listener list however many places watch it. A write updates the cache from
 * the rows the server sends back and wakes every listener, so the UI sees its
 * own change at once (the echo Firebase gave). Other people's changes arrive
 * by polling an index of (id, updated_at) every 30 s while the tab is
 * visible, and on focus: only rows that changed are fetched.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export type Ref = { readonly path: string[]; readonly key: string | null };
export type Snapshot = { readonly key: string | null; val(): any; exists(): boolean };
export type Unsubscribe = () => void;

/** There is one database; the handle is just for Firebase-shaped calls. */
export const db = Symbol("tree");
/** Nothing to wait for any more; kept so callers read the same. */
export const authReady: Promise<void> = Promise.resolve();

const POLL_MS = 30_000;

type Row = { id: string; data: Json; updated_at: string };
type Store = {
  rows: Map<string, Row>;
  loading: Promise<void> | null;
  loaded: boolean;
  listeners: Set<() => void>;
};

const stores = new Map<string, Store>();

function storeFor(collection: string): Store {
  let s = stores.get(collection);
  if (!s) {
    s = { rows: new Map(), loading: null, loaded: false, listeners: new Set() };
    stores.set(collection, s);
  }
  return s;
}

class TreeError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data?.error ?? "error";
    const message = data?.message ?? (res.status === 403 ? "You don't have permission to change this." : res.status === 401 ? "Sign in again." : "Something went wrong. Try again.");
    throw new TreeError(res.status, code, message);
  }
  return data as T;
}

const q = (path: string[], extra = "") => `/api/tree?path=${encodeURIComponent(path.join("/"))}${extra}`;

function split(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/** Load a whole collection once (concurrent callers share the request). */
function load(collection: string): Promise<void> {
  const s = storeFor(collection);
  if (s.loaded) return Promise.resolve();
  if (!s.loading) {
    s.loading = call<{ value: Json; updated?: Record<string, string> }>(q([collection]))
      .then(({ value, updated }) => {
        s.rows.clear();
        if (value && typeof value === "object" && !Array.isArray(value)) {
          for (const [id, data] of Object.entries(value)) s.rows.set(id, { id, data, updated_at: updated?.[id] ?? "" });
        }
        s.loaded = true;
        emit(s);
      })
      .finally(() => {
        s.loading = null;
      });
  }
  return s.loading;
}

function emit(s: Store) {
  for (const l of [...s.listeners]) l();
}

/** Firebase's child order: integer-like keys first, numerically; then strings. */
function compareKeys(a: string, b: string): number {
  const na = /^-?\d+$/.test(a) ? Number(a) : null;
  const nb = /^-?\d+$/.test(b) ? Number(b) : null;
  if (na !== null && nb !== null) return na - nb || a.localeCompare(b);
  if (na !== null) return -1;
  if (nb !== null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function valueAt(path: string[]): Json {
  if (!path.length) {
    const all: { [k: string]: Json } = {};
    for (const [c, s] of stores) if (s.rows.size) all[c] = valueAt([c]);
    return Object.keys(all).length ? all : null;
  }
  const s = storeFor(path[0]);
  if (path.length === 1) {
    if (!s.rows.size) return null;
    const out: { [k: string]: Json } = {};
    for (const id of [...s.rows.keys()].sort(compareKeys)) out[id] = s.rows.get(id)!.data;
    return out;
  }
  let cur: Json = s.rows.get(path[1])?.data ?? null;
  for (const k of path.slice(2)) {
    if (cur === null || typeof cur !== "object") return null;
    cur = Array.isArray(cur) ? (cur[Number(k)] ?? null) : (cur[k] ?? null);
  }
  return cur ?? null;
}

function snapshot(path: string[]): Snapshot {
  const value = valueAt(path);
  return { key: path.length ? path[path.length - 1] : null, val: () => value, exists: () => value !== null };
}

/** Put the rows a write (or a poll) returned into the cache; null data removes. */
function absorb(rows: Array<{ collection: string; id: string; data: Json | null; updated_at: string | null }>) {
  const touched = new Set<Store>();
  for (const r of rows) {
    const s = storeFor(r.collection);
    if (r.data === null) s.rows.delete(r.id);
    else s.rows.set(r.id, { id: r.id, data: r.data, updated_at: r.updated_at ?? "" });
    touched.add(s);
  }
  for (const s of touched) emit(s);
}

// ── Reading ──────────────────────────────────────────────────────────────

export function ref(_db: unknown, path = ""): Ref {
  const segments = split(path);
  return { path: segments, key: segments.length ? segments[segments.length - 1] : null };
}

export async function get(r: Ref): Promise<Snapshot> {
  if (!r.path.length) throw new Error("Read a collection or a node, not the whole tree.");
  await load(r.path[0]);
  return snapshot(r.path);
}

/**
 * Call back with the value at `r` now (once loaded) and after every change.
 * `onError` hears a failed first load.
 */
export function onValue(r: Ref, cb: (snap: Snapshot) => void, onError?: (err: Error) => void): Unsubscribe {
  if (!r.path.length) throw new Error("Watch a collection or a node, not the whole tree.");
  const s = storeFor(r.path[0]);
  let alive = true;
  const listener = () => alive && cb(snapshot(r.path));
  s.listeners.add(listener);
  startPolling();
  if (s.loaded) cb(snapshot(r.path));
  else load(r.path[0]).catch((err) => alive && onError?.(err as Error));
  return () => {
    alive = false;
    s.listeners.delete(listener);
    stopPollingIfIdle();
  };
}

// ── Writing ──────────────────────────────────────────────────────────────

type Op = { op: "set" | "update"; path: string; value: unknown };

async function apply(ops: Op[]) {
  const collections = new Set(ops.flatMap((o) => (o.path ? [split(o.path)[0]] : Object.keys(o.value as object).map((k) => split(k)[0]))));
  // The write lands on the server's copy; the cache needs the collection to merge the echo into.
  await Promise.all([...collections].map(load));
  const { rows } = await call<{ rows: Array<{ collection: string; id: string; data: Json | null; updated_at: string | null }> }>("/api/tree", {
    method: "POST",
    body: JSON.stringify({ ops }),
  });
  absorb(rows);
}

/** Set the given fields under `r` (a key may be a nested path like "a/b"); null removes a field. */
export async function update(r: Ref, values: Record<string, unknown>): Promise<void> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) if (v !== undefined) clean[k] = v;
  if (!Object.keys(clean).length) return;
  await apply([{ op: "update", path: r.path.join("/"), value: clean }]);
}

/** Replace the node at `r` (null removes it). */
export async function set(r: Ref, value: unknown): Promise<void> {
  await apply([{ op: "set", path: r.path.join("/"), value: value === undefined ? null : value }]);
}

export async function remove(r: Ref): Promise<void> {
  await set(r, null);
}

/** Add a child under `r` with a new time-ordered key; resolves to its ref (`.key`). */
export async function push(r: Ref, value?: unknown): Promise<Ref> {
  const key = pushId();
  const child = ref(db, [...r.path, key].join("/"));
  if (value !== undefined) await set(child, value);
  return child;
}

// Firebase's push ids: 20 chars, the first 8 a timestamp, so they sort by time.
const PUSH_CHARS = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
let lastPushTime = 0;
let lastRand: number[] = [];

export function pushId(now = Date.now()): string {
  const same = now === lastPushTime;
  lastPushTime = now;
  const stamp: string[] = [];
  let t = now;
  for (let i = 7; i >= 0; i--) {
    stamp[i] = PUSH_CHARS[t % 64];
    t = Math.floor(t / 64);
  }
  if (!same) {
    lastRand = Array.from({ length: 12 }, () => Math.floor(Math.random() * 64));
  } else {
    let i = 11;
    while (i >= 0 && lastRand[i] === 63) lastRand[i--] = 0;
    if (i >= 0) lastRand[i]++;
  }
  return stamp.join("") + lastRand.map((n) => PUSH_CHARS[n]).join("");
}

// ── Keeping up with others ───────────────────────────────────────────────

let pollTimer: number | null = null;
let polling = false;

/** Fetch the rows that changed since the cache last saw them, per watched collection. */
async function poll() {
  if (polling || typeof document === "undefined" || document.visibilityState !== "visible") return;
  polling = true;
  try {
    for (const [collection, s] of stores) {
      if (!s.listeners.size) continue;
      // A first load that failed would otherwise leave its page stuck; try it
      // again so the page recovers on its own (listeners hear the success).
      if (!s.loaded) {
        await load(collection).catch(() => {});
        continue;
      }
      const { rows: index } = await call<{ rows: { id: string; updated_at: string }[] }>(q([collection], "&view=index"));
      const seen = new Set<string>();
      const changed: string[] = [];
      for (const r of index) {
        seen.add(r.id);
        const have = s.rows.get(r.id);
        if (!have || have.updated_at !== r.updated_at) changed.push(r.id);
      }
      const gone = [...s.rows.keys()].filter((id) => !seen.has(id));
      if (!changed.length && !gone.length) continue;
      const fresh = changed.length ? (await call<{ rows: Row[] }>(q([collection], `&ids=${encodeURIComponent(changed.join(","))}`))).rows : [];
      absorb([...gone.map((id) => ({ collection, id, data: null, updated_at: null })), ...fresh.map((r) => ({ collection, ...r }))]);
    }
  } catch {
    // Offline or a blip: the next poll tries again.
  } finally {
    polling = false;
  }
}

function startPolling() {
  if (pollTimer !== null || typeof window === "undefined") return;
  pollTimer = window.setInterval(() => void poll(), POLL_MS);
  window.addEventListener("focus", onFocus);
}

function onFocus() {
  void poll();
}

function stopPollingIfIdle() {
  if (pollTimer === null || [...stores.values()].some((s) => s.listeners.size)) return;
  window.clearInterval(pollTimer);
  pollTimer = null;
  window.removeEventListener("focus", onFocus);
}

/** Forget everything cached (sign-out). */
export function resetStore() {
  for (const s of stores.values()) {
    s.rows.clear();
    s.loaded = false;
    s.loading = null;
  }
}
