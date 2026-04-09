import { useState, useEffect, useCallback } from "react";
import { Link, useSearchParams, useLocation } from "react-router";

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
  const realmId = searchParams.get("realm_id") || "";

  const [companyName, setCompanyName] = useState("");
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [report, setReport] = useState<{ title: string; columns: string[]; rows: ReportRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastUpdatedText, setLastUpdatedText] = useState("");
  const [light, setLight] = useState(isPublic);

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

  function handleGeneratePDF() {
    if (!report) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const generatedDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

    const colHeaders = report.columns.map((c) => `<th class="col-header">${c}</th>`).join("");

    printWindow.document.write(`<!DOCTYPE html><html><head>
      <title>Trial Balance - ${companyName || "BFO"} - Dec 31, ${selectedYear}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: #ffffff;
          color: #1a1a2e;
          padding: 0;
          font-size: 11px;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        .page { max-width: 800px; margin: 0 auto; padding: 48px 40px; }

        /* Header */
        .header {
          margin-bottom: 32px;
          position: relative;
        }
        .header-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 20px;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .brand-icon {
          width: 40px;
          height: 40px;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 700;
          font-size: 16px;
          letter-spacing: -0.5px;
        }
        .brand-text { display: flex; flex-direction: column; }
        .brand-name { font-size: 18px; font-weight: 700; color: #1a1a2e; letter-spacing: -0.3px; }
        .brand-sub { font-size: 11px; color: #64748b; font-weight: 400; }
        .header-meta {
          text-align: right;
          font-size: 10px;
          color: #94a3b8;
          line-height: 1.6;
        }
        .divider {
          height: 3px;
          background: linear-gradient(90deg, #1a1a2e 0%, #3b82f6 50%, #1a1a2e 100%);
          border-radius: 2px;
          margin-bottom: 8px;
        }
        .report-title-bar {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          padding: 12px 0;
        }
        .report-title { font-size: 22px; font-weight: 700; color: #1a1a2e; letter-spacing: -0.5px; }
        .report-period {
          font-size: 12px;
          color: #64748b;
          font-weight: 500;
          background: #f1f5f9;
          padding: 4px 12px;
          border-radius: 6px;
        }

        /* Table */
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        thead th {
          padding: 10px 12px;
          font-size: 9px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: #64748b;
          border-bottom: 2px solid #e2e8f0;
        }
        thead th.account-col { text-align: left; }
        thead th.col-header { text-align: right; }

        tbody td {
          padding: 6px 12px;
          font-size: 10.5px;
          font-variant-numeric: tabular-nums;
          border-bottom: 1px solid #f1f5f9;
        }
        tbody td.label-cell { text-align: left; color: #475569; }
        tbody td.value-cell { text-align: right; color: #475569; }

        /* Row types */
        tr.section-row td {
          padding-top: 18px;
          padding-bottom: 6px;
          border-bottom: none;
          font-weight: 700;
          font-size: 11px;
          color: #1a1a2e;
          letter-spacing: -0.2px;
        }
        tr.bold-row td {
          font-weight: 600;
          color: #1e293b;
        }
        tr.total-row td {
          border-top: 2px solid #cbd5e1;
          border-bottom: 2px solid #cbd5e1;
          font-weight: 700;
          color: #0f172a;
          font-size: 11px;
          padding-top: 8px;
          padding-bottom: 8px;
          background: #f8fafc;
        }
        tr.grand-total td {
          border-top: 3px double #1a1a2e;
          border-bottom: none;
          font-weight: 700;
          color: #0f172a;
          font-size: 11.5px;
          padding-top: 10px;
          padding-bottom: 10px;
        }
        tr:hover td { background: #fafbfd; }
        tr.total-row:hover td { background: #f1f5f9; }

        /* Alternating subtle stripe */
        tbody tr.stripe td { background: #fafbfc; }
        tbody tr.stripe:hover td { background: #f5f7fa; }

        /* Footer */
        .footer {
          margin-top: 40px;
          padding-top: 16px;
          border-top: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .footer-left { font-size: 9px; color: #94a3b8; }
        .footer-right { font-size: 9px; color: #94a3b8; }
        .footer-right span { color: #64748b; font-weight: 500; }

        @media print {
          body { padding: 0; }
          .page { padding: 24px 20px; }
          tr:hover td, tr.total-row:hover td { background: inherit; }
        }
      </style></head><body>
      <div class="page">
        <div class="header">
          <div class="header-top">
            <div class="brand">
              <div class="brand-icon">BFO</div>
              <div class="brand-text">
                <div class="brand-name">${companyName || "Burton Family Office"}</div>
                <div class="brand-sub">Burton Family Office</div>
              </div>
            </div>
            <div class="header-meta">
              Generated ${generatedDate}<br/>
              QuickBooks Online
            </div>
          </div>
          <div class="divider"></div>
          <div class="report-title-bar">
            <div class="report-title">Trial Balance</div>
            <div class="report-period">As of December 31, ${selectedYear}</div>
          </div>
        </div>

        <table>
          <thead><tr><th class="account-col">Account</th>${colHeaders}</tr></thead>
          <tbody>
          ${report.rows.map((row, idx) => {
            const isTotal = row.label.toLowerCase().startsWith("total");
            const isGrandTotal = row.depth === 0 && isTotal;
            const isSection = row.bold && row.values.every((v) => !v);
            const cls = isGrandTotal ? "grand-total" : isTotal ? "total-row" : isSection ? "section-row" : row.bold ? "bold-row" : (idx % 2 === 0 ? "stripe" : "");
            const vals = row.values.map((v) => `<td class="value-cell">${v ? formatCurrency(v) : ""}</td>`).join("");
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

  const pageBg = light ? "bg-white text-gray-900" : "";
  const card = light ? "rounded-xl border border-gray-200 bg-gray-50" : "rounded-xl border border-white/10 bg-white/[0.02]";
  const mutedText = light ? "text-gray-500" : "text-gray-500";
  const headingText = light ? "text-gray-900" : "";
  const btnBorder = light ? "border border-gray-200 hover:border-gray-400 text-gray-600 hover:text-gray-900" : "border border-white/10 hover:border-white/20 text-gray-500 hover:text-white";
  const selectStyle = light
    ? "bg-white border border-gray-200 text-gray-900 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-amber-500"
    : "bg-white/5 border border-white/10 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-amber-500/50";

  return (
    <div className={`${pageBg} min-h-screen transition-colors duration-200 ${isPublic ? "p-6 sm:p-10" : ""}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-3">
          <Link to="/tools/quickbooks" className={`${mutedText} hover:text-white transition-colors`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className={`text-2xl font-bold ${headingText}`}>Trial Balance</h1>
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

      {/* Year Selector */}
      <div className="flex items-center gap-3 mb-6">
        <span className={`text-xs ${mutedText}`}>As of December 31,</span>
        <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} className={selectStyle}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 text-sm">
          {error}<button onClick={() => setError("")} className="ml-3 underline">Dismiss</button>
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
              <tbody>
                {report.rows.map((row, i) => {
                  const isTotal = row.label.toLowerCase().startsWith("total");
                  const isSection = row.bold && row.values.every((v) => !v);
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
                          className={`py-1.5 px-4 text-right tabular-nums whitespace-nowrap ${
                            isTotal ? `font-bold ${light ? "text-gray-900" : "text-white"}` : light ? "text-gray-600" : "text-gray-400"
                          }`}
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
    </div>
  );
}
