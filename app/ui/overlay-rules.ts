/**
 * The overlay manager's rules, kept free of React and the DOM so they're
 * tested on their own (tests/overlay.test.ts). app/ui/overlay.tsx applies
 * them to real elements. docs/DESIGN.md §8.19 and §14.4.
 *
 * - One stack. Opening pushes; Escape and scrim taps act on the top entry only.
 * - Scrims never stack: only the lowest modal entry draws one.
 * - Focus moves in by a fixed order of preference (pickInitialFocus), is
 *   trapped while a modal is on top (trapTarget), and goes back to the opener,
 *   or to <main> when the opener has gone (returnFocusTarget).
 * - Escape or the scrim on an overlay holding unsaved input asks "Discard
 *   changes?" first (needsDiscard).
 */

export type OverlayKind = "dialog" | "confirm" | "sheet" | "drawer" | "palette" | "menu" | "popover" | "select";

export type StackEntry = {
  id: number;
  kind: OverlayKind;
  /** Modal kinds have a scrim, make the app inert and lock the page's scroll. */
  modal: boolean;
};

/** Kinds that are modal on every device. Menus, popovers and selects are modal only as phone sheets. */
export function isModalKind(kind: OverlayKind, asSheet = false): boolean {
  if (kind === "menu" || kind === "popover" || kind === "select") return asSheet;
  return true;
}

/** An ordered stack of open overlays, with subscribers told of every change. */
export class OverlayStack<E extends StackEntry = StackEntry> {
  private list: E[] = [];
  private listeners = new Set<() => void>();

  get entries(): readonly E[] {
    return this.list;
  }
  push(entry: E): void {
    this.list = [...this.list.filter((e) => e.id !== entry.id), entry];
    this.emit();
  }
  remove(id: number): void {
    const before = this.list.length;
    this.list = this.list.filter((e) => e.id !== id);
    if (this.list.length !== before) this.emit();
  }
  top(): E | undefined {
    return this.list[this.list.length - 1];
  }
  isTop(id: number): boolean {
    return this.top()?.id === id;
  }
  has(id: number): boolean {
    return this.list.some((e) => e.id === id);
  }
  hasModal(): boolean {
    return this.list.some((e) => e.modal);
  }
  /** The one entry that draws a scrim: the lowest modal. An overlay opened over another adds none. */
  scrimOwner(): number | null {
    return this.list.find((e) => e.modal)?.id ?? null;
  }
  /** Whether `id` sits under another modal entry (it is behind a scrim, so it can't be the target of a tap). */
  isCovered(id: number): boolean {
    const i = this.list.findIndex((e) => e.id === id);
    return i >= 0 && this.list.slice(i + 1).some((e) => e.modal);
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of [...this.listeners]) fn();
  }
}

/** The places focus can land when an overlay opens, as the overlay found them. */
export type FocusCandidates<T> = {
  /** The caller's `initialFocus`. */
  initial?: T | null;
  /** The type-to-confirm field (§11.2: it takes focus when the dialog opens). */
  typeField?: T | null;
  /** Cancel, in a confirm. */
  cancel?: T | null;
  /** The narrowest choice, when the overlay offers a scope. */
  narrowest?: T | null;
  /** The first field of a form. */
  firstField?: T | null;
  /** In a menu or list: the checked item, else the first. */
  checkedItem?: T | null;
  firstItem?: T | null;
  /** The confirm's action button (a routine, default-tone confirm starts there). */
  primary?: T | null;
  /** The title, made focusable, as the last resort. */
  title?: T | null;
};

export type ConfirmTone = "default" | "commit" | "danger";

/**
 * Where focus goes on open (§8.19): the caller's choice; else the
 * type-to-confirm field; else Cancel for a binding, billed or destructive
 * confirm; else the narrowest scope; else a routine confirm's action; else
 * the first field; else the checked menu item or the first item; else the
 * title.
 */
