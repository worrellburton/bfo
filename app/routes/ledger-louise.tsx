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
// PHASE 2 — K-1 READINESS
// ========================
function K1ReadinessTab() {
  const checklist = [
    { item: "EIN Obtained for Ledger Louise, LLC", status: "yellow" as const, statusLabel: "VERIFY", detail: "Confirm EIN exists and is associated with partnership tax filing (Form 1065). If not obtained, apply via IRS Form SS-4." },
    { item: "QuickBooks Online Connected", status: "yellow" as const, statusLabel: "IN PROGRESS", detail: "QuickBooks integration built in BFO. Complete OAuth connection to pull live financial data." },
    { item: "Dedicated Bank Account", status: "green" as const, statusLabel: "DONE", detail: "Ledger Louise has an active bank account. Ensure all LL transactions flow through this account." },
    { item: "Chart of Accounts Established", status: "red" as const, statusLabel: "NOT STARTED", detail: "Set up holding company COA in QuickBooks: management fee income, intercompany receivables, distributions, operating expenses." },
    { item: "Bank Account Reconciled (2023–Present)", status: "red" as const, statusLabel: "NOT STARTED", detail: "Reconcile all bank activity from formation (Sept 2023) through current. Classify all transactions." },
    { item: "Subsidiary Income/Loss Tracked", status: "red" as const, statusLabel: "NOT STARTED", detail: "Track K-1 income flowing from each subsidiary (Swisshelm, Sundown, Ledger Burton, Worrell Burton) into Ledger Louise." },
    { item: "Capital Accounts Maintained per IRC 704-1(b)", status: "red" as const, statusLabel: "NOT STARTED", detail: "Required by the Operating Agreement (Section III.9). Track contributions, allocations, and distributions for the Trust's capital account." },
    { item: "Form 1065 Filed — Tax Year 2023 (Partial Year)", status: "red" as const, statusLabel: "CRITICAL", detail: "Ledger Louise was formed Sept 12, 2023. A 2023 Form 1065 was due March 15, 2024 (or Sept 15 with extension). Verify if filed." },
    { item: "Form 1065 Filed — Tax Year 2024", status: "red" as const, statusLabel: "CRITICAL", detail: "Full year 2024 Form 1065 was due March 15, 2025 (or Sept 15, 2025 with extension). Verify if filed or if extension was requested." },
    { item: "Form 1065 Filed — Tax Year 2025", status: "yellow" as const, statusLabel: "UPCOMING", detail: "Due March 15, 2026 (or Sept 15, 2026 with extension). This is the next filing if prior years are caught up." },
    { item: "Schedule K-1 Issued to Burton Family Revocable Trust", status: "red" as const, statusLabel: "CRITICAL", detail: "K-1 must be issued to the Trust for each tax year. The Trust then reports this income on its Form 1041." },
    { item: "Nevada Commerce Tax Evaluated", status: "yellow" as const, statusLabel: "VERIFY", detail: "Nevada has no income tax, but the Commerce Tax applies if Nevada-sourced gross revenue exceeds $4M. Verify threshold." },
    { item: "Nevada Annual List Filed", status: "yellow" as const, statusLabel: "VERIFY", detail: "Nevada LLCs must file an Annual List with the Secretary of State and pay $150 fee. Due by last day of anniversary month (September)." },
  ];

  const k1LineItems = [
    { line: "Line 1", description: "Ordinary business income (loss)", source: "Net income from management fees, operations", applies: true },
    { line: "Line 2", description: "Net rental real estate income (loss)", source: "Pass-through from subsidiary real estate holdings", applies: true },
    { line: "Line 3", description: "Other net rental income (loss)", source: "Non-real-estate rental activity", applies: false },
    { line: "Line 4", description: "Guaranteed payments for services", source: "N/A — Operating Agreement provides no compensation to managers", applies: false },
    { line: "Line 5", description: "Interest income", source: "Bank interest, intercompany loans", applies: true },
    { line: "Line 6a", description: "Ordinary dividends", source: "Dividends from Catalog Digital, Atlas Hydration if applicable", applies: true },
    { line: "Line 7", description: "Royalties", source: "If any IP licensing exists", applies: false },
    { line: "Line 8", description: "Net short-term capital gain (loss)", source: "From investment sales < 1 year", applies: true },
    { line: "Line 9a", description: "Net long-term capital gain (loss)", source: "From investment/property sales > 1 year", applies: true },
    { line: "Line 10", description: "Net Section 1231 gain (loss)", source: "Business property sales (real estate, equipment)", applies: true },
    { line: "Line 11", description: "Other income (loss)", source: "Miscellaneous income items", applies: true },
    { line: "Line 13", description: "Other deductions", source: "Section 179, charitable contributions, etc.", applies: true },
    { line: "Line 14", description: "Self-employment earnings", source: "Only if members are active in management of real estate", applies: false },
    { line: "Line 20", description: "Section 199A (QBI) information", source: "Qualified Business Income for 20% deduction — critical for pass-through entities", applies: true },
  ];

  const deadlines = [
    { year: "2023", form: "Form 1065 (Partial Year)", due: "March 15, 2024", extended: "Sept 15, 2024", status: "red" as const, statusLabel: "VERIFY" },
    { year: "2024", form: "Form 1065 (Full Year)", due: "March 15, 2025", extended: "Sept 15, 2025", status: "red" as const, statusLabel: "VERIFY" },
    { year: "2025", form: "Form 1065 (Full Year)", due: "March 15, 2026", extended: "Sept 15, 2026", status: "yellow" as const, statusLabel: "UPCOMING" },
    { year: "Annual", form: "Nevada Annual List", due: "September 30 each year", extended: "N/A", status: "yellow" as const, statusLabel: "VERIFY" },
  ];

  const criticalCount = checklist.filter((c) => c.statusLabel === "CRITICAL").length;
  const doneCount = checklist.filter((c) => c.status === "green").length;
  const verifyCount = checklist.filter((c) => c.statusLabel === "VERIFY").length;

  return (
    <div className="space-y-6">
      {/* Summary Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Items", value: checklist.length, color: accent },
          { label: "Completed", value: doneCount, color: "#22c55e" },
          { label: "Critical", value: criticalCount, color: "#ef4444" },
          { label: "Need Verification", value: verifyCount, color: "#eab308" },
        ].map((m) => (
          <Card key={m.label}>
            <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{m.label}</p>
            <p className="text-2xl font-bold" style={{ color: m.color }}>{m.value}</p>
          </Card>
        ))}
      </div>

      {/* Critical Alert */}
      <Card>
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-red-500/15 shrink-0">
            <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-sm text-red-400 mb-1">Priority: Verify Prior Year Tax Filings</h3>
            <p className="text-gray-400 text-xs leading-relaxed">
              Ledger Louise was formed September 12, 2023. As a multi-member LLC taxed as a partnership, it is <strong>required</strong> to file Form 1065 for each tax year and issue Schedule K-1 to the Burton Family Revocable Trust. Late filing penalties are <strong>$220/month per partner</strong> (for 2024 returns). Check immediately whether 2023 and 2024 returns were filed or if extensions were obtained.
            </p>
          </div>
        </div>
      </Card>

      {/* Readiness Checklist */}
      <Card>
        <SectionTitle>
          <svg className="w-4 h-4" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          K-1 Readiness Checklist
        </SectionTitle>
        <div className="space-y-2">
          {checklist.map((item, i) => (
            <div key={i} className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-semibold text-gray-200">{item.item}</p>
                <Badge status={item.status} label={item.statusLabel} />
              </div>
              <p className="text-[10px] text-gray-500 leading-relaxed">{item.detail}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* K-1 Line Items */}
      <Card>
        <SectionTitle>
          <svg className="w-4 h-4" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          Schedule K-1 Line Items — What Flows to the Trust
        </SectionTitle>
        <p className="text-[10px] text-gray-500 mb-3">
          The K-1 issued to the Burton Family Revocable Trust will report these items. The Trust then reports them on its Form 1041 (or individual returns if grantor trust).
        </p>
        <div className="rounded-lg border border-white/10 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03]">
                <th className="text-left px-3 py-2 text-gray-400 font-medium w-16">Line</th>
                <th className="text-left px-3 py-2 text-gray-400 font-medium">Description</th>
                <th className="text-left px-3 py-2 text-gray-400 font-medium hidden sm:table-cell">Source</th>
                <th className="text-center px-3 py-2 text-gray-400 font-medium w-20">Applies</th>
              </tr>
            </thead>
            <tbody>
              {k1LineItems.map((item) => (
                <tr key={item.line} className="border-b border-white/5">
                  <td className="px-3 py-2 font-mono text-gray-500">{item.line}</td>
                  <td className="px-3 py-2 text-gray-300">{item.description}</td>
                  <td className="px-3 py-2 text-gray-500 hidden sm:table-cell">{item.source}</td>
                  <td className="px-3 py-2 text-center">
                    {item.applies ? (
                      <span className="text-blue-400">&#10003;</span>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Filing Deadlines */}
      <Card>
        <SectionTitle>
          <svg className="w-4 h-4" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
          Filing Deadlines & Status
        </SectionTitle>
        <div className="rounded-lg border border-white/10 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03]">
                <th className="text-left px-4 py-2 text-gray-400 font-medium">Tax Year</th>
                <th className="text-left px-4 py-2 text-gray-400 font-medium">Form</th>
                <th className="text-left px-4 py-2 text-gray-400 font-medium">Due Date</th>
                <th className="text-left px-4 py-2 text-gray-400 font-medium">Extended</th>
                <th className="text-center px-4 py-2 text-gray-400 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {deadlines.map((d) => (
                <tr key={d.year} className="border-b border-white/5">
                  <td className="px-4 py-2.5 font-semibold text-gray-200">{d.year}</td>
                  <td className="px-4 py-2.5 text-gray-400">{d.form}</td>
                  <td className="px-4 py-2.5 text-gray-400">{d.due}</td>
                  <td className="px-4 py-2.5 text-gray-400">{d.extended}</td>
                  <td className="px-4 py-2.5 text-center"><Badge status={d.status} label={d.statusLabel} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 p-3 rounded-lg bg-red-500/5 border border-red-500/10">
          <p className="text-[10px] text-red-400 leading-relaxed">
            <strong>Late Filing Penalty (IRC 6698):</strong> $220/month per partner (2024 returns), up to 12 months. Since Ledger Louise has 1 partner (the Trust), the maximum penalty per year is $2,640. If 2023 AND 2024 are both unfiled, potential combined penalties could reach $5,280 plus interest. Filing as soon as possible reduces the penalty window.
          </p>
        </div>
      </Card>

      {/* K-1 Flow Diagram */}
      <Card>
        <SectionTitle>
          <svg className="w-4 h-4" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
          </svg>
          K-1 Flow: Subsidiaries → Ledger Louise → Trust
        </SectionTitle>
        <div className="flex flex-col items-center gap-2">
          <div className="grid grid-cols-4 gap-2 w-full">
            {["Swisshelm Mtn", "Sundown Inv.", "Ledger Burton", "Worrell Burton"].map((s) => (
              <div key={s} className="rounded-lg border border-white/10 bg-white/[0.03] p-2 text-center">
                <p className="text-[10px] font-semibold text-gray-300">{s}</p>
                <p className="text-[9px] text-gray-600">Issues K-1 ↓</p>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4].map((i) => (
              <svg key={i} className="w-4 h-5 text-gray-600" viewBox="0 0 16 20"><path d="M8 0v20M4 16l4 4 4-4" fill="none" stroke="currentColor" strokeWidth={1.5} /></svg>
            ))}
          </div>
          <div className="px-6 py-3 rounded-xl border-2 border-blue-400/40 bg-blue-400/15 text-center w-full max-w-sm">
            <p className="text-sm font-bold" style={{ color: accent }}>Ledger Louise, LLC</p>
            <p className="text-[10px] text-gray-400">Receives K-1s from subs · Consolidates · Files Form 1065</p>
          </div>
          <svg className="w-4 h-6 text-blue-400" viewBox="0 0 16 24"><path d="M8 0v24M4 20l4 4 4-4" fill="none" stroke="currentColor" strokeWidth={2} /></svg>
          <div className="px-6 py-3 rounded-xl border-2 border-blue-500/30 bg-blue-500/10 text-center w-full max-w-sm">
            <p className="text-sm font-bold text-blue-400">Burton Family Revocable Trust</p>
            <p className="text-[10px] text-gray-400">Receives K-1 from Ledger Louise · Reports on Form 1041</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ========================
// PHASE 3 — MANAGEMENT ACTIVATION
// ========================
function ActivationTab() {
  type ActionStatus = "done" | "in-progress" | "not-started" | "critical";
  const statusMap: Record<ActionStatus, { badge: "green" | "yellow" | "red" | "gray"; label: string }> = {
    "done": { badge: "green", label: "DONE" },
    "in-progress": { badge: "yellow", label: "IN PROGRESS" },
    "not-started": { badge: "gray", label: "NOT STARTED" },
    "critical": { badge: "red", label: "CRITICAL" },
  };

  const phases = [
    {
      phase: "A",
      title: "Foundation — Immediate Actions",
      description: "Establish the basic infrastructure needed before Ledger Louise can operate as a management company.",
      actions: [
        { action: "Obtain / verify EIN for Ledger Louise, LLC", status: "in-progress" as ActionStatus, detail: "Required for Form 1065 filing. If EIN exists, confirm it's set up for partnership filing, not disregarded entity." },
        { action: "Open dedicated operating bank account", status: "done" as ActionStatus, detail: "Ledger Louise has an active bank account. All management fee income and operating expenses should flow through this account." },
        { action: "Connect QuickBooks Online", status: "in-progress" as ActionStatus, detail: "BFO integration built. Complete OAuth flow to pull real-time financials into the dashboard." },
        { action: "Establish Chart of Accounts for holding company", status: "not-started" as ActionStatus, detail: "Create accounts: Management Fee Income, Intercompany Receivables, Distributions Received, Distributions Paid, Operating Expenses, Professional Fees, Travel & Entertainment." },
        { action: "File delinquent tax returns (2023, 2024)", status: "critical" as ActionStatus, detail: "Engage CPA to prepare and file Form 1065 for 2023 (partial year: Sept–Dec) and 2024 (full year). Issue K-1s to Trust for each year." },
        { action: "Designate registered agent in Nevada", status: "in-progress" as ActionStatus, detail: "Verify current registered agent is active. Nevada requires a registered agent with a physical address in the state." },
      ],
    },
    {
      phase: "B",
      title: "Intercompany Framework — Management Services",
      description: "Establish formal agreements that create legitimate management fee income for Ledger Louise and deductible expenses for subsidiaries.",
      actions: [
        { action: "Draft Management Services Agreement (MSA) template", status: "not-started" as ActionStatus, detail: "Master agreement template covering: scope of services, fee structure, payment terms, termination, confidentiality. Each subsidiary gets a customized version." },
        { action: "Execute MSA with Swisshelm Mountain Ventures, LLC", status: "not-started" as ActionStatus, detail: "Services: financial oversight of AZ Center for Recovery, Persons Lodge, Breezewood. Accounting, compliance, strategic planning, capital allocation." },
        { action: "Execute MSA with Sundown Investments, LLC", status: "not-started" as ActionStatus, detail: "Services: financial oversight of FDJ Hesperia, FDJ CFS, Palomino Ranch. Property management oversight, lease administration, financial reporting." },
        { action: "Execute MSA with Ledger Burton, LLC", status: "not-started" as ActionStatus, detail: "Services: oversight of VQ National investment. Strategic advisory, performance monitoring, governance support." },
        { action: "Execute MSA with Worrell Burton, LLC", status: "not-started" as ActionStatus, detail: "Services: oversight of Catalog Digital and Atlas Hydration. Business development support, financial reporting, compliance." },
        { action: "Establish management fee structure", status: "not-started" as ActionStatus, detail: "Options: (1) Percentage of revenue (1–5% typical), (2) Fixed annual fee per subsidiary, (3) Cost-plus model (actual costs + markup). Must be arm's-length and reasonable." },
        { action: "Create intercompany billing procedures", status: "not-started" as ActionStatus, detail: "Monthly or quarterly invoicing from Ledger Louise to each subsidiary. Document services rendered, hours, and fee calculations." },
        { action: "Document cost allocation methodology", status: "not-started" as ActionStatus, detail: "Allocate shared costs (accounting software, legal, insurance) across subsidiaries. Use reasonable allocation keys (revenue, headcount, assets)." },
      ],
    },
    {
      phase: "C",
      title: "Active Management — Centralized Operations",
      description: "Transform Ledger Louise into the central management hub for the Burton family enterprise.",
      actions: [
        { action: "Centralize accounting and financial reporting", status: "not-started" as ActionStatus, detail: "All subsidiary financials flow through Ledger Louise. Produce consolidated management reports for the family." },
        { action: "Implement consolidated financial statements", status: "not-started" as ActionStatus, detail: "Quarterly consolidated P&L, balance sheet, and cash flow across all entities. Track intercompany eliminations." },
        { action: "Manage subsidiary distributions to Ledger Louise", status: "not-started" as ActionStatus, detail: "Establish distribution policies for each subsidiary. Cash flows up from operating entities to Ledger Louise for centralized capital allocation." },
        { action: "Manage distributions from Ledger Louise to Trust", status: "not-started" as ActionStatus, detail: "Per Section 5.01: distributions in excess of operating requirements, pro rata by ownership (100% to Trust)." },
        { action: "Strategic planning and capital allocation", status: "not-started" as ActionStatus, detail: "Ledger Louise serves as the capital allocation committee — deciding which subsidiaries receive investment, which distribute cash." },
        { action: "Centralize insurance programs", status: "not-started" as ActionStatus, detail: "Per Section 2.06(l): obtain and maintain commercial general liability, D&O insurance. Negotiate group rates across all entities." },
        { action: "Establish compliance calendar", status: "not-started" as ActionStatus, detail: "Track all filing deadlines, annual reports, license renewals, insurance renewals, and tax deadlines across all entities." },
      ],
    },
    {
      phase: "D",
      title: "Tax Optimization — Maximize Pass-Through Benefits",
      description: "Ensure the K-1 structure is optimized for tax efficiency across the Trust and its beneficiaries.",
      actions: [
        { action: "Ensure proper K-1 cascade: Subs → LL → Trust", status: "not-started" as ActionStatus, detail: "Each subsidiary issues K-1 to Ledger Louise. LL consolidates and issues single K-1 to the Trust. Trust reports on Form 1041." },
        { action: "Evaluate management fee deductibility", status: "not-started" as ActionStatus, detail: "Management fees paid by subsidiaries are deductible business expenses (IRC 162). Fees received by Ledger Louise are ordinary income. Net effect: income shifts to LL level." },
        { action: "Analyze Section 199A (QBI) implications", status: "not-started" as ActionStatus, detail: "Qualified Business Income deduction (20%) may apply to pass-through income. Evaluate which subsidiary income qualifies. Management company income generally qualifies if below threshold." },
        { action: "Review Nevada Commerce Tax threshold", status: "not-started" as ActionStatus, detail: "Nevada Commerce Tax applies to entities with Nevada-sourced gross revenue > $4M. Rate is 0.051%. Evaluate if Ledger Louise or subsidiaries exceed threshold." },
        { action: "Evaluate Section 754 election", status: "not-started" as ActionStatus, detail: "A 754 election allows basis step-up on transfers of partnership interests. Consider whether beneficial given the Trust structure." },
        { action: "Consider entity classification elections", status: "not-started" as ActionStatus, detail: "All LLCs currently default to partnership treatment. Evaluate if any subsidiary would benefit from S-corp election (Form 2553) for self-employment tax savings." },
        { action: "Review state nexus and filing requirements", status: "not-started" as ActionStatus, detail: "Subsidiaries operate in multiple states (AZ, CA, NV). Evaluate state-level partnership returns and withholding requirements for each entity." },
      ],
    },
  ];

  const totalActions = phases.reduce((sum, p) => sum + p.actions.length, 0);
  const doneActions = phases.reduce((sum, p) => sum + p.actions.filter((a) => a.status === "done").length, 0);
  const criticalActions = phases.reduce((sum, p) => sum + p.actions.filter((a) => a.status === "critical").length, 0);

  return (
    <div className="space-y-6">
      {/* Progress Bar */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <SectionTitle>Transformation Progress</SectionTitle>
          <span className="text-xs text-gray-400">{doneActions} of {totalActions} actions complete</span>
        </div>
        <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${(doneActions / totalActions) * 100}%`, background: accent }}
          />
        </div>
        <div className="flex gap-4 mt-3 text-[10px]">
          <span className="text-green-400">{doneActions} Done</span>
          <span className="text-yellow-400">{phases.reduce((s, p) => s + p.actions.filter((a) => a.status === "in-progress").length, 0)} In Progress</span>
          <span className="text-red-400">{criticalActions} Critical</span>
          <span className="text-gray-500">{phases.reduce((s, p) => s + p.actions.filter((a) => a.status === "not-started").length, 0)} Not Started</span>
        </div>
      </Card>

      {/* Management Fee Explainer */}
      <Card>
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${accent}15` }}>
            <svg className="w-5 h-5" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-sm mb-1">Why Management Fees Matter</h3>
            <p className="text-gray-400 text-xs leading-relaxed">
              By charging subsidiaries management fees, Ledger Louise creates <strong>legitimate operating income</strong> that flows through the K-1 to the Trust. This centralizes income at the holding company level, creating a single point of financial control. The fees must be <strong>arm's-length</strong> (comparable to what an unrelated third-party management company would charge) to withstand IRS scrutiny. Typical holding company fees range from <strong>1–5% of subsidiary revenue</strong> or a fixed annual fee.
            </p>
          </div>
        </div>
      </Card>

      {/* Phase Cards */}
      {phases.map((p) => (
        <Card key={p.phase}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold" style={{ background: `${accent}15`, color: accent }}>
              {p.phase}
            </div>
            <div>
              <h3 className="font-semibold text-sm">{p.title}</h3>
              <p className="text-[10px] text-gray-500">{p.description}</p>
            </div>
          </div>
          <div className="space-y-2">
            {p.actions.map((a, i) => (
              <div key={i} className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] ${
                      a.status === "done" ? "bg-green-500/20 text-green-400" :
                      a.status === "in-progress" ? "bg-yellow-500/20 text-yellow-400" :
                      a.status === "critical" ? "bg-red-500/20 text-red-400" :
                      "bg-white/5 text-gray-600"
                    }`}>
                      {a.status === "done" ? "✓" : a.status === "critical" ? "!" : i + 1}
                    </span>
                    <p className="text-xs font-semibold text-gray-200">{a.action}</p>
                  </div>
                  <Badge status={statusMap[a.status].badge} label={statusMap[a.status].label} />
                </div>
                <p className="text-[10px] text-gray-500 leading-relaxed ml-7">{a.detail}</p>
              </div>
            ))}
          </div>
        </Card>
      ))}

      {/* Operating Agreement Authority */}
      <Card>
        <SectionTitle>
          <svg className="w-4 h-4" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21" />
          </svg>
          Operating Agreement Authority for These Actions
        </SectionTitle>
        <div className="space-y-2">
          {[
            { section: "II.5", title: "Purpose & Scope", text: "The Company may engage in any lawful business or activity — no amendment needed to add management services." },
            { section: "2.06(a)", title: "Authorized Acts — Contracts", text: "Managing Members may enter into any contract or agreement necessary to further Company Business, including MSAs with subsidiaries." },
            { section: "2.06(c)", title: "Authorized Acts — Hire Professionals", text: "May hire consultants, brokers, attorneys, accountants — supports engaging CPA for delinquent filings." },
            { section: "2.06(h)", title: "Authorized Acts — Tax Returns", text: "May prepare and file all necessary returns and statements, pay all taxes — authorizes catching up on Form 1065 filings." },
            { section: "2.06(i)", title: "Authorized Acts — Accounting Methods", text: "May determine accounting methods and conventions — supports establishing QuickBooks COA and procedures." },
            { section: "IV.1(c)", title: "Reimbursement", text: "Managing Members entitled to reimbursement for all costs and expenses incurred in management — but no compensation. Management fees go to the Company, not to members personally." },
          ].map((item) => (
            <div key={item.section} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-white/[0.02] transition-colors">
              <span className="text-[10px] font-mono text-blue-400/60 w-16 shrink-0 pt-0.5">§{item.section}</span>
              <div>
                <p className="text-xs font-semibold text-gray-300">{item.title}</p>
                <p className="text-[10px] text-gray-500">{item.text}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ========================
// PHASE 4 — SUBSIDIARY MAP
// ========================
function SubsidiaryMapTab() {
  type SubStatus = "active" | "passive" | "dormant" | "unknown";
  const statusColors: Record<SubStatus, { badge: "green" | "yellow" | "gray" | "blue"; label: string }> = {
    active: { badge: "green", label: "ACTIVE" },
    passive: { badge: "yellow", label: "PASSIVE" },
    dormant: { badge: "gray", label: "DORMANT" },
    unknown: { badge: "blue", label: "VERIFY" },
  };

  const subsidiaries = [
    {
      name: "Swisshelm Mountain Ventures, LLC",
      color: "#f97316",
      status: "active" as SubStatus,
      role: "Behavioral Health & Recovery Operations",
      state: "Arizona",
      holdings: [
        { name: "Arizona Center for Recovery — A New Direction, LLC", ownership: "Operating Entity", type: "Behavioral Health", status: "active" as SubStatus },
        { name: "Persons Lodge LLC", ownership: "100%", type: "Residential Treatment", status: "active" as SubStatus },
        { name: "Breezewood", ownership: "100%", type: "Residential Treatment", status: "active" as SubStatus },
      ],
      k1Items: ["Ordinary business income/loss", "Rental income (if facilities owned)", "Depreciation", "Employee costs pass-through"],
      mgmtServices: ["Financial reporting & accounting", "Regulatory compliance oversight", "Strategic planning", "HR & payroll administration", "Insurance management"],
      estimatedFee: "3-5% of gross revenue",
    },
    {
      name: "Sundown Investments, LLC",
      color: "#22c55e",
      status: "active" as SubStatus,
      role: "Real Estate Holdings — Hospitality & Commercial",
      state: "California / Nevada",
      holdings: [
        { name: "FDJ Hesperia, LLC", ownership: "100%", type: "Hotel Property", status: "active" as SubStatus },
        { name: "FDJ CFS, LLC", ownership: "100%", type: "Hotel Property", status: "active" as SubStatus },
        { name: "Palomino Ranch on the Bend, LLC", ownership: "Interest", type: "Ranch / Land", status: "unknown" as SubStatus },
      ],
      k1Items: ["Net rental real estate income/loss", "Depreciation (MACRS)", "Interest expense", "Property tax deductions", "Section 1231 gains on sale"],
      mgmtServices: ["Property management oversight", "Lease administration", "Capital improvement planning", "Financial reporting", "Tax compliance"],
      estimatedFee: "2-4% of gross revenue or $5K-$15K/property/year",
    },
    {
      name: "Ledger Burton, LLC",
      color: "#a855f7",
      status: "passive" as SubStatus,
      role: "VisionQuest National Investment Vehicle",
      state: "Nevada / Arizona",
      holdings: [
        { name: "VQ National", ownership: "Investment Interest", type: "Behavioral Health Services", status: "active" as SubStatus },
      ],
      k1Items: ["Ordinary business income/loss (pass-through from VQ)", "Guaranteed payments (if any)", "Section 199A QBI"],
      mgmtServices: ["Investment monitoring", "Performance reporting", "Governance & board participation", "Strategic advisory"],
      estimatedFee: "1-2% of invested capital or flat $10K-$25K/year",
    },
    {
      name: "Worrell Burton, LLC",
      color: "#06b6d4",
      status: "active" as SubStatus,
      role: "Technology & Consumer Products Ventures",
      state: "Nevada",
      holdings: [
        { name: "Catalog Digital, Inc", ownership: "Equity Interest", type: "Technology / Digital", status: "active" as SubStatus },
        { name: "Atlas Hydration, Inc", ownership: "Equity Interest", type: "Consumer Products / Beverage", status: "active" as SubStatus },
      ],
      k1Items: ["Ordinary business income/loss", "Dividends (if C-corp distributions)", "Capital gains on equity events", "Startup costs / losses"],
      mgmtServices: ["Business development support", "Financial reporting & accounting", "Cap table management", "Investor relations", "Legal & compliance"],
      estimatedFee: "2-3% of revenue or flat $5K-$15K/entity/year",
    },
  ];

  const relatedEntities = [
    { name: "Quail Lakes Apartments, LLC", type: "Multi-Family Real Estate", status: "unknown" as SubStatus, relationship: "Direct or indirect interest — verify ownership chain" },
    { name: "HSL TP Hotel, LLC", type: "Hospitality", status: "unknown" as SubStatus, relationship: "Direct or indirect interest — verify ownership chain" },
    { name: "HSL Placita West Ltd Partners", type: "Real Estate Partnership", status: "unknown" as SubStatus, relationship: "Limited partnership interest — verify ownership chain" },
  ];

  return (
    <div className="space-y-6">
      {/* Overview Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Direct Subsidiaries", value: "4", color: accent },
          { label: "Total Holdings", value: "10+", color: "#22c55e" },
          { label: "States", value: "NV, AZ, CA", color: "#a855f7" },
          { label: "Related Entities", value: "3", color: "#eab308" },
        ].map((m) => (
          <Card key={m.label}>
            <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{m.label}</p>
            <p className="text-xl font-bold" style={{ color: m.color }}>{m.value}</p>
          </Card>
        ))}
      </div>

      {/* Full Hierarchy */}
      <Card>
        <SectionTitle>
          <svg className="w-4 h-4" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
          </svg>
          Complete Entity Hierarchy
        </SectionTitle>

        {/* Trust → LL */}
        <div className="flex flex-col items-center gap-2 mb-6">
          <div className="px-5 py-2.5 rounded-xl border-2 border-blue-500/30 bg-blue-500/10 text-center w-full max-w-sm">
            <p className="text-xs font-bold text-blue-400">Burton Family Revocable Trust</p>
            <p className="text-[10px] text-gray-500">100% owner · Receives K-1 from Ledger Louise</p>
          </div>
          <svg className="w-4 h-5 text-blue-400" viewBox="0 0 16 20"><path d="M8 0v20M4 16l4 4 4-4" fill="none" stroke="currentColor" strokeWidth={2} /></svg>
          <div className="px-5 py-2.5 rounded-xl border-2 border-blue-400/40 bg-blue-400/15 text-center w-full max-w-sm">
            <p className="text-sm font-bold" style={{ color: accent }}>Ledger Louise, LLC</p>
            <p className="text-[10px] text-gray-400">Holding & Management Company · Files Form 1065</p>
          </div>
        </div>

        {/* Connector line */}
        <div className="flex justify-center mb-2">
          <div className="w-[80%] h-px bg-white/10 relative">
            {[0, 33, 66, 100].map((pct) => (
              <div key={pct} className="absolute top-0 w-px h-3 bg-white/10" style={{ left: `${pct}%` }} />
            ))}
          </div>
        </div>
      </Card>

      {/* Subsidiary Detail Cards */}
      {subsidiaries.map((sub) => (
        <Card key={sub.name}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold" style={{ background: `${sub.color}20`, color: sub.color }}>
                {sub.name.charAt(0)}
              </div>
              <div>
                <h3 className="font-semibold text-sm">{sub.name}</h3>
                <p className="text-[10px] text-gray-500">{sub.role} · {sub.state}</p>
              </div>
            </div>
            <Badge status={statusColors[sub.status].badge} label={statusColors[sub.status].label} />
          </div>

          {/* Holdings */}
          <div className="mb-4">
            <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Holdings</p>
            <div className="space-y-1.5">
              {sub.holdings.map((h) => (
                <div key={h.name} className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                  <div>
                    <p className="text-xs font-medium text-gray-300">{h.name}</p>
                    <p className="text-[10px] text-gray-500">{h.type} · {h.ownership}</p>
                  </div>
                  <Badge status={statusColors[h.status].badge} label={statusColors[h.status].label} />
                </div>
              ))}
            </div>
          </div>

          {/* K-1 Items & Management Services side by side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">K-1 Items Expected</p>
              <div className="space-y-1">
                {sub.k1Items.map((item) => (
                  <div key={item} className="flex items-center gap-2 text-[10px] text-gray-400">
                    <span style={{ color: sub.color }}>&#8226;</span>
                    {item}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Management Services (MSA)</p>
              <div className="space-y-1">
                {sub.mgmtServices.map((svc) => (
                  <div key={svc} className="flex items-center gap-2 text-[10px] text-gray-400">
                    <span style={{ color: accent }}>&#8226;</span>
                    {svc}
                  </div>
                ))}
              </div>
              <div className="mt-2 px-2 py-1 rounded bg-white/[0.03] border border-white/5 inline-block">
                <p className="text-[10px] text-gray-500">Est. Fee: <span className="font-semibold text-gray-300">{sub.estimatedFee}</span></p>
              </div>
            </div>
          </div>
        </Card>
      ))}

      {/* Related Entities */}
      <Card>
        <SectionTitle>
          <svg className="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
          </svg>
          Related Entities — Ownership Verification Needed
        </SectionTitle>
        <p className="text-[10px] text-gray-500 mb-3">
          These entities appear in the org chart but their ownership chain through Ledger Louise needs verification. They may be held directly by the Trust, by a subsidiary, or by another family entity.
        </p>
        <div className="space-y-2">
          {relatedEntities.map((e) => (
            <div key={e.name} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/5">
              <div>
                <p className="text-xs font-semibold text-gray-300">{e.name}</p>
                <p className="text-[10px] text-gray-500">{e.type} · {e.relationship}</p>
              </div>
              <Badge status="blue" label="VERIFY" />
            </div>
          ))}
        </div>
      </Card>

      {/* Intercompany Flow Summary */}
      <Card>
        <SectionTitle>
          <svg className="w-4 h-4" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
          </svg>
          Intercompany Cash Flow Architecture
        </SectionTitle>
        <div className="space-y-3">
          {[
            { direction: "UP", label: "Subsidiaries → Ledger Louise", items: ["Distributions of operating profits", "K-1 income/loss allocations", "Management fee payments"], color: "#22c55e" },
            { direction: "DOWN", label: "Ledger Louise → Subsidiaries", items: ["Capital contributions for growth", "Intercompany loans", "Management services (billed via MSA)"], color: "#3b82f6" },
            { direction: "UP", label: "Ledger Louise → Trust", items: ["Distributions to Trust (per Section 5.01)", "K-1 reporting (Form 1065 → Schedule K-1)", "Tax information for Form 1041"], color: "#a855f7" },
          ].map((flow) => (
            <div key={flow.label} className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${flow.color}20`, color: flow.color }}>
                  {flow.direction === "UP" ? "↑" : "↓"}
                </span>
                <p className="text-xs font-semibold text-gray-300">{flow.label}</p>
              </div>
              <div className="ml-7 space-y-0.5">
                {flow.items.map((item) => (
                  <p key={item} className="text-[10px] text-gray-500">• {item}</p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ========================
// PHASE 5 — TAX & COMPLIANCE
// ========================
function TaxComplianceTab() {
  const federalFilings = [
    { form: "Form 1065", title: "U.S. Return of Partnership Income", frequency: "Annual", due: "March 15 (or Sept 15 with extension)", entity: "Ledger Louise, LLC", status: "red" as const, statusLabel: "VERIFY 2023/2024", notes: "Primary partnership return. Reports all income, deductions, credits. Generates Schedule K-1 for each partner." },
    { form: "Schedule K-1", title: "Partner's Share of Income, Deductions, Credits", frequency: "Annual (with 1065)", due: "With Form 1065", entity: "Issued to: Burton Family Revocable Trust", status: "red" as const, statusLabel: "VERIFY", notes: "Reports the Trust's 100% allocable share of income/loss. Trust then reports on Form 1041 or individual returns (if grantor trust)." },
    { form: "Form 7004", title: "Extension of Time to File", frequency: "As needed", due: "March 15", entity: "Ledger Louise, LLC", status: "yellow" as const, statusLabel: "CHECK", notes: "Provides automatic 6-month extension (to Sept 15). Must be filed by original due date. Does NOT extend time to pay." },
    { form: "Form 8825", title: "Rental Real Estate Income and Expenses", frequency: "Annual (if applicable)", due: "With Form 1065", entity: "Ledger Louise, LLC", status: "gray" as const, statusLabel: "IF APPLICABLE", notes: "Required if Ledger Louise directly holds rental real estate. May not apply if rental properties are held at subsidiary level." },
    { form: "Form 1041", title: "U.S. Income Tax Return for Estates and Trusts", frequency: "Annual", due: "April 15 (or Oct 15 with extension)", entity: "Burton Family Revocable Trust", status: "yellow" as const, statusLabel: "TRUST FILING", notes: "The Trust files this return and includes K-1 income from Ledger Louise. If grantor trust, income may flow to individual returns instead." },
  ];

  const stateFilings = [
    { state: "Nevada", filing: "Annual List of Members/Managers", due: "Last day of anniversary month (September)", fee: "$150", status: "yellow" as const, statusLabel: "VERIFY", notes: "Filed with NV Secretary of State. Lists managing members and registered agent. $150 filing fee." },
    { state: "Nevada", filing: "Business License Renewal", due: "Anniversary of formation", fee: "$200", status: "yellow" as const, statusLabel: "VERIFY", notes: "Nevada state business license. Required for all entities doing business in Nevada." },
    { state: "Nevada", filing: "Commerce Tax Return", due: "Aug 14 (for prior year)", fee: "0.051% if >$4M", status: "green" as const, statusLabel: "LIKELY N/A", notes: "Only applies if Nevada-sourced gross revenue exceeds $4M. Most holding companies fall below this threshold. Rate is 0.051% of gross revenue above $4M." },
    { state: "Arizona", filing: "Partnership Income Tax Return (Form 165)", due: "April 15", fee: "N/A", status: "yellow" as const, statusLabel: "EVALUATE", notes: "Required if Ledger Louise has Arizona-sourced income (e.g., through Swisshelm/AZ Center for Recovery). Arizona requires withholding on nonresident partners' shares." },
    { state: "California", filing: "Partnership Return (Form 565)", due: "March 15", fee: "$800 min tax", status: "yellow" as const, statusLabel: "EVALUATE", notes: "Required if doing business in CA or having CA-sourced income (e.g., through FDJ properties). California charges an $800 minimum annual LLC fee." },
  ];

  const complianceCalendar = [
    { month: "January", items: ["Gather subsidiary K-1s from prior year", "Begin Form 1065 preparation", "Send W-9s to any new vendors/service providers"] },
    { month: "March", items: ["File Form 1065 or Form 7004 extension (by March 15)", "Issue Schedule K-1 to Burton Family Revocable Trust", "File California Form 565 if applicable (by March 15)"] },
    { month: "April", items: ["Trust files Form 1041 or individual returns (by April 15)", "File Arizona Form 165 if applicable (by April 15)", "Q1 estimated tax payments if applicable"] },
    { month: "June", items: ["Q2 estimated tax payments if applicable", "Mid-year financial review", "Review intercompany balances"] },
    { month: "August", items: ["Nevada Commerce Tax return (by Aug 14) if applicable", "Review YTD financials and tax projections"] },
    { month: "September", items: ["File extended Form 1065 if extension was filed (by Sept 15)", "Nevada Annual List due (anniversary month)", "Nevada Business License renewal", "Q3 estimated tax payments if applicable"] },
    { month: "December", items: ["Year-end close procedures", "Review and finalize distributions", "Tax planning for next year", "Q4 estimated tax payments if applicable"] },
  ];

  const taxElections = [
    { election: "Partnership Tax Classification (Default)", code: "IRC 7701 / Form 8832", status: "green" as const, statusLabel: "CURRENT", description: "Ledger Louise defaults to partnership treatment as a multi-member LLC. No election needed — this is the correct classification for K-1 issuance.", recommendation: "Maintain current classification. Do NOT elect corporate treatment." },
    { election: "Section 754 — Basis Adjustment", code: "IRC 754", status: "gray" as const, statusLabel: "EVALUATE", description: "Allows step-up (or step-down) in basis of partnership assets when a partnership interest is transferred or when a distribution is made.", recommendation: "Consider if Trust plans to transfer interests to beneficiaries. A 754 election is irrevocable once made and applies to all future transfers." },
    { election: "Section 199A — QBI Deduction", code: "IRC 199A", status: "yellow" as const, statusLabel: "ANALYZE", description: "Qualified Business Income deduction allows 20% deduction on pass-through business income. Management company income may qualify if below income thresholds ($364,200 joint / $182,100 single for 2024).", recommendation: "CPA should analyze which income streams qualify. Real estate rental income has special rules. Specified service trades may be limited." },
    { election: "Tax Matters Partner Designation", code: "IRC 6223(a)", status: "green" as const, statusLabel: "DESIGNATED", description: "Robert W. Burton is designated as Tax Matters Member per the Operating Agreement. Responsible for all IRS communications, audits, and elections.", recommendation: "Current designation is appropriate. Ensure Robert W. Burton is aware of responsibilities." },
    { election: "Accounting Method", code: "IRC 446", status: "gray" as const, statusLabel: "DETERMINE", description: "Partnership must select cash or accrual method of accounting. Most small partnerships use cash method. Accrual required if gross receipts exceed $29M average over 3 years.", recommendation: "Cash method is likely appropriate for Ledger Louise as a holding company. CPA should confirm." },
    { election: "Depreciation Method (Subsidiaries)", code: "IRC 168 / Bonus Depreciation", status: "gray" as const, statusLabel: "EVALUATE", description: "Real estate subsidiaries should evaluate MACRS depreciation schedules. Bonus depreciation is phasing down: 40% in 2025, 20% in 2026, 0% in 2027.", recommendation: "Cost segregation studies on hotel properties (FDJ) could accelerate depreciation deductions flowing through K-1s." },
  ];

  return (
    <div className="space-y-6">
      {/* Federal Filing Requirements */}
      <Card>
        <SectionTitle>
          <svg className="w-4 h-4" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21" />
          </svg>
          Federal Filing Requirements
        </SectionTitle>
        <div className="space-y-2">
          {federalFilings.map((f) => (
            <div key={f.form + f.entity} className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{f.form}</span>
                  <p className="text-xs font-semibold text-gray-200">{f.title}</p>
                </div>
                <Badge status={f.status} label={f.statusLabel} />
              </div>
              <div className="flex gap-4 mt-1 text-[10px] text-gray-500">
                <span>Entity: {f.entity}</span>
                <span>Due: {f.due}</span>
                <span>Frequency: {f.frequency}</span>
              </div>
              <p className="text-[10px] text-gray-500 mt-1.5 leading-relaxed">{f.notes}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* State Filing Requirements */}
      <Card>
        <SectionTitle>
          <svg className="w-4 h-4" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
          </svg>
          State Filing Requirements
        </SectionTitle>
        <div className="rounded-lg border border-white/10 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03]">
                <th className="text-left px-3 py-2 text-gray-400 font-medium">State</th>
                <th className="text-left px-3 py-2 text-gray-400 font-medium">Filing</th>
                <th className="text-left px-3 py-2 text-gray-400 font-medium">Due</th>
                <th className="text-left px-3 py-2 text-gray-400 font-medium">Fee</th>
                <th className="text-center px-3 py-2 text-gray-400 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {stateFilings.map((s, i) => (
                <tr key={i} className="border-b border-white/5">
                  <td className="px-3 py-2 font-semibold text-gray-300">{s.state}</td>
                  <td className="px-3 py-2 text-gray-400">{s.filing}</td>
                  <td className="px-3 py-2 text-gray-400">{s.due}</td>
                  <td className="px-3 py-2 text-gray-400">{s.fee}</td>
                  <td className="px-3 py-2 text-center"><Badge status={s.status} label={s.statusLabel} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/10">
          <p className="text-[10px] text-yellow-400 leading-relaxed">
            <strong>California $800 Minimum:</strong> If Ledger Louise is deemed to be "doing business" in California (through Sundown's FDJ properties), it may owe an $800 annual LLC fee regardless of income. This is separate from the subsidiary's own California filing obligations.
          </p>
        </div>
      </Card>

      {/* Tax Elections & Strategies */}
      <Card>
        <SectionTitle>
          <svg className="w-4 h-4" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Tax Elections & Strategies
        </SectionTitle>
        <div className="space-y-3">
          {taxElections.map((e) => (
            <div key={e.election} className="p-4 rounded-lg bg-white/[0.02] border border-white/5">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-xs font-semibold text-gray-200">{e.election}</p>
                  <p className="text-[10px] font-mono text-gray-600">{e.code}</p>
                </div>
                <Badge status={e.status} label={e.statusLabel} />
              </div>
              <p className="text-[10px] text-gray-500 leading-relaxed mb-2">{e.description}</p>
              <div className="p-2 rounded bg-blue-500/5 border border-blue-500/10">
                <p className="text-[10px] text-blue-400 leading-relaxed"><strong>Recommendation:</strong> {e.recommendation}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Compliance Calendar */}
      <Card>
        <SectionTitle>
          <svg className="w-4 h-4" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
          Annual Compliance Calendar
        </SectionTitle>
        <div className="space-y-2">
          {complianceCalendar.map((month) => (
            <div key={month.month} className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
              <p className="text-xs font-semibold text-gray-200 mb-1.5">{month.month}</p>
              <div className="space-y-1 ml-2">
                {month.items.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-[10px] text-gray-400">
                    <span className="text-blue-400 mt-0.5">&#9679;</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Penalty Exposure Summary */}
      <Card>
        <SectionTitle>
          <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          Penalty Exposure Summary
        </SectionTitle>
        <div className="rounded-lg border border-white/10 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03]">
                <th className="text-left px-4 py-2 text-gray-400 font-medium">Penalty Type</th>
                <th className="text-left px-4 py-2 text-gray-400 font-medium">IRC Section</th>
                <th className="text-left px-4 py-2 text-gray-400 font-medium">Rate</th>
                <th className="text-right px-4 py-2 text-gray-400 font-medium">Max Exposure</th>
              </tr>
            </thead>
            <tbody>
              {[
                { type: "Late filing Form 1065 (2023)", code: "IRC 6698", rate: "$220/month × 1 partner × up to 12 months", max: "$2,640" },
                { type: "Late filing Form 1065 (2024)", code: "IRC 6698", rate: "$220/month × 1 partner × up to 12 months", max: "$2,640" },
                { type: "Late K-1 to Trust", code: "IRC 6722", rate: "$290 per incorrect/late K-1 (2024)", max: "$290" },
                { type: "Nevada Annual List late fee", code: "NRS 86.5628", rate: "$150 + penalties", max: "$150+" },
                { type: "Failure to file state returns (AZ/CA)", code: "Varies", rate: "Varies by state", max: "TBD" },
              ].map((p) => (
                <tr key={p.type} className="border-b border-white/5">
                  <td className="px-4 py-2.5 text-gray-300">{p.type}</td>
                  <td className="px-4 py-2.5 font-mono text-gray-500 text-[10px]">{p.code}</td>
                  <td className="px-4 py-2.5 text-gray-400">{p.rate}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-red-400">{p.max}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex justify-between items-center p-3 rounded-lg bg-red-500/5 border border-red-500/10">
          <p className="text-xs text-red-400 font-semibold">Total Maximum Exposure (if 2023 + 2024 unfiled)</p>
          <p className="text-lg font-bold text-red-400">$5,720+</p>
        </div>
        <p className="text-[10px] text-gray-500 mt-2 leading-relaxed">
          <strong>Note:</strong> The IRS may abate first-time penalties under the First Time Penalty Abatement (FTA) program if Ledger Louise has no prior penalty history. CPA should request abatement when filing delinquent returns.
        </p>
      </Card>
    </div>
  );
}

// ========================
// PLACEHOLDER TAB (Phase 6)
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
      {activeTab === "k1" && <K1ReadinessTab />}
      {activeTab === "activation" && <ActivationTab />}
      {activeTab === "subsidiaries" && <SubsidiaryMapTab />}
      {activeTab === "tax" && <TaxComplianceTab />}
      {activeTab === "roadmap" && <PlaceholderTab phase={6} title="Transformation Roadmap" />}
    </div>
  );
}
