import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router";

export function meta() {
  return [{ title: "BFO - Profit & Loss | QuickBooks" }];
}

type ReportRow = {
  label: string;
  values: string[];
  depth: number;
  bold?: boolean;
};

type ViewMode = "monthly" | "annual" | "custom";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function formatCurrency(val: string | number): string {
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return val as string;
  if (num === 0) return "0.00";
  const negative = num < 0;
  const formatted = Math.abs(num).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return negative ? `(${formatted})` : formatted;
}

function parseReport(data: any): { title: string; columns: string[]; rows: ReportRow[] } {
  if (!data?.Header) return { title: "", columns: [], rows: [] };
  const title = data.Header.ReportName || "";
  const columns = data.Columns?.Column?.map((c: any) => c.ColTitle || "") || [];
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
  const currentMonth = now.getMonth(); // 0-indexed

  const [viewMode, setViewMode] = useState<ViewMode>("monthly");
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [report, setReport] = useState<{ title: string; columns: string[]; rows: ReportRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastUpdatedText, setLastUpdatedText] = useState("");
  const [light, setLight] = useState(false);

  useEffect(() => {
    if (!lastUpdated) return;
    setLastUpdatedText(timeAgo(lastUpdated));
    const interval = setInterval(() => setLastUpdatedText(timeAgo(lastUpdated)), 30000);
    return () => clearInterval(interval);
  }, [lastUpdated]);

  const fetchPL = useCallback(async (startDate: string, endDate: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/quickbooks/data?report=profit-loss-detail&start_date=${startDate}&end_date=${endDate}`);
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

  // Fetch on mount and when filters change
  useEffect(() => {
    let startDate: string, endDate: string;

    if (viewMode === "monthly") {
      const year = selectedYear;
      const month = selectedMonth;
      startDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(year, month + 1, 0).getDate();
      endDate = `${year}-${String(month + 1).padStart(2, "0")}-${lastDay}`;
    } else if (viewMode === "annual") {
      startDate = `${selectedYear}-01-01`;
      endDate = `${selectedYear}-12-31`;
    } else {
      // custom — default to YTD
      startDate = `${currentYear}-01-01`;
      endDate = now.toISOString().split("T")[0];
    }

    fetchPL(startDate, endDate);
  }, [viewMode, selectedYear, selectedMonth, fetchPL]);

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  function handleGeneratePDF() {
    if (!report) return;
    const bgColor = light ? "#ffffff" : "#0a0a0a";
    const textColor = light ? "#111827" : "#f9fafb";
    const mutedColor = light ? "#6b7280" : "#9ca3af";
    const borderColor = light ? "#e5e7eb" : "rgba(255,255,255,0.1)";

    const periodLabel = viewMode === "monthly"
      ? `${FULL_MONTHS[selectedMonth]} ${selectedYear}`
      : viewMode === "annual"
        ? `Annual ${selectedYear}`
        : `Year to Date ${currentYear}`;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(`<!DOCTYPE html><html><head>
      <title>Profit & Loss - ${periodLabel}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: ${bgColor}; color: ${textColor}; padding: 40px; font-size: 11px; }
        .header { margin-bottom: 24px; padding-bottom: 12px; border-bottom: 2px solid ${borderColor}; }
        .header h1 { font-size: 20px; margin-bottom: 4px; }
        .header p { color: ${mutedColor}; font-size: 12px; }
        .row { display: flex; justify-content: space-between; padding: 3px 8px; font-size: 10px; color: ${mutedColor}; }
        .row.bold { font-weight: 600; color: ${textColor}; }
        .row.total { border-top: 1px solid ${borderColor}; font-weight: 700; color: ${textColor}; }
        .row.section { margin-top: 10px; margin-bottom: 4px; }
        .negative { color: #ef4444; }
        .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid ${borderColor}; font-size: 10px; color: ${mutedColor}; text-align: center; }
        @media print { body { padding: 20px; } }
      </style></head><body>
      <div class="header">
        <h1>Profit & Loss</h1>
        <p>${periodLabel} &middot; Generated ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
      </div>
      ${report.rows.map((row) => {
        const isTotal = row.label.toLowerCase().startsWith("total") || row.label.toLowerCase().startsWith("net ");
        const isSection = row.bold && row.values.every((v) => !v);
        const cls = isTotal ? "row total" : isSection ? "row bold section" : row.bold ? "row bold" : "row";
        const val = row.values[0] || "";
        const negClass = parseFloat(val) < 0 ? ' class="negative"' : "";
        return `<div class="${cls}" style="padding-left:${row.depth * 16 + 8}px"><span>${row.label}</span>${val ? `<span${negClass}>${formatCurrency(val)}</span>` : ""}</div>`;
      }).join("")}
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
        <p className={`${mutedText} text-sm`}>Ledger Louise, LLC</p>
        {lastUpdated && <span className="text-xs text-gray-600">&middot; Updated {lastUpdatedText}</span>}
      </div>

      {/* View Mode Tabs */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Year selector — always shown */}
        <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} className={selectStyle}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>

        {/* Month selector — shown for monthly view */}
        {viewMode === "monthly" && (
          <div className="flex flex-wrap gap-1">
            {MONTHS.map((m, i) => {
              const disabled = selectedYear === currentYear && i > currentMonth;
              return (
                <button
                  key={m}
                  onClick={() => !disabled && setSelectedMonth(i)}
                  disabled={disabled}
                  className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                    selectedMonth === i
                      ? light ? "bg-green-100 text-green-700 font-medium" : "bg-green-500/20 text-green-400 font-medium"
                      : disabled
                        ? light ? "text-gray-300 cursor-not-allowed" : "text-gray-700 cursor-not-allowed"
                        : light ? "text-gray-600 hover:bg-gray-100" : "text-gray-400 hover:bg-white/5"
                  }`}
                >
                  {m}
                </button>
              );
            })}
          </div>
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

      {/* Report Table */}
      {!loading && report && report.rows.length > 0 && (
        <div className={`${card} p-4 sm:p-6`}>
          <div className="mb-4">
            <h3 className={`font-semibold text-sm ${headingText}`}>
              {viewMode === "monthly" ? `${FULL_MONTHS[selectedMonth]} ${selectedYear}` : viewMode === "annual" ? `Annual ${selectedYear}` : `Year to Date ${currentYear}`}
            </h3>
            <p className={`text-xs ${mutedText}`}>{report.title}</p>
          </div>
          <div className="space-y-0">
            {report.rows.map((row, i) => {
              const isTotal = row.label.toLowerCase().startsWith("total") || row.label.toLowerCase().startsWith("net ");
              const isSection = row.bold && row.values.every((v) => !v);
              const val = row.values[0] || "";
              return (
                <div
                  key={i}
                  className={`flex items-center justify-between py-1.5 px-3 text-xs ${
                    isTotal
                      ? `border-t ${light ? "border-gray-200" : "border-white/10"} font-bold`
                      : isSection
                        ? "mt-3 mb-1"
                        : light ? "text-gray-600" : "text-gray-400"
                  }`}
                  style={{ paddingLeft: `${row.depth * 16 + 12}px` }}
                >
                  <span className={row.bold ? `font-semibold ${light ? "text-gray-900" : "text-white"}` : ""}>{row.label}</span>
                  {val && (
                    <span
                      className={`tabular-nums ${
                        isTotal
                          ? light ? "text-gray-900" : "text-white"
                          : parseFloat(val) < 0 ? "text-red-500" : ""
                      }`}
                      style={isTotal && row.label.toLowerCase().includes("net") ? { color: "#22c55e" } : {}}
                    >
                      {formatCurrency(val)}
                    </span>
                  )}
                </div>
              );
            })}
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
