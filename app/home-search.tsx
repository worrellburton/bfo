import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router";
import { authFetch } from "./auth";
import { rememberRecent, useEntities, usePaletteResults, type Command, type PageLink } from "./command-palette";
import { cx, format, Icon, Keycap, Skeleton } from "./ui";

/**
 * The search box on Home (desktop and tablet; on phones the top bar's search
 * opens the palette): type, and what matches appears under it as you go:
 * pages, entities, a few book transactions, and a search of mail or the
 * books for the words typed. The same results as ⌘K, in place.
 *
 * The list is an opaque overlay surface (docs/DESIGN.md §8.19), rows are the
 * standard 40/48px, and the highlighted row is tracked by id, so results
 * that arrive late never move the highlight under the cursor.
 */

type ShellContext = { pages: PageLink[] };

type Txn = {
  transaction_id: string;
  date: string;
  amount: number | string;
  merchant_name: string | null;
  name: string | null;
  entity_name: string | null;
  book_category: string | null;
};

type Row = Command & { txn?: { date: string; entity: string | null; account: string | null; amount: number } };

/** A few book transactions matching the words typed, a moment after typing stops. `loading` while they're on the way. */
function useTransactionHits(q: string): { rows: Txn[]; loading: boolean } {
  const [hits, setHits] = useState<{ q: string; rows: Txn[] }>({ q: "", rows: [] });
  const query = q.trim();
  useEffect(() => {
    if (query.length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      authFetch(`/api/books/data?report=transactions&q=${encodeURIComponent(query)}&limit=3&summary=0`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : { transactions: [] }))
        .then((body) => setHits({ q: query, rows: (body?.transactions ?? []) as Txn[] }))
        .catch(() => undefined);
    }, 180);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [query]);
  const ready = hits.q === query;
  return { rows: ready ? hits.rows : [], loading: query.length >= 2 && !ready };
}

/** Pages show at most this many before "Show all". */
const PAGES_SHOWN = 4;

