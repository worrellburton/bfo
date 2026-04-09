import { useState } from "react";
import { Link } from "react-router";
import { useTheme } from "../theme";
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
  const { theme } = useTheme();
  const isDark = theme === "dark";
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

      {/* Equity Deep Dive */}
      <div className="mt-10 mb-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-green-500/15">
            <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4" />
            </svg>
          </div>
          <h2 className="text-lg font-bold">Equity Accounts Explained</h2>
        </div>
        <p className="text-xs text-gray-500 mb-4">Plain-English breakdown of each equity line item</p>
      </div>

      <div className="space-y-4">
        {/* Common Stock */}
        <Card>
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-gray-500">31110</span>
              <h3 className="text-sm font-bold text-gray-200">Common Stock</h3>
            </div>
            <span className="font-mono tabular-nums text-sm font-bold text-green-400">$1,444,543.33</span>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed mb-2">
            <strong className={isDark ? "text-gray-300" : "text-gray-700"}>What it is:</strong> The <em>par value</em> of all shares VQ has issued to shareholders. Par value is a nominal
            amount (often $0.01 or $1) assigned to each share when the company was incorporated — it's an accounting legacy, not market value.
          </p>
          <p className="text-xs text-gray-400 leading-relaxed">
            <strong className={isDark ? "text-gray-300" : "text-gray-700"}>Why it matters:</strong> This represents the legal capital of the company — the minimum amount shareholders
            contributed. It doesn't change unless new shares are issued or retired.
          </p>
        </Card>

        {/* Additional Paid In Capital */}
        <Card>
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-gray-500">31120</span>
              <h3 className="text-sm font-bold text-gray-200">Additional Paid-In Capital (APIC)</h3>
            </div>
            <span className="font-mono tabular-nums text-sm font-bold text-green-400">$160,014.69</span>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed mb-2">
            <strong className={isDark ? "text-gray-300" : "text-gray-700"}>What it is:</strong> The amount shareholders paid <em>above</em> par value when buying stock directly from the company.
            If par is $1 and shareholders paid $10, the extra $9 per share goes here.
          </p>
          <p className="text-xs text-gray-400 leading-relaxed">
            <strong className={isDark ? "text-gray-300" : "text-gray-700"}>Why it matters:</strong> APIC plus Common Stock = the total cash shareholders put into the business for their
            ownership stake. For VQ: <strong className={isDark ? "text-gray-300" : "text-gray-700"}>$1.44M + $160K = $1.60M</strong> total contributed capital.
          </p>
        </Card>

        {/* Retained Earnings */}
        <Card>
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-gray-500">31210</span>
              <h3 className="text-sm font-bold text-gray-200">Retained Earnings</h3>
            </div>
            <span className="font-mono tabular-nums text-sm font-bold text-red-400">-$466.42</span>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed mb-2">
            <strong className={isDark ? "text-gray-300" : "text-gray-700"}>What it is:</strong> The cumulative net profits (or losses) the company has kept <em>from prior years</em>, after
            paying out any dividends. A negative number means accumulated losses exceed accumulated profits historically.
          </p>
          <p className="text-xs text-gray-400 leading-relaxed">
            <strong className={isDark ? "text-gray-300" : "text-gray-700"}>Why it matters:</strong> VQ's retained earnings are essentially zero (-$466) — meaning historically, profits and
            losses have roughly cancelled out. The current year's $1.64M loss will roll into this account at year-end, making it significantly negative.
          </p>
        </Card>

        {/* Treasury Stock — THE BIG ONE */}
        <Card className="border-yellow-500/30 bg-yellow-500/[0.03]">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-gray-500">31300</span>
              <h3 className="text-sm font-bold text-yellow-300">Treasury Stock</h3>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border bg-yellow-500/15 text-yellow-400 border-yellow-500/30">
                Largest Item
              </span>
            </div>
            <span className="font-mono tabular-nums text-sm font-bold text-red-400">-$5,836,850.09</span>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">What It Is</p>
              <p className={`text-xs ${isDark ? "text-gray-300" : "text-gray-700"} leading-relaxed`}>
                Treasury stock is <strong>VQ's own shares that the company bought back from shareholders</strong>. When a company repurchases its own stock,
                those shares aren't cancelled — they're held "in the treasury" and recorded as a negative number that reduces total equity. This is called a
                <em> contra-equity account</em>.
              </p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Why It's Negative</p>
              <p className={`text-xs ${isDark ? "text-gray-300" : "text-gray-700"} leading-relaxed`}>
                The company used $5.84M of its cash to buy back shares. That cash left the company (reducing assets) and in exchange the company got
                back its own stock (which doesn't count as an asset — you can't own yourself). The result is a permanent reduction in equity of $5.84M.
              </p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Why Companies Do This</p>
              <ul className={`text-xs ${isDark ? "text-gray-300" : "text-gray-700"} leading-relaxed space-y-1 list-disc pl-5`}>
                <li><strong>Buying out departing shareholders</strong> — a co-founder or early investor wants to exit, the company buys their shares.</li>
                <li><strong>Estate planning / succession</strong> — common in family businesses when ownership is being consolidated.</li>
                <li><strong>Employee stock plans</strong> — shares held in treasury to issue to employees later.</li>
                <li><strong>Concentrating ownership</strong> — fewer shares outstanding means remaining shareholders own a bigger percentage.</li>
                <li><strong>Returning cash to shareholders</strong> — an alternative to paying dividends.</li>
              </ul>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">What This Means for VQ</p>
              <p className={`text-xs ${isDark ? "text-gray-300" : "text-gray-700"} leading-relaxed`}>
                VQ has spent <strong className="text-yellow-300">$5.84M of its cash</strong> to repurchase shares at some point in the past. This is 4x the size of total
                contributed capital ($1.6M), which means the buybacks were funded by retained earnings from prior profitable years or by taking on debt (note
                the $2.09M related-party note to Bob Burton). The Grace Dix Stock Repurchase line ($5,277 in current liabilities) suggests stock repurchase
                activity is ongoing.
              </p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Impact on Equity</p>
              <p className={`text-xs ${isDark ? "text-gray-300" : "text-gray-700"} leading-relaxed`}>
                Without the treasury stock position, VQ's total equity would be approximately
                <strong className="text-green-400"> $7.46M</strong> instead of $1.62M. The buybacks account for 78% of the gap between contributed capital
                and current equity. Combined with the $1.64M current year loss, they leave VQ with minimal equity cushion against liabilities.
              </p>
            </div>
          </div>
        </Card>

        {/* Deferred Comp Obligation */}
        <Card>
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-gray-500">31500</span>
              <h3 className="text-sm font-bold text-gray-200">Deferred Compensation Obligation</h3>
            </div>
            <span className="font-mono tabular-nums text-sm font-bold text-green-400">$936,472.43</span>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed mb-2">
            <strong className={isDark ? "text-gray-300" : "text-gray-700"}>What it is:</strong> Compensation that has been earned by employees or executives but isn't paid until a future
            date (retirement, vesting, or termination). It's a promise to pay later, recorded in equity because it's often tied to stock-based or
            ownership-linked arrangements.
          </p>
          <p className="text-xs text-gray-400 leading-relaxed mb-2">
            <strong className={isDark ? "text-gray-300" : "text-gray-700"}>Why it's here and not in liabilities:</strong> When deferred comp is funded through a rabbi trust or tied to
            company stock, it appears in equity as an offsetting entry. There's also a "VQ Deferred Compensation" line of $66,666.67 in current liabilities —
            likely the portion due within the next 12 months.
          </p>
          <p className="text-xs text-gray-400 leading-relaxed">
            <strong className={isDark ? "text-gray-300" : "text-gray-700"}>Why it matters:</strong> $936K in future comp obligations is material. These will eventually be paid out in cash,
            reducing equity further when paid.
          </p>
        </Card>

        {/* Opening Balance Equity */}
        <Card>
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-gray-200">Opening Balance Equity</h3>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border bg-orange-500/15 text-orange-400 border-orange-500/30">
                Cleanup Needed
              </span>
            </div>
            <span className="font-mono tabular-nums text-sm font-bold text-green-400">$6,557,006.86</span>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed mb-2">
            <strong className={isDark ? "text-gray-300" : "text-gray-700"}>What it is:</strong> A <em>QuickBooks-generated temporary account</em> that holds offsetting entries when
            opening balances were entered during initial setup or migration. It should eventually be reclassified into Retained Earnings, Common Stock, or
            APIC — whichever is appropriate.
          </p>
          <p className="text-xs text-gray-400 leading-relaxed mb-2">
            <strong className={isDark ? "text-gray-300" : "text-gray-700"}>Why a clean balance sheet shouldn't have this:</strong> An Opening Balance Equity balance of $6.56M means the
            QuickBooks file was set up with offsetting entries that were never properly reclassified. CPAs typically zero this account out by reclassifying
            it to the correct equity account during year-end close.
          </p>
          <p className="text-xs text-gray-400 leading-relaxed">
            <strong className={isDark ? "text-gray-300" : "text-gray-700"}>Action item:</strong> Work with the bookkeeper or CPA to identify what this balance represents (likely prior
            year retained earnings or capital contributions) and reclassify it. This is the single largest cleanup item on the balance sheet.
          </p>
        </Card>

        {/* Net Income */}
        <Card>
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-gray-200">Net Income (Current Period)</h3>
            </div>
            <span className="font-mono tabular-nums text-sm font-bold text-red-400">-$1,639,698.50</span>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed mb-2">
            <strong className={isDark ? "text-gray-300" : "text-gray-700"}>What it is:</strong> The profit or loss from the current accounting period (year-to-date or full year). This
            flows from the Income Statement and increases or decreases equity depending on whether the company made money.
          </p>
          <p className="text-xs text-gray-400 leading-relaxed mb-2">
            <strong className={isDark ? "text-gray-300" : "text-gray-700"}>What $1.64M loss means:</strong> VQ spent $1.64M more than it brought in during the current period. At year-end
            this loss will be closed out of Net Income and added to Retained Earnings, making retained earnings roughly -$1.64M going into next year.
          </p>
          <p className="text-xs text-gray-400 leading-relaxed">
            <strong className={isDark ? "text-gray-300" : "text-gray-700"}>Trajectory concern:</strong> With only $1.62M of total equity and a current-period loss of $1.64M, <em>another
            year of similar losses would wipe out equity entirely</em>. Recovery requires either cutting expenses, growing revenue, or raising new capital.
          </p>
        </Card>

        {/* Summary Card */}
        <Card className="border-purple-500/30 bg-purple-500/[0.03]">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-purple-500/15 shrink-0">
              <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-bold text-purple-300 mb-2">How Equity Actually Got to $1.62M</h3>
              <div className={`space-y-1 text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                <div className="flex justify-between"><span>Common stock + APIC (money from shareholders)</span><span className="font-mono text-green-400">+$1,604,558</span></div>
                <div className="flex justify-between"><span>Retained earnings (historical profit/loss)</span><span className="font-mono text-red-400">-$466</span></div>
                <div className="flex justify-between"><span>Treasury stock (buybacks)</span><span className="font-mono text-red-400">-$5,836,850</span></div>
                <div className="flex justify-between"><span>Deferred comp obligation</span><span className="font-mono text-green-400">+$936,472</span></div>
                <div className="flex justify-between"><span>Opening balance equity (QB cleanup)</span><span className="font-mono text-green-400">+$6,557,007</span></div>
                <div className="flex justify-between"><span>Net income (current period loss)</span><span className="font-mono text-red-400">-$1,639,699</span></div>
                <div className="flex justify-between pt-2 border-t border-white/10 font-bold">
                  <span className="text-purple-300">Total Equity</span>
                  <span className="font-mono text-purple-300">$1,621,022</span>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function VQBalanceSheet() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-6">
        <Link to="/tools" className={`${isDark ? "hover:text-white" : "hover:text-gray-900"} transition-colors`}>Tools</Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className={isDark ? "text-gray-300" : "text-gray-700"}>VQ Balance Sheet</span>
      </div>
      <VQBalanceSheetContent />
    </div>
  );
}
