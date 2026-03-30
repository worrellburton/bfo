import { useState } from "react";
import { Link } from "react-router";

export function meta() {
  return [{ title: "BFO - Penguin NYC Contract Review" }];
}

const tabs = ["Overview", "Strengths", "Weaknesses", "Email Draft"] as const;
type Tab = (typeof tabs)[number];

// ─── Contract Overview Data ──────────────────────────────────────────
const dealTerms = [
  { label: "Investor Entity", value: "Sundown Investments LLC (Robert Burton)" },
  { label: "Investment", value: "8 Class B Units × $25,000 = $200,000" },
  { label: "Company", value: "Penguin Flagship NYC LLC" },
  { label: "Business", value: "NYC restaurant / bar concept" },
  { label: "Formation Date", value: "November 17, 2025" },
  { label: "Operating Agreement", value: "Effective March 10, 2026" },
  { label: "Manager", value: "People's Hospitality Inc. (CEO: Emmet McDermott)" },
  { label: "Subscription Type", value: "Irrevocable — restricted securities, no liquidity" },
];

const distributionWaterfall = [
  {
    phase: "Phase 1 — Until Capital Returned",
    classB: "70%",
    classA: "30%",
    note: "Favorable to investors until they recoup their $200K",
  },
  {
    phase: "Phase 2 — After Capital Returned",
    classB: "30%",
    classA: "70%",
    note: "Flips heavily in favor of Manager / Class A",
  },
];

const sideLetterTerms = [
  { label: "IPCO Rights", value: "$50,000 for 25% of subscription agreement rights" },
  { label: "Additional Option", value: "$200K additional investment at $8M valuation threshold" },
];

// ─── Strengths ───────────────────────────────────────────────────────
const strengths = [
  {
    title: "70/30 Initial Distribution Split",
    detail:
      "Class B investors receive 70% of distributions until capital is returned — a strong investor-first waterfall that prioritizes getting your $200K back before the Manager profits significantly.",
  },
  {
    title: "Experienced Hospitality Operator",
    detail:
      "People's Hospitality Inc. and Emmet McDermott bring hospitality operating experience to the venture, reducing execution risk on the restaurant/bar concept.",
  },
  {
    title: "IPCO Side Letter — Upside Optionality",
    detail:
      "The side letter grants 25% of subscription rights for $50K, providing leveraged upside exposure without committing the full $200K immediately.",
  },
  {
    title: "Additional Investment Option at $8M Threshold",
    detail:
      "The option to invest an additional $200K if the company reaches an $8M valuation lets you double down only after the concept is de-risked and proving success.",
  },
  {
    title: "NYC Market Opportunity",
    detail:
      "New York City remains one of the strongest restaurant/bar markets globally. A well-executed concept in a prime location has significant revenue potential.",
  },
  {
    title: "Defined Capital Return Priority",
    detail:
      "The waterfall structure ensures investor capital is returned before the profit-sharing ratio flips, providing a clear path to recouping the initial investment.",
  },
  {
    title: "Limited Capital Exposure",
    detail:
      "$200K is a manageable position size for the Burton portfolio. Even in a downside scenario, the loss is contained and doesn't threaten overall portfolio health.",
  },
  {
    title: "Class B Voting on Key Matters",
    detail:
      "Class B members likely retain voting rights on fundamental matters (dissolution, amendment of operating agreement), providing some governance protection.",
  },
  {
    title: "Structured as LLC — Tax Pass-Through",
    detail:
      "LLC structure provides pass-through taxation, avoiding double taxation. Losses (common in early restaurant operations) can potentially offset other income.",
  },
  {
    title: "Recent Formation — Ground Floor Entry",
    detail:
      "The company was formed November 2025 with the operating agreement effective March 2026. This is a ground-floor entry before operations begin, meaning maximum upside capture.",
  },
];

