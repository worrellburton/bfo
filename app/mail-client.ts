import type { FileKind } from "../lib/file-kind";
import { useEffect, useSyncExternalStore } from "react";
import { authFetch, getToken } from "./auth";

/**
 * The inbox's side of /api/mail: the shapes the server returns, one helper per
 * call, and the shared unread count behind the envelope in the rail.
 * Fields added with Trash (deletedAt, kept, trash, hold…) are optional: a
 * server that predates them still answers, and the page reads their absence
 * as "not there yet".
 */

// ── Types (the /api/mail contract) ───────────────────────────────────────

export type MailAddress = { email: string; name?: string | null };
export type MailAttachment = { id: string; filename: string; contentType: string; size: number; available: boolean };
/** "active": inbox and sent together, one row per conversation, latest activity first. "trash": deleted, kept 30 days. */
export type MailFolder = "active" | "inbox" | "sent" | "archive" | "other" | "trash";
/** Narrows a folder: everything, only unread, only starred, or only mail that is both. */
export type MailFilter = "all" | "unread" | "starred" | "unread-starred";

export type MailSummary = {
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
  /** The distinct kinds among them (pdf, image, sheet…), for the list's icons. Older rows may lack it. */
  attachmentKinds?: FileKind[];
  status: string | null;
  /** A catch-all copy (mail to an address nobody owns). */
  other: boolean;
  /** The conversation it's in, and when that conversation last had a message (Active pages on these). */
  threadKey?: string;
  threadAt?: string;
  /** Received mail neither SPF nor DKIM vouches for: its From could be forged (no colleague's photo on it). */
  unverified?: boolean;
  /** In Trash: when it was deleted, and when it goes for good. */
  deletedAt?: string;
  purgeAt?: string;
  /** Kept for records. */
  held?: boolean;
};

export type MailMessage = MailSummary & {
  bcc: MailAddress[];
  text: string | null;
  html: string | null;
  attachments: MailAttachment[];
  deliveredTo: string | null;
  messageId: string | null;
  /** Neither SPF nor DKIM passed. */
  unverifiedSender: boolean;
  /** Where the sender asked replies to go, when that's not the From. */
  replyTo?: MailAddress[];
  /** Reads like payment or banking instructions. */
  paymentRisk?: boolean;
  /** The mailbox has written to this sender before (its pictures may load). Absent: not known. */
  knownSender?: boolean;
  /** The display name copies someone in the office, from outside the office's domain. */
  impersonation?: boolean;
  /** Kept for records: this message ("message"), or a hold on its mailbox or all mail ("hold"). */
  kept?: "message" | "hold" | null;
};

export type MailCount = {
  unread: number;
  otherUnread: number;
  /** null until an admin gives the user an address. */
  address: string | null;
  /** Extra addresses on the same account: mail to them lands here too, and they can be sent from. */
  aliases?: string[];
  canSeeOther: boolean;
  /** Unread conversations in Inbox (Active): the folder tab's badge. */
  activeUnread?: number;
  /** Trash is set up on the server (deleting is recoverable). */
  trash?: boolean;
  /** A records hold covering my mail, if one is on. */
  hold?: { since: string; reason: string | null; all: boolean } | null;
  /** I may put all mail on hold or lift it (owners). */
  canHold?: boolean;
  /** When mail was last checked for new messages, and whether that worked (the reason for owners and admins). */
  sync?: { at?: string | null; failed?: boolean; error?: string };
};

export type OutgoingAttachment = { filename: string; contentType: string; data: string };

type SendInput = {
  sendId: string;
  /** One of my addresses; the main one when left out. */
  from?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  /** The formatted body (the editor's HTML); the server cleans it and writes the text part from it. */
  html?: string;
  replyToId?: string;
  forwardId?: string;
  attachments?: OutgoingAttachment[];
};

// ── Calls ────────────────────────────────────────────────────────────────

export class MailError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function fallbackMessage(status: number, code?: string): string {
  if (code === "not_found" || status === 404) return "That message is no longer here. It may have been moved or deleted.";
  if (code === "no_address") return "You don't have an address yet. Ask an owner or admin for one.";
  if (code === "bad_action") return "Deleting isn't available yet, so nothing was deleted. Archive it instead.";
  if (code === "forbidden" || status === 403) return "Your role doesn't allow that. Ask an owner or admin.";
  if (status === 413) return "That's too large to send. Remove an attachment and try again.";
  if (status === 429) return "That's the most messages for today. Try again tomorrow.";
  return "That didn't work. Check your connection and try again.";
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new MailError(res.status, data?.error ?? "error", data?.message ?? fallbackMessage(res.status, data?.error));
  return data as T;
}

