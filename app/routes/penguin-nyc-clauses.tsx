import { useState } from "react";
import { Link } from "react-router";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Penguin NYC Clause Analysis" }];
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

// --- Sub-page Navigation ---

const navTabs = [
  { label: "Overview", href: "/tools/penguin-nyc", active: false },
  { label: "Advisory", href: "/tools/penguin-nyc/advisory", active: false },
  { label: "Clause Analysis", href: "/tools/penguin-nyc/clauses", active: true },
];

// --- Clause Data ---

type Rating = "favorable" | "neutral" | "caution" | "critical";

interface Clause {
  id: string;
  section: string;
  title: string;
  rating: Rating;
  source: "subscription" | "side-letter" | "risk-factors";
  excerpt: string;
  analysis: string;
  bfoImpact: string;
}

const ratingConfig: Record<Rating, { label: string; bg: string; text: string; border: string; dot: string }> = {
  favorable: { label: "Favorable", bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20", dot: "bg-emerald-400" },
  neutral: { label: "Neutral", bg: "bg-gray-500/10", text: "text-gray-400", border: "border-gray-500/20", dot: "bg-gray-400" },
  caution: { label: "Caution", bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20", dot: "bg-amber-400" },
  critical: { label: "Critical", bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/20", dot: "bg-red-400" },
};

const clauses: Clause[] = [
  {
    id: "1a",
    section: "§1(a)",
    title: "Irrevocable Subscription",
    rating: "critical",
    source: "subscription",
    excerpt: `"Subject to the terms and conditions of this Subscription Agreement, Subscriber, intending to be legally bound, hereby irrevocably subscribes for and agrees to purchase 8 Class B Units... This subscription, when signed by Subscriber, is irrevocable."`,
    analysis: "The subscription becomes immediately irrevocable upon signing. There is no cooling-off period, no rescission right, and no condition that allows the investor to back out. Combined with the restricted securities nature of the investment, this locks in the full $200,000 commitment with no way to reverse.",
    bfoImpact: "Once Robert Burton signs, there is zero ability to change course. BFO must be 100% certain before executing. Every open question should be answered BEFORE signing.",
  },
  {
    id: "1c",
    section: "§1(c)",
    title: "Immediate Use of Funds",
    rating: "caution",
    source: "subscription",
    excerpt: `"The Company shall be permitted to use and/or spend all or part of the Purchase Price immediately upon the satisfaction of each of the following conditions: (i) Company's receipt of the Purchase Price... and (ii) the execution of this Subscription Agreement."`,
    analysis: "There is no escrow, no milestone-based funding, and no restriction on how funds are deployed. The Manager can spend the entire $200K the moment the check clears and the agreement is signed. No use-of-proceeds schedule is attached.",
    bfoImpact: "BFO has no control or visibility over how the $200K is spent. Should request a use-of-proceeds schedule before signing.",
  },
  {
    id: "2",
    section: "§2",
    title: "Irrevocable Power of Attorney",
    rating: "critical",
    source: "subscription",
    excerpt: `"By executing this Subscription Agreement, the Subscriber is hereby granting to the Manager a special power of attorney... is irrevocable, and shall survive the death, disability or legal incapacity of the Subscriber."`,
    analysis: "The Manager receives a special power of attorney coupled with an interest that is irrevocable and survives death/disability. This allows the Manager to execute legal documents on behalf of the Subscriber without further consent. While standard in LLC operating agreements, the irrevocable and survival-after-death nature is significant.",
    bfoImpact: "Robert Burton grants permanent authority to People's Hospitality to act on his behalf regarding the Operating Agreement. This power cannot be revoked even after death. Estate planning implications should be reviewed with counsel.",
  },
  {
    id: "3c",
    section: "§3(c)",
    title: "Securities Not Registered — Restricted",
    rating: "critical",
    source: "subscription",
    excerpt: `"The issuance of the Securities will not be registered under the Securities Act of 1933... are 'restricted securities'... no public market for the resale of any of the Securities currently exists, and no such market may ever exist."`,
    analysis: "The Class B Units are unregistered restricted securities under SEC Rule 144. They cannot be resold without registration or an exemption. The Company has no obligation to register them. This is a permanent liquidity trap with no guaranteed exit mechanism.",
    bfoImpact: "The $200K should be treated as a permanent, illiquid allocation. There is no realistic path to selling these units on any timeline.",
  },
  {
    id: "3n",
    section: "§3(n)",
    title: "Passive Investment — No Operational Control",
    rating: "caution",
    source: "subscription",
    excerpt: `"Subscriber acknowledges and agrees that... Subscriber will have no right or power to participate in the day-to-day management or control of the Company, and will not have an opportunity to evaluate the specific management decisions made by the Company."`,
    analysis: "Class B members are explicitly excluded from operational decisions. The Subscriber will not even have the opportunity to evaluate management decisions as they're being made. Total dependence on the Manager's competence and integrity.",
    bfoImpact: "BFO is trusting 100% of operational execution to People's Hospitality. Due diligence on the operator is therefore the single most important pre-signing activity.",
  },
  {
    id: "3t",
    section: "§3(t)",
    title: "Liquor License — Personal Disclosure Requirements",
    rating: "caution",
    source: "subscription",
    excerpt: `"Subscriber acknowledges... the Company... shall apply for one or more liquor licenses... Subscriber agrees that its name may appear on a public database as co-licensee... Subscriber agrees that it shall promptly following the Company's request, provide certain information... including bank statements, passport photo, fingerprinting and/or background check."`,
    analysis: "As a member, Burton may be listed as a co-licensee on the NY State Liquor Authority database. This requires providing personal information including bank statements, passport photos, and submitting to fingerprinting and background checks. The NYSLA can also investigate members at any time.",
    bfoImpact: "Robert Burton's name will be publicly associated with a liquor license. He must provide personal financial documents and biometric data. This creates ongoing compliance obligations and public exposure.",
  },
  {
    id: "3w",
    section: "§3(w)",
    title: "Accredited Investor Representation",
    rating: "neutral",
    source: "subscription",
    excerpt: `"Subscriber further warrants that Subscriber: (i) has a net worth (excluding home equity, home furnishings, and automobiles), or joint net worth with Subscriber's spouse, of at least $1,000,000; or (ii) has had income in excess of $200,000..."`,
    analysis: "Standard accredited investor verification. Sundown Investments LLC and Robert Burton must qualify as accredited. This is a factual representation — no concern if it's accurate, but it's a warranty that survives closing.",
    bfoImpact: "Ensure Sundown Investments LLC qualifies. This representation survives closing and could be used against Burton if it proves false.",
  },
  {
    id: "5",
    section: "§5",
    title: "Mutual Indemnification",
    rating: "favorable",
    source: "subscription",
    excerpt: `"Subscriber agrees to indemnify and hold harmless the Company... Company agrees to indemnify and hold harmless Subscriber and its respective employees, agents, advisors... from and against all losses, liabilities, claims, damages."`,
    analysis: "Indemnification runs both ways — the Company indemnifies the Subscriber and vice versa. This is better than one-way indemnification (which is common). However, the Company's indemnification only covers false representations, not general losses from business operations.",
    bfoImpact: "Provides some protection if the Company makes false statements in the agreement. Does NOT protect against business losses or Manager misconduct.",
  },
  {
    id: "6a",
    section: "§6(a)",
    title: "Risk Factor — Recently Organized / No Operating History",
    rating: "critical",
    source: "risk-factors",
    excerpt: `"The Company was recently organized and... has not engaged in any material business transactions since its inception... any investment therein will constitute highly speculative seed capital."`,
    analysis: "The Company itself acknowledges this is seed capital in a pre-revenue entity with zero operating history. The agreement explicitly warns there is no assurance the business plan will work or that the Company will ever be profitable.",
    bfoImpact: "The Company's own documents characterize this as 'highly speculative seed capital.' BFO should size this position accordingly — assume total loss is possible.",
  },
  {
    id: "6d",
    section: "§6(d)",
    title: "Risk Factor — Hospitality Industry Risks",
    rating: "caution",
    source: "risk-factors",
    excerpt: `"Historically, restaurants have represented high risk investments, and the rate of failure for bars and restaurants is considered to be at least as high, or higher, than the failure rate for small businesses generally."`,
    analysis: "The agreement warns about food costs, labor costs, lease costs, consumer preferences, and the high failure rate of restaurants. These costs are not tied to revenue — they're fixed obligations regardless of sales. The Company itself rates this as high-risk.",
    bfoImpact: "Industry base rates work against this investment. BFO should factor in 60-80% probability of failure when sizing the position.",
  },
  {
    id: "6f",
    section: "§6(f)",
    title: "Risk Factor — NYC Competition",
    rating: "caution",
    source: "risk-factors",
    excerpt: `"The competition for bars and restaurants in New York City is especially competitive, as New York City has one of the densest concentrations of bars and restaurants in the United States."`,
    analysis: "NYC is among the most competitive restaurant markets globally. The agreement notes competitors may have been in existence longer and have substantially greater resources. A new concept must differentiate immediately to survive.",
    bfoImpact: "The concept must be exceptionally strong to succeed in this market. BFO should evaluate the specific location, concept differentiation, and target demographic before committing.",
  },
  {
    id: "6m",
    section: "§6(m)",
    title: "Risk Factor — Wage Theft Act Liability",
    rating: "critical",
    source: "risk-factors",
    excerpt: `"New York also takes the position under Wage Theft and Prevention Act... that the ten (10) members of a limited liability company with the largest ownership share in that company may be held jointly and severally liable for any and all debts, wages, or salaries due and owing to the company's employees."`,
    analysis: "This is a direct personal liability risk. If the restaurant fails to pay employees properly (common in the industry), the top 10 members — which likely includes Robert Burton — can be held JOINTLY AND SEVERALLY LIABLE. This means Burton could be sued for the FULL amount owed to ALL employees, not just his proportional share.",
    bfoImpact: "This is the single most dangerous clause for BFO. Personal liability exposure is UNLIMITED and extends to all employee wages, liquidated damages, penalties, interest, and attorneys' fees. Must get indemnification from the Company and verify EPLI insurance.",
  },
  {
    id: "10c",
    section: "§10(c)",
    title: "Irrevocability Survives Death",
    rating: "caution",
    source: "subscription",
    excerpt: `"The subscription hereunder is irrevocable by Subscriber, except as required by applicable law, and that this Subscription Agreement shall survive the death or disability of Subscriber and shall be binding upon and inure to the benefit of the parties and their heirs, executors, administrators, successors."`,
    analysis: "The subscription and all obligations bind the Subscriber's estate, heirs, and successors. If Robert Burton passes away, his estate remains bound by every obligation in this agreement — the investment cannot be returned and the estate inherits all liabilities.",
    bfoImpact: "BFO estate planning must account for this illiquid position. The Burton family inherits both the investment and all associated liabilities, including potential Wage Theft Act exposure.",
  },
  {
    id: "10j",
    section: "§10(j)",
    title: "Mandatory Arbitration — No Jury Trial",
    rating: "caution",
    source: "subscription",
    excerpt: `"The Parties agree to submit all controversies, disputes, claims... to arbitration administered by the American Arbitration Association in New York, New York... The Parties are otherwise waiving their right to seek remedies in court, including the right to a jury trial."`,
    analysis: "All disputes must go through AAA arbitration in New York — no court, no jury. While arbitration can be faster, it can also be expensive (AAA filing fees for $200K+ disputes are significant) and the results are binding with very limited appeal rights.",
    bfoImpact: "If BFO has a dispute with the Manager, the only recourse is AAA arbitration in NYC. This is manageable but worth noting — arbitration tends to favor repeat players (the Manager likely uses AAA more than individual investors).",
  },
  {
    id: "SL1",
    section: "Side Letter §1",
    title: "IPCO Rights — IP Entity Investment",
    rating: "favorable",
    source: "side-letter",
    excerpt: `"Investor shall purchase Class A Units in IPCO with an aggregate purchase price of $50,000, being twenty five percent (25%) of the aggregate investment amount for the Requisite Units."`,
    analysis: "The side letter grants the right to invest $50K in a separate IP-holding entity. This is potentially valuable because it gives partial ownership of the intellectual property that the main agreement assigns entirely to the Manager. However, the IPCO doesn't exist yet, and the conversion to Class B or C units (with different rights) is at the IPCO manager's discretion.",
    bfoImpact: "This is BFO's only path to IP ownership. However, the IPCO has not been created yet, terms are uncertain, and the price-per-unit is set by the manager. Should negotiate clearer IPCO terms before signing.",
  },
  {
    id: "SL2",
    section: "Side Letter §2",
    title: "Additional Investment Option",
    rating: "favorable",
    source: "side-letter",
    excerpt: `"Upon the Company's receipt of an aggregate of $8,000,000 in investments... Investor shall have the option, but not the obligation, to purchase additional Class B Units... with an aggregate purchase price of $200,000 and additional Class A Units with an aggregate purchase price of $50,000 on the same terms."`,
    analysis: "This gives the right (not obligation) to invest another $250K at the same terms once the company reaches $8M in total investment. This is valuable because it lets BFO double down after the concept is de-risked. The 30-day decision window is tight but manageable.",
    bfoImpact: "Good optionality — if the restaurant succeeds and reaches $8M in investment, BFO can invest another $250K at original terms. If it's failing, BFO can decline. Must-have provision for BFO's upside strategy.",
  },
  {
    id: "SL7",
    section: "Side Letter §7",
    title: "Termination of Rights",
    rating: "caution",
    source: "side-letter",
    excerpt: `"The rights described herein shall terminate and be of no further force or effect upon such time as Investor no longer owns the Requisite Units."`,
    analysis: "All side letter rights (IPCO, additional investment option) terminate if the investor sells or transfers the 8 Class B Units. Combined with the Right of First Refusal in the Operating Agreement, this creates a double lock — you can't easily sell, and if you do, you lose your best rights.",
    bfoImpact: "The side letter rights are the most valuable part of this deal. But they're tied to holding all 8 units — partial sales or any transfer kills them. This further cements the illiquidity.",
  },
];

// --- Filter Types ---

type FilterSource = "all" | "subscription" | "side-letter" | "risk-factors";
type FilterRating = "all" | Rating;

// --- Component ---

export default function PenguinNYCClauses() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [filterSource, setFilterSource] = useState<FilterSource>("all");
  const [filterRating, setFilterRating] = useState<FilterRating>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = clauses.filter((c) => {
    if (filterSource !== "all" && c.source !== filterSource) return false;
    if (filterRating !== "all" && c.rating !== filterRating) return false;
    return true;
  });

  const counts = {
    favorable: clauses.filter((c) => c.rating === "favorable").length,
    neutral: clauses.filter((c) => c.rating === "neutral").length,
    caution: clauses.filter((c) => c.rating === "caution").length,
    critical: clauses.filter((c) => c.rating === "critical").length,
  };

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-6">
        <Link to="/tools" className={`${isDark ? "hover:text-white" : "hover:text-gray-900"} transition-colors`}>Tools</Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <Link to="/tools/penguin-nyc" className={`${isDark ? "hover:text-white" : "hover:text-gray-900"} transition-colors`}>Penguin NYC</Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className={isDark ? "text-gray-300" : "text-gray-700"}>Clause Analysis</span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold mb-1">Contract Clause Analysis</h1>
          <p className="text-gray-500 text-sm">Section-by-section review of the subscription agreement, side letter, and risk factors</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500">{clauses.length} clauses analyzed</div>
        </div>
      </div>

      {/* Sub-page Nav */}
      <div className={`flex gap-1 mb-6 border-b ${isDark ? "border-white/10" : "border-gray-200"} pb-px overflow-x-auto`}>
        {navTabs.map((tab) => (
          <Link
            key={tab.href}
            to={tab.href}
            className={`px-4 py-2.5 text-xs font-medium rounded-t-lg transition-all duration-200 ${
              tab.active
                ? `text-cyan-400 ${isDark ? "bg-white/5" : "bg-black/5"} border-b-2 border-cyan-400`
                : `text-gray-500 ${isDark ? "hover:text-gray-300" : "hover:text-gray-700"} hover:bg-white/[0.02]`
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {(["favorable", "neutral", "caution", "critical"] as const).map((r) => {
          const cfg = ratingConfig[r];
          return (
            <button
              key={r}
              onClick={() => setFilterRating(filterRating === r ? "all" : r)}
              className={`rounded-xl border p-4 text-center transition-all ${
                filterRating === r ? `${cfg.border} ${cfg.bg}` : `${isDark ? "border-white/10" : "border-gray-200"} bg-white/[0.02] hover:bg-white/[0.04]`
              }`}
            >
              <div className={`text-2xl font-black tabular-nums ${filterRating === r ? cfg.text : "text-gray-200"}`}>
                {counts[r]}
              </div>
              <div className={`text-[10px] uppercase tracking-wider font-semibold ${filterRating === r ? cfg.text : "text-gray-500"}`}>
                {cfg.label}
              </div>
            </button>
          );
        })}
      </div>

      {/* Source Filter */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">Source:</span>
        {([
          { value: "all" as const, label: "All Documents" },
          { value: "subscription" as const, label: "Subscription Agreement" },
          { value: "side-letter" as const, label: "Side Letter" },
          { value: "risk-factors" as const, label: "Risk Factors" },
        ]).map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilterSource(opt.value)}
            className={`px-3 py-1 rounded-lg text-xs transition-all ${
              filterSource === opt.value
                ? "bg-cyan-500/10 text-cyan-400"
                : `text-gray-500 ${isDark ? "hover:text-gray-300" : "hover:text-gray-700"} hover:bg-white/[0.02]`
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Clause Cards */}
      <div className="space-y-3">
        {filtered.map((clause) => {
          const cfg = ratingConfig[clause.rating];
          const isExpanded = expandedId === clause.id;
          return (
            <div key={clause.id} className={`rounded-xl border ${cfg.border} bg-white/[0.02] overflow-hidden`}>
              <button
                onClick={() => setExpandedId(isExpanded ? null : clause.id)}
                className="w-full text-left p-5 flex items-center gap-4"
              >
                {/* Rating Dot */}
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${cfg.dot}`} />

                {/* Section & Title */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-mono text-gray-500">{clause.section}</span>
                    <span className={`text-sm font-semibold ${cfg.text}`}>{clause.title}</span>
                  </div>
                </div>

                {/* Badges */}
                <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
                  <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${cfg.bg} ${cfg.text}`}>
                    {cfg.label}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider ${isDark ? "bg-white/5" : "bg-black/5"} text-gray-500`}>
                    {clause.source === "side-letter" ? "Side Letter" : clause.source === "risk-factors" ? "Risk Factor" : "Subscription"}
                  </span>
                </div>

                {/* Chevron */}
                <svg
                  className={`w-4 h-4 text-gray-500 transition-transform flex-shrink-0 ${isExpanded ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isExpanded && (
                <div className="px-5 pb-5 space-y-4 border-t border-white/5 pt-4">
                  {/* Contract Excerpt */}
                  <div>
                    <div className="text-[9px] text-gray-500 uppercase tracking-wider font-semibold mb-2">Contract Language</div>
                    <div className="rounded-lg bg-white/[0.03] border border-white/5 p-4">
                      <p className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"} italic leading-relaxed`}>{clause.excerpt}</p>
                    </div>
                  </div>

                  {/* Analysis */}
                  <div>
                    <div className="text-[9px] text-gray-500 uppercase tracking-wider font-semibold mb-2">Analysis</div>
                    <p className={`text-xs ${isDark ? "text-gray-300" : "text-gray-700"} leading-relaxed`}>{clause.analysis}</p>
                  </div>

                  {/* BFO Impact */}
                  <div className={`rounded-lg ${cfg.bg} border ${cfg.border} p-4`}>
                    <div className={`text-[9px] ${cfg.text} uppercase tracking-wider font-semibold mb-1`}>BFO Impact</div>
                    <p className={`text-xs ${isDark ? "text-gray-300" : "text-gray-700"} leading-relaxed`}>{clause.bfoImpact}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom Note */}
      <div className={`mt-8 rounded-xl border ${isDark ? "border-white/10" : "border-gray-200"} bg-white/[0.02] p-4`}>
        <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-1">Note</div>
        <div className="text-[10px] text-gray-600 leading-relaxed">
          This clause analysis covers the Subscription Agreement and Side Letter only. The Operating Agreement (Exhibit A) contains
          additional terms governing distributions, management authority, IP ownership, and transfer restrictions that are referenced throughout
          but require separate detailed review. BFO should request a full Operating Agreement review from qualified legal counsel.
        </div>
      </div>
    </div>
  );
}
