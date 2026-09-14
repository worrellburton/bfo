import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { authFetch } from "../auth";
import { useTheme } from "../theme";
import { normalizeCsv, parseCsv, type CsvRow } from "../books-csv";
import {
  TxnTable,
  TxnTableSkeleton,
  Menu,
  BatchBar,
  EntityTag,
  Icon,
  Toast,
  entityTag,
  money,
  dateRange,
  setEntityHueOrder,
  useFocusTrap,
  useMedia,
  type Txn,
  type TxnView,
  tiers,
  MICRO,
  incomeTone,
  popoverSurface,
  primaryBtn,
  outlineBtn,
  ghostBtn,
  cardSurface,
  hairline,
  ruleBorder,
  textInput,
  BTN_BASE,
  TAP,
  PATHS,
} from "../books-shared";

export function meta() {
  return [{ title: "BFO - Books · Transactions" }];
}

type Entity = { id: string; name: string };
/** Totals for the whole filtered set — the strip above the ledger. */
type Summary = { count: number; expenses: number; income: number; first: string | null; last: string | null };
type BankAccount = { account_id: string; name: string; official_name: string | null; nickname: string | null; mask: string | null; institution_name: string };

const PAGE = 100;

/**
 * List ⇄ cards. Desktop defaults to the table, phones to cards; an explicit
 * choice is remembered per browser and wins over the device default.
 */
const VIEW_KEY = "bfo-books-view";
function readStored(): TxnView | null {
  try {
    const s = localStorage.getItem(VIEW_KEY);
    if (s === "list" || s === "cards") return s;
  } catch {
    /* private mode — fall through to the device default */
  }
  return null;
}

/**
 * Whether the search field is wide enough for the full hint. Measured from
 * the field itself (a ResizeObserver), not a media query: the hint is
 * 160.6px + 38.7px padding, so 204px is the floor with a little slack. The
 * first measurement runs before paint so the short hint never flashes.
 */
function useSearchRoomy(ref: RefObject<HTMLInputElement | null>): boolean {
  const [roomy, setRoomy] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setRoomy(el.offsetWidth >= 204);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return roomy;
}

/**
 * Debounced search box — keystrokes re-render only this input; the page (and
 * its 100-row table) re-renders once, 300ms after typing pauses.
 */