function post<T>(body: Record<string, unknown>): Promise<T> {
  return call<T>("/api/mail", { method: "POST", body: JSON.stringify(body) });
}

type ListQuery = {
  folder: MailFolder;
  filter?: MailFilter;
  /** Only mail with attachments. */
  attachments?: boolean;
  /** Search text: every folder is searched and `folder` is ignored. */
  q?: string;
  /** One of my addresses: only that mailbox. */
  to?: string;
  /** The last row already shown, for the next page. */
  before?: string;
  beforeId?: string;
  /** Active: the last conversation shown (with before = its threadAt). */
  beforeKey?: string;
  limit?: number;
};

/** One page, newest first. */
export function listMail({ folder, filter = "all", attachments = false, q = "", to, before, beforeId, beforeKey, limit = 50 }: ListQuery) {
  const p = new URLSearchParams({ view: "list", folder, limit: String(limit) });
  if (filter !== "all") p.set("filter", filter);
  if (attachments) p.set("att", "1");
  if (q.trim()) p.set("q", q.trim());
  if (to) p.set("to", to);
  if (before) p.set("before", before);
  if (before && beforeId) p.set("beforeId", beforeId);
  if (before && beforeKey) p.set("beforeKey", beforeKey);
  // `pinned`: starred mail for the top of the first page (filter "all", no search). `unread`: one mailbox's unread count.
  return call<{ messages: MailSummary[]; hasMore: boolean; pinned?: MailSummary[]; unread?: number }>(`/api/mail?${p}`);
}

/** Opens a message; the server marks it read (with `conversation`, its whole conversation: opened from Active). */
export function getMessage(id: string, opts: { conversation?: boolean; /** Fetched ahead of a tap: don't mark it read. */ peek?: boolean } = {}) {
  return call<{ message: MailMessage }>(`/api/mail?view=message&id=${encodeURIComponent(id)}${opts.conversation ? "&conversation=1" : ""}${opts.peek ? "&peek=1" : ""}`);
}

/** The conversation a message is in, newest first (itself included). */
export function getThread(id: string) {
  return call<{ messages: MailMessage[] }>(`/api/mail?view=thread&id=${encodeURIComponent(id)}`);
}

function getMailCount() {
  return call<MailCount>("/api/mail?view=count");
}

/** A short-lived download link for one attachment. */
export function attachmentUrl(id: string, att: string) {
  return call<{ url: string }>(`/api/mail?view=attachment&id=${encodeURIComponent(id)}&att=${encodeURIComponent(att)}`);
}

/** Owner/admin: adds an extra address to my account ("accounting" or the full address). */
export function addAlias(address: string) {
  return post<{ aliases: string[] }>({ action: "alias-add", address });
}

export function removeAlias(address: string) {
  return post<{ aliases: string[] }>({ action: "alias-remove", address });
}

/** Address (lowercase) → a link to the picture its owner chose for their mail. */
export type MailFaces = Record<string, string>;

export function getFaces() {
  return call<{ faces: MailFaces }>("/api/mail?view=faces");
}

/** My picture for my mail: a small square image as a data: URL. */
export function setMailPhoto(data: string) {
  return post<{ faces: MailFaces }>({ action: "photo-set", data });
}

export function removeMailPhoto() {
  return post<{ faces: MailFaces }>({ action: "photo-remove" });
}

export function syncMail() {
  return post<{ ingested: number; error?: string }>({ action: "sync" });
}

export function sendMail(input: SendInput) {
  return post<{ message: MailSummary }>({ action: "send", ...input });
}

/** `conversation`: archive the whole conversation out of Active (a row there stands for all of it). */
export function moveMail(ids: string[], folder: "inbox" | "archive", opts: { conversation?: boolean } = {}) {
  return post<{ ok: true }>({ action: "move", ids, folder, ...(opts.conversation ? { conversation: true } : {}) });
}

export function markRead(ids: string[], read: boolean) {
  return post<{ ok: true }>({ action: "read", ids, read });
}

/** `conversation`: unstarring clears every starred message in their conversations (Active shows them as one). */
export function starMail(ids: string[], starred: boolean, opts: { conversation?: boolean } = {}) {
  return post<{ ok: true }>({ action: "star", ids, starred, ...(opts.conversation ? { conversation: true } : {}) });
}

/** What Delete did: into Trash, archived instead (held mail that came in), or left alone (held mail sent out). */
export type TrashResult = { trashed: string[]; archived: string[]; kept: string[]; purgeAt?: string };

