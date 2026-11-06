/**
 * What's left of the old Appearance settings (docs/DESIGN.md §9.4, §14.2).
 * Glass and row density are gone: surfaces are solid and there is one
 * density per kind of device. Until every page has moved off the legacy
 * `.glass-card` and density rules in app.css, the boot script pins them to
 * solid and standard, whatever was saved, and forgets the old choices.
 * The theme itself lives in app/theme.tsx.
 */

/** Part of the boot script (app/sidebar.ts): solid surfaces and standard rows before first paint. */
export const APPEARANCE_BOOT = `
  try {
    document.documentElement.style.setProperty("--glass", "1");
    document.documentElement.setAttribute("data-density", "cozy");
    localStorage.removeItem("bfo-glass");
    localStorage.removeItem("bfo-density");
  } catch (e) {}
`;
