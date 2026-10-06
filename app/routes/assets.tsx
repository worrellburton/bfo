import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router";
import { useTheme } from "../theme";
import { EstateMapView, INITIAL_ENTITIES } from "./estate-map";
import { entityCompleteness, entityType, type CompletenessItem } from "../entity-completeness";
import {
  BTN_BASE,
  Icon,
  MICRO,
  Menu,
  PATHS,
  TAG_PILL,
  TAP,
  Toast,
  amberTone,
  cardSurface,
  entityTag,
  entityTagClass,
  ghostBtn,
  hairline,
  incomeTone,
  outlineBtn,
  popoverSurface,
  primaryBtn,
  ruleBorder,
  setEntityTagLocal,
  textInput,
  tiers,
  useFocusTrap,
  useMedia,
} from "../books-shared";

export function meta() {
  return [{ title: "BFO - Assets" }];
}

interface Asset {
  id: string;
  name: string;
  type: "LLC" | "C-Corp" | "Trust";
  state: string;
  ein: string;
  createdAt: number;
  ownerId?: string;
  llcType?: "Disregarded Entity" | "Partnership" | "C Corporation" | "";
  initials?: string;
  stateLink?: string;
  operatingAgreementDate?: string;
  articlesOfOrgDate?: string;
  // Read for the completeness score; written on the entity page.
  address?: string;
  registeredAgent?: string;
  formationDate?: string;
  einLetter?: unknown;
  w9?: unknown;
  articles?: unknown;
  operatingAgreement?: unknown;
}

type SortKey = "name" | "type" | "llcType" | "state" | "ein" | "owner" | "filings" | "score";
type SortDir = "asc" | "desc";
type EntView = "list" | "cards" | "map";
type Score = { score: number; items: CompletenessItem[]; missing: CompletenessItem[] };

// ── Seed tables (unchanged from the original page) ──────────────────────────
// Ownership hierarchy from the estate map: child name (lowercased) → parent name.
const OWNERSHIP_MAP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const ent of INITIAL_ENTITIES) {
    if (ent.parentId) {
      const parent = INITIAL_ENTITIES.find((e) => e.id === ent.parentId);
      if (parent) map[ent.name.toLowerCase()] = parent.name;
    }
  }
  return map;
})();

// LLC type mapping based on known entity data
const LLC_TYPE_MAP: Record<string, "Disregarded Entity" | "Partnership" | "C Corporation"> = {
  "ledger louise, llc": "Disregarded Entity",
  "swisshelm mountain ventures, llc": "Disregarded Entity",
  "sundown investments, llc": "Disregarded Entity",
  "ledger burton, llc": "Disregarded Entity",
  "worrell burton, llc": "Disregarded Entity",
  "fdj hesperia, llc (100%)": "Disregarded Entity",
  "fdj cfs, llc (100%)": "Disregarded Entity",
  "palomino ranch on the bend, llc (100%)": "Disregarded Entity",
  "persons lodge llc (100%)": "Disregarded Entity",
  "breezewood (100%)": "Disregarded Entity",
  "arizona center for recovery - a new direction, llc": "Disregarded Entity",
  "quail lakes apartments, llc": "Partnership",
  "hsl tp hotel, llc": "Partnership",
  "hsl placita west ltd partnership": "Partnership",
};

const FILING_KEYS = ["einLetter", "w9", "articles", "operatingAgreement"] as const;

// ── States ──────────────────────────────────────────────────────────────────
// The fifty states plus DC, for the state filter's mega menu. Records may hold
// a name ("Arizona") or a postal code ("AZ"); both fold to the name.
const US_STATES: ReadonlyArray<readonly [string, string]> = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"],
  ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"],
  ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"],
  ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"],
  ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
];
const STATE_KEY = new Map<string, string>(US_STATES.flatMap(([abbr, name]) => [[abbr.toLowerCase(), name], [name.toLowerCase(), name]]));
const STATE_ABBR = new Map<string, string>(US_STATES.map(([abbr, name]) => [name, abbr]));
/** The value the "No state" choice stands for in the filter. */
const NO_STATE = "__none";
/** A record's state as the filter sees it: the full name for US states, else the trimmed text ("" when blank). */
function canonState(raw: string | undefined): string {
  const s = (raw || "").trim();
  return s ? STATE_KEY.get(s.toLowerCase()) ?? s : "";
}

/**
 * List ⇄ cards ⇄ map. Every screen defaults to the map; an explicit choice
 * is remembered per browser and wins over the default (the same contract as
 * the Books ledger).
 */
const VIEW_KEY = "bfo-entities-view";
function readStoredView(): EntView | null {
  try {
    const s = localStorage.getItem(VIEW_KEY);
    if (s === "list" || s === "cards" || s === "map") return s;
  } catch {
    /* private mode — fall through to the device default */
  }
  return null;
}

/** The head's fill and bottom rule live on the cells (see books-shared headSkin). */
function headSkin(isDark: boolean): string {
  return isDark
    ? "bg-[#080808] [&>th]:shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.08)]"
    : "bg-white [&>th]:shadow-[inset_0_-1px_0_0_#e5e7eb]";
}

// Fixed widths in px (the root is 85%, so rem columns would drift). Entity is
// the only fluid column; columns join as the viewport grows so the table
// never scrolls sideways: md Type · Owned by · Filings, xl State · EIN,
// 1400px Tax classification.
const COLS = {
  type: "w-[76px] hidden md:table-cell",
  llcType: "w-[136px] hidden min-[1400px]:table-cell",
  state: "w-[104px] hidden xl:table-cell",
  ein: "w-[108px] hidden xl:table-cell",
  owner: "w-[180px] hidden md:table-cell",
  filings: "w-[80px] hidden md:table-cell",
  score: "w-[116px]",
  menu: "w-[44px]",
};

/** "Missing: Registered agent, W-9 (+16)" — the points are what the record would gain. */
function missingSummary(s: Score, max = 2): string {
  if (!s.missing.length) return "All requirements on file";
  const names = s.missing.slice(0, max).map((m) => m.label);
  const more = s.missing.length - max;
  return `Missing: ${names.join(", ")}${more > 0 ? ` +${more} more` : ""} (+${100 - s.score})`;
}

/** The compliance ring's colour — the entity page's scale (emerald ≥ 90, indigo ≥ 60, amber below). */
function scoreTone(score: number, isDark: boolean): string {
  if (score >= 90) return isDark ? "text-emerald-400" : "text-emerald-600";
  if (score >= 60) return isDark ? "text-indigo-400" : "text-indigo-600";
  return isDark ? "text-amber-400" : "text-amber-600";
}
/** The score number beside a ring: green when there, amber when far off, plain between. */
function scoreText(score: number, isDark: boolean, plain: string): string {
  return score >= 90 ? incomeTone(isDark) : score < 60 ? amberTone(isDark) : plain;
}

// ── Small pieces ────────────────────────────────────────────────────────────

