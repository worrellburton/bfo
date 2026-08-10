import { useEffect, useState } from "react";

/**
 * The sidebar is an auto-collapsing rail: 76px of icons at rest, expanding to
 * 260px as an overlay while a fine pointer hovers it. One pair of numbers
 * drives the rail, the content inset and the flyout, so the edges never drift.
 */
export const SIDEBAR_OPEN_W = 260;
export const SIDEBAR_RAIL_W = 76;

/**
 * Runs in <head> before first paint so the rail renders at its resting width
 * immediately — no flash from an unstyled default.
 */
export const SIDEBAR_BOOT_SCRIPT = `
(function () {
  try {
    document.documentElement.style.setProperty("--sidebar-w", "${SIDEBAR_RAIL_W}px");
  } catch (e) {}
})();
`.trim();

/** Pointer-based hover expansion is desktop-only; it never fires on touch. */
export function useHoverCapable(): boolean {
  const [capable, setCapable] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    setCapable(query.matches);
    const onChange = (e: MediaQueryListEvent) => setCapable(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return capable;
}
