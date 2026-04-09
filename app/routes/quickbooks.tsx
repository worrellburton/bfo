import { useState, useEffect, useCallback } from "react";
import { Link, useSearchParams } from "react-router";

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

const COLORS = ["#22c55e", "#3b82f6", "#a855f7", "#f59e0b", "#ec4899"];

const REPORTS = [
  { key: "profit-loss", label: "Profit & Loss", desc: "Income, expenses, net income", color: "#22c55e", icon: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" },
  { key: "balance-sheet", label: "Balance Sheet", desc: "Assets, liabilities, equity", color: "#3b82f6", icon: "M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.97zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.97z" },
  { key: "trial-balance", label: "Trial Balance", desc: "Debits, credits, balances", color: "#f59e0b", icon: "M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" },
  { key: "general-ledger", label: "General Ledger", desc: "Transaction-level detail", color: "#06b6d4", icon: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" },
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
          <h1 className="text-2xl font-bold">Finance</h1>
        </div>
        {status === "connected" && (
          <div className="flex items-center gap-2">
            <Link
              to="/public/bf-access"
              target="_blank"
              className="text-xs text-gray-500 hover:text-blue-400 transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-blue-400/30 flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
              BF Access
            </Link>
            <a
              href="/api/quickbooks/auth"
              className="text-xs text-gray-500 hover:text-green-400 transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-green-400/30 flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Add Company
            </a>
          </div>
        )}
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
        <div className="space-y-4">
          {companies.map((c, ci) => {
            const data = companyData[c.realm_id];
            if (!data) return null;
            const name = data.companyName;
            const m = data.metrics;
            const color = COLORS[ci % COLORS.length];
            const isExpanded = expandedRealm === c.realm_id;
            const isDragging = dragIndex === ci;
            const isDragOver = dragOverIndex === ci;

            return (
              <div
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
                className={`rounded-xl border overflow-hidden transition-all ${
                  isDragOver ? "border-green-500/50 bg-green-500/5" : isDragging ? "opacity-50 border-white/10 bg-white/[0.02]" : "border-white/10 bg-white/[0.02]"
                }`}
              >
                {/* Company header + metrics — clickable */}
                <button
                  onClick={() => setExpandedRealm(isExpanded ? null : c.realm_id)}
                  className="w-full text-left p-5 hover:bg-white/[0.02] transition-colors cursor-pointer"
                >
                  {/* Top row: company name + connected badge */}
                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm shrink-0"
                      style={{ background: `${color}20`, color }}
                    >
                      {name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm truncate">{name}</h3>
                      {data.companyInfo?.CompanyAddr?.City && (
                        <p className="text-gray-500 text-xs truncate">
                          {data.companyInfo.CompanyAddr.City}, {data.companyInfo.CompanyAddr.CountrySubDivisionCode}
                          {data.companyInfo.FiscalYearStartMonth && ` · FY starts month ${data.companyInfo.FiscalYearStartMonth}`}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-center gap-1.5 text-xs" style={{ color: accent }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent }} />
                        Connected
                      </div>
                      <svg
                        className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>

                  {/* Metrics row */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    {[
                      { label: "Total Income", key: "totalIncome", color: "#22c55e" },
                      { label: "Total Expenses", key: "totalExpenses", color: "#ef4444" },
                      { label: "Net Income", key: "netIncome", color: parseFloat(m.netIncome || "0") >= 0 ? "#22c55e" : "#ef4444" },
                      { label: "Total Assets", key: "totalAssets", color: "#3b82f6" },
                      { label: "Total Equity", key: "totalEquity", color: "#a855f7" },
                    ].map((metric) =>
                      m[metric.key] ? (
                        <div key={metric.label} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
                          <p className="text-[9px] uppercase tracking-wider text-gray-500 mb-0.5">{metric.label}</p>
                          <p className="text-sm font-bold tabular-nums" style={{ color: metric.color }}>
                            ${formatCurrency(m[metric.key])}
                          </p>
                        </div>
                      ) : null
                    )}
                  </div>
                </button>

                {/* Expanded: report links */}
                {isExpanded && (
                  <div className="border-t border-white/10 p-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {REPORTS.map((r) => (
                        <Link
                          key={r.key}
                          to={`/tools/quickbooks/${r.key}?realm_id=${c.realm_id}`}
                          className="group flex items-center gap-3 p-3 rounded-lg border border-white/5 bg-white/[0.01] hover:border-white/15 hover:bg-white/[0.03] transition-all"
                        >
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${r.color}15` }}>
                            <svg className="w-4 h-4" style={{ color: r.color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={r.icon} />
                            </svg>
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium group-hover:text-white transition-colors truncate">{r.label}</p>
                            <p className="text-[10px] text-gray-500 truncate">{r.desc}</p>
                          </div>
                        </Link>
                      ))}
                    </div>
                    <div className="mt-3 flex justify-end">
                      <button
                        onClick={(e) => handleDisconnect(c.realm_id, e)}
                        className="text-[10px] text-gray-600 hover:text-red-400 transition-colors px-2 py-1 rounded"
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
