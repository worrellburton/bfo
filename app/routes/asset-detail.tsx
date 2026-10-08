import { Fragment, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTheme } from "../theme";
import { authFetch } from "../auth";
import { entityCompleteness, entityType, TAX_CLASSES, type EntityType } from "../entity-completeness";
import { alertDialog, confirmDialog } from "../confirm-dialog";
import { isAdmin as userIsAdmin } from "../auth";
import {
  DOC_LABEL,
  docKindOf,
  formatAddress as formatPalmAddress,
  normalizeName,
  openPalmDocument,
  palmCall,
  PalmCallError,
  palmJurisdiction,
  PalmUnavailable,
  pickRegistryMatch,
  RA_STATUS,
  sortDocuments,
  stateFindings,
  toStateRecord,
  type PalmDocument,
  type PalmLink,
  type PalmMode,
  type RaService,
  type RegistryRecord,
  type StateRecord,
} from "../palm";
import {
  BOI_NOTE,
  DOC_KEYS,
  documentRules,
  obligations,
  paperworkChecks,
  stateCode,
  taxHome,
  type DocKey,
  type DocRule,
  type PaperworkInput,
} from "../entity-paperwork";

export function meta() {
  return [{ title: "BFO - Asset" }];
}

interface Asset {
  name: string;
  type: "LLC" | "C-Corp" | "LP" | "Trust";
  state: string;
  ein: string;
  createdAt: number;
  registeredAgent?: string;
  address?: string;
  formationDate?: string;
  status?: string;
  notes?: string;
  ownerId?: string;
  llcType?: string; // tax classification (LLC/corp options, or grantor / non-grantor for a trust)
  /** Where the tax class came from: a document's evidence, or "Entered by hand". Absent = never confirmed. */
  llcTypeSource?: string;
  /** A document states a different tax class than the record. */
  llcTypeConflict?: { value: string; evidence: string; docName: string; at: number } | null;
  trustees?: string;
  grantors?: string;
  beneficiaries?: string;
  stateLink?: string;
  /** The state's file / registration number for the entity. */
  fileNumber?: string;
  /** Where the registered agent value came from, when not typed by hand. */
  registeredAgentSource?: string;
  /** Palm links, one per mode — test and live data never mix. */
  palm?: Partial<Record<PalmMode, PalmLink>>;
  /** The state's record as last read through Palm. */
  stateRecord?: StateRecord;
  operatingAgreementDate?: string;
  articlesOfOrgDate?: string;
  w9?: UploadedFile;
  articles?: UploadedFile;
  einLetter?: UploadedFile;
  operatingAgreement?: UploadedFile;
  trustAgreement?: UploadedFile;
  trustCertificate?: UploadedFile;
  trustSchedule?: UploadedFile;
  sElection?: UploadedFile;
  sElectionAccepted?: UploadedFile;
  classElection?: UploadedFile;
  annualReport?: UploadedFile;
  foreignRegistration?: UploadedFile;
  goodStanding?: UploadedFile;
  ownershipLedger?: UploadedFile;
  minutes?: UploadedFile;
  /** Owners and managers as a document lists them (operating agreement, ledger, articles). */
  members?: Member[];
  membersSource?: string;
  /** Year the latest annual report / tax receipt on file covers. */
  annualReportYear?: number;
  /** What the entity is, read from its governing documents. */
  profile?: EntityProfile;
  verification?: Verification;
}

type Member = { name: string; percent: number | null; role: string | null };

type EntityProfile = {
  whatItIs: string;
  purpose: string | null;
  properties: { description: string; state: string | null; status: string | null }[];
  management: string | null;
  managers: string[];
  members: { name: string; percent: number | null; since: string | null }[];
  taxTreatment: string | null;
  taxEvidence: string | null;
  governingLaw: string | null;
  partnershipRepresentative: string | null;
  keyTerms: string[];
  issues: string[];
  sources: string[];
  documentsRead?: string[];
  checkedAt: number;
};

type VerifyField =
  | "name" | "type" | "state" | "ein" | "formationDate" | "address"
  | "registeredAgent" | "llcType" | "operatingAgreementDate" | "articlesOfOrgDate"
  | "trustees" | "grantors" | "beneficiaries";

interface Verification {
  checkedAt: number;
  summary: string;
  fields: { field: VerifyField; found: string | null; status: "match" | "mismatch" | "missing_on_record" | "not_found"; source: string | null; note: string | null }[];
  owners: { name: string; percent: number | null; source: string | null }[];
  ownershipStatus: "match" | "mismatch" | "unclear";
  issues: { severity: "high" | "medium" | "low"; message: string }[];
  documentsRead: string[];
  /** The record as it was when checked — so stale findings can be spotted. */
  recordAtCheck?: Partial<Record<VerifyField, string>>;
}

const VERIFY_LABEL: Record<VerifyField, string> = {
  name: "Legal name",
  type: "Entity type",
  state: "State of formation",
  ein: "EIN",
  formationDate: "Formation date",
  address: "Principal address",
  registeredAgent: "Registered agent",
  llcType: "Tax classification",
  operatingAgreementDate: "Operating agreement date",
  articlesOfOrgDate: "Articles filing date",
  trustees: "Trustees",
  grantors: "Grantors",
  beneficiaries: "Beneficiaries",
};

interface UploadedFile {
  url: string;
  fileName: string;
  size: number;
  contentType: string;
  uploadedAt: number;
  storagePath: string; // "" when the slot points at a Documents entry
  docId?: string; // set when filed from the Documents library (no separate copy)
}

interface CorpData {
  // Board of Directors
  directors?: Record<string, { name: string; title: string; since: string }>;
  // Officers
  officers?: Record<string, { name: string; title: string; since: string }>;
  // Shareholders
  shareholders?: Record<string, { name: string; shares: number; class: string; percentage: number }>;
  // Stock info
  authorizedShares?: number;
  issuedShares?: number;
  parValue?: string;
  stockClasses?: string;
  // Compliance
  fiscalYearEnd?: string;
  annualReportDue?: string;
  nextBoardMeeting?: string;
  stateFilingStatus?: string;
  // Key dates
  incorporationDate?: string;
  lastAnnualReport?: string;
  lastBoardMeeting?: string;
}

interface AssetDoc {
  id: string;
  name: string;
  url: string;
  createdAt: number;
  storagePath?: string;
  storageProvider?: "supabase" | "firebase";
  size?: number;
  contentType?: string;
  factsCheckedAt?: number; // key facts already read from this document
  classReadAt?: number; // tax classification already read from this document
  autoFileSkip?: boolean; // removed from a filing slot by hand — don't auto-file again
}

interface OperatingContract {
  id: string;
  counterparty: string;
  role: "manager" | "managed";
  services: string[];
  fee: string;
  frequency: string;
  effectiveDate: string;
  term: string;
  status: "draft" | "active" | "terminated";
  referralCredit?: boolean;
  letterhead?: "bfo" | "robert";
  createdAt: number;
}

const MSA_SERVICES = [
  "Financial Management & Oversight",
  "AI, Automation & Technology Management",
  "SEO & Digital Marketing",
  "Bookkeeping & Accounting",
  "Tax Coordination & Planning",
  "Bank Account Management",
  "Compliance & Regulatory Oversight",
  "Strategic Planning & Advisory",
  "Custom Infrastructure Engineering",
  "Data Engineering & Analytics",
  "Solutions Engineering",
  "Fractional CFO",
  "Fractional CTO",
];

const LEDGER_LOUISE_SUBS = [
  "Swisshelm Mountain Ventures, LLC",
  "Sundown Investments, LLC",
  "Ledger Burton, LLC",
  "Worrell Burton, LLC",
];

// Older contracts stored two separate AI services that are now one line.
const SERVICE_ALIASES: Record<string, string> = {
  "AI & Technology Management": "AI, Automation & Technology Management",
  "AI Agent & Automation Development": "AI, Automation & Technology Management",
};
function normalizeServices(list: string[]): string[] {
  const out: string[] = [];
  for (const s of list) {
    const mapped = SERVICE_ALIASES[s] || s;
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out;
}

// Outline icon paths (heroicons v1 geometry) used across the page.
const ICON_PATHS = {
  chevronLeft: "M15 19l-7-7 7-7",
  chevronDown: "M19 9l-7 7-7-7",
  doc: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  page: "M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z",
  edit: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
  trash: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M4 7h16M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3",
  plus: "M12 4v16m8-8H4",
  external: "M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14",
  download: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4",
  upload: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12",
  replace: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
  copy: "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z",
  check: "M5 13l4 4L19 7",
  link: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1",
  sparkle: "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z",
} as const;

function Icon({ name, className = "w-3.5 h-3.5", strokeWidth = 1.75 }: { name: keyof typeof ICON_PATHS; className?: string; strokeWidth?: number }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={strokeWidth} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={ICON_PATHS[name]} />
    </svg>
  );
}

