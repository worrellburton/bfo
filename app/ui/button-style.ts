/**
 * The Button's skin (docs/DESIGN.md §8.1), shared by Button, LinkButton and
 * the rare element that must look like one (a file input's label), and the
 * layout context a phone footer sets.
 */

import { createContext } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

/**
 * Set by a phone footer (a sheet's or a dialog's) so the buttons in it are
 * `lg` and full width without each call site saying so (§8.1 Groups).
 */
export const ButtonLayout = createContext<{ size?: ButtonSize; full?: boolean }>({});

const SIZE: Record<ButtonSize, string> = {
  sm: "h-(--control-sm) px-3 text-small font-medium",
  md: "h-(--control-md) px-4 text-body font-medium",
  lg: "h-(--control-lg) px-5 text-body font-medium",
};

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-ink text-ink-inverse enabled:hover:bg-primary-hover enabled:active:bg-primary-pressed disabled:bg-selected disabled:text-ink-disabled",
  secondary: "border border-edge text-ink enabled:hover:bg-hover enabled:active:bg-selected disabled:border-line disabled:text-ink-disabled",
  quiet: "text-ink-2 enabled:hover:bg-hover enabled:hover:text-ink enabled:active:bg-selected disabled:text-ink-disabled",
  danger: "bg-danger text-on-danger enabled:hover:bg-danger-hover enabled:active:bg-danger-hover disabled:bg-selected disabled:text-ink-disabled",
};

/** The classes a Button wears, for the rare element that must look like one (a file input's label). */
export function buttonClasses(o: { variant?: ButtonVariant; size?: ButtonSize; full?: boolean } = {}): string {
  return cx(
    "ds relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-control transition-colors duration-(--dur-1) ease-(--ease-standard) disabled:cursor-not-allowed",
    SIZE[o.size ?? "md"],
    VARIANT[o.variant ?? "secondary"],
    o.full && "w-full",
  );
}
