import { useEffect } from "react";
import type { BrandFont, Finish } from "./brand";

/**
 * The chosen lockup as live type: "BURTON FAMILY OFFICE" small above a large
 * "BFO", in the style's Google font and finish (app.css .brand-*). The font is
 * loaded the first time it's on the page and published as --font-brand.
 */

const loaded = new Set<string>();

export function loadBrandFont(font: BrandFont) {
  if (typeof document === "undefined" || loaded.has(font.css)) return;
  loaded.add(font.css);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${font.css}&display=swap`;
  document.head.appendChild(link);
}

export function useBrandFont(font: BrandFont | undefined) {
  useEffect(() => {
    if (!font) return;
    loadBrandFont(font);
    document.documentElement.style.setProperty("--font-brand", `"${font.family}", Georgia, serif`);
  }, [font?.css, font?.family]);
}

export function BrandLockup({
  font,
  finish = "ivory",
  size,
  name = true,
  className = "",
}: {
  font: BrandFont;
  finish?: Finish;
  /** hero: the landing page; compact: above the sign-in card; mark: just "BFO", sized by the caller's class. */
  size: "hero" | "compact" | "mark";
  name?: boolean;
  className?: string;
}) {
  useBrandFont(font);
  const family = { fontFamily: `"${font.family}", Georgia, serif`, fontWeight: font.weight };
  return (
    <span className={`brand-lockup brand-lockup-${size} brand-${finish} ${className}`} style={family} aria-label="Burton Family Office">
      {name && size !== "mark" && <span className="brand-lockup-name" aria-hidden>Burton Family Office</span>}
      <span className="brand-lockup-mark" aria-hidden>BFO</span>
    </span>
  );
}
