import { useEffect, useState } from "react";
import { useEntity } from "./context";
import { Disclosure, Icon, IconButton, useTone } from "./ui";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const isFiled = (note: string) => note.startsWith("Filed") || note.startsWith("Read");

/**
 * Floating status while documents are read (a library scan, or uploads being
 * filed). Hides itself 12 s after a scan ends (the timer lives in scanLibrary),
 * unless Results has been opened; an upload-only toast goes away when
 * `sorting` returns to 0.
 */
export function ScanToast() {
  const { page } = useEntity();
  const t = useTone();
  const { scan, sorting, aiDown, setScan, scanHideTimer } = page;
  // Once Results is opened, keep the toast until it is dismissed.
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!scan) setHeld(false);
    else if (held && scanHideTimer.current) clearTimeout(scanHideTimer.current);
  }, [scan, held, scanHideTimer]);
  if (!scan && sorting <= 0) return null;

  const total = scan?.total ?? 0;
  const done = scan?.done ?? 0;
  const notes = scan?.notes ?? [];
  const finished = !!scan?.finished && sorting === 0;
  const filed = notes.filter(isFiled).length;
  const pct = scan && total ? (done / total) * 100 : null;
  const indeterminate = !finished && (pct == null || pct === 0);

  const title = finished
    ? filed
      ? `Done — ${plural(filed, "update")}`
      : aiDown
        ? "Paused — nothing filed"
        : "Done — nothing new found"
    : scan
      ? `Reading documents · ${Math.min(done + 1, total)} of ${total}`
      : `Reading ${plural(sorting, "document")}…`;

  const detail = aiDown
    ? "Paused — the document reader is unavailable."
    : finished
      ? `${plural(total, "document")} checked`
      : scan?.current ?? null;

  const fill = finished ? "bg-emerald-500" : t.dark ? "bg-[#818cf8]" : "bg-[#4f46e5]";
  const good = t.dark ? "text-emerald-400" : "text-emerald-600";

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 lg:bottom-6"
    >
      <style>
        {"@keyframes entity-toast-in{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}" +
          "@keyframes entity-bar{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}"}
      </style>
      <div
        className={`pointer-events-auto w-full max-w-[440px] overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-xl motion-safe:animate-[entity-toast-in_320ms_cubic-bezier(0.16,1,0.3,1)_both] ${
          t.dark ? "border-white/10 bg-[#0d0f17]/95 shadow-black/60" : "border-gray-200 bg-white/95 shadow-gray-900/15"
        }`}
      >
        <div className="flex items-center gap-3 px-5 pb-2.5 pt-3">
          {finished ? (
            <Icon name="check" className={`h-3.5 w-3.5 ${good}`} strokeWidth={2.5} />
          ) : (
            <Icon name="sparkle" className={`h-3.5 w-3.5 motion-safe:animate-pulse ${t.accent}`} />
          )}
          <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 leading-snug">
            <span className={`text-[13px] font-semibold tabular-nums ${t.text}`}>{title}</span>
            {detail && (
              <span className={`max-w-full truncate text-[12px] ${t.muted}`} title={detail}>
                {detail}
              </span>
            )}
          </p>
          {finished && <IconButton icon="x" label="Dismiss" onClick={() => setScan(null)} className="-my-1 -mr-2" />}
        </div>

        <div className="px-5 pb-3">
          <div className={`h-1 overflow-hidden rounded-full ${t.dark ? "bg-white/[0.07]" : "bg-gray-100"}`}>
            {indeterminate ? (
              <div className={`h-full w-1/3 rounded-full motion-safe:animate-[entity-bar_1.4s_ease-in-out_infinite] ${fill}`} />
            ) : (
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${fill}`}
                style={{ width: `${finished ? 100 : Math.max(6, pct ?? 0)}%` }}
              />
            )}
          </div>
        </div>

        {notes.length > 0 && (
          <div className={`border-t ${t.line}`} onClickCapture={() => setHeld(true)}>
            <Disclosure label="Results" count={notes.length}>
              <ul className="max-h-36 space-y-1 overflow-y-auto px-5 pb-3">
                {notes.map((n, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px] leading-snug">
                    <Icon
                      name={isFiled(n) ? "check" : "doc"}
                      className={`mt-px h-3 w-3 ${isFiled(n) ? good : t.muted}`}
                      strokeWidth={isFiled(n) ? 2.25 : 1.75}
                    />
                    <span className={`min-w-0 break-words ${isFiled(n) ? t.text : t.muted}`}>{n}</span>
                  </li>
                ))}
              </ul>
            </Disclosure>
          </div>
        )}
      </div>
    </div>
  );
}
