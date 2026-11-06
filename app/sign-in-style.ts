/**
 * Small shared pieces of the door's sign-in screens (app/sign-in-door.tsx),
 * kept apart from the components so those files export components only.
 */

import { useEffect } from "react";

/** The door's ground colour, for the browser chrome while a door screen is up (§2.6). */
const DOOR_GROUND = "#05060b";

/** While mounted, the browser's toolbar and the iOS status bar take the door's ground, and go back after. */
export function useDoorChrome() {
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const before = meta?.getAttribute("content") ?? null;
    meta?.setAttribute("content", DOOR_GROUND);
    return () => {
      if (meta && before) meta.setAttribute("content", before);
    };
  }, []);
}

/** The door's own focus ring: ivory, 2px, 3px out (the app's accent ring is for the app). */
export const DOOR_FOCUS = "focus-visible:outline-door-ink! focus-visible:outline-offset-[3px]!";

/** "Resend in 0:44" while it waits, then "Resend code". */
export function resendLabel(seconds: number): string {
  if (seconds <= 0) return "Resend code";
  return `Resend in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
