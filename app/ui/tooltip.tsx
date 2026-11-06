/**
 * Tooltip (docs/DESIGN.md §8.17): desktop only, after 500ms of hover or at
 * once on keyboard focus. It names or explains; it never holds an action or
 * anything needed to finish a task. The trigger keeps its own accessible
 * name (an IconButton's label), so the tip itself is hidden from screen
 * readers. On touch the child renders alone.
 */

import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";
import { useFinePointer } from "./media";
import { chain, elementRef, mergeRefs } from "./refs";
import { overlayRoot } from "./portal";

type Handlers = {
  onPointerEnter?: (e: SyntheticEvent) => void;
  onPointerLeave?: (e: SyntheticEvent) => void;
  onFocus?: (e: SyntheticEvent) => void;
  onBlur?: (e: SyntheticEvent) => void;
  onPointerDown?: (e: SyntheticEvent) => void;
};

export function Tooltip({ label, children }: { label: string; children: ReactElement }) {
  const fine = useFinePointer();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const id = useId();

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !tip.current) return;
    const a = anchor.current.getBoundingClientRect();
    const t = tip.current.getBoundingClientRect();
    const below = a.top - t.height - 8 < 8;
    const left = Math.max(8, Math.min(a.left + a.width / 2 - t.width / 2, window.innerWidth - t.width - 8));
    setPos({ left, top: below ? a.bottom + 8 : a.top - t.height - 8 });
  }, [open, label]);

  if (!fine || !label) return children;
  const p = children.props as Handlers;
  const trigger = cloneElement(children as ReactElement<Handlers & { ref?: unknown }>, {
    ref: mergeRefs(elementRef(children), (el: HTMLElement | null) => {
      anchor.current = el;
    }),
    onPointerEnter: chain(p.onPointerEnter, () => {
      clear();
      timer.current = window.setTimeout(() => setOpen(true), 500);
    }),
    onPointerLeave: chain(p.onPointerLeave, () => {
      clear();
      setOpen(false);
    }),
    onPointerDown: chain(p.onPointerDown, () => {
      clear();
      setOpen(false);
    }),
    onFocus: chain(p.onFocus, (e) => {
      const el = e.currentTarget as HTMLElement;
      if (el.matches?.(":focus-visible")) setOpen(true);
    }),
    onBlur: chain(p.onBlur, () => {
      clear();
      setOpen(false);
    }),
  });
  return (
    <>
      {trigger}
      {open &&
        createPortal(
          <div
            ref={tip}
            id={id}
            aria-hidden="true"
            className={cx("ds pointer-events-none fixed z-tooltip max-w-[240px] rounded-control bg-ink px-2 py-1 text-caption text-ink-inverse", pos ? "ds-menu-in" : "invisible")}
            style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0 }}
          >
            {label}
          </div>,
          overlayRoot(),
        )}
    </>
  );
}
