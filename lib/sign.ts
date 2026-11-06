/**
 * Signatures (Tools › Signatures): a document goes out to its parties, each
 * signs on a public page, and the signed copy comes back with a certificate.
 *
 * Rows live in public.signature_requests (supabase/migrations/
 * 20261028_signature_requests.sql, and 20261107_signature_requests_records.sql
 * for the fingerprints, the archive, the replaces chain and the filed copy).
 * The PDFs live in the private "documents" bucket under signatures/<id>/:
 * the original as uploaded or generated, the copy with the signatures stamped
 * so far, and the signed copy once everyone has signed (the stamped pages
 * plus a certificate page). A request tied to an entity also files its signed
 * copy under assets/<id>/ with the entity's documents.
 *
 * The record a signature leaves, per party: the electronic-records consent
 * (the disclosure's version, when, the network address and the device), the
 * signature itself (when, from where, on what device, drawn or typed, and
 * whether a game came first), the first opening, and any decline. The
 * certificate prints all of it with the SHA-256 of the original and of the
 * signed pages.
 *
 * Pure helpers (field geometry, status, tokens, the certificate text, the
 * emails, what may be deleted or archived) are here so they can be tested;
 * api/sign.ts does the I/O.
 *
 * HTTP surface: none (a library for api/sign.ts).
 * Env: none read here; the caller's SUPABASE_URL, SUPABASE_SERVICE_KEY and
 * the Bird email vars (BIRD_* in lib/auth.ts) carry the I/O.
 */

