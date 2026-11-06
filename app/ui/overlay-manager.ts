/**
 * The overlay manager (docs/DESIGN.md §8.19, §14.4): one stack for every
 * modal and popover, applied to the page. The rules themselves are pure and
 * tested (overlay-rules.ts); this file applies them to the DOM, and the
 * components in overlay.tsx and select.tsx register through useOverlay().
 *
 * - Everything portals into <div id="overlays"> at the end of <body>.
 * - Escape and scrim taps act on the top entry only; scrims never stack.
 * - While a modal is open: <html data-overlay="modal">, everything else in
 *   <body> is inert, and the page's scroll is locked without shifting it
 *   (scrollbar-gutter: stable). The Ask button and floating bars hide from
 *   app.css.
 * - Focus moves in (pickInitialFocus), is trapped while a modal is on top,
 *   and returns to the opener, or to <main> when the opener has gone.
 * - Escape, the scrim or × on an overlay holding unsaved input (`dirty`)
 *   ask "Discard changes?" first.
 * - On touch, <html data-keyboard="open"> while the on-screen keyboard is up.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { confirm } from "./confirm";
import { needsDiscard, OverlayStack, pickInitialFocus, placeAnchored, returnFocusTarget, trapTarget, isModalKind, type ConfirmTone, type OverlayKind, type StackEntry } from "./overlay-rules";

// ── The manager ──────────────────────────────────────────────────────────

export type CloseReason = "escape" | "scrim" | "close" | "action" | "outside" | "tab";

type Entry = StackEntry & {
  panel: () => HTMLElement | null;
  trigger: () => HTMLElement | null;
  requestClose: (reason: CloseReason) => void;
};

/** The one stack. Exported for the scrim, which acts on whatever is on top. */
export const stack = new OverlayStack<Entry>();
let nextId = 1;
let installed = false;
let locked: { overflow: string; gutter: string; inerted: HTMLElement[] } | null = null;

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** The elements Tab can reach inside `root`, in order. */
export function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => !el.closest("[inert]") && el.getClientRects().length > 0);
}

/** Lock or release the page while a modal is open (§14.4). */
function syncDocument() {
  const html = document.documentElement;
  const modal = stack.hasModal();
  if (stack.top()) html.dataset.overlay = modal ? "modal" : "popover";
  else delete html.dataset.overlay;
  if (modal && !locked) {
    const root = document.querySelector("body > [data-overlay-root]");
    const inerted: HTMLElement[] = [];
    for (const el of [...document.body.children] as HTMLElement[]) {
      if (el === root || el.inert || el.tagName === "SCRIPT") continue;
      el.inert = true;
      inerted.push(el);
    }
    locked = { overflow: html.style.overflow, gutter: html.style.scrollbarGutter, inerted };
    html.style.scrollbarGutter = "stable";
    html.style.overflow = "hidden";
  } else if (!modal && locked) {
    for (const el of locked.inerted) el.inert = false;
    html.style.overflow = locked.overflow;
    html.style.scrollbarGutter = locked.gutter;
    locked = null;
  }
}

function onKeyDown(e: KeyboardEvent) {
  const top = stack.top();
  if (!top || e.isComposing) return;
  const panel = top.panel();
  if (!panel) return;
  const active = document.activeElement as HTMLElement | null;
  const inside = !!active && panel.contains(active);
  const onTrigger = !!active && !!top.trigger()?.contains(active);
  const neutral = !active || active === document.body || active === document.documentElement;
  if (e.key === "Escape") {
    // A search field with text clears first (§8.3); the next Escape closes.
    if (active instanceof HTMLInputElement && active.type === "search" && active.value) return;
    // Focus in some other layer (a legacy popup opened above this one) handles its own Escape.
    if (!inside && !onTrigger && !neutral && !document.querySelector("body > [data-overlay-root]")?.contains(active)) return;
    e.preventDefault();
    e.stopPropagation();
    top.requestClose("escape");
    return;
  }
  if (e.key !== "Tab") return;
  if (!top.modal) {
    // A menu or listbox closes on Tab: focus goes back to its trigger now, and Tab moves on from there.
    if (inside && (top.kind === "menu" || top.kind === "select")) {
      top.trigger()?.focus({ preventScroll: true });
      top.requestClose("tab");
    }
    return;
  }
  e.stopPropagation();
  const target = trapTarget(tabbables(panel), active, e.shiftKey, inside);
  if (target) {
    e.preventDefault();
    target.focus();
  }
}

