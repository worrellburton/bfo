import { useState } from "react";
import { Link } from "react-router";
import {
  accent,
  fmt,
  fmtCompact,
  bankAccounts,
  totalBank,
  accountsReceivable,
  totalAR,
  otherCurrentAssets,
  totalOtherCurrent,
  totalCurrentAssets,
  fixedAssets,
  totalFixed,
  otherAssets,
  totalOther,
  totalAssets,
  accountsPayable,
  totalAP,
  otherCurrentLiabilities,
  totalOtherCurrentLiab,
  totalCurrentLiab,
  longTermLiab,
  totalLongTermLiab,
  totalLiabilities,
  equity,
  totalEquity,
  totalLiabilitiesEquity,
} from "./vq-balance-sheet-view";

export function meta() {
  return [{ title: "BFO - VQ Balance Sheet" }];
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-white/10 bg-white/[0.02] p-5 ${className}`}>{children}</div>;
}

function Metric({ label, value, sub, color = accent, trend }: { label: string; value: string; sub?: string; color?: string; trend?: "up" | "down" | "neutral" }) {
  return (
    <Card>
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-xl font-bold" style={{ color }}>{value}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-1">{sub}</p>}
    </Card>
  );
}

function LineItem({ code, name, value, indent = 0 }: { code: string; name: string; value: number; indent?: number }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-[11px] hover:bg-white/[0.02] rounded px-2" style={{ paddingLeft: `${0.5 + indent * 1}rem` }}>
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {code && <span className="text-gray-600 font-mono text-[10px] shrink-0">{code}</span>}
        <span className="text-gray-400 truncate">{name}</span>
      </div>
      <span className={`font-mono tabular-nums shrink-0 ${value < 0 ? "text-red-400" : "text-gray-300"}`}>{fmt(value)}</span>
    </div>
  );
}

function SubTotal({ label, value, indent = 0 }: { label: string; value: number; indent?: number }) {
  return (
    <div className="flex items-center justify-between py-2 text-xs font-semibold border-t border-white/10 mt-1" style={{ paddingLeft: `${0.5 + indent * 1}rem` }}>
      <span className="text-gray-300">{label}</span>
      <span className="font-mono tabular-nums text-gray-200">{fmt(value)}</span>
    </div>
  );
}

function SectionHeader({ label, indent = 0 }: { label: string; indent?: number }) {
  return (
    <div className="py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500" style={{ paddingLeft: `${0.5 + indent * 1}rem` }}>
      {label}
    </div>
  );
}

function Collapsible({ title, color, defaultOpen = true, children }: { title: string; color: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="mb-4">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}15` }}>
            <svg className="w-4 h-4" style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={open ? "M19 9l-7 7-7-7" : "M9 5l7 7-7 7"} />
            </svg>
          </div>
          <h2 className="text-sm font-bold" style={{ color }}>{title}</h2>
        </div>
      </button>
      {open && <div>{children}</div>}
    </Card>
  );
}

