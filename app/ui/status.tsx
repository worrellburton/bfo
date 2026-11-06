/**
 * Status, Badge, Count and FilterChip (docs/DESIGN.md §8.7).
 *
 * - Status: a state, as a dot and a word. Exceptions only: "Connected",
 *   "Mapped", "On" show nothing. Where statuses repeat in a grid, `shape`
 *   swaps the dot for a glyph so colour is never the only signal. Never
 *   pulsing; the words stay ink.
 * - Badge: a kind, not a state (LLC, Trust, Staff only). Neutral, never
 *   coloured, never a button.
 * - Count: a number on a pill; `attention` (amber) for things that need the
 *   person, never red; "99+" over 99; nothing at zero.
 * - FilterChip: an active filter with a × that removes it.
 */

import type { ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./icon";

export type Tone = "neutral" | "positive" | "warning" | "negative" | "info";

const DOT: Record<Tone, string> = {
  neutral: "bg-ink-3",
  positive: "bg-positive",
  warning: "bg-warning",
  negative: "bg-negative",
  info: "bg-info",
};
const GLYPH_TEXT: Record<Tone, string> = {
  neutral: "text-ink-3",
  positive: "text-positive",
  warning: "text-warning",
  negative: "text-negative",
  info: "text-info",
};
const SHAPE: Record<Tone, IconName> = { neutral: "minus", positive: "check", warning: "warning", negative: "x", info: "info" };

export function Status({
  tone,
  children,
  shape = false,
  className,
}: {
  tone: Tone;
  /** One or two words, a fact: "Overdue", "Filed", "Needs review". */
  children: ReactNode;
  /** A 16px shape instead of the dot, where statuses repeat in a grid. */
  shape?: boolean;
  className?: string;
}) {
  return (
    <span className={cx("ds inline-flex items-center gap-[6px] text-small whitespace-nowrap text-ink", className)}>
      {shape ? (
        <span className={GLYPH_TEXT[tone]}>
          <Icon name={SHAPE[tone]} size={16} />
        </span>
      ) : (
        <span aria-hidden="true" className={cx("size-2 shrink-0 rounded-full", DOT[tone])} />
      )}
      {children}
    </span>
  );
}

export function Badge({ children, icon, className }: { children: ReactNode; /** A 12px leading icon (a lock for Staff only). */ icon?: IconName; className?: string }) {
  return (
    <span className={cx("ds inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-sunken px-2 text-caption font-medium whitespace-nowrap text-ink-2", className)}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

export function Count({
  n,
  tone = "neutral",
  label,
  className,
}: {
  n: number;
  /** attention: things that need the person (amber). Never red. */ tone?: "neutral" | "attention";
  /** What it counts, for screen readers ("3 need review"). */ label?: string;
  className?: string;
}) {
  if (!n || n < 0) return null;
  return (
    <span
      aria-label={label}
      className={cx(
        "ds inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-[6px] text-caption font-medium tabular-nums",
        tone === "attention" ? "bg-warning-tint text-warning" : "bg-sunken text-ink-2",
        className,
      )}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function FilterChip({ children, onRemove, removeLabel }: { children: ReactNode; onRemove: () => void; /** "Remove filter: Nevada"; defaults from the chip's text. */ removeLabel?: string }) {
  return (
    <span className="ds inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-edge pr-1 pl-3 text-small text-ink">
      <span className="whitespace-nowrap">{children}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel ?? (typeof children === "string" ? `Remove filter: ${children}` : "Remove filter")}
        className="relative inline-flex size-5 cursor-pointer items-center justify-center rounded-full text-ink-2 after:absolute after:-inset-3 after:content-[''] hover:bg-hover hover:text-ink"
      >
        <Icon name="x" size={12} />
      </button>
    </span>
  );
}
