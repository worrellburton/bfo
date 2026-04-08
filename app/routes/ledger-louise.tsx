import { useState } from "react";
import { Link } from "react-router";

export function meta() {
  return [{ title: "BFO - Ledger Louise" }];
}

const accent = "#3b82f6";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-white/10 bg-white/[0.02] p-5 ${className}`}>{children}</div>;
}

interface ItemInfo {
  task: string;
  detail: string;
  done: boolean;
  popup?: {
    title: string;
    sections: { heading: string; content: string }[];
    sources?: { label: string; citation: string }[];
  };
}

const steps: {
  number: number;
  title: string;
  subtitle: string;
  why: string;
  items: ItemInfo[];
  outcome: string;
}[] = [
  {
    number: 1,
    title: "Activate",
    subtitle: "Establish as an active business",
    why: "The IRS only allows business expense deductions for entities engaged in a trade or business. We need to document that Ledger Louise actively manages its 4 subsidiaries.",
    items: [
      {
        task: "Draft MSA between Ledger Louise and each subsidiary",
        detail: "Swisshelm Mountain Ventures, Sundown Investments, Ledger Burton, Worrell Burton",
        done: false,
        popup: {
          title: "Management Services Agreement (MSA)",
          sections: [
            {
              heading: "What is an MSA?",
              content: "A written contract between Ledger Louise (the manager) and each subsidiary (the client) defining what management services are provided, how much they cost, and how they're paid. This is the single most important document for proving Ledger Louise is an active business.",
            },
            {
              heading: "Can the management fee be $1?",
              content: "No. The IRS requires related-party transactions to be at \"arm's length\" under IRC §482 — meaning the fee must reflect what an unrelated company would charge for the same services. A $1 fee has no economic substance and would be disallowed in an audit, potentially disqualifying all of Ledger Louise's expense deductions.",
            },
            {
              heading: "Reasonable fee ranges",
              content: "Fixed fee: $500–$2,000 per quarter per subsidiary (for basic oversight, bookkeeping, compliance). Percentage of revenue: 2–5% of subsidiary revenue (standard for holding company management). Cost-plus: Actual costs incurred + 5–10% markup (easiest to defend in audit because it's directly tied to real expenses).",
            },
            {
              heading: "Recommended approach",
              content: "Start with a modest fixed fee — $500/quarter per subsidiary ($2,000/quarter total, $8,000/year). This creates $8,000 of legitimate business income for Ledger Louise and $2,000/year of deductible management expenses for each subsidiary. The fee can be adjusted as the scope of services grows.",
            },
            {
              heading: "Cost to draft the MSAs",
              content: "Attorney-drafted: $1,500–$5,000 for a template MSA, then minor customization per subsidiary. Template/self-drafted: $0–$500 using a standard management services template customized for each sub. A single well-drafted template works for all 4 subsidiaries with only the entity name and specific services changing.",
            },
            {
              heading: "What the MSA should include",
              content: "1) Scope of services (bookkeeping, tax coordination, strategic planning, compliance). 2) Fee amount and payment schedule. 3) Term and renewal. 4) Reporting obligations. 5) Termination provisions. 6) Signatures from authorized members of both entities.",
            },
          ],
          sources: [
            { label: "IRC §482", citation: "Authority for IRS to reallocate income between related entities if transactions aren't at arm's length." },
            { label: "Treasury Reg. 1.482-1(b)(1)", citation: "Defines the arm's length standard: \"The standard to be applied is that of a taxpayer dealing at arm's length with an uncontrolled taxpayer.\"" },
            { label: "Treasury Reg. 1.482-9", citation: "Specific rules for services transactions between related parties, including the Services Cost Method (SCM) and cost-plus pricing." },
            { label: "IRS Audit Technique Guide — Related Party Transactions", citation: "IRS examiners specifically look for below-market pricing, lack of written agreements, and absence of actual services rendered." },
            { label: "IRC §162(a)", citation: "Business expenses must be \"ordinary and necessary\" — management fees must reflect real services actually performed." },
          ],
        },
      },
      {
        task: "Document management activities",
        detail: "Oversight, strategic planning, financial reporting, administrative services",
        done: false,
        popup: {
          title: "Documenting Management Activities",
          sections: [
            {
              heading: "Why this matters",
              content: "The IRS distinguishes between passive holding (not deductible) and active management (deductible). You need a written record of what Ledger Louise actually does for its subsidiaries.",
            },
            {
              heading: "What to document",
              content: "Strategic decisions made for subsidiaries, financial oversight activities, tax coordination across entities, compliance monitoring, communication with subsidiary managers, bank account management, vendor negotiations, and any administrative services provided.",
            },
            {
              heading: "How to document",
              content: "A simple log or journal entry per month is sufficient. Date, activity, time spent, which subsidiary it relates to. Even 2-3 entries per month establishes a pattern of active management.",
            },
          ],
        },
      },
      {
        task: "Hold and record initial Managing Member meeting",
        detail: "Minutes documenting the decision to activate management operations starting 2025",
        done: false,
        popup: {
          title: "Initial Managing Member Meeting",
          sections: [
            {
              heading: "Purpose",
              content: "A formal resolution by the Managing Members to activate Ledger Louise as a management company effective 2025. This creates a clear start date for business operations.",
            },
            {
              heading: "What the minutes should include",
              content: "Date and attendees (Robert Ledger Burton, Claire Burton, Robert W. Burton, Amanda Burton Dawson per the Operating Agreement). Resolution to begin providing management services to subsidiaries. Approval of the MSA template and fee schedule. Designation of who handles day-to-day operations.",
            },
            {
              heading: "Cost",
              content: "$0 — you write and sign the minutes yourself. Keep the original in your records.",
            },
          ],
        },
      },
      {
        task: "Establish a management fee schedule",
        detail: "Even a nominal fee ($500/quarter per sub) proves active operations",
        done: false,
        popup: {
          title: "Management Fee Schedule",
          sections: [
            {
              heading: "Why not $1?",
              content: "IRC §482 requires arm's length pricing. A $1 fee for management services that would cost $500+ from a third party signals a sham transaction. The IRS can impute a reasonable fee and reallocate income accordingly.",
            },
            {
              heading: "Setting the right amount",
              content: "Start modest but real. $500/quarter per subsidiary = $8,000/year total income to Ledger Louise. This is within the normal range for basic management oversight of small LLCs. You can increase it as services expand.",
            },
            {
              heading: "Payment mechanics",
              content: "Ledger Louise invoices each subsidiary quarterly. Subsidiaries pay from their bank accounts to Ledger Louise's bank account. Real money moves. This creates a paper trail that proves the arrangement is genuine.",
            },
          ],
          sources: [
            { label: "IRC §482", citation: "IRS can adjust income between related parties to reflect arm's length pricing." },
            { label: "Gregory v. Helvering, 293 U.S. 465 (1935)", citation: "Landmark case establishing that transactions must have economic substance beyond tax avoidance." },
          ],
        },
      },
      {
        task: "Create scope of services document",
        detail: "Bookkeeping, tax coordination, bank account management, compliance",
        done: false,
        popup: {
          title: "Scope of Services Document",
          sections: [
            {
              heading: "What this is",
              content: "A one-page attachment to each MSA that lists exactly what Ledger Louise does for each subsidiary. This is what an IRS examiner looks at to determine if real services are being provided.",
            },
            {
              heading: "Example services list",
              content: "Financial oversight and bookkeeping coordination. Tax return preparation coordination. Bank account management and cash flow monitoring. Regulatory compliance (state filings, annual lists). Strategic planning and investment oversight. Vendor and contractor management. Insurance coordination.",
            },
          ],
        },
      },
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

function InfoModal({ item, onClose }: { item: ItemInfo; onClose: () => void }) {
  if (!item.popup) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md sm:max-w-2xl max-h-[80vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0a0a0f] p-4 sm:p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-gray-100">{item.popup.title}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{item.task}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Sections */}
        <div className="space-y-4">
          {item.popup.sections.map((section, i) => (
            <div key={i}>
              <h3 className="text-sm font-semibold text-gray-200 mb-1">{section.heading}</h3>
              <p className="text-xs text-gray-400 leading-relaxed">{section.content}</p>
            </div>
          ))}
        </div>

        {/* Sources */}
        {item.popup.sources && item.popup.sources.length > 0 && (
          <div className="mt-6 pt-4 border-t border-white/10">
            <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3">Sources</h3>
            <div className="space-y-2">
              {item.popup.sources.map((source, i) => (
                <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                  <span className="text-[10px] font-bold text-blue-400 shrink-0 mt-0.5">{source.label}</span>
                  <p className="text-[10px] text-gray-500">{source.citation}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LedgerLouise() {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [modalItem, setModalItem] = useState<ItemInfo | null>(null);

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
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
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
                <button
                  onClick={() => setExpandedStep(isExpanded ? null : step.number)}
                  className={`flex flex-col items-center text-center flex-1 group cursor-pointer transition-all duration-200 ${isExpanded ? "scale-[1.02]" : ""}`}
                >
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
                  <p className="text-sm font-bold mt-2" style={{ color }}>{step.title}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5 max-w-[140px]">{step.subtitle}</p>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border bg-white/5 text-gray-500 border-white/10 mt-2">
                    Not Started
                  </span>
                </button>
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

            <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5 mb-4">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Why This Step Matters</p>
              <p className="text-xs text-gray-400 leading-relaxed">{step.why}</p>
            </div>

            <div className="space-y-2 mb-4">
              {step.items.map((item, i) => (
                <button
                  key={i}
                  onClick={() => item.popup ? setModalItem(item) : undefined}
                  className={`w-full flex items-start gap-3 p-3 rounded-lg bg-white/[0.01] border border-white/5 text-left transition-colors ${
                    item.popup ? "hover:bg-white/[0.04] hover:border-white/15 cursor-pointer" : "cursor-default"
                  }`}
                >
                  <div className="w-5 h-5 rounded border border-white/20 flex items-center justify-center shrink-0 mt-0.5">
                    {item.done && (
                      <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-200">{item.task}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">{item.detail}</p>
                  </div>
                  {item.popup && (
                    <svg className="w-4 h-4 text-gray-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                    </svg>
                  )}
                </button>
              ))}
            </div>

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

      {/* Info Modal */}
      {modalItem && <InfoModal item={modalItem} onClose={() => setModalItem(null)} />}
    </div>
  );
}
