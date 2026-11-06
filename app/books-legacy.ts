/**
 * The skins Books used before the design system, kept only for pages in
 * other areas that still import them from app/books-shared (assets,
 * investments, the brand studio). Books itself draws with app/ui and the
 * tokens in docs/DESIGN.md. Delete this file when those callers move
 * (DESIGN.md §14.3: these become thin re-exports, then go).
 */

import { createElement } from "react";

/** Text tiers: t1 primary/numbers, t2 readable meta, t3 glyphs only. */
export function tiers(isDark: boolean): { t1: string; t2: string; t3: string } {
  return isDark ? { t1: "text-gray-100", t2: "text-gray-400", t3: "text-gray-500" } : { t1: "text-gray-900", t2: "text-gray-500/100", t3: "text-gray-500/80" };
}

export const MICRO = "text-xs font-semibold uppercase tracking-[0.08em]";

export function incomeTone(isDark: boolean): string {
  return isDark ? "text-emerald-400" : "text-emerald-700";
}

export function amberTone(isDark: boolean): string {
  return isDark ? "text-amber-400" : "text-amber-700";
}

export function popoverSurface(_isDark: boolean): string {
  return "glass-panel";
}

export function primaryBtn(isDark: boolean): string {
  return isDark
    ? "bg-white text-black hover:bg-gray-200 active:bg-gray-300 disabled:bg-white/20 disabled:text-white/50"
    : "bg-gray-900 text-white hover:bg-gray-800 active:bg-gray-700 disabled:bg-gray-200 disabled:text-gray-500";
}

export function outlineBtn(isDark: boolean): string {
  return isDark
    ? "border border-white/10 text-gray-200 hover:bg-white/[0.06] hover:border-white/15 disabled:opacity-40"
    : "border border-gray-200 text-gray-800 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-40";
}

export function ghostBtn(isDark: boolean): string {
  return isDark ? "text-gray-400 hover:bg-white/[0.06] hover:text-white disabled:opacity-40" : "text-gray-500/100 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40";
}

export function cardSurface(_isDark: boolean): string {
  return "glass-card";
}

export function hairline(isDark: boolean): string {
  return isDark ? "border-white/[0.06]" : "border-gray-200/70";
}

export function ruleBorder(isDark: boolean): string {
  return isDark ? "border-white/[0.08]" : "border-gray-200";
}

export function textInput(isDark: boolean): string {
  return isDark
    ? "bg-white/[0.04] border-white/10 text-gray-100 placeholder:text-gray-500 hover:border-white/15 focus:border-white/25 focus:bg-white/[0.06]"
    : "bg-white border-gray-200 text-gray-900 placeholder:text-gray-500/100 hover:border-gray-300 focus:border-gray-400";
}

export const BTN_BASE = "inline-flex items-center justify-center rounded-full font-medium transition-colors cursor-pointer disabled:cursor-default";

export const TAP = {
  box: "relative after:content-[''] after:absolute after:-inset-[10px] lg:after:inset-0",
  pill: "relative after:content-[''] after:absolute after:inset-x-0 after:-inset-y-[8.5px] lg:after:inset-0",
  line: "relative after:content-[''] after:absolute after:inset-x-0 after:-inset-y-[13px] lg:after:inset-0",
  line2: "relative after:content-[''] after:absolute after:inset-x-0 after:-inset-y-[6px] lg:after:inset-0",
  head: "relative after:content-[''] after:absolute after:inset-x-0 after:-inset-y-[12px] lg:after:inset-0",
  seg: "relative after:content-[''] after:absolute after:inset-x-0 after:-inset-y-1 sm:after:-inset-y-[10px] lg:after:inset-0",
  md: "relative after:content-[''] after:absolute after:inset-0 sm:after:-inset-[7px] lg:after:inset-0",
  avatar: "relative after:content-[''] after:absolute after:-inset-[12px] lg:after:inset-0",
};

export const TAG_PILL = "inline-flex items-center shrink-0 rounded-md text-xs font-semibold tracking-[0.04em] leading-none h-5 px-1.5";

/** Entity tags are neutral (identity takes no colour, DESIGN.md §2.4). */
export function entityTagClass(_name: string | null | undefined, _isDark: boolean): string {
  return "bg-sunken text-ink-2";
}

/** A tiny stroked icon from a single path. */
export function Icon({ d, className, strokeWidth = 1.8 }: { d: string; className?: string; strokeWidth?: number }) {
  return createElement(
    "svg",
    { className: className ?? "w-3.5 h-3.5 shrink-0", fill: "none", stroke: "currentColor", strokeWidth, viewBox: "0 0 24 24", "aria-hidden": true },
    createElement("path", { strokeLinecap: "round", strokeLinejoin: "round", d }),
  );
}

/** Every stroked glyph the legacy Books callers draw. */
export const PATHS = {
  down: "M12 4.5v15m0 0l6.75-6.75M12 19.5l-6.75-6.75",
  up: "M12 19.5v-15m0 0l6.75 6.75M12 4.5L5.25 11.25",
  swap: "M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m3-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5",
  building: "M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h6M9 10.5h6M9 14.25h6M10.5 21v-3.75h3V21",
  trend: "M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941",
  receipt: "M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0c1.1.128 1.907 1.077 1.907 2.185z",
  scale: "M12 3v17.25m-7.5-3.75h15M4.5 6.75l3 7.5 3-7.5m3 0l3 7.5 3-7.5",
  chevron: "M19.5 8.25l-7.5 7.5-7.5-7.5",
  chevronUp: "M4.5 15.75l7.5-7.5 7.5 7.5",
  chevronRight: "M8.25 4.5l7.5 7.5-7.5 7.5",
  check: "M4.5 12.75l6 6 9-13.5",
  close: "M6 18L18 6M6 6l12 12",
  search: "M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z",
  sun: "M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z",
  list: "M4 6h16M4 12h16M4 18h16",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  inbox:
    "M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3",
  sync: "M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99",
};