import { createHash, randomBytes } from "node:crypto";
import { degrees, PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const SITE = "https://www.burtonfamilyoffice.com";
export const SIGN_BUCKET = "documents";

/**
 * The version of the Electronic Records and Signatures Disclosure a signer
 * agrees to (app/sign/disclosure.tsx holds the text, under the same version).
 * Change both together when the words change; every consent records which
 * version was shown.
 */
export const ESIGN_DISCLOSURE_VERSION = "2026-11-06";
const KNOWN_DISCLOSURES = new Set([ESIGN_DISCLOSURE_VERSION]);

/** How long a signing link works after it is sent (Remind sends a fresh one). */
export const LINK_DAYS = 60;

export type PartyKey = "a" | "b";
type FieldType = "signature" | "initials" | "name" | "date" | "address";
export type PartyStatus = "pending" | "sent" | "viewed" | "signed" | "declined";
export type RequestStatus = "draft" | "sent" | "partial" | "completed" | "declined" | "voided";
/** How the parties sign: the plain page, the Anything Is Possible theater game, or the racetrack game in front of it. */
export type SignMode = "normal" | "game" | "race";

/** Where a signer's mark goes: fractions of the page, y measured from the top. */
export type SignField = { id: string; party: PartyKey; type: FieldType; page: number; x: number; y: number; w: number; h: number };

/** A signer's agreement to use electronic records and signatures: which disclosure, when, and from where. */
export type ConsentRecord = { version: string; at: string; ip?: string; device?: string };

export type Party = {
  key: PartyKey;
  role: string;
  /** The person who signs. */
  name: string;
  email: string;
  /** The company the person signs for ("Northwind Holdings, LLC"), when they sign for one. */
  entity?: string;
  /** Their title in that company ("Manager"). */
  title?: string;
  status: PartyStatus;
  /** sha-256 of the token in their link; the token itself is never stored. */
  tokenHash?: string;
  sentAt?: string;
  /** When the link in their latest email stops working. */
  expiresAt?: string;
  viewedAt?: string;
  viewIp?: string;
  viewDevice?: string;
  signedAt?: string;
  declinedAt?: string;
  declinedReason?: string;
  declineIp?: string;
  declineDevice?: string;
  /** The network address the signature came from. */
  ip?: string;
  /** The browser the signature came from (its user agent, clipped). */
  device?: string;
  /** Drawn with a finger or mouse, or typed and set in a script face. */
  method?: "drawn" | "typed";
  /** Where they signed: on the page straight away, or after the game. */
  via?: "page" | "game";
  /** The time zone the date stamp was written in. */
  timeZone?: string;
  /** What they typed as their name when signing (the certificate shows it). */
  signedAs?: string;
  /** The address they typed when signing, when the document has an address field for them. */
  address?: string;
  /** Their agreement to sign electronically, recorded just before the signature. */
  consent?: ConsentRecord;
};

export type SignEvent = { at: string; kind: string; party?: PartyKey; by?: string; note?: string; ip?: string; device?: string };

export type SignatureRequestRow = {
  id: string;
  title: string;
  status: RequestStatus;
  source: "contract" | "upload";
  asset_id: string | null;
  contract_id: string | null;
  created_by: string | null;
  created_by_name: string | null;
  original_path: string | null;
  current_path: string | null;
  signed_path: string | null;
  pages: Array<{ w: number; h: number }>;
  fields: SignField[];
  parties: Party[];
  events: SignEvent[];
  created_at: string;
  sent_at: string | null;
  completed_at: string | null;
  copy_sent_at: string | null;
  /** Who it comes from when it must not mention BFO (an MSA with "Entity name only"); null is BFO. */
  brand: string | null;
  /** The plain signing page, or the game in front of it. Rows from before the column read as normal. */
  mode: SignMode;
  /** Bumped on every write; writes name the version they read so none overwrites another. */
  version: number;
  // The columns below arrive with 20261107_signature_requests_records.sql; rows read before it lack them.
  /** SHA-256 (hex) of the original document, as sent. */
  original_sha256?: string | null;
  /** SHA-256 of the signed pages before the certificate (printed on the certificate). */
  executed_sha256?: string | null;
  /** SHA-256 of the signed copy as filed and sent: the signed pages plus the certificate. */
  signed_sha256?: string | null;
  /** Archived: hidden from the list, kept whole (an executed or sent request is never deleted). */
  archived_at?: string | null;
  archived_by?: string | null;
  archived_by_name?: string | null;
  archived_reason?: string | null;
  /** The request this one was sent again from, and the one that replaced it. */
  replaces?: string | null;
  replaced_by?: string | null;
  /** Where the signed copy was filed with the entity's documents (assets/<id>/…). */
  filed_path?: string | null;
};

/** The columns 20261107_signature_requests_records.sql adds; a write to a database without them leaves them out. */
export const RECORD_COLUMNS = [
  "original_sha256",
  "executed_sha256",
  "signed_sha256",
  "archived_at",
  "archived_by",
  "archived_by_name",
  "archived_reason",
  "replaces",
  "replaced_by",
  "filed_path",
] as const;

/** What the office sees: the row without the token hashes. */
type SignatureRequestView = Omit<SignatureRequestRow, "parties"> & { parties: Array<Omit<Party, "tokenHash">> };

export function toView(row: SignatureRequestRow): SignatureRequestView {
  return { ...row, parties: row.parties.map(({ tokenHash: _t, ...p }) => p) };
}

/**
 * Names the PDF a viewer should see now. The stamped copy is rewritten in place
 * at the same path on each signature, so the key carries the signature count:
 * a page can tell a new version from a fresh link to the same one.
 */
export function pdfKey(row: Pick<SignatureRequestRow, "signed_path" | "current_path" | "original_path" | "parties">): string | null {
  const path = row.signed_path || row.current_path || row.original_path;
  return path ? `${path}#${row.parties.filter((p) => p.status === "signed").length}` : null;
}

/**
 * A fresh path for a new version of a request's PDF. Every upload and every
 * stamped copy gets its own, so nothing already written is ever replaced: an
 * old upload link can't swap the document, and a signature that loses a race
 * leaves the winner's file alone.
 */
export const versionPath = (id: string, which: "upload" | "current" | "signed") => `signatures/${id}/${which}-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}.pdf`;

/** True for a path versionPath made for this request's uploads. */
export const isUploadPath = (id: string, path: string) => new RegExp(`^signatures/${id.replace(/[^0-9a-f-]/gi, "")}/upload-[a-z0-9]+-[0-9a-f]{8}\\.pdf$`).test(path);

/** The SHA-256 of a file, as lowercase hex: the document's fingerprint on the certificate. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Where the signed copy is filed with an entity's documents: under the entity, named after the request. */
export function filedPath(assetId: string, title: string, id: string, now = Date.now()): string {
  const safeAsset = assetId.replace(/[^\w-]/g, "_").slice(0, 80);
  const safeTitle =
    title
      .replace(/[^\w .&,()-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "Document";
  return `assets/${safeAsset}/${now}-${safeTitle} (signed ${id.slice(0, 8)}).pdf`;
}

// ── Tokens ────────────────────────────────────────────────────────────────

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/;

/** When a link sent now stops working. */
export function linkExpiry(from: Date = new Date()): string {
  return new Date(from.getTime() + LINK_DAYS * 24 * 3600_000).toISOString();
}

/** True when the party's link has run out (links from before expiry was kept never do). */
export function linkExpired(p: Pick<Party, "expiresAt">, now: Date = new Date()): boolean {
  return !!p.expiresAt && Date.parse(p.expiresAt) < now.getTime();
}

// ── Status ────────────────────────────────────────────────────────────────

/** The request's status from its parties' (a void stays void). */
export function deriveStatus(parties: Party[], current: RequestStatus): RequestStatus {
  if (current === "voided" || current === "draft") return current;
  if (parties.some((p) => p.status === "declined")) return "declined";
  const signed = parties.filter((p) => p.status === "signed").length;
  if (parties.length && signed === parties.length) return "completed";
  if (signed > 0) return "partial";
  return "sent";
}

/** A name that reads as a company, trust or other organisation rather than a person. */
export function looksLikeEntity(name: string): boolean {
  return (
    /\b(l\.?l\.?c|l\.?l\.?p|l\.?p|inc|incorporated|corp|corporation|company|co|ltd|limited|trust|foundation|partners(hip)?|holdings|pllc|pc|p\.c)\b\.?,?\s*$/i.test(name.trim()) ||
    /,\s*(llc|inc|lp|ltd)\b/i.test(name)
  );
}

/** "Northwind Holdings, LLC, by Alex Rivera, Manager", or the person's name alone. */
export function signerCapacity(p: Pick<Party, "name" | "entity" | "title">): string {
  if (!p.entity) return p.name;
  return `${p.entity}, by ${p.name || "its signer"}${p.title ? `, ${p.title}` : ""}`;
}

/** Why a request can't go out yet, or null when it can. `sender` is the email of the person sending it. */
export function sendBlocker(row: Pick<SignatureRequestRow, "original_path" | "fields" | "parties">, sender?: string | null): string | null {
  if (!row.original_path) return "Add the document first.";
  if (row.parties.length < 1) return "Add at least one party.";
  for (const p of row.parties) {
    if (!p.name.trim()) return `Name the ${p.role.toLowerCase() || "party"}.`;
    if (!p.entity && looksLikeEntity(p.name)) return `${p.name} is a company: name the person who signs for it, and their title.`;
    if (p.entity && !p.title?.trim()) return `Add ${p.name}'s title at ${p.entity}.`;
    if (!EMAIL_RE.test(p.email.trim())) return `${p.name || p.role} needs an email address.`;
    if (!row.fields.some((f) => f.party === p.key && f.type === "signature")) return `Place a signature field for ${p.name || p.role}.`;
  }
  // A signing link goes to the signer, never to whoever presses Send in their place.
  const me = sender?.trim().toLowerCase();
  if (me) {
    const mine = row.parties.filter((p) => p.email.trim().toLowerCase() === me);
    if (mine.length > 1) return "Two parties have your email address. Each party needs their own.";
  }
  const emails = row.parties.map((p) => p.email.trim().toLowerCase());
  if (new Set(emails).size !== emails.length) return "Two parties have the same email address. Each party needs their own.";
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Why a request can't be deleted, or null when it can: only a draft that never went out. */
export function deleteBlocker(row: Pick<SignatureRequestRow, "status" | "sent_at">): string | null {
  if (row.status !== "draft" || row.sent_at) return "A request that has been sent is kept. Archive it instead.";
  return null;
}

/** Why a request can't be archived now, or null. Open requests are voided first, so no link stays live on a hidden record. */
export function archiveBlocker(row: Pick<SignatureRequestRow, "status" | "sent_at" | "archived_at">): string | null {
  if (row.archived_at) return "It's already archived.";
  if (row.status === "draft" && !row.sent_at) return "A draft that never went out can be deleted instead.";
  if (row.status === "sent" || row.status === "partial") return "It's still out for signature. Void it first.";
  return null;
}

/** A consent as the signer's page sends it: agreed, to a disclosure version this server knows. */
export function consentProblem(consent: unknown, version: unknown): "consent" | "consent_version" | null {
  if (consent !== true) return "consent";
  if (typeof version !== "string" || !KNOWN_DISCLOSURES.has(version)) return "consent_version";
  return null;
}

/** A time zone the browser named, if it's a real one; the date stamp is written in it. */
export function cleanTimeZone(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(raw) || raw.length > 64) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    return undefined;
  }
}

/** A user agent, clipped and stripped to what's worth keeping as evidence. */
export function cleanDevice(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = [...raw]
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
    .join("")
    .trim();
  return s ? s.slice(0, 300) : undefined;
}

/** A user agent as a few words: "Safari on iPhone", "Chrome on Windows". */
export function deviceSummary(ua: string | undefined): string {
  if (!ua) return "";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /CrOS/.test(ua)
              ? "ChromeOS"
              : /Linux/.test(ua)
                ? "Linux"
                : "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\/|FxiOS/.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || "a browser";
}

/** Bounds a field's geometry to the page and sane sizes. */
export function cleanField(raw: unknown, pageCount: number): SignField | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const type = f.type;
  const party = f.party;
  if (type !== "signature" && type !== "initials" && type !== "name" && type !== "date" && type !== "address") return null;
  if (party !== "a" && party !== "b") return null;
  const page = Math.floor(Number(f.page));
  if (!(page >= 1 && page <= pageCount)) return null;
  const num = (v: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number(v)));
  const w = num(f.w, 0.03, 1);
  const h = num(f.h, 0.01, 1);
  const x = num(f.x, 0, 1 - w);
  const y = num(f.y, 0, 1 - h);
  if ([x, y, w, h].some((n) => Number.isNaN(n))) return null;
  const id = typeof f.id === "string" && /^[\w-]{1,40}$/.test(f.id) ? f.id : randomBytes(6).toString("hex");
  return { id, party, type, page, x, y, w, h };
}

