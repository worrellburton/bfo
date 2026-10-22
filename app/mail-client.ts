import { useEffect, useSyncExternalStore } from "react";
import { authFetch, getToken } from "./auth";

/**
 * The inbox's side of /api/mail: the shapes the server returns, one helper per
 * call, and the shared unread count behind the envelope in the rail.
 */

// ── Types (the /api/mail contract) ───────────────────────────────────────

export type MailAddress = { email: string; name?: string | null };
export type MailAttachment = { id: string; filename: string; contentType: string; size: number; available: boolean };
/** "active": inbox and sent together, one row per conversation, latest activity first. */
export type MailFolder = "active" | "inbox" | "sent" | "archive" | "other";
/** Narrows a folder's list: everything, only unread, or only starred. */
export type MailFilter = "all" | "unread" | "starred";

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
  status: string | null;
  /** A catch-all copy (mail to an address nobody owns). */
  other: boolean;
  /** The conversation it's in, and when that conversation last had a message (Active pages on these). */
  threadKey?: string;
  threadAt?: string;
  /** Received mail neither SPF nor DKIM vouches for: its From could be forged (no colleague's photo on it). */
  unverified?: boolean;
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
};

export type MailCount = {
  unread: number;
  otherUnread: number;
  /** null until an admin gives the user an address. */
  address: string | null;
  /** Extra addresses on the same account: mail to them lands here too, and they can be sent from. */
  aliases?: string[];
  canSeeOther: boolean;
  sync?: { error?: string };
};

export type MailStatus = {
  domain: { found: boolean; inbound: string; receiving: string } | { error: string };
  read: { ok: boolean } | { error: string };
  webhookSecret: boolean;
  lastSync: { at: string | null; error: string | null };
};

export type OutgoingAttachment = { filename: string; contentType: string; data: string };

export type SendInput = {
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
  if (code === "not_found" || status === 404) return "That message is gone.";
  if (code === "no_address") return "No address yet. Ask an admin.";
  if (code === "forbidden" || status === 403) return "Not allowed.";
  if (status === 413) return "Too large to send.";
  if (status === 429) return "Too many sends today. Try again later.";
  return "Something went wrong. Try again.";
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

export type ListQuery = {
  folder: MailFolder;
  filter?: MailFilter;
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
export function listMail({ folder, filter = "all", q = "", to, before, beforeId, beforeKey, limit = 50 }: ListQuery) {
  const p = new URLSearchParams({ view: "list", folder, limit: String(limit) });
  if (filter !== "all") p.set("filter", filter);
  if (q.trim()) p.set("q", q.trim());
  if (to) p.set("to", to);
  if (before) p.set("before", before);
  if (before && beforeId) p.set("beforeId", beforeId);
  if (before && beforeKey) p.set("beforeKey", beforeKey);
  // `pinned`: starred mail for the top of the first page (filter "all", no search).
  return call<{ messages: MailSummary[]; hasMore: boolean; pinned?: MailSummary[] }>(`/api/mail?${p}`);
}

/** Opens a message; the server marks it read (with `conversation`, its whole conversation: opened from Active). */
export function getMessage(id: string, opts: { conversation?: boolean } = {}) {
  return call<{ message: MailMessage }>(`/api/mail?view=message&id=${encodeURIComponent(id)}${opts.conversation ? "&conversation=1" : ""}`);
}

/** The conversation a message is in, newest first (itself included). */
export function getThread(id: string) {
  return call<{ messages: MailMessage[] }>(`/api/mail?view=thread&id=${encodeURIComponent(id)}`);
}

export function getMailCount() {
  return call<MailCount>("/api/mail?view=count");
}

/** A short-lived download link for one attachment. */
export function attachmentUrl(id: string, att: string) {
  return call<{ url: string }>(`/api/mail?view=attachment&id=${encodeURIComponent(id)}&att=${encodeURIComponent(att)}`);
}

/** Owner/admin diagnostics: is Bird set up to receive? */
export function getMailStatus() {
  return call<MailStatus>("/api/mail?view=status");
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

/** `conversation`: every message in their conversations, sent and received. */
export function deleteMail(ids: string[], opts: { conversation?: boolean } = {}) {
  return post<{ ok: true }>({ action: "delete", ids, ...(opts.conversation ? { conversation: true } : {}) });
}

// ── Change signal ────────────────────────────────────────────────────────

/** Fired after anything that changes the unread count (read, move, delete, send). */
export const MAIL_CHANGED_EVENT = "bfo-mail-changed";

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
  const value = useSyncExternalStore(subscribe, () => count, () => null);
  // A remount (e.g. returning to the tab's shell) asks again.
  useEffect(() => {
    if (count) void refreshCount();
  }, []);
  return value;
}

/** The same message, laid out better: same words, clearer shape (Improve design). */
export function improveMail(html: string, subject: string): Promise<{ html: string }> {
  return post<{ html: string }>({ action: "improve", html, subject });
}
