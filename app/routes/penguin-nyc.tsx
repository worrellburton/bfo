import { useState } from "react";
import { Link } from "react-router";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Penguin NYC Contract Review" }];
}

// --- Reusable Components ---

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  return (
    <div className={`rounded-xl border ${isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-gray-50"} p-4`}>
      <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-lg font-bold tabular-nums" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status, label }: { status: "green" | "amber" | "red" | "cyan"; label: string }) {
  const colors = {
    green: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    amber: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    red: "bg-red-500/15 text-red-400 border-red-500/30",
    cyan: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  };
  const dots = {
    green: "bg-emerald-400",
    amber: "bg-amber-400",
    red: "bg-red-400",
    cyan: "bg-cyan-400",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${colors[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dots[status]}`} />
      {label}
    </span>
  );
}

// --- Tab Types ---

type Tab = "overview" | "strengths" | "weaknesses" | "email";

const tabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "strengths", label: "Strengths" },
  { id: "weaknesses", label: "Weaknesses" },
  { id: "email", label: "Email Draft" },
];

// --- Distribution Waterfall ---

function WaterfallBar({ label, classA, classB, phase }: { label: string; classA: number; classB: number; phase: string }) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}>{phase}</span>
        <span className="text-[10px] text-gray-500">{label}</span>
      </div>
      <div className={`flex h-8 rounded-lg overflow-hidden border ${isDark ? "border-white/10" : "border-gray-200"}`}>
        <div
          className="flex items-center justify-center text-[10px] font-bold text-white"
          style={{ width: `${classA}%`, background: "rgba(239, 68, 68, 0.4)" }}
        >
          Class A: {classA}%
        </div>
        <div
          className="flex items-center justify-center text-[10px] font-bold text-white"
          style={{ width: `${classB}%`, background: "rgba(6, 182, 212, 0.4)" }}
        >
          Class B: {classB}%
        </div>
      </div>
    </div>
  );
}

// --- Entity Map ---

function EntityMap() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  return (
    <div className="flex flex-col items-center gap-3">
      {/* Investor */}
      <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-5 py-3 text-center">
        <div className="text-xs font-bold text-cyan-400">Sundown Investments LLC</div>
        <div className={`text-[10px] ${isDark ? "text-gray-400" : "text-gray-500"}`}>Robert Burton, Principal</div>
        <div className="text-[10px] text-gray-500">Subscriber / Class B Investor</div>
      </div>
      {/* Arrow */}
      <div className="flex flex-col items-center">
        <svg className="w-4 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 16 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 2v18m0 0l-4-4m4 4l4-4" />
        </svg>
        <span className="text-[9px] text-gray-500">8 Class B Units @ $25K = $200K</span>
      </div>
      {/* Company */}
      <div className="rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-center">
        <div className="text-xs font-bold text-white">Penguin Flagship NYC LLC</div>
        <div className="text-[10px] text-gray-400">NYC Restaurant/Bar Venture</div>
        <div className="text-[10px] text-gray-500">Formed Nov 17, 2025 in New York</div>
      </div>
      {/* Arrow */}
      <div className="flex flex-col items-center">
        <svg className="w-4 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 16 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 2v18m0 0l-4-4m4 4l4-4" />
        </svg>
        <span className="text-[9px] text-gray-500">Managed by</span>
      </div>
      {/* Manager */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-3 text-center">
        <div className="text-xs font-bold text-amber-400">People&apos;s Hospitality Inc.</div>
        <div className="text-[10px] text-gray-400">CEO: Emmet McDermott</div>
        <div className="text-[10px] text-gray-500">Manager / Class A Holder</div>
      </div>
    </div>
  );
}

// --- Strengths Data ---

const strengths = [
  {
    title: "Favorable initial distribution split (70/30 to Class B)",
    detail: "Until Class B investors receive their full capital back, distributions are split 70% to Class B and 30% to Class A. This accelerates the return of invested capital.",
  },
  {
    title: "Preemptive rights protect against dilution",
    detail: "Class B members have preemptive rights on any new equity issuances, preventing the Manager from diluting existing investors without offering them the chance to participate.",
  },
  {
    title: "Class B approval rights on major decisions",
    detail: "Purchases or borrowings exceeding $500K, deemed liquidation events, issuance of senior units, and dissolution/bankruptcy all require Class B approval.",
  },
  {
    title: "Tag-along rights if 50%+ units sold",
    detail: "If 50% or more of the outstanding units are being sold, Class B investors have the right to participate in the sale on the same terms, protecting against being left behind in a deal.",
  },
  {
    title: "IPCO Rights for IP entity ownership",
    detail: "Side letter grants the right to purchase Class A Units in a new IP entity for $50,000 (25% of the $200K subscription), providing access to the intellectual property upside.",
  },
  {
    title: "Additional Investment Option at same terms",
    detail: "Once the company raises $8M total, the investor has the option to purchase an additional $200K in Class B Units plus $50K in IPCO units at the same original terms.",
  },
  {
    title: "Tax distributions required at highest NYC rate",
    detail: "Company is required to make tax distributions calculated at the highest individual NYC tax rate, ensuring investors aren\u2019t out-of-pocket for tax obligations on phantom income.",
  },
  {
    title: "Mutual indemnification",
    detail: "The indemnification runs both ways \u2014 the Company also indemnifies the Subscriber, not just the other way around. This provides some protection against company-side misrepresentations.",
  },
  {
    title: "No obligation for additional capital contributions",
    detail: "Class B members cannot be forced to put in more money beyond the initial subscription amount. The $200K investment is the maximum capital at risk.",
  },
  {
    title: "Right of First Refusal protects existing investors",
    detail: "Any transfer of units is subject to a Right of First Refusal, preventing unwanted third parties from entering the investment and protecting existing investor interests.",
  },
];

// --- Weaknesses Data ---

const weaknesses: { severity: "red" | "amber"; title: string; detail: string }[] = [
  {
    severity: "red",
    title: "Distribution waterfall FLIPS to 70/30 in favor of Class A after capital return",
    detail: "Once Class B investors receive their initial capital back (1x return), the distribution split reverses to 70% Class A / 30% Class B. This is a massive long-term disadvantage \u2014 the majority of profits go to management.",
  },
  {
    severity: "red",
    title: "Manager owns ALL intellectual property exclusively",
    detail: "The Manager (People\u2019s Hospitality Inc.) exclusively owns all intellectual property. The Company only receives a royalty-free license. If the IP becomes highly valuable, the Company (and its investors) have no ownership claim.",
  },
  {
    severity: "red",
    title: "Manager can use IP in \u201cOutside Ventures\u201d with zero obligation",
    detail: "The Manager can take any intellectual property created with Company resources and use it in completely separate ventures with zero obligation to share profits or returns with Class B investors.",
  },
  {
    severity: "red",
    title: "Subscription is IRREVOCABLE once signed",
    detail: "Once the subscription agreement is executed, it cannot be revoked, canceled, terminated, or rescinded. The investor is locked in regardless of any changed circumstances.",
  },
  {
    severity: "red",
    title: "No public market, no liquidity \u2014 must hold indefinitely",
    detail: "These are restricted securities with no public market, and no public market may ever exist. The investor must be prepared to hold these units indefinitely with no ability to exit.",
  },
  {
    severity: "amber",
    title: "Management Fee amount is NOT specified",
    detail: "The operating agreement allows a Management Fee but the amount is not specified \u2014 only that it must be \u201cconsistent with similarly-situated businesses.\u201d This is vague and gives the Manager significant discretion.",
  },
  {
    severity: "amber",
    title: "Guaranteed payments to Manager/Class A \u2014 amounts not specified",
    detail: "The Manager and Class A holders receive guaranteed payments, but the specific amounts are not defined in the agreement. These are determined by the Manager, creating a potential conflict of interest.",
  },
  {
    severity: "amber",
    title: "Manager has FULL exclusive authority \u2014 Class B is completely passive",
    detail: "The Manager has full and exclusive authority over all business decisions. Class B investors have no management rights whatsoever and are entirely dependent on the Manager\u2019s judgment.",
  },
  {
    severity: "amber",
    title: "Power of Attorney is irrevocable and survives death/disability",
    detail: "The subscriber grants an irrevocable power of attorney to the Manager that cannot be revoked and survives the subscriber\u2019s death, incapacity, or disability.",
  },
  {
    severity: "amber",
    title: "NY Wage Theft liability for top 10 members",
    detail: "Under New York\u2019s Wage Theft Prevention Act, the top 10 members of an LLC may be held jointly and severally liable for the company\u2019s wage and salary obligations to employees.",
  },
];

// --- Email Content ---

const emailContent = `To: Emmet McDermott, People's Hospitality Inc.
Subject: Penguin Flagship NYC LLC \u2014 Due Diligence Questions re: Subscription Agreement

Dear Emmet,

Thank you for the opportunity to participate in the Penguin Flagship NYC LLC venture. Before we finalize our subscription for 8 Class B Units ($200,000), we have several questions we'd like addressed. We believe clarity on these points will help us move forward efficiently.

FINANCIAL TERMS & STRUCTURE:

1. Management Fee: The Operating Agreement references a Management Fee "consistent with similarly-situated businesses" but does not specify an amount or percentage. Can you provide the specific Management Fee amount or calculation methodology?

2. Guaranteed Payments: What are the specific amounts or formulas for the guaranteed payments to the Manager and Class A holders referenced in the Operating Agreement?

3. Capitalization Table: Can you provide the current cap table showing how many Class A and Class B units are outstanding, and the total number of units authorized?

4. Distribution Flip Timeline: What are your projected timelines for when Class B investors will receive their full capital return (triggering the 70/30 flip to Class A favor)? We would like to understand the expected investment horizon.

5. Business Plan & Projections: Can we receive a copy of the business plan and detailed financial projections for the venture?

OPERATIONAL QUESTIONS:

6. Lease Terms: What are the current lease terms for the Premises (duration, rent, escalations, renewal options)?

7. Fundraise Status: What is the total fundraise target, and how much capital has been raised to date?

8. Use of Proceeds: What is the planned use of proceeds from our $200,000 investment specifically?

9. Insurance: What insurance coverage does the company currently carry or plan to carry?

NEGOTIATION POINTS:

10. Distribution Waterfall: Can we negotiate a longer period before the distribution flip? Specifically, we would like to discuss a 1.5x or 2x capital return threshold (rather than 1x) before the split reverses to 70/30 in favor of Class A. Alternatively, can we add a minimum preferred return (e.g., 8-10% IRR) before the flip?

11. Financial Reporting: Can we get quarterly financial reporting explicitly committed to in the subscription agreement, rather than the current "upon request" standard?

12. IP Ownership: The current structure gives the Manager exclusive ownership of all IP, even IP created with Company funds. Can this be modified so that IP created using Company resources is owned by the Company, with the Manager retaining rights only to IP developed independently?

13. Minimum Preferred Return: Can we add a preferred return hurdle (e.g., 8% annually) that must be achieved before the distribution waterfall shifts?

We appreciate your time addressing these questions. We remain very interested in the opportunity and look forward to your responses so we can proceed with the subscription.

Best regards,
Robert Burton
Sundown Investments LLC`;

// --- Overview Tab ---

function OverviewTab() {
  return (
    <div className="space-y-6">
      {/* Contract Status */}
      <div className="flex flex-wrap gap-2">
        <StatusBadge status="red" label="Not Yet Signed" />
        <StatusBadge status="amber" label="Under Review" />
        <StatusBadge status="cyan" label="Due Diligence" />
      </div>

      {/* Deal Summary */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <h3 className="text-sm font-semibold text-cyan-400 mb-4">Deal Summary</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Total Investment" value="$200,000" color="#06b6d4" />
          <StatCard label="Unit Type" value="Class B" sub="Investor class" />
          <StatCard label="Units" value="8" sub="@ $25,000 each" />
          <StatCard label="Company" value="Penguin NYC" sub="Restaurant/Bar" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
          <StatCard label="Subscriber" value="Sundown Inv." sub="Robert Burton" />
          <StatCard label="Manager" value="People's Hosp." sub="Emmet McDermott, CEO" />
          <StatCard label="Op. Agreement" value="Mar 10, 2026" sub="Effective date" />
          <StatCard label="Formation" value="Nov 17, 2025" sub="New York" />
        </div>
      </div>

      {/* Side Letter Rights */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <h3 className="text-sm font-semibold text-cyan-400 mb-4">Side Letter Rights</h3>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-cyan-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-3 h-3 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-200">IPCO Rights</div>
              <div className="text-xs text-gray-500">Right to purchase Class A Units in a new IP entity (&ldquo;IPCO&rdquo;) for $50,000 (25% of the $200K subscription)</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-cyan-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-3 h-3 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-200">Additional Investment Option</div>
              <div className="text-xs text-gray-500">Once company raises $8M total, option to buy additional $200K Class B + $50K IPCO units at same terms</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-3 h-3 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-200">30-Day Decision Window</div>
              <div className="text-xs text-gray-500">Must accept or reject additional investment option within 30 days of notification from Manager</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-3 h-3 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-200">Rights Termination</div>
              <div className="text-xs text-gray-500">All side letter rights terminate if investor no longer owns the 8 Class B Units. Rights are not assignable without Manager consent.</div>
            </div>
          </div>
        </div>
      </div>

      {/* Distribution Waterfall */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <h3 className="text-sm font-semibold text-cyan-400 mb-4">Distribution Waterfall</h3>
        <div className="space-y-5">
          <WaterfallBar
            phase="Phase 1: Before Capital Return"
            label="Favorable to investors"
            classA={30}
            classB={70}
          />
          <div className="flex items-center gap-3 px-2">
            <div className="flex-1 h-px bg-white/10" />
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
              <span className="text-[10px] text-red-400 font-bold uppercase tracking-wider">Flip after 1x capital return</span>
            </div>
            <div className="flex-1 h-px bg-white/10" />
          </div>
          <WaterfallBar
            phase="Phase 2: After Capital Return"
            label="Heavily favors management"
            classA={70}
            classB={30}
          />
        </div>
        <div className="mt-4 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
          <div className="text-[10px] text-red-400 font-semibold uppercase tracking-wider mb-1">Key Risk</div>
          <div className="text-xs text-gray-400">Once investors receive their initial capital back (1x return only), the distribution split reverses dramatically. Long-term profits heavily favor Class A / Manager.</div>
        </div>
      </div>

      {/* Key Dates & Deadlines */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <h3 className="text-sm font-semibold text-cyan-400 mb-4">Key Dates &amp; Deadlines</h3>
        <div className="space-y-3">
          {[
            { date: "Nov 17, 2025", event: "Company Formation", desc: "Penguin Flagship NYC LLC formed in New York", status: "complete" as const },
            { date: "Mar 10, 2026", event: "Operating Agreement Effective", desc: "Operating Agreement effective date", status: "complete" as const },
            { date: "TBD", event: "Subscription Signing", desc: "Subscription agreement execution \u2014 NOT YET SIGNED", status: "pending" as const },
            { date: "TBD", event: "$8M Raise Threshold", desc: "Triggers additional investment option from Side Letter", status: "pending" as const },
            { date: "TBD + 30 days", event: "Additional Investment Decision", desc: "30-day window to accept/reject additional investment", status: "pending" as const },
          ].map((item, i) => (
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

      {/* Entity Map */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <h3 className="text-sm font-semibold text-cyan-400 mb-6">Entity Map</h3>
        <EntityMap />
      </div>
    </div>
  );
}

// --- Strengths Tab ---

function StrengthsTab() {
  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500 mb-4">10 favorable terms identified in the subscription and operating agreements</div>
      {strengths.map((item, i) => (
        <div key={i} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-[10px] font-bold text-emerald-400">{i + 1}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-emerald-400 mb-1">{item.title}</div>
              <div className="text-xs text-gray-400 leading-relaxed">{item.detail}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Weaknesses Tab ---

function WeaknessesTab() {
  const redCount = weaknesses.filter(w => w.severity === "red").length;
  const amberCount = weaknesses.filter(w => w.severity === "amber").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 mb-4">
        <StatusBadge status="red" label={`${redCount} Critical`} />
        <StatusBadge status="amber" label={`${amberCount} Notable`} />
      </div>
      {weaknesses.map((item, i) => {
        const borderColor = item.severity === "red" ? "border-red-500/20" : "border-amber-500/20";
        const bgColor = item.severity === "red" ? "bg-red-500/15" : "bg-amber-500/15";
        const textColor = item.severity === "red" ? "text-red-400" : "text-amber-400";
        const badgeLabel = item.severity === "red" ? "CRITICAL" : "NOTABLE";
        return (
          <div key={i} className={`rounded-xl border ${borderColor} bg-white/[0.02] p-4`}>
            <div className="flex items-start gap-3">
              <div className={`w-6 h-6 rounded-full ${bgColor} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                <span className={`text-[10px] font-bold ${textColor}`}>{i + 1}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-medium ${textColor} mb-1`}>{item.title}</div>
                <div className="text-xs text-gray-400 leading-relaxed mb-2">{item.detail}</div>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${bgColor} ${textColor}`}>
                  {badgeLabel}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Email Draft Tab ---

function EmailDraftTab() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(emailContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="text-xs text-gray-500">Pre-written email with critical due diligence questions</div>
          <div className="text-[10px] text-gray-600 mt-0.5">13 questions covering financial terms, operations, and negotiation points</div>
        </div>
        <button
          onClick={handleCopy}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
            copied
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/25"
          }`}
        >
          {copied ? (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
              Copy Email
            </>
          )}
        </button>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <pre className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap font-mono">{emailContent}</pre>
      </div>
    </div>
  );
}

// --- Main Component ---

export default function PenguinNYC() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-6">
        <Link to="/tools" className="hover:text-white transition-colors">Tools</Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-gray-300">Penguin NYC Contract Review</span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold mb-1">Penguin NYC Contract Review</h1>
          <p className="text-gray-500 text-sm">Subscription agreement analysis for Penguin Flagship NYC LLC</p>
        </div>
        <StatusBadge status="red" label="Not Signed" />
      </div>

      {/* Sub-page Nav */}
      <div className="flex gap-1 mb-4 border-b border-white/10 pb-px overflow-x-auto">
        <span className="px-4 py-2.5 text-xs font-medium rounded-t-lg text-cyan-400 bg-white/5 border-b-2 border-cyan-400">
          Overview
        </span>
        <Link
          to="/tools/penguin-nyc/advisory"
          className="px-4 py-2.5 text-xs font-medium rounded-t-lg text-gray-500 hover:text-gray-300 hover:bg-white/[0.02] transition-all duration-200"
        >
          Advisory
        </Link>
        <Link
          to="/tools/penguin-nyc/clauses"
          className="px-4 py-2.5 text-xs font-medium rounded-t-lg text-gray-500 hover:text-gray-300 hover:bg-white/[0.02] transition-all duration-200"
        >
          Clause Analysis
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 ${
              activeTab === tab.id
                ? "text-cyan-400 bg-cyan-500/10"
                : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.02]"
            }`}
          >
            {tab.label}
            {tab.id === "strengths" && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] bg-emerald-500/15 text-emerald-400">10</span>
            )}
            {tab.id === "weaknesses" && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] bg-red-500/15 text-red-400">10</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && <OverviewTab />}
      {activeTab === "strengths" && <StrengthsTab />}
      {activeTab === "weaknesses" && <WeaknessesTab />}
      {activeTab === "email" && <EmailDraftTab />}
    </div>
  );
}
