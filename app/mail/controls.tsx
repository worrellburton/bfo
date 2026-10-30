import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, useTone } from "../entity/ui";
import { Star } from "./glyphs";
import { tap } from "./helpers";

/** The appearance button: Mail's own light/dark switch. A sun in the dark, a moon in the light. */
export function ThemeButton({ dark, onToggle, className = "", iconClassName = "h-5 w-5" }: { dark: boolean; onToggle: () => void; className?: string; iconClassName?: string }) {
  return (
    <button
      type="button"
      aria-label={dark ? "Appearance: dark. Switch to light" : "Appearance: light. Switch to dark"}
      title={dark ? "Switch to light" : "Switch to dark"}
      onClick={onToggle}
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full transition-transform active:scale-90 ${className}`}
    >
      <span key={dark ? "sun" : "moon"} className="theme-icon-in inline-flex">
      {dark ? (
        <svg viewBox="0 0 24 24" className={iconClassName} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2M12 19.5v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2.5 12h2M19.5 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className={iconClassName} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z" />
        </svg>
      )}
      </span>
    </button>
  );
}

/** Open/closed with an exit: `shown` stays true for `ms` after closing so the exit animation can play; `leaving` marks that stretch. */
export function useExit(open: boolean, ms: number): { shown: boolean; leaving: boolean } {
  const [shown, setShown] = useState(open);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (open) {
      setShown(true);
      setLeaving(false);
      return;
    }
    if (!shown) return;
    setLeaving(true);
    const id = window.setTimeout(() => {
      setShown(false);
      setLeaving(false);
    }, ms);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return { shown, leaving };
}

// ── Controls ─────────────────────────────────────────────────────────────

/** A row of pills where one is on. With `iconsOnly` the labels are tooltips. */
export function Segmented<K extends string>({
  label,
  value,
  options,
  onChange,
  iconsOnly = false,
  stretch = false,
  className = "",
}: {
  label: string;
  value: K;
  options: { key: K; label: string; icon?: ReactNode }[];
  onChange: (next: K) => void;
  iconsOnly?: boolean;
  /** Fill the row, each choice the same width (phones). */
  stretch?: boolean;
  className?: string;
}) {
  const t = useTone();
  return (
    <div
      role="group"
      aria-label={label}
      className={`${stretch ? "flex w-full" : "inline-flex shrink-0"} items-center gap-0.5 rounded-xl p-0.5 ${t.dark ? "bg-white/[0.05]" : "bg-gray-100"} ${className}`}
    >
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            aria-label={iconsOnly ? o.label : undefined}
            title={iconsOnly ? o.label : undefined}
            onClick={() => onChange(o.key)}
            className={`inline-flex h-6 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[9px] text-[12px] font-medium transition-colors max-sm:h-[38px] max-sm:text-[13.5px] md:pointer-coarse:h-[36px] ${
              stretch ? "flex-1 justify-center px-2" : iconsOnly ? "w-7 justify-center max-sm:w-[40px] md:pointer-coarse:w-[40px]" : "px-2.5 max-sm:px-3 md:pointer-coarse:px-3"
            } ${
              on ? (t.dark ? "bg-white/[0.1] text-white shadow-sm" : "bg-white text-gray-900 shadow-sm") : t.dark ? "text-gray-500 hover:text-gray-200" : "text-gray-500 hover:text-gray-900"
            }`}
          >
            {o.icon}
            {!iconsOnly && o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The search box: what's typed is searched after a short pause (or at once on
 * Enter), and the URL keeps the term. Esc or the × clears it.
 */
export function SearchField({ value, onSearch, className = "" }: { value: string; onSearch: (term: string) => void; className?: string }) {
  const t = useTone();
  const [term, setTerm] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);
  // Back/forward or a cleared search: the box follows the URL.
  useEffect(() => setTerm(value), [value]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  function change(next: string) {
    setTerm(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onSearch(next), 350);
  }
  function submit(next: string) {
    if (timer.current) window.clearTimeout(timer.current);
    onSearch(next);
  }
  return (
    <div
      role="search"
      className={`flex items-center gap-2 rounded-full border px-3.5 transition-colors pill-glass max-md:h-[48px] max-md:px-5 md:h-9 md:rounded-xl md:px-3 ${
        t.dark ? "md:border-white/[0.08] md:bg-white/[0.04] md:focus-within:border-white/20 md:focus-within:bg-white/[0.06]" : "md:border-gray-200 md:bg-white md:focus-within:border-gray-400"
      } ${className}`}
    >
      <svg className={`h-[18px] w-[18px] shrink-0 md:h-4 md:w-4 ${t.muted}`} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
      </svg>
      <input
        ref={ref}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        aria-label="Search mail"
        placeholder="Search mail"
        data-page-search
        value={term}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit(term);
          else if (e.key === "Escape") {
            setTerm("");
            submit("");
            ref.current?.blur();
          }
        }}
        style={{ outline: "none" }}
        className={`min-w-0 flex-1 bg-transparent text-[16px] placeholder:text-gray-500 md:text-[13px] [&::-webkit-search-cancel-button]:hidden ${t.text}`}
      />
      {term && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setTerm("");
            submit("");
            ref.current?.focus();
          }}
          className={`inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full max-md:-mr-2 max-md:h-[40px] max-md:w-[40px] ${t.dark ? "text-gray-400 hover:bg-white/[0.08] hover:text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"}`}
        >
          <Icon name="x" className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

/** Star toggle for a row: quiet until hovered, unless it's on. Stops the click reaching the row. */
/**
 * Picking a message: a round box that pops as it fills and draws its check
 * (a dash when only some are picked). Shift-click picks the range from the
 * last one picked.
 */
export function SelectBox({ on, mixed = false, onToggle, label, className = "" }: { on: boolean; mixed?: boolean; onToggle: (shift: boolean) => void; label: string; className?: string }) {
  const t = useTone();
  const filled = on || mixed;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? "mixed" : on}
      aria-label={label}
      title={label}
      // Shift-click shouldn't select the text between.
      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(e.shiftKey);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={`group/pick inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full max-md:h-[40px] max-md:w-[40px] md:pointer-coarse:h-[40px] md:pointer-coarse:w-[40px] ${className}`}
    >
      <span
        key={filled ? "on" : "off"}
        className={`relative grid h-[17px] w-[17px] place-items-center rounded-full border-[1.5px] transition-[background-color,border-color,box-shadow] duration-200 ${filled ? "pick-pop" : ""} ${
          filled
            ? "border-(--mail-accent) bg-(--mail-accent-deep) shadow-[0_0_0_3px_rgba(129,140,248,0.18)]"
            : t.dark
              ? "border-white/25 group-hover/pick:border-white/60"
              : "border-gray-300 group-hover/pick:border-gray-500"
        }`}
      >
        <svg viewBox="0 0 12 12" className="h-[9px] w-[9px]" fill="none" stroke="white" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {mixed ? (
            <path d="M3 6h6" />
          ) : (
            <path d="M2.5 6.3l2.3 2.3 4.7-5" style={{ strokeDasharray: 12, strokeDashoffset: on ? 0 : 12, transition: "stroke-dashoffset 220ms ease 60ms" }} />
          )}
        </svg>
      </span>
    </button>
  );
}

export function StarButton({ on, onToggle, className = "", alwaysOnPhones = false }: { on: boolean; onToggle: (next: boolean) => void; className?: string; alwaysOnPhones?: boolean }) {
  const t = useTone();
  const [pop, setPop] = useState(false);
  return (
    <button
      type="button"
      aria-label={on ? "Unstar" : "Star"}
      aria-pressed={on}
      title={on ? "Unstar" : "Star"}
      onClick={(e) => {
        e.stopPropagation();
        if (!on) {
          setPop(true);
          setTimeout(() => setPop(false), 400);
          tap();
        }
        onToggle(!on);
      }}
      // Enter/Space press the star, not the row it sits in.
      onKeyDown={(e) => e.stopPropagation()}
      className={`inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors max-md:h-[40px] max-md:w-[40px] md:pointer-coarse:h-[40px] md:pointer-coarse:w-[40px] ${
        on ? "" : `${t.faint} md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 ${alwaysOnPhones ? "" : "max-md:hidden"} ${t.dark ? "hover:text-gray-200" : "hover:text-gray-700"}`
      } ${className}`}
    >
      <Star on={on} className={`h-3.5 w-3.5 max-md:h-[18px] max-md:w-[18px] ${pop ? "star-pop" : ""}`} strokeWidth={on ? 1.6 : 1.4} />
    </button>
  );
}

/** Phones: a thin line across the top that fills as you read down a message. */
export function ReadingProgress() {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setPct(max > 40 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  if (pct <= 0) return null;
  return <div aria-hidden="true" className="read-progress md:hidden" style={{ width: `${pct}%`, top: "env(safe-area-inset-top)" }} />;
}

