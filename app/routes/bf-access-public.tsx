import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router";

export function meta() {
  return [{ title: "BFO - BeachFleischman Access" }];
}

function formatCurrency(val: string | number): string {
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return val as string;
  if (num === 0) return "-";
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

function applyStoredOrder(companies: Company[]): Company[] {
  try {
    const stored = localStorage.getItem("qb-company-order");
    const order: string[] = stored ? JSON.parse(stored) : [];
    if (order.length === 0) return companies;
    const map = new Map(companies.map((c) => [c.realm_id, c]));
    const ordered: Company[] = [];
    for (const id of order) {
      const c = map.get(id);
      if (c) { ordered.push(c); map.delete(id); }
    }
    for (const c of map.values()) ordered.push(c);
    return ordered;
  } catch { return companies; }
}

const REPORTS = [
  { key: "profit-loss", label: "Profit & Loss" },
  { key: "balance-sheet", label: "Balance Sheet" },
  { key: "trial-balance", label: "Trial Balance" },
  { key: "general-ledger", label: "General Ledger" },
];

const METRIC_COLS = [
  { key: "totalIncome", label: "Total Income" },
  { key: "totalExpenses", label: "Total Expenses" },
  { key: "netIncome", label: "Net Income" },
  { key: "totalAssets", label: "Total Assets" },
  { key: "totalEquity", label: "Total Equity" },
];

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
      const companyList: Company[] = applyStoredOrder(listRes.companies);
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
    <div className="min-h-screen bg-gray-50 text-gray-900" style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
      {/* Header */}
      <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
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
      <main className="max-w-7xl mx-auto px-6 py-8">
        {status === "loading" && loading && (
          <div className="flex items-center justify-center py-24">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-gray-600" />
          </div>
        )}

        {status === "disconnected" && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">No Connected Accounts</h2>
            <p className="text-gray-500 text-sm">No QuickBooks accounts are currently connected.</p>
          </div>
        )}

        {status === "connected" && !loading && (
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left py-3 px-5 text-xs font-medium text-gray-500 uppercase tracking-wider">Entity</th>
                  {METRIC_COLS.map((col) => (
                    <th key={col.key} className="text-right py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">{col.label}</th>
                  ))}
                  <th className="w-10 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => {
                  const data = companyData[c.realm_id];
                  if (!data) return null;
                  const m = data.metrics;
                  const isExpanded = expandedRealm === c.realm_id;

                  return (
                    <tbody key={c.realm_id}>
                      <tr
                        onClick={() => setExpandedRealm(isExpanded ? null : c.realm_id)}
                        className={`border-b border-gray-100 cursor-pointer transition-colors ${isExpanded ? "bg-gray-50" : "hover:bg-gray-50"}`}
                      >
                        <td className="py-3.5 px-5">
                          <div className="font-medium text-gray-900">{data.companyName}</div>
                          {data.companyInfo?.CompanyAddr?.City && (
                            <div className="text-xs text-gray-400 mt-0.5">
                              {data.companyInfo.CompanyAddr.City}, {data.companyInfo.CompanyAddr.CountrySubDivisionCode}
                            </div>
                          )}
                        </td>
                        {METRIC_COLS.map((col) => (
                          <td key={col.key} className="py-3.5 px-4 text-right tabular-nums text-gray-700 hidden lg:table-cell">
                            {m[col.key] ? `$${formatCurrency(m[col.key])}` : "-"}
                          </td>
                        ))}
                        <td className="px-3">
                          <svg
                            className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <td colSpan={METRIC_COLS.length + 2} className="px-5 py-4">
                            {/* Mobile metrics */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4 lg:hidden">
                              {METRIC_COLS.map((col) =>
                                m[col.key] ? (
                                  <div key={col.key}>
                                    <div className="text-[10px] text-gray-400 uppercase tracking-wider">{col.label}</div>
                                    <div className="text-sm font-medium tabular-nums text-gray-900">${formatCurrency(m[col.key])}</div>
                                  </div>
                                ) : null
                              )}
                            </div>
                            {/* Report links */}
                            <div className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-medium">Reports</div>
                            <div className="flex flex-wrap gap-2">
                              {REPORTS.map((r) => (
                                <Link
                                  key={r.key}
                                  to={`/public/bf-access/${r.key}?realm_id=${c.realm_id}`}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 hover:border-gray-400 hover:text-gray-900 transition-colors"
                                >
                                  {r.label}
                                  <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                                </Link>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-12">
        <div className="max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
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
