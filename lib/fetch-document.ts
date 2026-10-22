/**
 * Reads a stored entity document on the server so Claude can read it. The
 * reference comes from the browser (a stored public URL, a signed URL, or a
 * bare path), so it is never fetched as given: only a path inside the
 * "documents" bucket under assets/ is accepted, a full URL must be on our own
 * Supabase host, and the object is downloaded by path with the service key —
 * which keeps working once the bucket is private. Capped in size and time.
 */

import { DOCUMENTS_BUCKET, documentStoragePath } from "./document-path.js";
import { storageRead } from "./storage.js";

const TIMEOUT_MS = 20_000;

function allowedHosts(): string[] {
  const hosts: string[] = [];
  try {
    if (process.env.SUPABASE_URL) hosts.push(new URL(process.env.SUPABASE_URL).host);
  } catch {
    // a malformed SUPABASE_URL just means Supabase documents can't be read
  }
  return hosts;
}

/** True when `raw` is an https URL on one of our storage hosts. */
export function isStorageUrl(raw: string, hosts: string[] = allowedHosts()): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === "https:" && !url.username && !url.password && hosts.includes(url.host);
}

export type FetchedDocument = { buf: Buffer; contentType: string };

/** The bucket path a browser-supplied document reference names, or null when it isn't one of ours. */
export function documentPathFor(raw: unknown, hosts: string[] = allowedHosts()): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !isStorageUrl(s, hosts)) return null;
  return documentStoragePath(s);
}

/**
 * The document's bytes and content type, or null when the reference isn't
 * one of our documents, the read fails, or the file is larger than `maxBytes`.
 */
export async function fetchDocument(raw: string, maxBytes: number): Promise<FetchedDocument | null> {
  const path = documentPathFor(raw);
  if (!path) return null;
  const file = await storageRead(path, DOCUMENTS_BUCKET, { maxBytes, timeoutMs: TIMEOUT_MS });
  if (!file) return null;
  return { buf: Buffer.from(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength), contentType: file.contentType };
}
