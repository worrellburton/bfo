import type { ReactNode } from "react";
import { useTone } from "./entity/ui";

/**
 * Mail's loaders, one for each wait, all in the mailbox's own colour
 * (the page sets --mail-hue):
 *
 *   ListLoader    the list arriving: ghost rows whose pictures orbit and whose
 *                 lines a light sweeps across, one row after another
 *   SearchLoader  a search running: a scan line passing over the rows
 *   ReaderLoader  a message opening: the subject writing itself, the sender's
 *                 mark orbiting, the body's lines appearing one by one
 *   Orbit         the small spinner for buttons (Send, Improve design, a file)
 *   SentCheck     a check drawing itself when a message has gone
 */

/** A ghost line that a light sweeps across. */
function Line({ w, delay = 0, h = "h-3" }: { w: string; delay?: number; h?: string }) {
  return <span className={`loader-line block ${h} ${w} rounded-full`} style={{ animationDelay: `${delay}ms` }} />;
}

/** A ghost picture: a ring in the mailbox's colour, a spark orbiting it. */
function OrbitRing({ size = "h-10 w-10", delay = 0 }: { size?: string; delay?: number }) {
  return (
    <span className={`loader-orbit relative block shrink-0 rounded-full ${size}`} style={{ animationDelay: `${delay}ms` }}>
      <span className="loader-spark" />
    </span>
  );
}

export function ListLoader({ table = false, label = "Fetching mail" }: { table?: boolean; label?: string }) {
  const t = useTone();
  // The table is a desktop view; phones show the row list whatever the saved view, so the loader does the same.
  const tableRows = table && (
    <div className="py-1 max-md:hidden">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="loader-row flex items-center gap-4 px-4 py-3" style={{ animationDelay: `${i * 60}ms` }}>
          <OrbitRing size="h-6 w-6" delay={i * 120} />
          <Line w="w-[160px]" delay={i * 90} />
          <Line w="w-[220px]" delay={i * 90 + 60} />
          <Line w="flex-1" delay={i * 90 + 120} />
          <Line w="w-12" delay={i * 90 + 180} />
        </div>
      ))}
    </div>
  );
  return (
    <div role="status" aria-label={label}>
      {tableRows}
      <div className={`py-1 ${table ? "md:hidden" : ""}`}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="loader-row flex items-start gap-3.5 px-5 py-3.5" style={{ animationDelay: `${i * 70}ms` }}>
            <OrbitRing delay={i * 140} />
            <div className="min-w-0 flex-1 space-y-2 pt-0.5">
              <div className="flex justify-between gap-6">
                <Line w="w-2/5" delay={i * 90} h="h-3.5" />
                <Line w="w-10" delay={i * 90 + 40} />
              </div>
              <Line w="w-4/5" delay={i * 90 + 80} />
              <Line w="w-3/5" delay={i * 90 + 120} />
            </div>
          </div>
        ))}
        <p className={`loader-caption mt-2 flex items-center justify-center gap-2 pb-24 text-[12px] sm:pb-0 ${t.muted}`}>
          <span className="loader-dot" />
          {label}
          <Dots />
        </p>
      </div>
    </div>
  );
}

/** A search under way: three faint rows and a scan line passing over them. */
export function SearchLoader({ term }: { term: string }) {
  const t = useTone();
  return (
    <div role="status" aria-label={`Searching for ${term}`} className="loader-scan relative overflow-hidden py-1">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex items-start gap-3.5 px-5 py-3.5 opacity-60">
          <span className={`block h-10 w-10 shrink-0 rounded-full ${t.dark ? "bg-white/[0.05]" : "bg-gray-100"}`} />
          <div className="min-w-0 flex-1 space-y-2 pt-0.5">
            <span className={`block h-3.5 w-2/5 rounded-full ${t.dark ? "bg-white/[0.06]" : "bg-gray-100"}`} />
            <span className={`block h-3 w-4/5 rounded-full ${t.dark ? "bg-white/[0.05]" : "bg-gray-100"}`} />
          </div>
        </div>
      ))}
      <span aria-hidden="true" className="loader-scanline" />
      <p className={`mt-1 flex items-center justify-center gap-2 text-[12px] ${t.muted}`}>
        Searching all mail for <span className={`font-medium ${t.text}`}>“{term}”</span>
        <Dots />
      </p>
    </div>
  );
}

/** A message opening. */
export function ReaderLoader() {
  const t = useTone();
  return (
    <div role="status" aria-label="Opening the message" className="px-5 pb-6 pt-5 sm:px-6 max-md:px-7 max-md:pt-6">
      <span className="loader-write block h-5 w-full max-w-[22rem] rounded-full" />
      <span className="loader-write mt-2 block h-5 w-1/2 rounded-full" style={{ animationDelay: "180ms" }} />
      <div className="mt-6 flex items-center gap-3">
        <OrbitRing size="h-11 w-11" />
        <div className="space-y-2">
          <Line w="w-36" h="h-3.5" />
          <Line w="w-20" delay={120} />
        </div>
      </div>
      <div className="mt-7 space-y-3">
        {["w-full", "w-11/12", "w-4/5", "w-full", "w-2/3"].map((w, i) => (
          <span key={i} className={`loader-type block h-3 rounded-full ${w}`} style={{ animationDelay: `${300 + i * 140}ms` }} />
        ))}
      </div>
      <p className={`mt-8 flex items-center gap-2 text-[12px] ${t.muted}`}>
        <span className="loader-dot" />
        Opening
        <Dots />
      </p>
    </div>
  );
}

/** Three dots that take turns. */
export function Dots() {
  return (
    <span aria-hidden="true" className="loader-dots inline-flex gap-[3px]">
      <i />
      <i />
      <i />
    </span>
  );
}

/** The small spinner for a button: a ring with a spark going round. */
export function Orbit({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`loader-orbit loader-orbit-fast relative inline-block shrink-0 rounded-full ${className}`}>
      <span className="loader-spark" />
    </span>
  );
}

/** A check that draws itself. */
export function SentCheck({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}>
      <path className="loader-check" d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

/** A label that shows the spinner while busy and the check once done. */
export function BusyLabel({ busy, done, children, doneLabel }: { busy: boolean; done?: boolean; children: ReactNode; doneLabel?: ReactNode }) {
  if (done)
    return (
      <span className="inline-flex items-center gap-1.5">
        <SentCheck />
        {doneLabel ?? children}
      </span>
    );
  if (busy)
    return (
      <span className="inline-flex items-center gap-1.5">
        <Orbit />
        {children}
      </span>
    );
  return <>{children}</>;
}
