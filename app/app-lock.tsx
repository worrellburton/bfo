import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isNativeApp } from "./native";
import { lockupOf, useBrandLogo } from "./brand";
import { Wordmark } from "./brand-lockup";
import { lockRequired } from "./shell-model";
import type { Role } from "./auth";
import { usePresence } from "./ui";
import { overlayRoot } from "./ui/portal";
import { modalAria } from "./shell-overlay";

/**
 * Face ID lock for the iPhone app. When it's on (the default wherever the
 * phone has Face ID, Touch ID or a passcode), BFO opens behind a cover and
 * asks for Face ID before showing anything; leaving the app covers it at
 * once, so the app switcher never shows mail or accounts, and coming back
 * after more than a minute asks again. The passcode works when Face ID
 * doesn't. On the web it does nothing.
 *
 * While the cover is up, everything behind it is inert, so neither a
 * keyboard nor VoiceOver can reach the page. Turning the lock off takes Face
 * ID first, and anyone who can see the office's codes or change the books
 * can't turn it off at all (shell-model lockRequired). The cover is the
 * door's: black, the ivory wordmark, one ivory button (docs/DESIGN.md §2.7).
 */

const SETTING_KEY = "bfo-face-id";
const LOCK_AFTER_MS = 60_000;

type Bio = typeof import("@capgo/capacitor-native-biometric");
let bioMod: Promise<Bio> | null = null;
const loadBio = () => (bioMod ??= import("@capgo/capacitor-native-biometric"));

function settingOn(): boolean {
  try {
    return localStorage.getItem(SETTING_KEY) !== "off";
  } catch {
    return true;
  }
}

export type LockKind = "Face ID" | "Touch ID" | "Passcode";

/** What this phone can unlock with, or null when it can't (no passcode set, or not the app). */
async function lockAvailable(): Promise<LockKind | null> {
  if (!isNativeApp()) return null;
  try {
    const { NativeBiometric, BiometryType } = await loadBio();
    const r = await NativeBiometric.isAvailable({ useFallback: true });
    if (!r.isAvailable) return null;
    return r.biometryType === BiometryType.FACE_ID ? "Face ID" : r.biometryType === BiometryType.TOUCH_ID ? "Touch ID" : "Passcode";
  } catch {
    return null;
  }
}