/**
 * Delete: into Trash for 30 days. `conversation`: every message in their
 * conversations, sent and received. A server without Trash answers 400
 * (an unknown action), so nothing is ever removed for good from here.
 */
export function trashMail(ids: string[], opts: { conversation?: boolean } = {}) {
  return post<TrashResult>({ action: "trash", ids, ...(opts.conversation ? { conversation: true } : {}) });
}

/** Out of Trash, back where each message was. */
export function restoreMail(ids: string[], opts: { conversation?: boolean } = {}) {
  return post<{ restored: string[] }>({ action: "restore", ids, ...(opts.conversation ? { conversation: true } : {}) });
}

/** Delete forever: only mail already in Trash, and never held mail. */
export function purgeMail(ids: string[]) {
  return post<{ purged: number; kept: number }>({ action: "purge", ids });
}

export function emptyTrash() {
  return post<{ purged: number; kept: number }>({ action: "empty-trash" });
}

/** Keep for records (owner or admin), or stop (owner). */
export function holdMail(ids: string[], held: boolean) {
  return post<{ ok: true }>({ action: "hold", ids, held });
}

/** A records hold on all mail (owner). */
export function holdAllMail(on: boolean, reason?: string) {
  return post<{ hold: MailCount["hold"] }>({ action: "hold-all", on, ...(reason ? { reason } : {}) });
}

/** The office-mailbox notice: its version and when I acknowledged it. */
export function getNotice() {
  return call<{ version: string; acknowledgedAt: string | null; recordable: boolean }>("/api/mail?view=notice");
}

export function ackNotice(version: string) {
  return post<{ acknowledgedAt: string; recorded: boolean }>({ action: "notice-ack", version });
}

// ── Change signal ────────────────────────────────────────────────────────

/** Fired after anything that changes the unread count (read, move, delete, send). */
const MAIL_CHANGED_EVENT = "bfo-mail-changed";

export function notifyMailChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MAIL_CHANGED_EVENT));
}

// ── Unread count ─────────────────────────────────────────────────────────
//
// One poll shared by every subscriber (the rail and the inbox page), so the
// count is fetched once however many places show it. It refreshes on mount,
// every 60 s while the tab is visible, on focus, and on MAIL_CHANGED_EVENT.

const POLL_MS = 60_000;

let count: MailCount | null = null;
const listeners = new Set<() => void>();
let inflight = false;
let again = false;
let stopPolling: (() => void) | null = null;
/** Bumped when the store resets (sign-out), so an answer for the last session is dropped. */
let generation = 0;

function emit() {
  for (const l of listeners) l();
}

async function refreshCount() {
  const token = getToken();
  if (!token) return;
  if (inflight) {
    again = true;
    return;
  }
  inflight = true;
  const gen = generation;
  try {
    const next = await getMailCount();
    // Signed out (store reset) or a different session since this request started: drop it.
    if (gen !== generation || token !== getToken()) return;
    count = next;
    emit();
  } catch {
    // Keep the last count; the next poll tries again.
  } finally {
    inflight = false;
    if (again) {
      again = false;
      void refreshCount();
    }
  }
}

function startPolling() {
  const refresh = () => void refreshCount();
  const onVisible = () => document.visibilityState === "visible" && refresh();
  const timer = window.setInterval(onVisible, POLL_MS);
  window.addEventListener("focus", refresh);
  window.addEventListener(MAIL_CHANGED_EVENT, refresh);
  document.addEventListener("visibilitychange", onVisible);
  refresh();
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("focus", refresh);
    window.removeEventListener(MAIL_CHANGED_EVENT, refresh);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!stopPolling) stopPolling = startPolling();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stopPolling) {
      stopPolling();
      stopPolling = null;
      // Signed out (the shell unmounted): the next person starts from nothing.
      generation++;
      count = null;
    }
  };
}

/** The caller's unread count and address; null until the first answer. */
export function useMailCount(): MailCount | null {
  const value = useSyncExternalStore(
    subscribe,
    () => count,
    () => null,
  );
  // A remount (e.g. returning to the tab's shell) asks again.
  useEffect(() => {
    if (count) void refreshCount();
  }, []);
  return value;
}

/** The same message, laid out better: same words and figures, clearer shape (Tidy layout). `ack`: the first-use notice's version, once. */
export function improveMail(html: string, subject: string, ack?: string): Promise<{ html: string }> {
  return post<{ html: string }>({ action: "improve", html, subject, ...(ack ? { ack } : {}) });
}
