import { useState } from "react";
import { Link } from "react-router";

export function meta() {
  return [{ title: "BFO - FDJ Hesperia Mission Control" }];
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// --- Reusable Components ---

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
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
  return (
    <div className="relative pl-6">
      {/* Vertical line */}
      <div className="absolute left-[7px] top-2 bottom-2 w-px bg-white/10" />
      <div className="space-y-6">
        {timelineEvents.map((evt, i) => (
          <div key={i} className="relative flex gap-4">
            {/* Dot */}
            <div
              className="absolute -left-6 top-1.5 w-[15px] h-[15px] rounded-full border-2 bg-black z-10"
              style={{ borderColor: evt.color }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-gray-500 tabular-nums mb-0.5">{evt.date}</div>
              <div className="text-sm font-semibold text-gray-200">{evt.title}</div>
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
  return (
    <div className="flex flex-col items-center gap-0">
      {/* Burton Family */}
      <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-5 py-2.5 text-center">
        <div className="text-[9px] text-gray-500 uppercase tracking-wider">Principals</div>
        <div className="text-sm font-semibold text-indigo-300">Robert & Claire Burton</div>
      </div>

      {/* Arrow down */}
      <div className="w-px h-6 bg-white/20" />
      <svg className="w-3 h-3 text-white/20 -mt-1" fill="currentColor" viewBox="0 0 12 12"><path d="M6 9L1 4h10L6 9z" /></svg>

      {/* FDJ Hesperia */}
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-5 py-2.5 text-center -mt-1">
        <div className="text-[9px] text-gray-500 uppercase tracking-wider">Holding Entity</div>
        <div className="text-sm font-semibold text-emerald-300">FDJ Hesperia, LLC</div>
      </div>

      {/* Split into two children */}
      <div className="w-px h-4 bg-white/20" />
      <div className="flex items-start gap-0 w-full max-w-lg">
        {/* Left branch */}
        <div className="flex-1 flex flex-col items-center">
          <div className="h-px w-1/2 bg-white/20 self-end" />
          <div className="w-px h-4 bg-white/20" />
          <svg className="w-3 h-3 text-white/20 -mt-1" fill="currentColor" viewBox="0 0 12 12"><path d="M6 9L1 4h10L6 9z" /></svg>
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-center -mt-1">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Owner</div>
            <div className="text-xs font-semibold text-emerald-300">FDJ ELD, LLC</div>
            <div className="text-[10px] text-gray-500 mt-0.5">El Dorado Apartments</div>
          </div>
        </div>

        {/* Right branch */}
        <div className="flex-1 flex flex-col items-center">
          <div className="h-px w-1/2 bg-white/20 self-start" />
          <div className="w-px h-4 bg-white/20" />
          <svg className="w-3 h-3 text-white/20 -mt-1" fill="currentColor" viewBox="0 0 12 12"><path d="M6 9L1 4h10L6 9z" /></svg>
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-center -mt-1">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Owner</div>
            <div className="text-xs font-semibold text-emerald-300">FDJ CFS, LLC</div>
            <div className="text-[10px] text-gray-500 mt-0.5">Comfort Suites Tucson</div>
          </div>
        </div>
      </div>

      {/* Connecting line down to BWL */}
      <div className="w-px h-4 bg-white/20" />

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

      <div className="w-px h-4 bg-white/20" />
      <svg className="w-3 h-3 text-white/20 -mt-1" fill="currentColor" viewBox="0 0 12 12"><path d="M6 9L1 4h10L6 9z" /></svg>

      {/* BWL */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-5 py-2.5 text-center -mt-1">
        <div className="text-[9px] text-gray-500 uppercase tracking-wider">Tenant / Operator</div>
        <div className="text-sm font-semibold text-amber-300">BWL Investments, LLC</div>
        <div className="text-[10px] text-gray-500 mt-0.5">Randal G. Dix / Transwest Properties</div>
      </div>

      {/* Marriott side note */}
      <div className="mt-6 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-2 text-center">
        <div className="text-[9px] text-gray-500 uppercase tracking-wider">Separate Investment</div>
        <div className="text-xs font-semibold text-gray-300">TownePlace Suites by Marriott</div>
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
  const equity = purchasePrice - debt;
  const ltv = (debt / purchasePrice) * 100;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 flex flex-col">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-[9px] text-gray-500 uppercase tracking-wider">{type}</div>
          <div className="text-base font-bold text-gray-100">{name}</div>
          <div className="text-[10px] text-gray-500">{address}</div>
        </div>
        <div className="text-[10px] text-gray-400 bg-white/5 px-2 py-0.5 rounded">{units}</div>
      </div>

      <div className="space-y-3 flex-1">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Purchase Price</div>
            <div className="text-sm font-semibold tabular-nums text-gray-200">${fmt(purchasePrice)}</div>
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
            <div className="text-sm font-semibold tabular-nums text-gray-200">${fmt(monthlyLease * 12)}</div>
          </div>
        </div>

        {/* Debt bar */}
        <div>
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-gray-500">LTV Ratio</span>
            <span className="text-gray-400 tabular-nums">{ltv.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-600 transition-all duration-700" style={{ width: `${ltv}%` }} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-1 border-t border-white/5">
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Interest Rate</div>
            <div className="text-xs font-semibold tabular-nums text-gray-300">{debtRate}</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Maturity</div>
            <div className="text-xs font-semibold text-gray-300">{debtDue}</div>
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
];

// --- Main Component ---

export default function FDJHesperia() {
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
        <Link to="/tools" className="hover:text-white transition-colors">Tools</Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-gray-300">FDJ Hesperia</span>
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
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 bg-white/[0.03] text-gray-300 hover:bg-white/[0.06] hover:text-white transition-colors cursor-pointer"
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
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setShowPublicLink(false)}
              className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors cursor-pointer"
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
                <h3 className="text-sm font-bold text-white">Public Link</h3>
                <p className="text-[11px] text-gray-500">Share a read-only summary</p>
              </div>
            </div>

            <div className="rounded-lg bg-white/[0.04] border border-white/10 p-3 mb-3">
              <div className="text-xs text-gray-300 font-mono break-all">
                {typeof window !== "undefined" ? `${window.location.origin}/public/fdj-hesperia?token=${getOrCreateToken()}` : ""}
              </div>
            </div>

            <button
              onClick={handleCopyLink}
              className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                copied
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-white/10 text-white border border-white/10 hover:bg-white/15"
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
      <div className="flex gap-1 border-b border-white/10 mb-8 overflow-x-auto -mx-1 px-1 scrollbar-hide">
        {tabs.map((tab) => (
          <Link
            key={tab.label}
            to={tab.href}
            className={`px-4 py-2 text-sm font-medium transition-colors relative whitespace-nowrap shrink-0 ${
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

      {/* Deal Health Status Bar */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-8 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="text-[9px] text-gray-500 uppercase tracking-wider">Deal Health</div>
          <StatusBadge status="green" label="Active" />
        </div>
        <div className="h-4 w-px bg-white/10 hidden sm:block" />
        <div className="flex items-center gap-2">
          <div className="text-[9px] text-gray-500 uppercase tracking-wider">Cash Flow</div>
          <StatusBadge status="green" label="Current" />
        </div>
        <div className="h-4 w-px bg-white/10 hidden sm:block" />
        <div className="flex items-center gap-2">
          <div className="text-[9px] text-gray-500 uppercase tracking-wider">EDA Sale</div>
          <StatusBadge status="amber" label="Pending" />
        </div>
        <div className="h-4 w-px bg-white/10 hidden sm:block" />
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
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Properties</h2>
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
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-5">Deal Structure</h3>
          <EntityMap />
        </div>

        {/* Timeline */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-5">Key Timeline</h3>
          <Timeline />
        </div>
      </div>

      {/* Cash Flow Summary */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 mb-8">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Cash Flow Received (as of April 2022)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Comfort Suites</div>
            <div className="text-lg font-bold tabular-nums text-emerald-400">$771,460</div>
            <div className="mt-2 h-2 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600" style={{ width: `${(771460 / 1577042) * 100}%` }} />
            </div>
            <div className="text-[10px] text-gray-500 mt-1 tabular-nums">48.9% of total</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">El Dorado</div>
            <div className="text-lg font-bold tabular-nums text-emerald-400">$535,582</div>
            <div className="mt-2 h-2 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-600" style={{ width: `${(535582 / 1577042) * 100}%` }} />
            </div>
            <div className="text-[10px] text-gray-500 mt-1 tabular-nums">34.0% of total</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Marriott Distribution</div>
            <div className="text-lg font-bold tabular-nums text-emerald-400">$270,000</div>
            <div className="mt-2 h-2 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-600" style={{ width: `${(270000 / 1577042) * 100}%` }} />
            </div>
            <div className="text-[10px] text-gray-500 mt-1 tabular-nums">17.1% of total</div>
          </div>
        </div>
      </div>

      {/* Key Parties */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 mb-8">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Key Parties</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Buyers / Investors</div>
            <div className="text-sm font-semibold text-gray-200">Robert L. Burton</div>
            <div className="text-sm font-semibold text-gray-200">Claire Burton</div>
            <div className="text-[10px] text-gray-500 mt-1">Via FDJ Hesperia, LLC</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Operator / Tenant</div>
            <div className="text-sm font-semibold text-gray-200">Randal G. Dix</div>
            <div className="text-[10px] text-gray-500 mt-1">BWL Investments, LLC</div>
            <div className="text-[10px] text-gray-500">Transwest Properties</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Key Agreements</div>
            <div className="text-xs text-gray-300">Master Leases (exp. Apr 30, 2027)</div>
            <div className="text-xs text-gray-300">Option Agreements</div>
            <div className="text-xs text-gray-300">Promissory Notes ($4.4M)</div>
            <div className="text-xs text-gray-300">EDA PSA (Jul 2021)</div>
          </div>
        </div>
      </div>

      {/* Tax Analysis — Sale to BWL */}
      <TaxAnalysisSection />
    </div>
  );
}

// ============================================================
// TAX ANALYSIS — BWL Buys FDJ Hesperia, LLC
// ============================================================
function TaxAnalysisSection() {
  const [scenario, setScenario] = useState<"low" | "mid" | "high">("mid");

  // Core assumptions
  const purchasePrice = 12748000; // $5.475M + $7.273M
  const buildingBasis = purchasePrice * 0.8; // ~80% of purchase is depreciable building
  // Weighted avg depreciation (mix of 27.5yr residential and 39yr commercial)
  // El Dorado: $5.475M * 80% / 27.5 = $159,273/yr
  // Comfort Suites: $7.273M * 80% / 39 = $149,190/yr
  // Total: ~$308,463/yr × 9 years ≈ $2.78M
  const accumulatedDepr = 2776163;
  const adjustedBasis = purchasePrice - accumulatedDepr; // ~$9.97M

  const scenarios = {
    low: { label: "At Cost", salePrice: 12748000, desc: "Sell to BWL at original purchase price (conservative)" },
    mid: { label: "Modest Growth", salePrice: 15000000, desc: "~18% appreciation over 9 years (below market)" },
    high: { label: "Market Value", salePrice: 18000000, desc: "~41% appreciation (reasonable for Tucson real estate)" },
  };

  const current = scenarios[scenario];
  const totalGain = current.salePrice - adjustedBasis;
  const depRecapture = Math.min(accumulatedDepr, totalGain); // Section 1250 unrecaptured
  const ltcgAmount = Math.max(0, totalGain - depRecapture);

  // Federal taxes
  const depRecaptureTax = depRecapture * 0.25; // Max 25% on unrecaptured §1250 gain
  const ltcgTax = ltcgAmount * 0.2; // 20% top LTCG bracket
  const niit = totalGain * 0.038; // 3.8% Net Investment Income Tax on full gain
  const fedTotal = depRecaptureTax + ltcgTax + niit;

  // State tax (Arizona flat 2.5%)
  const stateTax = totalGain * 0.025;

  const totalTax = fedTotal + stateTax;
  const netProceeds = current.salePrice - totalTax;

  function fmtTax(n: number) {
    return `$${Math.round(n).toLocaleString()}`;
  }

  return (
    <div className="rounded-xl border border-white/10 bg-gradient-to-br from-amber-500/[0.03] to-purple-500/[0.03] p-5 mb-8">
      <div className="flex items-start gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-amber-500/15 border border-amber-500/30 shrink-0">
          <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.375m-8.25-3a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm6.75-6a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm-13.5 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-white">Tax Analysis — Sale to BWL Investments, LLC</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">Scenario: BWL Investments purchases 100% membership interest in FDJ Hesperia, LLC</p>
        </div>
      </div>

      {/* Scenario Toggle */}
      <div className="flex flex-wrap gap-2 mb-5">
        {(Object.keys(scenarios) as Array<keyof typeof scenarios>).map((key) => {
          const s = scenarios[key];
          const isActive = scenario === key;
          return (
            <button
              key={key}
              onClick={() => setScenario(key)}
              className={`flex-1 min-w-[120px] px-3 py-2.5 rounded-lg text-xs font-medium transition-all border ${
                isActive
                  ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
                  : "bg-white/[0.02] text-gray-400 border-white/10 hover:bg-white/[0.04]"
              }`}
            >
              <div className="font-bold">{s.label}</div>
              <div className="text-[10px] opacity-70 tabular-nums mt-0.5">{fmtTax(s.salePrice)}</div>
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-gray-500 mb-5 leading-relaxed italic">{current.desc}</p>

      {/* Key Numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/10">
          <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Sale Price</div>
          <div className="text-sm font-bold text-white tabular-nums">{fmtTax(current.salePrice)}</div>
        </div>
        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/10">
          <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Adjusted Basis</div>
          <div className="text-sm font-bold text-gray-300 tabular-nums">{fmtTax(adjustedBasis)}</div>
          <div className="text-[9px] text-gray-500 mt-0.5">After $2.78M depreciation</div>
        </div>
        <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
          <div className="text-[9px] text-amber-400/70 uppercase tracking-wider mb-1">Total Gain</div>
          <div className="text-sm font-bold text-amber-300 tabular-nums">{fmtTax(totalGain)}</div>
        </div>
        <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
          <div className="text-[9px] text-red-400/70 uppercase tracking-wider mb-1">Est. Total Tax</div>
          <div className="text-sm font-bold text-red-300 tabular-nums">{fmtTax(totalTax)}</div>
        </div>
      </div>

      {/* Tax Breakdown */}
      <div className="rounded-lg bg-black/30 border border-white/5 p-4 mb-5">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-3">Federal & State Tax Breakdown</div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex-1">
              <span className="text-gray-300">Depreciation Recapture</span>
              <span className="text-[9px] text-gray-600 ml-2">IRC §1250 · 25% rate</span>
            </div>
            <div className="text-right tabular-nums">
              <div className="text-gray-400">{fmtTax(depRecapture)} × 25%</div>
              <div className="text-red-400 font-semibold">{fmtTax(depRecaptureTax)}</div>
            </div>
          </div>
          <div className="h-px bg-white/5" />
          <div className="flex items-center justify-between text-xs">
            <div className="flex-1">
              <span className="text-gray-300">Long-Term Capital Gains</span>
              <span className="text-[9px] text-gray-600 ml-2">IRC §1(h) · 20% top rate</span>
            </div>
            <div className="text-right tabular-nums">
              <div className="text-gray-400">{fmtTax(ltcgAmount)} × 20%</div>
              <div className="text-red-400 font-semibold">{fmtTax(ltcgTax)}</div>
            </div>
          </div>
          <div className="h-px bg-white/5" />
          <div className="flex items-center justify-between text-xs">
            <div className="flex-1">
              <span className="text-gray-300">Net Investment Income Tax</span>
              <span className="text-[9px] text-gray-600 ml-2">IRC §1411 · 3.8%</span>
            </div>
            <div className="text-right tabular-nums">
              <div className="text-gray-400">{fmtTax(totalGain)} × 3.8%</div>
              <div className="text-red-400 font-semibold">{fmtTax(niit)}</div>
            </div>
          </div>
          <div className="h-px bg-white/5" />
          <div className="flex items-center justify-between text-xs">
            <div className="flex-1">
              <span className="text-gray-300">Arizona State Tax</span>
              <span className="text-[9px] text-gray-600 ml-2">2.5% flat</span>
            </div>
            <div className="text-right tabular-nums">
              <div className="text-gray-400">{fmtTax(totalGain)} × 2.5%</div>
              <div className="text-red-400 font-semibold">{fmtTax(stateTax)}</div>
            </div>
          </div>
          <div className="h-px bg-white/10 mt-1" />
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs font-bold text-white">Total Estimated Tax</span>
            <span className="text-sm font-bold text-red-300 tabular-nums">{fmtTax(totalTax)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white">Net Proceeds (pre-debt payoff)</span>
            <span className="text-sm font-bold text-emerald-400 tabular-nums">{fmtTax(netProceeds)}</span>
          </div>
        </div>
      </div>

      {/* How Entity Sale Works */}
      <div className="rounded-lg bg-white/[0.02] border border-white/10 p-4 mb-4">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">How an Entity Sale Works</div>
        <p className="text-xs text-gray-400 leading-relaxed mb-2">
          When BWL buys 100% of FDJ Hesperia, LLC, the Burtons are selling their <strong className="text-gray-300">membership interests</strong>, not the
          properties directly. Under IRC §741, gain from selling a partnership/LLC interest is generally treated as capital gain — <em>except</em> for the
          portion attributable to "hot assets" under IRC §751 (depreciation recapture), which is taxed as ordinary income at the unrecaptured §1250 rate (25%).
        </p>
        <p className="text-xs text-gray-400 leading-relaxed">
          For the buyer, an LLC interest purchase of a disregarded entity or partnership is <strong className="text-gray-300">treated as an asset purchase</strong> —
          BWL gets a stepped-up basis in the underlying properties equal to the purchase price (IRC §743(b) if §754 election made, or automatic if FDJ becomes disregarded).
        </p>
      </div>

      {/* Key Considerations */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-[11px] font-bold text-emerald-300">Tax Savings Options</span>
          </div>
          <ul className="text-[10px] text-gray-400 space-y-1 list-disc pl-4">
            <li><strong className="text-gray-300">1031 Exchange:</strong> Defer ALL tax by rolling proceeds into like-kind real estate (must identify in 45 days, close in 180)</li>
            <li><strong className="text-gray-300">Installment Sale (§453):</strong> Spread gain across payment years, reducing marginal rate impact</li>
            <li><strong className="text-gray-300">Opportunity Zones:</strong> Invest gains in QOZ fund for 10-year deferral and potential exclusion</li>
            <li><strong className="text-gray-300">Charitable CRT:</strong> Gift to Charitable Remainder Trust for immediate deduction + lifetime income</li>
          </ul>
        </div>
        <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-[11px] font-bold text-amber-300">Complications to Watch</span>
          </div>
          <ul className="text-[10px] text-gray-400 space-y-1 list-disc pl-4">
            <li><strong className="text-gray-300">$4.4M BWL Promissory Notes:</strong> If offset against purchase price, may trigger cancellation of indebtedness income separately</li>
            <li><strong className="text-gray-300">$5.85M Property Debt:</strong> Assumption of debt counts as part of sale proceeds (boot)</li>
            <li><strong className="text-gray-300">Holding Period:</strong> 9+ years confirms long-term capital gain treatment</li>
            <li><strong className="text-gray-300">Community Property (AZ):</strong> Spouses may split gain 50/50; step-up at first death could reduce future tax</li>
            <li><strong className="text-gray-300">Entity Classification:</strong> Actual tax depends on whether FDJ is taxed as partnership, disregarded entity, or corp</li>
          </ul>
        </div>
      </div>

      {/* Assumptions */}
      <div className="rounded-lg bg-black/20 border border-white/5 p-3">
        <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-2">Assumptions & Sources</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-gray-500 leading-relaxed">
          <div>• Combined purchase price: $12.748M (El Dorado $5.475M + Comfort Suites $7.273M)</div>
          <div>• Building basis ~80% of purchase (land non-depreciable)</div>
          <div>• El Dorado: 27.5-yr residential MACRS (IRC §168)</div>
          <div>• Comfort Suites: 39-yr commercial MACRS</div>
          <div>• Accumulated depreciation ~$2.78M over 9 years</div>
          <div>• Federal LTCG 20% top bracket for high earners</div>
          <div>• Unrecaptured §1250 gain capped at 25% (IRC §1(h)(6))</div>
          <div>• NIIT 3.8% applies (IRC §1411) for passive investors</div>
          <div>• Arizona state income tax 2.5% flat (2024+)</div>
          <div>• Excludes transaction costs, legal fees, and AMT</div>
        </div>
        <p className="text-[9px] text-amber-400/70 mt-3 italic">
          ⚠ This is an estimate for planning purposes. Actual tax will depend on FDJ Hesperia's entity classification, each spouse's tax bracket, prior suspended passive losses, state of residence, and how the $4.4M BWL note is settled. Consult a qualified tax professional before acting.
        </p>
      </div>
    </div>
  );
}
