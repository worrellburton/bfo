import { fileKinds, type FileKind } from "./file-kind.js";
import { likeTerm } from "./pg-filter.js";
import { notifyNewMail, type NewMail } from "./push.js";
import { createHash, randomUUID } from "node:crypto";
import { birdPlatformFetch, sb } from "./auth.js";
import { countRows } from "./db-pages.js";
import { isOurAddress, MAIL_DOMAIN, onOurDomain } from "./mail-address.js";
import { composeDocument, composeText } from "./mail-compose.js";
import { storageDownload, storageRemove, storageUpload } from "./storage.js";

/**
 * BFO Mail: everyone's inbox on the family domain, kept in Supabase.
 *
 * Bird receives all mail for the domain (any local part) and keeps it 30 days
 * as "inbound messages" (rem_…). We copy each one into public.mail_messages —
 * one row per mailbox it belongs to — with its attachments in the private
 * "mail" bucket, either when Bird's email.received webhook arrives or on a
 * throttled sync that pages Bird's list. Sending goes through Bird's plain
 * email endpoint from the user's own address, and the sent copy is stored too.
 *
 * Pure pieces (routing, header parsing, snippets, html, limits, row mapping)
 * are exported on their own so they're tested without a network.
 */

// ── Shapes the API returns (mirrored in app/mail-client.ts) ───────────

export type MailAddress = { email: string; name?: string | null };
type MailAttachment = { id: string; filename: string; contentType: string; size: number; available: boolean };
/** "active": inbox and sent together, one row per conversation, latest activity first. */
export type MailFolder = "active" | "inbox" | "sent" | "archive" | "other";
type MailSummary = {
  id: string;
  folder: "inbox" | "sent" | "archive";
  direction: "in" | "out";
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  snippet: string;
  occurredAt: string;
  read: boolean;
  starred: boolean;
  attachmentCount: number;
  /** The distinct kinds among them (pdf, image, sheet…), first-seen order, for the list's icons. */
  attachmentKinds: FileKind[];
  status: string | null;
  /** A catch-all copy (mail for an address nobody has). */
  other: boolean;
  /** The conversation it's in, and when that conversation last had a message (Active pages on these). */
  threadKey?: string;
  threadAt?: string;
  /** Received mail neither SPF nor DKIM vouches for: its From could be forged. */
  unverified?: boolean;
};
/** Narrows a folder's list: everything, only unread, or only starred. */
import type { MailFilter } from "./mail-filter.js";
export type { MailFilter } from "./mail-filter.js";
export { filterOf, filterFlags } from "./mail-filter.js";
type MailMessage = MailSummary & {
  bcc: MailAddress[];
  text: string | null;
  html: string | null;
  attachments: MailAttachment[];
  deliveredTo: string | null;
  messageId: string | null;
  unverifiedSender: boolean;
};

// ── Rows (public.mail_messages) ───────────────────────────────────────

/** An attachment as kept on a row; path is null when Bird no longer had the file. */
export type StoredAttachment = { id: string; filename: string; contentType: string; size: number; path: string | null };

export type MailRow = {
  id: string;
  user_id: string | null;
  dedupe_key: string;
  folder: "inbox" | "sent" | "archive";
  direction: "in" | "out";
  bird_id: string | null;
  message_id: string | null;
  in_reply_to: string | null;
  references_ids: string[] | null;
  from_email: string | null;
  from_name: string | null;
  to_addrs: MailAddress[] | null;
  cc_addrs: MailAddress[] | null;
  bcc_addrs: MailAddress[] | null;
  delivered_to: string | null;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  snippet: string | null;
  attachments: StoredAttachment[] | null;
  spf_pass: boolean | null;
  dkim_pass: boolean | null;
  status: string | null;
  read_at: string | null;
  starred_at: string | null;
  occurred_at: string | null;
  created_at: string;
  /** The conversation (migration 20261023_mail_threads), and the time of its latest message. */
  thread_key?: string | null;
  thread_at?: string | null;
};

/** Columns a list needs — no bodies. */
export const SUMMARY_COLUMNS =
  "id,user_id,folder,direction,from_email,from_name,to_addrs,cc_addrs,subject,snippet,occurred_at,created_at,read_at,starred_at,attachments,status,thread_key,thread_at,spf_pass,dkim_pass";

export type SummaryRow = Pick<
  MailRow,
  | "id" | "user_id" | "folder" | "direction" | "from_email" | "from_name" | "to_addrs" | "cc_addrs"
  | "subject" | "snippet" | "occurred_at" | "created_at" | "read_at" | "starred_at" | "attachments" | "status"
  | "thread_key" | "thread_at" | "spf_pass" | "dkim_pass"
>;

export const BUCKET = "mail";

const LIMITS = {
  recipients: 50,
  subject: 300,
  textBytes: 500 * 1024,
  /** New files from the browser (the request body is capped at ~4.5 MB). */
  attachBytes: 3 * 1024 * 1024,
  /** Everything Bird is handed, forwarded files included. */
  totalAttachBytes: 15 * 1024 * 1024,
  attachments: 20,
  sendsPerDay: 200,
};

const SNIPPET_LEN = 160;
const HEADER_MAX = 998;
const SYNC_THROTTLE_MS = 30_000;
const SYNC_OVERLAP_MS = 10 * 60_000;
const SYNC_FIRST_WINDOW_MS = 30 * 24 * 60 * 60_000;
/** Sync lists Bird a day at a time, halving a day that holds more than this. */
const SYNC_WINDOW_MS = 24 * 60 * 60_000;
const SYNC_WINDOW_MAX = 100;
const SYNC_MIN_WINDOW_MS = 1000;
const SEND_WINDOW_MS = 24 * 60 * 60_000;
/** An inbound From on our domain counts as ours only with a sent copy this close. */
const OWN_SENT_BEFORE_MS = 15 * 60_000;
const OWN_SENT_SKEW_MS = 5 * 60_000;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BIRD_ID_RE = /^[\w-]{1,200}$/;

const enc = encodeURIComponent;

// ── Addresses ─────────────────────────────────────────────────────────

const EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** One plain address, lowercase. */
function isValidEmail(address: string): boolean {
  return address.length <= 254 && EMAIL_RE.test(address) && !/^\.|\.\.|\.@/.test(address);
}

/** "Jane <jane@x.com>" or "jane@x.com" → "jane@x.com", or null. */
function parseAddress(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let value = input.trim();
  const angle = /<([^<>]*)>\s*$/.exec(value);
  if (angle) value = angle[1].trim();
  value = value.toLowerCase();
  return isValidEmail(value) ? value : null;
}

