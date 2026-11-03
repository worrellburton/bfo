import { useEffect, useState } from "react";
import { lockupOf, type Logo } from "./brand";

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
