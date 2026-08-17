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
  const [view, setView] = useState<"pnl" | "balance" | "statements">("pnl");
  const [sheet, setSheet] = useState<BalanceSheet | null>(null);
  const [statements, setStatements] = useState<any | null>(null);
  const [tax1099, setTax1099] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // The frozen label column casts a soft edge once a table scrolls sideways.
  const [pnlXScrolled, setPnlXScrolled] = useState(false);
  const [flowXScrolled, setFlowXScrolled] = useState(false);
  // Collapsed P&L sections still show their total row.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleSection = (k: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  const entityParam = selected.size === 0 ? "all" : [...selected].join(",");

  // Pull the year's transactions and hand the browser a CSV for the CPA.
  const [exporting, setExporting] = useState(false);
  async function downloadCsv() {
    setExporting(true);
    try {
      const rows: any[] = [];
      for (let offset = 0; ; offset += 500) {
        const res = await authFetch(
          `/api/books/data?report=transactions&year=${year}&entity=${encodeURIComponent(entityParam)}&limit=500&offset=${offset}`
        );
        if (!res.ok) break;
        const data = await res.json();
        rows.push(...(data.transactions ?? []));
        if ((data.transactions ?? []).length < 500) break;
      }
      const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const header = ["Date", "Entity", "Description", "Vendor", "Account", "Amount"];
      const body = rows.map((t) =>
        [t.date, t.entity_name ?? "", t.name ?? "", t.merchant_name ?? "", t.book_category ?? "", (-t.amount).toFixed(2)]
          .map(esc)
          .join(",")
      );
      const csv = [header.join(","), ...body].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `bfo-transactions-${year}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setExporting(false);
    }
  }

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
        } else if (view === "balance") {
          const res = await authFetch(
            `/api/books/data?report=balance-sheet&entity=${encodeURIComponent(entityParam)}`
          );
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.message || "Couldn't build the balance sheet.");
          setSheet(data);
        } else {
          const [sRes, tRes] = await Promise.all([
            authFetch(`/api/books/data?report=statements&entity=${encodeURIComponent(entityParam)}&year=${year}`),
            authFetch(`/api/books/data?report=tax1099&year=${year}`),
          ]);
          const sData = await sRes.json().catch(() => ({}));
          if (!sRes.ok) throw new Error(sData?.message || "Couldn't build the statements.");
          setStatements(sData);
          setTax1099(tRes.ok ? await tRes.json() : null);
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

  const colShadow = isDark ? "books-col-shadow-dark" : "books-col-shadow";

  const num = "px-3 py-2 text-right whitespace-nowrap tabular-nums";
  const sectionHead = `px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider ${subtle}`;

  /** Walk into the transactions behind one cell. */
  function drill(section: string, rowLabel: string | null, monthIndex: number | null) {
    const params = new URLSearchParams({ entity: entityParam, year, section });
    if (rowLabel != null) params.set("label", rowLabel);
    if (monthIndex != null) params.set("month", String(monthIndex + 1));
    navigate(`/books/reports/cell?${params}`);
  }

  const cellBtn = `w-full text-right cursor-pointer rounded px-1 -mx-1 transition-colors hover:underline decoration-dotted decoration-1 underline-offset-[3px] ${
    isDark ? "hover:bg-white/10" : "hover:bg-black/5"
  }`;

  function bodyRow(
    rowLabel: string,
    monthly: number[],
    total: number,
    section: string,
    opts?: { bold?: boolean; headline?: boolean; color?: string; signColor?: boolean; indent?: boolean; drillLabel?: string | null }
  ) {
    // Per-cell colour by that cell's own sign (green up, red down) — so a
    // negative year never paints a profitable month red.
    const signTone = (v: number) => (v === 0 ? faint : v < 0 ? "text-rose-400" : "text-emerald-500");
    const drillLabel = opts?.drillLabel === undefined ? rowLabel : opts.drillLabel;
    const topBorder = opts?.headline ? `border-t-2 ${border}` : `border-t ${rowBorder}`;
    const emphasis = opts?.headline ? `${bandBg} text-[15px]` : opts?.bold ? bandBg : `group ${hoverRow}`;
    return (
      <tr key={`${section}-${rowLabel}`} className={`${topBorder} ${opts?.bold || opts?.headline ? "font-semibold" : ""} ${emphasis}`}>
        <td className={`px-3 py-2 sticky left-0 whitespace-nowrap border-r transition-colors ${rowBorder} ${stickyBg} ${isDark ? "group-hover:bg-[#101010]" : "group-hover:bg-gray-50"} ${opts?.indent ? "pl-6" : ""}`}>
          {(() => {
            // "4000 Rental Income" → muted code, emphasized name. A plain
            // account row's name walks to its full-year transaction list.
            const m = /^(\d{4})\s+(.+)$/.exec(rowLabel);
            const plain = !opts?.bold && !opts?.headline;
            const inner = m && plain ? (
              <>
                <span className={`tabular-nums text-[11px] mr-1.5 ${faint}`}>{m[1]}</span>
                {m[2]}
              </>
            ) : (
              rowLabel
            );
            if (!plain || !drillLabel) return inner;
            return (
              <button
                className="cursor-pointer hover:underline decoration-dotted underline-offset-2 text-left"
                title={`Open ${rowLabel}`}
                onClick={() => drill(section, drillLabel, null)}
              >
                {inner}
              </button>
            );
          })()}
        </td>
        {monthly.map((v, i) => {
          const colBg = i === curMonth ? colHi : thisYear && i > curMonth ? futureCol : "";
          const tone = opts?.signColor ? signTone(v) : opts?.color ?? (v === 0 ? faint : v < 0 ? "text-rose-400" : "");
          return (
            <td key={i} className={`${num} ${colBg} ${tone}`}>
              {v === 0 ? (
                // A month that hasn't happened yet stays blank, not dashed.
                thisYear && i > curMonth ? "" : money(v)
              ) : (
                <button
                  className={cellBtn}
                  title="View underlying transactions"
                  aria-label={`${rowLabel}, ${MONTHS[i]}: view transactions`}
                  onClick={() => drill(section, drillLabel, i)}
                >
                  {money(v)}
                </button>
              )}
            </td>
          );
        })}
        <td className={`${num} font-semibold border-l ${border} ${colHi} ${opts?.signColor ? signTone(total) : opts?.color ?? (total < 0 ? "text-rose-400" : "")}`}>
          {total === 0 ? (
            money(total)
          ) : (
            <button
              className={cellBtn}
              title="View underlying transactions"
              aria-label={`${rowLabel}, full year: view transactions`}
              onClick={() => drill(section, drillLabel, null)}
            >
              {money(total)}
            </button>
          )}
        </td>
      </tr>
    );
  }

  /** Clickable section band — folds its line items. When folded and given
   *  totals, the band itself carries the numbers (no separate total row). */
  function sectionHeaderRow(
    id: string,
    label: string,
    extra?: string,
    totals?: { monthly: number[]; total: number; tone?: string }
  ) {
    const isCollapsed = collapsed.has(id);
    const showInline = isCollapsed && !!totals;
    return (
      <tr
        key={`head-${id}`}
        onClick={() => toggleSection(id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleSection(id);
          }
        }}
        tabIndex={0}
        aria-expanded={!isCollapsed}
        className={`border-t ${border} cursor-pointer select-none ${bandBg} ${isDark ? "hover:bg-white/[0.05]" : "hover:bg-black/[0.04]"}`}
      >
        <td colSpan={showInline ? 1 : 14} className={`${sectionHead} sticky left-0 border-r ${rowBorder} ${bandBg} whitespace-nowrap`}>
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
        {showInline && (
          <>
            {totals!.monthly.map((v, i) => {
              const colBg = i === curMonth ? colHi : thisYear && i > curMonth ? futureCol : "";
              return (
                <td key={i} className={`${num} font-semibold ${colBg} ${v === 0 ? faint : totals!.tone ?? (v < 0 ? "text-rose-400" : "")}`}>
                  {v === 0 && thisYear && i > curMonth ? "" : money(v)}
                </td>
              );
            })}
            <td className={`${num} font-semibold border-l ${border} ${colHi} ${totals!.tone ?? (totals!.total < 0 ? "text-rose-400" : "")}`}>
              {money(totals!.total)}
            </td>
          </>
        )}
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
          {([["pnl", "Profit & loss"], ["balance", "Balance sheet"], ["statements", "Statements"]] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setView(value)}
              aria-pressed={view === value}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all cursor-pointer ${
                view === value
                  ? isDark ? "bg-white text-black" : "bg-gray-900 text-white"
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
              className={`pl-4 pr-3 py-2 rounded-full text-sm border cursor-pointer flex items-center gap-2 max-w-[280px] ${
                isDark ? "bg-white/[0.04] border-white/10 text-white" : "bg-white border-gray-200 text-gray-900"
              }`}
            >
              <span className="truncate">{pickerLabel}</span>
              <svg className="w-3.5 h-3.5 opacity-60 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            {pickerOpen &&
              (() => {
                const allMode = selected.size === 0;
                const isChecked = (id: string) => allMode || selected.has(id);
                const toggle = (id: string) => {
                  setSelected((prev) => {
                    // From the all-entities view, a click isolates just that one
                    // (select one — not "everything except this").
                    if (prev.size === 0) return new Set([id]);
                    const base = new Set(prev);
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
                // Wide mega layout: entities spread across columns so nothing
                // scrolls. ~5 per column, capped at 3 columns.
                const cols = Math.min(3, Math.max(1, Math.ceil(entities.length / 5)));
                return (
                  <div
                    className={`absolute right-0 mt-2 w-[min(680px,calc(100vw-2rem))] max-h-[72vh] overflow-y-auto rounded-2xl border shadow-xl z-30 p-2 ${
                      isDark ? "bg-[#161616] border-white/10" : "bg-white border-gray-200"
                    }`}
                  >
                    {/* Select all / clear, side by side and full width. */}
                    <div className="flex items-center gap-1.5 px-1 pb-1.5">
                      <button
                        onClick={() => setSelected(new Set())}
                        className={`flex-1 flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm cursor-pointer ${
                          allMode ? "font-semibold" : ""
                        } ${isDark ? "hover:bg-white/5" : "hover:bg-gray-50"}`}
                      >
                        {box(allMode)}
                        <span>All entities</span>
                      </button>
                      {!allMode && (
                        <button
                          onClick={() => setSelected(new Set())}
                          className={`px-3 py-2 rounded-lg text-xs cursor-pointer ${
                            isDark ? "text-gray-400 hover:bg-white/5 hover:text-white" : "text-gray-500 hover:bg-gray-100 hover:text-black"
                          }`}
                        >
                          Reset
                        </button>
                      )}
                    </div>
                    <div className={`mb-1 border-t ${rowBorder}`} />
                    <div
                      className="grid gap-x-2"
                      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                    >
                      {entities.map((en) => {
                        const on = isChecked(en.id);
                        return (
                          <button
                            key={en.id}
                            onClick={() => toggle(en.id)}
                            title={en.name}
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
                  </div>
                );
              })()}
          </div>

          {view === "pnl" && (
            <span className="relative inline-flex items-center">
              <select
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className={`appearance-none pl-4 pr-8 py-2 rounded-full text-sm tabular-nums border cursor-pointer ${
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
        <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${isDark ? "border-red-500/20 bg-red-500/10 text-red-400" : "border-red-200 bg-red-50 text-red-700"}`}>
          {error}
        </div>
      )}

      {view === "statements" ? (
        loading || !statements ? (
          <div className={`rounded-2xl border p-4 max-w-3xl space-y-2.5 rise-in ${card}`}>
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="shimmer h-4" style={{ width: `${95 - (i % 3) * 10}%` }} />
            ))}
          </div>
        ) : (
          <div className="space-y-6 max-w-3xl">
            {/* Cash-flow summary */}
            <div className={`rounded-2xl border overflow-hidden rise-in ${card}`}>
              <div className={`px-4 py-2.5 border-b ${border} flex items-center justify-between`}>
                <span className="text-sm font-semibold">Cash flow · {statements.year}</span>
                <button
                  onClick={() => void downloadCsv()}
                  disabled={exporting}
                  className={`px-3 py-1.5 rounded-lg text-xs cursor-pointer disabled:opacity-50 ${isDark ? "bg-white/10 hover:bg-white/15 text-white" : "bg-gray-900 text-white hover:bg-gray-800"}`}
                >
                  {exporting ? "Exporting…" : "Export CSV"}
                </button>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {([
                    ["Operating activities", statements.cash_flow.operating],
                    ["Financing activities (transfers, loans, draws)", statements.cash_flow.financing],
                    ["Uncategorized", statements.cash_flow.uncategorized],
                  ] as const).map(([k, v]) => (
                    <tr key={k} className={`border-t ${rowBorder}`}>
                      <td className="px-4 py-2">{k}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(v)}</td>
                    </tr>
                  ))}
                  <tr className={`border-t ${border} font-semibold`}>
                    <td className="px-4 py-2">Net change in cash</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(statements.cash_flow.net_change)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Trial balance */}
            <div className={`rounded-2xl border overflow-hidden rise-in ${card}`}>
              <div className={`px-4 py-2.5 border-b ${border} text-sm font-semibold`}>Trial balance</div>
              <table className="w-full text-sm">
                <thead>
                  <tr className={`text-[11px] uppercase tracking-wider ${subtle} border-b ${border}`}>
                    <th className="px-4 py-2 text-left font-medium">Account</th>
                    <th className="px-4 py-2 text-right font-medium">Debit</th>
                    <th className="px-4 py-2 text-right font-medium">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {statements.trial_balance.map((r: any) => (
                    <tr key={r.account} className={`border-t ${rowBorder}`}>
                      <td className="px-4 py-2">{r.account}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.debit ? money(r.debit) : "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.credit ? money(r.credit) : "—"}</td>
                    </tr>
                  ))}
                  <tr className={`border-t ${border} font-semibold`}>
                    <td className="px-4 py-2">Totals</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(statements.totals.debit)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(statements.totals.credit)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* 1099 vendor totals */}
            {tax1099 && tax1099.vendors.length > 0 && (
              <div className={`rounded-2xl border overflow-hidden rise-in ${card}`}>
                <div className={`px-4 py-2.5 border-b ${border} text-sm font-semibold`}>
                  1099 candidates · paid ≥ ${tax1099.threshold} in {tax1099.year}
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {tax1099.vendors.map((v: any) => (
                      <tr key={v.vendor} className={`border-t ${rowBorder}`}>
                        <td className="px-4 py-2 truncate max-w-[320px]" title={v.vendor}>{v.vendor}</td>
                        <td className={`px-4 py-2 text-xs ${subtle}`}>{v.account.replace(/^\d{4}\s+/, "")}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{money(v.paid)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      ) : view === "balance" ? (
        loading ? (
          <div className={`rounded-2xl border p-4 max-w-3xl space-y-2.5 rise-in ${card}`}>
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="shimmer h-4" style={{ width: `${95 - (i % 3) * 10}%` }} />
            ))}
          </div>
        ) : !sheet ? null : (
          <>
          <div className={`rounded-2xl border overflow-hidden max-w-3xl rise-in ${card}`}>
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
                        <td className="px-4 py-2">Total {title.toLowerCase()}</td>
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
          <p className={`mt-3 text-[11px] uppercase tracking-wider ${subtle}`}>
            {sheet.as_of
              ? `As of ${new Date(sheet.as_of).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}`
              : ""}
          </p>
          </>
        )
      ) : loading ? (
        <div className="rise-in">
          <div className="flex flex-wrap gap-x-16 gap-y-4 mb-7">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i}>
                <div className="shimmer h-3 w-20 mb-2" />
                <div className="shimmer h-7 w-28" />
              </div>
            ))}
          </div>
          <div className={`rounded-2xl border p-4 space-y-2.5 ${card}`}>
            <div className="shimmer h-8 mb-3" />
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="shimmer h-4" style={{ width: `${95 - (i % 4) * 8}%` }} />
            ))}
          </div>
        </div>
      ) : !pnl ? null : pnl.transaction_count === 0 ? (
        <div
          className={`rounded-2xl border border-dashed px-6 py-14 text-center rise-in ${
            isDark ? "border-white/15" : "border-gray-300"
          }`}
        >
          <p className="text-sm font-medium mb-1">Nothing booked for {pnl.year}</p>
          <p className={`text-sm ${subtle}`}>Sync transactions or widen the entity selection.</p>
        </div>
      ) : (
        <>
        {/* The year in five quiet figures. */}
        <div className={`flex flex-wrap gap-y-4 mb-7 rise-in`}>
          {(() => {
            const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
            const rev = sum(pnl.revenue_monthly);
            const opInc = sum(pnl.operating_income_monthly);
            const opMargin = rev !== 0 ? (opInc / rev) * 100 : 0;
            const kpis: Array<[string, string, string]> = [
              ["Revenue", money(rev), ""],
              ["Operating expenses", money(sum(pnl.operating_monthly)), ""],
              ["Operating income", money(opInc), opInc < 0 ? "text-rose-400" : ""],
              ["Operating margin", `${opMargin.toFixed(1)}%`, opMargin < 0 ? "text-rose-400" : ""],
              ["Net income", money(pnl.net_total), pnl.net_total >= 0 ? "text-emerald-500" : "text-rose-400"],
            ];
            return kpis.map(([label, display, tone]) => (
              <div key={label} className={`px-8 first:pl-0 last:pr-0 border-l first:border-l-0 ${border}`}>
                <p className={`text-[11px] uppercase tracking-wider mb-1 ${subtle}`}>{label}</p>
                <p className={`text-2xl font-semibold tabular-nums tracking-tight ${tone}`}>{display}</p>
              </div>
            ));
          })()}
        </div>
        <div
          className={`rounded-2xl border overflow-x-auto rise-in ${card} ${pnlXScrolled ? colShadow : ""}`}
          onScroll={(e) => setPnlXScrolled(e.currentTarget.scrollLeft > 2)}
        >
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
                    className={`px-3 py-3 text-right min-w-[68px] ${
                      i === curMonth
                        ? `${colHi} font-semibold ${isDark ? "text-gray-200" : "text-gray-800"}`
                        : thisYear && i > curMonth
                          ? `${futureCol} font-medium`
                          : "font-medium"
                    }`}
                  >
                    {m}
                  </th>
                ))}
                <th className={`px-3 py-3 text-right font-medium min-w-[80px] border-l ${border} ${colHi}`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {sectionHeaderRow("revenue", "Revenue", undefined, {
                monthly: pnl.revenue_monthly,
                total: pnl.revenue_monthly.reduce((a, b) => a + b, 0),
                tone: "text-emerald-500",
              })}
              {!collapsed.has("revenue") && (
                <>
                  {pnl.revenue.map((r) => bodyRow(r.label, r.monthly, r.total, "revenue", { indent: true }))}
                  {bodyRow("Total revenue", pnl.revenue_monthly, pnl.revenue_monthly.reduce((a, b) => a + b, 0), "revenue", {
                    bold: true,
                    color: "text-emerald-500",
                    drillLabel: null,
                  })}
                </>
              )}

              {sectionHeaderRow("operating", "Operating expenses", undefined, {
                monthly: pnl.operating_monthly,
                total: pnl.operating_monthly.reduce((a, b) => a + b, 0),
              })}
              {!collapsed.has("operating") && (
                <>
                  {pnl.operating.map((r) => bodyRow(r.label, r.monthly, r.total, "operating", { indent: true }))}
                  {bodyRow("Total operating expenses", pnl.operating_monthly, pnl.operating_monthly.reduce((a, b) => a + b, 0), "operating", {
                    bold: true,
                    drillLabel: null,
                  })}
                </>
              )}

              {(pnl.other.length > 0 || pnl.other_monthly.some((v) => v !== 0)) && (
                <>
                  {sectionHeaderRow("other", "Other income / (expense)", undefined, {
                    monthly: pnl.other_monthly,
                    total: pnl.other_monthly.reduce((a, b) => a + b, 0),
                  })}
                  {!collapsed.has("other") && (
                    <>
                      {pnl.other.map((r) => bodyRow(r.label, r.monthly, r.total, "other", { indent: true }))}
                      {bodyRow("Total other", pnl.other_monthly, pnl.other_monthly.reduce((a, b) => a + b, 0), "other", {
                        bold: true,
                        drillLabel: null,
                      })}
                    </>
                  )}
                </>
              )}

              {bodyRow("Net income", pnl.net_monthly, pnl.net_total, "net", {
                headline: true,
                signColor: true,
                drillLabel: null,
              })}

              {/* Operating margin = operating income ÷ revenue, per month. */}
              {(() => {
                const marginMonthly = pnl.operating_income_monthly.map((v, i) =>
                  pnl.revenue_monthly[i] ? (v / pnl.revenue_monthly[i]) * 100 : 0
                );
                const revTotal = pnl.revenue_monthly.reduce((a, b) => a + b, 0);
                const opTotal = pnl.operating_income_monthly.reduce((a, b) => a + b, 0);
                const marginTotal = revTotal ? (opTotal / revTotal) * 100 : 0;
                const fmt = (p: number) => (p === 0 ? "—" : `${Math.round(p)}%`);
                return (
                  <tr className={`border-t ${border} ${bandBg}`}>
                    <td className={`px-3 py-2 sticky left-0 whitespace-nowrap border-r text-xs uppercase tracking-wider ${rowBorder} ${stickyBg} ${subtle}`}>
                      Operating margin
                    </td>
                    {marginMonthly.map((p, i) => {
                      const colBg = i === curMonth ? colHi : thisYear && i > curMonth ? futureCol : "";
                      return (
                        <td key={i} className={`${num} text-xs ${colBg} ${p === 0 ? faint : p < 0 ? "text-rose-400" : subtle}`}>
                          {p === 0 && thisYear && i > curMonth ? "" : fmt(p)}
                        </td>
                      );
                    })}
                    <td className={`${num} text-xs font-semibold border-l ${border} ${colHi} ${marginTotal === 0 ? faint : marginTotal < 0 ? "text-rose-400" : subtle}`}>
                      {fmt(marginTotal)}
                    </td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>

        {/* Transfers & intercompany live in their own table — cash movements,
            not part of the income statement. */}
        {(pnl.transfers.rows.length > 0 || pnl.transfers.total !== 0 ||
          pnl.intercompany.total !== 0 ||
          pnl.intercompany.in.some((v) => v !== 0) ||
          pnl.intercompany.out.some((v) => v !== 0)) && (
          <div
            className={`rounded-2xl border overflow-x-auto rise-in mt-6 ${card} ${flowXScrolled ? colShadow : ""}`}
            onScroll={(e) => setFlowXScrolled(e.currentTarget.scrollLeft > 2)}
          >
            <table className="text-sm min-w-[1100px] w-full">
              <thead className={`sticky top-0 z-20 ${stickyBg} shadow-[0_1px_0_rgba(0,0,0,0.06)]`}>
                <tr className={`text-xs uppercase tracking-wider ${subtle} border-b ${border}`}>
                  <th className={`px-3 py-3 text-left font-medium sticky left-0 z-10 border-r ${rowBorder} ${stickyBg}`}>
                    Transfers & flow
                  </th>
                  {MONTHS.map((m, i) => (
                    <th
                      key={m}
                      className={`px-3 py-3 text-right min-w-[68px] ${
                        i === curMonth
                          ? `${colHi} font-semibold ${isDark ? "text-gray-200" : "text-gray-800"}`
                          : thisYear && i > curMonth
                            ? `${futureCol} font-medium`
                            : "font-medium"
                      }`}
                    >
                      {m}
                    </th>
                  ))}
                  <th className={`px-3 py-3 text-right font-medium min-w-[80px] border-l ${border} ${colHi}`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {(pnl.transfers.rows.length > 0 || pnl.transfers.total !== 0) && (
                  <>
                    {sectionHeaderRow("transfers", "Transfers", undefined, {
                      monthly: pnl.transfers.net,
                      total: pnl.transfers.total,
                    })}
                    {!collapsed.has("transfers") && (
                      <>
                        {pnl.transfers.rows.map((r) => bodyRow(r.label, r.monthly, r.total, "transfers", { indent: true }))}
                        {bodyRow("Net transfers", pnl.transfers.net, pnl.transfers.total, "transfers", {
                          bold: true,
                          drillLabel: null,
                        })}
                      </>
                    )}
                  </>
                )}

                {(pnl.intercompany.total !== 0 ||
                  pnl.intercompany.in.some((v) => v !== 0) ||
                  pnl.intercompany.out.some((v) => v !== 0)) && (
                  <>
                    {sectionHeaderRow("intercompany", "Intercompany", undefined, {
                      monthly: pnl.intercompany.net,
                      total: pnl.intercompany.total,
                    })}
                    {!collapsed.has("intercompany") && (
                      <>
                        {bodyRow("In", pnl.intercompany.in, pnl.intercompany.in.reduce((a, b) => a + b, 0), "intercompany", { indent: true, drillLabel: null })}
                        {bodyRow("Out", pnl.intercompany.out.map((v) => -v), -pnl.intercompany.out.reduce((a, b) => a + b, 0), "intercompany", { indent: true, drillLabel: null })}
                        {bodyRow("Net", pnl.intercompany.net, pnl.intercompany.total, "intercompany", { bold: true, drillLabel: null })}
                      </>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className={`mt-3 text-[11px] uppercase tracking-wider ${subtle}`}>
          Cash basis{pnl.eliminated_count > 0 && ` · ${pnl.eliminated_count} eliminated`}
        </p>
        </>
      )}
    </div>
  );
}