const UNSTORABLE = /\u0000|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** Text Postgres will accept: no NULs, no lone surrogates. */
export const storable = (s: string) => s.replace(UNSTORABLE, "");

const storableOrNull = (s: string | null | undefined) => (s == null ? null : storable(s));

const cleanAddrs = (list: unknown): MailAddress[] =>
  Array.isArray(list)
    ? list
        .filter((a): a is { email: string; name?: unknown } => !!a && typeof a.email === "string" && !!a.email)
        .map((a) => (typeof a.name === "string" && a.name ? { email: storable(a.email), name: storable(a.name) } : { email: storable(a.email) }))
    : [];

// ── Routing ───────────────────────────────────────────────────────────

/** To + Cc addresses on our domain, lowercase, once each. */
export function ourRecipients(msg: { to?: { email?: string }[] | null; cc?: { email?: string }[] | null }): string[] {
  const out: string[] = [];
  for (const a of [...(msg.to ?? []), ...(msg.cc ?? [])]) {
    const email = typeof a?.email === "string" ? a.email.trim().toLowerCase() : "";
    if (email && isOurAddress(email) && isValidEmail(email) && !out.includes(email)) out.push(email);
  }
  return out;
}

/** A raw message's header block, folded lines joined. */
function headerBlock(raw: string): string {
  const end = raw.search(/\r?\n\r?\n/);
  return (end < 0 ? raw : raw.slice(0, end)).replace(/\r?\n[ \t]+/g, " ");
}

/**
 * The envelope recipients mail servers leave in the headers — Delivered-To,
 * X-Original-To, then "for <x@…>" in Received — that are on our domain. Used
 * when To/Cc name nobody here (Bcc, mailing lists).
 */
export function rawHeaderRecipients(raw: string): string[] {
  const found: Record<"delivered-to" | "x-original-to" | "received", string[]> = { "delivered-to": [], "x-original-to": [], received: [] };
  for (const line of headerBlock(raw).split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1);
    if (name === "delivered-to" || name === "x-original-to") {
      for (const m of value.matchAll(/([^\s<>,;"]+@[^\s<>,;"]+)/g)) found[name].push(m[1]);
    } else if (name === "received") {
      for (const m of value.matchAll(/\bfor\s+<?([^\s<>,;"]+@[^\s<>,;"]+)/gi)) found.received.push(m[1]);
    }
  }
  const out: string[] = [];
  for (const a of [...found["delivered-to"], ...found["x-original-to"], ...found.received]) {
    const email = a.toLowerCase();
    if (isOurAddress(email) && isValidEmail(email) && !out.includes(email)) out.push(email);
  }
  return out;
}

// ── Bodies ────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntity(match: string, entity: string): string {
  if (entity[0] === "#") {
    const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code > 0 && code < 0x110000 && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match;
  }
  return ENTITIES[entity.toLowerCase()] ?? match;
}

/** Readable text from an HTML body (for snippets). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|tr|li|h[1-6]|blockquote|table)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity);
}

/** Where a reply's quoted original starts: "On … wrote:", Outlook's separator, or a forward header. */
const QUOTE_HEADER_RE = /(?:^|\n)[ \t]*(?:On [^\n]{0,300}?(?:\n[^\n]{0,200}?)?wrote:[ \t]*(?:\n|$)|-{3,}[ \t]*Original Message[ \t]*-{3,}|-{3,}[ \t]*Forwarded message[ \t]*-{3,}|From:[ \t][^\n]*\nSent:[ \t])/i;

/** The message's own words: quoted lines and everything from the quote header on are dropped. */
export function withoutQuotes(text: string): string {
  const norm = text.replace(/\r\n?/g, "\n");
  const head = QUOTE_HEADER_RE.exec(norm);
  const own = head ? norm.slice(0, head.index) : norm;
  return own
    .split("\n")
    .filter((l) => !l.startsWith(">"))
    .join("\n");
}

/** HTML with its quoted replies (<blockquote>, Gmail's quote block) taken out. */
function htmlWithoutQuotes(html: string): string {
  let out = html;
  // Innermost first, so nested quotes come out whole.
  for (let i = 0; i < 20; i++) {
    const next = out.replace(/<blockquote\b(?:(?!<blockquote\b)[\s\S])*?<\/blockquote\s*>/gi, " ");
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Lines a help desk wraps around a reply, which say nothing about it: Zendesk's "type above this line", rules, footers, ticket codes. */
const BOILERPLATE_LINE = [
  /^#+-.*-#+$/, // ##- Please type your reply above this line -##
  /^please type your reply above this line/i,
  /^[-_=*]{4,}$/,
  /^this (email|message) is a service from/i,
  /^delivered by zendesk/i,
  /^\[[A-Z0-9]{3,}(-[A-Z0-9]{3,})+\]$/, // [209REE-6G6XY]
  /^(sent from my (iphone|ipad|android|galaxy|phone)|get outlook for (ios|android))\b/i,
];

/** Text without the lines a support desk wraps around it. Exported for tests. */
function withoutBoilerplate(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => !BOILERPLATE_LINE.some((re) => re.test(l.trim())))
    .join("\n");
}

/** The first ~160 characters of a message's own words, on one line. */
export function snippetOf(text: string | null | undefined, html?: string | null, max = SNIPPET_LEN): string {
  const full = withoutBoilerplate(text?.trim() ? text : html ? htmlToText(html) : "");
  const own = withoutBoilerplate(text?.trim() ? withoutQuotes(text) : html ? withoutQuotes(htmlToText(htmlWithoutQuotes(html))) : "");
  // A reply that says nothing new: show the quote rather than nothing.
  const source = own.trim() ? own : full;
  const flat = storable(source).replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  let cut = flat.slice(0, max - 1);
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1); // don't split a pair
  return `${cut.trimEnd()}…`;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const QUOTE_STYLE = "margin:0 0 0 2px;padding-left:10px;border-left:2px solid #d0d0d0;color:#555";

function renderLines(lines: string[]): string {
  const out: string[] = [];
  let plain: string[] = [];
  // Before a quote, end the text with one more <br>: a browser drops a
  // trailing one before a block, so this keeps a blank line blank.
  const flush = (beforeQuote: boolean) => {
    if (plain.length) out.push(plain.map(escapeHtml).join("<br>") + (beforeQuote ? "<br>" : ""));
    plain = [];
  };
  for (let i = 0; i < lines.length; ) {
    if (lines[i].startsWith(">")) {
      flush(true);
      const quoted: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) quoted.push(lines[i++].replace(/^> ?/, ""));
      out.push(`<blockquote style="${QUOTE_STYLE}">${renderLines(quoted)}</blockquote>`);
    } else {
      plain.push(lines[i++]);
    }
  }
  flush(false);
  return out.join("");
}

