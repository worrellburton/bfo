/**
 * Where an entity document lives in the "documents" storage bucket, worked
 * out from whatever the tree stored for it. Records written before signed
 * links carry a permanent public URL (…/storage/v1/object/public/documents/<path>);
 * newer ones also carry the bare path. Reads never follow the stored URL:
 * they go by path, through /api/documents/url (a short-lived signed link) in
 * the browser, or a service-key download on the server.
 *
 * Pure (no I/O), shared by the browser and the API.
 */

export const DOCUMENTS_BUCKET = "documents";

/** How long a signed document link lasts, in seconds. */
export const SIGNED_URL_TTL_S = 600;

/** Any storage URL form that names an object in the documents bucket: public, signed, or authenticated. */
const OBJECT_URL = new RegExp(`^/storage/v1/object/(?:public/|sign/|authenticated/)?${DOCUMENTS_BUCKET}/(.+)$`);

/**
 * True for a path this app writes and may hand out: `assets/<assetId>/<file…>`,
 * with no empty, `.` or `..` segment, and nothing that would change what URL
 * it becomes (backslashes, `?`, `#`, `%`, control characters).
 *
 * A `..` inside a file name ("Foo Inc..pdf", which the upload sanitiser can
 * produce) is not a traversal and is allowed; a `..` segment never is.
 */
export function isDocumentPath(path: string): boolean {
  if (typeof path !== "string" || path.length > 1024) return false;
  if (/[\\?#%\u0000-\u001f\u007f]/.test(path)) return false;
  const parts = path.split("/");
  if (parts.length < 3 || parts[0] !== "assets") return false;
  return parts.every((p) => p !== "" && p !== "." && p !== "..");
}

/**
 * The bucket path a stored document reference points at, or null when it
 * isn't one of ours (an external link, a Firebase URL not yet moved, junk).
 * Accepts a public URL, an already-signed URL, or a bare path.
 */
export function documentStoragePath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  let path: string;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    let url: URL;
    try {
      url = new URL(s);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const m = OBJECT_URL.exec(url.pathname);
    if (!m) return null;
    try {
      path = decodeURIComponent(m[1]);
    } catch {
      return null;
    }
  } else {
    path = s.replace(/^\/+/, "");
    if (path.startsWith(`${DOCUMENTS_BUCKET}/`)) path = path.slice(DOCUMENTS_BUCKET.length + 1);
  }
  return isDocumentPath(path) ? path : null;
}

/** The entity a document path belongs to (`assets/<assetId>/…`). */
export function documentAssetId(path: string): string | null {
  return isDocumentPath(path) ? path.split("/")[1] : null;
}

/** A stored file or Documents entry, as the tree keeps it. */
export type StoredFileRef = { url?: string | null; storagePath?: string | null; storageProvider?: string | null };

/**
 * The bucket path of a stored file record: from its URL, else from its
 * `storagePath` when that is a path in our bucket (a Documents entry still in
 * Firebase also has a storagePath, but not one of ours, and no "supabase" provider).
 */
export function storagePathOf(file: StoredFileRef | null | undefined): string | null {
  if (!file) return null;
  const fromUrl = documentStoragePath(file.url);
  if (fromUrl) return fromUrl;
  if (file.storageProvider === "supabase" || (!file.url && file.storagePath)) return documentStoragePath(file.storagePath);
  return null;
}

/** Roles that see every entity. ("email" users can't reach entities at all.) */
const SEES_ALL = new Set(["owner", "admin", "member", "viewer"]);

/** Parts of an entity record a partner never sees (mirrors api/tree.ts). */
const PARTNER_HIDDEN = ["notes", "contracts", "verification"];

/**
 * The folder an entity's files go in: its id as upload-url, palm-sync and
 * firebase-bridge sanitise it (so an id ending in "_" loses it).
 */
export function assetPathSegment(assetId: string): string {
  return assetId.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * Who may read the document at `path`: returns the entity id it is read
 * through, or null to refuse. Staff (owners, admins, members, viewers) see
 * every entity; a partner only the entities they've been given
 * (`partnerAssets`, their entity_access rows), so taking someone off an
 * entity cuts off its documents at once. Anyone else is refused.
 */
export function readableEntity(role: string, path: string, partnerAssets: Iterable<string> | null): string | null {
  const segment = documentAssetId(path);
  if (!segment) return null;
  if (SEES_ALL.has(role)) return segment;
  if (role !== "partner" || !partnerAssets) return null;
  for (const id of partnerAssets) if (id && assetPathSegment(id) === segment) return id;
  return null;
}

/**
 * True when an entity record refers to `path` from a part a partner can see:
 * a Documents entry or a filing slot. A partner is only given links to files
 * the entity still shows them, never an orphaned or staff-only object.
 */
export function recordReferencesPath(data: unknown, path: string): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const matches = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v) && storagePathOf(v as StoredFileRef) === path;
  const record = data as Record<string, unknown>;
  const docs = record.documents;
  if (docs && typeof docs === "object" && Object.values(docs as Record<string, unknown>).some(matches)) return true;
  return Object.entries(record).some(([k, v]) => k !== "documents" && !PARTNER_HIDDEN.includes(k) && matches(v));
}
