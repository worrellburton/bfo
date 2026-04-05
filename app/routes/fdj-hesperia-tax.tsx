import { useState } from "react";
import { Link } from "react-router";

export function meta() {
  return [{ title: "BFO - FDJ Hesperia Tax Analysis" }];
}

function StatusBadge({ status, label }: { status: "green" | "amber" | "red"; label: string }) {
  const colors = {
    green: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    amber: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    red: "bg-red-500/15 text-red-400 border-red-500/30",
  };
  const dots = { green: "bg-emerald-400", amber: "bg-amber-400", red: "bg-red-400" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${colors[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dots[status]}`} />
      {label}
    </span>
  );
}

const tabs = [
  { label: "Overview", href: "/tools/fdj-hesperia", active: false },
  { label: "Financials", href: "/tools/fdj-hesperia/financials", active: false },
  { label: "Documents", href: "/tools/fdj-hesperia/documents", active: false },
  { label: "Advisory", href: "/tools/fdj-hesperia/advisory", active: false },
  { label: "Tax", href: "/tools/fdj-hesperia/tax", active: true },
];

const entityOptions = {
  "fdj-hesperia": {
    label: "FDJ Hesperia, LLC",
    subtitle: "Both properties (El Dorado + Comfort Suites)",
    purchasePrice: 12748000,
    accumulatedDepr: 2776163,
    deprNote: "El Dorado 27.5yr + Comfort Suites 39yr MACRS",
    debt: 5850000,
    bwlNotes: 4400000,
    scenarios: {
      low: { label: "At Cost", salePrice: 12748000, desc: "Sell to BWL at original purchase price (conservative)" },
      mid: { label: "Modest Growth", salePrice: 15000000, desc: "~18% appreciation over 9 years (below market)" },
      high: { label: "Market Value", salePrice: 18000000, desc: "~41% appreciation (reasonable for Tucson real estate)" },
    },
    assumptions: [
      "Combined purchase price: $12.748M (El Dorado $5.475M + Comfort Suites $7.273M)",
      "Building basis ~80% of purchase (land non-depreciable)",
      "El Dorado: 27.5-yr residential MACRS (IRC §168)",
      "Comfort Suites: 39-yr commercial MACRS",
      "Accumulated depreciation ~$2.78M over 9 years",
    ],
    complications: [
      { bold: "$4.4M BWL Promissory Notes:", text: "If offset against purchase price, may trigger cancellation of indebtedness income separately" },
      { bold: "$5.85M Property Debt:", text: "Assumption of debt counts as part of sale proceeds (boot)" },
      { bold: "Holding Period:", text: "9+ years confirms long-term capital gain treatment" },
      { bold: "Community Property (AZ):", text: "Spouses may split gain 50/50; step-up at first death could reduce future tax" },
      { bold: "Entity Classification:", text: "Actual tax depends on whether FDJ is taxed as partnership, disregarded entity, or corp" },
    ],
    entitySaleDesc: "When BWL buys 100% of FDJ Hesperia, LLC, the Burtons are selling their membership interests, not the properties directly.",
    disclaimer: "This is an estimate for planning purposes. Actual tax will depend on FDJ Hesperia's entity classification, each spouse's tax bracket, prior suspended passive losses, state of residence, and how the $4.4M BWL note is settled. Consult a qualified tax professional before acting.",
  },
  "fdj-cfs": {
    label: "FDJ CFS, LLC",
    subtitle: "Comfort Suites Tucson only (86 rooms, hospitality)",
    purchasePrice: 7273000,
    accumulatedDepr: 1342708,
    deprNote: "39-yr commercial MACRS (hospitality)",
    debt: 3350000,
    bwlNotes: 0,
    scenarios: {
      low: { label: "At Cost", salePrice: 7273000, desc: "Sell CFS to BWL at original purchase price (conservative)" },
      mid: { label: "Modest Growth", salePrice: 8500000, desc: "~17% appreciation over 9 years (below market for hospitality)" },
      high: { label: "Market Value", salePrice: 10000000, desc: "~37% appreciation (strong hospitality market)" },
    },
    assumptions: [
      "Purchase price: $7.273M (Comfort Suites Tucson, 86 rooms)",
      "Building basis ~80% of purchase (land non-depreciable)",
      "39-yr commercial MACRS depreciation (IRC §168)",
      "Accumulated depreciation ~$1.34M over 9 years",
      "Hospitality asset — classified as nonresidential real property",
    ],
    complications: [
      { bold: "$3.35M Property Debt:", text: "Assumption of debt by BWL counts as part of sale proceeds (boot)" },
      { bold: "Holding Period:", text: "9+ years confirms long-term capital gain treatment" },
      { bold: "FF&E / Personal Property:", text: "Hotel furniture, fixtures & equipment may be subject to ordinary income recapture (IRC §1245) rather than §1250 rates" },
      { bold: "Community Property (AZ):", text: "Spouses may split gain 50/50; step-up at first death could reduce future tax" },
      { bold: "Franchise Agreement:", text: "Transfer of Choice Hotels franchise may require approval and trigger assignment fees" },
    ],
    entitySaleDesc: "When BWL buys 100% of FDJ CFS, LLC, the Burtons are selling their membership interest in the Comfort Suites entity only — not the El Dorado property.",
    disclaimer: "This is an estimate for planning purposes. Actual tax will depend on FDJ CFS's entity classification, allocation between real property and FF&E, each spouse's tax bracket, prior suspended passive losses, and state of residence. Consult a qualified tax professional before acting.",
  },
};

export default function FDJHesperiaTax() {
  const [entity, setEntity] = useState<"fdj-hesperia" | "fdj-cfs">("fdj-hesperia");
  const [scenario, setScenario] = useState<"low" | "mid" | "high">("mid");

  const ent = entityOptions[entity];
  const purchasePrice = ent.purchasePrice;
  const accumulatedDepr = ent.accumulatedDepr;
  const adjustedBasis = purchasePrice - accumulatedDepr;

  const scenarios = ent.scenarios;

  const current = scenarios[scenario];
  const totalGain = current.salePrice - adjustedBasis;
  const depRecapture = Math.min(accumulatedDepr, totalGain);
  const ltcgAmount = Math.max(0, totalGain - depRecapture);

  const depRecaptureTax = depRecapture * 0.25;
  const ltcgTax = ltcgAmount * 0.2;
  const niit = totalGain * 0.038;
  const fedTotal = depRecaptureTax + ltcgTax + niit;
  const stateTax = totalGain * 0.025;
  const totalTax = fedTotal + stateTax;
  const netProceeds = current.salePrice - totalTax;

  function fmtTax(n: number) {
    return `$${Math.round(n).toLocaleString()}`;
  }

  function fmtDepr(n: number) {
    if (n >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
    return `$${Math.round(n / 1000).toLocaleString()}K`;
  }

  return (
    <div className="max-w-6xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-4">
        <Link to="/tools" className="hover:text-white transition-colors">Tools</Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <Link to="/tools/fdj-hesperia" className="hover:text-white transition-colors">FDJ Hesperia</Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-gray-300">Tax</span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">FDJ Hesperia</h1>
          <p className="text-gray-500 text-sm">Tax Analysis — Sale to BWL Investments</p>
        </div>
        <StatusBadge status="amber" label="Analysis" />
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-white/10 mb-8 overflow-x-auto -mx-1 px-1">
        {tabs.map((tab) => (
          <Link
            key={tab.label}
            to={tab.href}
            className={`px-4 py-2 text-sm font-medium transition-colors relative whitespace-nowrap shrink-0 ${
              tab.active ? "text-white" : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab.label}
            {tab.active && <div className="absolute bottom-0 left-0 right-0 h-px bg-amber-500" />}
          </Link>
        ))}
      </div>

      {/* Tax Content */}
      <div className="rounded-xl border border-white/10 bg-gradient-to-br from-amber-500/[0.03] to-purple-500/[0.03] p-5 mb-8">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-amber-500/15 border border-amber-500/30 shrink-0">
            <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.375m-8.25-3a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm6.75-6a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm-13.5 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-white">Tax Analysis — Sale to BWL Investments, LLC</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">Scenario: BWL Investments purchases 100% membership interest in {ent.label}</p>
          </div>
        </div>

        {/* Entity Toggle */}
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          {(Object.keys(entityOptions) as Array<keyof typeof entityOptions>).map((key) => {
            const e = entityOptions[key];
            const isActive = entity === key;
            return (
              <button
                key={key}
                onClick={() => { setEntity(key); setScenario("mid"); }}
                className={`flex-1 px-3 py-2.5 rounded-lg text-xs font-medium transition-all border ${
                  isActive
                    ? "bg-purple-500/15 text-purple-300 border-purple-500/40"
                    : "bg-white/[0.02] text-gray-400 border-white/10 hover:bg-white/[0.04]"
                }`}
              >
                <div className="font-bold">{e.label}</div>
                <div className="text-[10px] opacity-70 mt-0.5">{e.subtitle}</div>
              </button>
            );
          })}
        </div>

        {/* Scenario Toggle */}
        <div className="flex flex-wrap gap-2 mb-5">
          {(Object.keys(scenarios) as Array<keyof typeof scenarios>).map((key) => {
            const s = scenarios[key];
            const isActive = scenario === key;
            return (
              <button
                key={key}
                onClick={() => setScenario(key)}
                className={`flex-1 min-w-[120px] px-3 py-2.5 rounded-lg text-xs font-medium transition-all border ${
                  isActive
                    ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
                    : "bg-white/[0.02] text-gray-400 border-white/10 hover:bg-white/[0.04]"
                }`}
              >
                <div className="font-bold">{s.label}</div>
                <div className="text-[10px] opacity-70 tabular-nums mt-0.5">{fmtTax(s.salePrice)}</div>
              </button>
            );
          })}
        </div>

        <p className="text-[10px] text-gray-500 mb-5 leading-relaxed italic">{current.desc}</p>

        {/* Key Numbers */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="p-3 rounded-lg bg-white/[0.02] border border-white/10">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Sale Price</div>
            <div className="text-sm font-bold text-white tabular-nums">{fmtTax(current.salePrice)}</div>
          </div>
          <div className="p-3 rounded-lg bg-white/[0.02] border border-white/10">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Adjusted Basis</div>
            <div className="text-sm font-bold text-gray-300 tabular-nums">{fmtTax(adjustedBasis)}</div>
            <div className="text-[9px] text-gray-500 mt-0.5">After {fmtDepr(accumulatedDepr)} depreciation</div>
          </div>
          <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
            <div className="text-[9px] text-amber-400/70 uppercase tracking-wider mb-1">Total Gain</div>
            <div className="text-sm font-bold text-amber-300 tabular-nums">{fmtTax(totalGain)}</div>
          </div>
          <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
            <div className="text-[9px] text-red-400/70 uppercase tracking-wider mb-1">Est. Total Tax</div>
            <div className="text-sm font-bold text-red-300 tabular-nums">{fmtTax(totalTax)}</div>
          </div>
        </div>

        {/* Tax Breakdown */}
        <div className="rounded-lg bg-black/30 border border-white/5 p-4 mb-5">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-3">Federal & State Tax Breakdown</div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex-1 min-w-0">
                <span className="text-gray-300">Depreciation Recapture</span>
                <span className="text-[9px] text-gray-600 ml-2 hidden sm:inline">IRC §1250 · 25% rate</span>
              </div>
              <div className="text-right tabular-nums shrink-0">
                <div className="text-gray-400 hidden sm:block">{fmtTax(depRecapture)} × 25%</div>
                <div className="text-red-400 font-semibold">{fmtTax(depRecaptureTax)}</div>
              </div>
            </div>
            <div className="h-px bg-white/5" />
            <div className="flex items-center justify-between text-xs">
              <div className="flex-1 min-w-0">
                <span className="text-gray-300">Long-Term Capital Gains</span>
                <span className="text-[9px] text-gray-600 ml-2 hidden sm:inline">IRC §1(h) · 20% top rate</span>
              </div>
              <div className="text-right tabular-nums shrink-0">
                <div className="text-gray-400 hidden sm:block">{fmtTax(ltcgAmount)} × 20%</div>
                <div className="text-red-400 font-semibold">{fmtTax(ltcgTax)}</div>
              </div>
            </div>
            <div className="h-px bg-white/5" />
            <div className="flex items-center justify-between text-xs">
              <div className="flex-1 min-w-0">
                <span className="text-gray-300">Net Investment Income Tax</span>
                <span className="text-[9px] text-gray-600 ml-2 hidden sm:inline">IRC §1411 · 3.8%</span>
              </div>
              <div className="text-right tabular-nums shrink-0">
                <div className="text-gray-400 hidden sm:block">{fmtTax(totalGain)} × 3.8%</div>
                <div className="text-red-400 font-semibold">{fmtTax(niit)}</div>
              </div>
            </div>
            <div className="h-px bg-white/5" />
            <div className="flex items-center justify-between text-xs">
              <div className="flex-1 min-w-0">
                <span className="text-gray-300">Arizona State Tax</span>
                <span className="text-[9px] text-gray-600 ml-2 hidden sm:inline">2.5% flat</span>
              </div>
              <div className="text-right tabular-nums shrink-0">
                <div className="text-gray-400 hidden sm:block">{fmtTax(totalGain)} × 2.5%</div>
                <div className="text-red-400 font-semibold">{fmtTax(stateTax)}</div>
              </div>
            </div>
            <div className="h-px bg-white/10 mt-1" />
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs font-bold text-white">Total Estimated Tax</span>
              <span className="text-sm font-bold text-red-300 tabular-nums">{fmtTax(totalTax)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white">Net Proceeds (pre-debt payoff)</span>
              <span className="text-sm font-bold text-emerald-400 tabular-nums">{fmtTax(netProceeds)}</span>
            </div>
          </div>
        </div>

        {/* How Entity Sale Works */}
        <div className="rounded-lg bg-white/[0.02] border border-white/10 p-4 mb-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">How an Entity Sale Works</div>
          <p className="text-xs text-gray-400 leading-relaxed mb-2">
            {ent.entitySaleDesc} Under IRC §741, gain from selling a partnership/LLC interest is generally treated as capital gain — <em>except</em> for the
            portion attributable to "hot assets" under IRC §751 (depreciation recapture), which is taxed as ordinary income at the unrecaptured §1250 rate (25%).
          </p>
          <p className="text-xs text-gray-400 leading-relaxed">
            For the buyer, an LLC interest purchase of a disregarded entity or partnership is <strong className="text-gray-300">treated as an asset purchase</strong> —
            BWL gets a stepped-up basis in the underlying properties equal to the purchase price (IRC §743(b) if §754 election made, or automatic if the entity becomes disregarded).
          </p>
        </div>

        {/* Key Considerations */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
            <div className="flex items-center gap-2 mb-1">
              <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-[11px] font-bold text-emerald-300">Tax Savings Options</span>
            </div>
            <ul className="text-[10px] text-gray-400 space-y-1 list-disc pl-4">
              <li><strong className="text-gray-300">1031 Exchange:</strong> Defer ALL tax by rolling proceeds into like-kind real estate (must identify in 45 days, close in 180)</li>
              <li><strong className="text-gray-300">Installment Sale (§453):</strong> Spread gain across payment years, reducing marginal rate impact</li>
              <li><strong className="text-gray-300">Opportunity Zones:</strong> Invest gains in QOZ fund for 10-year deferral and potential exclusion</li>
              <li><strong className="text-gray-300">Charitable CRT:</strong> Gift to Charitable Remainder Trust for immediate deduction + lifetime income</li>
            </ul>
          </div>
          <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
            <div className="flex items-center gap-2 mb-1">
              <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-[11px] font-bold text-amber-300">Complications to Watch</span>
            </div>
            <ul className="text-[10px] text-gray-400 space-y-1 list-disc pl-4">
              {ent.complications.map((c, i) => (
                <li key={i}><strong className="text-gray-300">{c.bold}</strong> {c.text}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* Assumptions */}
        <div className="rounded-lg bg-black/20 border border-white/5 p-3">
          <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-2">Assumptions & Sources</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-gray-500 leading-relaxed">
            {ent.assumptions.map((a, i) => (
              <div key={i}>• {a}</div>
            ))}
            <div>• Federal LTCG 20% top bracket for high earners</div>
            <div>• Unrecaptured §1250 gain capped at 25% (IRC §1(h)(6))</div>
            <div>• NIIT 3.8% applies (IRC §1411) for passive investors</div>
            <div>• Arizona state income tax 2.5% flat (2024+)</div>
            <div>• Excludes transaction costs, legal fees, and AMT</div>
          </div>
          <p className="text-[9px] text-amber-400/70 mt-3 italic">
            {ent.disclaimer}
          </p>
        </div>
      </div>
    </div>
  );
}
