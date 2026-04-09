import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router";

export function meta() {
  return [{ title: "BFO - QuickBooks | Ledger Louise" }];
}

function formatCurrency(val: string | number): string {
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return val as string;
  const negative = num < 0;
  const formatted = Math.abs(num).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return negative ? `(${formatted})` : formatted;
}

function parseMetrics(data: any): Record<string, string> {
  if (!data?.Rows?.Row) return {};
  const out: Record<string, string> = {};
  function walk(rows: any[]) {
    for (const row of rows) {
      if (row.Summary?.ColData) {
        const label = row.Summary.ColData[0]?.value?.toLowerCase() || "";
        const value = row.Summary.ColData[1]?.value || "";
        if (label.includes("net income")) out.netIncome = value;
        if (label === "total income" || label === "gross profit") out.totalIncome = value;
        if (label.startsWith("total expenses")) out.totalExpenses = value;
        if (label === "total assets") out.totalAssets = value;
        if (label.includes("total equity")) out.totalEquity = value;
        if (label.startsWith("total liabilities")) out.totalLiabilities = value;
      }
      if (row.ColData) {
        const label = row.ColData[0]?.value?.toLowerCase() || "";
        const value = row.ColData[1]?.value || "";
        if (label.includes("net income")) out.netIncome = value;
        if (label === "total assets") out.totalAssets = value;
        if (label.includes("total equity")) out.totalEquity = value;
      }
      if (row.Rows?.Row) walk(row.Rows.Row);
    }
  }
  walk(data.Rows.Row);
  return out;
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
  const [status, setStatus] = useState<"loading" | "connected" | "disconnected">("loading");
  const [companyName, setCompanyName] = useState("");
  const [companyInfo, setCompanyInfo] = useState<any>(null);
  const [metrics, setMetrics] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastUpdatedText, setLastUpdatedText] = useState("");

  useEffect(() => {
    if (!lastUpdated) return;
    setLastUpdatedText(timeAgo(lastUpdated));
    const interval = setInterval(() => setLastUpdatedText(timeAgo(lastUpdated)), 30000);
    return () => clearInterval(interval);
  }, [lastUpdated]);

  const fetchReport = useCallback(async (report: string, params?: string) => {
    try {
      const res = await fetch(`/api/quickbooks/data?report=${report}${params || ""}`);
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
    }
  }, []);

  useEffect(() => {
    async function load() {
      const statusRes = await fetchReport("status");
      if (!statusRes?.connected) {
        setStatus("disconnected");
        setLoading(false);
        return;
      }
      setStatus("connected");
      const [company, pl, bs] = await Promise.all([
        fetchReport("company-info"),
        fetchReport("profit-loss"),
        fetchReport("balance-sheet"),
      ]);
      if (company?.CompanyInfo) {
        setCompanyInfo(company.CompanyInfo);
        setCompanyName(company.CompanyInfo.CompanyName);
      }
      const plMetrics = pl ? parseMetrics(pl) : {};
      const bsMetrics = bs ? parseMetrics(bs) : {};
      setMetrics({ ...plMetrics, ...bsMetrics });
      setLastUpdated(new Date());
      setLoading(false);
    }
    load();
  }, [fetchReport]);

  async function handleDisconnect() {
    if (!confirm("Disconnect QuickBooks? You can always reconnect later.")) return;
    await fetch("/api/quickbooks/disconnect", { method: "POST" });
    setStatus("disconnected");
    setCompanyName("");
    setCompanyInfo(null);
    setMetrics({});
    setLastUpdated(null);
  }

  const accent = "#22c55e";

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-3">
          <Link to="/tools" className="text-gray-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-2xl font-bold">QuickBooks</h1>
        </div>
        {status === "connected" && (
          <div className="flex items-center gap-2">
            <a
              href="/api/quickbooks/auth"
              className="text-xs text-gray-500 hover:text-green-400 transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-green-400/30 flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Add Company
            </a>
            <button
              onClick={handleDisconnect}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-red-400/30"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 mb-8">
        <p className="text-gray-500 text-sm">Ledger Louise, LLC &mdash; Financial Dashboard</p>
        {lastUpdated && (
          <span className="text-xs text-gray-600">&middot; Updated {lastUpdatedText}</span>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 text-sm">
          {error}
          <button onClick={() => setError("")} className="ml-3 underline">Dismiss</button>
        </div>
      )}

      {status === "loading" && loading && (
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/20 border-t-white/80" />
        </div>
      )}

      {status === "disconnected" && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6" style={{ background: `${accent}15`, color: accent }}>
            <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.886-3.497l4.5-4.5a4.5 4.5 0 016.364 6.364l-1.757 1.757M10.5 13.5l3-3" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold mb-2">Connect QuickBooks</h2>
          <p className="text-gray-500 text-sm mb-6 max-w-md">
            Link your Ledger Louise QuickBooks account to view real-time financials, P&L statements, and balance sheets.
          </p>
          <a
            href="/api/quickbooks/auth"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium text-white transition-all hover:opacity-90"
            style={{ background: accent }}
          >
            Connect QuickBooks
          </a>
        </div>
      )}

      {status === "connected" && !loading && (
        <>
          {/* Company Info */}
          {companyInfo && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 mb-6">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm" style={{ background: `${accent}20`, color: accent }}>
                  {companyName?.charAt(0) || "L"}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-sm">{companyName}</h3>
                  <p className="text-gray-500 text-xs">
                    {companyInfo.LegalName && companyInfo.LegalName !== companyName ? `${companyInfo.LegalName} · ` : ""}
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
          {Object.keys(metrics).length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
              {[
                { label: "Total Income", key: "totalIncome", color: accent },
                { label: "Total Expenses", key: "totalExpenses", color: "#ef4444" },
                { label: "Net Income", key: "netIncome", color: parseFloat(metrics.netIncome || "0") >= 0 ? accent : "#ef4444" },
                { label: "Total Assets", key: "totalAssets", color: "#3b82f6" },
                { label: "Total Equity", key: "totalEquity", color: "#a855f7" },
              ].map((m) =>
                metrics[m.key] ? (
                  <div key={m.label} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{m.label}</p>
                    <p className="text-lg font-bold tabular-nums" style={{ color: m.color }}>
                      ${formatCurrency(metrics[m.key])}
                    </p>
                  </div>
                ) : null
              )}
            </div>
          )}

          {/* Report Navigation Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
            <Link
              to="/tools/quickbooks/profit-loss"
              className="group rounded-xl border border-white/10 bg-white/[0.02] p-6 hover:border-green-500/30 hover:bg-green-500/[0.03] transition-all"
            >
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: `${accent}15` }}>
                  <svg className="w-6 h-6" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-sm group-hover:text-green-400 transition-colors">Profit & Loss</h3>
                  <p className="text-gray-500 text-xs">Income, expenses, and net income</p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                {metrics.totalIncome && <span>Income: <span className="text-green-400 font-medium">${formatCurrency(metrics.totalIncome)}</span></span>}
                {metrics.netIncome && <span>Net: <span className={`font-medium ${parseFloat(metrics.netIncome) >= 0 ? "text-green-400" : "text-red-400"}`}>${formatCurrency(metrics.netIncome)}</span></span>}
              </div>
              <div className="flex items-center gap-1 mt-4 text-xs text-gray-500 group-hover:text-green-400 transition-colors">
                <span>View reports</span>
                <svg className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>

            <Link
              to="/tools/quickbooks/balance-sheet"
              className="group rounded-xl border border-white/10 bg-white/[0.02] p-6 hover:border-blue-500/30 hover:bg-blue-500/[0.03] transition-all"
            >
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-blue-500/10">
                  <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.97zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.97z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-sm group-hover:text-blue-400 transition-colors">Balance Sheet</h3>
                  <p className="text-gray-500 text-xs">Assets, liabilities, and equity</p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                {metrics.totalAssets && <span>Assets: <span className="text-blue-400 font-medium">${formatCurrency(metrics.totalAssets)}</span></span>}
                {metrics.totalEquity && <span>Equity: <span className="text-purple-400 font-medium">${formatCurrency(metrics.totalEquity)}</span></span>}
              </div>
              <div className="flex items-center gap-1 mt-4 text-xs text-gray-500 group-hover:text-blue-400 transition-colors">
                <span>View reports</span>
                <svg className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>

            <Link
              to="/tools/quickbooks/trial-balance"
              className="group rounded-xl border border-white/10 bg-white/[0.02] p-6 hover:border-amber-500/30 hover:bg-amber-500/[0.03] transition-all"
            >
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-amber-500/10">
                  <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-sm group-hover:text-amber-400 transition-colors">Trial Balance</h3>
                  <p className="text-gray-500 text-xs">Debits, credits, and account balances</p>
                </div>
              </div>
              <div className="flex items-center gap-1 mt-2 text-xs text-gray-500 group-hover:text-amber-400 transition-colors">
                <span>View report</span>
                <svg className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>

            <Link
              to="/tools/quickbooks/general-ledger"
              className="group rounded-xl border border-white/10 bg-white/[0.02] p-6 hover:border-cyan-500/30 hover:bg-cyan-500/[0.03] transition-all"
            >
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-cyan-500/10">
                  <svg className="w-6 h-6 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-sm group-hover:text-cyan-400 transition-colors">General Ledger</h3>
                  <p className="text-gray-500 text-xs">Transaction-level detail by account</p>
                </div>
              </div>
              <div className="flex items-center gap-1 mt-2 text-xs text-gray-500 group-hover:text-cyan-400 transition-colors">
                <span>View report</span>
                <svg className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
