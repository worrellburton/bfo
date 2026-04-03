import { useState } from "react";
import { Link } from "react-router";

export function meta() {
  return [{ title: "BFO - Ledger Louise" }];
}

const accent = "#3b82f6";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-white/10 bg-white/[0.02] p-5 ${className}`}>{children}</div>;
}

const steps = [
  {
    number: 1,
    title: "Activate",
    subtitle: "Establish as an active business",
    why: "The IRS only allows business expense deductions for entities engaged in a trade or business. We need to document that Ledger Louise actively manages its 4 subsidiaries.",
    items: [
      { task: "Draft MSA between Ledger Louise and each subsidiary", detail: "Swisshelm Mountain Ventures, Sundown Investments, Ledger Burton, Worrell Burton", done: false },
      { task: "Document management activities", detail: "Oversight, strategic planning, financial reporting, administrative services", done: false },
      { task: "Hold and record initial Managing Member meeting", detail: "Minutes documenting the decision to activate management operations starting 2025", done: false },
      { task: "Establish a management fee schedule", detail: "Even a nominal fee ($100-500/quarter per sub) proves active operations", done: false },
      { task: "Create scope of services document", detail: "Bookkeeping, tax coordination, bank account management, compliance", done: false },
    ],
    outcome: "Written proof Ledger Louise actively manages its subsidiaries — qualifying expenses as business deductions.",
  },
  {
    number: 2,
    title: "Bookkeep",
    subtitle: "Clean books and categorize expenses",
    why: "The IRS requires substantiation for every deduction. QuickBooks is connected — now categorize every transaction so they map to deductible expense categories on the Trust's Form 1041 Schedule C.",
    items: [
      { task: "Set up Chart of Accounts in QuickBooks", detail: "Management fees income, Professional services, Office & admin, Software, Bank fees, Legal", done: false },
      { task: "Reconcile bank account from formation through current", detail: "Every transaction classified — clean records support 2025 deductions", done: false },
      { task: "Categorize all 2025 expenses by deduction type", detail: "Ordinary and necessary business expenses per IRC §162", done: false },
      { task: "Track management fee invoices to subsidiaries", detail: "Income side — must match the MSAs from Step 1", done: false },
      { task: "Set up monthly bookkeeping routine", detail: "Reconcile bank, categorize transactions, file receipts over $75", done: false },
    ],
    outcome: "Every dollar categorized and ready for the CPA to report on the Trust's tax return.",
  },
  {
    number: 3,
    title: "Substantiate",
    subtitle: "Paper trail that survives an audit",
    why: "Deductions without documentation get disallowed. The IRS can challenge any expense — especially for a disregarded entity owned by a trust. A solid paper trail makes every deduction defensible.",
    items: [
      { task: "File signed MSAs with each subsidiary", detail: "Keep originals — these prove the business purpose of Ledger Louise", done: false },
      { task: "Maintain quarterly meeting minutes", detail: "Decisions made, subsidiaries reviewed, actions taken — even brief notes count", done: false },
      { task: "Keep receipts and invoices for all expenses", detail: "Digital copies organized by month — QuickBooks receipt capture works", done: false },
      { task: "Document business purpose for each expense category", detail: "One sentence per category is enough", done: false },
      { task: "Maintain a simple activity log", detail: "Monthly summary: emails sent, decisions made, accounts reviewed", done: false },
      { task: "File Nevada Annual List on time", detail: "Due by last day of formation anniversary month (September) — $150", done: false },
    ],
    outcome: "If the IRS asks 'prove it,' you hand them a binder and they move on.",
  },
  {
    number: 4,
    title: "File",
    subtitle: "CPA reports on Trust's Form 1041",
    why: "As a disregarded entity, Ledger Louise doesn't file its own return. All income and expenses are reported on the Trust's Form 1041, Schedule C. A CPA handles this — your job is to hand them clean books.",
    items: [
      { task: "Find a CPA experienced with trusts and disregarded entities", detail: "They need to understand Form 1041 Schedule C reporting", done: false },
      { task: "Provide CPA with QuickBooks access or year-end P&L", detail: "Income (management fees) and expenses (categorized from Step 2)", done: false },
      { task: "CPA prepares Trust's Form 1041 with Ledger Louise activity", detail: "Business income and expenses on Schedule C, net flows to Trust", done: false },
      { task: "Review return before filing — confirm all expenses included", detail: "Cross-check QuickBooks P&L against what the CPA reported", done: false },
      { task: "File Form 1041 by April 15, 2026", detail: "Or Form 7004 for automatic 5.5-month extension (Sept 30, 2026)", done: false },
    ],
    outcome: "Ledger Louise's business expenses reduce the Trust's taxable income. Done.",
  },
];

const stepColors = ["#ef4444", "#f97316", "#3b82f6", "#22c55e"];

export default function LedgerLouise() {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-6">
        <Link to="/tools" className="hover:text-white transition-colors">Tools</Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-gray-300">Ledger Louise</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${accent}15` }}>
            <svg className="w-6 h-6" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3H21m-3.75 3H21" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold">Ledger Louise, LLC</h1>
            <p className="text-gray-500 text-sm">Roadmap — Activate & Deduct Business Expenses</p>
          </div>
        </div>
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border bg-yellow-500/15 text-yellow-400 border-yellow-500/30">
          2025 Tax Year
        </span>
      </div>

      {/* Context Banner */}
      <Card className="mb-8">
        <p className="text-xs text-gray-400 leading-relaxed">
          Ledger Louise is a <strong className="text-gray-300">disregarded entity</strong> owned by the Burton Family Revocable Trust.
          It stays that way — no elections, no entity changes. Make it an <strong className="text-gray-300">active business</strong> so
          expenses are deductible on the Trust's Form 1041.
        </p>
      </Card>

      {/* Horizontal Roadmap */}
      <div className="overflow-x-auto pb-4 mb-6">
        <div className="flex items-start gap-0 min-w-[700px]">
          {steps.map((step, i) => {
            const color = stepColors[i];
            const isExpanded = expandedStep === step.number;
            return (
              <div key={step.number} className="flex items-start flex-1">
                {/* Step Node */}
                <button
                  onClick={() => setExpandedStep(isExpanded ? null : step.number)}
                  className={`flex flex-col items-center text-center flex-1 group cursor-pointer transition-all duration-200 ${isExpanded ? "scale-[1.02]" : ""}`}
                >
                  {/* Circle */}
                  <div
                    className={`w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold border-2 transition-all duration-200 ${
                      isExpanded ? "shadow-lg shadow-black/30 scale-110" : "group-hover:scale-105"
                    }`}
                    style={{
                      borderColor: color,
                      background: isExpanded ? `${color}25` : `${color}10`,
                      color: color,
                    }}
                  >
                    {step.number}
                  </div>

                  {/* Title */}
                  <p className="text-sm font-bold mt-2" style={{ color }}>{step.title}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5 max-w-[140px]">{step.subtitle}</p>

                  {/* Status */}
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border bg-white/5 text-gray-500 border-white/10 mt-2">
                    Not Started
                  </span>
                </button>

                {/* Arrow connector */}
                {i < steps.length - 1 && (
                  <div className="flex items-center pt-6 px-1 shrink-0">
                    <div className="w-8 h-px bg-white/15" />
                    <svg className="w-3 h-3 text-white/20 -ml-1" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Expanded Step Detail */}
      {expandedStep !== null && (() => {
        const step = steps.find((s) => s.number === expandedStep)!;
        const color = stepColors[expandedStep - 1];
        return (
          <Card className="mb-6">
            {/* Step Header */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${color}15` }}>
                  <span className="text-lg font-bold" style={{ color }}>{step.number}</span>
                </div>
                <div>
                  <h2 className="text-lg font-bold" style={{ color }}>{step.title}</h2>
                  <p className="text-xs text-gray-500">{step.subtitle}</p>
                </div>
              </div>
              <button onClick={() => setExpandedStep(null)} className="text-gray-500 hover:text-gray-300 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Why */}
            <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5 mb-4">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Why This Step Matters</p>
              <p className="text-xs text-gray-400 leading-relaxed">{step.why}</p>
            </div>

            {/* Checklist */}
            <div className="space-y-2 mb-4">
              {step.items.map((item, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.01] border border-white/5">
                  <div className="w-5 h-5 rounded border border-white/20 flex items-center justify-center shrink-0 mt-0.5">
                    {item.done && (
                      <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-200">{item.task}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Outcome */}
            <div className="flex items-start gap-2 p-3 rounded-lg" style={{ background: `${color}08`, borderLeft: `3px solid ${color}` }}>
              <svg className="w-4 h-4 shrink-0 mt-0.5" style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs" style={{ color }}><strong>Outcome:</strong> {step.outcome}</p>
            </div>
          </Card>
        );
      })()}

      {/* End State */}
      <Card>
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-green-500/15 shrink-0">
            <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-sm text-green-400 mb-1">End State</h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              Ledger Louise stays a disregarded LLC owned by the Trust. It actively manages 4 subsidiaries.
              All business expenses are deducted on the Trust's Form 1041 Schedule C, reducing the Trust's taxable income.
              No entity changes. No elections. No new tax returns. Just clean books and a paper trail.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
