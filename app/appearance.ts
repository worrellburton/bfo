import { useSyncExternalStore } from "react";

/**
 * How the app looks, chosen from the sidebar's Appearance panel and kept on
 * this browser: how solid the glass cards are and how tall the rows are.
 * (Light or dark lives in app/theme.tsx.) Both are applied to <html> as a
 * CSS variable and an attribute that app.css reads — and by the boot script
 * before first paint, so nothing jumps.
 */

export type Density = "compact" | "cozy" | "relaxed";

export const GLASS_KEY = "bfo-glass";
export const DENSITY_KEY = "bfo-density";
export const DENSITIES: { key: Density; label: string; hint: string }[] = [
  { key: "compact", label: "Compact", hint: "More on screen" },
  { key: "cozy", label: "Cozy", hint: "As designed" },
  { key: "relaxed", label: "Relaxed", hint: "Room to breathe" },
];

type Appearance = { glass: number; density: Density };

const read = (): Appearance => {
  let glass = 0;
  let density: Density = "cozy";
  try {
    const g = Number(localStorage.getItem(GLASS_KEY));
    if (Number.isFinite(g)) glass = Math.min(100, Math.max(0, g));
    const d = localStorage.getItem(DENSITY_KEY);
    if (d === "compact" || d === "relaxed") density = d;
  } catch {
    /* no storage: the defaults */
  }
  return { glass, density };
};

let current: Appearance = typeof window === "undefined" ? { glass: 0, density: "cozy" } : read();
const listeners = new Set<() => void>();

function apply(a: Appearance) {
  const root = document.documentElement;
  root.style.setProperty("--glass", String(a.glass / 100));
  root.setAttribute("data-density", a.density);
}

function set(patch: Partial<Appearance>) {
  current = { ...current, ...patch };
  apply(current);
  try {
    localStorage.setItem(GLASS_KEY, String(current.glass));
    localStorage.setItem(DENSITY_KEY, current.density);
  } catch {
    /* kept for this visit only */
  }
  listeners.forEach((f) => f());
}

export function useAppearance() {
  const a = useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    () => current,
    () => current,
  );
  return {
    glass: a.glass,
    density: a.density,
    setGlass: (glass: number) => set({ glass: Math.round(Math.min(100, Math.max(0, glass))) }),
    setDensity: (density: Density) => set({ density }),
    reset: () => set({ glass: 0, density: "cozy" }),
  };
}

/** Part of the boot script (app/sidebar.ts): the saved look before first paint. */
export const APPEARANCE_BOOT = `
  try {
    var g = Number(localStorage.getItem("${GLASS_KEY}"));
    document.documentElement.style.setProperty("--glass", String(isFinite(g) ? Math.min(100, Math.max(0, g)) / 100 : 0));
    var d = localStorage.getItem("${DENSITY_KEY}");
    document.documentElement.setAttribute("data-density", d === "compact" || d === "relaxed" ? d : "cozy");
  } catch (e) {}
`;
