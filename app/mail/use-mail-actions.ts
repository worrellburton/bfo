import type { Dispatch, RefObject, SetStateAction } from "react";
import type { SetURLSearchParams } from "react-router";
import { confirm, dismissToast, format, toast } from "../ui";
import {
  getMessage,
  holdMail,
  markRead,
  moveMail,
  notifyMailChanged,
  purgeMail,
  restoreMail,
  starMail,
  trashMail,
  type MailFolder,
  type MailMessage,
  type MailSummary,
  type TrashResult,
} from "../mail-client";
import { eachRow, listRows, type ListState } from "./list-state";
import { senderLabel } from "./helpers";
import type { Draft } from "./drafts";

// ── Undo: the toast's action, and "z" while the toast is up ──────────────

let lastUndo: { run: () => void; until: number } | null = null;

/** A toast saying what just happened (§8.16), with Undo when it can be undone; "z" undoes it too while it's up. */
export function notify(message: string, undo?: () => void) {
  lastUndo = undo ? { run: undo, until: Date.now() + 8000 } : null;
  toast({ message, ...(undo ? { action: { label: "Undo", run: undo } } : {}) });
}

/** "z": undo the last action while its toast is up. True when there was one. */
export function undoLast(): boolean {
  const u = lastUndo;
  if (!u || Date.now() > u.until) return false;
  lastUndo = null;
  u.run();
  return true;
}

/** "Moved 3 messages to Trash", "Moved the conversation to Trash". */
export function trashLine(r: TrashResult, conversation: boolean): string {
  const held = r.archived.length + r.kept.length;
  if (held && !r.trashed.length) {
    return r.archived.length ? "Mail is on hold, so nothing was deleted. What you received was archived instead." : "Mail is on hold, so nothing was deleted.";
  }
  const what = conversation ? (r.trashed.length === 1 ? "the message" : "the conversation") : r.trashed.length === 1 ? "the message" : `${r.trashed.length} messages`;
  const tail = held ? ` ${held} on hold ${held === 1 ? "was" : "were"} kept.` : "";
  return `Moved ${what} to Trash.${tail}`;
}

/** What the page's actions act on: the list, the open message, and the navigation's refs. */
type Deps = {
  folder: MailFolder;
  q: string;
  cache: RefObject<Map<string, MailMessage>>;
  listRef: RefObject<ListState | null>;
  setList: Dispatch<SetStateAction<ListState | null>>;
  setListError: Dispatch<SetStateAction<string | null>>;
  reread: () => void;
  refreshActive: () => void;
  patchRow: (id: string, patch: Partial<MailSummary>) => void;
  setOpen: Dispatch<SetStateAction<{ id: string; message: MailMessage | null; error: string | null } | null>>;
  thread: { id: string; messages: MailMessage[] } | null;
  setThread: Dispatch<SetStateAction<{ id: string; messages: MailMessage[] } | null>>;
  setFreshId: Dispatch<SetStateAction<string | null>>;
  setDraft: Dispatch<SetStateAction<Draft | null>>;
  closeMessage: () => void;
  setParams: SetURLSearchParams;
  openIdRef: RefObject<string | null>;
  navStateRef: RefObject<unknown>;
  queryRef: RefObject<(extra?: Record<string, string>) => Record<string, string>>;
  mountedRef: RefObject<boolean>;
};