/** A mode as sent by the office; anything unknown is the plain page. */
export function cleanMode(raw: unknown): SignMode {
  return raw === "game" || raw === "race" ? raw : "normal";
}

/** True for a mode that puts a game in front of the signing page. */
export const isGameMode = (mode: SignMode | undefined): boolean => mode === "game" || mode === "race";

/** The modes as words, for the history and the certificate. */
export const MODE_WORDS: Record<SignMode, string> = { normal: "Normal e-signature", game: "Anything Is Possible film", race: "Racetrack game" };

export function cleanParty(raw: unknown, key: PartyKey, prior?: Party): Party | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const entity = str(p.entity, 160);
  const title = str(p.title, 80);
  const { entity: _e, title: _t, ...rest } = prior ?? ({ status: "pending" as PartyStatus } as Partial<Party>);
  return {
    ...(rest as Party),
    key,
    role: str(p.role, 40) || (key === "a" ? "Party A" : "Party B"),
    name: str(p.name, 120),
    email: str(p.email, 200).toLowerCase(),
    ...(entity ? { entity } : {}),
    ...(entity && title ? { title } : {}),
  };
}

// ── Dates ─────────────────────────────────────────────────────────────────

/** The signing date as stamped on the page: in the signer's own time zone when the page sent one, else the office's (Arizona). */
export function officeDate(d: Date = new Date(), timeZone = "America/Phoenix"): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "long", day: "numeric", year: "numeric" }).format(d);
}

