/** The toast region (docs/DESIGN.md §8.16); see toast.ts. */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cx } from "./cx";
import { currentToast, setToast, subscribeToast, type CurrentToast } from "./toast-store";

/** Where toasts appear: bottom centre of the content column (§8.16). Mounted once, by toast(). */
export function ToastRegion() {
  const t = useSyncExternalStore(subscribeToast, currentToast, () => null);
  const [shown, setShown] = useState<CurrentToast | null>(null);
  const [leaving, setLeaving] = useState(false);
  const paused = useRef(false);
  const timer = useRef<number | null>(null);
  const left = useRef(0);
  const started = useRef(0);

  useEffect(() => {
    if (t) {
      setShown(t);
      setLeaving(false);
    } else if (shown) setLeaving(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  useEffect(() => {
    if (!leaving) return;
    const id = window.setTimeout(() => {
      setShown(null);
      setLeaving(false);
    }, 160);
    return () => window.clearTimeout(id);
  }, [leaving]);

  const stop = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const run = (ms: number) => {
    stop();
    started.current = Date.now();
    left.current = ms;
    timer.current = window.setTimeout(() => {
      if (currentToast()?.id === shown?.id) setToast(null);
    }, ms);
  };
  useEffect(() => {
    if (!shown || leaving) return;
    paused.current = false;
    run(shown.duration ?? (shown.action ? 8000 : 5000));
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown?.id, leaving]);
  const pause = () => {
    if (paused.current || !timer.current) return;
    paused.current = true;
    left.current -= Date.now() - started.current;
    stop();
  };
  const resume = () => {
    if (!paused.current) return;
    paused.current = false;
    run(Math.max(1500, left.current));
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="ds pointer-events-none fixed z-toast flex justify-center px-4"
      style={{
        left: "var(--content-inset, var(--inset, 0px))",
        right: 0,
        bottom: "var(--toast-bottom)",
      }}
    >
      {shown && (
        <div
          key={shown.id}
          onPointerEnter={pause}
          onPointerLeave={resume}
          onFocus={pause}
          onBlur={resume}
          className={cx(
            "pointer-events-auto flex min-h-[44px] w-full max-w-[420px] items-center gap-4 rounded-card border border-line-strong bg-overlay py-3 pr-3 pl-4 text-body text-ink shadow-(--elevation-2)",
            leaving ? "ds-toast-out" : "ds-toast-in",
          )}
        >
          <span className="min-w-0 flex-1 line-clamp-2">{shown.message}</span>
          {shown.action && (
            <button
              type="button"
              onClick={() => {
                shown.action!.run();
                setToast(null);
              }}
              className="-my-2 inline-flex min-h-[32px] shrink-0 cursor-pointer items-center rounded-control px-2 text-body font-medium text-accent hover:text-accent-hover hover:underline touch:min-h-[44px]"
            >
              {shown.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
