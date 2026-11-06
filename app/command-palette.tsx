import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { getUser } from "./auth";
import { Glyph } from "./shell-icons";
import { matchRanges, recentKey, scoreMatch, type Glyph as GlyphName } from "./shell-model";
import { Button, Dialog, Icon, Keycap, cx, useFinePointer, useMedia, useOverlay, usePresence } from "./ui";
import { useKeyboardInset } from "./ui/overlay-manager";
import { overlayRoot } from "./ui/portal";
import { modalAria, modalOpen, otherModalOpen } from "./shell-overlay";

/**
 * ⌘K / Ctrl-K (or "/") search and jump (docs/DESIGN.md §8.19): every page,
 * every entity, a search of mail or the books, and a few actions. With
 * nothing typed it shows recent places and the main sections. A dialog at
 * the top on desktop; a full-screen sheet with Cancel on phones. Also owns
 * the global keys (g then a letter, ?, [) and the shortcuts sheet.
 */

export type Command = {
  id: string;
  label: string;
  /** The trailing hint: an entity's type and state, an action's note. */
  hint?: string;
  group: "Recent" | "Go to" | "Pages" | "Entities" | "Actions" | "Search";
  keywords?: string;
  run: () => void;
  /** A page's section ("Mail"), shown before its name. */
  section?: string;
  glyph?: GlyphName;
  /** A keycap at the right (an action's shortcut). */
  keys?: string[];
  /** A search hand-off: the words, and where they're searched. */
  query?: string;
  scope?: string;
};

export type PageLink = { to: string; label: string; section?: string; keywords?: string; glyph?: GlyphName };
export type PaletteAction = { id: string; label: string; hint?: string; keys?: string[]; keywords?: string; glyph?: GlyphName; run: () => void };

/** Two-key shortcuts: "g" then the letter. */
const GO_SHORTCUTS: Array<{ key: string; to: string; label: string }> = [
  { key: "h", to: "/home", label: "Home" },
  { key: "m", to: "/inbox", label: "Mail" },
  { key: "e", to: "/assets", label: "Entities" },
  { key: "o", to: "/estate-map", label: "Estate map" },
  { key: "t", to: "/treasury", label: "Treasury" },
  { key: "i", to: "/investments", label: "Investments" },
  { key: "b", to: "/books/transactions", label: "Transactions" },
  { key: "r", to: "/books/review", label: "Review" },
  { key: "c", to: "/books/calendar", label: "Recurring" },
  { key: "p", to: "/books/reports", label: "Reports" },
  { key: "s", to: "/settings", label: "Settings" },
];

const RECENT_MAX = 6;
type Recent = { to: string; label: string; hint?: string };

function recentStoreKey(): string | null {
  const id = getUser()?.id;
  return id ? recentKey(id) : null;
}

function readRecent(): Recent[] {
  const key = recentStoreKey();
  if (!key) return [];
  try {
    const v = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(v) ? v.filter((r) => r && typeof r.to === "string" && typeof r.label === "string") : [];
  } catch {
    return [];
  }
}

/** Remember a visited place so the palette can offer it first. Kept per account on this device. */
export function rememberRecent(r: Recent) {
  const key = recentStoreKey();
  if (!key) return;
  try {
    const next = [r, ...readRecent().filter((x) => x.to !== r.to)].slice(0, RECENT_MAX);
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Storage unavailable: recents are a convenience.
  }
}