/** An audit stamp: "Nov 5, 2026, 6:58 AM MST", in Arizona time like everything the office keeps. */
export function officeDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })
    .format(new Date(iso))
    .replace(/[\u202f\u00a0]/g, " ");
}

/** A date for an email: "January 5, 2027". */
function longDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", month: "long", day: "numeric", year: "numeric" }).format(new Date(iso));
}

// ── Stamping ──────────────────────────────────────────────────────────────

export type Stamp = { field: SignField; png?: Uint8Array; text?: string };

/** Fits a w×h image inside a box, keeping its shape, anchored bottom-left. */
export function fitInside(imgW: number, imgH: number, boxW: number, boxH: number): { w: number; h: number } {
  const s = Math.min(boxW / imgW, boxH / imgH);
  return { w: imgW * s, h: imgH * s };
}

/** A field's rectangle in PDF points (origin bottom-left). */
export function fieldRect(f: SignField, pw: number, ph: number): { x: number; y: number; w: number; h: number } {
  return { x: f.x * pw, y: ph - (f.y + f.h) * ph, w: f.w * pw, h: f.h * ph };
}

/** A page as a viewer shows it: its visible box (CropBox) and how far it's turned clockwise. */
type PageFrame = { x: number; y: number; w: number; h: number; rotate: number };

export function pageFrame(page: PDFPage): PageFrame {
  const box = page.getCropBox();
  const r = (((page.getRotation().angle % 360) + 360) % 360) as number;
  return { x: box.x, y: box.y, w: box.width, h: box.height, rotate: r === 90 || r === 180 || r === 270 ? r : 0 };
}

/** The size a viewer draws the page at (turned pages swap width and height). */
export const shownSize = (f: PageFrame) => (f.rotate === 90 || f.rotate === 270 ? { w: f.h, h: f.w } : { w: f.w, h: f.h });

/**
 * Where a field goes in the page's own coordinates. Fields are placed on the
 * page as it's shown (pdf.js applies /Rotate and the CropBox), so the shown
 * box's bottom-left corner is mapped back, and the content is turned to read
 * upright. Returns that corner, the box's shown size in points, and the turn.
 */
export function placeField(f: SignField, frame: PageFrame): { x: number; y: number; w: number; h: number; rotate: number } {
  const shown = shownSize(frame);
  const w = f.w * shown.w;
  const h = f.h * shown.h;
  // The shown bottom-left corner, as fractions of the shown page from its top-left.
  const u = f.x;
  const v = f.y + f.h;
  let px: number;
  let py: number;
  switch (frame.rotate) {
    case 90:
      px = frame.x + v * frame.w;
      py = frame.y + u * frame.h;
      break;
    case 180:
      px = frame.x + (1 - u) * frame.w;
      py = frame.y + v * frame.h;
      break;
    case 270:
      px = frame.x + (1 - v) * frame.w;
      py = frame.y + (1 - u) * frame.h;
      break;
    default:
      px = frame.x + u * frame.w;
      py = frame.y + (1 - v) * frame.h;
  }
  return { x: px, y: py, w, h, rotate: frame.rotate };
}

/** A point `dx` along and `dy` up from (x, y), in a box turned `rotate` degrees counterclockwise. */
function along(x: number, y: number, dx: number, dy: number, rotate: number) {
  const t = (rotate * Math.PI) / 180;
  return { x: x + dx * Math.cos(t) - dy * Math.sin(t), y: y + dx * Math.sin(t) + dy * Math.cos(t) };
}

/**
 * Text the standard PDF fonts can draw. They only cover Windows-1252, and
 * pdf-lib throws on anything else, so accents are folded ("Łukasz" → "Lukasz")
 * and what's left that the font lacks becomes "?".
 */
