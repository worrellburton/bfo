import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import { canWrite, currentUser, fail, guard, handleError, sb, sendEmail } from "../lib/auth.js";
import { clientIp } from "./auth/request-code.js";
import { notifyAdmins } from "../lib/push.js";
import { storageDownload, storageSignedUrl, storageUpload } from "../lib/storage.js";
import {
  appendCertificate,
  cleanField,
  cleanParty,
  deriveStatus,
  hashToken,
  newToken,
  officeDate,
  pathFor,
  pdfKey,
  sendBlocker,
  SIGN_BUCKET,
  signedCopyEmail,
  signLink,
  signRequestEmail,
  stampPdf,
  toView,
  TOKEN_RE,
  type Party,
  type PartyKey,
  type SignatureRequestRow,
  type SignEvent,
  type Stamp,
} from "../lib/sign.js";

/**
 * Signatures (lib/sign.ts). Two callers: the office (signed in, canWrite) and
 * a signer holding the private link from their email (no account; the token
 * in the link is their proof).
 *
 * Office — GET → { requests }  every request, newest first (no token hashes)
 *          GET ?id=<uuid>[&have=<pdfKey>] → { request, pdfKey, pdfUrl }  one, with a short-lived link to its
 *                     latest PDF (null when `have` already names that version: a page polling for progress)
 *          POST { action, … }:
 *            create     { title, assetId?, contractId?, parties?, brand? } → { request }  (brand: send under that name, never BFO's)
 *            upload-url { id, contentType? } → { signedUrl, token, path }  a one-time PUT for the PDF
 *            attach     { id }  reads the uploaded PDF (page sizes) → { request }
 *            update     { id, title?, fields?, parties? } → { request }  (fields and parties while nobody has signed)
 *            send       { id } → { request }  emails each party their link
 *            remind     { id, party? } → { request }  re-sends the link to those who haven't signed
 *            send-copy  { id } → { request }  emails every party a link to the signed copy
 *            void       { id } → { request }  the links stop working
 *            delete     { id } → { ok }
 *            download   { id } → { url }  the signed copy (or the latest PDF)
 *
 * Signer — GET ?token=<token>[&have=<pdfKey>] → { title, brand, you, parties, fields, pdfKey, pdfUrl, status, completed }  (marks viewed)
 *          POST { action: "sign", token, name, signature (PNG data URL), consent: true } → { ok, completed }
 *          POST { action: "decline", token, reason? } → { ok }
 */

const UUID_RE = /^[0-9a-f-]{36}$/i;
const MAX_PDF_BYTES = 25 * 1024 * 1024;

type Body = Record<string, unknown>;

function parseBody(req: VercelRequest): Body {
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {};
  return (b && typeof b === "object" ? b : {}) as Body;
}

async function rowById(id: string): Promise<SignatureRequestRow | null> {
  if (!UUID_RE.test(id)) return null;
  const rows = await sb<SignatureRequestRow[]>(`signature_requests?id=eq.${id}&limit=1`);
  return rows?.[0] ?? null;
}

async function rowByToken(token: string): Promise<SignatureRequestRow | null> {
  if (!TOKEN_RE.test(token)) return null;
  const probe = encodeURIComponent(JSON.stringify([{ tokenHash: hashToken(token) }]));
  const rows = await sb<SignatureRequestRow[]>(`signature_requests?parties=cs.${probe}&limit=1`);
  return rows?.[0] ?? null;
}

async function patch(id: string, body: Partial<SignatureRequestRow>): Promise<SignatureRequestRow> {
  const rows = await sb<SignatureRequestRow[]>(`signature_requests?id=eq.${id}`, { method: "PATCH", prefer: "return=representation", body });
  if (!rows?.[0]) throw new Error("signature request vanished");
  return rows[0];
}

const event = (kind: string, extra: Omit<SignEvent, "at" | "kind"> = {}): SignEvent => ({ at: new Date().toISOString(), kind, ...extra });

/** A short-lived link to the PDF the office or a signer should see now. */
async function latestPdfUrl(row: SignatureRequestRow, download?: string): Promise<string | null> {
  const path = row.signed_path || row.current_path || row.original_path;
  return path ? storageSignedUrl(path, 3600, SIGN_BUCKET, download) : null;
}

