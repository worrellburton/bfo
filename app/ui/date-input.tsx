/**
 * A date field (docs/DESIGN.md §8.3): shows "Nov 6, 2026", accepts dates
 * typed in common forms ("11/6/2026", "6 Nov 2026"), and opens a calendar
 * (a popover on desktop, a sheet on touch). The value is a calendar date,
 * "YYYY-MM-DD", or null.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "./button";
import { cx } from "./cx";
import { FIELD_SKIN } from "./field";
import { date as formatDate, isoDate, parseDate } from "./format";
import { Popover } from "./overlay";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function monthGrid(year: number, month: number): (string | null)[] {
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: first }, () => null);
  for (let d = 1; d <= days; d++) cells.push(isoDate(new Date(year, month, d)));
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** The month grid. Arrow keys move by day and week; Enter chooses. Today has an accent ring; the chosen day the accent tint. */
function Calendar({ value, onPick }: { value: string | null; onPick: (iso: string) => void }) {
  const today = isoDate(new Date());
  const start = value ?? today;
  const [view, setView] = useState(() => ({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 }));
  const [focus, setFocus] = useState(start);
  const grid = useMemo(() => monthGrid(view.y, view.m), [view]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-day="${focus}"]`)?.focus({ preventScroll: true });
  }, [focus, view]);
  const shift = (days: number) => {
    const d = new Date(Number(focus.slice(0, 4)), Number(focus.slice(5, 7)) - 1, Number(focus.slice(8, 10)) + days);
    setFocus(isoDate(d));
    setView({ y: d.getFullYear(), m: d.getMonth() });
  };
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(view.y, view.m, 1));
  return (
    <div ref={ref} className="ds flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <IconButton icon="chevronLeft" label="Previous month" noTooltip onClick={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))} />
        <span className="text-body font-medium text-ink" aria-live="polite">
          {monthName}
        </span>
        <IconButton icon="chevronRight" label="Next month" noTooltip onClick={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))} />
      </div>
      <div role="grid" aria-label={monthName} className="grid grid-cols-7 gap-[2px] text-center tabular-nums">
        {WEEKDAYS.map((w) => (
          <span key={w} role="columnheader" className="flex h-8 items-center justify-center text-caption font-medium text-ink-2">
            {w}
          </span>
        ))}
        {grid.map((iso, i) =>
          iso ? (
            <button
              key={iso}
              type="button"
              role="gridcell"
              data-day={iso}
              aria-selected={iso === value}
              aria-current={iso === today ? "date" : undefined}
              tabIndex={iso === focus ? 0 : -1}
              onClick={() => onPick(iso)}
              onKeyDown={(e) => {
                const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
                if (step) {
                  e.preventDefault();
                  shift(step);
                }
              }}
              className={cx(
                "flex h-9 items-center justify-center rounded-control text-body outline-offset-[-2px]! touch:h-11",
                iso === value ? "bg-accent-tint font-medium text-accent" : "text-ink hover:bg-hover",
                iso === today && "shadow-[inset_0_0_0_1px_var(--color-accent)]",
              )}
            >
              {Number(iso.slice(8, 10))}
            </button>
          ) : (
            <span key={`e${i}`} />
          ),
        )}
      </div>
    </div>
  );
}

export function DateInput({
  value,
  onChange,
  invalid,
  id,
  disabled,
  "aria-describedby": describedBy,
  className,
}: {
  /** "YYYY-MM-DD" or null. */
  value: string | null;
  onChange: (iso: string | null) => void;
  invalid?: boolean;
  id?: string;
  disabled?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  className?: string;
}) {
  const shown = (v: string | null) => (v ? formatDate(v, "medium") : "");
  const [text, setText] = useState(shown(value));
  const [bad, setBad] = useState(false);
  const [open, setOpen] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(shown(value));
  }, [value]);
  const commit = () => {
    const t = text.trim();
    if (!t) {
      setBad(false);
      onChange(null);
      return;
    }
    const iso = parseDate(t);
    setBad(!iso);
    if (iso) {
      onChange(iso);
      setText(shown(iso));
    }
  };
  return (
    <div
      className={cx(
        "ds flex h-(--control-md) w-full min-w-0 items-center gap-1 pr-1 pl-3 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent has-[input:focus-visible]:outline-solid",
        FIELD_SKIN,
        disabled ? "border-line bg-selected text-ink-disabled" : invalid || bad ? "border-negative" : "border-edge",
        className,
      )}
    >
      <input
        id={id}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={invalid || bad || undefined}
        placeholder="Nov 6, 2026"
        autoComplete="off"
        value={text}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        className="h-full min-w-0 flex-1 bg-transparent text-field text-inherit tabular-nums outline-none! placeholder:text-ink-3 disabled:cursor-not-allowed"
      />
      <Popover
        label="Choose a date"
        open={open}
        onOpenChange={setOpen}
        align="end"
        trigger={<IconButton icon="calendar" label="Choose a date" noTooltip disabled={disabled} className="size-[28px]! touch:size-[40px]!" />}
      >
        <Calendar
          value={value}
          onPick={(iso) => {
            onChange(iso);
            setText(shown(iso));
            setBad(false);
            setOpen(false);
          }}
        />
      </Popover>
    </div>
  );
}
