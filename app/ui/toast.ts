/**
 * Toast (docs/DESIGN.md §8.16): confirms something that just happened, and
 * offers Undo when it can be undone. One line of body ink (two at most),
 * one optional action on the right, no icon. Bottom centre of the content
 * column, 24px up, on desktop; on phones centred above the Ask button's row.
 * 5 seconds, 8 with an action, paused while hovered or focused. One at a
 * time: a new toast replaces the current one. Never for an error or for
 * anything the person must read later (that's a Banner).
 *
 *   toast({ message: "Refiled 48 transactions", action: { label: "Undo", run: undo } });
 */

import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { overlayRoot } from "./portal";
import { ToastRegion } from "./toast-region";
import { setToast, type ToastOptions } from "./toast-store";

export type { ToastOptions } from "./toast-store";

let root: Root | null = null;

/** Show a toast; it replaces any toast on screen. */
export function toast(o: ToastOptions): void {
  if (typeof document === "undefined") return;
  if (!root) {
    const host = document.createElement("div");
    overlayRoot().appendChild(host);
    root = createRoot(host);
    root.render(createElement(ToastRegion));
  }
  setToast(o);
}

/** Take the current toast down (a page leaving, say). */
export function dismissToast(): void {
  setToast(null);
}