function fileName(row: SignatureRequestRow): string {
  return `${row.title.replace(/[^\w .&-]+/g, " ").replace(/\s+/g, " ").trim() || "Document"}${row.signed_path ? " (signed)" : ""}.pdf`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "POST"])) return;
  try {
    const body = req.method === "POST" ? parseBody(req) : {};
    const token = String((req.method === "GET" ? req.query.token : body.token) ?? "");
    if (token) return signer(req, res, token, body);

    const me = await currentUser(req);
    if (!me) return fail(res, 401, "unauthorized");
    if (!canWrite(me)) return fail(res, 403, "forbidden");

    if (req.method === "GET") {
      const id = String(req.query.id ?? "");
      if (id) {
        const row = await rowById(id);
        if (!row) return fail(res, 404, "not_found");
        // A page polling for progress passes the key it already shows; an unchanged PDF isn't re-linked.
        const key = pdfKey(row);
        const same = typeof req.query.have === "string" && req.query.have === key;
        return res.status(200).json({ request: toView(row), pdfKey: key, pdfUrl: same ? null : await latestPdfUrl(row) });
      }
      const rows = await sb<SignatureRequestRow[]>("signature_requests?select=*&order=created_at.desc&limit=200");
      return res.status(200).json({ requests: (rows ?? []).map(toView) });
    }

    const action = String(body.action ?? "");
    if (action === "create") {
      const title = String(body.title ?? "").trim().slice(0, 160) || "Untitled document";
      const assetId = typeof body.assetId === "string" && /^[\w-]{1,80}$/.test(body.assetId) ? body.assetId : null;
      const contractId = typeof body.contractId === "string" && /^[\w-]{1,80}$/.test(body.contractId) ? body.contractId : null;
      const brand = typeof body.brand === "string" && body.brand.trim() ? body.brand.trim().slice(0, 120) : null;
      const parties = partiesFrom(body.parties, []);
      const [row] = await sb<SignatureRequestRow[]>("signature_requests", {
        method: "POST",
        prefer: "return=representation",
        body: {
          title,
          source: contractId ? "contract" : "upload",
          asset_id: assetId,
          contract_id: contractId,
          brand,
          created_by: me.id,
          created_by_name: me.name,
          parties,
          events: [event("created", { by: me.id })],
        },
      });
      return res.status(200).json({ request: toView(row) });
    }

    const id = String(body.id ?? "");
    const row = await rowById(id);
    if (!row) return fail(res, 404, "not_found");

    switch (action) {
      case "upload-url": {
        if (row.status !== "draft") return fail(res, 409, "already_sent", "The document can't change once it has been sent.");
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_KEY;
        if (!url || !key) return fail(res, 503, "not_configured");
        const supabase = createClient(url, key);
        const path = pathFor(row.id, "original");
        const { data, error } = await supabase.storage.from(SIGN_BUCKET).createSignedUploadUrl(path, { upsert: true });
        if (error || !data) return fail(res, 502, "signed_url_failed", error?.message);
        return res.status(200).json({ signedUrl: data.signedUrl, token: data.token, path });
      }
      case "attach": {
        if (row.status !== "draft") return fail(res, 409, "already_sent");
        const path = pathFor(row.id, "original");
        const bytes = await storageDownload(path, SIGN_BUCKET);
        if (!bytes) return fail(res, 400, "no_file", "The PDF didn't arrive. Try the upload again.");
        if (bytes.byteLength > MAX_PDF_BYTES) return fail(res, 413, "too_big", "PDFs up to 25 MB.");
        let pages: Array<{ w: number; h: number }>;
        try {
          const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
          pages = doc.getPages().map((p) => {
            const s = p.getSize();
            return { w: Math.round(s.width * 100) / 100, h: Math.round(s.height * 100) / 100 };
          });
        } catch {
          return fail(res, 400, "not_a_pdf", "That file isn't a PDF we can read.");
        }
        if (!pages.length) return fail(res, 400, "not_a_pdf", "That PDF has no pages.");
        // Fields placed before the file (a contract's known signature block) are kept if they fit.
        const fields = row.fields.map((f) => cleanField(f, pages.length)).filter((f): f is NonNullable<typeof f> => !!f);
        const next = await patch(row.id, { original_path: path, current_path: path, pages, fields, events: [...row.events, event("attached", { by: me.id, note: `${pages.length} page${pages.length === 1 ? "" : "s"}` })] });
        return res.status(200).json({ request: toView(next) });
      }
      case "update": {
        const changes: Partial<SignatureRequestRow> = {};
        if (typeof body.title === "string") changes.title = body.title.trim().slice(0, 160) || row.title;
        const locked = row.parties.some((p) => p.status === "signed") || row.status === "completed" || row.status === "voided";
        if (Array.isArray(body.fields)) {
          if (locked) return fail(res, 409, "locked", "Fields can't move once someone has signed.");
          changes.fields = body.fields.map((f) => cleanField(f, Math.max(1, row.pages.length))).filter((f): f is NonNullable<typeof f> => !!f);
        }
        if (Array.isArray(body.parties)) {
          if (locked) return fail(res, 409, "locked", "Parties can't change once someone has signed.");
          changes.parties = partiesFrom(body.parties, row.parties);
        }
        const next = await patch(row.id, changes);
        return res.status(200).json({ request: toView(next) });
      }
      case "send": {
        if (row.status === "voided") return fail(res, 409, "voided");
        const why = sendBlocker(row);
        if (why) return fail(res, 400, "not_ready", why);
        const parties: Party[] = [];
        const links: Array<[Party, string]> = [];
        for (const p of row.parties) {
          if (p.status === "signed") {
            parties.push(p);
            continue;
          }
          const t = newToken();
          const sent: Party = { ...p, tokenHash: hashToken(t), status: "sent", sentAt: new Date().toISOString() };
          parties.push(sent);
          links.push([sent, signLink(t)]);
        }
        const now = new Date().toISOString();
        const events = [...row.events, event("sent", { by: me.id })];
        for (const [p, link] of links) {
          const mail = signRequestEmail(row, p, link);
          await sendEmail(p.email, mail.subject, mail.text, mail.html, undefined, undefined, { replyTo: me.email ?? undefined, fromName: row.brand ?? undefined });
          events.push(event("emailed", { party: p.key }));
        }
        const next = await patch(row.id, { parties, status: deriveStatus(parties, "sent"), sent_at: row.sent_at ?? now, events });
        return res.status(200).json({ request: toView(next) });
      }
      case "remind": {
        if (row.status !== "sent" && row.status !== "partial") return fail(res, 409, "not_pending");
        const only = body.party === "a" || body.party === "b" ? (body.party as PartyKey) : null;
        const parties: Party[] = [];
        const events = [...row.events];
        for (const p of row.parties) {
          if (p.status === "signed" || p.status === "declined" || (only && p.key !== only)) {
            parties.push(p);
            continue;
          }
          // A fresh link each time: the old one stops working.
          const t = newToken();
          const sent: Party = { ...p, tokenHash: hashToken(t), status: p.status === "viewed" ? "viewed" : "sent", sentAt: new Date().toISOString() };
          parties.push(sent);
          const mail = signRequestEmail(row, sent, signLink(t), true);
          await sendEmail(p.email, mail.subject, mail.text, mail.html, undefined, undefined, { replyTo: me.email ?? undefined, fromName: row.brand ?? undefined });
          events.push(event("reminded", { party: p.key, by: me.id }));
        }
        const next = await patch(row.id, { parties, events });
        return res.status(200).json({ request: toView(next) });
      }
      case "send-copy": {
        if (row.status !== "completed" || !row.signed_path) return fail(res, 409, "not_completed", "The copy goes out once everyone has signed.");
        const parties: Party[] = [];
        const events = [...row.events];
        for (const p of row.parties) {
          const t = newToken();
          const next: Party = { ...p, tokenHash: hashToken(t) };
          parties.push(next);
          const mail = signedCopyEmail(row, next, signLink(t));
          await sendEmail(p.email, mail.subject, mail.text, mail.html, undefined, undefined, { replyTo: me.email ?? undefined, fromName: row.brand ?? undefined });
          events.push(event("copy_sent", { party: p.key, by: me.id }));
        }
        const next = await patch(row.id, { parties, events, copy_sent_at: new Date().toISOString() });
        return res.status(200).json({ request: toView(next) });
      }
      case "void": {
        if (row.status === "completed") return fail(res, 409, "completed", "A signed document can't be voided; delete it instead.");
        const parties = row.parties.map(({ tokenHash: _t, ...p }) => p);
        const next = await patch(row.id, { status: "voided", parties, events: [...row.events, event("voided", { by: me.id })] });
        return res.status(200).json({ request: toView(next) });
      }
      case "delete": {
        await sb(`signature_requests?id=eq.${row.id}`, { method: "DELETE" });
        return res.status(200).json({ ok: true });
      }
      case "download": {
        const url = await latestPdfUrl(row, fileName(row));
        if (!url) return fail(res, 404, "no_file");
        return res.status(200).json({ url });
      }
      default:
        return fail(res, 400, "unknown_action");
    }
  } catch (err) {
    return handleError(res, err);
  }
}

