import { sb } from "./auth.js";
import { storageUpload } from "./storage.js";
import { COLLECTIONS, readCollection, readRows, type Collection, type Json, type TreeRow } from "./tree.js";

/**
 * The one-way bridge out of Firebase. BFO's data lived in Firebase Realtime
 * Database and some older files in Firebase Storage; both now live in
 * Supabase. Each collection is copied the first time the app asks for it
 * (tree_imports remembers), and files are moved into the "documents" bucket
 * as their entities are read. Once every row of tree_imports says done and
 * files_done, Firebase isn't touched again and the project can be deleted.
 *
 * Firebase is read with an anonymous sign-in, as the browser used to; the
 * project's web config is public by design. The REST API is used directly so
 * the Firebase SDK isn't a dependency.
 */

const FIREBASE = {
  apiKey: "AIzaSyAtSSBoP5s0VsFuoqA1XqkD92Pkr62TYm0",
  databaseURL: "https://bfoffice-89093-default-rtdb.firebaseio.com",
  storageBucket: "bfoffice-89093.firebasestorage.app",
};
const FIREBASE_STORAGE_HOST = "firebasestorage.googleapis.com";
const DOCUMENTS_BUCKET = "documents";
const TOKEN_TTL_MS = 50 * 60_000;
const IMPORT_STALE_MS = 3 * 60_000;
const IMPORT_WAIT_MS = 25_000;
const INSERT_CHUNK = 40;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

type ImportRow = { collection: string; status: "running" | "done" | "error"; started_at: string; files_done: boolean; files_given_up?: boolean };

let token: { value: string; until: number } | null = null;

/** An anonymous Firebase ID token (the database rules only ask that there is one). */
async function firebaseToken(): Promise<string> {
  if (token && token.until > Date.now()) return token.value;
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`Firebase sign-in failed (${res.status})`);
  const data = (await res.json()) as { idToken?: string };
  if (!data.idToken) throw new Error("Firebase sign-in returned no token");
  token = { value: data.idToken, until: Date.now() + TOKEN_TTL_MS };
  return data.idToken;
}

/** One node of the Realtime Database, as JSON (null when empty). */
async function readFirebase(path: string): Promise<Json> {
  const t = await firebaseToken();
  const res = await fetch(`${FIREBASE.databaseURL}/${path}.json?auth=${encodeURIComponent(t)}`, { signal: AbortSignal.timeout(40_000) });
  if (!res.ok) throw new Error(`Firebase read of ${path} failed (${res.status})`);
  return (await res.json()) as Json;
}

/** Firebase stores a list as an object keyed "0", "1", … and hands back an array; keep whichever it gives. */
function rowsOf(collection: Collection, node: Json): Omit<TreeRow, "updated_at">[] {
  if (node === null || typeof node !== "object") return [];
  const entries = Array.isArray(node) ? node.map((v, i) => [String(i), v] as const) : Object.entries(node);
  return entries.filter(([, v]) => v !== null && v !== undefined).map(([id, data]) => ({ collection, id, data }));
}

async function importStatus(collection: Collection): Promise<ImportRow | null> {
  const rows = await sb<ImportRow[]>(`tree_imports?collection=eq.${encodeURIComponent(collection)}&select=*&limit=1`);
  return rows?.[0] ?? null;
}

/** Try to be the one instance that copies this collection. */
async function claimImport(collection: Collection, stale: ImportRow | null): Promise<boolean> {
  const now = new Date().toISOString();
  if (!stale) {
    const inserted = await sb<ImportRow[]>("tree_imports?on_conflict=collection", {
      method: "POST",
      body: { collection, status: "running", started_at: now },
      prefer: "resolution=ignore-duplicates,return=representation",
    });
    return !!inserted?.length;
  }
  // A run that died, or an earlier failure: take it over.
  const taken = await sb<ImportRow[]>(
    `tree_imports?collection=eq.${encodeURIComponent(collection)}&status=eq.${stale.status}&started_at=eq.${encodeURIComponent(stale.started_at)}`,
    { method: "PATCH", body: { status: "running", started_at: now, error: null }, prefer: "return=representation" }
  );
  return !!taken?.length;
}

