/**
 * Fetches a stored document on the server so Claude can read it. The URL
 * comes from the browser, so it is only followed when it points at our own
 * storage (Firebase Storage or the Supabase project) — never an arbitrary
 * host, an internal address, or a redirect — and the read is capped in both
 * size and time.
 */

const TIMEOUT_MS = 20_000;

function allowedHosts(): string[] {
  const hosts = ["firebasestorage.googleapis.com"];
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

/**
 * The document's bytes and content type, or null when the URL isn't ours,
 * the fetch fails, or the file is larger than `maxBytes`.
 */
export async function fetchDocument(raw: string, maxBytes: number): Promise<FetchedDocument | null> {
  if (!isStorageUrl(raw)) return null;
  try {
    const res = await fetch(raw, { redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok || !res.body) return null;
    const declared = Number(res.headers.get("content-length") || "0");
    if (declared > maxBytes) {
      await res.body.cancel();
      return null;
    }
    // Stream so an undeclared or lying length can't run past the cap.
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const contentType = (res.headers.get("content-type") || "").toLowerCase().split(";")[0].trim();
    return { buf: Buffer.concat(chunks), contentType };
  } catch {
    return null;
  }
}
