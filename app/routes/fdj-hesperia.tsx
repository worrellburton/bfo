import { useState } from "react";
import { Link } from "react-router";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - FDJ Hesperia Mission Control" }];
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// --- Reusable Components ---

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  return (
    <div className={`rounded-xl border ${isDark ? "border-white/10" : "border-gray-200"} ${isDark ? "bg-white/[0.02]" : "bg-white"} p-4`}>
      <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-lg font-bold tabular-nums" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

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

// --- Timeline ---

const timelineEvents = [
  { date: "Dec 14, 2016", title: "PSAs Signed", desc: "Purchase & Sale Agreements for both El Dorado and Comfort Suites executed", color: "#6366f1" },
  { date: "Jan 16, 2017", title: "First Amendments", desc: "Closing extended, additional $600K earnest money deposited for each property", color: "#6366f1" },
  { date: "Mar 27, 2017", title: "Second Amendments", desc: "Closing date extended to April 14, 2017", color: "#6366f1" },
  { date: "Apr 2017", title: "Closings Complete", desc: "Both properties closed. Master leases and option agreements executed with BWL", color: "#10b981" },
  { date: "Oct 5, 2018", title: "$1.4M Promissory Note", desc: "Additional promissory note signed, bringing total BWL loans to $4.4M", color: "#f59e0b" },
  { date: "Jul 1, 2021", title: "EDA PSA Signed", desc: "BWL to purchase El Dorado Apartments for $5,475,000", color: "#6366f1" },
  { date: "Dec 17, 2021", title: "EDA PSA Amendment", desc: "Closing deadline extended to February 28, 2022", color: "#f59e0b" },
  { date: "Apr 12, 2022", title: "Marriott Distribution", desc: "$270,000 distribution letter from TownePlace Suites by Marriott", color: "#10b981" },
];

function Timeline() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  return (
    <div className="relative pl-6">
      {/* Vertical line */}
      <div className={`absolute left-[7px] top-2 bottom-2 w-px ${isDark ? "bg-white/10" : "bg-gray-200"}`} />
      <div className="space-y-6">
        {timelineEvents.map((evt, i) => (
          <div key={i} className="relative flex gap-4">
            {/* Dot */}
            <div
              className={`absolute -left-6 top-1.5 w-[15px] h-[15px] rounded-full border-2 ${isDark ? "bg-black" : "bg-white"} z-10`}
              style={{ borderColor: evt.color }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-gray-500 tabular-nums mb-0.5">{evt.date}</div>
              <div className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-gray-700"}`}>{evt.title}</div>
              <div className="text-xs text-gray-500 mt-0.5">{evt.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Entity Map ---

function EntityMap() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const lineColor = isDark ? "bg-white/20" : "bg-gray-300";
  const arrowColor = isDark ? "text-white/20" : "text-gray-300";
  return (
    <div className="flex flex-col items-center gap-0">
      {/* Burton Family */}
      <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-5 py-2.5 text-center">
        <div className="text-[9px] text-gray-500 uppercase tracking-wider">Principals</div>
        <div className="text-sm font-semibold text-indigo-300">Robert & Claire Burton</div>
      </div>

      {/* Arrow down */}
      <div className={`w-px h-6 ${lineColor}`} />
      <svg className={`w-3 h-3 ${arrowColor} -mt-1`} fill="currentColor" viewBox="0 0 12 12"><path d="M6 9L1 4h10L6 9z" /></svg>

      {/* FDJ Hesperia */}
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-5 py-2.5 text-center -mt-1">
        <div className="text-[9px] text-gray-500 uppercase tracking-wider">Holding Entity</div>
        <div className="text-sm font-semibold text-emerald-300">FDJ Hesperia, LLC</div>
      </div>

      {/* Split into two children */}
      <div className={`w-px h-4 ${lineColor}`} />
      <div className="flex items-start gap-0 w-full max-w-lg">
        {/* Left branch */}
        <div className="flex-1 flex flex-col items-center">
          <div className={`h-px w-1/2 ${lineColor} self-end`} />
          <div className={`w-px h-4 ${lineColor}`} />
          <svg className={`w-3 h-3 ${arrowColor} -mt-1`} fill="currentColor" viewBox="0 0 12 12"><path d="M6 9L1 4h10L6 9z" /></svg>
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-center -mt-1">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Owner</div>
            <div className="text-xs font-semibold text-emerald-300">FDJ ELD, LLC</div>
            <div className="text-[10px] text-gray-500 mt-0.5">El Dorado Apartments</div>
          </div>
        </div>

        {/* Right branch */}
        <div className="flex-1 flex flex-col items-center">
          <div className={`h-px w-1/2 ${lineColor} self-start`} />
          <div className={`w-px h-4 ${lineColor}`} />
          <svg className={`w-3 h-3 ${arrowColor} -mt-1`} fill="currentColor" viewBox="0 0 12 12"><path d="M6 9L1 4h10L6 9z" /></svg>
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-center -mt-1">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Owner</div>
            <div className="text-xs font-semibold text-emerald-300">FDJ CFS, LLC</div>
            <div className="text-[10px] text-gray-500 mt-0.5">Comfort Suites Tucson</div>
          </div>
        </div>
      </div>

      {/* Connecting line down to BWL */}
      <div className={`w-px h-4 ${lineColor}`} />

      {/* Money flow indicators */}
      <div className="flex items-center gap-3 my-1">
        <div className="flex items-center gap-1 text-[9px]">
          <svg className="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
          <span className="text-emerald-400">$33,333/mo lease</span>
        </div>
        <div className="flex items-center gap-1 text-[9px]">
          <svg className="w-3 h-3 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
          <span className="text-amber-400">$4.4M loans</span>
        </div>
      </div>

      <div className={`w-px h-4 ${lineColor}`} />
      <svg className={`w-3 h-3 ${arrowColor} -mt-1`} fill="currentColor" viewBox="0 0 12 12"><path d="M6 9L1 4h10L6 9z" /></svg>

      {/* BWL */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-5 py-2.5 text-center -mt-1">
        <div className="text-[9px] text-gray-500 uppercase tracking-wider">Tenant / Operator</div>
        <div className="text-sm font-semibold text-amber-300">BWL Investments, LLC</div>
        <div className="text-[10px] text-gray-500 mt-0.5">Randal G. Dix / Transwest Properties</div>
      </div>

      {/* Marriott side note */}
      <div className={`mt-6 rounded-lg border ${isDark ? "border-white/10" : "border-gray-200"} ${isDark ? "bg-white/[0.02]" : "bg-white"} px-4 py-2 text-center`}>
        <div className="text-[9px] text-gray-500 uppercase tracking-wider">Separate Investment</div>
        <div className={`text-xs font-semibold ${isDark ? "text-gray-300" : "text-gray-700"}`}>TownePlace Suites by Marriott</div>
        <div className="text-[10px] text-gray-500 mt-0.5">30% ownership (15% Bob + 15% Claire)</div>
      </div>
    </div>
  );
}

// --- Property Card ---

function PropertyCard({
  name,
  type,
  units,
  address,
  purchasePrice,
  debt,
  debtRate,
  debtDue,
  monthlyLease,
}: {
  name: string;
  type: string;
  units: string;
  address: string;
  purchasePrice: number;
  debt: number;
  debtRate: string;
  debtDue: string;
  monthlyLease: number;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const equity = purchasePrice - debt;
  const ltv = (debt / purchasePrice) * 100;

  return (
    <div className={`rounded-xl border ${isDark ? "border-white/10" : "border-gray-200"} ${isDark ? "bg-white/[0.02]" : "bg-white"} p-5 flex flex-col`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-[9px] text-gray-500 uppercase tracking-wider">{type}</div>
          <div className={`text-base font-bold ${isDark ? "text-gray-100" : "text-gray-900"}`}>{name}</div>
          <div className="text-[10px] text-gray-500">{address}</div>
        </div>
        <div className={`text-[10px] ${isDark ? "text-gray-400" : "text-gray-500"} ${isDark ? "bg-white/5" : "bg-black/5"} px-2 py-0.5 rounded`}>{units}</div>
      </div>

      <div className="space-y-3 flex-1">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Purchase Price</div>
            <div className={`text-sm font-semibold tabular-nums ${isDark ? "text-gray-200" : "text-gray-700"}`}>${fmt(purchasePrice)}</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Outstanding Debt</div>
            <div className="text-sm font-semibold tabular-nums text-amber-400">${fmt(debt)}</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Monthly Lease</div>
            <div className="text-sm font-semibold tabular-nums text-emerald-400">${fmt(monthlyLease)}</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Annual Lease</div>
            <div className={`text-sm font-semibold tabular-nums ${isDark ? "text-gray-200" : "text-gray-700"}`}>${fmt(monthlyLease * 12)}</div>
          </div>
        </div>

        {/* Debt bar */}
        <div>
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-gray-500">LTV Ratio</span>
            <span className={`${isDark ? "text-gray-400" : "text-gray-500"} tabular-nums`}>{ltv.toFixed(1)}%</span>
          </div>
          <div className={`h-2 ${isDark ? "bg-white/5" : "bg-black/5"} rounded-full overflow-hidden`}>
            <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-600 transition-all duration-700" style={{ width: `${ltv}%` }} />
          </div>
        </div>

        <div className={`grid grid-cols-2 gap-3 pt-1 border-t ${isDark ? "border-white/5" : "border-gray-100"}`}>
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Interest Rate</div>
            <div className={`text-xs font-semibold tabular-nums ${isDark ? "text-gray-300" : "text-gray-700"}`}>{debtRate}</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Maturity</div>
            <div className={`text-xs font-semibold ${isDark ? "text-gray-300" : "text-gray-700"}`}>{debtDue}</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Equity</div>
            <div className="text-xs font-semibold tabular-nums text-emerald-400">${fmt(equity)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Tab Navigation ---

const tabs = [
  { label: "Overview", href: "/tools/fdj-hesperia", active: true },
  { label: "Financials", href: "/tools/fdj-hesperia/financials", active: false },
  { label: "Documents", href: "/tools/fdj-hesperia/documents", active: false },
  { label: "Advisory", href: "/tools/fdj-hesperia/advisory", active: false },
  { label: "Tax", href: "/tools/fdj-hesperia/tax", active: false },
];

// --- Main Component ---

export default function FDJHesperia() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [showPublicLink, setShowPublicLink] = useState(false);
  const [copied, setCopied] = useState(false);

  function getOrCreateToken() {
    let token = localStorage.getItem("fdj-public-token");
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem("fdj-public-token", token);
    }
    return token;
  }

  function handleCopyLink() {
    const token = getOrCreateToken();
    const url = `${window.location.origin}/public/fdj-hesperia?token=${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="max-w-6xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-4">
        <Link to="/tools" className={`${isDark ? "hover:text-white" : "hover:text-gray-900"} transition-colors`}>Tools</Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className={isDark ? "text-gray-300" : "text-gray-700"}>FDJ Hesperia</span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">FDJ Hesperia</h1>
          <p className="text-gray-500 text-sm">Burton Family Investment Mission Control</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            onClick={() => setShowPublicLink(true)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border ${isDark ? "border-white/10" : "border-gray-200"} ${isDark ? "bg-white/[0.03]" : "bg-white"} ${isDark ? "text-gray-300" : "text-gray-700"} ${isDark ? "hover:bg-white/[0.06]" : "hover:bg-gray-100"} ${isDark ? "hover:text-white" : "hover:text-gray-900"} transition-colors cursor-pointer`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Create Public Link
          </button>
          <StatusBadge status="amber" label="Monitoring" />
          <div className="text-[10px] text-gray-500 w-full sm:w-auto">
            Master leases expire <span className="text-amber-400 font-medium">Apr 30, 2027</span>
          </div>
        </div>
      </div>

      {/* Public Link Modal */}
      {showPublicLink && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => setShowPublicLink(false)}
        >
          <div className={`absolute inset-0 ${isDark ? "bg-black/60" : "bg-black/30"} backdrop-blur-sm`} />
          <div
            className={`relative ${isDark ? "bg-[#111]" : "bg-white"} border ${isDark ? "border-white/10" : "border-gray-200"} rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setShowPublicLink(false)}
              className={`absolute top-4 right-4 text-gray-500 ${isDark ? "hover:text-white" : "hover:text-gray-900"} transition-colors cursor-pointer`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              </div>
              <div>
                <h3 className={`text-sm font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Public Link</h3>
                <p className="text-[11px] text-gray-500">Share a read-only summary</p>
              </div>
            </div>

            <div className={`rounded-lg ${isDark ? "bg-white/[0.04]" : "bg-black/5"} border ${isDark ? "border-white/10" : "border-gray-200"} p-3 mb-3`}>
              <div className={`text-xs ${isDark ? "text-gray-300" : "text-gray-700"} font-mono break-all`}>
                {typeof window !== "undefined" ? `${window.location.origin}/public/fdj-hesperia?token=${getOrCreateToken()}` : ""}
              </div>
            </div>

            <button
              onClick={handleCopyLink}
              className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                copied
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : isDark
                    ? "bg-white/10 text-white border border-white/10 hover:bg-white/15"
                    : "bg-gray-100 text-gray-900 border border-gray-200 hover:bg-gray-200"
              }`}
            >
              {copied ? "Copied!" : "Copy Link"}
            </button>

            <p className="text-[10px] text-gray-500 mt-3 text-center leading-relaxed">
              This link shows a read-only summary. No login required.
            </p>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className={`flex gap-1 border-b ${isDark ? "border-white/10" : "border-gray-200"} mb-8 overflow-x-auto -mx-1 px-1 scrollbar-hide`}>
        {tabs.map((tab) => (
          <Link
            key={tab.label}
            to={tab.href}
            className={`px-4 py-2 text-sm font-medium transition-colors relative whitespace-nowrap shrink-0 ${
              tab.active
                ? isDark ? "text-white" : "text-gray-900"
                : isDark ? "text-gray-500 hover:text-gray-300" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
            {tab.active && (
              <div className="absolute bottom-0 left-0 right-0 h-px bg-emerald-500" />
            )}
          </Link>
        ))}
      </div>

      {/* Deal Health Status Bar */}
      <div className={`rounded-xl border ${isDark ? "border-white/10" : "border-gray-200"} ${isDark ? "bg-white/[0.02]" : "bg-white"} p-4 mb-8 flex flex-wrap items-center gap-4`}>
        <div className="flex items-center gap-2">
          <div className="text-[9px] text-gray-500 uppercase tracking-wider">Deal Health</div>
          <StatusBadge status="green" label="Active" />
        </div>
        <div className={`h-4 w-px ${isDark ? "bg-white/10" : "bg-gray-200"} hidden sm:block`} />
        <div className="flex items-center gap-2">
          <div className="text-[9px] text-gray-500 uppercase tracking-wider">Cash Flow</div>
          <StatusBadge status="green" label="Current" />
        </div>
        <div className={`h-4 w-px ${isDark ? "bg-white/10" : "bg-gray-200"} hidden sm:block`} />
        <div className="flex items-center gap-2">
          <div className="text-[9px] text-gray-500 uppercase tracking-wider">EDA Sale</div>
          <StatusBadge status="amber" label="Pending" />
        </div>
        <div className={`h-4 w-px ${isDark ? "bg-white/10" : "bg-gray-200"} hidden sm:block`} />
        <div className="flex items-center gap-2">
          <div className="text-[9px] text-gray-500 uppercase tracking-wider">Debt</div>
          <StatusBadge status="amber" label="Review" />
        </div>
      </div>

      {/* Key Metrics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        <StatCard
          label="Total Investment"
          value="$12,848,000"
          sub="Both properties combined"
        />
        <StatCard
          label="Net Cash Invested"
          value="$2,600,000"
          sub="After $4.4M loan back"
          color="#6366f1"
        />
        <StatCard
          label="Total Cash Received"
          value="$1,577,042"
          sub="As of April 2022"
          color="#10b981"
        />
        <StatCard
          label="Monthly Income"
          value="$33,333"
          sub="$17,333 on net investment"
          color="#10b981"
        />
        <StatCard
          label="Tax Savings"
          value="~$3,200,000"
          sub="1031 exchange benefit"
          color="#10b981"
        />
        <StatCard
          label="Marriott Ownership"
          value="30%"
          sub="15% Bob + 15% Claire"
          color="#6366f1"
        />
      </div>

      {/* Properties Overview */}
      <h2 className={`text-sm font-semibold ${isDark ? "text-gray-400" : "text-gray-500"} uppercase tracking-wider mb-4`}>Properties</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        <PropertyCard
          name="El Dorado Apartments"
          type="Multifamily"
          units="96 Units"
          address="2440 E. Glenn St, Tucson, AZ"
          purchasePrice={5475000}
          debt={2500000}
          debtRate="4.86%"
          debtDue="Nov 2025"
          monthlyLease={13167}
        />
        <PropertyCard
          name="Comfort Suites Tucson"
          type="Hospitality"
          units="86 Rooms"
          address="515 W. Auto Mall Dr, Tucson, AZ"
          purchasePrice={7273000}
          debt={3350000}
          debtRate="5.50%"
          debtDue="May 2027"
          monthlyLease={20167}
        />
      </div>

      {/* Deal Structure + Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        {/* Entity Map */}
        <div className={`rounded-xl border ${isDark ? "border-white/10" : "border-gray-200"} ${isDark ? "bg-white/[0.02]" : "bg-white"} p-5`}>
          <h3 className={`text-sm font-semibold ${isDark ? "text-gray-400" : "text-gray-500"} uppercase tracking-wider mb-5`}>Deal Structure</h3>
          <EntityMap />
        </div>

        {/* Timeline */}
        <div className={`rounded-xl border ${isDark ? "border-white/10" : "border-gray-200"} ${isDark ? "bg-white/[0.02]" : "bg-white"} p-5`}>
          <h3 className={`text-sm font-semibold ${isDark ? "text-gray-400" : "text-gray-500"} uppercase tracking-wider mb-5`}>Key Timeline</h3>
          <Timeline />
        </div>
      </div>

      {/* Cash Flow Summary */}
      <div className={`rounded-xl border ${isDark ? "border-white/10" : "border-gray-200"} ${isDark ? "bg-white/[0.02]" : "bg-white"} p-5 mb-8`}>
        <h3 className={`text-sm font-semibold ${isDark ? "text-gray-400" : "text-gray-500"} uppercase tracking-wider mb-4`}>Cash Flow Received (as of April 2022)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Comfort Suites</div>
            <div className="text-lg font-bold tabular-nums text-emerald-400">$771,460</div>
            <div className={`mt-2 h-2 ${isDark ? "bg-white/5" : "bg-black/5"} rounded-full overflow-hidden`}>
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600" style={{ width: `${(771460 / 1577042) * 100}%` }} />
            </div>
            <div className="text-[10px] text-gray-500 mt-1 tabular-nums">48.9% of total</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">El Dorado</div>
            <div className="text-lg font-bold tabular-nums text-emerald-400">$535,582</div>
            <div className={`mt-2 h-2 ${isDark ? "bg-white/5" : "bg-black/5"} rounded-full overflow-hidden`}>
              <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-600" style={{ width: `${(535582 / 1577042) * 100}%` }} />
            </div>
            <div className="text-[10px] text-gray-500 mt-1 tabular-nums">34.0% of total</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Marriott Distribution</div>
            <div className="text-lg font-bold tabular-nums text-emerald-400">$270,000</div>
            <div className={`mt-2 h-2 ${isDark ? "bg-white/5" : "bg-black/5"} rounded-full overflow-hidden`}>
              <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-600" style={{ width: `${(270000 / 1577042) * 100}%` }} />
            </div>
            <div className="text-[10px] text-gray-500 mt-1 tabular-nums">17.1% of total</div>
          </div>
        </div>
      </div>

      {/* Key Parties */}
      <div className={`rounded-xl border ${isDark ? "border-white/10" : "border-gray-200"} ${isDark ? "bg-white/[0.02]" : "bg-white"} p-5 mb-8`}>
        <h3 className={`text-sm font-semibold ${isDark ? "text-gray-400" : "text-gray-500"} uppercase tracking-wider mb-4`}>Key Parties</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Buyers / Investors</div>
            <div className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-gray-700"}`}>Robert L. Burton</div>
            <div className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-gray-700"}`}>Claire Burton</div>
            <div className="text-[10px] text-gray-500 mt-1">Via FDJ Hesperia, LLC</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Operator / Tenant</div>
            <div className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-gray-700"}`}>Randal G. Dix</div>
            <div className="text-[10px] text-gray-500 mt-1">BWL Investments, LLC</div>
            <div className="text-[10px] text-gray-500">Transwest Properties</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Key Agreements</div>
            <div className={`text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}>Master Leases (exp. Apr 30, 2027)</div>
            <div className={`text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}>Option Agreements</div>
            <div className={`text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}>Promissory Notes ($4.4M)</div>
            <div className={`text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}>EDA PSA (Jul 2021)</div>
          </div>
        </div>
      </div>

    </div>
  );
}
