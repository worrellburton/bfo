import { useState } from "react";
import { Link } from "react-router";
import jsPDF from "jspdf";

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

// --- Termination Grounds Data ---

const terminationGrounds: {
  num: number;
  title: string;
  severity: "critical" | "high" | "medium";
  applies: "yes" | "partial" | "no" | "unknown";
  contractExcerpt: string;
  analysis: string;
}[] = [
  {
    num: 1,
    title: "Criminal Conviction / Felony / Fraud / Embezzlement",
    severity: "critical",
    applies: "no",
    contractExcerpt: "conviction or entry of a plea of nolo contendere for a crime or offense involving misappropriation of monies or other property, or any felony offense (including Foreign Corrupt Practices Act of 1977), or Executive\u2019s commission of fraud or embezzlement",
    analysis: "No evidence of criminal activity. This ground is not applicable to the $50M revenue loss scenario unless fraud or embezzlement is discovered during investigation.",
  },
  {
    num: 2,
    title: "Breach of Fiduciary Duties",
    severity: "critical",
    applies: "partial",
    contractExcerpt: "breach by Executive of Executive\u2019s fiduciary duties to VisionQuest",
    analysis: "POTENTIALLY APPLICABLE. A CEO\u2019s fiduciary duty of care requires acting with the care an ordinarily prudent person would exercise. Knowingly failing to pursue available funding while the company hemorrhages $50M in revenue could constitute a breach of the duty of care. Requires showing the CEO knew funding was available and chose not to act.",
  },
  {
    num: 3,
    title: "Insubordination / Willful Failure to Discharge Duties",
    severity: "high",
    applies: "yes",
    contractExcerpt: "insubordination or willful failure to discharge any of Executive\u2019s duties or obligations under this Agreement",
    analysis: "STRONG GROUND. If the Board directed the CEO to pursue funding and the CEO failed to do so, this is direct insubordination. Even without specific Board direction, the Job Description requires the CEO to \u201cpartner with high level officers to grow the company and strengthen and ensure the company\u2019s sustainability\u201d and \u201cwork closely with the CFO to set yearly budgets to allocate capital.\u201d Willful inaction on a $50M revenue decline qualifies.",
  },
  {
    num: 4,
    title: "Violation of Law / Regulation",
    severity: "critical",
    applies: "no",
    contractExcerpt: "violation of any law, rule, or regulation of any governmental agency with jurisdiction over VisionQuest which could reasonably be expected to impair VisionQuest\u2019s ability to conduct its business in its usual manner or could reasonably be expected to subject VisionQuest to public disrespect, scandal, or ridicule",
    analysis: "Not directly applicable unless the CEO\u2019s actions (or inactions) resulted in regulatory violations. Would need to investigate whether any compliance failures occurred during the revenue decline.",
  },
  {
    num: 5,
    title: "Insobriety / Drug Use Affecting Duties",
    severity: "critical",
    applies: "no",
    contractExcerpt: "insobriety or non-therapeutic use of drugs, chemicals, or controlled substances either: (A) in the course of performing Executive\u2019s duties and responsibilities under this Agreement; or (B) in any other manner affecting Executive\u2019s ability to perform Executive\u2019s duties",
    analysis: "Not applicable to the $50M revenue loss scenario.",
  },
  {
    num: 6,
    title: "Willful Misconduct (Business Affairs / Code of Ethics)",
    severity: "high",
    applies: "partial",
    contractExcerpt: "willful misconduct with respect to the business and affairs of VisionQuest or any subsidiary or affiliate thereof, including, but not limited to, Executive\u2019s willful violation of any Code of Ethics or any other material policy of VisionQuest",
    analysis: "POTENTIALLY APPLICABLE. Willfully ignoring a deteriorating $50M financial position and consciously choosing not to pursue known funding sources could be construed as willful misconduct with respect to VisionQuest\u2019s business affairs. The key question is whether the CEO\u2019s inaction was willful (intentional) versus merely negligent.",
  },
  {
    num: 7,
    title: "Dishonesty",
    severity: "critical",
    applies: "unknown",
    contractExcerpt: "dishonesty",
    analysis: "INVESTIGATE. If the CEO misrepresented the company\u2019s financial condition to the Board, concealed the availability of funding sources, or provided misleading reports about revenue projections, this ground applies. Review Board meeting minutes, financial presentations, and CEO communications for any misrepresentations.",
  },
  {
    num: 8,
    title: "Material Breach by Act or Omission",
    severity: "high",
    applies: "yes",
    contractExcerpt: "any act or omission constituting a material breach by Executive of any provision of this Agreement",
    analysis: "STRONG GROUND. An OMISSION (failure to act) explicitly qualifies as a material breach. The CEO\u2019s duty under Section 1(a) is to be \u201cresponsible for the overall leadership, management, and operation of VisionQuest\u201d and to \u201ctake such steps as are reasonably necessary to assure the financial strength and integrity of VisionQuest.\u201d Failing to pursue funding while revenue declined $50M is a material omission of this core duty.",
  },
  {
    num: 9,
    title: "Policy Violation (Harassment, Discrimination, IP, Confidentiality)",
    severity: "critical",
    applies: "no",
    contractExcerpt: "Executive\u2019s violation of any VisionQuest policy involving harassment, discrimination, intellectual property, and/or confidentiality",
    analysis: "Not applicable to the revenue loss scenario unless separate policy violations are discovered.",
  },
  {
    num: 10,
    title: "Disparaging Statements About VisionQuest",
    severity: "medium",
    applies: "no",
    contractExcerpt: "Executive has made oral or written statements disparaging the reputation of VisionQuest, its products, or its services",
    analysis: "Not directly applicable. However, if the CEO made negative statements about VisionQuest\u2019s financial viability to third parties (funders, partners, employees) that contributed to the revenue decline, this could be explored.",
  },
  {
    num: 11,
    title: "Negligence / Failure to Perform Duties",
    severity: "high",
    applies: "yes",
    contractExcerpt: "Executive\u2019s negligence or refusal or failure to perform Executive\u2019s duties as set forth in this Agreement, which, if curable, is not cured within 30 calendar days after receipt of written notice from the Board of such unsatisfactory performance; provided, however, that successive refusals or failures involving the same unsatisfactory performance by Executive shall be deemed incapable of being cured",
    analysis: "THIS IS THE STRONGEST GROUND. The CEO\u2019s duty per Section 1(a) is to \u201cassure the financial strength and integrity of VisionQuest.\u201d Losing $50M in revenue while not pursuing known funding sources is textbook negligence/failure to perform. CRITICAL: If the Board previously raised this issue and the CEO didn\u2019t fix it, the 30-day cure period is ELIMINATED \u2014 \u201csuccessive refusals or failures involving the same unsatisfactory performance shall be deemed incapable of being cured.\u201d",
  },
  {
    num: 12,
    title: "Multiple Consecutive Quarterly Losses",
    severity: "high",
    applies: "yes",
    contractExcerpt: "Multiple consecutive quarterly losses due to declining of gross income or net profits",
    analysis: "DIRECT HIT. A $50M revenue loss would produce multiple consecutive quarters of declining gross income. This is the most straightforward ground \u2014 no subjective interpretation needed. If VisionQuest\u2019s financials show consecutive quarters of declining revenue or net income, this ground is satisfied on its face. No cure period. No ambiguity.",
  },
  {
    num: 13,
    title: "Inability to Execute Strategic Plan",
    severity: "high",
    applies: "yes",
    contractExcerpt: "Inability to execute the company\u2019s strategic plan",
    analysis: "STRONG GROUND \u2014 NOW BULLETPROOF WITH THE STRATEGIC PLAN DOCUMENT. The VisionQuest Strategic Plan V5.2 (2022-2027) explicitly requires: (1) \u201cImprove revenues and financial reporting,\u201d (2) \u201cComplete FY2022 with .5% profit margin then increase profitability 8% by the end of FY2027,\u201d (3) \u201cMaintain, grow, and optimize the company.\u201d A $50M revenue loss is the opposite of every financial objective in the Board-approved strategic plan.",
  },
];

