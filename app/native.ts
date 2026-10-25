import { Capacitor } from "@capacitor/core";

/**
 * The iPhone app (capacitor.config.ts, ios/) opens this site inside a native
 * shell; Capacitor's bridge is present there and nowhere else. These helpers
 * use native features when it is, and fall back quietly on the web:
 *
 *   haptic()            a light tap (Safari on iPhone ignores navigator.vibrate)
 *   statusBarFor(dark)  light or dark status-bar text to match the page
 *
 * Plugins are loaded only inside the app, so the web bundle carries none of them.
 */

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

type HapticsModule = typeof import("@capacitor/haptics");
type StatusBarModule = typeof import("@capacitor/status-bar");
let haptics: Promise<HapticsModule> | null = null;
let statusBar: Promise<StatusBarModule> | null = null;
const loadHaptics = () => (haptics ??= import("@capacitor/haptics"));
const loadStatusBar = () => (statusBar ??= import("@capacitor/status-bar"));

// Inside the app, load the plugins up front so the first tap isn't late.
if (typeof window !== "undefined" && isNativeApp()) {
  void loadHaptics();
  void loadStatusBar();
}

/** A light tap: native haptics in the app, a short vibration where the browser allows it. */
export function haptic(strength: "light" | "medium" = "light") {
  if (isNativeApp()) {
    void loadHaptics()
      .then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: strength === "medium" ? ImpactStyle.Medium : ImpactStyle.Light }))
      .catch(() => undefined);
    return;
  }
  try {
    (navigator as Navigator & { vibrate?: (p: number) => boolean }).vibrate?.(strength === "medium" ? 14 : 8);
  } catch {
    // no haptics here
  }
}

/** The status bar's text in the app: light over a dark page, dark over a light one. */
export function statusBarFor(dark: boolean) {
  if (!isNativeApp()) return;
  void loadStatusBar()
    .then(({ StatusBar, Style }) => StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }))
    .catch(() => undefined);
}
