import { createContext, useContext, useState, useEffect } from "react";
import type { BackgroundId } from "./webgl-backgrounds";

type Theme = "dark" | "light";

const ThemeContext = createContext<{
  theme: Theme;
  toggle: () => void;
  backgroundId: BackgroundId;
  setBackgroundId: (id: BackgroundId) => void;
}>({ theme: "dark", toggle: () => {}, backgroundId: "none", setBackgroundId: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("bfo-theme") as Theme) || "light";
    }
    return "light";
  });

  const [backgroundId, setBackgroundIdState] = useState<BackgroundId>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("bfo-bg") as BackgroundId) || "none";
    }
    return "none";
  });

  useEffect(() => {
    localStorage.setItem("bfo-theme", theme);
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  function toggle() {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }

  function setBackgroundId(id: BackgroundId) {
    setBackgroundIdState(id);
    localStorage.setItem("bfo-bg", id);
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle, backgroundId, setBackgroundId }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