export function fontSafe(text: string, font: Pick<PDFFont, "getCharacterSet">): string {
  const have = new Set(font.getCharacterSet());
  const folded = text
    .replace(/[Łł]/g, (c) => (c === "Ł" ? "L" : "l"))
    .replace(/[Đđ]/g, (c) => (c === "Đ" ? "D" : "d"))
    .replace(/[Øø]/g, (c) => (c === "Ø" ? "O" : "o"))
    .replace(/[Ħħ]/g, (c) => (c === "Ħ" ? "H" : "h"))
    .replace(/ı/g, "i")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
  let out = "";
  for (const ch of folded) {
    const cp = ch.codePointAt(0)!;
    if (have.has(cp)) {
      out += ch;
      continue;
    }
    const base = ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    out += [...base].every((c) => have.has(c.codePointAt(0)!)) && base ? base : "?";
  }
  return out;
}

/** Draws each stamp into the PDF and returns the new bytes. */
export async function stampPdf(pdf: Uint8Array, stamps: Stamp[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const pages = doc.getPages();
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const plain = await doc.embedFont(StandardFonts.Helvetica);
  for (const s of stamps) {
    const page = pages[s.field.page - 1];
    if (!page) continue;
    const r = placeField(s.field, pageFrame(page));
    if (s.png) {
      const img = await doc.embedPng(s.png);
      const fit = fitInside(img.width, img.height, r.w, r.h);
      page.drawImage(img, { x: r.x, y: r.y, width: fit.w, height: fit.h, rotate: degrees(r.rotate) });
    } else if (s.text) {
      const font = s.field.type === "name" || s.field.type === "initials" ? italic : plain;
      if (s.field.type === "address") drawWrapped(page, font, fontSafe(s.text, font), r);
      else drawFitted(page, font, fontSafe(s.text, font), r);
    }
  }
  return doc.save();
}

function drawFitted(page: PDFPage, font: PDFFont, text: string, r: { x: number; y: number; w: number; h: number; rotate: number }) {
  let size = Math.min(14, r.h * 0.7);
  while (size > 5 && font.widthOfTextAtSize(text, size) > r.w) size -= 0.5;
  const at = along(r.x, r.y, 0, (r.h - size) / 2 + size * 0.1, r.rotate);
  page.drawText(text, { x: at.x, y: at.y, size, font, color: rgb(0.08, 0.08, 0.1), rotate: degrees(r.rotate) });
}

/**
 * An address in its box: on the lines it was typed on, or, typed on one line,
 * broken at its commas into up to three, at the largest size that fits.
 */
function drawWrapped(page: PDFPage, font: PDFFont, text: string, r: { x: number; y: number; w: number; h: number; rotate: number }) {
  const typed = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const fits = (lines: string[], size: number) => lines.every((l) => font.widthOfTextAtSize(l, size) <= r.w) && size * 1.2 * lines.length <= r.h;
  let size = Math.min(11, r.h * 0.7);
  let lines = typed.length ? typed : [text];
  if (lines.length === 1) {
    // Pack the comma-separated parts into as few lines as fit, three at most.
    const parts = lines[0].split(/,\s*/).filter(Boolean);
    for (; size > 5; size -= 0.5) {
      const packed: string[] = [];
      for (const part of parts) {
        const last = packed[packed.length - 1];
        if (last !== undefined && font.widthOfTextAtSize(`${last}, ${part}`, size) <= r.w) packed[packed.length - 1] = `${last}, ${part}`;
        else packed.push(part);
      }
      if (packed.length <= 3 && fits(packed, size)) {
        lines = packed;
        break;
      }
    }
  }
  while (size > 5 && !fits(lines, size)) size -= 0.5;
  const lineH = size * 1.2;
  const total = lineH * lines.length;
  lines.forEach((l, i) => {
    const at = along(r.x, r.y, 0, (r.h - total) / 2 + (lines.length - 1 - i) * lineH + size * 0.1, r.rotate);
    page.drawText(l, { x: at.x, y: at.y, size, font, color: rgb(0.08, 0.08, 0.1), rotate: degrees(r.rotate) });
  });
}

/** Appends the certificate page (or pages): who signed what, when, from where, on what, after agreeing to what, and the document's fingerprints. */
export async function appendCertificate(pdf: Uint8Array, row: SignatureRequestRow): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const first = doc.getPage(0).getSize();
  let page = doc.addPage([first.width, first.height]);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.08, 0.08, 0.1);
  const muted = rgb(0.4, 0.4, 0.42);
  const ml = 56;
  const mr = first.width - 56;
  let y = first.height - 80;
  const room = (need: number) => {
    if (y - need >= 56) return;
    page = doc.addPage([first.width, first.height]);
    y = first.height - 64;
  };
  const line = (text: string, font: PDFFont, size: number, color = ink) => {
    // Long lines (a device, a fingerprint) wrap at spaces, or anywhere when there are none.
    const words = fontSafe(text, font).split(/(?<=\s)/);
    const rows: string[] = [];
    let cur = "";
    for (const w of words) {
      if (font.widthOfTextAtSize(cur + w, size) <= mr - ml || !cur) cur += w;
      else {
        rows.push(cur.trimEnd());
        cur = w;
      }
    }
    if (cur) rows.push(cur.trimEnd());
    for (let r of rows) {
      while (font.widthOfTextAtSize(r, size) > mr - ml && r.length > 1) {
        let cut = r.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(r.slice(0, cut), size) > mr - ml) cut--;
        room(size * 1.55);
        page.drawText(r.slice(0, cut), { x: ml, y, size, font, color });
        y -= size * 1.55;
        r = r.slice(cut);
      }
      room(size * 1.55);
      page.drawText(r, { x: ml, y, size, font, color });
      y -= size * 1.55;
    }
  };
  const mark = fontSafe(row.brand || "BFO", serifBold);
  line(mark, serifBold, 14);
  y += 2;
  page.drawText("Signature certificate", { x: ml + serifBold.widthOfTextAtSize(mark, 14) + 10, y: y + 14 * 1.55 - 2, size: 8, font: sans, color: muted });
  page.drawLine({ start: { x: ml, y: y + 6 }, end: { x: mr, y: y + 6 }, thickness: 0.8, color: ink });
  y -= 22;
  line(row.title, serifBold, 18);
  line(`Reference ${row.id}`, sans, 8, muted);
  y -= 10;
  for (const text of certificateLines(row)) {
    if (text === "") {
      y -= 8;
      continue;
    }
    const bold = text.startsWith("## ");
    if (bold) room(60);
    line(bold ? text.slice(3) : text, bold ? serifBold : serif, bold ? 12 : 10.5);
  }
  y -= 10;
  room(60);
  page.drawLine({ start: { x: ml, y }, end: { x: mr, y }, thickness: 0.4, color: muted });
  y -= 16;
  for (const text of certificateFooter(row.brand)) line(text, sans, 8, muted);
  return doc.save();
}

