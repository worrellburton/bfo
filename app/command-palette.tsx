import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

/**
 * ⌘K / Ctrl-K (or "/") jump-to-anything: every page, every entity, a
 * transaction search, and a few actions. Recently opened places float to the
 * top. Also owns the two-key "g then …" shortcuts and the "?" sheet.
 */

export type Command = {
  id: string;
  label: string;
  /** Second line — the section, the entity type, a hint. */
  hint?: string;
  group: "Recent" | "Pages" | "Entities" | "Actions" | "Search";
  keywords?: string;
  run: () => void;
};

export type PageLink = { to: string; label: string; section?: string; keywords?: string };

/** Two-key shortcuts: "g" then the letter. */
export const GO_SHORTCUTS: Array<{ key: string; to: string; label: string }> = [
  { key: "h", to: "/home", label: "Home" },
  { key: "e", to: "/assets", label: "Entities" },
  { key: "m", to: "/estate-map", label: "Estate map" },
  { key: "t", to: "/treasury", label: "Treasury" },
  { key: "i", to: "/investments", label: "Investments" },
  { key: "b", to: "/books/transactions", label: "Books · Transactions" },
  { key: "r", to: "/books/review", label: "Books · Review" },
  { key: "c", to: "/books/calendar", label: "Books · Calendar" },
  { key: "s", to: "/settings", label: "Settings" },
];

const RECENT_KEY = "bfo-recent";
const RECENT_MAX = 6;
type Recent = { to: string; label: string; hint?: string };

function readRecent(): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v.filter((r) => r && typeof r.to === "string" && typeof r.label === "string") : [];
  } catch {
    return [];
  }
}

