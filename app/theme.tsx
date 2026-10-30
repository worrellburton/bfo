import { createContext, useContext, useState, useEffect, useLayoutEffect } from "react";

/** Before paint in the browser (no flash of the other theme); a plain effect on the server. */
const useBeforePaint = typeof window !== "undefined" ? useLayoutEffect : useEffect;
import { statusBarFor } from "./native";

type Theme = "dark" | "light";

const ThemeContext = createContext<{
  /** What's on screen: a page's own setting (Mail's) while it's open, else the app's. For colours. */
  theme: Theme;
  /** The app's own setting, which toggle and setTheme change (the Appearance panel and menu show this). */
  appTheme: Theme;
  /** A page (Mail) is showing its own light or dark instead of the app's. */
  overridden: boolean;
  toggle: () => void;
  /** Light or dark, chosen outright (the Appearance panel). */
  setTheme: (theme: Theme) => void;
  /** A page with its own light/dark setting (Mail) applies it while it's on screen; null gives the app's back. */
  setOverride: (theme: Theme | null) => void;
}>({ theme: "dark", appTheme: "dark", overridden: false, toggle: () => {}, setTheme: () => {}, setOverride: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("bfo-theme") as Theme) || "dark";
    }
    return "dark";
  });

  const [override, setOverride] = useState<Theme | null>(null);
  const effective = override ?? theme;

  useEffect(() => {
    localStorage.setItem("bfo-theme", theme);
  }, [theme]);
  useBeforePaint(() => {
    document.documentElement.classList.toggle("light", effective === "light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", effective === "light" ? "#f9fafb" : "#000000");
    statusBarFor(effective === "dark");
  }, [effective]);

  function toggle() {
    setThemeState((t) => (t === "dark" ? "light" : "dark"));
  }
  const setTheme = (t: Theme) => setThemeState(t);

  return (
    <ThemeContext.Provider value={{ theme: effective, appTheme: theme, overridden: override !== null, toggle, setTheme, setOverride }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
