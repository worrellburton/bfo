import { Link } from "react-router";

export function meta() {
  return [{ title: "BFO - Penguin NYC Deal Advisory" }];
}

// --- Reusable Components ---

function StatusBadge({ status, label }: { status: "green" | "amber" | "red" | "cyan"; label: string }) {
  const colors = {
    green: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    amber: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    red: "bg-red-500/15 text-red-400 border-red-500/30",
    cyan: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  };
  const dots = { green: "bg-emerald-400", amber: "bg-amber-400", red: "bg-red-400", cyan: "bg-cyan-400" };
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
      style={{ backgroundColor: `${color}15`, color, borderColor: `${color}40` }}
    >
      {grade}
    </span>
  );
}

// --- Tab Navigation ---

const tabs = [
  { label: "Overview", href: "/tools/penguin-nyc", active: false },
  { label: "Advisory", href: "/tools/penguin-nyc/advisory", active: true },
];

// --- Risk Score Data ---

const riskCategories: {
  category: string;
  score: number;
  maxScore: number;
  grade: string;
  gradeColor: string;
  factors: string[];
}[] = [
  {
    category: "Contract Structure",
    score: 4,
    maxScore: 10,
    grade: "D+",
    gradeColor: "#ef4444",
    factors: [
      "Waterfall flips from 70/30 → 30/70 at only 1x return — no preferred return hurdle",
      "Irrevocable subscription with no exit mechanism",
      "Manager has full exclusive authority — zero Class B operational control",
      "Irrevocable Power of Attorney survives death/disability",
    ],
  },
  {
    category: "IP & Asset Protection",
    score: 2,
    maxScore: 10,
    grade: "F",
    gradeColor: "#ef4444",
    factors: [
      "Manager exclusively owns ALL intellectual property",
      "Manager can use Company-funded IP in outside ventures with zero obligation",
      "Company only gets a royalty-free license — IP leaves if Manager leaves",
      "Brand, recipes, systems built with investor capital belong to Manager",
    ],
  },
  {
    category: "Financial Transparency",
    score: 3,
    maxScore: 10,
    grade: "D",
    gradeColor: "#ef4444",
    factors: [
      "Management Fee amount not specified — 'consistent with similarly-situated businesses'",
      "Guaranteed payments to Manager/Class A amounts not defined",
      "No mandatory reporting cadence — financial info only 'upon request'",
      "No business plan or financial projections provided with subscription docs",
    ],
  },
  {
    category: "Liquidity & Exit",
    score: 2,
    maxScore: 10,
    grade: "F",
    gradeColor: "#ef4444",
    factors: [
      "Restricted securities with no public market",
      "No buyback provision or put option",
      "Right of First Refusal limits secondary sales",
      "Must be prepared to hold indefinitely",
    ],
  },
  {
    category: "Investor Protections",
    score: 6,
    maxScore: 10,
    grade: "B-",
    gradeColor: "#22c55e",
    factors: [
      "Preemptive rights on new issuances (anti-dilution)",
      "Class B approval required for transactions over $500K",
      "Tag-along rights on 50%+ unit sales",
      "Tax distributions at highest NYC rate required",
    ],
  },
  {
    category: "Market & Operator Risk",
    score: 5,
    maxScore: 10,
    grade: "C",
    gradeColor: "#f59e0b",
    factors: [
      "NYC restaurant failure rate ~60% in Year 1, ~80% in 5 years",
      "No published track record from People's Hospitality Inc.",
      "Concept not yet operational — pre-revenue investment",
      "Potential Wage Theft Act personal liability for top 10 members",
    ],
  },
];

const overallScore = riskCategories.reduce((sum, c) => sum + c.score, 0);
const overallMax = riskCategories.reduce((sum, c) => sum + c.maxScore, 0);
const overallPct = Math.round((overallScore / overallMax) * 100);

// --- Negotiation Playbook ---

