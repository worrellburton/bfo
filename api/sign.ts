import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import { canWrite, currentUser, fail, guard, handleError, sb, sendEmail, type AppUser } from "../lib/auth.js";
import { clientIp } from "./auth/request-code.js";
import { notifyAdmins } from "../lib/push.js";
import { storageDownload, storageRemove, storageSignedUrl, storageUpload } from "../lib/storage.js";
import {
  appendCertificate,
  cleanField,
  cleanParty,
  deriveStatus,
  hashToken,
  isUploadPath,
  newToken,
  officeDate,
  pageFrame,
  pdfKey,
  sendBlocker,
  shownSize,
  SIGN_BUCKET,
  signedCopyEmail,
  signLink,
  signRequestEmail,
  stampPdf,
  toView,
  TOKEN_RE,
  versionPath,
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
 *            upload-url { id } → { signedUrl, token, path }  a one-time PUT to a fresh path (it can't overwrite)
 *            attach     { id, path }  reads that upload (page sizes) and makes it the document → { request }
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
 *
 * Every write names the row's version it read and bumps it; a write that
 * finds a newer version re-reads and tries again. So two parties signing at
 * once, or a signer opening the page while the office reminds, never undo
 * each other. Each stamped copy goes to a new path, so a losing attempt
 * leaves the winner's file alone.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, BIRD_* (email, lib/auth.ts), APNS_* (push to admins).
 */

const UUID_RE = /^[0-9a-f-]{36}$/i;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const TRIES = 5;

type Body = Record<string, unknown>;

/** A refusal decided inside a retried write: the handler answers with it. */
class Refuse extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string
  ) {
    super(message ?? code);
  }
}

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