function typingInField(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

type Entity = { id: string; name: string; type?: string; state?: string; taxClass?: string };

/** Entities from the shared tree, loaded the first time the palette opens. */
export function useEntities(enabled: boolean): Entity[] {
  const [entities, setEntities] = useState<Entity[]>([]);
  const loaded = useRef(false);
  useEffect(() => {
    if (!enabled || loaded.current) return;
    loaded.current = true;
    void (async () => {
      try {
        const { db, authReady, get, ref } = await import("./store");
        await authReady;
        const snap = await get(ref(db, "assets"));
        const val = (snap.val() ?? {}) as Record<string, { name?: string; type?: string; state?: string; llcType?: string }>;
        setEntities(
          Object.entries(val)
            .filter(([, a]) => a?.name)
            .map(([id, a]) => ({ id, name: a.name!, type: a.type, state: a.state, taxClass: a.llcType }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      } catch {
        loaded.current = false; // try again next open
      }
    })();
  }, [enabled]);
  return entities;
}

const isEntityPath = (to: string) => /^\/assets\/[^/]+/.test(to);

/**
 * The palette's results for a query. Nothing typed: recent places, the main
 * sections (minus the recent ones) and the actions. Something typed: the
 * best-matching pages, entities and actions, then a search of mail and the
 * books for the words. The home page's search box shares it.
 */
export function usePaletteResults({
  q,
  pages,
  entities,
  actions,
  go,
  goTo = [],
}: {
  q: string;
  pages: PageLink[];
  entities: Entity[];
  actions: PaletteAction[];
  go: (to: string, state?: unknown) => void;
  /** The main sections, offered when nothing is typed. */
  goTo?: PageLink[];
}): Command[] {
  return useMemo(() => {
    const query = q.trim().toLowerCase();
    const out: Command[] = [];
    if (!query) {
      const recent = readRecent();
      for (const r of recent) {
        const entity = isEntityPath(r.to);
        const page = pages.find((p) => p.to === r.to);
        out.push({
          id: `recent:${r.to}`,
          label: r.label,
          section: entity ? undefined : (page?.section ?? r.hint),
          hint: entity ? r.hint : undefined,
          glyph: entity ? "entities" : (page?.glyph ?? "page"),
          group: "Recent",
          run: () => go(r.to),
        });
      }
      const seen = new Set(recent.map((r) => r.to));
      for (const p of goTo) if (!seen.has(p.to)) out.push({ id: `goto:${p.to}`, label: p.label, glyph: p.glyph, group: "Go to", run: () => go(p.to) });
      for (const a of actions) out.push({ ...a, group: "Actions" });
      return out;
    }
    const best = <T,>(items: T[], score: (t: T) => number, max: number) =>
      items
        .map((t) => ({ t, s: score(t) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, max)
        .map((x) => x.t);
    for (const p of best(pages, (p) => scoreMatch(p.label, `${p.section ?? ""} ${p.keywords ?? ""}`, query), 8)) {
      out.push({ id: `page:${p.to}`, label: p.label, section: p.section, hint: p.section, keywords: p.keywords, glyph: p.glyph ?? "page", group: "Pages", run: () => go(p.to) });
    }
    for (const e of best(entities, (e) => scoreMatch(e.name, [e.type, e.taxClass, e.state].filter(Boolean).join(" "), query), 6)) {
      const hint = [e.type, e.taxClass, e.state].filter(Boolean).join(" · ") || "Entity";
      out.push({
        id: `entity:${e.id}`,
        label: e.name,
        hint,
        glyph: "entities",
        group: "Entities",
        run: () => {
          rememberRecent({ to: `/assets/${e.id}`, label: e.name, hint });
          go(`/assets/${e.id}`);
        },
      });
    }
    for (const a of best(actions, (a) => scoreMatch(a.label, `${a.hint ?? ""} ${a.keywords ?? ""}`, query), 4)) out.push({ ...a, group: "Actions" });
    const words = q.trim();
    out.push(
      {
        id: "search:mail",
        label: `“${words}” in Mail`,
        query: words,
        scope: "Mail",
        hint: "Mail",
        glyph: "search",
        group: "Search",
        run: () => go(`/inbox?q=${encodeURIComponent(words)}`, { q: words }),
      },
      {
        id: "search:txns",
        label: `“${words}” in transactions`,
        query: words,
        scope: "transactions",
        hint: "Books",
        glyph: "search",
        group: "Search",
        run: () => go(`/books/transactions?q=${encodeURIComponent(words)}`, { q: words }),
      },
    );
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, pages, entities, actions, goTo]);
}

/** The label with the letters the query matched set in 600. */
function Matched({ text, q }: { text: string; q: string }) {
  const ranges = matchRanges(text, q);
  if (!ranges.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([a, b], i) => {
    if (a > at) parts.push(text.slice(at, a));
    parts.push(
      <span key={i} className="font-semibold">
        {text.slice(a, b)}
      </span>,
    );
    at = b;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/** One result row: icon, the section before the name, the name, and a hint or keycap at the right. */
function ResultRow({ c, q, active, id, onPoint }: { c: Command; q: string; active: boolean; id: string; onPoint: () => void }) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      onMouseMove={onPoint}
      onClick={() => c.run()}
      className={cx("flex min-h-(--row-1) cursor-pointer items-center gap-3 rounded-control px-3 text-body outline-offset-[-2px]!", active && "bg-selected")}
    >
      <span className="text-ink-2">{c.glyph ? <Glyph name={c.glyph} /> : <span className="block size-(--icon)" />}</span>
      <span className="min-w-0 flex-1 truncate py-1">
        {c.query !== undefined ? (
          <>
            <span className="text-ink">“{c.query}”</span>
            <span className="text-ink-2"> in {c.scope}</span>
          </>
        ) : (
          <>
            {c.section && (
              <span className="text-ink-2">
                {c.section}
                <span aria-hidden="true" className="px-1 text-ink-3">
                  /
                </span>
              </span>
            )}
            <span className="text-ink">
              <Matched text={c.label} q={q} />
            </span>
          </>
        )}
      </span>
      {c.keys ? <Keycap keys={c.keys} /> : c.hint && c.group !== "Pages" && c.group !== "Search" ? <span className="max-w-[45%] shrink-0 truncate text-caption text-ink-3">{c.hint}</span> : null}
    </div>
  );
}

export function CommandPalette({
  open,
  onClose,
  pages,
  actions,
  goTo,
  onShortcuts,
}: {
  open: boolean;
  onClose: () => void;
  pages: PageLink[];
  actions: PaletteAction[];
  /** The main sections, offered when nothing is typed (the nav's top level). */
  goTo?: PageLink[];
  onShortcuts?: () => void;
}) {
  const navigate = useNavigate();
  const phone = useMedia("(width < 48rem)");
  const fine = useFinePointer();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState(false);
  const entities = useEntities(open);
  const { mounted, leaving } = usePresence(open, 120);
  const handle = useOverlay({ open, onClose, kind: "palette" });
  const kb = useKeyboardInset(open && phone);
  const base = useId();

  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
  }, [open]);

  const go = (to: string, state?: unknown) => {
    onClose();
    navigate(to, state ? { state } : undefined);
  };
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  // Keyboard shortcuts mean nothing without a keyboard.
  const wrapped = useMemo(() => actions.filter((a) => fine || !a.keys).map((a) => ({ ...a, run: run(a.run) })), [actions, fine]); // eslint-disable-line react-hooks/exhaustive-deps
  const top = useMemo(() => goTo ?? pages.filter((p) => !p.section && !p.to.startsWith("/legal")), [goTo, pages]);
  const results = usePaletteResults({ q, pages, entities, actions: wrapped, go, goTo: top });

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  // The list fades at its foot while there's more below, so it never seems to end mid-row.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const sync = () => setFade(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    return () => el.removeEventListener("scroll", sync);
  }, [results, mounted]);

  if (!mounted) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Home" && !q) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && !q) {
      e.preventDefault();
      setActive(results.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      results[active]?.run();
    } else if (e.key === "?" && !q && onShortcuts) {
      e.preventDefault();
      onClose();
      onShortcuts();
    }
  }

  const listId = `${base}-list`;
  const optionId = (i: number) => `${base}-opt-${i}`;
  const groups: Array<{ name: Command["group"]; rows: Array<{ c: Command; i: number }> }> = [];
  results.forEach((c, i) => {
    const last = groups[groups.length - 1];
    if (last?.name === c.group) last.rows.push({ c, i });
    else groups.push({ name: c.group, rows: [{ c, i }] });
  });

  const input = (
    <input
      value={q}
      onChange={(e) => setQ(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder="Search BFO"
      aria-label="Search BFO"
      role="combobox"
      aria-expanded="true"
      aria-autocomplete="list"
      aria-controls={listId}
      aria-activedescendant={results[active] ? optionId(active) : undefined}
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="go"
      style={{ fontSize: 16 }}
      className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-3 focus-visible:outline-none!"
    />
  );

  const list = (
    <div
      id={listId}
      ref={listRef}
      role="listbox"
      aria-label="Results"
      className={cx("overflow-y-auto overscroll-contain p-2", phone ? "min-h-0 flex-1" : "max-h-[min(60dvh,520px)]")}
      style={fade ? { maskImage: "linear-gradient(to bottom, #000 calc(100% - 24px), transparent)", WebkitMaskImage: "linear-gradient(to bottom, #000 calc(100% - 24px), transparent)" } : undefined}
    >
      {results.length === 0 && <p className="px-3 py-8 text-center text-body text-ink-2">Nothing matches “{q.trim()}”. Try a shorter word, or a section’s name.</p>}
      {groups.map((g, gi) => {
        const hid = `${base}-g${gi}`;
        return (
          <div key={hid} role="group" aria-labelledby={hid} className={gi > 0 ? "mt-2" : ""}>
            <div id={hid} role="presentation" className="flex h-[28px] items-center px-3 text-caption font-medium text-ink-2">
              {g.name}
            </div>
            {g.rows.map(({ c, i }) => (
              <div key={c.id} data-idx={i}>
                <ResultRow c={c} q={q} active={i === active} id={optionId(i)} onPoint={() => setActive(i)} />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );

  const panel = phone ? (
    <div className="ds fixed inset-x-0 top-0" style={{ height: kb.height ?? "100dvh" }}>
      <div
        ref={handle.panelRef}
        {...modalAria("Jump to")}
        className={cx("absolute inset-0 flex flex-col bg-overlay text-body text-ink outline-none", leaving ? "pointer-events-none ds-dialog-out" : "ds-full-in")}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-line pt-[env(safe-area-inset-top)] pr-1 pl-4">
          <div className="flex h-[52px] min-w-0 flex-1 items-center gap-2">
            <Icon name="search" className="text-ink-2" />
            {input}
          </div>
          <Button variant="quiet" size="sm" onClick={() => handle.requestClose("close")}>
            Cancel
          </Button>
        </div>
        {list}
      </div>
    </div>
  ) : (
    <div className="ds fixed inset-0">
      {handle.ownsScrim && <div aria-hidden="true" className={cx("absolute inset-0 bg-scrim", leaving ? "ds-scrim-out" : "ds-scrim-in")} onClick={() => handle.requestClose("scrim")} />}
      <div className="pointer-events-none absolute inset-0 flex items-start justify-center px-6" style={{ paddingTop: "max(12vh, calc(env(safe-area-inset-top) + 16px))" }}>
        <div
          ref={handle.panelRef}
          {...modalAria("Jump to")}
          className={cx(
            "pointer-events-auto flex w-full max-w-dialog-lg flex-col overflow-hidden rounded-dialog border border-line-strong bg-overlay text-body text-ink shadow-(--elevation-2) outline-none",
            leaving ? "pointer-events-none ds-dialog-out" : "ds-dialog-in",
          )}
        >
          <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-4">
            <Icon name="search" size={20} className="text-ink-2" />
            {input}
            {fine && (
              <button type="button" aria-label="Close" onClick={() => handle.requestClose("close")} className="inline-flex cursor-pointer rounded-mark">
                <Keycap keys={["Esc"]} />
              </button>
            )}
          </div>
          {list}
          {fine && (
            <div className="flex h-[36px] shrink-0 items-center gap-4 border-t border-line px-4 text-caption text-ink-2">
              <span className="inline-flex items-center gap-1">
                <Keycap keys={["↑"]} />
                <Keycap keys={["↓"]} /> to move
              </span>
              <span className="inline-flex items-center gap-1">
                <Keycap keys={["↵"]} /> to open
              </span>
              {onShortcuts && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onShortcuts();
                  }}
                  className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-mark hover:text-ink"
                >
                  <Keycap keys={["?"]} /> Keyboard shortcuts
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
  return createPortal(panel, overlayRoot());
}

/** Mail's own keys (app/mail/shortcuts.ts), shown first while Mail is open. */
const MAIL_KEYS: Array<[string[], string]> = [
  [["j"], "Next message"],
  [["k"], "Previous message"],
  [["o"], "Open"],
  [["u"], "Back to the list"],
  [["e"], "Archive"],
  [["s"], "Star"],
  [["x"], "Select"],
  [["shift", "U"], "Mark unread"],
  [["z"], "Undo archive, read or star"],
  [["#"], "Delete for good"],
  [["r"], "Reply"],
  [["a"], "Reply all"],
  [["f"], "Forward"],
  [["c"], "New message"],
];

function KeyRow({ keys, label, sequence }: { keys: string[]; label: string; sequence?: boolean }) {
  return (
    <li className="flex min-h-[32px] items-center justify-between gap-4">
      <span className="text-body text-ink">{label}</span>
      <Keycap keys={keys} sequence={sequence} />
    </li>
  );
}

/** The keyboard shortcuts (?): general keys, then "Go to" with g then a letter; Mail's keys first while Mail is open. */
export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname } = useLocation();
  const inMail = pathname === "/inbox";
  const desktop = useMedia("(width >= 64rem)");
  const label = "text-small font-medium text-ink-2";
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" size={inMail ? "lg" : "md"}>
      <div className="flex flex-col gap-6 pb-2">
        {inMail && (
          <section>
            <h3 className={label}>In Mail</h3>
            <ul className="mt-2 grid gap-x-8 sm:grid-cols-2">
              {MAIL_KEYS.map(([keys, l]) => (
                <KeyRow key={l} keys={keys} label={l} />
              ))}
            </ul>
          </section>
        )}
        <section>
          <h3 className={label}>General</h3>
          <ul className="mt-2">
            <KeyRow keys={["mod", "K"]} label="Search BFO" />
            <KeyRow keys={["/"]} label="Search this page" />
            {desktop && <KeyRow keys={["["]} label="Collapse or expand the sidebar" />}
            <KeyRow keys={["?"]} label="Show shortcuts" />
            <KeyRow keys={["Esc"]} label="Close" />
          </ul>
        </section>
        <section>
          <h3 className={label}>Go to</h3>
          <p className="mt-1 text-small text-ink-2">Press g, then the key.</p>
          <ul className="mt-2 grid gap-x-8 sm:grid-cols-2">
            {GO_SHORTCUTS.map((s) => (
              <KeyRow key={s.key} keys={[s.key]} label={s.label} />
            ))}
          </ul>
        </section>
      </div>
    </Dialog>
  );
}

/**
 * Global keys: ⌘K / Ctrl-K opens or closes the palette, "/" searches the
 * page (or opens the palette), "?" the shortcuts, "[" the sidebar, and "g"
 * followed by a letter jumps to a page. Ignored while typing or over a
 * dialog.
 */
export function useGlobalShortcuts(opts: { openPalette: () => void; openSheet: () => void; toggleSidebar?: () => void }) {
  const navigate = useNavigate();
  const { openPalette, openSheet, toggleSidebar } = opts;
  useEffect(() => {
    let gAt = 0;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // Not over another dialog (compose, a confirm): a jump from there would drop it. The palette itself toggles.
        if (!otherModalOpen()) openPalette();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typingInField(e)) return;
      if (modalOpen()) return;
      if (e.key === "/") {
        e.preventDefault();
        // A page with its own search (Mail, Entities) marks its box: "/" goes there, as it does in Gmail.
        const own = [...document.querySelectorAll<HTMLInputElement>("input[data-page-search]")].find((el) => el.offsetParent !== null);
        if (own) own.focus();
        else openPalette();
      } else if (e.key === "?") {
        e.preventDefault();
        openSheet();
      } else if (e.key === "[" && toggleSidebar) {
        e.preventDefault();
        toggleSidebar();
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
  }, [navigate, openPalette, openSheet, toggleSidebar]);
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
