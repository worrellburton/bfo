import type { Dispatch, RefObject, SetStateAction } from "react";
import type { SetURLSearchParams } from "react-router";
import { confirmDialog } from "../confirm-dialog";
import { deleteMail, getMessage, markRead, moveMail, notifyMailChanged, starMail, type MailFilter, type MailFolder, type MailMessage, type MailSummary } from "../mail-client";
import { eachRow, listRows, type ListState } from "./list-state";
import type { Draft } from "./drafts";

/** What the page's actions act on: the list, the open message, the toast, and the navigation's refs. */
type Deps = {
  folder: MailFolder;
  filter: MailFilter;
  q: string;
  cache: RefObject<Map<string, MailMessage>>;
  listRef: RefObject<ListState | null>;
  setList: Dispatch<SetStateAction<ListState | null>>;
  setListError: Dispatch<SetStateAction<string | null>>;
  loadList: (which: MailFolder, narrow: MailFilter, term: string, to: string, mode: "replace" | "refresh" | "reset") => Promise<void>;
  refreshActive: () => void;
  patchRow: (id: string, patch: Partial<MailSummary>) => void;
  setOpen: Dispatch<SetStateAction<{ id: string; message: MailMessage | null; error: string | null } | null>>;
  thread: { id: string; messages: MailMessage[] } | null;
  setThread: Dispatch<SetStateAction<{ id: string; messages: MailMessage[] } | null>>;
  setFreshId: Dispatch<SetStateAction<string | null>>;
  setDraft: Dispatch<SetStateAction<Draft | null>>;
  setToast: (text: string | null, undo?: () => void) => void;
  setToastState: Dispatch<SetStateAction<{ text: string; undo?: () => void } | null>>;
  closeMessage: () => void;
  setParams: SetURLSearchParams;
  openIdRef: RefObject<string | null>;
  navStateRef: RefObject<unknown>;
  queryRef: RefObject<(extra?: Record<string, string>) => Record<string, string>>;
  mountedRef: RefObject<boolean>;
};

