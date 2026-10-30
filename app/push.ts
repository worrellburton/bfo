import { useEffect, useState } from "react";
import { authFetch, getToken } from "./auth";
import { notifyMailChanged } from "./mail-client";
import { isNativeApp } from "./native";

/**
 * Push notifications in the iPhone app (lib/push.ts sends them). Once someone
 * allows them, the phone registers with Apple on every launch and tells BFO
 * its token under the current account; a notice for new mail opens that
 * message when tapped, and refreshes the list when it arrives with the app
 * open. On the web all of this is a no-op.
 */

type PushModule = typeof import("@capacitor/push-notifications");
let mod: Promise<PushModule> | null = null;
const load = () => (mod ??= import("@capacitor/push-notifications"));

export type PushState = "unsupported" | "prompt" | "granted" | "denied";

const TOKEN_KEY = "bfo-push-token";
let navigateTo: ((url: string) => void) | null = null;
let listening = false;

function savedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

async function listen() {
  if (listening) return;
  listening = true;
  const { PushNotifications } = await load();
  await PushNotifications.addListener("registration", ({ value }) => {
    try {
      localStorage.setItem(TOKEN_KEY, value);
    } catch {
      // kept for this visit only
    }
    void authFetch("/api/push", { method: "POST", body: JSON.stringify({ action: "register", token: value, platform: "ios" }) }).catch(() => undefined);
  });
  await PushNotifications.addListener("registrationError", (e) => console.warn("push: registration failed", e.error));
  // A notice arriving while the app is open: the list catches up.
  await PushNotifications.addListener("pushNotificationReceived", () => notifyMailChanged());
  // Tapped: open what it's about (Capacitor holds a cold-launch tap until this listener exists).
  await PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
    const url = (notification.data as { url?: unknown } | undefined)?.url;
    if (typeof url === "string" && url.startsWith("/")) {
      if (navigateTo) navigateTo(url);
      else window.location.assign(url);
    }
  });
}

async function pushState(): Promise<PushState> {
  if (!isNativeApp()) return "unsupported";
  try {
    const { PushNotifications } = await load();
    const { receive } = await PushNotifications.checkPermissions();
    return receive === "granted" ? "granted" : receive === "denied" ? "denied" : "prompt";
  } catch {
    return "unsupported";
  }
}

/** Ask (iOS shows its own dialog once), and register if allowed. */
export async function enablePush(): Promise<PushState> {
  if (!isNativeApp()) return "unsupported";
  const { PushNotifications } = await load();
  await listen();
  const { receive } = await PushNotifications.requestPermissions();
  if (receive !== "granted") return receive === "denied" ? "denied" : "prompt";
  await PushNotifications.register();
  return "granted";
}

/**
 * The signed-in shell (app-layout): on each launch and each account change,
 * register again if notifications are allowed, so the token stays current and
 * belongs to whoever is signed in.
 */
export function usePush(userId: string | null, navigate: (url: string) => void) {
  useEffect(() => {
    navigateTo = navigate;
  }, [navigate]);
  useEffect(() => {
    if (!userId || !isNativeApp()) return;
    let alive = true;
    void (async () => {
      await listen();
      if (alive && (await pushState()) === "granted") {
        const { PushNotifications } = await load();
        await PushNotifications.register();
      }
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [userId]);
}

/** Signing out: this phone stops getting that account's notices. Call before the session is cleared. */
export function forgetPushDevice() {
  const token = savedToken();
  const session = getToken();
  if (!token || !session || !isNativeApp()) return;
  void fetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
    body: JSON.stringify({ action: "unregister", token }),
  }).catch(() => undefined);
}

/** For the Mail invitation: whether to offer it. */
export function usePushState(): [PushState, (s: PushState) => void] {
  const [state, setState] = useState<PushState>("unsupported");
  useEffect(() => {
    void pushState().then(setState);
  }, []);
  return [state, setState];
}