/** A press outside a non-modal overlay closes it (and any non-modal ones above it). */
function onPointerDown(e: PointerEvent) {
  const t = e.target as Node | null;
  if (!t) return;
  for (let i = stack.entries.length - 1; i >= 0; i--) {
    const entry = stack.entries[i];
    if (entry.modal) return;
    if (entry.panel()?.contains(t) || entry.trigger()?.contains(t)) return;
    entry.requestClose("outside");
  }
}

/** On touch, the on-screen keyboard is "up" when the visual viewport is much shorter than the layout one. */
function onViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const up = window.innerHeight - vv.height > 140 && window.matchMedia("(pointer: coarse)").matches;
  if (up) document.documentElement.dataset.keyboard = "open";
  else delete document.documentElement.dataset.keyboard;
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  window.visualViewport?.addEventListener("resize", onViewport);
  stack.subscribe(syncDocument);
}

function useStackVersion() {
  return useSyncExternalStore(
    (fn) => stack.subscribe(fn),
    () => stack.entries,
    () => stack.entries,
  );
}

/** Mounted while open and for `ms` after, so the exit can play (§7.2). */
export function usePresence(open: boolean, ms: number): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(
      () => {
        setMounted(false);
        setLeaving(false);
      },
      reduced ? 100 : ms,
    );
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return { mounted: mounted || open, leaving: leaving && !open };
}

export type UseOverlayOptions = {
  open: boolean;
  onClose: () => void;
  kind: OverlayKind;
  /** Modal kinds get a scrim, inert the app and lock scroll. Defaults by kind. */
  modal?: boolean;
  /** Where focus goes on open; else the manager's order (§8.19). */
  initialFocus?: RefObject<HTMLElement | null>;
  /** A confirm's tone: danger and commit start on Cancel. */
  tone?: ConfirmTone;
  /** Unsaved input: Escape, the scrim and × ask "Discard changes?" first. */
  dirty?: boolean;
  /** The element that opened it (menus, popovers): presses on it don't count as outside. */
  trigger?: RefObject<HTMLElement | null>;
  /** Move focus in on open (default true). A popover with nothing to focus leaves it on the trigger. */
  moveFocus?: boolean;
};

export type OverlayHandle = {
  panelRef: RefObject<HTMLDivElement | null>;
  titleId: string;
  descId: string;
  /** This entry draws the scrim (the lowest open modal). */
  ownsScrim: boolean;
  /** Something modal sits above this entry. */
  covered: boolean;
  /** Close, with the dirty check for escape, scrim and close. */
  requestClose: (reason: CloseReason) => void;
};

