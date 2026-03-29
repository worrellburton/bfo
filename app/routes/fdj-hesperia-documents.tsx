import { useState } from "react";
import { Link } from "react-router";

export function meta() {
  return [{ title: "BFO - FDJ Hesperia Documents" }];
}

// --- Types ---

type Category = "all" | "comfort-suites" | "el-dorado" | "el-dorado-sale" | "financial";
type DocType = "PSA" | "Amendment" | "Master Lease" | "Option" | "Note" | "Letter" | "Summary";
type AgreementStatus = "green" | "amber" | "red";

interface Document {
  id: number;
  name: string;
  category: Exclude<Category, "all">;
  date: string;
  docType: DocType;
  parties: string[];
  keyTerms: string[];
}

// --- Data ---

const documents: Document[] = [
  {
    id: 1,
    name: "Comfort Suites PSA",
    category: "comfort-suites",
    date: "Dec 14, 2016",
    docType: "PSA",
    parties: ["CFS Tucson LLC (Seller)", "FDJ Hesperia LLC (Buyer)"],
    keyTerms: [
      "86 hotel rooms - Purchase price: $7,273,000",
      "Earnest money: $800,000 - Non-contingent",
      "Closing by Jan 31, 2017 - Escrow: Title Security Agency",
    ],
  },
  {
    id: 2,
    name: "Comfort Suites PSA - First Amendment",
    category: "comfort-suites",
    date: "Jan 16, 2017",
    docType: "Amendment",
    parties: ["CFS Tucson LLC", "FDJ Hesperia LLC"],
    keyTerms: [
      "Extended closing 60 days to March 31, 2017",
      "Additional $600,000 earnest money deposit",
      "Non-refundable",
    ],
  },
  {
    id: 3,
    name: "Comfort Suites PSA - Second Amendment",
    category: "comfort-suites",
    date: "Mar 27, 2017",
    docType: "Amendment",
    parties: ["CFS Tucson LLC", "FDJ Hesperia LLC"],
    keyTerms: [
      "Extended closing to April 14, 2017",
    ],
  },
  {
    id: 4,
    name: "Master Lease - FDJ BWL CFS",
    category: "comfort-suites",
    date: "Apr 20, 2017",
    docType: "Master Lease",
    parties: ["FDJ CFS LLC (Owner, Robert Burton)", "BWL Investments LLC (Tenant, Randal Dix / ANG Trust)"],
    keyTerms: [
      "Triple net lease - Expires April 30, 2027",
      "Rent: $20,167/mo ($242,000/yr) - Underlying loan: $3,350,000",
      "Property mgr: Transwest Properties (max 5% gross) - Default interest: 8%",
    ],
  },
  {
    id: 5,
    name: "Option Agreement - FDJ BWL CFS",
    category: "comfort-suites",
    date: "Apr 20, 2017",
    docType: "Option",
    parties: ["FDJ CFS LLC", "BWL Investments LLC"],
    keyTerms: [
      "Call option: BWL purchase at $7,273,000 (Apr 21, 2018 - Apr 30, 2027)",
      "Put option: FDJ force sale (Apr 21, 2020 - Apr 30, 2030)",
      "AS-IS basis",
    ],
  },
  {
    id: 6,
    name: "El Dorado PSA",
    category: "el-dorado",
    date: "Dec 14, 2016",
    docType: "PSA",
    parties: ["El Dorado of TUC LLC (Seller)", "FDJ Hesperia LLC (Buyer)"],
    keyTerms: [
      "96 apartments - Purchase price: $5,475,000",
      "Earnest money: $600,000",
      "Mortgage assumption: $2,500,000",
    ],
  },
  {
    id: 7,
    name: "El Dorado PSA - First Amendment",
    category: "el-dorado",
    date: "Jan 16, 2017",
    docType: "Amendment",
    parties: ["El Dorado of TUC LLC", "FDJ Hesperia LLC"],
    keyTerms: [
      "Extended closing 60 days to March 31, 2017",
      "Additional $600,000 earnest money",
    ],
  },
  {
    id: 8,
    name: "El Dorado PSA - Second Amendment",
    category: "el-dorado",
    date: "Mar 27, 2017",
    docType: "Amendment",
    parties: ["El Dorado of TUC LLC", "FDJ Hesperia LLC"],
    keyTerms: [
      "Extended closing to April 14, 2017",
    ],
  },
  {
    id: 9,
    name: "Master Lease - FDJ BWL ELD",
    category: "el-dorado",
    date: "Apr 21, 2017",
    docType: "Master Lease",
    parties: ["FDJ ELD LLC (Owner)", "BWL Investments LLC (Tenant)"],
    keyTerms: [
      "Triple net lease - Expires April 30, 2027",
      "Rent: $13,167/mo ($158,000/yr) - Underlying loan: $2,500,000",
      "Property mgr: Transwest Properties",
    ],
  },
  {
    id: 10,
    name: "Option Agreement - FDJ BWL ELD",
    category: "el-dorado",
    date: "Apr 21, 2017",
    docType: "Option",
    parties: ["FDJ ELD LLC", "BWL Investments LLC"],
    keyTerms: [
      "Call option: BWL purchase at $5,475,000 (Apr 21, 2018 - Apr 30, 2027)",
      "Put option: FDJ force sale (Apr 21, 2020 - Apr 30, 2030)",
    ],
  },
  {
    id: 11,
    name: "EDA PSA 2021",
    category: "el-dorado-sale",
    date: "Jun 29, 2021",
    docType: "PSA",
    parties: ["FDJ ELD LLC (Seller)", "BWL Investments LLC (Buyer)"],
    keyTerms: [
      "Price: $5,475,000 - Earnest: $50,000",
      "Mortgage assumption: $2,500,000 - Cash at closing: $2,925,000",
      "Non-contingent - Closing 30 days after lender approval or by Dec 31, 2021",
    ],
  },
  {
    id: 12,
    name: "EDA PSA Amendment",
    category: "el-dorado-sale",
    date: "Dec 17, 2021",
    docType: "Amendment",
    parties: ["FDJ ELD LLC", "BWL Investments LLC"],
    keyTerms: [
      "Extended closing to February 28, 2022",
      "Escrow fees paid by buyer",
    ],
  },
  {
    id: 13,
    name: "Burton $1.4M Promissory Note",
    category: "financial",
    date: "Oct 5, 2018",
    docType: "Note",
    parties: ["Robert Burton (Lender)", "BWL Investments LLC (Borrower)"],
    keyTerms: [
      "Principal: $1,400,000 at 3% interest",
      "Part of total $4.4M in loans to BWL",
    ],
  },
  {
    id: 14,
    name: "Burton Letter 4-12-2022",
    category: "financial",
    date: "Apr 12, 2022",
    docType: "Letter",
    parties: ["Randal Dix (From)", "Robert Burton (To)"],
    keyTerms: [
      "Summary of deal performance and cash flows received",
      "Marriott ownership details and distribution info",
    ],
  },
  {
    id: 15,
    name: "Burton Summary Sheet 4-2021",
    category: "financial",
    date: "Apr 2021",
    docType: "Summary",
    parties: ["Internal document"],
    keyTerms: [
      "Property values, income, expenses, NOI for both properties",
      "Cash flow and debt details",
    ],
  },
];