/** Remember a visited place so the palette can offer it first. */
export function rememberRecent(r: Recent) {
  try {
    const next = [r, ...readRecent().filter((x) => x.to !== r.to)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable — recents are a convenience
  }
}

function typingInField(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

/** Score a command against the query: prefix > word-start > substring; 0 = no match. */
function score(c: Command, q: string): number {
  if (!q) return 1;
  const label = c.label.toLowerCase();
  const hay = `${label} ${(c.hint ?? "").toLowerCase()} ${(c.keywords ?? "").toLowerCase()}`;
  if (label.startsWith(q)) return 4;
  if (label.split(/[\s,·/-]+/).some((w) => w.startsWith(q))) return 3;
  if (hay.includes(q)) return 2;
  // Every query word somewhere in the haystack.
  const words = q.split(/\s+/).filter(Boolean);
  return words.length > 1 && words.every((w) => hay.includes(w)) ? 1 : 0;
}

type Entity = { id: string; name: string; type?: string; state?: string };

/** Entities from Firebase, loaded the first time the palette opens. */
function useEntities(enabled: boolean): Entity[] {
  const [entities, setEntities] = useState<Entity[]>([]);
  const loaded = useRef(false);
  useEffect(() => {
    if (!enabled || loaded.current) return;
    loaded.current = true;
    void (async () => {
      try {
        const [{ db, authReady }, { get, ref }] = await Promise.all([import("./firebase"), import("firebase/database")]);
        await authReady;
        const snap = await get(ref(db, "assets"));
        const val = (snap.val() ?? {}) as Record<string, { name?: string; type?: string; state?: string }>;
        setEntities(
          Object.entries(val)
            .filter(([, a]) => a?.name)
            .map(([id, a]) => ({ id, name: a.name!, type: a.type, state: a.state }))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      } catch {
        loaded.current = false; // try again next open
      }
    })();
  }, [enabled]);
  return entities;
}

export function CommandPalette({
  open,
  onClose,
  pages,
  actions,
  isDark,
}: {
  open: boolean;
  onClose: () => void;
  pages: PageLink[];
  actions: Array<{ id: string; label: string; hint?: string; run: () => void }>;
  isDark: boolean;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const entities = useEntities(open);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    const all: Command[] = [];
    if (!query) {
      for (const r of readRecent()) all.push({ id: `recent:${r.to}`, label: r.label, hint: r.hint, group: "Recent", run: () => go(r.to) });
    }
    for (const p of pages) {
      all.push({ id: `page:${p.to}`, label: p.label, hint: p.section, keywords: p.keywords, group: "Pages", run: () => go(p.to) });
    }
    for (const e of entities) {
      all.push({
        id: `entity:${e.id}`,
        label: e.name,
        hint: [e.type, e.state].filter(Boolean).join(" · ") || "Entity",
        group: "Entities",
        run: () => {
          rememberRecent({ to: `/assets/${e.id}`, label: e.name, hint: "Entity" });
          go(`/assets/${e.id}`);
        },
      });
    }
    for (const a of actions) all.push({ ...a, group: "Actions" });

    const scored = all
      .map((c) => ({ c, s: score(c, query) }))
      .filter((x) => x.s > 0)
      // Without a query keep the natural order; with one, best matches first
      // while groups stay together.
      .sort((a, b) => (query ? b.s - a.s : 0));
    const order: Command["group"][] = ["Recent", "Pages", "Entities", "Actions", "Search"];
    const byGroup = new Map<Command["group"], Command[]>();
    for (const { c } of scored) {
      const list = byGroup.get(c.group) ?? [];
      if (list.length < (query ? 8 : c.group === "Entities" ? 6 : 12)) list.push(c);
      byGroup.set(c.group, list);
    }
    if (query) {
      byGroup.set("Search", [
        {
          id: "search:txns",
          label: `Search transactions for “${q.trim()}”`,
          hint: "Books",
          group: "Search",
          run: () => go(`/books/transactions?q=${encodeURIComponent(q.trim())}`),
        },
      ]);
    }
    return order.flatMap((g) => byGroup.get(g) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, pages, entities, actions]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      results[active]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  const surface = isDark ? "bg-[#111113]/95 border-white/10 text-white" : "bg-white/95 border-gray-200 text-gray-900";
  const muted = isDark ? "text-gray-500" : "text-gray-500";
  let lastGroup = "";

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center px-3 pt-[max(12vh,calc(env(safe-area-inset-top)+16px))]" role="presentation">
      <div className="palette-backdrop absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Jump to"
        className={`palette-panel relative w-full max-w-[560px] overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-2xl ${surface}`}
        onKeyDown={onKeyDown}
      >
        <div className={`flex items-center gap-3 border-b px-4 ${isDark ? "border-white/10" : "border-gray-100"}`}>
          <svg className={`h-[18px] w-[18px] shrink-0 ${muted}`} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search pages, entities, transactions"
            aria-label="Search"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[active] ? `palette-${active}` : undefined}
            className="palette-input h-14 min-w-0 flex-1 bg-transparent text-[15px] placeholder:text-gray-500"
          />
          <kbd className={`hidden rounded-md border px-1.5 py-0.5 text-[11px] sm:inline ${isDark ? "border-white/15 text-gray-400" : "border-gray-200 text-gray-500"}`}>Esc</kbd>
        </div>
        <div id="palette-list" ref={listRef} role="listbox" className="max-h-[min(60vh,440px)] overflow-y-auto p-2">
          {results.length === 0 && <p className={`px-3 py-8 text-center text-sm ${muted}`}>Nothing matches “{q}”.</p>}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header && <div className={`px-3 pb-1 pt-3 text-[11px] font-medium ${muted}`}>{header}</div>}
                <button
                  id={`palette-${i}`}
                  data-idx={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => c.run()}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                    i === active ? (isDark ? "bg-white/10" : "bg-gray-100") : ""
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.hint && <span className={`shrink-0 truncate text-xs ${muted}`}>{c.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className={`hidden items-center gap-4 border-t px-4 py-2 text-[11px] sm:flex ${muted} ${isDark ? "border-white/10" : "border-gray-100"}`}>
          <span>↑↓ to move</span>
          <span>↵ to open</span>
          <span className="ml-auto">? for shortcuts</span>
        </div>
      </div>
    </div>
  );
}

export function ShortcutSheet({ open, onClose, isDark }: { open: boolean; onClose: () => void; isDark: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const kbd = `inline-flex min-w-[22px] justify-center rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${
    isDark ? "border-white/15 bg-white/5 text-gray-200" : "border-gray-200 bg-gray-50 text-gray-700"
  }`;
  const rows: Array<[string[], string]> = [
    [["⌘", "K"], "Jump to anything"],
    [["/"], "Jump to anything"],
    ...GO_SHORTCUTS.map((s) => [["g", s.key], s.label] as [string[], string]),
    [["?"], "This sheet"],
  ];
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-4" role="presentation">
      <div className="palette-backdrop absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className={`palette-panel relative w-full max-w-[400px] rounded-2xl border p-5 shadow-2xl ${
          isDark ? "border-white/10 bg-[#111113] text-white" : "border-gray-200 bg-white text-gray-900"
        }`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Keyboard shortcuts</h2>
          <button onClick={onClose} aria-label="Close" className={`rounded-full p-1.5 ${isDark ? "hover:bg-white/10" : "hover:bg-gray-100"}`}>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <ul className="space-y-2 text-sm">
          {rows.map(([keys, label], i) => (
            <li key={i} className="flex items-center justify-between gap-4">
              <span className={isDark ? "text-gray-300" : "text-gray-600"}>{label}</span>
              <span className="flex gap-1">
                {keys.map((k, j) => (
                  <kbd key={j} className={kbd}>{k}</kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Global keys: ⌘K / Ctrl-K and "/" open the palette, "?" the shortcut
 * sheet, and "g" followed by a letter jumps to a page. Ignored while typing.
 */
export function useGlobalShortcuts(opts: { openPalette: () => void; openSheet: () => void }) {
  const navigate = useNavigate();
  const { openPalette, openSheet } = opts;
  useEffect(() => {
    let gAt = 0;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typingInField(e)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (e.key === "/") {
        e.preventDefault();
        openPalette();
      } else if (e.key === "?") {
        e.preventDefault();
        openSheet();
      } else if (e.key === "g") {
        gAt = Date.now();
      } else if (Date.now() - gAt < 1200) {
        const hit = GO_SHORTCUTS.find((s) => s.key === e.key.toLowerCase());
        gAt = 0;
        if (hit) {
          e.preventDefault();
          navigate(hit.to);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, openPalette, openSheet]);
}

/** Records visits to the main pages as recents. */
export function useTrackRecent(pages: PageLink[]) {
  const location = useLocation();
  useEffect(() => {
    const page = pages.find((p) => p.to === location.pathname);
    // Home is always one tap away; recents are for everything else.
    if (page && page.to !== "/home") rememberRecent({ to: page.to, label: page.label, hint: page.section });
  }, [location.pathname, pages]);
}
