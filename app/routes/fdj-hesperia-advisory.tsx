import { Link } from "react-router";

export function meta() {
  return [{ title: "BFO - FDJ Hesperia Deal Advisory" }];
}

// --- Reusable Components ---

function StatusBadge({ status, label }: { status: "green" | "amber" | "red"; label: string }) {
  const colors = {
    green: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    amber: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    red: "bg-red-500/15 text-red-400 border-red-500/30",
  };
  const dots = {
    green: "bg-emerald-400",
    amber: "bg-amber-400",
    red: "bg-red-400",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${colors[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dots[status]}`} />
      {label}
    </span>
  );
}

function PriorityBadge({ level }: { level: "HIGH" | "MEDIUM" | "LOW" }) {
  const styles = {
    HIGH: "bg-red-500/15 text-red-400 border-red-500/30",
    MEDIUM: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    LOW: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${styles[level]}`}>
      {level}
    </span>
  );
}

function GradeBadge({ grade, color }: { grade: string; color: string }) {
  return (
    <span
      className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-sm font-black border"
      style={{
        backgroundColor: `${color}15`,
        color: color,
        borderColor: `${color}40`,
      }}
    >
      {grade}
    </span>
  );
}

// --- Tab Navigation ---

const tabs = [
  { label: "Overview", href: "/tools/fdj-hesperia" },
  { label: "Financials", href: "/tools/fdj-hesperia/financials" },
  { label: "Documents", href: "/tools/fdj-hesperia/documents" },
  { label: "Advisory", href: "/tools/fdj-hesperia/advisory" },
];

// --- Concern Card ---