export function pickInitialFocus<T>(c: FocusCandidates<T>, tone?: ConfirmTone): T | null {
  if (c.initial) return c.initial;
  if (c.typeField) return c.typeField;
  if ((tone === "danger" || tone === "commit") && c.cancel) return c.cancel;
  if (c.narrowest) return c.narrowest;
  if (tone === "default" && c.primary) return c.primary;
  if (c.firstField) return c.firstField;
  if (c.checkedItem) return c.checkedItem;
  if (c.firstItem) return c.firstItem;
  return c.title ?? null;
}

/**
 * Tab inside a trap. `list` is the overlay's tabbable elements in order,
 * `current` what has focus, `inside` whether that is within the overlay.
 * Returns the element to move to, or null to let the browser move as usual.
 */
export function trapTarget<T>(list: readonly T[], current: T | null, shift: boolean, inside: boolean): T | null {
  if (!list.length) return null;
  const first = list[0];
  const last = list[list.length - 1];
  if (!inside || current === null) return shift ? last : first;
  if (shift && current === first) return last;
  if (!shift && current === last) return first;
  if (!list.includes(current)) return shift ? last : first;
  return null;
}

/** Focus goes back to the opener; if it has left the page, to the fallback (<main>). */
export function returnFocusTarget<T>(opener: T | null | undefined, connected: (t: T) => boolean, fallback: T | null): T | null {
  if (opener && connected(opener)) return opener;
  return fallback;
}

/** Escape and scrim taps ask "Discard changes?" when the overlay holds unsaved input; Cancel and × that the person chose don't. */
export function needsDiscard(dirty: boolean, reason: "escape" | "scrim" | "close" | "action"): boolean {
  return dirty && (reason === "escape" || reason === "scrim" || reason === "close");
}

/** Curly quotes and apostrophes typed as straight ones, case and outer spaces ignored (§11.2). */
export function normalizeTyped(s: string): string {
  return s
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Whether what was typed matches the name to confirm. */
export function typedMatches(typed: string, target: string): boolean {
  const want = normalizeTyped(target);
  return want.length > 0 && normalizeTyped(typed) === want;
}

/** "Northwind, Alder, Birch, Cedar, Elm, and 4 more": a confirm's list of names, five then a count (§8.19). */
export function namesWithMore(names: readonly string[], shown = 5): { shown: string[]; more: number } {
  if (names.length <= shown + 1) return { shown: [...names], more: 0 };
  return { shown: names.slice(0, shown), more: names.length - shown };
}

/**
 * Where an anchored panel goes: below the trigger's start (or end) edge,
 * `gap` away; above when there isn't room below and there is more above;
 * kept `margin` inside the viewport. Never covers its trigger.
 */
export function placeAnchored(
  trigger: { top: number; bottom: number; left: number; right: number; width: number },
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
  o: { align?: "start" | "end"; gap?: number; margin?: number } = {},
): { left: number; top?: number; bottom?: number; above: boolean; maxHeight: number } {
  const gap = o.gap ?? 4;
  const margin = o.margin ?? 8;
  const below = viewport.height - trigger.bottom - gap - margin;
  const aboveRoom = trigger.top - gap - margin;
  const above = panel.height > below && aboveRoom > below;
  const raw = o.align === "end" ? trigger.right - panel.width : trigger.left;
  const left = Math.max(margin, Math.min(raw, viewport.width - panel.width - margin));
  const maxHeight = Math.max(120, above ? aboveRoom : below);
  return above ? { left, bottom: viewport.height - trigger.top + gap, above, maxHeight } : { left, top: trigger.bottom + gap, above, maxHeight };
}

/** Whether a released drag closes a bottom sheet: past a quarter of its height, or a downward flick. */
export function sheetDragCloses(dy: number, height: number, velocity: number): boolean {
  return dy > height / 4 || (dy > 12 && velocity > 0.5);
}

/** Type-ahead: the first label after `from` that starts with what was typed (wrapping), or -1. */
export function typeAhead(labels: readonly string[], typed: string, from: number): number {
  const t = typed.toLowerCase();
  if (!t) return -1;
  for (let k = 1; k <= labels.length; k++) {
    const i = (from + k) % labels.length;
    if (labels[i].toLowerCase().startsWith(t)) return i;
  }
  return -1;
}
