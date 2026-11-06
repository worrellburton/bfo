import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Location, NavigateFunction, SetURLSearchParams } from "react-router";
import { getMessage, type MailFilter, type MailFolder, type MailMessage } from "../mail-client";
import { filterFor, type Narrow } from "./constants";
import { phoneScreen, supportsViewTransitions, transition } from "../view-transition";
import { tap } from "./helpers";
import type { ListState } from "./list-state";

/** Moving about the page: the URL for a folder, filter, search, mailbox or open message, and the page transitions on phones. */
export function useMailNavigation({
  folder,
  filter,
  attachments,
  q,
  box,
  openId,
  cache,
  listRef,
  setParams,
  navigate,
  location,
}: {
  folder: MailFolder;
  filter: MailFilter;
  attachments: boolean;
  q: string;
  box: string;
  openId: string | null;
  cache: RefObject<Map<string, MailMessage>>;
  listRef: RefObject<ListState | null>;
  setParams: SetURLSearchParams;
  navigate: NavigateFunction;
  location: Location;
}) {
  /** The page's own query string: folder, filter, search and mailbox, plus the open message. */
  function query(extra: Record<string, string> = {}): Record<string, string> {
    const next: Record<string, string> = {};
    if (folder !== "active") next.f = folder;
    if (filter !== "all") next.v = filter;
    if (attachments) next.att = "1";
    if (q) next.q = q;
    if (box) next.a = box;
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

  /** The place's query string: a folder, its narrowing, the search (kept only when asked) and the mailbox. */
  function place(nextFolder: MailFolder, narrow: Narrow, keepSearch: boolean): Record<string, string> {
    const p: Record<string, string> = {};
    if (nextFolder !== "active") p.f = nextFolder;
    const v = filterFor(narrow);
    if (v !== "all") p.v = v;
    if (narrow.attachments) p.att = "1";
    if (keepSearch && q) p.q = q;
    if (box) p.a = box;
    return p;
  }
  const current: Narrow = { unread: filter === "unread" || filter === "unread-starred", starred: filter === "starred" || filter === "unread-starred", attachments };

  /** Picking a folder ends a search and keeps the narrowing. */
  function chooseFolder(next: MailFolder) {
    if (next === folder && !openId && !q) return;
    setParams(place(next, current, false));
  }

  /** Narrowing applies at once, and narrows a search too. */
  function chooseNarrow(next: Narrow) {
    setParams(place(folder, next, true));
  }

  /** Set the search text (the URL carries it, so Back and reload keep it). */
  function search(term: string) {
    const clean = term.trim();
    if (clean === q) return;
    const p = place(folder, current, false);
    if (clean) p.q = clean;
    setParams(p, { replace: true });
  }

  /** Show one mailbox (an address of mine), or all of them. */
  function chooseBox(next: string) {
    if (next === box) return;
    const p = place(folder, current, true);
    if (next) p.a = next;
    else delete p.a;
    setParams(p);
  }

  return { prefetch, returnedId, select, closeMessage, chooseFolder, chooseNarrow, search, chooseBox, openIdRef, navStateRef, queryRef, mountedRef };
}
