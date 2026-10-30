import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchableImageUrl, publicAddress, verifyImageUrl } from "../lib/mail-image.js";

/**
 * A picture from a message, fetched by BFO and passed on (lib/mail-image.ts).
 * The URL carries a signature made when the message was served, so only
 * pictures BFO itself pointed at can be asked for. No session is needed: an
 * <img> inside the mail frame can't send one, and the signature stands in.
 * Images only, up to 8 MB, eight seconds, no cookies either way.
 *
 * Only the public internet is fetched: each host must resolve to public
 * addresses (lib/mail-image.ts publicAddress), and the connection goes to the
 * address that was checked, so a second DNS answer can't point it inward.
 * Redirects are followed by hand, at most three, each hop checked the same way.
 */

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const MAX_HOPS = 3;

/** The host's addresses when every one is on the public internet, else null. */
async function publicAddresses(host: string): Promise<LookupAddress[] | null> {
  const found = await lookup(host, { all: true, verbatim: true }).catch(() => [] as LookupAddress[]);
  return found.length > 0 && found.every((a) => publicAddress(a.address)) ? found : null;
}

type Upstream = { status: number; headers: IncomingHttpHeaders; body: IncomingMessage };

/** One GET, connected to `addr` whatever the name resolves to now (TLS still checks the name). */
function get(url: URL, addr: LookupAddress, signal: AbortSignal): Promise<Upstream> {
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      url,
      {
        method: "GET",
        signal,
        headers: { Accept: "image/*,*/*;q=0.5", "User-Agent": "BFO-Mail/1.0 (+https://www.burtonfamilyoffice.com)" },
        lookup: (_host, opts, cb) => (opts.all ? cb(null, [addr]) : cb(null, addr.address, addr.family)),
      },
      (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res })
    );
    req.on("error", reject);
    req.end();
  });
}

/** The body, or null once it passes `max` bytes. */
async function readCapped(body: IncomingMessage, max: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += (chunk as Buffer).length;
    if (size > max) {
      body.destroy();
      return null;
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).end();
  const u = typeof req.query.u === "string" ? req.query.u : "";
  const s = typeof req.query.s === "string" ? req.query.s : "";
  if (!u || !s || s.length !== 32 || !verifyImageUrl(u, s)) return res.status(403).end();
  const target = fetchableImageUrl(u);
  if (!target) return res.status(400).end();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let url = target;
    let upstream: Upstream;
    for (let hop = 0; ; hop++) {
      const addrs = await publicAddresses(url.hostname.replace(/^\[|\]$/g, ""));
      if (!addrs) return res.status(502).end();
      upstream = await get(url, addrs[0], ctrl.signal);
      const header = upstream.headers.location;
      const location = upstream.status >= 300 && upstream.status < 400 ? (Array.isArray(header) ? header[0] : header) : null;
      if (!location) break;
      upstream.body.destroy();
      let nextRaw = "";
      try {
        nextRaw = new URL(location, url).href;
      } catch {
        /* not an address: refused below */
      }
      const next = hop < MAX_HOPS ? fetchableImageUrl(nextRaw) : null;
      if (!next) return res.status(502).end();
      url = next;
    }
    const done = () => upstream.body.destroy();
    if (upstream.status < 200 || upstream.status >= 300) return done(), res.status(upstream.status === 404 ? 404 : 502).end();
    const type = String(upstream.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (!type.startsWith("image/")) return done(), res.status(415).end();
    const declared = Number(upstream.headers["content-length"] || 0);
    if (declared > MAX_BYTES) return done(), res.status(413).end();
    const buf = await readCapped(upstream.body, MAX_BYTES);
    if (!buf) return res.status(413).end();
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Cache-Control", "private, max-age=86400, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    if (req.method === "HEAD") return res.status(200).end();
    return res.status(200).send(buf);
  } catch {
    return res.status(504).end();
  } finally {
    clearTimeout(timer);
  }
}
