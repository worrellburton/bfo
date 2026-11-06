import type { ReactNode } from "react";
import { confirm, type ConfirmOptions as UiConfirmOptions } from "./ui";

/**
 * The app's confirm and alert, for the callers written before the design
 * system: `confirmDialog(...)` and `alertDialog(...)` keep their signatures
 * and now render the system's confirm (app/ui confirm(); docs/DESIGN.md
 * §8.19, §11). New code calls `confirm()` from app/ui directly.
 *
 *   if (!(await confirmDialog({ title: "Delete this entity?", tone: "danger", confirmLabel: "Delete entity" }))) return;
 *
 * Mapped: `requireText` is typed confirmation; `details` the list of facts;
 * `tone` "danger" the red button with focus on Cancel. Added (optional): the
 * object line, "This can't be undone.", a receipt, the commit tone, and
 * which button takes focus.
 */

type ConfirmOptions = {
  /** The question: "Delete this rule?" */
  title: string;
  /** One or two sentences of consequence. */
  message?: ReactNode;
  /** Facts as a list: what will happen. */
  details?: ReactNode[];
  /** The verb and object: "Delete rule". Never OK, Yes or Confirm. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger: destroys (red, focus on Cancel). commit: binding, billed or sent out (focus on Cancel). default: routine. */
  tone?: "danger" | "default" | "commit";
  /** Make the person type this (the thing's name, or a count) before confirming. */
  requireText?: string;
  /** Alert mode: one button that closes it. */
  alert?: boolean;
  /** The thing, on its own line, with what tells it apart. */
  object?: UiConfirmOptions["object"];
  /** Appends "This can't be undone." */
  irreversible?: boolean;
  /** A cost, as a receipt. */
  receipt?: UiConfirmOptions["receipt"];
  /** Which button takes focus, overriding the tone's rule. */
  focus?: "cancel" | "confirm";
};

/** Show the dialog; resolves true when confirmed. Safe to call from any handler. */
export async function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  const danger = opts.tone === "danger";
  const result = await confirm({
    title: opts.title,
    message: opts.message,
    details: opts.details,
    object: opts.object,
    irreversible: opts.irreversible,
    receipt: opts.receipt,
    typeToConfirm: opts.requireText,
    tone: opts.alert ? "default" : (opts.tone ?? "default"),
    focus: opts.focus,
    confirmLabel: opts.confirmLabel ?? (opts.alert ? "Close" : danger ? "Delete" : "Continue"),
    cancelLabel: opts.alert ? undefined : opts.cancelLabel,
    acknowledge: opts.alert,
  });
  return result !== false;
}

/** An in-app alert: one message, one button that closes it. */
export function alertDialog(title: string, message?: ReactNode): Promise<void> {
  return confirmDialog({ title, message, alert: true }).then(() => undefined);
}
