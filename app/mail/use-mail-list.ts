import { useCallback, useEffect, useRef, useState } from "react";
import { listMail, type MailCount, type MailFilter, type MailFolder, type MailSummary } from "../mail-client";
import { eachRow, listRows, sortsAfter, threadSortsAfter, type ListState } from "./list-state";

type Where = { folder: MailFolder; filter: MailFilter; attachments: boolean; q: string; box: string };

/**
 * The list the page shows: read for the folder, filters, search and mailbox in
 * the URL, paged, and re-read as the count moves. Rows show the moment they
 * arrive; the skeleton (app/ui) appears only if the read takes over 300ms.
 */
export function useMailList({ folder, filter, attachments, q, box, count }: Where & { count: MailCount | null }) {
  const [list, setList] = useState<ListState | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const listReq = useRef(0);
  const listRef = useRef(list);
  listRef.current = list;

  // Newest first. "refresh" re-reads the first page and keeps any older pages already loaded.
  // "reset" re-reads the first page without blanking the list first, and drops older pages: after an action
  // that can move rows anywhere (a star, an archive in Active), merging would keep stale rows or lose moved ones.
  const loadList = useCallback(async (w: Where, mode: "replace" | "refresh" | "reset") => {
    const req = ++listReq.current;
    if (mode === "replace") {
      setList(null);
      setListError(null);
    }
    try {
      const head = await listMail({ folder: w.folder, filter: w.filter, attachments: w.attachments, q: w.q, to: w.box || undefined });
      if (req !== listReq.current) return;
      setListError(null);
      const fresh: ListState = { folder: w.folder, filter: w.filter, attachments: w.attachments, q: w.q, to: w.box, ...head, pinned: head.pinned ?? [] };
      setList((prev) => {
        if (mode !== "refresh" || !prev || !same(prev, w) || !head.messages.length) return fresh;
        const ids = new Set([...head.messages, ...fresh.pinned].map((m) => m.id));
        // More than a page arrived since the last read: the head doesn't reach the old list, so keeping it would leave a hole.
        if (head.hasMore && !prev.messages.some((m) => ids.has(m.id))) return fresh;
        // Keep what sorts after the head's last row, in the server's order. Active has a row per
        // conversation: one that moved up is in the head now, under its newest message.
        const last = head.messages[head.messages.length - 1];
        const threads = new Set([...head.messages, ...fresh.pinned].map((m) => m.threadKey).filter(Boolean));
        const older = prev.messages.filter((m) =>
          w.folder === "active" && !w.q ? !ids.has(m.id) && !(m.threadKey && threads.has(m.threadKey)) && threadSortsAfter(m, last) : !ids.has(m.id) && sortsAfter(m, last),
        );
        return { ...fresh, messages: [...head.messages, ...older], hasMore: older.length ? prev.hasMore : head.hasMore };
      });
    } catch (e) {
      if (req === listReq.current && mode === "replace") setListError((e as Error).message);
    }
  }, []);

  const where = { folder, filter, attachments, q, box };
  useEffect(() => {
    void loadList(where, "replace");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, filter, attachments, q, box, loadList]);

  // New mail shows up through the shared count; when it moves, re-read the list.
  const unreadKey = count ? `${count.unread}/${count.otherUnread}` : null;
  const lastKey = useRef(unreadKey);
  useEffect(() => {
    if (lastKey.current && unreadKey && lastKey.current !== unreadKey) void loadList(where, "refresh");
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
      const after = cur.folder === "active" && !cur.q && last.threadAt && last.threadKey ? { before: last.threadAt, beforeKey: last.threadKey } : { before: last.occurredAt, beforeId: last.id };
      const next = await listMail({ folder: cur.folder, filter: cur.filter, attachments: cur.attachments, q: cur.q, to: cur.to || undefined, ...after });
      setList((prev) => {
        if (!prev || !same(prev, { folder: cur.folder, filter: cur.filter, attachments: cur.attachments, q: cur.q, box: cur.to })) return prev;
        const ids = new Set(listRows(prev).map((m) => m.id));
        const threads = new Set(
          prev.folder === "active" && !prev.q
            ? listRows(prev)
                .map((m) => m.threadKey)
                .filter(Boolean)
            : [],
        );
        const added = next.messages.filter((m) => !ids.has(m.id) && !(m.threadKey && threads.has(m.threadKey)));
        return { ...prev, messages: [...prev.messages, ...added], hasMore: next.hasMore };
      });
    } catch (e) {
      setListError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  /** Read the list showing now again from its first page (after an undo, say), without blanking it. */
  function reread() {
    const cur = listRef.current;
    if (cur) void loadList({ folder: cur.folder, filter: cur.filter, attachments: cur.attachments, q: cur.q, box: cur.to }, "reset");
  }

  /**
   * Active shows each conversation under its newest message, so a reply, move or
   * delete can change a row or its place: read the list again. Reads the list
   * that's showing now, not the one when the action started.
   */
  function refreshActive() {
    const cur = listRef.current;
    if (cur?.folder === "active" && !cur.q) reread();
  }

  /** Change one row in the list (if it's there). */
  const patchRow = (id: string, patch: Partial<MailSummary>) => setList((prev) => prev && eachRow(prev, (rows) => rows.map((m) => (m.id === id ? { ...m, ...patch } : m))));

  return { list, setList, listError, setListError, loadingMore, listRef, loadList, loadMore, reread, refreshActive, patchRow };
}

/** The list was read for this place. */
export function same(l: Pick<ListState, "folder" | "filter" | "attachments" | "q" | "to">, w: Where): boolean {
  return l.folder === w.folder && l.filter === w.filter && l.attachments === w.attachments && l.q === w.q && l.to === w.box;
}