const categoryTabs: { key: Category; label: string; count: number }[] = [
  { key: "all", label: "All Documents", count: documents.length },
  { key: "comfort-suites", label: "Comfort Suites", count: documents.filter((d) => d.category === "comfort-suites").length },
  { key: "el-dorado", label: "El Dorado", count: documents.filter((d) => d.category === "el-dorado").length },
  { key: "el-dorado-sale", label: "El Dorado Sale", count: documents.filter((d) => d.category === "el-dorado-sale").length },
  { key: "financial", label: "Financial", count: documents.filter((d) => d.category === "financial").length },
];

const agreementStatuses: { name: string; status: AgreementStatus; label: string }[] = [
  { name: "Comfort Suites PSA", status: "green", label: "Closed" },
  { name: "El Dorado PSA", status: "green", label: "Closed" },
  { name: "CFS Master Lease", status: "amber", label: "Active - Expires Apr 2027" },
  { name: "ELD Master Lease", status: "amber", label: "Active - Expires Apr 2027" },
  { name: "CFS Option Agreement", status: "amber", label: "Active" },
  { name: "ELD Option Agreement", status: "amber", label: "Active" },
  { name: "EDA PSA 2021", status: "amber", label: "Pending Close" },
  { name: "Promissory Notes", status: "amber", label: "Outstanding" },
];

const keyDates = [
  { date: "Nov 2025", label: "El Dorado Debt Maturity", urgency: "red" as const },
  { date: "May 2027", label: "Comfort Suites Debt Maturity", urgency: "amber" as const },
  { date: "Apr 30, 2027", label: "Master Leases Expire", urgency: "amber" as const },
  { date: "Apr 30, 2027", label: "Call Options Expire", urgency: "amber" as const },
  { date: "Apr 30, 2030", label: "Put Options Expire", urgency: "green" as const },
];

// --- Components ---

