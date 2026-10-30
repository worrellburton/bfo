import { useRef, useState } from "react";
import { useTone } from "../entity/ui";
import { FileKindIcons } from "../file-icon";
import type { MailAddress, MailSummary } from "../mail-client";
import { Glyph, Star } from "./glyphs";
import { cleanSnippet, listDate, same, senderLabel, tap } from "./helpers";
import { Avatar } from "./avatar";
import { SelectBox, StarButton } from "./controls";

// ── List ─────────────────────────────────────────────────────────────────


/** Who a row is from — or, in Sent, who it went to. */
export function whoOf(m: MailSummary, sent: boolean, me: string): string {
  if (!sent) return senderLabel(m.from);
  return m.to.map((a) => (same(a.email, me) ? "me" : senderLabel(a))).join(", ") || "—";
}

/** A small round mark for unread rows; invisible otherwise, so text lines up. */
export function UnreadDot({ on }: { on: boolean }) {
  return (
    <>
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${on ? "bg-(--mail-accent) shadow-[0_0_8px_var(--mail-accent)]" : "bg-transparent"}`} />
      {on && <span className="sr-only">Unread. </span>}
    </>
  );
}

export function ListRow({
  m,
  sent,
  me,
  selected,
  onOpen,
  onPrefetch,
  onStar,
  picked = false,
  picking = false,
  onPick,
  onArchive,
}: {
  m: MailSummary;
  sent: boolean;
  me: string;
  selected: boolean;
  onOpen: () => void;
  /** The finger has landed on the row: fetch its message ahead of the tap. */
  onPrefetch?: () => void;
  onStar: (on: boolean) => void;
  /** Picked for a bulk action; `picking`: some message is, so every row shows its box. */
  picked?: boolean;
  picking?: boolean;
  onPick?: (shift: boolean) => void;
  /** Phones: a swipe left archives (when given). */
  onArchive?: () => void;
}) {
  const t = useTone();
  const unread = !m.read;
  // Phones: a finger across the row drags it; past the threshold it archives (left) or stars (right). A held finger picks it.
  const [dx, setDx] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const gesture = useRef<{ x: number; y: number; id: number; moved: boolean; held: boolean; timer: number } | null>(null);
  const THRESHOLD = 72;
  const onPointerDown = (e: React.PointerEvent) => {
    onPrefetch?.();
    if (e.pointerType === "mouse" || e.button !== 0) return;
    const g = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, held: false, timer: 0 };
    g.timer = window.setTimeout(() => {
      if (!g.moved && onPick) {
        g.held = true;
        tap();
        onPick(false);
      }
    }, 450);
    gesture.current = g;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId || g.held) return;
    const ddx = e.clientX - g.x;
    const ddy = e.clientY - g.y;
    if (!g.moved) {
      if (Math.abs(ddx) < 10 && Math.abs(ddy) < 10) return;
      window.clearTimeout(g.timer);
      if (Math.abs(ddy) > Math.abs(ddx)) {
        gesture.current = null; // a scroll, not a swipe
        return;
      }
      g.moved = true;
      setSwiping(true);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // a pointer the browser won't capture: the row still follows the finger while it stays over it
      }
    }
    // Only the ways that do something; the row resists past the threshold.
    const allowed = ddx < 0 ? !!onArchive : true;
    const raw = allowed ? ddx : ddx * 0.25;
    setDx(Math.max(-140, Math.min(140, Math.abs(raw) > THRESHOLD ? Math.sign(raw) * (THRESHOLD + (Math.abs(raw) - THRESHOLD) * 0.35) : raw)));
  };
  const endGesture = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    window.clearTimeout(g.timer);
    gesture.current = null;
    if (g.moved) {
      setSwiping(false);
      if (dx <= -THRESHOLD && onArchive) {
        tap();
        onArchive();
      } else if (dx >= THRESHOLD) {
        tap();
        onStar(!m.starred);
      }
      setDx(0);
    }
  };
  /** The click that follows a swipe or a hold isn't an open. */
  const swallowClick = useRef(false);
  const onClickRow = () => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    onOpen();
  };
  const who = sent ? `To ${whoOf(m, true, me)}` : whoOf(m, false, me);
  const face: MailAddress = sent ? (m.to.find((a) => !same(a.email, me)) ?? m.to[0] ?? m.from) : m.from;
  const past = Math.abs(dx) >= THRESHOLD;
  return (
    <div className={`swipe-track ${dx !== 0 ? "" : "md:contents"}`}>
      {dx < 0 && onArchive && (
        <div aria-hidden="true" className={`swipe-under justify-end ${past ? "bg-(--mail-accent-deep) text-white" : t.dark ? "bg-(--mail-accent-deep)/25 text-(--mail-accent-pale)" : "bg-(--mail-accent-deep)/15 text-(--mail-accent-ink)"}`}>
          <Glyph name="archive" className="mr-2 h-[18px] w-[18px]" />
          Archive
        </div>
      )}
      {dx > 0 && (
        <div aria-hidden="true" className={`swipe-under ${past ? "bg-amber-400 text-gray-950" : t.dark ? "bg-amber-400/20 text-amber-200" : "bg-amber-100 text-amber-800"}`}>
          <Star on className="mr-2 h-[18px] w-[18px]" />
          {m.starred ? "Unstar" : "Star"}
        </div>
      )}
    <div
      role="button"
      data-mail-row={m.id}
      tabIndex={0}
      onClick={onClickRow}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => {
        const g = gesture.current;
        if (g && (g.moved || g.held)) swallowClick.current = true;
        endGesture(e);
      }}
      onPointerCancel={endGesture}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-current={selected ? "true" : undefined}
      aria-selected={onPick ? picked : undefined}
      style={dx !== 0 ? { transform: `translateX(${dx}px)` } : undefined}
      className={`swipe-row group flex w-full cursor-pointer items-start gap-3 py-3 pl-4 pr-2 text-left transition-colors max-md:select-none max-md:[-webkit-touch-callout:none] max-md:gap-3.5 max-md:rounded-2xl max-md:px-5 max-md:py-3.5 ${swiping ? "swiping" : "max-md:active:scale-[0.99]"} ${
        picked ? (t.dark ? "bg-(--mail-accent-deep)/[0.13]" : "bg-(--mail-accent-deep)/10") : selected ? (t.dark ? "bg-white/[0.06]" : "bg-gray-100/80") : dx !== 0 ? (t.dark ? "bg-[#0b0b0f]" : "bg-white") : unread ? (t.dark ? "bg-(--mail-accent-deep)/[0.09] hover:bg-(--mail-accent-deep)/[0.14]" : "bg-(--mail-accent-deep)/[0.055] hover:bg-(--mail-accent-deep)/[0.09]") : t.hover
      } ${t.dark ? "active:bg-white/[0.05] focus-visible:bg-white/[0.05]" : "active:bg-gray-100 focus-visible:bg-gray-50"} focus-visible:outline-none`}
    >
      <span className="relative mt-0.5 shrink-0">
        {/* The avatar turns into its select box on hover, and stays one while anything is picked. Unread: it carries the light. */}
        <span className={`block rounded-full transition-opacity duration-150 ${unread && !picked ? "unread-ring" : ""} ${onPick && (picked || picking) ? "opacity-0" : onPick ? "md:group-hover:opacity-0" : ""}`}>
          <Avatar a={face} trusted={sent || !m.unverified} size="h-10 w-10 text-[13px] max-md:text-[12.5px]" />
        </span>
        {onPick && (
          <span className={`touch-keep-hover absolute inset-0 grid place-items-center transition-opacity duration-150 ${picked || picking ? "opacity-100" : "opacity-0 md:group-hover:opacity-100 max-md:opacity-0"}`}>
            <SelectBox on={picked} onToggle={onPick} label={picked ? "Unselect" : "Select"} className="!h-10 !w-10" />
          </span>
        )}
        {unread && (
          <span aria-hidden="true" className={`absolute -left-1.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-(--mail-accent) ring-2 ${t.dark ? "ring-[#0b0b0f]" : "ring-white"}`} />
        )}
        {unread && <span className="sr-only">Unread. </span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[13.5px] leading-5 max-md:text-[13px] max-md:leading-5 ${unread ? `font-bold ${t.text}` : `font-normal ${t.soft}`}`}>{who}</span>
        <span className="flex items-center gap-1.5">
          <span className={`min-w-0 flex-1 truncate text-[12.5px] leading-5 max-md:text-[12px] max-md:leading-5 ${unread ? `font-semibold ${t.text}` : `font-normal ${t.soft}`}`}>{m.subject || "(no subject)"}</span>
          {m.attachmentCount > 0 && (
            <span className="shrink-0">
              <FileKindIcons kinds={m.attachmentKinds?.length ? m.attachmentKinds : ["file"]} count={m.attachmentCount} className="h-[15px] w-[15px] max-md:h-4 max-md:w-4" />
            </span>
          )}
        </span>
        <span className={`block truncate text-[12px] leading-5 max-md:text-[11.5px] max-md:leading-5 ${t.muted}`}>{cleanSnippet(m.snippet) || "\u00a0"}</span>
      </span>
      {/* Right rail: when, and the star. Desktop shows the star on hover; phones always, as Gmail does. */}
      <span className="flex shrink-0 flex-col items-end justify-between self-stretch">
        <time dateTime={m.occurredAt} className={`pr-1 text-[11.5px] leading-5 tabular-nums max-md:text-[10.5px] max-md:leading-5 ${unread ? `font-semibold ${t.dark ? "text-(--mail-accent)" : "text-(--mail-accent-ink)"}` : t.muted}`}>
          {listDate(m.occurredAt)}
        </time>
        <StarButton on={m.starred} onToggle={onStar} className="-mb-1.5 max-md:-mr-1" alwaysOnPhones />
      </span>
    </div>
    </div>
  );
}
