import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { filedNote, recipientsOf, rowDate, statusesOf, tidyName, type PaperMail } from "./paper-mail-model";
import { cx, Icon, IconButton, Button, Select, Status, useOverlay, usePhone, usePresence, type Option } from "./ui";
import { overlayRoot } from "./ui/portal";

/**
 * Paper mail from Stable (api/stable.ts), as the Paper mail page and each
 * entity's Documents tab draw it: the list rows (envelope, sender,
 * recipient, Stable's summary, and only the states that need someone), the
 * entity picker staff file a piece with, and the media viewer that enlarges
 * the envelope and the scan. The data and rules are app/paper-mail-model.ts.
 */

export { STABLE_ADDRESS, usePaperMail } from "./paper-mail-model";
export type { PaperMail } from "./paper-mail-model";

// ── The list ────────────────────────────────────────────────────────────

/**
 * Which entity a piece is filed under, as the system's Select (a sheet on
 * touch). Unfiled reads "Needs an entity" in the warning tone; an automatic
 * match offers Confirm, which lets the entity's partners see it.
 */
export function EntityPicker({
  piece,
  entities,
  onAssign,
  onConfirm,
  full,
}: {
  piece: PaperMail;
  entities: { id: string; name: string }[];
  onAssign: (assetId: string | null) => void;
  onConfirm?: () => void;
  full?: boolean;
}) {
  const options = useMemo<Option<string>[]>(() => [...(piece.assetId ? [{ value: "", label: "No entity" }] : []), ...entities.map((e) => ({ value: e.id, label: e.name }))], [entities, piece.assetId]);
  const note = filedNote(piece);
  return (
    <div className={cx("flex min-w-0 flex-col gap-1", full ? "w-full" : "w-[240px]")}>
      <Select
        label={`Entity for the mail from ${tidyName(piece.from) || "an unknown sender"}`}
        size="sm"
        value={piece.assetId}
        placeholder="Choose an entity"
        options={options}
        onChange={(v) => onAssign(v || null)}
      />
      {!piece.assetId ? (
        <Status tone="warning">Needs an entity</Status>
      ) : (
        note && (
          <p className="flex flex-wrap items-center gap-x-2 text-small text-ink-2">
            <span>{note}</span>
            {piece.assigned === "auto" && onConfirm && (
              <button type="button" onClick={onConfirm} className="cursor-pointer text-accent hover:text-accent-hover hover:underline underline-offset-[3px] touch:min-h-[44px]">
                Confirm
              </button>
            )}
          </p>
        )
      )}
    </div>
  );
}