async function runImport(collection: Collection): Promise<void> {
  try {
    const node = await readFirebase(collection);
    const rows = rowsOf(collection, node);
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await sb("tree_nodes?on_conflict=collection,id", {
        method: "POST",
        body: rows.slice(i, i + INSERT_CHUNK),
        prefer: "resolution=ignore-duplicates",
      });
    }
    await sb(`tree_imports?collection=eq.${encodeURIComponent(collection)}`, {
      method: "PATCH",
      body: { status: "done", finished_at: new Date().toISOString(), count: rows.length, error: null },
    });
  } catch (err) {
    await sb(`tree_imports?collection=eq.${encodeURIComponent(collection)}`, {
      method: "PATCH",
      body: { status: "error", error: (err instanceof Error ? err.message : String(err)).slice(0, 300) },
    }).catch((e) => console.error("firebase-bridge: couldn't record the import error", e));
    throw err;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Make sure a collection has been copied out of Firebase. The first caller
 * does the copy; others arriving meanwhile wait for it. Done once, it's a
 * single small read per request thereafter.
 */
async function ensureImported(collection: Collection): Promise<void> {
  const done = importedCache.get(collection);
  if (done) return;
  const started = Date.now();
  for (;;) {
    const status = await importStatus(collection);
    if (status?.status === "done") {
      importedCache.set(collection, true);
      return;
    }
    const stale = status && (status.status === "error" || Date.parse(status.started_at) < Date.now() - IMPORT_STALE_MS);
    if (!status || stale) {
      if (await claimImport(collection, status)) {
        await runImport(collection);
        importedCache.set(collection, true);
        return;
      }
      continue; // someone else got it first
    }
    if (Date.now() - started > IMPORT_WAIT_MS) throw new Error(`Still copying ${collection} from Firebase; try again in a moment.`);
    await sleep(1000);
  }
}

/** Collections known to be copied, per instance; a read of tree_imports confirms the rest. */
const importedCache = new Map<Collection, boolean>();

/** Forget what this process knows about copies (tests). */
export function forgetImports(): void {
  importedCache.clear();
  filesSettled = false;
  failedFiles.clear();
}

export async function importAll(): Promise<void> {
  for (const c of COLLECTIONS) await ensureImported(c);
}

// ── Files ────────────────────────────────────────────────────────────────

type FileRef = { path: string[]; url: string; storagePath: string; name: string; contentType: string | null };

const isFirebaseUrl = (url: unknown): url is string => typeof url === "string" && url.startsWith(`https://${FIREBASE_STORAGE_HOST}/`);

/** Every document and filing slot of an entity still stored in Firebase. */
export function firebaseFilesOf(assetId: string, asset: Json): FileRef[] {
  if (asset === null || typeof asset !== "object" || Array.isArray(asset)) return [];
  const out: FileRef[] = [];
  const docs = (asset as { [k: string]: Json }).documents;
  if (docs && typeof docs === "object" && !Array.isArray(docs)) {
    for (const [docId, d] of Object.entries(docs)) {
      if (!d || typeof d !== "object" || Array.isArray(d)) continue;
      const doc = d as { [k: string]: Json };
      if (doc.storageProvider === "supabase" || typeof doc.storagePath !== "string" || !doc.storagePath) continue;
      if (!isFirebaseUrl(doc.url)) continue;
      out.push({
        path: ["assets", assetId, "documents", docId],
        url: doc.url,
        storagePath: doc.storagePath,
        name: typeof doc.name === "string" && doc.name ? doc.name : "document",
        contentType: typeof doc.contentType === "string" ? doc.contentType : null,
      });
    }
  }
  for (const [kind, v] of Object.entries(asset as { [k: string]: Json })) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const slot = v as { [k: string]: Json };
    if (typeof slot.fileName !== "string" || !isFirebaseUrl(slot.url) || typeof slot.storagePath !== "string" || !slot.storagePath || slot.docId) continue;
    out.push({ path: ["assets", assetId, kind], url: slot.url, storagePath: slot.storagePath, name: slot.fileName, contentType: typeof slot.contentType === "string" ? slot.contentType : null });
  }
  return out;
}

const safeSegment = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "file";

/**
 * Where a moved file goes in the documents bucket: one safe segment, named
 * after the file, keeping the extension of the Firebase object (its last path
 * segment only, sanitised too), so the result is always an isDocumentPath.
 */
export function movedFilePath(assetId: string, name: string, firebasePath: string, now = Date.now()): string {
  const last = firebasePath.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  const ext = dot > 0 && dot < last.length - 1 ? safeSegment(last.slice(dot + 1)) : "";
  const base = safeSegment(name.replace(/\.[^.]+$/, ""));
  return `assets/${safeSegment(assetId)}/${now}-${base}${ext && !base.endsWith(`.${ext}`) ? `.${ext}` : ""}`;
}