function ConcernCard({
  title,
  severity,
  children,
}: {
  title: string;
  severity: "red" | "amber";
  children: React.ReactNode;
}) {
  const borderColor = severity === "red" ? "border-red-500/30" : "border-amber-500/30";
  const accentBg = severity === "red" ? "bg-red-500/5" : "bg-amber-500/5";
  return (
    <div className={`rounded-xl border ${borderColor} ${accentBg} p-5`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <h4 className="text-sm font-bold text-gray-100">{title}</h4>
        <StatusBadge status={severity} label={severity === "red" ? "Critical" : "Warning"} />
      </div>
      <div className="space-y-2 text-xs text-gray-400 leading-relaxed">{children}</div>
    </div>
  );
}

// --- Checklist Item ---

function ChecklistItem({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5 w-4 h-4 rounded border border-white/20 bg-white/[0.03] flex-shrink-0" />
      <span className="text-xs text-gray-300 leading-relaxed">{text}</span>
    </div>
  );
}

// --- Scorecard Row ---

function ScorecardRow({
  label,
  grade,
  color,
  note,
}: {
  label: string;
  grade: string;
  color: string;
  note: string;
}) {
  return (
    <div className="flex items-center gap-4 py-3 border-b border-white/5 last:border-0">
      <GradeBadge grade={grade} color={color} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-200">{label}</div>
        <div className="text-[11px] text-gray-500 mt-0.5">{note}</div>
      </div>
    </div>
  );
}

// --- Main Component ---

export default function FDJHesperiaAdvisory() {
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
        <span className="text-gray-300">Advisory</span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Deal Advisory</h1>
          <p className="text-gray-500 text-sm">Analysis & Recommendations for the Burton Family</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status="amber" label="Action Needed" />
          <div className="text-[10px] text-gray-500">
            As of <span className="text-gray-300 font-medium">March 2026</span>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-white/10 mb-8">
        {tabs.map((tab) => (
          <Link
            key={tab.label}
            to={tab.href}
            className={`px-4 py-2 text-sm font-medium transition-colors relative ${
              tab.label === "Advisory"
                ? "text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab.label}
            {tab.label === "Advisory" && (
              <div className="absolute bottom-0 left-0 right-0 h-px bg-emerald-500" />
            )}
          </Link>
        ))}
      </div>

      {/* ========== 1. OVERALL DEAL ASSESSMENT ========== */}
      <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/[0.04] p-6 mb-8">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Overall Assessment</div>
            <h2 className="text-lg font-bold text-gray-100">
              This deal has been financially favorable, but requires immediate attention
            </h2>
          </div>
          <div className="flex-shrink-0">
            <GradeBadge grade="B+" color="#818cf8" />
          </div>
        </div>
        <div className="space-y-2 text-sm text-gray-400 leading-relaxed">
          <p>
            The 1031 exchange alone justified this transaction - you saved approximately $3.2M in taxes
            on a net cash investment of just $2.6M. Cash flow has been consistent and reasonable at
            $33,333 per month. However, several critical deadlines have now passed or are fast approaching,
            and the current status of key deal components is unclear.
          </p>
          <p className="text-gray-500 text-xs">
            Grade: <span className="text-indigo-400 font-semibold">B+</span> - Good deal structurally,
            but execution risks are emerging that need prompt attention.
          </p>
        </div>
      </div>

      {/* ========== 2. WHAT'S WORKING WELL ========== */}
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-6 mb-8">
        <h3 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider mb-4">
          What's Working Well
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          {[
            "1031 exchange saved ~$3.2M in taxes - more than the entire net cash invested",
            "Consistent monthly cash flow of $33,333/mo since 2017",
            "Total cash received ($1,577,042) represents 60.7% of net investment already returned",
            "El Dorado appreciated 38% ($5.475M to $7.58M) based on 2020 valuation",
            "Triple net leases mean zero operating responsibility for the Burton family",
            "30% Marriott TownePlace ownership providing additional income stream",
            "BWL/Dix bearing all property management costs and operating risks",
            "Low effective loan-to-value ratio across the portfolio",
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2.5 py-1">
              <svg className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-xs text-gray-300 leading-relaxed">{item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ========== 3. CRITICAL CONCERNS ========== */}
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
        Critical Concerns
      </h3>
      <div className="space-y-4 mb-8">
        <ConcernCard title="El Dorado Debt Maturity - OVERDUE" severity="red">
          <p>
            The $2,500,000 loan at 4.86% matured in <span className="text-red-400 font-semibold">November 2025</span>.
            As of March 2026, this debt is past due. It is unclear whether it has been refinanced, extended, or what
            the current status is.
          </p>
          <div className="mt-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
            <span className="text-red-400 font-semibold text-[11px]">ACTION NEEDED:</span>
            <span className="text-red-300 text-[11px] ml-1">Confirm the current status of this loan immediately.</span>
          </div>
        </ConcernCard>

        <ConcernCard title="EDA Sale Status - UNCLEAR" severity="red">
          <p>
            BWL agreed to purchase El Dorado Apartments for $5,475,000 via the July 2021 PSA. An amendment
            pushed the closing deadline to February 2022. It is now March 2026 - did this sale close?
            If not, why not?
          </p>
          <div className="mt-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
            <span className="text-red-400 font-semibold text-[11px]">ACTION NEEDED:</span>
            <span className="text-red-300 text-[11px] ml-1">Determine if the sale closed and obtain closing documents.</span>
          </div>
        </ConcernCard>

        <ConcernCard title="Comfort Suites Debt Maturity - APPROACHING" severity="amber">
          <p>
            The $3,350,000 loan at 5.50% is due <span className="text-amber-400 font-semibold">May 2027</span> -
            just over one year away. A refinancing plan or payoff strategy is needed. The current interest rate
            environment may result in higher rates on any refinancing.
          </p>
        </ConcernCard>

        <ConcernCard title="Master Lease Expiration - APPROACHING" severity="amber">
          <p>
            Both master leases with BWL Investments expire <span className="text-amber-400 font-semibold">April 30, 2027</span>.
            What happens after expiration? Are renewal terms being discussed? Will a new operator be needed?
            The Burton family's entire income stream from these properties depends on these leases.
          </p>
        </ConcernCard>

        <ConcernCard title="Promissory Notes Status - UNKNOWN" severity="amber">
          <p>
            BWL owes the Burton family $4.4M in promissory notes at 3% interest. What is the current
            outstanding balance? Have regular payments been made? These appear to be unsecured obligations -
            what collateral, if any, secures these notes?
          </p>
        </ConcernCard>

        <ConcernCard title="Comfort Suites Value Decline" severity="amber">
          <p>
            The Comfort Suites was purchased for $7,273,000 but was valued at only $6,572,145 in 2020 -
            a decline of 9.6%, likely driven by COVID's impact on the hospitality sector. Has the value
            recovered since 2020? A current appraisal is needed to understand the family's true equity position.
          </p>
        </ConcernCard>

        <ConcernCard title="Concentration Risk" severity="amber">
          <p>
            The entire deal structure depends on a single counterparty: BWL Investments / Randal Dix.
            If BWL were to default on its lease obligations, the Burton family would need to step in
            and directly manage two commercial properties. There is no diversification of operator risk.
          </p>
        </ConcernCard>
      </div>

      {/* ========== 4. MISSING INFORMATION CHECKLIST ========== */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 mb-8">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-1">
          Missing Information Checklist
        </h3>
        <p className="text-[11px] text-gray-500 mb-4">
          Items the Burton family should obtain or confirm as soon as possible.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
          <div className="divide-y divide-white/5">
            <ChecklistItem text="Current El Dorado loan status (refinanced? extended? paid off?)" />
            <ChecklistItem text="EDA PSA closing confirmation (did the $5,475,000 sale close?)" />
            <ChecklistItem text="Current Comfort Suites appraisal / valuation" />
            <ChecklistItem text="Current El Dorado appraisal / valuation" />
            <ChecklistItem text="Promissory note payment history and current balances" />
            <ChecklistItem text="BWL Investments financial statements" />
            <ChecklistItem text="Property insurance certificates (current)" />
          </div>
          <div className="divide-y divide-white/5">
            <ChecklistItem text="Property tax payment confirmations" />
            <ChecklistItem text="Rent rolls for both properties" />
            <ChecklistItem text="Capital expenditure history since 2017" />
            <ChecklistItem text="Master lease renewal / extension discussions" />
            <ChecklistItem text="Comfort Suites brand / franchise agreement status" />
            <ChecklistItem text="Environmental reports (Phase I updates)" />
            <ChecklistItem text="Title insurance policy updates" />
          </div>
        </div>
      </div>

      {/* ========== 5. RECOMMENDATIONS ========== */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 mb-8">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Recommendations
        </h3>
        <div className="space-y-4">
          {[
            { num: 1, priority: "HIGH" as const, text: "Immediately verify El Dorado loan status - this debt matured in November 2025 and its current state is unknown." },
            { num: 2, priority: "HIGH" as const, text: "Confirm whether the EDA sale (PSA dated July 2021) has closed. If not, determine why and whether to exercise the put option." },
            { num: 3, priority: "HIGH" as const, text: "Request BWL Investments financial statements and promissory note payment history to assess counterparty health." },
            { num: 4, priority: "MEDIUM" as const, text: "Obtain current property appraisals for both El Dorado and Comfort Suites to establish true portfolio value." },
            { num: 5, priority: "MEDIUM" as const, text: "Begin master lease renewal discussions - the April 2027 expiration is roughly 13 months away." },
            { num: 6, priority: "MEDIUM" as const, text: "Evaluate Comfort Suites debt refinancing options well ahead of the May 2027 maturity." },
            { num: 7, priority: "LOW" as const, text: "Consider commissioning an independent property inspection for both assets." },
            { num: 8, priority: "LOW" as const, text: "Review Marriott TownePlace Suites investment performance and distribution history." },
          ].map((item) => (
            <div key={item.num} className="flex items-start gap-4">
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-white/5 flex items-center justify-center text-xs font-bold text-gray-400 tabular-nums">
                {item.num}
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-center gap-2 mb-1">
                  <PriorityBadge level={item.priority} />
                </div>
                <p className="text-xs text-gray-300 leading-relaxed">{item.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ========== 6. DEAL SCORECARD ========== */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 mb-8">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Deal Scorecard
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
          <div>
            <ScorecardRow grade="A+" color="#10b981" label="Tax Efficiency" note="1031 exchange saved ~$3.2M" />
            <ScorecardRow grade="A" color="#10b981" label="Cash Flow" note="Consistent $33K/mo since 2017" />
            <ScorecardRow grade="B+" color="#818cf8" label="Asset Appreciation" note="El Dorado up 38%, CFS down 10%" />
            <ScorecardRow grade="C" color="#f59e0b" label="Counterparty Risk" note="Single operator dependency (BWL/Dix)" />
          </div>
          <div>
            <ScorecardRow grade="B-" color="#818cf8" label="Documentation" note="Gaps in recent status updates" />
            <ScorecardRow grade="C" color="#f59e0b" label="Debt Management" note="El Dorado maturity overdue" />
            <ScorecardRow grade="C+" color="#f59e0b" label="Transparency" note="Limited ongoing reporting from operator" />
            <div className="mt-4 pt-4 border-t border-white/10 flex items-center gap-4">
              <GradeBadge grade="B" color="#818cf8" />
              <div>
                <div className="text-sm font-bold text-gray-100">Overall Grade</div>
                <div className="text-[11px] text-gray-500">Good structure, emerging execution risks</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ========== 7. BOTTOM LINE ========== */}
      <div className="rounded-xl border-2 border-emerald-500/30 bg-emerald-500/[0.03] p-6 mb-8">
        <div className="flex items-start gap-3 mb-3">
          <svg className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="text-base font-bold text-emerald-300">Bottom Line for the Burton Family</h3>
        </div>
        <div className="space-y-3 text-sm text-gray-300 leading-relaxed">
          <p>
            The FDJ Hesperia investment was well-structured and has performed reasonably well. The 1031
            exchange alone made it worthwhile - you saved more in taxes (<span className="text-emerald-400 font-semibold">$3.2M</span>)
            than you have at risk (<span className="text-white font-semibold">$2.6M</span>). You've received{" "}
            <span className="text-emerald-400 font-semibold">$1.58M</span> in cash flow, your El Dorado
            property appreciated significantly, and you have a 30% stake in a Marriott property.
          </p>
          <p>
            However, several time-sensitive items need your attention <span className="text-amber-400 font-semibold">now</span> -
            particularly the El Dorado loan maturity and the status of the pending sale. We recommend
            scheduling a meeting with Mr. Dix to review all outstanding items and ensure the family's
            interests are fully protected going forward.
          </p>
        </div>
      </div>
    </div>
  );
}