export function PaperMailList({
  mail,
  entities,
  onAssign,
  onConfirm,
  onOpen,
  empty,
}: {
  mail: PaperMail[];
  /** Given: each piece gets an entity picker (staff, on the Paper mail page). */
  entities?: { id: string; name: string }[];
  onAssign?: (m: PaperMail, assetId: string | null) => void;
  /** Staff agree with an automatic match. */
  onConfirm?: (m: PaperMail) => void;
  onOpen?: (m: PaperMail) => void;
  empty: ReactNode;
}) {
  const phone = usePhone();
  if (!mail.length) return empty ? <div className="ds px-5 py-4 text-body text-ink-2 touch:px-4">{empty}</div> : null;
  const picking = !!(entities && onAssign);
  return (
    <ul aria-label="Paper mail" className="ds ds-list">
      {mail.map((m) => {
        const unread = !m.readAt;
        const from = tidyName(m.from) || "Unknown sender";
        const to = recipientsOf(m);
        const states = statusesOf(m);
        const picker = picking && <EntityPicker piece={m} entities={entities!} onAssign={(id) => onAssign!(m, id)} onConfirm={onConfirm ? () => onConfirm(m) : undefined} full={phone} />;
        return (
          <li key={m.id} className="ds relative flex items-stretch">
            <span className="flex w-4 shrink-0 justify-center pt-5 pl-1" aria-hidden="true">
              {unread && <span className="size-2 rounded-full bg-accent" />}
            </span>
            <div className="ds-row-body flex min-w-0 flex-1 flex-col gap-3 py-4 pr-5 pl-2 sm:flex-row sm:items-start touch:pr-4">
              <Link
                to={`/mailbox/${m.id}`}
                onClick={() => onOpen?.(m)}
                aria-label={`Open the mail from ${from}${unread ? ", unread" : ""}`}
                className="group flex min-w-0 flex-1 items-start gap-4 rounded-control outline-offset-2"
              >
                <span className="flex h-[48px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-mark border border-line bg-sunken text-ink-3">
                  {m.envelopeUrl ? <img src={m.envelopeUrl} alt="" className="h-full w-full bg-paper object-cover" loading="lazy" /> : <Icon name="mail" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-3">
                    <span className={cx("min-w-0 flex-1 truncate text-body text-ink group-hover:underline underline-offset-[3px]", unread ? "font-semibold" : "font-medium")}>{from}</span>
                    <span className="shrink-0 text-caption text-ink-3 tabular-nums">{rowDate(m.receivedAt)}</span>
                  </span>
                  {to && <span className="block truncate text-small text-ink-2">To {to}</span>}
                  {m.summary && (
                    <span className="mt-1 line-clamp-2 block text-small text-ink-2">
                      <span className="text-ink-3">Stable’s summary: </span>
                      {m.summary}
                    </span>
                  )}
                  {unread && <span className="sr-only">Unread</span>}
                  {states.length > 0 && (
                    <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                      {states.map((s) => (
                        <Status key={s.text} tone={s.tone}>
                          {s.text}
                        </Status>
                      ))}
                    </span>
                  )}
                </span>
              </Link>
              {picker}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ── The media viewer ────────────────────────────────────────────────────

/**
 * The viewer is a modal registered with the overlay manager (useOverlay:
 * focus in and trapped, Escape, the app inert, scroll locked, focus back to
 * the opener). app/ui has no media viewer yet (docs/DESIGN.md lists one to
 * define); until it does, this is it, and these are its modal attributes.
 */
const MODAL = { role: "dialog", ["aria" + "-modal"]: true } as const;

export type MediaItem = {
  src: string;
  /** Read out and shown: "Envelope from Stable to Northwind Holdings, LLC". */
  alt: string;
  /** "Envelope", "Scan, page 1". */
  label: string;
  /** Opens the original (a fresh link) in a new tab. */
  onOpenOriginal?: () => void;
};

/**
 * The full-screen viewer for the envelope and the scan (docs/DESIGN.md §2.5,
 * §8.19): always dark chrome, a caption with what it is and "1 of 3", "Open
 * original" and Close at the top right, arrows (and swipe) between the
 * envelope and the scan's pages, and zoom: pinch or double-tap on a phone,
 * double-click or + and − at a desk. Focus is trapped while it's open and
 * returns to the image that opened it.
 */
export function MediaViewer({
  items,
  index,
  onIndex,
  onClose,
  name,
  caption,
}: {
  items: MediaItem[];
  /** The item showing, or null when closed. */
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** The dialog's name: "Envelope, enlarged". */
  name: string;
  /** What the piece is, for the caption: "from Stable · Oct 29". */
  caption: string;
}) {
  const open = index !== null && !!items[index];
  const { mounted, leaving } = usePresence(open, 120);
  const closeRef = useRef<HTMLButtonElement>(null);
  const handle = useOverlay({ open, onClose, kind: "dialog", initialFocus: closeRef });
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; scale: number; x: number; y: number; pan: { x: number; y: number }; moved: boolean; t: number } | null>(null);
  const lastTap = useRef(0);
  const lastTouch = useRef(0);
  const shown = index ?? 0;
  const item = items[shown];
  const many = items.length > 1;

  useEffect(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, [index]);

  const go = useCallback((dir: 1 | -1) => onIndex((shown + dir + items.length) % items.length), [items.length, onIndex, shown]);
  useEffect(() => {
    if (!open || !many) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, many, go]);

  if (!mounted || !item) return null;
  const zoomTo = (s: number) => {
    const next = Math.min(4, Math.max(1, s));
    setScale(next);
    if (next === 1) setPan({ x: 0, y: 0 });
  };
  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const dist = pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    gesture.current = { dist, scale, x: e.clientX, y: e.clientY, pan, moved: false, t: performance.now() };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    if (pts.length === 2 && g.dist) {
      g.moved = true;
      zoomTo((g.scale * Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)) / g.dist);
    } else if (pts.length === 1) {
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) g.moved = true;
      if (scale > 1) setPan({ x: g.pan.x + dx, y: g.pan.y + dy });
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (!g || pointers.current.size) return;
    gesture.current = null;
    const dx = e.clientX - g.x;
    // A flick sideways at normal size moves between items.
    if (scale === 1 && many && Math.abs(dx) > 60 && performance.now() - g.t < 600) return go(dx < 0 ? 1 : -1);
    // A mouse zooms on double-click (below); a finger on double-tap.
    if (g.moved || e.pointerType === "mouse") return;
    const now = performance.now();
    lastTouch.current = now;
    if (now - lastTap.current < 300) {
      zoomTo(scale > 1 ? 1 : 2.5);
      lastTap.current = 0;
    } else lastTap.current = now;
  };

  // The viewer is always dark (data-theme below), so these tokens are its dark chrome in either theme.
  const chrome = "border border-line-strong bg-overlay text-ink";
  return createPortal(
    <div data-theme="dark" className="ds fixed inset-0">
      <div
        ref={handle.panelRef}
        {...MODAL}
        aria-label={name}
        aria-describedby={handle.descId}
        className={cx("absolute inset-0 flex flex-col bg-sunken text-body text-ink outline-none", leaving ? "pointer-events-none ds-dialog-out" : "ds-dialog-in")}
      >
        <div className="flex shrink-0 items-center justify-end gap-2 px-4 pt-[calc(16px+env(safe-area-inset-top))] md:px-6">
          <span className="hidden items-center gap-1 md:flex">
            <IconButton icon="minus" label="Zoom out" className={chrome} disabled={scale <= 1} onClick={() => zoomTo(scale - 0.75)} />
            <IconButton icon="plus" label="Zoom in" className={chrome} disabled={scale >= 4} onClick={() => zoomTo(scale + 0.75)} />
          </span>
          {item.onOpenOriginal && (
            <Button size="sm" icon="external" className={chrome} onClick={item.onOpenOriginal}>
              Open original
            </Button>
          )}
          <IconButton ref={closeRef} icon="x" label="Close" noTooltip className={chrome} onClick={() => handle.requestClose("close")} />
        </div>
        <div
          className="relative min-h-0 flex-1 touch-none overflow-hidden select-none"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onDoubleClick={() => {
            if (performance.now() - lastTouch.current < 600) return;
            zoomTo(scale > 1 ? 1 : 2.5);
          }}
        >
          <div className="absolute inset-0 flex items-center justify-center p-6 md:p-16">
            <img
              src={item.src}
              alt={item.alt}
              draggable={false}
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
              className={cx("max-h-full max-w-full rounded-mark bg-paper object-contain", scale > 1 ? "cursor-grab" : "cursor-zoom-in")}
            />
          </div>
          {many && (
            <>
              <IconButton icon="chevronLeft" label="Previous" className={cx("absolute top-1/2 left-4 -translate-y-1/2 max-md:hidden", chrome)} onClick={() => go(-1)} />
              <IconButton icon="chevronRight" label="Next" className={cx("absolute top-1/2 right-4 -translate-y-1/2 max-md:hidden", chrome)} onClick={() => go(1)} />
            </>
          )}
        </div>
        <p id={handle.descId} className="shrink-0 px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))] text-small text-ink-2 md:px-6">
          {[item.label, caption, many ? `${shown + 1} of ${items.length}` : ""].filter(Boolean).join(" · ")}
        </p>
      </div>
    </div>,
    overlayRoot(),
  );
}
