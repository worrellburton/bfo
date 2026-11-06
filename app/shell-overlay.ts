/**
 * The ARIA the shell's own overlays carry: the command palette, the drawer
 * and the App lock cover. They register with app/ui's overlay manager
 * (useOverlay) for the stack, focus, Escape, inert and the scroll lock, as
 * docs/DESIGN.md §14.4 says custom overlays do; only their shapes are their
 * own. This is the one place outside app/ui that names a modal, so
 * check:design reports it here and nowhere else in the shell; it belongs in
 * app/ui (a request to foundation).
 */

/** A modal dialog's role and state, named by `label`. */
export function modalAria(label: string) {
  return { role: "dialog", "aria-modal": true, "aria-label": label } as const;
}

/** Any modal on the page, including a legacy page's own (Mail's composer): global keys stand aside for them. */
export function modalOpen(): boolean {
  return document.documentElement.dataset.overlay === "modal" || !!document.querySelector('[aria-modal="true"]');
}

/** A modal other than the palette (⌘K toggles the palette, but never jumps away from another dialog). */
export function otherModalOpen(): boolean {
  return [...document.querySelectorAll('[aria-modal="true"]')].some((el) => el.getAttribute("aria-label") !== "Jump to");
}
