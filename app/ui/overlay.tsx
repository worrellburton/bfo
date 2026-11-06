/**
 * The overlay kinds (docs/DESIGN.md §8.19): Dialog, Sheet (bottom,
 * full-screen, right), Menu, Popover and the confirm's view. They register
 * with the manager (overlay-manager.ts) for the stack, focus, Escape, the
 * scrim, inert and the scroll lock; confirm() itself is in confirm.ts and
 * Select in select.tsx. Everything renders into <div id="overlays">.
 */

import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton } from "./button";
import { ButtonLayout } from "./button-style";
import { ChoiceTiles } from "./choice";
import { cx } from "./cx";
import { money } from "./format";
import { Icon, type IconName } from "./icon";
import { useNarrow, useTouch } from "./media";
import { stack, tabbables, useAnchor, useKeyboardInset, useOverlay, usePresence, type OverlayHandle } from "./overlay-manager";
import { sheetDragCloses, typeAhead, typedMatches, namesWithMore, type ConfirmTone } from "./overlay-rules";
import { overlayRoot } from "./portal";
import { chain, elementRef, mergeRefs } from "./refs";

/** The dimmed layer behind a modal; only the lowest modal draws it (scrims never stack). A tap acts on the top overlay. */
function Scrim({ visible, leaving }: { visible: boolean; leaving: boolean }) {
  return <div aria-hidden="true" className={cx("absolute inset-0", visible && "bg-scrim", visible && (leaving ? "ds-scrim-out" : "ds-scrim-in"))} onClick={() => stack.top()?.requestClose("scrim")} />;
}

// ── Frames: the shapes every kind is drawn in ────────────────────────────

export type FrameProps = {
  handle: OverlayHandle;
  leaving: boolean;
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  role?: "dialog" | "alertdialog";
  /** Hide the × (a confirm, where Cancel is the way out). */
  hideClose?: boolean;
};

function DialogFrame({ handle, leaving, title, description, footer, children, role = "dialog", hideClose, size = "md" }: FrameProps & { size?: "sm" | "md" | "lg" }) {
  return (
    <div className="ds fixed inset-0">
      <Scrim visible={handle.ownsScrim} leaving={leaving} />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
        <div
          ref={handle.panelRef}
          inert={handle.covered}
          role={role}
          aria-modal="true"
          aria-labelledby={handle.titleId}
          aria-describedby={description ? handle.descId : undefined}
          className={cx(
            "pointer-events-auto relative flex max-h-[min(85dvh,720px)] w-full flex-col rounded-dialog border border-line-strong bg-overlay text-body text-ink shadow-(--elevation-2) outline-none",
            size === "sm" ? "max-w-dialog-sm" : size === "lg" ? "max-w-dialog-lg" : "max-w-dialog-md",
            leaving ? "pointer-events-none ds-dialog-out" : "ds-dialog-in",
          )}
        >
          <div className="flex shrink-0 items-start gap-4 px-6 pt-6">
            <div className="min-w-0 flex-1">
              <h2 id={handle.titleId} data-overlay-title tabIndex={-1} className="text-title text-balance text-ink outline-none">
                {title}
              </h2>
              {description && (
                <div id={handle.descId} className="mt-1 text-body text-pretty text-ink-2">
                  {description}
                </div>
              )}
            </div>
            {!hideClose && <IconButton icon="x" label="Close" className="-mr-2 -mt-1" noTooltip onClick={() => handle.requestClose("close")} />}
          </div>
          {children ? <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-2">{children}</div> : null}
          {footer ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-6 pt-4 pb-6">{footer}</div> : <div className="h-6 shrink-0" />}
        </div>
      </div>
    </div>
  );
}

/** The phone's bottom sheet, shared with Select (not exported from the barrel). */
export function BottomSheetFrame({ handle, leaving, title, description, footer, children, role = "dialog", hideClose }: FrameProps) {
  const kb = useKeyboardInset(true);
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);
  const [dy, setDy] = useState(0);
  const [settling, setSettling] = useState(false);
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setSettling(false);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.y);
    setDy(drag.current.dy);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const h = handle.panelRef.current?.offsetHeight ?? 400;
    const velocity = d.dy / Math.max(1, performance.now() - d.t);
    if (sheetDragCloses(d.dy, h, velocity)) handle.requestClose("close");
    setSettling(true);
    setDy(0);
  };
  return (
    <div className="ds fixed inset-0">
      <Scrim visible={handle.ownsScrim} leaving={leaving} />
      <div
        ref={handle.panelRef}
        inert={handle.covered}
        role={role}
        aria-modal="true"
        aria-labelledby={handle.titleId}
        aria-describedby={description ? handle.descId : undefined}
        style={{
          bottom: kb.bottom,
          maxHeight: kb.height ? Math.round(kb.height * 0.9) : undefined,
          transform: dy ? `translateY(${dy}px)` : undefined,
          transition: settling ? "transform var(--dur-3) var(--ease-out)" : undefined,
        }}
        className={cx(
          "absolute inset-x-0 flex max-h-[90dvh] flex-col rounded-t-dialog border-x border-t border-line-strong bg-overlay text-body text-ink shadow-(--elevation-2) outline-none",
          leaving ? "pointer-events-none ds-sheet-out" : "ds-sheet-in",
        )}
      >
        <div className="shrink-0 touch-none select-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-line-strong" aria-hidden="true" />
          <div className="flex min-h-[52px] items-center gap-2 pr-2 pl-4">
            <h2 id={handle.titleId} data-overlay-title tabIndex={-1} className="min-w-0 flex-1 text-title text-balance text-ink outline-none">
              {title}
            </h2>
            {!hideClose && <IconButton icon="x" label="Close" noTooltip onClick={() => handle.requestClose("close")} />}
          </div>
        </div>
        {description && (
          <div id={handle.descId} className="shrink-0 px-4 pb-2 text-body text-pretty text-ink-2">
            {description}
          </div>
        )}
        {children ? <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div> : null}
        {footer ? (
          <ButtonLayout.Provider value={{ size: "lg", full: true }}>
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-line px-4 pt-4 pb-[calc(16px+env(safe-area-inset-bottom))]">{footer}</div>
          </ButtonLayout.Provider>
        ) : (
          <div className="h-[env(safe-area-inset-bottom)] shrink-0" />
        )}
      </div>
    </div>
  );
}

