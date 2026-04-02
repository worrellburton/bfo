import { useState } from "react";
import { Link } from "react-router";

export function meta() {
  return [{ title: "BFO - Ledger Louise" }];
}

const accent = "#3b82f6";

type Tab = "overview" | "k1" | "activation" | "subsidiaries" | "tax" | "roadmap";

const tabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "Phase 1 — Overview" },
  { id: "k1", label: "Phase 2 — K-1 Readiness" },
  { id: "activation", label: "Phase 3 — Management Activation" },
  { id: "subsidiaries", label: "Phase 4 — Subsidiary Map" },
  { id: "tax", label: "Phase 5 — Tax & Compliance" },
  { id: "roadmap", label: "Phase 6 — Transformation Roadmap" },
];

function Badge({ status, label }: { status: "green" | "yellow" | "red" | "blue" | "gray"; label: string }) {
  const colors = {
    green: "bg-green-500/15 text-green-400 border-green-500/30",
    yellow: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    red: "bg-red-500/15 text-red-400 border-red-500/30",
    blue: `bg-blue-500/15 text-blue-400 border-blue-500/30`,
    gray: "bg-white/5 text-gray-400 border-white/10",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${colors[status]}`}>
      {label}
    </span>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-white/10 bg-white/[0.02] p-5 ${className}`}>{children}</div>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">{children}</h3>;
}

