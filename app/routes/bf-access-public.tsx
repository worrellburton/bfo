import { useState, useEffect, useCallback } from "react";

export function meta() {
  return [{ title: "BFO - BeachFleischman Access" }];
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

type Company = { realm_id: string; company_name: string; updated_at: string };
type CompanyData = { companyInfo: any; companyName: string; metrics: Record<string, string> };

const COLORS = ["#16a34a", "#2563eb", "#9333ea", "#d97706", "#db2777"];

export default function BFAccessPublic() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyData, setCompanyData] = useState<Record<string, CompanyData>>({});
  const [expandedRealm, setExpandedRealm] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "connected" | "disconnected">("loading");
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastUpdatedText, setLastUpdatedText] = useState("");

  useEffect(() => {
    if (!lastUpdated) return;
    setLastUpdatedText(timeAgo(lastUpdated));
    const interval = setInterval(() => setLastUpdatedText(timeAgo(lastUpdated)), 30000);
    return () => clearInterval(interval);
  }, [lastUpdated]);

  const fetchReport = useCallback(async (report: string, realmId?: string) => {
    try {
      const params = realmId ? `&realm_id=${realmId}` : "";
      const res = await fetch(`/api/quickbooks/data?report=${report}${params}`);
      const data = await res.json();
      if (data.error === "not_connected" || data.error === "auth_expired") return null;
      if (!res.ok) return null;
      return data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    async function load() {
      const listRes = await fetchReport("list");
      if (!listRes?.companies || listRes.companies.length === 0) {
        setStatus("disconnected");
        setLoading(false);
        return;
      }
      const companyList: Company[] = listRes.companies;
      setCompanies(companyList);
      setStatus("connected");

      const dataMap: Record<string, CompanyData> = {};
      await Promise.all(
        companyList.map(async (c) => {
          const [company, pl, bs] = await Promise.all([
            fetchReport("company-info", c.realm_id),
            fetchReport("profit-loss", c.realm_id),
            fetchReport("balance-sheet", c.realm_id),
          ]);
          const plMetrics = pl ? parseMetrics(pl) : {};
          const bsMetrics = bs ? parseMetrics(bs) : {};
          dataMap[c.realm_id] = {
            companyInfo: company?.CompanyInfo || null,
            companyName: company?.CompanyInfo?.CompanyName || c.company_name || "Unknown",
            metrics: { ...plMetrics, ...bsMetrics },
          };
        })
      );
      setCompanyData(dataMap);
      setLastUpdated(new Date());
      setLoading(false);
    }
    load();
  }, [fetchReport]);

  return (
    <div className="min-h-screen bg-white text-gray-900" style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
      {/* Header */}
      <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold tracking-tight text-gray-900">BFO</span>
            <div className="h-5 w-px bg-gray-200" />
            <span className="text-xs text-gray-400 uppercase tracking-wider">BeachFleischman Access</span>
          </div>
          {lastUpdated && (
            <span className="text-xs text-gray-400">Updated {lastUpdatedText}</span>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Financial Dashboard</h1>
          <p className="text-sm text-gray-500">QuickBooks connected entities overview</p>
        </div>

        {status === "loading" && loading && (
          <div className="flex items-center justify-center py-24">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-gray-600" />
          </div>
        )}

        {status === "disconnected" && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-6">
              <svg viewBox="0 0 24 24" className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.886-3.497l4.5-4.5a4.5 4.5 0 016.364 6.364l-1.757 1.757M10.5 13.5l3-3" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">No Connected Accounts</h2>
            <p className="text-gray-500 text-sm max-w-md">No QuickBooks accounts are currently connected.</p>
          </div>
        )}

        {status === "connected" && !loading && (
          <div className="space-y-4">
            {companies.map((c, ci) => {
              const data = companyData[c.realm_id];
              if (!data) return null;
              const name = data.companyName;
              const m = data.metrics;
              const color = COLORS[ci % COLORS.length];
              const isExpanded = expandedRealm === c.realm_id;

              return (
                <div key={c.realm_id} className="rounded-xl border border-gray-200 bg-white overflow-hidden transition-all shadow-sm">
                  <button
                    onClick={() => setExpandedRealm(isExpanded ? null : c.realm_id)}
                    className="w-full text-left p-5 hover:bg-gray-50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm text-white shrink-0"
                        style={{ background: color }}
                      >
                        {name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm text-gray-900 truncate">{name}</h3>
                        {data.companyInfo?.CompanyAddr?.City && (
                          <p className="text-gray-400 text-xs truncate">
                            {data.companyInfo.CompanyAddr.City}, {data.companyInfo.CompanyAddr.CountrySubDivisionCode}
                            {data.companyInfo.FiscalYearStartMonth && ` \u00b7 FY starts month ${data.companyInfo.FiscalYearStartMonth}`}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="flex items-center gap-1.5 text-xs text-green-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                          Connected
                        </div>
                        <svg
                          className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          fill="none" stroke="currentColor" viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                      {[
                        { label: "Total Income", key: "totalIncome", color: "#16a34a" },
                        { label: "Total Expenses", key: "totalExpenses", color: "#dc2626" },
                        { label: "Net Income", key: "netIncome", color: parseFloat(m.netIncome || "0") >= 0 ? "#16a34a" : "#dc2626" },
                        { label: "Total Assets", key: "totalAssets", color: "#2563eb" },
                        { label: "Total Equity", key: "totalEquity", color: "#9333ea" },
                      ].map((metric) =>
                        m[metric.key] ? (
                          <div key={metric.label} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                            <p className="text-[9px] uppercase tracking-wider text-gray-400 mb-0.5">{metric.label}</p>
                            <p className="text-sm font-bold tabular-nums" style={{ color: metric.color }}>
                              ${formatCurrency(m[metric.key])}
                            </p>
                          </div>
                        ) : null
                      )}
                    </div>
                  </button>

                  {isExpanded && data.companyInfo && (
                    <div className="border-t border-gray-200 p-5 bg-gray-50">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                        {data.companyInfo.CompanyName && (
                          <div>
                            <p className="text-gray-400 text-[9px] uppercase tracking-wider mb-0.5">Company</p>
                            <p className="font-medium text-gray-900">{data.companyInfo.CompanyName}</p>
                          </div>
                        )}
                        {data.companyInfo.CompanyAddr?.City && (
                          <div>
                            <p className="text-gray-400 text-[9px] uppercase tracking-wider mb-0.5">Location</p>
                            <p className="font-medium text-gray-900">{data.companyInfo.CompanyAddr.City}, {data.companyInfo.CompanyAddr.CountrySubDivisionCode}</p>
                          </div>
                        )}
                        {data.companyInfo.FiscalYearStartMonth && (
                          <div>
                            <p className="text-gray-400 text-[9px] uppercase tracking-wider mb-0.5">Fiscal Year Start</p>
                            <p className="font-medium text-gray-900">Month {data.companyInfo.FiscalYearStartMonth}</p>
                          </div>
                        )}
                        {data.companyInfo.CompanyStartDate && (
                          <div>
                            <p className="text-gray-400 text-[9px] uppercase tracking-wider mb-0.5">Company Start</p>
                            <p className="font-medium text-gray-900">{data.companyInfo.CompanyStartDate}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-12">
        <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold tracking-tight text-gray-900">BFO</span>
            <span className="text-[10px] text-gray-400">Burton Family Office</span>
          </div>
          <p className="text-[10px] text-gray-400">Confidential - For authorized recipients only</p>
        </div>
      </footer>
    </div>
  );
}
