import { createContext, useContext, useState, useEffect, useLayoutEffect } from "react";

/** Before paint in the browser (no flash of the other theme); a plain effect on the server. */
const useBeforePaint = typeof window !== "undefined" ? useLayoutEffect : useEffect;
import type { BackgroundId } from "./webgl-backgrounds";
import { statusBarFor } from "./native";

type Theme = "dark" | "light";

const ThemeContext = createContext<{
  theme: Theme;
  toggle: () => void;
  /** Light or dark, chosen outright (the Appearance panel). */
  setTheme: (theme: Theme) => void;
  backgroundId: BackgroundId;
  setBackgroundId: (id: BackgroundId) => void;
  /** A page with its own light/dark setting (Mail) applies it while it's on screen; null gives the app's back. */
  setOverride: (theme: Theme | null) => void;
}>({ theme: "dark", toggle: () => {}, setTheme: () => {}, backgroundId: "none", setBackgroundId: () => {}, setOverride: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("bfo-theme") as Theme) || "dark";
    }
    return "dark";
  });

  const [backgroundId, setBackgroundIdState] = useState<BackgroundId>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("bfo-bg") as BackgroundId) || "none";
    }
    return "none";
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

  function setBackgroundId(id: BackgroundId) {
    setBackgroundIdState(id);
    localStorage.setItem("bfo-bg", id);
  }

  return (
    <ThemeContext.Provider value={{ theme: effective, toggle, setTheme, backgroundId, setBackgroundId, setOverride }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
