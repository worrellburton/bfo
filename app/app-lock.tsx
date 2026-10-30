import { useEffect, useRef, useState } from "react";
import { isNativeApp } from "./native";

/**
 * Face ID lock for the iPhone app. When it's on (the default wherever the
 * phone has Face ID, Touch ID or a passcode), BFO opens behind a cover and
 * asks for Face ID before showing anything; leaving the app covers it at once,
 * so the app switcher never shows mail or accounts, and coming back after more
 * than a minute asks again. The passcode works when Face ID doesn't. The
 * account menu turns it off (useAppLockSetting). On the web it does nothing.
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

type LockKind = "Face ID" | "Touch ID" | "Passcode";

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

async function verify(kind: LockKind | null): Promise<boolean> {
  try {
    const { NativeBiometric } = await loadBio();
    await NativeBiometric.verifyIdentity({ reason: "Unlock BFO", title: "Unlock BFO", subtitle: kind === "Passcode" ? undefined : `Use ${kind ?? "Face ID"}`, useFallback: true });
    return true;
  } catch {
    return false;
  }
}

/** The account menu's switch. */
export function useAppLockSetting(): { kind: LockKind | null; on: boolean; set: (on: boolean) => void } {
  const [kind, setKind] = useState<LockKind | null>(null);
  const [on, setOn] = useState(true);
  useEffect(() => {
    setOn(settingOn());
    void lockAvailable().then(setKind);
  }, []);
  return {
    kind,
    on,
    set: (next) => {
      try {
        localStorage.setItem(SETTING_KEY, next ? "on" : "off");
      } catch {
        // for this visit only
      }
      setOn(next);
    },
  };
}

/** The cover itself. Mounted once in the signed-in shell. */
export function AppLock() {
  const native = typeof window !== "undefined" && isNativeApp();
  // Covered from the very first frame when the lock is on, so nothing shows before Face ID.
  const [state, setState] = useState<"open" | "locked" | "cover">(() => (native && settingOn() ? "locked" : "open"));
  const [kind, setKind] = useState<LockKind | null>(null);
  const verifying = useRef(false);
  const hiddenAt = useRef<number | null>(null);
  const kindRef = useRef<LockKind | null>(null);
  kindRef.current = kind;

  const unlock = async (k: LockKind | null) => {
    if (verifying.current) return;
    verifying.current = true;
    const ok = await verify(k);
    // Face ID's sheet makes the app briefly inactive; let that settle before listening again.
    window.setTimeout(() => {
      verifying.current = false;
    }, 600);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!native) return;
    let handle: { remove: () => Promise<void> } | null = null;
    void import("@capacitor/app").then(({ App }) =>
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
          setState("locked");
          void unlock(k);
        } else setState((s) => (s === "cover" ? "open" : s));
      }).then((h) => {
        handle = h;
      }),
    ).catch(() => undefined);
    return () => {
      void handle?.remove();
    };
    // One listener for the app's life; it reads the current values through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "open") return null;
  return (
    <div className="app-lock fixed inset-0 z-[300] flex flex-col items-center justify-center gap-6 bg-[#0a0a0a] px-8 text-center" role="dialog" aria-modal="true" aria-label="BFO is locked">
      <img src="/icon-192.png" alt="" className="h-[76px] w-[76px] rounded-[18px]" />
      {state === "locked" && (
        <>
          <p className="text-[17px] font-semibold text-white">BFO is locked</p>
          <button
            type="button"
            onClick={() => void unlock(kind)}
            className="inline-flex h-[48px] min-w-[220px] cursor-pointer items-center justify-center gap-2 rounded-full bg-white px-6 text-[15px] font-semibold text-black active:scale-[0.98]"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden="true">
              <path d="M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M20 16v2a2 2 0 01-2 2h-2M8 20H6a2 2 0 01-2-2v-2M9 9.5v1M15 9.5v1M12 9.5v3.5h-1M9.5 16c1.4 1 3.6 1 5 0" />
            </svg>
            Unlock with {kind ?? "Face ID"}
          </button>
        </>
      )}
    </div>
  );
}
