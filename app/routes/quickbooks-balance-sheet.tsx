import { useState, useEffect, useCallback } from "react";
import { Link, useSearchParams, useLocation } from "react-router";
import { useTheme } from "../theme";
import { WebGLBackground } from "../webgl-backgrounds";

export function meta() {
  return [{ title: "BFO - Balance Sheet | Finance" }];
}

type ReportRow = {
  label: string;
  values: string[];
  depth: number;
  bold?: boolean;
};

type ViewMode = "monthly" | "annual" | "current";

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

export default function BalanceSheet() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const isPublic = location.pathname.startsWith("/public/");
  const { backgroundId } = useTheme();
  const realmId = searchParams.get("realm_id") || "";

  const [companyName, setCompanyName] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("current");
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
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

  const fetchBS = useCallback(async (asOf: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/quickbooks/data?report=balance-sheet-detail&as_of=${asOf}${realmParam}`);
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
    let asOf: string;

    if (viewMode === "current") {
      // If user picked the current year, show as-of today; otherwise use end-of-year for the selected year
      asOf = selectedYear === currentYear
        ? now.toISOString().split("T")[0]
        : `${selectedYear}-12-31`;
    } else if (viewMode === "monthly") {
      // End of selected month
      const lastDay = new Date(selectedYear, selectedMonth + 1, 0).getDate();
      asOf = `${selectedYear}-${String(selectedMonth + 1).padStart(2, "0")}-${lastDay}`;
    } else {
      // Annual — end of year
      asOf = `${selectedYear}-12-31`;
    }

    fetchBS(asOf);
  }, [viewMode, selectedYear, selectedMonth, fetchBS, realmParam]);

  // Drill-down: fetch GL for a specific account + period
  function matchesAccount(glName: string, bsName: string): boolean {
    const gl = glName.toLowerCase().trim();
    const bs = bsName.toLowerCase().trim();
    if (gl === bs) return true;
    if (gl.endsWith(":" + bs)) return true;
    if (gl.includes(bs)) return true;
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
        function walk(rows: any[], currentAccount: string) {
          for (const row of rows) {
            if (row.Header?.ColData) {
              const headerName = row.Header.ColData[0]?.value || "";
              const isMatch = matchesAccount(headerName, drill!.account);
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

  function handleCellClick(account: string) {
    if (!account || account.toLowerCase().startsWith("total") || account.toLowerCase().startsWith("net ")) return;
    let startDate: string, endDate: string, period: string;
    if (viewMode === "monthly") {
      startDate = `${selectedYear}-${String(selectedMonth + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(selectedYear, selectedMonth + 1, 0).getDate();
      endDate = `${selectedYear}-${String(selectedMonth + 1).padStart(2, "0")}-${lastDay}`;
      period = `${FULL_MONTHS[selectedMonth]} ${selectedYear}`;
    } else if (viewMode === "annual") {
      startDate = `${selectedYear}-01-01`;
      endDate = `${selectedYear}-12-31`;
      period = `${selectedYear}`;
    } else {
      startDate = `${currentYear}-01-01`;
      endDate = now.toISOString().split("T")[0];
      period = `YTD ${currentYear}`;
    }
    setDrill({ account, period, startDate, endDate });
  }

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  function handleExportCSV() {
    if (!report) return;
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const header = ["Account", "Amount"].map(esc).join(",");
    const rows = report.rows.map((row) =>
      [row.label, row.values[0] || ""].map(esc).join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const entity = (companyName || "Entity").replace(/[^a-zA-Z0-9]/g, "");
    const today = new Date().toISOString().split("T")[0].replace(/-/g, "");
    a.download = `BFO${entity}BalanceSheet${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleGeneratePDF() {
    if (!report) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const generatedDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const periodLabel = viewMode === "current"
      ? selectedYear === currentYear
        ? `As of ${now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
        : `As of December 31, ${selectedYear}`
      : viewMode === "monthly"
        ? `As of ${FULL_MONTHS[selectedMonth]} ${selectedYear}`
        : `As of December 31, ${selectedYear}`;

    printWindow.document.write(`<!DOCTYPE html><html><head>
      <title>Balance Sheet - ${companyName || "BFO"} - ${periodLabel}</title>
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
        thead th.col-header { text-align: right; }
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
            <div class="report-title">Balance Sheet</div>
            <div class="report-period">${periodLabel}</div>
          </div>
        </div>
        <table>
          <thead><tr><th class="account-col">Account</th><th class="col-header">Amount</th></tr></thead>
          <tbody>
          ${report.rows.map((row, idx) => {
            const isTotal = row.label.toLowerCase().startsWith("total") || row.label.toLowerCase().startsWith("net ");
            const isGrandTotal = row.depth === 0 && isTotal;
            const isSection = row.bold && row.values.every((v) => !v);
            const cls = isGrandTotal ? "grand-total" : isTotal ? "total-row" : isSection ? "section-row" : row.bold ? "bold-row" : (idx % 2 === 0 ? "stripe" : "");
            const val = row.values[0] || "";
            const negCls = parseFloat(val) < 0 ? " negative" : "";
            return `<tr class="${cls}"><td class="label-cell" style="padding-left:${row.depth * 18 + 12}px">${row.label}</td><td class="value-cell${negCls}">${val ? formatCurrency(val) : ""}</td></tr>`;
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
  const btnActive = light ? "border border-blue-500 bg-blue-50 text-blue-700" : "border border-blue-500/40 bg-blue-500/10 text-blue-400";
  const selectStyle = light
    ? "bg-gray-100 border border-gray-300 text-gray-900 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-blue-500"
    : "bg-white/5 border border-white/10 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-blue-500/50";

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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-3">
          <Link to={isPublic ? "/public/bf-access" : "/tools/quickbooks"} className={`${mutedText} hover:text-white transition-colors`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className={`text-2xl font-bold ${headingText}`}>Balance Sheet</h1>
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
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${focusMode ? "bg-blue-500/10 text-blue-600 border border-blue-500/20" : btnBorder}`}
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

      {/* View Mode Tabs */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} className={selectStyle}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <div className={`h-4 w-px ${light ? "bg-gray-300" : "bg-gray-600"}`} />
        {(["current", "monthly", "annual"] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${viewMode === mode ? btnActive : btnBorder}`}
          >
            {mode === "current" ? "Current" : mode === "monthly" ? "Monthly" : "Annual"}
          </button>
        ))}
      </div>

      {/* Filters */}
      {viewMode === "monthly" && (
        <div className="flex flex-wrap items-center gap-3 mb-6">
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
                      ? light ? "bg-blue-100 text-blue-700 font-medium" : "bg-blue-500/20 text-blue-400 font-medium"
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
        </div>
      )}

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

      {/* Report Table */}
      {!loading && report && report.rows.length > 0 && (
        <div className={`${card} p-4 sm:p-6`}>
          <div className="mb-4">
            <h3 className={`font-semibold text-sm ${headingText}`}>
              {viewMode === "current"
                ? selectedYear === currentYear
                  ? `As of ${now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
                  : `As of December 31, ${selectedYear}`
                : viewMode === "monthly"
                  ? `As of end of ${FULL_MONTHS[selectedMonth]} ${selectedYear}`
                  : `As of December 31, ${selectedYear}`}
            </h3>
            <p className={`text-xs ${mutedText}`}>{report.title}</p>
          </div>
          <div className="space-y-0" onMouseLeave={() => { setHoveredRow(null); setHoveredCol(null); }}>
            {report.rows.filter((row) => !searchQuery || row.label.toLowerCase().includes(searchQuery.toLowerCase())).map((row, i) => {
              const isTotal = row.label.toLowerCase().startsWith("total") || row.label.toLowerCase().startsWith("net ");
              const isSection = row.bold && row.values.every((v) => !v);
              const val = row.values[0] || "";
              const rowId = `${row.label}-${i}`;
              // Explicit text color so bold section/total rows don't fall back to light/inherited gray
              const rowTextColor = isTotal || isSection || row.bold
                ? (light ? "text-gray-900" : "text-white")
                : (light ? "text-gray-700" : "text-gray-400");
              return (
                <div
                  key={i}
                  onMouseEnter={() => { setHoveredRow(rowId); setHoveredCol(0); }}
                  className={`flex items-center justify-between py-1.5 px-3 text-xs ${rowTextColor} ${
                    isTotal
                      ? `border-t ${light ? "border-gray-200" : "border-white/10"} font-bold`
                      : isSection
                        ? "mt-3 mb-1"
                        : ""
                  }`}
                  style={{ paddingLeft: `${row.depth * 16 + 12}px` }}
                >
                  <span className={row.bold ? "font-semibold" : ""}>{row.label}</span>
                  {val && (() => {
                    const clickable = !isTotal && !isSection && !row.bold && parseFloat(val) !== 0;
                    return (
                      <span
                        onClick={clickable ? () => handleCellClick(row.label) : undefined}
                        className={`tabular-nums transition-opacity duration-200 ${
                          parseFloat(val) < 0 ? "text-red-500" : ""
                        } ${clickable ? "cursor-pointer hover:underline hover:text-blue-400" : ""} ${getCellHighlight(rowId, 0)}`}
                        style={isTotal && row.label.toLowerCase().includes("equity") ? { color: "#a855f7" } : isTotal && row.label.toLowerCase().includes("assets") ? { color: "#3b82f6" } : {}}
                      >
                        {formatCurrency(val)}
                      </span>
                    );
                  })()}
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
