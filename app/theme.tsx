import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState } from "react";
import { statusBarFor } from "./native";
import { parseThemeSetting, resolveTheme, THEME_COLOR, THEME_KEY, type Theme, type ThemeSetting } from "./shell-model";

/**
 * The app's one theme (docs/DESIGN.md §2.1, §14.2): Automatic (follows the
 * device; the default), Light or Dark, kept on this device as `bfo-theme`.
 * What's on screen is applied to <html> as data-theme (the tokens follow it)
 * and, until the rescue layer goes, the `light` class; the browser chrome's
 * colour and the iPhone status bar follow. The boot script (app/sidebar.ts)
 * does the same before first paint. No page has a theme of its own.
 */

export type { Theme, ThemeSetting };

/** Before paint in the browser (no flash of the other theme); a plain effect on the server. */
const useBeforePaint = typeof window !== "undefined" ? useLayoutEffect : useEffect;

type ThemeContextValue = {
  /** What's on screen: "light" or "dark". For anything that still needs to know. */
  theme: Theme;
  /** The setting: Automatic, Light or Dark. */
  setting: ThemeSetting;
  setSetting: (s: ThemeSetting) => void;
  /** Light ↔ dark, chosen outright (the palette's action). */
  toggle: () => void;
  /** @deprecated The setting is the app's alone; read `setting`. Kept so existing callers compile. */
  appTheme: Theme;
  /** @deprecated No page overrides the theme any more (Mail's own switch is retired); always false. */
  overridden: boolean;
  /** @deprecated Chooses Light or Dark outright; use setSetting. */
  setTheme: (t: Theme) => void;
  /** @deprecated A no-op: no page has a theme of its own (§2.1). */
  setOverride: (t: Theme | null) => void;
};

const noop = () => {};
const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  setting: "auto",
  setSetting: noop,
  toggle: noop,
  appTheme: "dark",
  overridden: false,
  setTheme: noop,
  setOverride: noop,
});

const prefersDark = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;

function readSetting(): ThemeSetting {
  try {
    return parseThemeSetting(localStorage.getItem(THEME_KEY));
  } catch {
    return "auto";
  }
}

/** Puts a theme on the document: data-theme, the legacy class, the browser chrome and the status bar. */
export function applyTheme(theme: Theme) {
  const html = document.documentElement;
  html.classList.toggle("light", theme === "light");
  html.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  statusBarFor(theme === "dark");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [setting, setSettingState] = useState<ThemeSetting>(() => (typeof window === "undefined" ? "auto" : readSetting()));
  const [deviceDark, setDeviceDark] = useState(prefersDark);
  const theme = resolveTheme(setting, deviceDark);

  // Automatic follows the device as it changes (sunset, a Control Center switch).
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const sync = () => setDeviceDark(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useBeforePaint(() => applyTheme(theme), [theme]);

  const setSetting = useCallback((s: ThemeSetting) => {
    setSettingState(s);
    try {
      if (s === "auto") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, s);
    } catch {
      // Kept for this visit only.
    }
  }, []);
  const toggle = useCallback(() => setSetting(theme === "dark" ? "light" : "dark"), [setSetting, theme]);

  return (
    <ThemeContext.Provider value={{ theme, setting, setSetting, toggle, appTheme: theme, overridden: false, setTheme: setSetting, setOverride: noop }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
