/**
 * confirm() (docs/DESIGN.md §8.19, §11): ask before anything that destroys,
 * binds, bills or sends. It renders ConfirmView into its own root inside
 * #overlays, so any handler can await it.
 */

import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmHost, type ConfirmOptions, type ConfirmResult } from "./overlay";
import { overlayRoot } from "./portal";

/**
 * Ask before anything that destroys, binds, bills or sends (§8.19, §11).
 * Resolves false for Cancel, Escape or the scrim; true for the action; or,
 * when the dialog offers a scope, an alternative or a version, an object
 * saying which.
 *
 *   if (!(await confirm({ title: "Delete this rule?", object: { name: rule.match }, confirmLabel: "Delete rule", tone: "danger", irreversible: true }))) return;
 */
export function confirm(o: ConfirmOptions): Promise<ConfirmResult> {
  if (typeof document === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const host = document.createElement("div");
    overlayRoot().appendChild(host);
    const root = createRoot(host);
    const gone = () => {
      root.unmount();
      host.remove();
    };
    root.render(createElement(ConfirmHost, { options: o, onAnswer: resolve, onGone: gone }));
  });
}
