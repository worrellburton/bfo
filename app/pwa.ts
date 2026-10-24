import { useEffect, useState } from "react";

/**
 * BFO as an installed app (Chrome's "Install BFO"; public/manifest.webmanifest
 * and public/sw.js). Registers the service worker, keeps Chrome's install
 * offer for when someone asks for it (the user menu's "Install app"), and
 * knows when the app is already running installed.
 */

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let offer: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

/** Called once on the client (app/root.tsx). */
export function startPwa() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // offered from the menu, not as a browser bar
    offer = e as InstallPrompt;
    changed();
  });
  window.addEventListener("appinstalled", () => {
    offer = null;
    changed();
  });
  // Dev servers serve their own modules; only the built site gets the worker.
  if ("serviceWorker" in navigator && !import.meta.env.DEV) {
    const register = () => navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("service worker didn't register", err));
    if (document.readyState === "complete") void register();
    else window.addEventListener("load", () => void register(), { once: true });
  }
}

/** Running as the installed app (its own window), not in a browser tab. */
export function installed(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Whether the browser will install BFO right now, and doing it. */
export function useInstall(): { canInstall: boolean; install: () => Promise<boolean> } {
  const [, setTick] = useState(0);
  useEffect(() => {
    const f = () => setTick((n) => n + 1);
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  }, []);
  return {
    canInstall: !!offer && !installed(),
    install: async () => {
      if (!offer) return false;
      const o = offer;
      await o.prompt();
      const { outcome } = await o.userChoice;
      offer = null; // Chrome's offer is good for one prompt
      changed();
      return outcome === "accepted";
    },
  };
}
