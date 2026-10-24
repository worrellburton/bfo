import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchableImageUrl, verifyImageUrl } from "../lib/mail-image.js";

/**
 * A picture from a message, fetched by BFO and passed on (lib/mail-image.ts).
 * The URL carries a signature made when the message was served, so only
 * pictures BFO itself pointed at can be asked for. No session is needed: an
 * <img> inside the mail frame can't send one, and the signature stands in.
 * Images only, up to 8 MB, eight seconds, no cookies either way.
 */

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 8000;

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
    const upstream = await fetch(target, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { Accept: "image/*,*/*;q=0.5", "User-Agent": "BFO-Mail/1.0 (+https://www.burtonfamilyoffice.com)" },
    });
    if (!upstream.ok) return res.status(upstream.status === 404 ? 404 : 502).end();
    const type = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!type.startsWith("image/")) return res.status(415).end();
    const declared = Number(upstream.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) return res.status(413).end();
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > MAX_BYTES) return res.status(413).end();
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
