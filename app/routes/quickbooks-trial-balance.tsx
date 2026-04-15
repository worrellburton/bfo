import { useState, useEffect, useCallback } from "react";
import { Link, useSearchParams, useLocation } from "react-router";
import { useTheme } from "../theme";
import { WebGLBackground } from "../webgl-backgrounds";

export function meta() {
  return [{ title: "BFO - Trial Balance | Finance" }];
}

type ReportRow = {
  label: string;
  values: string[];
  depth: number;
  bold?: boolean;
};

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

export default function TrialBalance() {
  const currentYear = new Date().getFullYear();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const isPublic = location.pathname.startsWith("/public/");
  const { backgroundId, theme, toggle } = useTheme();
  const realmId = searchParams.get("realm_id") || "";

  const [companyName, setCompanyName] = useState("");
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [report, setReport] = useState<{ title: string; columns: string[]; rows: ReportRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastUpdatedText, setLastUpdatedText] = useState("");
  // Public pages are always light; authenticated pages follow the global theme
  const light = isPublic ? true : theme === "light";
  const [searchQuery, setSearchQuery] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);

  function getCellHighlight(rowId: string, colIdx: number, isLabel?: boolean): string {
    if (!focusMode || isLabel) return "";
    if (hoveredRow === null || hoveredCol === null) return "";
    if (rowId === hoveredRow || colIdx === hoveredCol) return "";
    return "opacity-20";
  }

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

  const fetchTB = useCallback(async (asOf: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/quickbooks/data?report=trial-balance&as_of=${asOf}${realmParam}`);
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
    fetchTB(`${selectedYear}-12-31`);
  }, [selectedYear, fetchTB, realmParam]);

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  function handleExportCSV() {
    if (!report) return;
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const header = ["Account", ...report.columns].map(esc).join(",");
    const rows = report.rows.map((row) =>
      [row.label, ...row.values.map((v) => v || "")].map(esc).join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const entity = (companyName || "Entity").replace(/[^a-zA-Z0-9]/g, "");
    const today = new Date().toISOString().split("T")[0].replace(/-/g, "");
    a.download = `BFO${entity}TrialBalance${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportXLSX() {
    if (!report) return;
    const XLSX = await import("xlsx");
    const aoa: (string | number)[][] = [
      [report.title || "Trial Balance"],
      [companyName || ""],
      [`As of December 31, ${selectedYear}`],
      [],
      ["Account", ...report.columns],
    ];
    for (const row of report.rows) {
      const indent = "  ".repeat(Math.min(row.depth, 6));
      const vals = row.values.map((v) => {
        if (!v) return "";
        const cleaned = String(v).replace(/,/g, "").replace(/\$/g, "").trim();
        const neg = /^\(.*\)$/.test(cleaned);
        const n = parseFloat(cleaned.replace(/[()]/g, ""));
        return Number.isFinite(n) ? (neg ? -n : n) : v;
      });
      aoa.push([`${indent}${row.label || ""}`, ...vals]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const totalCols = 1 + report.columns.length;
    (ws as any)["!cols"] = [{ wch: 42 }, ...report.columns.map(() => ({ wch: 16 }))];
    (ws as any)["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: totalCols - 1 } },
    ];
    for (let r = 5; r < aoa.length; r++) {
      for (let c = 1; c < totalCols; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = (ws as any)[addr];
        if (cell && typeof cell.v === "number") {
          cell.t = "n";
          cell.z = '#,##0.00;(#,##0.00);"–"';
        }
      }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `TB_FY${selectedYear}`.slice(0, 31));
    const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const blob = new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const entity = (companyName || "Entity").replace(/[^a-zA-Z0-9]/g, "");
    const today = new Date().toISOString().split("T")[0].replace(/-/g, "");
    a.download = `BFO${entity}TrialBalance${today}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }


  const pageBg = light ? "bg-white text-gray-900" : "";
  const card = light ? "rounded-xl border border-gray-200 bg-gray-50" : "rounded-xl border border-white/10 bg-white/[0.02]";
  const mutedText = light ? "text-gray-500" : "text-gray-500";
  const headingText = light ? "text-gray-900" : "";
  const btnBorder = light ? "border border-gray-200 hover:border-gray-400 text-gray-600 hover:text-gray-900" : "border border-white/10 hover:border-white/20 text-gray-500 hover:text-white";
  const selectStyle = light
    ? "bg-gray-100 border border-gray-300 text-gray-900 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-amber-500"
    : "bg-white/5 border border-white/10 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-amber-500/50";

  return (
    <div className={`${pageBg} min-h-screen flex flex-col transition-colors duration-200 relative`}>
      {isPublic && <WebGLBackground backgroundId={backgroundId} dark={!light} />}
      {isPublic && (
        <header className="border-b border-gray-200 bg-white sticky top-0 z-10 mb-6">
          <div className="px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xl font-bold tracking-tight text-gray-900">BFO</span>
              <div className="h-5 w-px bg-gray-200" />
              <span className="text-xs text-gray-400 uppercase tracking-wider">BeachFleischman Access</span>
            </div>
          </div>
        </header>
      )}
      <div className={isPublic ? "px-6 sm:px-10 flex-1 flex flex-col relative z-[1]" : ""}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-3">
          <Link to={isPublic ? "/public/bf-access" : "/tools/quickbooks"} className={`${mutedText} hover:text-white transition-colors`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className={`text-2xl font-bold ${headingText}`}>Trial Balance</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { if (!isPublic) toggle(); }} disabled={isPublic} className={`text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${btnBorder}`}>
            {light ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
            )}
          </button>
          <button
            onClick={() => { setFocusMode((v) => !v); setHoveredRow(null); setHoveredCol(null); }}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${focusMode ? "bg-amber-500/10 text-amber-600 border border-amber-500/20" : btnBorder}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><line x1="12" y1="2" x2="12" y2="6" stroke="currentColor" strokeWidth={2} /><line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" strokeWidth={2} /><line x1="2" y1="12" x2="6" y2="12" stroke="currentColor" strokeWidth={2} /><line x1="18" y1="12" x2="22" y2="12" stroke="currentColor" strokeWidth={2} /></svg>
            Focus
          </button>
          <button onClick={handleExportCSV} disabled={!report || loading} className={`text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50 ${btnBorder}`}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            CSV
          </button>
          <button onClick={handleExportXLSX} disabled={!report || loading} className={`text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50 ${btnBorder}`}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2a2 2 0 012-2h2a2 2 0 012 2v2m-6 0h6m-6 0H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2" /></svg>
            XLSX
          </button>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-6">
        <p className={`${mutedText} text-sm`}>{companyName || "Loading..."}</p>
        {lastUpdated && <span className="text-xs text-gray-600">&middot; Updated {lastUpdatedText}</span>}
      </div>

      {/* Year Selector */}
      <div className="flex items-center gap-3 mb-6">
        <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} className={selectStyle}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <div className={`h-4 w-px ${light ? "bg-gray-300" : "bg-gray-600"}`} />
        <span className={`text-xs ${mutedText}`}>As of December 31</span>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 text-sm">
          {error}<button onClick={() => setError("")} className="ml-3 underline">Dismiss</button>
        </div>
      )}

      {!loading && report && report.rows.length > 0 && (
        <div className="mb-4">
          <div className="relative">
            <svg className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${light ? "text-gray-400" : "text-gray-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              type="text"
              placeholder="Search accounts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full pl-10 pr-4 py-2 text-sm rounded-lg transition-colors ${light ? "bg-white border border-gray-200 text-gray-900 placeholder-gray-400 focus:border-gray-400" : "bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:border-white/20"} focus:outline-none`}
            />
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-24">
          <div className={`animate-spin rounded-full h-8 w-8 border-2 ${light ? "border-gray-200 border-t-gray-600" : "border-white/20 border-t-white/80"}`} />
        </div>
      )}

      {!loading && report && report.rows.length > 0 && (
        <div className={`${card} overflow-hidden`}>
          <div className="p-4 sm:p-6 pb-2">
            <h3 className={`font-semibold text-sm ${headingText}`}>As of December 31, {selectedYear}</h3>
            <p className={`text-xs ${mutedText}`}>{report.title}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className={`text-left py-2 px-4 ${mutedText} font-medium sticky left-0 ${light ? "bg-gray-50" : "bg-[#0d0d0d]"}`} style={{ minWidth: "250px" }}>Account</th>
                  {report.columns.map((col, ci) => (
                    <th key={ci} className={`text-right py-2 px-4 ${mutedText} font-medium whitespace-nowrap`}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody onMouseLeave={() => { setHoveredRow(null); setHoveredCol(null); }}>
                {report.rows.filter((row) => !searchQuery || row.label.toLowerCase().includes(searchQuery.toLowerCase())).map((row, i) => {
                  const isTotal = row.label.toLowerCase().startsWith("total");
                  const isSection = row.bold && row.values.every((v) => !v);
                  const rowId = `${row.label}-${i}`;
                  return (
                    <tr key={i} className={isTotal ? `border-t ${light ? "border-gray-200" : "border-white/10"}` : ""}>
                      <td
                        className={`py-1.5 px-4 ${isSection ? "pt-4 pb-1" : ""} ${
                          row.bold ? `font-semibold ${light ? "text-gray-900" : "text-white"}` : light ? "text-gray-600" : "text-gray-400"
                        } ${isTotal ? "font-bold" : ""} sticky left-0 ${light ? "bg-gray-50" : "bg-[#0d0d0d]"}`}
                        style={{ paddingLeft: `${row.depth * 16 + 16}px`, minWidth: "250px" }}
                      >
                        {row.label}
                      </td>
                      {row.values.map((val, vi) => (
                        <td
                          key={vi}
                          onMouseEnter={() => { setHoveredRow(rowId); setHoveredCol(vi); }}
                          className={`py-1.5 px-4 text-right tabular-nums whitespace-nowrap transition-opacity duration-200 ${
                            isTotal ? `font-bold ${light ? "text-gray-900" : "text-white"}` : light ? "text-gray-600" : "text-gray-400"
                          } ${getCellHighlight(rowId, vi)}`}
                        >
                          {val ? formatCurrency(val) : ""}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && report && report.rows.length === 0 && (
        <div className={`${card} p-12 text-center`}><p className={mutedText}>No data available for this period.</p></div>
      )}

      {isPublic && (
        <footer className="border-t border-gray-200 mt-auto pt-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold tracking-tight text-gray-900">BFO</span>
            <span className="text-[10px] text-gray-400">Burton Family Office</span>
          </div>
          <p className="text-[10px] text-gray-400">Confidential - For authorized recipients only</p>
        </footer>
      )}
      </div>
    </div>
  );
}
