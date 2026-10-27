import { useCallback, useEffect, useRef, useState } from "react";
import { listMail, type MailCount, type MailFilter, type MailFolder, type MailSummary } from "../mail-client";
import { LIST_LOADER_MS, LOADER_OUT_MS, SEARCH_LOADER_MS, holdFor } from "./constants";
import { eachRow, listRows, sortsAfter, threadSortsAfter, type ListState } from "./list-state";

/** The list the page shows: read for the folder, filter, search and mailbox in the URL, paged, and re-read as the count moves. */
export function useMailList({ folder, filter, q, box, count }: { folder: MailFolder; filter: MailFilter; q: string; box: string; count: MailCount | null }) {
  const [list, setList] = useState<ListState | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const listReq = useRef(0);
  const listRef = useRef(list);
  listRef.current = list;

  // Newest first. "refresh" re-reads the first page and keeps any older pages already loaded.
  // "reset" re-reads the first page without blanking the list first, and drops older pages: after an action
  // that can move rows anywhere (a star, an archive in Active), merging would keep stale rows or lose moved ones.
  /** The loader on its way out, and rows that have just arrived (they animate in once, not again when the list comes back into view). */
  const [loaderLeaving, setLoaderLeaving] = useState(false);
  const [rowsFresh, setRowsFresh] = useState(false);
  const loadList = useCallback(async (which: MailFolder, narrow: MailFilter, term: string, to: string, mode: "replace" | "refresh" | "reset") => {
    const req = ++listReq.current;
    const shownAt = performance.now();
    if (mode === "replace") {
      setList(null);
      setListError(null);
    }
    try {
      const head = await listMail({ folder: which, filter: narrow, q: term, to: to || undefined });
      if (req !== listReq.current) return;
      setListError(null);
      if (mode === "replace") {
        // The loader plays through (the constellation assembles, the sonar sweeps), fades out in place, and the rows come in.
        await holdFor(shownAt, term ? SEARCH_LOADER_MS : LIST_LOADER_MS);
        if (req !== listReq.current) return;
        setLoaderLeaving(true);
        await new Promise((r) => setTimeout(r, LOADER_OUT_MS));
        if (req !== listReq.current) return;
        setLoaderLeaving(false);
        setList({ folder: which, filter: narrow, q: term, to, ...head, pinned: head.pinned ?? [] });
        setRowsFresh(true);
        window.setTimeout(() => setRowsFresh(false), 1500);
        return;
      }
      setList((prev) => {
        const fresh = { folder: which, filter: narrow, q: term, to, ...head, pinned: head.pinned ?? [] };
        if (mode === "reset" || !prev || prev.folder !== which || prev.filter !== narrow || prev.q !== term || prev.to !== to || !head.messages.length) return fresh;
        const ids = new Set([...head.messages, ...fresh.pinned].map((m) => m.id));
        // More than a page arrived since the last read: the head doesn't reach the old list, so keeping it would leave a hole.
        if (head.hasMore && !prev.messages.some((m) => ids.has(m.id))) return fresh;
        // Keep what sorts after the head's last row, in the server's order. Active has a row per
        // conversation: one that moved up is in the head now, under its newest message.
        const last = head.messages[head.messages.length - 1];
        const threads = new Set([...head.messages, ...fresh.pinned].map((m) => m.threadKey).filter(Boolean));
        const older = prev.messages.filter((m) =>
          which === "active" && !term
            ? !ids.has(m.id) && !(m.threadKey && threads.has(m.threadKey)) && threadSortsAfter(m, last)
            : !ids.has(m.id) && sortsAfter(m, last)
        );
        return { ...fresh, messages: [...head.messages, ...older], hasMore: older.length ? prev.hasMore : head.hasMore };
      });
    } catch (e) {
      if (req === listReq.current && mode === "replace") setListError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadList(folder, filter, q, box, "replace");
  }, [folder, filter, q, box, loadList]);

  // New mail shows up through the shared count; when it moves, re-read the list.
  const unreadKey = count ? `${count.unread}/${count.otherUnread}` : null;
  const lastKey = useRef(unreadKey);
  useEffect(() => {
    if (lastKey.current && unreadKey && lastKey.current !== unreadKey) void loadList(folder, filter, q, box, "refresh");
    lastKey.current = unreadKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadKey]);

  async function loadMore() {
    const cur = listRef.current;
    if (!cur || !cur.messages.length) return;
    setLoadingMore(true);
    try {
      const last = cur.messages[cur.messages.length - 1];
      // Active pages by conversation; everything else by message.
      const after =
        cur.folder === "active" && !cur.q && last.threadAt && last.threadKey
          ? { before: last.threadAt, beforeKey: last.threadKey }
          : { before: last.occurredAt, beforeId: last.id };
      const next = await listMail({ folder: cur.folder, filter: cur.filter, q: cur.q, to: cur.to || undefined, ...after });
      setList((prev) => {
        if (!prev || prev.folder !== cur.folder || prev.filter !== cur.filter || prev.q !== cur.q || prev.to !== cur.to) return prev;
        const ids = new Set(listRows(prev).map((m) => m.id));
        const threads = new Set(prev.folder === "active" && !prev.q ? listRows(prev).map((m) => m.threadKey).filter(Boolean) : []);
        const added = next.messages.filter((m) => !ids.has(m.id) && !(m.threadKey && threads.has(m.threadKey)));
        return { ...prev, messages: [...prev.messages, ...added], hasMore: next.hasMore };
      });
    } catch (e) {
      setListError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  /**
   * Active shows each conversation under its newest message, so a reply, move or
   * delete can change a row or its place: read the list again. Reads the list
   * that's showing now, not the one when the action started.
   */
  function refreshActive() {
    const cur = listRef.current;
    if (cur?.folder === "active" && !cur.q) void loadList(cur.folder, cur.filter, cur.q, cur.to, "reset");
  }

  /** Change one row in the list (if it's there). */
  const patchRow = (id: string, patch: Partial<MailSummary>) =>
    setList((prev) => prev && eachRow(prev, (rows) => rows.map((m) => (m.id === id ? { ...m, ...patch } : m))));

  return { list, setList, listError, setListError, loadingMore, listRef, loaderLeaving, rowsFresh, loadList, loadMore, refreshActive, patchRow };
}