/** Archive, delete, star, unread, undo and the rest: each changes the list and the open message at once, with a toast. */
export function useMailActions({ folder, filter, q, cache, listRef, setList, setListError, loadList, refreshActive, patchRow, setOpen, thread, setThread, setFreshId, setDraft, setToast, setToastState, closeMessage, setParams, openIdRef, navStateRef, queryRef, mountedRef }: Deps) {
  function dropFromList(id: string) {
    // The one after it (or before, at the end), to open in its place, as Gmail does after an archive.
    const all = listRows(listRef.current);
    const at = all.findIndex((m) => m.id === id);
    const next = at >= 0 ? (all[at + 1] ?? all[at - 1]) : undefined;
    setList((prev) => prev && eachRow(prev, (rows) => rows.filter((m) => m.id !== id)));
    // Only if it's still the one open (and the page is still here).
    if (!mountedRef.current || openIdRef.current !== id) return;
    if (next) setParams(queryRef.current({ m: next.id }), { replace: true, state: navStateRef.current });
    else closeMessage();
  }

  /** Read the list again from its first page, as it shows now (after an undo, say). */
  function resetList() {
    const cur = listRef.current;
    if (cur) void loadList(cur.folder, cur.filter, cur.q, cur.to, "reset");
  }

  const failOn = (id: string, e: unknown) => setOpen((o) => (o && o.id === id ? { ...o, error: (e as Error).message } : o));

  async function move(m: MailMessage, to: "inbox" | "archive") {
    try {
      // From Active, Archive takes the whole conversation out (sent copies stay in Out).
      const cur = listRef.current;
      const whole = cur?.folder === "active" && !cur.q;
      await moveMail([m.id], to, { conversation: to === "archive" && whole });
      cache.current.set(m.id, { ...m, folder: to });
      dropFromList(m.id);
      refreshActive();
      notifyMailChanged();
      const back = to === "archive" ? "inbox" : "archive";
      setToast(to === "archive" ? "Archived" : "Moved to inbox", () => undoWith(() => moveMail([m.id], back, { conversation: whole })));
    } catch (e) {
      failOn(m.id, e);
    }
  }

  /** Archive straight from a row (a swipe): the same as from the reader, with Undo. */
  async function archiveRow(m: MailSummary) {
    try {
      const cur = listRef.current;
      const whole = cur?.folder === "active" && !cur.q;
      await moveMail([m.id], "archive", { conversation: whole });
      cache.current.delete(m.id);
      dropFromList(m.id);
      refreshActive();
      notifyMailChanged();
      setToast("Archived", () => undoWith(() => moveMail([m.id], "inbox", { conversation: whole })));
    } catch (e) {
      setToast((e as Error).message || "Couldn't archive it.");
    }
  }

  async function remove(m: MailMessage) {
    const ok = await confirmDialog({ title: "Delete this message?", confirmLabel: "Delete", tone: "danger" });
    if (!ok) return;
    try {
      await deleteMail([m.id]);
      cache.current.delete(m.id);
      dropFromList(m.id);
      refreshActive();
      notifyMailChanged();
      setToast("Deleted");
    } catch (e) {
      failOn(m.id, e);
    }
  }

  /** Star or unstar, shown at once and undone if the server says no. */
  async function star(m: MailSummary, starred: boolean, fromList = true) {
    patchRow(m.id, { starred });
    const hit = cache.current.get(m.id);
    if (hit) cache.current.set(m.id, { ...hit, starred });
    setOpen((o) => (o && o.id === m.id && o.message ? { ...o, message: { ...o.message, starred } } : o));
    try {
      // In Active a row is starred when any message in its conversation is: unstarring the row clears them all.
      // (Unstarring one message in the reader touches only that message.)
      const before = listRef.current;
      await starMail([m.id], starred, { conversation: fromList && before?.folder === "active" && !before.q });
      // Starred mail sits at the top: read the list again so it moves there (or back to its date) — the list
      // showing now, which may not be the one the click was in.
      const cur = listRef.current;
      if (cur && cur.filter === "all" && !cur.q) void loadList(cur.folder, cur.filter, cur.q, cur.to, "reset");
    } catch (e) {
      patchRow(m.id, { starred: !starred });
      if (hit) cache.current.set(m.id, { ...hit, starred: !starred });
      setOpen((o) => (o && o.id === m.id && o.message ? { ...o, message: { ...o.message, starred: !starred }, error: (e as Error).message } : o));
    }
  }

  /** Undo the last action: run its reverse, then read the list again. */
  async function undoWith(reverse: () => Promise<unknown>) {
    setToastState(null);
    try {
      await reverse();
      cache.current.clear();
      resetList();
      notifyMailChanged();
      setToast("Undone");
    } catch (e) {
      setListError((e as Error).message);
    }
  }

  /** Back to unread: the list shows it bold again and the reader closes (opening marks it read). */
  async function markUnread(m: MailMessage) {
    try {
      await markRead([m.id], false);
      patchRow(m.id, { read: false });
      cache.current.delete(m.id);
      notifyMailChanged();
      if (mountedRef.current && openIdRef.current === m.id) closeMessage();
      setToast("Marked as unread", () => undoWith(() => markRead([m.id], true)));
    } catch (e) {
      failOn(m.id, e);
    }
  }

  function onSent(sent: MailSummary, about?: string) {
    setDraft(null);
    setToast("Sent");
    // A reply or forward on the conversation that's open: the sent message joins it at the top.
    const conv = thread;
    if (about && conv && (conv.id === about || conv.messages.some((m) => m.id === about))) {
      getMessage(sent.id)
        .then(({ message }) => {
          setThread((cur) => (cur && cur.id === conv.id ? { ...cur, messages: [message, ...cur.messages.filter((m) => m.id !== message.id)] } : cur));
          setFreshId(message.id);
        })
        .catch(() => {});
    }
    if (folder === "sent" && filter === "all" && !q) setList((prev) => prev && { ...prev, messages: [sent, ...prev.messages.filter((m) => m.id !== sent.id)] });
    // In Active, the conversation just replied to moves to the top.
    refreshActive();
    notifyMailChanged();
  }

  return { dropFromList, resetList, move, archiveRow, remove, star, undoWith, markUnread, onSent };
}