export function HomeSearch() {
  const navigate = useNavigate();
  const { pages } = useOutletContext<ShellContext>() ?? { pages: [] };
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [allPages, setAllPages] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const entities = useEntities(focused);

  const go = useCallback(
    (to: string) => {
      setQ("");
      setFocused(false);
      inputRef.current?.blur();
      navigate(to);
    },
    [navigate],
  );
  const base = usePaletteResults({ q, pages, entities, actions: [], go });
  const { rows: txns, loading: txnsLoading } = useTransactionHits(focused ? q : "");
  const typed = q.trim().length > 0;

  // Places, then a few transactions, then the searches of mail and the books.
  const results = useMemo<Row[]>(() => {
    if (!typed) return base.filter((c) => c.group === "Recent");
    const pageRows = base.filter((c) => c.group === "Pages");
    const shownPages = allPages ? pageRows : pageRows.slice(0, PAGES_SHOWN);
    const morePages: Row[] = !allPages && pageRows.length > PAGES_SHOWN ? [{ id: "more:pages", label: `Show all ${pageRows.length} pages`, group: "Pages", run: () => setAllPages(true) }] : [];
    const txnRows: Row[] = txns.map((x) => {
      const who = (x.merchant_name || x.name || "Transaction").trim();
      return {
        id: `txn:${x.transaction_id}`,
        label: who,
        group: "Search",
        txn: { date: x.date, entity: x.entity_name, account: x.book_category ? x.book_category.replace(/^\d{4}\s+/, "") : "Uncategorized", amount: Number(x.amount) },
        run: () => go(`/books/transactions?q=${encodeURIComponent(who)}&txn=${encodeURIComponent(x.transaction_id)}`),
      };
    });
    const rest = base.filter((c) => c.group !== "Pages" && c.group !== "Search");
    const searches = base.filter((c) => c.group === "Search");
    return [...rest, ...shownPages, ...morePages, ...txnRows, ...searches];
  }, [base, txns, go, typed, allPages]);

  const open = focused && (typed || results.length > 0);
  // The highlight follows an id; when that row goes away it falls back to the first.
  const active = results.find((r) => r.id === activeId) ?? results[0] ?? null;

  useEffect(() => {
    setActiveId(null);
    setAllPages(false);
  }, [q]);
  useEffect(() => {
    if (open && active) listRef.current?.querySelector(`[data-id="${CSS.escape(active.id)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (c: Row) => {
    if (c.group === "Pages" && c.id.startsWith("page:")) rememberRecent({ to: c.id.replace(/^page:/, ""), label: c.label, hint: c.hint });
    c.run();
  };

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "Escape") inputRef.current?.blur();
      return;
    }
    const i = active ? results.indexOf(active) : -1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveId(results[Math.min(results.length - 1, i + 1)]?.id ?? null);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveId(results[Math.max(0, i - 1)]?.id ?? null);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active) choose(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setQ("");
      inputRef.current?.blur();
    }
  }

  const heading = (c: Row): string => {
    if (c.id.startsWith("txn:")) return "In the books";
    if (c.group === "Pages") {
      const sections = new Set(results.filter((r) => r.group === "Pages" && !r.id.startsWith("more:")).map((r) => r.hint ?? ""));
      return sections.size === 1 && [...sections][0] ? `Pages in ${[...sections][0]}` : "Pages";
    }
    return c.group;
  };
  const oneSection = (c: Row) => c.group === "Pages" && heading(c) !== "Pages";
  const searches = results.filter((c) => c.group === "Search" && !c.txn);
  const places = results.filter((c) => !(c.group === "Search" && !c.txn));
  let lastHeading = "";
  const option = (c: Row) => {
    const on = active?.id === c.id;
    return (
      <button
        id={`home-search-${c.id}`}
        data-id={c.id}
        role="option"
        aria-selected={on}
        tabIndex={-1}
        onMouseMove={() => setActiveId(c.id)}
        onClick={() => choose(c)}
        className={cx("flex w-full cursor-pointer items-center gap-3 rounded-control px-3 text-left", c.txn ? "min-h-(--row-2)" : "min-h-(--row-1)", on && "bg-hover")}
      >
        {c.txn ? (
          <>
            <span className="min-w-0 flex-1 py-2">
              <span className="block text-body break-words text-ink">{c.label}</span>
              <span className="block truncate text-small text-ink-2">{[format.date(c.txn.date), c.txn.entity, c.txn.account].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="shrink-0 text-body font-medium text-ink tabular-nums">{format.money(-c.txn.amount, { sign: "always" })}</span>
          </>
        ) : (
          <>
            {c.group === "Search" && <Icon name="search" size={16} className="text-ink-2" />}
            <span className={cx("min-w-0 flex-1 truncate text-body", c.id.startsWith("more:") ? "text-accent" : "text-ink")}>{c.label}</span>
            {c.hint && !oneSection(c) && c.group !== "Search" && <span className="shrink-0 truncate text-caption text-ink-3">{c.hint}</span>}
          </>
        )}
      </button>
    );
  };

  return (
    <div className="ds relative w-full">
      <div className="flex h-11 items-center gap-3 rounded-control border border-edge bg-field px-3 text-ink focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent focus-within:outline-solid">
        <Icon name="search" size={20} className="text-ink-3" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          type="search"
          placeholder="Search BFO"
          aria-label="Search BFO"
          role="combobox"
          aria-expanded={open}
          aria-controls="home-search-list"
          aria-autocomplete="list"
          aria-activedescendant={open && active ? `home-search-${active.id}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent text-field text-ink outline-none! placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
        />
        {q ? (
          <button
            type="button"
            aria-label="Clear the search"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQ("");
              inputRef.current?.focus();
            }}
            className="-mr-2 flex size-8 cursor-pointer items-center justify-center rounded-control text-ink-2 hover:bg-hover hover:text-ink touch:size-11"
          >
            <Icon name="x" size={16} />
          </button>
        ) : (
          <Keycap keys={["⌘", "K"]} />
        )}
      </div>

      {open && (
        <div
          id="home-search-list"
          ref={listRef}
          role="listbox"
          aria-label="Search results"
          // Mouse down would blur the input and close the list before the click lands.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute inset-x-0 top-[calc(100%+4px)] z-popover flex max-h-[min(60dvh,480px)] flex-col overflow-hidden rounded-card border border-line-strong bg-overlay shadow-(--elevation-2)"
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {typed && places.length === 0 && !txnsLoading && <p className="px-3 py-4 text-body text-ink-2">Nothing matches “{q.trim()}”.</p>}
            {places.map((c) => {
              const h = heading(c);
              const header = h !== lastHeading ? h : null;
              lastHeading = h;
              return (
                <div key={c.id}>
                  {header && <div className="px-3 pt-3 pb-1 text-caption font-medium text-ink-2">{header}</div>}
                  {option(c)}
                </div>
              );
            })}
            {txnsLoading && (
              <div aria-hidden>
                <div className="px-3 pt-3 pb-1 text-caption font-medium text-ink-2">In the books</div>
                <Skeleton kind="rows" rows={2} />
              </div>
            )}
          </div>
          {/* The searches of mail and the books stay in sight at the foot. */}
          {searches.length > 0 && (
            <div className="shrink-0 border-t border-line p-1">
              {searches.map((c) => (
                <div key={c.id}>{option(c)}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