const negotiationItems: {
  priority: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  currentTerm: string;
  proposedTerm: string;
  rationale: string;
}[] = [
  {
    priority: "HIGH",
    title: "Increase Waterfall Flip Threshold",
    currentTerm: "Distribution flip at 1x capital return",
    proposedTerm: "Flip at 1.5x–2x capital return, OR add 8–10% preferred return hurdle before flip",
    rationale:
      "The current 1x threshold means investors start losing the favorable split the moment they get their money back. A higher threshold ensures investors earn a real return before the Manager takes the lion's share.",
  },
  {
    priority: "HIGH",
    title: "IP Ownership — Company Retains What It Funds",
    currentTerm: "Manager exclusively owns ALL intellectual property, can use in outside ventures",
    proposedTerm: "IP created using Company funds is owned by the Company. Manager retains only independently-developed IP.",
    rationale:
      "Investor capital is building the brand, systems, and recipes. It's fundamentally unfair for those assets to be exclusively owned by the Manager and usable in competing ventures.",
  },
  {
    priority: "HIGH",
    title: "Define Management Fee & Guaranteed Payments",
    currentTerm: "Management Fee 'consistent with similarly-situated businesses'; guaranteed payments unspecified",
    proposedTerm: "Management Fee capped at X% of revenue (e.g., 3–5%). Guaranteed payments explicitly defined with amounts and conditions.",
    rationale:
      "Undefined fees give the Manager unchecked ability to extract value. Investors need clarity on the total cost of management before distributions are calculated.",
  },
  {
    priority: "HIGH",
    title: "Mandatory Quarterly Financial Reporting",
    currentTerm: "Financial information available 'upon request'",
    proposedTerm: "Quarterly P&L, balance sheet, and cash flow statements delivered within 45 days of quarter end. Annual CPA-reviewed financials.",
    rationale:
      "Passive investors with no operational control need regular financial transparency to monitor their investment. 'Upon request' creates unnecessary friction.",
  },
  {
    priority: "HIGH",
    title: "Wage Theft Act Indemnification",
    currentTerm: "Top 10 members may face personal liability under NY Wage Theft Prevention Act",
    proposedTerm: "Company indemnifies Class B members for any Wage Theft Act claims. Company maintains employment practices liability insurance covering all members.",
    rationale:
      "Passive investors who have zero control over hiring, wages, or labor practices should not bear personal liability for the Manager's employment decisions.",
  },
  {
    priority: "MEDIUM",
    title: "Add Key Person Clause",
    currentTerm: "No key person provision",
    proposedTerm: "If Emmet McDermott ceases to be actively involved in management, Class B members can vote to dissolve or appoint a replacement Manager.",
    rationale:
      "The investment thesis depends heavily on the specific operator. If that person leaves, investors need a mechanism to protect their capital.",
  },
  {
    priority: "MEDIUM",
    title: "Post-Flip Profit Improvement",
    currentTerm: "30% Class B / 70% Class A after capital return",
    proposedTerm: "40% Class B / 60% Class A after capital return, or tiered (40/60 up to 3x, then 30/70)",
    rationale:
      "Even after the flip, Class B should retain a larger share of profits. A tiered system rewards the Manager for exceptional performance while being fairer to investors at moderate success levels.",
  },
  {
    priority: "MEDIUM",
    title: "Cap on Total Capital Raise / Dilution Protection",
    currentTerm: "Preemptive rights exist, but total raise amount is open-ended",
    proposedTerm: "Cap total authorized units or require Class B supermajority approval for raises above $X. Ensure anti-dilution applies to valuation (not just unit count).",
    rationale:
      "While preemptive rights help, they only protect investors who can afford to participate in every round. A cap prevents excessive dilution for those who can't.",
  },
  {
    priority: "LOW",
    title: "Revocability Window",
    currentTerm: "Subscription is irrevocable immediately upon signing",
    proposedTerm: "10-day cooling-off period after signing during which subscription can be revoked without penalty",
    rationale:
      "Standard consumer protection concept. Allows time to identify any issues discovered after signing before capital is fully committed.",
  },
  {
    priority: "LOW",
    title: "Drag-Along Threshold Increase",
    currentTerm: "Drag-along rights may be triggered at lower thresholds",
    proposedTerm: "Drag-along requires 75%+ of total units (not just a majority) and a minimum valuation floor to protect against fire sales",
    rationale:
      "Prevents a scenario where a slim majority forces all investors into an unfavorable exit. Higher threshold and valuation floor protect minority Class B interests.",
  },
];

// --- Recommendation ---

const recommendation = {
  verdict: "PROCEED WITH CAUTION" as const,
  verdictColor: "#f59e0b",
  summary:
    "The Penguin NYC deal offers genuine upside potential with a ground-floor entry into a NYC restaurant/bar concept and a favorable initial distribution split. However, the contract heavily favors the Manager in key areas — IP ownership, undefined fees, post-return profit split, and lack of liquidity. BFO should NOT sign as-is.",
  nextSteps: [
    "Send the due diligence email (Phase 1 Email Draft tab) to Emmet McDermott immediately",
    "Negotiate the TOP 5 HIGH-priority items below — these are non-negotiable for BFO",
    "Request a business plan with financial projections before committing capital",
    "Have BFO's attorney review the Operating Agreement with specific focus on IP ownership and Wage Theft Act liability",
    "If People's Hospitality refuses to negotiate on IP ownership and fee transparency, seriously consider walking away",
  ],
};

// --- Component ---

