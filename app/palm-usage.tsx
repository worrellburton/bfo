import { useEffect, useState } from "react";
import { dollars, PALM_PRICES, STATE_RECORD_CENTS, type PalmProduct } from "../lib/palm-pricing";
import { palmCall, type PalmMode } from "./palm";

/**
 * What Palm has cost: this month's bill so far (every billed call is logged
 * on the server, lib/palm.ts), what it went on, the latest calls, and the
 * price list. On Tools → Entity compliance.
 */

type Usage = {
  mode: PalmMode | null;
  month: { cents: number; calls: number; testCalls: number; byProduct: Partial<Record<PalmProduct, { calls: number; cents: number }>> };
  lastMonth: { cents: number };
  recent: { at: string; mode: PalmMode; product: PalmProduct; cents: number; by: string | null; assetId: string | null; reason: string | null }[];
};

/** "$0.75" next to a button that costs money; the title says what for. */
export function PriceTag({ cents, isDark, what, className = "" }: { cents: number; isDark: boolean; what?: string; className?: string }) {
  return (
    <span
      title={what ? `Palm bills ${dollars(cents)} for ${what}` : `Palm bills ${dollars(cents)}`}
      className={`inline-flex items-center rounded-full px-1.5 py-px text-[10.5px] font-medium tabular-nums ${
        isDark ? "bg-amber-400/10 text-amber-200/90" : "bg-amber-50 text-amber-700"
      } ${className}`}
    >
      {dollars(cents)}
    </span>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function PalmCostCard({ isDark, names, refreshKey = 0 }: { isDark: boolean; names: Record<string, string>; refreshKey?: number }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    palmCall<Usage>("usage")
      .then((u) => alive && (setUsage(u), setFailed(false)))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  if (failed && !usage) return null;
  const t2 = isDark ? "text-gray-400" : "text-gray-500";
  const t3 = isDark ? "text-gray-500" : "text-gray-400";
  const line = isDark ? "border-white/[0.06]" : "border-gray-100";
  const month = new Date().toLocaleString("en-US", { month: "long" });
  const products = Object.entries(usage?.month.byProduct ?? {}) as [PalmProduct, { calls: number; cents: number }][];

  return (
    <section className={`mt-5 rounded-2xl border ${isDark ? "border-white/10 bg-white/[0.02] glass-card" : "border-gray-200 bg-white glass-card"}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full cursor-pointer items-center gap-4 px-5 py-3.5 text-left sm:px-6">
        <div className="min-w-0 flex-1">
          <p className={`text-[11px] font-medium uppercase tracking-[0.14em] ${t3}`}>Palm costs · {month}</p>
          {!usage ? (
            <div className={`mt-1.5 h-5 w-48 animate-pulse rounded ${isDark ? "bg-white/[0.06]" : "bg-gray-100"}`} />
          ) : (
            <p className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="text-[18px] font-semibold tabular-nums tracking-[-0.01em]">{dollars(usage.month.cents)}</span>
              <span className={`text-[12px] ${t2}`}>
                {usage.month.calls} billed call{usage.month.calls === 1 ? "" : "s"}
                {usage.month.testCalls ? ` · ${usage.month.testCalls} free in test mode` : ""} · last month {dollars(usage.lastMonth.cents)}
              </span>
            </p>
          )}
        </div>
        <span className={`hidden text-[12px] sm:block ${t2}`}>{open ? "Hide" : "Details & prices"}</span>
        <svg className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""} ${t3}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className={`grid gap-6 border-t px-5 pb-5 pt-4 sm:px-6 lg:grid-cols-2 ${line}`}>
          <div className="min-w-0">
            {products.length > 0 && (
              <>
                <p className={`mb-2 text-[11px] font-medium uppercase tracking-[0.14em] ${t3}`}>This month by product</p>
                <ul className="mb-5 space-y-1">
                  {products.map(([p, v]) => (
                    <li key={p} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                      <span>{PALM_PRICES[p]?.label ?? p}</span>
                      <span className={`tabular-nums ${t2}`}>
                        {v.calls} × {dollars(PALM_PRICES[p]?.cents ?? 0)} = <span className={isDark ? "text-white" : "text-gray-900"}>{dollars(v.cents)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className={`mb-2 text-[11px] font-medium uppercase tracking-[0.14em] ${t3}`}>Latest calls</p>
            {!usage?.recent.length ? (
              <p className={`text-[12.5px] ${t2}`}>No billed calls yet.</p>
            ) : (
              <ul className={`divide-y ${isDark ? "divide-white/[0.05]" : "divide-gray-100"}`}>
                {usage.recent.slice(0, 12).map((r, i) => (
                  <li key={i} className="flex items-baseline gap-3 py-1.5 text-[12px]">
                    <span className={`w-[104px] shrink-0 tabular-nums ${t3}`}>{when(r.at)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {PALM_PRICES[r.product]?.label ?? r.product}
                      {r.assetId && names[r.assetId] ? <span className={t2}> · {names[r.assetId]}</span> : null}
                      {r.by ? <span className={t3}> · {r.by}</span> : null}
                    </span>
                    <span className={`shrink-0 tabular-nums ${r.mode === "test" ? t3 : ""}`}>{r.mode === "test" ? "test" : dollars(r.cents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="min-w-0">
            <p className={`mb-2 text-[11px] font-medium uppercase tracking-[0.14em] ${t3}`}>Palm's prices</p>
            <ul className={`divide-y ${isDark ? "divide-white/[0.05]" : "divide-gray-100"}`}>
              {(Object.entries(PALM_PRICES) as [PalmProduct, (typeof PALM_PRICES)[PalmProduct]][]).map(([k, p]) => (
                <li key={k} className="flex items-baseline gap-3 py-1.5 text-[12px]">
                  <span className="w-[118px] shrink-0 font-medium">{p.label}</span>
                  <span className={`min-w-0 flex-1 ${t2}`}>{p.what}</span>
                  <span className="shrink-0 tabular-nums">
                    {dollars(p.cents)}
                    <span className={t3}>/{p.per === "call" ? "call" : "mo"}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className={`mt-3 text-[11.5px] leading-relaxed ${t2}`}>
              Reading a state record is a search and a detail, {dollars(STATE_RECORD_CENTS)} (just the detail, {dollars(PALM_PRICES.detail.cents)}, once the file number is
              on record). The daily check re-reads each record once a week. Checking a new entity's name is {dollars(PALM_PRICES.name_eligibility.cents)} a check.
              Business records, agent service, documents and filings aren't billed per call; a filing's state fee shows before you submit it.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