// ========================
// PHASE 1 — OVERVIEW
// ========================
function OverviewTab() {
  const entityInfo = [
    { label: "Entity Name", value: "Ledger Louise, LLC" },
    { label: "Entity Type", value: "Limited Liability Company" },
    { label: "State of Formation", value: "Nevada" },
    { label: "Effective Date", value: "September 12, 2023" },
    { label: "Principal Office", value: "401 Ryland St, Suite 200-A, Reno, NV 89502" },
    { label: "Fiscal Year", value: "Calendar Year (December 31)" },
    { label: "Purpose", value: "Any lawful business (Section II.5)" },
    { label: "Governing Law", value: "Nevada" },
    { label: "Tax Treatment", value: "Partnership (Form 1065 → Schedule K-1)" },
    { label: "Tax Matters Member", value: "Robert W. Burton" },
  ];

  const managingMembers = [
    { name: "Robert Ledger Burton", role: "Managing Member", signed: true },
    { name: "Claire Burton", role: "Managing Member", signed: true },
    { name: "Robert W. Burton", role: "Managing Member / Tax Matters Member / Manager", signed: true },
    { name: "Amanda Burton Dawson", role: "Managing Member", signed: true },
  ];

  const keyProvisions = [
    { provision: "Management Authority", detail: "Vested solely in Managing Members (Section IV.1)", section: "Art. IV" },
    { provision: "Voting", detail: "Unanimous vote required; majority as fallback (Section IV.1(b))", section: "Art. IV" },
    { provision: "Compensation", detail: "No compensation for Managing Members — reimbursement only (Section IV.1(c))", section: "Art. IV" },
    { provision: "Allocations", detail: "Pro rata by ownership percentage (Article VI)", section: "Art. VI" },
    { provision: "Distributions", detail: "Pro rata by ownership, in excess of operating requirements (Section 5.01)", section: "Art. V" },
    { provision: "Capital Contributions", detail: "No additional required without written agreement (Section III.2)", section: "Art. III" },
    { provision: "Interest on Capital", detail: "None (Section III.3)", section: "Art. III" },
    { provision: "Transfers", detail: "Only to Permitted Transferees with Managing Member consent (Article VIII)", section: "Art. VIII" },
    { provision: "Capital Accounts", detail: "Maintained per IRC 704-1(b) (Section III.9)", section: "Art. III" },
    { provision: "Officers", detail: "May be appointed by Managing Members (Section IV.3)", section: "Art. IV" },
    { provision: "Indemnification", detail: "Full indemnification for Members, Officers, Affiliates (Section IV.5)", section: "Art. IV" },
    { provision: "Amendments", detail: "Written instrument by Managing Members (Article XI)", section: "Art. XI" },
  ];

  return (
    <div className="space-y-6">
      {/* Current Status Warning */}
      <Card>
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-yellow-500/15 shrink-0">
            <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-sm">Current Status</h3>
              <Badge status="yellow" label="Passive Holding Entity" />
            </div>
            <p className="text-gray-400 text-xs leading-relaxed">
              Ledger Louise currently operates as a passive holding entity with a bank account. It needs to be activated as a proper holding and management company to issue Schedule K-1s to the Burton Family Revocable Trust. This tool will guide the transformation process across 6 phases.
            </p>
          </div>
        </div>
      </Card>

      {/* Entity Information */}
      <Card>
        <SectionTitle>
          <svg className="w-4 h-4" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          Entity Information
        </SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {entityInfo.map((item) => (
            <div key={item.label} className="flex flex-col gap-0.5 p-3 rounded-lg bg-white/[0.02] border border-white/5">
              <span className="text-[10px] uppercase tracking-wider text-gray-500">{item.label}</span>
              <span className="text-xs text-gray-200">{item.value}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Ownership Structure */}
      <Card>
        <SectionTitle>
          <svg className="w-4 h-4" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
          </svg>
          Ownership Structure
        </SectionTitle>
        <div className="flex flex-col items-center gap-3">
          {/* Trust */}
          <div className="px-5 py-3 rounded-xl border-2 border-blue-500/30 bg-blue-500/10 text-center w-full max-w-md">
            <p className="text-xs font-bold text-blue-400">Burton Family Revocable Trust</p>
            <p className="text-[10px] text-gray-500">U/A dated December 22, 2014</p>
            <p className="text-[10px] text-gray-500">Robert L. Burton & Claire B. Burton, Trustees</p>
          </div>
          <svg className="w-4 h-6 text-gray-600" viewBox="0 0 16 24"><path d="M8 0v24M4 20l4 4 4-4" fill="none" stroke="currentColor" strokeWidth={1.5} /></svg>
          {/* Ledger Louise */}
          <div className="px-5 py-3 rounded-xl border-2 border-blue-400/40 bg-blue-400/15 text-center w-full max-w-md">
            <p className="text-sm font-bold" style={{ color: accent }}>Ledger Louise, LLC</p>
            <p className="text-[10px] text-gray-400">Nevada LLC · 100% Common Units</p>
            <Badge status="yellow" label="Passive — Needs Activation" />
          </div>
          <svg className="w-4 h-6 text-gray-600" viewBox="0 0 16 24"><path d="M8 0v24M4 20l4 4 4-4" fill="none" stroke="currentColor" strokeWidth={1.5} /></svg>
          {/* Subsidiaries */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 w-full">
            {[
              { name: "Swisshelm Mountain Ventures", subs: ["AZ Center for Recovery", "Persons Lodge (100%)", "Breezewood (100%)"] },
              { name: "Sundown Investments", subs: ["FDJ Hesperia (100%)", "FDJ CFS (100%)", "Palomino Ranch on the Bend"] },
              { name: "Ledger Burton", subs: ["VQ National"] },
              { name: "Worrell Burton", subs: ["Catalog Digital, Inc", "Atlas Hydration, Inc"] },
            ].map((sub) => (
              <div key={sub.name} className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-center">
                <p className="text-[11px] font-semibold text-gray-200 mb-1">{sub.name}, LLC</p>
                {sub.subs.map((s) => (
                  <p key={s} className="text-[10px] text-gray-500">{s}</p>
                ))}
              </div>
            ))}
          </div>
          {/* Related entities */}
          <div className="flex gap-3 mt-1">
            {["Quail Lakes Apartments", "HSL TP Hotel", "HSL Placita West Ltd Partners"].map((e) => (
              <div key={e} className="rounded-lg border border-white/5 bg-white/[0.01] px-3 py-1.5">
                <p className="text-[10px] text-gray-600">{e}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Managing Members */}
      <Card>
        <SectionTitle>
          <svg className="w-4 h-4" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
          Managing Members
        </SectionTitle>
        <div className="space-y-2">
          {managingMembers.map((m) => (
            <div key={m.name} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/5">
              <div>
                <p className="text-xs font-semibold text-gray-200">{m.name}</p>
                <p className="text-[10px] text-gray-500">{m.role}</p>
              </div>
              <Badge status="green" label="Signed" />
            </div>
          ))}
        </div>
        <p className="text-[10px] text-gray-500 mt-3">
          Decisions require unanimous vote of all Managing Members. If unanimous vote cannot be reached, majority of voting Members decides. (Section IV.1(b))
        </p>
      </Card>

      {/* Key Agreement Provisions */}
      <Card>
        <SectionTitle>
          <svg className="w-4 h-4" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
          </svg>
          Key Agreement Provisions
        </SectionTitle>
        <div className="space-y-1">
          {keyProvisions.map((p) => (
            <div key={p.provision} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-white/[0.02] transition-colors">
              <span className="text-[10px] font-mono text-gray-600 w-12 shrink-0 pt-0.5">{p.section}</span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-gray-300">{p.provision}</p>
                <p className="text-[10px] text-gray-500">{p.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Member Schedule */}
      <Card>
        <SectionTitle>
          <svg className="w-4 h-4" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15" />
          </svg>
          Schedule I — Members, Units & Information
        </SectionTitle>
        <div className="rounded-lg border border-white/10 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03]">
                <th className="text-left px-4 py-2 text-gray-400 font-medium">Member</th>
                <th className="text-left px-4 py-2 text-gray-400 font-medium">Admission Date</th>
                <th className="text-right px-4 py-2 text-gray-400 font-medium">Common Units</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-4 py-3">
                  <p className="font-semibold text-gray-200">Robert L. Burton & Claire B. Burton</p>
                  <p className="text-[10px] text-gray-500">As Trustees of the Burton Family Revocable Trust</p>
                  <p className="text-[10px] text-gray-500">11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028</p>
                </td>
                <td className="px-4 py-3 text-gray-400">September 12, 2023</td>
                <td className="px-4 py-3 text-right">
                  <span className="text-lg font-bold" style={{ color: accent }}>100%</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ========================
// PLACEHOLDER TABS (Phases 2-6)
// ========================
function PlaceholderTab({ phase, title }: { phase: number; title: string }) {
  return (
    <Card>
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: `${accent}15`, color: accent }}>
          <span className="text-2xl font-bold">{phase}</span>
        </div>
        <h2 className="text-lg font-semibold mb-2">{title}</h2>
        <p className="text-gray-500 text-sm max-w-md">This phase will be built next. Complete the previous phase first, then we'll build this one.</p>
        <Badge status="gray" label="Upcoming" />
      </div>
    </Card>
  );
}

// ========================
// MAIN COMPONENT
// ========================
export default function LedgerLouise() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-6">
        <Link to="/tools" className="hover:text-white transition-colors">Tools</Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-gray-300">Ledger Louise</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${accent}15` }}>
            <svg className="w-6 h-6" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3H21m-3.75 3H21" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold">Ledger Louise, LLC</h1>
            <p className="text-gray-500 text-sm">Management & K-1 Readiness — Burton Family Revocable Trust</p>
          </div>
        </div>
        <Badge status="yellow" label="In Progress" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-white/10 pb-px overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-xs font-medium rounded-t-lg transition-all duration-200 whitespace-nowrap ${
              activeTab === tab.id
                ? "text-blue-400 bg-white/5 border-b-2 border-blue-400"
                : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.02]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && <OverviewTab />}
      {activeTab === "k1" && <PlaceholderTab phase={2} title="K-1 Readiness Assessment" />}
      {activeTab === "activation" && <PlaceholderTab phase={3} title="Management Activation" />}
      {activeTab === "subsidiaries" && <PlaceholderTab phase={4} title="Subsidiary Map & K-1 Flow" />}
      {activeTab === "tax" && <PlaceholderTab phase={5} title="Tax & Compliance Framework" />}
      {activeTab === "roadmap" && <PlaceholderTab phase={6} title="Transformation Roadmap" />}
    </div>
  );
}