/** A completeness ring: the track plus an arc for the score. */
function Ring({ score, size, isDark, stroke = 2, children }: { score: number; size: number; isDark: boolean; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, score)) / 100);
  return (
    <span className={`relative inline-flex items-center justify-center shrink-0 ${scoreTone(score, isDark)}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className={isDark ? "stroke-white/10" : "stroke-gray-200"} />
        {score > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={off}
          />
        )}
      </svg>
      {children && <span className="absolute inset-0 flex items-center justify-center">{children}</span>}
    </span>
  );
}

// Tips warm up like the entity-tag tooltip: the first waits, the next ones
// are instant for a moment so scanning a column reads as one gesture.
let tipWarmUntil = 0;

/**
 * A hover / focus card rendered through a portal (never clipped by the
 * table). The trigger is a real button so it takes keyboard focus and a tap
 * opens it on touch; the summary rides on aria-label for screen readers.
 */
function Tip({
  isDark,
  label,
  content,
  children,
  className = "",
  width = 232,
}: {
  isDark: boolean;
  label: string;
  content: ReactNode;
  children: ReactNode;
  className?: string;
  width?: number;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | null>(null);
  const shown = useRef(false);
  const id = useId();
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    shown.current = true;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8));
    setPos(window.innerHeight - r.bottom > 220 ? { left, top: r.bottom + 8 } : { left, bottom: window.innerHeight - r.top + 8 });
  };
  const enter = () => {
    if (Date.now() < tipWarmUntil) show();
    else timer.current = window.setTimeout(show, 250);
  };
  const hide = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (shown.current) tipWarmUntil = Date.now() + 400;
    shown.current = false;
    setPos(null);
  };
  useEffect(() => {
    if (!pos) return;
    const h = () => hide();
    window.addEventListener("scroll", h, true);
    window.addEventListener("resize", h);
    return () => {
      window.removeEventListener("scroll", h, true);
      window.removeEventListener("resize", h);
    };
  }, [pos]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-describedby={pos ? id : undefined}
        onMouseEnter={enter}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={show}
        onKeyDown={(e) => {
          if (e.key === "Escape" && pos) {
            e.preventDefault();
            hide();
          }
        }}
        className={`inline-flex items-center rounded-md cursor-default ${className}`}
      >
        {children}
      </button>
      {pos &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width }}
            className={`z-[80] pointer-events-none rounded-xl border px-3 py-2.5 text-left tabular-nums ${
              pos.top !== undefined ? "pop-in origin-top" : "pop-in-up origin-bottom"
            } ${popoverSurface(isDark)}`}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
}

type RowAction = { label: string; run?: () => void; href?: string };

/**
 * The row kebab: an anchored popover on sm+, a bottom sheet on phones (the
 * same idiom as the ledger's ⋯). Arrow keys move, Escape / Tab close, focus
 * returns to the trigger.
 */
function RowMenu({
  isDark,
  name,
  actions,
  onOpenChange,
  className = "",
}: {
  isDark: boolean;
  name: string;
  actions: RowAction[];
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const { t1, t3 } = tiers(isDark);
  const smUp = useMedia("(min-width: 640px)");
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [box, setBox] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusFirst = useRef(false);
  const W = 200;

  const items = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? []);
  const setBoth = (v: boolean) => {
    setOpen(v);
    onOpenChange?.(v);
  };
  const close = (refocus: boolean) => {
    setBoth(false);
    setBox(null);
    if (refocus) btnRef.current?.focus({ preventScroll: true });
  };
  const openMenu = (kbd: boolean) => {
    focusFirst.current = kbd;
    setSheet(!smUp);
    setBoth(true);
  };

  useFocusTrap(panelRef, open && sheet, { initial: "container" });

  useLayoutEffect(() => {
    if (!open || sheet) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const h = actions.length * 32 + 10;
    const left = Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8));
    setBox(window.innerHeight - r.bottom > h + 12 ? { left, top: r.bottom + 6 } : { left, bottom: window.innerHeight - r.top + 6 });
  }, [open, sheet, actions.length]);

  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    if (focusFirst.current) {
      focusFirst.current = false;
      requestAnimationFrame(() => items()[0]?.focus());
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      closeRef.current(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current(true);
      }
    };
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (!sheet) closeRef.current(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, sheet]);

  const onPanelKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab") {
      if (!sheet) close(false);
      return;
    }
    const list = items();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = (i + 1) % list.length;
    else if (e.key === "ArrowUp") next = i < 0 ? list.length - 1 : (i - 1 + list.length) % list.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = list.length - 1;
    if (next < 0) return;
    e.preventDefault();
    list[next].focus();
  };

  const itemSkin = isDark
    ? "text-gray-200 hover:bg-white/[0.08] focus-visible:bg-white/[0.08]"
    : "text-gray-800 hover:bg-gray-100 focus-visible:bg-gray-100";
  const itemCls = sheet
    ? `w-full min-h-[44px] px-3 rounded-lg text-base text-left inline-flex items-center gap-3 cursor-pointer transition-colors ${itemSkin}`
    : `w-full h-8 px-2 rounded-lg text-xs text-left inline-flex items-center whitespace-nowrap cursor-pointer transition-colors ${itemSkin}`;
  const renderItems = () =>
    actions.map((a) =>
      a.href ? (
        <a key={a.label} role="menuitem" href={a.href} target="_blank" rel="noopener noreferrer" onClick={() => close(false)} className={itemCls}>
          {a.label}
          <Icon d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" className="ml-auto w-3 h-3 opacity-50" />
        </a>
      ) : (
        <button
          key={a.label}
          type="button"
          role="menuitem"
          onClick={() => {
            // Refocus the kebab first so whatever the action opens records it.
            close(true);
            a.run?.();
          }}
          className={itemCls}
        >
          {a.label}
        </button>
      )
    );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? close(false) : openMenu(false))}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
            e.preventDefault();
            if (open) items()[0]?.focus();
            else openMenu(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${name}`}
        className={`w-7 h-7 rounded-md inline-flex items-center justify-center cursor-pointer transition-[color,background-color,opacity] ${TAP.box} ${t3} ${
          isDark
            ? "hover:bg-white/[0.06] hover:text-white aria-expanded:bg-white/[0.08] aria-expanded:text-gray-100"
            : "hover:bg-gray-100 hover:text-gray-900 aria-expanded:bg-gray-100 aria-expanded:text-gray-900"
        } ${className}`}
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      {open &&
        (sheet || box) &&
        createPortal(
          sheet ? (
            <>
              <div className="fixed inset-0 z-[69] bg-black/50 backdrop-blur-[2px] fade-in" onClick={() => close(true)} aria-hidden />
              <div
                ref={panelRef}
                role="menu"
                aria-label={`Actions for ${name}`}
                tabIndex={-1}
                onKeyDown={onPanelKey}
                className={`fixed inset-x-0 bottom-0 z-[70] rounded-t-2xl border flex flex-col pb-[max(env(safe-area-inset-bottom),12px)] sheet-in ${popoverSurface(isDark)}`}
              >
                <div className={`mx-auto mt-2 mb-1 h-1 w-10 rounded-full shrink-0 ${isDark ? "bg-white/20" : "bg-gray-300"}`} aria-hidden />
                <p className={`px-4 pt-2 pb-1 text-base font-semibold truncate ${t1}`}>{name}</p>
                <div className="p-2">{renderItems()}</div>
              </div>
            </>
          ) : (
            <div
              ref={panelRef}
              role="menu"
              aria-label={`Actions for ${name}`}
              onKeyDown={onPanelKey}
              style={{ position: "fixed", left: box!.left, top: box!.top, bottom: box!.bottom, width: W }}
              className={`z-[70] rounded-xl border p-1 ${box!.top !== undefined ? "pop-in origin-top" : "pop-in-up origin-bottom"} ${popoverSurface(isDark)}`}
            >
              {renderItems()}
            </div>
          ),
          document.body
        )}
    </>
  );
}

// ── State filter: a mega menu ───────────────────────────────────────────────
type StateChoice = { value: string; label: string; abbr?: string; count: number };

/**
 * The toolbar's state filter. A wide panel under the trigger (a bottom sheet
 * on phones): a search field, the states in use with their entity counts,
 * then every other state in an alphabetical grid, plus "No state". Several
 * can be picked; the list shows entities in any of them. Arrow keys move
 * through the grid (up / down by row), typing jumps to a state, Space or
 * Enter toggles, Escape closes; focus stays inside until it does.
 */