/** The HTML part for a plain-text message: escaped, line breaks kept, "> " lines quoted. */
export function htmlFromText(text: string): string {
  const body = renderLines(text.replace(/\r\n?/g, "\n").split("\n"));
  // A complete, plain document: spam filters score bare HTML fragments worse.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0"><div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">${body}</div></body></html>`;
}

// ── Threading ─────────────────────────────────────────────────────────

const messageIdOk = (s: string) => !!s && s.length <= HEADER_MAX && !/\s/.test(s);

/**
 * In-Reply-To and References for a reply: the original's Message-ID, and its
 * References plus that id — oldest dropped until the header fits 998 chars.
 */
export function replyHeaders(original: Pick<MailRow, "message_id" | "references_ids">): { inReplyTo: string | null; references: string[] } {
  const id = (original.message_id ?? "").trim();
  const refs: string[] = [];
  for (const r of [...(original.references_ids ?? []), id]) {
    const v = typeof r === "string" ? r.trim() : "";
    if (messageIdOk(v) && !refs.includes(v)) refs.push(v);
  }
  while (refs.length && refs.join(" ").length > HEADER_MAX) refs.shift();
  return { inReplyTo: messageIdOk(id) ? id : null, references: refs };
}

/** Every Message-ID a message names: its own, the one it answers, and its References. */
export function threadIds(row: Pick<MailRow, "message_id" | "in_reply_to" | "references_ids">): string[] {
  const out: string[] = [];
  for (const v of [row.message_id, row.in_reply_to, ...(row.references_ids ?? [])]) {
    const id = typeof v === "string" ? v.trim() : "";
    if (messageIdOk(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * PostgREST condition for the messages in one conversation: any that is one of
 * these ids, answers one, or lists one in its References. Null when there are
 * none to look for. Goes in an and=(…), so it can't clash with a scope's or=(…).
 */
export function threadCondition(ids: string[]): string | null {
  const ok = ids.filter(messageIdOk).slice(0, 60);
  if (!ok.length) return null;
  const q = ok.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",");
  return `and=${encodeURIComponent(`(or(message_id.in.(${q}),in_reply_to.in.(${q}),references_ids.ov.{${q}}))`)}`;
}

// ── Mapping rows to the API ───────────────────────────────────────────

export function toSummary(row: SummaryRow): MailSummary {
  return {
    id: row.id,
    folder: row.folder,
    direction: row.direction,
    from: { email: row.from_email ?? "", name: row.from_name ?? null },
    to: cleanAddrs(row.to_addrs),
    cc: cleanAddrs(row.cc_addrs),
    subject: row.subject ?? "",
    snippet: row.snippet ?? "",
    occurredAt: row.occurred_at ?? row.created_at,
    read: !!row.read_at,
    starred: !!row.starred_at,
    attachmentCount: row.attachments?.length ?? 0,
    attachmentKinds: fileKinds(row.attachments ?? []),
    status: row.status ?? null,
    other: row.user_id === null,
    ...(row.thread_key ? { threadKey: row.thread_key, threadAt: row.thread_at ?? row.occurred_at ?? row.created_at } : {}),
    ...(unverified(row) ? { unverified: true } : {}),
  };
}

/** Received mail that neither SPF nor DKIM vouches for: the From could be anyone's. Our own sent copies need neither. */
function unverified(row: Pick<MailRow, "direction"> & Partial<Pick<MailRow, "spf_pass" | "dkim_pass">>): boolean {
  return row.direction === "in" && row.spf_pass !== true && row.dkim_pass !== true;
}

export function toMessage(row: MailRow): MailMessage {
  return {
    ...toSummary(row),
    bcc: cleanAddrs(row.bcc_addrs),
    text: row.text_body ?? null,
    html: row.html_body ?? null,
    attachments: (row.attachments ?? []).map((a) => ({
      id: a.id,
      filename: a.filename || "attachment",
      contentType: a.contentType || "application/octet-stream",
      size: a.size ?? 0,
      available: !!a.path,
    })),
    deliveredTo: row.delivered_to ?? null,
    messageId: row.message_id ?? null,
    // Our own sent copies carry no SPF/DKIM result, and need none.
    unverifiedSender: unverified(row),
  };
}

// ── Who sees what ─────────────────────────────────────────────────────

/** PostgREST filter for the rows a user may touch: their own, plus the catch-all for owners/admins. */
export function scopeFilter(userId: string, admin: boolean): string {
  return admin ? `or=(user_id.eq.${userId},user_id.is.null)` : `user_id=eq.${userId}`;
}

/** True when the row is the user's own, or a catch-all copy and they're an owner/admin. */
export function canSee(row: Pick<MailRow, "user_id">, userId: string, admin: boolean): boolean {
  return row.user_id === userId || (row.user_id === null && admin);
}

/** PostgREST filter for one folder of a user's mail. Archive also holds archived catch-all mail for admins. */
export function folderFilter(folder: MailFolder, userId: string, admin: boolean): string {
  // Active leaves out conversations archived from it (mail_messages.active_hidden).
  if (folder === "active") return `user_id=eq.${userId}&folder=in.(inbox,sent)&active_hidden=is.false`;
  if (folder === "other") return "user_id=is.null&folder=eq.inbox";
  if (folder === "archive") return `${scopeFilter(userId, admin)}&folder=eq.archive`;
  return `user_id=eq.${userId}&folder=eq.${folder}`;
}

/** A value quoted for a PostgREST condition, so commas, parentheses and dots in it are literal. */
export function pgQuote(v: string): string {
  return encodeURIComponent(`"${v.replace(/[\\"]/g, (c) => `\\${c}`)}"`);
}

/**
 * Active's paging, for use inside and=(…): the conversations after the last
 * one shown, in the list's (thread_at desc, thread_key asc) order.
 */
export function activeAfter(threadAt: string, threadKey: string): string {
  const at = pgQuote(threadAt);
  return `or(thread_at.lt.${at},and(thread_at.eq.${at},thread_key.gt.${pgQuote(threadKey)}))`;
}

/** The order Active reads rows in: each conversation together, its newest message first. */
export const ACTIVE_ORDER = "thread_at.desc,thread_key.asc,occurred_at.desc,id.desc";

/**
 * Rows in ACTIVE_ORDER → the newest message of each conversation, at most
 * `limit` of them; `more` when there may be further conversations.
 */
export function conversationHeads<T extends { id: string; thread_key?: string | null }>(rows: T[], limit: number, fetched: number): { heads: T[]; more: boolean } {
  const heads: T[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const key = r.thread_key || `id:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (heads.length === limit) return { heads, more: true };
    heads.push(r);
  }
  // A full read may have stopped partway: there could be more after it.
  return { heads, more: rows.length >= fetched };
}

/** PostgREST clause narrowing a folder to unread or starred mail; "" for everything. */
export function filterClause(filter: MailFilter): string {
  if (filter === "unread") return "&read_at=is.null";
  if (filter === "starred") return "&starred_at=not.is.null";
  if (filter === "unread-starred") return "&read_at=is.null&starred_at=not.is.null";
  return "";
}


const SEARCH_MAX = 100;

/**
 * A PostgREST condition matching mail that mentions `q` in its subject,
 * sender, summary or text — for use inside and=(…). "" when there's nothing
 * to search for. The term is quoted (so commas and parentheses are literal)
 * and its wildcards are dropped: `*` around it does the matching.
 */
export function searchCondition(q: string): string {
  const term = likeTerm(q.replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX));
  if (!term) return "";
  const quoted = `*${term}*`;
  return `or(subject.ilike.${quoted},from_email.ilike.${quoted},from_name.ilike.${quoted},snippet.ilike.${quoted},text_body.ilike.${quoted})`;
}

// countRows now lives with the other paging helpers; re-exported for the mail endpoints.
export { countRows };

// ── Sending: checking a request ───────────────────────────────────────

type OutgoingFile = { filename: string; contentType: string; bytes: Buffer };

type SendRequest = {
  sendId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  html: string;
  replyToId: string | null;
  forwardId: string | null;
  attachments: OutgoingFile[];
};

type Refusal = { error: string; message: string };

function addressList(input: unknown): string[] | Refusal {
  const entries = typeof input === "string" ? input.split(/[,;]/) : Array.isArray(input) ? input : input == null ? [] : null;
  if (!entries) return { error: "bad_address", message: "Recipients must be a list of addresses." };
  const out: string[] = [];
  for (const entry of entries) {
    if (typeof entry === "string" && !entry.trim()) continue;
    const email = parseAddress(entry);
    if (!email) return { error: "bad_address", message: `"${String(entry).trim().slice(0, 80)}" isn't a valid address.` };
    if (!out.includes(email)) out.push(email);
  }
  return out;
}

const cleanFilename = (name: unknown) =>
  storable(typeof name === "string" ? name : "").replace(/[\r\n\t"\\/]+/g, " ").trim().slice(0, 200).replace(/[\ud800-\udbff]$/, "") || "attachment";

const cleanContentType = (type: unknown) =>
  typeof type === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(type.trim()) ? type.trim().toLowerCase() : "application/octet-stream";

/** Validate a send request from the browser. Everything is checked before anything is sent. */
export function parseSend(body: Record<string, unknown>): SendRequest | Refusal {
  const sendId = typeof body.sendId === "string" ? body.sendId.trim() : "";
  if (!UUID_RE.test(sendId)) return { error: "bad_send_id", message: "Missing send id. Reload and try again." };

  const to = addressList(body.to);
  if (!Array.isArray(to)) return to;
  const cc = addressList(body.cc);
  if (!Array.isArray(cc)) return cc;
  const bcc = addressList(body.bcc);
  if (!Array.isArray(bcc)) return bcc;
  // Each person once: To wins over Cc, Cc over Bcc.
  const ccOnly = cc.filter((a) => !to.includes(a));
  const bccOnly = bcc.filter((a) => !to.includes(a) && !ccOnly.includes(a));
  if (!to.length) return { error: "no_recipients", message: "Add a recipient." };
  if (to.length + ccOnly.length + bccOnly.length > LIMITS.recipients) {
    return { error: "too_many_recipients", message: `Send to ${LIMITS.recipients} people or fewer.` };
  }

  const subject = storable(typeof body.subject === "string" ? body.subject : "").replace(/[\r\n]+/g, " ").trim();
  if (subject.length > LIMITS.subject) return { error: "subject_too_long", message: `Keep the subject under ${LIMITS.subject} characters.` };

  // A formatted message (the editor's HTML) is cleaned to the allowlist again here; its text part is written from it.
  const formatted = typeof body.html === "string" && body.html.trim() ? storable(body.html) : null;
  if (formatted && Buffer.byteLength(formatted) > LIMITS.textBytes * 2) return { error: "text_too_long", message: "The message is too long." };
  const text = formatted ? composeText(formatted) : storable(typeof body.text === "string" ? body.text : "");
  if (Buffer.byteLength(text) > LIMITS.textBytes) return { error: "text_too_long", message: "The message is too long." };

  const ref = (v: unknown) => (v == null || v === "" ? null : typeof v === "string" && UUID_RE.test(v) ? v : undefined);
  const replyToId = ref(body.replyToId);
  const forwardId = ref(body.forwardId);
  if (replyToId === undefined || forwardId === undefined) return { error: "bad_reference", message: "The original message wasn't found." };
  if (replyToId && forwardId) return { error: "bad_reference", message: "Reply or forward, not both." };

  const files = body.attachments == null ? [] : body.attachments;
  if (!Array.isArray(files)) return { error: "bad_attachment", message: "Attachments weren't readable." };
  if (files.length > LIMITS.attachments) return { error: "too_many_attachments", message: `Attach ${LIMITS.attachments} files or fewer.` };
  const attachments: OutgoingFile[] = [];
  for (const f of files as Array<Record<string, unknown>>) {
    const data = typeof f?.data === "string" ? f.data.replace(/^data:[^,]*;base64,/, "").replace(/\s+/g, "") : "";
    if (!data || !/^[A-Za-z0-9+/]+=*$/.test(data)) return { error: "bad_attachment", message: `${cleanFilename(f?.filename)} wasn't readable.` };
    attachments.push({ filename: cleanFilename(f.filename), contentType: cleanContentType(f.contentType), bytes: Buffer.from(data, "base64") });
  }
  if (attachments.reduce((n, a) => n + a.bytes.length, 0) > LIMITS.attachBytes) {
    return { error: "attachments_too_large", message: "Attachments can be 3 MB in total." };
  }

  return { sendId, to, cc: ccOnly, bcc: bccOnly, subject, text, html: formatted ? composeDocument(formatted) : htmlFromText(text), replyToId, forwardId, attachments };
}

// ── Bird ──────────────────────────────────────────────────────────────

/** A Bird call that failed; the message is one plain line for people. */
export class BirdError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** A send refused once the forwarded files are counted in (too many, too big). */
export class SendRefused extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

type BirdTask = "read" | "send" | "domains";

const SCOPE_HINT: Record<BirdTask, string> = {
  read: "the API key can't read received mail",
  send: "the API key can't send email",
  domains: "the API key can't read domains",
};

/** One line a person can act on, from a failed Bird response. */
function birdProblem(status: number, body: string, task: BirdTask): string {
  let detail = body;
  try {
    const j = JSON.parse(body);
    detail = j?.error?.message ?? j?.message ?? j?.detail ?? j?.title ?? "";
  } catch {
    /* not JSON */
  }
  detail = String(detail ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (status === 401) return "Bird refused (401): the API key isn't valid";
  if (status === 403) return `Bird refused (403): ${SCOPE_HINT[task]}`;
  if (status === 429) return "Bird is busy (429): try again in a minute";
  return `Bird refused (${status})${detail ? `: ${detail}` : ""}`;
}

export function problemText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}

async function bird(path: string, task: BirdTask, init: Parameters<typeof birdPlatformFetch>[1] = {}): Promise<Response> {
  const res = await birdPlatformFetch(path, init);
  if (!res.ok) throw new BirdError(res.status, birdProblem(res.status, await res.text().catch(() => ""), task));
  return res;
}

/** Bird's answer, or null when it's gone (404, or 410 past retention). */
async function birdMaybe(path: string): Promise<Response | null> {
  const res = await birdPlatformFetch(path);
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw new BirdError(res.status, birdProblem(res.status, await res.text().catch(() => ""), "read"));
  return res;
}

type BirdAddress = { email: string; name?: string | null };

/** A received message as Bird lists it. */
export type BirdInbound = {
  id: string;
  from: BirdAddress | null;
  to?: BirdAddress[] | null;
  cc?: BirdAddress[] | null;
  subject: string | null;
  message_id: string | null;
  in_reply_to: string | null;
  references?: string[] | null;
  spf_pass: boolean | null;
  dkim_pass: boolean | null;
  attachments?: { id: string; filename: string | null; content_type: string | null; size: number }[] | null;
  received_at: string;
};

const inboundPath = (id: string) => `/v1/email/inbound-messages/${enc(id)}`;

export async function getInbound(id: string): Promise<BirdInbound | null> {
  const res = await birdMaybe(inboundPath(id));
  return res ? ((await res.json()) as BirdInbound) : null;
}

async function inboundBody(id: string): Promise<{ html: string | null; text: string | null }> {
  const res = await birdMaybe(`${inboundPath(id)}/body`);
  if (!res) return { html: null, text: null };
  const data = (await res.json()) as { html?: string | null; text?: string | null };
  return { html: data.html ?? null, text: data.text ?? null };
}

/** Just the header block of the raw message — read until the blank line, then hang up. */
async function inboundHeaders(id: string): Promise<string | null> {
  const res = await birdMaybe(`${inboundPath(id)}/raw`);
  if (!res) return null;
  if (!res.body) return headerBlock(await res.text());
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < 256 * 1024) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (/\r?\n\r?\n/.test(text)) break;
    }
  } finally {
    void reader.cancel().catch(() => {
      /* the stream is being abandoned; a cancel error changes nothing */
    });
  }
  return headerBlock(text);
}

async function inboundAttachment(id: string, attachmentId: string): Promise<Uint8Array | null> {
  const res = await birdMaybe(`${inboundPath(id)}/attachments/${enc(attachmentId)}`);
  return res ? new Uint8Array(await res.arrayBuffer()) : null;
}

// ── Receiving ─────────────────────────────────────────────────────────

/**
 * Approved users with one of these addresses, main or extra (mail_aliases),
 * each once, with the address it reached them at (the first of theirs listed).
 */
async function usersAt(addresses: string[]): Promise<{ id: string; mail_address: string }[]> {
  if (!addresses.length) return [];
  // Addresses come from the inbound message, so each is quoted with its quotes escaped.
  const list = addresses.map(pgQuote).join(",");
  const [main, extra] = await Promise.all([
    sb<{ id: string; mail_address: string }[]>(`app_users?status=eq.approved&mail_address=in.(${list})&select=id,mail_address`),
    sb<{ address: string; user_id: string }[]>(`mail_aliases?address=in.(${list})&select=address,user_id`),
  ]);
  const extraOwners = [...new Set((extra ?? []).map((r) => r.user_id))];
  const approved = extraOwners.length
    ? new Set((await sb<{ id: string }[]>(`app_users?status=eq.approved&id=in.(${extraOwners.join(",")})&select=id`) ?? []).map((u) => u.id))
    : new Set<string>();
  const hits = [
    ...(main ?? []).map((u) => ({ id: u.id, address: u.mail_address })),
    ...(extra ?? []).filter((r) => approved.has(r.user_id)).map((r) => ({ id: r.user_id, address: r.address })),
  ];
  const out: { id: string; mail_address: string }[] = [];
  for (const addr of addresses) {
    for (const h of hits) {
      if (h.address === addr && !out.some((o) => o.id === h.id)) out.push({ id: h.id, mail_address: h.address });
    }
  }
  return out;
}

/** Copy each attachment into the bucket once, shared by every mailbox copy. A file Bird no longer has is kept as unavailable. */
async function keepInboundAttachments(msg: BirdInbound): Promise<StoredAttachment[]> {
  const out: StoredAttachment[] = [];
  for (const a of msg.attachments ?? []) {
    if (!a?.id || !BIRD_ID_RE.test(a.id)) continue;
    const contentType = a.content_type || "application/octet-stream";
    const bytes = await inboundAttachment(msg.id, a.id);
    const path = bytes ? await storageUpload(`in/${msg.id}/${a.id}`, bytes, contentType, BUCKET) : null;
    out.push({ id: a.id, filename: storable(a.filename || "") || "attachment", contentType: storable(contentType), size: a.size ?? bytes?.length ?? 0, path });
  }
  return out;
}

/**
 * SPF/DKIM only say the sending server was allowed to send for *its* domain,
 * not that it owns the From address. Mail "from" our own domain is only taken
 * as ours when we sent a matching message just before it arrived.
 */
async function sentByUs(fromEmail: string, subject: string | null, receivedAt: string): Promise<boolean> {
  // Nothing we send has an address or subject like this (and it would make the query too long).
  if (!isValidEmail(fromEmail) || (subject?.length ?? 0) > LIMITS.subject) return false;
  const at = new Date(receivedAt).getTime() || Date.now();
  const since = new Date(at - OWN_SENT_BEFORE_MS).toISOString();
  const until = new Date(at + OWN_SENT_SKEW_MS).toISOString();
  const sameSubject = subject ? `subject=eq.${enc(subject)}` : `or=(subject.is.null,subject.eq."")`;
  const rows = await sb<{ id: string }[]>(
    `mail_messages?direction=eq.out&from_email=eq.${enc(fromEmail)}&${sameSubject}` +
      `&occurred_at=gte.${enc(since)}&occurred_at=lte.${enc(until)}&select=id&limit=1`
  );
  return !!rows?.length;
}

/**
 * Store one received message: a copy for each user it's addressed to (To/Cc,
 * else the envelope headers), or one catch-all copy. Safe to repeat — copies
 * already stored, or deleted, are skipped. Returns how many copies were added.
 */
export async function ingestInbound(msg: BirdInbound): Promise<number> {
  if (!msg?.id || !BIRD_ID_RE.test(msg.id)) throw new Error("bad inbound message id");

  let recipients = ourRecipients(msg);
  let users = await usersAt(recipients);
  if (!users.length) {
    const headers = await inboundHeaders(msg.id);
    const envelope = headers ? rawHeaderRecipients(headers) : [];
    users = await usersAt(envelope);
    recipients = [...envelope, ...recipients.filter((r) => !envelope.includes(r))];
  }
  const targets = users.length
    ? users.map((u) => ({ userId: u.id as string | null, deliveredTo: u.mail_address as string | null }))
    : [{ userId: null, deliveredTo: recipients[0] ?? null }];
  const keyFor = (userId: string | null) => `in:${msg.id}:${userId ?? "other"}`;

  const [stored, deleted] = await Promise.all([
    sb<{ dedupe_key: string }[]>(`mail_messages?bird_id=eq.${enc(msg.id)}&select=dedupe_key`),
    sb<{ dedupe_key: string }[]>(`mail_deleted?bird_id=eq.${enc(msg.id)}&select=dedupe_key`),
  ]);
  const have = new Set([...(stored ?? []), ...(deleted ?? [])].map((r) => r.dedupe_key));
  const todo = targets.filter((t) => !have.has(keyFor(t.userId)));
  if (!todo.length) return 0;

  const from = msg.from?.email ? { email: storable(msg.from.email.toLowerCase()), name: storableOrNull(msg.from.name) } : null;
  const subject = storableOrNull(msg.subject);
  const occurredAt = msg.received_at || new Date().toISOString();
  let spf = msg.spf_pass ?? null;
  let dkim = msg.dkim_pass ?? null;
  if (from && onOurDomain(from.email) && (spf || dkim) && !(await sentByUs(from.email, subject, occurredAt))) {
    spf = null; // a forged From on our domain: show it as unverified
    dkim = null;
  }

  const body = await inboundBody(msg.id);
  const attachments = await keepInboundAttachments(msg);
  const shared = {
    folder: "inbox",
    direction: "in",
    bird_id: msg.id,
    message_id: storableOrNull(msg.message_id),
    in_reply_to: storableOrNull(msg.in_reply_to),
    references_ids: (msg.references ?? []).filter((r) => typeof r === "string").map(storable),
    from_email: from?.email ?? null,
    from_name: from?.name || null,
    to_addrs: cleanAddrs(msg.to),
    cc_addrs: cleanAddrs(msg.cc),
    bcc_addrs: [],
    subject,
    text_body: storableOrNull(body.text),
    html_body: storableOrNull(body.html),
    snippet: snippetOf(body.text, body.html),
    attachments,
    spf_pass: spf,
    dkim_pass: dkim,
    status: null,
    read_at: null,
    starred_at: null,
    occurred_at: occurredAt,
  };
  // Only rows actually stored come back (duplicates are ignored), so each new message is announced once.
  const inserted = await sb<NewMail[]>("mail_messages?on_conflict=dedupe_key&select=id,user_id,thread_key,from_email,from_name,subject,snippet,occurred_at", {
    method: "POST",
    body: todo.map((t) => ({ ...shared, user_id: t.userId, dedupe_key: keyFor(t.userId), delivered_to: storableOrNull(t.deliveredTo) })),
    prefer: "resolution=ignore-duplicates,return=representation",
  });
  if (!Array.isArray(inserted)) return 0;
  // A notice on the recipients' phones (the iPhone app); never holds the mail up or fails it.
  await notifyNewMail(inserted);
  return inserted.length;
}

type SyncResult = { ingested: number; error?: string; skipped?: boolean };

type SyncState = { id: string; cursor: string | null; synced_at: string | null; error: string | null };

type Listing = BirdInbound[] | "full" | "over";

/**
 * Everything Bird received in [from, to] (both ends inclusive), all pages.
 * "full" when there are more than `max`; "over" when time ran out first.
 */
async function listWindow(from: number, to: number, max: number, over: () => boolean): Promise<Listing> {
  const seen = new Map<string, BirdInbound>();
  let after: string | null = null;
  do {
    if (over()) return "over";
    const q = new URLSearchParams({ received_after: new Date(from).toISOString(), received_before: new Date(to).toISOString(), limit: "100" });
    if (after) q.set("starting_after", after);
    const page = (await (await bird(`/v1/email/inbound-messages?${q}`, "read")).json()) as { data?: BirdInbound[]; next_cursor?: string | null };
    for (const m of page.data ?? []) if (m?.id && BIRD_ID_RE.test(m.id) && !seen.has(m.id)) seen.set(m.id, m);
    after = page.next_cursor ?? null;
    // One page past the limit is enough to know the window needs halving.
    if (after && seen.size >= max) return "full";
  } while (after);
  return [...seen.values()];
}

/** Which of these Bird ids are stored already, or were deleted. */
async function knownBirdIds(ids: string[]): Promise<Set<string>> {
  const have = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const list = ids.slice(i, i + 100).join(",");
    const [stored, deleted] = await Promise.all([
      sb<{ bird_id: string }[]>(`mail_messages?bird_id=in.(${list})&select=bird_id`),
      sb<{ bird_id: string }[]>(`mail_deleted?bird_id=in.(${list})&select=bird_id`),
    ]);
    for (const r of [...(stored ?? []), ...(deleted ?? [])]) have.add(r.bird_id);
  }
  return have;
}

/**
 * Pull anything the webhook missed. At most one run per 30 seconds across all
 * instances (claimed by a conditional update). Walks forward from the cursor
 * (less 10 minutes of overlap) a day at a time — halving a crowded day — and
 * stores each window's missing mail oldest-first within the time budget.
 *
 * The cursor only ever means "everything received before this is stored or
 * deleted": it moves to the end of a window once all of it is in, or to just
 * before the first message left behind.
 */
export async function syncInbound(opts: { budgetMs?: number } = {}): Promise<SyncResult> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 35_000;
  const over = () => Date.now() - started > budget;
  const now = new Date(started).toISOString();
  const cutoff = new Date(started - SYNC_THROTTLE_MS).toISOString();

  const claimed = await sb<SyncState[]>(`mail_sync?id=eq.inbound&or=(synced_at.is.null,synced_at.lt.${enc(`"${cutoff}"`)})`, {
    method: "PATCH",
    body: { synced_at: now, updated_at: now },
    prefer: "return=representation",
  });
  const state = claimed?.[0];
  if (!state) return { ingested: 0, skipped: true };

  let from = state.cursor ? new Date(state.cursor).getTime() - SYNC_OVERLAP_MS : started - SYNC_FIRST_WINDOW_MS;
  let cursor = state.cursor;
  let ingested = 0;
  let error: string | undefined;
  const at = (m: BirdInbound) => new Date(m.received_at).getTime() || started;

  try {
    while (from < started) {
      let to = Math.min(from + SYNC_WINDOW_MS, started);
      let items: Listing;
      while ((items = await listWindow(from, to, to - from > SYNC_MIN_WINDOW_MS ? SYNC_WINDOW_MAX : Infinity, over)) === "full") {
        to = from + Math.floor((to - from) / 2);
      }
      if (items === "over") break;

      const have = await knownBirdIds(items.map((m) => m.id));
      const todo = items.filter((m) => !have.has(m.id)).sort((a, b) => at(a) - at(b));

      // Oldest first, until time runs out.
      let firstLeft: number | null = null;
      for (const m of todo) {
        if (over()) {
          firstLeft ??= Math.min(at(m), to);
          break;
        }
        try {
          ingested += await ingestInbound(m);
        } catch (err) {
          console.error(`mail: couldn't store ${m.id}`, err);
          error ??= problemText(err);
          firstLeft ??= Math.min(at(m), to);
          if (err instanceof BirdError && (err.status === 401 || err.status === 403)) break;
        }
      }
      if (firstLeft !== null) {
        cursor = new Date(firstLeft - 1000).toISOString();
        break;
      }
      cursor = new Date(to).toISOString();
      from = to;
    }
  } catch (err) {
    error = problemText(err);
  }

  await sb("mail_sync?id=eq.inbound", {
    method: "PATCH",
    body: { cursor, error: error ?? null, updated_at: new Date().toISOString() },
  }).catch((err) => console.error("mail: couldn't save the sync cursor", err));
  return error ? { ingested, error } : { ingested };
}

