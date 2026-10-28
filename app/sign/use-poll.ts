import { useEffect, useRef } from "react";

/**
 * Calls `fn` every `ms` while `active` and the tab is visible, and once more
 * when the tab comes back. Signatures has no push channel to the browser, so
 * a page waiting on someone else's signature asks.
 */
export function usePoll(fn: () => void | Promise<void>, ms: number, active: boolean) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        try {
          await latest.current();
        } catch {
          // the next tick tries again
        }
      }
      if (!stopped) timer = setTimeout(tick, ms);
    };
    timer = setTimeout(tick, ms);
    const onVisible = () => {
      if (document.visibilityState === "visible") void latest.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ms, active]);
}
