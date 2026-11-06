/**
 * Choosing (docs/DESIGN.md §8.6). Pick by kind: several independent yes/no
 * choices are Checkboxes; one of two to four options with consequences is
 * ChoiceTiles; an immediate on/off setting is a Switch (never inside a form
 * with a Save button); one of two to five short options is a Segmented
 * control (segmented.tsx); a long list is a Select (select.tsx).
 *
 * The chosen state is never colour alone: the check, the filled radio or the
 * thumb's side carries it too. Checkbox and Switch are labelled rows; the
 * whole row is the target, at least 44px tall on touch.
 */

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "./cx";

export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  disabled,
  name,
  className,
}: {
  /** true, false, or "mixed" (some of a group). */
  checked: boolean | "mixed";
  onChange: (v: boolean) => void;
  /** What checking it means. For agreement, the words of the agreement (§11.4). */
  label: ReactNode;
  /** One line under the label. */
  hint?: ReactNode;
  disabled?: boolean;
  name?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const hintId = useId();
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = checked === "mixed";
  }, [checked]);
  const on = checked === true;
  const mixed = checked === "mixed";
  return (
    <label className={cx("ds group/check flex items-start gap-2 text-body touch:min-h-[44px] touch:items-center", disabled ? "cursor-not-allowed" : "cursor-pointer", className)}>
      <input
        ref={ref}
        type="checkbox"
        name={name}
        className="peer sr-only"
        checked={on}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className={cx(
          "mt-[2px] inline-flex size-[16px] shrink-0 items-center justify-center rounded-mark border-[1.5px] touch:mt-0 touch:size-[20px]",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-focus-visible:outline-solid",
          disabled ? "border-line bg-selected text-ink-disabled" : on || mixed ? "border-accent bg-accent text-on-accent" : "border-edge bg-field",
        )}
      >
        {on && (
          <svg viewBox="0 0 16 16" className="size-[12px] touch:size-[14px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
        )}
        {mixed && (
          <svg viewBox="0 0 16 16" className="size-[12px] touch:size-[14px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M4 8h8" />
          </svg>
        )}
      </span>
      <span className="min-w-0">
        <span className={cx("block", disabled ? "text-ink-disabled" : "text-ink")}>{label}</span>
        {hint && (
          <span id={hintId} className="block text-small text-ink-2">
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

/**
 * A radio group with descriptions, for two to four options that carry
 * consequences (a role, a signing mode, a tax election, a confirm's scope).
 * One Tab stop; the arrow keys move the choice. `value` null shows the
 * question unanswered.
 */
export function ChoiceTiles<T extends string>({
  value,
  onChange,
  label,
  options,
  stacked = false,
  hideLabel = false,
}: {
  value: T | null;
  onChange: (v: T) => void;
  /** The question, shown above the tiles (and the group's name). */
  label: string;
  options: { value: T; title: string; description?: string; disabled?: boolean }[];
  /** Always one column (a confirm, a narrow form). Otherwise a row on desktop when they fit. */
  stacked?: boolean;
  /** Keep the label for screen readers only (a confirm's scope, where the title asks). */
  hideLabel?: boolean;
}) {
  const labelId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const current = options.findIndex((o) => o.value === value);
  const tabStop = current >= 0 ? current : enabled[0];
  const move = (from: number, dir: 1 | -1) => {
    const at = enabled.indexOf(from);
    const next = enabled[(at + dir + enabled.length) % enabled.length];
    if (next === undefined) return;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div className="ds flex flex-col gap-2">
      <div id={labelId} className={cx("text-small font-medium text-ink", hideLabel && "sr-only")}>
        {label}
      </div>
      <div role="radiogroup" aria-labelledby={labelId} className={cx("grid gap-2", !stacked && "sm:auto-cols-fr sm:grid-flow-col")}>
        {options.map((o, i) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={o.disabled}
              tabIndex={i === tabStop ? 0 : -1}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                  e.preventDefault();
                  move(i, 1);
                } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  move(i, -1);
                }
              }}
              className={cx(
                "flex items-start gap-3 rounded-card border p-4 text-left transition-colors duration-(--dur-1)",
                o.disabled
                  ? "cursor-not-allowed border-line bg-selected"
                  : on
                    ? "cursor-pointer border-accent bg-accent-tint shadow-[inset_0_0_0_1px_var(--color-accent)]"
                    : "cursor-pointer border-edge hover:bg-hover",
              )}
            >
              <span
                aria-hidden="true"
                className={cx(
                  "mt-[2px] inline-flex size-[16px] shrink-0 items-center justify-center rounded-full border-[1.5px]",
                  o.disabled ? "border-line" : on ? "border-accent bg-accent" : "border-edge bg-field",
                )}
              >
                {on && <span className="size-[6px] rounded-full bg-on-accent" />}
              </span>
              <span className="min-w-0">
                <span className={cx("block text-body font-medium", o.disabled ? "text-ink-disabled" : "text-ink")}>{o.title}</span>
                {o.description && <span className="block text-small text-ink-2">{o.description}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * An immediate on/off setting: the setting's name on the left, the switch on
 * the right, in a row of at least 44px. The label names the setting, never
 * its current value.
 */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  /** The setting's name. */
  label: string;
  /** One line under the name: what it does. */
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <div className={cx("ds flex min-h-[44px] items-center justify-between gap-4", className)}>
      <div className="min-w-0">
        <label htmlFor={id} className={cx("block text-body", disabled ? "text-ink-disabled" : "cursor-pointer text-ink")}>
          {label}
        </label>
        {hint && (
          <p id={hintId} className="text-small text-ink-2">
            {hint}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={hint ? hintId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative inline-flex h-[20px] w-[36px] shrink-0 items-center rounded-full transition-colors duration-(--dur-1) touch:h-[26px] touch:w-[44px]",
          disabled ? "cursor-not-allowed bg-selected" : checked ? "cursor-pointer bg-accent" : "cursor-pointer bg-edge",
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            "inline-block size-[16px] rounded-full bg-paper shadow-(--elevation-1) transition-transform duration-(--dur-1) ease-(--ease-standard) touch:size-[22px]",
            checked ? "translate-x-[18px] touch:translate-x-[20px]" : "translate-x-[2px]",
          )}
        />
      </button>
    </div>
  );
}
