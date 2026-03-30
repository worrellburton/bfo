import { useState } from "react";
import { Link } from "react-router";

export function meta() {
  return [{ title: "BFO - CEO Agreement Review" }];
}

// --- Reusable Components ---

function StatusBadge({ status, label }: { status: "green" | "amber" | "red" | "orange"; label: string }) {
  const colors = {
    green: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    amber: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    red: "bg-red-500/15 text-red-400 border-red-500/30",
    orange: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  };
  const dots = { green: "bg-emerald-400", amber: "bg-amber-400", red: "bg-red-400", orange: "bg-orange-400" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${colors[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dots[status]}`} />
      {label}
    </span>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-lg font-bold tabular-nums" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

// --- Tab Config ---

const tabs = [
  { id: "overview" as const, label: "Overview" },
  { id: "grounds" as const, label: "Termination Grounds" },
  { id: "consequences" as const, label: "Consequences" },
  { id: "warroom" as const, label: "$50M War Room" },
];
type Tab = (typeof tabs)[number]["id"];

// --- Agreement Data ---

const keyTerms = [
  { label: "Executive", value: "Yousef Awwad", sub: "Chief Executive Officer" },
  { label: "Company", value: "VisionQuest National, Ltd", sub: "Arizona LLC" },
  { label: "Reports To", value: "Board of Directors" },
  { label: "Effective Date", value: "Dec 27-28, 2022", sub: "Signed by both parties" },
  { label: "Employment Period", value: "5 Years", sub: "Auto-renews for subsequent 5-year terms" },
  { label: "Salary", value: "$350,000/yr", sub: "Prorated for partial years", color: "#f97316" },
  { label: "Bonus", value: "5% Net Income", sub: "Quarterly, Fiscal Year (Jul 1 - Jun 30)", color: "#f97316" },
  { label: "PTO", value: "5+ Weeks", sub: "+ 5 sick days per year" },
  { label: "Non-Compete", value: "12 Months", sub: "Post-termination" },
  { label: "Geographic Scope", value: "5 States", sub: "AZ, DE, MD, PA, TX" },
  { label: "Governing Law", value: "Arizona", sub: "Pima County courts" },
  { label: "Jury Trial", value: "Waived", sub: "Both parties waived" },
];

const keyDates = [
  { date: "Dec 27-28, 2022", event: "Agreement Executed", desc: "Signed by Yousef Awwad and Chairman of the Board", status: "complete" as const },
  { date: "Jan 1, 2023", event: "Bonus Eligibility Begins", desc: "5% of Fiscal Year Net Income bonus starts", status: "complete" as const },
  { date: "Jul 1 - Jun 30", event: "Fiscal Year Cycle", desc: "Net Income calculated: gross revenue less Expenses", status: "complete" as const },
  { date: "Dec 27, 2027", event: "Initial Term Expires", desc: "5-year employment period ends", status: "pending" as const },
  { date: "Dec 27, 2027+", event: "Auto-Renewal", desc: "Automatically renews for subsequent 5-year terms unless terminated per Section 4", status: "pending" as const },
];

const compensationDetails = [
  {
    title: "Base Salary",
    amount: "$350,000",
    period: "per year",
    details: "Paid in substantially equal periodic installments per standard payroll. Increases determined as part of annual performance evaluation. Prorated for partial years.",
  },
  {
    title: "Quarterly Bonus",
    amount: "5%",
    period: "of Fiscal Year Net Income",
    details: "Calculated by HR, Payroll, or Finance Director. Paid as a single lump sum within 30 days after quarter end. If quarterly Net Income is a loss, subsequent bonus is offset. Must be employed by VQ to earn. If terminated before fiscal year end, receives 5% of net income prorated for months employed.",
  },
  {
    title: "Benefits",
    amount: "Full",
    period: "executive package",
    details: "Medical, life insurance, disability, long-term care, retirement plan, and all other benefits available to executive employees. VQ may modify or terminate plans at any time.",
  },
  {
    title: "Business Expenses",
    amount: "Reimbursed",
    period: "per policy",
    details: "Reasonable expenses directly related to duties, licenses, certifications. Subject to timely submission of documentation per VQ policy.",
  },
];

const restrictiveCovenants = [
  {
    title: "Non-Competition",
    duration: "Employment + 12 months",
    scope: "AZ, DE, MD, PA, TX",
    detail: "Cannot engage in any Competing Business in any capacity (proprietor, partner, officer, director, employee, consultant, agent, advisor, shareholder, etc.) within the Geographic Scope.",
  },
  {
    title: "Non-Solicitation",
    duration: "Employment + 12 months",
    scope: "Clients & Employees",
    detail: "Cannot solicit VQ's customers, clients, or employees. Cannot solicit anyone who had business contact with VQ during last 12 months of employment.",
  },
  {
    title: "Confidentiality",
    duration: "Perpetual",
    scope: "All proprietary information",
    detail: "Cannot disclose any Confidential and Proprietary Information — financial reports, business plans, strategies, databases, client lists, personnel data, trade secrets. Survives termination.",
  },
  {
    title: "Intellectual Property",
    duration: "Perpetual",
    scope: "All work product",
    detail: "All IP conceived during employment is exclusive property of VQ. Executive irrevocably assigns all rights, title, and interest. Includes inventions, writings, programs, discoveries.",
  },
  {
    title: "Non-Disparagement",
    duration: "Mutual / Perpetual",
    scope: "Both parties",
    detail: "Neither party shall defame, disparage, or denigrate the other. VQ's officers/directors also bound. Executive must update LinkedIn to reflect no longer employed upon termination.",
  },
];

const violationConsequences = [
  "VisionQuest can cease making severance payments (Sections 3 and 4(e))",
  "Executive forfeits right to receive any amounts absent a violation",
  "Executive must repay all amounts received during the breach period",
  "Executive retains only $2,000 as consideration for the release",
  "VisionQuest can notify future employers of the restrictive covenants",
  "Restricted Period extended by the duration of any breach activity",
  "VisionQuest entitled to injunctive relief without proving actual damages",
];

// --- Overview Tab ---

function OverviewTab() {
  return (
    <div className="space-y-6">
      {/* Status Badges */}
      <div className="flex flex-wrap gap-2">
        <StatusBadge status="green" label="Active Agreement" />
        <StatusBadge status="orange" label="5-Year Term" />
        <StatusBadge status="amber" label="Auto-Renewing" />
      </div>

      {/* Key Terms Grid */}
      <section>
        <h3 className="text-sm font-semibold text-orange-400 mb-3">Agreement Terms</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {keyTerms.map((t) => (
            <div key={t.label} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">{t.label}</div>
              <div className="text-sm font-bold" style={t.color ? { color: t.color } : undefined}>{t.value}</div>
              {t.sub && <div className="text-[10px] text-gray-500 mt-0.5">{t.sub}</div>}
            </div>
          ))}
        </div>
      </section>

      {/* Entity Map */}
      <section>
        <h3 className="text-sm font-semibold text-orange-400 mb-3">Organizational Structure</h3>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
          <div className="flex flex-col items-center gap-2">
            {/* Board */}
            <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-6 py-3 text-center">
              <div className="text-xs font-bold text-orange-400">Board of Directors</div>
              <div className="text-[10px] text-gray-500">Governing authority — hires/fires CEO</div>
            </div>
            <svg className="w-4 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 16 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 2v16m0 0l-4-4m4 4l4-4" />
            </svg>
            {/* CEO */}
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-6 py-3 text-center">
              <div className="text-xs font-bold text-red-400">CEO — Yousef Awwad</div>
              <div className="text-[10px] text-gray-500">$350K salary + 5% Net Income bonus</div>
            </div>
            <svg className="w-4 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 16 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 2v16m0 0l-4-4m4 4l4-4" />
            </svg>
            {/* VQ Operations */}
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-6 py-3 text-center">
              <div className="text-xs font-bold text-gray-300">VisionQuest Operations</div>
              <div className="text-[10px] text-gray-500">Child, youth & family services — AZ, DE, MD, PA, TX</div>
            </div>
            {/* Corporate Structure pillars */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 w-full max-w-xl">
              {[
                { name: "Operations", desc: "Maintain, grow & optimize" },
                { name: "Finance", desc: "Improve revenues & reporting" },
                { name: "Human Resources", desc: "Culture, retention, hiring" },
                { name: "Compliance", desc: "Local, state & federal" },
              ].map((p) => (
                <div key={p.name} className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-center">
                  <div className="text-[10px] font-semibold text-gray-400">{p.name}</div>
                  <div className="text-[9px] text-gray-600">{p.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Key Dates */}
      <section>
        <h3 className="text-sm font-semibold text-orange-400 mb-3">Key Dates & Deadlines</h3>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <div className="space-y-3">
            {keyDates.map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${item.status === "complete" ? "bg-emerald-400" : "bg-gray-600"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-200">{item.event}</span>
                    <span className="text-[10px] text-gray-500 tabular-nums">{item.date}</span>
                  </div>
                  <div className="text-[10px] text-gray-500">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Compensation Breakdown */}
      <section>
        <h3 className="text-sm font-semibold text-orange-400 mb-3">Compensation Structure</h3>
        <div className="space-y-3">
          {compensationDetails.map((c) => (
            <div key={c.title} className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-black text-orange-400">{c.amount}</span>
                  <span className="text-xs text-gray-500">{c.period}</span>
                </div>
              </div>
              <div className="text-xs font-semibold text-gray-300 mb-1">{c.title}</div>
              <div className="text-xs text-gray-500 leading-relaxed">{c.details}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Restrictive Covenants */}
      <section>
        <h3 className="text-sm font-semibold text-orange-400 mb-3">Restrictive Covenants (Section 5)</h3>
        <div className="space-y-3">
          {restrictiveCovenants.map((r) => (
            <div key={r.title} className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-sm font-semibold text-gray-200">{r.title}</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20 font-semibold">
                  {r.duration}
                </span>
              </div>
              <div className="text-[10px] text-gray-500 mb-1">Scope: {r.scope}</div>
              <div className="text-xs text-gray-400 leading-relaxed">{r.detail}</div>
            </div>
          ))}
        </div>
        {/* Violation Consequences */}
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/[0.03] p-5">
          <div className="text-[10px] text-red-400 font-bold uppercase tracking-wider mb-2">
            <svg className="w-3.5 h-3.5 inline mr-1 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
            </svg>
            If Executive Violates Covenants (Section 5(e))
          </div>
          <ul className="space-y-1.5">
            {violationConsequences.map((v, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-red-500 mt-0.5 text-xs">•</span>
                <span className="text-xs text-gray-400">{v}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Dispute Resolution */}
      <section>
        <h3 className="text-sm font-semibold text-orange-400 mb-3">Dispute Resolution (Section 10)</h3>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Forum</div>
              <div className="text-sm font-medium text-gray-200">Pima County, Arizona</div>
              <div className="text-[10px] text-gray-500">State or federal courts</div>
            </div>
            <div>
              <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Jury Trial</div>
              <div className="text-sm font-medium text-red-400">Waived</div>
              <div className="text-[10px] text-gray-500">Both parties irrevocably waived</div>
            </div>
            <div>
              <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Remedies</div>
              <div className="text-sm font-medium text-gray-200">Injunctive Relief</div>
              <div className="text-[10px] text-gray-500">No bond required, no proof of actual damages</div>
            </div>
          </div>
        </div>
      </section>

      {/* Notice Addresses */}
      <section>
        <h3 className="text-sm font-semibold text-orange-400 mb-3">Notice Addresses (Section 12)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">To Executive</div>
            <div className="text-xs text-gray-300">11921 N. Silver Village Place</div>
            <div className="text-xs text-gray-300">Oro Valley, Arizona 85737</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">To VisionQuest</div>
            <div className="text-xs text-gray-300">PO Box 12906</div>
            <div className="text-xs text-gray-300">Tucson, Arizona 85732</div>
          </div>
        </div>
      </section>
    </div>
  );
}

// --- Placeholder Tabs (Phase 2, 3, 4) ---

function GroundsTab() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
      <svg className="w-12 h-12 mx-auto mb-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
      </svg>
      <div className="text-sm font-semibold text-gray-400 mb-1">Termination Grounds — Phase 2</div>
      <div className="text-xs text-gray-600">All 13 for-cause grounds with severity ratings and $50M applicability analysis</div>
    </div>
  );
}

function ConsequencesTab() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
      <svg className="w-12 h-12 mx-auto mb-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
      </svg>
      <div className="text-sm font-semibold text-gray-400 mb-1">Consequences & Cost Calculator — Phase 3</div>
      <div className="text-xs text-gray-600">For Cause vs Without Cause comparison, severance math, Section 409A</div>
    </div>
  );
}

function WarRoomTab() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
      <svg className="w-12 h-12 mx-auto mb-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
      <div className="text-sm font-semibold text-gray-400 mb-1">$50M Revenue Loss War Room — Phase 4</div>
      <div className="text-xs text-gray-600">Strategic Plan scorecard, Job Description violations, Arizona law, termination playbook</div>
    </div>
  );
}

// --- Main Component ---

export default function CEOAgreement() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-6">
        <Link to="/tools" className="hover:text-white transition-colors">Tools</Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-gray-300">CEO Agreement Review</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-orange-500/15">
            <svg className="w-6 h-6 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold">CEO Agreement Review</h1>
            <p className="text-gray-500 text-sm">Yousef Awwad — VisionQuest National, Ltd Employment Agreement</p>
          </div>
        </div>
        <StatusBadge status="orange" label="Under Review" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-white/10 pb-px overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-xs font-medium rounded-t-lg transition-all duration-200 whitespace-nowrap ${
              activeTab === tab.id
                ? "text-orange-400 bg-white/5 border-b-2 border-orange-400"
                : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.02]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && <OverviewTab />}
      {activeTab === "grounds" && <GroundsTab />}
      {activeTab === "consequences" && <ConsequencesTab />}
      {activeTab === "warroom" && <WarRoomTab />}
    </div>
  );
}