/** The small print under the certificate; without BFO's name when the request is sent under another. */
export function certificateFooter(brand: string | null): string[] {
  const how =
    "Each party opened a private link sent to the email address above, agreed to use electronic records and signatures, opened the document and signed it. The time, network address and device of each step are recorded. The SHA-256 fingerprints identify the original document and the signed pages exactly: a copy whose fingerprint differs is not this document.";
  return brand ? [`Signed electronically. ${how}`] : [`Signed through BFO, Burton Family Office (burtonfamilyoffice.com). ${how}`];
}

/** How a party came to sign: on the page straight away, or after the request's game. */
function signedThrough(row: Pick<SignatureRequestRow, "mode">, p: Party): string {
  const method = p.method === "typed" ? "Signature typed" : p.method === "drawn" ? "Signature drawn" : "Signed";
  if (!isGameMode(row.mode)) return `${method} on the signing page`;
  return p.via === "game" ? `${method} on the signing page, after the ${MODE_WORDS[row.mode]}` : `${method} on the signing page (the ${MODE_WORDS[row.mode]} was offered first and skipped)`;
}

/** The certificate's lines (a "## " prefix is a heading; "" is a gap). */
export function certificateLines(row: SignatureRequestRow): string[] {
  const out: string[] = [];
  const from = (ip?: string, device?: string) => [ip ? ` from ${ip}` : "", device ? ` · ${deviceSummary(device)}` : ""].join("");
  for (const p of row.parties) {
    out.push(`## ${p.role}: ${signerCapacity(p)}`);
    out.push(`Email ${p.email}`);
    if (p.signedAs && p.signedAs !== p.name) out.push(`Signed as ${p.signedAs}`);
    if (p.consent) out.push(`Agreed to use electronic records and signatures ${officeDateTime(p.consent.at)}${from(p.consent.ip, p.consent.device)} (disclosure of ${p.consent.version})`);
    if (p.signedAt) {
      out.push(`Signed ${officeDateTime(p.signedAt)}${from(p.ip, p.device)}`);
      out.push(signedThrough(row, p));
    } else if (p.declinedAt) out.push(`Declined ${officeDateTime(p.declinedAt)}${from(p.declineIp, p.declineDevice)}`);
    else out.push("Not signed");
    if (p.viewedAt) out.push(`First opened ${officeDateTime(p.viewedAt)}${from(p.viewIp, p.viewDevice)}`);
    out.push("");
  }
  out.push("## The document");
  out.push(`Signing mode: ${MODE_WORDS[row.mode ?? "normal"]}${isGameMode(row.mode) ? " (optional; the signing page and its consent are the same in every mode)" : ""}`);
  if (row.original_sha256) out.push(`Original document SHA-256: ${row.original_sha256}`);
  if (row.executed_sha256) out.push(`Signed pages SHA-256 (pages 1 to ${row.pages.length || "end"}, before this certificate): ${row.executed_sha256}`);
  if (row.sent_at) out.push(`Sent for signature ${officeDateTime(row.sent_at)}${row.created_by_name ? ` by ${row.created_by_name}` : ""}`);
  if (row.completed_at) out.push(`Completed ${officeDateTime(row.completed_at)}`);
  return out;
}

