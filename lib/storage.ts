/**
 * Supabase Storage helpers for the private buckets ("receipts" by default,
 * "mail" for mail attachments, "documents" for entity documents). Everything
 * runs server-side with the service key, so the buckets stay private and
 * reads go through short-lived signed URLs.
 */

const BUCKET = "receipts";

function cfg() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY are not set");
  return { url: url.replace(/\/$/, ""), key };
}

/** Upload bytes to <bucket>/<path> (overwriting). Returns the stored object path. */
export async function storageUpload(path: string, bytes: Uint8Array, contentType: string, bucket = BUCKET): Promise<string> {
  const { url, key } = cfg();
  const r = await fetch(`${url}/storage/v1/object/${bucket}/${encodeURI(path)}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": contentType || "application/octet-stream",
      "x-upsert": "true",
    },
    body: bytes as any,
    // A stalled upload must not hold a time-limited function (the Palm sync saves many in one run).
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`storage upload failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return path;
}

/**
 * A time-limited signed download URL for a stored object (default 1 hour).
 * With `download`, the browser saves it under that filename.
 */
export async function storageSignedUrl(path: string, expiresIn = 3600, bucket = BUCKET, download?: string): Promise<string | null> {
  try {
    const { url, key } = cfg();
    const r = await fetch(`${url}/storage/v1/object/sign/${bucket}/${encodeURI(path)}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn }),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { signedURL?: string };
    if (!data.signedURL) return null;
    const signed = `${url}/storage/v1${data.signedURL}`;
    return download ? `${signed}${signed.includes("?") ? "&" : "?"}download=${encodeURIComponent(download)}` : signed;
  } catch {
    return null;
  }
}

/** The bytes of a stored object, or null when it isn't there. */
export async function storageDownload(path: string, bucket = BUCKET): Promise<Uint8Array | null> {
  const { url, key } = cfg();
  const r = await fetch(`${url}/storage/v1/object/${bucket}/${encodeURI(path)}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (r.status === 404 || r.status === 400) return null; // Storage answers a missing object with either
  if (!r.ok) throw new Error(`storage download failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return new Uint8Array(await r.arrayBuffer());
}

/**
 * A stored object's bytes and content type, read with the service key, or
 * null when it's missing, larger than `maxBytes`, or the read fails or runs
 * past `timeoutMs`. Streams, so a file over the cap is never held in full.
 */
export async function storageRead(
  path: string,
  bucket: string,
  opts: { maxBytes: number; timeoutMs?: number }
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const { url, key } = cfg();
    const r = await fetch(`${url}/storage/v1/object/${bucket}/${encodeURI(path)}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      redirect: "error",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
    if (!r.ok || !r.body) return null;
    if (Number(r.headers.get("content-length") || "0") > opts.maxBytes) {
      await r.body.cancel();
      return null;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > opts.maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.byteLength;
    }
    return { bytes, contentType: (r.headers.get("content-type") || "").toLowerCase().split(";")[0].trim() };
  } catch {
    return null;
  }
}

/** Delete a stored object (best-effort). */
export async function storageRemove(path: string, bucket = BUCKET): Promise<void> {
  try {
    const { url, key } = cfg();
    await fetch(`${url}/storage/v1/object/${bucket}/${encodeURI(path)}`, {
      method: "DELETE",
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
  } catch {
    /* best-effort */
  }
}
