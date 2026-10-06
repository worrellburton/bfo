import { useEffect, useState } from "react";
import { useNavigation } from "react-router";

/**
 * A thin bar across the top while the next page's code loads, so a tap on
 * slow mobile data visibly did something. Waits 120ms before showing, so
 * instant navigations don't flash it.
 */
export function RouteProgress() {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!busy) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), 120);
    return () => clearTimeout(t);
  }, [busy]);
  if (!visible) return null;
  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      className="route-progress pointer-events-none fixed inset-x-0 top-0 z-[100] h-[2px]"
      style={{ marginTop: "env(safe-area-inset-top)" }}
    />
  );
}

/** Says so when the device drops offline, and briefly when it's back. */
export function OfflineBanner({ isDark }: { isDark: boolean }) {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [back, setBack] = useState(false);
  useEffect(() => {
    const up = () => {
      setOnline(true);
      setBack(true);
    };
    const down = () => {
      setOnline(false);
      setBack(false);
    };
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  useEffect(() => {
    if (!back) return;
    const t = setTimeout(() => setBack(false), 2500);
    return () => clearTimeout(t);
  }, [back]);
  if (online && !back) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-[95] flex justify-center px-4"
      style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
    >
      <div
        className={`toast-in flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] shadow-lg backdrop-blur-xl ${
          isDark ? "border-white/10 bg-black/80 text-gray-200" : "border-gray-200 bg-white/90 text-gray-700"
        }`}
      >
        <span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-500" : "bg-amber-500"}`} />
        {online ? "Back online" : "You're offline — changes won't save until you reconnect"}
      </div>
    </div>
  );
}