// --- Grounds Tab ---

function GroundsTab() {
  const applicableCount = terminationGrounds.filter(g => g.applies === "yes").length;
  const partialCount = terminationGrounds.filter(g => g.applies === "partial").length;

  const severityColors = {
    critical: { border: "border-red-500/20", bg: "bg-red-500/15", text: "text-red-400" },
    high: { border: "border-orange-500/20", bg: "bg-orange-500/15", text: "text-orange-400" },
    medium: { border: "border-amber-500/20", bg: "bg-amber-500/15", text: "text-amber-400" },
  };

  const appliesColors = {
    yes: { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30", label: "APPLIES" },
    partial: { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/30", label: "PARTIAL" },
    no: { bg: "bg-gray-500/15", text: "text-gray-500", border: "border-gray-500/30", label: "N/A" },
    unknown: { bg: "bg-purple-500/15", text: "text-purple-400", border: "border-purple-500/30", label: "INVESTIGATE" },
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="rounded-xl border border-orange-500/20 bg-orange-500/[0.03] p-5">
        <div className="flex items-center gap-3 mb-3">
          <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
          </svg>
          <div className="text-sm font-bold text-orange-400">Section 4(d) — Termination for Cause</div>
        </div>
        <p className="text-xs text-gray-400 leading-relaxed mb-3">
          The Employment Agreement defines 13 specific grounds for termination &ldquo;for Cause.&rdquo; Termination for Cause means <span className="text-white font-semibold">zero severance</span> — VisionQuest&rsquo;s obligation to pay salary ceases on the Termination Date. Below is each ground analyzed against the $50M revenue loss scenario.
        </p>
        <div className="flex flex-wrap gap-2">
          <StatusBadge status="green" label={`${applicableCount} Directly Apply`} />
          <StatusBadge status="amber" label={`${partialCount} Partially Apply`} />
          <StatusBadge status="orange" label="13 Total Grounds" />
        </div>
      </div>

      {/* Cure Period Warning */}
      <div className="rounded-xl border border-red-500/20 bg-red-500/[0.03] p-4">
        <div className="flex items-start gap-2">
          <svg className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
          </svg>
          <div>
            <div className="text-[10px] text-red-400 font-bold uppercase tracking-wider mb-1">Critical: 30-Day Cure Period (Cause #11 Only)</div>
            <div className="text-xs text-gray-400">Cause #11 (Negligence/Failure to Perform) has a 30-day cure period after written notice. <span className="text-red-400 font-semibold">However, &ldquo;successive refusals or failures involving the same unsatisfactory performance shall be deemed incapable of being cured.&rdquo;</span> If the Board has previously raised the revenue/funding issue, the cure period is waived. All other grounds have NO cure period.</div>
          </div>
        </div>
      </div>

      {/* All 13 Grounds */}
      {terminationGrounds.map((g) => {
        const sev = severityColors[g.severity];
        const app = appliesColors[g.applies];
        return (
          <div key={g.num} className={`rounded-xl border ${g.applies === "yes" ? "border-emerald-500/20" : "border-white/10"} bg-white/[0.02] p-5`}>
            <div className="flex items-start gap-3">
              {/* Number */}
              <div className={`flex-shrink-0 w-8 h-8 rounded-lg ${g.applies === "yes" ? "bg-emerald-500/15" : "bg-white/5"} flex items-center justify-center`}>
                <span className={`text-xs font-black ${g.applies === "yes" ? "text-emerald-400" : "text-gray-500"}`}>{g.num}</span>
              </div>
              <div className="flex-1 min-w-0">
                {/* Header */}
                <div className="flex items-center flex-wrap gap-2 mb-2">
                  <span className="text-sm font-semibold text-gray-200">{g.title}</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${sev.bg} ${sev.text} ${sev.border}`}>
                    {g.severity}
                  </span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${app.bg} ${app.text} ${app.border}`}>
                    {app.label}
                  </span>
                </div>
                {/* Contract Excerpt */}
                <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3 mb-3">
                  <div className="text-[9px] text-gray-600 uppercase tracking-wider font-semibold mb-1">Contract Language</div>
                  <div className="text-xs text-gray-400 italic leading-relaxed">&ldquo;{g.contractExcerpt}&rdquo;</div>
                </div>
                {/* BFO Analysis */}
                <div className="text-xs text-gray-400 leading-relaxed">
                  <span className="text-[9px] text-orange-400 uppercase tracking-wider font-semibold">BFO Analysis: </span>
                  {g.analysis}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Bottom Summary */}
      <div className="rounded-xl border-2 border-emerald-500/30 bg-emerald-500/[0.03] p-5">
        <div className="text-sm font-bold text-emerald-400 mb-2">
          <svg className="w-4 h-4 inline mr-1 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Strongest Grounds for Termination
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          {[
            { num: 12, title: "Multiple Consecutive Quarterly Losses", strength: "DIRECT HIT — objective, no interpretation needed" },
            { num: 11, title: "Negligence / Failure to Perform", strength: "STRONGEST — duty to assure financial strength" },
            { num: 13, title: "Inability to Execute Strategic Plan", strength: "BULLETPROOF — Strategic Plan V5.2 documents targets" },
            { num: 8, title: "Material Breach by Omission", strength: "STRONG — omission explicitly covered in contract" },
          ].map((s) => (
            <div key={s.num} className="rounded-lg bg-emerald-500/[0.05] border border-emerald-500/20 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/20 w-5 h-5 rounded flex items-center justify-center">#{s.num}</span>
                <span className="text-xs font-semibold text-emerald-300">{s.title}</span>
              </div>
              <div className="text-[10px] text-gray-500">{s.strength}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Termination Scenarios Data ---

const scenarios: {
  id: string;
  title: string;
  color: string;
  borderColor: string;
  items: { label: string; value: string; note?: string }[];
}[] = [
  {
    id: "for-cause",
    title: "Termination FOR Cause",
    color: "text-emerald-400",
    borderColor: "border-emerald-500/20",
    items: [
      { label: "Salary", value: "Ceases immediately", note: "On Termination Date" },
      { label: "Bonus", value: "Prorated only", note: "5% of net income for months employed before termination" },
      { label: "Severance", value: "$0", note: "No severance pay whatsoever" },
      { label: "Benefits", value: "Cease on Termination Date" },
      { label: "Non-Compete", value: "12 months enforced", note: "AZ, DE, MD, PA, TX" },
      { label: "Non-Solicitation", value: "12 months enforced", note: "Clients & employees" },
      { label: "Confidentiality", value: "Perpetual", note: "Survives termination forever" },
      { label: "Return of Materials", value: "Immediate", note: "All keys, property, docs, computers, software" },
      { label: "Cooperation", value: "Required post-termination", note: "Must cooperate with litigation, investigations" },
      { label: "Non-Disparagement", value: "Mutual", note: "Neither party can disparage; CEO updates LinkedIn" },
    ],
  },
  {
    id: "without-cause",
    title: "Termination WITHOUT Cause",
    color: "text-red-400",
    borderColor: "border-red-500/20",
    items: [
      { label: "Salary", value: "Ceases on Termination Date" },
      { label: "Bonus", value: "Prorated through Termination Date" },
      { label: "Severance", value: "FULL remaining term salary", note: "Paid in installments per standard payroll schedule" },
      { label: "Release Required", value: "Yes — within 60 days", note: "Must sign general release and waiver of all claims" },
      { label: "Release Revocation", value: "Standard revocation period applies", note: "If revoked, no severance" },
      { label: "Section 409A", value: "May delay payments 7 months", note: "If CEO is a 'specified employee' under IRC 409A" },
      { label: "Non-Compete", value: "12 months still enforced" },
      { label: "Non-Solicitation", value: "12 months still enforced" },
      { label: "Confidentiality", value: "Perpetual" },
      { label: "Non-Disparagement", value: "Mutual" },
    ],
  },
  {
    id: "resignation",
    title: "Resignation by Executive",
    color: "text-amber-400",
    borderColor: "border-amber-500/20",
    items: [
      { label: "Salary", value: "Ceases on Termination Date" },
      { label: "Bonus", value: "Prorated for months employed" },
      { label: "Severance", value: "$0", note: "No severance on voluntary resignation" },
      { label: "All Restrictive Covenants", value: "Survive termination", note: "Non-compete, non-solicit, confidentiality, IP — all enforced" },
      { label: "Cooperation", value: "Required post-termination" },
      { label: "Return of Materials", value: "Immediate" },
    ],
  },
  {
    id: "death",
    title: "Death During Employment",
    color: "text-gray-400",
    borderColor: "border-white/10",
    items: [
      { label: "Date of Death", value: "= Termination Date" },
      { label: "Accrued Obligations", value: "Paid to estate/beneficiaries", note: "Accrued compensation, unpaid vacation, sick leave" },
      { label: "Severance", value: "$0" },
    ],
  },
  {
    id: "disability",
    title: "Disability",
    color: "text-gray-400",
    borderColor: "border-white/10",
    items: [
      { label: "Trigger", value: "Mentally or physically incapable", note: "Even with reasonable accommodation" },
      { label: "Accrued Obligations", value: "Paid in cash" },
      { label: "Severance", value: "$0" },
    ],
  },
];

// --- Cost Calculator ---

// Agreement signed Dec 27-28, 2022. Initial 5-year term expires Dec 27, 2027.
// Current date assumption: March 30, 2026
const SALARY = 350000;
const TERM_START = new Date("2022-12-27");
const TERM_END = new Date("2027-12-27");
const TODAY = new Date("2026-03-30");
const remainingMs = TERM_END.getTime() - TODAY.getTime();
const remainingMonths = Math.ceil(remainingMs / (1000 * 60 * 60 * 24 * 30.44));
const remainingYears = (remainingMonths / 12).toFixed(1);
const severanceCost = Math.round((remainingMonths / 12) * SALARY);
const monthlySalary = Math.round(SALARY / 12);

function ConsequencesTab() {
  return (
    <div className="space-y-6">
      {/* Cost Calculator Hero */}
      <div className="rounded-xl border-2 border-orange-500/30 bg-orange-500/[0.03] p-6">
        <div className="flex items-center gap-2 mb-4">
          <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm font-bold text-orange-400">Severance Cost Calculator</div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <StatCard label="Annual Salary" value={`$${SALARY.toLocaleString()}`} color="#f97316" />
          <StatCard label="Monthly Salary" value={`$${monthlySalary.toLocaleString()}`} sub="Per installment" />
          <StatCard label="Months Remaining" value={`${remainingMonths}`} sub={`${remainingYears} years to Dec 2027`} />
          <StatCard label="Term End" value="Dec 27, 2027" sub="Initial 5-year term" />
        </div>

        {/* For Cause vs Without Cause comparison */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-5">
            <div className="text-[9px] text-emerald-400 uppercase tracking-wider font-bold mb-2">If Terminated FOR Cause</div>
            <div className="text-3xl font-black text-emerald-400 mb-1">$0</div>
            <div className="text-xs text-gray-500">Zero severance obligation</div>
            <div className="mt-3 text-[10px] text-gray-500">Salary ceases immediately. Only prorated bonus for months already worked. VisionQuest saves the full remaining term salary.</div>
          </div>
          <div className="rounded-xl border border-red-500/20 bg-red-500/[0.03] p-5">
            <div className="text-[9px] text-red-400 uppercase tracking-wider font-bold mb-2">If Terminated WITHOUT Cause</div>
            <div className="text-3xl font-black text-red-400 mb-1">${severanceCost.toLocaleString()}</div>
            <div className="text-xs text-gray-500">Remaining salary through Dec 2027</div>
            <div className="mt-3 text-[10px] text-gray-500">{remainingMonths} months × ${monthlySalary.toLocaleString()}/mo. Paid in installments per standard payroll. First payment after release revocation period expires.</div>
          </div>
        </div>

        {/* Savings callout */}
        <div className="mt-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4 text-center">
          <div className="text-[10px] text-emerald-400 uppercase tracking-wider font-bold mb-1">For-Cause Termination Savings</div>
          <div className="text-2xl font-black text-emerald-400">${severanceCost.toLocaleString()}</div>
          <div className="text-xs text-gray-500 mt-1">This is the cost VisionQuest avoids by establishing valid Cause grounds</div>
        </div>
      </div>

      {/* Section 409A Warning */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] p-4">
        <div className="flex items-start gap-2">
          <svg className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
          </svg>
          <div>
            <div className="text-[10px] text-amber-400 font-bold uppercase tracking-wider mb-1">Section 409A Compliance (Section 22)</div>
            <div className="text-xs text-gray-400 leading-relaxed">
              If severance benefits are subject to IRC Section 409A and the CEO is a &ldquo;specified employee,&rdquo; severance payments <span className="text-amber-400 font-semibold">will not begin until the first day of the seventh month</span> following the Termination Date. This is a deferred compensation rule that can delay Without-Cause severance payments significantly. For-Cause termination avoids this issue entirely since there is no severance.
            </div>
          </div>
        </div>
      </div>

      {/* Release Requirement */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="text-sm font-semibold text-orange-400 mb-3">
          <svg className="w-4 h-4 inline mr-1.5 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Release Requirement (Section 4(e)(ii))
        </h3>
        <div className="text-xs text-gray-400 leading-relaxed mb-3">
          To receive Severance Pay (Without Cause only), the Executive <span className="text-white font-semibold">must sign a general release and waiver</span> of all claims within 60 calendar days following the Termination Date. If the Executive does not sign (or revokes) the release, no Severance Pay is owed.
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Deadline</div>
            <div className="text-sm font-semibold text-gray-200">60 calendar days</div>
            <div className="text-[10px] text-gray-500">After Termination Date</div>
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Scope</div>
            <div className="text-sm font-semibold text-gray-200">General release & waiver</div>
            <div className="text-[10px] text-gray-500">All claims related to employment</div>
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">First Payment</div>
            <div className="text-sm font-semibold text-gray-200">After revocation period</div>
            <div className="text-[10px] text-gray-500">First regular payroll after release is final</div>
          </div>
        </div>
      </div>

      {/* Scenario Comparison Cards */}
      <div>
        <h3 className="text-sm font-semibold text-orange-400 mb-3">
          <svg className="w-4 h-4 inline mr-1.5 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
          </svg>
          All Termination Scenarios — Side by Side
        </h3>
        <div className="space-y-4">
          {scenarios.map((s) => (
            <div key={s.id} className={`rounded-xl border ${s.borderColor} bg-white/[0.02] p-5`}>
              <div className={`text-sm font-bold ${s.color} mb-3`}>{s.title}</div>
              <div className="space-y-2">
                {s.items.map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-28 flex-shrink-0">
                      <span className="text-[10px] text-gray-500 font-medium">{item.label}</span>
                    </div>
                    <div className="flex-1">
                      <span className="text-xs text-gray-200 font-medium">{item.value}</span>
                      {item.note && <span className="text-[10px] text-gray-500 ml-2">— {item.note}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Covenant Breach Clawback */}
      <div className="rounded-xl border border-red-500/20 bg-red-500/[0.03] p-5">
        <h3 className="text-sm font-semibold text-red-400 mb-3">
          <svg className="w-4 h-4 inline mr-1.5 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
          </svg>
          Clawback — If Executive Breaches Restrictive Covenants (Section 5(e))
        </h3>
        <div className="text-xs text-gray-400 leading-relaxed mb-3">
          Even if termination is Without Cause and severance is being paid, VisionQuest has the right to <span className="text-red-400 font-semibold">cease all payments and claw back amounts already paid</span> if the Executive breaches any restrictive covenant (non-compete, non-solicitation, confidentiality).
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg bg-red-500/[0.05] border border-red-500/15 p-3">
            <div className="text-[9px] text-red-400 uppercase tracking-wider font-semibold mb-1">Clawback</div>
            <div className="text-xs text-gray-400">Must repay all amounts received during the breach period to VisionQuest</div>
          </div>
          <div className="rounded-lg bg-red-500/[0.05] border border-red-500/15 p-3">
            <div className="text-[9px] text-red-400 uppercase tracking-wider font-semibold mb-1">Retention</div>
            <div className="text-xs text-gray-400">Executive keeps only $2,000 as consideration for the release agreement</div>
          </div>
        </div>
      </div>

      {/* BFO Recommendation */}
      <div className="rounded-xl border-2 border-emerald-500/30 bg-emerald-500/[0.03] p-5">
        <div className="text-sm font-bold text-emerald-400 mb-2">
          <svg className="w-4 h-4 inline mr-1 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          BFO Recommendation
        </div>
        <div className="text-xs text-gray-400 leading-relaxed mb-3">
          Terminate FOR CAUSE using grounds #8, #11, #12, and #13 simultaneously. This eliminates the ${severanceCost.toLocaleString()} severance obligation entirely. Using multiple grounds provides redundancy — if one is challenged, the others stand independently. Document everything thoroughly before initiating termination.
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-emerald-500/[0.05] border border-emerald-500/20 p-3 text-center">
            <div className="text-xl font-black text-emerald-400">$0</div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">For-Cause Severance</div>
          </div>
          <div className="rounded-lg bg-red-500/[0.05] border border-red-500/20 p-3 text-center">
            <div className="text-xl font-black text-red-400">${severanceCost.toLocaleString()}</div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Without-Cause Cost</div>
          </div>
          <div className="rounded-lg bg-orange-500/[0.05] border border-orange-500/20 p-3 text-center">
            <div className="text-xl font-black text-orange-400">${severanceCost.toLocaleString()}</div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Total Savings</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Strategic Plan Scorecard ---

const strategicPlanItems: {
  pillar: string;
  objective: string;
  targets: { target: string; status: "fail" | "unknown" | "partial" }[];
}[] = [
  {
    pillar: "Operations",
    objective: "Maintain, grow, and optimize the company both locally and nationally in a responsible and steady manner",
    targets: [
      { target: "Open at least one pathfinder program annually between 2022\u20132027", status: "unknown" },
      { target: "Open at least one community based program annually between 2022\u20132027", status: "unknown" },
      { target: "Expand current ORR programs by 10% between 2022\u20132027", status: "unknown" },
    ],
  },
  {
    pillar: "Finance",
    objective: "Improve revenues and financial reporting",
    targets: [
      { target: "Complete FY2022 with .5% profit margin then increase profitability to 8% by end of FY2027", status: "fail" },
      { target: "Ensure 100% compliance with Creditors\u2019 covenants and other bank requirements", status: "unknown" },
      { target: "Ensure the financial audit is completed by March of the following fiscal year", status: "unknown" },
    ],
  },
  {
    pillar: "Human Resources",
    objective: "Create a diverse culture that promotes inclusion, innovation, and staff advancement",
    targets: [
      { target: "Increase Recruitment and Hiring by 10% annually starting in 2022", status: "unknown" },
      { target: "Increase staff retention by 10% annually starting in 2022", status: "unknown" },
      { target: "Enhance technological infrastructure for remote work to reduce overhead costs", status: "unknown" },
    ],
  },
  {
    pillar: "Compliance",
    objective: "Ensure compliance with local, state, federal and other contractual obligations",
    targets: [
      { target: "Ensure programs are compliant with licensing and contract requirements at 100%", status: "unknown" },
      { target: "Ensure all policies and procedures are reviewed and updated annually", status: "unknown" },
      { target: "Compliance alignment with outcomes", status: "unknown" },
    ],
  },
];

// --- Job Description Violations ---

const jobDescViolations: {
  duty: string;
  source: string;
  failure: string;
  strength: "critical" | "strong" | "supporting";
}[] = [
  {
    duty: "Develop strategic objectives and direction",
    source: "Job Description \u2014 Principal Duties",
    failure: "Failed to develop a funding strategy or pivot the company\u2019s direction in response to $50M revenue decline over 3 years",
    strength: "critical",
  },
  {
    duty: "Partner with high level officers to grow the company and to strengthen and ensure the company\u2019s sustainability",
    source: "Job Description \u2014 Principal Duties",
    failure: "Company lost $50M in revenue \u2014 the opposite of growth. Sustainability is now threatened. CEO did not lead the company to new funding sources despite knowing they were available.",
    strength: "critical",
  },
  {
    duty: "Work closely with the CFO to set yearly budgets to allocate capital in consideration of factors like net income, cash flow, and the valuation they wish to achieve",
    source: "Job Description \u2014 Principal Duties",
    failure: "Capital allocation failed to account for revenue decline. Budgets did not adapt to the $50M shortfall. No evidence of strategic capital redeployment.",
    strength: "strong",
  },
  {
    duty: "Track the company\u2019s performance relative to competitors and monitor the market for potential acquisitions or significant regulatory developments",
    source: "Job Description \u2014 Principal Duties",
    failure: "Failed to identify and/or pursue available funding sources. Did not monitor the market for opportunities that could offset the revenue decline.",
    strength: "critical",
  },
  {
    duty: "Responsible for the overall leadership, management, and operation of VisionQuest",
    source: "Employment Agreement \u2014 Section 1(a)",
    failure: "Overall leadership failed to prevent or reverse a $50M revenue loss. The most fundamental CEO responsibility was not met.",
    strength: "critical",
  },
  {
    duty: "Take such steps as are reasonably necessary to assure the financial strength and integrity of VisionQuest",
    source: "Employment Agreement \u2014 Section 1(a)",
    failure: "The financial strength of VisionQuest was not assured \u2014 it was decimated. Steps that were reasonably necessary (pursuing known funding) were not taken.",
    strength: "critical",
  },
  {
    duty: "Devote substantially all of Executive\u2019s professional time to the performance of his duties",
    source: "Employment Agreement \u2014 Section 1(b)",
    failure: "If CEO was not devoting full professional time to addressing the revenue crisis and pursuing funding, this is a direct contract violation.",
    strength: "supporting",
  },
];

// --- Termination Playbook Steps ---

const playbookSteps: {
  step: number;
  title: string;
  detail: string;
  timing: string;
  critical?: boolean;
}[] = [
  {
    step: 1,
    title: "DOCUMENT \u2014 Compile Evidence",
    detail: "Gather quarterly financial statements showing consecutive revenue decline. Compile list of funding opportunities the CEO knew about but did not pursue. Collect Board meeting minutes where revenue/funding was discussed. Pull CEO\u2019s performance reviews and any prior written warnings.",
    timing: "Start immediately",
    critical: true,
  },
  {
    step: 2,
    title: "LEGAL REVIEW \u2014 Engage Arizona Employment Counsel",
    detail: "Have an Arizona employment attorney review the termination strategy and evidence package. Confirm the for-cause grounds are sufficient under Arizona law. Ensure compliance with the agreement\u2019s procedural requirements.",
    timing: "Within 1 week",
    critical: true,
  },
  {
    step: 3,
    title: "BOARD RESOLUTION \u2014 Formal Termination Vote",
    detail: "Convene a Board meeting. Present the evidence of Causes #8, #11, #12, and #13. Pass a formal Board resolution to terminate the CEO for Cause. Document the vote, the specific grounds cited, and the evidence supporting each ground.",
    timing: "After legal review",
    critical: true,
  },
  {
    step: 4,
    title: "WRITTEN NOTICE \u2014 Deliver Termination Letter",
    detail: "Prepare formal written termination notice per Section 4(d) specifying all applicable Cause grounds. For Cause #11, if this is the first notice, this starts the 30-day cure clock. If the Board has previously raised these same issues, cite that \u201csuccessive failures are incapable of being cured.\u201d Deliver via first-class mail, hand delivery, or overnight courier to: 11921 N. Silver Village Place, Oro Valley, AZ 85737.",
    timing: "Immediately after Board vote",
    critical: true,
  },
  {
    step: 5,
    title: "CURE PERIOD \u2014 30 Days (If Required for Cause #11)",
    detail: "If this is the first written notice for Cause #11, the CEO has 30 calendar days to cure the negligence/failure. Monitor closely. If the CEO fails to cure, proceed with termination. NOTE: Causes #12 and #13 have NO cure period \u2014 termination can proceed immediately on those grounds alone.",
    timing: "30 days after notice (if applicable)",
  },
  {
    step: 6,
    title: "EFFECTIVE TERMINATION \u2014 Cease Salary",
    detail: "On the Termination Date, VisionQuest\u2019s obligation to pay salary ceases. The CEO is no longer an employee. All benefits terminate. Demand return of all company property per Section 4(g).",
    timing: "Termination Date",
  },
  {
    step: 7,
    title: "SECURE PROPERTY \u2014 Materials Return",
    detail: "Collect all keys, computers, software, documents, files, notes, contracts, data, and any reproductions or copies. VisionQuest may withhold accrued vacation pay (but not Salary) to recover unreturned materials. Change passwords, revoke system access, secure facilities.",
    timing: "Termination Date",
  },
  {
    step: 8,
    title: "MONITOR COVENANTS \u2014 Non-Compete & Non-Solicitation",
    detail: "Track the former CEO\u2019s activities for 12 months. The non-compete covers AZ, DE, MD, PA, TX in any capacity (employee, consultant, advisor, etc.). The non-solicitation covers VisionQuest clients and employees. VisionQuest has the right to notify future employers of these restrictions (Section 5(f)).",
    timing: "12 months post-termination",
  },
  {
    step: 9,
    title: "PREPARE FOR CHALLENGE \u2014 Dispute Defense",
    detail: "The CEO may challenge the for-cause termination. All proceedings are in Pima County, AZ. Jury trial is waived. VisionQuest is entitled to injunctive relief without proving actual damages or posting bond. Maintain all documentation securely. The non-disparagement clause (Section 7) prohibits both parties from making negative public statements.",
    timing: "Ongoing",
  },
];

// --- Arizona Employment Law ---

const arizonaLawPoints: {
  title: string;
  detail: string;
  citation?: string;
}[] = [
  {
    title: "Arizona is an At-Will Employment State",
    detail: "Under Arizona law, employment is presumed at-will (A.R.S. \u00A7 23-1501). However, this Employment Agreement creates a contractual for-cause standard during the Employment Period, overriding at-will default. The Board must follow the contract\u2019s termination procedures.",
    citation: "A.R.S. \u00A7 23-1501",
  },
  {
    title: "Contract Supersedes At-Will",
    detail: "Arizona courts enforce employment agreements as written. The for-cause provisions in Section 4(d) create specific, enumerated grounds that VisionQuest must satisfy to terminate without paying severance. Using multiple grounds simultaneously strengthens the position.",
  },
  {
    title: "Burden of Proof on Employer",
    detail: "The burden of proving \u201cCause\u201d for termination rests with VisionQuest (the employer). This is why thorough documentation is critical \u2014 Board minutes, financial records, written notices, and CEO communications all serve as evidence.",
  },
  {
    title: "Covenant Not to Compete \u2014 Reasonableness",
    detail: "Arizona courts apply a reasonableness test to non-compete agreements (Amex Distributing Co. v. Mascari). The 12-month duration and 5-state geographic scope are likely enforceable given the CEO\u2019s access to confidential information and client relationships.",
    citation: "Amex Distributing Co. v. Mascari, 150 Ariz. 510 (1986)",
  },
  {
    title: "Implied Covenant of Good Faith",
    detail: "Arizona recognizes an implied covenant of good faith and fair dealing in employment contracts (Wagenseller v. Scottsdale Memorial Hospital). Termination must be in good faith and consistent with the contract terms \u2014 not pretextual.",
    citation: "Wagenseller v. Scottsdale Memorial Hospital, 147 Ariz. 370 (1985)",
  },
  {
    title: "Jury Trial Waiver is Enforceable",
    detail: "Arizona generally enforces jury trial waivers in commercial contracts when knowingly and voluntarily agreed to. Section 10(b) of this agreement contains an express, mutual waiver. Both parties initialed it. This limits the CEO\u2019s litigation options.",
  },
  {
    title: "Injunctive Relief Available",
    detail: "Under Section 9(a), VisionQuest can seek preliminary and permanent injunctive relief to prevent covenant breaches without proving actual damages or posting a bond. This is a powerful enforcement tool if the CEO violates non-compete or confidentiality provisions.",
  },
];

// --- War Room Tab ---

function WarRoomTab() {
  const strengthColors = {
    critical: { bg: "bg-red-500/15", text: "text-red-400", label: "CRITICAL" },
    strong: { bg: "bg-orange-500/15", text: "text-orange-400", label: "STRONG" },
    supporting: { bg: "bg-amber-500/15", text: "text-amber-400", label: "SUPPORTING" },
  };

  const statusColors = {
    fail: { bg: "bg-red-500/15", text: "text-red-400", label: "FAILED" },
    unknown: { bg: "bg-gray-500/15", text: "text-gray-500", label: "VERIFY" },
    partial: { bg: "bg-amber-500/15", text: "text-amber-400", label: "PARTIAL" },
  };

  return (
    <div className="space-y-6">
      {/* Scenario Summary */}
      <div className="rounded-xl border-2 border-red-500/30 bg-red-500/[0.03] p-6">
        <div className="flex items-center gap-2 mb-4">
          <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
          </svg>
          <div className="text-sm font-bold text-red-400">$50M Revenue Loss — Scenario Analysis</div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-center">
            <div className="text-xl font-black text-red-400">~$50M</div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Revenue Lost</div>
          </div>
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-center">
            <div className="text-xl font-black text-red-400">3 Years</div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Of Inaction</div>
          </div>
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-center">
            <div className="text-xl font-black text-amber-400">Known</div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Funding Available</div>
          </div>
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-center">
            <div className="text-xl font-black text-emerald-400">4 Grounds</div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">For Termination</div>
          </div>
        </div>
        <div className="text-xs text-gray-400 leading-relaxed">
          The company lost approximately $50 million in revenue. The CEO did not lead the company to a new funding source in the last 3 years, despite knowing that funding was available. This maps directly to <span className="text-white font-semibold">4 for-cause termination grounds</span> and violates <span className="text-white font-semibold">6 specific duties</span> from the Employment Agreement and Job Description.
        </div>
      </div>

      {/* Strategic Plan Scorecard */}
      <section>
        <h3 className="text-sm font-semibold text-orange-400 mb-2">
          <svg className="w-4 h-4 inline mr-1.5 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          Strategic Plan V5.2 Scorecard (2022-2027)
        </h3>
        <p className="text-[10px] text-gray-500 mb-3">Board-approved strategic plan objectives mapped against CEO performance. This document is key evidence for Cause #13: &ldquo;Inability to execute the company&rsquo;s strategic plan.&rdquo;</p>
        <div className="space-y-4">
          {strategicPlanItems.map((pillar) => (
            <div key={pillar.pillar} className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
              <div className="text-xs font-bold text-orange-400 mb-1">{pillar.pillar}</div>
              <div className="text-[10px] text-gray-500 italic mb-3">&ldquo;{pillar.objective}&rdquo;</div>
              <div className="space-y-2">
                {pillar.targets.map((t, i) => {
                  const st = statusColors[t.status];
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${st.bg} ${st.text}`}>
                        {st.label}
                      </span>
                      <span className="text-xs text-gray-400">{t.target}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-lg bg-red-500/[0.05] border border-red-500/20 p-3">
          <div className="text-[10px] text-red-400 font-bold uppercase tracking-wider mb-1">Key Finding</div>
          <div className="text-xs text-gray-400">The Finance pillar objective to &ldquo;Improve revenues and financial reporting&rdquo; and achieve 8% profitability by FY2027 is <span className="text-red-400 font-semibold">directly contradicted</span> by a $50M revenue loss. This alone satisfies Cause #13.</div>
        </div>
      </section>

      {/* Job Description Violations */}
      <section>
        <h3 className="text-sm font-semibold text-orange-400 mb-2">
          <svg className="w-4 h-4 inline mr-1.5 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
          </svg>
          Job Description & Contract Duty Violations
        </h3>
        <p className="text-[10px] text-gray-500 mb-3">Each CEO duty mapped to a specific failure. The Job Description is incorporated into the Employment Agreement by reference (Section 1(a), Exhibit A).</p>
        <div className="space-y-3">
          {jobDescViolations.map((v, i) => {
            const sc = strengthColors[v.strength];
            return (
              <div key={i} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${sc.bg} ${sc.text}`}>
                    {sc.label}
                  </span>
                  <span className="text-[10px] text-gray-500">{v.source}</span>
                </div>
                <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2.5 mb-2">
                  <div className="text-[9px] text-gray-600 uppercase tracking-wider mb-0.5">Duty</div>
                  <div className="text-xs text-gray-300 italic">&ldquo;{v.duty}&rdquo;</div>
                </div>
                <div>
                  <div className="text-[9px] text-red-400 uppercase tracking-wider font-semibold mb-0.5">Failure</div>
                  <div className="text-xs text-gray-400">{v.failure}</div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Arizona Employment Law */}
      <section>
        <h3 className="text-sm font-semibold text-orange-400 mb-2">
          <svg className="w-4 h-4 inline mr-1.5 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
          </svg>
          Arizona Employment Law Framework
        </h3>
        <p className="text-[10px] text-gray-500 mb-3">Key legal principles governing this termination under Arizona law (Choice of Law: Section 13).</p>
        <div className="space-y-3">
          {arizonaLawPoints.map((p, i) => (
            <div key={i} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-gray-200">{p.title}</span>
              </div>
              <div className="text-xs text-gray-400 leading-relaxed">{p.detail}</div>
              {p.citation && (
                <div className="mt-1.5 text-[10px] text-orange-400/70 font-mono">{p.citation}</div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Termination Playbook */}
      <section>
        <h3 className="text-sm font-semibold text-orange-400 mb-2">
          <svg className="w-4 h-4 inline mr-1.5 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Step-by-Step Termination Playbook
        </h3>
        <p className="text-[10px] text-gray-500 mb-3">Execute these steps in order. Critical steps must not be skipped.</p>
        <div className="space-y-3">
          {playbookSteps.map((s) => (
            <div key={s.step} className={`rounded-xl border ${s.critical ? "border-orange-500/20" : "border-white/10"} bg-white/[0.02] p-4`}>
              <div className="flex items-start gap-3">
                <div className={`flex-shrink-0 w-8 h-8 rounded-lg ${s.critical ? "bg-orange-500/15" : "bg-white/5"} flex items-center justify-center`}>
                  <span className={`text-xs font-black ${s.critical ? "text-orange-400" : "text-gray-500"}`}>{s.step}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-gray-200">{s.title}</span>
                    {s.critical && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 font-bold uppercase tracking-wider">Critical</span>
                    )}
                    <span className="text-[10px] text-gray-600">{s.timing}</span>
                  </div>
                  <div className="text-xs text-gray-400 leading-relaxed">{s.detail}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Risk Assessment */}
      <section>
        <h3 className="text-sm font-semibold text-orange-400 mb-3">
          <svg className="w-4 h-4 inline mr-1.5 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          Risk Assessment for VisionQuest
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Wrongful Termination Claim</div>
            <div className="flex items-center gap-2 mb-2">
              <div className="text-sm font-bold text-amber-400">MEDIUM</div>
              <span className="text-[10px] text-gray-500">(LOW if documentation is thorough)</span>
            </div>
            <div className="text-xs text-gray-400">CEO may claim termination was pretextual. Mitigate by using multiple grounds simultaneously and documenting every step.</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Severance Exposure if For-Cause Fails</div>
            <div className="flex items-center gap-2 mb-2">
              <div className="text-sm font-bold text-red-400">~${severanceCost.toLocaleString()}</div>
              <span className="text-[10px] text-gray-500">remaining term salary</span>
            </div>
            <div className="text-xs text-gray-400">If a court determines termination was not for valid Cause, VisionQuest would owe the full remaining term salary as severance.</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Non-Compete Enforceability</div>
            <div className="flex items-center gap-2 mb-2">
              <div className="text-sm font-bold text-emerald-400">HIGH</div>
            </div>
            <div className="text-xs text-gray-400">12 months, 5 states. Arizona courts generally enforce reasonable non-competes for C-suite executives with access to trade secrets.</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Recommended Strategy</div>
            <div className="flex items-center gap-2 mb-2">
              <div className="text-sm font-bold text-orange-400">MULTI-GROUND</div>
            </div>
            <div className="text-xs text-gray-400">Use grounds #8, #11, #12, #13 simultaneously. If one ground is challenged, the others stand independently. This provides maximum legal protection.</div>
          </div>
        </div>
      </section>

      {/* Disclaimer */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-1">Disclaimer</div>
        <div className="text-[10px] text-gray-600 leading-relaxed">
          This analysis is for informational purposes only and does not constitute legal advice. BFO should engage qualified Arizona employment counsel before initiating any termination. The strategic plan scorecard items marked &ldquo;VERIFY&rdquo; require confirmation with actual company records. Risk assessments are subjective based on the contract terms and general Arizona employment law principles.
        </div>
      </div>
    </div>
  );
}

// --- PDF Report Generator ---

function generatePDF() {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const margin = 18;
  const maxW = W - margin * 2;
  let y = 20;

  function checkPage(need: number) {
    if (y + need > 275) { doc.addPage(); y = 20; }
  }

  function heading(text: string, size = 16) {
    checkPage(14);
    doc.setFontSize(size);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(249, 115, 22);
    doc.text(text, margin, y);
    y += size * 0.5 + 4;
  }

  function subheading(text: string) {
    checkPage(10);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(60, 60, 60);
    doc.text(text, margin, y);
    y += 6;
  }

  function body(text: string, indent = 0) {
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 80, 80);
    const lines = doc.splitTextToSize(text, maxW - indent);
    for (const line of lines) {
      checkPage(5);
      doc.text(line, margin + indent, y);
      y += 4.2;
    }
    y += 1;
  }

  function boldBody(text: string, indent = 0) {
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(50, 50, 50);
    const lines = doc.splitTextToSize(text, maxW - indent);
    for (const line of lines) {
      checkPage(5);
      doc.text(line, margin + indent, y);
      y += 4.2;
    }
    y += 1;
  }

  function separator() {
    checkPage(6);
    doc.setDrawColor(220, 220, 220);
    doc.line(margin, y, W - margin, y);
    y += 5;
  }

  // ===== COVER PAGE =====
  doc.setFillColor(20, 20, 20);
  doc.rect(0, 0, W, 297, "F");

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(249, 115, 22);
  doc.text("BFO — CONFIDENTIAL", margin, 30);

  doc.setFontSize(28);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text("CEO Employment", margin, 60);
  doc.text("Agreement Review", margin, 72);

  doc.setFontSize(14);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(180, 180, 180);
  doc.text("Yousef Awwad — VisionQuest National, Ltd", margin, 90);

  doc.setFontSize(11);
  doc.setTextColor(249, 115, 22);
  doc.text("TERMINATION ANALYSIS & STRATEGY", margin, 105);

  doc.setFontSize(9);
  doc.setTextColor(140, 140, 140);
  doc.text("Prepared: " + new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), margin, 120);
  doc.text("Classification: CONFIDENTIAL — Attorney-Client Privileged", margin, 126);

  // Key stats
  doc.setFontSize(40);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(239, 68, 68);
  doc.text("~$50M", margin, 165);
  doc.setFontSize(11);
  doc.setTextColor(180, 180, 180);
  doc.text("Revenue Loss", margin, 172);

  doc.setFontSize(40);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(34, 197, 94);
  doc.text("$0", margin + 80, 165);
  doc.setFontSize(11);
  doc.setTextColor(180, 180, 180);
  doc.text("For-Cause Severance", margin + 80, 172);

  doc.setFontSize(40);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(249, 115, 22);
  const savingsStr = `~$${severanceCost.toLocaleString()}`;
  doc.text(savingsStr, margin, 200);
  doc.setFontSize(11);
  doc.setTextColor(180, 180, 180);
  doc.text("Savings vs Without-Cause", margin, 207);

  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text("This report is for informational purposes only and does not constitute legal advice.", margin, 270);
  doc.text("BFO should engage qualified Arizona employment counsel before initiating any termination.", margin, 275);

  // ===== PAGE 2: OVERVIEW =====
  doc.addPage();
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, W, 297, "F");
  y = 20;

  heading("1. Agreement Overview");
  const overviewPairs = [
    ["Executive:", "Yousef Awwad — Chief Executive Officer"],
    ["Company:", "VisionQuest National, Ltd (Arizona LLC)"],
    ["Reports To:", "Board of Directors"],
    ["Effective Date:", "December 27-28, 2022"],
    ["Employment Period:", "5 years, auto-renewed for subsequent 5-year terms"],
    ["Salary:", "$350,000 per year"],
    ["Bonus:", "5% of Fiscal Year Net Income (quarterly)"],
    ["Non-Compete:", "12 months post-termination — AZ, DE, MD, PA, TX"],
    ["Governing Law:", "State of Arizona — Pima County courts"],
    ["Jury Trial:", "Waived by both parties"],
  ];
  for (const [label, val] of overviewPairs) {
    checkPage(6);
    boldBody(label, 0);
    y -= 5.2;
    body(val, 35);
  }

  separator();
  heading("2. Compensation Structure");
  boldBody("Base Salary: $350,000/year");
  body("Paid in substantially equal periodic installments. Increases determined by annual performance evaluation. Prorated for partial years.");
  y += 2;
  boldBody("Quarterly Bonus: 5% of Fiscal Year Net Income");
  body("Calculated by HR/Payroll/Finance Director. Paid as lump sum within 30 days after quarter end. If quarterly Net Income is a loss, subsequent bonus is offset. Must be employed by VQ to earn. If terminated before fiscal year end, receives 5% of net income prorated for months employed.");
  y += 2;
  boldBody("Benefits: Full executive package");
  body("Medical, life insurance, disability, long-term care, retirement plan. VQ may modify or terminate plans at any time.");

  separator();
  heading("3. Restrictive Covenants");
  const covenantPairs = [
    ["Non-Competition:", "Employment + 12 months in AZ, DE, MD, PA, TX. Cannot engage in any Competing Business in any capacity."],
    ["Non-Solicitation:", "Employment + 12 months. Cannot solicit VQ clients or employees."],
    ["Confidentiality:", "Perpetual. All proprietary information remains VQ property."],
    ["Intellectual Property:", "Perpetual. All IP conceived during employment is exclusive VQ property."],
    ["Non-Disparagement:", "Mutual. Neither party can defame or disparage the other."],
  ];
  for (const [label, val] of covenantPairs) {
    boldBody(label);
    body(val, 4);
    y += 1;
  }

  // ===== PAGE: TERMINATION GROUNDS =====
  doc.addPage(); y = 20;
  heading("4. Termination for Cause — All 13 Grounds (Section 4(d))");
  body("Termination for Cause means ZERO severance — VisionQuest's obligation to pay salary ceases on the Termination Date. Below is each ground analyzed against the $50M revenue loss scenario.");
  y += 3;

  for (const g of terminationGrounds) {
    checkPage(30);
    const appliesLabel = g.applies === "yes" ? "[APPLIES]" : g.applies === "partial" ? "[PARTIAL]" : g.applies === "unknown" ? "[INVESTIGATE]" : "[N/A]";
    subheading(`#${g.num}: ${g.title}  —  ${g.severity.toUpperCase()}  ${appliesLabel}`);
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(120, 120, 120);
    const excerpt = doc.splitTextToSize(`"${g.contractExcerpt}"`, maxW - 4);
    for (const line of excerpt) { checkPage(4); doc.text(line, margin + 2, y); y += 3.8; }
    y += 1;
    body("Analysis: " + g.analysis, 2);
    y += 2;
  }

  // ===== PAGE: CONSEQUENCES =====
  doc.addPage(); y = 20;
  heading("5. Termination Consequences & Cost Calculator");

  subheading("Severance Cost Calculator");
  boldBody(`Annual Salary: $${SALARY.toLocaleString()}`);
  boldBody(`Monthly Salary: $${monthlySalary.toLocaleString()}`);
  boldBody(`Months Remaining in Term: ${remainingMonths} (~${remainingYears} years to Dec 2027)`);
  y += 2;
  boldBody("If Terminated FOR Cause: $0 severance");
  body("Salary ceases immediately on Termination Date. Only prorated bonus for months already worked.");
  y += 2;
  boldBody(`If Terminated WITHOUT Cause: ~$${severanceCost.toLocaleString()} severance`);
  body(`${remainingMonths} months x $${monthlySalary.toLocaleString()}/mo. Paid in installments per standard payroll.`);
  y += 2;
  boldBody(`FOR-CAUSE SAVINGS: ~$${severanceCost.toLocaleString()}`);
  y += 3;

  separator();
  subheading("Termination FOR Cause");
  for (const item of scenarios[0].items) {
    body(`${item.label}: ${item.value}${item.note ? " — " + item.note : ""}`, 2);
  }
  y += 2;
  subheading("Termination WITHOUT Cause");
  for (const item of scenarios[1].items) {
    body(`${item.label}: ${item.value}${item.note ? " — " + item.note : ""}`, 2);
  }
  y += 2;
  subheading("Resignation by Executive");
  for (const item of scenarios[2].items) {
    body(`${item.label}: ${item.value}${item.note ? " — " + item.note : ""}`, 2);
  }

  separator();
  subheading("Section 409A Compliance");
  body("If severance benefits are subject to IRC Section 409A and the CEO is a 'specified employee,' severance payments will not begin until the first day of the seventh month following the Termination Date. For-Cause termination avoids this issue entirely.");
  y += 2;
  subheading("Release Requirement (Section 4(e)(ii))");
  body("To receive Severance Pay (Without Cause only), the Executive must sign a general release and waiver of all claims within 60 calendar days following the Termination Date. If the Executive does not sign or revokes the release, no Severance Pay is owed.");
  y += 2;
  subheading("Covenant Breach Clawback (Section 5(e))");
  body("If the Executive breaches any restrictive covenant post-termination, VisionQuest can cease all payments and claw back amounts already paid. Executive retains only $2,000 as consideration for the release.");

  // ===== PAGE: WAR ROOM =====
  doc.addPage(); y = 20;
  heading("6. $50M Revenue Loss — War Room Analysis");

  subheading("Scenario Summary");
  body("Revenue Loss: ~$50,000,000");
  body("Funding Gap: CEO did not lead the company to a new funding source in the last 3 years");
  body("CEO Knowledge: Knew that funding was available and possible");
  body("Applicable For-Cause Grounds: #8 (Material Breach), #11 (Negligence), #12 (Quarterly Losses), #13 (Strategic Plan)");
  y += 3;

  separator();
  subheading("Strategic Plan V5.2 Scorecard (2022-2027)");
  body("The Board-approved VisionQuest Strategic Plan V5.2 establishes specific, measurable objectives. This document is key evidence for Cause #13.");
  y += 2;
  for (const pillar of strategicPlanItems) {
    checkPage(20);
    boldBody(`${pillar.pillar}: "${pillar.objective}"`);
    for (const t of pillar.targets) {
      const label = t.status === "fail" ? "FAILED" : "VERIFY";
      body(`  [${label}] ${t.target}`, 4);
    }
    y += 2;
  }

  separator();
  subheading("Job Description & Contract Duty Violations");
  body("The Job Description is incorporated into the Employment Agreement by reference (Section 1(a), Exhibit A).");
  y += 2;
  for (const v of jobDescViolations) {
    checkPage(18);
    boldBody(`[${v.strength.toUpperCase()}] "${v.duty}"`);
    body(`Source: ${v.source}`, 4);
    body(`Failure: ${v.failure}`, 4);
    y += 2;
  }

  // ===== PAGE: ARIZONA LAW =====
  doc.addPage(); y = 20;
  heading("7. Arizona Employment Law Framework");
  body("Choice of Law: State of Arizona (Section 13). All proceedings in Pima County, AZ.");
  y += 2;
  for (const p of arizonaLawPoints) {
    checkPage(18);
    subheading(p.title);
    body(p.detail, 2);
    if (p.citation) { body(`Citation: ${p.citation}`, 4); }
    y += 2;
  }

  // ===== PAGE: PLAYBOOK =====
  separator();
  heading("8. Step-by-Step Termination Playbook");
  for (const s of playbookSteps) {
    checkPage(18);
    subheading(`Step ${s.step}: ${s.title}${s.critical ? " [CRITICAL]" : ""}`);
    body(`Timing: ${s.timing}`, 2);
    body(s.detail, 2);
    y += 2;
  }

  // ===== PAGE: RISK & RECOMMENDATION =====
  separator();
  heading("9. Risk Assessment & Recommendation");

  subheading("Risk Assessment");
  body("Wrongful Termination Claim Risk: MEDIUM (LOW if documentation is thorough)");
  body(`Severance Exposure if For-Cause Fails: ~$${severanceCost.toLocaleString()} (remaining term salary)`);
  body("Non-Compete Enforceability: HIGH (12 months, 5 states, C-suite access to trade secrets)");
  y += 3;

  subheading("BFO RECOMMENDATION");
  boldBody("Terminate FOR CAUSE using grounds #8, #11, #12, and #13 simultaneously.");
  body(`This eliminates the ~$${severanceCost.toLocaleString()} severance obligation entirely. Using multiple grounds provides redundancy — if one is challenged, the others stand independently.`);
  y += 3;
  boldBody("Immediate next steps:");
  body("1. Compile quarterly financials showing consecutive revenue decline");
  body("2. Document funding opportunities the CEO knew about but did not pursue");
  body("3. Engage Arizona employment counsel to review strategy");
  body("4. Convene Board meeting and pass termination resolution");
  y += 5;

  // Disclaimer
  checkPage(15);
  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, W - margin, y);
  y += 5;
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(150, 150, 150);
  const disc = doc.splitTextToSize("DISCLAIMER: This report is for informational purposes only and does not constitute legal advice. BFO should engage qualified Arizona employment counsel before initiating any termination. Risk assessments are subjective based on contract terms and general Arizona employment law principles.", maxW);
  for (const line of disc) { doc.text(line, margin, y); y += 3.5; }

  doc.save("CEO-Agreement-Review-VisionQuest.pdf");
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
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-orange-500/15 shrink-0">
            <svg className="w-6 h-6 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">CEO Agreement Review</h1>
            <p className="text-gray-500 text-xs sm:text-sm">Yousef Awwad — VisionQuest National, Ltd Employment Agreement</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={generatePDF}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-orange-500/15 text-orange-400 border border-orange-500/30 hover:bg-orange-500/25 transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Download Report
          </button>
          <StatusBadge status="orange" label="Under Review" />
        </div>
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