// ─── Weaknesses ──────────────────────────────────────────────────────
const weaknesses = [
  {
    title: "Irrevocable Subscription — No Exit",
    detail:
      "Once signed, the subscription cannot be revoked. The securities are restricted with no secondary market. Your $200K is locked with no liquidity path unless the Manager agrees to a buyback or the company is sold.",
    severity: "high" as const,
  },
  {
    title: "Post-Return Flip to 30/70 Against Investors",
    detail:
      "After capital is returned, distributions flip to 30% Class B / 70% Class A. The Manager captures the vast majority of long-term profits. If the venue is highly successful, Burton sees only 30% of the upside.",
    severity: "high" as const,
  },
  {
    title: "Manager Owns ALL Intellectual Property",
    detail:
      "People's Hospitality retains exclusive ownership of all IP and can use it in outside ventures. The brand, recipes, systems — everything built with your capital belongs to the Manager, not the company.",
    severity: "high" as const,
  },
  {
    title: "Unspecified Management Fee",
    detail:
      "The operating agreement does not clearly specify the management fee structure. The Manager could extract significant value through fees before any distributions reach Class B investors.",
    severity: "high" as const,
  },
  {
    title: "Guaranteed Payments to Manager Undefined",
    detail:
      "Guaranteed payments to the Manager and Class A members are not clearly defined, creating risk that the Manager receives guaranteed compensation regardless of profitability.",
    severity: "medium" as const,
  },
  {
    title: "Passive Investment — No Operational Control",
    detail:
      "Class B members are passive investors with no say in day-to-day operations, hiring, menu, location selection, or capital expenditure decisions. The Manager has unilateral operational control.",
    severity: "medium" as const,
  },
  {
    title: "NY Wage Theft Prevention Act Liability",
    detail:
      "As a top-10 member, Burton may face personal liability under New York's Wage Theft Prevention Act. Restaurant businesses carry inherent labor compliance risk, and this could expose Burton personally.",
    severity: "high" as const,
  },
  {
    title: "Restaurant Industry Failure Rate",
    detail:
      "Approximately 60% of NYC restaurants fail within the first year, and ~80% within five years. The statistical probability of total loss of capital is significant regardless of operator quality.",
    severity: "medium" as const,
  },
  {
    title: "No Financial Reporting Cadence Specified",
    detail:
      "The agreement does not establish mandatory quarterly or annual financial reporting to Class B investors. Without transparency, it's difficult to monitor how your capital is being deployed.",
    severity: "medium" as const,
  },
  {
    title: "Manager Can Use IP in Competing Ventures",
    detail:
      "Not only does the Manager own all IP, they can explicitly use it in outside ventures. The Manager could open competing restaurants using IP developed with your investment capital.",
    severity: "high" as const,
  },
];

// ─── Email Draft ─────────────────────────────────────────────────────
const emailDraft = `Hi Emmet,

Thank you for the opportunity to review the Penguin Flagship NYC LLC Subscription Agreement and Side Letter. We're interested in the concept and appreciate the detail in the documents.

Before we finalize, we have several questions that are important for us to make an informed decision:

1. MANAGEMENT FEES — What is the specific management fee structure? Is it a percentage of revenue, a flat annual fee, or calculated another way? Are there any other fees (asset management, acquisition, disposition) that the Manager or Class A will receive?

2. GUARANTEED PAYMENTS — Can you clarify the guaranteed payments to the Manager and Class A members? What are the amounts, frequency, and conditions? Are these paid before or after operating expenses?

3. FINANCIAL REPORTING — What financial reporting will Class B investors receive? We'd like to understand the cadence (monthly, quarterly, annual), the level of detail (P&L, balance sheet, cash flow), and whether reports will be audited or reviewed by an independent CPA.

4. USE OF PROCEEDS — Can you provide a detailed use-of-proceeds breakdown for the total capital raise? Specifically, what percentage goes to buildout, working capital, pre-opening costs, and reserves?

5. INTELLECTUAL PROPERTY — The agreement states the Manager owns all IP and can use it in outside ventures. Can you help us understand the rationale? Would you consider granting the Company a perpetual license to the IP developed using Company funds, or limiting outside use of Company-funded IP?

6. DISTRIBUTION WATERFALL — After capital is returned and the split flips to 30/70, is there any catch-up provision or preferred return for Class B investors? What is the projected timeline to return investor capital based on your financial model?

7. WAGE THEFT PREVENTION ACT — The agreement references potential liability under NY's Wage Theft Prevention Act for top-10 members. What specific protections or indemnifications are in place for passive Class B investors? Has counsel reviewed this exposure?

8. EXIT / LIQUIDITY — Given the irrevocable nature of the subscription and restricted securities, what liquidity options exist for Class B members? Is there a buyback provision, right of first refusal, or any anticipated liquidity event timeline?

9. OPERATING BUDGET & PROJECTIONS — Can you share the projected operating budget for Year 1 and Year 2, including expected revenue, operating costs, and projected distributions to Class B?

10. INSURANCE & LIABILITY — What insurance coverage will the Company maintain (general liability, liquor liability, D&O, employment practices)? Are Class B members named as additional insureds?

11. KEY PERSON PROVISION — Is there a key person clause tied to Emmet McDermott or People's Hospitality? If the Manager is unable to operate, what happens to the Company and investor capital?

12. CAPITAL CALLS — Does the operating agreement permit additional capital calls from Class B members? If so, under what circumstances and what are the consequences of not participating?

13. COMPARABLE DEALS — Can you share any comparable deals or track record from People's Hospitality's prior restaurant/bar ventures? We'd like to understand historical performance and investor outcomes.

We want to make sure this is structured for mutual success. Looking forward to your responses — happy to jump on a call to discuss.

Best regards,
Robert Burton
Sundown Investments LLC`;

