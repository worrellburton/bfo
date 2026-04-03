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
    subtitle: "Establish Ledger Louise as an active business",
    status: "not-started" as const,
    why: "Ledger Louise is currently a passive holding entity. The IRS only allows business expense deductions for entities engaged in a trade or business. We need to document that Ledger Louise actively manages its 4 subsidiaries.",
    items: [
      { task: "Draft a Management Services Agreement (MSA) between Ledger Louise and each subsidiary", detail: "Swisshelm Mountain Ventures, Sundown Investments, Ledger Burton, Worrell Burton", done: false },
      { task: "Document Ledger Louise's management activities", detail: "Oversight of subsidiaries, strategic planning, financial reporting, administrative services", done: false },
      { task: "Hold and record initial Managing Member meeting", detail: "Meeting minutes documenting the decision to activate management operations starting 2025", done: false },
      { task: "Establish a management fee schedule", detail: "Even a nominal fee ($100-500/quarter per sub) creates legitimate business income and proves active operations", done: false },
      { task: "Create a simple scope of services document", detail: "List what Ledger Louise actually does: bookkeeping, tax coordination, bank account management, compliance", done: false },
    ],
    outcome: "Ledger Louise has written proof it actively manages its subsidiaries — qualifying its expenses as business deductions.",
  },
  {
    number: 2,
    title: "Bookkeep",
    subtitle: "Clean books and categorize all expenses",
    status: "not-started" as const,
    why: "The IRS requires substantiation for every business deduction. QuickBooks is already connected — now we need to properly categorize every transaction so they map to deductible expense categories on the Trust's Form 1041 Schedule C.",
    items: [
      { task: "Set up Chart of Accounts in QuickBooks", detail: "Categories: Management fees income, Professional services, Office & admin, Software & subscriptions, Bank fees, Legal & compliance", done: false },
      { task: "Reconcile bank account from formation (Sept 2023) through current", detail: "Every transaction classified — even if 2023-2024 aren't being filed, clean records support 2025", done: false },
      { task: "Categorize all 2025 expenses by deduction type", detail: "Ordinary and necessary business expenses per IRC §162", done: false },
      { task: "Track management fee invoices sent to subsidiaries", detail: "Income side — must match the MSAs from Step 1", done: false },
      { task: "Set up monthly bookkeeping routine", detail: "Reconcile bank, categorize new transactions, file receipts for anything over $75", done: false },
    ],
    outcome: "Every dollar in and out of Ledger Louise is categorized and ready for the CPA to report on the Trust's tax return.",
  },
  {
    number: 3,
    title: "Substantiate",
    subtitle: "Build the paper trail that survives an audit",
    status: "not-started" as const,
    why: "Deductions without documentation get disallowed. The IRS can challenge any expense — especially for a disregarded entity owned by a trust. A solid paper trail makes every deduction defensible.",
    items: [
      { task: "File signed MSAs with each subsidiary", detail: "Keep originals — these prove the business purpose of Ledger Louise", done: false },
      { task: "Maintain quarterly meeting minutes", detail: "Document decisions made, subsidiaries reviewed, actions taken — even brief notes count", done: false },
      { task: "Keep receipts and invoices for all expenses", detail: "Digital copies in a folder organized by month — QuickBooks receipt capture works", done: false },
      { task: "Document business purpose for each expense category", detail: "Why does Ledger Louise need this? One sentence per category is enough", done: false },
      { task: "Maintain a simple activity log", detail: "Monthly summary of what Ledger Louise did: emails sent, decisions made, accounts reviewed", done: false },
      { task: "File Nevada Annual List on time", detail: "Due by last day of the month of formation anniversary (September) — $150 fee", done: false },
    ],
    outcome: "If the IRS asks 'prove it,' you hand them a binder and they move on.",
  },
  {
    number: 4,
    title: "File",
    subtitle: "CPA reports Ledger Louise activity on Trust's Form 1041",
    status: "not-started" as const,
    why: "As a disregarded entity, Ledger Louise doesn't file its own tax return. Instead, all income and expenses are reported on the Burton Family Revocable Trust's Form 1041, Schedule C. A CPA handles this — your job is to hand them clean books.",
    items: [
      { task: "Find a CPA experienced with trusts and disregarded entities", detail: "They need to understand Form 1041 Schedule C reporting for a disregarded LLC", done: false },
      { task: "Provide CPA with QuickBooks access or year-end P&L report", detail: "They need income (management fees) and expenses (all categorized from Step 2)", done: false },
      { task: "CPA prepares Trust's Form 1041 with Ledger Louise activity", detail: "Business income and expenses on Schedule C, net income/loss flows to Trust", done: false },
      { task: "Review return before filing — confirm all expenses are included", detail: "Cross-check QuickBooks P&L against what the CPA reported", done: false },
      { task: "File Form 1041 by April 15, 2026 (for tax year 2025)", detail: "Or file Form 7004 for automatic 5.5-month extension (September 30, 2026)", done: false },
    ],
    outcome: "Ledger Louise's business expenses reduce the Trust's taxable income. Done.",
  },
];

export default function LedgerLouise() {
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
      <Card className="mb-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-blue-500/15 shrink-0">
            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-sm text-blue-400 mb-1">How This Works</h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              Ledger Louise is a <strong className="text-gray-300">disregarded entity</strong> — a single-member LLC owned by the Burton Family Revocable Trust.
              It stays that way. No elections, no entity changes. The goal is to make Ledger Louise an <strong className="text-gray-300">active business</strong> so
              its expenses qualify as deductible business expenses on the Trust's Form 1041. Four steps, start to finish.
            </p>
          </div>
        </div>
      </Card>

      {/* Steps */}
      <div className="space-y-6">
        {steps.map((step, stepIndex) => (
          <Card key={step.number}>
            {/* Step Header */}
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${accent}15` }}>
                <span className="text-xl font-bold" style={{ color: accent }}>{step.number}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-lg font-bold">{step.title}</h2>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border bg-white/5 text-gray-400 border-white/10">
                    Not Started
                  </span>
                </div>
                <p className="text-sm text-gray-400">{step.subtitle}</p>
              </div>
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
            <div className="flex items-start gap-2 p-3 rounded-lg" style={{ background: `${accent}08`, borderLeft: `3px solid ${accent}` }}>
              <svg className="w-4 h-4 shrink-0 mt-0.5" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs" style={{ color: accent }}><strong>Outcome:</strong> {step.outcome}</p>
            </div>

            {/* Connector line between steps */}
            {stepIndex < steps.length - 1 && (
              <div className="flex justify-center mt-4 -mb-5">
                <div className="w-px h-6 bg-white/10" />
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* Bottom Summary */}
      <Card className="mt-6">
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