/** Copy one file into the documents bucket; returns its new path and public URL. */
async function moveFile(assetId: string, file: FileRef): Promise<{ storagePath: string; url: string }> {
  const t = await firebaseToken();
  // The stored download URL carries its own token; fall back to the object path with ours.
  let res = await fetch(file.url, { redirect: "error", signal: AbortSignal.timeout(40_000) });
  if (!res.ok) {
    res = await fetch(`https://${FIREBASE_STORAGE_HOST}/v0/b/${FIREBASE.storageBucket}/o/${encodeURIComponent(file.storagePath)}?alt=media`, {
      headers: { Authorization: `Firebase ${t}` },
      redirect: "error",
      signal: AbortSignal.timeout(40_000),
    });
  }
  if (!res.ok) throw new Error(`Firebase Storage answered ${res.status} for ${file.storagePath}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error(`${file.storagePath} is too large to move`);
  const contentType = file.contentType || res.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
  const storagePath = movedFilePath(assetId, file.name, file.storagePath);
  await storageUpload(storagePath, bytes, contentType, DOCUMENTS_BUCKET);
  // The legacy URL shape is kept on the record; reads go by `storagePath` through signed links.
  const url = `${(process.env.SUPABASE_URL ?? "").replace(/\/$/, "")}/storage/v1/object/public/${DOCUMENTS_BUCKET}/${storagePath}`;
  return { storagePath, url };
}

/**
 * Move an entity's Firebase files into Supabase Storage and point its records
 * at them. With `assetId` just that entity, else every entity, until `budgetMs`
 * is spent. Returns how many files moved and whether any are left.
 */
export async function migrateFirebaseFiles(opts: { assetId?: string; budgetMs?: number } = {}): Promise<{ moved: number; remaining: number }> {
  if (filesSettled) return { moved: 0, remaining: 0 };
  const started = Date.now();
  const budget = opts.budgetMs ?? 8_000;
  const status = await importStatus("assets");
  if (status?.files_done || status?.files_given_up) {
    filesSettled = true;
    return { moved: 0, remaining: 0 };
  }

  const rows = opts.assetId ? await readRows("assets", [opts.assetId]) : await readCollection("assets");
  const todo = rows.flatMap((r) => firebaseFilesOf(r.id, r.data).map((f) => ({ row: r, file: f })));
  let moved = 0;
  let failed = 0;
  let skipped = 0;
  let exhausted = false;
  for (const { row, file } of todo) {
    if (Date.now() - started > budget) {
      exhausted = true;
      break;
    }
    // A file that already failed in this process isn't fetched again; the next instance gets one more try.
    if (failedFiles.has(file.storagePath)) {
      skipped++;
      continue;
    }
    try {
      const next = await moveFile(row.id, file);
      const value = file.path.length === 4 ? { url: next.url, storagePath: next.storagePath, storageProvider: "supabase" } : { url: next.url, storagePath: next.storagePath };
      await sb("rpc/tree_apply", { method: "POST", body: { ops: [{ op: "update", path: file.path, value }] } });
      moved++;
    } catch (err) {
      failed++;
      failedFiles.add(file.storagePath);
      console.error(`firebase-bridge: couldn't move ${file.storagePath}`, err);
    }
  }
  const remaining = todo.length - moved;
  if (!opts.assetId && remaining === 0 && !failed) {
    filesSettled = true;
    await sb("tree_imports?collection=eq.assets", { method: "PATCH", body: { files_done: true } }).catch((err) => console.error("firebase-bridge: couldn't mark files done", err));
  } else if (!opts.assetId && !exhausted && moved === 0 && remaining > 0 && failed + skipped === remaining) {
    // Every file still in Firebase has failed to move at least once: stop
    // scanning on each request, here and in every later instance.
    filesSettled = true;
    console.warn(`firebase-bridge: giving up on ${remaining} Firebase file(s) that couldn't be moved; marking files_given_up`);
    await sb("tree_imports?collection=eq.assets", { method: "PATCH", body: { files_given_up: true } }).catch((err) =>
      console.error("firebase-bridge: couldn't record files_given_up", err)
    );
  }
  return { moved, remaining };
}

/** Whether this instance knows the file move is finished (files_done or files_given_up). */
let filesSettled = false;
/** Firebase object paths that failed to move in this process; not retried until the next instance. */
const failedFiles = new Set<string>();
