import { useEffect, useState } from "react";

/**
 * The device questions components ask (docs/DESIGN.md §8.0, §8.19), as hooks
 * that follow resizes. SSR is off, so window is always there; the guards are
 * for tests and the build.
 */

/** Touch: a phone (under 768px) or any device whose primary pointer is coarse. Matches the `touch:` variant. */
export const TOUCH_QUERY = "(width < 48rem), (pointer: coarse)";
/** A phone: under 768px. Tables become lists here. */
export const PHONE_QUERY = "(width < 48rem)";
/** Under 640px a Dialog renders as a bottom sheet. */
export const NARROW_QUERY = "(width < 40rem)";
/** A fine pointer: keycaps and tooltips show only here. */
export const FINE_QUERY = "(hover: hover) and (pointer: fine)";

function matches(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

/** True while the viewport matches `query`. */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const sync = () => setOn(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return on;
}

export const useTouch = () => useMedia(TOUCH_QUERY);
export const usePhone = () => useMedia(PHONE_QUERY);
export const useNarrow = () => useMedia(NARROW_QUERY);
export const useFinePointer = () => useMedia(FINE_QUERY);

/** Whether the platform's command key is ⌘ (Apple) rather than Ctrl. */
export function isApple(): boolean {
  if (typeof navigator === "undefined") return false;
  const p = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(p) || /Mac OS X/.test(navigator.userAgent);
}

/** Calls back once after `ms` while `on` is true: skeletons and route progress appear only after 300ms (§8.14). */
export function useDelayed(on: boolean, ms = 300): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!on) {
      setShown(false);
      return;
    }
    const t = window.setTimeout(() => setShown(true), ms);
    return () => window.clearTimeout(t);
  }, [on, ms]);
  return shown;
}
