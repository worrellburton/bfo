/**
 * The entity page's data model: record types, constants and pure helpers.
 * No React, no styling — shared by the page's logic (use-entity) and its views.
 */

import { entityType } from "../entity-completeness";
import { DOC_KEYS, documentRules, type DocKey, type DocRule, type PaperworkInput } from "../entity-paperwork";
import type { ForeignRegistration } from "../entity-addresses";
import type { Closing } from "../entity-closing";
import type { PalmLink, PalmMode, StateRecord } from "../palm";
import type { EinCheck } from "../../lib/palm-monitor";
import type { PalmFilingDue } from "../../lib/palm-webhook";

export interface Asset {
  name: string;
  type: "LLC" | "C-Corp" | "LP" | "Trust";
  state: string;
  ein: string;
  createdAt: number;
  registeredAgent?: string;
  /** The principal office: where the business is, as the state lists it. */
  address?: string;
  /** Where its mail goes, when not the principal office. */
  mailingAddress?: string;
  /** The home state's registered agent's street address. */
  registeredAgentAddress?: string;
  /** Each state it's registered in as a foreign entity, by two-letter code. */
  foreign?: Record<string, ForeignRegistration>;
  /** Being closed down (app/entity-closing.ts): when it started, each step's date, when it was marked dissolved. */
  closing?: Closing | null;
  /** States whose registry had no entry (or several) for it, from the state-record check. */
  registryMiss?: Record<string, { outcome: "not_found" | "ambiguous"; at: number }>;
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
  /** Filings Palm Monitor says are due or overdue, by state and kind (api/palm-webhook.ts). */
  palmFilings?: Record<string, PalmFilingDue>;
  /** The latest change Palm Monitor saw on each state's record. */
  palmMonitor?: Record<string, { lastChange?: { at: number; mode: PalmMode; changes: { attribute: string | null; action: string | null; summary: string | null; from: string | null; to: string | null }[] } }>;
  /** What the IRS said about the EIN, through Palm. */
  einCheck?: EinCheck;
  operatingAgreementDate?: string;
  /** The address before the last change, and when it changed (YYYY-MM-DD). */
  previousAddress?: string;
  addressChangedAt?: string;
  /** Where the change has been reported, by date (YYYY-MM-DD): the state, the IRS, banks. */
  addressUpdates?: { state?: string | null; irs?: string | null; banks?: string | null };
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

/** An owner or manager. `address` is theirs (Exhibit A of the operating agreement lists it). */
export type Member = { name: string; percent: number | null; role: string | null; address?: string | null };

export type EntityProfile = {
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

export type VerifyField =
  | "name" | "type" | "state" | "ein" | "formationDate" | "address"
  | "registeredAgent" | "llcType" | "operatingAgreementDate" | "articlesOfOrgDate"
  | "trustees" | "grantors" | "beneficiaries";

export interface Verification {
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

export const VERIFY_LABEL: Record<VerifyField, string> = {
  name: "Legal name",
  type: "Entity type",
  state: "State of formation",
  ein: "EIN",
  formationDate: "Formation date",
  address: "Principal office",
  registeredAgent: "Registered agent",
  llcType: "Tax classification",
  operatingAgreementDate: "Operating agreement date",
  articlesOfOrgDate: "Articles filing date",
  trustees: "Trustees",
  grantors: "Grantors",
  beneficiaries: "Beneficiaries",
};

export interface UploadedFile {
  url: string;
  fileName: string;
  size: number;
  contentType: string;
  uploadedAt: number;
  storagePath: string; // "" when the slot points at a Documents entry
  docId?: string; // set when filed from the Documents library (no separate copy)
}

export interface CorpData {
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

export interface AssetDoc {
  id: string;
  name: string;
  url: string;
  createdAt: number;
  storagePath?: string;
  storageProvider?: "supabase";
  size?: number;
  contentType?: string;
  factsCheckedAt?: number; // key facts already read from this document
  classReadAt?: number; // tax classification already read from this document
  autoFileSkip?: boolean; // removed from a filing slot by hand — don't auto-file again
}

export interface OperatingContract {
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

export const MSA_SERVICES = [
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

export const LEDGER_LOUISE_SUBS = [
  "Swisshelm Mountain Ventures, LLC",
  "Sundown Investments, LLC",
  "Ledger Burton, LLC",
  "Worrell Burton, LLC",
];

// Older contracts stored two separate AI services that are now one line.
export const SERVICE_ALIASES: Record<string, string> = {
  "AI & Technology Management": "AI, Automation & Technology Management",
  "AI Agent & Automation Development": "AI, Automation & Technology Management",
};
export function normalizeServices(list: string[]): string[] {
  const out: string[] = [];
  for (const s of list) {
    const mapped = SERVICE_ALIASES[s] || s;
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out;
}

// Outline icon paths (heroicons v1 geometry) used across the page.

// "2025-01-01" -> "Jan 1, 2025" (parsed as a local date so it never shifts a day).
// Anything that isn't a plain ISO date is shown as typed.
export function fmtDate(value?: string): string {
  if (!value) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export type EntityTab = "overview" | "documents" | "people" | "compliance" | "agreements" | "governance" | "activity";

// A moment as a local calendar date ("Oct 7, 2026") — not the UTC day.
export function fmtStamp(ms?: number): string {
  return ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
}

// Short file-kind label for the document list tile.
export function docKind(doc: { contentType?: string; storagePath?: string }): string {
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
export function normValue(v: string | null | undefined): string {
  return (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
export function normEntityName(v: string | null | undefined): string {
  return (v ?? "")
    .toLowerCase()
    .replace(/\(\d+%\)/g, "")
    .replace(/[,.]/g, " ")
    .replace(/\b(llc|l l c|inc|incorporated|corp|corporation|lp|ltd|limited partnership|limited liability company)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function timeAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

// ── Formation filings ────────────────────────────────────────────────────
export type FileKind = DocKey;
/** Every slot an entity can have — for lookups that don't care about type. */
export const FILING_KINDS: FileKind[] = DOC_KEYS;

export const FALLBACK_TITLE: Record<FileKind, string> = {
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
export function ruleFor(kind: FileKind, a?: PaperworkInput | null): DocRule | undefined {
  return a ? documentRules(a).find((r) => r.key === kind) : undefined;
}

export function filingTitle(kind: FileKind, a?: PaperworkInput | null): string {
  return ruleFor(kind, a)?.title ?? FALLBACK_TITLE[kind];
}

/** A confident guess from the document's name alone. */
export function guessFiling(name: string): FileKind | null {
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

export const CLASSIFIER_KIND: Record<string, FileKind | undefined> = {
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

export type Classified = {
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
export const TAX_CLASS_KINDS: ReadonlySet<string> = new Set(["einLetter", "w9", "operatingAgreement"]);

/** A tax class source written by a person rather than read off a document. */
export const BY_HAND = "Entered by hand";

/**
 * The tree drops empty arrays (and objects) on write, so a stored profile with
 * no properties or issues comes back without those keys. Restore them on read.
 */
export function fromDatabase(raw: Asset): Asset {
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
  if (a.stateRecord) a.stateRecord = { ...a.stateRecord, managers: list(a.stateRecord.managers), people: list(a.stateRecord.people) };
  if (a.members) a.members = list(a.members);
  if (a.verification) {
    const v = a.verification;
    a.verification = { ...v, fields: list(v.fields), owners: list(v.owners), issues: list(v.issues), documentsRead: list(v.documentsRead) };
  }
  return a;
}

/** An EIN as typed, tidied: nine digits become NN-NNNNNNN; anything else is left for the form to flag. */
export function tidyEin(raw?: string | null): string {
  const s = (raw ?? "").trim();
  const digits = s.replace(/\D/g, "");
  return digits.length === 9 && /^[\d\s-]+$/.test(s) ? `${digits.slice(0, 2)}-${digits.slice(2)}` : s;
}

export const einLooksRight = (s?: string | null) => !s?.trim() || /^\d{2}-\d{7}$/.test(tidyEin(s));

/** "Robert L. Burton, Claire B. Burton and Jane Doe" → each name. */
export function splitNames(s?: string | null): string[] {
  return (s ?? "")
    .split(/\s*(?:,|;|\n|\band\b|&)\s*/i)
    .map((n) => n.trim())
    .filter(Boolean);
}
