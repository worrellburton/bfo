/**
 * Supabase Storage helpers for the private "receipts" bucket. Everything runs
 * server-side with the service key, so the bucket stays private and reads go
 * through short-lived signed URLs.
 */

const BUCKET = "receipts";

function cfg() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY are not set");
  return { url: url.replace(/\/$/, ""), key };
}

/** Upload bytes to receipts/<path>. Returns the stored object path. */
export async function storageUpload(path: string, bytes: Uint8Array, contentType: string): Promise<string> {
  const { url, key } = cfg();
  const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${encodeURI(path)}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": contentType || "application/octet-stream",
      "x-upsert": "true",
    },
    body: bytes as any,
  });
  if (!r.ok) throw new Error(`storage upload failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return path;
}

/** A time-limited signed download URL for a stored object (default 1 hour). */
export async function storageSignedUrl(path: string, expiresIn = 3600): Promise<string | null> {
  try {
    const { url, key } = cfg();
    const r = await fetch(`${url}/storage/v1/object/sign/${BUCKET}/${encodeURI(path)}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn }),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { signedURL?: string };
    return data.signedURL ? `${url}/storage/v1${data.signedURL}` : null;
  } catch {
    return null;
  }
}

/** Delete a stored object (best-effort). */
export async function storageRemove(path: string): Promise<void> {
  try {
    const { url, key } = cfg();
    await fetch(`${url}/storage/v1/object/${BUCKET}/${encodeURI(path)}`, {
      method: "DELETE",
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
  } catch {
    /* best-effort */
  }
}
