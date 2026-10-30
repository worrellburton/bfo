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

/**
 * True for an address on the public internet. A hostname that resolves to a
 * loopback, private, link-local, shared (CGNAT), multicast or reserved address
 * is refused, as is any IPv6 address outside global unicast (2000::/3); an
 * IPv4-mapped IPv6 address is judged by its IPv4 part.
 */
export function publicAddress(addr: string): boolean {
  const a = addr.toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (mapped) return publicAddress(mapped[1]);
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (v4) {
    const [p, q, r] = v4.slice(1, 4).map(Number);
    if (v4.slice(1).some((n) => Number(n) > 255)) return false;
    return !(
      p === 0 || p === 10 || p === 127 || p >= 224 ||
      (p === 100 && q >= 64 && q < 128) ||
      (p === 169 && q === 254) ||
      (p === 172 && q >= 16 && q < 32) ||
      (p === 192 && q === 168) ||
      (p === 192 && q === 0 && r === 0) ||
      (p === 198 && (q === 18 || q === 19))
    );
  }
  if (!a.includes(":")) return false;
  const first = a.startsWith("::") ? 0 : parseInt(a.split(":")[0], 16);
  return first >= 0x2000 && first <= 0x3fff;
}

/** The proxied address for a remote picture. */
export function proxiedImageUrl(url: string): string {
  return `${IMAGE_PATH}?u=${encodeURIComponent(url)}&s=${signImageUrl(url)}`;
}

const REMOTE = /^\s*(https?:)?\/\//i;

/** Every remote image in the HTML, pointed at the proxy: src, srcset, poster, the old background attribute, and
 * url() in style attributes and <style> blocks. An address the proxy won't fetch (a bare IP, an odd port) is left
 * as written: the mail frame's CSP allows pictures only from BFO (app/mail-frame.tsx), so it never loads. */
export function proxyRemoteImages(html: string): string {
  const fix = (raw: string): string => {
    const v = raw.trim();
    if (!REMOTE.test(v)) return raw;
    const abs = v.startsWith("//") ? `https:${v}` : v;
    return fetchableImageUrl(abs) ? proxiedImageUrl(abs) : raw;
  };
  const attr = (m: string, pre: string, _q: string, dq?: string, sq?: string, map: (v: string) => string = fix) => {
    const v = dq ?? sq ?? "";
    const out = map(v);
    return out === v ? m : `${pre}"${out.replace(/"/g, "&quot;")}"`;
  };
  const srcset = (v: string) =>
    v
      .split(",")
      .map((part) => {
        const [url, ...rest] = part.trim().split(/\s+/);
        return [fix(url), ...rest].join(" ");
      })
      .join(", ");
  // CSS url(), quoted as written or HTML-escaped inside an attribute. The new address goes in unquoted, with the
  // characters that would end it escaped (they're in the u= value, so the server reads the same address).
  const css = (text: string) =>
    text.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|&quot;(.*?)&quot;|&#39;(.*?)&#39;|([^"'()\s]+))\s*\)/gi, (m, ...found: (string | undefined)[]) => {
      const url = found.slice(0, 5).find((x) => x !== undefined) ?? "";
      const out = fix(url);
      return out === url ? m : `url(${out.replace(/['()"]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)})`;
    });
  return html
    .replace(/(<img\b[^>]*?\s(?:src|data-src)\s*=\s*)("([^"]*)"|'([^']*)')/gi, (m, pre: string, q: string, dq?: string, sq?: string) => attr(m, pre, q, dq, sq))
    .replace(/(<(?:img|source)\b[^>]*?\ssrcset\s*=\s*)("([^"]*)"|'([^']*)')/gi, (m, pre: string, q: string, dq?: string, sq?: string) => attr(m, pre, q, dq, sq, srcset))
    .replace(/(<video\b[^>]*?\sposter\s*=\s*)("([^"]*)"|'([^']*)')/gi, (m, pre: string, q: string, dq?: string, sq?: string) => attr(m, pre, q, dq, sq))
    .replace(/(<[a-z][a-z0-9]*\b[^>]*?\sbackground\s*=\s*)("([^"]*)"|'([^']*)')/gi, (m, pre: string, q: string, dq?: string, sq?: string) => attr(m, pre, q, dq, sq))
    .replace(/(<[a-z][a-z0-9]*\b[^>]*?\sstyle\s*=\s*)("([^"]*)"|'([^']*)')/gi, (m, pre: string, q: string, dq?: string, sq?: string) => attr(m, pre, q, dq, sq, css))
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_m, open: string, body: string, close: string) => open + css(body) + close);
}
