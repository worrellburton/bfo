import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router";

export function meta() {
  return [{ title: "BFO - QuickBooks | Ledger Louise" }];
}

type ReportRow = {
  label: string;
  value: string;
  depth: number;
  bold?: boolean;
};

function parseQBOReport(data: any): { title: string; period: string; rows: ReportRow[] } {
  if (!data?.Header) return { title: "", period: "", rows: [] };
  const title = data.Header.ReportName || "";
  const period = data.Header.DateMacro || data.Header.StartPeriod
    ? `${data.Header.StartPeriod || ""} to ${data.Header.EndPeriod || ""}`
    : "";
  const rows: ReportRow[] = [];

  function walkRows(rowData: any[], depth: number) {
    if (!rowData) return;
    for (const row of rowData) {
      if (row.Header?.ColData) {
        rows.push({
          label: row.Header.ColData[0]?.value || "",
          value: row.Header.ColData[1]?.value || "",
          depth,
          bold: true,
        });
      }
      if (row.Rows?.Row) {
        walkRows(row.Rows.Row, depth + 1);
      }
      if (row.ColData) {
        rows.push({
          label: row.ColData[0]?.value || "",
          value: row.ColData[1]?.value || "",
          depth,
        });
      }
      if (row.Summary?.ColData) {
        rows.push({
          label: row.Summary.ColData[0]?.value || "",
          value: row.Summary.ColData[1]?.value || "",
          depth,
          bold: true,
        });
      }
    }
  }

  walkRows(data.Rows?.Row || [], 0);
  return { title, period, rows };
}

function formatCurrency(val: string | number): string {
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return val as string;
  const negative = num < 0;
  const formatted = Math.abs(num).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return negative ? `(${formatted})` : formatted;
}

