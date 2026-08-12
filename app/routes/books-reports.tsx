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
  income: PnlRow[];
  expenses: PnlRow[];
  income_monthly: number[];
  expense_monthly: number[];
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
    opts?: { bold?: boolean; color?: string; indent?: boolean; drillLabel?: string | null }
  ) {
    const drillLabel = opts?.drillLabel === undefined ? rowLabel : opts.drillLabel;
    return (
      <tr key={`${section}-${rowLabel}`} className={`border-t ${rowBorder} ${opts?.bold ? "font-semibold" : ""}`}>
        <td className={`px-3 py-2 sticky left-0 whitespace-nowrap ${stickyBg} ${opts?.indent ? "pl-6" : ""}`}>
          {rowLabel}
        </td>
        {monthly.map((v, i) => (
          <td key={i} className={`${num} ${opts?.color ?? (v === 0 ? subtle : "")}`}>
            {v === 0 ? (
              money(v)
            ) : (
              <button className={cellBtn} onClick={() => drill(section, drillLabel, i)}>{money(v)}</button>
            )}
          </td>
        ))}
        <td className={`${num} font-semibold ${opts?.color ?? ""}`}>
          {total === 0 ? (
            money(total)
          ) : (
            <button className={cellBtn} onClick={() => drill(section, drillLabel, null)}>{money(total)}</button>
          )}
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
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <div className={`inline-flex rounded-lg border p-0.5 mb-3 ${isDark ? "border-white/10" : "border-gray-200"}`}>
            {([["pnl", "Profit & loss"], ["balance", "Balance sheet"]] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setView(value)}
                aria-pressed={view === value}
                className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                  view === value
                    ? isDark ? "bg-white/10 text-white" : "bg-black/5 text-black"
                    : isDark ? "text-gray-500 hover:text-white" : "text-gray-500 hover:text-black"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {view === "pnl" ? (
            <p className={`text-sm ${subtle}`}>
              Cash basis · click any number for its transactions · movements between selected
              entities are eliminated{pnl && pnl.eliminated_count > 0 ? ` (${pnl.eliminated_count} eliminated)` : ""}.
            </p>
          ) : (
            <p className={`text-sm ${subtle}`}>
              What the family owns and owes
              {sheet?.as_of ? ` · as of ${new Date(sheet.as_of).toLocaleString()}` : ""} · loans stay
              on the sheet regardless of entity selection.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Entity multi-select */}
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => setPickerOpen((v) => !v)}
              aria-expanded={pickerOpen}
              className={`px-3 py-2 rounded-lg text-sm border cursor-pointer flex items-center gap-2 ${
                isDark ? "bg-white/[0.04] border-white/10 text-white" : "bg-white border-gray-200 text-gray-900"
              }`}
            >
              {pickerLabel}
              <svg className="w-3.5 h-3.5 opacity-60" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            {pickerOpen && (
              <div
                className={`absolute right-0 mt-2 w-72 max-h-80 overflow-y-auto rounded-xl border shadow-lg z-30 p-1.5 ${
                  isDark ? "bg-[#161616] border-white/10" : "bg-white border-gray-200"
                }`}
              >
                <button
                  onClick={() => setSelected(new Set())}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm cursor-pointer ${
                    selected.size === 0 ? "font-semibold" : ""
                  } ${isDark ? "hover:bg-white/5" : "hover:bg-gray-50"}`}
                >
                  All entities
                </button>
                <div className={`my-1 border-t ${rowBorder}`} />
                {entities.map((en) => {
                  const on = selected.has(en.id);
                  return (
                    <label
                      key={en.id}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm cursor-pointer ${
                        isDark ? "hover:bg-white/5" : "hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            on ? next.delete(en.id) : next.add(en.id);
                            return next;
                          })
                        }
                      />
                      <span className="truncate">{en.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {view === "pnl" && (
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className={`px-3 py-2 rounded-lg text-sm border cursor-pointer ${
                isDark ? "bg-white/[0.04] border-white/10 text-white" : "bg-white border-gray-200 text-gray-900"
              }`}
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
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
          <p className={`text-sm ${subtle}`}>Building the balance sheet…</p>
        ) : !sheet ? null : (
          <div className={`rounded-xl border overflow-hidden max-w-3xl ${card}`}>
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
        )
      ) : loading ? (
        <p className={`text-sm ${subtle}`}>Building the P&amp;L…</p>
      ) : !pnl ? null : pnl.transaction_count === 0 ? (
        <p className={`text-sm ${subtle}`}>
          Nothing booked for {pnl.year} in this selection — sync transactions or widen the entities.
        </p>
      ) : (
        <div className={`rounded-xl border overflow-x-auto ${card}`}>
          <table className="text-sm min-w-[1100px] w-full">
            <thead>
              <tr className={`text-xs uppercase tracking-wider ${subtle} border-b ${border}`}>
                <th className={`px-3 py-3 text-left font-medium sticky left-0 ${stickyBg}`}>
                  {pickerLabel} · {pnl.year}
                </th>
                {MONTHS.map((m) => (
                  <th key={m} className="px-3 py-3 text-right font-medium">{m}</th>
                ))}
                <th className="px-3 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={14} className={sectionHead}>Income</td>
              </tr>
              {pnl.income.map((r) => bodyRow(r.label, r.monthly, r.total, "income", { indent: true }))}
              {bodyRow("Total income", pnl.income_monthly, pnl.income_monthly.reduce((a, b) => a + b, 0), "income", {
                bold: true,
                color: "text-emerald-500",
                drillLabel: null,
              })}

              <tr className={`border-t ${border}`}>
                <td colSpan={14} className={sectionHead}>Expenses</td>
              </tr>
              {pnl.expenses.map((r) => bodyRow(r.label, r.monthly, r.total, "expenses", { indent: true }))}
              {bodyRow("Total expenses", pnl.expense_monthly, pnl.expense_monthly.reduce((a, b) => a + b, 0), "expenses", {
                bold: true,
                drillLabel: null,
              })}

              {bodyRow("Net", pnl.net_monthly, pnl.net_total, "net", {
                bold: true,
                color: pnl.net_total >= 0 ? "text-emerald-500" : "text-red-400",
                drillLabel: null,
              })}

              {(pnl.transfers.rows.length > 0 || pnl.transfers.total !== 0) && (
                <>
                  <tr className={`border-t ${border}`}>
                    <td colSpan={14} className={sectionHead}>
                      Transfers <span className="normal-case tracking-normal font-normal">— own money moving, outside the P&amp;L</span>
                    </td>
                  </tr>
                  {pnl.transfers.rows.map((r) => bodyRow(r.label, r.monthly, r.total, "transfers", { indent: true }))}
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
                  <tr className={`border-t ${border}`}>
                    <td colSpan={14} className={sectionHead}>
                      Intercompany <span className="normal-case tracking-normal font-normal">— with entities outside this selection</span>
                    </td>
                  </tr>
                  {bodyRow("In", pnl.intercompany.in, pnl.intercompany.in.reduce((a, b) => a + b, 0), "intercompany", { indent: true, drillLabel: null })}
                  {bodyRow("Out", pnl.intercompany.out.map((v) => -v), -pnl.intercompany.out.reduce((a, b) => a + b, 0), "intercompany", { indent: true, drillLabel: null })}
                  {bodyRow("Net", pnl.intercompany.net, pnl.intercompany.total, "intercompany", { bold: true, drillLabel: null })}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