/** Writes `changes` if the row is still at the version it was read at. Null when someone else wrote first. */
async function writeIfUnchanged(row: SignatureRequestRow, changes: Partial<SignatureRequestRow>): Promise<SignatureRequestRow | null> {
  const rows = await sb<SignatureRequestRow[]>(`signature_requests?id=eq.${row.id}&version=eq.${row.version ?? 0}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { ...changes, version: (row.version ?? 0) + 1 },
  });
  return rows?.[0] ?? null;
}

/**
 * Reads the row, works out the change, writes it if nothing changed meanwhile,
 * and otherwise starts again from the fresh row. `plan` may throw Refuse.
 */
async function update(
  load: () => Promise<SignatureRequestRow | null>,
  plan: (row: SignatureRequestRow) => Partial<SignatureRequestRow> | Promise<Partial<SignatureRequestRow>>
): Promise<SignatureRequestRow> {
  for (let i = 0; i < TRIES; i++) {
    const row = await load();
    if (!row) throw new Refuse(404, "not_found", "This request isn't there any more.");
    const written = await writeIfUnchanged(row, await plan(row));
    if (written) return written;
  }
  throw new Refuse(409, "busy", "Something else changed this at the same moment. Try again.");
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

/** Sends each email; the links are already saved, so a failure is reported, not lost. */
async function sendAll(me: AppUser, row: SignatureRequestRow, mails: Array<{ party: Party; subject: string; text: string; html: string }>, kind: string) {
  const sent: SignEvent[] = [];
  const failed: string[] = [];
  for (const m of mails) {
    try {
      await sendEmail(m.party.email, m.subject, m.text, m.html, undefined, undefined, { replyTo: me.email ?? undefined, fromName: row.brand ?? undefined });
      sent.push(event(kind, { party: m.party.key, by: me.id }));
    } catch (err) {
      console.error(`sign: ${kind} email to party ${m.party.key} failed`, err instanceof Error ? err.message : err);
      failed.push(m.party.name || m.party.role);
    }
  }
  let next = row;
  if (sent.length) next = await update(() => rowById(row.id), (r) => ({ events: [...r.events, ...sent] })).catch(() => row);
  if (failed.length) throw new Refuse(502, "email_failed", `Saved, but the email to ${failed.join(" and ")} didn't go out. Try Remind.`);
  return next;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "POST"])) return;
  try {
    const body = req.method === "POST" ? parseBody(req) : {};
    const token = String((req.method === "GET" ? req.query.token : body.token) ?? "");
    if (token) return await signer(req, res, token, body);

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
    const fresh = () => rowById(row.id);

    switch (action) {
      case "upload-url": {
        if (row.status !== "draft") return fail(res, 409, "already_sent", "The document can't change once it has been sent.");
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_KEY;
        if (!url || !key) return fail(res, 503, "not_configured");
        // A fresh path, no overwriting: once the upload lands, this link can't replace it.
        const path = versionPath(row.id, "upload");
        const { data, error } = await createClient(url, key).storage.from(SIGN_BUCKET).createSignedUploadUrl(path);
        if (error || !data) return fail(res, 502, "signed_url_failed", error?.message);
        return res.status(200).json({ signedUrl: data.signedUrl, token: data.token, path });
      }
      case "attach": {
        const path = String(body.path ?? "");
        if (!isUploadPath(row.id, path)) return fail(res, 400, "bad_path");
        const bytes = await storageDownload(path, SIGN_BUCKET);
        if (!bytes) return fail(res, 400, "no_file", "The PDF didn't arrive. Try the upload again.");
        if (bytes.byteLength > MAX_PDF_BYTES) return fail(res, 413, "too_big", "PDFs up to 25 MB.");
        let pages: Array<{ w: number; h: number }>;
        try {
          const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
          // Pages as a viewer shows them (turned, cropped): that's where fields are placed.
          pages = doc.getPages().map((p) => {
            const s = shownSize(pageFrame(p));
            return { w: Math.round(s.w * 100) / 100, h: Math.round(s.h * 100) / 100 };
          });
        } catch {
          return fail(res, 400, "not_a_pdf", "That file isn't a PDF we can read.");
        }
        if (!pages.length) return fail(res, 400, "not_a_pdf", "That PDF has no pages.");
        const next = await update(fresh, (r) => {
          if (r.status !== "draft") throw new Refuse(409, "already_sent", "The document can't change once it has been sent.");
          // Fields placed before the file (a contract's known signature block) are kept if they fit.
          const fields = r.fields.map((f) => cleanField(f, pages.length)).filter((f): f is NonNullable<typeof f> => !!f);
          return { original_path: path, current_path: path, pages, fields, events: [...r.events, event("attached", { by: me.id, note: `${pages.length} page${pages.length === 1 ? "" : "s"}` })] };
        });
        return res.status(200).json({ request: toView(next) });
      }
      case "update": {
        const next = await update(fresh, (r) => {
          const changes: Partial<SignatureRequestRow> = {};
          if (typeof body.title === "string") changes.title = body.title.trim().slice(0, 160) || r.title;
          const locked = r.parties.some((p) => p.status === "signed") || r.status === "completed" || r.status === "voided";
          if (Array.isArray(body.fields)) {
            if (locked) throw new Refuse(409, "locked", "Fields can't move once someone has signed.");
            changes.fields = body.fields.map((f) => cleanField(f, Math.max(1, r.pages.length))).filter((f): f is NonNullable<typeof f> => !!f);
          }
          if (Array.isArray(body.parties)) {
            if (locked) throw new Refuse(409, "locked", "Parties can't change once someone has signed.");
            changes.parties = partiesFrom(body.parties, r.parties);
          }
          return changes;
        });
        return res.status(200).json({ request: toView(next) });
      }
      case "send": {
        let links: Array<[Party, string]> = [];
        // The new links are saved first; only then do the emails go out.
        const saved = await update(fresh, (r) => {
          if (r.status === "voided") throw new Refuse(409, "voided");
          const why = sendBlocker(r);
          if (why) throw new Refuse(400, "not_ready", why);
          links = [];
          const parties = r.parties.map((p) => {
            if (p.status === "signed") return p;
            const t = newToken();
            const sent: Party = { ...p, tokenHash: hashToken(t), status: "sent", sentAt: new Date().toISOString() };
            links.push([sent, signLink(t)]);
            return sent;
          });
          return { parties, status: deriveStatus(parties, "sent"), sent_at: r.sent_at ?? new Date().toISOString(), events: [...r.events, event("sent", { by: me.id })] };
        });
        const next = await sendAll(me, saved, links.map(([party, link]) => ({ party, ...signRequestEmail(saved, party, link) })), "emailed");
        return res.status(200).json({ request: toView(next) });
      }
      case "remind": {
        const only = body.party === "a" || body.party === "b" ? (body.party as PartyKey) : null;
        let links: Array<[Party, string]> = [];
        const saved = await update(fresh, (r) => {
          if (r.status !== "sent" && r.status !== "partial") throw new Refuse(409, "not_pending");
          links = [];
          // A fresh link each time: the old one stops working.
          const parties = r.parties.map((p) => {
            if (p.status === "signed" || p.status === "declined" || (only && p.key !== only)) return p;
            const t = newToken();
            const sent: Party = { ...p, tokenHash: hashToken(t), sentAt: new Date().toISOString() };
            links.push([sent, signLink(t)]);
            return sent;
          });
          return { parties };
        });
        const next = await sendAll(me, saved, links.map(([party, link]) => ({ party, ...signRequestEmail(saved, party, link, true) })), "reminded");
        return res.status(200).json({ request: toView(next) });
      }
      case "send-copy": {
        let links: Array<[Party, string]> = [];
        const saved = await update(fresh, (r) => {
          if (r.status !== "completed" || !r.signed_path) throw new Refuse(409, "not_completed", "The copy goes out once everyone has signed.");
          links = [];
          const parties = r.parties.map((p) => {
            const t = newToken();
            const next: Party = { ...p, tokenHash: hashToken(t) };
            links.push([next, signLink(t)]);
            return next;
          });
          return { parties, copy_sent_at: new Date().toISOString() };
        });
        const next = await sendAll(me, saved, links.map(([party, link]) => ({ party, ...signedCopyEmail(saved, party, link) })), "copy_sent");
        return res.status(200).json({ request: toView(next) });
      }
      case "void": {
        const next = await update(fresh, (r) => {
          if (r.status === "completed") throw new Refuse(409, "completed", "A signed document can't be voided; delete it instead.");
          return { status: "voided", parties: r.parties.map(({ tokenHash: _t, ...p }) => p), events: [...r.events, event("voided", { by: me.id })] };
        });
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
    if (err instanceof Refuse) return fail(res, err.status, err.code, err.message === err.code ? undefined : err.message);
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
  const hash = hashToken(token);
  const load = async () => {
    const r = await rowByToken(token);
    return r && r.status !== "voided" && r.parties.some((p) => p.tokenHash === hash) ? r : null;
  };
  const row = await load();
  if (!row) return fail(res, 404, "not_found", "This signing link isn't valid any more.");
  const youIn = (r: SignatureRequestRow) => r.parties.find((p) => p.tokenHash === hash)!;
  const you = youIn(row);

  if (req.method === "GET") {
    let current = row;
    if (!you.viewedAt && you.status !== "signed") {
      // Best effort, and only this party's entry: losing a race just means it's marked on the next look.
      const viewedAt = new Date().toISOString();
      current =
        (await writeIfUnchanged(row, {
          parties: row.parties.map((p) => (p.key === you.key ? { ...p, status: p.status === "sent" ? "viewed" : p.status, viewedAt } : p)),
          events: [...row.events, event("viewed", { party: you.key })],
        }).catch(() => null)) ?? row;
    }
    const me = youIn(current) ?? you;
    const completed = current.status === "completed";
    const key = pdfKey(current);
    const same = typeof req.query.have === "string" && req.query.have === key;
    return res.status(200).json({
      brand: current.brand,
      pdfKey: key,
      title: current.title,
      status: current.status,
      completed,
      you: { key: me.key, role: me.role, name: me.name, email: me.email, status: me.status },
      parties: current.parties.map((p) => ({ key: p.key, role: p.role, name: p.name, status: p.status })),
      fields: current.fields,
      pages: current.pages,
      pdfUrl: same ? null : await latestPdfUrl(current, completed ? fileName(current) : undefined),
      sentBy: current.created_by_name,
    });
  }

  const action = String(body.action ?? "");
  if (action === "decline") {
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    await update(load, (r) => {
      const p0 = youIn(r);
      if (p0.status === "signed") throw new Refuse(409, "already_signed");
      const parties = r.parties.map((p) => (p.key === p0.key ? { ...p, status: "declined" as const, declinedAt: new Date().toISOString(), declinedReason: reason || undefined } : p));
      return { parties, status: deriveStatus(parties, r.status), events: [...r.events, event("declined", { party: p0.key, note: reason || undefined })] };
    });
    void notifyAdmins({ aps: { alert: { title: "Signature declined", body: `${you.name} declined ${row.title}${reason ? `: ${reason}` : ""}` }, sound: "default" }, url: `/tools/signatures/${row.id}` }, `sign-${row.id}`);
    return res.status(200).json({ ok: true });
  }
  if (action !== "sign") return fail(res, 400, "unknown_action");
  if (body.consent !== true) return fail(res, 400, "consent", "Please agree to sign electronically.");
  const name = String(body.name ?? "").trim().slice(0, 120);
  if (!name) return fail(res, 400, "name", "Type your full name.");
  const png = pngFromDataUrl(body.signature);
  if (!png) return fail(res, 400, "signature", "Draw or type your signature.");
  const ip = clientIp(req.headers) ?? undefined;
  const initials = name.split(/\s+/).map((w) => w[0]?.toUpperCase() ?? "").join("");

  // Stamp the latest copy into a new file, then claim the row at the version that copy came from.
  // If another signature landed first, drop this attempt's files and stamp the newer copy instead.
  let done: SignatureRequestRow | null = null;
  for (let i = 0; i < TRIES && !done; i++) {
    const r = await load();
    if (!r) return fail(res, 404, "not_found", "This signing link isn't valid any more.");
    const p0 = youIn(r);
    if (p0.status === "signed") return fail(res, 409, "already_signed", "You've already signed this.");
    if (r.status === "completed" || r.status === "declined") return fail(res, 409, "closed");
    if (!r.current_path) return fail(res, 409, "no_file");
    const pdf = await storageDownload(r.current_path, SIGN_BUCKET);
    if (!pdf) return fail(res, 500, "no_file", "The document couldn't be read.");

    const stamps: Stamp[] = r.fields
      .filter((f) => f.party === p0.key)
      .map((field) => (field.type === "signature" ? { field, png } : { field, text: field.type === "date" ? officeDate() : field.type === "initials" ? initials : name }));
    const stamped = await stampPdf(pdf, stamps);
    const signedAt = new Date().toISOString();
    const parties: Party[] = r.parties.map((p) => (p.key === p0.key ? { ...p, status: "signed", signedAt, signedAs: name, ip } : p));
    const status = deriveStatus(parties, r.status);
    const events = [...r.events, event("signed", { party: p0.key })];
    // Everything that can fail is built before anything is uploaded.
    const final = status === "completed" ? await appendCertificate(stamped, { ...r, parties, completed_at: signedAt }) : null;

    const currentPath = versionPath(r.id, "current");
    const signedPath = final ? versionPath(r.id, "signed") : null;
    await storageUpload(currentPath, stamped, "application/pdf", SIGN_BUCKET);
    if (final && signedPath) await storageUpload(signedPath, final, "application/pdf", SIGN_BUCKET);
    const changes: Partial<SignatureRequestRow> = { parties, status, current_path: currentPath, events };
    if (final && signedPath) {
      changes.signed_path = signedPath;
      changes.completed_at = signedAt;
      events.push(event("completed"));
    }
    done = await writeIfUnchanged(r, changes);
    if (!done) {
      await storageRemove(currentPath, SIGN_BUCKET);
      if (signedPath) await storageRemove(signedPath, SIGN_BUCKET);
    }
  }
  if (!done) return fail(res, 409, "busy", "Someone else signed at the same moment. Try again.");

  const completed = done.status === "completed";
  void notifyAdmins(
    {
      aps: { alert: { title: completed ? "Signed by everyone" : "Signature received", body: `${name} signed ${done.title}` }, sound: "default" },
      url: `/tools/signatures/${done.id}`,
    },
    `sign-${done.id}`
  );
  return res.status(200).json({ ok: true, completed });
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
