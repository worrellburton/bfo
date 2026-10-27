import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { getUser, isAdmin } from "../auth";
import { confirmDialog } from "../confirm-dialog";
import { Button, ErrorLine, Icon, IconButton, TextButton, useTone } from "../entity/ui";
import { MailAurora, mailboxHue } from "../mail-aurora";
import { ListLoader, SearchLoader } from "../mail-loaders";
import { PullToRefresh } from "../mail-pull";
import { enablePush, usePushState } from "../push";
import { phoneScreen, supportsViewTransitions, transition } from "../view-transition";
import {
  deleteMail,
  getFaces,
  getMessage,
  markRead,
  moveMail,
  notifyMailChanged,
  starMail,
  syncMail,
  useMailCount,
  type MailFaces,
  type MailFilter,
  type MailFolder,
  type MailMessage,
  type MailSummary,
} from "../mail-client";
import { Glyph, Star } from "../mail/glyphs";
import { dayGroup, same, tap } from "../mail/helpers";
import { FacesContext } from "../mail/avatar";
import { EMPTY, FILTERS, FOLDERS, NOTHING, VIEW_KEY, savedView, type View } from "../mail/constants";
import { eachRow, listRows } from "../mail/list-state";
import { ReadingProgress, SearchField, Segmented, SelectBox, ThemeButton } from "../mail/controls";
import { FolderMenu } from "../mail/folder-menu";
import { blankDraft, forwardDraft, replyDraft, type Draft } from "../mail/drafts";
import { MyPhoto } from "../mail/my-photo";
import { MailboxPicker } from "../mail/mailbox-picker";
import { Compose } from "../mail/composer";
import { Reader } from "../mail/reader";
import { ListRow } from "../mail/list-row";
import { MailTable } from "../mail/table";
import { useMailList } from "../mail/use-mail-list";
import { useMailTheme } from "../mail/use-mail-theme";
import { useOpenMessage } from "../mail/use-open-message";

