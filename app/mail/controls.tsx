import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Count, SearchField, cx } from "../ui";
import type { MailFolder } from "../mail-client";
import { Star } from "./glyphs";
import { tap } from "./helpers";

/**
 * Mail's small controls on the system's parts: the search box (the system's
 * SearchField, searching after a short pause), the pick box and the star in
 * a row, and the folder tabs (the system's Tabs, matched on ?f= rather than
 * the path).
 */

/** What's typed is searched after a short pause (or at once on Enter); the URL keeps the term. Esc or × clears it. */
export function MailSearch({ value, onSearch, className }: { value: string; onSearch: (term: string) => void; className?: string }) {
  const [term, setTerm] = useState(value);
  const timer = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // Back/forward or a cleared search: the box follows the URL.
  useEffect(() => setTerm(value), [value]);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  // "/" (the shortcut sheet's "Search this page") finds the box by this mark.
  useEffect(() => {
    box.current?.querySelector("input")?.setAttribute("data-page-search", "");
  }, []);
  function change(next: string) {
    setTerm(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onSearch(next), next ? 350 : 0);
  }
  return (
    <div ref={box} className={cx("min-w-0", className)}>
      <SearchField
        value={term}
        onChange={change}
        onSubmit={(v) => {
          if (timer.current) window.clearTimeout(timer.current);
          onSearch(v);
        }}
        placeholder="Search mail"
        label="Search mail"
      />
    </div>
  );
}

/**
 * Picking a message for a bulk action: the system's checkbox (16px, 20 on
 * touch, accent when on, a dash when some are picked) in a hit area of the
 * control size. Shift-click picks the range from the last one picked.
 */
export function SelectBox({ on, mixed = false, onToggle, label, className }: { on: boolean; mixed?: boolean; onToggle: (shift: boolean) => void; label: string; className?: string }) {
  const filled = on || mixed;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? "mixed" : on}
      aria-label={label}
      // Shift-click shouldn't select the text between.
      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(e.shiftKey);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={cx("inline-flex size-(--control-sm) shrink-0 cursor-pointer items-center justify-center rounded-control", className)}
    >
      <span
        aria-hidden="true"
        className={cx("inline-flex size-[16px] items-center justify-center rounded-mark border-[1.5px] touch:size-[20px]", filled ? "border-accent bg-accent text-on-accent" : "border-edge bg-field")}
      >
        {filled && (
          <svg viewBox="0 0 16 16" className="size-[12px] touch:size-[14px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            {mixed ? <path d="M4 8h8" /> : <path d="M3.5 8.5l3 3 6-7" />}
          </svg>
        )}
      </span>
    </button>
  );
}

/**
 * A row's star. On: always shown, amber. Off: only on desktop hover or focus
 * (`reveal`), never as a row of empty outlines; on touch a swipe stars.
 */
export function StarButton({ on, onToggle, reveal = false, className }: { on: boolean; onToggle: (next: boolean) => void; reveal?: boolean; className?: string }) {
  if (!on && !reveal) return null;
  return (
    <button
      type="button"
      aria-label={on ? "Unstar" : "Star"}
      aria-pressed={on}
      title={on ? "Unstar (s)" : "Star (s)"}
      onClick={(e) => {
        e.stopPropagation();
        if (!on) tap();
        onToggle(!on);
      }}
      // Enter/Space press the star, not the row it sits in.
      onKeyDown={(e) => e.stopPropagation()}
      className={cx(
        "inline-flex size-(--control-sm) shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-3 hover:bg-hover hover:text-ink",
        !on && "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 touch:hidden",
        className,
      )}
    >
      <Star on={on} />
    </button>
  );
}

/** One folder tab: its label, its count (the things in it that need the person), and where it goes. */
export type FolderTab = { key: MailFolder; label: string; to: string; count?: number; title?: string };

/**
 * The folder tabs: the system's Tabs (§8.11), 40px, body 500, the current
 * one ink with a 2px ink underline on the bar's hairline. Mail's folders live
 * on one path, told apart by ?f=, so the current tab is named outright.
 */
export function FolderTabs({ items, current, onChoose }: { items: FolderTab[]; current: MailFolder; onChoose: (f: MailFolder) => void }) {
  return (
    <nav aria-label="Folders" className="ds min-w-0">
      <ul className="-mb-px flex gap-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((t) => {
          const on = t.key === current;
          return (
            <li key={t.key} className="shrink-0">
              <Link
                to={t.to}
                aria-current={on ? "page" : undefined}
                title={t.title}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  onChoose(t.key);
                }}
                className={cx(
                  "flex h-10 items-center gap-2 border-b-2 text-body font-medium whitespace-nowrap touch:h-11",
                  on ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink",
                )}
              >
                {t.label}
                {t.count ? <Count n={t.count} label={`${t.count} unread`} /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
