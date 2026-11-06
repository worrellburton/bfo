import { useEffect, useState, useSyncExternalStore } from "react";
import { useNavigation } from "react-router";
import { cx, useDelayed } from "./ui";

/**
 * The shell's two status pieces (docs/DESIGN.md §7.2, §8.14, §8.16, §12.1).
 *
 * - RouteProgress: while the next page's code loads, a 2px accent bar along
 *   the top of the content, shown only after 300ms so quick moves don't
 *   flash it; it fades when the page arrives.
 * - OfflineBanner: says so while the device is offline, and that changes
 *   made now aren't saved (nothing is queued), then briefly when it's back,
 *   with a way to refresh. It sits where toasts sit: bottom centre of the
 *   content column, above the Ask button's row on a phone.
 *
 * useOnline() lets a page say how old its figures are while offline, and
 * the `bfo:online` window event tells pages the connection is back.
 */

export function RouteProgress() {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const shown = useDelayed(busy, 300);
  const [grow, setGrow] = useState(false);
  useEffect(() => {
    if (!shown) {
      setGrow(false);
      return;
    }
    const t = window.requestAnimationFrame(() => setGrow(true));
    return () => window.cancelAnimationFrame(t);
  }, [shown]);
  if (!shown) return null;
  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      className="pointer-events-none fixed top-0 right-0 z-toast h-[2px]"
      style={{ left: "var(--content-inset, 0px)", marginTop: "env(safe-area-inset-top)" }}
    >
      <div className="h-full bg-accent" style={{ width: grow ? "85%" : "8%", transition: "width 6s var(--ease-out)" }} />
    </div>
  );
}

// ── Online and offline ──────────────────────────────────────────────────

let offlineSince: number | null = typeof navigator !== "undefined" && !navigator.onLine ? Date.now() : null;
const listeners = new Set<() => void>();
let wired = false;
function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("offline", () => {
    offlineSince = Date.now();
    listeners.forEach((f) => f());
  });
  window.addEventListener("online", () => {
    offlineSince = null;
    listeners.forEach((f) => f());
    window.dispatchEvent(new CustomEvent("bfo:online"));
  });
}

/** Whether the device is online, and since when it hasn't been (ms), for "Figures as of …" while offline. */
export function useOnline(): { online: boolean; offlineSince: number | null } {
  wire();
  const since = useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    () => offlineSince,
    () => null,
  );
  return { online: since === null, offlineSince: since };
}

export function OfflineBanner() {
  const { online } = useOnline();
  const [back, setBack] = useState(false);
  const [wasOffline, setWasOffline] = useState(!online);
  useEffect(() => {
    if (!online) {
      setWasOffline(true);
      setBack(false);
    } else if (wasOffline) {
      setWasOffline(false);
      setBack(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);
  useEffect(() => {
    if (!back) return;
    const t = setTimeout(() => setBack(false), 8000);
    return () => clearTimeout(t);
  }, [back]);
  const showing = !online || back;
  const [leaving, setLeaving] = useState(false);
  const [mounted, setMounted] = useState(showing);
  useEffect(() => {
    if (showing) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    const t = setTimeout(() => setMounted(false), 160);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showing]);

  return (
    <div
      role="status"
      aria-live="polite"
      data-floating
      className="ds pointer-events-none fixed right-0 z-toast flex justify-center px-(--gutter)"
      style={{ left: "var(--content-inset, 0px)", bottom: "var(--toast-bottom)" }}
    >
      {mounted && (
        <div
          className={cx(
            "pointer-events-auto flex min-h-[44px] w-full max-w-[420px] items-center gap-3 rounded-card border border-line-strong bg-overlay py-2 pr-2 pl-4 text-body text-ink shadow-(--elevation-2)",
            leaving ? "ds-toast-out" : "ds-toast-in",
          )}
        >
          <span aria-hidden="true" className={cx("size-2 shrink-0 rounded-full", online ? "bg-positive" : "bg-warning")} />
          <span className="min-w-0 flex-1 py-1">{online ? "Back online." : "You’re offline. Changes won’t be saved."}</span>
          {online && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-(--control-sm) shrink-0 cursor-pointer items-center rounded-control px-3 text-body font-medium text-accent hover:bg-hover"
            >
              Refresh
            </button>
          )}
        </div>
      )}
    </div>
  );
}
