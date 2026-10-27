import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTheme } from "../theme";
import { MAIL_THEME_KEY } from "./constants";
import { tap } from "./helpers";

export function useMailTheme() {
  /** Mail's own light/dark setting: light unless switched, kept on the device, applied only while Mail is on screen. */
  const { setOverride } = useTheme();
  const themeFadeTimer = useRef<number | undefined>(undefined);
  const [mailTheme, setMailTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    try {
      setMailTheme(localStorage.getItem(MAIL_THEME_KEY) === "dark" ? "dark" : "light");
    } catch {
      // Private mode: light it is.
    }
  }, []);
  // Applied before paint, so the page never shows a frame of the other theme.
  useLayoutEffect(() => {
    setOverride(mailTheme);
  }, [mailTheme, setOverride]);
  useEffect(() => () => setOverride(null), [setOverride]);
  const mailThemeRef = useRef(mailTheme);
  mailThemeRef.current = mailTheme;
  function toggleMailTheme() {
    // Read from the ref, so two quick taps go there and back.
    const next = mailThemeRef.current === "dark" ? "light" : "dark";
    mailThemeRef.current = next;
    // Colours ease across for a moment (app.css, .theme-switching); the aurora eases its own underneath.
    const root = document.documentElement;
    root.classList.add("theme-switching");
    window.clearTimeout(themeFadeTimer.current);
    themeFadeTimer.current = window.setTimeout(() => root.classList.remove("theme-switching"), 420);
    setMailTheme(next);
    setOverride(next);
    try {
      localStorage.setItem(MAIL_THEME_KEY, next);
    } catch {
      // Then it lasts the visit.
    }
    tap();
  }
  return { toggleMailTheme };
}
