import { Fragment, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { authFetch } from "../auth";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Books · Reports" }];
}

type PnlRow = { label: string; monthly: number[]; total: number };
type Pnl = {
  year: number;
  entity: string;
  transaction_count: number;
  eliminated_count: number;
  revenue: PnlRow[];
  operating: PnlRow[];
  other: PnlRow[];
  revenue_monthly: number[];
  operating_monthly: number[];
  other_monthly: number[];
  operating_income_monthly: number[];
  net_monthly: number[];
  net_total: number;
  transfers: { rows: PnlRow[]; in: number[]; out: number[]; net: number[]; total: number };
  intercompany: { in: number[]; out: number[]; net: number[]; total: number };
};

type Entity = { id: string; name: string };

type BsRow = { label: string; detail: string; balance: number };
type BalanceSheet = {
  as_of: string | null;
  sections: {
    cash: { rows: BsRow[]; total: number };
    investments: { rows: BsRow[]; total: number };
    loans: { rows: BsRow[]; total: number };
    credit: { rows: BsRow[]; total: number };
  };
  total_assets: number;
  total_liabilities: number;
  net_worth: number;
};

function moneyFull(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function money(n: number): string {
  if (Math.round(n) === 0) return "—";
  const v = Math.abs(Math.round(n)).toLocaleString("en-US");
  return n < 0 ? `($${v})` : `$${v}`;
}

export default function BooksReports() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const navigate = useNavigate();

  const [entities, setEntities] = useState<Entity[]>([]);
  // Empty selection = all entities.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [view, setView] = useState<"pnl" | "balance">("pnl");
  const [sheet, setSheet] = useState<BalanceSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Collapsed P&L sections still show their total row.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleSection = (k: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  const entityParam = selected.size === 0 ? "all" : [...selected].join(",");

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/books/data?report=meta");
        if (res.ok) setEntities((await res.json()).entities ?? []);
      } catch {
        // picker just stays short
      }
    })();
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

  useEffect(() => {
    setLoading(true);
    setError("");
    void (async () => {
      try {
        if (view === "pnl") {
          const res = await authFetch(
            `/api/books/data?report=pnl&entity=${encodeURIComponent(entityParam)}&year=${year}`
          );
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.message || "Couldn't build the P&L.");
          setPnl(data);
        } else {
          const res = await authFetch(
            `/api/books/data?report=balance-sheet&entity=${encodeURIComponent(entityParam)}`
          );
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.message || "Couldn't build the balance sheet.");
          setSheet(data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't build that report.");
      } finally {
        setLoading(false);
      }
    })();
  }, [entityParam, year, view]);

  const subtle = "text-gray-500";
  const border = isDark ? "border-white/10" : "border-gray-200";
  const rowBorder = isDark ? "border-white/5" : "border-gray-100";
  const card = isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white";
  const stickyBg = isDark ? "bg-[#0b0b0b]" : "bg-white";
  const faint = isDark ? "text-gray-700" : "text-gray-300";
  const colHi = isDark ? "bg-white/[0.035]" : "bg-black/[0.02]";
  const futureCol = isDark ? "bg-white/[0.012]" : "bg-black/[0.012]";
  const bandBg = isDark ? "bg-white/[0.025]" : "bg-gray-50/80";
  const hoverRow = isDark ? "hover:bg-white/[0.02]" : "hover:bg-gray-50/70";
  const thisYear = Number(year) === new Date().getFullYear();
  const curMonth = thisYear ? new Date().getMonth() : -1;
  const sectionKeys = ["revenue", "operating", "other", "transfers", "intercompany"];
  const allCollapsed = sectionKeys.every((k) => collapsed.has(k));
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(sectionKeys));

  const num = "px-3 py-2 text-right whitespace-nowrap tabular-nums";
  const sectionHead = `px-3 py-2 text-[11px] font-semibold uppercase tracking-wider ${subtle}`;

  /** Walk into the transactions behind one cell. */
  function drill(section: string, rowLabel: string | null, monthIndex: number | null) {
    const params = new URLSearchParams({ entity: entityParam, year, section });
    if (rowLabel != null) params.set("label", rowLabel);
    if (monthIndex != null) params.set("month", String(monthIndex + 1));
    navigate(`/books/reports/cell?${params}`);
  }

  const cellBtn = `w-full text-right cursor-pointer rounded px-1 -mx-1 transition-colors ${
    isDark ? "hover:bg-white/10" : "hover:bg-black/5"
  }`;

  function bodyRow(
    rowLabel: string,
    monthly: number[],
    total: number,
    section: string,
    opts?: { bold?: boolean; headline?: boolean; color?: string; indent?: boolean; drillLabel?: string | null }
  ) {
    const drillLabel = opts?.drillLabel === undefined ? rowLabel : opts.drillLabel;
    const topBorder = opts?.headline ? `border-t-2 ${border}` : `border-t ${rowBorder}`;
    const emphasis = opts?.headline ? `${bandBg} text-[15px]` : opts?.bold ? bandBg : hoverRow;
    return (
      <tr key={`${section}-${rowLabel}`} className={`${topBorder} ${opts?.bold || opts?.headline ? "font-semibold" : ""} ${emphasis}`}>
        <td className={`px-3 py-2 sticky left-0 whitespace-nowrap border-r ${rowBorder} ${stickyBg} ${opts?.indent ? "pl-6" : ""}`}>
          {(() => {
            // "4000 Rental Income" → muted code, emphasized name.
            const m = /^(\d{4})\s+(.+)$/.exec(rowLabel);
            if (!m || opts?.bold || opts?.headline) return rowLabel;
            return (
              <>
                <span className={`tabular-nums text-[11px] mr-1.5 ${faint}`}>{m[1]}</span>
                {m[2]}
              </>
            );
          })()}
        </td>
        {monthly.map((v, i) => {
          const colBg = i === curMonth ? colHi : thisYear && i > curMonth ? futureCol : "";
          const tone = opts?.color ?? (v === 0 ? faint : v < 0 ? "text-rose-400" : "");
          return (
            <td key={i} className={`${num} ${colBg} ${tone}`}>
              {v === 0 ? (
                money(v)
              ) : (
                <button className={cellBtn} onClick={() => drill(section, drillLabel, i)}>{money(v)}</button>
              )}
            </td>
          );
        })}
        <td className={`${num} font-semibold border-l ${rowBorder} ${colHi} ${opts?.color ?? (total < 0 ? "text-rose-400" : "")}`}>
          {total === 0 ? (
            money(total)
          ) : (
            <button className={cellBtn} onClick={() => drill(section, drillLabel, null)}>{money(total)}</button>
          )}
        </td>
      </tr>
    );
  }

  /** Clickable section band — folds its line items, keeps the total row. */
  function sectionHeaderRow(id: string, label: string, extra?: string) {
    const isCollapsed = collapsed.has(id);
    return (
      <tr
        key={`head-${id}`}
        onClick={() => toggleSection(id)}
        className={`border-t ${border} cursor-pointer select-none ${bandBg} ${isDark ? "hover:bg-white/[0.05]" : "hover:bg-black/[0.04]"}`}
      >
        <td colSpan={14} className={`${sectionHead} sticky left-0 border-r ${rowBorder} ${bandBg}`}>
          <span className="inline-flex items-center gap-1.5">
            <svg
              className={`w-3 h-3 transition-transform duration-150 ${isCollapsed ? "-rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
            {label}
            {extra && <span className="normal-case font-normal tracking-normal opacity-60">{extra}</span>}
          </span>
        </td>
      </tr>
    );
  }

  const years = [0, 1].map((d) => String(new Date().getFullYear() - d));
  const pickerLabel =
    selected.size === 0
      ? "All entities"
      : selected.size === 1
        ? entities.find((e) => selected.has(e.id))?.name ?? "1 entity"
        : `${selected.size} entities`;

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
        <div className={`inline-flex rounded-full border p-0.5 ${isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white"}`}>
          {([["pnl", "Profit & loss"], ["balance", "Balance sheet"]] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setView(value)}
              aria-pressed={view === value}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all cursor-pointer ${
                view === value
                  ? isDark ? "bg-white text-black shadow-sm" : "bg-gray-900 text-white shadow-sm"
                  : isDark ? "text-gray-500 hover:text-white" : "text-gray-500 hover:text-black"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {/* Entity multi-select */}
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => setPickerOpen((v) => !v)}
              aria-expanded={pickerOpen}
              className={`pl-4 pr-3 py-2 rounded-full text-sm border cursor-pointer flex items-center gap-2 ${
                isDark ? "bg-white/[0.04] border-white/10 text-white" : "bg-white border-gray-200 text-gray-900"
              }`}
            >
              {pickerLabel}
              <svg className="w-3.5 h-3.5 opacity-60" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            {pickerOpen &&
              (() => {
                const allMode = selected.size === 0;
                // Checking/unchecking against the effective set: in all-mode
                // every box reads as checked, so the first uncheck drops just
                // that one entity.
                const isChecked = (id: string) => allMode || selected.has(id);
                const toggle = (id: string) => {
                  setSelected((prev) => {
                    const base = prev.size === 0 ? new Set(entities.map((e) => e.id)) : new Set(prev);
                    base.has(id) ? base.delete(id) : base.add(id);
                    // Everything checked collapses back to the all-entities view.
                    return base.size === entities.length ? new Set() : base;
                  });
                };
                const box = (on: boolean) => (
                  <span
                    className={`w-4 h-4 rounded-[5px] border shrink-0 flex items-center justify-center ${
                      on
                        ? "bg-emerald-500 border-emerald-500"
                        : isDark
                          ? "border-white/25"
                          : "border-gray-300"
                    }`}
                  >
                    {on && (
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                  </span>
                );
                return (
                  <div
                    className={`absolute right-0 mt-2 w-72 max-h-80 overflow-y-auto rounded-xl border shadow-lg z-30 p-1.5 ${
                      isDark ? "bg-[#161616] border-white/10" : "bg-white border-gray-200"
                    }`}
                  >
                    <button
                      onClick={() => setSelected(new Set())}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm cursor-pointer ${
                        allMode ? "font-semibold" : ""
                      } ${isDark ? "hover:bg-white/5" : "hover:bg-gray-50"}`}
                    >
                      {box(allMode)}
                      <span>All entities</span>
                    </button>
                    <div className={`my-1 border-t ${rowBorder}`} />
                    {entities.map((en) => {
                      const on = isChecked(en.id);
                      return (
                        <button
                          key={en.id}
                          onClick={() => toggle(en.id)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm cursor-pointer text-left ${
                            isDark ? "hover:bg-white/5" : "hover:bg-gray-50"
                          }`}
                        >
                          {box(on)}
                          <span className="truncate">{en.name}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
          </div>

          {view === "pnl" && (
            <span className="relative inline-flex items-center">
              <select
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className={`appearance-none pl-4 pr-8 py-2 rounded-full text-sm border cursor-pointer ${
                  isDark ? "bg-white/[0.04] border-white/10 text-white" : "bg-white border-gray-200 text-gray-900"
                }`}
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <svg className="w-3.5 h-3.5 absolute right-3 pointer-events-none opacity-60" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-700"}`}>
          {error}
        </div>
      )}

      {view === "balance" ? (
        loading ? (
          <div className={`rounded-2xl border p-4 max-w-3xl space-y-2.5 rise-in ${card}`}>
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="shimmer h-4" style={{ width: `${95 - (i % 3) * 10}%` }} />
            ))}
          </div>
        ) : !sheet ? null : (
          <>
          <div className={`rounded-2xl border overflow-hidden max-w-3xl shadow-sm rise-in ${card}`}>
            <table className="w-full text-sm">
              <tbody>
                {(
                  [
                    ["Cash & banks", sheet.sections.cash],
                    ["Investments", sheet.sections.investments],
                    ["Loans receivable", sheet.sections.loans],
                  ] as const
                ).map(([title, section]) =>
                  section.rows.length === 0 ? null : (
                    <Fragment key={title}>
                      <tr className={`border-t first:border-t-0 ${border}`}>
                        <td colSpan={2} className={sectionHead}>{title}</td>
                      </tr>
                      {section.rows.map((r, i) => (
                        <tr key={`${title}-${i}`} className={`border-t ${rowBorder}`}>
                          <td className="px-4 py-2">
                            {r.label}
                            {r.detail && <span className={`ml-2 text-xs ${subtle}`}>{r.detail}</span>}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">{moneyFull(r.balance)}</td>
                        </tr>
                      ))}
                      <tr className={`border-t font-semibold ${rowBorder}`}>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-3">
                            <span>Total {title.toLowerCase()}</span>
                            {/* Share of total assets, at a glance. */}
                            <span className={`h-1 rounded-full w-24 overflow-hidden ${isDark ? "bg-white/[0.06]" : "bg-gray-100"}`} aria-hidden>
                              <span
                                className="block h-full rounded-full bg-emerald-500/70"
                                style={{ width: `${Math.min(100, Math.round((section.total / Math.max(sheet.total_assets, 1)) * 100))}%` }}
                              />
                            </span>
                            <span className={`text-[10px] font-normal tabular-nums ${subtle}`}>
                              {Math.round((section.total / Math.max(sheet.total_assets, 1)) * 100)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{moneyFull(section.total)}</td>
                      </tr>
                    </Fragment>
                  )
                )}

                <tr className={`border-t font-semibold ${border}`}>
                  <td className="px-4 py-2.5">Total assets</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-emerald-500">
                    {moneyFull(sheet.total_assets)}
                  </td>
                </tr>

                {sheet.sections.credit.rows.length > 0 && (
                  <>
                    <tr className={`border-t ${border}`}>
                      <td colSpan={2} className={sectionHead}>Liabilities</td>
                    </tr>
                    {sheet.sections.credit.rows.map((r, i) => (
                      <tr key={`credit-${i}`} className={`border-t ${rowBorder}`}>
                        <td className="px-4 py-2">
                          {r.label}
                          {r.detail && <span className={`ml-2 text-xs ${subtle}`}>{r.detail}</span>}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-rose-400">
                          ({moneyFull(r.balance)})
                        </td>
                      </tr>
                    ))}
                    <tr className={`border-t font-semibold ${rowBorder}`}>
                      <td className="px-4 py-2">Total liabilities</td>
                      <td className="px-4 py-2 text-right tabular-nums text-rose-400">
                        ({moneyFull(sheet.total_liabilities)})
                      </td>
                    </tr>
                  </>
                )}

                <tr className={`border-t-2 font-bold ${border}`}>
                  <td className="px-4 py-3">Net worth</td>
                  <td className="px-4 py-3 text-right tabular-nums text-lg">{moneyFull(sheet.net_worth)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className={`mt-3 text-[11px] ${subtle}`}>
            {sheet.as_of ? `As of ${new Date(sheet.as_of).toLocaleString()}` : ""}
          </p>
          </>
        )
      ) : loading ? (
        <div className="rise-in">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`rounded-2xl border px-4 py-3.5 ${card}`}>
                <div className="shimmer h-3 w-20 mb-2.5" />
                <div className="shimmer h-6 w-28" />
              </div>
            ))}
          </div>
          <div className={`rounded-2xl border p-4 space-y-2.5 ${card}`}>
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="shimmer h-4" style={{ width: `${95 - (i % 4) * 8}%` }} />
            ))}
          </div>
        </div>
      ) : !pnl ? null : pnl.transaction_count === 0 ? (
        <p className={`text-sm ${subtle}`}>
          Nothing booked for {pnl.year} in this selection — sync transactions or widen the entities.
        </p>
      ) : (
        <>
        {/* Headline figures for the year, with the monthly shape and momentum. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5 rise-in">
          {(() => {
            const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
            const opInc = sum(pnl.operating_income_monthly);
            const kpis: Array<{ label: string; value: number; monthly: number[]; tone: string; bar: string }> = [
              { label: "Revenue", value: sum(pnl.revenue_monthly), monthly: pnl.revenue_monthly, tone: "text-emerald-500", bar: "bg-emerald-500/60" },
              { label: "Operating expenses", value: sum(pnl.operating_monthly), monthly: pnl.operating_monthly, tone: "", bar: isDark ? "bg-white/30" : "bg-gray-400/70" },
              { label: "Operating income", value: opInc, monthly: pnl.operating_income_monthly, tone: opInc >= 0 ? "text-emerald-500" : "text-rose-400", bar: opInc >= 0 ? "bg-emerald-500/60" : "bg-rose-400/60" },
              { label: "Net income", value: pnl.net_total, monthly: pnl.net_monthly, tone: pnl.net_total >= 0 ? "text-emerald-500" : "text-rose-400", bar: pnl.net_total >= 0 ? "bg-emerald-500/60" : "bg-rose-400/60" },
            ];
            // Momentum: latest active month vs the one before it.
            const last = curMonth >= 0 ? curMonth : 11;
            return kpis.map((k) => {
              const max = Math.max(...k.monthly.map((v) => Math.abs(v)), 1);
              const cur = k.monthly[last] ?? 0;
              const prev = k.monthly[last - 1] ?? 0;
              const delta = cur - prev;
              return (
                <div key={k.label} className={`rounded-2xl border px-4 py-3.5 ${card}`}>
                  <p className={`text-[11px] uppercase tracking-wider mb-1 ${subtle}`}>{k.label}</p>
                  <div className="flex items-baseline gap-2">
                    <p className={`text-xl font-semibold tabular-nums tracking-tight ${k.tone}`}>{money(k.value)}</p>
                    {prev !== 0 && delta !== 0 && (
                      <span className={`text-[11px] tabular-nums ${delta > 0 ? "text-emerald-500" : "text-rose-400"}`}>
                        {delta > 0 ? "▲" : "▼"} {money(Math.abs(delta))}
                      </span>
                    )}
                  </div>
                  <div className="flex items-end gap-[3px] h-6 mt-2" aria-hidden>
                    {k.monthly.map((v, i) => (
                      <span
                        key={i}
                        title={MONTHS[i]}
                        className={`flex-1 rounded-sm min-h-[2px] ${
                          v === 0 ? (isDark ? "bg-white/[0.06]" : "bg-gray-100") : k.bar
                        } ${i === curMonth ? "opacity-100" : "opacity-70"}`}
                        style={{ height: `${Math.max(8, Math.round((Math.abs(v) / max) * 100))}%` }}
                      />
                    ))}
                  </div>
                </div>
              );
            });
          })()}
        </div>
        <div className={`rounded-2xl border overflow-x-auto shadow-sm rise-in ${card}`}>
          <table className="text-sm min-w-[1100px] w-full">
            <thead className={`sticky top-0 z-20 ${stickyBg} shadow-[0_1px_0_rgba(0,0,0,0.06)]`}>
              <tr className={`text-xs uppercase tracking-wider ${subtle} border-b ${border}`}>
                <th className={`px-3 py-3 text-left font-medium sticky left-0 z-10 border-r ${rowBorder} ${stickyBg}`}>
                  <button
                    onClick={toggleAll}
                    title={allCollapsed ? "Expand all" : "Collapse all"}
                    className="inline-flex items-center gap-1.5 cursor-pointer hover:opacity-70 transition-opacity"
                  >
                    <svg
                      className={`w-3 h-3 transition-transform duration-150 ${allCollapsed ? "-rotate-90" : ""}`}
                      fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                    {pickerLabel} · {pnl.year}
                  </button>
                </th>
                {MONTHS.map((m, i) => (
                  <th
                    key={m}
                    className={`px-3 py-3 text-right font-medium min-w-[68px] ${
                      i === curMonth ? colHi : thisYear && i > curMonth ? futureCol : ""
                    }`}
                  >
                    {m}
                  </th>
                ))}
                <th className={`px-3 py-3 text-right font-medium min-w-[80px] border-l ${rowBorder} ${colHi}`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {sectionHeaderRow("revenue", "Revenue")}
              {!collapsed.has("revenue") &&
                pnl.revenue.map((r) => bodyRow(r.label, r.monthly, r.total, "revenue", { indent: true }))}
              {bodyRow("Total revenue", pnl.revenue_monthly, pnl.revenue_monthly.reduce((a, b) => a + b, 0), "revenue", {
                bold: true,
                color: "text-emerald-500",
                drillLabel: null,
              })}

              {sectionHeaderRow("operating", "Operating expenses")}
              {!collapsed.has("operating") &&
                pnl.operating.map((r) => bodyRow(r.label, r.monthly, r.total, "operating", { indent: true }))}
              {bodyRow("Total operating expenses", pnl.operating_monthly, pnl.operating_monthly.reduce((a, b) => a + b, 0), "operating", {
                bold: true,
                drillLabel: null,
              })}

              {bodyRow(
                "Operating income",
                pnl.operating_income_monthly,
                pnl.operating_income_monthly.reduce((a, b) => a + b, 0),
                "net",
                { bold: true, color: "text-gray-400", drillLabel: null }
              )}

              {(pnl.other.length > 0 || pnl.other_monthly.some((v) => v !== 0)) && (
                <>
                  {sectionHeaderRow("other", "Other income / (expense)")}
                  {!collapsed.has("other") &&
                    pnl.other.map((r) => bodyRow(r.label, r.monthly, r.total, "other", { indent: true }))}
                  {bodyRow("Total other", pnl.other_monthly, pnl.other_monthly.reduce((a, b) => a + b, 0), "other", {
                    bold: true,
                    drillLabel: null,
                  })}
                </>
              )}

              {bodyRow("Net income", pnl.net_monthly, pnl.net_total, "net", {
                headline: true,
                color: pnl.net_total >= 0 ? "text-emerald-500" : "text-red-400",
                drillLabel: null,
              })}

              {(pnl.transfers.rows.length > 0 || pnl.transfers.total !== 0) && (
                <>
                  {sectionHeaderRow("transfers", "Transfers", "— own money moving, outside the P&L")}
                  {!collapsed.has("transfers") &&
                    pnl.transfers.rows.map((r) => bodyRow(r.label, r.monthly, r.total, "transfers", { indent: true }))}
                  {bodyRow("Net transfers", pnl.transfers.net, pnl.transfers.total, "transfers", {
                    bold: true,
                    drillLabel: null,
                  })}
                </>
              )}

              {(pnl.intercompany.total !== 0 ||
                pnl.intercompany.in.some((v) => v !== 0) ||
                pnl.intercompany.out.some((v) => v !== 0)) && (
                <>
                  {sectionHeaderRow("intercompany", "Intercompany", "— with entities outside this selection")}
                  {!collapsed.has("intercompany") && (
                    <>
                      {bodyRow("In", pnl.intercompany.in, pnl.intercompany.in.reduce((a, b) => a + b, 0), "intercompany", { indent: true, drillLabel: null })}
                      {bodyRow("Out", pnl.intercompany.out.map((v) => -v), -pnl.intercompany.out.reduce((a, b) => a + b, 0), "intercompany", { indent: true, drillLabel: null })}
                    </>
                  )}
                  {bodyRow("Net", pnl.intercompany.net, pnl.intercompany.total, "intercompany", { bold: true, drillLabel: null })}
                </>
              )}
            </tbody>
          </table>
        </div>
        <p className={`mt-3 text-[11px] ${subtle}`}>
          Cash basis
          {pnl.eliminated_count > 0 && ` · ${pnl.eliminated_count} intercompany movements eliminated`}
          {" · click any figure for its transactions"}
        </p>
        </>
      )}
    </div>
  );
}