function StateMegaMenu({
  isDark,
  value,
  onChange,
  counts,
  noState,
}: {
  isDark: boolean;
  value: string[];
  onChange: (v: string[]) => void;
  /** Entities per state in use (canonical names). */
  counts: Map<string, number>;
  /** Entities with no state recorded. */
  noState: number;
}) {
  const { t1, t2, t3 } = tiers(isDark);
  const smUp = useMedia("(min-width: 640px)");
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [q, setQ] = useState("");
  const [box, setBox] = useState<{ left: number; top?: number; bottom?: number; width: number; maxH: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<number | null>(null);
  const typed = useRef({ buf: "", at: 0 });
  const titleId = useId();
  const selected = useMemo(() => new Set(value), [value]);

  const inUse: StateChoice[] = useMemo(
    () => [
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name, count]) => ({ value: name, label: name, abbr: STATE_ABBR.get(name), count })),
      ...(noState ? [{ value: NO_STATE, label: "No state", count: noState }] : []),
    ],
    [counts, noState]
  );
  const others: StateChoice[] = useMemo(
    () => US_STATES.filter(([, name]) => !counts.has(name)).map(([abbr, name]) => ({ value: name, label: name, abbr, count: 0 })),
    [counts]
  );
  const needle = q.trim().toLowerCase();
  const hit = (c: StateChoice) =>
    !needle || c.label.toLowerCase().includes(needle) || c.abbr?.toLowerCase() === needle || (c.value === NO_STATE && "none".startsWith(needle));
  const shownInUse = inUse.filter(hit);
  const shownOthers = others.filter(hit);

  const text =
    value.length === 0 ? "All states" : value.length === 1 ? (value[0] === NO_STATE ? "No state" : value[0]) : `${value.length} states`;

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  function finishClose() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setClosing(false);
    setOpen(false);
    setBox(null);
    setQ("");
  }
  // The exit animation plays before unmount. Focus goes back to the trigger
  // for every close the keyboard could have caused, not for a click elsewhere.
  function requestClose(refocus: boolean) {
    if (!open || closing) return;
    setClosing(true);
    if (refocus) btnRef.current?.focus({ preventScroll: true });
    closeTimer.current = window.setTimeout(finishClose, 220);
  }
  function openPanel() {
    if (closing) return;
    setSheet(!smUp);
    setOpen(true);
  }
  const toggle = (v: string) => onChange(selected.has(v) ? value.filter((x) => x !== v) : [...value, v]);

  // The sheet is modal (scroll lock + trap); the popover wraps Tab itself.
  // (The sheet takes focus on its container so the phone keyboard stays down.)
  useFocusTrap(panelRef, open && sheet, { initial: "container" });
  useEffect(() => {
    if (open && !sheet) requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
  }, [open, sheet]);

  useLayoutEffect(() => {
    if (!open || sheet || closing) return;
    function place() {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(window.innerWidth - 16, 600);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const below = window.innerHeight - r.bottom - 16;
      const above = r.top - 16;
      setBox(
        below < 360 && above > below
          ? { left, bottom: window.innerHeight - r.top + 8, width, maxH: Math.min(560, above - 8) }
          : { left, top: r.bottom + 8, width, maxH: Math.max(240, Math.min(560, below - 8)) }
      );
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, sheet, closing]);

  useEffect(() => {
    if (!open || closing) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      requestClose(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closing]);

  const options = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>("[data-state-opt]") ?? []);
  /** Up / down move by row through the grids (and across the two groups); left / right step. */
  function moveFrom(cur: HTMLElement, dir: "up" | "down"): HTMLElement | undefined {
    const r = cur.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cands = options()
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r: o }) => (dir === "down" ? o.top >= r.bottom - 2 : o.bottom <= r.top + 2));
    if (!cands.length) return undefined;
    const rowY = dir === "down" ? Math.min(...cands.map((c) => c.r.top)) : Math.max(...cands.map((c) => c.r.top));
    const row = cands.filter((c) => Math.abs(c.r.top - rowY) < 4);
    row.sort((a, b) => Math.abs(a.r.left + a.r.width / 2 - cx) - Math.abs(b.r.left + b.r.width / 2 - cx));
    return row[0]?.el;
  }

  function onPanelKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    // Keys typed here never reach the map's window shortcuts (F fits, +/− zoom).
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      requestClose(true);
      return;
    }
    if (e.key === "Tab" && !sheet) {
      const list = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>("input, button:not([disabled])") ?? []
      ).filter((el) => el.offsetParent !== null);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    const list = options();
    if (active === searchRef.current) {
      if (e.key === "ArrowDown" && list.length) {
        e.preventDefault();
        list[0].focus();
      } else if (e.key === "Enter" && needle && list.length) {
        e.preventDefault();
        list[0].click();
      }
      return;
    }
    const i = active ? list.indexOf(active) : -1;
    if (i < 0) return;
    let next: HTMLElement | undefined;
    if (e.key === "ArrowRight") next = list[Math.min(i + 1, list.length - 1)];
    else if (e.key === "ArrowLeft") next = list[Math.max(i - 1, 0)];
    else if (e.key === "ArrowDown") next = moveFrom(active!, "down");
    else if (e.key === "ArrowUp") {
      next = moveFrom(active!, "up");
      if (!next) next = searchRef.current ?? undefined;
    } else if (e.key === "Home") next = list[0];
    else if (e.key === "End") next = list[list.length - 1];
    else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Typeahead: letters build a prefix for a moment, then reset.
      const now = Date.now();
      const t = typed.current;
      t.buf = now - t.at > 700 ? e.key.toLowerCase() : t.buf + e.key.toLowerCase();
      t.at = now;
      const label = (el: HTMLElement) => (el.dataset.label ?? "").toLowerCase();
      const start = t.buf.length === 1 ? i + 1 : i;
      next = [...list.slice(start), ...list.slice(0, start)].find((el) => label(el).startsWith(t.buf));
    } else return;
    e.preventDefault();
    next?.focus();
    next?.scrollIntoView({ block: "nearest" });
  }

  // ── Skins ──
  const trigger = `group/menu inline-flex items-center gap-1.5 h-[40px] sm:h-9 pl-4 pr-3 rounded-full border text-sm font-medium whitespace-nowrap cursor-pointer transition-colors max-w-[240px] ${TAP.md} ${
    isDark
      ? "bg-white/[0.04] border-white/10 text-gray-200 hover:bg-white/[0.08] hover:border-white/15 aria-expanded:bg-white/[0.1] aria-expanded:border-white/20"
      : "bg-white border-gray-200 text-gray-800 hover:bg-gray-50 hover:border-gray-300 aria-expanded:bg-gray-100 aria-expanded:border-gray-300"
  }`;
  const hl = isDark ? "hover:bg-white/[0.08] focus-visible:bg-white/[0.08]" : "hover:bg-gray-100 focus-visible:bg-gray-100";
  const optCls = `group/opt w-full min-w-0 flex items-center rounded-lg text-left cursor-pointer transition-colors focus-visible:outline-0! ${
    isDark ? "focus-visible:ring-1 focus-visible:ring-white/25" : "focus-visible:ring-1 focus-visible:ring-gray-300"
  } ${hl} ${sheet ? "min-h-[44px] px-2.5 gap-2.5 text-[15px]" : "h-8 px-2 gap-2 text-xs"}`;
  const check = (on: boolean) => (
    <span
      aria-hidden
      className={`shrink-0 inline-flex items-center justify-center rounded-[4px] border transition-colors ${sheet ? "w-[18px] h-[18px]" : "w-[14px] h-[14px]"} ${
        on
          ? isDark ? "bg-indigo-500 border-indigo-500 text-white" : "bg-indigo-600 border-indigo-600 text-white"
          : isDark ? "border-white/25 group-hover/opt:border-white/40" : "border-gray-300 group-hover/opt:border-gray-400"
      }`}
    >
      {on && <Icon d={PATHS.check} strokeWidth={3} className={sheet ? "w-3 h-3" : "w-2.5 h-2.5"} />}
    </span>
  );
  const option = (c: StateChoice, withCount: boolean) => {
    const on = selected.has(c.value);
    return (
      <button
        key={c.value}
        type="button"
        role="checkbox"
        aria-checked={on}
        data-state-opt
        data-label={c.label}
        onClick={() => toggle(c.value)}
        title={c.label}
        className={`${optCls} ${on ? `font-medium ${t1}` : isDark ? "text-gray-300" : "text-gray-700"}`}
      >
        {check(on)}
        <span className={`truncate flex-1 ${c.value === NO_STATE && !on ? t2 : ""}`}>{c.label}</span>
        {withCount && <span className={`shrink-0 tabular-nums ${on ? t2 : t3}`}>{c.count}</span>}
      </button>
    );
  };
  const head = (label: string, note?: string) => (
    <p className={`flex items-baseline gap-2 px-2 pt-2 pb-1 text-xs font-medium ${t2}`}>
      {label}
      {note && <span className={`font-normal ${t3}`}>{note}</span>}
    </p>
  );
  const smallBtn = `${BTN_BASE} ${sheet ? "h-[40px] px-5 text-sm" : "h-7 px-3 text-xs"}`;

  const panelBody = (
    <>
      <div className={`shrink-0 border-b ${sheet ? "px-3 pt-1 pb-2.5" : "p-2.5"} ${hairline(isDark)}`}>
        <div className="relative">
          <Icon d={PATHS.search} strokeWidth={2} className={`absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none ${t3}`} />
          <input
            ref={searchRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search states…"
            aria-label="Search states"
            className={`w-full rounded-full border pl-8 [&::-webkit-search-cancel-button]:appearance-none ${
              sheet ? "h-[40px] pr-3.5 text-[16px] placeholder:text-base" : "h-8 pr-3 text-xs focus-visible:outline-0!"
            } ${textInput(isDark)}`}
          />
        </div>
      </div>
      <div className={`flex-1 min-h-0 overflow-y-auto overscroll-contain ${sheet ? "px-2 pb-2" : "px-1.5 pb-1.5"}`}>
        {shownInUse.length === 0 && shownOthers.length === 0 && <p className={`px-2 py-3 text-xs ${t2}`}>No states match.</p>}
        {shownInUse.length > 0 && (
          <div role="group" aria-label="States in use">
            {head("States in use", "entities")}
            <div className={`grid gap-x-1 ${sheet ? "grid-cols-1" : "grid-cols-3"}`}>{shownInUse.map((c) => option(c, true))}</div>
          </div>
        )}
        {shownOthers.length > 0 && (
          <div role="group" aria-label="Other states" className={shownInUse.length ? `mt-1.5 border-t pt-0.5 ${hairline(isDark)}` : ""}>
            {head(shownInUse.length ? "Other states" : "States")}
            <div className={`grid gap-x-1 ${sheet ? "grid-cols-2" : "grid-cols-4"}`}>{shownOthers.map((c) => option(c, false))}</div>
          </div>
        )}
      </div>
      <div className={`shrink-0 flex items-center gap-2 border-t ${sheet ? "px-4 pt-2.5" : "px-3 py-2"} ${hairline(isDark)}`}>
        <p className={`flex-1 min-w-0 truncate text-xs ${t2}`} aria-live="polite">
          {value.length === 0 ? "Showing every state" : `${value.length} selected · entities in any of them`}
        </p>
        <button type="button" onClick={() => onChange([])} disabled={value.length === 0} className={`${smallBtn} ${ghostBtn(isDark)}`}>
          Clear
        </button>
        <button type="button" onClick={() => requestClose(true)} className={`${smallBtn} ${primaryBtn(isDark)}`}>
          Done
        </button>
      </div>
    </>
  );

  const enter = sheet ? "sheet-in" : box?.bottom !== undefined ? "pop-in-up origin-bottom" : "pop-in origin-top";
  const exit = sheet ? "sheet-out" : box?.bottom !== undefined ? "pop-out-up" : "pop-out";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? requestClose(false) : openPanel())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            openPanel();
          }
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`State: ${text}`}
        className={trigger}
      >
        {value.length > 0 && <span aria-hidden className={`w-1.5 h-1.5 rounded-full shrink-0 ${isDark ? "bg-indigo-400" : "bg-indigo-600"}`} />}
        <span className="truncate">{text}</span>
        <Icon
          d={PATHS.chevron}
          strokeWidth={2}
          className={`w-3 h-3 shrink-0 opacity-50 transition-[rotate] motion-reduce:transition-none ${open && !closing ? "rotate-180" : ""}`}
        />
      </button>
      {open &&
        (sheet || box) &&
        createPortal(
          <>
            {sheet && (
              <div
                className={`fixed inset-0 z-[69] bg-black/50 backdrop-blur-[2px] ${closing ? "fade-out" : "fade-in"}`}
                onClick={() => requestClose(true)}
                aria-hidden
              />
            )}
            <div
              ref={panelRef}
              role="dialog"
              aria-modal={sheet || undefined}
              aria-label={sheet ? undefined : "Filter by state"}
              aria-labelledby={sheet ? titleId : undefined}
              onKeyDown={onPanelKey}
              onAnimationEnd={(e) => {
                if (closing && e.target === e.currentTarget) finishClose();
              }}
              style={
                sheet
                  ? { position: "fixed", left: 0, right: 0, bottom: 0 }
                  : { position: "fixed", left: box!.left, top: box!.top, bottom: box!.bottom, width: box!.width, maxHeight: box!.maxH }
              }
              className={`z-[70] border overflow-hidden flex flex-col tabular-nums ${
                sheet ? "rounded-t-2xl max-h-[82vh] pb-[max(env(safe-area-inset-bottom),12px)]" : "rounded-xl"
              } ${closing ? `${exit} pointer-events-none` : enter} ${popoverSurface(isDark)}`}
            >
              {sheet && (
                <>
                  <div className={`mx-auto mt-2 h-1 w-10 rounded-full shrink-0 ${isDark ? "bg-white/20" : "bg-gray-300"}`} aria-hidden />
                  <p id={titleId} className={`px-4 pt-2 pb-1.5 text-base font-semibold ${t1}`}>
                    State
                  </p>
                </>
              )}
              {panelBody}
            </div>
          </>,
          document.body
        )}
    </>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function Assets() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const navigate = useNavigate();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "name", dir: "asc" });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState<"all" | "LLC" | "C-Corp" | "Trust">("all");
  const [stateF, setStateF] = useState<string[]>([]);
  const [attention, setAttention] = useState(false);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [copiedEin, setCopiedEin] = useState<string | null>(null);
  const [menuRow, setMenuRow] = useState<string | null>(null);

  const [choice, setChoice] = useState<EntView | null>(readStoredView);
  const view: EntView = choice ?? "map";
  const pickView = (v: EntView) => {
    setChoice(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* the choice just doesn't persist */
    }
  };

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let alive = true;

    async function setup() {
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, onValue, get, update, push } = await import("firebase/database");

      // One-time seed: create any Estate Map entities that don't exist yet
      if (!localStorage.getItem("bfo-assets-seeded-v1")) {
        try {
          const snap = await get(ref(db, "assets"));
          const existing = snap.val() || {};
          const existingNames = new Set<string>(
            Object.values(existing).map((a: any) => (a?.name || "").toLowerCase())
          );
          for (const ent of INITIAL_ENTITIES) {
            if (!existingNames.has(ent.name.toLowerCase())) {
              const lower = ent.name.toLowerCase();
              const type = /\btrust\b/.test(lower) ? "Trust" : lower.includes("inc") && !lower.includes("llc") ? "C-Corp" : "LLC";
              await push(ref(db, "assets"), {
                name: ent.name,
                type,
                state: "",
                ein: "",
                createdAt: Date.now(),
              });
            }
          }
          localStorage.setItem("bfo-assets-seeded-v1", "1");
        } catch (err) {
          console.error("Estate seed error:", err);
        }
      }

      // One-time seed: populate entity details from spreadsheet data
      if (!localStorage.getItem("bfo-entity-details-seeded-v1")) {
        try {
          const snap2 = await get(ref(db, "assets"));
          const all = snap2.val() || {};
          const entityData: Record<string, { state?: string; ein?: string; type?: string; address?: string; formationDate?: string }> = {
            "burton family revocable trust": { type: "Trust", state: "", address: "" },
            "ledger burton, llc": { state: "Delaware", ein: "93-3749778", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028", formationDate: "2023-08-17" },
            "ledger louise, llc": { state: "Nevada", ein: "93-3776895", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028", formationDate: "2023-08-11" },
            "sundown investments, llc": { state: "Arizona", ein: "93-3965064", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028", formationDate: "2023-08-16" },
            "swisshelm mountain ventures, llc": { state: "Arizona", ein: "93-3788576", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028", formationDate: "2023-08-30" },
            "worrell burton, llc": { state: "Nevada", ein: "93-3856277", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028", formationDate: "2023-08-28" },
            "arizona center for recovery - a new direction, llc": { state: "Arizona", ein: "85-3388398", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028", formationDate: "2019-06-25" },
            "fdj hesperia, llc (100%)": { state: "Arizona", ein: "81-0625880", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028", formationDate: "2016-06-09" },
            "palomino ranch on the bend, llc (100%)": { state: "Arizona", ein: "45-2077575", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028", formationDate: "2011-05-11" },
            "breezewood (100%)": { state: "Arizona", ein: "27-0298583", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028", formationDate: "2000-06-04" },
            "persons lodge llc (100%)": { state: "Arizona", ein: "83-0788287", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028", formationDate: "2016-06-09" },
            "vq national": { state: "Arizona", ein: "86-0278038", type: "C-Corp", address: "11201 N Tatum Blvd Ste 300, PMB, Phoenix, AZ 85028" },
            "catalog digital, inc": { state: "Delaware", ein: "92-3587849", type: "C-Corp", address: "540 Hudson #6, New York, NY 10014", formationDate: "2023-04-12" },
            "quail lakes apartments, llc": { state: "Arizona", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028" },
            "hsl tp hotel, llc": { state: "Arizona", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028" },
            "hsl placita west ltd partnership": { state: "Arizona", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028" },
            "fdj cfs, llc (100%)": { state: "Delaware", formationDate: "2017-01-24" },
            "atlas hydration, inc": { type: "C-Corp" },
          };
          for (const [fbId, fbVal] of Object.entries(all)) {
            const name = ((fbVal as any)?.name || "").toLowerCase();
            const seed = entityData[name];
            if (seed) {
              const updates: Record<string, string> = {};
              if (seed.state && !(fbVal as any).state) updates.state = seed.state;
              if (seed.ein && !(fbVal as any).ein) updates.ein = seed.ein;
              if (seed.type && (fbVal as any).type !== seed.type) updates.type = seed.type;
              if (seed.address && !(fbVal as any).address) updates.address = seed.address;
              if (seed.formationDate && !(fbVal as any).formationDate) updates.formationDate = seed.formationDate;
              if (Object.keys(updates).length > 0) {
                await update(ref(db, `assets/${fbId}`), updates);
              }
            }
          }
          localStorage.setItem("bfo-entity-details-seeded-v1", "1");
        } catch (err) {
          console.error("Entity details seed error:", err);
        }
      }

      // One-time seed: populate ownership and LLC type
      if (!localStorage.getItem("bfo-ownership-seeded-v1")) {
        try {
          const snap3 = await get(ref(db, "assets"));
          const all3 = snap3.val() || {};
          // Build name-to-id lookup
          const nameToId: Record<string, string> = {};
          for (const [fbId, fbVal] of Object.entries(all3)) {
            const name = ((fbVal as any)?.name || "").toLowerCase();
            nameToId[name] = fbId;
          }
          for (const [fbId, fbVal] of Object.entries(all3)) {
            const name = ((fbVal as any)?.name || "").toLowerCase();
            const updates: Record<string, string> = {};
            // Set ownerId from estate map hierarchy
            const ownerName = OWNERSHIP_MAP[name];
            if (ownerName && !(fbVal as any).ownerId) {
              const ownerId = nameToId[ownerName.toLowerCase()];
              if (ownerId) updates.ownerId = ownerId;
            }
            // Set llcType
            const llcType = LLC_TYPE_MAP[name];
            if (llcType && !(fbVal as any).llcType) {
              updates.llcType = llcType;
            }
            if (Object.keys(updates).length > 0) {
              await update(ref(db, `assets/${fbId}`), updates);
            }
          }
          localStorage.setItem("bfo-ownership-seeded-v1", "1");
        } catch (err) {
          console.error("Ownership seed error:", err);
        }
      }

      // One-time fix: early seeding saved every non-Inc entity as an "LLC",
      // the family trust included. Store trusts as trusts.
      if (!localStorage.getItem("bfo-trust-type-v1")) {
        try {
          const snap4 = await get(ref(db, "assets"));
          const all4 = (snap4.val() || {}) as Record<string, { name?: string; type?: string }>;
          for (const [fbId, v] of Object.entries(all4)) {
            if (v?.type === "LLC" && /\btrust\b/i.test(v?.name ?? "")) {
              await update(ref(db, `assets/${fbId}`), { type: "Trust" });
            }
          }
          localStorage.setItem("bfo-trust-type-v1", "1");
        } catch (err) {
          console.error("Trust type fix error:", err);
        }
      }

      if (!alive) return;
      unsubscribe = onValue(
        ref(db, "assets"),
        (snapshot) => {
          const data = snapshot.val();
          if (data) {
            const arr = Object.entries(data).map(([id, value]) => {
              const a = { id, ...(value as Omit<Asset, "id">) };
              // Old records stored the trust as an "LLC"; show its real type.
              return { ...a, type: entityType(a) };
            });
            setAssets(arr);
          } else {
            setAssets([]);
          }
          setLoadError("");
          setLoading(false);
        },
        (err) => {
          console.error("Assets load error:", err);
          setLoadError("Couldn't load entities.");
          setLoading(false);
        }
      );
    }

    setup().catch((err) => {
      console.error("Assets load error:", err);
      if (!alive) return;
      setLoadError("Couldn't load entities.");
      setLoading(false);
    });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);

  async function handleCreate(fields: { name: string; type: "LLC" | "C-Corp" | "Trust"; state: string; ein: string }) {
    const { db } = await import("../firebase");
    const { push, ref } = await import("firebase/database");
    await push(ref(db, "assets"), {
      name: fields.name.trim(),
      type: fields.type,
      state: fields.state.trim(),
      ein: fields.ein.trim(),
      createdAt: Date.now(),
    });
  }

  async function saveInitials(asset: Asset, raw: string) {
    const initials = raw.trim().toUpperCase().slice(0, 4);
    try {
      const { db } = await import("../firebase");
      const { ref, update } = await import("firebase/database");
      await update(ref(db, `assets/${asset.id}`), { initials });
      // Books tags pick the change up immediately, not just next session.
      setEntityTagLocal(asset.name, initials || null);
    } catch {
      setToast("Couldn't save those initials.");
    }
  }

  function copyEin(ein: string) {
    void navigator.clipboard?.writeText(ein).then(() => {
      setCopiedEin(ein);
      setTimeout(() => setCopiedEin(null), 1200);
    });
  }

  async function updateOwner(assetId: string, ownerId: string) {
    try {
      const { db } = await import("../firebase");
      const { ref, update } = await import("firebase/database");
      await update(ref(db, `assets/${assetId}`), { ownerId: ownerId || "" });
    } catch {
      setToast("Couldn't change the owner.");
    }
  }

  // ── Derived data ─────────────────────────────────────────────────────────
  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const scores = useMemo(() => new Map<string, Score>(assets.map((a) => [a.id, entityCompleteness(a)])), [assets]);
  const scoreOf = (a: Asset) => scores.get(a.id) ?? entityCompleteness(a);
  // Children by owner (only owners that exist; a self-owner is a root).
  const childrenOf = useMemo(() => {
    const m = new Map<string, Asset[]>();
    for (const a of assets) {
      if (!a.ownerId || a.ownerId === a.id || !byId.has(a.ownerId)) continue;
      const list = m.get(a.ownerId) ?? [];
      list.push(a);
      m.set(a.ownerId, list);
    }
    return m;
  }, [assets, byId]);
  const ownerName = (a: Asset) => (a.ownerId ? byId.get(a.ownerId)?.name ?? "" : "");
  const tagOf = (a: { name: string; initials?: string }) => a.initials || entityTag(a.name);
  const filingCount = (a: Asset) => FILING_KEYS.filter((k) => !!a[k]).length;

  function descendantsOf(id: string): Set<string> {
    const out = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const k of childrenOf.get(cur) ?? []) {
        if (out.has(k.id)) continue;
        out.add(k.id);
        stack.push(k.id);
      }
    }
    return out;
  }

  // Entities per state (US states folded to their names) for the state menu.
  const stateCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assets) {
      const st = canonState(a.state);
      if (st) m.set(st, (m.get(st) ?? 0) + 1);
    }
    return m;
  }, [assets]);
  const statelessCount = assets.filter((a) => !canonState(a.state)).length;
  const inStates = (a: Asset) => !stateF.length || stateF.includes(canonState(a.state) || NO_STATE);

  // ── Filtering ────────────────────────────────────────────────────────────
  const needle = q.trim().toLowerCase();
  const digits = needle.replace(/\D/g, "");
  const filtered = Boolean(needle) || typeF !== "all" || stateF.length > 0 || attention;
  const matches = (a: Asset) => {
    if (typeF !== "all" && a.type !== typeF) return false;
    const st = (a.state || "").trim();
    if (!inStates(a)) return false;
    if (attention && scoreOf(a).score >= 100) return false;
    if (!needle) return true;
    return (
      a.name.toLowerCase().includes(needle) ||
      st.toLowerCase().includes(needle) ||
      (a.ein || "").toLowerCase().includes(needle) ||
      (digits.length >= 2 && (a.ein || "").replace(/\D/g, "").includes(digits)) ||
      tagOf(a).toLowerCase() === needle
    );
  };
  const matched = assets.filter(matches);
  const matchedIds = new Set(matched.map((a) => a.id));
  function clearFilters() {
    setQ("");
    setTypeF("all");
    setStateF([]);
    setAttention(false);
  }

  // ── Sorting ──────────────────────────────────────────────────────────────
  // Sorting by Entity keeps the ownership tree (siblings ordered by name);
  // any other column flattens the list so e.g. the weakest records rise to
  // the top across the whole family. Blank values always sort last.
  const treeMode = sort.key === "name";
  const textKey = (a: Asset): string => {
    switch (sort.key) {
      case "type":
        return a.type || "";
      case "llcType":
        return a.llcType || "";
      case "state":
        return (a.state || "").trim();
      case "ein":
        return (a.ein || "").trim();
      case "owner":
        return ownerName(a);
      default:
        return a.name;
    }
  };
  const cmp = (a: Asset, b: Asset): number => {
    const dir = sort.dir === "asc" ? 1 : -1;
    if (sort.key === "score" || sort.key === "filings") {
      const d = sort.key === "score" ? scoreOf(a).score - scoreOf(b).score : filingCount(a) - filingCount(b);
      return d * dir || a.name.localeCompare(b.name);
    }
    const x = textKey(a);
    const y = textKey(b);
    if (!x !== !y) return x ? -1 : 1;
    return x.localeCompare(y) * dir || a.name.localeCompare(b.name);
  };
  const onSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );

  type Row = { asset: Asset; depth: number; kids: number; context: boolean };
  // The tree: matches plus their ancestors (shown muted, for context), in
  // pre-order. Cycles (A owns B owns A) fall back to roots so nothing hides.
  function buildRows(respectCollapse: boolean): Row[] {
    if (!treeMode) return [...matched].sort(cmp).map((asset) => ({ asset, depth: 0, kids: 0, context: false }));
    const visible = new Set<string>();
    for (const a of matched) {
      let cur: Asset | undefined = a;
      const guard = new Set<string>();
      while (cur && !guard.has(cur.id)) {
        guard.add(cur.id);
        visible.add(cur.id);
        cur = cur.ownerId && cur.ownerId !== cur.id ? byId.get(cur.ownerId) : undefined;
      }
    }
    const inSet = assets.filter((a) => visible.has(a.id));
    const kidsOf = (id: string) => (childrenOf.get(id) ?? []).filter((k) => visible.has(k.id)).sort(cmp);
    const out: Row[] = [];
    const seen = new Set<string>();
    const walk = (a: Asset, depth: number) => {
      if (seen.has(a.id)) return;
      seen.add(a.id);
      const kids = kidsOf(a.id);
      out.push({ asset: a, depth, kids: kids.length, context: !matchedIds.has(a.id) });
      if (respectCollapse && collapsed.has(a.id)) {
        // Mark the hidden subtree seen so the cycle sweep doesn't resurface it.
        for (const d of descendantsOf(a.id)) seen.add(d);
        return;
      }
      for (const k of kids) walk(k, depth + 1);
    };
    const roots = inSet.filter((a) => !a.ownerId || a.ownerId === a.id || !visible.has(a.ownerId)).sort(cmp);
    for (const r of roots) walk(r, 0);
    for (const a of inSet.sort(cmp)) if (!seen.has(a.id)) walk(a, 0);
    return out;
  }
  const rows = buildRows(true);
  const cardRows = buildRows(false).filter((r) => !r.context);
  const parentIds = [...childrenOf.keys()];
  const allExpanded = collapsed.size === 0;
  const toggleNode = (id: string, open?: boolean) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      const isOpen = !next.has(id);
      if (open === undefined ? isOpen : !open) next.add(id);
      else next.delete(id);
      return next;
    });

  const ownerOptions = (a: Asset) => {
    // An entity can't be owned by itself or by anything beneath it.
    const banned = descendantsOf(a.id);
    banned.add(a.id);
    if (a.ownerId) banned.delete(a.ownerId);
    return [
      { value: "", label: "No owner" },
      ...[...assets]
        .filter((o) => !banned.has(o.id))
        .sort((x, y) => x.name.localeCompare(y.name))
        .map((o) => ({
          value: o.id,
          label: o.name,
          icon: <span className={`${TAG_PILL} ${entityTagClass(o.name, isDark)}`}>{tagOf(o)}</span>,
        })),
    ];
  };

  // ── Summary (the filtered set, like the ledger's strip) ──────────────────
  const total = matched.length;
  const llcs = matched.filter((a) => a.type === "LLC").length;
  const corps = matched.filter((a) => a.type === "C-Corp").length;
  const trusts = matched.filter((a) => a.type === "Trust").length;
  const stateCount = new Set(matched.map((a) => (a.state || "").trim()).filter(Boolean)).size;
  const avg = total ? Math.round(matched.reduce((s, a) => s + scoreOf(a).score, 0) / total) : 0;
  const complete = matched.filter((a) => scoreOf(a).score >= 100).length;
  const attentionAll = assets.filter((a) => scoreOf(a).score < 100).length;
  const attentionShown = total - complete;

  // ── Skins (books-shared tokens) ──────────────────────────────────────────
  const { t1, t2, t3 } = tiers(isDark);
  const card = `rounded-2xl border ${cardSurface(isDark)}`;
  const rule = ruleBorder(isDark);
  const hair = hairline(isDark);
  const field = textInput(isDark);
  const searchField = `h-[40px] sm:h-9 w-full pl-9 pr-4 rounded-full text-[16px] sm:text-sm placeholder:text-sm border cursor-text [&::-webkit-search-cancel-button]:appearance-none ${field}`;
  const segContainer = `inline-flex items-center h-[40px] sm:h-9 p-0.5 rounded-full border ${
    isDark ? "border-white/10 bg-white/[0.04]" : "border-gray-200 bg-gray-50"
  }`;
  const segment = "inline-flex items-center justify-center h-full min-w-[44px] sm:min-w-0 px-3 rounded-full text-sm font-medium whitespace-nowrap transition-colors cursor-pointer";
  const segOn = isDark ? "bg-white/[0.1] text-gray-100" : "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200";
  const segOff = isDark
    ? "text-gray-400 hover:text-gray-100 hover:bg-white/[0.06]"
    : "text-gray-500/100 hover:text-gray-900 hover:bg-gray-200/60";
  const viewSeg = `h-full w-[40px] sm:w-8 rounded-full flex items-center justify-center transition-colors cursor-pointer ${TAP.seg}`;
  const hover = isDark ? "hover:bg-white/[0.04]" : "hover:bg-gray-50";
  // The row whose menu is open holds a tint, so it reads as "the one you touched".
  const activeRow = isDark ? "bg-white/[0.04]" : "bg-gray-50";
  const cell = "px-2 py-3.5 lg:py-3";
  // "No owner" is the soft pill with its fill withdrawn until hover, so the
  // column only speaks where there is an owner.
  const noOwner = isDark
    ? "[&>button]:text-gray-500 [&>button:not(:hover):not([aria-expanded=true])]:bg-transparent"
    : "[&>button]:text-gray-500/100 [&>button:not(:hover):not([aria-expanded=true])]:bg-transparent";
  const chevBtn = `relative after:content-[''] after:absolute after:-inset-x-[10px] after:-inset-y-[13px] lg:after:inset-0 w-5 h-5 rounded-md inline-flex items-center justify-center shrink-0 cursor-pointer transition-colors ${t3} ${
    isDark ? "hover:bg-white/[0.06] hover:text-white" : "hover:bg-gray-100 hover:text-gray-900"
  }`;
  const kpiSize = "text-xl lg:text-3xl leading-none";
  const kpi = `block mt-1 ${kpiSize} font-semibold tracking-tight truncate`;

  // ── Pieces shared by list and cards ──────────────────────────────────────
  const tagChip = (a: Asset, touch = false) =>
    editingTag === a.id ? (
      <input
        autoFocus
        value={tagDraft}
        aria-label={`Initials for ${a.name}`}
        onChange={(e) => setTagDraft(e.target.value.toUpperCase().slice(0, 4))}
        onBlur={() => {
          void saveInitials(a, tagDraft);
          setEditingTag(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            e.preventDefault();
            setEditingTag(null);
          }
        }}
        className={`${touch ? "h-6 lg:h-5" : "h-5"} w-[52px] shrink-0 px-1.5 rounded-md text-xs font-semibold tracking-[0.04em] uppercase border focus-visible:outline-0! ${
          isDark ? "bg-white/10 border-white/25 text-white" : "bg-white border-gray-300 text-gray-900"
        }`}
      />
    ) : (
      <button
        type="button"
        onClick={() => {
          setEditingTag(a.id);
          setTagDraft(tagOf(a));
        }}
        title="Edit initials"
        aria-label={`Initials ${tagOf(a)} — edit`}
        className={`${TAG_PILL} ${touch ? "h-6 px-2 lg:h-5 lg:px-1.5" : ""} ${TAP.line} cursor-pointer transition-[filter] hover:brightness-110 ${entityTagClass(a.name, isDark)}`}
      >
        {tagOf(a)}
      </button>
    );

  const typeBadge = (a: Asset) => (
    <span
      title={a.type === "LLC" && a.llcType ? `LLC · ${a.llcType}` : a.type}
      className={`inline-flex items-center shrink-0 h-5 px-1.5 rounded-md text-xs font-medium leading-none ${
        a.type === "C-Corp" || a.type === "Trust"
          ? isDark ? "border border-white/15 text-gray-300" : "border border-gray-300 text-gray-700"
          : isDark ? "bg-white/[0.05] text-gray-400" : "bg-gray-100 text-gray-500/100"
      }`}
    >
      {a.type || "—"}
    </span>
  );

  const scoreCard = (a: Asset, s: Score) => (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <p className={`text-sm font-semibold ${t1}`}>Compliance {s.score}</p>
        {s.missing.length > 0 && <p className={`text-xs ${t2}`}>+{100 - s.score} available</p>}
      </div>
      {s.missing.length > 0 ? (
        <>
          <p className={`mt-2.5 mb-1 ${MICRO} ${t2}`}>Missing</p>
          <ul className="space-y-1">
            {s.missing.map((m) => (
              <li key={m.key} className="flex items-baseline justify-between gap-4 text-xs">
                <span className={t1}>{m.label}</span>
                <span className={t2}>+{Math.round((m.weight / s.items.reduce((n, i) => n + i.weight, 0)) * 100)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={`mt-1 text-xs ${incomeTone(isDark)}`}>Every requirement for {a.type === "C-Corp" ? "a C-Corp" : a.type === "Trust" ? "a trust" : "an LLC"} is on file.</p>
      )}
    </>
  );

  const filingsCard = (a: Asset, s: Score) => {
    const filings = s.items.filter((i) => (FILING_KEYS as readonly string[]).includes(i.key));
    return (
      <>
        <p className={`mb-1.5 ${MICRO} ${t2}`}>Filings</p>
        <ul className="space-y-1">
          {filings.map((f) => (
            <li key={f.key} className="flex items-center gap-2 text-xs">
              {f.done ? (
                <Icon d={PATHS.check} strokeWidth={2.5} className={`w-3 h-3 shrink-0 ${incomeTone(isDark)}`} />
              ) : (
                <span aria-hidden className={`w-3 h-3 shrink-0 inline-flex items-center justify-center`}>
                  <span className={`w-[7px] h-[7px] rounded-full border-[1.5px] ${isDark ? "border-white/30" : "border-gray-400"}`} />
                </span>
              )}
              <span className={f.done ? t1 : t2}>{f.label}</span>
              <span className={`ml-auto ${f.done ? t2 : amberTone(isDark)}`}>{f.done ? "On file" : "Missing"}</span>
            </li>
          ))}
        </ul>
        {a.stateLink && <p className={`mt-2 text-xs ${t2}`}>State filing link in the ⋯ menu.</p>}
      </>
    );
  };

  const filingPips = (a: Asset, s: Score) => {
    const filings = s.items.filter((i) => (FILING_KEYS as readonly string[]).includes(i.key));
    const on = filings.filter((f) => f.done);
    // Trusts carry no filing slots, so there is nothing to show.
    if (!filings.length) return null;
    return (
      <Tip
        isDark={isDark}
        label={`Filings: ${on.length} of ${filings.length} on file${on.length < filings.length ? ` — missing ${filings.filter((f) => !f.done).map((f) => f.label).join(", ")}` : ""}`}
        content={filingsCard(a, s)}
        className={`h-7 px-1.5 -mx-1.5 gap-[4px] ${TAP.head} ${isDark ? "hover:bg-white/[0.06]" : "hover:bg-gray-100"}`}
      >
        {filings.map((f) => (
          <span
            key={f.key}
            aria-hidden
            className={`w-[7px] h-[7px] rounded-full ${
              f.done ? (isDark ? "bg-emerald-400" : "bg-emerald-600") : `border-[1.5px] ${isDark ? "border-white/25" : "border-gray-300"}`
            }`}
          />
        ))}
      </Tip>
    );
  };

  const rowActions = (a: Asset): RowAction[] => [
    { label: "Open entity", run: () => navigate(`/assets/${a.id}`) },
    {
      label: "Edit initials",
      run: () => {
        setEditingTag(a.id);
        setTagDraft(tagOf(a));
      },
    },
    ...(a.ein ? [{ label: "Copy EIN", run: () => copyEin(a.ein) }] : []),
    ...(a.stateLink ? [{ label: "State filing", href: a.stateLink }] : []),
  ];

  // A column header: a sort button (ledger recipe — the caret is an arrow,
  // revealed on hover, solid when active).
  const th = (label: string, key: SortKey | null, className = "", extra?: ReactNode) => {
    const thCls = `px-2 py-2.5 font-medium text-left ${className}`;
    if (!key) {
      return (
        <th scope="col" className={thCls}>
          {label}
        </th>
      );
    }
    const active = sort.key === key;
    return (
      <th scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={`group/th ${thCls}`}>
        <span className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSort(key)}
            className={`inline-flex items-center gap-1 h-6 -my-0.5 px-1.5 -mx-1.5 rounded-md cursor-pointer transition-colors ${TAP.head} ${
              active ? t1 : isDark ? "hover:text-gray-100 hover:bg-white/[0.04]" : "hover:text-gray-900 hover:bg-gray-100"
            }`}
          >
            {label}
            <Icon
              d={active && sort.dir === "asc" ? PATHS.up : PATHS.down}
              strokeWidth={2}
              className={`w-3 h-3 shrink-0 transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover/th:opacity-60"}`}
            />
          </button>
          {extra}
        </span>
      </th>
    );
  };

  // ── Toolbar pieces ───────────────────────────────────────────────────────
  const searchBox = () => (
    <div className="relative order-1 flex-1 min-w-0 lg:min-w-[10rem] lg:max-w-[20rem] xl:flex-none xl:w-72">
      <Icon d={PATHS.search} className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none ${t3}`} strokeWidth={2} />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search entities by name, EIN or state"
        placeholder="Search entities…"
        className={searchField}
      />
    </div>
  );
  const typeSegments = () => (
    <div role="group" aria-label="Entity type" className={segContainer}>
      {(
        [
          ["all", "All"],
          ["LLC", "LLC"],
          ["C-Corp", "C-Corp"],
          ["Trust", "Trust"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => setTypeF(value)}
          aria-pressed={typeF === value}
          className={`${segment} ${TAP.seg} ${typeF === value ? segOn : segOff}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
  const stateMenu = () => (
    <StateMegaMenu isDark={isDark} value={stateF} onChange={setStateF} counts={stateCounts} noState={statelessCount} />
  );
  // On the map the state filter lights the matching entities (by name).
  const mapHighlight = useMemo(
    () => (stateF.length ? new Set(assets.filter(inStates).map((a) => a.name.toLowerCase())) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assets, stateF]
  );
  const attentionToggle = () => (
    <button
      type="button"
      aria-pressed={attention}
      onClick={() => setAttention((v) => !v)}
      title="Compliance below 100"
      className={`${BTN_BASE} h-[40px] sm:h-9 px-3.5 gap-2 text-sm whitespace-nowrap ${TAP.md} ${
        attention
          ? isDark
            ? "border border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
            : "border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
          : outlineBtn(isDark)
      }`}
    >
      <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${isDark ? "bg-amber-400" : "bg-amber-500"}`} />
      Needs attention
      <span className={`font-normal ${attention ? "" : t2}`}>{attentionAll}</span>
    </button>
  );
  const clearButton = () => (
    <button type="button" onClick={clearFilters} className={`${BTN_BASE} h-[40px] sm:h-9 px-4 text-sm ${TAP.md} ${outlineBtn(isDark)}`}>
      Clear
    </button>
  );
  const viewToggle = () => (
    <div role="group" aria-label="View" className={segContainer}>
      {(
        [
          ["list", "List view", PATHS.list],
          ["cards", "Card view", PATHS.grid],
          [
            "map",
            "Map view",
            "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
          ],
        ] as const
      ).map(([v, name, d]) => (
        <button
          key={v}
          type="button"
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

  // ── Strip ────────────────────────────────────────────────────────────────
  const ready = !loading;
  const strip: Array<{ label: string; value: string; tone?: string; sub?: ReactNode }> = [
    { label: "Entities", value: String(total), sub: total ? `${complete} complete` : "—" },
    { label: "LLCs", value: String(llcs) },
    { label: trusts ? "C-Corps · Trusts" : "C-Corps", value: trusts ? `${corps} · ${trusts}` : String(corps) },
    { label: "States", value: String(stateCount) },
    {
      label: "Avg compliance",
      value: total ? `${avg}%` : "—",
      tone: total && avg >= 100 ? incomeTone(isDark) : "",
      sub: !total ? (
        "—"
      ) : attentionShown > 0 ? (
        <button
          type="button"
          onClick={() => setAttention((v) => !v)}
          aria-pressed={attention}
          className={`relative cursor-pointer hover:underline underline-offset-2 ${TAP.line} ${amberTone(isDark)}`}
        >
          {attentionShown} need{attentionShown === 1 ? "s" : ""} attention
        </button>
      ) : (
        <span className={incomeTone(isDark)}>All complete</span>
      ),
    },
  ];
  const stripBorder = [
    "",
    "border-l",
    "border-t md:border-t-0 md:border-l",
    "border-l border-t md:border-t-0",
    "col-span-2 md:col-span-1 border-t md:border-t-0 md:border-l",
  ] as const;

  // ── Skeletons ────────────────────────────────────────────────────────────
  const bar = (cls: string) => <div className={`shimmer ${cls}`} aria-hidden />;
  const listSkeleton = (
    <table className="w-full table-fixed text-sm" aria-busy="true" aria-label="Loading entities">
      <thead>
        <tr className={`text-left text-xs font-medium ${t2} ${headSkin(isDark)}`}>
          <th scope="col" className="pl-4 pr-2 py-2.5 font-medium">Entity</th>
          <th scope="col" className={`${COLS.type} px-2 py-2.5 font-medium`}>Type</th>
          <th scope="col" className={`${COLS.llcType} px-2 py-2.5 font-medium`}>Tax classification</th>
          <th scope="col" className={`${COLS.state} px-2 py-2.5 font-medium`}>State</th>
          <th scope="col" className={`${COLS.ein} px-2 py-2.5 font-medium`}>EIN</th>
          <th scope="col" className={`${COLS.owner} px-2 py-2.5 font-medium`}>Owned by</th>
          <th scope="col" className={`${COLS.filings} px-2 py-2.5 font-medium`}>Filings</th>
          <th scope="col" className={`${COLS.score} px-2 py-2.5 font-medium`}>Compliance</th>
          <th scope="col" className={COLS.menu}><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: 8 }, (_, i) => (
          <tr key={i} className={i === 0 ? "" : `border-t ${hair}`}>
            <td className={`pl-4 pr-2 py-3.5 lg:py-3`}>
              <div className="flex items-center gap-2" style={{ paddingLeft: [0, 18, 36, 36, 18, 36, 54, 0][i] }}>
                {bar("w-5 h-3 opacity-0")}
                {bar("h-5 w-9 rounded-md!")}
                {bar("h-3 w-44")}
              </div>
            </td>
            <td className={`${cell} ${COLS.type}`}>{bar("h-5 w-10 rounded-md!")}</td>
            <td className={`${cell} ${COLS.llcType}`}>{bar("h-3 w-24")}</td>
            <td className={`${cell} ${COLS.state}`}>{bar("h-3 w-14")}</td>
            <td className={`${cell} ${COLS.ein}`}>{bar("h-3 w-20")}</td>
            <td className={`${cell} ${COLS.owner}`}>{bar("h-7 w-32 rounded-full!")}</td>
            <td className={`${cell} ${COLS.filings}`}>{bar("h-2 w-10")}</td>
            <td className={`${cell} ${COLS.score}`}>{bar("h-3 w-12")}</td>
            <td />
          </tr>
        ))}
      </tbody>
    </table>
  );
  const cardsSkeleton = (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2 sm:gap-3 p-4" aria-busy="true" aria-label="Loading entities">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className={`rounded-xl border p-3 flex flex-col gap-2.5 ${cardSurface(isDark)}`}>
          <div className="flex items-center gap-3">
            {bar("h-6 w-9 rounded-md!")}
            <div className="flex-1 min-w-0">
              {bar("h-3.5 w-2/3")}
              {bar("mt-1.5 h-2.5 w-1/2")}
            </div>
            {bar("w-8 h-8 rounded-full!")}
          </div>
          {bar("h-2.5 w-3/4")}
          <div className="flex items-center gap-2">
            {bar("h-8 lg:h-7 w-36 rounded-full!")}
            {bar("h-2 w-10")}
          </div>
        </div>
      ))}
    </div>
  );

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="w-full tabular-nums">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="min-w-0">
          <h1 className={`text-2xl font-semibold tracking-tight leading-tight ${t1}`}>Entities</h1>
          <p className={`mt-1 text-xs ${t2}`}>
            {loading ? (
              <span className="shimmer inline-block h-[1em] w-40 rounded! align-middle" aria-hidden />
            ) : (
              <>
                {assets.length} {assets.length === 1 ? "entity" : "entities"}
                {attentionAll > 0 && (
                  <>
                    {" · "}
                    {attentionAll} below 100%
                  </>
                )}
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className={`${BTN_BASE} shrink-0 h-[40px] sm:h-9 pl-3.5 pr-4 gap-1.5 text-sm ${TAP.md} ${primaryBtn(isDark)}`}
        >
          <Icon d="M12 4.5v15m7.5-7.5h-15" strokeWidth={2.2} className="w-3.5 h-3.5" />
          New entity
        </button>
      </div>

      <NewEntityDialog isDark={isDark} open={showForm} onClose={() => setShowForm(false)} onCreate={handleCreate} />

      {/* Summary strip */}
      <div className={`grid grid-cols-2 md:grid-cols-5 overflow-hidden mb-5 tabular-nums ${card}`}>
        {strip.map(({ label, value, tone, sub }, i) => (
          <div key={label} className={`min-w-0 px-4 py-3 ${stripBorder[i]} ${hair}`}>
            <span className={`block text-xs font-medium ${t2}`}>{label}</span>
            {!ready ? (
              <span className={`mt-1 block ${kpiSize}`} aria-hidden>
                <span className="shimmer inline-block h-[1em] w-14 rounded! align-top" />
              </span>
            ) : (
              <span className={`${kpi} ${tone || t1}`}>{value}</span>
            )}
            {sub !== undefined &&
              (!ready ? (
                <span className="mt-1 block text-xs leading-tight" aria-hidden>
                  <span className="shimmer inline-block h-[1em] w-24 rounded! align-top" />
                </span>
              ) : (
                <span className={`block mt-1 text-xs leading-tight truncate ${t2}`}>{sub}</span>
              ))}
          </div>
        ))}
      </div>

      {loadError && (
        <div role="alert" className={`mb-5 rounded-2xl px-4 py-2 text-sm fade-in ${isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-700"}`}>
          {loadError}
        </div>
      )}

      <div className={card}>
        {/* Toolbar: one DOM for every width. lg+: search · type · state ·
            attention · clear … view toggle in one row. Below lg: search +
            toggle, then the filters in a scrolling strip. */}
        <div className={`px-4 py-3 ${view === "map" ? "" : `border-b ${rule}`}`}>
          {view === "map" ? (
            <div className="flex items-center gap-2">
              <div className="shrink-0">{stateMenu()}</div>
              <p className={`flex-1 min-w-0 truncate text-sm ${t2} hidden sm:block sm:ml-1`}>
                {stateF.length ? "Entities in the chosen states are lit" : "Ownership map"}
                <span className="hidden lg:inline"> — drag to pan, scroll to zoom</span>
              </p>
              <div className="shrink-0 ml-auto">{viewToggle()}</div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {searchBox()}
              <div className="order-2 shrink-0 lg:order-7">{viewToggle()}</div>
              <div className="order-3 basis-[calc(100%+2rem)] -mx-4 px-4 py-2 -my-2 scroll-px-4 flex items-center gap-2 overflow-x-auto no-scrollbar [&>*]:shrink-0 [mask-image:linear-gradient(to_right,#000_calc(100%-12px),transparent)] lg:[mask-image:none] lg:contents">
                <div className="lg:order-2">{typeSegments()}</div>
                <div className="lg:order-3">{stateMenu()}</div>
                <div className="lg:order-4">{attentionToggle()}</div>
                {filtered && <div className="lg:order-5">{clearButton()}</div>}
                <div className="hidden lg:block lg:order-6 lg:ml-auto" aria-hidden />
              </div>
            </div>
          )}
        </div>

        {view === "map" ? null : loading ? (
          view === "list" ? listSkeleton : cardsSkeleton
        ) : assets.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <Icon d={PATHS.building} className={`w-6 h-6 mx-auto ${t3}`} strokeWidth={1.4} />
            <p className={`mt-3 text-sm font-medium ${t1}`}>No entities yet</p>
            <p className={`mt-1 text-xs ${t2}`}>Create one to get started.</p>
            <button type="button" onClick={() => setShowForm(true)} className={`${BTN_BASE} mt-4 h-[40px] sm:h-9 px-4 text-sm ${primaryBtn(isDark)}`}>
              New entity
            </button>
          </div>
        ) : matched.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <Icon d={PATHS.search} className={`w-6 h-6 mx-auto ${t3}`} strokeWidth={1.4} />
            <p className={`mt-3 text-sm font-medium ${t1}`}>No entities match</p>
            <p className={`mt-1 text-xs ${t2}`}>Try another search or clear the filters.</p>
            <button type="button" onClick={clearFilters} className={`${BTN_BASE} mt-4 h-[40px] sm:h-9 px-4 text-sm ${outlineBtn(isDark)}`}>
              Clear filters
            </button>
          </div>
        ) : view === "list" ? (
          /* ── List: the ownership tree, one calm line per entity ── */
          <table aria-label="Entities" className="w-full table-fixed text-sm tabular-nums">
            <thead className="sticky top-[calc(3.5rem+1px+env(safe-area-inset-top))] lg:top-0 z-10">
              <tr className={`text-left text-xs font-medium ${t2} ${headSkin(isDark)}`}>
                {th(
                  "Entity",
                  "name",
                  "pl-4",
                  treeMode && parentIds.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setCollapsed(allExpanded ? new Set(parentIds) : new Set())}
                      className={`relative h-6 -my-0.5 px-1.5 rounded-md font-normal cursor-pointer transition-colors ${TAP.head} ${t3} ${
                        isDark ? "hover:text-gray-100 hover:bg-white/[0.04]" : "hover:text-gray-900 hover:bg-gray-100"
                      }`}
                    >
                      {allExpanded ? "Collapse all" : "Expand all"}
                    </button>
                  ) : !treeMode ? (
                    <button
                      type="button"
                      onClick={() => setSort({ key: "name", dir: "asc" })}
                      title="Sorted flat by another column — back to the ownership tree"
                      className={`relative h-6 -my-0.5 px-1.5 rounded-md font-normal cursor-pointer transition-colors ${TAP.head} ${t3} ${
                        isDark ? "hover:text-gray-100 hover:bg-white/[0.04]" : "hover:text-gray-900 hover:bg-gray-100"
                      }`}
                    >
                      Show tree
                    </button>
                  ) : undefined
                )}
                {th("Type", "type", COLS.type)}
                {th("Tax classification", "llcType", COLS.llcType)}
                {th("State", "state", COLS.state)}
                {th("EIN", "ein", COLS.ein)}
                {th("Owned by", "owner", COLS.owner)}
                {th("Filings", "filings", COLS.filings)}
                {th("Compliance", "score", COLS.score)}
                <th scope="col" className={COLS.menu}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="fade-in">
              {rows.map(({ asset: a, depth, kids, context }, ri) => {
                const s = scoreOf(a);
                const isCollapsed = collapsed.has(a.id);
                const menuOpen = menuRow === a.id;
                const mute = context ? "opacity-55" : "";
                return (
                  <tr
                    key={a.id}
                    className={`group transition-colors duration-100 ${ri === 0 ? "" : `border-t ${hair}`} ${menuOpen ? activeRow : hover}`}
                  >
                    <td className={`pl-4 pr-2 py-3.5 lg:py-3`}>
                      <div className="flex items-center gap-2 min-w-0" style={{ paddingLeft: depth * 18 }}>
                        {treeMode &&
                          (kids > 0 ? (
                            <button
                              type="button"
                              onClick={() => toggleNode(a.id)}
                              onKeyDown={(e) => {
                                if (e.key === "ArrowRight") {
                                  e.preventDefault();
                                  toggleNode(a.id, true);
                                } else if (e.key === "ArrowLeft") {
                                  e.preventDefault();
                                  toggleNode(a.id, false);
                                }
                              }}
                              aria-expanded={!isCollapsed}
                              aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${a.name}`}
                              className={chevBtn}
                            >
                              <Icon
                                d={PATHS.chevronRight}
                                strokeWidth={2.2}
                                className={`w-3 h-3 transition-transform motion-reduce:transition-none ${isCollapsed ? "" : "rotate-90"}`}
                              />
                            </button>
                          ) : (
                            <span className="w-5 shrink-0" aria-hidden />
                          ))}
                        <span className={`shrink-0 inline-flex ${mute}`}>{tagChip(a)}</span>
                        <Link
                          to={`/assets/${a.id}`}
                          title={a.name}
                          className={`min-w-0 truncate text-sm hover:underline underline-offset-2 py-[13px] -my-[13px] lg:py-0 lg:my-0 ${context ? `font-normal ${t2}` : `font-medium ${t1}`}`}
                        >
                          {a.name}
                        </Link>
                        {isCollapsed && kids > 0 && <span className={`shrink-0 text-xs ${t2}`}>+{kids}</span>}
                      </div>
                    </td>
                    <td className={`${cell} ${COLS.type} ${mute}`}>{typeBadge(a)}</td>
                    <td className={`${cell} ${COLS.llcType} truncate ${a.llcType ? t2 : t3} ${mute}`} title={a.llcType || undefined}>
                      {a.llcType || "—"}
                    </td>
                    <td className={`${cell} ${COLS.state} truncate ${a.state ? t2 : t3} ${mute}`} title={a.state || undefined}>
                      {a.state || "—"}
                    </td>
                    <td className={`${cell} ${COLS.ein} whitespace-nowrap ${mute}`}>
                      {a.ein ? (
                        <button
                          type="button"
                          onClick={() => copyEin(a.ein)}
                          title="Copy EIN"
                          className={`font-mono text-xs tabular-nums cursor-pointer rounded hover:underline decoration-dotted underline-offset-2 ${
                            copiedEin === a.ein ? incomeTone(isDark) : t2
                          }`}
                        >
                          {copiedEin === a.ein ? "Copied" : a.ein}
                        </button>
                      ) : (
                        <span className={t3}>—</span>
                      )}
                    </td>
                    <td className={`${cell} ${COLS.owner} ${mute}`}>
                      <div className={`min-w-0 [&>button]:max-w-full ${a.ownerId && byId.has(a.ownerId) ? "" : noOwner}`}>
                        <Menu
                          value={a.ownerId && byId.has(a.ownerId) ? a.ownerId : ""}
                          options={ownerOptions(a)}
                          onChange={(v) => void updateOwner(a.id, v)}
                          isDark={isDark}
                          tone="soft"
                          size="sm"
                          touch
                          chevron="hover"
                          label="Owned by"
                        />
                      </div>
                    </td>
                    <td className={`${cell} ${COLS.filings} ${mute}`}>{filingPips(a, s)}</td>
                    <td className={`${cell} ${COLS.score} ${mute}`}>
                      <Tip
                        isDark={isDark}
                        label={`Compliance ${s.score}. ${missingSummary(s, 99)}`}
                        content={scoreCard(a, s)}
                        className={`h-7 px-1.5 -mx-1.5 gap-2 ${TAP.head} ${isDark ? "hover:bg-white/[0.06]" : "hover:bg-gray-100"}`}
                      >
                        <Ring score={s.score} size={16} isDark={isDark} />
                        <span className={`text-sm font-medium tabular-nums ${scoreText(s.score, isDark, t1)}`}>
                          {s.score}
                        </span>
                      </Tip>
                    </td>
                    <td className="pr-2 text-right align-middle">
                      <RowMenu
                        isDark={isDark}
                        name={a.name}
                        actions={rowActions(a)}
                        onOpenChange={(o) => setMenuRow(o ? a.id : null)}
                        className={menuOpen ? "" : "lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          /* ── Cards: one per entity, ownership order ── */
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2 sm:gap-3 p-4 fade-in">
            {cardRows.map(({ asset: a }) => {
              const s = scoreOf(a);
              const menuOpen = menuRow === a.id;
              const surface = menuOpen
                ? isDark ? "border-white/[0.12] bg-white/[0.05]" : "border-gray-300 bg-gray-50"
                : isDark ? "border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.05]" : "border-gray-200 bg-white hover:bg-gray-50";
              return (
                <div key={a.id} className={`group relative flex flex-col gap-2.5 rounded-xl border p-3 transition-colors duration-100 ${surface}`}>
                  <div className="flex items-center gap-3">
                    {tagChip(a, true)}
                    <div className="flex-1 min-w-0">
                      <Link
                        to={`/assets/${a.id}`}
                        title={a.name}
                        className={`block truncate text-base lg:text-sm font-medium leading-5 hover:underline underline-offset-2 py-[13px] -my-[13px] lg:py-0 lg:my-0 ${t1}`}
                      >
                        {a.name}
                      </Link>
                      <p className={`mt-0.5 truncate text-sm lg:text-xs ${t2}`}>
                        {a.type}
                        {a.state ? ` · ${a.state}` : ""}
                        {a.ein ? (
                          <>
                            {" · "}
                            <span className="font-mono">{a.ein}</span>
                          </>
                        ) : (
                          <span className={t3}> · No EIN</span>
                        )}
                      </p>
                    </div>
                    <Tip
                      isDark={isDark}
                      label={`Compliance ${s.score}. ${missingSummary(s, 99)}`}
                      content={scoreCard(a, s)}
                      className="rounded-full shrink-0 relative after:content-[''] after:absolute after:-inset-[4px] lg:after:inset-0"
                    >
                      <Ring score={s.score} size={34} stroke={2.5} isDark={isDark}>
                        <span className={`text-[11px] font-semibold tabular-nums ${scoreText(s.score, isDark, t1)}`}>{s.score}</span>
                      </Ring>
                    </Tip>
                  </div>
                  {s.missing.length === 0 ? (
                    <p className={`text-sm lg:text-xs truncate ${incomeTone(isDark)}`}>All requirements on file</p>
                  ) : (
                    <p className={`flex items-baseline gap-1 min-w-0 text-sm lg:text-xs ${t2}`} title={missingSummary(s, 99)}>
                      <span className="truncate">Missing: {s.missing.map((m) => m.label).join(", ")}</span>
                      <span className={`shrink-0 ${amberTone(isDark)}`}>+{100 - s.score}</span>
                    </p>
                  )}
                  <div className="mt-auto flex items-center gap-3 min-w-0">
                    <div className={`min-w-0 [&>button]:max-w-full ${a.ownerId && byId.has(a.ownerId) ? "" : noOwner}`}>
                      <Menu
                        value={a.ownerId && byId.has(a.ownerId) ? a.ownerId : ""}
                        options={ownerOptions(a)}
                        onChange={(v) => void updateOwner(a.id, v)}
                        isDark={isDark}
                        tone="soft"
                        size="sm"
                        touch
                        label="Owned by"
                        leading={<Icon d={PATHS.building} className="w-3.5 h-3.5 shrink-0 opacity-60" />}
                      />
                    </div>
                    <span className="shrink-0">{filingPips(a, s)}</span>
                    <RowMenu
                      isDark={isDark}
                      name={a.name}
                      actions={rowActions(a)}
                      onOpenChange={(o) => setMenuRow(o ? a.id : null)}
                      className="ml-auto -mr-1.5 shrink-0"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {view !== "map" && !loading && matched.length > 0 && (
          <div className={`flex items-center justify-between gap-3 px-4 py-3 border-t ${hair}`}>
            <span role="status" aria-live="polite" className={`text-xs ${t2}`}>
              {filtered ? `Showing ${matched.length} of ${assets.length} entities` : `${assets.length} entities`}
              {view === "list" && treeMode && filtered && rows.some((r) => r.context) && " · owners shown for context"}
            </span>
          </div>
        )}
      </div>

      {view === "map" && (
        <div className="mt-5">
          <EstateMapView embedded highlight={mapHighlight} />
        </div>
      )}

      <Toast message={toast} isDark={isDark} onClose={() => setToast("")} />
    </div>
  );
}

// ── New entity dialog ───────────────────────────────────────────────────────
/** The create form (same fields, same write), as a dialog in the Books idiom. */
function NewEntityDialog({
  isDark,
  open,
  onClose,
  onCreate,
}: {
  isDark: boolean;
  open: boolean;
  onClose: () => void;
  onCreate: (fields: { name: string; type: "LLC" | "C-Corp" | "Trust"; state: string; ein: string }) => Promise<void>;
}) {
  const { t1, t2 } = tiers(isDark);
  const ref = useRef<HTMLFormElement>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<"LLC" | "C-Corp" | "Trust">("LLC");
  const [state, setState] = useState("");
  const [ein, setEin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useFocusTrap(ref, open);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    setError("");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await onCreate({ name, type, state, ein });
      setName("");
      setState("");
      setEin("");
      onClose();
    } catch {
      setError("Couldn't create that entity.");
    } finally {
      setBusy(false);
    }
  }

  const fieldCls = `w-full h-[40px] sm:h-9 px-3.5 rounded-full text-[16px] sm:text-sm border ${textInput(isDark)}`;
  const segContainer = `flex items-center h-[40px] sm:h-9 p-0.5 rounded-full border ${isDark ? "border-white/10 bg-white/[0.04]" : "border-gray-200 bg-gray-50"}`;
  const segOn = isDark ? "bg-white/[0.1] text-gray-100" : "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200";
  const segOff = isDark ? "text-gray-400 hover:text-gray-100 hover:bg-white/[0.06]" : "text-gray-500/100 hover:text-gray-900 hover:bg-gray-200/60";
  const label = `block ${MICRO} ${t2} mb-1`;

  // Portalled to <body>: inside <main> (its own stacking context) the overlay
  // would sit beneath the sidebar and the phone top bar.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px] fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        ref={ref}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-entity-title"
        className={`w-full max-w-md rounded-2xl border p-5 pop-in ${popoverSurface(isDark)}`}
      >
        <h2 id="new-entity-title" className={`text-lg font-semibold tracking-tight ${t1}`}>
          New entity
        </h2>
        <p className={`mt-1 mb-4 text-xs ${t2}`}>Add the basics now; filings and the rest live on the entity's page.</p>

        <span id="new-entity-type" className={label}>
          Type
        </span>
        <div role="group" aria-labelledby="new-entity-type" className={`${segContainer} mb-3`}>
          {(["LLC", "C-Corp", "Trust"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={type === t}
              onClick={() => setType(t)}
              className={`flex-1 h-full rounded-full text-sm font-medium transition-colors cursor-pointer ${type === t ? segOn : segOff}`}
            >
              {t}
            </button>
          ))}
        </div>

        <label htmlFor="new-entity-name" className={label}>
          Name
        </label>
        <input
          id="new-entity-name"
          data-autofocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Entity name"
          required
          className={`${fieldCls} mb-3`}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div>
            <label htmlFor="new-entity-state" className={label}>
              State of formation
            </label>
            <input id="new-entity-state" type="text" value={state} onChange={(e) => setState(e.target.value)} placeholder="e.g. Delaware" className={fieldCls} />
          </div>
          <div>
            <label htmlFor="new-entity-ein" className={label}>
              EIN
            </label>
            <input
              id="new-entity-ein"
              type="text"
              inputMode="numeric"
              value={ein}
              onChange={(e) => setEin(e.target.value)}
              placeholder="Optional"
              className={`${fieldCls} font-mono`}
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="mb-3 text-xs text-red-500">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={`${BTN_BASE} h-[40px] sm:h-9 px-4 text-sm ${ghostBtn(isDark)}`}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            aria-busy={busy || undefined}
            className={`${BTN_BASE} h-[40px] sm:h-9 px-4 text-sm aria-busy:pointer-events-none ${primaryBtn(isDark)}`}
          >
            {busy ? "Creating…" : `Create ${type}`}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}
