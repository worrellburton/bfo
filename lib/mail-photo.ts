import { randomUUID } from "node:crypto";
import { sb, type AppUser } from "./auth.js";
import { BUCKET } from "./mail.js";
import { storageRemove, storageSignedUrl, storageUpload } from "./storage.js";

/**
 * The picture each user chose for their mail (app_users.mail_photo). The
 * browser crops it square and shrinks it before sending; it's kept in the
 * private mail bucket and handed out as signed links, keyed by every address
 * the user has, so an inbox can show it wherever that address appears.
 */

/** Generous for a 256 px square; the browser sends far less. */
export const PHOTO_MAX_BYTES = 1024 * 1024;
/** Long enough for a working day in the inbox; the page asks again on load. */
const FACE_LINK_SECONDS = 12 * 60 * 60;

type PhotoKind = { contentType: string; ext: string };

/** What the bytes are, read from their first few: JPEG, PNG or WebP, else null. */
function sniff(b: Uint8Array): PhotoKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { contentType: "image/jpeg", ext: "jpg" };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { contentType: "image/png", ext: "png" };
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { contentType: "image/webp", ext: "webp" };
  return null;
}

/** The largest side a picture may have; the browser sends 256. */
export const PHOTO_MAX_SIDE = 1024;

/** Width and height read from the image's header (PNG IHDR, JPEG SOF, WebP VP8/VP8L/VP8X), or null. */
export function dimensions(b: Uint8Array, type: string): { width: number; height: number } | null {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const u24le = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  const u32be = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  if (type === "image/png") return b.length >= 24 ? { width: u32be(16), height: u32be(20) } : null;
  if (type === "image/jpeg") {
    // Walk the segments to the first start-of-frame marker.
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: u16be(i + 5), width: u16be(i + 7) };
      i += 2 + u16be(i + 2);
    }
    return null;
  }
  if (type === "image/webp" && b.length >= 30) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === "VP8 ") return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { width: u24le(24) + 1, height: u24le(27) + 1 };
  }
  return null;
}

/** A picture from the browser (a data: URL or bare base64), checked to be a small image. */
export function parsePhoto(data: unknown): ({ bytes: Uint8Array } & PhotoKind) | { error: string; message: string } {
  if (typeof data !== "string" || !data) return { error: "bad_photo", message: "Choose a picture." };
  const base64 = data.replace(/^data:image\/[\w.+-]+;base64,/, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return { error: "bad_photo", message: "That picture couldn't be read." };
  if (base64.length > Math.ceil((PHOTO_MAX_BYTES * 4) / 3) + 4) return { error: "photo_too_large", message: "That picture is too large." };
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  if (bytes.length > PHOTO_MAX_BYTES) return { error: "photo_too_large", message: "That picture is too large." };
  const kind = sniff(bytes);
  if (!kind) return { error: "bad_photo", message: "Use a JPEG, PNG or WebP picture." };
  // A small file can still claim a huge canvas, and every inbox here would decode it.
  const size = dimensions(bytes, kind.contentType);
  if (!size || size.width > PHOTO_MAX_SIDE || size.height > PHOTO_MAX_SIDE) return { error: "bad_photo", message: `Use a picture no larger than ${PHOTO_MAX_SIDE} × ${PHOTO_MAX_SIDE}.` };
  return { bytes, ...kind };
}

/**
 * The last answer, reused for a while: every inbox load asks, and signing each photo's link is a request of
 * its own. The links last 12 hours, so a 10-minute-old list is still good; a photo change clears it.
 */
const FACES_REUSE_MS = 10 * 60 * 1000;
let facesCache: { at: number; faces: Record<string, string> } | null = null;

/** Every address with a picture, lowercase → a signed link to it. */
export async function mailFaces(now = Date.now()): Promise<Record<string, string>> {
  if (facesCache && now - facesCache.at < FACES_REUSE_MS) return facesCache.faces;
  const faces = await readFaces();
  facesCache = { at: now, faces };
  return faces;
}

async function readFaces(): Promise<Record<string, string>> {
  const users = await sb<{ id: string; mail_address: string; mail_photo: string }[]>(
    "app_users?status=eq.approved&mail_address=not.is.null&mail_photo=not.is.null&select=id,mail_address,mail_photo"
  );
  if (!users?.length) return {};
  const aliases = await sb<{ address: string; user_id: string }[]>(
    `mail_aliases?user_id=in.(${users.map((u) => u.id).join(",")})&select=address,user_id`
  );
  const faces: Record<string, string> = {};
  await Promise.all(
    users.map(async (u) => {
      // A picture that can't be signed falls back to initials.
      const url = await storageSignedUrl(u.mail_photo, FACE_LINK_SECONDS, BUCKET).catch((err) => (console.error("mail-photo: couldn't sign a link", err), null));
      if (!url) return;
      faces[u.mail_address.toLowerCase()] = url;
      for (const a of aliases ?? []) if (a.user_id === u.id) faces[a.address.toLowerCase()] = url;
    })
  );
  return faces;
}

/** Keeps the new picture, then lets go of the old one. */
export async function setMailPhoto(me: AppUser, data: unknown): Promise<{ ok: true } | { error: string; message: string }> {
  const photo = parsePhoto(data);
  if ("error" in photo) return photo;
  // A new name each time, so a link to the old picture never shows the new one half-cached.
  const path = `faces/${me.id}/${randomUUID()}.${photo.ext}`;
  await storageUpload(path, photo.bytes, photo.contentType, BUCKET);
  await sb(`app_users?id=eq.${me.id}`, { method: "PATCH", body: { mail_photo: path } });
  facesCache = null;
  if (me.mail_photo && me.mail_photo !== path) await storageRemove(me.mail_photo, BUCKET);
  return { ok: true };
}

/** Back to initials. */
export async function removeMailPhoto(me: AppUser): Promise<void> {
  await sb(`app_users?id=eq.${me.id}`, { method: "PATCH", body: { mail_photo: null } });
  facesCache = null;
  if (me.mail_photo) await storageRemove(me.mail_photo, BUCKET);
}