export function meta() {
  return [{ title: "BFO - Mail" }];
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function Inbox() {
  const t = useTone();
  const me = getUser();
  const count = useMailCount();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();

  const canSeeOther = count ? count.canSeeOther : isAdmin(me);
  const f = params.get("f");
  // Active (in and out together, by conversation) unless the URL picks another.
  const folder: MailFolder = f === "inbox" || f === "sent" || f === "archive" || (f === "other" && canSeeOther) ? f : "active";
  const v = params.get("v");
  const filter: MailFilter = v === "unread" || v === "starred" || v === "unread-starred" ? v : "all";
  /** Search text from the URL; while set, every folder is searched. */
  const q = (params.get("q") ?? "").trim();
  const openId = params.get("m");
  // Until the count answers, the session's copy will do. null from the server: no address yet.
  const address = (count ? count.address : me?.mailAddress) || "";
  const noAddress = !!count && !count.address;
  const aliases = useMemo(() => (address ? (count?.aliases ?? []) : []), [address, count?.aliases]);
  const mine = useMemo(() => (address ? [address, ...aliases] : []), [address, aliases]);
  /** One mailbox (an address of mine) from the URL, or every one. */
  const a = (params.get("a") ?? "").toLowerCase();
  const box = mine.some((m) => m.toLowerCase() === a) ? a : "";

  const [view, setView] = useState<View>("table");
  useEffect(() => setView(savedView()), []);
  function chooseView(next: View) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // A preference that doesn't stick is no loss.
    }
  }

  const [draft, setDraft] = useState<Draft | null>(null);
  /** A short note after an action; with `undo`, a button (and "z") puts it back. */
  const [toast, setToastState] = useState<{ text: string; undo?: () => void } | null>(null);
  const [toastLeaving, setToastLeaving] = useState(false);
  const setToast = (text: string | null, undo?: () => void) => {
    setToastLeaving(false);
    setToastState(text ? { text, undo } : null);
  };
  const { toggleMailTheme } = useMailTheme();
  /** Everyone's chosen pictures, by address; asked for once per visit. */
  const [faces, setFaces] = useState<MailFaces>({});
  useEffect(() => {
    let alive = true;
    getFaces()
      .then((r) => alive && setFaces(r.faces ?? {}))
      .catch(() => {}); // Initials and logos will do.
    return () => {
      alive = false;
    };
  }, []);
  /** Messages picked for a bulk action, and the last one clicked (shift-click picks the range from it). */
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const pickAnchor = useRef<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const { list, setList, listError, setListError, loadingMore, listRef, loaderLeaving, rowsFresh, loadList, loadMore, refreshActive, patchRow } = useMailList({ folder, filter, q, box, count });

  const { cache, open, setOpen, thread, setThread, freshId, setFreshId } = useOpenMessage({ openId, listRef, patchRow });

  /** The page's own query string: folder and filter, plus the open message. */
  function query(extra: Record<string, string> = {}): Record<string, string> {
    const next: Record<string, string> = {};
    if (folder !== "active") next.f = folder;
    if (filter !== "all") next.v = filter;
    if (q) next.q = q;
    return { ...next, ...extra };
  }

  // The page's transitions (view-transition.ts) wait for the navigation to land: a location change settles them.
  const settle = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    settle.current?.();
    settle.current = null;
  }, [location.key]);
  /** Navigate inside a page transition on phones (list → message, message → list); plain on larger screens. */
  function go(dir: "forward" | "back", nav: () => void) {
    if (!phoneScreen() || !supportsViewTransitions()) return nav();
    void transition(
      "mail",
      dir,
      () =>
        new Promise<void>((resolve) => {
          settle.current = resolve;
          window.setTimeout(resolve, 800); // never hang on a navigation that didn't change the location
          nav();
        }),
    );
  }

  /** The finger is on a row: fetch its message now (without marking it read), so the open is instant when the tap lands. */
  const prefetching = useRef(new Set<string>());
  function prefetch(id: string) {
    if (cache.current.has(id) || prefetching.current.has(id)) return;
    prefetching.current.add(id);
    const cur = listRef.current;
    getMessage(id, { conversation: cur?.folder === "active" && !cur.q, peek: true })
      .then(({ message }) => cache.current.set(id, message))
      .catch(() => undefined)
      .finally(() => prefetching.current.delete(id));
  }
  /** Back from a message: its row glows for a moment, so the eye lands where it left. */
  const [returnedId, setReturnedId] = useState<string | null>(null);

  function select(id: string) {
    if (!openId) tap();
    // From the list: push, so Back returns to it. Between messages: replace. The message's page starts at its top.
    go("forward", () => {
      setParams(query({ m: id }), openId ? { replace: true, state: location.state } : { state: { fromList: true } });
      if (!openId) window.scrollTo(0, 0);
    });
  }

  // Read through refs, so a move/delete that resolves later acts on what's open now.
  const openIdRef = useRef(openId);
  openIdRef.current = openId;
  const navStateRef = useRef(location.state);
  navStateRef.current = location.state;
  const queryRef = useRef(query);
  queryRef.current = query;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function closeMessage() {
    const was = openIdRef.current;
    if (was) {
      setReturnedId(was);
      window.setTimeout(() => setReturnedId((r) => (r === was ? null : r)), 1600);
    }
    go("back", () => {
      if ((navStateRef.current as { fromList?: boolean } | null)?.fromList) navigate(-1);
      else setParams(queryRef.current(), { replace: true });
    });
  }

  /** The phone menu: folder and filter in one step (Starred is a place there). Ends a search. */
  function choosePlace(nextFolder: MailFolder, nextFilter: MailFilter) {
    if (nextFolder === folder && nextFilter === filter && !openId && !q) return;
    const p: Record<string, string> = {};
    if (nextFolder !== "active") p.f = nextFolder;
    if (nextFilter !== "all") p.v = nextFilter;
    if (box) p.a = box;
    setParams(p);
  }

  /** Picking a folder ends a search; changing the filter narrows it. */
  function chooseFolder(next: MailFolder) {
    if (next === folder && !openId && !q) return;
    const p: Record<string, string> = {};
    if (next !== "active") p.f = next;
    if (filter !== "all") p.v = filter;
    if (box) p.a = box;
    setParams(p);
  }

  function chooseFilter(next: MailFilter) {
    if (next === filter && !openId) return;
    const p: Record<string, string> = {};
    if (folder !== "active") p.f = folder;
    if (next !== "all") p.v = next;
    if (q) p.q = q;
    if (box) p.a = box;
    setParams(p);
  }

  /** Set the search text (the URL carries it, so Back and reload keep it). */
  function search(term: string) {
    const clean = term.trim();
    if (clean === q) return;
    const p: Record<string, string> = {};
    if (folder !== "active") p.f = folder;
    if (filter !== "all") p.v = filter;
    if (clean) p.q = clean;
    if (box) p.a = box;
    setParams(p, { replace: true });
  }

  /** Show one mailbox (an address of mine), or all of them. */
  function chooseBox(next: string) {
    if (next === box) return;
    const p: Record<string, string> = {};
    if (folder !== "active") p.f = folder;
    if (filter !== "all") p.v = filter;
    if (q) p.q = q;
    if (next) p.a = next;
    setParams(p);
  }

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

  // ── Keys (Gmail's, listed on "?"): j/k next/previous, o open, e archive, # delete, r/a/f reply/all/forward,
  // s star, x select, U unread, c new, u back to the list, z undo. Never while typing or over a dialog.
  // Bound fresh each render, so every key acts on the list and message showing now.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (draft || document.querySelector('[aria-modal="true"]')) return;
      const all = listRows(listRef.current);
      const openRow = open?.message ?? null;
      const focusedId = (document.activeElement as HTMLElement | null)?.closest?.("[data-mail-row]")?.getAttribute("data-mail-row") ?? null;
      const focused = focusedId ? all.find((m) => m.id === focusedId) ?? null : null;
      const act = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      switch (e.key) {
        case "j":
        case "k": {
          const step = e.key === "j" ? 1 : -1;
          if (openId) {
            const next = all[all.findIndex((m) => m.id === openId) + step];
            if (next) act(() => select(next.id));
            return;
          }
          // In the list: move focus row by row (the visible list: table on desktop, rows on phones).
          const rowsShown = [...document.querySelectorAll<HTMLElement>("[data-mail-row]")].filter((r) => r.offsetParent !== null);
          const at = rowsShown.findIndex((r) => r.getAttribute("data-mail-row") === focusedId);
          const target = rowsShown[at < 0 ? 0 : Math.min(rowsShown.length - 1, Math.max(0, at + step))];
          if (target) act(() => {
            target.focus();
            target.scrollIntoView({ block: "nearest" });
          });
          return;
        }
        case "o":
          if (focused && !openId) act(() => select(focused.id));
          return;
        case "u":
          if (openId) act(() => closeMessage());
          return;
        case "e":
          if (openRow && (openRow.direction === "in" || folder === "active") && openRow.folder !== "archive") act(() => void move(openRow, "archive"));
          // Only where the bulk bar offers Archive: Active, and received mail in In.
          else if (!openId && picked.size && (folder === "active" || (folder === "inbox" && pickedRows.some((m) => m.direction === "in")))) act(() => void bulk("archive"));
          else if (!openId && !picked.size && focused && (folder === "active" || (folder === "inbox" && focused.direction === "in"))) act(() => void bulk("archive", [focused.id]));
          return;
        case "#":
          if (openRow) act(() => void remove(openRow));
          else if (picked.size) act(() => void bulk("delete"));
          else if (focused) act(() => void bulk("delete", [focused.id]));
          return;
        case "r":
        case "a":
        case "f":
          if (!openRow || noAddress) return;
          act(() => setDraft(e.key === "f" ? forwardDraft(openRow) : replyDraft(openRow, e.key === "a" ? "all" : "reply", mine)));
          return;
        case "s":
          if (openRow) act(() => void star(openRow, !openRow.starred, false));
          else if (focused) act(() => void star(focused, !focused.starred));
          return;
        case "x":
          if (focused) act(() => pick(focused.id, false));
          return;
        case "U":
          if (openRow && openRow.direction === "in") act(() => void markUnread(openRow));
          else if (!openId && picked.size) act(() => void bulk("unread"));
          return;
        case "c":
          if (!noAddress) act(() => setDraft(blankDraft(box || undefined)));
          return;
        case "z":
          if (toast?.undo) act(() => toast.undo?.());
          return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!toast) return;
    // Long enough to reach Undo when there is one.
    const total = toast.undo ? 6000 : 2200;
    const leave = setTimeout(() => setToastLeaving(true), total - 200);
    const id = setTimeout(() => {
      setToastState(null);
      setToastLeaving(false);
    }, total);
    return () => { clearTimeout(id); clearTimeout(leave); };
  }, [toast]);

  const syncError = isAdmin(me) ? count?.sync?.error : undefined;
  const folders = FOLDERS.filter((x) => x.key !== "other" || canSeeOther);
  const rows = list && list.folder === folder && list.filter === filter && list.q === q && list.to === box ? listRows(list) : null;

  // Another folder, filter, search or mailbox starts with nothing picked.
  useEffect(() => {
    setPicked(new Set());
    pickAnchor.current = null;
  }, [folder, filter, q, box]);

  // Esc lets go of the selection (when no message is open to close first).
  useEffect(() => {
    if (!picked.size) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !openIdRef.current && !draft) setPicked(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked.size, draft]);

  function pick(id: string, shift: boolean) {
    const ids = (rows ?? []).map((m) => m.id);
    setPicked((prev) => {
      const next = new Set(prev);
      const turnOn = !prev.has(id);
      const from = shift && pickAnchor.current ? ids.indexOf(pickAnchor.current) : -1;
      const to = ids.indexOf(id);
      if (from >= 0 && to >= 0) {
        // The whole range takes the clicked one's new state.
        for (const x of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) turnOn ? next.add(x) : next.delete(x);
      } else if (turnOn) next.add(id);
      else next.delete(id);
      return next;
    });
    pickAnchor.current = id;
  }

  function pickAll() {
    const ids = (rows ?? []).map((m) => m.id);
    setPicked((prev) => (ids.length && ids.every((x) => prev.has(x)) ? new Set() : new Set(ids)));
    pickAnchor.current = null;
  }

  /** Read or unread, archive or back to the inbox, or delete: for every picked message at once. */
  async function bulk(action: "read" | "unread" | "archive" | "inbox" | "delete", only?: string[]) {
    // The picked rows, or (from a key) just the one in focus.
    const ids = only ?? (rows ?? []).filter((m) => picked.has(m.id)).map((m) => m.id);
    if (!ids.length || bulkBusy) return;
    // In Active each row is a conversation: Archive and Delete take all of it.
    const whole = folder === "active" && !q;
    if (action === "delete") {
      const ok = await confirmDialog(
        whole
          ? { title: `Delete ${ids.length} conversation${ids.length === 1 ? "" : "s"}?`, message: "Every message in them, received and sent, is deleted for good.", confirmLabel: "Delete", tone: "danger" }
          : { title: `Delete ${ids.length} message${ids.length === 1 ? "" : "s"}?`, confirmLabel: "Delete", tone: "danger" }
      );
      if (!ok) return;
    }
    setBulkBusy(true);
    try {
      if (action === "read" || action === "unread") {
        const read = action === "read";
        await markRead(ids, read);
        setList((prev) => prev && eachRow(prev, (rows) => rows.map((m) => (picked.has(m.id) ? { ...m, read } : m))));
        for (const id of ids) cache.current.delete(id);
        setToast(read ? `Marked ${ids.length} as read` : `Marked ${ids.length} as unread`, () => undoWith(() => markRead(ids, !read)));
      } else {
        if (action === "delete") await deleteMail(ids, { conversation: whole });
        else await moveMail(ids, action, { conversation: whole && action === "archive" });
        const gone = new Set(ids);
        setList((prev) => prev && eachRow(prev, (rows) => rows.filter((m) => !gone.has(m.id))));
        for (const id of ids) cache.current.delete(id);
        if (openIdRef.current && gone.has(openIdRef.current)) closeMessage();
        setPicked(new Set());
        refreshActive();
        if (action === "delete") setToast(`Deleted ${ids.length}`);
        else {
          const back = action === "archive" ? "inbox" : "archive";
          setToast(action === "archive" ? `Archived ${ids.length}` : `Moved ${ids.length} to the inbox`, () => undoWith(() => moveMail(ids, back, { conversation: whole })));
        }
      }
      notifyMailChanged();
    } catch (e) {
      setListError((e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  }
  const sent = folder === "sent";
  /** Active mixes both ways: each row says whether it came in or went out. */
  const mixed = folder === "active" && !q;
  // In the table, the open message takes the whole card; in columns, it sits beside the list.
  const tableReading = view === "table" && !!openId;

  const emptyText = () => {
    if (q) return `Nothing matches “${q}”.`;
    if ((folder === "inbox" || folder === "active") && noAddress) return "No address yet. Ask an admin.";
    return NOTHING[filter] || EMPTY[folder];
  };

  const reader = (
    <Reader
      key={openId ?? undefined}
      message={open?.message ?? null}
      error={open?.error ?? null}
      me={address}
      backAlways={view === "table"}
      onBack={closeMessage}
      onReply={(m, mode) => setDraft(replyDraft(m, mode, mine))}
      onForward={(m) => setDraft(forwardDraft(m))}
      onMove={move}
      onDelete={remove}
      onStar={(m, on) => star(m, on, false)}
      onUnread={markUnread}
      thread={thread && thread.id === open?.id ? thread.messages : []}
      wholeConversation={folder === "active" && !q}
      freshId={freshId}
      preview={openId ? (rows ?? []).find((r) => r.id === openId) ?? null : null}
    />
  );

  const pickedRows = (rows ?? []).filter((m) => picked.has(m.id));
  const bulkBar = pickedRows.length > 0 && rows && (
    <div
      role="toolbar"
      aria-label="Selected messages"
      className={`pick-bar-in sticky top-0 z-[2] flex flex-wrap items-center gap-1 border-b px-3 py-1.5 backdrop-blur-xl ${t.line} ${t.dark ? "bg-[#14152a]/95" : "bg-(--mail-accent-deep)/10/95"}`}
    >
      <SelectBox
        on={pickedRows.length === rows.length}
        mixed={pickedRows.length < rows.length}
        onToggle={() => pickAll()}
        label={pickedRows.length === rows.length ? "Unselect all" : "Select all"}
      />
      <span className={`mr-2 text-[12.5px] font-medium tabular-nums ${t.text}`}>{pickedRows.length} selected</span>
      {pickedRows.length < rows.length && (
        <button type="button" onClick={() => pickAll()} className={`mr-1 cursor-pointer text-[12px] hover:underline ${t.accent}`}>
          Select all {rows.length}
        </button>
      )}
      <span className="flex-1" />
      {pickedRows.some((m) => !m.read) && (
        <Button kind="ghost" disabled={bulkBusy} onClick={() => void bulk("read")}>
          Mark read
        </Button>
      )}
      {pickedRows.some((m) => m.read) && (
        <Button kind="ghost" disabled={bulkBusy} onClick={() => void bulk("unread")}>
          Mark unread
        </Button>
      )}
      {(folder === "active" || (folder === "inbox" && pickedRows.some((m) => m.direction === "in"))) && (
        <Button kind="ghost" disabled={bulkBusy} onClick={() => void bulk("archive")}>
          Archive
        </Button>
      )}
      {folder === "archive" && (
        <Button kind="ghost" disabled={bulkBusy} onClick={() => void bulk("inbox")}>
          Move to inbox
        </Button>
      )}
      <Button kind="ghost" disabled={bulkBusy} onClick={() => void bulk("delete")}>
        Delete
      </Button>
      <IconButton icon="x" label="Clear selection (Esc)" onClick={() => setPicked(new Set())} />
    </div>
  );

  // The iPhone app: invite notifications for new mail once, until answered (app/push.ts).
  const [pushAsk, setPushAsk] = usePushState();
  const [pushDismissed, setPushDismissed] = useState(true);
  useEffect(() => {
    try {
      setPushDismissed(localStorage.getItem("bfo-push-ask") === "no");
    } catch {
      setPushDismissed(false);
    }
  }, []);
  const pushInvite =
    pushAsk === "prompt" && !pushDismissed && rows && !q ? (
      <div className={`row-in mx-4 mb-2 mt-1 rounded-2xl border p-3.5 md:hidden ${t.dark ? "border-white/[0.08] bg-white/[0.05]" : "border-gray-200 bg-white/80"}`}>
        <div className="flex items-center gap-3">
          <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${t.dark ? "bg-(--mail-accent-deep)/25 text-(--mail-accent-pale)" : "bg-(--mail-accent-deep)/10 text-(--mail-accent-ink)"}`}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block text-[14px] font-semibold ${t.text}`}>Know when mail arrives</span>
            <span className={`block text-[12.5px] ${t.muted}`}>A notification on this phone for new mail.</span>
          </span>
        </div>
        <div className="mt-2.5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem("bfo-push-ask", "no");
              } catch {
                // for this visit
              }
              setPushDismissed(true);
            }}
            className={`h-[40px] shrink-0 cursor-pointer rounded-full px-3 text-[13px] font-medium ${t.muted}`}
          >
            Not now
          </button>
          <button type="button" onClick={async () => setPushAsk(await enablePush())} className="fab-glass h-[40px] shrink-0 cursor-pointer rounded-full px-5 text-[13px] font-semibold">
            Turn on
          </button>
        </div>
      </div>
    ) : null;

  const listBody = !rows ? (
    listError ? <ErrorLine>{listError}</ErrorLine> : (
      <div className={loaderLeaving ? "loader-out" : ""}>{q ? <SearchLoader term={q} /> : <ListLoader table={view === "table"} label={folder === "sent" ? "Fetching sent mail" : folder === "archive" ? "Fetching the archive" : "Fetching mail"} />}</div>
    )
  ) : rows.length === 0 ? (
    <div className="px-5 py-10 text-center">
      <div className={`row-in mx-auto max-w-[320px] rounded-3xl border px-6 py-8 mail-glass-top ${t.dark ? "border-white/[0.08] bg-white/[0.03]" : "border-gray-200 bg-white/70"}`}>
        <span
          aria-hidden="true"
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full text-white"
          style={{ background: `linear-gradient(135deg, hsl(var(--mail-hue) var(--mail-sat) 60%), hsl(calc(var(--mail-hue) + 28) var(--mail-sat) 62%))`, boxShadow: `0 0 36px hsl(var(--mail-hue) var(--mail-sat) 60% / 0.45)` }}
        >
          <Icon name="mail" className="h-6 w-6" strokeWidth={1.6} />
        </span>
        <p className={`text-[14px] font-medium ${t.text}`}>{emptyText()}</p>
        {(folder === "inbox" || folder === "active") && filter === "all" && !q && address && <p className={`mt-1 text-[12.5px] ${t.muted}`}>{address}</p>}
        {(folder === "inbox" || folder === "active") && filter === "all" && !q && <p className={`mt-3 text-[12px] ${t.faint}`}>Enjoy the quiet.</p>}
      </div>
    </div>
  ) : (
    <>
      {view === "table" ? (
        <>
          <MailTable rows={rows} sent={sent} mixed={mixed} me={address} onOpen={select} onStar={star} picked={picked} onPick={pick} onPickAll={pickAll} className="max-md:hidden" />
          <ul className="md:hidden">
            {rows.map((m, i) => {
              const pinnedIds = new Set((list?.pinned ?? []).map((p) => p.id));
              const groupOf = (x: MailSummary) => (pinnedIds.has(x.id) ? "Starred" : dayGroup(x.occurredAt));
              const group = groupOf(m);
              const first = i === 0 || groupOf(rows[i - 1]) !== group;
              return (
                <Fragment key={m.id}>
                  {first && !q && (
                    <li aria-hidden="true" className={`${rowsFresh ? "row-in" : ""} px-5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.14em] first:pt-1 ${t.faint}`} style={{ animationDelay: `${Math.min(i, 12) * 28}ms` }}>
                      {group}
                    </li>
                  )}
                  <li className={`${rowsFresh ? "row-in" : ""} ${m.id === returnedId ? "row-return" : ""}`} style={{ animationDelay: `${Math.min(i, 12) * 28}ms` }}>
                    <ListRow m={m} sent={sent || (mixed && m.direction === "out")} me={address} selected={false} onOpen={() => select(m.id)} onPrefetch={() => prefetch(m.id)} onStar={(on) => star(m, on)} picked={picked.has(m.id)} picking={picked.size > 0} onPick={(shift) => pick(m.id, shift)} onArchive={m.folder === "archive" ? undefined : () => void archiveRow(m)} />
                  </li>
                </Fragment>
              );
            })}
          </ul>
        </>
      ) : (
        <ul className={`divide-y ${t.divide}`}>
          {rows.map((m) => (
            <li key={m.id}>
              <ListRow m={m} sent={sent || (mixed && m.direction === "out")} me={address} selected={m.id === openId} onOpen={() => select(m.id)} onPrefetch={() => prefetch(m.id)} onStar={(on) => star(m, on)} picked={picked.has(m.id)} picking={picked.size > 0} onPick={(shift) => pick(m.id, shift)} />
            </li>
          ))}
        </ul>
      )}
      {listError && <ErrorLine>{listError}</ErrorLine>}
      {list?.hasMore && (
        <div className={`border-t p-2 ${t.line}`}>
          <Button kind="ghost" className="w-full" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </>
  );

  const toolbar = (
    /* A container, so the narrow list of a tablet's split view can drop the filters (the folder chips scroll). */
    <div className={`@container flex shrink-0 items-center gap-2 border-b px-1.5 py-1.5 max-md:border-0 max-md:px-0 max-md:pb-2 max-md:pt-0 ${t.line}`}>
      {q ? (
        <div className={`flex min-w-0 flex-1 items-center gap-2 px-2 text-[12.5px] max-md:px-1 max-md:text-[13.5px] ${t.muted}`}>
          <span className="truncate">
            {rows ? `${rows.length}${list?.hasMore ? "+" : ""} result${rows.length === 1 ? "" : "s"}` : "Searching"} in all mail
          </span>
          <TextButton onClick={() => search("")} className={`shrink-0 ${t.accent}`}>
            Clear
          </TextButton>
        </div>
      ) : (
      <>
      <div className="mx-1 flex min-w-0 flex-1 md:hidden">
        <FolderMenu folders={folders} folder={folder} filter={filter} count={count ? { unread: count.unread, otherUnread: count.otherUnread } : null} onPick={choosePlace} />
      </div>
      <nav aria-label="Folders" className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-md:hidden">
        {folders.map((x) => {
          const on = x.key === folder;
          const n = x.key === "inbox" || x.key === "active" ? count?.unread : x.key === "other" ? count?.otherUnread : 0;
          // Active isn't a folder like the rest (it's In and Out together, as conversations): its own colour and mark, and a rule after it.
          const live = x.key === "active";
          const tone = live
            ? on
              ? t.dark ? "bg-(--mail-accent-deep)/25 text-(--mail-accent-pale) ring-1 ring-inset ring-(--mail-accent)/50" : "bg-(--mail-accent-deep) text-white"
              : t.dark ? "text-(--mail-accent) ring-1 ring-inset ring-(--mail-accent)/25 hover:bg-(--mail-accent-deep)/10 hover:text-(--mail-accent-pale)" : "text-(--mail-accent-ink) ring-1 ring-inset ring-(--mail-accent-deep)/30 hover:bg-(--mail-accent-deep)/10"
            : on
              ? t.dark ? "bg-white/[0.09] text-white" : "bg-gray-900 text-white"
              : t.dark ? "text-gray-400 hover:text-gray-200" : "text-gray-500 hover:text-gray-900";
          const badge = live
            ? on
              ? t.dark ? "bg-(--mail-accent)/30 text-white" : "bg-white/20 text-white"
              : t.dark ? "bg-(--mail-accent-deep)/20 text-(--mail-accent-pale)" : "bg-(--mail-accent-deep)/15 text-(--mail-accent-ink)"
            : on
              ? "bg-white/15 text-white"
              : t.dark ? "bg-white/[0.07] text-gray-300" : "bg-gray-100 text-gray-600";
          return (
            <Fragment key={x.key}>
              <button
                type="button"
                aria-current={on ? "page" : undefined}
                onClick={() => chooseFolder(x.key)}
                title={live ? "In (inbox) and Out (sent) together, a row per conversation, latest activity first" : undefined}
                className={`inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[12.5px] font-medium transition-colors max-md:h-[38px] max-md:rounded-[10px] max-md:px-3.5 max-md:text-[13.5px] ${live ? "font-semibold" : ""} ${tone}`}
              >
                {live && <Glyph name="chats" className="h-3.5 w-3.5" />}
                {x.label}
                {!!n && <span className={`min-w-[18px] rounded-full px-1.5 text-center text-[10.5px] tabular-nums leading-[18px] ${badge}`}>{n}</span>}
              </button>
              {live && <span aria-hidden="true" className={`mx-1.5 my-1 w-px shrink-0 self-stretch max-md:hidden ${t.dark ? "bg-white/10" : "bg-gray-200"}`} />}
            </Fragment>
          );
        })}
      </nav>
      </>
      )}
      <Segmented
        label="Show"
        value={filter}
        onChange={chooseFilter}
        className="max-md:hidden @max-[440px]:hidden"
        options={FILTERS.map((x) => ({ key: x.key, label: x.label, icon: x.key === "starred" ? <Star on className="h-3 w-3" /> : undefined }))}
      />
    </div>
  );

  // Phones: the title shrinks into a glass bar as the list scrolls under it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 28);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // Mail that arrived since the list was read: offer it, don't shuffle the list under a thumb.
  const seenUnread = useRef<number | null>(null);
  const [freshMail, setFreshMail] = useState(false);
  useEffect(() => {
    const n = count?.unread;
    if (n === undefined) return;
    if (seenUnread.current === null) seenUnread.current = n;
    else if (n > seenUnread.current && (folder === "active" || folder === "inbox") && !q) setFreshMail(true);
    seenUnread.current = n;
  }, [count?.unread, folder, q]);
  useEffect(() => setFreshMail(false), [list?.messages[0]?.id, folder, box, q]);
  /** Pulled down on a phone: ask Bird for new mail, then read the list and the count again. */
  async function refreshFromPull(): Promise<{ fresh: number }> {
    const r = await syncMail().catch(() => ({ ingested: 0 }));
    const cur = listRef.current;
    if (cur) await loadList(cur.folder, cur.filter, cur.q, cur.to, "reset");
    // What this pull brought in is already on screen: no "New mail" pill for it.
    seenUnread.current = Number.POSITIVE_INFINITY;
    notifyMailChanged();
    return { fresh: r.ingested ?? 0 };
  }

  return (
    <FacesContext.Provider value={faces}>
    <MailAurora hue={mailboxHue(box)} dark={t.dark} className="mail-aurora" />
    {openId && <ReadingProgress />}
    {freshMail && !openId && (
      <button
        type="button"
        onClick={() => {
          setFreshMail(false);
          resetList();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        className={`pill-in fixed left-1/2 z-40 inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-4 text-[13px] font-semibold shadow-xl mail-glass-top ${
          t.dark ? "border-white/15 bg-(--mail-accent-deep)/40 text-white" : "border-(--mail-accent-deep)/30 bg-white/90 text-(--mail-accent-ink)"
        }`}
        style={{ top: "calc(env(safe-area-inset-top) + 5.25rem)" }}
      >
        <span className="unread-glow h-1.5 w-1.5 rounded-full bg-(--mail-accent-pale)" />
        New mail
      </button>
    )}
    <div className="@container relative mx-auto flex max-w-[1400px] flex-col gap-3 sm:gap-4 md:h-[calc(100dvh-3.5rem-env(safe-area-inset-top))] lg:h-[calc(100dvh-4rem-env(safe-area-inset-top))]" style={{ ["--mail-hue" as string]: Math.round(mailboxHue(box) * 360) }}>
      {/* Phones: Mail is its own place. A way back to BFO, then the mailbox as the title, the way out to its menu. */}
      {!openId && (
        <div className="flex items-center gap-2 px-1 pt-1 md:hidden">
          <Link
            to="/home"
            aria-label="Back to BFO"
            className={`inline-flex h-[44px] shrink-0 items-center gap-1 rounded-full pl-1.5 pr-3 text-[13px] font-medium transition-colors ${t.dark ? "text-gray-400 hover:bg-white/[0.06] hover:text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"}`}
          >
            <Icon name="chevronLeft" className="h-4 w-4" strokeWidth={2.2} />
            BFO
          </Link>
          <span className="flex-1" />
          {/* Your own photo is set from the desktop header; on a phone its menu had no room. */}
          <ThemeButton dark={t.dark} onToggle={toggleMailTheme} className={`pill-glass h-[44px] w-[44px] ${t.dark ? "text-gray-100" : "text-gray-700"}`} iconClassName="h-[22px] w-[22px]" />
        </div>
      )}
      {!openId && address && !noAddress && (
        <div className={`sticky z-20 -mx-4 px-5 transition-[padding,background-color] duration-300 md:hidden ${scrolled ? `mail-glass-top border-b py-2 ${t.dark ? "border-white/[0.08] bg-[#0b0b10]/[0.92]" : "border-gray-200 bg-white/[0.92]"}` : "px-5 py-0"}`} style={{ top: "env(safe-area-inset-top)" }}>
          <MailboxPicker address={address} aliases={aliases} box={box} onChoose={chooseBox} canAdd={isAdmin(me)} big compact={scrolled} unread={count?.unread ?? 0} />
        </div>
      )}
      {!openId && noAddress && <p className={`px-2 text-[13px] md:hidden ${t.muted}`}>No address yet. Ask an admin for one.</p>}
      {/* Larger screens: the title, the addresses, search and the view switch on one line. */}
      <header className="flex items-start justify-between gap-3 pt-1 max-md:hidden">
        <div className="flex min-w-0 items-center gap-3">
          {address && !noAddress && <MyPhoto address={address} name={me?.name ?? null} onFaces={setFaces} />}
          <div className="min-w-0">
            <h1 className={`text-[20px] font-semibold leading-[1.2] tracking-[-0.015em] sm:text-[22px] ${t.text}`}>Mail</h1>
            {noAddress ? (
              <p className={`mt-1 text-[12.5px] ${t.muted}`}>No address yet</p>
            ) : address && (
              <MailboxPicker address={address} aliases={aliases} box={box} onChoose={chooseBox} canAdd={isAdmin(me)} />
            )}
          </div>
        </div>
        <SearchField value={q} onSearch={search} className="mx-6 hidden min-w-0 max-w-[460px] flex-1 self-center md:flex" />
        <div className="flex shrink-0 items-center gap-2">
          <ThemeButton dark={t.dark} onToggle={toggleMailTheme} className={`h-8 w-8 ${t.dark ? "text-gray-400 hover:bg-white/[0.06] hover:text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"}`} />
          <Segmented
            label="View"
            value={view}
            onChange={chooseView}
            iconsOnly
            className="max-md:hidden"
            options={[
              { key: "table", label: "Table", icon: <Glyph name="rows" className="h-3.5 w-3.5" /> },
              { key: "columns", label: "Columns", icon: <Glyph name="columns" className="h-3.5 w-3.5" /> },
            ]}
          />
          <Button kind="primary" size="md" icon="edit" disabled={noAddress} title={noAddress ? "Ask an admin for an address" : undefined} onClick={() => setDraft(blankDraft(box || undefined))} className="max-sm:hidden">
            New
          </Button>
        </div>
      </header>

      {!openId && <SearchField value={q} onSearch={search} className="search-glow mx-1 md:hidden" />}

      {syncError && <p className={`-mt-1 text-[12px] ${t.muted}`}>Can't fetch new mail: {syncError}</p>}

      {view === "table" ? (
        /* One card: the table, or the open message in its place. */
        /* While reading, the card mustn't clip: the reader's toolbar sticks to the page, not to the card. */
        <section
          aria-label={tableReading ? "Message" : "Messages"}
          className={`mail-card flex min-h-0 flex-1 flex-col rounded-2xl border max-md:overflow-visible ${tableReading ? "md:overflow-hidden" : "overflow-hidden"} ${t.surface}`}
        >
          {tableReading ? (
            <div className={`min-h-0 flex-1 md:overflow-y-auto ${supportsViewTransitions() ? "" : "reader-in md:[animation:none]"}`}>{reader}</div>
          ) : (
            <>
              {toolbar}
              <PullToRefresh enabled={!openId} onRefresh={refreshFromPull} className="min-h-0 flex-1 overflow-y-auto max-md:overflow-visible max-md:pb-[calc(5rem+env(safe-area-inset-bottom))]">
                {pushInvite}
                {bulkBar}
                {listBody}
              </PullToRefresh>
            </>
          )}
        </section>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3">
          {/* The list */}
          <section
            aria-label="Messages"
            className={`mail-card flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border max-md:overflow-visible @min-[680px]:w-[300px] @min-[680px]:flex-none @min-[900px]:w-[400px] ${t.surface} ${openId ? "@max-[680px]:hidden" : ""}`}
          >
            {toolbar}
            <PullToRefresh enabled={!openId} onRefresh={refreshFromPull} className="min-h-0 flex-1 overflow-y-auto max-md:overflow-visible max-md:pb-[calc(5rem+env(safe-area-inset-bottom))]">
              {pushInvite}
              {bulkBar}
              {listBody}
            </PullToRefresh>
          </section>

          {/* The reader */}
          <section aria-label="Message" className={`mail-card min-w-0 flex-1 rounded-2xl border md:overflow-y-auto ${t.surface} ${openId ? "" : "@max-[680px]:hidden"}`}>
            {!open ? (
              <div className={`flex h-full min-h-[240px] flex-col items-center justify-center gap-2 text-[12.5px] ${t.faint}`}>
                <Icon name="mail" className="h-6 w-6" strokeWidth={1.4} />
                Pick a message to read it here
              </div>
            ) : (
              reader
            )}
          </section>
        </div>
      )}

      {/* Phones and small tablets: compose floats above the list, clear of the browser's bottom bar. */}
      {!openId && !draft && !noAddress &&
        createPortal(
          <button
            type="button"
            aria-label="New message"
            title="New message"
            onClick={() => setDraft(blankDraft(box || undefined))}
            className="mail-fab fab-in fab-glass fixed right-5 z-40 flex h-[58px] w-[58px] cursor-pointer items-center justify-center rounded-full transition-transform active:scale-90 md:hidden"
            style={{ bottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
          >
            <Icon name="edit" className="h-[26px] w-[26px]" strokeWidth={1.9} />
          </button>,
          document.body
        )}

      {/* Portalled: <main> is its own stacking context, under the rail and the mobile header. */}
      {draft && createPortal(<Compose draft={draft} addresses={mine} onClose={() => setDraft(null)} onSent={(m) => onSent(m, draft.replyToId ?? draft.forwardId)} />, document.body)}

      {toast &&
        createPortal(
          <div role="status" className="pointer-events-none fixed inset-x-0 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-[70] flex justify-center px-4">
            <span className={`${toastLeaving ? "toast-out" : "toast-in"} pointer-events-auto inline-flex items-center gap-3 rounded-full px-4 py-2 text-[12.5px] font-medium shadow-lg ${t.dark ? "bg-white text-gray-950" : "bg-gray-900 text-white"}`}>
              {toast.text}
              {toast.undo && (
                <button
                  type="button"
                  onClick={() => toast.undo?.()}
                  title="Undo (z)"
                  className={`-my-1 cursor-pointer rounded-full px-2 py-1 font-semibold underline-offset-2 hover:underline ${t.dark ? "text-(--mail-accent-ink)" : "text-(--mail-accent-pale)"}`}
                >
                  Undo
                </button>
              )}
            </span>
          </div>,
          document.body
        )}
    </div>
    </FacesContext.Provider>
  );
}
