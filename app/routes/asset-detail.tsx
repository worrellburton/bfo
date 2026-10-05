import { Fragment, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTheme } from "../theme";
import { authFetch } from "../auth";

export function meta() {
  return [{ title: "BFO - Asset" }];
}

interface Asset {
  name: string;
  type: "LLC" | "C-Corp";
  state: string;
  ein: string;
  createdAt: number;
  registeredAgent?: string;
  address?: string;
  formationDate?: string;
  status?: string;
  notes?: string;
  ownerId?: string;
  llcType?: "Disregarded Entity" | "Partnership" | "C Corporation" | "";
  stateLink?: string;
  operatingAgreementDate?: string;
  articlesOfOrgDate?: string;
  w9?: UploadedFile;
  articles?: UploadedFile;
  einLetter?: UploadedFile;
  operatingAgreement?: UploadedFile;
}

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

// ── Formation filings ────────────────────────────────────────────────────
type FileKind = "einLetter" | "w9" | "articles" | "operatingAgreement";
const FILING_KINDS: FileKind[] = ["einLetter", "w9", "articles", "operatingAgreement"];

function filingTitle(kind: FileKind, type?: Asset["type"]): string {
  const corp = type === "C-Corp";
  if (kind === "einLetter") return "EIN Letter";
  if (kind === "w9") return "Form W-9";
  if (kind === "articles") return corp ? "Certificate of Incorporation" : "Articles of Organization";
  return corp ? "Bylaws" : "Operating Agreement";
}

function filingDescription(kind: FileKind): string {
  if (kind === "einLetter") return "IRS EIN assignment — CP 575 or 147C.";
  if (kind === "w9") return "Request for Taxpayer Identification Number.";
  if (kind === "articles") return "State formation filing — articles or certificate.";
  return "Governing agreement among the owners.";
}

/** A confident guess from the document's name alone. */
function guessFiling(name: string): FileKind | null {
  const n = name.toLowerCase();
  if (/\bw[\s-]?9\b/.test(n)) return "w9";
  if (/\bein\b|\bcp[\s-]?575\b|\b147[\s-]?c\b|\bss[\s-]?4\b|employer identification/.test(n)) return "einLetter";
  if (/operating agreement|\bllc agreement\b|\bbylaws?\b/.test(n)) return "operatingAgreement";
  if (/articles? of (organization|incorporation|formation)|certificate of (formation|incorporation|organization)|\barticles\b/.test(n)) return "articles";
  return null;
}

const CLASSIFIER_KIND: Record<string, FileKind | undefined> = {
  ein_letter: "einLetter",
  w9: "w9",
  articles: "articles",
  operating_agreement: "operatingAgreement",
};

type Classified = { kind: string; confidence: "high" | "medium" | "low"; ein: string | null; date: string | null; state: string | null };