/** Archive, delete, restore, star, unread, undo and the rest: each changes the list and the open message at once, then says so. */
export function useMailActions({
  folder,
  q,
  cache,
  listRef,
  setList,
  setListError,
  reread,
  refreshActive,
  patchRow,
  setOpen,
  thread,
  setThread,
  setFreshId,
  setDraft,
  closeMessage,
  setParams,
  openIdRef,
  navStateRef,
  queryRef,
  mountedRef,
}: Deps) {
  function dropFromList(ids: string[]) {
    const gone = new Set(ids);
    // The one after it (or before, at the end), to open in its place, as Gmail does after an archive.
    const all = listRows(listRef.current);
    const at = all.findIndex((m) => openIdRef.current && m.id === openIdRef.current);
    const after = at >= 0 ? all.slice(at + 1).find((m) => !gone.has(m.id)) : undefined;
    const before = at >= 0 ? [...all.slice(0, at)].reverse().find((m) => !gone.has(m.id)) : undefined;
    setList((prev) => prev && eachRow(prev, (rows) => rows.filter((m) => !gone.has(m.id))));
    for (const id of ids) cache.current.delete(id);
    // Only if it's still the one open (and the page is still here).
    if (!mountedRef.current || !openIdRef.current || !gone.has(openIdRef.current)) return;
    const next = after ?? before;
    if (next) setParams(queryRef.current({ m: next.id }), { replace: true, state: navStateRef.current });
    else closeMessage();
  }

  const failOn = (id: string, e: unknown) => setOpen((o) => (o && o.id === id ? { ...o, error: (e as Error).message } : o));

  /** Run an action's reverse, then read the list again. */
  async function undoWith(reverse: () => Promise<unknown>) {
    dismissToast();
    lastUndo = null;
    try {
      await reverse();
      cache.current.clear();
      reread();
      notifyMailChanged();
      notify("Undone");
    } catch (e) {
      setListError((e as Error).message);
    }
  }

  /** In Active (no search) a row is its whole conversation. */
  const wholeNow = () => {
    const cur = listRef.current;
    return cur?.folder === "active" && !cur.q;
  };

  async function move(m: MailMessage, to: "inbox" | "archive") {
    try {
      // From Active, Archive takes the whole conversation out (sent copies stay in Sent).
      const whole = wholeNow();
      await moveMail([m.id], to, { conversation: to === "archive" && whole });
      dropFromList([m.id]);
      refreshActive();
      notifyMailChanged();
      const back = to === "archive" ? "inbox" : "archive";
      notify(to === "archive" ? (whole ? "Archived the conversation" : "Archived") : "Moved to your inbox", () => void undoWith(() => moveMail([m.id], back, { conversation: whole })));
    } catch (e) {
      failOn(m.id, e);
    }
  }

  /** Archive straight from a row (a swipe): the same as from the reader, with Undo. */
  async function archiveRow(m: MailSummary) {
    try {
      const whole = wholeNow();
      await moveMail([m.id], "archive", { conversation: whole });
      dropFromList([m.id]);
      refreshActive();
      notifyMailChanged();
      notify(whole ? "Archived the conversation" : "Archived", () => void undoWith(() => moveMail([m.id], "inbox", { conversation: whole })));
    } catch (e) {
      setListError((e as Error).message);
    }
  }

  /** Undo a Delete: everything that went to Trash comes back, and anything a hold archived goes back to the inbox. */
  const undoTrash = (r: TrashResult) => () =>
    void undoWith(async () => {
      if (r.trashed.length) await restoreMail(r.trashed);
      if (r.archived.length) await moveMail(r.archived, "inbox");
    });

  /** Delete: into Trash for 30 days, at once, with Undo (§11.1: it can be undone, so it isn't asked). */
  async function remove(m: MailMessage) {
    try {
      const whole = wholeNow();
      const r = await trashMail([m.id], { conversation: whole });
      dropFromList([m.id, ...r.trashed, ...r.archived]);
      refreshActive();
      notifyMailChanged();
      notify(trashLine(r, whole), r.trashed.length || r.archived.length ? undoTrash(r) : undefined);
    } catch (e) {
      failOn(m.id, e);
    }
  }

  /** Out of Trash, from the reader. */
  async function restore(m: MailMessage) {
    try {
      const r = await restoreMail([m.id]);
      dropFromList(r.restored.length ? r.restored : [m.id]);
      notifyMailChanged();
      notify("Restored from Trash", () => void undoWith(() => trashMail(r.restored)));
    } catch (e) {
      failOn(m.id, e);
    }
  }

  /** Delete forever, from Trash: asked first, because it can't be undone. */
  async function purge(m: MailMessage) {
    const files = m.attachments?.length ?? 0;
    const ok = await confirm({
      title: "Delete this message forever?",
      object: {
        name: m.subject || "(no subject)",
        detail: `${m.direction === "out" ? "To" : "From"} ${senderLabel(m.direction === "out" ? (m.to[0] ?? m.from) : m.from)} · ${format.date(m.occurredAt, "medium")}`,
      },
      message: `It${files ? ` and its ${files === 1 ? "attachment" : `${files} attachments`}` : ""} will be removed from BFO. A record of who deleted it, and when, is kept.`,
      irreversible: true,
      confirmLabel: "Delete forever",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const r = await purgeMail([m.id]);
      if (r.kept) {
        failOn(m.id, new Error("This message is kept for records, so it can't be deleted forever."));
        return;
      }
      dropFromList([m.id]);
      notifyMailChanged();
      notify("Deleted forever");
    } catch (e) {
      failOn(m.id, e);
    }
  }

  /** Keep for records, or stop (owner). */
  async function hold(m: MailMessage, on: boolean) {
    try {
      await holdMail([m.id], on);
      const kept = on ? ("message" as const) : null;
      setOpen((o) => (o && o.id === m.id && o.message ? { ...o, message: { ...o.message, kept, held: on } } : o));
      patchRow(m.id, { held: on });
      const hit = cache.current.get(m.id);
      if (hit) cache.current.set(m.id, { ...hit, kept, held: on });
      notify(on ? "Kept for records. It can't be deleted until an owner releases it." : "No longer kept for records");
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
      // Starred mail sits at the top: read the list again so it moves there (or back to its date).
      const cur = listRef.current;
      if (cur && cur.filter === "all" && !cur.q && !cur.attachments) reread();
    } catch (e) {
      patchRow(m.id, { starred: !starred });
      if (hit) cache.current.set(m.id, { ...hit, starred: !starred });
      setOpen((o) => (o && o.id === m.id && o.message ? { ...o, message: { ...o.message, starred: !starred }, error: (e as Error).message } : o));
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
      notify("Marked as unread", () => void undoWith(() => markRead([m.id], true)));
    } catch (e) {
      failOn(m.id, e);
    }
  }

  function onSent(sent: MailSummary, about?: string) {
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
    const cur = listRef.current;
    if (folder === "sent" && cur?.folder === "sent" && cur.filter === "all" && !q) setList((prev) => prev && { ...prev, messages: [sent, ...prev.messages.filter((m) => m.id !== sent.id)] });
    // In Active, the conversation just replied to moves to the top.
    refreshActive();
    notifyMailChanged();
    setDraft(null);
  }

  return { dropFromList, move, archiveRow, remove, restore, purge, hold, star, undoWith, undoTrash, markUnread, onSent };
}