/** The last sync's time and problem, for admins. */
export async function lastSync(): Promise<{ at: string | null; error: string | null }> {
  const rows = await sb<SyncState[]>("mail_sync?id=eq.inbound&select=synced_at,error&limit=1").catch((err) => (console.error("mail: couldn't read the sync state", err), [] as SyncState[]));
  return { at: rows?.[0]?.synced_at ?? null, error: rows?.[0]?.error ?? null };
}

/** Plain diagnostics for the setup banner: Bird's view of the domain, whether the key can read mail, the webhook secret, the last sync. */
export async function mailStatus() {
  const domain = bird("/v1/email/domains?limit=100", "domains")
    .then(async (res) => {
      const list = ((await res.json()) as { data?: any[] }).data ?? [];
      const d = list.find((x) => String(x?.domain ?? "").toLowerCase() === MAIL_DOMAIN);
      return d
        ? { found: true, inbound: (d.capabilities?.inbound?.status as string) ?? null, receiving: (d.receiving?.state as string) ?? null }
        : { found: false, inbound: null, receiving: null };
    })
    .catch((err) => ({ error: problemText(err) }));
  const read = bird("/v1/email/inbound-messages?limit=1", "read")
    .then(() => ({ ok: true as const }))
    .catch((err) => ({ error: problemText(err) }));
  const [d, r, s] = await Promise.all([domain, read, lastSync()]);
  return { domain: d, read: r, webhookSecret: !!process.env.BIRD_WEBHOOK_SECRET?.trim(), lastSync: s };
}