/** Registers an overlay with the manager while `open`. */
export function useOverlay(o: UseOverlayOptions): OverlayHandle {
  const panelRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);
  if (!idRef.current) idRef.current = nextId++;
  const id = idRef.current;
  const base = useId();
  const titleId = `${base}-title`;
  const descId = `${base}-desc`;
  const latest = useRef(o);
  latest.current = o;
  const opener = useRef<HTMLElement | null>(null);
  const skipReturn = useRef(false);
  const modal = o.modal ?? isModalKind(o.kind);

  const requestClose = useCallback((reason: CloseReason) => {
    const cur = latest.current;
    // A press elsewhere puts focus where it landed; Tab has already moved it on.
    skipReturn.current = reason === "outside" || reason === "tab";
    if (needsDiscard(!!cur.dirty, reason === "outside" ? "scrim" : reason === "tab" ? "action" : reason)) {
      void confirm({ title: "Discard changes?", message: "What you entered here hasn't been saved.", confirmLabel: "Discard changes", cancelLabel: "Keep editing", tone: "danger" }).then((ok) => {
        if (ok) latest.current.onClose();
      });
      return;
    }
    cur.onClose();
  }, []);

  useLayoutEffect(() => {
    if (!o.open) return;
    install();
    opener.current = latest.current.trigger?.current ?? (document.activeElement as HTMLElement | null);
    skipReturn.current = false;
    stack.push({ id, kind: o.kind, modal, panel: () => panelRef.current, trigger: () => latest.current.trigger?.current ?? null, requestClose });
    return () => {
      const wasTop = stack.isTop(id);
      stack.remove(id);
      if (skipReturn.current || !wasTop) return;
      const back = returnFocusTarget(opener.current, (el) => el.isConnected && !el.closest("[inert]"), document.getElementById("main"));
      back?.focus({ preventScroll: true });
    };
  }, [o.open, id, modal, o.kind, requestClose]);

  // Focus in, once the panel is in the DOM.
  useLayoutEffect(() => {
    if (!o.open || o.moveFocus === false) return;
    const panel = panelRef.current;
    if (!panel) return;
    const q = <T extends HTMLElement>(sel: string) => panel.querySelector<T>(sel);
    const firstField = [...panel.querySelectorAll<HTMLElement>('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [data-field]:not([disabled])')].find(
      (el) => !el.closest("[data-no-autofocus]"),
    );
    const firstControl = latest.current.kind === "popover" ? tabbables(panel)[0] : undefined;
    const target = pickInitialFocus<HTMLElement>(
      {
        initial: o.initialFocus?.current,
        typeField: q('[data-focus="type"]'),
        cancel: q('[data-focus="cancel"]'),
        narrowest: q('[data-scope] [aria-checked="true"]'),
        primary: q('[data-focus="primary"]:not([disabled])'),
        firstField: firstField ?? firstControl,
        checkedItem: q('[role="menuitemradio"][aria-checked="true"], [role="option"][aria-selected="true"]'),
        firstItem: q('[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemradio"]:not([aria-disabled="true"]), [role="option"]:not([aria-disabled="true"])'),
        title: q("[data-overlay-title]") ?? panel,
      },
      o.tone,
    );
    if (target && target.tabIndex < 0 && !target.hasAttribute("tabindex")) target.tabIndex = -1;
    target?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.open]);

  const entries = useStackVersion();
  void entries;
  return { panelRef, titleId, descId, ownsScrim: stack.scrimOwner() === id, covered: stack.isCovered(id), requestClose };
}

/** Follows the visual viewport, so a bottom sheet's footer rides above the on-screen keyboard. */
export function useKeyboardInset(on: boolean): { bottom: number; height: number | null } {
  const [v, setV] = useState<{ bottom: number; height: number | null }>({ bottom: 0, height: null });
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!on || !vv) return;
    const sync = () => setV({ bottom: Math.max(0, window.innerHeight - vv.height - vv.offsetTop), height: vv.height });
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, [on]);
  return v;
}

/** Positions a panel under its trigger, flipping above when there's no room (§8.19 Menu). */
export function useAnchor(open: boolean, trigger: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>, o: { align?: "start" | "end"; matchWidth?: boolean; minWidth?: number } = {}) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; above: boolean; maxHeight: number; minWidth?: number; maxWidth?: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const t = trigger.current;
      const p = panel.current;
      if (!t || !p) return;
      const r = t.getBoundingClientRect();
      // A listbox is at least as wide as its trigger (200px at least) and fits its content up to 320px (§8.4, §8.19).
      const minWidth = o.matchWidth ? Math.max(r.width, o.minWidth ?? 200) : undefined;
      const maxWidth = o.matchWidth ? Math.min(window.innerWidth - 16, Math.max(320, r.width)) : undefined;
      if (minWidth !== undefined) {
        p.style.minWidth = `${minWidth}px`;
        p.style.maxWidth = `${maxWidth}px`;
      }
      const size = { width: p.offsetWidth, height: p.scrollHeight };
      const at = placeAnchored(r, size, { width: window.innerWidth, height: window.innerHeight }, { align: o.align });
      setPos({ ...at, minWidth, maxWidth });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, trigger, panel, o.align, o.matchWidth, o.minWidth]);
  return pos;
}