// ── Emails ────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The links every signer's email carries: the disclosure (on the signing page) and the privacy notice. */
function footerLinks(link: string | null): string {
  const a = (href: string, label: string) => `<a href="${href}" style="color:rgba(255,255,255,0.7);text-decoration:underline;">${esc(label)}</a>`;
  const parts = [...(link ? [a(`${link}#disclosure`, "Electronic records disclosure")] : []), a(`${SITE}/legal/privacy`, "Privacy")];
  return `<div style="margin-top:24px;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.7);">${parts.join(" &middot; ")}</div>`;
}

function shell(inner: string, brand: string | null = null, footer = ""): string {
  return `<!doctype html><html><body style="margin:0;background:#000;padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:460px;background:#0b0b0b;border:1px solid rgba(255,255,255,0.12);border-radius:20px;" cellpadding="0" cellspacing="0">
      <tr><td style="padding:40px 34px;text-align:center;">
        ${
          brand
            ? `<div style="font-family:'Playfair Display',Georgia,serif;font-size:26px;line-height:1.2;color:#ffffff;">${esc(brand)}</div>`
            : `<div style="font-size:13px;color:rgba(255,255,255,0.7);">Burton Family Office</div>
        <div style="margin-top:6px;font-family:'Playfair Display',Georgia,serif;font-size:40px;color:#ffffff;">BFO</div>`
        }
        ${inner}
        ${footer}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

const button = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;margin-top:26px;padding:12px 26px;border-radius:12px;background:#ffffff;color:#000;font-size:14px;font-weight:600;text-decoration:none;">${esc(label)}</a>`;

/** The line that tells a theater-mode signer what comes first. Signing never needs a computer: a phone signs on the page. */
export const GAME_NOTE =
  "This one is a little different: on a computer, a short film plays before the signing page (about three minutes, sound on). On a phone or tablet, or if you'd rather skip it, you can read and sign straight away.";
/** The same for the racetrack game. */
export const RACE_NOTE =
  "This one is a little different: on a computer, you race two laps around a track before the signing page (about three minutes, sound on). On a phone or tablet, or if you'd rather skip it, you can read and sign straight away.";

/** "You're signing as Alex Rivera, Member." or "You're signing for Northwind Holdings, LLC as its Manager." */
function signingAs(party: Party): string {
  return party.entity ? `You're signing for ${party.entity} as its ${party.title || "authorised signer"}.` : `You're signing as ${party.name}, ${party.role}.`;
}

export function signRequestEmail(row: Pick<SignatureRequestRow, "title" | "created_by_name" | "brand"> & { mode?: SignMode }, party: Party, link: string, remind = false) {
  const from = row.brand || row.created_by_name || "Burton Family Office";
  const game = isGameMode(row.mode);
  const note = row.mode === "race" ? RACE_NOTE : GAME_NOTE;
  const until = party.expiresAt ? `The link works until ${longDate(party.expiresAt)}.` : "";
  const subject = remind ? `Reminder: ${row.title} is waiting for your signature` : `${from} sent you ${row.title} to sign`;
  const text = `${from} ${remind ? "is still waiting for your signature on" : "sent you"} ${row.title}.\n\n${game ? `${note}\n\n` : ""}Review and sign it here:\n${link}\n\n${signingAs(party)} The link is private to you.${until ? ` ${until}` : ""}\n\nElectronic records disclosure: ${link}#disclosure\nPrivacy: ${SITE}/legal/privacy\n`;
  const html = shell(
    `
        <div style="margin:28px 0 8px;font-size:15px;line-height:1.6;color:rgba(255,255,255,0.8);">${esc(from)} ${remind ? "is still waiting for your signature on" : "sent you"}<br/><strong style="color:#fff;">${esc(row.title)}</strong></div>
        <div style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.7);">${esc(signingAs(party))}</div>
        ${game ? `<div style="margin-top:14px;font-size:13px;line-height:1.6;color:rgba(255,255,255,0.7);">${esc(note)}</div>` : ""}
        ${button(link, "Review and sign")}
        <div style="margin-top:20px;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.7);">This link is private to you.${until ? ` ${esc(until)}` : ""} If you weren't expecting it, you can ignore this email.</div>`,
    row.brand,
    footerLinks(link),
  );
  return { subject, text, html };
}

export function signedCopyEmail(row: Pick<SignatureRequestRow, "title" | "brand"> & { signed_sha256?: string | null }, party: Party, link: string) {
  const subject = `${row.title}: signed by everyone`;
  const print = row.signed_sha256 ? `\n\nThe signed copy's SHA-256 fingerprint is ${row.signed_sha256}.` : "";
  const text = `${row.title} has been signed by every party. Your copy, with the signature certificate, is here:\n${link}${print}\n\nPrivacy: ${SITE}/legal/privacy\n`;
  const html = shell(
    `
        <div style="margin:28px 0 8px;font-size:15px;line-height:1.6;color:rgba(255,255,255,0.8);">Signed by everyone<br/><strong style="color:#fff;">${esc(row.title)}</strong></div>
        <div style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.7);">Your copy for ${esc(party.name)}, with the signature certificate.</div>
        ${button(link, "Download the signed copy")}
        ${row.signed_sha256 ? `<div style="margin-top:20px;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.7);word-break:break-all;">SHA-256 fingerprint: ${esc(row.signed_sha256)}</div>` : ""}`,
    row.brand,
    footerLinks(null),
  );
  return { subject, text, html };
}

/** The office's email when a party signs: who, what, and whether that completes it. */
export function signedNoticeEmail(row: Pick<SignatureRequestRow, "id" | "title">, signer: string, completed: boolean) {
  const subject = completed ? `Signed by everyone: ${row.title}` : `${signer} signed ${row.title}`;
  const link = `${SITE}/tools/signatures/${row.id}`;
  const text = `${signer} signed ${row.title}.${completed ? " Everyone has signed; the signed copy is ready." : " Waiting on the other party."}\n\n${link}\n`;
  const html = shell(`
        <div style="margin:28px 0 8px;font-size:15px;line-height:1.6;color:rgba(255,255,255,0.8);">${esc(signer)} signed<br/><strong style="color:#fff;">${esc(row.title)}</strong></div>
        <div style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.7);">${completed ? "Everyone has signed. The signed copy, with its certificate, is ready." : "Waiting on the other party."}</div>
        ${button(link, "Open the request")}`);
  return { subject, text, html };
}

/** The office's email when a party declines, with their reason (kept off the push, which shows on lock screens). */
export function declinedNoticeEmail(row: Pick<SignatureRequestRow, "id" | "title">, signer: string, reason: string) {
  const subject = `${signer} declined ${row.title}`;
  const link = `${SITE}/tools/signatures/${row.id}`;
  const said = reason ? `Their reason: ${reason}` : "They didn't give a reason.";
  const text = `${signer} declined to sign ${row.title}. The request is closed.\n\n${said}\n\n${link}\n`;
  const html = shell(`
        <div style="margin:28px 0 8px;font-size:15px;line-height:1.6;color:rgba(255,255,255,0.8);">${esc(signer)} declined<br/><strong style="color:#fff;">${esc(row.title)}</strong></div>
        <div style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.7);">The request is closed. ${esc(said)}</div>
        ${button(link, "Open the request")}`);
  return { subject, text, html };
}

/** The decliner's receipt: what they declined, when, and that nothing more is needed. */
export function declineReceiptEmail(row: Pick<SignatureRequestRow, "title" | "brand" | "created_by_name">, party: Party, at: string) {
  const from = row.brand || row.created_by_name || "Burton Family Office";
  const subject = `You declined ${row.title}`;
  const text = `You declined to sign ${row.title} on ${officeDateTime(at)}. ${from} has been told. Nothing more is needed from you.\n\nPrivacy: ${SITE}/legal/privacy\n`;
  const html = shell(
    `
        <div style="margin:28px 0 8px;font-size:15px;line-height:1.6;color:rgba(255,255,255,0.8);">You declined<br/><strong style="color:#fff;">${esc(row.title)}</strong></div>
        <div style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.7);">${esc(officeDateTime(at))}. ${esc(from)} has been told. Nothing more is needed from you, ${esc(party.name)}.</div>`,
    row.brand,
    footerLinks(null),
  );
  return { subject, text, html };
}

/** A party's notice that a request was withdrawn: their link stops working, and nothing more is needed. */
export function withdrawnEmail(row: Pick<SignatureRequestRow, "title" | "brand" | "created_by_name">, party: Party, signedBefore: boolean) {
  const from = row.brand || row.created_by_name || "Burton Family Office";
  const subject = `${row.title} was withdrawn`;
  const lost = signedBefore ? " Your signature on it no longer counts." : "";
  const text = `${from} withdrew ${row.title}.${lost} The signing link no longer works, and nothing more is needed from you.\n\nPrivacy: ${SITE}/legal/privacy\n`;
  const html = shell(
    `
        <div style="margin:28px 0 8px;font-size:15px;line-height:1.6;color:rgba(255,255,255,0.8);">Withdrawn<br/><strong style="color:#fff;">${esc(row.title)}</strong></div>
        <div style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.7);">${esc(from)} withdrew this request.${esc(lost)} The signing link no longer works, and nothing more is needed from you, ${esc(party.name)}.</div>`,
    row.brand,
    footerLinks(null),
  );
  return { subject, text, html };
}

export function signLink(token: string): string {
  return `${SITE}/sign/${token}`;
}
