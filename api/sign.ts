/**
 * Signatures (lib/sign.ts). Two callers: the office (signed in, canWrite) and
 * a signer holding the private link from their email (no account; the token
 * in the link is their proof). Partners are refused with 403 by currentUser.
 *
 * Office — GET → { requests, entityNames }  every request that isn't archived, newest first (no token hashes);
 *                     ?archived=1 → only the archived ones
 *          GET ?id=<uuid>[&have=<pdfKey>] → { request, pdfKey, pdfUrl, gameAllowed, gameEntity, entityName, accounts, people, related }
 *                     one, with a short-lived link to its latest PDF (null when `have` already names that version: a page
 *                     polling for progress); gameAllowed: a draft that may go out as the game (TallulahMD LLC's,
 *                     lib/game-entity); accounts: which parties already have a BFO account; people: names for the
 *                     history's actors; related: other requests for the same document and entity (versions)
 *          POST { action, … }:
 *            create     { title, assetId?, contractId?, parties?, brand?, mode? } → { request }  (brand: send under that name,
 *                       never BFO's; mode: normal, game or race, the games only for TallulahMD LLC)
 *            upload-url { id } → { signedUrl, token, path }  a one-time PUT to a fresh path (it can't overwrite)
 *            attach     { id, path }  reads that upload (page sizes, SHA-256) and makes it the document → { request }
 *            attach-stored { id, path }  a PDF already in an entity's documents (lib/document-path), copied under the request
 *            update     { id, title?, fields?, parties?, mode? } → { request }  only while it's a draft: once sent, the
 *                       record can't change without an event (void it and send a new one)
 *            send       { id, plain? } → { request }  emails each party their link (plain: a normal-looking email for a game)
 *            remind     { id, party?, plain? } → { request }  a fresh link to those who haven't signed
 *            resend     { id, mode?, plain?, address?: PartyKey[], reason? } → { request }  the same document and parties as a
 *                       new request (replaces / replaced_by link the two); Address boxes under the named parties' signatures;
 *                       a pending original is voided; a completed one needs a reason and stays on file
 *            send-copy  { id } → { request }  emails every party a link to the signed copy (it also goes out by itself on completion)
 *            void       { id, reason, notify? } → { request }  the links stop working; notify emails the parties
 *            archive    { id, reason } → { request }  owner or admin: hidden from the list, kept whole
 *            unarchive  { id } → { request }  owner or admin
 *            delete     { id } → { ok }  only a draft that never went out; its files go too
 *            file       { id } → { request }  files the signed copy with the entity's documents (done on completion; this retries)
 *            download   { id } → { url }  the signed copy (or the latest PDF)
 *
 * Signer — GET ?token=<token>[&have=<pdfKey>] → { title, brand, mode, you, parties, fields, pdfKey, pdfUrl, downloadUrl, status,
 *                     completed, documentId, signedSha, expiresAt, disclosureVersion }  (a withdrawn request answers with
 *                     its status and date only; an expired link with 410)
 *          POST { action: "opened", token }  the page drew the document: the first opening, with its address and device
 *          POST { action: "sign", token, name, signature (PNG data URL), consent: true, consentVersion, method?, via?, timeZone?,
 *                 address? } → { ok, completed }
 *          POST { action: "decline", token, reason? } → { ok }
 *
 * Every write names the row's version it read and bumps it; a write that
 * finds a newer version re-reads and tries again. So two parties signing at
 * once, or a signer opening the page while the office reminds, never undo
 * each other. Each stamped copy goes to a new path, so a losing attempt
 * leaves the winner's file alone.
 *
 * Consequential office actions go to the audit log (lib/audit.ts) and, for a
 * request tied to an entity, to the entity's activity (lib/activity.ts).
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, BIRD_* (email, lib/auth.ts), APNS_* (push to admins).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import { randomBytes } from "node:crypto";
import { canWrite, currentUser, fail, guard, handleError, isAdmin, sb, sendEmail, type AppUser } from "../lib/auth.js";
import { clientIp } from "./auth/request-code.js";
import { logActivity, type Actor } from "../lib/activity.js";
import { audit } from "../lib/audit.js";
import { fetchAll } from "../lib/db-pages.js";
import { notifyAdmins } from "../lib/push.js";
import { storageDownload, storageRemove, storageSignedUrl, storageUpload } from "../lib/storage.js";
import { DOCUMENTS_BUCKET, isDocumentPath } from "../lib/document-path.js";
import { GAME_ONLY_MESSAGE, isGameEntity } from "../lib/game-entity.js";
import { applyOps, readRows } from "../lib/tree.js";
import {
  appendCertificate,
  archiveBlocker,
  cleanDevice,
  cleanField,
  cleanMode,
  cleanParty,
  cleanTimeZone,
  consentProblem,
  declinedNoticeEmail,
  declineReceiptEmail,
  deleteBlocker,
  deriveStatus,
  ESIGN_DISCLOSURE_VERSION,
  filedPath,
  hashToken,
  isGameMode,
  isUploadPath,
  linkExpired,
  linkExpiry,
  MODE_WORDS,
  newToken,
  officeDate,
  pageFrame,
  type Party,
  type PartyKey,
  pdfKey,
  RECORD_COLUMNS,
  sendBlocker,
  sha256Hex,
  shownSize,
  SIGN_BUCKET,
  type SignatureRequestRow,
  signedCopyEmail,
  signedNoticeEmail,
  type SignEvent,
  type SignField,
  signLink,
  signRequestEmail,
  type Stamp,
  stampPdf,
  TOKEN_RE,
  toView,
  versionPath,
  withdrawnEmail,
} from "../lib/sign.js";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const TRIES = 5;

type Body = Record<string, unknown>;
type Row = SignatureRequestRow;

/** A refusal decided inside a retried write: the handler answers with it. */
class Refuse extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

function parseBody(req: VercelRequest): Body {
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
  return (b && typeof b === "object" ? b : {}) as Body;
}

/** A database error that means a column isn't there yet (20261107_signature_requests_records.sql not applied). */
export function isMissingColumn(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /PGRST204|42703|column .* does not exist|Could not find the '[^']+' column/i.test(msg);
}

async function rowById(id: string): Promise<Row | null> {
  if (!UUID_RE.test(id)) return null;
  const rows = await sb<Row[]>(`signature_requests?id=eq.${id}&limit=1`);
  return rows?.[0] ?? null;
}

async function rowByToken(token: string): Promise<Row | null> {
  if (!TOKEN_RE.test(token)) return null;
  const probe = encodeURIComponent(JSON.stringify([{ tokenHash: hashToken(token) }]));
  const rows = await sb<Row[]>(`signature_requests?parties=cs.${probe}&limit=1`);
  return rows?.[0] ?? null;
}

