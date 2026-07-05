import { useEffect, useMemo, useState } from "react";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - MFAs" }];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type MFA = {
  id: string;
  manager: string;
  client: string;
  fee: number;
  feeRaw: string;
  frequency: string;
  effectiveDate: string;
  status: string;
};

function parseFee(fee: string | undefined): number {
  if (!fee) return 0;
  const n = parseFloat(String(fee).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}

function fmtMoney(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// Robustly extract {year, month} from an effective date without timezone drift.
function effYearMonth(effectiveDate: string): { y: number; m: number } | null {
  if (!effectiveDate) return null;
  let match = effectiveDate.match(/^(\d{4})-(\d{2})-(\d{2})/); // YYYY-MM-DD
  if (match) return { y: +match[1], m: +match[2] - 1 };
  match = effectiveDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // MM/DD/YYYY
  if (match) return { y: +match[3], m: +match[1] - 1 };
  const d = new Date(effectiveDate);
  if (!isNaN(d.getTime())) return { y: d.getFullYear(), m: d.getMonth() };
  return null;
}

export default function MFAs() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const now = new Date();
  const currentYear = now.getFullYear();
  const [year, setYear] = useState(currentYear);
  const [activeOnly, setActiveOnly] = useState(true);
  const [mfas, setMfas] = useState<MFA[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    async function setup() {
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, onValue } = await import("firebase/database");
      unsub = onValue(ref(db, "assets"), (snap) => {
        const data = snap.val() || {};
        const list: MFA[] = [];
        for (const [assetId, asset] of Object.entries<any>(data)) {
          const contracts = asset?.contracts || {};
          for (const [cid, c] of Object.entries<any>(contracts)) {
            list.push({
              id: `${assetId}:${cid}`,
              manager: asset?.name || "—",
              client: c?.counterparty || "—",
              fee: parseFee(c?.fee),
              feeRaw: c?.fee || "",
              frequency: c?.frequency || "",
              effectiveDate: c?.effectiveDate || "",
              status: c?.status || "draft",
            });
          }
        }
        list.sort((a, b) => (a.manager + " " + a.client).localeCompare(b.manager + " " + b.client));
        setMfas(list);
        setLoading(false);
      });
    }
    setup();
    return () => unsub?.();
  }, []);

  const rows = useMemo(
    () => (activeOnly ? mfas.filter((m) => m.status === "active") : mfas),
    [mfas, activeOnly]
  );

  // A month is active if it falls on/after the contract's effective month.
  // (No termination date is stored, so the fee runs through the selected year.)
  function isActiveMonth(m: MFA, monthIdx: number): boolean {
    const ym = effYearMonth(m.effectiveDate);
    if (!ym) return true;
    if (year > ym.y) return true;
    if (year < ym.y) return false;
    return monthIdx >= ym.m;
  }

  function cellAmount(m: MFA, monthIdx: number): number | null {
    if (!isActiveMonth(m, monthIdx)) return null;
    return m.fee; // full fee each active month
  }

  const rowTotals = rows.map((m) => MONTHS.reduce((sum, _, i) => sum + (cellAmount(m, i) ?? 0), 0));
  const colTotals = MONTHS.map((_, i) => rows.reduce((sum, m) => sum + (cellAmount(m, i) ?? 0), 0));
  const grandTotal = colTotals.reduce((a, b) => a + b, 0);

  const years = Array.from({ length: 6 }, (_, i) => currentYear - 3 + i);

  function handleExportCSV() {
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const header = ["MFA", "Fee", ...MONTHS, "Total"].map(esc).join(",");
    const body = rows.map((m, ri) => {
      const cells = MONTHS.map((_, i) => {
        const a = cellAmount(m, i);
        return a == null ? "" : String(a);
      });
      return [`${m.manager} -> ${m.client}`, m.feeRaw, ...cells, String(rowTotals[ri])].map(esc).join(",");
    });
    const totalRow = ["Total", "", ...colTotals.map(String), String(grandTotal)].map(esc).join(",");
    const csv = [header, ...body, totalRow].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `BFO_MFAs_${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const cardBg = isDark ? "bg-[#0d0d0d]" : "bg-white";
  const cardBorder = isDark ? "border-white/10" : "border-gray-200";
  const headBg = isDark ? "bg-white/[0.03]" : "bg-gray-50";
  const subText = isDark ? "text-gray-500" : "text-gray-500";
  const rowHover = isDark ? "hover:bg-white/[0.03]" : "hover:bg-gray-50";
  const btn = isDark
    ? "text-xs px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 text-gray-300 hover:text-white transition-colors cursor-pointer inline-flex items-center gap-1.5"
    : "text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:border-gray-400 text-gray-600 hover:text-gray-900 transition-colors cursor-pointer inline-flex items-center gap-1.5";
  const btnActive = isDark
    ? "text-xs px-3 py-1.5 rounded-lg border border-white/40 bg-white/10 text-white transition-colors cursor-pointer"
    : "text-xs px-3 py-1.5 rounded-lg border border-gray-900 bg-gray-900 text-white transition-colors cursor-pointer";
  const selectCls = isDark
    ? "text-xs bg-white/5 border border-white/10 text-white rounded-lg px-3 py-1.5 focus:outline-none cursor-pointer"
    : "text-xs bg-gray-100 border border-gray-300 text-gray-900 rounded-lg px-3 py-1.5 focus:outline-none cursor-pointer";
  const th = `text-right py-2.5 px-3 font-semibold uppercase tracking-wider text-[10px] ${subText} whitespace-nowrap`;
  const stickyCell = `sticky left-0 z-10 ${cardBg}`;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-1">
        <h1 className="text-3xl font-bold">MFAs</h1>
        <div className="flex items-center gap-2">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={selectCls}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button onClick={() => setActiveOnly((v) => !v)} className={activeOnly ? btnActive : btn}>
            {activeOnly ? "Active only" : "All statuses"}
          </button>
          <button onClick={handleExportCSV} disabled={rows.length === 0} className={`${btn} disabled:opacity-50`}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            CSV
          </button>
        </div>
      </div>
      <p className={`${subText} text-sm mb-6`}>
        Management fee agreements — the contracted fee shown in full for each active month of {year}.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className={`animate-spin rounded-full h-8 w-8 border-2 ${isDark ? "border-white/20 border-t-white/80" : "border-gray-200 border-t-gray-600"}`} />
        </div>
      ) : rows.length === 0 ? (
        <div className={`border rounded-xl p-12 text-center ${cardBorder} ${cardBg}`}>
          <p className={subText}>
            No {activeOnly ? "active " : ""}MFAs found. Add Operating Contracts on an entity, then they'll show here.
          </p>
        </div>
      ) : (
        <div className={`border rounded-xl overflow-hidden ${cardBorder} ${cardBg}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={`${headBg} border-b ${cardBorder}`}>
                  <th className={`text-left py-2.5 px-4 font-semibold uppercase tracking-wider text-[10px] ${subText} ${stickyCell} ${headBg}`} style={{ minWidth: "240px" }}>
                    MFA
                  </th>
                  {MONTHS.map((mo) => (
                    <th key={mo} className={th} style={{ minWidth: "72px" }}>{mo}</th>
                  ))}
                  <th className={`${th} border-l ${cardBorder}`} style={{ minWidth: "90px" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m, ri) => (
                  <tr key={m.id} className={`border-b last:border-b-0 ${cardBorder} ${rowHover} transition-colors`}>
                    <td className={`py-2.5 px-4 ${stickyCell}`} style={{ minWidth: "240px" }}>
                      <div className="font-medium leading-tight">{m.manager} <span className={subText}>→</span> {m.client}</div>
                      <div className={`text-[10px] mt-0.5 ${subText}`}>
                        {m.feeRaw || fmtMoney(m.fee)}{m.frequency ? ` / ${m.frequency}` : ""}
                        {activeOnly ? "" : ` · ${m.status}`}
                      </div>
                    </td>
                    {MONTHS.map((_, i) => {
                      const a = cellAmount(m, i);
                      return (
                        <td key={i} className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                          {a == null ? <span className={isDark ? "text-gray-700" : "text-gray-300"}>—</span> : fmtMoney(a)}
                        </td>
                      );
                    })}
                    <td className={`py-2.5 px-3 text-right tabular-nums font-semibold whitespace-nowrap border-l ${cardBorder}`}>
                      {fmtMoney(rowTotals[ri])}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={`${headBg} border-t-2 ${cardBorder} font-semibold`}>
                  <td className={`py-2.5 px-4 ${stickyCell} ${headBg}`} style={{ minWidth: "240px" }}>Total</td>
                  {colTotals.map((t, i) => (
                    <td key={i} className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">{fmtMoney(t)}</td>
                  ))}
                  <td className={`py-2.5 px-3 text-right tabular-nums whitespace-nowrap border-l ${cardBorder}`}>{fmtMoney(grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className={`px-4 py-2 text-xs ${subText} border-t ${cardBorder}`}>
            {rows.length} MFA{rows.length === 1 ? "" : "s"} · {year} · annual total {fmtMoney(grandTotal)}
          </div>
        </div>
      )}
    </div>
  );
}
