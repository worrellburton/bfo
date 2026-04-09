import { useState, useEffect, useCallback } from "react";
import { Link, useSearchParams } from "react-router";

export function meta() {
  return [{ title: "BFO - Profit & Loss | Finance" }];
}

type ReportRow = {
  label: string;
  values: string[];
  depth: number;
  bold?: boolean;
};

type ViewMode = "monthly" | "annual" | "custom";

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function formatCurrency(val: string | number): string {
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return val as string;
  if (num === 0) return "-";
  const negative = num < 0;
  const formatted = Math.abs(num).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return negative ? `(${formatted})` : formatted;
}

function parseReport(data: any): { title: string; columns: string[]; rows: ReportRow[] } {
  if (!data?.Header) return { title: "", columns: [], rows: [] };
  const title = data.Header.ReportName || "";
  // Extract column headers (skip first "Account" column)
  const columns = (data.Columns?.Column || []).slice(1).map((c: any) => c.ColTitle || "");
  const rows: ReportRow[] = [];

  function walkRows(rowData: any[], depth: number) {
    if (!rowData) return;
    for (const row of rowData) {
      if (row.Header?.ColData) {
        rows.push({
          label: row.Header.ColData[0]?.value || "",
          values: row.Header.ColData.slice(1).map((c: any) => c.value || ""),
          depth,
          bold: true,
        });
      }
      if (row.Rows?.Row) walkRows(row.Rows.Row, depth + 1);
      if (row.ColData) {
        rows.push({
          label: row.ColData[0]?.value || "",
          values: row.ColData.slice(1).map((c: any) => c.value || ""),
          depth,
        });
      }
      if (row.Summary?.ColData) {
        rows.push({
          label: row.Summary.ColData[0]?.value || "",
          values: row.Summary.ColData.slice(1).map((c: any) => c.value || ""),
          depth,
          bold: true,
        });
      }
    }
  }

  walkRows(data.Rows?.Row || [], 0);
  return { title, columns, rows };
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function ProfitLoss() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const [searchParams] = useSearchParams();
  const realmId = searchParams.get("realm_id") || "";

  const [companyName, setCompanyName] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("monthly");
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [report, setReport] = useState<{ title: string; columns: string[]; rows: ReportRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastUpdatedText, setLastUpdatedText] = useState("");
  const [light, setLight] = useState(false);

  useEffect(() => {
    if (!realmId) return;
    fetch(`/api/quickbooks/data?report=company-info&realm_id=${realmId}`)
      .then((r) => r.json())
      .then((d) => setCompanyName(d?.CompanyInfo?.CompanyName || ""))
      .catch(() => {});
  }, [realmId]);

  useEffect(() => {
    if (!lastUpdated) return;
    setLastUpdatedText(timeAgo(lastUpdated));
    const interval = setInterval(() => setLastUpdatedText(timeAgo(lastUpdated)), 30000);
    return () => clearInterval(interval);
  }, [lastUpdated]);

  const realmParam = realmId ? `&realm_id=${realmId}` : "";

  const fetchPL = useCallback(async (url: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.error === "not_connected" || data.error === "auth_expired") {
        setError("QuickBooks not connected. Please reconnect.");
        return;
      }
      if (!res.ok) throw new Error(data.message || data.error);
      setReport(parseReport(data));
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (viewMode === "monthly") {
      fetchPL(`/api/quickbooks/data?report=profit-loss-monthly&year=${selectedYear}${realmParam}`);
    } else if (viewMode === "annual") {
      fetchPL(`/api/quickbooks/data?report=profit-loss-detail&start_date=${selectedYear}-01-01&end_date=${selectedYear}-12-31${realmParam}`);
    } else {
      fetchPL(`/api/quickbooks/data?report=profit-loss-detail&start_date=${currentYear}-01-01&end_date=${now.toISOString().split("T")[0]}${realmParam}`);
    }
  }, [viewMode, selectedYear, fetchPL, realmParam]);

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);
  const isMultiColumn = viewMode === "monthly" && report && report.columns.length > 1;

  function handleGeneratePDF() {
    if (!report) return;
    const bgColor = light ? "#ffffff" : "#0a0a0a";
    const textColor = light ? "#111827" : "#f9fafb";
    const mutedColor = light ? "#6b7280" : "#9ca3af";
    const borderColor = light ? "#e5e7eb" : "rgba(255,255,255,0.1)";

    const periodLabel = viewMode === "monthly"
      ? `Monthly ${selectedYear}`
      : viewMode === "annual"
        ? `Annual ${selectedYear}`
        : `Year to Date ${currentYear}`;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const colHeaders = isMultiColumn
      ? report.columns.map((c) => `<th style="text-align:right;padding:4px 8px;font-size:9px;color:${mutedColor};font-weight:500;white-space:nowrap">${c}</th>`).join("")
      : `<th style="text-align:right;padding:4px 8px;font-size:9px;color:${mutedColor}">Amount</th>`;

    printWindow.document.write(`<!DOCTYPE html><html><head>
      <title>Profit & Loss - ${periodLabel}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: ${bgColor}; color: ${textColor}; padding: 30px; font-size: 10px; }
        .header { margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid ${borderColor}; }
        .header h1 { font-size: 18px; margin-bottom: 2px; }
        .header p { color: ${mutedColor}; font-size: 11px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 3px 6px; }
        .label { text-align: left; }
        .value { text-align: right; font-variant-numeric: tabular-nums; }
        .bold td { font-weight: 600; color: ${textColor}; }
        .total td { border-top: 1px solid ${borderColor}; font-weight: 700; }
        .section td { padding-top: 10px; }
        .muted { color: ${mutedColor}; }
        .negative { color: #ef4444; }
        .footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid ${borderColor}; font-size: 9px; color: ${mutedColor}; text-align: center; }
        @media print { body { padding: 15px; font-size: 8px; } }
      </style></head><body>
      <div class="header">
        <h1>Profit & Loss</h1>
        <p>${periodLabel} &middot; Generated ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
      </div>
      <table>
        <thead><tr><th class="label"></th>${colHeaders}</tr></thead>
        <tbody>
        ${report.rows.map((row) => {
          const isTotal = row.label.toLowerCase().startsWith("total") || row.label.toLowerCase().startsWith("net ");
          const isSection = row.bold && row.values.every((v) => !v);
          const cls = isTotal ? "total" : isSection ? "section bold" : row.bold ? "bold" : "muted";
          const vals = isMultiColumn
            ? row.values.map((v) => `<td class="value${parseFloat(v) < 0 ? " negative" : ""}">${v ? formatCurrency(v) : ""}</td>`).join("")
            : `<td class="value${parseFloat(row.values[0]) < 0 ? " negative" : ""}">${row.values[0] ? formatCurrency(row.values[0]) : ""}</td>`;
          return `<tr class="${cls}"><td class="label" style="padding-left:${row.depth * 14 + 4}px">${row.label}</td>${vals}</tr>`;
        }).join("")}
        </tbody>
      </table>
      <div class="footer">Burton Family Office &middot; Generated from QuickBooks Online</div>
    </body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  }

  // Theme
  const pageBg = light ? "bg-white text-gray-900" : "";
  const card = light ? "rounded-xl border border-gray-200 bg-gray-50" : "rounded-xl border border-white/10 bg-white/[0.02]";
  const mutedText = light ? "text-gray-500" : "text-gray-500";
  const headingText = light ? "text-gray-900" : "";
  const btnBorder = light ? "border border-gray-200 hover:border-gray-400 text-gray-600 hover:text-gray-900" : "border border-white/10 hover:border-white/20 text-gray-500 hover:text-white";
  const btnActive = light ? "border border-green-500 bg-green-50 text-green-700" : "border border-green-500/40 bg-green-500/10 text-green-400";
  const selectStyle = light
    ? "bg-white border border-gray-200 text-gray-900 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-green-500"
    : "bg-white/5 border border-white/10 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-green-500/50";

  return (
    <div className={`${pageBg} min-h-screen transition-colors duration-200`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-3">
          <Link to="/tools/quickbooks" className={`${mutedText} hover:text-white transition-colors`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className={`text-2xl font-bold ${headingText}`}>Profit & Loss</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setLight((v) => !v)} className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${btnBorder}`}>
            {light ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
            )}
          </button>
          <button onClick={handleGeneratePDF} disabled={!report || loading} className={`text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50 ${btnBorder}`}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
            PDF
          </button>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-6">
        <p className={`${mutedText} text-sm`}>{companyName || "Loading..."}</p>
        {lastUpdated && <span className="text-xs text-gray-600">&middot; Updated {lastUpdatedText}</span>}
      </div>

      {/* View Mode Tabs + Year */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex items-center gap-2">
          {(["monthly", "annual", "custom"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${viewMode === mode ? btnActive : btnBorder}`}
            >
              {mode === "monthly" ? "Monthly" : mode === "annual" ? "Annual" : "Year to Date"}
            </button>
          ))}
        </div>
        {viewMode !== "custom" && (
          <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} className={selectStyle}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 text-sm">
          {error}
          <button onClick={() => setError("")} className="ml-3 underline">Dismiss</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <div className={`animate-spin rounded-full h-8 w-8 border-2 ${light ? "border-gray-200 border-t-gray-600" : "border-white/20 border-t-white/80"}`} />
        </div>
      )}

      {/* Report */}
      {!loading && report && report.rows.length > 0 && (
        <div className={`${card} overflow-hidden`}>
          <div className="p-4 sm:p-6 pb-2">
            <h3 className={`font-semibold text-sm ${headingText}`}>
              {viewMode === "monthly" ? `${selectedYear} Monthly Breakdown` : viewMode === "annual" ? `Annual ${selectedYear}` : `Year to Date ${currentYear}`}
            </h3>
            <p className={`text-xs ${mutedText}`}>{report.title}</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              {/* Column Headers */}
              {isMultiColumn && (
                <thead>
                  <tr>
                    <th className={`text-left py-2 px-4 ${mutedText} font-medium sticky left-0 ${light ? "bg-gray-50" : "bg-[#0d0d0d]"}`} style={{ minWidth: "200px" }}>
                      Account
                    </th>
                    {report.columns.map((col, ci) => (
                      <th key={ci} className={`text-right py-2 px-3 ${mutedText} font-medium whitespace-nowrap`} style={{ minWidth: "90px" }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {report.rows.map((row, i) => {
                  const isTotal = row.label.toLowerCase().startsWith("total") || row.label.toLowerCase().startsWith("net ");
                  const isSection = row.bold && row.values.every((v) => !v);
                  const isNet = isTotal && row.label.toLowerCase().includes("net");

                  return (
                    <tr
                      key={i}
                      className={
                        isTotal
                          ? `border-t ${light ? "border-gray-200" : "border-white/10"}`
                          : isSection
                            ? ""
                            : ""
                      }
                    >
                      {/* Label cell */}
                      <td
                        className={`py-1.5 px-4 ${
                          isSection ? "pt-4 pb-1" : ""
                        } ${
                          row.bold
                            ? `font-semibold ${light ? "text-gray-900" : "text-white"}`
                            : light ? "text-gray-600" : "text-gray-400"
                        } ${isTotal ? "font-bold" : ""} sticky left-0 ${light ? "bg-gray-50" : "bg-[#0d0d0d]"}`}
                        style={{ paddingLeft: `${row.depth * 16 + 16}px`, minWidth: "200px" }}
                      >
                        {row.label}
                      </td>
                      {/* Value cells */}
                      {isMultiColumn ? (
                        row.values.map((val, vi) => (
                          <td
                            key={vi}
                            className={`py-1.5 px-3 text-right tabular-nums whitespace-nowrap ${
                              isTotal
                                ? `font-bold ${light ? "text-gray-900" : "text-white"}`
                                : parseFloat(val) < 0
                                  ? "text-red-500"
                                  : light ? "text-gray-600" : "text-gray-400"
                            }`}
                            style={isNet ? { color: "#22c55e" } : {}}
                          >
                            {val ? formatCurrency(val) : ""}
                          </td>
                        ))
                      ) : (
                        <td
                          className={`py-1.5 px-4 text-right tabular-nums ${
                            isTotal
                              ? `font-bold ${light ? "text-gray-900" : "text-white"}`
                              : parseFloat(row.values[0]) < 0
                                ? "text-red-500"
                                : light ? "text-gray-600" : "text-gray-400"
                          }`}
                          style={isNet ? { color: "#22c55e" } : {}}
                        >
                          {row.values[0] ? formatCurrency(row.values[0]) : ""}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && report && report.rows.length === 0 && (
        <div className={`${card} p-12 text-center`}>
          <p className={mutedText}>No data available for this period.</p>
        </div>
      )}
    </div>
  );
}
