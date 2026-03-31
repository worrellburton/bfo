import { useState, useEffect, useCallback } from "react";
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

function ReportTable({ data, accent }: { data: { title: string; period: string; rows: ReportRow[] }; accent: string }) {
  if (!data.rows.length) return null;
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-sm">{data.title}</h3>
          {data.period && <p className="text-xs text-gray-500">{data.period}</p>}
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
                  ? "border-t border-white/10 font-bold"
                  : isSection
                    ? "mt-3 mb-1"
                    : "text-gray-400"
              }`}
              style={{ paddingLeft: `${row.depth * 16 + 12}px` }}
            >
              <span className={row.bold ? "font-semibold text-white" : ""}>{row.label}</span>
              {row.value && (
                <span
                  className={`tabular-nums ${
                    isTotal ? "text-white" : parseFloat(row.value) < 0 ? "text-red-400" : ""
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

export default function QuickBooks() {
  const [status, setStatus] = useState<"loading" | "connected" | "disconnected" | "error">("loading");
  const [companyName, setCompanyName] = useState("");
  const [companyInfo, setCompanyInfo] = useState<any>(null);
  const [profitLoss, setProfitLoss] = useState<any>(null);
  const [balanceSheet, setBalanceSheet] = useState<any>(null);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");

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
          // Fetch all data in parallel
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
  }

  const plData = profitLoss ? parseQBOReport(profitLoss) : null;
  const bsData = balanceSheet ? parseQBOReport(balanceSheet) : null;

  // Extract key metrics from P&L
  const netIncome = plData?.rows.find((r) => r.label.toLowerCase().includes("net income"))?.value;
  const totalIncome = plData?.rows.find((r) => r.label.toLowerCase() === "total income" || r.label.toLowerCase() === "gross profit")?.value;
  const totalExpenses = plData?.rows.find((r) => r.label.toLowerCase().startsWith("total expenses"))?.value;

  // Extract key metrics from Balance Sheet
  const totalAssets = bsData?.rows.find((r) => r.label.toLowerCase() === "total assets")?.value;
  const totalLiabilities = bsData?.rows.find(
    (r) => r.label.toLowerCase().startsWith("total liabilities")
  )?.value;
  const totalEquity = bsData?.rows.find((r) => r.label.toLowerCase().includes("total equity"))?.value;

  const accent = "#22c55e";

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <Link to="/tools" className="text-gray-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-2xl font-bold">QuickBooks</h1>
        </div>
        {status === "connected" && (
          <button
            onClick={handleDisconnect}
            className="text-xs text-gray-500 hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-red-400/30"
          >
            Disconnect
          </button>
        )}
      </div>
      <p className="text-gray-500 text-sm mb-8">Ledger Louise, LLC &mdash; Financial Dashboard</p>

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
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/20 border-t-white/80" />
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
          <h2 className="text-lg font-semibold mb-2">Connect QuickBooks</h2>
          <p className="text-gray-500 text-sm mb-6 max-w-md">
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
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 mb-6">
              <div className="flex items-center gap-4">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm"
                  style={{ background: `${accent}20`, color: accent }}
                >
                  {companyName?.charAt(0) || "L"}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-sm">{companyName}</h3>
                  <p className="text-gray-500 text-xs">
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
                    <div key={m.label} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                      <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{m.label}</p>
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
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
              {loading["profit-loss"] ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-white/20 border-t-white/80" />
                </div>
              ) : plData ? (
                <ReportTable data={plData} accent={accent} />
              ) : (
                <p className="text-gray-500 text-sm text-center py-12">No P&L data available</p>
              )}
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
              {loading["balance-sheet"] ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-white/20 border-t-white/80" />
                </div>
              ) : bsData ? (
                <ReportTable data={bsData} accent="#3b82f6" />
              ) : (
                <p className="text-gray-500 text-sm text-center py-12">No Balance Sheet data available</p>
              )}
            </div>
          </div>

          {/* Refresh */}
          <div className="mt-6 flex justify-center">
            <button
              onClick={async () => {
                const [pl, bs] = await Promise.all([
                  fetchData("profit-loss"),
                  fetchData("balance-sheet"),
                ]);
                if (pl) setProfitLoss(pl);
                if (bs) setBalanceSheet(bs);
              }}
              disabled={loading["profit-loss"] || loading["balance-sheet"]}
              className="text-xs text-gray-500 hover:text-white transition-colors px-4 py-2 rounded-lg border border-white/10 hover:border-white/20 disabled:opacity-50"
            >
              {loading["profit-loss"] || loading["balance-sheet"] ? "Refreshing..." : "Refresh Data"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
