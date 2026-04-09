import { useState, useEffect, useCallback } from "react";
import { Link, useSearchParams } from "react-router";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Finance | Financial Dashboard" }];
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

function loadCompanyOrder(): string[] {
  try {
    const stored = localStorage.getItem("qb-company-order");
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function saveCompanyOrder(order: string[]) {
  localStorage.setItem("qb-company-order", JSON.stringify(order));
}

function applyStoredOrder(companies: Company[]): Company[] {
  const order = loadCompanyOrder();
  if (order.length === 0) return companies;
  const map = new Map(companies.map((c) => [c.realm_id, c]));
  const ordered: Company[] = [];
  for (const id of order) {
    const c = map.get(id);
    if (c) { ordered.push(c); map.delete(id); }
  }
  // Append any new companies not in saved order
  for (const c of map.values()) ordered.push(c);
  return ordered;
}

export default function QuickBooks() {
  const [searchParams] = useSearchParams();
  const urlError = searchParams.get("error");
  const urlDetail = searchParams.get("detail");
  const urlRealmId = searchParams.get("realm_id");
  const urlConnected = searchParams.get("connected");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyData, setCompanyData] = useState<Record<string, CompanyData>>({});
  const [expandedRealm, setExpandedRealm] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "connected" | "disconnected">("loading");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(
    urlError
      ? `Connection failed: ${urlError}${urlDetail ? ` — ${urlDetail}` : ""}${urlRealmId ? ` (realm: ${urlRealmId})` : ""}`
      : urlConnected && urlRealmId
        ? ""
        : ""
  );
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastUpdatedText, setLastUpdatedText] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const { theme, toggle: toggleTheme } = useTheme();
  const light = theme === "light";

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

  async function handleDisconnect(realmId: string, e: React.MouseEvent) {
    e.stopPropagation();
    const name = companyData[realmId]?.companyName || "this company";
    if (!confirm(`Disconnect ${name}?`)) return;
    await fetch(`/api/quickbooks/disconnect?realm_id=${realmId}`, { method: "POST" });
    setCompanies((prev) => prev.filter((c) => c.realm_id !== realmId));
    setCompanyData((prev) => { const next = { ...prev }; delete next[realmId]; return next; });
    if (expandedRealm === realmId) setExpandedRealm(null);
    if (companies.length <= 1) setStatus("disconnected");
  }

  const accent = "#22c55e";
  const btnBorder = light ? "border border-gray-200 hover:border-gray-400 text-gray-600 hover:text-gray-900" : "border border-white/10 hover:border-white/20 text-gray-500 hover:text-white";

  return (
    <div className={`${light ? "bg-white text-gray-900" : ""} min-h-screen transition-colors duration-200`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-3">
          <Link to="/tools" className={`${light ? "text-gray-400 hover:text-gray-900" : "text-gray-500 hover:text-white"} transition-colors`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className={`text-2xl font-bold ${light ? "text-gray-900" : ""}`}>Finance</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleTheme} className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${btnBorder}`}>
            {light ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
            )}
          </button>
          {status === "connected" && (
            <>
              <Link
                to="/public/bf-access"
                target="_blank"
                className={`text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${light ? "border border-gray-200 hover:border-blue-400 text-gray-500 hover:text-blue-600" : "border border-white/10 hover:border-blue-400/30 text-gray-500 hover:text-blue-400"}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                BF Access
              </Link>
              <a
                href="/api/quickbooks/auth"
                className={`text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${light ? "border border-gray-200 hover:border-green-400 text-gray-500 hover:text-green-600" : "border border-white/10 hover:border-green-400/30 text-gray-500 hover:text-green-400"}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                Add Company
              </a>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 mb-8">
        <p className="text-gray-500 text-sm">Financial Dashboard</p>
        {lastUpdated && <span className="text-xs text-gray-600">&middot; Updated {lastUpdatedText}</span>}
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 text-sm">
          {error}<button onClick={() => setError("")} className="ml-3 underline">Dismiss</button>
        </div>
      )}

      {status === "loading" && loading && (
        <div className="flex items-center justify-center py-24">
          <div className={`animate-spin rounded-full h-8 w-8 border-2 ${light ? "border-gray-200 border-t-gray-600" : "border-white/20 border-t-white/80"}`} />
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
            Link your QuickBooks account to view real-time financials, P&L statements, and balance sheets.
          </p>
          <a
            href="/api/quickbooks/auth"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium text-white transition-all hover:opacity-90"
            style={{ background: accent }}
          >
            Connect QuickBooks Account
          </a>
        </div>
      )}

      {status === "connected" && !loading && (
        <div className={`rounded-xl border overflow-hidden ${light ? "border-gray-200 bg-white shadow-sm" : "border-white/10 bg-white/[0.02]"}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className={`border-b ${light ? "border-gray-200 bg-gray-50" : "border-white/10 bg-white/[0.03]"}`}>
                <th className={`text-left py-3 px-5 text-xs font-medium uppercase tracking-wider ${light ? "text-gray-500" : "text-gray-500"}`}>Entity</th>
                {METRIC_COLS.map((col) => (
                  <th key={col.key} className={`text-right py-3 px-4 text-xs font-medium uppercase tracking-wider hidden lg:table-cell ${light ? "text-gray-500" : "text-gray-500"}`}>{col.label}</th>
                ))}
                <th className="w-10 px-3"></th>
              </tr>
            </thead>
            {companies.map((c, ci) => {
              const data = companyData[c.realm_id];
              if (!data) return null;
              const m = data.metrics;
              const isExpanded = expandedRealm === c.realm_id;
              const isDragging = dragIndex === ci;
              const isDragOver = dragOverIndex === ci;

              return (
                <tbody
                  key={c.realm_id}
                  draggable
                  onDragStart={() => setDragIndex(ci)}
                  onDragOver={(e) => { e.preventDefault(); setDragOverIndex(ci); }}
                  onDragEnd={() => {
                    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
                      setCompanies((prev) => {
                        const next = [...prev];
                        const [moved] = next.splice(dragIndex, 1);
                        next.splice(dragOverIndex, 0, moved);
                        saveCompanyOrder(next.map((c) => c.realm_id));
                        return next;
                      });
                    }
                    setDragIndex(null);
                    setDragOverIndex(null);
                  }}
                  onDragLeave={() => setDragOverIndex(null)}
                  className={isDragging ? "opacity-50" : isDragOver ? (light ? "bg-green-50" : "bg-green-500/5") : ""}
                >
                  <tr
                    onClick={() => setExpandedRealm(isExpanded ? null : c.realm_id)}
                    className={`border-b cursor-pointer transition-colors ${
                      isExpanded
                        ? light ? "bg-gray-50 border-gray-200" : "bg-white/[0.03] border-white/10"
                        : light ? "border-gray-100 hover:bg-gray-50" : "border-white/5 hover:bg-white/[0.02]"
                    }`}
                  >
                    <td className="py-3.5 px-5">
                      <div className={`font-medium ${light ? "text-gray-900" : "text-white"}`}>{data.companyName}</div>
                    </td>
                    {METRIC_COLS.map((col) => (
                      <td key={col.key} className={`py-3.5 px-4 text-right tabular-nums hidden lg:table-cell ${light ? "text-gray-700" : "text-gray-400"}`}>
                        {m[col.key] ? `$${formatCurrency(m[col.key])}` : "-"}
                      </td>
                    ))}
                    <td className="px-3">
                      <svg
                        className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className={`border-b ${light ? "bg-gray-50 border-gray-200" : "bg-white/[0.02] border-white/10"}`}>
                      <td colSpan={METRIC_COLS.length + 2} className="px-5 py-4">
                        {/* Mobile metrics */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4 lg:hidden">
                          {METRIC_COLS.map((col) =>
                            m[col.key] ? (
                              <div key={col.key}>
                                <div className="text-[10px] text-gray-500 uppercase tracking-wider">{col.label}</div>
                                <div className={`text-sm font-medium tabular-nums ${light ? "text-gray-900" : "text-white"}`}>${formatCurrency(m[col.key])}</div>
                              </div>
                            ) : null
                          )}
                        </div>
                        {/* Report links */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-gray-500 uppercase tracking-wider font-medium mr-1">Reports</span>
                          {REPORTS.map((r) => (
                            <Link
                              key={r.key}
                              to={`/tools/quickbooks/${r.key}?realm_id=${c.realm_id}`}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                                light
                                  ? "border border-gray-200 bg-white text-gray-700 hover:border-gray-400 hover:text-gray-900"
                                  : "border border-white/10 bg-white/[0.03] text-gray-400 hover:border-white/20 hover:text-white"
                              }`}
                            >
                              {r.label}
                              <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                            </Link>
                          ))}
                          <button
                            onClick={(e) => handleDisconnect(c.realm_id, e)}
                            className="ml-auto text-[10px] text-gray-600 hover:text-red-400 transition-colors px-2 py-1 rounded"
                          >
                            Disconnect
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </div>
  );
}