const categoryColors: Record<Exclude<Category, "all">, { bg: string; text: string; border: string }> = {
  "comfort-suites": { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/30" },
  "el-dorado": { bg: "bg-purple-500/15", text: "text-purple-400", border: "border-purple-500/30" },
  "el-dorado-sale": { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/30" },
  financial: { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30" },
};

const categoryLabels: Record<Exclude<Category, "all">, string> = {
  "comfort-suites": "Comfort Suites",
  "el-dorado": "El Dorado",
  "el-dorado-sale": "EDA Sale",
  financial: "Financial",
};

function CategoryBadge({ category }: { category: Exclude<Category, "all"> }) {
  const c = categoryColors[category];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wider border ${c.bg} ${c.text} ${c.border}`}>
      {categoryLabels[category]}
    </span>
  );
}

function DocTypeIcon({ docType }: { docType: DocType }) {
  const iconClass = "w-5 h-5 text-gray-500";
  switch (docType) {
    case "PSA":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    case "Amendment":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      );
    case "Master Lease":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      );
    case "Option":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      );
    case "Note":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case "Letter":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      );
    case "Summary":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
  }
}

function DocTypeBadge({ docType }: { docType: DocType }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider bg-white/5 text-gray-400 border border-white/5">
      {docType}
    </span>
  );
}

function DocumentCard({ doc }: { doc: Document }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 hover:border-white/25 transition-colors group">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-white/[0.03] border border-white/5 group-hover:border-white/10 transition-colors">
            <DocTypeIcon docType={doc.docType} />
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-200 group-hover:text-white transition-colors">{doc.name}</div>
            <div className="text-[10px] text-gray-500 tabular-nums mt-0.5">{doc.date}</div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <CategoryBadge category={doc.category} />
        <DocTypeBadge docType={doc.docType} />
      </div>

      <div className="space-y-1.5 mb-3">
        {doc.keyTerms.map((term, i) => (
          <div key={i} className="flex items-start gap-2 text-[11px] text-gray-400">
            <span className="text-gray-600 mt-0.5 shrink-0">&#8226;</span>
            <span>{term}</span>
          </div>
        ))}
      </div>

      <div className="border-t border-white/5 pt-3">
        <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Parties</div>
        <div className="text-[11px] text-gray-400">
          {doc.parties.join(" / ")}
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: AgreementStatus }) {
  const colors = {
    green: "bg-emerald-400",
    amber: "bg-amber-400",
    red: "bg-red-400",
  };
  return <span className={`w-2 h-2 rounded-full ${colors[status]} shrink-0`} />;
}

// --- Tab Navigation ---

const tabs = [
  { label: "Overview", href: "/tools/fdj-hesperia", active: false },
  { label: "Financials", href: "/tools/fdj-hesperia/financials", active: false },
  { label: "Documents", href: "/tools/fdj-hesperia/documents", active: true },
  { label: "Advisory", href: "/tools/fdj-hesperia/advisory", active: false },
];

// --- Main Component ---

export default function FDJHesperiaDocuments() {
  const [activeCategory, setActiveCategory] = useState<Category>("all");

  const filtered = activeCategory === "all" ? documents : documents.filter((d) => d.category === activeCategory);

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
        <span className="text-gray-300">Documents</span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Documents Vault</h1>
          <p className="text-gray-500 text-sm">{documents.length} documents across {categoryTabs.length - 1} categories</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-white/10 mb-8">
        {tabs.map((tab) => (
          <Link
            key={tab.label}
            to={tab.href}
            className={`px-4 py-2 text-sm font-medium transition-colors relative ${
              tab.active
                ? "text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab.label}
            {tab.active && (
              <div className="absolute bottom-0 left-0 right-0 h-px bg-emerald-500" />
            )}
          </Link>
        ))}
      </div>

      {/* Category Filter Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {categoryTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveCategory(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
              activeCategory === tab.key
                ? "bg-white/10 text-white border-white/20"
                : "bg-white/[0.02] text-gray-500 border-white/5 hover:border-white/15 hover:text-gray-300"
            }`}
          >
            {tab.label}
            <span className={`ml-1.5 text-[10px] tabular-nums ${activeCategory === tab.key ? "text-gray-300" : "text-gray-600"}`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Document Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        {filtered.map((doc) => (
          <DocumentCard key={doc.id} doc={doc} />
        ))}
      </div>

      {/* Agreement Status Tracker + Key Dates */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        {/* Agreement Status Tracker */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Agreement Status Tracker</h3>
          <div className="space-y-3">
            {agreementStatuses.map((a, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <StatusDot status={a.status} />
                  <span className="text-sm text-gray-300">{a.name}</span>
                </div>
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                  a.status === "green" ? "text-emerald-400" : a.status === "amber" ? "text-amber-400" : "text-red-400"
                }`}>
                  {a.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Key Dates */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Key Dates from Documents</h3>
          <div className="space-y-0">
            {keyDates.map((kd, i) => {
              const urgencyColors = {
                red: { dot: "bg-red-400", dateBg: "bg-red-500/10", dateText: "text-red-400", dateBorder: "border-red-500/20" },
                amber: { dot: "bg-amber-400", dateBg: "bg-amber-500/10", dateText: "text-amber-400", dateBorder: "border-amber-500/20" },
                green: { dot: "bg-emerald-400", dateBg: "bg-emerald-500/10", dateText: "text-emerald-400", dateBorder: "border-emerald-500/20" },
              };
              const uc = urgencyColors[kd.urgency];
              return (
                <div key={i} className="flex items-center gap-4 py-3 border-b border-white/5 last:border-b-0">
                  <div className={`px-3 py-1.5 rounded-lg text-xs font-semibold tabular-nums border ${uc.dateBg} ${uc.dateText} ${uc.dateBorder} min-w-[110px] text-center`}>
                    {kd.date}
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${uc.dot}`} />
                    <span className="text-sm text-gray-300">{kd.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
