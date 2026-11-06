import { useEffect, useState } from "react";
import { Disclosure, Icon, IconButton, cx } from "../ui";
import { useEntity } from "./context";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const isFiled = (note: string) => note.startsWith("Filed") || note.startsWith("Read");

/**
 * The status of documents being read (a library scan, or uploads being
 * filed), floating at the bottom of the content like a toast (§8.16): one
 * line, a progress line, and the results behind a disclosure. It hides 12 s
 * after a scan ends (the timer lives in scanLibrary) unless Results has been
 * opened; an upload-only one goes when `sorting` returns to 0.
 */
export function ScanToast() {
  const { page } = useEntity();
  const { scan, sorting, aiDown, setScan, scanHideTimer } = page;
  // Once Results is opened, keep it until it's dismissed.
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!scan || (!scan.finished && scan.done === 0)) setHeld(false);
    else if (held && scanHideTimer.current) clearTimeout(scanHideTimer.current);
  }, [scan, held, scanHideTimer]);
  if (!scan && sorting <= 0) return null;

  const total = scan?.total ?? 0;
  const done = scan?.done ?? 0;
  const notes = scan?.notes ?? [];
  const finished = !!scan?.finished && sorting === 0;
  const filed = notes.filter(isFiled).length;
  const pct = scan && total ? (done / total) * 100 : null;

  const title = finished
    ? filed
      ? `Done: ${plural(filed, "update")}`
      : aiDown
        ? "Paused: nothing filed"
        : "Done: nothing new found"
    : scan
      ? `Reading documents, ${Math.min(done + 1, total)} of ${total}`
      : `Reading ${plural(sorting, "document")}…`;
  const detail = aiDown ? "The document reader is unavailable." : finished ? `${plural(total, "document")} checked` : (scan?.current ?? null);

  return (
    <div role="status" aria-live="polite" data-floating className="ds pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-toast flex justify-center px-4 lg:bottom-6">
      <div className="pointer-events-auto w-full max-w-[420px] overflow-hidden rounded-card border border-line-strong bg-overlay shadow-(--elevation-2)">
        <div className="flex items-center gap-3 px-4 pt-3 pb-2">
          <span className={finished ? "text-positive" : "text-ink-2"}>
            <Icon name={finished ? "check" : "sparkle"} size={16} />
          </span>
          <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
            <span className="text-body font-medium text-ink tabular-nums">{title}</span>
            {detail && (
              <span className="max-w-full truncate text-small text-ink-2" title={detail}>
                {detail}
              </span>
            )}
          </p>
          {finished && <IconButton icon="x" label="Dismiss" onClick={() => setScan(null)} className="-my-1 -mr-2" />}
        </div>
        <div className="px-4 pb-3">
          <div className="h-[2px] overflow-hidden rounded-full bg-sunken">
            <div className={cx("h-full rounded-full transition-[width] duration-(--dur-3)", finished ? "bg-positive" : "bg-accent")} style={{ width: `${finished ? 100 : Math.max(6, pct ?? 6)}%` }} />
          </div>
        </div>
        {notes.length > 0 && (
          <div className="border-t border-line px-4 py-1" onClickCapture={() => setHeld(true)}>
            <Disclosure label="Results" count={notes.length}>
              <ul className="flex max-h-36 flex-col gap-1 overflow-y-auto pb-2">
                {notes.map((n, i) => (
                  <li key={i} className={cx("text-small break-words", isFiled(n) ? "text-ink" : "text-ink-2")}>
                    {n}
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