export function VQBalanceSheetContent({ showShare = true }: { showShare?: boolean }) {
  const [copied, setCopied] = useState(false);

  // Calculated metrics
  const currentRatio = totalCurrentAssets / totalCurrentLiab;
  const debtToEquity = totalLiabilities / totalEquity;
  const workingCapital = totalCurrentAssets - totalCurrentLiab;
  const netIncome = -1639698.5;
  const equityPct = (totalEquity / totalAssets) * 100;
  const cashCoverage = (totalBank / totalCurrentLiab) * 100;

  // Grant deferred revenue total
  const grantDeferred = otherCurrentLiabilities
    .filter((l) => l.name.startsWith("Deferred Revenue"))
    .reduce((sum, l) => sum + l.value, 0);

  const rouAssetNet = 13878954 - 6413938;
  const rouLeaseTotal = 5262708 + 1910378;

  async function copyLink() {
    const url = `${window.location.origin}/public/vq-balance-sheet`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // noop
    }
  }

  const insights = [
    {
      severity: "red" as const,
      title: "Net loss of $1.64M",
      description: "The entity is operating at a loss. Net income flows negatively through equity.",
    },
    {
      severity: "red" as const,
      title: "Negative working capital of $1.57M",
      description: `Current assets (${fmtCompact(totalCurrentAssets)}) don't cover current liabilities (${fmtCompact(totalCurrentLiab)}). Current ratio 0.86 — below the 1.0 solvency threshold.`,
    },
    {
      severity: "red" as const,
      title: "Highly leveraged: 9.73x debt-to-equity",
      description: `Liabilities (${fmtCompact(totalLiabilities)}) are nearly 10x equity (${fmtCompact(totalEquity)}). Equity represents only ${equityPct.toFixed(1)}% of total assets.`,
    },
    {
      severity: "yellow" as const,
      title: "$400K doubtful accounts allowance",
      description: "Allowance represents 34% of accounts receivable — significant collection risk on $1.18M gross AR.",
    },
    {
      severity: "yellow" as const,
      title: `Related-party note: $2.09M to Bob Burton`,
      description: "Long-term note payable dated 3.30.23. Material related-party obligation requires disclosure.",
    },
    {
      severity: "blue" as const,
      title: `Strong cash position: ${fmtCompact(totalBank)}`,
      description: `Bank accounts cover ${cashCoverage.toFixed(0)}% of current liabilities. BMO Reserve holds $3.89M alone.`,
    },
    {
      severity: "blue" as const,
      title: `Grant deferred revenue: ${fmtCompact(grantDeferred)}`,
      description: "Multi-state program grants (CA, TX, AZ, NM, MD) creating future earned revenue as services are delivered.",
    },
    {
      severity: "gray" as const,
      title: "ROU leases balanced (ASC 842)",
      description: `Net ROU asset ${fmtCompact(rouAssetNet)} vs lease liability ${fmtCompact(rouLeaseTotal)} — standard operating lease accounting.`,
    },
  ];

  const severityStyles = {
    red: { bg: "bg-red-500/10", border: "border-red-500/20", text: "text-red-400", dot: "#ef4444" },
    yellow: { bg: "bg-yellow-500/10", border: "border-yellow-500/20", text: "text-yellow-400", dot: "#eab308" },
    blue: { bg: "bg-blue-500/10", border: "border-blue-500/20", text: "text-blue-400", dot: "#3b82f6" },
    gray: { bg: "bg-white/[0.03]", border: "border-white/10", text: "text-gray-400", dot: "#9ca3af" },
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${accent}15` }}>
            <svg className="w-6 h-6" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold">VQ Balance Sheet</h1>
            <p className="text-gray-500 text-sm">Financial position snapshot</p>
          </div>
        </div>
        {showShare && (
          <button
            onClick={copyLink}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-xs font-medium transition-colors"
            style={{ color: accent }}
          >
            {copied ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Link copied
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                </svg>
                Copy public link
              </>
            )}
          </button>
        )}
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Metric label="Total Assets" value={fmtCompact(totalAssets)} sub="All asset categories" color="#8b5cf6" />
        <Metric label="Total Liabilities" value={fmtCompact(totalLiabilities)} sub={`${((totalLiabilities / totalAssets) * 100).toFixed(1)}% of assets`} color="#ef4444" />
        <Metric label="Total Equity" value={fmtCompact(totalEquity)} sub={`${equityPct.toFixed(1)}% of assets`} color="#22c55e" />
        <Metric label="Net Income" value={fmtCompact(netIncome)} sub="Current period" color="#ef4444" />
      </div>

      {/* Financial Health Ratios */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Metric label="Current Ratio" value={currentRatio.toFixed(2)} sub="Target: > 1.0" color={currentRatio < 1 ? "#ef4444" : "#22c55e"} />
        <Metric label="Debt to Equity" value={`${debtToEquity.toFixed(2)}x`} sub="Target: < 2.0x" color={debtToEquity > 3 ? "#ef4444" : "#22c55e"} />
        <Metric label="Working Capital" value={fmtCompact(workingCapital)} sub="Current assets − liabilities" color={workingCapital < 0 ? "#ef4444" : "#22c55e"} />
        <Metric label="Cash Coverage" value={`${cashCoverage.toFixed(0)}%`} sub="Cash / current liabilities" color="#3b82f6" />
      </div>

      {/* Insights */}
      <Card className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <svg className="w-5 h-5" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
          </svg>
          <h2 className="text-sm font-bold">Key Insights</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {insights.map((insight, i) => {
            const styles = severityStyles[insight.severity];
            return (
              <div key={i} className={`p-3 rounded-lg border ${styles.bg} ${styles.border}`}>
                <div className="flex items-start gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ background: styles.dot }} />
                  <div>
                    <p className={`text-xs font-semibold ${styles.text}`}>{insight.title}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">{insight.description}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Balance Sheet Detail */}
      <Collapsible title="ASSETS" color="#8b5cf6">
        <SectionHeader label="Current Assets" />
        <SectionHeader label="Bank Accounts" indent={1} />
        {bankAccounts.map((a) => <LineItem key={a.code} code={a.code} name={a.name} value={a.value} indent={2} />)}
        <SubTotal label="Total Bank Accounts" value={totalBank} indent={1} />

        <SectionHeader label="Accounts Receivable" indent={1} />
        {accountsReceivable.map((a) => <LineItem key={a.code} code={a.code} name={a.name} value={a.value} indent={2} />)}
        <SubTotal label="Total Accounts Receivable" value={totalAR} indent={1} />

        <SectionHeader label="Other Current Assets" indent={1} />
        {otherCurrentAssets.map((a) => <LineItem key={a.code} code={a.code} name={a.name} value={a.value} indent={2} />)}
        <SubTotal label="Total Other Current Assets" value={totalOtherCurrent} indent={1} />

        <SubTotal label="Total Current Assets" value={totalCurrentAssets} />

        <SectionHeader label="Fixed Assets" />
        {fixedAssets.map((a) => <LineItem key={a.code} code={a.code} name={a.name} value={a.value} indent={1} />)}
        <SubTotal label="Total Fixed Assets" value={totalFixed} />

        <SectionHeader label="Other Assets" />
        {otherAssets.map((a) => <LineItem key={a.code} code={a.code} name={a.name} value={a.value} indent={1} />)}
        <SubTotal label="Total Other Assets" value={totalOther} />

        <div className="flex items-center justify-between py-3 mt-2 border-t-2 border-purple-500/30 bg-purple-500/5 px-2 rounded">
          <span className="text-sm font-bold text-purple-300">TOTAL ASSETS</span>
          <span className="font-mono tabular-nums text-sm font-bold text-purple-300">{fmt(totalAssets)}</span>
        </div>
      </Collapsible>

      <Collapsible title="LIABILITIES" color="#ef4444" defaultOpen={true}>
        <SectionHeader label="Current Liabilities" />
        <SectionHeader label="Accounts Payable" indent={1} />
        {accountsPayable.map((a) => <LineItem key={a.code} code={a.code} name={a.name} value={a.value} indent={2} />)}
        <SubTotal label="Total Accounts Payable" value={totalAP} indent={1} />

        <SectionHeader label="Other Current Liabilities" indent={1} />
        {otherCurrentLiabilities.map((a) => <LineItem key={a.code} code={a.code} name={a.name} value={a.value} indent={2} />)}
        <SubTotal label="Total Other Current Liabilities" value={totalOtherCurrentLiab} indent={1} />

        <SubTotal label="Total Current Liabilities" value={totalCurrentLiab} />

        <SectionHeader label="Long-Term Liabilities" />
        {longTermLiab.map((a) => <LineItem key={a.code} code={a.code} name={a.name} value={a.value} indent={1} />)}
        <SubTotal label="Total Long-Term Liabilities" value={totalLongTermLiab} />

        <div className="flex items-center justify-between py-3 mt-2 border-t-2 border-red-500/30 bg-red-500/5 px-2 rounded">
          <span className="text-sm font-bold text-red-300">TOTAL LIABILITIES</span>
          <span className="font-mono tabular-nums text-sm font-bold text-red-300">{fmt(totalLiabilities)}</span>
        </div>
      </Collapsible>

      <Collapsible title="EQUITY" color="#22c55e" defaultOpen={true}>
        {equity.map((a, i) => <LineItem key={i} code={a.code} name={a.name} value={a.value} indent={1} />)}
        <div className="flex items-center justify-between py-3 mt-2 border-t-2 border-green-500/30 bg-green-500/5 px-2 rounded">
          <span className="text-sm font-bold text-green-300">TOTAL EQUITY</span>
          <span className="font-mono tabular-nums text-sm font-bold text-green-300">{fmt(totalEquity)}</span>
        </div>
      </Collapsible>

      {/* Grand Total */}
      <Card className="mt-6" >
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-gray-200">TOTAL LIABILITIES AND EQUITY</span>
          <span className="font-mono tabular-nums text-lg font-bold" style={{ color: accent }}>{fmt(totalLiabilitiesEquity)}</span>
        </div>
      </Card>
    </div>
  );
}

export default function VQBalanceSheet() {
  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-6">
        <Link to="/tools" className="hover:text-white transition-colors">Tools</Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-gray-300">VQ Balance Sheet</span>
      </div>
      <VQBalanceSheetContent />
    </div>
  );
}
