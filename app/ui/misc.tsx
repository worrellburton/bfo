/**
 * Small pieces (docs/DESIGN.md §8.17, §10, §11.6, §11.7): Avatar, Keycap,
 * Money, DateText, AiNote and LegalLinks. Tooltip lives in tooltip.tsx and
 * is re-exported here.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { cx } from "./cx";
import { asOf, date as formatDate, dateTime, initials, money, relative, time as formatTime, type Sign } from "./format";
import { Icon } from "./icon";
import { isApple, useFinePointer } from "./media";

export { Tooltip } from "./tooltip";

/**
 * A circle of 24, 32 or 40px: `sunken` fill and initials in ink-2, or a
 * photo that fades in over them; an organisation gets a building glyph. No
 * colours, no serif. Decorative beside a visible name; pass `label` when
 * it stands alone.
 */
export function Avatar({
  name,
  src,
  kind = "person",
  size = 32,
  label,
  className,
}: {
  name: string;
  src?: string | null;
  kind?: "person" | "organisation";
  size?: 24 | 32 | 40;
  label?: string;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [src]);
  const box = size === 24 ? "size-6 text-caption" : size === 40 ? "size-10 text-body" : "size-8 text-small";
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx("ds relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-sunken font-medium text-ink-2 select-none", box, className)}
    >
      {kind === "organisation" ? <Icon name="building" size={size === 40 ? 20 : 16} /> : initials(name)}
      {src && !failed && (
        <img
          src={src}
          alt=""
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cx("absolute inset-0 size-full object-cover transition-opacity duration-(--dur-3)", loaded ? "opacity-100" : "opacity-0")}
        />
      )}
    </span>
  );
}

/**
 * Keyboard keys, shown only with a fine pointer. "mod" is ⌘ on Apple devices
 * and Ctrl elsewhere. A chord shows side by side; a sequence is joined by
 * "then".
 */
export function Keycap({ keys, sequence = false, className }: { keys: string[]; sequence?: boolean; className?: string }) {
  const fine = useFinePointer();
  if (!fine) return null;
  const apple = isApple();
  const shown = keys.map((k) => (k === "mod" ? (apple ? "⌘" : "Ctrl") : k === "shift" ? (apple ? "⇧" : "Shift") : k === "alt" ? (apple ? "⌥" : "Alt") : k));
  return (
    <span className={cx("ds inline-flex items-center gap-1", className)} aria-hidden="true">
      {shown.map((k, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {sequence && i > 0 && <span className="text-caption text-ink-2">then</span>}
          <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-mark border border-line-strong bg-sunken px-1 font-sans text-caption font-medium text-ink-2">{k}</kbd>
        </span>
      ))}
    </span>
  );
}

/**
 * An amount, tabular, through format.money (§10.2). `tone`: none (ink);
 * "in" (money in is positive, out stays ink: a ledger that mixes both);
 * direction (positive or negative: a signed result such as Net). Zero as a
 * dash is ink-3.
 */
export function Money({
  value,
  precision = "cents",
  sign = "auto",
  zero = "value",
  tone = "none",
  currency,
  className,
}: {
  value: number | null | undefined;
  precision?: "cents" | "dollars" | "compact";
  sign?: Sign;
  zero?: "dash" | "value";
  tone?: "none" | "in" | "direction";
  currency?: string;
  className?: string;
}) {
  const text = money(value, { precision, sign, zero, currency });
  const isZero = text === "—";
  const v = value ?? 0;
  const colour = isZero ? "text-ink-3" : tone === "direction" ? (v > 0 ? "text-positive" : v < 0 ? "text-negative" : "") : tone === "in" && v > 0 ? "text-positive" : "";
  const exact = precision === "compact" && value !== null && value !== undefined ? money(value) : undefined;
  return (
    <span className={cx("tabular-nums whitespace-nowrap", colour, className)} title={exact}>
      {text}
    </span>
  );
}

/**
 * A date or time in a <time> element (§10.5): short, medium, long, time,
 * audit (with the zone), or relative (under a day; the exact time on
 * hover). "asof" reads "As of Nov 6, 2026, 7:00 AM".
 */
export function DateText({ value, style = "short", className }: { value: string | Date; style?: "short" | "medium" | "long" | "time" | "audit" | "relative" | "asof"; className?: string }) {
  const iso = typeof value === "string" ? value : value.toISOString();
  const [, tick] = useState(0);
  useEffect(() => {
    if (style !== "relative") return;
    const t = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, [style]);
  const text =
    style === "time"
      ? formatTime(value)
      : style === "audit"
        ? dateTime(value, { zone: true })
        : style === "relative"
          ? relative(value)
          : style === "asof"
            ? asOf(value, { time: true })
            : formatDate(value, style);
  return (
    <time dateTime={iso} title={style === "relative" ? dateTime(value) : undefined} className={cx("tabular-nums", className)}>
      {text}
    </time>
  );
}

/**
 * The label on anything AI made, where it appears (§11.6): a sparkle and
 * "Read by AI from Operating Agreement", "Drafted by AI · review before
 * sending", or "Summary by AI", in small ink-2.
 */
export function AiNote({ kind, source, className }: { kind: "read" | "drafted" | "summary"; /** The document it was read from. */ source?: string; className?: string }) {
  const words = kind === "read" ? `Read by AI${source ? ` from ${source}` : ""}` : kind === "drafted" ? "Drafted by AI · review before sending" : "Summary by AI";
  return (
    <span className={cx("ds inline-flex items-center gap-[6px] text-small text-ink-2", className)}>
      <Icon name="sparkle" size={16} />
      {words}
    </span>
  );
}

/** "Terms · Privacy" (§11.7): caption links in ink-2 in the app, door ink 2 on the door. */
export function LegalLinks({ tone = "app", className, children }: { tone?: "app" | "door"; className?: string; /** Anything to put before them on the same line. */ children?: ReactNode }) {
  const link = cx("underline-offset-[3px] hover:underline", tone === "door" ? "text-door-ink-2 hover:text-door-ink" : "text-ink-2 hover:text-ink");
  return (
    <p className={cx("ds text-caption", tone === "door" ? "text-door-ink-2" : "text-ink-2", className)}>
      {children}
      <Link to="/legal/terms" className={link}>
        Terms
      </Link>
      <span aria-hidden="true"> · </span>
      <Link to="/legal/privacy" className={link}>
        Privacy
      </Link>
    </p>
  );
}