function SearchBox({ value, onCommit, className }: { value: string; onCommit: (v: string) => void; className: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const roomy = useSearchRoomy(inputRef);
  const [v, setV] = useState(value);
  // Resync only when the prop changes from OUTSIDE (Clear filters). Our own
  // committed value echoing back must not clobber keystrokes typed since.
  const committed = useRef(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (value !== committed.current) {
      committed.current = value;
      setV(value);
    }
  }
  useEffect(() => {
    if (v === value) return;
    const t = setTimeout(() => {
      committed.current = v;
      onCommit(v);
    }, 300);
    return () => clearTimeout(t);
  }, [v, value, onCommit]);
  return (
    <input
      ref={inputRef}
      type="search"
      value={v}
      onChange={(e) => setV(e.target.value)}
      aria-label="Search merchants or memos"
      placeholder={roomy ? "Search merchants or memos…" : "Search…"}
      className={className}
    />
  );
}

export default function BooksTransactions() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [rows, setRows] = useState<Txn[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [vendorNames, setVendorNames] = useState<string[]>([]);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // Page-level problems (load / sync / backfill / load more) go to the banner
  // under the strip; row and batch saves happen 1–3 screens down, so their
  // errors surface as a toast instead.
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const [q, setQ] = useState("");
  const [entity, setEntity] = useState("all");
  const [type, setType] = useState<"all" | "revenue" | "expenses" | "transfers" | "intercompany" | "uncategorized">("all");
  const [year, setYear] = useState("all");
  const [uncat, setUncat] = useState<number | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "date", dir: "desc" });

  // An explicit choice wins; otherwise the device class decides, live — so a
  // window resized across lg (or a rotated tablet) re-derives the default.
  const [choice, setChoice] = useState<TxnView | null>(readStored);
  const lgUp = useMedia("(min-width: 1024px)");
  const view: TxnView = choice ?? (lgUp ? "list" : "cards");
  const pickView = (v: TxnView) => {
    setChoice(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* the choice just doesn't persist */
    }
  };

  // CSV import + Mercury backfill
  const [importOpen, setImportOpen] = useState(false);
  const closeImport = useCallback(() => setImportOpen(false), []);
  const [backfilling, setBackfilling] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Below sm the kebab opens as a bottom sheet (the phone's one menu idiom);
  // the sheet plays its exit before unmounting, the popover closes at once.
  const smUp = useMedia("(min-width: 640px)");
  const moreSheet = moreOpen && !smUp;
  const [moreClosing, setMoreClosing] = useState(false);
  const moreCloseTimer = useRef<number | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreSheetRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  // Set when the kebab is opened from the keyboard: focus lands on the first
  // (visible) item once the menu has rendered. A mouse click leaves focus put.
  const moreFocusFirst = useRef(false);
  const menuItems = () =>
    Array.from(
      (moreSheetRef.current ?? moreRef.current)?.querySelectorAll<HTMLButtonElement>("[role='menuitem'], [role='menuitemcheckbox']") ?? []
    ).filter((el) => el.offsetParent !== null);
  const closeMore = (refocus: boolean) => {
    if (moreSheetRef.current) {
      if (moreClosing) return;
      setMoreClosing(true);
      moreCloseTimer.current = window.setTimeout(() => {
        setMoreOpen(false);
        setMoreClosing(false);
      }, 200);
    } else {
      setMoreOpen(false);
    }
    if (refocus) moreBtnRef.current?.focus();
  };
  const closeMoreRef = useRef(closeMore);
  closeMoreRef.current = closeMore;
  useEffect(() => () => {
    if (moreCloseTimer.current) clearTimeout(moreCloseTimer.current);
  }, []);
  useFocusTrap(moreSheetRef, moreSheet && !moreClosing, { initial: "container" });
  // The kebab menu closes on an outside click or Escape, like every popover
  // (the sheet's backdrop is its outside click).
  useEffect(() => {
    if (!moreOpen) return;
    if (moreFocusFirst.current) {
      moreFocusFirst.current = false;
      menuItems()[0]?.focus();
    }
    const onDown = (e: MouseEvent) => {
      if (moreSheetRef.current) return;
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) closeMoreRef.current(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Consumed: the batch bar's document listener leaves the selection alone.
        e.preventDefault();
        closeMoreRef.current(true);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);
  const onKebabKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      // Stop here: the wrapper's onMenuKey would otherwise see focus already
      // on item 0 and advance to item 1 (mouse-open, then ArrowDown).
      e.stopPropagation();
      moreFocusFirst.current = true;
      if (moreOpen) menuItems()[0]?.focus();
      else setMoreOpen(true);
    }
  };
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Tab leaves the menu, so the menu goes too (an open menu with focus in
    // the toolbar is an orphan).
    if (e.key === "Tab" && moreOpen) {
      closeMore(false);
      return;
    }
    const items = menuItems();
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === "ArrowDown") next = (i + 1) % items.length;
    else if (e.key === "ArrowUp") next = i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    items[next].focus();
  };
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [sunriseOn, setSunriseOn] = useState(false);
  const [nextSunrise, setNextSunrise] = useState<string | null>(null);
  const [lastAutoSync, setLastAutoSync] = useState<string | null>(null);
  const [sunriseBusy, setSunriseBusy] = useState(false);
  const [sunriseError, setSunriseError] = useState("");

  const loadSettings = useCallback(async () => {
    try {
      const res = await authFetch("/api/books/data?report=settings");
      if (res.ok) {
        const d = await res.json();
        setSunriseOn(!!d.sync_at_sunrise);
        setNextSunrise(d.next_sunrise_utc ?? null);
        setLastAutoSync(d.last_auto_sync_date ?? null);
      }
    } catch {
      /* toggle just defaults off */
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function toggleSunrise() {
    if (sunriseBusy) return;
    const next = !sunriseOn;
    setSunriseOn(next); // optimistic
    setSunriseBusy(true);
    setSunriseError("");
    try {
      const res = await authFetch("/api/books/data", {
        method: "POST",
        body: JSON.stringify({ action: "set_sunrise_sync", enabled: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error || "Couldn't save the sunrise setting.");
      }
      // Re-read so the "next sunrise" / "last ran" line reflects the server.
      await loadSettings();
    } catch (err) {
      setSunriseOn(!next);
      setSunriseError(err instanceof Error ? err.message : "Couldn't save the sunrise setting.");
    } finally {
      setSunriseBusy(false);
    }
  }

  // "today 6:04 AM" / "tomorrow 6:05 AM" — the next automatic sync, in the
  // viewer's local time.
  const nextSunriseLabel = useMemo(() => {
    if (!nextSunrise) return null;
    const d = new Date(nextSunrise);
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return `${sameDay ? "today" : "tomorrow"} ${time}`;
  }, [nextSunrise]);

  const lastRanLabel = useMemo(() => {
    if (!lastAutoSync) return "hasn't run yet";
    // last_auto_sync_date is a plain YYYY-MM-DD; render it without a TZ shift.
    const [y, m, dd] = lastAutoSync.split("-").map(Number);
    return `last ran ${new Date(y, m - 1, dd).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  }, [lastAutoSync]);

  // If the search text is an entity's initials (its tag), search by that
  // entity instead of the description — so "BFT" finds that entity's rows.
  const tagMatch = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return null;
    return entities.find((e) => entityTag(e.name).toLowerCase() === t) ?? null;
  }, [q, entities]);

  const query = useCallback(
    (offset: number) => {
      const params = new URLSearchParams({ report: "transactions", limit: String(PAGE), offset: String(offset) });
      const effEntity = tagMatch ? tagMatch.id : entity;
      if (effEntity !== "all") params.set("entity", effEntity);
      if (type !== "all") params.set("type", type);
      if (year !== "all") params.set("year", year);
      // Only pass the text search when it isn't an entity-initials match.
      if (!tagMatch && q.trim()) params.set("q", q.trim());
      if (!(sort.key === "date" && sort.dir === "desc")) params.set("sort", `${sort.key}.${sort.dir}`);
      return `/api/books/data?${params}`;
    },
    [entity, type, year, q, sort, tagMatch]
  );

  // Click a column: same column flips direction, a new column starts descending.
  const onSort = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));

  // Infinite scroll: the next page loads as the sentinel nears the viewport.
  // After a failed page the observer stands down — the Load more button is
  // the retry, so a flaky connection can't loop on the sentinel.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || loading || loadingMore || loadMoreFailed || rows.length >= total) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) void loadMore();
      },
      { rootMargin: "600px" }
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, total, loading, loadingMore, loadMoreFailed]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch(query(0));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Couldn't load transactions.");
      setRows(data.transactions ?? []);
      setTotal(data.total ?? 0);
      setSummary(data.summary ?? null);
      setLoadMoreFailed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load transactions.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  // q arrives already debounced by the SearchBox — load immediately.
  useEffect(() => {
    void load();
  }, [load]);

  const refreshUncat = useCallback(async () => {
    try {
      const params = new URLSearchParams({ report: "transactions", type: "uncategorized", limit: "1" });
      if (entity !== "all") params.set("entity", entity);
      if (year !== "all") params.set("year", year);
      const res = await authFetch(`/api/books/data?${params}`);
      if (res.ok) setUncat((await res.json()).total ?? 0);
    } catch {
      // the count is a nudge, not critical
    }
  }, [entity, year]);

  useEffect(() => {
    void refreshUncat();
  }, [refreshUncat]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/books/data?report=meta");
        if (!res.ok) return;
        const data = await res.json();
        const list: Entity[] = data.entities ?? [];
        setEntities(list);
        // Entity tag hues are assigned by sorted position, so eight entities
        // get eight hues instead of whatever the name hash collides on.
        setEntityHueOrder(list.map((e) => e.name));
        setCategories(data.categories ?? []);
        setVendorNames(data.vendors ?? []);
        setLastSynced(data.last_synced_at ?? null);
      } catch {
        // meta is decoration
      }
    })();
  }, []);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await authFetch(query(rows.length));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error();
      setRows((prev) => [...prev, ...(data.transactions ?? [])]);
    } catch {
      setError("Couldn't load more transactions.");
      setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }

  async function backfillMercury() {
    setBackfilling(true);
    setError("");
    try {
      const res = await authFetch("/api/mercury/backfill", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Mercury backfill failed.");
      setError("");
      await load();
      alert(`Mercury backfill: ${data.backfilled} transactions added.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mercury backfill failed.");
    } finally {
      setBackfilling(false);
    }
  }

  async function syncNow() {
    if (syncing) return;
    setSyncing(true);
    setError("");
    try {
      const res = await authFetch("/api/cron/books-sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Sync failed.");
      setLastSynced(new Date().toISOString());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }
  const syncLabel = syncing ? "Syncing…" : backfilling ? "Backfilling…" : "Sync now";

  // ── Skins ────────────────────────────────────────────────────────────────
  // One text ladder, one card surface, one rule weight — shared with
  // books-shared so the strip, toolbar and table read as a single system.
  const { t1, t2, t3 } = tiers(isDark);
  const card = `rounded-2xl border ${cardSurface(isDark)}`;
  const rule = ruleBorder(isDark);
  const hair = hairline(isDark);
  const field = textInput(isDark);
  // 16px on phones so iOS doesn't auto-zoom the page when the field focuses;
  // the placeholder stays on the scale so the resting field matches the
  // pickers beside it.
  const searchField = `h-[40px] sm:h-9 w-full pl-9 pr-4 rounded-full text-[16px] sm:text-sm placeholder:text-sm border cursor-text [&::-webkit-search-cancel-button]:appearance-none ${field}`;
  // Working ≠ disabled: a control busy on its own action keeps full opacity
  // and just stops taking clicks until it's done.
  const busyBtn = "aria-busy:pointer-events-none";
  // The type segments and the view toggle share one skin. The active segment
  // is raised, not inverted, so Sync now stays the only saturated fill above
  // the ledger.
  const segContainer = `inline-flex items-center h-[40px] sm:h-9 p-0.5 rounded-full border ${
    isDark ? "border-white/10 bg-white/[0.04]" : "border-gray-200 bg-gray-50"
  }`;
  // A floor on phones so "All" isn't the narrowest control on the page.
  const segment = "inline-flex items-center justify-center h-full min-w-[44px] sm:min-w-0 px-3 rounded-full text-sm font-medium whitespace-nowrap transition-colors cursor-pointer";
  const segOn = isDark ? "bg-white/[0.1] text-gray-100" : "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200";
  const segOff = isDark
    ? "text-gray-400 hover:text-gray-100 hover:bg-white/[0.06]"
    : "text-gray-500/100 hover:text-gray-900 hover:bg-gray-200/60";
  const viewSeg = `h-full w-[40px] sm:w-8 rounded-full flex items-center justify-center transition-colors cursor-pointer ${TAP.seg}`;
  // Popover items share the Menu option's vocabulary (h-8 px-2 text-xs);
  // sheet items the Menu sheet's (min-h-[44px] px-3 text-base).
  const menuItemSkin = isDark
    ? "text-gray-200 hover:bg-white/[0.08] focus-visible:bg-white/[0.08]"
    : "text-gray-800 hover:bg-gray-100 focus-visible:bg-gray-100";
  const menuItem = `w-full h-8 px-2 rounded-lg text-xs text-left whitespace-nowrap cursor-pointer transition-colors ${menuItemSkin}`;
  const sheetItem = `w-full min-h-[44px] px-3 rounded-lg text-base text-left inline-flex items-center gap-3 cursor-pointer transition-colors ${menuItemSkin}`;
  // The kebab's actions, in one place for the popover and the sheet.
  const moreActions = [
    ["Sync now", () => void syncNow(), "sm:hidden"],
    ["Import CSV…", () => setImportOpen(true), ""],
    ["Backfill Mercury history…", () => void backfillMercury(), ""],
  ] as const;
  // Refocus the kebab BEFORE the action runs, so a dialog it opens records
  // the kebab as its opener and hands focus back there on close.
  const runAction = (run: () => void) => {
    closeMore(true);
    run();
  };
  // The Sunrise switch. Everything here is in px on purpose: the site scales
  // rem down 15%, so a rem-sized track with a px-sized travel let the knob
  // slide past the end of the track. Track 36×20, knob 16, 2px inset → "on"
  // travel is exactly 16px. The "on" track is the accent (the checked
  // checkbox's fill), so "on" means one colour everywhere; the sun icon
  // alone carries the sunrise amber.
  const sunIcon = (
    <Icon
      d={PATHS.sun}
      strokeWidth={1.6}
      className={`w-4 h-4 shrink-0 transition-colors ${sunriseOn ? (isDark ? "text-amber-400" : "text-amber-600") : ""}`}
    />
  );
  const switchTrack = (
    <span
      aria-hidden
      className={`relative block w-[36px] h-[20px] rounded-full shrink-0 overflow-hidden transition-colors duration-200 ease-out ${
        sunriseOn ? (isDark ? "bg-emerald-500" : "bg-emerald-600") : isDark ? "bg-white/15" : "bg-gray-300"
      }`}
    >
      <span
        className={`absolute left-[2px] top-[2px] w-[16px] h-[16px] rounded-full bg-white shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none ${
          sunriseOn ? "translate-x-[16px]" : "translate-x-0"
        }`}
      />
    </span>
  );

  const years = [0, 1, 2].map((d) => String(new Date().getFullYear() - d));

  const filtered = Boolean(q.trim()) || entity !== "all" || year !== "all" || type !== "all";
  function clearFilters() {
    setQ("");
    setEntity("all");
    setYear("all");
    setType("all");
  }

  // ── Toolbar pieces ───────────────────────────────────────────────────────
  // Rendered from helpers so the lg+ single row and the phone two-row layout
  // share identical literal class strings.
  const searchBox = () => (
    <div className="relative order-1 flex-1 min-w-0 lg:min-w-[10rem] lg:max-w-[20rem] xl:flex-none xl:w-80">
      <Icon d={PATHS.search} className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none ${t3}`} strokeWidth={2} />
      <SearchBox value={q} onCommit={setQ} className={searchField} />
    </div>
  );
  const entityMenu = () => (
    <Menu
      value={tagMatch ? tagMatch.id : entity}
      isDark={isDark}
      size="md"
      label="Entity"
      onChange={setEntity}
      options={[
        { value: "all", label: "All entities" },
        { value: "unmapped", label: "Unmapped" },
        ...entities.map((en) => ({ value: en.id, label: en.name, icon: <EntityTag name={en.name} isDark={isDark} tooltip={false} srName={false} /> })),
      ]}
    />
  );
  const timeMenu = () => (
    <Menu
      value={year}
      isDark={isDark}
      size="md"
      label="Period"
      onChange={setYear}
      options={[{ value: "all", label: "All time" }, ...years.map((y) => ({ value: y, label: y }))]}
    />
  );
  const typeSegments = () => (
    <div role="group" aria-label="Type" className={segContainer}>
      {(
        [
          ["all", "All"],
          ["revenue", "Income"],
          ["expenses", "Expense"],
          ["transfers", "Transfer"],
          ["intercompany", "Roll-up"],
          ["uncategorized", "Uncategorized"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => setType(value)}
          aria-pressed={type === value}
          className={`${segment} ${TAP.seg} ${type === value ? segOn : segOff}`}
        >
          {label}
          {value === "uncategorized" && uncat ? <span className="ml-1 font-normal">{uncat}</span> : null}
        </button>
      ))}
    </div>
  );
  const viewToggle = () => (
    <div role="group" aria-label="View" className={segContainer}>
      {(
        [
          ["list", "List view", PATHS.list],
          ["cards", "Card view", PATHS.grid],
        ] as const
      ).map(([v, name, d]) => (
        <button
          key={v}
          type="button"
          data-testid={v === "list" ? "view-list" : "view-cards"}
          aria-label={name}
          title={name}
          aria-pressed={view === v}
          onClick={() => pickView(v)}
          className={`${viewSeg} ${view === v ? segOn : segOff}`}
        >
          <Icon d={d} className="w-3.5 h-3.5" />
        </button>
      ))}
    </div>
  );
  const clearButton = () => (
    <button
      type="button"
      onClick={clearFilters}
      aria-label="Clear filters"
      title="Clear filters"
      className={`${BTN_BASE} h-[40px] sm:h-9 px-4 text-sm ${TAP.md} ${outlineBtn(isDark)}`}
    >
      Clear
    </button>
  );

  // ── Loading states ───────────────────────────────────────────────────────
  // Only the very first fetch shows the skeleton. A re-sort, filter or search
  // keeps the ledger mounted and dims it (after 150ms, so a fast response
  // never flashes): no scroll jump, and the sort button keeps keyboard focus.
  const firstLoad = loading && summary === null;
  const refreshing = loading && !firstLoad;

  // ── Summary strip — Income · Expenses · Net · Transactions (+ range) ─────
  const ready = summary !== null;
  const hasRows = ready && summary.count > 0;
  const net = ready ? summary.income - summary.expenses : 0;
  const strip: Array<{ label: string; value: string | null; tone: string; sub?: string | null }> = [
    {
      label: "Income",
      value: ready ? (hasRows ? (summary.income > 0 ? `+${money(summary.income)}` : money(0)) : "—") : null,
      tone: hasRows && summary.income > 0 ? incomeTone(isDark) : "",
    },
    { label: "Expenses", value: ready ? (hasRows ? money(summary.expenses) : "—") : null, tone: "" },
    {
      label: "Net",
      value: ready ? (hasRows ? (net > 0 ? `+${money(net)}` : money(net)) : "—") : null,
      tone: hasRows && net > 0 ? incomeTone(isDark) : "",
    },
    {
      label: "Transactions",
      value: ready ? summary.count.toLocaleString() : null,
      tone: "",
      sub: ready ? (hasRows && summary.first && summary.last ? dateRange(summary.first, summary.last) : "—") : null,
    },
  ];
  const cellBorder = ["", "border-l", "border-t md:border-t-0 md:border-l", "border-l border-t md:border-t-0"] as const;
  // The four totals are the page's focal point: 14.9px on phones (above the
  // 11.9px card amounts), 22.3px at lg+ — above the 17.85px h1, so the page
  // has one headline. The shimmer below derives its height from the same classes.
  const kpiSize = "text-xl lg:text-3xl leading-none";
  const kpi = `block mt-1 ${kpiSize} font-semibold tracking-tight truncate transition-opacity ${
    refreshing ? "opacity-60 delay-150" : ""
  }`;

  return (
    // tabular-nums inherits to the strip and footer; books-shared carries its
    // own for portals/embeds.
    <div className="w-full tabular-nums">
      {/* ── Header. One DOM for every width: the title block takes the row
          and the actions cluster (sunrise · sync · kebab) sits at its right.
          Below sm the title block dissolves (`contents`) so the h1 shares a
          line with the cluster and the meta line drops under both at full
          width, 3px below the h1 (gap-y-3 minus -mt-2). */}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 mb-5">
        <div className="contents sm:block sm:min-w-0 sm:flex-1">
          <h1 className={`order-1 flex-1 min-w-0 self-end sm:self-center text-2xl font-semibold tracking-tight leading-tight ${t1}`}>Transactions</h1>
          {/* Two clauses, one capital each. The switch beside them is the
              status; no amber dot repeats it. */}
          {sunriseError ? (
            <p role="alert" className="order-3 basis-full -mt-2 sm:basis-auto sm:mt-1 text-xs text-red-500">{sunriseError}</p>
          ) : (
            (lastSynced || sunriseOn) && (
              <p className={`order-3 basis-full -mt-2 sm:basis-auto sm:mt-1 text-xs flex flex-wrap items-center gap-x-1.5 gap-y-0.5 ${t2}`}>
                {lastSynced && (
                  <span>
                    Synced {new Date(lastSynced).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                )}
                {lastSynced && sunriseOn && <span aria-hidden>·</span>}
                {sunriseOn && (
                  <span>
                    {nextSunriseLabel ? `Sunrise sync ${nextSunriseLabel}` : "Sunrise sync on"}
                    <span className="hidden sm:inline">, {lastRanLabel}</span>
                  </span>
                )}
              </p>
            )
          )}
        </div>
        <div className="order-2 flex items-center gap-2 sm:-mt-0.5">
          {/* Sync at sunrise — a daily automatic sync at local dawn. A
              setting, so on phones it lives in the kebab sheet (the meta
              line already states it) and the header stays title · Sync · ⋯. */}
          <button
            type="button"
            role="switch"
            aria-checked={sunriseOn}
            aria-label="Sunrise sync"
            aria-busy={sunriseBusy || undefined}
            onClick={() => void toggleSunrise()}
            title={sunriseOn && nextSunriseLabel ? `Next sync ${nextSunriseLabel} · ${lastRanLabel}` : "Sync automatically at sunrise"}
            className={`hidden sm:inline-flex items-center gap-2 h-9 pl-3 pr-1.5 rounded-full text-sm font-medium transition-colors cursor-pointer ${TAP.md} ${busyBtn} ${outlineBtn(isDark)}`}
          >
            {sunIcon}
            <span>Sunrise sync</span>
            {switchTrack}
          </button>
          {/* Phones: an icon-only Sync in the cluster (the kebab also carries
              the labelled item); sm+: the page's single primary button, at a
              fixed width so the cluster never shifts while it works. */}
          <button
            type="button"
            onClick={() => void syncNow()}
            aria-label="Sync now"
            title="Sync now"
            aria-busy={syncing || undefined}
            className={`${BTN_BASE} sm:hidden w-[40px] h-[40px] ${busyBtn} ${outlineBtn(isDark)}`}
          >
            <Icon d={PATHS.sync} className={`w-4 h-4 ${syncing ? "animate-spin motion-reduce:animate-none" : ""}`} />
          </button>
          <span className="hidden sm:contents">
            <button
              type="button"
              onClick={() => void syncNow()}
              aria-busy={syncing || undefined}
              className={`${BTN_BASE} h-9 px-4 text-sm min-w-[6.5rem] ${TAP.md} ${busyBtn} ${primaryBtn(isDark)}`}
            >
              {syncLabel}
            </button>
          </span>
          <div className="relative" ref={moreRef} onKeyDown={onMenuKey}>
            <button
              ref={moreBtnRef}
              type="button"
              onClick={() => (moreOpen ? closeMore(false) : setMoreOpen(true))}
              onKeyDown={onKebabKey}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              aria-label="More actions"
              className={`w-[40px] h-[40px] sm:w-9 sm:h-9 rounded-full flex items-center justify-center cursor-pointer transition-colors ${TAP.md} ${outlineBtn(isDark)} ${
                isDark
                  ? "aria-expanded:bg-white/[0.1] aria-expanded:border-white/20 aria-expanded:text-white"
                  : "aria-expanded:bg-gray-100 aria-expanded:border-gray-300 aria-expanded:text-gray-900"
              }`}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
              </svg>
            </button>
            {moreOpen && !moreSheet && (
              <div role="menu" className={`absolute right-0 mt-2 w-48 rounded-xl border p-1 pop-in z-40 ${popoverSurface(isDark)}`}>
                {moreActions.map(([label, run, extra]) => (
                  <button key={label} type="button" role="menuitem" onClick={() => runAction(run)} className={`${menuItem} ${extra}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* The phone sheet: the same recipe as every picker sheet, with the
              Sunrise switch as its first row. */}
          {moreSheet &&
            createPortal(
              <>
                <div
                  className={`fixed inset-0 z-[69] bg-black/50 backdrop-blur-[2px] ${moreClosing ? "fade-out" : "fade-in"}`}
                  onClick={() => closeMore(true)}
                  aria-hidden
                />
                <div
                  ref={moreSheetRef}
                  role="menu"
                  aria-label="More actions"
                  tabIndex={-1}
                  onKeyDown={onMenuKey}
                  className={`fixed inset-x-0 bottom-0 z-[70] rounded-t-2xl border flex flex-col pb-[max(env(safe-area-inset-bottom),12px)] ${
                    moreClosing ? "sheet-out pointer-events-none" : "sheet-in"
                  } ${popoverSurface(isDark)}`}
                >
                  <div className={`mx-auto mt-2 mb-1 h-1 w-10 rounded-full shrink-0 ${isDark ? "bg-white/20" : "bg-gray-300"}`} aria-hidden />
                  <div className="p-2">
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={sunriseOn}
                      aria-busy={sunriseBusy || undefined}
                      onClick={() => void toggleSunrise()}
                      className={`${sheetItem} justify-between ${busyBtn}`}
                    >
                      <span className="inline-flex items-center gap-3">
                        {sunIcon}
                        Sunrise sync
                      </span>
                      {switchTrack}
                    </button>
                    {moreActions.map(([label, run]) => (
                      <button key={label} type="button" role="menuitem" onClick={() => runAction(run)} className={sheetItem}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </>,
              document.body
            )}
        </div>
      </div>

      <ImportCsvDialog
        isDark={isDark}
        open={importOpen}
        onClose={closeImport}
        onImported={() => {
          void load();
          void refreshUncat();
        }}
      />

      {/* ── Summary strip — the whole filtered set, not just the rows loaded.
          P&L order, 4-up from md; the values dim with the ledger on refresh
          so stale totals never sit at full strength beside dimmed rows. */}
      <div className={`grid grid-cols-2 md:grid-cols-4 overflow-hidden mb-5 tabular-nums ${card}`}>
        {strip.map(({ label, value, tone, sub }, i) => (
          <div key={label} className={`min-w-0 px-4 py-3 ${cellBorder[i]} ${hair}`}>
            <span className={`block text-xs font-medium ${t2}`}>{label}</span>
            {value === null ? (
              <span className={`mt-1 block ${kpiSize}`} aria-hidden>
                <span className="shimmer inline-block h-[1em] w-20 rounded! align-top" />
              </span>
            ) : (
              <span title={value} className={`${kpi} ${tone || t1}`}>
                {value}
              </span>
            )}
            {sub === null ? (
              <span className="mt-1 block text-xs leading-tight" aria-hidden>
                <span className="shimmer inline-block h-[1em] w-28 rounded! align-top" />
              </span>
            ) : sub !== undefined ? (
              <span className={`block mt-1 text-xs leading-tight ${t2}`}>{sub}</span>
            ) : null}
          </div>
        ))}
      </div>

      {error && (
        <div
          role="alert"
          className={`mb-5 rounded-2xl pl-4 pr-2 py-2 flex items-center gap-3 text-sm fade-in ${isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-700"}`}
        >
          <span className="flex-1 min-w-0">{error}</span>
          <button
            type="button"
            onClick={() => setError("")}
            aria-label="Dismiss"
            className={`w-7 h-7 rounded-md inline-flex items-center justify-center shrink-0 cursor-pointer hover:bg-red-500/10 ${TAP.box}`}
          >
            <Icon d={PATHS.close} className="w-3 h-3" strokeWidth={2} />
          </button>
        </div>
      )}

      {/* ── Ledger ───────────────────────────────────────────────────────── */}
      <div className={card}>
        {/* One DOM for every width. lg+: a single row — search · entity ·
            period · clear … type segments · view toggle; the search absorbs
            the slack (flex-1, capped at 20rem) so the row never wraps. Below
            lg: search + toggle on the first line, then the filters in a
            scrolling strip. The strip is `lg:contents`, so on desktop its
            children join the row directly and `order-*` places them. Its
            basis is the full card width (content + both insets) so the clip
            edge is the card edge, softened by a short fade; Clear sits before
            the type segments on phones so it's reachable without scrolling. */}
        <div className={`px-4 py-3 border-b ${rule}`}>
          <div className="flex flex-wrap items-center gap-2">
            {searchBox()}
            <div className="order-2 shrink-0 lg:order-6">{viewToggle()}</div>
            {/* `py-2 -my-2`: overflow-x clips vertically too, so the strip
                keeps the ring's 4px (and most of the tablet tap boxes) inside
                its own padding; the negative margin gives the height back. */}
            <div className="order-3 basis-[calc(100%+2rem)] -mx-4 px-4 py-2 -my-2 scroll-px-4 flex items-center gap-2 overflow-x-auto no-scrollbar [&>*]:shrink-0 [mask-image:linear-gradient(to_right,#000_calc(100%-12px),transparent)] lg:[mask-image:none] lg:contents">
              {/* At lg the row has ~875px for six controls: the chosen entity
                  truncates at 12rem there (the tag in its option and the
                  strip say the rest) so a long LLC name never wraps the row. */}
              <div className="lg:order-2 min-w-0 max-w-[240px] lg:max-w-[12rem] xl:max-w-[240px] [&>button]:max-w-full">{entityMenu()}</div>
              <div className="lg:order-3">{timeMenu()}</div>
              {filtered && <div className="lg:order-4">{clearButton()}</div>}
              <div className="lg:order-5 lg:ml-auto">{typeSegments()}</div>
            </div>
          </div>
        </div>

        <div
          aria-busy={refreshing || undefined}
          className={`transition-opacity ${refreshing ? "opacity-60 delay-150 pointer-events-none" : "delay-0"}`}
        >
          {firstLoad ? (
            <TxnTableSkeleton isDark={isDark} view={view} selection />
          ) : rows.length === 0 ? (
            <div className="px-4 py-16 text-center">
              {filtered ? (
                <>
                  <Icon d={PATHS.search} className={`w-6 h-6 mx-auto ${t3}`} strokeWidth={1.4} />
                  <p className={`mt-3 text-sm font-medium ${t1}`}>No transactions match</p>
                  <p className={`mt-1 text-xs ${t2}`}>Try another search or clear the filters.</p>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className={`${BTN_BASE} mt-4 h-[40px] sm:h-9 px-4 text-sm ${outlineBtn(isDark)}`}
                  >
                    Clear filters
                  </button>
                </>
              ) : (
                <>
                  <Icon d={PATHS.inbox} className={`w-6 h-6 mx-auto ${t3}`} strokeWidth={1.4} />
                  <p className={`mt-3 text-sm font-medium ${t1}`}>Nothing synced yet</p>
                  <p className={`mt-1 text-xs ${t2}`}>Run a sync or import a bank CSV to get started.</p>
                  <div className="mt-4 flex justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => void syncNow()}
                      aria-busy={syncing || undefined}
                      className={`${BTN_BASE} h-[40px] sm:h-9 px-4 text-sm ${busyBtn} ${primaryBtn(isDark)}`}
                    >
                      {syncLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportOpen(true)}
                      className={`${BTN_BASE} h-[40px] sm:h-9 px-4 text-sm ${outlineBtn(isDark)}`}
                    >
                      Import CSV…
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <TxnTable
              rows={rows}
              categories={categories}
              isDark={isDark}
              view={view}
              sort={sort}
              onSort={onSort}
              selection={{
                selected,
                toggle: (id) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    next.has(id) ? next.delete(id) : next.add(id);
                    return next;
                  }),
                setAll: (ids) => setSelected(new Set(ids)),
                selectMany: (ids, on) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    for (const id of ids) on ? next.add(id) : next.delete(id);
                    return next;
                  }),
              }}
              onRowChange={(t) =>
                setRows((prev) => prev.map((r) => (r.transaction_id === t.transaction_id ? t : r)))
              }
              onError={setToast}
              onReload={() => {
                void load();
                void refreshUncat();
              }}
            />
          )}
        </div>

        {/* Footer: how far we are + load more. The sentinel sits here so nearing
            the end of the loaded rows auto-loads the next page. */}
        {!firstLoad && rows.length < total && (
          <div className={`flex items-center justify-center gap-3 px-4 py-3 border-t ${hair}`}>
            <span role="status" aria-live="polite" className={`text-xs ${t2}`}>
              Showing {rows.length.toLocaleString()} of {total.toLocaleString()}
            </span>
            <button
              type="button"
              onClick={() => {
                setLoadMoreFailed(false);
                void loadMore();
              }}
              aria-busy={loadingMore || undefined}
              // The touch-sm token: visible h-8 with a 40px hit box below lg, h-7 at lg.
              className={`${BTN_BASE} h-8 lg:h-7 px-3 text-sm lg:text-xs ${TAP.pill} ${busyBtn} ${outlineBtn(isDark)}`}
            >
              {loadingMore ? "Loading…" : `Load ${Math.min(PAGE, total - rows.length)} more`}
            </button>
            <div ref={sentinelRef} aria-hidden />
          </div>
        )}
      </div>

      <BatchBar
        count={selected.size}
        isDark={isDark}
        busy={batchBusy}
        vendorSuggestions={vendorNames}
        categories={categories}
        onApply={(patch) => {
          setBatchBusy(true);
          void authFetch("/api/books/data", {
            method: "POST",
            body: JSON.stringify({ action: "batch_update", transaction_ids: [...selected], ...patch }),
          })
            .then(async (res) => {
              if (!res.ok) throw new Error("Couldn't apply that batch edit.");
              setSelected(new Set());
              await load();
            })
            .catch((err) => setToast(err instanceof Error ? err.message : "Couldn't apply that batch edit."))
            .finally(() => setBatchBusy(false));
        }}
        onClear={() => setSelected(new Set())}
      />

      <Toast message={toast} isDark={isDark} onClose={() => setToast("")} />
    </div>
  );
}

// ── CSV import ─────────────────────────────────────────────────────────────
/**
 * The bank-CSV import dialog. Self-contained: it fetches the bank accounts
 * the first time it opens, parses the chosen file, posts the rows and reports
 * the result; the route only learns that an import landed (`onImported`).
 */
function ImportCsvDialog({
  isDark,
  open,
  onClose,
  onImported,
}: {
  isDark: boolean;
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const { t1, t2 } = tiers(isDark);
  const ref = useRef<HTMLDivElement>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  // The select's empty-state label follows this, so a failed or empty
  // account list never sits on "Loading accounts…" forever.
  const [accounts, setAccounts] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [importAccount, setImportAccount] = useState("");
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [csvName, setCsvName] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Focus lands on the dialog itself (Tab then reaches the select first), so
  // a mouse-opened dialog doesn't greet you with a focus ring on a neutral
  // field; Tab wraps; focus returns to the opener and body scroll unlocks.
  useFocusTrap(ref, open, { initial: "container" });

  // Escape closes like every other floating surface; each opening starts
  // with a clean result line. The callback lives in a ref so the listener
  // registers once per opening (see ConfirmDialog); preventDefault tells the
  // batch bar the key is taken.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    setResult(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open || bankAccounts.length) return;
    let alive = true;
    setAccounts("loading");
    void (async () => {
      try {
        const res = await authFetch("/api/plaid/data?report=treasury");
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { accounts?: (BankAccount & { type?: string })[] };
        const banks = (data.accounts ?? []).filter((a) => a.type !== "investment");
        if (!alive) return;
        setBankAccounts(banks);
        setAccounts(banks.length ? "ready" : "empty");
        if (banks[0]) setImportAccount((cur) => cur || banks[0].account_id);
      } catch {
        if (alive) setAccounts("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, bankAccounts.length]);
  const accountsLabel =
    accounts === "loading" ? "Loading accounts…" : accounts === "error" ? "Couldn't load accounts" : "No bank accounts connected";

  function onCsvFile(file: File) {
    setCsvName(file.name);
    setResult(null);
    void file.text().then((text) => {
      const parsed = normalizeCsv(parseCsv(text));
      setCsvRows(parsed);
      if (!parsed.length) setResult({ ok: false, text: "Couldn't find date/amount/description columns in that file." });
    });
  }

  async function runImport() {
    if (importing || !importAccount || !csvRows.length) return;
    setImporting(true);
    setResult(null);
    try {
      const res = await authFetch("/api/books/import-csv", {
        method: "POST",
        body: JSON.stringify({ account_id: importAccount, rows: csvRows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Import failed.");
      setResult({ ok: true, text: `Imported ${data.imported} transactions (${data.skipped_existing} already present).` });
      setCsvRows([]);
      setCsvName("");
      onImported();
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : "Import failed." });
    } finally {
      setImporting(false);
    }
  }

  if (!open) return null;
  // The pill-button skin for the file control; the native input is visually
  // hidden and the label is its face, so the focus ring moves to the label.
  const fileBtn = `${BTN_BASE} h-[40px] sm:h-9 px-4 text-sm ${outlineBtn(isDark)} peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 ${
    isDark ? "peer-focus-visible:outline-[rgba(16,185,129,0.6)]" : "peer-focus-visible:outline-emerald-600"
  }`;
  return (
    // mousedown on the backdrop itself, not click: a drag that starts inside
    // the dialog (selecting text, dragging off the select) and releases over
    // the backdrop must not throw the chosen file away.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px] fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        className={`w-full max-w-md rounded-2xl border p-5 pop-in ${popoverSurface(isDark)}`}
      >
        <h2 id="import-title" className={`text-lg font-semibold tracking-tight ${t1}`}>Import bank CSV</h2>
        <p className={`mt-1 text-xs mb-4 ${t2}`}>
          For history Plaid can't reach (Wells Fargo beyond 90 days). Export the range from the
          bank's site, pick the account it belongs to, and import — duplicates are skipped.
        </p>

        <label htmlFor="import-account" className={`block ${MICRO} ${t2} mb-1`}>Account</label>
        <select
          id="import-account"
          value={importAccount}
          onChange={(e) => setImportAccount(e.target.value)}
          className={`w-full mb-3 h-[40px] sm:h-9 px-3.5 rounded-full text-[16px] sm:text-sm border cursor-pointer ${textInput(isDark)}`}
        >
          {bankAccounts.length === 0 && <option value="">{accountsLabel}</option>}
          {bankAccounts.map((a) => (
            <option key={a.account_id} value={a.account_id}>
              {(a.nickname || a.official_name || a.name) + (a.mask ? ` ····${a.mask}` : "")} — {a.institution_name}
            </option>
          ))}
        </select>

        <span id="import-file-label" className={`block ${MICRO} ${t2} mb-1`}>CSV file</span>
        <div className="flex items-center min-w-0 mb-3">
          <input
            id="import-file"
            type="file"
            accept=".csv,text/csv"
            aria-labelledby="import-file-label"
            onChange={(e) => e.target.files?.[0] && onCsvFile(e.target.files[0])}
            className="sr-only peer"
          />
          <label htmlFor="import-file" className={fileBtn}>
            Choose CSV…
          </label>
          <span className={`ml-3 text-xs truncate ${csvName ? t1 : t2}`} title={csvName || undefined}>
            {csvName || "No file chosen"}
          </span>
        </div>

        {csvRows.length > 0 && (
          <p className={`text-xs mb-3 ${t2}`}>
            <span className={`font-medium ${t1}`}>{csvRows.length} rows</span>,{" "}
            {csvRows.reduce((min, r) => (r.date < min ? r.date : min), csvRows[0].date)} →{" "}
            {csvRows.reduce((max, r) => (r.date > max ? r.date : max), csvRows[0].date)}
          </p>
        )}
        {result && (
          <p role="status" className={`text-xs mb-3 ${result.ok ? incomeTone(isDark) : "text-red-500"}`}>{result.text}</p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={`${BTN_BASE} h-[40px] sm:h-9 px-4 text-sm ${ghostBtn(isDark)}`}>
            Close
          </button>
          <button
            type="button"
            onClick={() => void runImport()}
            disabled={!csvRows.length || !importAccount}
            aria-busy={importing || undefined}
            className={`${BTN_BASE} h-[40px] sm:h-9 px-4 text-sm aria-busy:pointer-events-none ${primaryBtn(isDark)}`}
          >
            {importing ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