// "2025-01-01" -> "Jan 1, 2025" (parsed as a local date so it never shifts a day).
// Anything that isn't a plain ISO date is shown as typed.
function fmtDate(value?: string): string {
  if (!value) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

type EntityTab = "overview" | "documents" | "compliance" | "agreements" | "governance";

// A moment as a local calendar date ("Oct 7, 2026") — not the UTC day.
function fmtStamp(ms?: number): string {
  return ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
}

// Short file-kind label for the document list tile.
function docKind(doc: { contentType?: string; storagePath?: string }): string {
  const ct = (doc.contentType || "").toLowerCase();
  if (!ct) return doc.storagePath ? "FILE" : "LINK";
  if (ct.includes("pdf")) return "PDF";
  if (ct.includes("wordprocessing") || ct.includes("msword")) return "DOC";
  if (ct.includes("spreadsheet") || ct.includes("excel") || ct.includes("csv")) return "XLS";
  if (ct.includes("presentation") || ct.includes("powerpoint")) return "PPT";
  const sub = ct.split("/").pop() || "";
  return sub.replace(/[^a-z0-9]/g, "").slice(0, 4).toUpperCase() || "FILE";
}

/** Compare values the way a person would: case, punctuation and legal suffixes aside. */
function normValue(v: string | null | undefined): string {
  return (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function normEntityName(v: string | null | undefined): string {
  return (v ?? "")
    .toLowerCase()
    .replace(/\(\d+%\)/g, "")
    .replace(/[,.]/g, " ")
    .replace(/\b(llc|l l c|inc|incorporated|corp|corporation|lp|ltd|limited partnership|limited liability company)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function timeAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

// ── Formation filings ────────────────────────────────────────────────────
type FileKind = DocKey;
/** Every slot an entity can have — for lookups that don't care about type. */
const FILING_KINDS: FileKind[] = DOC_KEYS;

const FALLBACK_TITLE: Record<FileKind, string> = {
  articles: "Formation filing",
  einLetter: "EIN Letter",
  w9: "Form W-9",
  operatingAgreement: "Governing agreement",
  trustAgreement: "Trust Agreement",
  trustCertificate: "Certification of Trust",
  trustSchedule: "Schedule A & assignments",
  sElection: "Form 2553 (S election)",
  sElectionAccepted: "CP261 (S election accepted)",
  classElection: "Form 8832 + IRS acceptance",
  annualReport: "Annual report",
  foreignRegistration: "Foreign registration",
  goodStanding: "Certificate of Good Standing",
  ownershipLedger: "Ownership ledger",
  minutes: "Minutes / consents",
};

/** The rule book's entry for this slot on this entity, if it applies. */
function ruleFor(kind: FileKind, a?: PaperworkInput | null): DocRule | undefined {
  return a ? documentRules(a).find((r) => r.key === kind) : undefined;
}

function filingTitle(kind: FileKind, a?: PaperworkInput | null): string {
  return ruleFor(kind, a)?.title ?? FALLBACK_TITLE[kind];
}

/** A confident guess from the document's name alone. */
function guessFiling(name: string): FileKind | null {
  const n = name.toLowerCase();
  if (/certification of trust|certificate of trust|trust certificate|abstract of trust|memorandum of trust/.test(n)) return "trustCertificate";
  if (/trust agreement|declaration of trust|trust instrument|trust indenture|amended and restated .*trust/.test(n)) return "trustAgreement";
  // A file named for the trust itself ("… Burton Family Revocable Trust") is
  // the trust instrument, unless the name says it's something about the trust.
  if (/(revocable|living|family|irrevocable) trust\b/.test(n) && !/certif|existence|assignment|appointment|amendment|schedule|resignation|memorandum|abstract|deed|transfer/.test(n)) return "trustAgreement";
  if (/schedule a\b|trust schedule|assignment of (membership|interest|llc)|assignment to (the )?trust/.test(n)) return "trustSchedule";
  if (/\bcp[\s-]?261\b|s[- ]?(corp(oration)?)? election accept/.test(n)) return "sElectionAccepted";
  if (/\b2553\b|s[- ]?corp(oration)? election|\bs election\b/.test(n)) return "sElection";
  if (/\b8832\b|entity classification/.test(n)) return "classElection";
  if (/good standing|certificate of (existence|status)/.test(n)) return "goodStanding";
  if (/foreign (registration|qualification)|application for (registration|authority)|\bl[\s-]?025\b/.test(n)) return "foreignRegistration";
  if (/annual (report|list|tax)|franchise tax|biennial statement|state business license/.test(n)) return "annualReport";
  if (/membership (ledger|list|register)|member (list|register)|stock (ledger|certificate)|cap(italization)? table|share register|partner register/.test(n)) return "ownershipLedger";
  if (/\bminutes\b|written consent|resolutions?\b|organizational (meeting|action)/.test(n)) return "minutes";
  if (/\bw[\s-]?9\b/.test(n)) return "w9";
  if (/\bein\b|\bcp[\s-]?575\b|\b147[\s-]?c\b|\bss[\s-]?4\b|employer identification/.test(n)) return "einLetter";
  if (/operating agreement|\bllc agreement\b|\bbylaws?\b|partnership agreement/.test(n)) return "operatingAgreement";
  if (/articles? of (organization|incorporation|formation)|certificate of (formation|incorporation|organization|limited partnership)|\barticles\b/.test(n)) return "articles";
  return null;
}

const CLASSIFIER_KIND: Record<string, FileKind | undefined> = {
  ein_letter: "einLetter",
  w9: "w9",
  articles: "articles",
  operating_agreement: "operatingAgreement",
  trust_agreement: "trustAgreement",
  trust_certificate: "trustCertificate",
  trust_schedule: "trustSchedule",
  s_election: "sElection",
  s_election_accepted: "sElectionAccepted",
  classification_election: "classElection",
  annual_report: "annualReport",
  foreign_registration: "foreignRegistration",
  good_standing: "goodStanding",
  ownership_ledger: "ownershipLedger",
  minutes: "minutes",
};

type Classified = {
  kind: string;
  confidence: "high" | "medium" | "low";
  ein: string | null;
  date: string | null;
  state: string | null;
  trustees?: string | null;
  grantors?: string | null;
  beneficiaries?: string | null;
  taxClassification?: string | null;
  taxClassificationEvidence?: string | null;
  filingYear?: number | null;
  registeredAgent?: string | null;
  principalAddress?: string | null;
  members?: Member[] | null;
};

/** Filings that state an entity's federal tax classification. */
const TAX_CLASS_KINDS: ReadonlySet<string> = new Set(["einLetter", "w9", "operatingAgreement"]);

/** A tax class source written by a person rather than read off a document. */
const BY_HAND = "Entered by hand";

// Services Included: dropdown with a per-service toggle, plus a reorderable
// selected list — the order here is the order services appear in the contract PDF.
function ServicesDropdown({
  selected,
  onChange,
  isDark,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  isDark: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const unselected = MSA_SERVICES.filter((s) => !selected.includes(s));
  const drop = (to: number) => {
    if (dragIndex === null || dragIndex === to) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    const next = [...selected];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(to, 0, moved);
    onChange(next);
    setDragIndex(null);
    setOverIndex(null);
  };
  const sw = (on: boolean) =>
    `relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors cursor-pointer max-sm:after:absolute max-sm:after:-inset-[15px] max-sm:after:content-[''] ${on ? (isDark ? "bg-[#818cf8]" : "bg-[#4f46e5]") : isDark ? "bg-white/15" : "bg-gray-300"}`;
  const knob = (on: boolean) =>
    `inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${on ? "translate-x-3.5" : "translate-x-0.5"}`;
  return (
    <div>
      <p className="text-[11px]  mb-2 text-gray-500">Services Included</p>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex items-center gap-2 text-xs h-7 max-sm:h-[40px] px-3 rounded-lg border cursor-pointer transition-colors ${isDark ? "bg-white/[0.03] border-white/[0.12] text-gray-200 hover:bg-white/[0.06]" : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"}`}
      >
        <span>{selected.length} service{selected.length === 1 ? "" : "s"} selected</span>
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className={`mt-2 w-full max-w-md rounded-lg border p-1 ${isDark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-gray-200"}`}>
          {selected.map((svc, i) => (
            <div
              key={svc}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragIndex !== null && overIndex !== i) setOverIndex(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(i);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-grab active:cursor-grabbing ${dragIndex === i ? "opacity-40" : ""} ${overIndex === i && dragIndex !== null && dragIndex !== i ? (isDark ? "bg-white/10" : "bg-indigo-50") : isDark ? "hover:bg-white/5" : "hover:bg-gray-50"}`}
            >
              <span className={`shrink-0 ${isDark ? "text-gray-500" : "text-gray-400"}`} title="Drag to reorder">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
                  <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
                  <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
                </svg>
              </span>
              <span className="flex-1 text-xs">{svc}</span>
              <button type="button" onClick={() => onChange(selected.filter((s) => s !== svc))} className={sw(true)} title="Remove from contract">
                <span className={knob(true)} />
              </button>
            </div>
          ))}
          {unselected.length > 0 && (
            <div className={`mt-1 pt-1 border-t ${isDark ? "border-white/10" : "border-gray-200"}`}>
              {unselected.map((svc) => (
                <div key={svc} className={`flex items-center gap-2 px-2 py-1.5 rounded-md ${isDark ? "hover:bg-white/5" : "hover:bg-gray-50"}`}>
                  <span className={`flex-1 text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}>{svc}</span>
                  <button type="button" onClick={() => onChange([...selected, svc])} className={sw(false)} title="Add to contract">
                    <span className={knob(false)} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Firebase drops empty arrays (and objects) on write, so a stored profile with
 * no properties or issues comes back without those keys. Restore them on read.
 */
function fromDatabase(raw: Asset): Asset {
  const list = <T,>(v: T[] | Record<string, T> | undefined | null): T[] => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []);
  const a: Asset = { ...raw };
  if (a.profile) {
    const p = a.profile;
    a.profile = {
      ...p,
      whatItIs: p.whatItIs ?? "",
      properties: list(p.properties),
      managers: list(p.managers),
      members: list(p.members),
      keyTerms: list(p.keyTerms),
      issues: list(p.issues),
      sources: list(p.sources),
      checkedAt: p.checkedAt ?? 0,
    };
  }
  if (a.stateRecord) a.stateRecord = { ...a.stateRecord, managers: list(a.stateRecord.managers) };
  if (a.members) a.members = list(a.members);
  if (a.verification) {
    const v = a.verification;
    a.verification = { ...v, fields: list(v.fields), owners: list(v.owners), issues: list(v.issues), documentsRead: list(v.documentsRead) };
  }
  return a;
}

export default function AssetDetail() {
  const { id, tab: tabParam } = useParams();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const inputCls = `${isDark ? "bg-white/[0.03] border-white/10 text-white focus:border-[#818cf8]/60" : "bg-white border-gray-200 text-gray-900 focus:border-[#4f46e5]/50"} border rounded-lg placeholder-gray-500 focus:outline-none transition-colors max-sm:text-[16px]`;
  const cardCls = `${isDark ? "bg-white/[0.02] border-white/[0.08]" : "bg-white border-gray-200"} border rounded-lg`;

  // Design tokens: hairline surfaces, mono kickers, indigo accent used sparingly.
  const surface = isDark
    ? "border border-white/[0.08] bg-white/[0.02]"
    : "border border-gray-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_1px_3px_rgba(16,24,40,0.03)]";
  const hairline = isDark ? "border-white/[0.08]" : "border-gray-200";
  const divider = isDark ? "border-white/[0.06]" : "border-gray-100";
  const kicker = "text-[12px] font-medium text-gray-500";
  const textMuted = "text-gray-500";
  const textSoft = isDark ? "text-gray-400" : "text-gray-600";
  const accentText = isDark ? "text-[#a5b4fc]" : "text-[#4f46e5]";
  const accentBg = isDark ? "bg-[#818cf8]" : "bg-[#4f46e5]";
  const accentTile = isDark ? "bg-[#818cf8]/10 text-[#a5b4fc]" : "bg-[#4f46e5]/[0.07] text-[#4f46e5]";
  const neutralTile = isDark ? "bg-white/[0.04] text-gray-400" : "bg-gray-100 text-gray-500";
  const rowBorder = isDark ? "border-white/[0.06]" : "border-gray-100";
  const rowHover = isDark ? "hover:bg-white/[0.025]" : "hover:bg-gray-50/80";
  // Mobile hit areas: the root font is 11.9px, so mobile minimums are in px.
  const hit = "relative max-sm:after:absolute max-sm:after:-inset-[15px] max-sm:after:content-['']";
  const hitY = "relative max-sm:after:absolute max-sm:after:inset-x-0 max-sm:after:-inset-y-[13px] max-sm:after:content-['']";
  const btnBase = "inline-flex items-center justify-center gap-1.5 h-8 max-sm:h-[40px] px-3 rounded-lg text-[12px] font-medium whitespace-nowrap transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
  const btnPrimary = `${btnBase} ${isDark ? "bg-white text-gray-950 hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-gray-700"}`;
  const btnOutline = `${btnBase} border ${isDark ? "border-white/[0.12] text-gray-200 hover:bg-white/[0.06]" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`;
  const btnGhostDanger = `${btnBase} ${isDark ? "text-red-400/90 hover:bg-red-500/10" : "text-red-600 hover:bg-red-50"}`;
  const btnXs = "inline-flex items-center justify-center gap-1 h-7 max-sm:h-[40px] px-2 max-sm:px-3 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer disabled:opacity-40";
  const btnXsPrimary = `${btnXs} ${isDark ? "bg-white text-gray-950 hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-gray-700"}`;
  const btnXsOutline = `${btnXs} border ${isDark ? "border-white/[0.1] text-gray-300 hover:bg-white/[0.06]" : "border-gray-200 text-gray-700 hover:bg-gray-50"}`;
  const btnXsGhost = `${btnXs} ${isDark ? "text-gray-400 hover:text-white hover:bg-white/[0.06]" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"}`;
  const iconBtn = `inline-flex items-center justify-center h-7 w-7 max-sm:h-[40px] max-sm:w-[40px] rounded-md transition-colors cursor-pointer disabled:opacity-40 ${isDark ? "text-gray-400 hover:text-white hover:bg-white/[0.06]" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"}`;
  const iconBtnDanger = `inline-flex items-center justify-center h-7 w-7 max-sm:h-[40px] max-sm:w-[40px] rounded-md transition-colors cursor-pointer disabled:opacity-40 ${isDark ? "text-gray-500 hover:text-red-400 hover:bg-red-500/10" : "text-gray-400 hover:text-red-600 hover:bg-red-50"}`;
  const switchOn = accentBg;
  const switchOff = isDark ? "bg-white/15" : "bg-gray-300";
  const [asset, setAsset] = useState<Asset | null>(null);
  const [docs, setDocs] = useState<AssetDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Asset>>({});

  // Sub-pages: the entity card stays on top; a category menu switches what's below.
  // After switching, scroll to the part that was asked for once it has rendered.
  const pendingScroll = useRef<{ id: string; block: ScrollLogicalPosition } | null>(null);
  const activeTabRef = useRef<HTMLAnchorElement | null>(null);
  // On a phone the menu scrolls sideways: keep the current category in view
  // (moving only the menu, never the page), including once it first appears.
  useEffect(() => {
    const el = activeTabRef.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const left = el.offsetLeft - box.offsetLeft;
    if (left < box.scrollLeft || left + el.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollTo({ left: Math.max(0, left - 8) });
  }, [tabParam, loading]);
  useEffect(() => {
    const p = pendingScroll.current;
    if (!p) return;
    pendingScroll.current = null;
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(p.id)?.scrollIntoView({ behavior: "smooth", block: p.block })));
  }, [tabParam]);
  function tabPath(t: EntityTab) {
    return t === "overview" ? `/assets/${id}` : `/assets/${id}/${t}`;
  }
  function goToTab(t: EntityTab, anchor?: string, block: ScrollLogicalPosition = "start") {
    const current = (tabParam ?? "overview") as EntityTab;
    if (current === t) {
      if (anchor) document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block });
      return;
    }
    pendingScroll.current = anchor ? { id: anchor, block } : null;
    navigate(tabPath(t));
  }

  // Corp management
  const [corpData, setCorpData] = useState<CorpData>({});
  const [corpTab, setCorpTab] = useState<"board" | "officers" | "shareholders" | "stock" | "compliance">("board");
  const [addingDirector, setAddingDirector] = useState(false);
  const [addingOfficer, setAddingOfficer] = useState(false);
  const [addingShareholder, setAddingShareholder] = useState(false);
  const [dirForm, setDirForm] = useState({ name: "", title: "Director", since: "" });
  const [offForm, setOffForm] = useState({ name: "", title: "", since: "" });
  const [shForm, setShForm] = useState({ name: "", shares: "", class: "Common", percentage: "" });

  // Operating contracts
  const [contracts, setContracts] = useState<OperatingContract[]>([]);
  const [addingContract, setAddingContract] = useState(false);
  const [contractForm, setContractForm] = useState({
    counterparty: "",
    fee: "$500",
    frequency: "Quarterly",
    effectiveDate: new Date().toISOString().slice(0, 10),
    term: "Annual, auto-renewing",
    status: "draft" as "draft" | "active" | "terminated",
    services: [...MSA_SERVICES] as string[],
    referralCredit: false,
    letterhead: "bfo" as "bfo" | "robert",
  });

  // Doc form
  const [docName, setDocName] = useState("");
  const [docUrl, setDocUrl] = useState("");

  // Formation filing slots (EIN letter, W-9, Articles, Operating Agreement)
  const [uploadState, setUploadState] = useState<Record<FileKind, { uploading: boolean; progress: number; error: string | null; dragOver: boolean }>>(
    () => Object.fromEntries(FILING_KINDS.map((k) => [k, { uploading: false, progress: 0, error: null, dragOver: false }])) as Record<FileKind, { uploading: boolean; progress: number; error: string | null; dragOver: boolean }>
  );
  // The slots the rule book asks for, plus any other slot that holds a file.
  const kindsFor = (a: Asset | null): FileKind[] => {
    const keys = documentRules(a ?? {}).map((r) => r.key);
    for (const k of FILING_KINDS) if (a?.[k] && !keys.includes(k)) keys.push(k);
    return keys;
  };
  // Auto-filing: notes about where uploads went, and how many are being read.
  const [filingNotes, setFilingNotes] = useState<string[]>([]);
  const [sorting, setSorting] = useState(0);
  // Set when the document reader is unavailable (e.g. the AI account is out of credit).
  const [aiDown, setAiDownState] = useState<string | null>(null);
  // Mirrors aiDown so a running scan can tell, at the end, whether it could read anything.
  const aiDownRef = useRef<string | null>(null);
  const setAiDown = (v: string | null) => {
    aiDownRef.current = v;
    setAiDownState(v);
  };
  // Live progress for "Scan existing documents", shown as a toast at the bottom.
  const [scan, setScan] = useState<{ total: number; done: number; current: string | null; notes: string[]; finished: boolean } | null>(null);
  const scanHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assetRef = useRef<Asset | null>(null);
  assetRef.current = asset;
  const claimedRef = useRef<Set<FileKind>>(new Set());
  const setSlot = (k: FileKind, patch: Partial<{ uploading: boolean; progress: number; error: string | null; dragOver: boolean }>) =>
    setUploadState((s) => ({ ...s, [k]: { ...s[k], ...patch } }));

  // Documents drag-drop zone state
  const [docDrop, setDocDrop] = useState<{
    dragOver: boolean;
    uploading: string | null; // current file name being uploaded
    progress: number; // overall batch progress, 0–100
    index: number; // 1-based position of the current file in the batch
    total: number; // files in the batch (grows if more are queued mid-batch)
    error: string | null;
  }>({ dragOver: false, uploading: null, progress: 0, index: 0, total: 0, error: null });
  // Batch upload queue. Refs so files dropped mid-batch append to the running
  // loop instead of starting a second one.
  const docQueueRef = useRef<File[]>([]);
  const docBatchRef = useRef<{ running: boolean; done: number; total: number; failures: { name: string; reason: string }[] }>({
    running: false,
    done: 0,
    total: 0,
    failures: [],
  });
  const [copiedDocId, setCopiedDocId] = useState<string | null>(null);
  const [renamingDocId, setRenamingDocId] = useState<string | null>(null);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const copiedEin = copied === "ein";
  const [showDone, setShowDone] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [showMatches, setShowMatches] = useState(false);
  const [assetNames, setAssetNames] = useState<Record<string, string>>({});
  // Every entity's record (light) — to follow ownership up the chain for
  // whose return a disregarded entity lands on, and to check the owner.
  const [allAssets, setAllAssets] = useState<Record<string, PaperworkInput & { ownerId?: string }>>({});
  const [showRecommended, setShowRecommended] = useState(false);

  // Contract editing
  const [editingContractId, setEditingContractId] = useState<string | null>(null);
  const [editContractForm, setEditContractForm] = useState({
    counterparty: "",
    fee: "",
    frequency: "Quarterly",
    effectiveDate: "",
    term: "",
    status: "draft" as "draft" | "active" | "terminated",
    services: [...MSA_SERVICES] as string[],
    referralCredit: false,
    letterhead: "bfo" as "bfo" | "robert",
  });

  useEffect(() => {
    let unsub1: (() => void) | undefined;
    let unsub2: (() => void) | undefined;
    let unsub5: (() => void) | undefined;
    let unsub6: (() => void) | undefined;

    async function setup() {
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, onValue } = await import("firebase/database");

      unsub1 = onValue(ref(db, `assets/${id}`), (snapshot) => {
        const data = snapshot.val();
        // The edit form is seeded when editing starts (startEditing), so a
        // background write (auto-filing, enrichment) never wipes what's typed.
        if (data) setAsset(fromDatabase(data as Asset));
        setLoading(false);
      });

      unsub2 = onValue(ref(db, `assets/${id}/documents`), (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const arr = Object.entries(data).map(([docId, value]) => ({
            id: docId,
            ...(value as Omit<AssetDoc, "id">),
          }));
          arr.sort((a, b) => b.createdAt - a.createdAt);
          setDocs(arr);
        } else {
          setDocs([]);
        }
      });

      // Every entity's name — to show and set who owns this one.
      const { get } = await import("firebase/database");
      get(ref(db, "assets"))
        .then((snap) => {
          const all = (snap.val() ?? {}) as Record<string, { name?: string }>;
          setAssetNames(Object.fromEntries(Object.entries(all).filter(([, v]) => v?.name).map(([k, v]) => [k, v.name as string])));
          setAllAssets(all as Record<string, PaperworkInput & { ownerId?: string }>);
        })
        .catch(() => {});

      // Corp data
      unsub5 = onValue(ref(db, `assets/${id}/corp`), (snapshot) => {
        const data = snapshot.val();
        setCorpData(data ? (data as CorpData) : {});
      });

      // Operating contracts
      unsub6 = onValue(ref(db, `assets/${id}/contracts`), (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const arr = Object.entries(data).map(([cId, value]) => ({
            id: cId,
            ...(value as Omit<OperatingContract, "id">),
          }));
          // Active first, then draft, then terminated; alpha within each group
          const rank = (s: string) => (s === "active" ? 0 : s === "draft" ? 1 : 2);
          arr.sort((a, b) => {
            const r = rank(a.status) - rank(b.status);
            return r !== 0 ? r : a.counterparty.localeCompare(b.counterparty);
          });
          setContracts(arr);
        } else {
          setContracts([]);
        }
      });
    }

    setup();
    return () => {
      unsub1?.();
      unsub2?.();
      unsub5?.();
      unsub6?.();
    };
  }, [id]);

  // What the form started from — so Save only overrides fields the user
  // changed, and keeps anything filled in the background meanwhile.
  const editBaseRef = useRef<Partial<Asset>>({});
  function startEditing() {
    if (!asset) return;
    // Edit with the entity's real type selected (old records say "LLC" for the trust).
    const seed = { ...asset, type: entityType(asset) };
    editBaseRef.current = seed;
    setForm(seed);
    setEditing(true);
    if ((tabParam ?? "overview") === "overview") setTimeout(() => document.getElementById("entity-edit")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    else goToTab("overview", "entity-edit");
  }

  async function handleSave() {
    if (!form.name?.trim()) return;
    const base = editBaseRef.current;
    const live = assetRef.current ?? ({} as Partial<Asset>);
    const pick = <K extends keyof Asset>(k: K) => ((form[k] ?? "") !== (base[k] ?? "") ? form[k] : live[k] ?? form[k]);
    const { db } = await import("../firebase");
    const { ref, update } = await import("firebase/database");
    // Changing the tax class by hand records that it came from a person; a
    // pending document conflict is settled when the hand value matches it.
    const classChanged = (form.llcType ?? "") !== (base.llcType ?? "");
    const conflict = live.llcTypeConflict;
    const provenance = classChanged
      ? {
          llcTypeSource: form.llcType ? BY_HAND : null,
          llcTypeConflict: conflict && conflict.value !== form.llcType ? conflict : null,
        }
      : {};
    const agentChanged = (form.registeredAgent ?? "") !== (base.registeredAgent ?? "");
    await update(ref(db, `assets/${id}`), {
      ...provenance,
      ...(agentChanged ? { registeredAgentSource: null } : {}),
      name: String(pick("name") ?? "").trim(),
      type: form.type,
      state: pick("state") || "",
      ein: pick("ein") || "",
      registeredAgent: pick("registeredAgent") || "",
      address: pick("address") || "",
      formationDate: pick("formationDate") || "",
      status: pick("status") || "Active",
      notes: pick("notes") || "",
      llcType: pick("llcType") || "",
      trustees: pick("trustees") || "",
      grantors: pick("grantors") || "",
      beneficiaries: pick("beneficiaries") || "",
      stateLink: pick("stateLink") || "",
      fileNumber: String(pick("fileNumber") ?? "").trim(),
      operatingAgreementDate: pick("operatingAgreementDate") || "",
      articlesOfOrgDate: pick("articlesOfOrgDate") || "",
    });
    setEditing(false);
  }

  async function handleAddDoc(e: React.FormEvent) {
    e.preventDefault();
    if (!docName.trim() || !docUrl.trim()) return;

    const { db } = await import("../firebase");
    const { push, ref } = await import("firebase/database");
    await push(ref(db, `assets/${id}/documents`), {
      name: docName.trim(),
      url: docUrl.trim(),
      createdAt: Date.now(),
    });
    setDocName("");
    setDocUrl("");
  }

  async function handleDeleteDoc(docId: string) {
    const doc = docs.find((d) => d.id === docId);
    const filedAs = FILING_KINDS.filter((k) => asset?.[k]?.docId === docId);
    if (
      !(await confirmDialog({
        title: `Delete “${doc?.name ?? "this document"}”?`,
        message: filedAs.length
          ? `It is filed as ${filedAs.map((k) => filingTitle(k, asset)).join(", ")} — that slot will be emptied.`
          : "This can't be undone.",
        tone: "danger",
      }))
    )
      return;
    if (doc?.storagePath) {
      if (doc.storageProvider === "supabase") {
        try {
          const r = await authFetch("/api/documents/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: doc.storagePath }),
          });
          if (r.status === 401 || r.status === 403) {
            await alertDialog("You don't have permission to delete documents.");
            return;
          }
        } catch {
          // ignore
        }
      } else {
        // Legacy Firebase-stored docs
        try {
          const { storage, authReady } = await import("../firebase");
          await authReady;
          const { ref: storageRef, deleteObject } = await import("firebase/storage");
          await deleteObject(storageRef(storage, doc.storagePath));
        } catch {
          // ignore
        }
      }
    }
    const { db, authReady } = await import("../firebase");
    await authReady;
    const { ref, remove, update } = await import("firebase/database");
    if (filedAs.length) await update(ref(db, `assets/${id}`), Object.fromEntries(filedAs.map((k) => [k, null])));
    await remove(ref(db, `assets/${id}/documents/${docId}`));
  }

  // Upload one document: signed URL → XHR PUT with progress → RTDB record.
  // Throws on failure; progress is reported as a 0–100 fraction of this file.
  async function uploadDocFile(file: File, onProgress: (pct: number) => void) {
    // 1. Ask the server for a signed upload URL into the Supabase
    //    "documents" bucket.
    const urlRes = await authFetch("/api/documents/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assetId: id,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
      }),
    });
    const urlData = await urlRes.json();
    if (!urlRes.ok || !urlData?.signedUrl) {
      throw new Error(urlData?.message || "Could not get signed upload URL");
    }

    // 2. PUT the file straight to Supabase Storage via XHR so we can
    //    track progress and time out if nothing streams.
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", urlData.signedUrl, true);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.setRequestHeader("x-upsert", "false");
      const stuckTimer = setTimeout(() => {
        setDocDrop((s) => ({
          ...s,
          error: "Upload is stuck. Check your connection and try again.",
        }));
      }, 15000);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.loaded > 0) {
          clearTimeout(stuckTimer);
          setDocDrop((s) => ({ ...s, error: null }));
          onProgress((e.loaded / e.total) * 100);
        }
      };
      xhr.onerror = () => {
        clearTimeout(stuckTimer);
        reject(new Error("Network error during upload"));
      };
      xhr.onload = () => {
        clearTimeout(stuckTimer);
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
      };
      xhr.send(file);
    });

    // 3. Record the document in the Firebase Realtime DB so it shows
    //    up in the list (RTDB is still our metadata store).
    const { db, authReady } = await import("../firebase");
    await authReady;
    const { ref: dbRef, push } = await import("firebase/database");
    const displayName = file.name.replace(/\.[^.]+$/, "");
    const record = {
      name: displayName,
      url: urlData.publicUrl,
      storagePath: urlData.path,
      storageProvider: "supabase" as const,
      size: file.size,
      contentType: file.type || "application/octet-stream",
      createdAt: Date.now(),
    };
    const pushed = await push(dbRef(db, `assets/${id}/documents`), record);
    return { id: pushed.key as string, ...record } as AssetDoc;
  }

  // ── Auto-filing ─────────────────────────────────────────────────────────
  // Point an empty filing slot at a Documents entry (no second copy) and fill
  // any blank key facts the document states. Never overwrites a filled slot
  // or a filled fact.
  async function fileDocument(kind: FileKind, doc: AssetDoc, facts?: Classified | null): Promise<string[]> {
    const current = assetRef.current;
    if (!current || current[kind] || claimedRef.current.has(kind)) return [];
    claimedRef.current.add(kind);
    const patch: Record<string, unknown> = {
      [kind]: {
        url: doc.url,
        fileName: doc.name,
        size: doc.size ?? 0,
        contentType: doc.contentType || "application/pdf",
        uploadedAt: doc.createdAt || Date.now(),
        storagePath: "",
        docId: doc.id,
      } satisfies UploadedFile,
    };
    const filled: string[] = [];
    // Only trust a document's facts when the reader agrees on what it is.
    if (facts && CLASSIFIER_KIND[facts.kind] === kind) {
      if (facts.ein && !current.ein?.trim() && (kind === "einLetter" || kind === "w9")) {
        patch.ein = facts.ein;
        filled.push(`EIN ${facts.ein}`);
      }
      if (facts.date && kind === "articles") {
        if (!current.formationDate) {
          patch.formationDate = facts.date;
          filled.push(`formed ${fmtDate(facts.date)}`);
        }
        if (!current.articlesOfOrgDate) patch.articlesOfOrgDate = facts.date;
      }
      if (facts.date && (kind === "trustAgreement" || kind === "trustCertificate") && !current.formationDate) {
        patch.formationDate = facts.date;
        filled.push(`trust dated ${fmtDate(facts.date)}`);
      }
      if (facts.state && kind === "trustAgreement" && !current.state?.trim()) {
        patch.state = facts.state;
        filled.push(`governed by ${facts.state} law`);
      }
      if (facts.date && kind === "operatingAgreement" && !current.operatingAgreementDate) {
        patch.operatingAgreementDate = facts.date;
        filled.push(`agreement dated ${fmtDate(facts.date)}`);
      }
      if (facts.state && kind === "articles" && !current.state?.trim()) {
        patch.state = facts.state;
        filled.push(facts.state);
      }
    }
    try {
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, update } = await import("firebase/database");
      await update(ref(db, `assets/${id}`), patch);
      return filled;
    } finally {
      claimedRef.current.delete(kind);
    }
  }

  /** Work out what a document is (name first, then Claude reads it) and file it. */
  /**
   * The federal tax class, from any document that states it (EIN letter's
   * required return, W-9 box, 2553/8832 election, member count in the
   * operating agreement). Fills a blank record and marks it confirmed; when
   * the record says something else, it is flagged — never overwritten.
   */
  async function applyTaxClass(facts: Classified, doc: AssetDoc) {
    const current = assetRef.current;
    const tc = facts.taxClassification?.trim();
    if (!current || !tc) return;
    const etype = entityType(current);
    if (etype === "Trust" || !TAX_CLASSES[etype].includes(tc as never)) return;
    const evidence = facts.taxClassificationEvidence?.trim() || "stated in the document";
    const source = `${evidence} (${doc.name})`;
    const patch: Record<string, unknown> = {};
    let note = "";
    if (!current.llcType) {
      patch.llcType = tc;
      patch.llcTypeSource = source;
      patch.llcTypeConflict = null;
      note = `tax class ${tc}`;
    } else if (current.llcType === tc) {
      if (current.llcTypeSource === source) return;
      patch.llcTypeSource = source;
      patch.llcTypeConflict = null;
      note = `confirmed ${tc}`;
    } else {
      if (current.llcTypeConflict?.value === tc && current.llcTypeConflict.docName === doc.name) return;
      patch.llcTypeConflict = { value: tc, evidence, docName: doc.name, at: Date.now() };
      note = `says ${tc}, record says ${current.llcType} — check it`;
    }
    const { db, authReady } = await import("../firebase");
    await authReady;
    const { ref, update } = await import("firebase/database");
    await update(ref(db, `assets/${id}`), patch);
    const line = `Read “${doc.name}” · ${note}`;
    setFilingNotes((n) => [...n, line]);
    setScan((sc) => (sc && !sc.finished ? { ...sc, notes: [...sc.notes, line] } : sc));
  }

  /**
   * Facts any piece of paperwork can carry: the registered agent and the
   * principal address (filled when blank), the owners it lists (kept with
   * the document they came from), and the year an annual report covers.
   */
  async function applyRecordFacts(facts: Classified, doc: AssetDoc) {
    const current = assetRef.current;
    if (!current) return;
    const patch: Record<string, unknown> = {};
    const added: string[] = [];
    const agent = facts.registeredAgent?.trim();
    if (agent && !current.registeredAgent?.trim() && entityType(current) !== "Trust") {
      patch.registeredAgent = agent;
      added.push(`agent ${agent}`);
    }
    const addr = facts.principalAddress?.trim();
    if (addr && !current.address?.trim()) {
      patch.address = addr;
      added.push("principal address");
    }
    const owners = (facts.members ?? []).filter((m) => m?.name?.trim());
    const ownerKinds = new Set(["operatingAgreement", "ownershipLedger", "articles", "annualReport"]);
    if (owners.length && ownerKinds.has(CLASSIFIER_KIND[facts.kind] ?? "") && (!current.members?.length || current.membersSource === doc.name)) {
      patch.members = owners.map((m) => ({ name: m.name.trim(), percent: typeof m.percent === "number" ? m.percent : null, role: m.role ?? null }));
      patch.membersSource = doc.name;
      added.push(`${owners.length} owner${owners.length === 1 ? "" : "s"} / managers`);
    }
    if (CLASSIFIER_KIND[facts.kind] === "annualReport" && facts.filingYear && (current.annualReportYear ?? 0) < facts.filingYear) {
      patch.annualReportYear = facts.filingYear;
      added.push(`annual filing for ${facts.filingYear}`);
    }
    if (!Object.keys(patch).length) return;
    const { db, authReady } = await import("../firebase");
    await authReady;
    const { ref, update } = await import("firebase/database");
    await update(ref(db, `assets/${id}`), patch);
    const line = `Read “${doc.name}” · added ${added.join(", ")}`;
    setFilingNotes((n) => [...n, line]);
    setScan((sc) => (sc && !sc.finished ? { ...sc, notes: [...sc.notes, line] } : sc));
  }

  /** Use the tax class a document states, settling the conflict. */
  async function acceptDocumentTaxClass() {
    const c = assetRef.current?.llcTypeConflict;
    if (!c) return;
    const { db, authReady } = await import("../firebase");
    await authReady;
    const { ref, update } = await import("firebase/database");
    await update(ref(db, `assets/${id}`), {
      llcType: c.value,
      llcTypeSource: `${c.evidence} (${c.docName})`,
      llcTypeConflict: null,
    });
  }

  /** Keep the record's tax class and dismiss the document's disagreement. */
  async function dismissTaxClassConflict() {
    const { db, authReady } = await import("../firebase");
    await authReady;
    const { ref, update } = await import("firebase/database");
    await update(ref(db, `assets/${id}`), { llcTypeConflict: null, llcTypeSource: assetRef.current?.llcTypeSource || BY_HAND });
  }

  /** A trust's trustees, grantors and beneficiaries, from any trust document that names them. */
  async function fillTrustPeople(facts: Classified, doc: AssetDoc) {
    const current = assetRef.current;
    if (!current || entityType(current) !== "Trust") return;
    const patch: Record<string, string> = {};
    const added: string[] = [];
    for (const key of ["trustees", "grantors", "beneficiaries"] as const) {
      const v = facts[key]?.trim();
      if (v && !current[key]?.trim()) {
        patch[key] = v;
        added.push(`${key} ${v}`);
      }
    }
    if (!added.length) return;
    const { db, authReady } = await import("../firebase");
    await authReady;
    const { ref, update } = await import("firebase/database");
    await update(ref(db, `assets/${id}`), patch);
    const note = `Read “${doc.name}” · added ${added.join("; ")}`;
    setFilingNotes((n) => [...n, note]);
    setScan((sc) => (sc && !sc.finished ? { ...sc, notes: [...sc.notes, note] } : sc));
  }

  async function autoFile(doc: AssetDoc, useClaude = true): Promise<string | null> {
    const ct = (doc.contentType || "").toLowerCase();
    const readable = ct.includes("pdf") || /^image\/(png|jpe?g|gif|webp)$/.test(ct);
    let kind = guessFiling(doc.name);
    let facts: Classified | null = null;
    if (useClaude && readable && doc.storagePath) {
      setSorting((n) => n + 1);
      try {
        const r = await authFetch("/api/documents/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: doc.url, fileName: doc.name, contentType: doc.contentType }),
        });
        if (r.ok) {
          facts = (await r.json()) as Classified;
          const read = CLASSIFIER_KIND[facts.kind];
          if (read && facts.confidence !== "low") kind = read;
          setAiDown(null);
          await fillTrustPeople(facts, doc);
          await applyTaxClass(facts, doc);
          await applyRecordFacts(facts, doc);
        } else if (r.status === 503) {
          const body = await r.json().catch(() => ({}));
          setAiDown(body?.message || "Document reading is unavailable right now.");
        }
      } catch {
        // fall back to the name
      } finally {
        setSorting((n) => n - 1);
      }
    }
    if (!kind) return null;
    const title = filingTitle(kind, assetRef.current);
    if (!kindsFor(assetRef.current).includes(kind)) {
      return `“${doc.name}” looks like ${title === "Operating Agreement" || title === "Articles of Organization" ? "an LLC filing" : `a ${title}`}, which doesn't apply here — kept in Documents`;
    }
    if (assetRef.current?.[kind] || claimedRef.current.has(kind)) {
      return `${title} already on file — kept “${doc.name}” in Documents`;
    }
    const filled = await fileDocument(kind, doc, facts);
    return `Filed “${doc.name}” as ${title}${filled.length ? ` · added ${filled.join(", ")}` : ""}`;
  }

  // Documents already in the library whose names say what they are get filed
  // into empty slots on load (name match only — no reading, no cost).
  const autoFiledOnLoad = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!asset) return;
    const linked = new Set(FILING_KINDS.map((k) => asset[k]?.docId).filter(Boolean));
    for (const kind of kindsFor(asset)) {
      if (asset[kind] || autoFiledOnLoad.current.has(kind)) continue;
      const doc = docs.find((d) => !d.autoFileSkip && !linked.has(d.id) && guessFiling(d.name) === kind);
      if (!doc) continue;
      autoFiledOnLoad.current.add(kind);
      linked.add(doc.id);
      void fileDocument(kind, doc).catch((err) => console.error("auto-file failed", err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, docs]);

  // Filed documents whose key facts are still blank on the record get read
  // once (the document is marked so it isn't read again on every visit).
  const enriching = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!asset) return;
    const blankFor: Partial<Record<FileKind, boolean>> = {
      einLetter: !asset.ein?.trim(),
      w9: !asset.ein?.trim(),
      articles: !asset.formationDate || !asset.articlesOfOrgDate || !asset.state?.trim(),
      operatingAgreement: !asset.operatingAgreementDate,
      trustAgreement: !asset.formationDate || !asset.state?.trim(),
      trustCertificate: !asset.formationDate,
    };
    // The tax class is read again until a document confirms it — older
    // reads didn't look for it, and a seeded or hand-entered value can be wrong.
    const classUnconfirmed =
      entityType(asset) !== "Trust" && (!asset.llcTypeSource || asset.llcTypeSource === BY_HAND) && !asset.llcTypeConflict;
    for (const kind of kindsFor(asset)) {
      const docId = asset[kind]?.docId;
      if (!docId || enriching.current.has(docId)) continue;
      const doc = docs.find((d) => d.id === docId);
      if (!doc || !doc.storagePath) continue;
      const needsFacts = blankFor[kind] && !doc.factsCheckedAt;
      const needsClass = classUnconfirmed && TAX_CLASS_KINDS.has(kind) && !doc.classReadAt;
      if (!needsFacts && !needsClass) continue;
      enriching.current.add(docId);
      void enrichFromDocument(kind, doc);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, docs]);

  async function enrichFromDocument(kind: FileKind, doc: AssetDoc) {
    setSorting((n) => n + 1);
    try {
      const r = await authFetch("/api/documents/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: doc.url, fileName: doc.name, contentType: doc.contentType }),
      });
      if (r.status === 503) {
        const body = await r.json().catch(() => ({}));
        setAiDown(body?.message || "Document reading is unavailable right now.");
        return;
      }
      if (!r.ok) return;
      const facts = (await r.json()) as Classified;
      setAiDown(null);
      await fillTrustPeople(facts, doc);
          await applyTaxClass(facts, doc);
          await applyRecordFacts(facts, doc);
      const current = assetRef.current;
      if (!current) return;
      const patch: Record<string, unknown> = {};
      if (CLASSIFIER_KIND[facts.kind] !== kind) {
        // The reader doesn't think this is a {kind}; don't take its facts.
        const { db, authReady } = await import("../firebase");
        await authReady;
        const { ref, update } = await import("firebase/database");
        await update(ref(db, `assets/${id}/documents/${doc.id}`), { factsCheckedAt: Date.now(), classReadAt: Date.now() });
        return;
      }
      const filled: string[] = [];
      if (facts.ein && !current.ein?.trim() && (kind === "einLetter" || kind === "w9")) {
        patch.ein = facts.ein;
        filled.push(`EIN ${facts.ein}`);
      }
      if (facts.date && kind === "articles") {
        if (!current.articlesOfOrgDate) {
          patch.articlesOfOrgDate = facts.date;
          filled.push(`articles filed ${fmtDate(facts.date)}`);
        }
        if (!current.formationDate) patch.formationDate = facts.date;
      }
      if (facts.state && kind === "articles" && !current.state?.trim()) patch.state = facts.state;
      if (facts.date && (kind === "trustAgreement" || kind === "trustCertificate") && !current.formationDate) {
        patch.formationDate = facts.date;
        filled.push(`trust dated ${fmtDate(facts.date)}`);
      }
      if (facts.state && kind === "trustAgreement" && !current.state?.trim()) {
        patch.state = facts.state;
        filled.push(`governed by ${facts.state} law`);
      }
      if (facts.date && kind === "operatingAgreement" && !current.operatingAgreementDate) {
        patch.operatingAgreementDate = facts.date;
        filled.push(`agreement dated ${fmtDate(facts.date)}`);
      }
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, update } = await import("firebase/database");
      if (Object.keys(patch).length) await update(ref(db, `assets/${id}`), patch);
      await update(ref(db, `assets/${id}/documents/${doc.id}`), { factsCheckedAt: Date.now(), classReadAt: Date.now() });
      if (filled.length) setFilingNotes((n) => [...n, `Read “${doc.name}” · added ${filled.join(", ")}`]);
    } catch (err) {
      console.error("reading filed document failed", err);
    } finally {
      setSorting((n) => n - 1);
    }
  }

  // ── Verify the record against its documents ────────────────────────────
  function recordValues(a: Asset): Partial<Record<VerifyField, string>> {
    return {
      name: a.name,
      type: entityType(a),
      state: a.state,
      ein: a.ein,
      formationDate: a.formationDate,
      address: a.address,
      registeredAgent: a.registeredAgent,
      llcType: a.llcType || "",
      operatingAgreementDate: a.operatingAgreementDate,
      articlesOfOrgDate: a.articlesOfOrgDate,
      trustees: a.trustees,
      grantors: a.grantors,
      beneficiaries: a.beneficiaries,
    };
  }

  // ── What the entity is, from its governing documents ──────────────────
  const [profiling, setProfiling] = useState(false);
  const [profileError, setProfileError] = useState("");
  const profileTried = useRef(false);

  // ── Palm: the state's record, and Palm as registered agent ─────────────
  const [palmStatus, setPalmStatus] = useState<{ configured: boolean; mode: PalmMode | null; error?: string } | null>(null);
  const [palmRa, setPalmRa] = useState<RaService | null | undefined>(undefined);
  const [palmDocs, setPalmDocs] = useState<PalmDocument[] | null>(null);
  const [palmBusy, setPalmBusy] = useState<"record" | "move" | "refresh" | null>(null);
  const [palmError, setPalmError] = useState("");
  const [registryChoices, setRegistryChoices] = useState<RegistryRecord[] | null>(null);
  const palmMode = palmStatus?.mode ?? null;
  /** Bumped by every read or change of Palm's agent service; an older response is dropped. */
  const palmSeq = useRef(0);
  /** Bumped when the page moves to another entity; work started for the last one stops touching the card. */
  const palmEpoch = useRef(0);
  const palmMoving = useRef(false);

  async function patchAsset(patch: Record<string, unknown>) {
    const { db } = await import("../firebase");
    const { ref, update } = await import("firebase/database");
    await update(ref(db, `assets/${id}`), patch);
  }

  async function loadPalmStatus(): Promise<{ configured: boolean; mode: PalmMode | null; error?: string }> {
    try {
      const s = await palmCall<{ configured: boolean; mode: PalmMode | null }>("status");
      setPalmStatus(s);
      return s;
    } catch (err) {
      const s = { configured: false, mode: null, error: err instanceof Error ? err.message : "Couldn't reach Palm." };
      setPalmStatus(s);
      return s;
    }
  }

  function showPalmError(err: unknown) {
    const msg = err instanceof Error ? err.message : "Couldn't reach Palm.";
    setPalmError(msg);
    if (err instanceof PalmCallError && err.code === "mode_changed") void loadPalmStatus();
    if (err instanceof PalmUnavailable) setPalmStatus({ configured: false, mode: null });
  }

  useEffect(() => {
    void loadPalmStatus();
  }, []);

  // Another entity: start the card clean.
  useEffect(() => {
    setEditing(false);
    setForm({});
    palmEpoch.current++;
    palmSeq.current++;
    setPalmRa(undefined);
    setPalmDocs(null);
    setRegistryChoices(null);
    setPalmError("");
    setPalmBusy(null);
  }, [id]);

  const palmBusinessId = palmMode ? asset?.palm?.[palmMode]?.businessId : undefined;
  useEffect(() => {
    if (!palmMode) return;
    if (!palmBusinessId) {
      // Never added to Palm in this mode, so Palm isn't its agent.
      setPalmRa(null);
      setPalmDocs(null);
      return;
    }
    if (palmMoving.current) return; // the move refreshes once it's done
    void refreshPalm(palmBusinessId, { busy: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palmBusinessId, palmMode]);

  /** Palm's agent service and mail for this entity; the record follows when the agent actually changes. */
  async function refreshPalm(businessId: string, opts: { busy?: boolean; keepError?: boolean } = {}) {
    const mode = palmMode;
    if (!mode) return;
    const seq = ++palmSeq.current;
    const busy = opts.busy ?? true;
    if (busy) setPalmBusy("refresh");
    if (!opts.keepError) setPalmError("");
    try {
      const [raR, docsR] = await Promise.allSettled([
        palmCall<{ service: RaService | null }>("ra", { businessId, mode }),
        palmCall<{ documents: PalmDocument[] }>("documents", { businessId, mode }),
      ]);
      if (seq !== palmSeq.current) return;
      if (docsR.status === "fulfilled") setPalmDocs(sortDocuments(docsR.value.documents));
      if (raR.status === "rejected") {
        if (!opts.keepError) showPalmError(raR.reason);
        return;
      }
      const service = raR.value.service;
      setPalmRa(service);
      const current = assetRef.current;
      if (!current) return;
      const before = current.palm?.[mode]?.ra?.status ?? null;
      const patch: Record<string, unknown> = {
        [`palm/${mode}/ra`]: { status: service?.status ?? null, name: service?.name ?? null, checkedAt: Date.now() },
      };
      if (mode === "live") {
        // Only on the change itself, so a later hand edit isn't overwritten on every visit.
        if (service?.status === "active" && before !== "active" && service.name) {
          patch.registeredAgent = service.name;
          patch.registeredAgentSource = `Palm, active since ${(service.started_at ?? new Date().toISOString()).slice(0, 10)}`;
        }
        if ((service?.status === "terminated" || service?.status === "canceled") && before === "active" && current.registeredAgentSource?.startsWith("Palm")) {
          patch.registeredAgentSource = `Palm stopped serving ${(service.ended_at ?? new Date().toISOString()).slice(0, 10)} — confirm the current agent`;
        }
      }
      await patchAsset(patch);
      if (docsR.status === "rejected" && !opts.keepError) showPalmError(docsR.reason);
    } finally {
      if (busy) setPalmBusy(null);
    }
  }

  /** Read the state's record: by file number when we have it, otherwise find the entity by name. */
  async function checkStateRecord(choice?: RegistryRecord) {
    const current = assetRef.current;
    const mode = palmMode;
    if (!current || !mode) return;
    const jurisdiction = palmJurisdiction(current.state);
    if (!jurisdiction) {
      setPalmError("Set the entity's state first.");
      return;
    }
    const epoch = palmEpoch.current;
    setPalmBusy("record");
    setPalmError("");
    try {
      let number = choice ? choice.registration_number : current.fileNumber;
      let where = choice?.registration_jurisdiction || jurisdiction;
      if (choice && !number && choice.palm_id) {
        // A picked entry without its number: look that exact entry up by its Palm ID.
        const { results } = await palmCall<{ results: RegistryRecord[] }>("registry-search", { palmId: choice.palm_id, mode });
        number = results.find((r) => r.palm_id === choice.palm_id)?.registration_number;
        where = results[0]?.registration_jurisdiction || where;
      }
      if (choice && !number) {
        if (epoch === palmEpoch.current) setPalmError("That registry entry has no file number. Add it by hand under Edit, then check again.");
        return;
      }
      if (!number) {
        const { results } = await palmCall<{ results: RegistryRecord[] }>("registry-search", { name: current.name, jurisdiction, mode });
        if (epoch !== palmEpoch.current) return;
        const match = pickRegistryMatch(results, current.name, jurisdiction);
        if (!match) {
          setRegistryChoices(results);
          if (!results.length) setPalmError(`No ${current.state} registry entry matched “${current.name}”. Add the state file number under Edit and try again.`);
          return;
        }
        number = match.registration_number;
        where = match.registration_jurisdiction || jurisdiction;
      }
      if (!number) {
        setPalmError("The registry result had no file number. Add it by hand under Edit.");
        return;
      }
      const { record } = await palmCall<{ record: RegistryRecord }>("registry-detail", { jurisdiction: where, number, mode });
      const snapshot = toStateRecord(record, mode);
      const patch: Record<string, unknown> = { stateRecord: JSON.parse(JSON.stringify(snapshot)) };
      if (mode === "live" && !current.fileNumber && snapshot.registrationNumber) patch.fileNumber = snapshot.registrationNumber;
      await patchAsset(patch);
      if (epoch === palmEpoch.current) setRegistryChoices(null);
    } catch (err) {
      if (epoch === palmEpoch.current) showPalmError(err);
    } finally {
      if (epoch === palmEpoch.current) setPalmBusy(null);
    }
  }

  /** Move the registered agent onto Palm: add the business to Palm if needed, then request the change. */
  async function moveAgentToPalm() {
    const current = assetRef.current;
    if (!current || !palmMode) return;
    // The key may have switched between test and live since the page loaded.
    const fresh = await loadPalmStatus();
    const mode = fresh.mode;
    if (!mode) return;
    if (mode !== palmMode) {
      setPalmError(`Palm is now in ${mode} mode. Check the card again before going on.`);
      return;
    }
    const jurisdiction = palmJurisdiction(current.state);
    if (!jurisdiction) {
      await alertDialog("Set the state first", "Palm files the change in the state the entity was formed in.");
      return;
    }
    const rec = current.stateRecord;
    // Palm can't take the file number after the business is added, so it must be known first.
    const fileNumber = current.fileNumber || (rec?.mode === mode ? rec.registrationNumber : undefined);
    if (!current.palm?.[mode]?.businessId && !fileNumber) {
      await alertDialog(
        "Check the state record first",
        "Palm needs the state's file number for this entity, and it can't be added later. Click “Check state record”, then try again.",
      );
      return;
    }
    const live = mode === "live";
    const oldAgent = current.registeredAgentSource?.startsWith("Palm") ? undefined : current.registeredAgent?.replace(/\.+$/, "");
    const lapsed = rec && ((rec.status && rec.status !== "active") || rec.standing?.registration === "not_compliant");
    const ok = await confirmDialog({
      title: live ? "Make Palm the registered agent?" : "Try the agent change in test mode?",
      message: live ? (
        <>
          Palm will file the change with the {current.state} Secretary of State for <b>{current.name}</b> and become its agent of record.
        </>
      ) : (
        <>
          Palm's sandbox will walk <b>{current.name}</b> through the change. Nothing is filed with the state and nothing is billed.
        </>
      ),
      details: live
        ? [
            "This is a live state filing, billed to the Palm account. State fees are passed through at cost.",
            `The current agent${oldAgent ? ` (${oldAgent})` : ""} stays on file until the state accepts the change. If it fails, nothing changes.`,
            "Once Palm is active, state mail and any legal papers served on the entity arrive here.",
            ...(lapsed
              ? [`The state's record shows ${rec?.status && rec.status !== "active" ? rec.status : "it isn't in good standing"}. The state may refuse the change until the overdue filing and fees are paid.`]
              : []),
            ...(oldAgent ? [`Afterwards, once the state shows Palm, cancel ${oldAgent}'s service so it isn't billed twice.`] : []),
          ]
        : ["The entity's record here isn't changed by a test.", "Switch PALM_API_KEY to a live key to make the real change."],
      confirmLabel: live ? "Make Palm the agent" : "Run the test",
      requireText: live ? current.name : undefined,
    });
    if (!ok) return;
    const epoch = palmEpoch.current;
    palmMoving.current = true;
    palmSeq.current++; // anything already in flight is now stale
    setPalmBusy("move");
    setPalmError("");
    let linkedId: string | undefined = current.palm?.[mode]?.businessId;
    try {
      if (!linkedId) {
        const linked = await palmCall<{ businessId: string; palmId: string | null }>("link", {
          mode,
          assetId: id,
          entity: {
            name: current.name,
            ein: current.ein,
            type: entityType(current),
            jurisdiction,
            formationDate: current.formationDate,
            fileNumber,
            address: current.address,
          },
        });
        linkedId = linked.businessId;
        const link: PalmLink = { businessId: linkedId, palmId: linked.palmId ?? null, linkedAt: Date.now() };
        await patchAsset({ [`palm/${mode}`]: link });
      }
      const { service } = await palmCall<{ service: RaService }>("ra-change", { mode, businessId: linkedId, assetId: id });
      palmSeq.current++;
      if (epoch === palmEpoch.current) setPalmRa(service);
      await patchAsset({ [`palm/${mode}/ra`]: { status: service.status, name: service.name ?? null, checkedAt: Date.now() } });
    } catch (err) {
      // The request may have gone through before the error: show Palm's actual state, then the error.
      if (linkedId && epoch === palmEpoch.current) await refreshPalm(linkedId, { busy: false, keepError: true });
      if (epoch === palmEpoch.current) showPalmError(err);
    } finally {
      palmMoving.current = false;
      if (epoch === palmEpoch.current) setPalmBusy(null);
    }
  }

  async function buildProfile() {
    const current = assetRef.current;
    if (!current || profiling) return;
    const documents = documentsForReading(current);
    if (!documents.length) {
      setProfileError("Upload the operating agreement (or bylaws / trust agreement) first.");
      return;
    }
    setProfiling(true);
    setProfileError("");
    try {
      const r = await authFetch("/api/documents/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity: { name: current.name, type: entityType(current), state: current.state }, documents }),
      });
      if (r.status === 503) {
        const body = await r.json().catch(() => ({}));
        setAiDown(body?.message || "Document reading is unavailable right now.");
        setProfileError("Document reading is paused right now.");
        return;
      }
      if (!r.ok) {
        setProfileError(r.status === 422 ? "None of the documents could be read." : "Couldn't read the documents — try again.");
        return;
      }
      const raw = (await r.json()) as Partial<EntityProfile>;
      if (typeof raw.whatItIs !== "string") {
        setProfileError("The reader returned nothing usable — try again.");
        return;
      }
      const profile: EntityProfile = {
        whatItIs: raw.whatItIs,
        purpose: raw.purpose ?? null,
        properties: raw.properties ?? [],
        management: raw.management ?? null,
        managers: raw.managers ?? [],
        members: raw.members ?? [],
        taxTreatment: raw.taxTreatment ?? null,
        taxEvidence: raw.taxEvidence ?? null,
        governingLaw: raw.governingLaw ?? null,
        partnershipRepresentative: raw.partnershipRepresentative ?? null,
        keyTerms: raw.keyTerms ?? [],
        issues: raw.issues ?? [],
        sources: raw.sources ?? [],
        documentsRead: raw.documentsRead ?? [],
        checkedAt: raw.checkedAt ?? Date.now(),
      };
      setAiDown(null);
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, update } = await import("firebase/database");
      const patch: Record<string, unknown> = { profile: JSON.parse(JSON.stringify(profile)) };
      // The owners the governing documents list feed the paperwork checks,
      // unless a more specific document already supplied them.
      const owners = profile.members.filter((m) => m.name?.trim());
      if (owners.length && (!current.members?.length || current.membersSource === "governing documents")) {
        patch.members = owners.map((m) => ({ name: m.name, percent: m.percent ?? null, role: "member" }));
        patch.membersSource = "governing documents";
      }
      await update(ref(db, `assets/${id}`), patch);
      if (profile.taxTreatment) {
        await applyTaxClass(
          { kind: "operating_agreement", confidence: "high", ein: null, date: null, state: null, taxClassification: profile.taxTreatment, taxClassificationEvidence: profile.taxEvidence },
          { id: "profile", name: profile.sources[0] ?? "the governing documents", url: "", createdAt: 0 }
        );
      }
    } catch (err) {
      console.error("profile failed", err);
      setProfileError("Couldn't read the documents — try again.");
    } finally {
      setProfiling(false);
    }
  }

  // Build the profile once, the first time an entity with documents is opened.
  useEffect(() => {
    if (!asset || asset.profile || profileTried.current || aiDown) return;
    if (!documentsForReading(asset).length) return;
    profileTried.current = true;
    void buildProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, docs, aiDown]);

  /** Every readable document on the entity — library files plus slot-only uploads — labelled with its filing. */
  function documentsForReading(a: Asset) {
    const readable = docs.filter((d) => d.storagePath && /pdf|image\//i.test(d.contentType || ""));
    // Filing slots uploaded straight to a slot (not via Documents) count too.
    const slotOnly = FILING_KINDS.filter((k) => a[k] && !a[k]!.docId).map((k) => ({
      name: a[k]!.fileName,
      url: a[k]!.url,
      contentType: a[k]!.contentType,
      filedAs: k as string | null,
    }));
    const filedAs = new Map(FILING_KINDS.filter((k) => a[k]?.docId).map((k) => [a[k]!.docId!, k as string]));
    return [
      ...slotOnly,
      ...readable.map((d) => ({ name: d.name, url: d.url, contentType: d.contentType, filedAs: filedAs.get(d.id) ?? null })),
    ];
  }

  async function runVerification() {
    if (!asset) return;
    const documents = documentsForReading(asset).map((d) => ({ ...d, filedAs: d.filedAs ? filingTitle(d.filedAs as FileKind, asset) : null }));
    if (!documents.length) {
      setVerifyError("Upload the entity's documents first — there's nothing to check against.");
      return;
    }
    setVerifying(true);
    setVerifyError("");
    try {
      const record = recordValues(asset);
      const r = await authFetch("/api/documents/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: { ...record, owner: asset.ownerId ? assetNames[asset.ownerId] ?? null : null },
          documents,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok)
        throw new Error(
          data?.error === "no_readable_documents"
            ? "None of the documents could be read (PDF or image needed)."
            : data?.error === "ai_unavailable"
              ? "Document reading is paused — the Anthropic account behind BFO is out of credit."
              : data?.error === "forbidden"
                ? "Your role can view this entity but not run the check."
                : data?.error === "rate_limited"
                  ? "Too many checks at once — wait a minute and try again."
                  : "The check didn't finish — try again.",
        );
      const result: Verification = { ...(data as Verification), recordAtCheck: record };
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, update } = await import("firebase/database");
      await update(ref(db, `assets/${id}`), { verification: JSON.parse(JSON.stringify(result)) });
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setVerifying(false);
    }
  }

  /** Apply one finding: write the documented value to the record. */
  async function applyFinding(field: VerifyField, value: string) {
    let v = value.trim();
    if (field === "llcType") {
      const m = /non[- ]?grantor|complex|simple trust/i.test(v)
        ? "Non-grantor trust"
        : /grantor|revocable/i.test(v)
          ? "Grantor trust"
          : /partner|1065/i.test(v)
            ? "Partnership"
            : /\bs[- ]?corp|1120-?s|2553/i.test(v)
              ? "S Corporation"
              : /corp|1120/i.test(v)
                ? "C Corporation"
                : /disregard|single/i.test(v)
                  ? "Disregarded Entity"
                  : "";
      if (!m) return;
      v = m;
    }
    if (field === "type") v = /trust/i.test(v) ? "Trust" : /corp|inc/i.test(v) ? "C-Corp" : /partnership|\bl\.?p\.?\b/i.test(v) && !/llc|limited liability/i.test(v) ? "LP" : "LLC";
    const { db, authReady } = await import("../firebase");
    await authReady;
    const { ref, update } = await import("firebase/database");
    await update(ref(db, `assets/${id}`), {
      [field]: v,
      // A tax class taken from the document check counts as confirmed.
      ...(field === "llcType" ? { llcTypeSource: "Matched by the document check", llcTypeConflict: null } : {}),
    });
  }

  async function applyOwner(ownerId: string) {
    const { db, authReady } = await import("../firebase");
    await authReady;
    const { ref, update } = await import("firebase/database");
    await update(ref(db, `assets/${id}`), { ownerId });
  }

  /** Ask Claude to read every unfiled PDF/image in the library and file what fits. */
  async function scanLibrary() {
    const current = assetRef.current;
    if (!current) return;
    const linked = new Set(FILING_KINDS.map((k) => current[k]?.docId).filter(Boolean));
    const candidates = docs.filter((d) => !linked.has(d.id) && !d.autoFileSkip && d.storagePath);
    if (scanHideTimer.current) clearTimeout(scanHideTimer.current);
    setScan({ total: candidates.length, done: 0, current: candidates[0]?.name ?? null, notes: [], finished: candidates.length === 0 });
    const notes: string[] = [];
    // Read every candidate — even once the slots are full, a trust's
    // documents still name its trustees, grantors and beneficiaries.
    for (const [i, doc] of candidates.entries()) {
      setScan((sc) => (sc ? { ...sc, current: doc.name } : sc));
      const note = await autoFile(doc);
      if (note) notes.push(note);
      setScan((sc) => (sc ? { ...sc, done: i + 1, notes: note ? [...sc.notes, note] : sc.notes } : sc));
    }
    setScan((sc) => (sc ? { ...sc, current: null, finished: true } : sc));
    scanHideTimer.current = setTimeout(() => setScan(null), 12000);
    setFilingNotes(
      notes.length
        ? notes
        : [aiDownRef.current ? "Couldn't read the documents — document reading is paused. Nothing new matched by name." : "Nothing new to file — no unfiled document matched an empty slot."],
    );
  }

  // Upload several documents one after another. If a batch is already
  // running, the files are appended to its queue instead.
  async function handleUploadDocs(files: File[]) {
    if (files.length === 0) return;
    const batch = docBatchRef.current;
    docQueueRef.current.push(...files);
    if (batch.running) {
      batch.total += files.length;
      setDocDrop((s) => ({ ...s, total: batch.total }));
      return;
    }
    batch.running = true;
    batch.done = 0;
    batch.total = files.length;
    batch.failures = [];
    setFilingNotes([]);
    setDocDrop((s) => ({ ...s, dragOver: false, error: null, progress: 0, index: 0, total: batch.total }));

    const maxBytes = 25 * 1024 * 1024;
    const overall = (fileFrac: number) => ((batch.done + fileFrac) / Math.max(batch.total, 1)) * 100;
    try {
      while (docQueueRef.current.length > 0) {
        const file = docQueueRef.current.shift()!;
        setDocDrop((s) => ({ ...s, uploading: file.name, index: batch.done + 1, total: batch.total, progress: overall(0) }));
        if (file.size > maxBytes) {
          batch.failures.push({ name: file.name, reason: "too large" });
        } else {
          try {
            const doc = await uploadDocFile(file, (pct) => setDocDrop((s) => ({ ...s, progress: overall(pct / 100) })));
            void autoFile(doc)
              .then((note) => note && setFilingNotes((n) => [...n, note]))
              .catch((err) => console.error("auto-file failed", err));
          } catch (err) {
            console.error("document upload failed:", file.name, err);
            const msg = err instanceof Error ? err.message : "upload failed";
            batch.failures.push({ name: file.name, reason: /network/i.test(msg) ? "network error" : msg });
          }
        }
        batch.done += 1;
      }
    } finally {
      const { failures, total } = batch;
      batch.running = false;
      setDocDrop((s) => ({
        ...s,
        uploading: null,
        progress: 0,
        index: 0,
        total: 0,
        error: failures.length > 0
          ? `${failures.length} of ${total} failed: ${failures.map((f) => `${f.name} (${f.reason})`).join(", ")}`
          : null,
      }));
    }
  }

  async function handleCopyDocUrl(doc: AssetDoc) {
    try {
      await navigator.clipboard.writeText(doc.url);
      setCopiedDocId(doc.id);
      setTimeout(() => setCopiedDocId((v) => (v === doc.id ? null : v)), 1500);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = doc.url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopiedDocId(doc.id);
      setTimeout(() => setCopiedDocId((v) => (v === doc.id ? null : v)), 1500);
    }
  }

  async function handleRenameDoc(doc: AssetDoc) {
    setRenamingDocId(doc.id);
    try {
      const res = await authFetch("/api/rename-doc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentName: doc.name,
          contentType: doc.contentType || "",
          url: doc.url,
          context: `Entity: ${asset?.name || ""} (${asset?.type || ""})`,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.name) {
        await alertDialog("Rename failed", String(data?.error || res.statusText));
        return;
      }
      const suggested: string = String(data.name).trim();
      if (!suggested || suggested === doc.name) return;
      const confirmed = prompt(
        `Claude suggests a new name for this document. Edit if you want, then press OK.`,
        suggested,
      );
      if (!confirmed || !confirmed.trim() || confirmed.trim() === doc.name) return;
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, update } = await import("firebase/database");
      await update(ref(db, `assets/${id}/documents/${doc.id}`), { name: confirmed.trim() });
    } catch (err) {
      console.error("rename failed:", err);
      await alertDialog("Rename failed", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRenamingDocId(null);
    }
  }

  function formatBytes(bytes?: number) {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  async function handleUploadFile(kind: FileKind, file: File) {
    if (!file) return;
    const maxBytes = 25 * 1024 * 1024;
    if (file.size > maxBytes) {
      setSlot(kind, { error: "File too large. Max 25 MB." });
      return;
    }
    setSlot(kind, { error: null, uploading: true, progress: 0 });
    try {
      const { db, storage, authReady } = await import("../firebase");
      await authReady;
      const { ref: dbRef, update } = await import("firebase/database");
      const { ref: storageRef, uploadBytesResumable, getDownloadURL, deleteObject } = await import("firebase/storage");

      const prior = asset?.[kind];
      if (prior?.storagePath && !prior.docId) {
        try {
          await deleteObject(storageRef(storage, prior.storagePath));
        } catch {
          // ignore
        }
      }

      const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
      const path = `assets/${id}/${kind}/${kind}-${Date.now()}.${ext}`;
      const sRef = storageRef(storage, path);
      const task = uploadBytesResumable(sRef, file, { contentType: file.type || "application/pdf" });

      await new Promise<void>((resolve, reject) => {
        const stuckTimer = setTimeout(() => {
          setSlot(kind, {
            error: `Upload is stuck. Check Firebase Storage rules for this bucket (authenticated writes to assets/<id>/${kind}/) and CORS.`,
          });
        }, 15000);
        task.on(
          "state_changed",
          (snap) => {
            const pct = snap.totalBytes > 0 ? (snap.bytesTransferred / snap.totalBytes) * 100 : 0;
            if (pct > 0) {
              clearTimeout(stuckTimer);
              setSlot(kind, { error: null });
            }
            setSlot(kind, { progress: pct });
          },
          (err) => {
            clearTimeout(stuckTimer);
            reject(err);
          },
          () => {
            clearTimeout(stuckTimer);
            resolve();
          },
        );
      });

      const url = await getDownloadURL(sRef);
      const meta: UploadedFile = {
        url,
        fileName: file.name,
        size: file.size,
        contentType: file.type || "application/pdf",
        uploadedAt: Date.now(),
        storagePath: path,
      };
      await update(dbRef(db, `assets/${id}`), { [kind]: meta });
    } catch (err) {
      console.error(`${kind} upload failed:`, err);
      setSlot(kind, { error: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      setSlot(kind, { uploading: false, progress: 0 });
    }
  }

  async function handleDeleteFile(kind: FileKind) {
    const file = asset?.[kind];
    if (!file) return;
    const label = filingTitle(kind, asset);
    // Filed from Documents: just unfile it — the document stays in the library.
    if (file.docId) {
      if (!(await confirmDialog({ title: `Unfile “${file.fileName}”?`, message: `It comes out of ${label} and stays in Documents.`, confirmLabel: "Unfile" }))) return;
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref: dbRef, update } = await import("firebase/database");
      await update(dbRef(db, `assets/${id}`), { [kind]: null });
      await update(dbRef(db, `assets/${id}/documents/${file.docId}`), { autoFileSkip: true });
      return;
    }
    if (!(await confirmDialog({ title: `Remove the uploaded ${label}?`, message: "The file is deleted.", tone: "danger", confirmLabel: "Remove" }))) return;
    try {
      const { db, storage, authReady } = await import("../firebase");
      await authReady;
      const { ref: dbRef, update } = await import("firebase/database");
      const { ref: storageRef, deleteObject } = await import("firebase/storage");
      try {
        if (file.storagePath) await deleteObject(storageRef(storage, file.storagePath));
      } catch {
        // ignore
      }
      await update(dbRef(db, `assets/${id}`), { [kind]: null });
    } catch (err) {
      console.error(`${kind} delete failed:`, err);
      setSlot(kind, { error: err instanceof Error ? err.message : "Delete failed" });
    }
  }

  const [deleting, setDeleting] = useState(false);

  /**
   * Delete the entity everywhere it lives: its record (filings, contracts,
   * document list), its uploaded files, its place on the Estate Map, and any
   * entities it owned (they move up to its own owner rather than vanish).
   */
  async function handleDeleteAsset() {
    const current = assetRef.current;
    if (!current || deleting) return;
    const { db, authReady } = await import("../firebase");
    await authReady;
    const { ref, get, update, remove, set } = await import("firebase/database");

    const all = ((await get(ref(db, "assets"))).val() ?? {}) as Record<string, { name?: string; ownerId?: string }>;
    const children = Object.entries(all).filter(([cid, a]) => cid !== id && a?.ownerId === id);
    const parentName = current.ownerId ? all[current.ownerId]?.name : undefined;
    const files = docs.filter((d) => d.storagePath);

    const details = [
      `Its key facts, filings${contracts.length ? `, ${contracts.length} contract${contracts.length === 1 ? "" : "s"}` : ""} and notes are removed.`,
      files.length ? `${files.length} uploaded document${files.length === 1 ? " is" : "s are"} deleted from storage.` : "",
      children.length
        ? `${children.map(([, a]) => a.name).join(", ")} ${children.length === 1 ? "moves" : "move"} up to ${parentName ?? "the top level"}.`
        : "",
      "It is removed from the Estate Map.",
    ].filter(Boolean);
    const ok = await confirmDialog({
      title: `Delete ${current.name}?`,
      message: "This can't be undone.",
      details,
      tone: "danger",
      confirmLabel: "Delete entity",
      requireText: files.length || children.length ? current.name : undefined,
    });
    if (!ok) return;

    setDeleting(true);
    try {
      // Children first, so nothing is left pointing at a missing owner.
      for (const [cid] of children) {
        await update(ref(db, `assets/${cid}`), { ownerId: current.ownerId || "" });
      }

      // The Estate Map keeps its own tree by name; lift this node's children
      // to its parent and drop the node.
      const mapSnap = await get(ref(db, "estate-map/entities"));
      const raw = mapSnap.val();
      if (raw) {
        const nodes: Array<{ id: string; name: string; parentId: string | null }> = (Array.isArray(raw) ? raw : Object.values(raw)).filter(Boolean);
        const node = nodes.find((n) => n.name?.trim().toLowerCase() === current.name.trim().toLowerCase());
        if (node) {
          const next = nodes
            .filter((n) => n.id !== node.id)
            .map((n) => (n.parentId === node.id ? { ...n, parentId: node.parentId ?? null } : n));
          await set(ref(db, "estate-map/entities"), next);
        }
      }

      // Uploaded files — best effort; the record goes either way.
      for (const d of files) {
        try {
          if (d.storageProvider === "supabase") {
            await authFetch("/api/documents/delete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ path: d.storagePath }),
            });
          } else {
            const { storage } = await import("../firebase");
            const { ref: storageRef, deleteObject } = await import("firebase/storage");
            await deleteObject(storageRef(storage, d.storagePath!));
          }
        } catch (err) {
          console.warn("couldn't delete stored file", d.storagePath, err);
        }
      }

      await remove(ref(db, `assets/${id}`));
      navigate("/assets");
    } catch (err) {
      console.error("delete entity failed", err);
      setDeleting(false);
      await alertDialog(
        "Couldn't delete this entity",
        err instanceof Error && /permission/i.test(err.message)
          ? "The database refused the change. Sign out and back in, then try again."
          : "Something went wrong while deleting. Nothing was removed from the entity itself — try again."
      );
    }
  }

  async function updateCorpField(field: string, value: unknown) {
    const { db } = await import("../firebase");
    const { ref, update } = await import("firebase/database");
    await update(ref(db, `assets/${id}/corp`), { [field]: value });
  }

  async function addDirector() {
    if (!dirForm.name.trim()) return;
    const { db } = await import("../firebase");
    const { push, ref } = await import("firebase/database");
    await push(ref(db, `assets/${id}/corp/directors`), { ...dirForm, name: dirForm.name.trim() });
    setDirForm({ name: "", title: "Director", since: "" });
    setAddingDirector(false);
  }

  async function removeDirector(dirId: string) {
    const { db } = await import("../firebase");
    const { ref, remove } = await import("firebase/database");
    await remove(ref(db, `assets/${id}/corp/directors/${dirId}`));
  }

  async function addOfficer() {
    if (!offForm.name.trim() || !offForm.title.trim()) return;
    const { db } = await import("../firebase");
    const { push, ref } = await import("firebase/database");
    await push(ref(db, `assets/${id}/corp/officers`), { ...offForm, name: offForm.name.trim(), title: offForm.title.trim() });
    setOffForm({ name: "", title: "", since: "" });
    setAddingOfficer(false);
  }

  async function removeOfficer(offId: string) {
    const { db } = await import("../firebase");
    const { ref, remove } = await import("firebase/database");
    await remove(ref(db, `assets/${id}/corp/officers/${offId}`));
  }

  async function addShareholder() {
    if (!shForm.name.trim()) return;
    const { db } = await import("../firebase");
    const { push, ref } = await import("firebase/database");
    await push(ref(db, `assets/${id}/corp/shareholders`), {
      name: shForm.name.trim(),
      shares: Number(shForm.shares) || 0,
      class: shForm.class,
      percentage: Number(shForm.percentage) || 0,
    });
    setShForm({ name: "", shares: "", class: "Common", percentage: "" });
    setAddingShareholder(false);
  }

  async function removeShareholder(shId: string) {
    const { db } = await import("../firebase");
    const { ref, remove } = await import("firebase/database");
    await remove(ref(db, `assets/${id}/corp/shareholders/${shId}`));
  }

  async function generateMSATemplates() {
    if (!asset) return;
    const { db } = await import("../firebase");
    const { push, ref } = await import("firebase/database");
    const existingCounterparties = new Set(contracts.map((c) => c.counterparty.toLowerCase()));
    for (const sub of LEDGER_LOUISE_SUBS) {
      if (existingCounterparties.has(sub.toLowerCase())) continue;
      await push(ref(db, `assets/${id}/contracts`), {
        counterparty: sub,
        role: "manager",
        services: MSA_SERVICES,
        fee: "$500",
        frequency: "Quarterly",
        effectiveDate: "2025-01-01",
        term: "Annual, auto-renewing",
        status: "draft",
        createdAt: Date.now(),
      });
    }
  }

  async function addContract() {
    if (!contractForm.counterparty.trim()) return;
    const services = contractForm.services.length > 0 ? contractForm.services : MSA_SERVICES;
    const { db } = await import("../firebase");
    const { push, ref } = await import("firebase/database");
    await push(ref(db, `assets/${id}/contracts`), {
      counterparty: contractForm.counterparty.trim(),
      role: "manager",
      services,
      fee: contractForm.fee.trim() || "$0",
      frequency: contractForm.frequency,
      effectiveDate: contractForm.effectiveDate,
      term: contractForm.term.trim() || "Annual, auto-renewing",
      status: contractForm.status,
      referralCredit: contractForm.referralCredit,
      letterhead: contractForm.letterhead,
      createdAt: Date.now(),
    });
    setContractForm({
      counterparty: "",
      fee: "$500",
      frequency: "Quarterly",
      effectiveDate: new Date().toISOString().slice(0, 10),
      term: "Annual, auto-renewing",
      status: "draft",
      services: [...MSA_SERVICES],
      referralCredit: false,
      letterhead: "bfo",
    });
    setAddingContract(false);
  }

  async function deleteContract(contractId: string) {
    const { db } = await import("../firebase");
    const { ref, remove } = await import("firebase/database");
    await remove(ref(db, `assets/${id}/contracts/${contractId}`));
  }

  async function updateContractStatus(contractId: string, status: "draft" | "active" | "terminated") {
    const { db } = await import("../firebase");
    const { ref, update } = await import("firebase/database");
    await update(ref(db, `assets/${id}/contracts/${contractId}`), { status });
  }

  function startEditContract(c: OperatingContract) {
    setEditingContractId(c.id);
    setEditContractForm({
      counterparty: c.counterparty,
      fee: c.fee,
      frequency: c.frequency,
      effectiveDate: c.effectiveDate,
      term: c.term,
      status: c.status,
      services: normalizeServices(Array.isArray(c.services) && c.services.length > 0 ? c.services : MSA_SERVICES),
      referralCredit: c.referralCredit ?? false,
      letterhead: c.letterhead ?? "bfo",
    });
    setAddingContract(false);
  }

  async function saveEditContract() {
    if (!editingContractId) return;
    if (!editContractForm.counterparty.trim()) return;
    const services = editContractForm.services.length > 0 ? editContractForm.services : MSA_SERVICES;
    const { db } = await import("../firebase");
    const { ref, update } = await import("firebase/database");
    await update(ref(db, `assets/${id}/contracts/${editingContractId}`), {
      counterparty: editContractForm.counterparty.trim(),
      fee: editContractForm.fee.trim() || "$0",
      frequency: editContractForm.frequency,
      effectiveDate: editContractForm.effectiveDate,
      term: editContractForm.term.trim() || "Annual, auto-renewing",
      status: editContractForm.status,
      services,
      referralCredit: editContractForm.referralCredit,
      letterhead: editContractForm.letterhead,
    });
    setEditingContractId(null);
  }

  function toggleService(list: string[], svc: string): string[] {
    return list.includes(svc) ? list.filter((s) => s !== svc) : [...list, svc];
  }

  const directors = corpData.directors ? Object.entries(corpData.directors).map(([k, v]) => ({ id: k, ...v })) : [];
  const officers = corpData.officers ? Object.entries(corpData.officers).map(([k, v]) => ({ id: k, ...v })) : [];
  const shareholders = corpData.shareholders ? Object.entries(corpData.shareholders).map(([k, v]) => ({ id: k, ...v })) : [];

  const breadcrumb = (
    <nav aria-label="Breadcrumb" className={`flex items-center gap-2 ${kicker}`}>
      <Link to="/assets" className={`inline-flex items-center gap-1 max-sm:min-h-[40px] max-sm:pr-2 transition-colors ${isDark ? "hover:text-white" : "hover:text-gray-900"}`}>
        <Icon name="chevronLeft" className="w-3 h-3" strokeWidth={2.25} />
        Entities
      </Link>
      <span className={isDark ? "text-gray-700" : "text-gray-300"}>/</span>
      <span className={isDark ? "text-gray-400" : "text-gray-700"}>Entity</span>
    </nav>
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-[1400px]">
        <div className={`rounded-2xl ${surface} px-5 py-5 sm:px-6`}>
          <div className="flex items-center gap-2.5">
            <span className={`h-1.5 w-1.5 rounded-full motion-safe:animate-pulse ${accentBg}`} />
            <span className={kicker}>Loading entity…</span>
          </div>
        </div>
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="mx-auto max-w-[1400px]">
        <div className={`rounded-2xl ${surface} px-5 py-5 sm:px-6`}>
          {breadcrumb}
          <p className={`mt-4 text-[14px] ${textSoft}`}>Entity not found.</p>
        </div>
      </div>
    );
  }

  async function copyValue(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older browsers and non-secure contexts: copy through a hidden field.
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      el.remove();
      if (!ok) return;
    }
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  }

  function handleCopyEin() {
    if (asset?.ein) copyValue("ein", asset.ein);
  }

  function sectionHeader(kickerText: string, title: string, count?: number, actions?: React.ReactNode) {
    return (
      <header className={`flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5 ${hairline}`}>
        <div className="min-w-0">
          <p className={kicker}>{kickerText}</p>
          <h2 className="mt-0.5 flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
            {title}
            {count !== undefined && (
              <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums ${isDark ? "bg-white/[0.06] text-gray-400" : "bg-gray-100 text-gray-500"}`}>
                {count}
              </span>
            )}
          </h2>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
    );
  }

  function renderFileSlot(kind: FileKind, title: string, description: string, accept: string, accepted: string[], rule?: DocRule) {
    const file = asset?.[kind];
    const slot = uploadState[kind];
    const typesLabel = accepted.map((t) => t.split("/")[1].toUpperCase()).join(", ");
    const picker = (
      <input type="file" accept={accept} className="sr-only" tabIndex={0} aria-label={`Upload ${title}`} disabled={slot.uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadFile(kind, f); e.target.value = ""; }} />
    );
    if (file) {
      // On file: one compact row.
      return (
        <div id={`filing-${kind}`} className="scroll-mt-24 px-5 py-3">
          <div className="flex items-center gap-3">
            <div className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${accentTile}`}>
              <Icon name="doc" className="w-4 h-4" />
              <span className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ${isDark ? "ring-[#0b0d15]" : "ring-white"}`} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium leading-tight">{title}</p>
              <a
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`${hitY} mt-0.5 block truncate font-mono text-[10px] hover:underline ${textMuted}`}
                title={file.fileName}
              >
                {file.fileName}
              </a>
            </div>
            <div className="flex shrink-0 items-center">
              <a href={file.url} target="_blank" rel="noopener noreferrer" className={iconBtn} title="View" aria-label={`View ${title}`}>
                <Icon name="external" />
              </a>
              <label className={`${iconBtn} focus-within:ring-2 ${isDark ? "focus-within:ring-[#818cf8]/60" : "focus-within:ring-[#4f46e5]/50"} ${slot.uploading ? "opacity-40 pointer-events-none" : ""}`} title="Replace" aria-label={`Replace ${title}`}>
                <Icon name="replace" />
                {picker}
              </label>
              <button onClick={() => handleDeleteFile(kind)} disabled={slot.uploading} className={iconBtnDanger} title={file.docId ? "Unfile (keeps the document)" : "Remove"} aria-label={`Remove ${title}`}>
                <Icon name="trash" />
              </button>
            </div>
          </div>
          {slot.uploading && (
            <div className={`mt-2 h-0.5 overflow-hidden rounded-full ${isDark ? "bg-white/[0.06]" : "bg-gray-100"}`}>
              <div className={`h-full transition-all ${accentBg}`} style={{ width: `${slot.progress}%` }} />
            </div>
          )}
          {slot.error && <p className="mt-2 text-[11px] text-red-400">{slot.error}</p>}
        </div>
      );
    }
    return (
      <div id={`filing-${kind}`} className="scroll-mt-24 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12.5px] font-medium leading-tight">{title}</p>
            <p className={`mt-0.5 text-[11px] leading-snug ${textMuted}`}>{description}</p>
            {rule?.howTo && (
              <a
                href={rule.howTo.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`${hitY} mt-1 inline-flex items-center gap-1 text-[11px] font-medium hover:underline ${accentText}`}
              >
                {rule.howTo.label}
                <Icon name="external" className="h-3 w-3" />
              </a>
            )}
          </div>
          {rule?.level === "recommended" ? (
            <span className={`inline-flex shrink-0 items-center gap-1.5 text-[11px] ${textMuted}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${isDark ? "bg-gray-500" : "bg-gray-400"}`} />
              Optional
            </span>
          ) : (
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 text-[11px]  ${isDark ? "text-amber-400/90" : "text-amber-600"}`}
              title={rule?.level === "expected" ? "Not a legal requirement, but banks, lenders and courts expect it" : "Required"}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              {rule?.level === "expected" ? "Expected" : "Missing"}
            </span>
          )}
        </div>
        <div className="mt-3">
          {(
            <label
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!slot.uploading) setSlot(kind, { dragOver: true }); }}
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); if (!slot.uploading) setSlot(kind, { dragOver: true }); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setSlot(kind, { dragOver: false }); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSlot(kind, { dragOver: false });
                if (slot.uploading) return;
                const f = e.dataTransfer.files?.[0];
                if (!f) return;
                if (!accepted.includes(f.type)) {
                  setSlot(kind, { error: `Only ${typesLabel} files accepted.` });
                  return;
                }
                handleUploadFile(kind, f);
              }}
              className={`flex h-[56px] cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 transition-colors focus-within:ring-2 ${isDark ? "focus-within:ring-[#818cf8]/50" : "focus-within:ring-[#4f46e5]/40"} ${
                slot.dragOver
                  ? isDark ? "border-[#818cf8]/70 bg-[#818cf8]/[0.08]" : "border-[#4f46e5]/60 bg-indigo-50"
                  : isDark ? "border-white/[0.12] hover:border-white/25 hover:bg-white/[0.02]" : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
              } ${slot.uploading ? "opacity-70 pointer-events-none" : ""}`}
            >
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${slot.dragOver ? accentTile : neutralTile}`}>
                <Icon name="upload" className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-[12px] font-medium ${isDark ? "text-gray-200" : "text-gray-800"}`}>
                  {slot.uploading ? `Uploading… ${slot.progress.toFixed(0)}%` : slot.dragOver ? "Drop to upload" : <>Drop file or <span className={accentText}>browse</span></>}
                </p>
                <p className={`mt-0.5 font-mono text-[10px] ${textMuted}`}>{typesLabel} &middot; up to 25 MB</p>
              </div>
              {picker}
            </label>
          )}
          {slot.uploading && (
            <div className={`mt-2 h-0.5 overflow-hidden rounded-full ${isDark ? "bg-white/[0.06]" : "bg-gray-100"}`}>
              <div className={`h-full transition-all ${accentBg}`} style={{ width: `${slot.progress}%` }} />
            </div>
          )}
          {slot.error && <p className="mt-2 text-[11px] text-red-400">{slot.error}</p>}
        </div>
      </div>
    );
  }

  type ContractForm = typeof contractForm;
  // On phones the contracts table becomes stacked cards; each cell shows its column name.
  const stackTd = "max-sm:block max-sm:px-4 max-sm:py-1.5 max-sm:before:mb-1 max-sm:before:block max-sm:before:text-[11px] max-sm:before:font-medium max-sm:before:text-gray-500 max-sm:before:content-[attr(data-label)]";

  function renderTermToggle(term: string, onChange: (next: string) => void) {
    const isAuto = term.toLowerCase().includes("auto-renew");
    return (
      <div className="flex min-w-[200px] items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={isAuto}
          onClick={() => onChange(isAuto ? "Annual, fixed term" : "Annual, auto-renewing")}
          className={`${hit} inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors cursor-pointer ${isAuto ? switchOn : switchOff}`}
        >
          <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${isAuto ? "translate-x-3.5" : "translate-x-0.5"}`} />
        </button>
        <div className="leading-tight">
          <p className="text-[11px] font-medium">{isAuto ? "Annual, auto-renewing" : "Annual, fixed term"}</p>
          <p className={`text-[10px] ${textMuted}`}>{isAuto ? "Renews yearly unless either party cancels 30 days prior." : "Ends after one year; renewal requires both parties."}</p>
        </div>
      </div>
    );
  }

  function renderSwitchRow(on: boolean, onToggle: () => void, title: string, description: string) {
    return (
      <div className="mt-3 flex items-start gap-2.5">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={onToggle}
          className={`${hit} mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${on ? switchOn : switchOff}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
        </button>
        <div>
          <p className="text-[11px] font-medium">{title}</p>
          <p className={`text-[10px] ${textMuted}`}>{description}</p>
        </div>
      </div>
    );
  }

  // Inline editor rows for a contract — shared by "New contract" and row edit.
  function renderContractFormRows(f: ContractForm, setF: (next: ContractForm) => void, onSave: () => void, onCancel: () => void, isNew: boolean) {
    const cellInputCls = `w-full h-7 max-sm:h-[44px] px-2 text-xs ${inputCls}`;
    const editBg = isDark ? "bg-[#818cf8]/[0.04]" : "bg-indigo-50/40";
    return (
      <>
        <tr className={`${isNew ? `border-t ${rowBorder}` : ""} ${editBg} max-sm:block max-sm:pt-2`}>
          <td data-label="Counterparty" className={`px-4 py-2 ${stackTd}`}>
            <input
              value={f.counterparty}
              onChange={(e) => setF({ ...f, counterparty: e.target.value })}
              placeholder={isNew ? "Counterparty (e.g. Acme Holdings, LLC)" : undefined}
              autoFocus
              className={cellInputCls}
            />
          </td>
          <td data-label="Fee" className={`px-4 py-2 ${stackTd}`}>
            <input value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} placeholder={isNew ? "$500" : undefined} className={`${cellInputCls} min-w-[72px]`} />
          </td>
          <td data-label="Frequency" className={`px-4 py-2 ${stackTd}`}>
            <select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })} className={`${cellInputCls} min-w-[96px]`}>
              <option value="Monthly">Monthly</option>
              <option value="Quarterly">Quarterly</option>
              <option value="Annually">Annually</option>
              <option value="One-time">One-time</option>
            </select>
          </td>
          <td data-label="Effective" className={`px-4 py-2 ${stackTd}`}>
            <input type="date" value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} className={`${cellInputCls} min-w-[124px]`} />
          </td>
          <td data-label="Term" className={`px-4 py-2 ${stackTd}`}>{renderTermToggle(f.term, (term) => setF({ ...f, term }))}</td>
          <td data-label="Status" className={`px-4 py-2 ${stackTd}`}>
            <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as "draft" | "active" | "terminated" })} className={cellInputCls}>
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="terminated">terminated</option>
            </select>
          </td>
          <td className="px-4 py-2 text-right max-sm:hidden">
            <div className="inline-flex items-center gap-1">
              <button onClick={onSave} disabled={!f.counterparty.trim()} className={btnXsPrimary}>
                Save
              </button>
              <button onClick={onCancel} className={btnXsGhost}>
                Cancel
              </button>
            </div>
          </td>
        </tr>
        <tr className={`${isNew ? "" : `border-b ${rowBorder}`} ${editBg} max-sm:block`}>
          <td colSpan={7} className="px-4 pb-4 pt-1 max-sm:block">
            <ServicesDropdown selected={f.services} onChange={(next) => setF({ ...f, services: next })} isDark={isDark} />
            {renderSwitchRow(
              f.referralCredit,
              () => setF({ ...f, referralCredit: !f.referralCredit }),
              "Referral credit",
              "Credit referral fees against this client's retainer instead of paying cash. Adds a clause to the contract PDF.",
            )}
            {renderSwitchRow(
              f.letterhead === "robert",
              () => setF({ ...f, letterhead: f.letterhead === "robert" ? "bfo" : "robert" }),
              `Letterhead: ${f.letterhead === "robert" ? "Robert Burton" : "BFO"}`,
              "Switches the contract masthead between BFO and Robert Burton.",
            )}
            {/* Phones: Save sits after the services, at the end of the stacked form. */}
            <div className="mt-4 flex items-center gap-2 sm:hidden">
              <button onClick={onSave} disabled={!f.counterparty.trim()} className={btnXsPrimary}>
                Save
              </button>
              <button onClick={onCancel} className={btnXsGhost}>
                Cancel
              </button>
            </div>
          </td>
        </tr>
      </>
    );
  }

  function statusPillCls(status: OperatingContract["status"]) {
    if (status === "active") return isDark ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300" : "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (status === "terminated") return isDark ? "border-red-500/25 bg-red-500/10 text-red-300" : "border-red-200 bg-red-50 text-red-700";
    return isDark ? "border-white/[0.12] bg-white/[0.04] text-gray-300" : "border-gray-200 bg-gray-50 text-gray-600";
  }

  // Derived header values
  const etype = entityType(asset);
  const isTrust = etype === "Trust";
  const glyph = etype === "C-Corp" ? "INC" : etype === "Trust" ? "TR" : etype === "LP" ? "LP" : "LLC";
  // What the rule book reads: the record, plus its owner and the owners its
  // documents list.
  const ownerRec = asset.ownerId ? allAssets[asset.ownerId] : undefined;
  const docOwners = (asset.members?.length ? asset.members : (asset.profile?.members ?? []).map((m) => ({ ...m, role: "member" }))).filter((m) => !/manager|director|officer/i.test(m.role ?? "") && (m.percent == null || m.percent > 0));
  const paper: PaperworkInput = {
    ...asset,
    owner: ownerRec ? { name: ownerRec.name, type: ownerRec.type, llcType: ownerRec.llcType } : null,
    ownerCount: docOwners.length || undefined,
  };
  const rules = documentRules(paper);
  const scoredKinds = rules.filter((r) => r.level !== "recommended").map((r) => r.key);
  const kinds = kindsFor(asset);
  const filedCount = scoredKinds.filter((k) => asset[k]).length;
  const deadlines = obligations(paper, new Date(), (() => {
    const home = taxHome({ ...paper, ownerId: asset.ownerId }, (oid) => allAssets[oid]);
    return home ? `${home.name}'s ${home.form === "return" ? "return" : home.form}` : null;
  })());
  const issues = paperworkChecks(paper);
  const homeReturn = taxHome({ ...paper, ownerId: asset.ownerId }, (oid) => allAssets[oid]);
  const { score, items: checklist } = entityCompleteness(paper);
  const missing = checklist.filter((i) => !i.done);
  const scoreTone = score >= 90 ? "emerald" : score >= 60 ? "indigo" : "amber";
  const scoreColor = {
    emerald: isDark ? "#34d399" : "#059669",
    indigo: isDark ? "#818cf8" : "#4f46e5",
    amber: isDark ? "#fbbf24" : "#d97706",
  }[scoreTone];
  const docFiledAs = new Map<string, FileKind>();
  for (const k of FILING_KINDS) if (asset[k]?.docId) docFiledAs.set(asset[k]!.docId!, k);
  // The two facts people reach for most lead the strip, one click to copy.
  const metrics: { key: string; label: string; value: string; sub?: string; copy?: string; mono?: boolean; to?: EntityTab }[] = [];
  const formed = fmtDate(asset.formationDate);
  if (isTrust && !asset.ein) {
    const trustees = (asset.trustees ?? "").split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
    metrics.push({ key: "trustees", label: "Trustees", value: String(trustees.length), sub: trustees.length ? trustees[0] : "none recorded" });
  } else {
    metrics.push({ key: "ein", label: "EIN", value: asset.ein || "—", copy: asset.ein || undefined, mono: true });
  }
  metrics.push({
    key: "formed",
    label: isTrust ? "Trust date" : etype === "C-Corp" ? "Incorporated" : etype === "LP" ? "Formed" : "Formation date",
    value: formed || "—",
    copy: formed || undefined,
  });
  metrics.push({ key: "score", label: "Completeness", value: `${score}`, sub: "/ 100" });
  metrics.push({ key: "paper", label: "Paperwork", value: `${filedCount}/${scoredKinds.length}`, sub: filedCount === scoredKinds.length ? "complete" : "on file", to: "documents" });

  // Visible on hover, keyboard focus, and always on touch-size screens.
  const corpRemoveCls = `${hit} text-xs cursor-pointer transition-opacity sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 ${isDark ? "text-gray-400 hover:text-red-400" : "text-gray-500 hover:text-red-600"}`;
  const chipBase = "inline-flex items-center gap-1.5 h-6 px-2 rounded-md border text-[11px] whitespace-nowrap";
  const chipNeutral = `${chipBase} ${isDark ? "border-white/[0.08] bg-white/[0.03] text-gray-300" : "border-gray-200 bg-gray-50 text-gray-600"}`;
  const statusIsActive = asset.status === "Active";

  const emptyValue = <span className={isDark ? "text-gray-600" : "text-gray-300"}>&mdash;</span>;
  // A filing's key fact: its date, and whether the document itself is on file.
  const filedFact = (kind: FileKind, date?: string) => {
    const file = asset[kind];
    if (!file && !fmtDate(date)) return null;
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        {fmtDate(date) ? <span className="tabular-nums">{fmtDate(date)}</span> : <span className={textMuted}>Date not on record</span>}
        {file ? (
          <a href={file.url} target="_blank" rel="noopener noreferrer" className={`${hitY} inline-flex items-center gap-1 text-[11px]  ${isDark ? "text-emerald-400" : "text-emerald-600"} hover:underline`}>
            <Icon name="check" className="h-2.5 w-2.5" strokeWidth={2.5} />
            On file
          </a>
        ) : (
          <span className={`text-[11px]  ${isDark ? "text-amber-400/90" : "text-amber-600"}`}>No document</span>
        )}
      </span>
    );
  };
  const factCell = (label: string, content: React.ReactNode, extraCls = "") => (
    <div key={label} className={`min-w-0 border-l border-t px-5 py-3.5 ${divider} ${extraCls}`}>
      <dt className={kicker}>{label}</dt>
      <dd className="mt-1.5 text-[13px] leading-snug break-words">{content || emptyValue}</dd>
    </div>
  );

  // The tax class with where it came from: a document (green), a person,
  // nothing at all (amber "not confirmed"), or a document that disagrees.
  const taxClassFact = () => {
    if (!asset.llcType && !asset.llcTypeConflict) return null;
    const c = asset.llcTypeConflict;
    const src = asset.llcTypeSource;
    const fromDoc = !!src && src !== BY_HAND;
    return (
      <div className="space-y-1.5">
        {asset.llcType && <div>{asset.llcType}</div>}
        {homeReturn && (
          <p className={`text-[11.5px] ${textMuted}`}>
            Reported on {homeReturn.form === "return" ? `${homeReturn.name}'s return` : `${homeReturn.name}'s ${homeReturn.form}`}
          </p>
        )}
        {c ? (
          <div className={`rounded-lg border px-2.5 py-2 text-[12px] leading-snug ${isDark ? "border-amber-400/30 bg-amber-400/[0.07] text-amber-200" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
            <p>
              <span className="font-semibold">{c.docName}</span> says <span className="font-semibold">{c.value}</span>
              {c.evidence ? ` — ${c.evidence}` : ""}.
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <button type="button" onClick={() => void acceptDocumentTaxClass()} className={`rounded-full px-2.5 py-1 font-medium max-sm:min-h-[36px] ${isDark ? "bg-amber-300 text-black hover:bg-amber-200" : "bg-amber-600 text-white hover:bg-amber-700"}`}>
                Use {c.value}
              </button>
              <button type="button" onClick={() => void dismissTaxClassConflict()} className="rounded-full px-2.5 py-1 underline-offset-2 hover:underline max-sm:min-h-[36px]">
                Keep {asset.llcType || "blank"}
              </button>
            </div>
          </div>
        ) : fromDoc ? (
          <p className={`text-[11.5px] ${isDark ? "text-emerald-400" : "text-emerald-700"}`} title={src}>✓ {src}</p>
        ) : src === BY_HAND ? (
          <p className={`text-[11.5px] text-gray-500`}>Entered by hand · not yet matched to a document</p>
        ) : (
          <p className={`text-[11.5px] ${isDark ? "text-amber-300" : "text-amber-700"}`}>
            {asset.einLetter || asset.w9
              ? sorting > 0
                ? "Checking it against the EIN letter and W-9…"
                : aiDown
                  ? "Not confirmed yet — document reading is paused"
                  : (
                    <>
                      Not confirmed by the EIN letter or W-9 on file —{" "}
                      <Link to={tabPath("documents")} className="underline underline-offset-2">
                        check them, or run Verify
                      </Link>
                    </>
                  )
              : (
                <>
                  Not confirmed by a document —{" "}
                  <button type="button" onClick={() => goToTab("documents", "filing-einLetter", "center")} className="cursor-pointer underline underline-offset-2">
                    upload the EIN letter or W-9
                  </button>
                </>
              )}
          </p>
        )}
      </div>
    );
  };

  // The category menu. Agreements for an LLC's operating contracts, Governance for a corporation's board.
  const complianceAlerts = issues.filter((i) => i.severity !== "info").length + (asset.stateRecord ? stateFindings(asset.stateRecord, asset).filter((f) => f.tone === "bad").length : 0);
  const tabs: { key: EntityTab; label: string; count?: number; alert?: boolean }[] = [
    { key: "overview", label: "Overview" },
    { key: "documents", label: "Documents", count: docs.length },
    { key: "compliance", label: "Compliance", count: complianceAlerts || undefined, alert: complianceAlerts > 0 },
    ...(etype === "LLC" ? [{ key: "agreements" as const, label: "Agreements", count: contracts.length }] : []),
    ...(asset.type === "C-Corp" ? [{ key: "governance" as const, label: "Governance" }] : []),
  ];
  const tab: EntityTab = tabs.some((t) => t.key === tabParam) ? (tabParam as EntityTab) : "overview";
  const mainHasContent = tab !== "compliance" || !isTrust;
  const railHasContent = tab === "overview" || tab === "documents" || tab === "compliance";
  const twoCol = mainHasContent && railHasContent;

  const field = (label: string, control: React.ReactNode, wide = false) => (
    <div className={wide ? "md:col-span-2" : ""}>
      <p className={`mb-1.5 ${kicker}`}>{label}</p>
      {control}
    </div>
  );
  const fieldInput = `w-full h-9 max-sm:h-[44px] px-3 text-[13px] ${inputCls}`;

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      {/* Hero */}
      <section className={`relative overflow-hidden rounded-2xl ${surface}`}>
        <div className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent ${isDark ? "via-[#818cf8]/70" : "via-[#4f46e5]/50"} to-transparent`} />
        <div className={`pointer-events-none absolute -top-24 left-1/4 h-40 w-1/2 rounded-full blur-3xl ${isDark ? "bg-[#818cf8]/[0.07]" : "bg-[#4f46e5]/[0.04]"}`} />
        <div className="relative px-5 pb-5 pt-4 sm:px-6 sm:pb-6 sm:pt-5">
          {breadcrumb}
          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border font-mono text-[11px] font-semibold tracking-[0.08em] ${
                  isDark ? "border-[#818cf8]/30 bg-[#818cf8]/10 text-[#a5b4fc]" : "border-[#4f46e5]/20 bg-[#4f46e5]/[0.06] text-[#4f46e5]"
                }`}
                aria-hidden="true"
              >
                {glyph}
              </div>
              <div className="min-w-0">
                <h1 className="break-words text-[22px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[28px]">{asset.name}</h1>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className={chipNeutral}>{etype}</span>
                  {asset.llcType && (
                    <span className={chipNeutral}>
                      <span className={`h-1 w-1 rounded-full ${accentBg}`} />
                      {asset.llcType}
                    </span>
                  )}
                  <span className={`${chipNeutral} ${asset.state ? "" : textMuted}`}>{asset.state || "No state"}</span>
                  {asset.ownerId && assetNames[asset.ownerId] && (
                    <Link to={`/assets/${asset.ownerId}`} className={`${chipNeutral} ${hitY} transition-colors ${isDark ? "hover:border-white/20" : "hover:border-gray-300"}`}>
                      <span className={textMuted}>Owned by</span>
                      {assetNames[asset.ownerId]}
                    </Link>
                  )}
                  {asset.status && (
                    <span
                      className={`${chipBase} ${
                        statusIsActive
                          ? isDark ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : isDark ? "border-amber-500/20 bg-amber-500/10 text-amber-300" : "border-amber-200 bg-amber-50 text-amber-700"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${statusIsActive ? "bg-emerald-500" : "bg-amber-500"}`} />
                      {asset.status}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:pt-1">
              <button
                onClick={() => (editing ? setEditing(false) : startEditing())}
                aria-expanded={editing}
                className={btnOutline}
              >
                <Icon name="edit" />
                {editing ? "Cancel" : "Edit"}
              </button>
              <button onClick={handleDeleteAsset} className={btnGhostDanger}>
                <Icon name="trash" />
                Delete
              </button>
            </div>
          </div>
        </div>
        <div className={`relative grid grid-cols-2 border-t sm:grid-cols-4 ${hairline}`}>
          {metrics.map((m, i) => {
            const cell = `min-w-0 px-5 py-3.5 sm:px-6 ${divider} ${i % 2 === 1 ? "border-l" : ""} ${i === 2 ? "sm:border-l" : ""} ${i >= 2 ? "border-t sm:border-t-0" : ""}`;
            const value = (
              <p className={`mt-1 truncate text-[15px] font-medium tabular-nums ${m.mono ? "font-mono tracking-[0.02em]" : ""}`}>
                {m.value}
                {m.sub && <span className={`ml-1.5 text-[11px] font-normal ${textMuted}`}>{m.sub}</span>}
              </p>
            );
            if (m.to) {
              return (
                <Link
                  key={m.key}
                  to={tabPath(m.to)}
                  className={`block transition-colors ${cell} ${isDark ? "hover:bg-white/[0.03]" : "hover:bg-gray-50"}`}
                >
                  <p className={kicker}>{m.label}</p>
                  {value}
                </Link>
              );
            }
            if (!m.copy) {
              return (
                <div key={m.key} className={cell}>
                  <p className={kicker}>{m.label}</p>
                  {value}
                </div>
              );
            }
            const done = copied === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => copyValue(m.key, m.copy!)}
                title={`Copy ${m.label.toLowerCase() === "ein" ? "EIN" : m.label.toLowerCase()}`}
                aria-label={`${m.label} ${m.value}. Copy`}
                className={`group/copy text-left cursor-pointer transition-colors ${cell} ${isDark ? "hover:bg-white/[0.03]" : "hover:bg-gray-50"}`}
              >
                <p className={`${kicker} flex items-center gap-1.5`}>
                  {m.label}
                  <span
                    aria-live="polite"
                    className={`inline-flex items-center gap-1 transition-opacity ${
                      done ? (isDark ? "text-emerald-400" : "text-emerald-600") : `${isDark ? "text-gray-600" : "text-gray-400"} sm:opacity-0 sm:group-hover/copy:opacity-100 group-focus-visible/copy:opacity-100`
                    }`}
                  >
                    <Icon name={done ? "check" : "copy"} className="w-3 h-3" strokeWidth={2} />
                    {done ? "Copied" : ""}
                  </span>
                </p>
                {value}
              </button>
            );
          })}
        </div>
      </section>

      {/* Category menu */}
      <nav aria-label="Entity sections" className="sticky top-[calc(3.5rem+env(safe-area-inset-top)+8px)] z-20 lg:top-3">
        <div
          className={`flex gap-1 rounded-xl border p-1 [overflow-x:auto] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
            isDark ? "border-white/[0.08] bg-[#0b0b0f]/95 backdrop-blur-xl" : "border-gray-200 bg-white/95 shadow-[0_1px_2px_rgba(16,24,40,0.04)] backdrop-blur-xl"
          }`}
        >
          {tabs.map((t) => {
            const on = t.key === tab;
            return (
              <Link
                key={t.key}
                to={tabPath(t.key)}
                aria-current={on ? "page" : undefined}
                ref={on ? activeTabRef : undefined}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[12.5px] font-medium transition-colors max-sm:h-[40px] max-sm:px-2.5 ${
                  on
                    ? isDark ? "bg-white/[0.09] text-white" : "bg-gray-900 text-white"
                    : isDark ? "text-gray-400 hover:bg-white/[0.04] hover:text-gray-200" : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                {t.label}
                {!!t.count && (
                  <span
                    className={`min-w-[18px] rounded-full px-1.5 text-center text-[10.5px] tabular-nums leading-[18px] ${
                      t.alert
                        ? isDark ? "bg-red-400/15 text-red-300" : "bg-red-50 text-red-700"
                        : on ? (isDark ? "bg-white/10 text-gray-200" : "bg-white/20 text-white") : isDark ? "bg-white/[0.06] text-gray-400" : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {t.count}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Key facts / Edit form */}
      {tab === "overview" && (editing ? (
        <section id="entity-edit" className={`scroll-mt-[calc(3.5rem+env(safe-area-inset-top)+80px)] lg:scroll-mt-20 rounded-2xl ${surface}`}>
          <header className={`flex items-center gap-2 border-b px-5 py-3.5 ${hairline}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${accentBg}`} />
            <span className={kicker}>Editing entity</span>
          </header>
          <div className="grid grid-cols-1 gap-x-5 gap-y-4 p-5 md:grid-cols-2">
            {field(
              "Entity name",
              <input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Entity name" className={fieldInput} />,
              true,
            )}
            {field(
              "Entity type",
              <div className={`grid grid-cols-3 gap-1 rounded-lg border p-1 ${hairline} ${isDark ? "bg-white/[0.02]" : "bg-gray-50"}`}>
                {(["LLC", "C-Corp", "LP", "Trust"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm({ ...form, type: t })}
                    aria-pressed={form.type === t}
                    className={`h-7 max-sm:h-[40px] rounded-md text-[12px] font-medium transition-colors cursor-pointer ${
                      form.type === t
                        ? isDark ? "bg-white text-gray-950" : "bg-gray-900 text-white"
                        : isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>,
            )}
            {field(
              "Status",
              <select value={form.status || "Active"} onChange={(e) => setForm({ ...form, status: e.target.value })} className={fieldInput}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
                <option value="Dissolved">Dissolved</option>
                <option value="Pending">Pending</option>
              </select>,
            )}
            {field(
              entityType(form) === "Trust" ? "Governing law (state)" : "State of formation",
              <input value={form.state || ""} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder={entityType(form) === "Trust" ? "e.g. Arizona" : "State of formation"} className={fieldInput} />,
            )}
            {field(
              "EIN",
              <input value={form.ein || ""} onChange={(e) => setForm({ ...form, ein: e.target.value })} placeholder="EIN" className={`${fieldInput} font-mono tabular-nums`} />,
            )}
            {entityType(form) !== "Trust" && field(
              "Registered agent",
              <input value={form.registeredAgent || ""} onChange={(e) => setForm({ ...form, registeredAgent: e.target.value })} placeholder="Registered agent" className={fieldInput} />,
            )}
            {field(
              entityType(form) === "Trust" ? "Mailing address" : "Principal address",
              <input value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder={entityType(form) === "Trust" ? "Mailing address" : "Principal address"} className={fieldInput} />,
            )}
            {field(
              entityType(form) === "Trust" ? "Trust date" : "Formation date",
              <input type="date" value={form.formationDate || ""} onChange={(e) => setForm({ ...form, formationDate: e.target.value })} className={fieldInput} />,
            )}
            {field(
              "Entity classification",
              <select value={form.llcType || ""} onChange={(e) => setForm({ ...form, llcType: e.target.value })} className={fieldInput}>
                <option value="">Select…</option>
                {TAX_CLASSES[entityType(form)].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
                {form.llcType && !TAX_CLASSES[entityType(form)].includes(form.llcType as never) && <option value={form.llcType}>{form.llcType}</option>}
              </select>,
            )}
            {entityType(form) === "Trust" && (
              <>
                {field(
                  "Trustees",
                  <input value={form.trustees || ""} onChange={(e) => setForm({ ...form, trustees: e.target.value })} placeholder="e.g. Robert Burton, Claire Burton" className={fieldInput} />,
                )}
                {field(
                  "Grantors",
                  <input value={form.grantors || ""} onChange={(e) => setForm({ ...form, grantors: e.target.value })} placeholder="Who created and funded the trust" className={fieldInput} />,
                )}
                {field(
                  "Beneficiaries",
                  <input value={form.beneficiaries || ""} onChange={(e) => setForm({ ...form, beneficiaries: e.target.value })} placeholder="Who the trust benefits" className={fieldInput} />,
                  true,
                )}
              </>
            )}
            {entityType(form) !== "Trust" && field(
              "State file number",
              <input value={form.fileNumber || ""} onChange={(e) => setForm({ ...form, fileNumber: e.target.value })} placeholder="e.g. E34087392023-1" className={fieldInput} />,
            )}
            {entityType(form) !== "Trust" && field(
              "State filing link",
              <input value={form.stateLink || ""} onChange={(e) => setForm({ ...form, stateLink: e.target.value })} placeholder="https://..." type="url" className={fieldInput} />,
            )}
            {entityType(form) !== "Trust" && field(
              "Operating agreement",
              <input type="date" value={form.operatingAgreementDate || ""} onChange={(e) => setForm({ ...form, operatingAgreementDate: e.target.value })} className={fieldInput} />,
            )}
            {entityType(form) !== "Trust" && field(
              "Articles of organization",
              <input type="date" value={form.articlesOfOrgDate || ""} onChange={(e) => setForm({ ...form, articlesOfOrgDate: e.target.value })} className={fieldInput} />,
            )}
            {field(
              "Notes",
              <textarea value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes" rows={3} className={`w-full px-3 py-2 text-[13px] ${inputCls} resize-none`} />,
              true,
            )}
          </div>
          <footer className={`flex items-center justify-end gap-2 border-t px-5 py-3.5 ${hairline}`}>
            <button onClick={() => setEditing(false)} className={btnOutline}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={!form.name?.trim()} title={form.name?.trim() ? undefined : "The entity needs a name"} className={btnPrimary}>
              <Icon name="check" strokeWidth={2.25} />
              Save changes
            </button>
          </footer>
        </section>
      ) : (
        <section className={`overflow-hidden rounded-2xl ${surface}`}>
          <header className={`border-b px-5 py-3 ${hairline}`}>
            <span className={kicker}>Key facts</span>
          </header>
          <dl className="-ml-px -mt-px grid grid-cols-2 md:grid-cols-4">
            {factCell(
              "EIN",
              asset.ein ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-mono tabular-nums tracking-[0.02em]">{asset.ein}</span>
                  <button
                    type="button"
                    onClick={handleCopyEin}
                    className={`${hit} inline-flex h-5 w-5 items-center justify-center rounded transition-colors cursor-pointer ${
                      copiedEin ? (isDark ? "text-emerald-400" : "text-emerald-600") : isDark ? "text-gray-500 hover:text-white hover:bg-white/[0.06]" : "text-gray-400 hover:text-gray-900 hover:bg-gray-100"
                    }`}
                    title={copiedEin ? "Copied" : "Copy EIN"}
                    aria-label="Copy EIN"
                  >
                    <Icon name={copiedEin ? "check" : "copy"} className="w-3 h-3" strokeWidth={2} />
                  </button>
                </span>
              ) : null,
            )}
            {isTrust ? (
              <>
                {factCell("Trustees", asset.trustees)}
                {factCell("Grantors", asset.grantors)}
                {factCell("Trust date", fmtDate(asset.formationDate) ? <span className="tabular-nums">{fmtDate(asset.formationDate)}</span> : null)}
                {factCell("Governing law", asset.state)}
                {factCell("Tax classification", asset.llcType)}
                {factCell("Beneficiaries", asset.beneficiaries)}
                {factCell("Trust agreement", filedFact("trustAgreement", asset.formationDate))}
                {factCell("Mailing address", asset.address, "col-span-2 md:col-span-4")}
              </>
            ) : (
              <>
            {factCell(
              "Registered agent",
              <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {asset.registeredAgent && <span>{asset.registeredAgent}</span>}
                <Link to={tabPath("compliance")} className={`text-[11.5px] hover:underline ${accentText}`}>
                  {asset.palm?.live?.ra?.status === "active" ? "Palm →" : "Change with Palm →"}
                </Link>
              </span>,
            )}
            {factCell("Principal address", asset.address)}
            {factCell("Formation date", fmtDate(asset.formationDate) ? <span className="tabular-nums">{fmtDate(asset.formationDate)}</span> : null)}
            {factCell(etype === "C-Corp" ? "Classification" : "Tax classification", taxClassFact())}
            {factCell(etype === "C-Corp" ? "Bylaws" : "Operating agreement", filedFact("operatingAgreement", asset.operatingAgreementDate))}
            {factCell(etype === "C-Corp" ? "Certificate" : "Articles of org", filedFact("articles", asset.articlesOfOrgDate))}
              </>
            )}
            {!isTrust && factCell(
              asset.fileNumber ? "State file number" : "State link",
              asset.fileNumber || asset.stateLink ? (
                <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                  {asset.fileNumber && <span className="font-mono tabular-nums tracking-[0.02em]">{asset.fileNumber}</span>}
                  {asset.stateLink && (
                    <a href={asset.stateLink} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 hover:underline ${accentText}`}>
                      View filing
                      <Icon name="external" className="w-3 h-3" />
                    </a>
                  )}
                </span>
              ) : null,
            )}
            {asset.notes &&
              factCell("Notes", <span className={`whitespace-pre-wrap ${textSoft}`}>{asset.notes}</span>, "col-span-2 md:col-span-4")}
          </dl>
        </section>
      ))}

      {/* Main column + rail */}
      <div className={`grid grid-cols-1 items-start gap-5 ${twoCol ? "lg:grid-cols-[minmax(0,1fr)_320px]" : ""}`}>
        <div className={`min-w-0 space-y-5 ${mainHasContent ? "" : "hidden"}`}>
          {/* State record and registered agent — through Palm */}
          {tab === "compliance" && !isTrust && (() => {
            const svc = palmRa;
            const toneChip = (tone: "good" | "wait" | "bad" | "muted") =>
              `${chipBase} ${
                tone === "good"
                  ? isDark ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : tone === "wait"
                    ? isDark ? "border-amber-400/25 bg-amber-400/10 text-amber-300" : "border-amber-200 bg-amber-50 text-amber-800"
                    : tone === "bad"
                      ? isDark ? "border-red-400/25 bg-red-400/10 text-red-300" : "border-red-200 bg-red-50 text-red-700"
                      : chipNeutral
              }`;
            // Until Palm answers, go by what was last seen, and don't offer the move.
            const known = svc !== undefined;
            const cachedStatus = palmMode ? asset.palm?.[palmMode]?.ra?.status ?? null : null;
            const status = known ? svc?.status ?? null : cachedStatus;
            const palmIsAgent = status === "active";
            const inFlight = status === "pending" || status === "termination_requested";
            const canMove = known && userIsAdmin() && !palmIsAgent && !inFlight;
            const st = status ? RA_STATUS[status] : null;
            const rec = asset.stateRecord;
            const findings = rec ? stateFindings(rec, asset) : [];
            const agentShown = palmIsAgent ? svc?.name ?? (palmMode ? asset.palm?.[palmMode]?.ra?.name : null) ?? asset.registeredAgent : asset.registeredAgent;
            const agentAddress = palmIsAgent ? formatPalmAddress(svc?.address) : null;
            const linkBtn = `${hitY} inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium disabled:cursor-wait disabled:opacity-60 ${accentText}`;
            return (
              <section id="registered-agent" className={`scroll-mt-[calc(3.5rem+env(safe-area-inset-top)+80px)] overflow-hidden rounded-2xl lg:scroll-mt-20 ${surface}`}>
                {sectionHeader(
                  "State record · Palm",
                  "Registered agent",
                  undefined,
                  palmStatus?.configured ? (
                    <div className="flex items-center gap-3">
                      {palmMode === "test" && <span className={toneChip("wait")}>Test mode</span>}
                      <button type="button" onClick={() => void checkStateRecord()} disabled={!!palmBusy} className={linkBtn}>
                        <Icon name="replace" className="h-3 w-3" />
                        {palmBusy === "record" ? "Checking…" : rec ? "Re-check state record" : "Check state record"}
                      </button>
                    </div>
                  ) : undefined,
                )}
                {!palmStatus ? (
                  <p className={`px-5 py-4 text-[12.5px] ${textMuted}`}>Checking the Palm connection…</p>
                ) : palmStatus.error ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-[12.5px]">
                    <p className={textSoft}>Couldn't reach Palm just now.</p>
                    <button type="button" onClick={() => void loadPalmStatus()} className={btnXsOutline}>
                      Try again
                    </button>
                  </div>
                ) : !palmStatus.configured ? (
                  <div className="space-y-3 px-5 py-4 text-[12.5px] leading-snug">
                    <p className={textSoft}>
                      Connect Palm to read this entity's record straight from the state and to have Palm act as its registered agent, with state mail and any legal papers delivered here.
                    </p>
                    <ol className={`list-decimal space-y-1 pl-4 ${textSoft}`}>
                      <li>
                        In Palm Console, open <b>API Keys</b> and generate a key. Start with a test key (<code>sk_test_…</code>): nothing is filed or billed.
                      </li>
                      <li>
                        In Vercel, add it to the <b>bfo</b> project as <code>PALM_API_KEY</code> (mark it Sensitive), then redeploy.
                      </li>
                    </ol>
                    <a href="https://platform.getpalm.com" target="_blank" rel="noopener noreferrer" className={btnXsOutline}>
                      Open Palm Console
                      <Icon name="external" className="h-3 w-3" />
                    </a>
                  </div>
                ) : (
                  <div className={`divide-y ${isDark ? "divide-white/[0.06]" : "divide-gray-100"}`}>
                    {/* The agent of record, and Palm's service */}
                    <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                      <div className="min-w-0 space-y-1">
                        <p className={kicker}>Agent of record</p>
                        <p className="text-[13.5px]">{agentShown || emptyValue}</p>
                        {agentAddress && <p className={`text-[11.5px] ${textMuted}`}>{agentAddress}</p>}
                        {!palmIsAgent && asset.registeredAgentSource && <p className={`text-[11px] ${textMuted}`}>{asset.registeredAgentSource}</p>}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {st ? (
                            <span className={toneChip(st.tone)}>
                              {st.label}
                              {svc?.status === "active" && svc.started_at ? ` · since ${fmtDate(svc.started_at.slice(0, 10))}` : ""}
                            </span>
                          ) : (
                            palmBusinessId && svc === null && <span className={chipNeutral}>Palm isn't the agent</span>
                          )}
                        </div>
                        {svc?.status === "pending" && (
                          <p className={`max-w-[52ch] text-[11.5px] leading-snug ${textMuted}`}>
                            Palm is filing the change with the state. It can take a few business days; this updates when the state accepts it.
                          </p>
                        )}
                        {svc?.status === "failed" && (
                          <p className={`max-w-[60ch] text-[11.5px] leading-snug ${isDark ? "text-red-300" : "text-red-700"}`}>
                            {svc.rejection_reason ? `The state didn't accept it: ${svc.rejection_reason}. ` : "Palm couldn't complete the change. "}
                            Palm Console shows the reason under this business; sort that out before trying again.
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {palmBusinessId && (
                          <button type="button" onClick={() => void refreshPalm(palmBusinessId)} disabled={!!palmBusy} className={btnXsOutline}>
                            {palmBusy === "refresh" ? "Refreshing…" : "Refresh"}
                          </button>
                        )}
                        {canMove ? (
                          <button type="button" onClick={() => void moveAgentToPalm()} disabled={!!palmBusy} className={btnXsPrimary}>
                            {palmBusy === "move" ? "Requesting…" : svc?.status === "failed" ? "Try again" : "Make Palm the agent"}
                          </button>
                        ) : (
                          !palmIsAgent && !inFlight && <span className={`text-[11px] ${textMuted}`}>An owner or admin can change the agent.</span>
                        )}
                      </div>
                    </div>

                    {/* Which registry entry is this entity? */}
                    {registryChoices && registryChoices.length > 0 && (
                      <div className="px-5 py-4">
                        <p className={kicker}>Which of these is {asset.name}?</p>
                        <ul className="mt-2 space-y-1.5">
                          {registryChoices.slice(0, 6).map((r, i) => (
                            <li key={`${r.registration_number ?? r.palm_id}-${i}`} className="flex items-start justify-between gap-3 text-[12.5px]">
                              <span className="min-w-0">
                                <span className="block">{r.name}</span>
                                <span className={`block text-[11.5px] ${textMuted}`}>
                                  {[r.registration_jurisdiction, r.registration_number, r.status, r.formation_date ? `formed ${r.formation_date.slice(0, 10)}` : null].filter(Boolean).join(" · ")}
                                </span>
                              </span>
                              <button type="button" onClick={() => void checkStateRecord(r)} disabled={!!palmBusy} className={`${btnXsOutline} shrink-0`}>
                                This one
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* What the state's record says */}
                    {rec && (
                      <div className="space-y-3 px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className={kicker}>State record</p>
                          {rec.status && <span className={toneChip(rec.status === "active" ? "good" : "bad")}>{rec.status}</span>}
                          {(["registration", "tax", "agent"] as const).map((k) =>
                            rec.standing?.[k] ? (
                              <span key={k} className={toneChip(rec.standing[k] === "compliant" ? "good" : "bad")}>
                                {k === "registration" ? "Filings" : k === "tax" ? "Tax" : "Agent"} {rec.standing[k] === "compliant" ? "current" : "behind"}
                              </span>
                            ) : null,
                          )}
                          {rec.mode === "test" && <span className={chipNeutral}>sandbox data</span>}
                        </div>
                        <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-[12.5px] sm:grid-cols-2">
                          {rec.registrationNumber && (
                            <div>
                              <dt className={kicker}>File number</dt>
                              <dd className="mt-0.5 font-mono tabular-nums">{rec.registrationNumber}</dd>
                            </div>
                          )}
                          {rec.agent && (
                            <div>
                              <dt className={kicker}>Agent the state has</dt>
                              <dd className="mt-0.5">{rec.agent}</dd>
                              {rec.agentAddress && <dd className={`text-[11px] ${textMuted}`}>{rec.agentAddress}</dd>}
                            </div>
                          )}
                          {rec.managers && rec.managers.length > 0 && (
                            <div>
                              <dt className={kicker}>People on file</dt>
                              <dd className="mt-0.5">{rec.managers.join(", ")}</dd>
                            </div>
                          )}
                          {rec.formationDate && (
                            <div>
                              <dt className={kicker}>Formed</dt>
                              <dd className="mt-0.5 tabular-nums">{fmtDate(rec.formationDate.slice(0, 10))}</dd>
                            </div>
                          )}
                        </dl>
                        {findings.length > 0 && (
                          <ul className="space-y-1">
                            {findings.map((f, i) => (
                              <li
                                key={i}
                                className={`text-[12px] leading-snug ${
                                  f.tone === "bad" ? (isDark ? "text-red-300" : "text-red-700") : f.tone === "warn" ? (isDark ? "text-amber-300" : "text-amber-800") : textSoft
                                }`}
                              >
                                {f.text}
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className={`text-[11px] ${textMuted}`}>
                          Read from the state through Palm, {fmtStamp(rec.checkedAt)}.
                          {palmIsAgent && svc?.started_at && rec.checkedAt < Date.parse(svc.started_at) ? " That was before Palm became the agent — re-check to see the change on the state's side." : ""}
                        </p>
                      </div>
                    )}

                    {/* State mail and agent paperwork */}
                    {palmDocs && palmDocs.length > 0 && (
                      <div className="px-5 py-4">
                        <p className={kicker}>From the state, through Palm</p>
                        <ul className="mt-2 space-y-1.5">
                          {palmDocs.map((d) => (
                            <li key={d.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                              <span className="min-w-0 truncate">
                                <span className={docKindOf(d) === "service_of_process" ? `font-medium ${isDark ? "text-red-300" : "text-red-700"}` : ""}>
                                  {DOC_LABEL[docKindOf(d)] ?? (docKindOf(d) || "Document").replace(/_/g, " ")}
                                </span>
                                <span className={textMuted}>
                                  {d.filename ? ` · ${d.filename}` : ""}
                                  {d.created_at ? ` · ${fmtDate(d.created_at.slice(0, 10))}` : ""}
                                </span>
                              </span>
                              <button
                                type="button"
                                onClick={() => void openPalmDocument(d).catch((e) => setPalmError(e instanceof Error ? e.message : "Couldn't open it."))}
                                className={btnXsOutline}
                              >
                                Open
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {palmError && <p className={`px-5 py-3 text-[12px] leading-snug ${isDark ? "text-red-300" : "text-red-700"}`}>{palmError}</p>}
                  </div>
                )}
              </section>
            );
          })()}

          {/* What this entity is — read from its governing documents */}
          {tab === "overview" && (
          <section className={`overflow-hidden rounded-2xl ${surface}`}>
            {sectionHeader(
              "From its documents",
              "What this entity is",
              undefined,
              <button
                type="button"
                onClick={() => void buildProfile()}
                disabled={profiling}
                className={`${hitY} inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium disabled:cursor-wait disabled:opacity-60 ${accentText}`}
              >
                <Icon name="sparkle" className="h-3 w-3" />
                {profiling ? "Reading…" : asset.profile ? "Re-read" : "Read documents"}
              </button>,
            )}
            {asset.profile ? (
              <div className="space-y-4 px-5 py-4">
                <p className="text-[13.5px] leading-relaxed">{asset.profile.whatItIs}</p>
                <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                  {asset.profile.members.length > 0 && (
                    <div>
                      <p className={kicker}>Owners</p>
                      <ul className="mt-1.5 space-y-1 text-[12.5px]">
                        {asset.profile.members.map((m, i) => (
                          <li key={i} className="flex justify-between gap-3">
                            <span className="min-w-0 truncate">{m.name}</span>
                            <span className={`shrink-0 tabular-nums ${textMuted}`}>{m.percent != null ? `${m.percent}%` : "—"}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="space-y-2.5">
                    {asset.profile.management && (
                      <div>
                        <p className={kicker}>Run by</p>
                        <p className="mt-0.5 text-[12.5px]">
                          {asset.profile.managers.length ? asset.profile.managers.join(", ") : "—"}
                          <span className={textMuted}> · {asset.profile.management}</span>
                        </p>
                      </div>
                    )}
                    {asset.profile.taxTreatment && (
                      <div>
                        <p className={kicker}>Taxed as</p>
                        <p className="mt-0.5 text-[12.5px]">{asset.profile.taxTreatment}</p>
                        {asset.profile.taxEvidence && <p className={`mt-0.5 text-[11px] leading-snug ${textMuted}`}>{asset.profile.taxEvidence}</p>}
                      </div>
                    )}
                    {asset.profile.governingLaw && (
                      <div>
                        <p className={kicker}>Governing law</p>
                        <p className="mt-0.5 text-[12.5px]">{asset.profile.governingLaw}</p>
                      </div>
                    )}
                  </div>
                </div>
                {asset.profile.properties.length > 0 && (
                  <div>
                    <p className={kicker}>Property and businesses</p>
                    <ul className="mt-1.5 space-y-1 text-[12.5px]">
                      {asset.profile.properties.map((p, i) => (
                        <li key={i} className="flex justify-between gap-3">
                          <span className="min-w-0">{p.description}{p.state ? `, ${p.state}` : ""}</span>
                          {p.status && <span className={`shrink-0 text-[11px] ${/sold/i.test(p.status) ? textMuted : isDark ? "text-emerald-400" : "text-emerald-700"}`}>{p.status}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {asset.profile.keyTerms.length > 0 && (
                  <div>
                    <p className={kicker}>Terms that matter</p>
                    <ul className={`mt-1.5 list-disc space-y-0.5 pl-4 text-[12px] leading-snug ${textSoft}`}>
                      {asset.profile.keyTerms.map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                  </div>
                )}
                {asset.profile.issues.length > 0 && (
                  <div className={`rounded-lg border px-3 py-2.5 ${isDark ? "border-amber-400/25 bg-amber-400/[0.05]" : "border-amber-200 bg-amber-50"}`}>
                    <p className={`text-[11.5px] font-medium ${isDark ? "text-amber-300" : "text-amber-800"}`}>Worth a look</p>
                    <ul className={`mt-1 list-disc space-y-0.5 pl-4 text-[12px] leading-snug ${isDark ? "text-amber-100/90" : "text-amber-900"}`}>
                      {asset.profile.issues.map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                  </div>
                )}
                <p className={`text-[11px] leading-snug ${textMuted}`}>
                  Read {fmtStamp(asset.profile.checkedAt)} from {asset.profile.sources.length ? asset.profile.sources.join(", ") : "the documents on file"}.
                </p>
              </div>
            ) : (
              <p className={`px-5 py-4 text-[12.5px] leading-snug ${textMuted}`}>
                {profiling
                  ? "Reading the operating agreement and the other documents on file…"
                  : profileError || (aiDown ? "Document reading is paused right now." : "Upload the operating agreement (or bylaws / trust agreement) and this fills in: what the entity is for, what it owns, who runs and owns it, and how it's taxed.")}
              </p>
            )}
            {asset.profile && profileError && <p className="px-5 pb-3 text-[11px] text-red-400">{profileError}</p>}
          </section>
          )}

          {/* C-Corp Management */}
          {tab === "governance" && asset.type === "C-Corp" && (
            <section className={`overflow-hidden rounded-2xl ${surface}`}>
              {sectionHeader("Governance", "Corporate Management")}

              {/* Tabs */}
              <div className="overflow-x-auto px-5 pt-4">
                <div className={`inline-flex min-w-full gap-1 rounded-lg border p-1 sm:min-w-0 ${hairline} ${isDark ? "bg-white/[0.02]" : "bg-gray-50"}`}>
                  {([
                    ["board", "Board of Directors"],
                    ["officers", "Officers"],
                    ["shareholders", "Shareholders"],
                    ["stock", "Stock"],
                    ["compliance", "Compliance"],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setCorpTab(key)}
                      aria-pressed={corpTab === key}
                      className={`h-7 max-sm:h-[40px] whitespace-nowrap rounded-md px-3 text-[12px] font-medium transition-colors cursor-pointer ${
                        corpTab === key
                          ? isDark ? "bg-white text-gray-950" : "bg-gray-900 text-white"
                          : isDark ? "text-gray-400 hover:text-white hover:bg-white/[0.04]" : "text-gray-500 hover:text-gray-900 hover:bg-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="max-w-3xl p-5">
                {/* Board of Directors */}
                {corpTab === "board" && (
                  <div className="space-y-3">
                    {directors.length > 0 ? (
                      <div className="space-y-2">
                        {directors.map((d) => (
                          <div key={d.id} className={`flex items-center justify-between p-3 ${cardCls} group`}>
                            <div>
                              <p className="text-[13px] font-medium">{d.name}</p>
                              <p className={`text-[11px] ${textMuted}`}>{d.title}{d.since ? ` — Since ${d.since}` : ""}</p>
                            </div>
                            <button onClick={async () => { if (await confirmDialog({ title: `Remove ${d.name} from the board?`, tone: "danger", confirmLabel: "Remove" })) void removeDirector(d.id); }} className={corpRemoveCls}>Remove</button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className={`text-[13px] ${textMuted}`}>No directors added yet.</p>
                    )}
                    {addingDirector ? (
                      <div className={`p-4 ${cardCls} space-y-2`}>
                        <input value={dirForm.name} onChange={(e) => setDirForm({ ...dirForm, name: e.target.value })} placeholder="Name" className={fieldInput} />
                        <input value={dirForm.title} onChange={(e) => setDirForm({ ...dirForm, title: e.target.value })} placeholder="Title (e.g. Director, Chairman)" className={fieldInput} />
                        <input type="date" value={dirForm.since} onChange={(e) => setDirForm({ ...dirForm, since: e.target.value })} className={fieldInput} />
                        <div className="flex gap-2">
                          <button onClick={addDirector} className={btnPrimary}>Add</button>
                          <button onClick={() => setAddingDirector(false)} className={`${btnBase} ${textSoft}`}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setAddingDirector(true)} className={`inline-flex items-center gap-1 max-sm:min-h-[40px] text-[12px] font-medium transition-opacity hover:opacity-80 cursor-pointer ${accentText}`}>
                        <Icon name="plus" className="w-3 h-3" strokeWidth={2.25} /> Add Director
                      </button>
                    )}
                  </div>
                )}

                {/* Officers */}
                {corpTab === "officers" && (
                  <div className="space-y-3">
                    {officers.length > 0 ? (
                      <div className="space-y-2">
                        {officers.map((o) => (
                          <div key={o.id} className={`flex items-center justify-between p-3 ${cardCls} group`}>
                            <div>
                              <p className="text-[13px] font-medium">{o.name}</p>
                              <p className={`text-[11px] ${textMuted}`}>{o.title}{o.since ? ` — Since ${o.since}` : ""}</p>
                            </div>
                            <button onClick={async () => { if (await confirmDialog({ title: `Remove ${o.name} as ${o.title}?`, tone: "danger", confirmLabel: "Remove" })) void removeOfficer(o.id); }} className={corpRemoveCls}>Remove</button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className={`text-[13px] ${textMuted}`}>No officers added yet.</p>
                    )}
                    {addingOfficer ? (
                      <div className={`p-4 ${cardCls} space-y-2`}>
                        <input value={offForm.name} onChange={(e) => setOffForm({ ...offForm, name: e.target.value })} placeholder="Name" className={fieldInput} />
                        <input value={offForm.title} onChange={(e) => setOffForm({ ...offForm, title: e.target.value })} placeholder="Title (CEO, CFO, Secretary, etc.)" className={fieldInput} />
                        <input type="date" value={offForm.since} onChange={(e) => setOffForm({ ...offForm, since: e.target.value })} className={fieldInput} />
                        <div className="flex gap-2">
                          <button onClick={addOfficer} className={btnPrimary}>Add</button>
                          <button onClick={() => setAddingOfficer(false)} className={`${btnBase} ${textSoft}`}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setAddingOfficer(true)} className={`inline-flex items-center gap-1 max-sm:min-h-[40px] text-[12px] font-medium transition-opacity hover:opacity-80 cursor-pointer ${accentText}`}>
                        <Icon name="plus" className="w-3 h-3" strokeWidth={2.25} /> Add Officer
                      </button>
                    )}
                  </div>
                )}

                {/* Shareholders */}
                {corpTab === "shareholders" && (
                  <div className="space-y-3">
                    {shareholders.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-[13px] text-left mb-3">
                          <thead>
                            <tr className={`border-b ${hairline}`}>
                              <th className={`py-2 pr-3 font-normal ${kicker}`}>Name</th>
                              <th className={`py-2 pr-3 font-normal ${kicker}`}>Shares</th>
                              <th className={`py-2 pr-3 font-normal ${kicker}`}>Class</th>
                              <th className={`py-2 pr-3 font-normal ${kicker}`}>%</th>
                              <th className="py-2 w-12"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {shareholders.map((s) => (
                              <tr key={s.id} className={`border-b ${rowBorder} group`}>
                                <td className="py-2 pr-3">{s.name}</td>
                                <td className={`py-2 pr-3 tabular-nums ${textSoft}`}>{s.shares.toLocaleString()}</td>
                                <td className={`py-2 pr-3 ${textSoft}`}>{s.class}</td>
                                <td className={`py-2 pr-3 tabular-nums ${textSoft}`}>{s.percentage}%</td>
                                <td className="py-2">
                                  <button onClick={async () => { if (await confirmDialog({ title: `Remove ${s.name} from the shareholders?`, tone: "danger", confirmLabel: "Remove" })) void removeShareholder(s.id); }} className={corpRemoveCls}>Remove</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className={`text-[13px] ${textMuted}`}>No shareholders added yet.</p>
                    )}
                    {addingShareholder ? (
                      <div className={`p-4 ${cardCls} space-y-2`}>
                        <input value={shForm.name} onChange={(e) => setShForm({ ...shForm, name: e.target.value })} placeholder="Shareholder name" className={fieldInput} />
                        <div className="flex gap-2">
                          <input type="number" value={shForm.shares} onChange={(e) => setShForm({ ...shForm, shares: e.target.value })} placeholder="Shares" className={`flex-1 min-w-0 h-9 px-3 text-[13px] ${inputCls}`} />
                          <select value={shForm.class} onChange={(e) => setShForm({ ...shForm, class: e.target.value })} className={`h-9 px-3 text-[13px] ${inputCls}`}>
                            <option value="Common">Common</option>
                            <option value="Preferred A">Preferred A</option>
                            <option value="Preferred B">Preferred B</option>
                          </select>
                          <input type="number" value={shForm.percentage} onChange={(e) => setShForm({ ...shForm, percentage: e.target.value })} placeholder="%" step="0.01" className={`w-20 h-9 px-3 text-[13px] ${inputCls}`} />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={addShareholder} className={btnPrimary}>Add</button>
                          <button onClick={() => setAddingShareholder(false)} className={`${btnBase} ${textSoft}`}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setAddingShareholder(true)} className={`inline-flex items-center gap-1 max-sm:min-h-[40px] text-[12px] font-medium transition-opacity hover:opacity-80 cursor-pointer ${accentText}`}>
                        <Icon name="plus" className="w-3 h-3" strokeWidth={2.25} /> Add Shareholder
                      </button>
                    )}
                  </div>
                )}

                {/* Stock */}
                {corpTab === "stock" && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className={`block mb-1.5 ${kicker}`}>Authorized Shares</label>
                      <input type="number" value={corpData.authorizedShares || ""} onChange={(e) => updateCorpField("authorizedShares", Number(e.target.value) || 0)} placeholder="e.g. 10,000,000" className={fieldInput} />
                    </div>
                    <div>
                      <label className={`block mb-1.5 ${kicker}`}>Issued Shares</label>
                      <input type="number" value={corpData.issuedShares || ""} onChange={(e) => updateCorpField("issuedShares", Number(e.target.value) || 0)} placeholder="e.g. 1,000,000" className={fieldInput} />
                    </div>
                    <div>
                      <label className={`block mb-1.5 ${kicker}`}>Par Value</label>
                      <input value={corpData.parValue || ""} onChange={(e) => updateCorpField("parValue", e.target.value)} placeholder="e.g. $0.001" className={fieldInput} />
                    </div>
                    <div>
                      <label className={`block mb-1.5 ${kicker}`}>Stock Classes</label>
                      <input value={corpData.stockClasses || ""} onChange={(e) => updateCorpField("stockClasses", e.target.value)} placeholder="e.g. Common, Preferred A" className={fieldInput} />
                    </div>
                  </div>
                )}

                {/* Compliance */}
                {corpTab === "compliance" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className={`block mb-1.5 ${kicker}`}>Fiscal Year End</label>
                        <input value={corpData.fiscalYearEnd || ""} onChange={(e) => updateCorpField("fiscalYearEnd", e.target.value)} placeholder="e.g. December 31" className={fieldInput} />
                      </div>
                      <div>
                        <label className={`block mb-1.5 ${kicker}`}>State Filing Status</label>
                        <select value={corpData.stateFilingStatus || ""} onChange={(e) => updateCorpField("stateFilingStatus", e.target.value)} className={fieldInput}>
                          <option value="">Select...</option>
                          <option value="Current">Current</option>
                          <option value="Due Soon">Due Soon</option>
                          <option value="Overdue">Overdue</option>
                          <option value="N/A">N/A</option>
                        </select>
                      </div>
                      <div>
                        <label className={`block mb-1.5 ${kicker}`}>Annual Report Due</label>
                        <input type="date" value={corpData.annualReportDue || ""} onChange={(e) => updateCorpField("annualReportDue", e.target.value)} className={fieldInput} />
                      </div>
                      <div>
                        <label className={`block mb-1.5 ${kicker}`}>Next Board Meeting</label>
                        <input type="date" value={corpData.nextBoardMeeting || ""} onChange={(e) => updateCorpField("nextBoardMeeting", e.target.value)} className={fieldInput} />
                      </div>
                      <div>
                        <label className={`block mb-1.5 ${kicker}`}>Incorporation Date</label>
                        <input type="date" value={corpData.incorporationDate || ""} onChange={(e) => updateCorpField("incorporationDate", e.target.value)} className={fieldInput} />
                      </div>
                      <div>
                        <label className={`block mb-1.5 ${kicker}`}>Last Annual Report</label>
                        <input type="date" value={corpData.lastAnnualReport || ""} onChange={(e) => updateCorpField("lastAnnualReport", e.target.value)} className={fieldInput} />
                      </div>
                      <div>
                        <label className={`block mb-1.5 ${kicker}`}>Last Board Meeting</label>
                        <input type="date" value={corpData.lastBoardMeeting || ""} onChange={(e) => updateCorpField("lastBoardMeeting", e.target.value)} className={fieldInput} />
                      </div>
                    </div>

                    {/* Compliance status summary */}
                    {(corpData.annualReportDue || corpData.nextBoardMeeting) && (
                      <div className={`mt-4 p-4 ${cardCls}`}>
                        <p className={`mb-2 ${kicker}`}>Upcoming Deadlines</p>
                        <div className="space-y-1">
                          {corpData.annualReportDue && (
                            <div className="flex justify-between text-xs">
                              <span className={textSoft}>Annual Report</span>
                              <span className={`tabular-nums ${new Date(corpData.annualReportDue) < new Date() ? (isDark ? "text-red-400" : "text-red-600") : isDark ? "text-emerald-400" : "text-emerald-700"}`}>
                                {corpData.annualReportDue}
                              </span>
                            </div>
                          )}
                          {corpData.nextBoardMeeting && (
                            <div className="flex justify-between text-xs">
                              <span className={textSoft}>Board Meeting</span>
                              <span className={`tabular-nums ${new Date(corpData.nextBoardMeeting) < new Date() ? (isDark ? "text-red-400" : "text-red-600") : isDark ? "text-emerald-400" : "text-emerald-700"}`}>
                                {corpData.nextBoardMeeting}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Operating Contracts */}
          {tab === "agreements" && etype === "LLC" && (() => {
            const showEmpty = contracts.length === 0 && !addingContract;
            return (
              <section className={`overflow-hidden rounded-2xl ${surface}`}>
                {sectionHeader(
                  "Agreements",
                  "Operating Contracts",
                  contracts.length,
                  <>
                    {asset.name.toLowerCase().includes("ledger louise") && contracts.length < LEDGER_LOUISE_SUBS.length && (
                      <button onClick={generateMSATemplates} className={btnOutline}>
                        Generate MSA Templates
                      </button>
                    )}
                    {!showEmpty && (
                      <button onClick={() => setAddingContract((v) => !v)} className={addingContract ? btnOutline : btnPrimary}>
                        {!addingContract && <Icon name="plus" strokeWidth={2.25} />}
                        {addingContract ? "Cancel" : "New Contract"}
                      </button>
                    )}
                  </>,
                )}

                {showEmpty ? (
                  <div className="flex flex-col items-start gap-3 px-5 py-5 sm:flex-row sm:items-center">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${hairline} ${neutralTile}`}>
                      <Icon name="page" className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium">No operating contracts yet</p>
                      <p className={`mt-0.5 text-[12px] ${textMuted}`}>Draft an MSA with a counterparty to track its fee, term and status.</p>
                    </div>
                    <button onClick={() => setAddingContract(true)} className={btnOutline}>
                      <Icon name="plus" strokeWidth={2.25} />
                      New Contract
                    </button>
                  </div>
                ) : (
                  <div className="sm:overflow-x-auto">
                    <table className="w-full text-sm max-sm:block sm:min-w-[960px]">
                      <thead className="max-sm:hidden">
                        <tr className={`border-b ${hairline} ${isDark ? "bg-white/[0.015]" : "bg-gray-50/60"}`}>
                          <th className={`w-[28%] px-4 py-2.5 text-left font-normal ${kicker}`}>Counterparty</th>
                          <th className={`px-4 py-2.5 text-left font-normal ${kicker}`}>Fee</th>
                          <th className={`px-4 py-2.5 text-left font-normal ${kicker}`}>Frequency</th>
                          <th className={`px-4 py-2.5 text-left font-normal ${kicker}`}>Effective</th>
                          <th className={`px-4 py-2.5 text-left font-normal ${kicker}`}>Term</th>
                          <th className={`px-4 py-2.5 text-left font-normal ${kicker}`}>Status</th>
                          <th className={`px-4 py-2.5 text-right font-normal ${kicker}`}>Actions</th>
                        </tr>
                      </thead>
                      <tbody className="max-sm:block">
                        {contracts.map((contract) =>
                          editingContractId === contract.id ? (
                            <Fragment key={contract.id}>
                              {renderContractFormRows(editContractForm, setEditContractForm, saveEditContract, () => setEditingContractId(null), false)}
                            </Fragment>
                          ) : (
                            <tr key={contract.id} className={`border-b last:border-b-0 ${rowBorder} ${rowHover} transition-colors max-sm:grid max-sm:grid-cols-2 max-sm:py-2`}>
                              <td className="px-4 py-3 max-sm:col-span-2 max-sm:pb-1">
                                <p className="text-[13px] font-medium leading-tight">{contract.counterparty}</p>
                                <p className={`mt-0.5 text-[11px] ${textMuted}`}>
                                  MSA — {asset.name} &rarr; {contract.counterparty}
                                </p>
                              </td>
                              <td data-label="Fee" className={`px-4 py-3 text-[13px] tabular-nums ${stackTd}`}>{contract.fee}</td>
                              <td data-label="Frequency" className={`px-4 py-3 text-[13px] ${textSoft} ${stackTd}`}>{contract.frequency}</td>
                              <td data-label="Effective" className={`whitespace-nowrap px-4 py-3 text-[12px] tabular-nums ${textSoft} ${stackTd}`}>{fmtDate(contract.effectiveDate)}</td>
                              <td data-label="Term" className={`px-4 py-3 text-[12px] ${textSoft} ${stackTd}`}>{contract.term}</td>
                              <td data-label="Status" className={`px-4 py-3 ${stackTd} max-sm:col-span-2`}>
                                <div className="relative inline-flex">
                                  <select
                                    value={contract.status}
                                    onChange={(e) => updateContractStatus(contract.id, e.target.value as "draft" | "active" | "terminated")}
                                    aria-label={`Status of the MSA with ${contract.counterparty}`}
                                    className={`h-6 max-sm:h-[40px] max-sm:text-[16px] appearance-none rounded-full border pl-2.5 pr-6 max-sm:pl-3.5 max-sm:pr-8 text-[11px]  outline-none cursor-pointer ${statusPillCls(contract.status)} ${
                                      isDark ? "[&_option]:bg-[#111118] [&_option]:text-gray-200" : "[&_option]:bg-white [&_option]:text-gray-900"
                                    }`}
                                  >
                                    <option value="draft">draft</option>
                                    <option value="active">active</option>
                                    <option value="terminated">terminated</option>
                                  </select>
                                  <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 opacity-70">
                                    <Icon name="chevronDown" className="w-3 h-3" strokeWidth={2.25} />
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right max-sm:col-span-2 max-sm:pt-2 max-sm:text-left">
                                <div className="inline-flex items-center gap-1 max-sm:gap-2">
                                  <button onClick={() => startEditContract(contract)} className={btnXsOutline} title="Edit">
                                    <Icon name="edit" className="w-3 h-3" />
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => navigate(`/assets/${id}/contract/${contract.id}`)}
                                    className={`${btnXs} ${isDark ? "bg-[#818cf8]/15 text-[#c7d2fe] hover:bg-[#818cf8]/25" : "bg-[#4f46e5]/[0.08] text-[#4f46e5] hover:bg-[#4f46e5]/[0.14]"}`}
                                  >
                                    <Icon name="page" className="w-3 h-3" />
                                    View PDF
                                  </button>
                                  <button
                                    onClick={() => {
                                      void confirmDialog({ title: `Delete the MSA with ${contract.counterparty}?`, tone: "danger" }).then((ok) => {
                                        if (ok) void deleteContract(contract.id);
                                      });
                                    }}
                                    className={iconBtnDanger}
                                    title="Delete"
                                    aria-label={`Delete the MSA with ${contract.counterparty}`}
                                  >
                                    <Icon name="trash" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ),
                        )}
                        {addingContract && renderContractFormRows(contractForm, setContractForm, addContract, () => setAddingContract(false), true)}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })()}

          {/* Paperwork: each filing this entity should have, in its slot */}
          {tab === "documents" && (
          <section className={`overflow-hidden rounded-2xl ${surface}`}>
            {sectionHeader(
              isTrust ? "Trust documents" : stateCode(asset.state) ? `${stateCode(asset.state)} ${etype === "C-Corp" ? "corporation" : etype}` : "Paperwork",
              "Paperwork",
              undefined,
              <span className={`text-[11px] tabular-nums ${filedCount === scoredKinds.length ? (isDark ? "text-emerald-400" : "text-emerald-600") : textMuted}`}>
                {filedCount}/{scoredKinds.length} on file
              </span>,
            )}
            {(() => {
              const ruleOf = new Map(rules.map((r) => [r.key, r] as const));
              const main = kinds.filter((k) => ruleOf.get(k)?.level !== "recommended");
              const extra = kinds.filter((k) => ruleOf.get(k)?.level === "recommended");
              const order = ["Trust", "Formation", "IRS", "Governance", "Elections", "State"];
              const groups = order
                .map((cat) => ({ cat, keys: main.filter((k) => (ruleOf.get(k)?.category ?? "Formation") === cat) }))
                .filter((g) => g.keys.length);
              const slot = (k: FileKind) => {
                const r = ruleOf.get(k);
                return (
                  <Fragment key={k}>
                    {renderFileSlot(k, filingTitle(k, asset), r?.why ?? "On file.", "application/pdf,image/png,image/jpeg", ["application/pdf", "image/png", "image/jpeg"], r)}
                  </Fragment>
                );
              };
              return (
                <>
                  {groups.map((g) => (
                    <div key={g.cat}>
                      <p className={`border-t px-5 pb-1 pt-3 text-[11px] font-medium first:border-t-0 ${hairline} ${textMuted}`}>{g.cat}</p>
                      <div className={`divide-y ${isDark ? "divide-white/[0.06]" : "divide-gray-100"}`}>{g.keys.map(slot)}</div>
                    </div>
                  ))}
                  {extra.length > 0 && (
                    <div className={`border-t ${hairline}`}>
                      <button
                        type="button"
                        onClick={() => setShowRecommended((v) => !v)}
                        aria-expanded={showRecommended}
                        className={`flex w-full cursor-pointer items-center justify-between px-5 py-3 text-left text-[12px] max-sm:min-h-[44px] ${textMuted}`}
                      >
                        <span>
                          Good to keep · {extra.filter((k) => asset[k]).length}/{extra.length} on file
                        </span>
                        <Icon name="chevronDown" className={`h-3.5 w-3.5 transition-transform ${showRecommended ? "rotate-180" : ""}`} />
                      </button>
                      {showRecommended && <div className={`divide-y border-t ${hairline} ${isDark ? "divide-white/[0.06]" : "divide-gray-100"}`}>{extra.map(slot)}</div>}
                    </div>
                  )}
                </>
              );
            })()}
            <div className={`border-t px-5 py-3 ${hairline}`}>
              <p className={`text-[11px] leading-snug ${textMuted}`}>
                Documents you upload are read and filed here automatically.
                {docs.length > 0 && filedCount < scoredKinds.length && (
                  <>
                    {" "}
                    <button
                      type="button"
                      onClick={() => void scanLibrary()}
                      disabled={sorting > 0 || (!!scan && !scan.finished)}
                      className={`${hitY} cursor-pointer font-medium disabled:cursor-wait disabled:opacity-60 ${accentText}`}
                    >
                      {sorting > 0 || (scan && !scan.finished) ? "Reading documents…" : "Scan existing documents"}
                    </button>
                  </>
                )}
              </p>
            </div>
          </section>
          )}

          {/* Documents */}
          {tab === "documents" && (
          <section className={`overflow-hidden rounded-2xl ${surface}`}>
            {sectionHeader("Library", "Documents", docs.length)}

            <div className="px-5 pt-4">
              {/* Drag-and-drop upload strip */}
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!docDrop.dragOver) setDocDrop((s) => ({ ...s, dragOver: true }));
                }}
                onDragLeave={() => setDocDrop((s) => ({ ...s, dragOver: false }))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDocDrop((s) => ({ ...s, dragOver: false }));
                  handleUploadDocs(Array.from(e.dataTransfer.files ?? []));
                }}
                className={`flex min-h-[60px] cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 py-2.5 transition-colors focus-within:ring-2 ${isDark ? "focus-within:ring-[#818cf8]/50" : "focus-within:ring-[#4f46e5]/40"} ${
                  docDrop.dragOver
                    ? isDark ? "border-[#818cf8]/70 bg-[#818cf8]/[0.08]" : "border-[#4f46e5]/60 bg-indigo-50"
                    : isDark ? "border-white/[0.12] hover:border-white/25 hover:bg-white/[0.02]" : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
                } ${docDrop.uploading ? "opacity-80" : ""}`}
              >
                <input
                  type="file"
                  multiple
                  aria-label="Upload documents"
                  className="sr-only"
                  onChange={(e) => {
                    // Copy before resetting the input — the FileList is live.
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    handleUploadDocs(files);
                  }}
                />
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${docDrop.dragOver || docDrop.uploading ? accentTile : neutralTile}`}>
                  <Icon name="upload" className="w-4 h-4" />
                </div>
                {docDrop.uploading ? (
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-[12px] font-medium">
                        Uploading {docDrop.index} of {docDrop.total} &middot; {docDrop.uploading}
                      </span>
                      <span className={`font-mono text-[10px] tabular-nums ${textMuted}`}>{Math.round(docDrop.progress)}%</span>
                    </div>
                    <div className={`mt-1.5 h-1 overflow-hidden rounded-full ${isDark ? "bg-white/[0.06]" : "bg-gray-100"}`}>
                      <div className={`h-full transition-all ${accentBg}`} style={{ width: `${docDrop.progress}%` }} />
                    </div>
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <p className={`text-[12px] font-medium ${isDark ? "text-gray-200" : "text-gray-800"}`}>
                      {docDrop.dragOver ? "Drop to upload" : <>Drop files or <span className={accentText}>browse</span> — multiple allowed</>}
                    </p>
                    <p className={`mt-0.5 font-mono text-[10px] ${textMuted}`}>PDF, images, Office docs &middot; up to 25 MB each</p>
                  </div>
                )}
              </label>
              {docDrop.error && <p className="mt-2 text-[11px] text-red-400">{docDrop.error}</p>}
              {aiDown && (
                <div className={`mt-2.5 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11.5px] leading-snug ${isDark ? "border-amber-500/30 bg-amber-500/[0.07] text-amber-200" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  <span>
                    {aiDown} Uploads are saved and filed by name only until it's back — then use “Scan existing documents” to read them.
                  </span>
                </div>
              )}
              {(sorting > 0 || filingNotes.length > 0) && (
                <div className={`mt-2.5 rounded-lg border px-3 py-2 ${hairline} ${isDark ? "bg-white/[0.02]" : "bg-gray-50/70"}`}>
                  {sorting > 0 && (
                    <p className={`flex items-center gap-2 text-[11px] ${textMuted}`}>
                      <span className={`h-1.5 w-1.5 motion-safe:animate-pulse rounded-full ${accentBg}`} />
                      Reading {sorting} document{sorting === 1 ? "" : "s"} to file {sorting === 1 ? "it" : "them"}…
                    </p>
                  )}
                  {filingNotes.map((note, i) => (
                    <p key={i} className="flex items-start gap-2 py-0.5 text-[11px] leading-snug">
                      <Icon name={note.startsWith("Filed") ? "check" : "doc"} className={`mt-px h-3 w-3 shrink-0 ${note.startsWith("Filed") ? (isDark ? "text-emerald-400" : "text-emerald-600") : textMuted}`} />
                      <span className={note.startsWith("Filed") ? "" : textMuted}>{note}</span>
                    </p>
                  ))}
                  {sorting === 0 && filingNotes.length > 0 && (
                    <button type="button" onClick={() => setFilingNotes([])} className={`mt-1 cursor-pointer text-[10.5px] max-sm:min-h-[40px] max-sm:pr-3 ${textMuted} hover:underline`}>
                      Dismiss
                    </button>
                  )}
                </div>
              )}

              {/* Optional: add an external URL */}
              <button
                type="button"
                onClick={() => setShowLinkForm((v) => !v)}
                aria-expanded={showLinkForm}
                className={`mt-2.5 inline-flex items-center gap-1.5 max-sm:mt-1 max-sm:min-h-[40px] text-[11px] transition-colors cursor-pointer ${isDark ? "text-gray-500 hover:text-gray-200" : "text-gray-500 hover:text-gray-900"}`}
              >
                <Icon name="link" className="w-3 h-3" />
                {showLinkForm ? "Hide external link" : "Or add an external link instead"}
              </button>
              {showLinkForm && (
                <form onSubmit={handleAddDoc} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
                  <input value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="Document name" required className={fieldInput} />
                  <input value={docUrl} onChange={(e) => setDocUrl(e.target.value)} placeholder="https://…" type="url" required className={fieldInput} />
                  <button type="submit" className={`${btnPrimary} h-9`}>
                    Add
                  </button>
                </form>
              )}
            </div>

            {docs.length === 0 ? (
              <p className={`px-5 pb-5 pt-4 text-[12px] ${textMuted}`}>No documents yet.</p>
            ) : (
              <ul className={`mt-4 divide-y border-t ${hairline} ${isDark ? "divide-white/[0.06]" : "divide-gray-100"}`}>
                {docs.map((doc) => {
                  const kind = docKind(doc);
                  const meta = [
                    doc.storagePath ? formatBytes(doc.size) : "External link",
                    doc.createdAt ? new Date(doc.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "",
                  ].filter(Boolean);
                  return (
                    <li key={doc.id} className={`flex flex-col gap-2 px-5 py-3 transition-colors sm:flex-row sm:items-center sm:gap-3 ${rowHover}`}>
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border font-mono text-[8.5px] font-semibold tracking-[0.04em] ${hairline} ${
                            kind === "PDF" ? accentTile : neutralTile
                          }`}
                        >
                          {kind}
                        </div>
                        <div className="min-w-0">
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`${hitY} block truncate text-[13px] font-medium transition-colors ${isDark ? "text-gray-100 hover:text-[#a5b4fc]" : "text-gray-900 hover:text-[#4f46e5]"}`}
                            title={doc.name}
                          >
                            {doc.name}
                          </a>
                          <p className={`mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[10px] tabular-nums ${textMuted}`}>
                            <span>{meta.join(" · ")}</span>
                            {docFiledAs.has(doc.id) && (
                              <span className={`inline-flex items-center gap-1 ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                                <Icon name="check" className="h-2.5 w-2.5" strokeWidth={2.5} />
                                Filed · {filingTitle(docFiledAs.get(doc.id)!, asset)}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 pl-12 sm:pl-0">
                        <button
                          onClick={() => handleRenameDoc(doc)}
                          disabled={renamingDocId === doc.id}
                          title="Suggest a better name using Claude"
                          className={btnXsOutline}
                        >
                          <Icon name="sparkle" className="w-3 h-3" />
                          {renamingDocId === doc.id ? "Renaming…" : "Rename"}
                        </button>
                        <button
                          onClick={() => handleCopyDocUrl(doc)}
                          className={
                            copiedDocId === doc.id
                              ? `${btnXs} border ${isDark ? "border-green-500/40 bg-green-500/10 text-green-300" : "border-green-400 bg-green-50 text-green-700"}`
                              : btnXsOutline
                          }
                        >
                          <Icon name={copiedDocId === doc.id ? "check" : "copy"} className="w-3 h-3" />
                          {copiedDocId === doc.id ? "Copied" : "Copy URL"}
                        </button>
                        <button onClick={() => handleDeleteDoc(doc.id)} className={iconBtnDanger} title="Delete" aria-label={`Delete ${doc.name}`}>
                          <Icon name="trash" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          )}
        </div>

        {/* Right rail */}
        <aside className={`${tab === "overview" ? "order-first" : ""} min-w-0 space-y-5 lg:order-none ${railHasContent ? "" : "hidden"}`}>
          {/* Completeness */}
          {tab === "overview" && (
          <section className={`overflow-hidden rounded-2xl ${surface}`}>
            <div className="flex items-center gap-4 px-5 py-4">
              <div className="relative h-[72px] w-[72px] shrink-0">
                <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90">
                  <circle cx="36" cy="36" r="31" fill="none" strokeWidth="6" className={isDark ? "stroke-white/[0.07]" : "stroke-gray-100"} />
                  <circle
                    cx="36"
                    cy="36"
                    r="31"
                    fill="none"
                    strokeWidth="6"
                    strokeLinecap="round"
                    stroke={scoreColor}
                    strokeDasharray={`${(score / 100) * 2 * Math.PI * 31} ${2 * Math.PI * 31}`}
                    style={{ transition: "stroke-dasharray 600ms cubic-bezier(0.22,1,0.36,1)", filter: isDark ? `drop-shadow(0 0 6px ${scoreColor}66)` : undefined }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[20px] font-semibold leading-none tabular-nums tracking-[-0.02em]">{score}</span>
                  <span className={`mt-0.5 font-mono text-[8.5px] tracking-[0.12em] ${textMuted}`}>/ 100</span>
                </div>
              </div>
              <div className="min-w-0">
                <p className={kicker}>Completeness</p>
                <p className="mt-1 text-[14px] font-semibold leading-snug">
                  {score === 100 ? "Record complete" : `${missing.length} item${missing.length === 1 ? "" : "s"} to go`}
                </p>
                <p className={`mt-0.5 text-[11px] leading-snug ${textMuted}`}>
                  {score === 100 ? "Every key fact and filing is on record." : "Key facts and formation filings this entity should have on record."}
                </p>
              </div>
            </div>
            <ul className={`border-t px-2 py-1.5 ${hairline}`}>
              {[...missing, ...(showDone || missing.length === 0 ? checklist.filter((i) => i.done) : [])].map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => {
                      if (item.done) return;
                      if (item.filing) goToTab("documents", `filing-${item.key}`, "center");
                      else if (!editing) startEditing();
                      else document.getElementById("entity-edit")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 max-sm:min-h-[40px] text-left text-[12px] transition-colors ${
                      item.done ? "cursor-default" : `cursor-pointer ${isDark ? "hover:bg-white/[0.04]" : "hover:bg-gray-50"}`
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                        item.done
                          ? isDark ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" : "border-emerald-300 bg-emerald-50 text-emerald-600"
                          : isDark ? "border-white/15" : "border-gray-300"
                      }`}
                    >
                      {item.done && <Icon name="check" className="h-2.5 w-2.5" strokeWidth={2.5} />}
                    </span>
                    <span className={`flex-1 truncate ${item.done ? textMuted : ""}`}>{item.label}</span>
                    {!item.done && <span className={`font-mono text-[10px] tabular-nums ${textMuted}`}>+{item.weight}</span>}
                  </button>
                </li>
              ))}
              {missing.length > 0 && missing.length < checklist.length && (
                <li>
                  <button
                    type="button"
                    onClick={() => setShowDone((v) => !v)}
                    className={`w-full cursor-pointer rounded-md px-3 py-1.5 max-sm:min-h-[40px] text-left text-[11px]  transition-colors ${textMuted} ${isDark ? "hover:text-gray-300" : "hover:text-gray-700"}`}
                  >
                    {showDone ? "Hide completed" : `Show ${checklist.length - missing.length} completed`}
                  </button>
                </li>
              )}
            </ul>
          </section>
          )}

          {/* Document check */}
          {tab === "documents" && (() => {
            const v = asset.verification;
            const current = recordValues(asset);
            const findings = (v?.fields ?? []).map((f) => {
              const now = current[f.field] ?? "";
              const resolved = !!f.found && normValue(now) === normValue(f.found);
              return { ...f, now, resolved };
            });
            const actionable = findings.filter((f) => !f.resolved && (f.status === "mismatch" || f.status === "missing_on_record") && f.found);
            const matched = findings.filter((f) => f.status === "match" || f.resolved);
            const changedSince = v?.recordAtCheck
              ? (Object.keys(v.recordAtCheck) as VerifyField[]).some((k) => normValue(v.recordAtCheck![k]) !== normValue(current[k]))
              : false;
            const recordedOwner = asset.ownerId ? assetNames[asset.ownerId] ?? null : null;
            const docOwners = v?.owners ?? [];
            const soleOwner = docOwners.length === 1 ? docOwners[0] : null;
            const soleOwnerId = soleOwner
              ? Object.entries(assetNames).find(([aid, n]) => aid !== id && normEntityName(n) === normEntityName(soleOwner.name))?.[0]
              : undefined;
            const ownerOk = !!recordedOwner && docOwners.some((o) => normEntityName(o.name) === normEntityName(recordedOwner));
            const ownerMismatch = docOwners.length > 0 && !ownerOk;
            const clean = !!v && actionable.length === 0 && !ownerMismatch && !(v.issues ?? []).some((i) => i.severity !== "low");
            return (
              <section className={`overflow-hidden rounded-2xl ${surface}`}>
                <header className={`flex items-start justify-between gap-3 border-b px-5 py-3.5 ${hairline}`}>
                  <div className="min-w-0">
                    <p className={kicker}>Document check</p>
                    <p className="mt-1 text-[14px] font-semibold leading-snug">
                      {verifying ? "Reading documents…" : !v ? "Not verified yet" : clean ? "Record matches documents" : `${actionable.length + (ownerMismatch ? 1 : 0) + (v.issues ?? []).filter((i) => i.severity !== "low").length} to review`}
                    </p>
                    {v && !verifying && (
                      <p className={`mt-0.5 font-mono text-[10px] ${textMuted}`}>
                        {v.documentsRead.length} document{v.documentsRead.length === 1 ? "" : "s"} · {timeAgo(v.checkedAt)}
                        {changedSince && <span className={isDark ? "text-amber-400" : "text-amber-600"}> · record changed since</span>}
                      </p>
                    )}
                  </div>
                  <button type="button" onClick={() => void runVerification()} disabled={verifying} className={`${btnXsOutline} shrink-0 disabled:cursor-wait disabled:opacity-60`}>
                    <Icon name="sparkle" className="w-3 h-3" />
                    {verifying ? "Checking…" : v ? "Re-check" : "Verify"}
                  </button>
                </header>

                {verifying && (
                  <div className="px-5 py-4">
                    <div className={`h-1 overflow-hidden rounded-full ${isDark ? "bg-white/[0.06]" : "bg-gray-100"}`}>
                      <div className={`h-full w-1/3 motion-safe:animate-[verify-scan_1.4s_ease-in-out_infinite] rounded-full ${accentBg}`} />
                    </div>
                    <p className={`mt-2.5 text-[11px] leading-snug ${textMuted}`}>
                      Claude is reading the filings and comparing them with this record — ownership, EIN, dates, addresses. This can take a minute.
                    </p>
                    <style>{`@keyframes verify-scan { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }`}</style>
                  </div>
                )}

                {!verifying && !v && (
                  <p className={`px-5 py-4 text-[11.5px] leading-snug ${textMuted}`}>
                    Reads this entity's documents and checks the record against them: legal name, EIN, state, formation and agreement dates, address, registered agent, tax classification and who owns it.
                  </p>
                )}
                {verifyError && <p className="px-5 pb-3 pt-2 text-[11px] text-red-400">{verifyError}</p>}

                {!verifying && v && (
                  <div className="space-y-3 px-5 py-4">
                    {v.summary && <p className={`text-[12px] leading-relaxed ${textSoft}`}>{v.summary}</p>}

                    {/* Ownership */}
                    <div className={`rounded-lg border px-3 py-2.5 ${hairline} ${ownerMismatch ? (isDark ? "border-amber-500/30 bg-amber-500/[0.06]" : "border-amber-200 bg-amber-50/70") : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className={kicker}>Ownership</p>
                        <span className={`text-[11px]  ${ownerOk ? (isDark ? "text-emerald-400" : "text-emerald-600") : ownerMismatch ? (isDark ? "text-amber-400" : "text-amber-600") : textMuted}`}>
                          {ownerOk ? "Matches" : ownerMismatch ? "Differs" : "Not stated"}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[12px]">
                        <span className={textMuted}>Record: </span>
                        {recordedOwner ?? "No owner set"}
                      </p>
                      {docOwners.length > 0 && (
                        <p className="mt-0.5 text-[12px]">
                          <span className={textMuted}>Documents: </span>
                          {docOwners.map((o) => `${o.name}${o.percent != null ? ` (${o.percent}%)` : ""}`).join(", ")}
                        </p>
                      )}
                      {ownerMismatch && soleOwnerId && (
                        <button type="button" onClick={() => void applyOwner(soleOwnerId)} className={`mt-2 ${btnXsOutline}`}>
                          Set owner to {assetNames[soleOwnerId]}
                        </button>
                      )}
                    </div>

                    {/* Fields that need a decision */}
                    {actionable.map((f) => (
                      <div key={f.field} className={`rounded-lg border px-3 py-2.5 ${hairline}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[12px] font-medium">{VERIFY_LABEL[f.field]}</p>
                          <span className={`text-[11px]  ${f.status === "mismatch" ? (isDark ? "text-amber-400" : "text-amber-600") : accentText}`}>
                            {f.status === "mismatch" ? "Differs" : "Not on record"}
                          </span>
                        </div>
                        {f.status === "mismatch" && (
                          <p className="mt-1 break-words text-[11.5px]">
                            <span className={textMuted}>Record: </span>
                            {f.field.endsWith("Date") ? fmtDate(f.now) || f.now : f.now}
                          </p>
                        )}
                        <p className="mt-0.5 break-words text-[11.5px]">
                          <span className={textMuted}>Documents: </span>
                          {f.field.endsWith("Date") ? fmtDate(f.found ?? "") || f.found : f.found}
                        </p>
                        {(f.source || f.note) && (
                          <p className={`mt-1 text-[10.5px] leading-snug ${textMuted}`}>{[f.source, f.note].filter(Boolean).join(" — ")}</p>
                        )}
                        <button type="button" onClick={() => void applyFinding(f.field, f.found!)} className={`mt-2 ${btnXsOutline}`}>
                          <Icon name="check" className="w-3 h-3" />
                          Use document value
                        </button>
                      </div>
                    ))}

                    {/* Other issues */}
                    {(v.issues ?? []).length > 0 && (
                      <ul className="space-y-1.5">
                        {v.issues.map((i, n) => (
                          <li key={n} className="flex items-start gap-2 text-[11.5px] leading-snug">
                            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${i.severity === "high" ? "bg-red-500" : i.severity === "medium" ? "bg-amber-500" : isDark ? "bg-white/30" : "bg-gray-300"}`} />
                            <span>{i.message}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* What already matches */}
                    {matched.length > 0 && (
                      <div>
                        <button
                          type="button"
                          onClick={() => setShowMatches((x) => !x)}
                          className={`inline-flex cursor-pointer items-center gap-1.5 max-sm:min-h-[40px] text-[11px]  ${isDark ? "text-emerald-400" : "text-emerald-600"}`}
                        >
                          <Icon name="check" className="h-3 w-3" strokeWidth={2.5} />
                          {matched.length} field{matched.length === 1 ? "" : "s"} confirmed
                        </button>
                        {showMatches && (
                          <ul className="mt-1.5 space-y-0.5">
                            {matched.map((f) => (
                              <li key={f.field} className={`flex justify-between gap-3 text-[11px] ${textMuted}`}>
                                <span>{VERIFY_LABEL[f.field]}</span>
                                <span className="truncate text-right">{f.source}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })()}

          {/* Deadlines: what this entity files, and when next */}
          {tab === "compliance" && deadlines.length > 0 && (
            <section className={`overflow-hidden rounded-2xl ${surface}`}>
              {sectionHeader("Compliance", "Deadlines")}
              <ul className={`divide-y ${isDark ? "divide-white/[0.06]" : "divide-gray-100"}`}>
                {deadlines.map((d) => {
                  const days = d.due ? Math.round((Date.parse(d.due) - Date.parse(new Date().toISOString().slice(0, 10))) / 86400000) : null;
                  const soon = days != null && days <= 45;
                  return (
                    <li key={d.key} className="px-5 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-medium leading-snug">{d.title}</p>
                          <p className={`mt-0.5 text-[11px] leading-snug ${textMuted}`}>
                            {d.agency} · {d.rule}
                            {d.fee ? ` · ${d.fee}` : ""}
                          </p>
                          {d.note && <p className={`mt-1 text-[11px] leading-snug ${textMuted}`}>{d.note}</p>}
                          {d.url && (
                            <a href={d.url} target="_blank" rel="noopener noreferrer" className={`${hitY} mt-1 inline-flex items-center gap-1 text-[11px] font-medium hover:underline ${accentText}`}>
                              {d.urlLabel ?? "File online"}
                              <Icon name="external" className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                        {d.due ? (
                          <div className="shrink-0 text-right">
                            <p className={`text-[12.5px] font-medium tabular-nums ${soon ? (isDark ? "text-amber-300" : "text-amber-700") : ""}`}>{fmtDate(d.due)}</p>
                            <p className={`text-[11px] tabular-nums ${soon ? (isDark ? "text-amber-300/80" : "text-amber-700") : textMuted}`}>
                              {days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className={`border-t px-5 py-2.5 text-[11px] leading-snug ${hairline} ${textMuted}`}>
                {isTrust ? "Beneficial-ownership (BOI) reporting doesn't apply to trusts." : BOI_NOTE} Dates assume a calendar tax year.
              </p>
            </section>
          )}

          {/* Paperwork checks: where the records disagree with each other or the rules */}
          {tab === "compliance" && (issues.length > 0 || docOwners.length > 0) && (
            <section className={`overflow-hidden rounded-2xl ${surface}`}>
              {sectionHeader("Compliance", "Checks", issues.filter((i) => i.severity !== "info").length || undefined)}
              {docOwners.length > 0 && (
                <div className={`border-b px-5 py-3 ${hairline}`}>
                  <p className={kicker}>Owners per {asset.membersSource ?? "its documents"}</p>
                  <ul className="mt-1.5 space-y-0.5 text-[12px]">
                    {docOwners.map((m, i) => (
                      <li key={i} className="flex justify-between gap-3">
                        <span className="truncate">{m.name}</span>
                        <span className={`shrink-0 tabular-nums ${textMuted}`}>{m.percent != null ? `${m.percent}%` : m.role ?? ""}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <ul className={`divide-y ${isDark ? "divide-white/[0.06]" : "divide-gray-100"}`}>
                {issues.map((i) => {
                  const tone =
                    i.severity === "high"
                      ? isDark ? "bg-red-400" : "bg-red-500"
                      : i.severity === "medium"
                        ? "bg-amber-500"
                        : i.severity === "low"
                          ? isDark ? "bg-gray-400" : "bg-gray-400"
                          : isDark ? "bg-emerald-400" : "bg-emerald-500";
                  return (
                    <li key={i.key} className="flex gap-3 px-5 py-3">
                      <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} aria-hidden />
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-medium leading-snug">{i.title}</p>
                        <p className={`mt-0.5 text-[11px] leading-snug ${textMuted}`}>{i.detail}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {tab === "compliance" && isTrust && deadlines.length === 0 && issues.length === 0 && docOwners.length === 0 && (
            <section className={`rounded-2xl px-5 py-4 text-[12.5px] ${surface} ${textMuted}`}>Nothing due and nothing to fix for this trust.</section>
          )}
        </aside>
      </div>

      {/* Live progress while documents are being read */}
      {(scan || sorting > 0) && (() => {
        const total = scan?.total ?? 0;
        const done = scan?.done ?? 0;
        const finished = !!scan?.finished && sorting === 0;
        const pct = scan && total ? (done / total) * 100 : null;
        const filed = (scan?.notes ?? []).filter((n) => n.startsWith("Filed") || n.startsWith("Read"));
        return (
          <div
            role="status"
            aria-live="polite"
            className="fixed inset-x-0 z-50 flex justify-center px-4 pointer-events-none bottom-[calc(1rem+env(safe-area-inset-bottom))] lg:bottom-6"
          >
            <div
              className={`pointer-events-auto w-full max-w-[440px] overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-xl motion-safe:animate-[scan-toast-in_320ms_cubic-bezier(0.16,1,0.3,1)_both] ${
                isDark ? "border-white/10 bg-[#0d0f17]/95 shadow-black/60" : "border-gray-200 bg-white/95 shadow-gray-900/15"
              }`}
            >
              <style>{`@keyframes scan-toast-in { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: none; } }`}</style>
              <div className="flex items-start gap-3 px-4 pt-3.5">
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                    finished ? (isDark ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-50 text-emerald-600") : accentTile
                  }`}
                >
                  {finished ? <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.5} /> : <Icon name="sparkle" className="h-3.5 w-3.5 motion-safe:animate-pulse" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold leading-tight">
                    {finished
                      ? filed.length
                        ? `Done — ${filed.length} update${filed.length === 1 ? "" : "s"}`
                        : aiDown
                          ? "Paused — nothing filed"
                          : "Done — nothing new found"
                      : scan
                        ? `Reading documents · ${Math.min(done + 1, total)} of ${total}`
                        : `Reading ${sorting} document${sorting === 1 ? "" : "s"}…`}
                  </p>
                  <p className={`mt-0.5 truncate text-[11.5px] ${textMuted}`}>
                    {aiDown
                      ? "Paused — the document reader is unavailable."
                      : finished
                        ? `${total} document${total === 1 ? "" : "s"} checked`
                        : scan?.current
                          ? scan.current
                          : "Working out what each file is…"}
                  </p>
                </div>
                {finished && (
                  <button
                    type="button"
                    onClick={() => setScan(null)}
                    aria-label="Dismiss"
                    className={`-mr-1 grid h-6 w-6 max-sm:-my-2 max-sm:-mr-2.5 max-sm:h-[40px] max-sm:w-[40px] place-items-center rounded-md transition-colors cursor-pointer ${isDark ? "text-gray-500 hover:bg-white/10 hover:text-white" : "text-gray-400 hover:bg-gray-100 hover:text-gray-900"}`}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
              <div className="px-4 pb-3.5 pt-3">
                <div className={`h-1 overflow-hidden rounded-full ${isDark ? "bg-white/[0.07]" : "bg-gray-100"}`}>
                  {pct == null || (!finished && pct === 0) ? (
                    <div className={`h-full w-1/3 rounded-full ${accentBg} motion-safe:animate-[verify-scan_1.4s_ease-in-out_infinite]`} />
                  ) : (
                    <div
                      className={`h-full rounded-full transition-[width] duration-500 ${finished ? "bg-emerald-500" : accentBg}`}
                      style={{ width: `${finished ? 100 : Math.max(6, pct)}%` }}
                    />
                  )}
                </div>
                <style>{`@keyframes verify-scan { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }`}</style>
                {(scan?.notes.length ?? 0) > 0 && (
                  <ul className="mt-2.5 max-h-36 space-y-1 overflow-y-auto">
                    {scan!.notes.map((n, i) => (
                      <li key={i} className="flex items-start gap-2 text-[11.5px] leading-snug">
                        <Icon
                          name={n.startsWith("Filed") || n.startsWith("Read") ? "check" : "doc"}
                          className={`mt-px h-3 w-3 shrink-0 ${n.startsWith("Filed") || n.startsWith("Read") ? (isDark ? "text-emerald-400" : "text-emerald-600") : textMuted}`}
                        />
                        <span className={n.startsWith("Filed") || n.startsWith("Read") ? "" : textMuted}>{n}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
