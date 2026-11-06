/**
 * Buttons and links (docs/DESIGN.md §8.1, §8.2, §3.4).
 *
 * - Button: primary (ink fill), secondary (the default: an `edge` outline),
 *   quiet (no border) and danger (only inside a confirm). Sizes sm, md, lg
 *   read --control-* so touch sizes come from tokens. One primary per screen.
 * - IconButton: a square, always with a `label` (its name, and its tooltip
 *   on desktop).
 * - LinkButton: a Button that navigates. TextLink: an accent link, inline
 *   (underlined) or standalone (chevron when it navigates).
 *
 * Disabled is never opacity: `selected` fill (or a `line` border) and the
 * `ink-disabled` label. Busy holds the width, shows a spinner and a verb
 * ("Saving…"), sets aria-busy and ignores clicks.
 */

import { useContext, useId, type ReactNode } from "react";
import { Link } from "react-router";
import { ButtonLayout, buttonClasses, type ButtonSize, type ButtonVariant } from "./button-style";
import { cx } from "./cx";
import { Icon, Spinner, type IconName } from "./icon";
import { Tooltip } from "./tooltip";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary: the one main action; secondary (default); quiet: low-emphasis; danger: only inside a confirm. */
  variant?: ButtonVariant;
  /** sm 32/44, md 36/44 (default), lg 44/48 (desktop/touch). */
  size?: ButtonSize;
  /** A leading icon. */
  icon?: IconName;
  /** Shows a spinner and `busyLabel`, holds the width, ignores clicks. */
  busy?: boolean;
  /** The verb while busy, with an ellipsis: "Saving…". Defaults to the label. */
  busyLabel?: string;
  /** Why it's disabled. Read out as its description and shown on hover; also show it visibly beside the button. */
  disabledReason?: string;
  /** Full width. */
  full?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
};

function Label({ icon, busy, busyLabel, children }: { icon?: IconName; busy?: boolean; busyLabel?: string; children: ReactNode }) {
  if (busyLabel === undefined && !busy) {
    return (
      <>
        {icon && <Icon name={icon} />}
        {children}
      </>
    );
  }
  // Both states share one grid cell, so the button keeps the wider one's width.
  return (
    <span className="grid place-items-center">
      <span className={cx("col-start-1 row-start-1 inline-flex items-center gap-2", busy && "invisible")}>
        {icon && <Icon name={icon} />}
        {children}
      </span>
      <span className={cx("col-start-1 row-start-1 inline-flex items-center gap-2", !busy && "invisible")} aria-hidden={!busy}>
        <Spinner />
        {busyLabel ?? children}
      </span>
    </span>
  );
}

export function Button({
  variant,
  size,
  icon,
  busy,
  busyLabel,
  disabledReason,
  full,
  className,
  children,
  type = "button",
  onClick,
  disabled,
  title,
  "aria-describedby": describedBy,
  ...rest
}: ButtonProps) {
  const layout = useContext(ButtonLayout);
  const reasonId = useId();
  const showReason = disabled && disabledReason;
  return (
    <button
      type={type}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-describedby={showReason ? cx(reasonId, describedBy) : describedBy}
      title={showReason ? disabledReason : title}
      onClick={busy ? (e) => e.preventDefault() : onClick}
      className={cx(buttonClasses({ variant, size: size ?? layout.size, full: full ?? layout.full }), busy && "cursor-progress", className)}
      {...rest}
    >
      <Label icon={icon} busy={busy} busyLabel={busyLabel}>
        {children}
      </Label>
      {showReason && (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      )}
    </button>
  );
}

/** A Button that navigates (a react-router Link). */
export function LinkButton({
  to,
  variant,
  size,
  icon,
  full,
  className,
  children,
  replace,
  state,
  ...rest
}: Omit<ButtonProps, "busy" | "busyLabel" | "disabledReason" | "ref" | "type"> & { to: string; replace?: boolean; state?: unknown } & Omit<
    React.AnchorHTMLAttributes<HTMLAnchorElement>,
    keyof ButtonProps
  >) {
  const layout = useContext(ButtonLayout);
  return (
    <Link
      to={to}
      replace={replace}
      state={state}
      className={cx(buttonClasses({ variant, size: size ?? layout.size, full: full ?? layout.full }), className)}
      {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
    >
      {icon && <Icon name={icon} />}
      {children}
    </Link>
  );
}

export type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  /** Its accessible name and, on desktop, its tooltip. Required. */
  label: string;
  /** quiet (default): ink-2 icon, hover fill; secondary: an edge border. */
  variant?: "quiet" | "secondary";
  /** sm 32/44 (default), md 36/44. */
  size?: "sm" | "md";
  /** A toggle: `selected` fill and ink icon, with aria-pressed. */
  pressed?: boolean;
  /** Skip the desktop tooltip (when the label is already visible beside it). */
  noTooltip?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
};

export function IconButton({ icon, label, variant = "quiet", size = "sm", pressed, noTooltip, className, type = "button", ...rest }: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      className={cx(
        "ds relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-control transition-colors duration-(--dur-1) disabled:cursor-not-allowed disabled:text-ink-disabled",
        size === "md" ? "size-(--control-md)" : "size-(--control-sm)",
        variant === "secondary" ? "border border-edge text-ink disabled:border-line" : "text-ink-2",
        pressed ? "bg-selected text-ink" : "enabled:hover:bg-hover enabled:hover:text-ink enabled:active:bg-selected",
        className,
      )}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
  return noTooltip ? button : <Tooltip label={label}>{button}</Tooltip>;
}

/**
 * A link in accent. Inline (inside running text): underlined, since accent
 * and ink differ by under 3:1. Standalone ("View all"): no underline until
 * hover, a chevron when it navigates, 44px tall on touch. External links
 * open in a new tab with the external-arrow icon.
 */
export function TextLink({
  to,
  children,
  inline = false,
  external,
  className,
  onClick,
}: {
  to: string;
  children: ReactNode;
  /** Inside a sentence: underlined, no chevron. */
  inline?: boolean;
  /** Leaves BFO: new tab and the external icon. Defaults to true for http(s) addresses. */
  external?: boolean;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
}) {
  const outside = external ?? /^https?:\/\//.test(to);
  const cls = inline
    ? cx("text-accent underline decoration-1 underline-offset-[3px] hover:text-accent-hover", className)
    : cx("ds inline-flex items-center gap-1 text-accent hover:text-accent-hover hover:underline underline-offset-[3px] touch:min-h-[44px]", className);
  const tail = !inline && (outside ? <Icon name="external" size={16} /> : <Icon name="chevronRight" size={16} />);
  if (outside || /^(mailto|tel):/.test(to)) {
    return (
      <a href={to} className={cls} onClick={onClick} {...(outside ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {children}
        {tail}
        {outside && <span className="sr-only">, opens in a new tab</span>}
      </a>
    );
  }
  return (
    <Link to={to} className={cls} onClick={onClick}>
      {children}
      {tail}
    </Link>
  );
}