export default function PenguinNYCAdvisory() {
  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-6">
        <Link to="/tools" className="hover:text-white transition-colors">Tools</Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <Link to="/tools/penguin-nyc" className="hover:text-white transition-colors">Penguin NYC</Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-gray-300">Advisory</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Deal Advisory & Risk Analysis</h1>
          <p className="text-gray-500 text-sm">Risk scoring, negotiation playbook, and BFO recommendation</p>
        </div>
        <StatusBadge status="amber" label="Proceed w/ Caution" />
      </div>

      {/* Sub-Nav Tabs */}
      <div className="flex gap-1 mb-6 border-b border-white/10 pb-px">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            to={tab.href}
            className={`px-4 py-2.5 text-xs font-medium rounded-t-lg transition-all duration-200 ${
              tab.active
                ? "text-cyan-400 bg-white/5 border-b-2 border-cyan-400"
                : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.02]"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* BFO Recommendation */}
      <section className="mb-8">
        <div className="rounded-xl border-2 p-6" style={{ borderColor: `${recommendation.verdictColor}40`, backgroundColor: `${recommendation.verdictColor}05` }}>
          <div className="flex items-center gap-3 mb-4">
            <GradeBadge grade="C-" color={recommendation.verdictColor} />
            <div>
              <div className="text-sm font-black uppercase tracking-wider" style={{ color: recommendation.verdictColor }}>
                {recommendation.verdict}
              </div>
              <div className="text-[10px] text-gray-500">Overall Deal Score: {overallScore}/{overallMax} ({overallPct}%)</div>
            </div>
          </div>
          <p className="text-sm text-gray-300 leading-relaxed mb-4">{recommendation.summary}</p>
          <div className="space-y-2">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Recommended Next Steps</div>
            {recommendation.nextSteps.map((step, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="w-5 h-5 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-gray-400">{i + 1}</span>
                </div>
                <span className="text-xs text-gray-400">{step}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Risk Score Dashboard */}
      <section className="mb-8">
        <h2 className="text-lg font-bold mb-4">Risk Score Dashboard</h2>

        {/* Overall Score Bar */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">Overall Deal Health</span>
            <span className="text-xs font-bold tabular-nums" style={{ color: recommendation.verdictColor }}>
              {overallScore}/{overallMax}
            </span>
          </div>
          <div className="h-3 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${overallPct}%`, backgroundColor: recommendation.verdictColor }}
            />
          </div>
        </div>

        {/* Category Cards */}
        <div className="space-y-3">
          {riskCategories.map((cat) => {
            const pct = Math.round((cat.score / cat.maxScore) * 100);
            return (
              <div key={cat.category} className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
                <div className="flex items-center gap-3 mb-3">
                  <GradeBadge grade={cat.grade} color={cat.gradeColor} />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-200">{cat.category}</span>
                      <span className="text-xs font-bold tabular-nums" style={{ color: cat.gradeColor }}>
                        {cat.score}/{cat.maxScore}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, backgroundColor: cat.gradeColor }}
                      />
                    </div>
                  </div>
                </div>
                <ul className="space-y-1.5 ml-[52px]">
                  {cat.factors.map((f, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-gray-600 mt-0.5">•</span>
                      <span className="text-xs text-gray-400">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* Negotiation Playbook */}
      <section className="mb-8">
        <h2 className="text-lg font-bold mb-2">Negotiation Playbook</h2>
        <p className="text-xs text-gray-500 mb-4">
          10 specific counter-terms BFO should push for before signing. Items are ordered by priority.
        </p>
        <div className="space-y-3">
          {negotiationItems.map((item, i) => (
            <div key={i} className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-gray-400">{i + 1}</span>
                </div>
                <div className="flex-1 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-200">{item.title}</span>
                  <PriorityBadge level={item.priority} />
                </div>
              </div>
              <div className="ml-9 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-lg bg-red-500/[0.03] border border-red-500/10 p-3">
                    <div className="text-[9px] text-red-400 uppercase tracking-wider font-semibold mb-1">Current Term</div>
                    <div className="text-xs text-gray-400">{item.currentTerm}</div>
                  </div>
                  <div className="rounded-lg bg-emerald-500/[0.03] border border-emerald-500/10 p-3">
                    <div className="text-[9px] text-emerald-400 uppercase tracking-wider font-semibold mb-1">Proposed Counter</div>
                    <div className="text-xs text-gray-400">{item.proposedTerm}</div>
                  </div>
                </div>
                <div className="text-xs text-gray-500 italic">{item.rationale}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom Disclaimer */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-1">Disclaimer</div>
        <div className="text-[10px] text-gray-600 leading-relaxed">
          This advisory analysis is for informational purposes only and does not constitute legal, financial, or investment advice.
          BFO should consult with qualified legal counsel and financial advisors before making any investment decisions.
          Risk scores are subjective assessments based on the contract terms as written.
        </div>
      </div>
    </div>
  );
}
