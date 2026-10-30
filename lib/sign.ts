/**
 * Signatures (Tools › Signatures): a document goes out to its parties, each
 * signs on a public page, and the signed copy comes back with a certificate.
 *
 * Rows live in public.signature_requests (supabase/migrations/
 * 20261028_signature_requests.sql). The PDFs live in the private "documents"
 * bucket under signatures/<id>/: original.pdf as uploaded or generated,
 * current.pdf with the signatures stamped so far, signed.pdf once everyone
 * has signed (current plus a certificate page).
 *
 * Pure helpers (field geometry, status, tokens, the certificate text, the
 * emails) are here so they can be tested; api/sign.ts does the I/O.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (storage and rows), the Bird email
 * vars sendEmail needs (BIRD_* in lib/auth.ts).
 */

import { createHash, randomBytes } from "node:crypto";
import { degrees, PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const SITE = "https://www.burtonfamilyoffice.com";
export const SIGN_BUCKET = "documents";

export type PartyKey = "a" | "b";
type FieldType = "signature" | "initials" | "name" | "date";
export type PartyStatus = "pending" | "sent" | "viewed" | "signed" | "declined";
export type RequestStatus = "draft" | "sent" | "partial" | "completed" | "declined" | "voided";

/** Where a signer's mark goes: fractions of the page, y measured from the top. */
export type SignField = { id: string; party: PartyKey; type: FieldType; page: number; x: number; y: number; w: number; h: number };

export type Party = {
  key: PartyKey;
  role: string;
  name: string;
  email: string;
  status: PartyStatus;
  /** sha-256 of the token in their link; the token itself is never stored. */
  tokenHash?: string;
  sentAt?: string;
  viewedAt?: string;
  signedAt?: string;
  declinedAt?: string;
  declinedReason?: string;
  ip?: string;
  /** What they typed as their name when signing (the certificate shows it). */
  signedAs?: string;
};

export type SignEvent = { at: string; kind: string; party?: PartyKey; by?: string; note?: string };

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
  /** Bumped on every write; writes name the version they read so none overwrites another. */
  version: number;
};

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

// ── Tokens ────────────────────────────────────────────────────────────────

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/;

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

/** Why a request can't go out yet, or null when it can. */
export function sendBlocker(row: Pick<SignatureRequestRow, "original_path" | "fields" | "parties">): string | null {
  if (!row.original_path) return "Add the document first.";
  if (row.parties.length < 1) return "Add at least one party.";
  for (const p of row.parties) {
    if (!p.name.trim()) return `Name the ${p.role.toLowerCase() || "party"}.`;
    if (!EMAIL_RE.test(p.email.trim())) return `${p.name || p.role} needs an email address.`;
    if (!row.fields.some((f) => f.party === p.key && f.type === "signature")) return `Place a signature field for ${p.name || p.role}.`;
  }
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Bounds a field's geometry to the page and sane sizes. */
export function cleanField(raw: unknown, pageCount: number): SignField | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const type = f.type;
  const party = f.party;
  if (type !== "signature" && type !== "initials" && type !== "name" && type !== "date") return null;
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

export function cleanParty(raw: unknown, key: PartyKey, prior?: Party): Party | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  return {
    ...(prior ?? { status: "pending" as PartyStatus }),
    key,
    role: str(p.role, 40) || (key === "a" ? "Party A" : "Party B"),
    name: str(p.name, 120),
    email: str(p.email, 200).toLowerCase(),
  };
}

// ── Dates ─────────────────────────────────────────────────────────────────

export function officeDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", month: "long", day: "numeric", year: "numeric" }).format(d);
}

function officeDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
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
      drawFitted(page, font, fontSafe(s.text, font), r);
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

/** Appends the certificate page: who signed what, when, from where. */
export async function appendCertificate(pdf: Uint8Array, row: SignatureRequestRow): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const first = doc.getPage(0).getSize();
  const page = doc.addPage([first.width, first.height]);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.08, 0.08, 0.1);
  const muted = rgb(0.45, 0.45, 0.47);
  const ml = 56;
  const mr = first.width - 56;
  let y = first.height - 80;
  const line = (text: string, font: PDFFont, size: number, color = ink, x = ml) => {
    page.drawText(fontSafe(text, font), { x, y, size, font, color });
    y -= size * 1.55;
  };
  const mark = fontSafe(row.brand || "BFO", serifBold);
  line(mark, serifBold, 14);
  y += 2;
  page.drawText("SIGNATURE CERTIFICATE", { x: ml + serifBold.widthOfTextAtSize(mark, 14) + 10, y: y + 14 * 1.55 - 2, size: 7, font: sans, color: muted });
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
    line(bold ? text.slice(3) : text, bold ? serifBold : serif, bold ? 12 : 10.5);
  }
  y -= 10;
  page.drawLine({ start: { x: ml, y }, end: { x: mr, y }, thickness: 0.4, color: muted });
  y -= 16;
  for (const text of certificateFooter(row.brand)) line(text, sans, 8, muted);
  return doc.save();
}

