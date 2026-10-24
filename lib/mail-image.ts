import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Remote pictures in mail, served through BFO instead of straight from the
 * sender. The message's HTML is rewritten so each remote image points at
 * /api/mail-image with a signed URL; that endpoint fetches the picture and
 * passes it on. Why: a phone's browser or content blocker may refuse a
 * third-party image inside the sandboxed mail frame, and this way the
 * sender's tracking pixel sees BFO's server, never the reader's address.
 */

const secret = () => process.env.MAIL_IMAGE_SECRET || process.env.AUTH_SECRET || process.env.SUPABASE_SERVICE_KEY || "";

export const IMAGE_PATH = "/api/mail-image";

export function signImageUrl(url: string): string {
  return createHmac("sha256", secret()).update(url).digest("base64url").slice(0, 32);
}

export function verifyImageUrl(url: string, sig: string): boolean {
  const want = signImageUrl(url);
  const a = Buffer.from(want);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** True for an address the proxy may fetch: http(s), a hostname (not a bare address), no credentials, a usual port. */
export function fetchableImageUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return null; // a bare address: nothing on the public web needs one
  return u;
}

/** The proxied address for a remote picture. */
export function proxiedImageUrl(url: string): string {
  return `${IMAGE_PATH}?u=${encodeURIComponent(url)}&s=${signImageUrl(url)}`;
}

const REMOTE = /^\s*(https?:)?\/\//i;

/** Every remote image in the HTML, pointed at the proxy: src, srcset and the old background attribute. */
export function proxyRemoteImages(html: string): string {
  const fix = (raw: string): string => {
    const v = raw.trim();
    if (!REMOTE.test(v)) return raw;
    const abs = v.startsWith("//") ? `https:${v}` : v;
    return fetchableImageUrl(abs) ? proxiedImageUrl(abs) : raw;
  };
  return html
    .replace(/(<img\b[^>]*?\s(?:src|data-src)\s*=\s*)("([^"]*)"|'([^']*)')/gi, (m, pre: string, _q: string, dq?: string, sq?: string) => {
      const v = dq ?? sq ?? "";
      const out = fix(v);
      return out === v ? m : `${pre}"${out.replace(/"/g, "&quot;")}"`;
    })
    .replace(/(<img\b[^>]*?\ssrcset\s*=\s*)("([^"]*)"|'([^']*)')/gi, (m, pre: string, _q: string, dq?: string, sq?: string) => {
      const v = dq ?? sq ?? "";
      const out = v
        .split(",")
        .map((part) => {
          const [url, ...rest] = part.trim().split(/\s+/);
          return [fix(url), ...rest].join(" ");
        })
        .join(", ");
      return out === v ? m : `${pre}"${out.replace(/"/g, "&quot;")}"`;
    })
    .replace(/(<(?:td|table|body|div)\b[^>]*?\sbackground\s*=\s*)("([^"]*)"|'([^']*)')/gi, (m, pre: string, _q: string, dq?: string, sq?: string) => {
      const v = dq ?? sq ?? "";
      const out = fix(v);
      return out === v ? m : `${pre}"${out.replace(/"/g, "&quot;")}"`;
    });
}
