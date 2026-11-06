/**
 * Fields (docs/DESIGN.md §8.3). A Field is a label above (small 500 ink), the
 * control, then a hint (small ink-2) or, while there is one, an error (small
 * negative, with its icon). It wires the control's id, aria-describedby and
 * aria-invalid. Optional fields say " (optional)"; required ones carry no
 * mark.
 *
 * Input, Textarea and SearchField share one skin: `field` fill, a 1px
 * `edge` border, radius 8, 16px text on touch so iOS never zooms. Focus is
 * the global ring; the border never changes colour on focus. Validate on
 * submit and on blur of a touched field; never with native bubbles.
 * DateInput lives in date-input.tsx; Select in select.tsx.
 */

import { Children, cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { IconButton } from "./button";
import { cx } from "./cx";
import { money, parseMoney } from "./format";
import { Icon } from "./icon";

export const FIELD_SKIN = "rounded-control border bg-field text-field text-ink placeholder:text-ink-3";
const SKIN_STATE = (invalid?: boolean, disabled?: boolean) => (disabled ? "border-line bg-selected text-ink-disabled cursor-not-allowed" : invalid ? "border-negative" : "border-edge");

type ControlProps = { id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean; invalid?: boolean };

export function Field({
  label,
  hint,
  error,
  optional,
  children,
  id,
  className,
}: {
  label: string;
  /** Under the control in ink-2: the format, a limit, who sees it. Hidden while there's an error. */
  hint?: ReactNode;
  /** What's wrong and what to do; replaces the hint. */
  error?: string;
  /** Adds " (optional)" after the label. */
  optional?: boolean;
  /** One control: an Input, Textarea, Select, DateInput, MoneyInput or a native element. */
  children: ReactElement;
  id?: string;
  className?: string;
}) {
  const auto = useId();
  const controlId = id ?? (children.props as ControlProps).id ?? auto;
  const noteId = `${controlId}-note`;
  const note = error ? error : hint;
  const own = typeof children.type !== "string";
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<ControlProps>, {
        id: controlId,
        "aria-describedby": cx((children.props as ControlProps)["aria-describedby"], note ? noteId : undefined) || undefined,
        "aria-invalid": error ? true : undefined,
        ...(own && error ? { invalid: true } : {}),
      })
    : Children.only(children);
  return (
    <div className={cx("ds flex flex-col gap-[6px]", className)}>
      <label htmlFor={controlId} className="text-small font-medium text-ink">
        {label}
        {optional && <span className="font-normal text-ink-3"> (optional)</span>}
      </label>
      {control}
      {error ? (
        <p id={noteId} className="flex items-start gap-[6px] text-small text-negative">
          <Icon name="error" size={16} className="mt-px" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={noteId} className="text-small text-ink-2">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "prefix"> & {
  /** Red border; Field sets it when it has an error. */
  invalid?: boolean;
  /** "$" before the value, in ink-2. */
  prefix?: ReactNode;
  /** "%" after the value, in ink-2. */
  suffix?: ReactNode;
  ref?: React.Ref<HTMLInputElement>;
};

/** A text input, 36px desktop and 44px touch. With a prefix or suffix, `className` goes on the box around it. */
export function Input({ invalid, prefix, suffix, className, disabled, ...rest }: InputProps) {
  if (prefix === undefined && suffix === undefined) {
    return (
      <input
        disabled={disabled}
        aria-invalid={invalid || rest["aria-invalid"] || undefined}
        className={cx("ds h-(--control-md) w-full min-w-0 px-3", FIELD_SKIN, SKIN_STATE(invalid, disabled), className)}
        {...rest}
      />
    );
  }
  return (
    <div
      className={cx(
        "ds flex h-(--control-md) w-full min-w-0 items-center gap-2 px-3 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent has-[input:focus-visible]:outline-solid",
        FIELD_SKIN,
        SKIN_STATE(invalid, disabled),
        className,
      )}
    >
      {prefix !== undefined && <span className="shrink-0 text-ink-2">{prefix}</span>}
      <input
        disabled={disabled}
        aria-invalid={invalid || rest["aria-invalid"] || undefined}
        className="h-full min-w-0 flex-1 bg-transparent text-field text-inherit outline-none! placeholder:text-ink-3 disabled:cursor-not-allowed"
        {...rest}
      />
      {suffix !== undefined && <span className="shrink-0 text-ink-2">{suffix}</span>}
    </div>
  );
}

/**
 * Dollars: a "$" prefix, the decimal keypad, and cents with separators once
 * the field loses focus ("1,250.00"). `value` is in dollars; null is empty.
 */
export function MoneyInput({
  value,
  onChange,
  invalid,
  id,
  disabled,
  placeholder = "0.00",
  "aria-describedby": describedBy,
  "aria-invalid": ariaInvalid,
  className,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  invalid?: boolean;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  className?: string;
}) {
  const shown = (v: number | null) => (v === null ? "" : money(v, { sign: "auto" }).replace("$", ""));
  const [text, setText] = useState(() => shown(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(shown(value));
  }, [value]);
  return (
    <Input
      id={id}
      prefix="$"
      inputMode="decimal"
      autoComplete="off"
      placeholder={placeholder}
      disabled={disabled}
      invalid={invalid}
      aria-invalid={ariaInvalid}
      aria-describedby={describedBy}
      className={cx("tabular-nums", className)}
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseMoney(e.target.value));
      }}
      onBlur={() => {
        focused.current = false;
        const n = parseMoney(text);
        setText(n === null ? (text.trim() ? text : "") : shown(n));
      }}
    />
  );
}

/** Starts at three lines, grows to ten, then scrolls. */
export function Textarea({ invalid, className, disabled, value, onChange, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean; ref?: React.Ref<HTMLTextAreaElement> }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const grow = () => {
    const el = ref.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 20;
    const chrome = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    el.style.height = "auto";
    const h = Math.min(Math.max(el.scrollHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth), line * 3 + chrome), line * 10 + chrome);
    el.style.height = `${h}px`;
    el.style.overflowY = el.scrollHeight + 2 > h ? "auto" : "hidden";
  };
  useLayoutEffect(grow, [value]);
  const { ref: callerRef, ...props } = rest as typeof rest & { ref?: React.Ref<HTMLTextAreaElement> };
  return (
    <textarea
      ref={(el) => {
        ref.current = el;
        if (typeof callerRef === "function") callerRef(el);
        else if (callerRef) (callerRef as { current: HTMLTextAreaElement | null }).current = el;
      }}
      rows={3}
      disabled={disabled}
      value={value}
      onChange={(e) => {
        onChange?.(e);
        grow();
      }}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      className={cx("ds block w-full resize-none px-3 py-2", FIELD_SKIN, SKIN_STATE(invalid, disabled), className)}
      {...props}
    />
  );
}

/**
 * Search: a leading magnifier, a clear (×) once there's text, Escape clears.
 * The placeholder names what it searches ("Search entities").
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  className,
  autoFocus,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  /** "Search entities". */
  placeholder: string;
  /** The field's accessible name (usually the placeholder's words). */
  label: string;
  className?: string;
  autoFocus?: boolean;
  /** Enter, for a search that runs on demand. */
  onSubmit?: (v: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      role="search"
      className={cx(
        "ds flex h-(--control-md) w-full min-w-0 items-center gap-2 pr-1 pl-3 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent has-[input:focus-visible]:outline-solid",
        FIELD_SKIN,
        "border-edge",
        className,
      )}
    >
      <Icon name="search" className="text-ink-3" />
      <input
        ref={ref}
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            e.stopPropagation();
            onChange("");
          } else if (e.key === "Enter") onSubmit?.(value);
        }}
        className="h-full min-w-0 flex-1 bg-transparent text-field text-ink outline-none! placeholder:text-ink-3"
      />
      {value && (
        <IconButton
          icon="x"
          label="Clear search"
          noTooltip
          className="size-[28px]! touch:size-[40px]!"
          onClick={() => {
            onChange("");
            ref.current?.focus();
          }}
        />
      )}
    </div>
  );
}