function partiesFrom(raw: unknown, prior: Party[]): Party[] {
  const list = Array.isArray(raw) ? raw.slice(0, 2) : [];
  const out: Party[] = [];
  (["a", "b"] as PartyKey[]).forEach((key, i) => {
    const p = cleanParty(list[i], key, prior.find((x) => x.key === key));
    if (p && (p.name || p.email || list[i])) out.push(p);
  });
  return out;
}

// ── The signer's side ─────────────────────────────────────────────────────

async function signer(req: VercelRequest, res: VercelResponse, token: string, body: Body) {
  const row = await rowByToken(token);
  if (!row || row.status === "voided") return fail(res, 404, "not_found", "This signing link isn't valid any more.");
  const you = row.parties.find((p) => p.tokenHash === hashToken(token));
  if (!you) return fail(res, 404, "not_found");

  if (req.method === "GET") {
    let parties = row.parties;
    let events = row.events;
    if (!you.viewedAt && you.status !== "signed") {
      const viewedAt = new Date().toISOString();
      parties = row.parties.map((p) => (p.key === you.key ? { ...p, status: p.status === "sent" ? "viewed" : p.status, viewedAt } : p));
      events = [...row.events, event("viewed", { party: you.key })];
      await patch(row.id, { parties, events });
    }
    const completed = row.status === "completed";
    const key = pdfKey(row);
    const same = typeof req.query.have === "string" && req.query.have === key;
    return res.status(200).json({
      brand: row.brand,
      pdfKey: key,
      title: row.title,
      status: row.status,
      completed,
      you: { key: you.key, role: you.role, name: you.name, email: you.email, status: parties.find((p) => p.key === you.key)?.status ?? you.status },
      parties: parties.map((p) => ({ key: p.key, role: p.role, name: p.name, status: p.status })),
      fields: row.fields,
      pages: row.pages,
      pdfUrl: same ? null : await latestPdfUrl(row, completed ? fileName(row) : undefined),
      sentBy: row.created_by_name,
    });
  }

  const action = String(body.action ?? "");
  if (action === "decline") {
    if (you.status === "signed") return fail(res, 409, "already_signed");
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    const parties = row.parties.map((p) => (p.key === you.key ? { ...p, status: "declined" as const, declinedAt: new Date().toISOString(), declinedReason: reason || undefined } : p));
    await patch(row.id, { parties, status: deriveStatus(parties, row.status), events: [...row.events, event("declined", { party: you.key, note: reason || undefined })] });
    void notifyAdmins({ aps: { alert: { title: "Signature declined", body: `${you.name} declined ${row.title}${reason ? `: ${reason}` : ""}` }, sound: "default" }, url: `/tools/signatures/${row.id}` }, `sign-${row.id}`);
    return res.status(200).json({ ok: true });
  }
  if (action !== "sign") return fail(res, 400, "unknown_action");
  if (you.status === "signed") return fail(res, 409, "already_signed", "You've already signed this.");
  if (row.status === "completed" || row.status === "declined") return fail(res, 409, "closed");
  if (body.consent !== true) return fail(res, 400, "consent", "Please agree to sign electronically.");
  const name = String(body.name ?? "").trim().slice(0, 120);
  if (!name) return fail(res, 400, "name", "Type your full name.");
  const png = pngFromDataUrl(body.signature);
  if (!png) return fail(res, 400, "signature", "Draw or type your signature.");
  if (!row.current_path) return fail(res, 409, "no_file");

  const pdf = await storageDownload(row.current_path, SIGN_BUCKET);
  if (!pdf) return fail(res, 500, "no_file", "The document couldn't be read.");
  const initials = name.split(/\s+/).map((w) => w[0]?.toUpperCase() ?? "").join("");
  const stamps: Stamp[] = row.fields
    .filter((f) => f.party === you.key)
    .map((field) => (field.type === "signature" ? { field, png } : { field, text: field.type === "date" ? officeDate() : field.type === "initials" ? initials : name }));
  const stamped = await stampPdf(pdf, stamps);
  const currentPath = pathFor(row.id, "current");
  await storageUpload(currentPath, stamped, "application/pdf", SIGN_BUCKET);

  const signedAt = new Date().toISOString();
  const parties: Party[] = row.parties.map((p) => (p.key === you.key ? { ...p, status: "signed", signedAt, signedAs: name, ip: clientIp(req.headers) ?? undefined } : p));
  const status = deriveStatus(parties, row.status);
  const events = [...row.events, event("signed", { party: you.key })];
  const changes: Partial<SignatureRequestRow> = { parties, status, current_path: currentPath, events };
  if (status === "completed") {
    const final = await appendCertificate(stamped, { ...row, parties, completed_at: signedAt });
    const signedPath = pathFor(row.id, "signed");
    await storageUpload(signedPath, final, "application/pdf", SIGN_BUCKET);
    changes.signed_path = signedPath;
    changes.completed_at = signedAt;
    events.push(event("completed"));
  }
  await patch(row.id, changes);
  void notifyAdmins(
    {
      aps: { alert: { title: status === "completed" ? "Signed by everyone" : "Signature received", body: `${name} signed ${row.title}` }, sound: "default" },
      url: `/tools/signatures/${row.id}`,
    },
    `sign-${row.id}`
  );
  return res.status(200).json({ ok: true, completed: status === "completed" });
}

/** The PNG bytes of a data: URL the signature pad produced (a few hundred KB at most). */
function pngFromDataUrl(raw: unknown): Uint8Array | null {
  if (typeof raw !== "string") return null;
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(raw);
  if (!m || m[1].length > 1_500_000) return null;
  const bytes = Buffer.from(m[1], "base64");
  // PNG signature
  if (bytes.length < 100 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  return new Uint8Array(bytes);
}
