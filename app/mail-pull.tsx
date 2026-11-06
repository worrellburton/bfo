import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, Spinner, cx } from "./ui";
import { haptic } from "./native";

/**
 * Pull the list down on a phone to check for new mail.
 *
 * The list rides the finger (a transform, with rubber-band resistance) and a
 * ring in the gap above it fills as you pull; past the hold point it pops and
 * the phone taps. Let go and the list settles at the hold point while the
 * ring spins; when the check is done the ring draws a tick and says what
 * came ("3 new" or "Up to date"), then the list eases back.
 *
 * The drag never re-renders React: the finger drives the DOM directly, and
 * state changes only at the phases (pulling → refreshing → done → idle).
 * Drawn with the system's parts: a ring in ink-3, the spinner while it
 * checks, a check and a caption when it's done.
 */

const HOLD = 64; // the distance that commits
const MAX = 118; // as far as the list will come
const EASE = "transform 480ms cubic-bezier(0.16, 1, 0.3, 1)";
const C = 2 * Math.PI * 11; // the ring's circumference (r = 11)

type Phase = "idle" | "pulling" | "refreshing" | "done";

export function PullToRefresh({ enabled, onRefresh, className = "", children }: { enabled: boolean; onRefresh: () => Promise<{ fresh: number } | void>; className?: string; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const badge = useRef<HTMLDivElement>(null);
  const arc = useRef<SVGCircleElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState("");
  const live = useRef({ enabled, onRefresh });
  live.current = { enabled, onRefresh };

  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const st = { y0: 0, x0: 0, active: false, y: 0, armed: false, busy: false, tracking: false };
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const place = (y: number, animate: boolean) => {
      const L = list.current;
      const B = badge.current;
      if (!L || !B) return;
      const f = Math.min(1, y / HOLD);
      L.style.transition = animate && !still ? EASE : "none";
      L.style.transform = y ? `translate3d(0, ${y}px, 0)` : "";
      B.style.transition = animate && !still ? "transform 480ms cubic-bezier(0.16, 1, 0.3, 1), opacity 320ms ease" : "none";
      // The badge hangs in the gap, growing in as it's revealed.
      B.style.transform = `translate(-50%, ${Math.max(-40, y - 48)}px) scale(${0.72 + 0.28 * f})`;
      B.style.opacity = String(Math.min(1, y / 28));
      if (arc.current) arc.current.style.strokeDashoffset = String(C * (1 - f));
    };
    const settle = () => {
      place(0, true);
      st.y = 0;
      st.armed = false;
      badge.current?.removeAttribute("data-armed");
    };

    const onStart = (e: TouchEvent) => {
      if (!live.current.enabled || st.busy || e.touches.length !== 1) return;
      if (window.scrollY > 1 || el.scrollTop > 1) return;
      st.y0 = e.touches[0].clientY;
      st.x0 = e.touches[0].clientX;
      st.tracking = true;
      st.active = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!st.tracking) return;
      const dy = e.touches[0].clientY - st.y0;
      const dx = e.touches[0].clientX - st.x0;
      if (!st.active) {
        // A sideways or upward start is a swipe or a scroll, not a pull.
        if (dy < 0 || Math.abs(dx) > Math.abs(dy)) {
          st.tracking = false;
          return;
        }
        if (dy < 8) return;
        if (window.scrollY > 1 || el.scrollTop > 1) {
          st.tracking = false;
          return;
        }
        st.active = true;
        setPhase("pulling");
        setNote("Pull to check for new mail");
      }
      // Ours now: the page mustn't rubber-band under it.
      if (e.cancelable) e.preventDefault();
      const pulled = Math.max(0, dy - 8);
      const y = MAX * (1 - Math.exp(-pulled / 150));
      st.y = y;
      place(y, false);
      const armed = y >= HOLD;
      if (armed !== st.armed) {
        st.armed = armed;
        if (armed) {
          tap();
          badge.current?.setAttribute("data-armed", "true");
          setNote("Let go to check");
        } else {
          badge.current?.removeAttribute("data-armed");
          setNote("Pull to check for new mail");
        }
      }
    };
    const onEnd = () => {
      if (!st.tracking) return;
      st.tracking = false;
      if (!st.active) return;
      st.active = false;
      if (st.y < HOLD) {
        settle();
        setPhase("idle");
        return;
      }
      st.busy = true;
      place(HOLD, true);
      setPhase("refreshing");
      setNote("Checking for new mail");
      const started = performance.now();
      void (async () => {
        let fresh = 0;
        try {
          const r = await live.current.onRefresh();
          fresh = r?.fresh ?? 0;
        } catch {
          // The list shows what it can; the ring still comes back.
        }
        // Long enough to read, however quick the answer.
        const wait = Math.max(0, 700 - (performance.now() - started));
        await new Promise((r) => setTimeout(r, wait));
        setPhase("done");
        setNote(fresh > 0 ? `${fresh} new` : "Up to date");
        tap();
        await new Promise((r) => setTimeout(r, 720));
        settle();
        setPhase("idle");
        st.busy = false;
      })();
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  return (
    <div ref={outer} className={cx("relative", className)}>
      <div
        ref={badge}
        data-phase={phase}
        aria-hidden={phase === "idle"}
        role="status"
        aria-live="polite"
        style={{ transform: "translate(-50%, -40px)", opacity: 0 }}
        className="pointer-events-none absolute top-0 left-1/2 z-sticky flex flex-col items-center gap-1 text-ink-3 md:hidden"
      >
        {phase === "refreshing" ? (
          <Spinner className="size-[24px]" />
        ) : phase === "done" ? (
          <Icon name="check" size={24} />
        ) : (
          <svg viewBox="0 0 28 28" className="size-[24px] -rotate-90" fill="none" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
            <circle cx="14" cy="14" r="11" stroke="currentColor" strokeOpacity="0.25" />
            <circle ref={arc} cx="14" cy="14" r="11" stroke="currentColor" strokeDasharray={C} strokeDashoffset={C} />
          </svg>
        )}
        <span className="text-caption whitespace-nowrap text-ink-2">{note}</span>
      </div>
      <div ref={list}>{children}</div>
    </div>
  );
}

/** A light tap: native haptics in the iPhone app (app/native.ts). */
function tap() {
  haptic();
}