// ── Sending ───────────────────────────────────────────────────────────

const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "file";

/** The original's stored files, to go out again with a forward. */
async function forwardedFiles(original: MailRow): Promise<OutgoingFile[]> {
  const out: OutgoingFile[] = [];
  for (const a of original.attachments ?? []) {
    if (!a.path) continue;
    const bytes = await storageDownload(a.path, BUCKET);
    if (bytes) out.push({ filename: a.filename || "attachment", contentType: a.contentType || "application/octet-stream", bytes: Buffer.from(bytes) });
  }
  return out;
}

type Sender = { id: string; name: string | null; address: string };

/** A uuid made from a string, so the same Bird request is one row in the send ledger. */
function uuidFrom(key: string): string {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Hold a place in the user's daily send limit before Bird is called. The
 * ledger (mail_sends) is never touched by deleting mail, and reserving before
 * counting means parallel sends can't all slip under the limit. The same Bird
 * request retried is the same row, so it isn't counted twice.
 */
async function reserveSend(userId: string, key: string): Promise<void> {
  const sendId = uuidFrom(key);
  const added = await sb<unknown[]>("mail_sends?on_conflict=user_id,send_id", {
    method: "POST",
    body: { user_id: userId, send_id: sendId },
    prefer: "resolution=ignore-duplicates,return=representation",
  });
  const since = new Date(Date.now() - SEND_WINDOW_MS).toISOString();
  const recent = await countRows("mail_sends", `user_id=eq.${userId}&created_at=gte.${enc(since)}`);
  if (recent > LIMITS.sendsPerDay) {
    if (added?.length) await sb(`mail_sends?user_id=eq.${userId}&send_id=eq.${sendId}`, { method: "DELETE" });
    throw new SendRefused("too_many_sends", `That's ${LIMITS.sendsPerDay} messages in a day. Try again later.`);
  }
}

/**
 * Send through Bird from the user's own address and keep the sent copy.
 * `original` is the message being replied to or forwarded (already checked
 * to be the sender's). Retrying the same message with the same sendId replays
 * Bird's answer and returns the copy stored the first time; a changed message
 * is a new Bird request (Bird refuses a reused key with a different body).
 */
export async function sendMail(sender: Sender, req: SendRequest, original: MailRow | null): Promise<MailRow> {
  const reply = original && req.replyToId ? replyHeaders(original) : null;
  const files = [...(original && req.forwardId ? await forwardedFiles(original) : []), ...req.attachments];
  if (files.length > LIMITS.attachments) throw new SendRefused("too_many_attachments", `Attach ${LIMITS.attachments} files or fewer.`);
  if (files.reduce((n, f) => n + f.bytes.length, 0) > LIMITS.totalAttachBytes) {
    throw new SendRefused("attachments_too_large", "The attachments are too large to send.");
  }

  const headers: Record<string, string> = {};
  if (reply?.inReplyTo) headers["In-Reply-To"] = reply.inReplyTo;
  if (reply?.references.length) headers.References = reply.references.join(" ");
  const name = (sender.name ?? "").replace(/[\r\n"<>]+/g, " ").trim();
  const from = name ? { email: sender.address, name } : { email: sender.address };

  const payload = {
    from,
    to: req.to,
    ...(req.cc.length ? { cc: req.cc } : {}),
    ...(req.bcc.length ? { bcc: req.bcc } : {}),
    subject: req.subject,
    text: req.text,
    html: req.html,
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(files.length
      ? { attachments: files.map((f) => ({ filename: f.filename, content: f.bytes.toString("base64"), content_type: f.contentType })) }
      : {}),
    category: "transactional",
    track_opens: false,
    track_clicks: false,
  };
  // birdPlatformFetch sends JSON.stringify(payload), so this covers exactly what Bird gets.
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
  const key = `mail-${sender.id}-${req.sendId}-${digest}`;
  await reserveSend(sender.id, key);

  let res = await birdPlatformFetch("/v1/email/messages", {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: payload,
  });
  // Bird replays a refused request's 4xx for ~3 hours. A replayed refusal sent
  // nothing, so asking again under a fresh key can't send twice.
  if (res.status >= 400 && res.status < 500 && res.status !== 409 && res.headers.get("idempotency-replay") === "true") {
    res = await birdPlatformFetch("/v1/email/messages", {
      method: "POST",
      headers: { "Idempotency-Key": `${key}-${randomUUID().slice(0, 8)}` },
      body: payload,
    });
  }
  const answer = await res.text();
  if (!res.ok) throw new BirdError(res.status, birdProblem(res.status, answer, "send"));
  let sent: { id?: string; status?: string };
  try {
    sent = JSON.parse(answer);
  } catch {
    sent = {};
  }
  if (!sent.id) throw new BirdError(502, "Bird didn't say whether it sent the message");

  const dedupeKey = `out:${sent.id}`;
  const existing = () => sb<MailRow[]>(`mail_messages?dedupe_key=eq.${enc(dedupeKey)}&user_id=eq.${sender.id}&select=*&limit=1`);
  const already = await existing();
  if (already?.[0]) return already[0];

  // Store the copy first (the files' paths decided up front), so the
  // recipient's copy of internal mail finds it when checking the sender.
  const id = randomUUID();
  const attachments: StoredAttachment[] = files.map((f, i) => ({
    id: `a${i}`,
    filename: storable(f.filename),
    contentType: f.contentType,
    size: f.bytes.length,
    path: `out/${id}/${i}-${safeName(f.filename)}`,
  }));

  const now = new Date().toISOString();
  const row = {
    id,
    user_id: sender.id,
    dedupe_key: dedupeKey,
    folder: "sent" as const,
    direction: "out" as const,
    bird_id: sent.id,
    message_id: null,
    in_reply_to: reply?.inReplyTo ?? null,
    references_ids: reply?.references ?? [],
    from_email: sender.address,
    from_name: storable(name) || null,
    to_addrs: req.to.map((email) => ({ email })),
    cc_addrs: req.cc.map((email) => ({ email })),
    bcc_addrs: req.bcc.map((email) => ({ email })),
    delivered_to: null,
    subject: storable(req.subject),
    text_body: storable(req.text),
    html_body: storable(req.html),
    snippet: snippetOf(req.text),
    attachments,
    spf_pass: null,
    dkim_pass: null,
    status: sent.status ?? null,
    read_at: now,
    starred_at: null,
    occurred_at: now,
  };
  const inserted = await sb<MailRow[]>("mail_messages?on_conflict=dedupe_key", {
    method: "POST",
    body: row,
    prefer: "resolution=ignore-duplicates,return=representation",
  });
  const stored = inserted?.[0];
  if (!stored) return (await existing())?.[0] ?? { ...row, created_at: now };

  // The mail has gone; a file that can't be kept just shows as unavailable.
  let lost = false;
  for (const [i, f] of files.entries()) {
    await storageUpload(attachments[i].path!, new Uint8Array(f.bytes), f.contentType, BUCKET).catch((err) => {
      console.error("mail: couldn't keep a sent attachment", err);
      attachments[i] = { ...attachments[i], path: null };
      lost = true;
    });
  }
  if (lost) {
    await sb(`mail_messages?id=eq.${id}`, { method: "PATCH", body: { attachments } }).catch((err) =>
      console.error("mail: couldn't mark a sent attachment unavailable", err)
    );
    return { ...stored, attachments };
  }
  return stored;
}

// ── Deleting ──────────────────────────────────────────────────────────

/**
 * Delete rows for good (already scoped to the caller), and any attachment
 * file no other copy still points at. A received copy leaves a tombstone so
 * the sync or a webhook retry doesn't bring it back.
 */
export async function deleteMessages(ids: string[], scope: string): Promise<void> {
  if (!ids.length) return;
  const rows = await sb<Pick<MailRow, "id" | "attachments" | "dedupe_key" | "bird_id" | "direction">[]>(
    `mail_messages?id=in.(${ids.join(",")})&${scope}&select=id,attachments,dedupe_key,bird_id,direction`
  );
  if (!rows?.length) return;
  const tombstones = rows.filter((r) => r.direction === "in" && r.bird_id).map((r) => ({ dedupe_key: r.dedupe_key, bird_id: r.bird_id }));
  if (tombstones.length) {
    await sb("mail_deleted?on_conflict=dedupe_key", { method: "POST", body: tombstones, prefer: "resolution=ignore-duplicates,return=minimal" });
  }
  await sb(`mail_messages?id=in.(${rows.map((r) => r.id).join(",")})&${scope}`, { method: "DELETE" });
  const paths = [...new Set(rows.flatMap((r) => (r.attachments ?? []).map((a) => a.path).filter((p): p is string => !!p)))];
  for (const path of paths) {
    const others = await sb<{ id: string }[]>(`mail_messages?attachments=cs.${enc(JSON.stringify([{ path }]))}&select=id&limit=1`);
    if (!others?.length) await storageRemove(path, BUCKET);
  }
}