// ─── Components ──────────────────────────────────────────────────────

function OverviewTab() {
  return (
    <div className="space-y-8">
      {/* Deal Terms */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Deal Terms</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {dealTerms.map((t) => (
            <div
              key={t.label}
              className="rounded-lg border border-white/10 bg-white/[0.02] p-4"
            >
              <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">
                {t.label}
              </div>
              <div className="text-sm font-medium text-gray-200">{t.value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Distribution Waterfall */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Distribution Waterfall</h2>
        <div className="space-y-3">
          {distributionWaterfall.map((w) => (
            <div
              key={w.phase}
              className="rounded-lg border border-white/10 bg-white/[0.02] p-4"
            >
              <div className="font-semibold text-sm text-gray-200 mb-2">{w.phase}</div>
              <div className="flex gap-4 mb-2">
                <span className="text-xs px-2 py-1 rounded bg-cyan-500/10 text-cyan-400 font-mono">
                  Class B: {w.classB}
                </span>
                <span className="text-xs px-2 py-1 rounded bg-orange-500/10 text-orange-400 font-mono">
                  Class A: {w.classA}
                </span>
              </div>
              <div className="text-xs text-gray-500">{w.note}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Side Letter */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Side Letter Terms</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {sideLetterTerms.map((t) => (
            <div
              key={t.label}
              className="rounded-lg border border-white/10 bg-white/[0.02] p-4"
            >
              <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">
                {t.label}
              </div>
              <div className="text-sm font-medium text-gray-200">{t.value}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function StrengthsTab() {
  return (
    <div className="space-y-3">
      {strengths.map((s, i) => (
        <div
          key={i}
          className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-5"
        >
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs font-bold mt-0.5">
              {i + 1}
            </div>
            <div>
              <h3 className="font-semibold text-sm text-emerald-300 mb-1">{s.title}</h3>
              <p className="text-xs text-gray-400 leading-relaxed">{s.detail}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function WeaknessesTab() {
  return (
    <div className="space-y-3">
      {weaknesses.map((w, i) => {
        const colors =
          w.severity === "high"
            ? { border: "border-red-500/20", bg: "bg-red-500/[0.03]", badge: "bg-red-500/20 text-red-400", title: "text-red-300" }
            : { border: "border-amber-500/20", bg: "bg-amber-500/[0.03]", badge: "bg-amber-500/20 text-amber-400", title: "text-amber-300" };
        return (
          <div key={i} className={`rounded-xl border ${colors.border} ${colors.bg} p-5`}>
            <div className="flex items-start gap-3">
              <div
                className={`flex-shrink-0 w-7 h-7 rounded-full ${colors.badge} flex items-center justify-center text-xs font-bold mt-0.5`}
              >
                {i + 1}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className={`font-semibold text-sm ${colors.title}`}>{w.title}</h3>
                  <span
                    className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${colors.badge} font-semibold`}
                  >
                    {w.severity}
                  </span>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">{w.detail}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmailDraftTab() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(emailDraft).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Draft Email to People's Hospitality</h2>
          <p className="text-xs text-gray-500 mt-1">
            Copy and paste this email to send to Emmet McDermott with critical due diligence questions.
          </p>
        </div>
        <button
          onClick={handleCopy}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            copied
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20"
          }`}
        >
          {copied ? (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Copy Email
            </>
          )}
        </button>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <pre className="whitespace-pre-wrap text-sm text-gray-300 font-sans leading-relaxed">
          {emailDraft}
        </pre>
      </div>
    </div>
  );
}

export default function PenguinNYC() {
  const [activeTab, setActiveTab] = useState<Tab>("Overview");

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-4">
        <Link to="/tools" className="hover:text-white transition-colors">
          Tools
        </Link>
        <span>/</span>
        <span className="text-gray-300">Penguin NYC Contract Review</span>
      </div>

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background: "#06b6d420", color: "#06b6d4" }}
        >
          <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
            />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-bold">Penguin NYC Contract Review</h1>
          <p className="text-gray-500 text-xs">
            Penguin Flagship NYC LLC — Subscription Agreement & Side Letter Analysis
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-white/10 pb-px">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === tab
                ? "text-cyan-400 border-b-2 border-cyan-400 bg-cyan-500/[0.05]"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "Overview" && <OverviewTab />}
      {activeTab === "Strengths" && <StrengthsTab />}
      {activeTab === "Weaknesses" && <WeaknessesTab />}
      {activeTab === "Email Draft" && <EmailDraftTab />}
    </div>
  );
}