function ReportTable({ data, accent, light }: { data: { title: string; period: string; rows: ReportRow[] }; accent: string; light: boolean }) {
  if (!data.rows.length) return null;
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className={`font-semibold text-sm ${light ? "text-gray-900" : ""}`}>{data.title}</h3>
          {data.period && <p className={`text-xs ${light ? "text-gray-500" : "text-gray-500"}`}>{data.period}</p>}
        </div>
      </div>
      <div className="space-y-0">
        {data.rows.map((row, i) => {
          const isTotal = row.label.toLowerCase().startsWith("total") || row.label.toLowerCase().startsWith("net ");
          const isSection = row.bold && !row.value;
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
              {row.value && (
                <span
                  className={`tabular-nums ${
                    isTotal ? (light ? "text-gray-900" : "text-white") : parseFloat(row.value) < 0 ? "text-red-500" : ""
                  }`}
                  style={isTotal && row.label.toLowerCase().includes("net") ? { color: accent } : {}}
                >
                  {formatCurrency(row.value)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
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

export default function QuickBooks() {
  const [status, setStatus] = useState<"loading" | "connected" | "disconnected" | "error">("loading");
  const [companyName, setCompanyName] = useState("");
  const [companyInfo, setCompanyInfo] = useState<any>(null);
  const [profitLoss, setProfitLoss] = useState<any>(null);
  const [balanceSheet, setBalanceSheet] = useState<any>(null);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastUpdatedText, setLastUpdatedText] = useState("");
  const [light, setLight] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  // Update the "last updated" text every 30s
  useEffect(() => {
    if (!lastUpdated) return;
    setLastUpdatedText(timeAgo(lastUpdated));
    const interval = setInterval(() => {
      setLastUpdatedText(timeAgo(lastUpdated));
    }, 30000);
    return () => clearInterval(interval);
  }, [lastUpdated]);

  const fetchData = useCallback(async (report: string) => {
    setLoading((p) => ({ ...p, [report]: true }));
    try {
      const res = await fetch(`/api/quickbooks/data?report=${report}`);
      const data = await res.json();
      if (data.error === "not_connected" || data.error === "auth_expired") {
        setStatus("disconnected");
        return null;
      }
      if (!res.ok) throw new Error(data.message || data.error);
      return data;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading((p) => ({ ...p, [report]: false }));
    }
  }, []);

  useEffect(() => {
    async function checkConnection() {
      try {
        const res = await fetch("/api/quickbooks/data?report=status");
        const data = await res.json();
        if (data.error === "not_connected") {
          setStatus("disconnected");
        } else if (data.connected) {
          setStatus("connected");
          const [company, pl, bs] = await Promise.all([
            fetchData("company-info"),
            fetchData("profit-loss"),
            fetchData("balance-sheet"),
          ]);
          if (company?.CompanyInfo) {
            setCompanyInfo(company.CompanyInfo);
            setCompanyName(company.CompanyInfo.CompanyName);
          }
          if (pl) setProfitLoss(pl);
          if (bs) setBalanceSheet(bs);
          setLastUpdated(new Date());
        } else {
          setStatus("disconnected");
        }
      } catch {
        setStatus("disconnected");
      }
    }
    checkConnection();
  }, [fetchData]);

  async function handleDisconnect() {
    if (!confirm("Disconnect QuickBooks? You can always reconnect later.")) return;
    await fetch("/api/quickbooks/disconnect", { method: "POST" });
    setStatus("disconnected");
    setCompanyName("");
    setCompanyInfo(null);
    setProfitLoss(null);
    setBalanceSheet(null);
    setLastUpdated(null);
  }

  async function handleRefresh() {
    const [pl, bs] = await Promise.all([
      fetchData("profit-loss"),
      fetchData("balance-sheet"),
    ]);
    if (pl) setProfitLoss(pl);
    if (bs) setBalanceSheet(bs);
    setLastUpdated(new Date());
  }

  function handleGeneratePDF() {
    const el = printRef.current;
    if (!el) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const bgColor = light ? "#ffffff" : "#0a0a0a";
    const textColor = light ? "#111827" : "#f9fafb";
    const mutedColor = light ? "#6b7280" : "#9ca3af";
    const borderColor = light ? "#e5e7eb" : "rgba(255,255,255,0.1)";
    const cardBg = light ? "#f9fafb" : "rgba(255,255,255,0.02)";

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${companyName || "QuickBooks"} - Financial Report</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: ${bgColor};
            color: ${textColor};
            padding: 40px;
            font-size: 11px;
          }
          .header { margin-bottom: 32px; padding-bottom: 16px; border-bottom: 2px solid ${borderColor}; }
          .header h1 { font-size: 20px; margin-bottom: 4px; }
          .header p { color: ${mutedColor}; font-size: 12px; }
          .metrics { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
          .metric { flex: 1; min-width: 120px; padding: 12px; border: 1px solid ${borderColor}; border-radius: 8px; background: ${cardBg}; }
          .metric-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: ${mutedColor}; margin-bottom: 4px; }
          .metric-value { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; }
          .reports { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
          .report { border: 1px solid ${borderColor}; border-radius: 8px; padding: 16px; background: ${cardBg}; }
          .report h3 { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
          .report .period { font-size: 10px; color: ${mutedColor}; margin-bottom: 12px; }
          .row { display: flex; justify-content: space-between; padding: 3px 8px; font-size: 10px; color: ${mutedColor}; }
          .row.bold { font-weight: 600; color: ${textColor}; }
          .row.total { border-top: 1px solid ${borderColor}; font-weight: 700; color: ${textColor}; }
          .row.section { margin-top: 10px; margin-bottom: 4px; }
          .row .value { font-variant-numeric: tabular-nums; }
          .negative { color: #ef4444; }
          .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid ${borderColor}; font-size: 10px; color: ${mutedColor}; text-align: center; }
          @media print {
            body { padding: 20px; }
            .reports { grid-template-columns: 1fr 1fr; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${companyName || "QuickBooks Report"}</h1>
          <p>${companyInfo?.LegalName && companyInfo.LegalName !== companyName ? companyInfo.LegalName + " &middot; " : ""}Generated ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</p>
        </div>
        ${renderMetricsHTML()}
        <div class="reports">
          ${renderReportHTML(profitLoss ? parseQBOReport(profitLoss) : null, "#22c55e")}
          ${renderReportHTML(balanceSheet ? parseQBOReport(balanceSheet) : null, "#3b82f6")}
        </div>
        <div class="footer">
          Burton Family Office &middot; Generated from QuickBooks Online
        </div>
      </body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  }

  function renderMetricsHTML() {
    const plData = profitLoss ? parseQBOReport(profitLoss) : null;
    const bsData = balanceSheet ? parseQBOReport(balanceSheet) : null;
    const metrics = [
      { label: "Total Expenses", value: plData?.rows.find((r) => r.label.toLowerCase().startsWith("total expenses"))?.value, color: "#ef4444" },
      { label: "Net Income", value: plData?.rows.find((r) => r.label.toLowerCase().includes("net income"))?.value, color: "#22c55e" },
      { label: "Total Assets", value: bsData?.rows.find((r) => r.label.toLowerCase() === "total assets")?.value, color: "#3b82f6" },
      { label: "Total Equity", value: bsData?.rows.find((r) => r.label.toLowerCase().includes("total equity"))?.value, color: "#a855f7" },
    ].filter((m) => m.value);
    if (!metrics.length) return "";
    return `<div class="metrics">${metrics.map((m) => `
      <div class="metric">
        <div class="metric-label">${m.label}</div>
        <div class="metric-value" style="color:${m.color}">$${formatCurrency(m.value!)}</div>
      </div>
    `).join("")}</div>`;
  }

  function renderReportHTML(data: { title: string; period: string; rows: ReportRow[] } | null, accent: string) {
    if (!data || !data.rows.length) return "";
    return `
      <div class="report">
        <h3>${data.title}</h3>
        ${data.period ? `<div class="period">${data.period}</div>` : ""}
        ${data.rows.map((row) => {
          const isTotal = row.label.toLowerCase().startsWith("total") || row.label.toLowerCase().startsWith("net ");
          const isSection = row.bold && !row.value;
          const cls = isTotal ? "row total" : isSection ? "row bold section" : row.bold ? "row bold" : "row";
          const valStyle = isTotal && row.label.toLowerCase().includes("net") ? `style="color:${accent}"` : parseFloat(row.value) < 0 ? 'class="value negative"' : 'class="value"';
          return `<div class="${cls}" style="padding-left:${row.depth * 16 + 8}px">
            <span>${row.label}</span>
            ${row.value ? `<span ${valStyle}>${formatCurrency(row.value)}</span>` : ""}
          </div>`;
        }).join("")}
      </div>
    `;
  }

  const plData = profitLoss ? parseQBOReport(profitLoss) : null;
  const bsData = balanceSheet ? parseQBOReport(balanceSheet) : null;

  const netIncome = plData?.rows.find((r) => r.label.toLowerCase().includes("net income"))?.value;
  const totalIncome = plData?.rows.find((r) => r.label.toLowerCase() === "total income" || r.label.toLowerCase() === "gross profit")?.value;
  const totalExpenses = plData?.rows.find((r) => r.label.toLowerCase().startsWith("total expenses"))?.value;
  const totalAssets = bsData?.rows.find((r) => r.label.toLowerCase() === "total assets")?.value;
  const totalEquity = bsData?.rows.find((r) => r.label.toLowerCase().includes("total equity"))?.value;

  const accent = "#22c55e";

  // Theme classes
  const card = light
    ? "rounded-xl border border-gray-200 bg-gray-50 p-5"
    : "rounded-xl border border-white/10 bg-white/[0.02] p-5";
  const cardLg = light
    ? "rounded-xl border border-gray-200 bg-gray-50 p-6"
    : "rounded-xl border border-white/10 bg-white/[0.02] p-6";
  const pageBg = light ? "bg-white text-gray-900" : "";
  const mutedText = light ? "text-gray-500" : "text-gray-500";
  const headingText = light ? "text-gray-900" : "";
  const btnBorder = light
    ? "border border-gray-200 hover:border-gray-400 text-gray-600 hover:text-gray-900"
    : "border border-white/10 hover:border-white/20 text-gray-500 hover:text-white";

  return (
    <div className={`${pageBg} min-h-screen transition-colors duration-200`} ref={printRef}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-3">
          <Link to="/tools" className={`${mutedText} hover:text-white transition-colors`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className={`text-2xl font-bold ${headingText}`}>QuickBooks</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Light/Dark toggle */}
          <button
            onClick={() => setLight((v) => !v)}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${btnBorder}`}
            title={light ? "Switch to dark mode" : "Switch to light mode"}
          >
            {light ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            )}
          </button>
          {/* Generate PDF */}
          {status === "connected" && (
            <button
              onClick={handleGeneratePDF}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${btnBorder}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Generate PDF
            </button>
          )}
          {/* Disconnect */}
          {status === "connected" && (
            <button
              onClick={handleDisconnect}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                light
                  ? "border border-gray-200 hover:border-red-300 text-gray-500 hover:text-red-500"
                  : "border border-white/10 hover:border-red-400/30 text-gray-500 hover:text-red-400"
              }`}
            >
              Disconnect
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 mb-8">
        <p className={`${mutedText} text-sm`}>Ledger Louise, LLC &mdash; Financial Dashboard</p>
        {lastUpdated && (
          <span className={`text-xs ${light ? "text-gray-400" : "text-gray-600"}`}>
            &middot; Updated {lastUpdatedText}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 text-sm">
          {error}
          <button onClick={() => setError("")} className="ml-3 underline">
            Dismiss
          </button>
        </div>
      )}

      {status === "loading" && (
        <div className="flex items-center justify-center py-24">
          <div className={`animate-spin rounded-full h-8 w-8 border-2 ${light ? "border-gray-200 border-t-gray-600" : "border-white/20 border-t-white/80"}`} />
        </div>
      )}

      {status === "disconnected" && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
            style={{ background: `${accent}15`, color: accent }}
          >
            <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.886-3.497l4.5-4.5a4.5 4.5 0 016.364 6.364l-1.757 1.757M10.5 13.5l3-3"
              />
            </svg>
          </div>
          <h2 className={`text-lg font-semibold mb-2 ${headingText}`}>Connect QuickBooks</h2>
          <p className={`${mutedText} text-sm mb-6 max-w-md`}>
            Link your Ledger Louise QuickBooks account to view real-time financials, P&L statements, and balance sheets.
          </p>
          <a
            href="/api/quickbooks/auth"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium text-white transition-all hover:opacity-90"
            style={{ background: accent }}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Connect QuickBooks
          </a>
        </div>
      )}

      {status === "connected" && (
        <>
          {/* Company Info Bar */}
          {companyInfo && (
            <div className={`${card} mb-6`}>
              <div className="flex items-center gap-4">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm"
                  style={{ background: `${accent}20`, color: accent }}
                >
                  {companyName?.charAt(0) || "L"}
                </div>
                <div className="flex-1">
                  <h3 className={`font-semibold text-sm ${headingText}`}>{companyName}</h3>
                  <p className={`${mutedText} text-xs`}>
                    {companyInfo.LegalName && companyInfo.LegalName !== companyName
                      ? `${companyInfo.LegalName} · `
                      : ""}
                    {companyInfo.CompanyAddr?.City && `${companyInfo.CompanyAddr.City}, ${companyInfo.CompanyAddr.CountrySubDivisionCode}`}
                    {companyInfo.FiscalYearStartMonth && ` · FY starts month ${companyInfo.FiscalYearStartMonth}`}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-xs" style={{ color: accent }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: accent }} />
                  Connected
                </div>
              </div>
            </div>
          )}

          {/* Key Metrics */}
          {(netIncome || totalAssets) && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
              {[
                { label: "Total Income", value: totalIncome, color: accent },
                { label: "Total Expenses", value: totalExpenses, color: "#ef4444" },
                { label: "Net Income", value: netIncome, color: parseFloat(netIncome || "0") >= 0 ? accent : "#ef4444" },
                { label: "Total Assets", value: totalAssets, color: "#3b82f6" },
                { label: "Total Equity", value: totalEquity, color: "#a855f7" },
              ].map(
                (m) =>
                  m.value && (
                    <div key={m.label} className={card}>
                      <p className={`text-[10px] uppercase tracking-wider ${mutedText} mb-1`}>{m.label}</p>
                      <p className="text-lg font-bold tabular-nums" style={{ color: m.color }}>
                        ${formatCurrency(m.value)}
                      </p>
                    </div>
                  )
              )}
            </div>
          )}

          {/* Reports */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className={cardLg}>
              {loading["profit-loss"] ? (
                <div className="flex items-center justify-center py-12">
                  <div className={`animate-spin rounded-full h-6 w-6 border-2 ${light ? "border-gray-200 border-t-gray-600" : "border-white/20 border-t-white/80"}`} />
                </div>
              ) : plData ? (
                <ReportTable data={plData} accent={accent} light={light} />
              ) : (
                <p className={`${mutedText} text-sm text-center py-12`}>No P&L data available</p>
              )}
            </div>

            <div className={cardLg}>
              {loading["balance-sheet"] ? (
                <div className="flex items-center justify-center py-12">
                  <div className={`animate-spin rounded-full h-6 w-6 border-2 ${light ? "border-gray-200 border-t-gray-600" : "border-white/20 border-t-white/80"}`} />
                </div>
              ) : bsData ? (
                <ReportTable data={bsData} accent="#3b82f6" light={light} />
              ) : (
                <p className={`${mutedText} text-sm text-center py-12`}>No Balance Sheet data available</p>
              )}
            </div>
          </div>

          {/* Refresh */}
          <div className="mt-6 flex items-center justify-center gap-4">
            <button
              onClick={handleRefresh}
              disabled={loading["profit-loss"] || loading["balance-sheet"]}
              className={`text-xs transition-colors px-4 py-2 rounded-lg disabled:opacity-50 ${btnBorder}`}
            >
              {loading["profit-loss"] || loading["balance-sheet"] ? "Refreshing..." : "Refresh Data"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
