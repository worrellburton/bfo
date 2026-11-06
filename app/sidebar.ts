import { APPEARANCE_BOOT } from "./appearance";
import { SIDEBAR_COLLAPSED, SIDEBAR_EXPANDED, SIDEBAR_KEY, THEME_COLOR, THEME_KEY } from "./shell-model";

/**
 * The boot script: runs in <head> before first paint (app/root.tsx), so the
 * first frame already has the right theme, browser-chrome colour and content
 * inset, with no flash (docs/DESIGN.md §2.1, §9.1, §14.2).
 *
 * - Theme: the saved setting (Automatic when none), resolved against the
 *   device; data-theme and the legacy `light` class on <html>; theme-color.
 *   The door (landing, sign-in, finish setup) is always night.
 * - The sidebar: --content-inset, the width the content sits right of (0 on
 *   phones, the 64px rail on tablets, the saved or default width on desktop).
 *   The shell keeps it current as the window changes.
 */
export const SIDEBAR_BOOT_SCRIPT = `
(function () {
  var html = document.documentElement;
  try {
    var saved = localStorage.getItem("${THEME_KEY}");
    var dark = saved === "dark" || (saved !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    html.classList.toggle("light", !dark);
    html.setAttribute("data-theme", dark ? "dark" : "light");
    var door = /^\\/(login|complete-profile)?(\\/|$)/.test(location.pathname);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", door ? "${THEME_COLOR.door}" : dark ? "${THEME_COLOR.dark}" : "${THEME_COLOR.light}");
  } catch (e) {}
  try {
    var w = window.innerWidth;
    var mode = localStorage.getItem("${SIDEBAR_KEY}");
    if (mode !== "expanded" && mode !== "collapsed") mode = w >= 1280 ? "expanded" : "collapsed";
    var inset = w < 768 ? 0 : w < 1024 ? ${SIDEBAR_COLLAPSED} : mode === "expanded" ? ${SIDEBAR_EXPANDED} : ${SIDEBAR_COLLAPSED};
    html.style.setProperty("--content-inset", inset + "px");
  } catch (e) {}
  ${APPEARANCE_BOOT}
})();
`.trim();