/** Everything an entity record needs, weighted to 100. */
function completeness(asset: Asset) {
  const corp = asset.type === "C-Corp";
  const items: { key: string; label: string; weight: number; done: boolean; filing?: FileKind }[] = [
    { key: "ein", label: "EIN", weight: 12, done: !!asset.ein?.trim() },
    { key: "state", label: "State of formation", weight: 6, done: !!asset.state?.trim() },
    { key: "formationDate", label: "Formation date", weight: 6, done: !!asset.formationDate },
    { key: "address", label: "Principal address", weight: 6, done: !!asset.address?.trim() },
    { key: "registeredAgent", label: "Registered agent", weight: 6, done: !!asset.registeredAgent?.trim() },
    ...(corp ? [] : [{ key: "llcType", label: "Tax classification", weight: 6, done: !!asset.llcType }]),
    ...FILING_KINDS.map((k) => ({
      key: k,
      label: filingTitle(k, asset.type),
      weight: k === "articles" ? 18 : k === "operatingAgreement" ? 16 : k === "einLetter" ? 14 : 10,
      done: !!asset[k],
      filing: k,
    })),
  ];
  const total = items.reduce((s, i) => s + i.weight, 0);
  const got = items.reduce((s, i) => s + (i.done ? i.weight : 0), 0);
  return { score: Math.round((got / total) * 100), items };
}

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
    `relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors cursor-pointer ${on ? (isDark ? "bg-[#818cf8]" : "bg-[#4f46e5]") : isDark ? "bg-white/15" : "bg-gray-300"}`;
  const knob = (on: boolean) =>
    `inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${on ? "translate-x-3.5" : "translate-x-0.5"}`;
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] mb-2 text-gray-500">Services Included</p>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 text-xs h-7 px-3 rounded-lg border cursor-pointer transition-colors ${isDark ? "bg-white/[0.03] border-white/[0.12] text-gray-200 hover:bg-white/[0.06]" : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"}`}
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

export default function AssetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const inputCls = `${isDark ? "bg-white/[0.03] border-white/10 text-white focus:border-[#818cf8]/60" : "bg-white border-gray-200 text-gray-900 focus:border-[#4f46e5]/50"} border rounded-lg placeholder-gray-500 focus:outline-none transition-colors`;
  const cardCls = `${isDark ? "bg-white/[0.02] border-white/[0.08]" : "bg-white border-gray-200"} border rounded-lg`;

  // Design tokens: hairline surfaces, mono kickers, indigo accent used sparingly.
  const surface = isDark
    ? "border border-white/[0.08] bg-white/[0.02]"
    : "border border-gray-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_1px_3px_rgba(16,24,40,0.03)]";
  const hairline = isDark ? "border-white/[0.08]" : "border-gray-200";
  const divider = isDark ? "border-white/[0.06]" : "border-gray-100";
  const kicker = "font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500";
  const textMuted = "text-gray-500";
  const textSoft = isDark ? "text-gray-400" : "text-gray-600";
  const accentText = isDark ? "text-[#a5b4fc]" : "text-[#4f46e5]";
  const accentBg = isDark ? "bg-[#818cf8]" : "bg-[#4f46e5]";
  const accentTile = isDark ? "bg-[#818cf8]/10 text-[#a5b4fc]" : "bg-[#4f46e5]/[0.07] text-[#4f46e5]";
  const neutralTile = isDark ? "bg-white/[0.04] text-gray-400" : "bg-gray-100 text-gray-500";
  const rowBorder = isDark ? "border-white/[0.06]" : "border-gray-100";
  const rowHover = isDark ? "hover:bg-white/[0.025]" : "hover:bg-gray-50/80";
  const btnBase = "inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium whitespace-nowrap transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
  const btnPrimary = `${btnBase} ${isDark ? "bg-white text-gray-950 hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-gray-700"}`;
  const btnOutline = `${btnBase} border ${isDark ? "border-white/[0.12] text-gray-200 hover:bg-white/[0.06]" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`;
  const btnGhostDanger = `${btnBase} ${isDark ? "text-red-400/90 hover:bg-red-500/10" : "text-red-600 hover:bg-red-50"}`;
  const btnXs = "inline-flex items-center justify-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer disabled:opacity-40";
  const btnXsPrimary = `${btnXs} ${isDark ? "bg-white text-gray-950 hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-gray-700"}`;
  const btnXsOutline = `${btnXs} border ${isDark ? "border-white/[0.1] text-gray-300 hover:bg-white/[0.06]" : "border-gray-200 text-gray-700 hover:bg-gray-50"}`;
  const btnXsGhost = `${btnXs} ${isDark ? "text-gray-400 hover:text-white hover:bg-white/[0.06]" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"}`;
  const iconBtn = `inline-flex items-center justify-center h-7 w-7 rounded-md transition-colors cursor-pointer disabled:opacity-40 ${isDark ? "text-gray-400 hover:text-white hover:bg-white/[0.06]" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"}`;
  const iconBtnDanger = `inline-flex items-center justify-center h-7 w-7 rounded-md transition-colors cursor-pointer disabled:opacity-40 ${isDark ? "text-gray-500 hover:text-red-400 hover:bg-red-500/10" : "text-gray-400 hover:text-red-600 hover:bg-red-50"}`;
  const switchOn = accentBg;
  const switchOff = isDark ? "bg-white/15" : "bg-gray-300";
  const [asset, setAsset] = useState<Asset | null>(null);
  const [docs, setDocs] = useState<AssetDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Asset>>({});

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
  const [uploadState, setUploadState] = useState<Record<FileKind, { uploading: boolean; progress: number; error: string | null; dragOver: boolean }>>({
    einLetter: { uploading: false, progress: 0, error: null, dragOver: false },
    w9: { uploading: false, progress: 0, error: null, dragOver: false },
    articles: { uploading: false, progress: 0, error: null, dragOver: false },
    operatingAgreement: { uploading: false, progress: 0, error: null, dragOver: false },
  });
  // Auto-filing: notes about where uploads went, and how many are being read.
  const [filingNotes, setFilingNotes] = useState<string[]>([]);
  const [sorting, setSorting] = useState(0);
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
  const [copiedEin, setCopiedEin] = useState(false);
  const [showDone, setShowDone] = useState(false);

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
        if (data) {
          setAsset(data as Asset);
          setForm(data as Asset);
        }
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

  async function handleSave() {
    const { db } = await import("../firebase");
    const { ref, update } = await import("firebase/database");
    await update(ref(db, `assets/${id}`), {
      name: form.name,
      type: form.type,
      state: form.state,
      ein: form.ein,
      registeredAgent: form.registeredAgent || "",
      address: form.address || "",
      formationDate: form.formationDate || "",
      status: form.status || "Active",
      notes: form.notes || "",
      llcType: form.llcType || "",
      stateLink: form.stateLink || "",
      operatingAgreementDate: form.operatingAgreementDate || "",
      articlesOfOrgDate: form.articlesOfOrgDate || "",
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
    if (!confirm(`Delete “${doc?.name ?? "this document"}”?${filedAs.length ? ` It is filed as ${filedAs.map((k) => filingTitle(k, asset?.type)).join(", ")} — that slot will be emptied.` : ""}`)) return;
    if (filedAs.length) {
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, update } = await import("firebase/database");
      await update(ref(db, `assets/${id}`), Object.fromEntries(filedAs.map((k) => [k, null])));
    }
    if (doc?.storagePath) {
      if (doc.storageProvider === "supabase") {
        try {
          await authFetch("/api/documents/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: doc.storagePath }),
          });
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
    const { ref, remove } = await import("firebase/database");
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
    if (facts) {
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
        }
      } catch {
        // fall back to the name
      } finally {
        setSorting((n) => n - 1);
      }
    }
    if (!kind) return null;
    const title = filingTitle(kind, assetRef.current?.type);
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
    for (const kind of FILING_KINDS) {
      if (asset[kind] || autoFiledOnLoad.current.has(kind)) continue;
      const doc = docs.find((d) => !d.autoFileSkip && !linked.has(d.id) && guessFiling(d.name) === kind);
      if (!doc) continue;
      autoFiledOnLoad.current.add(kind);
      linked.add(doc.id);
      void fileDocument(kind, doc).catch((err) => console.error("auto-file failed", err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, docs]);

  /** Ask Claude to read every unfiled PDF/image in the library and file what fits. */
  async function scanLibrary() {
    const current = assetRef.current;
    if (!current) return;
    const linked = new Set(FILING_KINDS.map((k) => current[k]?.docId).filter(Boolean));
    const candidates = docs.filter((d) => !linked.has(d.id) && !d.autoFileSkip && d.storagePath);
    const notes: string[] = [];
    for (const doc of candidates) {
      if (FILING_KINDS.every((k) => assetRef.current?.[k])) break;
      const note = await autoFile(doc);
      if (note) notes.push(note);
    }
    setFilingNotes(notes.length ? notes : ["Nothing new to file — no unfiled document matched an empty slot."]);
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
        alert(`Rename failed: ${data?.error || res.statusText}`);
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
      alert(`Rename failed: ${err instanceof Error ? err.message : "unknown"}`);
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
    const label = filingTitle(kind, asset?.type);
    // Filed from Documents: just unfile it — the document stays in the library.
    if (file.docId) {
      if (!confirm(`Unfile “${file.fileName}” from ${label}? It stays in Documents.`)) return;
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref: dbRef, update } = await import("firebase/database");
      await update(dbRef(db, `assets/${id}`), { [kind]: null });
      await update(dbRef(db, `assets/${id}/documents/${file.docId}`), { autoFileSkip: true });
      return;
    }
    if (!confirm(`Remove the uploaded ${label}?`)) return;
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

  async function handleDeleteAsset() {
    if (!confirm("Delete this entity? This cannot be undone.")) return;
    const { db } = await import("../firebase");
    const { ref, remove } = await import("firebase/database");
    await remove(ref(db, `assets/${id}`));
    window.location.href = "/bfo/assets";
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
      <Link to="/assets" className={`inline-flex items-center gap-1 transition-colors ${isDark ? "hover:text-white" : "hover:text-gray-900"}`}>
        <Icon name="chevronLeft" className="w-3 h-3" strokeWidth={2.25} />
        Assets
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
            <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${accentBg}`} />
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

  async function handleCopyEin() {
    if (!asset?.ein) return;
    try {
      await navigator.clipboard.writeText(asset.ein);
      setCopiedEin(true);
      setTimeout(() => setCopiedEin(false), 1500);
    } catch {
      // clipboard unavailable — nothing to do
    }
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

  function renderFileSlot(kind: FileKind, title: string, description: string, accept: string, accepted: string[]) {
    const file = asset?.[kind];
    const slot = uploadState[kind];
    const typesLabel = accepted.map((t) => t.split("/")[1].toUpperCase()).join(", ");
    const picker = (
      <input type="file" accept={accept} className="hidden" disabled={slot.uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadFile(kind, f); e.target.value = ""; }} />
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
                className={`mt-0.5 block truncate font-mono text-[10px] hover:underline ${textMuted}`}
                title={file.fileName}
              >
                {file.fileName}
              </a>
            </div>
            <div className="flex shrink-0 items-center">
              <a href={file.url} target="_blank" rel="noopener noreferrer" className={iconBtn} title="View" aria-label={`View ${title}`}>
                <Icon name="external" />
              </a>
              <label className={`${iconBtn} ${slot.uploading ? "opacity-40 pointer-events-none" : ""}`} title="Replace" aria-label={`Replace ${title}`}>
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
            <p className={`mt-0.5 text-[11px] ${textMuted}`}>{description}</p>
          </div>
          <span className={`inline-flex shrink-0 items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em] ${isDark ? "text-amber-400/90" : "text-amber-600"}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Missing
          </span>
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
              className={`flex h-[56px] cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 transition-colors ${
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

  function renderTermToggle(term: string, onChange: (next: string) => void) {
    const isAuto = term.toLowerCase().includes("auto-renew");
    return (
      <div className="flex min-w-[200px] items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={isAuto}
          onClick={() => onChange(isAuto ? "Annual, fixed term" : "Annual, auto-renewing")}
          className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors cursor-pointer ${isAuto ? switchOn : switchOff}`}
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
          className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${on ? switchOn : switchOff}`}
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
    const cellInputCls = `w-full h-7 px-2 text-xs ${inputCls}`;
    const editBg = isDark ? "bg-[#818cf8]/[0.04]" : "bg-indigo-50/40";
    return (
      <>
        <tr className={`${isNew ? `border-t ${rowBorder}` : ""} ${editBg}`}>
          <td className="px-4 py-2">
            <input
              value={f.counterparty}
              onChange={(e) => setF({ ...f, counterparty: e.target.value })}
              placeholder={isNew ? "Counterparty (e.g. Acme Holdings, LLC)" : undefined}
              autoFocus
              className={cellInputCls}
            />
          </td>
          <td className="px-4 py-2">
            <input value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} placeholder={isNew ? "$500" : undefined} className={`${cellInputCls} min-w-[72px]`} />
          </td>
          <td className="px-4 py-2">
            <select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })} className={`${cellInputCls} min-w-[96px]`}>
              <option value="Monthly">Monthly</option>
              <option value="Quarterly">Quarterly</option>
              <option value="Annually">Annually</option>
              <option value="One-time">One-time</option>
            </select>
          </td>
          <td className="px-4 py-2">
            <input type="date" value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} className={`${cellInputCls} min-w-[124px]`} />
          </td>
          <td className="px-4 py-2">{renderTermToggle(f.term, (term) => setF({ ...f, term }))}</td>
          <td className="px-4 py-2">
            <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as "draft" | "active" | "terminated" })} className={cellInputCls}>
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="terminated">terminated</option>
            </select>
          </td>
          <td className="px-4 py-2 text-right">
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
        <tr className={`${isNew ? "" : `border-b ${rowBorder}`} ${editBg}`}>
          <td colSpan={7} className="px-4 pb-4 pt-1">
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
  const glyph = asset.type === "C-Corp" ? "INC" : asset.type === "LLC" ? "LLC" : String(asset.type || "ENT").slice(0, 3).toUpperCase();
  const filedCount = FILING_KINDS.filter((k) => asset[k]).length;
  const { score, items: checklist } = completeness(asset);
  const missing = checklist.filter((i) => !i.done);
  const scoreTone = score >= 90 ? "emerald" : score >= 60 ? "indigo" : "amber";
  const scoreColor = {
    emerald: isDark ? "#34d399" : "#059669",
    indigo: isDark ? "#818cf8" : "#4f46e5",
    amber: isDark ? "#fbbf24" : "#d97706",
  }[scoreTone];
  const docFiledAs = new Map<string, FileKind>();
  for (const k of FILING_KINDS) if (asset[k]?.docId) docFiledAs.set(asset[k]!.docId!, k);
  const activeContracts = contracts.filter((c) => c.status === "active").length;
  const metrics: { label: string; value: string; sub?: string }[] = [];
  if (asset.type === "LLC") metrics.push({ label: "Contracts", value: String(contracts.length), sub: `${activeContracts} active` });
  if (asset.type === "C-Corp") metrics.push({ label: "Directors", value: String(directors.length), sub: `${shareholders.length} holder${shareholders.length === 1 ? "" : "s"}` });
  metrics.push({ label: "Completeness", value: `${score}`, sub: "/ 100" });
  metrics.push({ label: "Filings", value: `${filedCount}/${FILING_KINDS.length}`, sub: filedCount === FILING_KINDS.length ? "complete" : "on file" });
  metrics.push({
    label: "On record since",
    value: asset.createdAt ? new Date(asset.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—",
  });

  const chipBase = "inline-flex items-center gap-1.5 h-6 px-2 rounded-md border text-[11px] whitespace-nowrap";
  const chipNeutral = `${chipBase} ${isDark ? "border-white/[0.08] bg-white/[0.03] text-gray-300" : "border-gray-200 bg-gray-50 text-gray-600"}`;
  const statusIsActive = asset.status === "Active";

  const emptyValue = <span className={isDark ? "text-gray-600" : "text-gray-300"}>&mdash;</span>;
  const factCell = (label: string, content: React.ReactNode, extraCls = "") => (
    <div key={label} className={`min-w-0 border-l border-t px-5 py-3.5 ${divider} ${extraCls}`}>
      <dt className={kicker}>{label}</dt>
      <dd className="mt-1.5 text-[13px] leading-snug break-words">{content || emptyValue}</dd>
    </div>
  );

  const field = (label: string, control: React.ReactNode, wide = false) => (
    <div className={wide ? "md:col-span-2" : ""}>
      <p className={`mb-1.5 ${kicker}`}>{label}</p>
      {control}
    </div>
  );
  const fieldInput = `w-full h-9 px-3 text-[13px] ${inputCls}`;

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
                  <span className={`${chipNeutral} font-mono tracking-[0.06em]`}>{asset.type}</span>
                  {asset.llcType && (
                    <span className={chipNeutral}>
                      <span className={`h-1 w-1 rounded-full ${accentBg}`} />
                      {asset.llcType}
                    </span>
                  )}
                  <span className={`${chipNeutral} ${asset.state ? "" : textMuted}`}>{asset.state || "No state"}</span>
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
              <button onClick={() => setEditing(!editing)} className={btnOutline}>
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
          {metrics.map((m, i) => (
            <div
              key={m.label}
              className={`min-w-0 px-5 py-3.5 sm:px-6 ${divider} ${i % 2 === 1 ? "border-l" : ""} ${i === 2 ? "sm:border-l" : ""} ${i >= 2 ? "border-t sm:border-t-0" : ""}`}
            >
              <p className={kicker}>{m.label}</p>
              <p className="mt-1 truncate text-[15px] font-medium tabular-nums">
                {m.value}
                {m.sub && <span className={`ml-1.5 text-[11px] font-normal ${textMuted}`}>{m.sub}</span>}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Key facts / Edit form */}
      {editing ? (
        <section className={`rounded-2xl ${surface}`}>
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
              <div className={`grid grid-cols-2 gap-1 rounded-lg border p-1 ${hairline} ${isDark ? "bg-white/[0.02]" : "bg-gray-50"}`}>
                {(["LLC", "C-Corp"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm({ ...form, type: t })}
                    className={`h-7 rounded-md text-[12px] font-medium transition-colors cursor-pointer ${
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
              "State of formation",
              <input value={form.state || ""} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="State of formation" className={fieldInput} />,
            )}
            {field(
              "EIN",
              <input value={form.ein || ""} onChange={(e) => setForm({ ...form, ein: e.target.value })} placeholder="EIN" className={`${fieldInput} font-mono tabular-nums`} />,
            )}
            {field(
              "Registered agent",
              <input value={form.registeredAgent || ""} onChange={(e) => setForm({ ...form, registeredAgent: e.target.value })} placeholder="Registered agent" className={fieldInput} />,
            )}
            {field(
              "Principal address",
              <input value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Principal address" className={fieldInput} />,
            )}
            {field(
              "Formation date",
              <input type="date" value={form.formationDate || ""} onChange={(e) => setForm({ ...form, formationDate: e.target.value })} className={fieldInput} />,
            )}
            {field(
              "Entity classification",
              <select value={form.llcType || ""} onChange={(e) => setForm({ ...form, llcType: e.target.value as Asset["llcType"] })} className={fieldInput}>
                <option value="">Select LLC Type...</option>
                <option value="Disregarded Entity">Disregarded Entity</option>
                <option value="Partnership">Partnership</option>
                <option value="C Corporation">C Corporation</option>
              </select>,
            )}
            {field(
              "State filing link",
              <input value={form.stateLink || ""} onChange={(e) => setForm({ ...form, stateLink: e.target.value })} placeholder="https://..." type="url" className={fieldInput} />,
            )}
            {field(
              "Operating agreement",
              <input type="date" value={form.operatingAgreementDate || ""} onChange={(e) => setForm({ ...form, operatingAgreementDate: e.target.value })} className={fieldInput} />,
            )}
            {field(
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
            <button onClick={handleSave} className={btnPrimary}>
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
                    className={`inline-flex h-5 w-5 items-center justify-center rounded transition-colors cursor-pointer ${
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
            {factCell("Registered agent", asset.registeredAgent)}
            {factCell("Principal address", asset.address)}
            {factCell("Formation date", fmtDate(asset.formationDate) ? <span className="tabular-nums">{fmtDate(asset.formationDate)}</span> : null)}
            {factCell(asset.type === "C-Corp" ? "Classification" : "LLC type", asset.llcType)}
            {factCell("Operating agreement", fmtDate(asset.operatingAgreementDate) ? <span className="tabular-nums">{fmtDate(asset.operatingAgreementDate)}</span> : null)}
            {factCell("Articles of org", fmtDate(asset.articlesOfOrgDate) ? <span className="tabular-nums">{fmtDate(asset.articlesOfOrgDate)}</span> : null)}
            {factCell(
              "State link",
              asset.stateLink ? (
                <a href={asset.stateLink} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 hover:underline ${accentText}`}>
                  View filing
                  <Icon name="external" className="w-3 h-3" />
                </a>
              ) : null,
            )}
            {asset.notes &&
              factCell("Notes", <span className={`whitespace-pre-wrap ${textSoft}`}>{asset.notes}</span>, "col-span-2 md:col-span-4")}
          </dl>
        </section>
      )}

      {/* Main column + rail */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          {/* C-Corp Management */}
          {asset.type === "C-Corp" && (
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
                      className={`h-7 whitespace-nowrap rounded-md px-3 text-[12px] font-medium transition-colors cursor-pointer ${
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
                            <button onClick={() => removeDirector(d.id)} className="text-gray-500 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">Remove</button>
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
                      <button onClick={() => setAddingDirector(true)} className={`inline-flex items-center gap-1 text-[12px] font-medium transition-opacity hover:opacity-80 cursor-pointer ${accentText}`}>
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
                            <button onClick={() => removeOfficer(o.id)} className="text-gray-500 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">Remove</button>
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
                      <button onClick={() => setAddingOfficer(true)} className={`inline-flex items-center gap-1 text-[12px] font-medium transition-opacity hover:opacity-80 cursor-pointer ${accentText}`}>
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
                                  <button onClick={() => removeShareholder(s.id)} className="text-gray-500 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">Remove</button>
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
                      <button onClick={() => setAddingShareholder(true)} className={`inline-flex items-center gap-1 text-[12px] font-medium transition-opacity hover:opacity-80 cursor-pointer ${accentText}`}>
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
                              <span className={`tabular-nums ${new Date(corpData.annualReportDue) < new Date() ? "text-red-400" : "text-green-400"}`}>
                                {corpData.annualReportDue}
                              </span>
                            </div>
                          )}
                          {corpData.nextBoardMeeting && (
                            <div className="flex justify-between text-xs">
                              <span className={textSoft}>Board Meeting</span>
                              <span className={`tabular-nums ${new Date(corpData.nextBoardMeeting) < new Date() ? "text-red-400" : "text-green-400"}`}>
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
          {asset.type === "LLC" && (() => {
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
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[960px] text-sm">
                      <thead>
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
                      <tbody>
                        {contracts.map((contract) =>
                          editingContractId === contract.id ? (
                            <Fragment key={contract.id}>
                              {renderContractFormRows(editContractForm, setEditContractForm, saveEditContract, () => setEditingContractId(null), false)}
                            </Fragment>
                          ) : (
                            <tr key={contract.id} className={`border-b last:border-b-0 ${rowBorder} ${rowHover} transition-colors`}>
                              <td className="px-4 py-3">
                                <p className="text-[13px] font-medium leading-tight">{contract.counterparty}</p>
                                <p className={`mt-0.5 text-[11px] ${textMuted}`}>
                                  MSA — {asset.name} &rarr; {contract.counterparty}
                                </p>
                              </td>
                              <td className="px-4 py-3 text-[13px] tabular-nums">{contract.fee}</td>
                              <td className={`px-4 py-3 text-[13px] ${textSoft}`}>{contract.frequency}</td>
                              <td className={`whitespace-nowrap px-4 py-3 text-[12px] tabular-nums ${textSoft}`}>{fmtDate(contract.effectiveDate)}</td>
                              <td className={`px-4 py-3 text-[12px] ${textSoft}`}>{contract.term}</td>
                              <td className="px-4 py-3">
                                <div className="relative inline-flex">
                                  <select
                                    value={contract.status}
                                    onChange={(e) => updateContractStatus(contract.id, e.target.value as "draft" | "active" | "terminated")}
                                    className={`h-6 appearance-none rounded-full border pl-2.5 pr-6 font-mono text-[10px] uppercase tracking-[0.1em] outline-none cursor-pointer ${statusPillCls(contract.status)} ${
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
                              <td className="px-4 py-3 text-right">
                                <div className="inline-flex items-center gap-1">
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
                                      if (confirm(`Delete the MSA with ${contract.counterparty}?`)) deleteContract(contract.id);
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

          {/* Documents */}
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
                className={`flex min-h-[60px] cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 py-2.5 transition-colors ${
                  docDrop.dragOver
                    ? isDark ? "border-[#818cf8]/70 bg-[#818cf8]/[0.08]" : "border-[#4f46e5]/60 bg-indigo-50"
                    : isDark ? "border-white/[0.12] hover:border-white/25 hover:bg-white/[0.02]" : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
                } ${docDrop.uploading ? "opacity-80" : ""}`}
              >
                <input
                  type="file"
                  multiple
                  className="hidden"
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
              {(sorting > 0 || filingNotes.length > 0) && (
                <div className={`mt-2.5 rounded-lg border px-3 py-2 ${hairline} ${isDark ? "bg-white/[0.02]" : "bg-gray-50/70"}`}>
                  {sorting > 0 && (
                    <p className={`flex items-center gap-2 text-[11px] ${textMuted}`}>
                      <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${accentBg}`} />
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
                    <button type="button" onClick={() => setFilingNotes([])} className={`mt-1 cursor-pointer text-[10.5px] ${textMuted} hover:underline`}>
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
                className={`mt-2.5 inline-flex items-center gap-1.5 text-[11px] transition-colors cursor-pointer ${isDark ? "text-gray-500 hover:text-gray-200" : "text-gray-500 hover:text-gray-900"}`}
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
                            className={`block truncate text-[13px] font-medium transition-colors ${isDark ? "text-gray-100 hover:text-[#a5b4fc]" : "text-gray-900 hover:text-[#4f46e5]"}`}
                            title={doc.name}
                          >
                            {doc.name}
                          </a>
                          <p className={`mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[10px] tabular-nums ${textMuted}`}>
                            <span>{meta.join(" · ")}</span>
                            {docFiledAs.has(doc.id) && (
                              <span className={`inline-flex items-center gap-1 ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                                <Icon name="check" className="h-2.5 w-2.5" strokeWidth={2.5} />
                                Filed · {filingTitle(docFiledAs.get(doc.id)!, asset.type)}
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
        </div>

        {/* Right rail */}
        <aside className="order-first min-w-0 space-y-5 lg:order-none lg:sticky lg:top-6">
          {/* Completeness */}
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
                      if (item.filing) document.getElementById(`filing-${item.filing}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                      else setEditing(true);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-[12px] transition-colors ${
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
                    className={`w-full cursor-pointer rounded-md px-3 py-1.5 text-left font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${textMuted} ${isDark ? "hover:text-gray-300" : "hover:text-gray-700"}`}
                  >
                    {showDone ? "Hide completed" : `Show ${checklist.length - missing.length} completed`}
                  </button>
                </li>
              )}
            </ul>
          </section>

          <section className={`overflow-hidden rounded-2xl ${surface}`}>
            {sectionHeader(
              "Formation",
              "Filings",
              undefined,
              <span className={`font-mono text-[10px] uppercase tracking-[0.14em] tabular-nums ${filedCount === FILING_KINDS.length ? (isDark ? "text-emerald-400" : "text-emerald-600") : textMuted}`}>
                {filedCount}/{FILING_KINDS.length} on file
              </span>,
            )}
            <div className={`divide-y ${isDark ? "divide-white/[0.06]" : "divide-gray-100"}`}>
              {FILING_KINDS.map((k) => (
                <Fragment key={k}>
                  {renderFileSlot(k, filingTitle(k, asset.type), filingDescription(k), "application/pdf,image/png,image/jpeg", ["application/pdf", "image/png", "image/jpeg"])}
                </Fragment>
              ))}
            </div>
            <div className={`border-t px-5 py-3 ${hairline}`}>
              <p className={`text-[11px] leading-snug ${textMuted}`}>
                Documents you upload are read and filed here automatically.
                {docs.length > 0 && filedCount < FILING_KINDS.length && (
                  <>
                    {" "}
                    <button
                      type="button"
                      onClick={() => void scanLibrary()}
                      disabled={sorting > 0}
                      className={`cursor-pointer font-medium disabled:cursor-wait disabled:opacity-60 ${accentText}`}
                    >
                      {sorting > 0 ? "Reading documents…" : "Scan existing documents"}
                    </button>
                  </>
                )}
              </p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