function FullSheetFrame({ handle, leaving, title, footer, children, action, description }: FrameProps & { action?: ReactNode }) {
  return (
    <div className="ds fixed inset-0">
      <div
        ref={handle.panelRef}
        inert={handle.covered}
        role="dialog"
        aria-modal="true"
        aria-labelledby={handle.titleId}
        aria-describedby={description ? handle.descId : undefined}
        className={cx("absolute inset-0 flex flex-col bg-overlay text-body text-ink outline-none", leaving ? "pointer-events-none ds-dialog-out" : "ds-full-in")}
      >
        <div className="grid min-h-[52px] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-line px-2 pt-[env(safe-area-inset-top)]">
          <div>
            <Button variant="quiet" size="sm" onClick={() => handle.requestClose("close")}>
              Cancel
            </Button>
          </div>
          <h2 id={handle.titleId} data-overlay-title tabIndex={-1} className="truncate text-center text-title text-ink outline-none">
            {title}
          </h2>
          <div className="flex justify-end">
            <ButtonLayout.Provider value={{ size: "sm" }}>{action}</ButtonLayout.Provider>
          </div>
        </div>
        {description && (
          <div id={handle.descId} className="shrink-0 px-4 pt-4 text-body text-ink-2">
            {description}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
        {footer && (
          <ButtonLayout.Provider value={{ size: "lg", full: true }}>
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-line px-4 pt-4 pb-[calc(16px+env(safe-area-inset-bottom))]">{footer}</div>
          </ButtonLayout.Provider>
        )}
        {!footer && <div className="h-[env(safe-area-inset-bottom)] shrink-0" />}
      </div>
    </div>
  );
}

function SideSheetFrame({ handle, leaving, title, description, footer, children, size = "md" }: FrameProps & { size?: "md" | "lg" }) {
  return (
    <div className="ds fixed inset-0">
      <Scrim visible={handle.ownsScrim} leaving={leaving} />
      <div
        ref={handle.panelRef}
        inert={handle.covered}
        role="dialog"
        aria-modal="true"
        aria-labelledby={handle.titleId}
        aria-describedby={description ? handle.descId : undefined}
        className={cx(
          "absolute inset-y-0 right-0 flex w-full flex-col border-l border-line-strong bg-overlay text-body text-ink shadow-(--elevation-2) outline-none",
          size === "lg" ? "max-w-[640px]" : "max-w-[480px]",
          leaving ? "pointer-events-none ds-side-out" : "ds-side-in",
        )}
      >
        <div className="flex min-h-[64px] shrink-0 items-center gap-3 border-b border-line pr-4 pl-6">
          <h2 id={handle.titleId} data-overlay-title tabIndex={-1} className="min-w-0 flex-1 truncate text-title text-ink outline-none">
            {title}
          </h2>
          <IconButton icon="x" label="Close" noTooltip onClick={() => handle.requestClose("close")} />
        </div>
        {description && (
          <div id={handle.descId} className="shrink-0 px-6 pt-4 text-body text-ink-2">
            {description}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

// ── Dialog and Sheet ─────────────────────────────────────────────────────

export type DialogProps = {
  open: boolean;
  /** Called for Escape, the scrim and × (after the dirty check). */
  onClose: () => void;
  /** Names the action or the record: "Edit owner: Alex Rivera". */
  title: string;
  /** One line under the title, in ink-2. */
  description?: ReactNode;
  /** sm 400 (confirms), md 520 (forms, the default), lg 640 (results, long content). */
  size?: "sm" | "md" | "lg";
  /** The buttons, secondary then primary. On a phone they stack, full width, primary on top. */
  footer?: ReactNode;
  /** Where focus goes on open; else the first field, else the title. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Unsaved input: Escape, the scrim and × ask "Discard changes?" first. */
  dirty?: boolean;
  children?: ReactNode;
};

/** A centred dialog from 640px up; a bottom sheet with the same content below that. */
export function Dialog({ open, onClose, title, description, size = "md", footer, initialFocus, dirty, children }: DialogProps) {
  const narrow = useNarrow();
  const { mounted, leaving } = usePresence(open, narrow ? 200 : 120);
  const handle = useOverlay({ open, onClose, kind: "dialog", initialFocus, dirty });
  if (!mounted) return null;
  const frame = { handle, leaving, title, description, footer, children };
  return createPortal(narrow ? <BottomSheetFrame {...frame} /> : <DialogFrame {...frame} size={size} />, overlayRoot());
}

export type SheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  /** bottom (default): rises from the bottom edge, drags to dismiss. full: covers the screen with Cancel, title and `action` in a top bar (composing, long forms). right: a side sheet on tablet and desktop (detail drawers); a bottom sheet on phones. */
  side?: "bottom" | "full" | "right";
  /** A right sheet's width: md 480 (default), lg 640. */
  size?: "md" | "lg";
  /** Sticky footer buttons, secondary then primary. */
  footer?: ReactNode;
  /** The full sheet's top-bar action (a primary sm Button). */
  action?: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  dirty?: boolean;
  children?: ReactNode;
};

export function Sheet({ open, onClose, title, description, side = "bottom", size = "md", footer, action, initialFocus, dirty, children }: SheetProps) {
  const narrow = useNarrow();
  const shape = side === "right" && narrow ? "bottom" : side;
  const { mounted, leaving } = usePresence(open, shape === "full" ? 120 : 200);
  const handle = useOverlay({ open, onClose, kind: "sheet", initialFocus, dirty });
  if (!mounted) return null;
  const frame = { handle, leaving, title, description, footer, children };
  return createPortal(
    shape === "full" ? <FullSheetFrame {...frame} action={action} /> : shape === "right" ? <SideSheetFrame {...frame} size={size} /> : <BottomSheetFrame {...frame} />,
    overlayRoot(),
  );
}

// ── Anchored panels: Menu and Popover ────────────────────────────────────

/** One entry in a Menu, a Card's "…" or a ListRow's "…". */
export type MenuItem =
  | {
      label: string;
      onSelect: () => void;
      /** A 16px icon; give every item in the group one, or none. */
      icon?: IconName;
      /** A trailing hint in caption ink-3 (a shortcut, a count). */
      hint?: string;
      /** Destroys or removes: negative text, last in the menu after a divider. */
      danger?: boolean;
      /** The chosen option: an accent check and aria-checked. */
      checked?: boolean;
      disabled?: boolean;
      /** Shown as the hint when disabled. */
      disabledReason?: string;
    }
  | { divider: true }
  | { group: string };

type ActionItem = Extract<MenuItem, { onSelect: () => void }>;
const isAction = (i: MenuItem): i is ActionItem => "onSelect" in i;

/** The rows of a menu, desktop or sheet. Arrow keys, Home, End and type-ahead move among enabled items. */
function MenuItems({ items, sheet, onChoose }: { items: MenuItem[]; sheet: boolean; onChoose: (item: ActionItem) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  // Icons only where a group's items carry them.
  const groups: MenuItem[][] = [[]];
  for (const it of items) {
    if ("divider" in it || "group" in it) groups.push([]);
    groups[groups.length - 1].push(it);
  }
  const iconsIn = new Set(groups.filter((g) => g.some((i) => isAction(i) && i.icon)).flat());
  const anyChecked = items.some((i) => isAction(i) && i.checked !== undefined);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const nodes = [...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const i = nodes.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = i < 0 ? 0 : (i + 1) % nodes.length;
    else if (e.key === "ArrowUp") next = i <= 0 ? nodes.length - 1 : i - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = nodes.length - 1;
    else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key, at: now };
      next = typeAhead(
        nodes.map((n) => n.dataset.label ?? n.textContent ?? ""),
        typed.current.text,
        typed.current.text.length > 1 ? Math.max(0, i - 1) : i,
      );
    } else return;
    e.preventDefault();
    if (next >= 0) nodes[next]?.focus();
  };

  return (
    <div ref={ref} onKeyDown={onKeyDown} className={sheet ? "py-1" : ""}>
      {items.map((it, k) => {
        if ("divider" in it) return <div key={k} role="separator" className="my-1 h-px bg-line" />;
        if ("group" in it)
          return (
            <div key={k} role="presentation" className={cx("flex items-center px-2 text-caption font-medium text-ink-2", sheet ? "h-[32px]" : "h-[28px]")}>
              {it.group}
            </div>
          );
        const off = !!it.disabled;
        return (
          <button
            key={k}
            type="button"
            role={anyChecked ? "menuitemradio" : "menuitem"}
            aria-checked={anyChecked ? !!it.checked : undefined}
            aria-disabled={off || undefined}
            tabIndex={-1}
            data-label={it.label}
            onClick={() => !off && onChoose(it)}
            className={cx(
              "flex w-full items-center gap-2 rounded-control px-2 text-left outline-offset-[-2px]!",
              sheet ? "min-h-[48px] text-body" : "min-h-(--row-menu) text-small touch:text-body",
              off ? "cursor-not-allowed text-ink-disabled" : cx("cursor-pointer hover:bg-hover focus:bg-hover", it.danger ? "text-negative" : "text-ink"),
            )}
          >
            {iconsIn.has(it) && (
              <span className={cx("inline-flex", off ? "" : it.danger ? "text-negative" : "text-ink-2")}>{it.icon ? <Icon name={it.icon} /> : <span className="size-(--icon)" />}</span>
            )}
            <span className="min-w-0 flex-1 py-[6px]">{it.label}</span>
            {(off ? (it.disabledReason ?? it.hint) : it.hint) && <span className="shrink-0 text-caption text-ink-3">{off ? (it.disabledReason ?? it.hint) : it.hint}</span>}
            {it.checked && <Icon name="check" className="text-accent" />}
          </button>
        );
      })}
    </div>
  );
}

type TriggerProps = {
  onClick?: (e: React.MouseEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
};

/**
 * A menu of commands on its trigger (a Button or an IconButton). Desktop: an
 * anchored panel, 200–320px, no scrim. Touch: a bottom sheet titled with
 * `label`, 48px rows. Choosing an item closes the menu first, so a confirm
 * the item opens returns focus to the trigger.
 */
export function Menu({
  trigger,
  items,
  label,
  align = "start",
}: {
  trigger: ReactElement;
  items: MenuItem[];
  /** The menu's name, and the sheet's title on touch. */ label: string;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const touch = useTouch();
  const triggerRef = useRef<HTMLElement | null>(null);
  const menuId = useId();
  const { mounted, leaving } = usePresence(open, touch ? 200 : 120);
  const handle = useOverlay({ open, onClose: () => setOpen(false), kind: "menu", modal: touch, trigger: triggerRef });
  const pos = useAnchor(open && !touch, triggerRef, handle.panelRef, { align });

  const choose = (item: ActionItem) => {
    handle.requestClose("action");
    triggerRef.current?.focus({ preventScroll: true });
    setOpen(false);
    item.onSelect();
  };
  const p = trigger.props as TriggerProps;
  const t = cloneElement(trigger as ReactElement<TriggerProps & Record<string, unknown>>, {
    ref: mergeRefs(elementRef(trigger), (el: HTMLElement | null) => {
      triggerRef.current = el;
    }),
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-controls": open ? menuId : undefined,
    onClick: chain(p.onClick, () => setOpen((v) => !v)),
    onKeyDown: chain(p.onKeyDown, (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
      }
    }),
  });

  let panel: ReactNode = null;
  if (mounted) {
    panel = touch ? (
      <BottomSheetFrame handle={handle} leaving={leaving} title={label}>
        <div id={menuId} role="menu" aria-label={label}>
          <MenuItems items={items} sheet onChoose={choose} />
        </div>
      </BottomSheetFrame>
    ) : (
      <div
        ref={handle.panelRef}
        id={menuId}
        role="menu"
        aria-label={label}
        style={pos ? { left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight } : { left: -9999, top: 0 }}
        className={cx(
          "ds fixed max-w-[320px] min-w-[200px] overflow-y-auto rounded-card border border-line-strong bg-overlay p-1 text-ink shadow-(--elevation-2)",
          leaving ? "pointer-events-none ds-menu-out" : pos?.above ? "ds-menu-in-up" : "ds-menu-in",
        )}
      >
        <MenuItems items={items} sheet={false} onChoose={choose} />
      </div>
    );
  }
  return (
    <>
      {t}
      {panel && createPortal(panel, overlayRoot())}
    </>
  );
}

/**
 * Anchored content that isn't a list of commands (a filter panel, a date
 * picker, an explanation): the Menu's surface, 280–400px wide, 16px
 * padding. Focus moves to its first control if it has one, else stays on
 * the trigger. Escape and an outside press close it. On touch: a bottom
 * sheet titled with `label`.
 */
export function Popover({
  trigger,
  label,
  children,
  width = 320,
  open: controlled,
  onOpenChange,
  align = "start",
}: {
  trigger: ReactElement;
  /** Names the popover; the sheet's title on touch. */
  label: string;
  children: ReactNode;
  /** 280–400; default 320. */
  width?: number;
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "end";
}) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const setOpen = (v: boolean) => {
    if (controlled === undefined) setOwn(v);
    onOpenChange?.(v);
  };
  const touch = useTouch();
  const triggerRef = useRef<HTMLElement | null>(null);
  const popId = useId();
  const { mounted, leaving } = usePresence(open, touch ? 200 : 120);
  const [hasControl, setHasControl] = useState(true);
  const handle = useOverlay({ open, onClose: () => setOpen(false), kind: "popover", modal: touch, trigger: triggerRef, moveFocus: touch || hasControl });
  const pos = useAnchor(open && !touch, triggerRef, handle.panelRef, { align });
  useLayoutEffect(() => {
    if (open) setHasControl(!!handle.panelRef.current && tabbables(handle.panelRef.current).length > 0);
  }, [open, handle.panelRef]);

  const p = trigger.props as TriggerProps;
  const t = cloneElement(trigger as ReactElement<TriggerProps & Record<string, unknown>>, {
    ref: mergeRefs(elementRef(trigger), (el: HTMLElement | null) => {
      triggerRef.current = el;
    }),
    "aria-haspopup": "dialog",
    "aria-expanded": open,
    "aria-controls": open ? popId : undefined,
    onClick: chain(p.onClick, () => setOpen(!open)),
  });
  const w = Math.min(400, Math.max(280, width));
  let panel: ReactNode = null;
  if (mounted) {
    panel = touch ? (
      <BottomSheetFrame handle={handle} leaving={leaving} title={label}>
        <div id={popId}>{children}</div>
      </BottomSheetFrame>
    ) : (
      <div
        ref={handle.panelRef}
        id={popId}
        role="dialog"
        aria-label={label}
        style={pos ? { left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight, width: w } : { left: -9999, top: 0, width: w }}
        className={cx(
          "ds fixed max-w-[calc(100vw-16px)] overflow-y-auto rounded-card border border-line-strong bg-overlay p-4 text-body text-ink shadow-(--elevation-2)",
          leaving ? "pointer-events-none ds-menu-out" : pos?.above ? "ds-menu-in-up" : "ds-menu-in",
        )}
      >
        {children}
      </div>
    );
  }
  return (
    <>
      {t}
      {panel && createPortal(panel, overlayRoot())}
    </>
  );
}

// ── confirm() ────────────────────────────────────────────────────────────

export type ConfirmOptions = {
  /** The question, naming the action and the kind of thing: "Delete this rule?" */
  title: string;
  /** The thing, on its own line: its name, and what tells it apart ("Created Mar 3 · matches 48 transactions"); or several names, one per line. */
  object?: { name: string; detail?: string } | { names: string[] };
  /** One or two sentences of consequence. */
  message?: ReactNode;
  /** Up to five facts, as a list. */
  details?: ReactNode[];
  /** A cost, as a receipt (§11.3): cents, tabular, the total in 600. */
  receipt?: { lines: { label: string; cents: number; estimate?: boolean }[]; mode?: "live" | "test" };
  /** Choices of reach, narrowest first (preselected): "Only this transaction" / "All 48 from this vendor". */
  scope?: { label: string; options: { value: string; title: string; description?: string }[] };
  /** Required: the verb and object, "Delete rule", "File for $129.00". Never OK, Yes or Confirm. */
  confirmLabel: string;
  /** "Cancel", unless the dialog is about stopping something ("Keep editing"). */
  cancelLabel?: string;
  /** default: routine (focus on the action). commit: binding, billed or sent out (focus on Cancel). danger: destroys (red button, focus on Cancel). */
  tone?: ConfirmTone;
  /** Appends "This can't be undone." */
  irreversible?: boolean;
  /** Typed confirmation (§11.2): the name as shown, or a count. */
  typeToConfirm?: string;
  /** A safer second action, offered as a second button ("Archive instead"). */
  alternative?: { label: string; value: string };
  /** For consent-like confirms the server records: sent back with the result. */
  version?: string;
  /** Which button takes focus, overriding the tone's rule. */
  focus?: "cancel" | "confirm";
  /** One button only: something to acknowledge, not a choice (the legacy alertDialog). */
  acknowledge?: boolean;
};

export type ConfirmResult = false | true | { scope?: string; alternative?: string; version?: string };

/** The confirm's body and buttons, for both confirm() and a component that must stay mounted (books' ConfirmDialog). */
export function ConfirmView({ open, options: o, onResult }: { open: boolean; options: ConfirmOptions; onResult: (r: ConfirmResult) => void }) {
  const [typed, setTyped] = useState("");
  const [scope, setScope] = useState<string | null>(o.scope?.options[0]?.value ?? null);
  const narrow = useNarrow();
  const tone = o.tone ?? "default";
  const needs = o.typeToConfirm?.trim();
  const ready = !needs || typedMatches(typed, needs);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const { mounted, leaving } = usePresence(open, narrow ? 200 : 120);
  const handle = useOverlay({
    open,
    onClose: () => onResult(false),
    kind: "confirm",
    tone,
    initialFocus: o.focus === "cancel" ? cancelRef : o.focus === "confirm" ? confirmRef : undefined,
  });
  const typeId = useId();
  if (!mounted) return null;

  const result = (alternative?: string): ConfirmResult => {
    if (!o.scope && !alternative && !o.version) return true;
    return { ...(o.scope && scope ? { scope } : {}), ...(alternative ? { alternative } : {}), ...(o.version ? { version: o.version } : {}) };
  };
  const total = o.receipt?.lines.reduce((s, l) => s + l.cents, 0) ?? 0;
  const estimate = o.receipt?.lines.some((l) => l.estimate);
  const names = o.object && "names" in o.object ? namesWithMore(o.object.names) : null;

  const body = (
    <div className="flex flex-col gap-4 text-pretty">
      {o.object &&
        ("name" in o.object ? (
          <div>
            <p className="text-body font-medium break-words text-ink">{o.object.name}</p>
            {o.object.detail && <p className="text-small text-ink-2">{o.object.detail}</p>}
          </div>
        ) : (
          names && (
            <ul className="text-body font-medium text-ink">
              {names.shown.map((n) => (
                <li key={n} className="break-words">
                  {n}
                </li>
              ))}
              {names.more > 0 && <li className="font-normal text-ink-2">and {names.more} more</li>}
            </ul>
          )
        ))}
      {(o.message || o.irreversible) && (
        <div className="text-body text-ink-2">
          {o.message}
          {o.message && o.irreversible ? " " : ""}
          {o.irreversible && "This can’t be undone."}
        </div>
      )}
      {o.details && o.details.length > 0 && (
        <ul className="flex flex-col gap-1 text-body text-ink-2">
          {o.details.map((d, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden="true" className="mt-[9px] size-1 shrink-0 rounded-full bg-ink-3" />
              <span className="min-w-0">{d}</span>
            </li>
          ))}
        </ul>
      )}
      {o.receipt && (
        <div className="rounded-card bg-sunken px-4 py-3 tabular-nums">
          {o.receipt.lines.map((l, i) => (
            <div key={i} className="flex justify-between gap-4 py-[2px] text-body text-ink">
              <span className="text-ink-2">{l.label}</span>
              <span>
                {l.estimate ? "About " : ""}
                {money(l.cents / 100)}
              </span>
            </div>
          ))}
          <div className="mt-2 flex justify-between gap-4 border-t border-line pt-2 text-body font-semibold text-ink">
            <span>Total</span>
            <span>
              {estimate ? "About " : ""}
              {money(total / 100)}
            </span>
          </div>
          {o.receipt.mode === "test" ? (
            <p className="mt-2 flex items-center gap-2 text-small text-ink">
              <span className="text-info">
                <Icon name="info" size={16} />
              </span>
              Test mode: nothing is charged
            </p>
          ) : o.receipt.mode === "live" ? (
            <p className="mt-2 text-small text-ink-2">Live: the card on file is charged</p>
          ) : null}
        </div>
      )}
      {o.scope && (
        <div data-scope>
          <ChoiceTiles label={o.scope.label} value={scope} onChange={setScope} options={o.scope.options} stacked />
        </div>
      )}
      {needs && (
        <div className="flex flex-col gap-[6px]">
          <label htmlFor={typeId} className="text-small text-ink">
            Type <span className="font-semibold">{needs}</span> to confirm
          </label>
          <div className="relative">
            <input
              id={typeId}
              data-focus="type"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && ready) onResult(result());
              }}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              style={{ fontSize: 16 }}
              className="h-(--control-md) w-full rounded-control border border-edge bg-field pr-10 pl-3 text-ink placeholder:text-ink-3"
            />
            {ready && (
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-positive" aria-label="Matches">
                <Icon name="check" size={16} />
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
  const hasBody = !!(o.object || o.message || o.irreversible || o.details?.length || o.receipt || o.scope || needs);
  const footer = (
    <>
      {!o.acknowledge && (
        <Button ref={cancelRef} data-focus="cancel" onClick={() => onResult(false)}>
          {o.cancelLabel ?? "Cancel"}
        </Button>
      )}
      {o.alternative && <Button onClick={() => onResult(result(o.alternative!.value))}>{o.alternative.label}</Button>}
      <Button
        ref={confirmRef}
        data-focus="primary"
        variant={tone === "danger" ? "danger" : "primary"}
        disabled={!ready}
        disabledReason={needs && !ready ? `Type ${needs} to confirm` : undefined}
        onClick={() => onResult(result())}
      >
        {o.confirmLabel}
      </Button>
    </>
  );
  const frame = { handle, leaving, title: o.title, footer, role: "alertdialog" as const, hideClose: true, children: hasBody ? body : undefined };
  return createPortal(narrow ? <BottomSheetFrame {...frame} /> : <DialogFrame {...frame} size="sm" />, overlayRoot());
}

/** The host confirm() renders into its own root: answers at once, leaves after the exit has played. */
export function ConfirmHost({ options, onAnswer, onGone }: { options: ConfirmOptions; onAnswer: (r: ConfirmResult) => void; onGone: () => void }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (open) return;
    const t = window.setTimeout(onGone, 260);
    return () => window.clearTimeout(t);
  }, [open, onGone]);
  return (
    <ConfirmView
      open={open}
      options={options}
      onResult={(r) => {
        if (!open) return;
        setOpen(false);
        onAnswer(r);
      }}
    />
  );
}
