import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router";
import { rememberRecent, useEntities, usePaletteResults, type PageLink } from "./command-palette";

/**
 * The search box on the home page: type, and what matches appears under it
 * as you go — pages, entities, and a search of mail or the books for the
 * words typed. The same results as ⌘K, in place instead of a dialog.
 */

export type ShellContext = { pages: PageLink[] };

export function HomeSearch({ isDark }: { isDark: boolean }) {
  const navigate = useNavigate();
  const { pages } = useOutletContext<ShellContext>() ?? { pages: [] };
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
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
    [navigate]
  );
  const results = usePaletteResults({ q, pages, entities, actions: [], go });
  const open = focused && q.trim().length > 0;

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "Escape") inputRef.current?.blur();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[active];
      if (hit) {
        if (hit.group === "Pages") rememberRecent({ to: hit.id.replace(/^page:/, ""), label: hit.label, hint: hit.hint });
        hit.run();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setQ("");
      inputRef.current?.blur();
    }
  }

  const muted = "text-gray-500";
  let lastGroup = "";

  return (
    <div className="relative z-20 w-full max-w-[640px]">
      <div
        className={`home-search flex h-12 items-center gap-3 rounded-2xl border px-4 transition-shadow ${
          isDark ? "border-white/10 bg-white/[0.04] text-white" : "border-gray-200 bg-white/70 text-gray-900"
        } ${focused ? (isDark ? "border-white/25 shadow-[0_0_0_1px_rgba(255,255,255,0.12),0_12px_40px_rgba(0,0,0,0.35)]" : "border-gray-300 shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_12px_40px_rgba(15,23,42,0.1)]") : ""}`}
      >
        <svg className={`h-[18px] w-[18px] shrink-0 ${muted}`} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          placeholder="Search entities, pages, mail, transactions"
          aria-label="Search BFO"
          role="combobox"
          aria-expanded={open}
          aria-controls="home-search-list"
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `home-search-${active}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[15px] placeholder:text-gray-500"
          style={{ outline: "none" }}
        />
        {q ? (
          <button
            type="button"
            aria-label="Clear"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQ("");
              inputRef.current?.focus();
            }}
            className={`flex h-7 w-7 items-center justify-center rounded-full ${isDark ? "text-gray-400 hover:bg-white/10 hover:text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"}`}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        ) : (
          <kbd className={`hidden rounded-md border px-1.5 py-0.5 text-[11px] sm:inline ${isDark ? "border-white/15 text-gray-500" : "border-gray-200 text-gray-400"}`}>⌘K</kbd>
        )}
      </div>

      {open && (
        <div
          id="home-search-list"
          ref={listRef}
          role="listbox"
          // Mouse down would blur the input and close the list before the click lands.
          onMouseDown={(e) => e.preventDefault()}
          className={`glass-panel absolute inset-x-0 top-[calc(100%+8px)] max-h-[min(50vh,420px)] overflow-y-auto rounded-2xl border p-2 shadow-2xl ${isDark ? "text-white" : "text-gray-900"}`}
        >
          {results.length === 0 && <p className={`px-3 py-6 text-center text-sm ${muted}`}>Nothing matches “{q}”.</p>}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header && <div className={`px-3 pb-1 pt-2.5 text-[11px] font-medium ${muted}`}>{header}</div>}
                <button
                  id={`home-search-${i}`}
                  data-idx={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => {
                    if (c.group === "Pages") rememberRecent({ to: c.id.replace(/^page:/, ""), label: c.label, hint: c.hint });
                    c.run();
                  }}
                  className={`flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
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
      )}
    </div>
  );
}