/** The small print under the certificate; without BFO's name when the request is sent under another. */
export function certificateFooter(brand: string | null): string[] {
  return brand
    ? ["Signed electronically. Each party opened a private link sent to the email address above, read the document,", "and signed it; the time and network address of each signature are recorded."]
    : [
        "Signed through BFO, Burton Family Office (burtonfamilyoffice.com). Each party opened a private link sent to the",
        "email address above, read the document, and signed it; the time and network address of each signature are recorded.",
      ];
}

/** The certificate's lines (a "## " prefix is a heading; "" is a gap). */
export function certificateLines(row: SignatureRequestRow): string[] {
  const out: string[] = [];
  for (const p of row.parties) {
    out.push(`## ${p.role}: ${p.name}`);
    out.push(`Email ${p.email}`);
    if (p.signedAs && p.signedAs !== p.name) out.push(`Signed as ${p.signedAs}`);
    out.push(p.signedAt ? `Signed ${officeDateTime(p.signedAt)}${p.ip ? ` from ${p.ip}` : ""}` : `Not signed`);
    if (p.viewedAt) out.push(`First opened ${officeDateTime(p.viewedAt)}`);
    out.push("");
  }
  if (row.sent_at) out.push(`Sent for signature ${officeDateTime(row.sent_at)}${row.created_by_name ? ` by ${row.created_by_name}` : ""}`);
  if (row.completed_at) out.push(`Completed ${officeDateTime(row.completed_at)}`);
  return out;
}

// ── Emails ────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function shell(inner: string, brand: string | null = null): string {
  return `<!doctype html><html><body style="margin:0;background:#000;padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:460px;background:#0b0b0b;border:1px solid rgba(255,255,255,0.12);border-radius:20px;" cellpadding="0" cellspacing="0">
      <tr><td style="padding:40px 34px;text-align:center;">
        ${
          brand
            ? `<div style="font-family:'Playfair Display',Georgia,serif;font-size:26px;line-height:1.2;color:#ffffff;">${esc(brand)}</div>`
            : `<div style="font-family:'Playfair Display',Georgia,serif;font-size:13px;letter-spacing:0.28em;text-transform:uppercase;color:rgba(255,255,255,0.5);">Burton Family Office</div>
        <div style="margin-top:6px;font-family:'Playfair Display',Georgia,serif;font-size:40px;color:#ffffff;">BFO</div>`
        }
        ${inner}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

const button = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;margin-top:26px;padding:12px 26px;border-radius:12px;background:#ffffff;color:#000;font-size:14px;font-weight:600;text-decoration:none;">${esc(label)}</a>`;

export function signRequestEmail(row: Pick<SignatureRequestRow, "title" | "created_by_name" | "brand">, party: Party, link: string, remind = false) {
  const from = row.brand || row.created_by_name || "Burton Family Office";
  const subject = remind ? `Reminder: ${row.title} is waiting for your signature` : `${from} sent you ${row.title} to sign`;
  const text = `${from} ${remind ? "is still waiting for your signature on" : "sent you"} ${row.title}.\n\nReview and sign it here:\n${link}\n\nYou're signing as ${party.name} (${party.role}). The link is private to you.\n`;
  const html = shell(`
        <div style="margin:28px 0 8px;font-size:15px;line-height:1.6;color:rgba(255,255,255,0.8);">${esc(from)} ${remind ? "is still waiting for your signature on" : "sent you"}<br/><strong style="color:#fff;">${esc(row.title)}</strong></div>
        <div style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.5);">You're signing as ${esc(party.name)}, ${esc(party.role)}.</div>
        ${button(link, "Review and sign")}
        <div style="margin-top:20px;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.4);">This link is private to you. If you weren't expecting it, you can ignore this email.</div>`, row.brand);
  return { subject, text, html };
}

export function signedCopyEmail(row: Pick<SignatureRequestRow, "title" | "brand">, party: Party, link: string) {
  const subject = `${row.title}: signed by everyone`;
  const text = `${row.title} has been signed by every party. Your copy, with the signature certificate, is here:\n${link}\n`;
  const html = shell(`
        <div style="margin:28px 0 8px;font-size:15px;line-height:1.6;color:rgba(255,255,255,0.8);">Signed by everyone<br/><strong style="color:#fff;">${esc(row.title)}</strong></div>
        <div style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.5);">Your copy for ${esc(party.name)}, with the signature certificate.</div>
        ${button(link, "Download the signed copy")}`, row.brand);
  return { subject, text, html };
}

export function signLink(token: string): string {
  return `${SITE}/sign/${token}`;
}
