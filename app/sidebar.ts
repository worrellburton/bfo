import { useCallback, useEffect, useState } from "react";

/**
 * Sidebar width is a user setting, not a toggle. One pair of numbers drives
 * the rail, the content inset and the hover flyout, so those edges can never
 * drift apart.
 */
export const SIDEBAR_OPEN_W = 260;
export const SIDEBAR_RAIL_W = 76;

export type SidebarMode = "open" | "collapsed" | "auto";

export const SIDEBAR_MODES: Array<{
  value: SidebarMode;
  title: string;
  description: string;
}> = [
  { value: "open", title: "Open", description: "The menu stays out." },
  { value: "collapsed", title: "Collapsed", description: "Icons only, and it stays that way." },
  { value: "auto", title: "Auto-collapse", description: "Icons only, opens when you hover it." },
];

export const SIDEBAR_STORAGE_KEY = "bfo-sidebar-mode";

/**
 * Runs in <head> before first paint so the rail never flashes open then snaps
 * shut. Sets the mode on <html> and seeds the width custom property, which is
 * what the layout reads on its very first render.
 */
export const SIDEBAR_BOOT_SCRIPT = `
(function () {
  try {
    var mode = localStorage.getItem(${JSON.stringify(SIDEBAR_STORAGE_KEY)}) || "open";
    if (mode !== "open" && mode !== "collapsed" && mode !== "auto") mode = "open";
    var root = document.documentElement;
    root.setAttribute("data-sidebar", mode);
    root.style.setProperty("--sidebar-w", (mode === "open" ? ${SIDEBAR_OPEN_W} : ${SIDEBAR_RAIL_W}) + "px");
  } catch (e) {}
})();
`.trim();

function readMode(): SidebarMode {
  if (typeof document === "undefined") return "open";
  const attr = document.documentElement.getAttribute("data-sidebar");
  if (attr === "open" || attr === "collapsed" || attr === "auto") return attr;
  return "open";
}

export function useSidebarMode() {
  // Seeded from the attribute the boot script already set, so the first render
  // matches what is on screen.
  const [mode, setModeState] = useState<SidebarMode>(readMode);

  const setMode = useCallback((next: SidebarMode) => {
    setModeState(next);
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-sidebar", next);
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, next);
    } catch {
      // Private browsing — the choice just won't survive a reload.
    }
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-w",
      `${mode === "open" ? SIDEBAR_OPEN_W : SIDEBAR_RAIL_W}px`
    );
  }, [mode]);

  return { mode, setMode };
}

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