/** The entity's name from the tree, or null. */
async function entityName(assetId: string | null): Promise<string | null> {
  if (!assetId) return null;
  try {
    const data = (await readRows("assets", [assetId]))[0]?.data;
    const name = data && typeof data === "object" && !Array.isArray(data) ? data.name : undefined;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch (err) {
    console.error("sign: couldn't read the entity's name", err instanceof Error ? err.message : err);
    return null;
  }
}

/** True when the request is one of TallulahMD LLC's, the one entity whose signers get the game (lib/game-entity). */
async function gameAllowed(row: Pick<Row, "asset_id">): Promise<boolean> {
  if (!row.asset_id) return false;
  const data = (await readRows("assets", [row.asset_id]))[0]?.data;
  const name = data && typeof data === "object" && !Array.isArray(data) ? data.name : undefined;
  return typeof name === "string" && isGameEntity(name);
}

/** gameAllowed for a page someone is looking at: an unreadable tree means the plain page (logged), not an error. */
async function gameAllowedOrPlain(row: Pick<Row, "asset_id">): Promise<boolean> {
  try {
    return await gameAllowed(row);
  } catch (err) {
    console.error("sign: couldn't read the request's entity, so the plain page", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Whether the database has the record columns; learnt from the first write that finds them missing. */
let recordColumns = true;

/** Writes `changes` if the row is still at the version it was read at. Null when someone else wrote first. */
async function writeIfUnchanged(row: Row, changes: Partial<Row>): Promise<Row | null> {
  const write = async (c: Partial<Row>) =>
    (
      await sb<Row[]>(`signature_requests?id=eq.${row.id}&version=eq.${row.version ?? 0}`, {
        method: "PATCH",
        prefer: "return=representation",
        body: { ...c, version: (row.version ?? 0) + 1 },
      })
    )?.[0] ?? null;
  const without = () => Object.fromEntries(Object.entries(changes).filter(([k]) => !(RECORD_COLUMNS as readonly string[]).includes(k))) as Partial<Row>;
  if (!recordColumns) return write(without());
  try {
    return await write(changes);
  } catch (err) {
    if (!isMissingColumn(err)) throw err;
    // The migration isn't applied yet: keep signing working, without the fingerprints and the archive.
    recordColumns = false;
    console.warn("sign: record columns missing; writing without them", { migrated: false });
    return write(without());
  }
}

/**
 * Reads the row, works out the change, writes it if nothing changed meanwhile,
 * and otherwise starts again from the fresh row. `plan` may throw Refuse.
 */
async function update(load: () => Promise<Row | null>, plan: (row: Row) => Partial<Row> | Promise<Partial<Row>>): Promise<Row> {
  for (let i = 0; i < TRIES; i++) {
    const row = await load();
    if (!row) throw new Refuse(404, "not_found", "This request isn't there any more.");
    const written = await writeIfUnchanged(row, await plan(row));
    if (written) return written;
  }
  throw new Refuse(409, "busy", "Something else changed this at the same moment. Try again.");
}

const event = (kind: string, extra: Omit<SignEvent, "at" | "kind"> = {}): SignEvent => ({ at: new Date().toISOString(), kind, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)) });

/** Who did it, for an office event: the id (and the name, so the history reads without a lookup). */
const by = (me: AppUser) => ({ by: me.id, byName: me.name || undefined });

/** The browser that made the request, as evidence (clipped). */
const deviceOf = (req: VercelRequest) => cleanDevice(req.headers?.["user-agent"]);

/** An office actor for the entity's activity. */
const actorOf = (me: AppUser | null): Actor => (me ? { id: me.id, name: me.name || me.email || null, source: "user" } : { id: null, name: "Signatures", source: "system" });

/** A line in the entity's activity, when the request belongs to one. Never fails the request. */
async function entityLog(row: Pick<Row, "asset_id">, me: AppUser | null, summary: string, detail?: Record<string, unknown>) {
  if (!row.asset_id) return;
  await logActivity(row.asset_id, actorOf(me), [{ kind: "signature", summary, detail: detail ?? null }]);
}

/** A short-lived link to the PDF the office or a signer should see now. */
async function latestPdfUrl(row: Row, download?: string): Promise<string | null> {
  const path = row.signed_path || row.current_path || row.original_path;
  return path ? storageSignedUrl(path, 3600, SIGN_BUCKET, download) : null;
}

function fileName(row: Row): string {
  return `${
    row.title
      .replace(/[^\w .&-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Document"
  }${row.signed_path ? " (signed)" : ""}.pdf`;
}

type Mail = { party: Party; subject: string; text: string; html: string };

/** Sends each email; the links are already saved, so a failure is reported, not lost. `me` null: sent by the system (on completion). */
async function sendAll(me: AppUser | null, row: Row, mails: Mail[], kind: string, note?: string): Promise<Row> {
  const sent: SignEvent[] = [];
  const failed: string[] = [];
  for (const m of mails) {
    try {
      await sendEmail(m.party.email, m.subject, m.text, m.html, undefined, undefined, { replyTo: me?.email ?? undefined, fromName: row.brand ?? undefined });
      sent.push(event(kind, { party: m.party.key, ...(me ? by(me) : { note: "automatically" }), ...(note ? { note } : {}) }));
    } catch (err) {
      console.error(`sign: ${kind} email to party ${m.party.key} failed`, err instanceof Error ? err.message : err);
      failed.push(m.party.name || m.party.role);
    }
  }
  let next = row;
  if (sent.length)
    next = await update(
      () => rowById(row.id),
      (r) => ({ events: [...r.events, ...sent], ...(kind === "copy_sent" ? { copy_sent_at: new Date().toISOString() } : {}) }),
    ).catch(() => row);
  if (failed.length) throw new Refuse(502, "email_failed", `Saved, but the email to ${failed.join(" and ")} didn't go out. Try again.`);
  return next;
}

/** Reads the PDF's pages and fingerprint and makes it the request's document; fields placed before the file (a contract's known signature block) are kept if they fit. */
async function attachPdf(me: AppUser, fresh: () => Promise<Row | null>, path: string, bytes: Uint8Array): Promise<Row> {
  if (bytes.byteLength > MAX_PDF_BYTES) throw new Refuse(413, "too_big", "PDFs up to 25 MB.");
  let pages: Array<{ w: number; h: number }>;
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    // Pages as a viewer shows them (turned, cropped): that's where fields are placed.
    pages = doc.getPages().map((p) => {
      const s = shownSize(pageFrame(p));
      return { w: Math.round(s.w * 100) / 100, h: Math.round(s.h * 100) / 100 };
    });
  } catch {
    throw new Refuse(400, "not_a_pdf", "That file isn't a PDF we can read.");
  }
  if (!pages.length) throw new Refuse(400, "not_a_pdf", "That PDF has no pages.");
  const original_sha256 = sha256Hex(bytes);
  return update(fresh, (r) => {
    if (r.status !== "draft") throw new Refuse(409, "already_sent", "The document can't change once it has been sent.");
    const fields = r.fields.map((f) => cleanField(f, pages.length)).filter((f): f is NonNullable<typeof f> => !!f);
    return {
      original_path: path,
      current_path: path,
      original_sha256,
      pages,
      fields,
      events: [...r.events, event("attached", { ...by(me), note: `${pages.length} page${pages.length === 1 ? "" : "s"}` })],
    };
  });
}

/** The public-URL form older document records carry (never fetched as given: readers go by storagePath). */
function storedUrl(path: string): string {
  const base = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  return base ? `${base}/storage/v1/object/public/${DOCUMENTS_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}` : "";
}

/**
 * Files the signed copy with the entity's documents (once): a copy of the
 * signed PDF under assets/<id>/, a document entry that names the request, and
 * an event. The entity's activity records the upload. Returns the row as it
 * now stands; throws only when asked by the office (a retry), else logs.
 */
async function fileSignedCopy(row: Row, me: AppUser | null): Promise<Row> {
  if (!row.asset_id || !row.signed_path || row.filed_path || row.status !== "completed") return row;
  const bytes = await storageDownload(row.signed_path, SIGN_BUCKET);
  if (!bytes) throw new Refuse(404, "no_file", "The signed copy isn't in storage.");
  const path = filedPath(row.asset_id, row.title, row.id);
  await storageUpload(path, bytes, "application/pdf", DOCUMENTS_BUCKET);
  const record = {
    name: `${row.title} (signed)`,
    url: storedUrl(path),
    storagePath: path,
    storageProvider: "supabase",
    size: bytes.byteLength,
    contentType: "application/pdf",
    createdAt: Date.now(),
    signatureRequestId: row.id,
    signedAt: row.completed_at,
    ...(row.signed_sha256 ? { sha256: row.signed_sha256 } : {}),
  };
  await applyOps([{ op: "set", path: ["assets", row.asset_id, "documents", `signed-${row.id}`], value: record }], actorOf(me));
  const next = await update(
    () => rowById(row.id),
    (r) => ({ filed_path: path, events: [...r.events, event("filed", { ...(me ? by(me) : {}), note: "with the entity's documents" })] }),
  );
  await audit({ actor: me ?? "system", action: "signature.file", target: { type: "signature_request", id: row.id, label: row.title }, summary: `Filed the signed copy of ${row.title} with the entity's documents`, detail: { assetId: row.asset_id, path } });
  return next;
}

/**
 * Emails every party a link to the signed copy. A party whose own link is in
 * hand (`keep`: the signer who just finished) keeps it; the others get a fresh
 * one (theirs from the request email stops working).
 */
async function sendSignedCopy(me: AppUser | null, load: () => Promise<Row | null>, keep?: { key: PartyKey; token: string }): Promise<Row> {
  let links: Array<[Party, string]> = [];
  const saved = await update(load, (r) => {
    if (r.status !== "completed" || !r.signed_path) throw new Refuse(409, "not_completed", "The copy goes out once everyone has signed.");
    links = [];
    const expiresAt = linkExpiry();
    const parties = r.parties.map((p) => {
      if (keep && p.key === keep.key) {
        const next: Party = { ...p, expiresAt };
        links.push([next, signLink(keep.token)]);
        return next;
      }
      const t = newToken();
      const next: Party = { ...p, tokenHash: hashToken(t), expiresAt };
      links.push([next, signLink(t)]);
      return next;
    });
    return { parties };
  });
  return sendAll(
    me,
    saved,
    links.map(([party, link]) => ({ party, ...signedCopyEmail(saved, party, link) })),
    "copy_sent",
  );
}

/** Two names that agree on their first and last words ("Alex Rivera" and "Alex J. Rivera"). */
export function sameName(a: string, b: string): boolean {
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z\s'-]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
  const x = words(a);
  const y = words(b);
  return !!x.length && !!y.length && x[0] === y[0] && x[x.length - 1] === y[y.length - 1];
}

/** A party's link going to whoever presses Send, when that person isn't the party: refused, so nobody can sign for someone else. */
export function senderIsntParty(row: Pick<Row, "parties">, me: Pick<AppUser, "email" | "name">): string | null {
  const mine = me.email?.trim().toLowerCase();
  if (!mine) return null;
  for (const p of row.parties) {
    if (p.email.trim().toLowerCase() !== mine) continue;
    if (!sameName(p.name, me.name ?? "")) return `${p.name}'s email is your own address. Use ${p.name}'s address, so only they can sign.`;
  }
  return null;
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
      if (id) return await officeOne(req, res, id);
      return await officeList(req, res);
    }

    const action = String(body.action ?? "");
    if (action === "create") {
      const title =
        String(body.title ?? "")
          .trim()
          .slice(0, 160) || "Untitled document";
      const assetId = typeof body.assetId === "string" && /^[\w-]{1,80}$/.test(body.assetId) ? body.assetId : null;
      const contractId = typeof body.contractId === "string" && /^[\w-]{1,80}$/.test(body.contractId) ? body.contractId : null;
      const brand = typeof body.brand === "string" && body.brand.trim() ? body.brand.trim().slice(0, 120) : null;
      const mode = cleanMode(body.mode);
      if (mode !== "normal" && !(await gameAllowed({ asset_id: assetId }))) return fail(res, 409, "game_not_for_entity", GAME_ONLY_MESSAGE);
      const parties = partiesFrom(body.parties, []);
      const [row] = await sb<Row[]>("signature_requests", {
        method: "POST",
        prefer: "return=representation",
        body: { title, source: contractId ? "contract" : "upload", asset_id: assetId, contract_id: contractId, brand, mode, created_by: me.id, created_by_name: me.name, parties, events: [event("created", by(me))] },
      });
      return res.status(200).json({ request: toView(row) });
    }

    const id = String(body.id ?? "");
    const row = await rowById(id);
    if (!row) return fail(res, 404, "not_found");
    const fresh = () => rowById(row.id);
    const label = { type: "signature_request", id: row.id, label: row.title };

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
        return res.status(200).json({ request: toView(await attachPdf(me, fresh, path, bytes)) });
      }
      case "attach-stored": {
        // A file already in an entity's documents: copied under the request, so the record's own copy never changes.
        const from = String(body.path ?? "");
        if (!isDocumentPath(from)) return fail(res, 400, "bad_path");
        if (row.status !== "draft") return fail(res, 409, "already_sent", "The document can't change once it has been sent.");
        const bytes = await storageDownload(from, DOCUMENTS_BUCKET);
        if (!bytes) return fail(res, 404, "no_file", "That file isn't in storage.");
        if (bytes.byteLength > MAX_PDF_BYTES) return fail(res, 413, "too_big", "PDFs up to 25 MB.");
        const path = versionPath(row.id, "upload");
        await storageUpload(path, bytes, "application/pdf", SIGN_BUCKET);
        return res.status(200).json({ request: toView(await attachPdf(me, fresh, path, bytes)) });
      }
      case "update": {
        const next = await update(fresh, async (r) => {
          const changes: Partial<Row> = {};
          const draft = r.status === "draft";
          // Once it has gone out, what was sent is the record: nothing changes it without an event.
          const lockedOut = (what: string) => new Refuse(409, "locked", `${what} can't change once it has been sent. Void it and send a new request instead.`);
          if (typeof body.title === "string") {
            const title = body.title.trim().slice(0, 160) || r.title;
            if (title !== r.title) {
              if (!draft) throw lockedOut("The title");
              changes.title = title;
            }
          }
          if (Array.isArray(body.fields)) {
            const fields = body.fields.map((f) => cleanField(f, Math.max(1, r.pages.length))).filter((f): f is NonNullable<typeof f> => !!f);
            if (JSON.stringify(fields) !== JSON.stringify(r.fields)) {
              if (!draft) throw lockedOut("The fields");
              changes.fields = fields;
            }
          }
          if (Array.isArray(body.parties)) {
            const parties = partiesFrom(body.parties, r.parties);
            const shape = (ps: Party[]) => JSON.stringify(ps.map((p) => [p.key, p.role, p.name, p.email, p.entity ?? "", p.title ?? ""]));
            if (shape(parties) !== shape(r.parties)) {
              if (!draft) throw lockedOut("The parties");
              changes.parties = parties;
            }
          }
          // The mode shapes the email that goes out, so it's settled before Send.
          if (typeof body.mode === "string" && cleanMode(body.mode) !== (r.mode ?? "normal")) {
            if (!draft) throw lockedOut("How they sign");
            if (cleanMode(body.mode) !== "normal" && !(await gameAllowed(r))) throw new Refuse(409, "game_not_for_entity", GAME_ONLY_MESSAGE);
            changes.mode = cleanMode(body.mode);
          }
          return changes;
        });
        return res.status(200).json({ request: toView(next) });
      }
      case "send": {
        const next = await sendNow(me, fresh, body.plain === true);
        await audit({ actor: me, action: "signature.send", target: label, summary: `Sent ${row.title} for signature`, detail: { parties: next.parties.length, mode: next.mode } });
        await entityLog(row, me, `Sent “${row.title}” for signature`);
        return res.status(200).json({ request: toView(next) });
      }
      case "resend":
        return res.status(200).json({ request: toView(await resend(me, row, body)) });
      case "remind": {
        const only = body.party === "a" || body.party === "b" ? (body.party as PartyKey) : null;
        // The office can keep the game a surprise: the email reads as a normal request, the link still opens it.
        const plain = body.plain === true;
        let links: Array<[Party, string]> = [];
        const saved = await update(fresh, (r) => {
          if (r.status !== "sent" && r.status !== "partial") throw new Refuse(409, "not_pending");
          links = [];
          // A fresh link each time: the old one stops working, and the new one runs for another LINK_DAYS.
          const parties = r.parties.map((p) => {
            if (p.status === "signed" || p.status === "declined" || (only && p.key !== only)) return p;
            const t = newToken();
            const sent: Party = { ...p, tokenHash: hashToken(t), sentAt: new Date().toISOString(), expiresAt: linkExpiry() };
            links.push([sent, signLink(t)]);
            return sent;
          });
          return { parties };
        });
        // A game-mode row of any other entity (from before the rule) is reminded about the plain page its signer gets.
        const asNormal = isGameMode(saved.mode) && (plain || !(await gameAllowed(saved)));
        const mailRow = asNormal ? { ...saved, mode: "normal" as const } : saved;
        const next = await sendAll(
          me,
          saved,
          links.map(([party, link]) => ({ party, ...signRequestEmail(mailRow, party, link, true) })),
          "reminded",
          plain && isGameMode(saved.mode) ? "as a normal request" : undefined,
        );
        return res.status(200).json({ request: toView(next) });
      }
      case "send-copy": {
        const next = await sendSignedCopy(me, fresh);
        await audit({ actor: me, action: "signature.send_copy", target: label, summary: `Emailed the signed copy of ${row.title} to every party` });
        return res.status(200).json({ request: toView(next) });
      }
      case "void": {
        const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
        if (!reason) return fail(res, 400, "reason", "Say why it's being voided; the reason is kept with the request.");
        const notify = body.notify === true;
        const next = await update(fresh, (r) => {
          if (r.status === "completed") throw new Refuse(409, "completed", "A signed document can't be voided. Archive it, or send a new version to replace it.");
          if (r.status === "voided") throw new Refuse(409, "voided", "It's already void.");
          if (r.status === "draft") throw new Refuse(409, "draft", "A draft hasn't gone out; delete it instead.");
          // The links stay known (not usable) so a signer who opens one is told it was withdrawn.
          return { status: "voided", events: [...r.events, event("voided", { ...by(me), note: reason })] };
        });
        let out = next;
        if (notify) {
          const signedBefore = new Set(row.parties.filter((p) => p.status === "signed").map((p) => p.key));
          out = await sendAll(
            me,
            next,
            next.parties.filter((p) => p.email && p.status !== "declined").map((party) => ({ party, ...withdrawnEmail(next, party, signedBefore.has(party.key)) })),
            "withdrawn_sent",
          ).catch((err) => {
            if (err instanceof Refuse) throw err;
            return next;
          });
        }
        const signedBy = row.parties.filter((p) => p.status === "signed").map((p) => p.name);
        await audit({ actor: me, action: "signature.void", target: label, summary: `Voided ${row.title}`, detail: { reason, notified: notify, discardedSignatures: signedBy.length } });
        await entityLog(row, me, `Voided the signature request for “${row.title}”`, { reason });
        return res.status(200).json({ request: toView(out) });
      }
      case "archive": {
        if (!isAdmin(me)) return fail(res, 403, "forbidden", "Only an owner or admin can archive a signature request.");
        const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
        if (!reason) return fail(res, 400, "reason", "Say why it's being archived; the reason is kept with the request.");
        const why = archiveBlocker(row);
        if (why) return fail(res, 409, "not_archivable", why);
        const next = await update(fresh, (r) => {
          const now = archiveBlocker(r);
          if (now) throw new Refuse(409, "not_archivable", now);
          return { archived_at: new Date().toISOString(), archived_by: me.id, archived_by_name: me.name ?? null, archived_reason: reason, events: [...r.events, event("archived", { ...by(me), note: reason })] };
        });
        if (!next.archived_at) return fail(res, 503, "not_ready", "Archiving needs a database update that hasn't been applied yet. Nothing was changed.");
        await audit({ actor: me, action: "signature.archive", target: label, summary: `Archived ${row.title}`, detail: { reason, status: row.status } });
        await entityLog(row, me, `Archived the signature request for “${row.title}”`, { reason });
        return res.status(200).json({ request: toView(next) });
      }
      case "unarchive": {
        if (!isAdmin(me)) return fail(res, 403, "forbidden", "Only an owner or admin can restore a signature request.");
        if (!row.archived_at) return res.status(200).json({ request: toView(row) });
        const next = await update(fresh, (r) => ({ archived_at: null, archived_by: null, archived_by_name: null, archived_reason: null, events: [...r.events, event("unarchived", by(me))] }));
        await audit({ actor: me, action: "signature.unarchive", target: label, summary: `Restored ${row.title} from the archive` });
        return res.status(200).json({ request: toView(next) });
      }
      case "delete": {
        // Only a draft that never went out: anything sent is a record, archived, never destroyed.
        const why = deleteBlocker(row);
        if (why) return fail(res, 409, "kept", why);
        await sb(`signature_requests?id=eq.${row.id}&status=eq.draft&sent_at=is.null`, { method: "DELETE" });
        // Its files go with it: the uploads under signatures/<id>/ that the row names.
        const paths = [...new Set([row.original_path, row.current_path].filter((p): p is string => !!p && p.startsWith(`signatures/${row.id}/`)))];
        for (const p of paths) await storageRemove(p, SIGN_BUCKET).catch((err) => console.error("sign: couldn't remove a draft's file", err instanceof Error ? err.message : err));
        await audit({ actor: me, action: "signature.delete", target: label, summary: `Deleted the unsent draft ${row.title}`, detail: { files: paths.length } });
        return res.status(200).json({ ok: true });
      }
      case "file": {
        if (!row.asset_id) return fail(res, 409, "no_entity", "This request isn't tied to an entity.");
        if (row.status !== "completed") return fail(res, 409, "not_completed", "It's filed once everyone has signed.");
        return res.status(200).json({ request: toView(await fileSignedCopy(row, me)) });
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

/** Every request that isn't archived (or, with ?archived=1, only those), newest first, and the names of their entities. */
async function officeList(req: VercelRequest, res: VercelResponse) {
  const archived = req.query.archived === "1";
  let rows: Row[];
  try {
    rows = await fetchAll<Row>(`signature_requests?select=*&archived_at=${archived ? "not.is.null" : "is.null"}&order=created_at.desc,id.desc`);
  } catch (err) {
    // Before the migration there is no archive: everything is in the list.
    if (!isMissingColumn(err)) throw err;
    rows = archived ? [] : await fetchAll<Row>("signature_requests?select=*&order=created_at.desc,id.desc");
  }
  const ids = [...new Set(rows.map((r) => r.asset_id).filter((v): v is string => !!v))];
  const entityNames: Record<string, string> = {};
  if (ids.length) {
    try {
      for (const r of await readRows("assets", ids)) {
        const name = r.data && typeof r.data === "object" && !Array.isArray(r.data) ? r.data.name : undefined;
        if (typeof name === "string" && name.trim()) entityNames[r.id] = name.trim();
      }
    } catch (err) {
      console.error("sign: couldn't read entity names for the list", err instanceof Error ? err.message : err);
    }
  }
  return res.status(200).json({ requests: rows.map(toView), entityNames });
}

/** One request for its page, with what the page needs around it. */
async function officeOne(req: VercelRequest, res: VercelResponse, id: string) {
  const row = await rowById(id);
  if (!row) return fail(res, 404, "not_found");
  // A page polling for progress passes the key it already shows; an unchanged PDF isn't re-linked.
  const key = pdfKey(row);
  const same = typeof req.query.have === "string" && req.query.have === key;
  const game = await gameAllowedOrPlain(row);
  // Which parties already have an account (an owner, admin or member keeps full access; inviting them changes nothing).
  const accounts: Partial<Record<PartyKey, string>> = {};
  const people: Record<string, string> = {};
  const related: Array<Pick<Row, "id" | "status" | "created_at" | "sent_at" | "completed_at"> & { archived: boolean }> = [];
  try {
    const emails = [...new Set(row.parties.map((p) => p.email.trim().toLowerCase()).filter(Boolean))];
    const byIds = [...new Set(row.events.map((e) => e.by).filter((v): v is string => !!v && UUID_RE.test(v)))];
    const [users, actors, versions] = await Promise.all([
      emails.length ? sb<Array<{ email: string | null; role: string; status: string }>>(`app_users?email=in.(${emails.map((e) => encodeURIComponent(`"${e}"`)).join(",")})&select=email,role,status`) : [],
      byIds.length ? sb<Array<{ id: string; name: string | null }>>(`app_users?id=in.(${byIds.join(",")})&select=id,name`) : [],
      sb<Row[]>(`signature_requests?title=eq.${encodeURIComponent(row.title)}&asset_id=${row.asset_id ? `eq.${encodeURIComponent(row.asset_id)}` : "is.null"}&id=neq.${row.id}&select=*&order=created_at.desc&limit=20`),
    ]);
    for (const p of row.parties) {
      const u = (users ?? []).find((x) => (x.email ?? "").toLowerCase() === p.email.trim().toLowerCase() && x.status === "approved");
      if (u) accounts[p.key] = u.role;
    }
    for (const a of actors ?? []) if (a.name) people[a.id] = a.name;
    for (const v of versions ?? []) related.push({ id: v.id, status: v.status, created_at: v.created_at, sent_at: v.sent_at, completed_at: v.completed_at, archived: !!v.archived_at });
  } catch (err) {
    console.error("sign: couldn't read the page's surroundings", err instanceof Error ? err.message : err);
  }
  return res.status(200).json({
    request: toView(row),
    pdfKey: key,
    pdfUrl: same ? null : await latestPdfUrl(row),
    // Whether "How they sign" may offer the game: only a draft, and only TallulahMD LLC's.
    gameAllowed: row.status === "draft" && game,
    // Whether this entity may have a game at all (the resend dialog offers one).
    gameEntity: game,
    entityName: await entityName(row.asset_id),
    accounts,
    people,
    related,
  });
}

/**
 * Sends a request: fresh links are saved first, then each party is emailed.
 * `plain` writes a game's email as a normal request (nothing about the game).
 */
async function sendNow(me: AppUser, load: () => Promise<Row | null>, plain = false): Promise<Row> {
  let links: Array<[Party, string]> = [];
  const saved = await update(load, async (r) => {
    if (r.status === "voided") throw new Refuse(409, "voided");
    if (r.status !== "draft") throw new Refuse(409, "already_sent", "It has already been sent. Use Remind.");
    if (isGameMode(r.mode) && !(await gameAllowed(r))) throw new Refuse(409, "game_not_for_entity", `${GAME_ONLY_MESSAGE} Switch it to Normal e-signature.`);
    const why = sendBlocker(r) ?? senderIsntParty(r, me);
    if (why) throw new Refuse(400, "not_ready", why);
    // The original's fingerprint, for a draft attached before fingerprints were kept.
    let original_sha256 = r.original_sha256 ?? null;
    if (!original_sha256 && r.original_path) {
      const bytes = await storageDownload(r.original_path, SIGN_BUCKET);
      if (bytes) original_sha256 = sha256Hex(bytes);
    }
    links = [];
    const now = new Date();
    const parties = r.parties.map((p) => {
      if (p.status === "signed") return p;
      const t = newToken();
      const sent: Party = { ...p, tokenHash: hashToken(t), status: "sent", sentAt: now.toISOString(), expiresAt: linkExpiry(now) };
      links.push([sent, signLink(t)]);
      return sent;
    });
    return {
      parties,
      status: deriveStatus(parties, "sent"),
      sent_at: r.sent_at ?? now.toISOString(),
      ...(original_sha256 ? { original_sha256 } : {}),
      events: [...r.events, event("sent", { ...by(me), ...(isGameMode(r.mode) ? { note: MODE_WORDS[r.mode] } : {}) })],
    };
  });
  const asNormal = plain && isGameMode(saved.mode);
  const mailRow = asNormal ? { ...saved, mode: "normal" as const } : saved;
  return sendAll(
    me,
    saved,
    links.map(([party, link]) => ({ party, ...signRequestEmail(mailRow, party, link) })),
    "emailed",
    asNormal ? "as a normal request" : undefined,
  );
}

/**
 * A request sent again as a new one: the same document and parties, in the
 * given mode, with Address boxes under the signatures of the parties named in
 * `address`. The two records point at each other (replaces / replaced_by). A
 * pending original is voided, so only the new links work; a completed one
 * stays on file as it is, and needs a reason.
 */
async function resend(me: AppUser, row: Row, body: Body): Promise<Row> {
  if (row.status === "draft") throw new Refuse(409, "not_sent", "This one hasn't been sent yet: send it instead.");
  if (!row.original_path) throw new Refuse(409, "no_file", "The original document isn't on the request.");
  const mode = cleanMode(body.mode);
  if (mode !== "normal" && !(await gameAllowed(row))) throw new Refuse(409, "game_not_for_entity", GAME_ONLY_MESSAGE);
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (row.status === "completed" && !reason) throw new Refuse(400, "reason", "Say why a signed agreement is going out again; the reason is kept with both requests.");
  const address = Array.isArray(body.address) ? body.address.filter((k): k is PartyKey => k === "a" || k === "b") : [];
  const bytes = await storageDownload(row.original_path, SIGN_BUCKET);
  if (!bytes) throw new Refuse(404, "no_file", "The original document isn't in storage.");
  const parties: Party[] = row.parties.map((p) => ({
    key: p.key,
    role: p.role,
    name: p.name,
    email: p.email,
    ...(p.entity ? { entity: p.entity } : {}),
    ...(p.title ? { title: p.title } : {}),
    status: "pending",
  }));
  const [made] = await sb<Row[]>("signature_requests", {
    method: "POST",
    prefer: "return=representation",
    body: {
      title: row.title,
      source: row.source,
      asset_id: row.asset_id,
      contract_id: row.contract_id,
      brand: row.brand,
      mode,
      created_by: me.id,
      created_by_name: me.name,
      parties,
      pages: row.pages,
      fields: withAddressFields(row.fields, address),
      events: [event("created", { ...by(me), note: `sent again from an earlier request${reason ? `: ${reason}` : ""}` })],
    },
  });
  const path = versionPath(made.id, "upload");
  await storageUpload(path, bytes, "application/pdf", SIGN_BUCKET);
  await writeIfUnchanged(made, { original_path: path, current_path: path, original_sha256: sha256Hex(bytes), replaces: row.id }).then(async (w) => w ?? (await rowById(made.id)));
  // The old record says where it went; a pending one is voided, so only the new links work.
  await update(
    () => rowById(row.id),
    (r) => {
      const note = event("resent", { ...by(me), note: `as a new request${mode === "normal" ? "" : ` (${MODE_WORDS[mode]})`}${reason ? `: ${reason}` : ""}` });
      const pending = r.status === "sent" || r.status === "partial";
      return pending
        ? { status: "voided", replaced_by: made.id, events: [...r.events, note, event("voided", { ...by(me), note: "replaced by the new request" })] }
        : { replaced_by: made.id, events: [...r.events, note] };
    },
  ).catch((err) => console.error("sign: couldn't note the resend on the old request", err instanceof Error ? err.message : err));
  const next = await sendNow(me, () => rowById(made.id), body.plain === true);
  await audit({
    actor: me,
    action: "signature.resend",
    target: { type: "signature_request", id: row.id, label: row.title },
    summary: `Sent ${row.title} again as a new request`,
    detail: { newId: made.id, mode, reason: reason || null, wasStatus: row.status },
  });
  await entityLog(row, me, `Sent “${row.title}” again as a new request`, reason ? { reason } : undefined);
  return next;
}

/** The fields again, plus an Address box under the first signature of each named party that has none. */
export function withAddressFields(fields: SignField[], parties: PartyKey[] = ["a", "b"]): SignField[] {
  const out = [...fields];
  for (const key of parties) {
    if (out.some((f) => f.party === key && f.type === "address")) continue;
    const sig = out.find((f) => f.party === key && f.type === "signature");
    if (!sig) continue;
    const h = 0.05;
    out.push({ id: randomBytes(6).toString("hex"), party: key, type: "address", page: sig.page, x: sig.x, y: Math.min(1 - h, sig.y + sig.h + 0.004), w: sig.w, h });
  }
  return out;
}

function partiesFrom(raw: unknown, prior: Party[]): Party[] {
  const list = Array.isArray(raw) ? raw.slice(0, 2) : [];
  const out: Party[] = [];
  (["a", "b"] as PartyKey[]).forEach((key, i) => {
    const p = cleanParty(
      list[i],
      key,
      prior.find((x) => x.key === key),
    );
    if (p && (p.name || p.email || list[i])) out.push(p);
  });
  return out;
}

// ── The signer's side ─────────────────────────────────────────────────────

async function signer(req: VercelRequest, res: VercelResponse, token: string, body: Body) {
  const hash = hashToken(token);
  // A withdrawn request is still found, so its signer is told; nothing can be done on it.
  const find = async () => {
    const r = await rowByToken(token);
    return r && r.parties.some((p) => p.tokenHash === hash) ? r : null;
  };
  const load = async () => {
    const r = await find();
    return r && r.status !== "voided" ? r : null;
  };
  const row = await find();
  if (!row) return fail(res, 404, "not_found", "This signing link isn't valid any more.");
  const youIn = (r: Row) => r.parties.find((p) => p.tokenHash === hash)!;
  const you = youIn(row);
  const sender = row.brand || row.created_by_name || "the sender";

  if (row.status === "voided") {
    if (req.method !== "GET") return fail(res, 409, "voided", "This request was withdrawn. Nothing more is needed from you.");
    const voided = [...row.events].reverse().find((e) => e.kind === "voided");
    return res.status(200).json({ title: row.title, brand: row.brand, status: "voided", voidedAt: voided?.at ?? null, replaced: !!row.replaced_by, sentBy: row.created_by_name, you: { key: you.key, name: you.name, status: you.status } });
  }
  if (linkExpired(you)) return fail(res, 410, "expired", `This link has expired. Ask ${sender} to send a new one.`);

  if (req.method === "GET") {
    const completed = row.status === "completed";
    const key = pdfKey(row);
    const same = typeof req.query.have === "string" && req.query.have === key;
    return res.status(200).json({
      brand: row.brand,
      // The game is only for TallulahMD LLC's signers; anyone else gets the plain page whatever the row says.
      mode: isGameMode(row.mode) && (await gameAllowedOrPlain(row)) ? row.mode : "normal",
      pdfKey: key,
      title: row.title,
      status: row.status,
      completed,
      completedAt: row.completed_at,
      you: { key: you.key, role: you.role, name: you.name, email: you.email, status: you.status, entity: you.entity ?? null, title: you.title ?? null, signedAt: you.signedAt ?? null },
      parties: row.parties.map((p) => ({ key: p.key, role: p.role, name: p.name, status: p.status })),
      fields: row.fields,
      pages: row.pages,
      pdfUrl: same ? null : await latestPdfUrl(row, completed ? fileName(row) : undefined),
      // The same PDF as a download, named after the document.
      downloadUrl: same ? null : await latestPdfUrl(row, fileName(row)),
      sentBy: row.created_by_name,
      // The original's fingerprint (the "document ID" the signer sees) and the signed copy's.
      documentId: row.original_sha256 ?? null,
      signedSha: completed ? (row.signed_sha256 ?? null) : null,
      expiresAt: you.expiresAt ?? null,
      disclosureVersion: ESIGN_DISCLOSURE_VERSION,
    });
  }

  const action = String(body.action ?? "");
  const ip = clientIp(req.headers ?? {}) ?? undefined;
  const device = deviceOf(req);

  if (action === "opened") {
    // Counted when the page has drawn the document, not when a mail scanner fetches the link. Best effort.
    if (!you.viewedAt && you.status !== "signed") {
      const viewedAt = new Date().toISOString();
      await writeIfUnchanged(row, {
        parties: row.parties.map((p) => (p.key === you.key ? { ...p, status: p.status === "sent" ? "viewed" : p.status, viewedAt, viewIp: ip, viewDevice: device } : p)),
        events: [...row.events, event("viewed", { party: you.key, ip, device })],
      }).catch(() => null);
    }
    return res.status(200).json({ ok: true });
  }

  if (action === "decline") {
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    const at = new Date().toISOString();
    await update(load, (r) => {
      const p0 = youIn(r);
      if (p0.status === "signed") throw new Refuse(409, "already_signed", "You've already signed this.");
      if (r.status === "completed" || r.status === "declined") throw new Refuse(409, "closed", "This request is already closed.");
      const parties = r.parties.map((p) => (p.key === p0.key ? { ...p, status: "declined" as const, declinedAt: at, declinedReason: reason || undefined, declineIp: ip, declineDevice: device } : p));
      return { parties, status: deriveStatus(parties, r.status), events: [...r.events, event("declined", { party: p0.key, note: reason || undefined, ip, device })] };
    });
    // The push stays short (it shows on lock screens); the reason goes by email and lives in the app.
    void notifyAdmins({ aps: { alert: { title: "Signature declined", body: `${you.name} declined ${row.title}` }, sound: "default" }, url: `/tools/signatures/${row.id}` }, `sign-${row.id}`);
    await emailOffice(declinedNoticeEmail(row, you.name, reason));
    await sendEmail(you.email, ...receipt(declineReceiptEmail(row, you, at)), undefined, undefined, { fromName: row.brand ?? undefined }).catch((err) =>
      console.error("sign: the decline receipt didn't go out", err instanceof Error ? err.message : err),
    );
    await audit({ actor: null, action: "signature.decline", target: { type: "signature_request", id: row.id, label: row.title }, summary: `${you.name} declined ${row.title}`, detail: { party: you.key } });
    await entityLog(row, null, `${you.name} declined to sign “${row.title}”`);
    return res.status(200).json({ ok: true });
  }

  if (action !== "sign") return fail(res, 400, "unknown_action");
  const problem = consentProblem(body.consent, body.consentVersion);
  if (problem === "consent") return fail(res, 400, "consent", "Agree to use electronic records and signatures first.");
  if (problem === "consent_version") return fail(res, 400, "consent_version", "This page changed since you opened it. Reload it and sign again.");
  const consentVersion = String(body.consentVersion);
  const name = String(body.name ?? "")
    .trim()
    .slice(0, 120);
  if (!name) return fail(res, 400, "name", "Type your full legal name.");
  const png = pngFromDataUrl(body.signature);
  if (!png) return fail(res, 400, "signature", "Draw or type your signature.");
  const address = String(body.address ?? "")
    .replace(/\r/g, "")
    .trim()
    .slice(0, 240);
  if (!address && row.fields.some((f) => f.party === you.key && f.type === "address")) return fail(res, 400, "address", "Type your address.");
  const method = body.method === "typed" ? "typed" : body.method === "drawn" ? "drawn" : undefined;
  const via = body.via === "game" ? "game" : "page";
  const timeZone = cleanTimeZone(body.timeZone);
  const initials = name
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  // Stamp the latest copy into a new file, then claim the row at the version that copy came from.
  // If another signature landed first, drop this attempt's files and stamp the newer copy instead.
  let done: Row | null = null;
  for (let i = 0; i < TRIES && !done; i++) {
    const r = await load();
    if (!r) return fail(res, 404, "not_found", "This signing link isn't valid any more.");
    const p0 = youIn(r);
    if (p0.status === "signed") return fail(res, 409, "already_signed", "You've already signed this.");
    if (r.status === "completed" || r.status === "declined") return fail(res, 409, "closed", "This request is already closed.");
    if (!r.current_path) return fail(res, 409, "no_file");
    const pdf = await storageDownload(r.current_path, SIGN_BUCKET);
    if (!pdf) return fail(res, 500, "no_file", "The document couldn't be read.");

    // Someone signing for a company: the Name box says so ("Northwind Holdings, LLC, by: Alex Rivera, Manager").
    const stampedName = p0.entity ? `${p0.entity}, by: ${name}${p0.title ? `, ${p0.title}` : ""}` : name;
    const stamps: Stamp[] = r.fields
      .filter((f) => f.party === p0.key)
      .map((field) =>
        field.type === "signature"
          ? { field, png }
          : { field, text: field.type === "date" ? officeDate(new Date(), timeZone) : field.type === "initials" ? initials : field.type === "address" ? address : stampedName },
      );
    const stamped = await stampPdf(pdf, stamps);
    const consentAt = new Date().toISOString();
    const signedAt = new Date().toISOString();
    const parties: Party[] = r.parties.map((p) =>
      p.key === p0.key
        ? {
            ...p,
            status: "signed",
            signedAt,
            signedAs: name,
            ip,
            device,
            via,
            ...(method ? { method } : {}),
            ...(timeZone ? { timeZone } : {}),
            ...(address ? { address } : {}),
            consent: { version: consentVersion, at: consentAt, ...(ip ? { ip } : {}), ...(device ? { device } : {}) },
          }
        : p,
    );
    const status = deriveStatus(parties, r.status);
    const events = [
      ...r.events,
      event("consented", { party: p0.key, note: `disclosure of ${consentVersion}`, ip, device }),
      event("signed", { party: p0.key, ip, device, note: [method === "typed" ? "typed" : method === "drawn" ? "drawn" : "", via === "game" ? `after the ${MODE_WORDS[r.mode ?? "normal"]}` : ""].filter(Boolean).join(", ") || undefined }),
    ];
    const changes: Partial<Row> = { parties, status, current_path: "", events };
    let signedPath: string | null = null;
    // Everything that can fail is built before anything is uploaded.
    if (status === "completed") {
      let original_sha256 = r.original_sha256 ?? null;
      if (!original_sha256 && r.original_path) {
        const orig = await storageDownload(r.original_path, SIGN_BUCKET);
        if (orig) original_sha256 = sha256Hex(orig);
      }
      const executed_sha256 = sha256Hex(stamped);
      const final = await appendCertificate(stamped, { ...r, parties, completed_at: signedAt, original_sha256, executed_sha256 });
      signedPath = versionPath(r.id, "signed");
      await storageUpload(signedPath, final, "application/pdf", SIGN_BUCKET);
      Object.assign(changes, { signed_path: signedPath, completed_at: signedAt, original_sha256, executed_sha256, signed_sha256: sha256Hex(final) });
      events.push(event("completed"));
    }
    const currentPath = versionPath(r.id, "current");
    await storageUpload(currentPath, stamped, "application/pdf", SIGN_BUCKET);
    changes.current_path = currentPath;
    done = await writeIfUnchanged(r, changes);
    if (!done) {
      await storageRemove(currentPath, SIGN_BUCKET);
      if (signedPath) await storageRemove(signedPath, SIGN_BUCKET);
    }
  }
  if (!done) return fail(res, 409, "busy", "Someone else signed at the same moment. Try again.");

  const completed = done.status === "completed";
  // The office hears about every signature: a push and an email to each owner and admin.
  void notifyAdmins(
    { aps: { alert: { title: completed ? "Signed by everyone" : "Signature received", body: `${name} signed ${done.title}` }, sound: "default" }, url: `/tools/signatures/${done.id}` },
    `sign-${done.id}`,
  );
  await emailOffice(signedNoticeEmail(done, name, completed));
  if (completed) await afterCompletion(done, { key: you.key, token });
  return res.status(200).json({ ok: true, completed });
}

/**
 * Once everyone has signed: the signed copy goes to every party (as the
 * signer's page promises), is filed with the entity's documents, and the
 * completion is recorded. Each step is logged on failure, never shown to the
 * signer: the office page offers each again.
 */
async function afterCompletion(row: Row, keep: { key: PartyKey; token: string }) {
  const target = { type: "signature_request", id: row.id, label: row.title };
  await audit({ actor: "system", action: "signature.complete", target, summary: `${row.title} was signed by everyone`, detail: { signedSha256: row.signed_sha256 ?? null } });
  await entityLog(row, null, `“${row.title}” was signed by everyone`);
  await fileSignedCopy(row, null).catch((err) => console.error("sign: couldn't file the signed copy with the entity", err instanceof Error ? err.message : err));
  await sendSignedCopy(null, () => rowById(row.id), keep).catch((err) => console.error("sign: the signed copy didn't go out by itself", err instanceof Error ? err.message : err));
}

/** An email's three parts, for sendEmail's arguments. */
const receipt = (m: { subject: string; text: string; html: string }): [string, string, string] => [m.subject, m.text, m.html];

/** Emails every approved owner and admin; a failure is logged, never shown to the signer. */
async function emailOffice(mail: { subject: string; text: string; html: string }) {
  try {
    const admins = await sb<Array<{ email: string | null }>>("app_users?role=in.(owner,admin)&status=eq.approved&select=email");
    for (const a of admins ?? []) {
      if (!a.email) continue;
      await sendEmail(a.email, mail.subject, mail.text, mail.html).catch((err) => console.error("sign: notice email failed", { to: !!a.email, error: err instanceof Error ? err.message : err }));
    }
  } catch (err) {
    console.error("sign: couldn't email the office", err instanceof Error ? err.message : err);
  }
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
