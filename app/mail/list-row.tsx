import { useRef, useState } from "react";
import { Status, cx, format } from "../ui";
import type { MailAddress, MailSummary } from "../mail-client";
import { Glyph, Star } from "./glyphs";
import { cleanSnippet, fullStamp, listDate, recipientLabel, same, senderLabel, tap } from "./helpers";
import { MailAvatar } from "./avatar";
import { SelectBox, StarButton } from "./controls";

// ── A message in a list: phones, and the column beside the reader ────────

/** Who a row is from — or, for mail I sent, who it went to. */
export function whoOf(m: MailSummary, sent: boolean, mine: string[]): string {
  if (!sent) return senderLabel(m.from);
  return m.to.map((a) => recipientLabel(a, mine)).join(", ") || "No recipients";
}

/** The unread mark: an 8px accent dot in its own gutter, read out as "Unread." (§8.9). */
export function UnreadDot({ on }: { on: boolean }) {
  return (
    <span className="flex w-2 shrink-0 justify-center self-start pt-[16px] touch:pt-[18px]">
      {on && <span aria-hidden="true" className="size-2 rounded-full bg-accent" />}
      {on && <span className="sr-only">Unread. </span>}
    </span>
  );
}

/** A sender SPF and DKIM don't vouch for: said once, beside the name, in words and a warning dot. */
export function UnverifiedTag() {
  return (
    <Status tone="warning" className="shrink-0">
      <span aria-hidden="true">Unverified</span>
      <span className="sr-only">Sender not verified</span>
    </Status>
  );
}

/**
 * One message (§8.9, three lines): who (semibold when unread) and when at the
 * top right; the subject, with a clip when there are files and the star when
 * it's on; the first words in ink-2. Unread is the dot and the weight, nothing
 * else. On a phone a finger across the row archives (left) or stars (right),
 * a held finger picks it, and while anything is picked a tap picks too.
 */
export function MailListRow({
  m,
  sent,
  mine,
  selected,
  grouped = false,
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
  mine: string[];
  /** Open in the reader beside the list. */
  selected: boolean;
  /** In a list grouped by day: the group says the date, the row the time. */
  grouped?: boolean;
  onOpen: () => void;
  /** The finger has landed on the row: fetch its message ahead of the tap. */
  onPrefetch?: () => void;
  onStar: (on: boolean) => void;
  /** Picked for a bulk action; `picking`: some message is, so every row shows its box and a tap picks. */
  picked?: boolean;
  picking?: boolean;
  onPick?: (shift: boolean) => void;
  /** Phones: a swipe left archives (when given). */
  onArchive?: () => void;
}) {
  const unread = !m.read;
  const [dx, setDx] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const gesture = useRef<{ x: number; y: number; id: number; moved: boolean; held: boolean; timer: number } | null>(null);
  const THRESHOLD = 72;
  const onPointerDown = (e: React.PointerEvent) => {
    onPrefetch?.();
    if (e.pointerType === "mouse" || e.button !== 0) return;
    const g = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, held: false, timer: 0 };
    g.timer = window.setTimeout(() => {
      if (!g.moved && onPick && !picking) {
        g.held = true;
        tap();
        onPick(false);
      }
    }, 450);
    gesture.current = g;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId || g.held || picking) return;
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
  const onClickRow = (e: React.MouseEvent) => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    // Picking: a tap (or a click) picks, as in a mail app's edit mode.
    if (picking && onPick) onPick(e.shiftKey);
    else onOpen();
  };
  const who = sent ? `To ${whoOf(m, true, mine)}` : whoOf(m, false, mine);
  const face: MailAddress = sent ? (m.to.find((a) => !mine.some((x) => same(a.email, x))) ?? m.to[0] ?? m.from) : m.from;
  const past = Math.abs(dx) >= THRESHOLD;
  const preview = cleanSnippet(m.snippet);
  return (
    <div className={cx("relative", dx !== 0 && "overflow-hidden")}>
      {dx < 0 && onArchive && (
        <div aria-hidden="true" className={cx("absolute inset-0 flex items-center justify-end gap-2 px-6 text-body font-medium", past ? "bg-ink text-ink-inverse" : "bg-selected text-ink")}>
          <Glyph name="archive" />
          Archive
        </div>
      )}
      {dx > 0 && (
        <div aria-hidden="true" className={cx("absolute inset-0 flex items-center gap-2 px-6 text-body font-medium", past ? "bg-warning-tint text-ink" : "bg-selected text-ink")}>
          <Star on={past} />
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
        style={dx !== 0 ? { transform: `translateX(${dx}px)`, touchAction: "pan-y" } : { touchAction: "pan-y" }}
        className={cx(
          "group/row relative flex w-full cursor-pointer items-start gap-3 py-3 pr-4 pl-2 text-left outline-offset-[-2px]! select-none [-webkit-touch-callout:none]",
          !swiping && "transition-transform duration-(--dur-4) ease-(--ease-out)",
          picked || selected ? "bg-selected" : dx !== 0 ? "bg-raised" : "bg-raised hover:bg-hover active:bg-selected",
        )}
      >
        <UnreadDot on={unread} />
        {/* The avatar turns into its pick box on hover, and stays one while anything is picked. */}
        <span className="relative mt-[2px] size-10 shrink-0">
          <span className={cx("absolute inset-0", onPick && (picked || picking) ? "invisible" : onPick ? "group-hover/row:invisible group-focus-within/row:invisible" : "")}>
            <MailAvatar a={face} trusted={sent || !m.unverified} size={40} />
          </span>
          {onPick && (
            <span
              className={cx(
                "absolute -inset-1 flex items-center justify-center touch:-inset-[2px]",
                picked || picking ? "visible" : "invisible group-hover/row:visible group-focus-within/row:visible touch:invisible",
              )}
            >
              <SelectBox on={picked} onToggle={onPick} label={picked ? "Unselect" : "Select"} className="size-full!" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cx("min-w-0 truncate text-body text-ink", unread ? "font-semibold" : "font-normal")}>{who}</span>
            {!sent && m.unverified && <UnverifiedTag />}
            <span className="flex-1" />
            <time dateTime={m.occurredAt} title={fullStamp(m.occurredAt)} className="shrink-0 text-caption text-ink-3 tabular-nums">
              {grouped ? format.time(m.occurredAt) : listDate(m.occurredAt)}
            </time>
          </span>
          <span className="flex items-center gap-2">
            <span className={cx("min-w-0 flex-1 truncate text-body text-ink", unread ? "font-semibold" : "font-normal")}>{m.subject || "(no subject)"}</span>
            {m.attachmentCount > 0 && (
              <span className="shrink-0 text-ink-3" title={`${m.attachmentCount} ${m.attachmentCount === 1 ? "attachment" : "attachments"}`}>
                <Glyph name="clip" size={16} />
                <span className="sr-only">
                  , {m.attachmentCount} {m.attachmentCount === 1 ? "attachment" : "attachments"}
                </span>
              </span>
            )}
            {m.held && <span className="sr-only">, kept for records</span>}
            <StarButton on={m.starred} onToggle={onStar} reveal className="-my-2 -mr-2" />
          </span>
          <span className="block truncate text-small text-ink-2">{preview || "\u00a0"}</span>
        </span>
      </div>
    </div>
  );
}