async function verify(kind: LockKind | null, reason = "Unlock BFO"): Promise<boolean> {
  try {
    const { NativeBiometric } = await loadBio();
    await NativeBiometric.verifyIdentity({ reason, title: reason, subtitle: kind === "Passcode" ? undefined : `Use ${kind ?? "Face ID"}`, useFallback: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Proves the person holding the phone is its owner before something that
 * changes who is signed in (switching accounts). True at once on the web
 * and on a phone without a lock.
 */
export async function confirmIdentity(reason: string): Promise<boolean> {
  if (!isNativeApp() || !settingOn()) return true;
  const kind = await lockAvailable();
  return kind ? verify(kind, reason) : true;
}

/** The lock's switch, for Settings › This device. Turning it off asks for Face ID; some roles can't. */
export function useAppLockSetting(role?: Role | null): { kind: LockKind | null; on: boolean; required: boolean; set: (on: boolean) => Promise<boolean> } {
  const [kind, setKind] = useState<LockKind | null>(null);
  const [on, setOn] = useState(true);
  const required = lockRequired(role);
  useEffect(() => {
    setOn(settingOn());
    void lockAvailable().then(setKind);
  }, []);
  return {
    kind,
    on: on || required,
    required,
    set: async (next) => {
      if (!next && (required || !(await verify(kind, "Turn off the lock")))) return false;
      try {
        localStorage.setItem(SETTING_KEY, next ? "on" : "off");
      } catch {
        // for this visit only
      }
      setOn(next);
      return true;
    },
  };
}

/** Makes everything but the cover inert while it's up, and gives back only what it took. */
function useInertBehind(on: boolean, host: HTMLElement | null) {
  useLayoutEffect(() => {
    if (!on || !host) return;
    const root = overlayRoot();
    const taken: HTMLElement[] = [];
    const candidates = [...(document.body.children as HTMLCollectionOf<HTMLElement>), ...(root.children as HTMLCollectionOf<HTMLElement>)];
    for (const el of candidates) {
      if (el === root || el === host || el.tagName === "SCRIPT" || el.inert) continue;
      el.inert = true;
      taken.push(el);
    }
    return () => {
      for (const el of taken) el.inert = false;
    };
  }, [on, host]);
}

let lockHost: HTMLElement | null = null;
function host(): HTMLElement {
  const root = overlayRoot();
  if (!lockHost || !lockHost.isConnected) {
    lockHost = document.createElement("div");
    lockHost.setAttribute("data-app-lock", "");
    root.prepend(lockHost);
  }
  return lockHost;
}

/** The cover itself. Mounted once in the signed-in shell. */
export function AppLock() {
  const native = typeof window !== "undefined" && isNativeApp();
  // Covered from the very first frame when the lock is on, so nothing shows before Face ID.
  const [state, setState] = useState<"open" | "locked" | "cover">(() => (native && settingOn() ? "locked" : "open"));
  const [kind, setKind] = useState<LockKind | null>(null);
  const [failed, setFailed] = useState(false);
  const verifying = useRef(false);
  const hiddenAt = useRef<number | null>(null);
  const kindRef = useRef<LockKind | null>(null);
  kindRef.current = kind;
  const logo = useBrandLogo();
  const covered = state !== "open";
  const { mounted, leaving } = usePresence(covered, 200);
  const el = mounted && typeof document !== "undefined" ? host() : null;
  useInertBehind(covered, el);

  const unlock = async (k: LockKind | null) => {
    if (verifying.current) return;
    verifying.current = true;
    const ok = await verify(k);
    // Face ID's sheet makes the app briefly inactive; let that settle before listening again.
    window.setTimeout(() => {
      verifying.current = false;
    }, 600);
    setFailed(!ok);
    if (ok) setState("open");
  };

  useEffect(() => {
    if (!native) return;
    let alive = true;
    void (async () => {
      const k = await lockAvailable();
      if (!alive) return;
      setKind(k);
      if (!settingOn() || !k) setState("open");
      else void unlock(k);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!native) return;
    let handle: { remove: () => Promise<void> } | null = null;
    void import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("appStateChange", ({ isActive }) => {
          if (verifying.current || !settingOn()) return;
          if (!isActive) {
            hiddenAt.current = Date.now();
            setState((s) => (s === "open" ? "cover" : s));
            return;
          }
          const away = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
          hiddenAt.current = null;
          const k = kindRef.current;
          if (away > LOCK_AFTER_MS && k) {
            setFailed(false);
            setState("locked");
            void unlock(k);
          } else setState((s) => (s === "cover" ? "open" : s));
        }).then((h) => {
          handle = h;
        }),
      )
      .catch(() => undefined);
    return () => {
      void handle?.remove();
    };
    // One listener for the app's life; it reads the current values through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!el) return null;
  const what = kind ?? "Face ID";
  return createPortal(
    <div
      data-theme="dark"
      {...modalAria("BFO is locked")}
      style={{ zIndex: 100 }}
      className={`ds fixed inset-0 flex flex-col items-center bg-brand-ink px-8 text-center text-brand-ivory ${leaving ? "ds-scrim-out" : ""}`}
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-3 pb-[10vh]">
        <Wordmark font={lockupOf(logo).font} size={44} />
        {state === "locked" && <p className="text-body text-door-ink-2">Locked</p>}
      </div>
      {state === "locked" && (
        <div className="flex w-full max-w-[320px] flex-col items-center gap-3" style={{ paddingBottom: "calc(48px + env(safe-area-inset-bottom))" }}>
          {failed && (
            <p role="status" className="text-small text-door-ink-2 text-pretty">
              {what === "Passcode" ? "That didn’t work. Try again." : `${what} didn’t work. Try again, or use your passcode.`}
            </p>
          )}
          <button
            type="button"
            onClick={() => void unlock(kind)}
            className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-brand-ivory px-6 text-body font-medium text-brand-ink focus-visible:outline-brand-ivory! focus-visible:outline-offset-[3px]!"
          >
            Unlock with {what}
          </button>
        </div>
      )}
    </div>,
    el,
  );
}
