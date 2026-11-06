import { useEffect, useState } from "react";
import { lockupOf, type Logo } from "./brand";
import { statusBarFor } from "./native";
import { THEME_COLOR } from "./shell-model";

/**
 * The front door's state, shared by the landing page and the owner's gallery
 * of backdrops (app/door.tsx has the parts that draw).
 */

export const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** True once the mark's typeface is loaded (or most of a second has passed), so the lockup never flashes in a fallback font. */
export function useTypefaceReady(logo: Logo | null | undefined): boolean {
  const lockup = lockupOf(logo);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      setReady(true);
    };
    const fonts = document.fonts;
    if (fonts?.load) fonts.load(`${lockup.font.weight} 10px "${lockup.font.family}"`).then(go, go);
    else go();
    const t = setTimeout(go, 700);
    return () => clearTimeout(t);
  }, [lockup.font.family, lockup.font.weight]);
  return ready;
}

/** Locks the document to the screen while mounted: no scrolling, no rubber-banding. */
export function useScreenLock() {
  useEffect(() => {
    document.documentElement.classList.add("door-lock");
    document.body.classList.add("door-lock");
    return () => {
      document.documentElement.classList.remove("door-lock");
      document.body.classList.remove("door-lock");
    };
  }, []);
}

/**
 * The door is always night (docs/DESIGN.md §2.1, §2.6): while a door screen
 * is mounted, the browser chrome is the door's ground (#05060b) and the
 * iPhone status bar is light; both go back to the app's theme on the way in.
 * The door screen also sets data-theme="dark" on its own root.
 */
export function useDoorChrome() {
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const before = meta?.getAttribute("content") ?? null;
    meta?.setAttribute("content", THEME_COLOR.door);
    statusBarFor(true);
    return () => {
      if (before) meta?.setAttribute("content", before);
      statusBarFor(document.documentElement.dataset.theme !== "light");
    };
  }, []);
}
