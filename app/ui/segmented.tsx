/**
 * Segmented control (docs/DESIGN.md §8.5): switches between two to five
 * views or filters of the same content (Map | List, 30D | 90D | All). A
 * `sunken` track; the chosen segment is an `overlay` fill with a 1px `edge`
 * border (what makes the choice visible at 3:1) and --elevation-1. It is a
 * radio group: one Tab stop, the arrow keys move the choice, and it changes
 * instantly. Not for page navigation (Tabs) or more than five options
 * (Select).
 */

import { useRef, type ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./icon";

export function Segmented<T extends string>({
  value,
  onChange,
  label,
  options,
  full = false,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  /** The group's name for screen readers ("View", "Period"). */
  label: string;
  /** Two to five; labels at most two words. An icon is a name from the set (or, for legacy callers, a node). With `iconOnly`, the label is the segment's name. */
  options: { value: T; label: string; icon?: IconName | ReactNode; iconOnly?: boolean }[];
  /** Fill the row, every segment the same width. */
  full?: boolean;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const move = (dir: 1 | -1) => {
    const next = (at + dir + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("ds h-(--control-sm) items-stretch gap-[2px] rounded-control bg-sunken p-[2px]", full ? "flex w-full" : "inline-flex", className)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((o, i) => {
        const on = i === at;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.iconOnly ? o.label : undefined}
            title={o.iconOnly ? o.label : undefined}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cx(
              "inline-flex cursor-pointer items-center justify-center gap-[6px] rounded-[6px] border text-small font-medium whitespace-nowrap touch:text-body",
              full ? "flex-1 px-2" : o.iconOnly ? "aspect-square" : "px-3",
              on ? "border-edge bg-overlay text-ink shadow-(--elevation-1)" : "border-transparent text-ink-2 hover:text-ink",
            )}
          >
            {typeof o.icon === "string" ? <Icon name={o.icon as IconName} /> : o.icon}
            {!o.iconOnly && o.label}
          </button>
        );
      })}
    </div>
  );
}
