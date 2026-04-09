import { useState, useEffect, useCallback } from "react";
import { Link, useSearchParams, useLocation } from "react-router";

export function meta() {
  return [{ title: "BFO - Profit & Loss | Finance" }];
}

type ReportRow = {
  label: string;
  values: string[];
  depth: number;
  bold?: boolean;
};

type ViewMode = "monthly" | "annual";

type DrillDown = {
  account: string;
  period: string;
  startDate: string;
  endDate: string;
};

type LedgerEntry = {
  date: string;
  type: string;
  docNum: string;
  name: string;
  memo: string;
  amount: string;
  balance: string;
};

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
  const location = useLocation();
  const isPublic = location.pathname.startsWith("/public/");
  const realmId = searchParams.get("realm_id") || "";

  const [companyName, setCompanyName] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("monthly");
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [report, setReport] = useState<{ title: string; columns: string[]; rows: ReportRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastUpdatedText, setLastUpdatedText] = useState("");
  const [light, setLight] = useState(isPublic);
  const [searchQuery, setSearchQuery] = useState("");
  const [drill, setDrill] = useState<DrillDown | null>(null);
  const [drillEntries, setDrillEntries] = useState<LedgerEntry[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [focusMode, setFocusMode] = useState(true);
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
    } else {
      fetchPL(`/api/quickbooks/data?report=profit-loss-detail&start_date=${selectedYear}-01-01&end_date=${selectedYear}-12-31${realmParam}`);
    }
  }, [viewMode, selectedYear, fetchPL, realmParam]);

  // Drill-down: fetch GL for a specific account + period
  function matchesAccount(glName: string, plName: string): boolean {
    const gl = glName.toLowerCase().trim();
    const pl = plName.toLowerCase().trim();
    if (gl === pl) return true;
    // GL uses "Parent:Child" format, P&L shows just "Child"
    if (gl.endsWith(":" + pl)) return true;
    if (gl.includes(pl)) return true;
    return false;
  }

  useEffect(() => {
    if (!drill) return;
    setDrillLoading(true);
    setDrillEntries([]);
    fetch(`/api/quickbooks/data?report=general-ledger&start_date=${drill.startDate}&end_date=${drill.endDate}${realmParam}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data?.Rows?.Row) { setDrillLoading(false); return; }
        const entries: LedgerEntry[] = [];

        // Walk the GL tree and collect transactions for matching accounts
        function walk(rows: any[], currentAccount: string) {
          for (const row of rows) {
            // Account section with sub-rows
            if (row.Header?.ColData) {
              const headerName = row.Header.ColData[0]?.value || "";
              const isMatch = matchesAccount(headerName, drill!.account);

              // Walk sub-rows of this account section
              if (row.Rows?.Row) {
                for (const subRow of row.Rows.Row) {
                  if (isMatch && subRow.ColData) {
                    const cols = subRow.ColData;
                    entries.push({
                      date: cols[0]?.value || "",
                      type: cols[1]?.value || "",
                      docNum: cols[2]?.value || "",
                      name: cols[3]?.value || "",
                      memo: cols[4]?.value || "",
                      amount: cols[5]?.value || cols[6]?.value || "",
                      balance: cols[7]?.value || cols[6]?.value || "",
                    });
                  }
                  // Nested sub-accounts
                  if (subRow.Header?.ColData) {
                    const subName = subRow.Header.ColData[0]?.value || "";
                    const subMatch = matchesAccount(subName, drill!.account);
                    if (subMatch && subRow.Rows?.Row) {
                      for (const txn of subRow.Rows.Row) {
                        if (txn.ColData) {
                          const cols = txn.ColData;
                          entries.push({
                            date: cols[0]?.value || "",
                            type: cols[1]?.value || "",
                            docNum: cols[2]?.value || "",
                            name: cols[3]?.value || "",
                            memo: cols[4]?.value || "",
                            amount: cols[5]?.value || cols[6]?.value || "",
                            balance: cols[7]?.value || cols[6]?.value || "",
                          });
                        }
                      }
                    }
                  }
                }
              }
            }
            // Top-level transaction row (shouldn't happen often in GL)
            if (row.ColData && !row.Header && !row.Summary) {
              if (currentAccount && matchesAccount(currentAccount, drill!.account)) {
                const cols = row.ColData;
                entries.push({
                  date: cols[0]?.value || "",
                  type: cols[1]?.value || "",
                  docNum: cols[2]?.value || "",
                  name: cols[3]?.value || "",
                  memo: cols[4]?.value || "",
                  amount: cols[5]?.value || cols[6]?.value || "",
                  balance: cols[7]?.value || cols[6]?.value || "",
                });
              }
            }
          }
        }
        walk(data.Rows.Row, "");
        setDrillEntries(entries);
      })
      .catch(() => {})
      .finally(() => setDrillLoading(false));
  }, [drill, realmParam]);

  function handleCellClick(account: string, colIndex: number) {
    if (!account || account.toLowerCase().startsWith("total") || account.toLowerCase().startsWith("net ")) return;
    let startDate: string, endDate: string, period: string;
    if (viewMode === "monthly") {
      const month = colIndex; // 0-indexed
      startDate = `${selectedYear}-${String(month + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(selectedYear, month + 1, 0).getDate();
      endDate = `${selectedYear}-${String(month + 1).padStart(2, "0")}-${lastDay}`;
      period = `${MONTHS_FULL[month]} ${selectedYear}`;
    } else {
      startDate = `${selectedYear}-01-01`;
      endDate = `${selectedYear}-12-31`;
      period = `${selectedYear}`;
    }
    setDrill({ account, period, startDate, endDate });
  }

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);
  const isMultiColumn = viewMode === "monthly" && report && report.columns.length > 1;

  function handleExportCSV() {
    if (!report) return;
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const header = ["Account", ...(isMultiColumn ? report.columns : ["Amount"])].map(esc).join(",");
    const rows = report.rows.map((row) => {
      const vals = isMultiColumn ? row.values : [row.values[0] || ""];
      return [row.label, ...vals.map((v) => v || "")].map(esc).join(",");
    });
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const entity = (companyName || "Entity").replace(/[^a-zA-Z0-9]/g, "");
    const today = new Date().toISOString().split("T")[0].replace(/-/g, "");
    a.download = `BFO${entity}ProfitLoss${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleGeneratePDF() {
    if (!report) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const generatedDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const periodLabel = viewMode === "monthly" ? `Monthly ${selectedYear}` : `Annual ${selectedYear}`;

    const colHeaders = isMultiColumn
      ? report.columns.map((c) => `<th class="col-header">${c}</th>`).join("")
      : `<th class="col-header">Amount</th>`;

    printWindow.document.write(`<!DOCTYPE html><html><head>
      <title>Profit & Loss - ${companyName || "BFO"} - ${periodLabel}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: #ffffff; color: #1a1a2e; padding: 0; font-size: 11px;
          -webkit-print-color-adjust: exact; print-color-adjust: exact;
        }
        .page { max-width: 800px; margin: 0 auto; padding: 48px 40px; }
        .header { margin-bottom: 32px; }
        .header-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
        .brand { display: flex; align-items: center; gap: 12px; }
        .brand-icon { width: 40px; height: 40px; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 10px; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 16px; letter-spacing: -0.5px; }
        .brand-text { display: flex; flex-direction: column; }
        .brand-name { font-size: 18px; font-weight: 700; color: #1a1a2e; letter-spacing: -0.3px; }
        .brand-sub { font-size: 11px; color: #64748b; font-weight: 400; }
        .header-meta { text-align: right; font-size: 10px; color: #94a3b8; line-height: 1.6; }
        .divider { height: 3px; background: linear-gradient(90deg, #1a1a2e 0%, #3b82f6 50%, #1a1a2e 100%); border-radius: 2px; margin-bottom: 8px; }
        .report-title-bar { display: flex; justify-content: space-between; align-items: baseline; padding: 12px 0; }
        .report-title { font-size: 22px; font-weight: 700; color: #1a1a2e; letter-spacing: -0.5px; }
        .report-period { font-size: 12px; color: #64748b; font-weight: 500; background: #f1f5f9; padding: 4px 12px; border-radius: 6px; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        thead th { padding: 10px 12px; font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: #64748b; border-bottom: 2px solid #e2e8f0; }
        thead th.account-col { text-align: left; }
        thead th.col-header { text-align: right; white-space: nowrap; }
        tbody td { padding: 6px 12px; font-size: 10.5px; font-variant-numeric: tabular-nums; border-bottom: 1px solid #f1f5f9; }
        tbody td.label-cell { text-align: left; color: #475569; }
        tbody td.value-cell { text-align: right; color: #475569; }
        tr.section-row td { padding-top: 18px; padding-bottom: 6px; border-bottom: none; font-weight: 700; font-size: 11px; color: #1a1a2e; letter-spacing: -0.2px; }
        tr.bold-row td { font-weight: 600; color: #1e293b; }
        tr.total-row td { border-top: 2px solid #cbd5e1; border-bottom: 2px solid #cbd5e1; font-weight: 700; color: #0f172a; font-size: 11px; padding-top: 8px; padding-bottom: 8px; background: #f8fafc; }
        tr.grand-total td { border-top: 3px double #1a1a2e; border-bottom: none; font-weight: 700; color: #0f172a; font-size: 11.5px; padding-top: 10px; padding-bottom: 10px; }
        tbody tr.stripe td { background: #fafbfc; }
        .negative { color: #dc2626; }
        .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
        .footer-left { font-size: 9px; color: #94a3b8; }
        .footer-right { font-size: 9px; color: #94a3b8; }
        .footer-right span { color: #64748b; font-weight: 500; }
        @media print { body { padding: 0; } .page { padding: 24px 20px; } }
      </style></head><body>
      <div class="page">
        <div class="header">
          <div class="header-top">
            <div class="brand">
              <div class="brand-icon">BFO</div>
              <div class="brand-text">
                <div class="brand-name">Burton Family Office</div>
                <div class="brand-sub">${companyName || ""}</div>
              </div>
            </div>
            <div class="header-meta">Generated ${generatedDate}<br/>QuickBooks Online</div>
          </div>
          <div class="divider"></div>
          <div class="report-title-bar">
            <div class="report-title">Profit & Loss</div>
            <div class="report-period">${periodLabel}</div>
          </div>
        </div>
        <table>
          <thead><tr><th class="account-col">Account</th>${colHeaders}</tr></thead>
          <tbody>
          ${report.rows.map((row, idx) => {
            const isTotal = row.label.toLowerCase().startsWith("total") || row.label.toLowerCase().startsWith("net ");
            const isGrandTotal = row.depth === 0 && isTotal;
            const isSection = row.bold && row.values.every((v) => !v);
            const cls = isGrandTotal ? "grand-total" : isTotal ? "total-row" : isSection ? "section-row" : row.bold ? "bold-row" : (idx % 2 === 0 ? "stripe" : "");
            const vals = isMultiColumn
              ? row.values.map((v) => `<td class="value-cell${parseFloat(v) < 0 ? " negative" : ""}">${v ? formatCurrency(v) : ""}</td>`).join("")
              : `<td class="value-cell${parseFloat(row.values[0]) < 0 ? " negative" : ""}">${row.values[0] ? formatCurrency(row.values[0]) : ""}</td>`;
            return `<tr class="${cls}"><td class="label-cell" style="padding-left:${row.depth * 18 + 12}px">${row.label}</td>${vals}</tr>`;
          }).join("")}
          </tbody>
        </table>
        <div class="footer">
          <div class="footer-left">Burton Family Office &middot; Confidential</div>
          <div class="footer-right">Page 1 &middot; <span>QuickBooks Online</span></div>
        </div>
      </div>
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
    <div className={`${pageBg} min-h-screen flex flex-col transition-colors duration-200`}>
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
      <div className={isPublic ? "px-6 sm:px-10 flex-1 flex flex-col" : ""}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-3">
          <Link to={isPublic ? "/public/bf-access" : "/tools/quickbooks"} className={`${mutedText} hover:text-white transition-colors`}>
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
          <button
            onClick={() => { setFocusMode((v) => !v); setHoveredRow(null); setHoveredCol(null); }}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${focusMode ? "bg-green-500/10 text-green-600 border border-green-500/20" : btnBorder}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><line x1="12" y1="2" x2="12" y2="6" stroke="currentColor" strokeWidth={2} /><line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" strokeWidth={2} /><line x1="2" y1="12" x2="6" y2="12" stroke="currentColor" strokeWidth={2} /><line x1="18" y1="12" x2="22" y2="12" stroke="currentColor" strokeWidth={2} /></svg>
            Focus
          </button>
          <button onClick={handleExportCSV} disabled={!report || loading} className={`text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50 ${btnBorder}`}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            CSV
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
        <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} className={selectStyle}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <div className={`h-4 w-px ${light ? "bg-gray-300" : "bg-gray-600"}`} />
        <div className="flex items-center gap-2">
          {(["monthly", "annual"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${viewMode === mode ? btnActive : btnBorder}`}
            >
              {mode === "monthly" ? "Monthly" : "Annual"}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 text-sm">
          {error}
          <button onClick={() => setError("")} className="ml-3 underline">Dismiss</button>
        </div>
      )}

      {!loading && report && report.rows.length > 0 && (
        <div className="mb-4">
          <div className="relative">
            <svg className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${light ? "text-gray-400" : "text-gray-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input type="text" placeholder="Search accounts..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className={`w-full pl-10 pr-4 py-2 text-sm rounded-lg transition-colors ${light ? "bg-white border border-gray-200 text-gray-900 placeholder-gray-400 focus:border-gray-400" : "bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:border-white/20"} focus:outline-none`} />
          </div>
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
          <div className="p-5 sm:p-8 pb-3">
            <h3 className={`font-semibold text-sm ${headingText}`}>
              {viewMode === "monthly" ? `${selectedYear} Monthly Breakdown` : `Annual ${selectedYear}`}
            </h3>
            <p className={`text-xs ${mutedText}`}>{report.title}</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              {/* Column Headers */}
              {isMultiColumn && (
                <thead>
                  <tr>
                    <th className={`text-left py-3 px-6 ${mutedText} font-medium sticky left-0 ${light ? "bg-gray-50" : "bg-[#0d0d0d]"}`} style={{ minWidth: "200px" }}>
                      Account
                    </th>
                    {report.columns.map((col, ci) => (
                      <th key={ci} className={`text-right py-3 px-4 ${mutedText} font-medium whitespace-nowrap`} style={{ minWidth: "90px" }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody onMouseLeave={() => { setHoveredRow(null); setHoveredCol(null); }}>
                {report.rows.filter((row) => !searchQuery || row.label.toLowerCase().includes(searchQuery.toLowerCase())).map((row, i) => {
                  const isTotal = row.label.toLowerCase().startsWith("total") || row.label.toLowerCase().startsWith("net ");
                  const isSection = row.bold && row.values.every((v) => !v);
                  const isNet = isTotal && row.label.toLowerCase().includes("net");
                  const rowId = `${row.label}-${i}`;

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
                      {/* Label cell — never dims */}
                      <td
                        className={`py-2 px-6 ${
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
                        row.values.map((val, vi) => {
                          const clickable = !isTotal && !isSection && !row.bold && val && parseFloat(val) !== 0;
                          return (
                            <td
                              key={vi}
                              onMouseEnter={() => { setHoveredRow(rowId); setHoveredCol(vi); }}
                              onClick={clickable ? () => handleCellClick(row.label, vi) : undefined}
                              className={`py-2 px-4 text-right tabular-nums whitespace-nowrap transition-opacity duration-200 ${
                                isTotal
                                  ? `font-bold ${light ? "text-gray-900" : "text-white"}`
                                  : parseFloat(val) < 0
                                    ? "text-red-500"
                                    : light ? "text-gray-600" : "text-gray-400"
                              } ${clickable ? "cursor-pointer hover:underline hover:text-green-400" : ""} ${getCellHighlight(rowId, vi)}`}
                              style={isNet ? { color: "#22c55e" } : {}}
                            >
                              {val ? formatCurrency(val) : ""}
                            </td>
                          );
                        })
                      ) : (
                        (() => {
                          const clickable = !isTotal && !isSection && !row.bold && row.values[0] && parseFloat(row.values[0]) !== 0;
                          return (
                            <td
                              onMouseEnter={() => { setHoveredRow(rowId); setHoveredCol(0); }}
                              onClick={clickable ? () => handleCellClick(row.label, 0) : undefined}
                              className={`py-1.5 px-4 text-right tabular-nums transition-opacity duration-200 ${
                                isTotal
                                  ? `font-bold ${light ? "text-gray-900" : "text-white"}`
                                  : parseFloat(row.values[0]) < 0
                                    ? "text-red-500"
                                    : light ? "text-gray-600" : "text-gray-400"
                              } ${clickable ? "cursor-pointer hover:underline hover:text-green-400" : ""} ${getCellHighlight(rowId, 0)}`}
                              style={isNet ? { color: "#22c55e" } : {}}
                            >
                              {row.values[0] ? formatCurrency(row.values[0]) : ""}
                            </td>
                          );
                        })()
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

      {isPublic && (
        <footer className="border-t border-gray-200 mt-auto pt-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold tracking-tight text-gray-900">BFO</span>
            <span className="text-[10px] text-gray-400">Burton Family Office</span>
          </div>
          <p className="text-[10px] text-gray-400">Confidential - For authorized recipients only</p>
        </footer>
      )}

      {/* Drill-down modal */}
      {drill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setDrill(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            onClick={(e) => e.stopPropagation()}
            className={`relative w-full max-w-6xl max-h-[90vh] overflow-y-auto rounded-xl shadow-2xl ${light ? "bg-white" : "bg-[#0d0d0d]"} border ${light ? "border-gray-200" : "border-white/10"}`}
          >
            <div className="sticky top-0 z-10 p-5 border-b flex items-center justify-between rounded-t-xl" style={{ borderColor: light ? "#e5e7eb" : "rgba(255,255,255,0.1)", background: light ? "#ffffff" : "#0d0d0d" }}>
              <div>
                <h3 className={`font-semibold text-sm ${headingText}`}>{drill.account}</h3>
                <p className={`text-xs ${mutedText}`}>General Ledger &middot; {drill.period}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (!drillEntries.length) return;
                    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
                    const header = ["Date", "Type", "Name", "Memo", "Amount", "Balance"].map(esc).join(",");
                    const rows = drillEntries.map((e) => [e.date, e.type, e.name, e.memo, e.amount, e.balance].map(esc).join(","));
                    const csv = [header, ...rows].join("\n");
                    const blob = new Blob([csv], { type: "text/csv" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    const entity = (companyName || "Entity").replace(/[^a-zA-Z0-9]/g, "");
                    const acct = drill.account.replace(/[^a-zA-Z0-9]/g, "");
                    const today = new Date().toISOString().split("T")[0].replace(/-/g, "");
                    a.download = `BFO${entity}${acct}${today}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  disabled={drillEntries.length === 0}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50 ${btnBorder}`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  CSV
                </button>
                <button
                  onClick={() => {
                    if (!drillEntries.length) return;
                    const pw = window.open("", "_blank");
                    if (!pw) return;
                    const genDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
                    pw.document.write(`<!DOCTYPE html><html><head><title>${drill.account} - GL</title><style>
                      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
                      *{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;font-size:11px;padding:40px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
                      .header{margin-bottom:24px}.brand{display:flex;align-items:center;gap:10px;margin-bottom:16px}.brand-icon{width:36px;height:36px;background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px}
                      .brand-name{font-size:16px;font-weight:700;color:#1a1a2e}.brand-sub{font-size:10px;color:#64748b}.divider{height:2px;background:linear-gradient(90deg,#1a1a2e,#3b82f6,#1a1a2e);border-radius:2px;margin-bottom:8px}
                      .title{font-size:18px;font-weight:700;color:#1a1a2e;margin-bottom:4px}.period{font-size:11px;color:#64748b}
                      table{width:100%;border-collapse:collapse;margin-top:16px}thead th{padding:8px;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;border-bottom:2px solid #e2e8f0;text-align:left}
                      thead th.right{text-align:right}tbody td{padding:6px 8px;font-size:10px;border-bottom:1px solid #f1f5f9;color:#475569}td.right{text-align:right;font-variant-numeric:tabular-nums}
                      .footer{margin-top:32px;padding-top:12px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8}
                      @media print{body{padding:20px}}
                    </style></head><body>
                      <div class="header"><div class="brand"><div class="brand-icon">BFO</div><div><div class="brand-name">Burton Family Office</div><div class="brand-sub">${companyName || ""}</div></div></div><div class="divider"></div>
                      <div class="title">${drill.account}</div><div class="period">General Ledger &middot; ${drill.period} &middot; Generated ${genDate}</div></div>
                      <table><thead><tr><th>Date</th><th>Type</th><th>Name</th><th>Memo</th><th class="right">Amount</th><th class="right">Balance</th></tr></thead><tbody>
                      ${drillEntries.map((e) => `<tr><td>${e.date}</td><td>${e.type}</td><td>${e.name}</td><td>${e.memo}</td><td class="right">${e.amount ? formatCurrency(e.amount) : ""}</td><td class="right">${e.balance ? formatCurrency(e.balance) : ""}</td></tr>`).join("")}
                      </tbody></table><div class="footer"><div>Burton Family Office &middot; Confidential</div><div>QuickBooks Online</div></div>
                    </body></html>`);
                    pw.document.close();
                    setTimeout(() => pw.print(), 500);
                  }}
                  disabled={drillEntries.length === 0}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50 ${btnBorder}`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                  PDF
                </button>
                <button onClick={() => setDrill(null)} className={`p-1.5 rounded-lg ${btnBorder}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            <div className="p-6">
              {drillLoading && (
                <div className="flex items-center justify-center py-16">
                  <div className={`animate-spin rounded-full h-6 w-6 border-2 ${light ? "border-gray-200 border-t-gray-600" : "border-white/20 border-t-white/80"}`} />
                </div>
              )}
              {!drillLoading && drillEntries.length === 0 && (
                <p className={`text-center py-16 text-sm ${mutedText}`}>No transactions found for this account in this period.</p>
              )}
              {!drillLoading && drillEntries.length > 0 && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className={`${mutedText}`}>
                      <th className="text-left py-2 px-3 font-medium">Date</th>
                      <th className="text-left py-2 px-3 font-medium">Type</th>
                      <th className="text-left py-2 px-3 font-medium">Name</th>
                      <th className="text-left py-2 px-3 font-medium">Memo</th>
                      <th className="text-right py-2 px-3 font-medium">Amount</th>
                      <th className="text-right py-2 px-3 font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillEntries.map((entry, ei) => (
                      <tr key={ei} className={`border-t ${light ? "border-gray-100" : "border-white/5"}`}>
                        <td className={`py-2 px-3 whitespace-nowrap ${light ? "text-gray-600" : "text-gray-400"}`}>{entry.date}</td>
                        <td className={`py-2 px-3 whitespace-nowrap ${light ? "text-gray-600" : "text-gray-400"}`}>{entry.type}</td>
                        <td className={`py-2 px-3 ${light ? "text-gray-800" : "text-gray-300"}`}>{entry.name}</td>
                        <td className={`py-2 px-3 ${mutedText}`}>{entry.memo}</td>
                        <td className={`py-2 px-3 text-right tabular-nums whitespace-nowrap ${parseFloat(entry.amount) < 0 ? "text-red-500" : light ? "text-gray-800" : "text-gray-300"}`}>
                          {entry.amount ? formatCurrency(entry.amount) : ""}
                        </td>
                        <td className={`py-2 px-3 text-right tabular-nums whitespace-nowrap ${light ? "text-gray-600" : "text-gray-400"}`}>
                          {entry.balance ? formatCurrency(entry.balance) : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
