import { useEffect, useRef, useState } from "react";
import { stepsLeft } from "../entity-closing";
import { isFormationDone } from "../formation";
import { raPatch } from "../../lib/palm-agent";
import { peoplePatch } from "../../lib/registry";
import { palmDocKey } from "../../lib/palm-docs";
import { dollars, STATE_RECORD_CENTS } from "../../lib/palm-pricing";
import { stateReadCost } from "../../lib/state-reads";
import { formingNow } from "../entity-addresses";
import { canDraftAgreement, f8822bData, fill8822B, fillW9, oaInput, oaProblems, operatingAgreement, operatingAgreementPdf, PALM_SLOT, w9Data, type Rec } from "../paperwork-generate";
import { useNavigate, useParams } from "react-router";
import { authFetch, getUser, isPartner } from "../auth";
import { entityCompleteness, entityType, TAX_CLASSES, type EntityType } from "../entity-completeness";
import { alertDialog, confirmDialog } from "../confirm-dialog";
import { copyStoredFileLink, openStoredFile } from "../stored-file";
import {
  DOC_LABEL,
  docKindOf,
  fetchPalmDocument,
  formatAddress as formatPalmAddress,
  lookupStateRecord,
  normalizeName,
  openPalmDocument,
  palmCall,
  PalmCallError,
  palmJurisdiction,
  PalmUnavailable,
  RA_STATUS,
  sameAddressText,
  sortDocuments,
  stateFindings,
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
  stateName,
  taxHome,
  type DocKey,
  type DocRule,
  type PaperworkInput,
} from "../entity-paperwork";
import {
  VERIFY_LABEL,
  MSA_SERVICES,
  LEDGER_LOUISE_SUBS,
  SERVICE_ALIASES,
  normalizeServices,
  fmtDate,
  fmtStamp,
  docKind,
  normValue,
  normEntityName,
  timeAgo,
  FILING_KINDS,
  FALLBACK_TITLE,
  ruleFor,
  filingTitle,
  guessFiling,
  CLASSIFIER_KIND,
  TAX_CLASS_KINDS,
  BY_HAND,
  fromDatabase,
  type Asset,
  type Member,
  type EntityProfile,
  type VerifyField,
  type Verification,
  type UploadedFile,
  type CorpData,
  type AssetDoc,
  type OperatingContract,
  type EntityTab,
  type FileKind,
  type Classified,
 tidyEin } from "./model";

/**
 * Everything the entity page knows and does — the record and its documents,
 * filing, reading and verifying documents, Palm, contracts, corporate
 * records, editing and deleting — with no markup. The views render it.
 * (Moved unchanged from the old single-file page.)
 */
/** Foreign registrations as typed: blank fields dropped, a state with nothing left dropped (null when none). */
export type PalmSyncLine = { label: string; tone: "good" | "warn" | "bad" | "muted"; text: string };
/** A sync with Palm under way (`step` is what it's reading) or just finished (`at`). */
export type PalmSyncState = { running: boolean; step: string; lines: PalmSyncLine[]; cents: number; mode: PalmMode; at?: number };

/** A People list filled from the state's record (lib/registry.ts peoplePatch): documents, with shares, replace it. */
const fromStateRecord = (source?: string | null) => /^State record\b/.test(source ?? "");

/** Owners, admins and members change the record; viewers and partners only read it. */
const canChangeRecord = () => ["owner", "admin", "member"].includes(getUser()?.role ?? "");

function cleanForeign(f: Asset["foreign"]): Asset["foreign"] | null {
  const out: NonNullable<Asset["foreign"]> = {};
  for (const [code, reg] of Object.entries(f ?? {})) {
    const kept = Object.fromEntries(Object.entries(reg ?? {}).filter(([, v]) => (typeof v === "string" ? v.trim() : v))) as typeof reg;
    for (const k of ["agent", "agentAddress", "fileNumber"] as const) if (typeof kept[k] === "string") kept[k] = kept[k]!.trim();
    if (Object.keys(kept).length) out[code] = kept;
  }
  return Object.keys(out).length ? out : null;
}

export function useEntityPage() {
  const { id, tab: tabParam } = useParams();
  const navigate = useNavigate();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [docs, setDocs] = useState<AssetDoc[]>([]);
  const [loading, setLoading] = useState(true);
  // The entity's first load failed: the page offers Try again instead of spinning forever.
  const [loadError, setLoadError] = useState(false);
  const [loadTry, setLoadTry] = useState(0);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Asset>>({});
  // When the edit form last saved, for a brief "Saved" by the Edit button.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!savedAt) return;
    const t = setTimeout(() => setSavedAt(null), 3000);
    return () => clearTimeout(t);
  }, [savedAt]);

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

    // Another entity: nothing of the last one shows while this one loads.
    setAsset(null);
    setLoading(true);
    setEditing(false);

    async function setup() {
      const { db, authReady } = await import("../store");
      await authReady;
      const { ref, onValue } = await import("../store");

      unsub1 = onValue(
        ref(db, `assets/${id}`),
        (snapshot) => {
          const data = snapshot.val();
          // The edit form is seeded when editing starts (startEditing), so a
          // background write (auto-filing, enrichment) never wipes what's typed.
          // Null once the collection has loaded means there's no such entity (or it was just deleted):
          // never keep showing (and saving into) the one before.
          setAsset(data ? fromDatabase(data as Asset) : null);
          setLoading(false);
          setLoadError(false);
        },
        () => setLoadError(true)
      );

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
      const { get } = await import("../store");
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

    setup().catch(() => setLoadError(true));
    return () => {
      unsub1?.();
      unsub2?.();
      unsub5?.();
      unsub6?.();
    };
  }, [id, loadTry]);
  function retryLoad() {
    setLoadError(false);
    setLoadTry((n) => n + 1);
  }

  // What the form started from — so Save only overrides fields the user
  // changed, and keeps anything filled in the background meanwhile.
  const editBaseRef = useRef<Partial<Asset>>({});
  function startEditing() {
    if (!asset) return;
    // Edit with the entity's real type selected (old records say "LLC" for the trust).
    const seed = { ...asset, type: entityType(asset) };
    editBaseRef.current = seed;
    setForm(seed);
    setSavedAt(null);
    setEditing(true);
    if ((tabParam ?? "overview") === "overview") setTimeout(() => document.getElementById("entity-edit")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    else goToTab("overview", "entity-edit");
  }

  async function handleSave() {
    if (!form.name?.trim()) return;
    const base = editBaseRef.current;
    const live = assetRef.current ?? ({} as Partial<Asset>);
    const pick = <K extends keyof Asset>(k: K) => ((form[k] ?? "") !== (base[k] ?? "") ? form[k] : live[k] ?? form[k]);
    const { db } = await import("../store");
    const { ref, update } = await import("../store");
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
      ein: tidyEin(pick("ein")),
      registeredAgent: pick("registeredAgent") || "",
      address: pick("address") || "",
      mailingAddress: sameAddressText(pick("mailingAddress"), pick("address")) ? "" : (pick("mailingAddress") || "").trim(),
      registeredAgentAddress: (pick("registeredAgentAddress") || "").trim(),
      foreign: cleanForeign(pick("foreign")),
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
    setSavedAt(Date.now());
  }

  /** Has the edit form moved from what it started with? */
  function formDirty() {
    const base = editBaseRef.current as Record<string, unknown>;
    const f = form as Record<string, unknown>;
    const same = (a: unknown, b: unknown) => JSON.stringify(a ?? "") === JSON.stringify(b ?? "");
    return Object.keys({ ...base, ...f }).some((k) => !same(f[k], base[k]));
  }

  /** Leave the edit form; asks first when that would throw away typing. */
  async function cancelEditing() {
    if (formDirty() && !(await confirmDialog({ title: "Discard changes?", confirmLabel: "Discard", tone: "danger" }))) return;
    setEditing(false);
  }

  async function handleAddDoc(e: React.FormEvent) {
    e.preventDefault();
    if (!docName.trim() || !docUrl.trim()) return;

    const { db } = await import("../store");
    const { push, ref } = await import("../store");
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
      try {
        const r = await deleteStoredFile(doc.storagePath);
        if (r && (r.status === 401 || r.status === 403)) {
          await alertDialog("You don't have permission to delete documents.");
          return;
        }
      } catch {
        // ignore
      }
    }
    const { db, authReady } = await import("../store");
    await authReady;
    const { ref, remove, update } = await import("../store");
    if (filedAs.length) await update(ref(db, `assets/${id}`), Object.fromEntries(filedAs.map((k) => [k, null])));
    await remove(ref(db, `assets/${id}/documents/${docId}`));
  }

  // Upload one document: signed URL → PUT with progress → its record in the tree.
  // Throws on failure; progress is reported as a 0–100 fraction of this file.
  async function uploadDocFile(file: File, onProgress: (pct: number) => void) {
    const stored = await uploadToStorage(file, (pct) => {
      setDocDrop((s) => ({ ...s, error: null }));
      onProgress(pct);
    }, () => setDocDrop((s) => ({ ...s, error: "Upload is stuck. Check your connection and try again." })));

    const { db, ref: dbRef, push } = await import("../store");
    const displayName = file.name.replace(/\.[^.]+$/, "");
    const record = {
      name: displayName,
      url: stored.url,
      storagePath: stored.path,
      storageProvider: "supabase" as const,
      size: file.size,
      contentType: file.type || "application/octet-stream",
      createdAt: Date.now(),
    };
    const pushed = await push(dbRef(db, `assets/${id}/documents`), record);
    return { id: pushed.key as string, ...record } as AssetDoc;
  }

  /**
   * Put a file in the "documents" bucket under this entity: a signed upload
   * URL from the server, then a PUT straight to Supabase Storage so progress
   * can be shown. `onStuck` fires if nothing has streamed after 15 s.
   */
  async function uploadToStorage(file: File, onProgress: (pct: number) => void, onStuck: () => void): Promise<{ path: string; url: string }> {
    const urlRes = await authFetch("/api/documents/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId: id, fileName: file.name, contentType: file.type || "application/octet-stream" }),
    });
    const urlData = await urlRes.json();
    if (!urlRes.ok || !urlData?.signedUrl) throw new Error(urlData?.message || "Could not get signed upload URL");

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", urlData.signedUrl, true);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.setRequestHeader("x-upsert", "false");
      const stuckTimer = setTimeout(onStuck, 15000);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.loaded > 0) {
          clearTimeout(stuckTimer);
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
    return { path: urlData.path as string, url: urlData.publicUrl as string };
  }

  /** Remove a stored file (best effort). Returns the response, or null when the path isn't one of ours. */
  async function deleteStoredFile(path: string): Promise<Response | null> {
    if (!/^assets\//.test(path)) return null;
    return authFetch("/api/documents/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
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
      const { db, authReady } = await import("../store");
      await authReady;
      const { ref, update } = await import("../store");
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
    const { db, authReady } = await import("../store");
    await authReady;
    const { ref, update } = await import("../store");
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
    if (owners.length && ownerKinds.has(CLASSIFIER_KIND[facts.kind] ?? "") && (!current.members?.length || current.membersSource === doc.name || fromStateRecord(current.membersSource))) {
      patch.members = owners.map((m) => ({ name: m.name.trim(), percent: typeof m.percent === "number" ? m.percent : null, role: m.role ?? null }));
      patch.membersSource = doc.name;
      added.push(`${owners.length} owner${owners.length === 1 ? "" : "s"} / managers`);
    }
    if (CLASSIFIER_KIND[facts.kind] === "annualReport" && facts.filingYear && (current.annualReportYear ?? 0) < facts.filingYear) {
      patch.annualReportYear = facts.filingYear;
      added.push(`annual filing for ${facts.filingYear}`);
    }
    if (!Object.keys(patch).length) return;
    const { db, authReady } = await import("../store");
    await authReady;
    const { ref, update } = await import("../store");
    await update(ref(db, `assets/${id}`), patch);
    const line = `Read “${doc.name}” · added ${added.join(", ")}`;
    setFilingNotes((n) => [...n, line]);
    setScan((sc) => (sc && !sc.finished ? { ...sc, notes: [...sc.notes, line] } : sc));
  }

  /** Use the tax class a document states, settling the conflict. */
  async function acceptDocumentTaxClass() {
    const c = assetRef.current?.llcTypeConflict;
    if (!c) return;
    const { db, authReady } = await import("../store");
    await authReady;
    const { ref, update } = await import("../store");
    await update(ref(db, `assets/${id}`), {
      llcType: c.value,
      llcTypeSource: `${c.evidence} (${c.docName})`,
      llcTypeConflict: null,
    });
  }

  /** Keep the record's tax class and dismiss the document's disagreement. */
  async function dismissTaxClassConflict() {
    const { db, authReady } = await import("../store");
    await authReady;
    const { ref, update } = await import("../store");
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
    const { db, authReady } = await import("../store");
    await authReady;
    const { ref, update } = await import("../store");
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
        const { db, authReady } = await import("../store");
        await authReady;
        const { ref, update } = await import("../store");
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
      const { db, authReady } = await import("../store");
      await authReady;
      const { ref, update } = await import("../store");
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
  /** The foreign state whose record is being read. */
  const [foreignBusy, setForeignBusy] = useState<string | null>(null);
  const [palmError, setPalmError] = useState("");
  const [registryChoices, setRegistryChoices] = useState<RegistryRecord[] | null>(null);
  const palmMode = palmStatus?.mode ?? null;
  /** What Palm pushed for this entity (webhook): mail, and agent changes with their reasons. */
  const [palmInbox, setPalmInbox] = useState<{ id: string; type: string; document_id: string | null; rejection_reason: string | null; read_at: string | null }[]>([]);
  useEffect(() => {
    if (!palmMode || !id || tabParam !== "compliance") return;
    let live = true;
    palmCall<{ events: typeof palmInbox }>("inbox", { assetId: id, mode: palmMode })
      .then((r) => {
        if (!live) return;
        setPalmInbox(r.events);
        // Seen here: mark read after a moment (the "New" marks stay for this visit).
        if (r.events.some((e) => !e.read_at)) setTimeout(() => void palmCall("inbox-read", { assetId: id, mode: palmMode }).catch(() => {}), 1500);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [palmMode, id, tabParam]);
  /** Bumped by every read or change of Palm's agent service; an older response is dropped. */
  const palmSeq = useRef(0);
  /** Bumped when the page moves to another entity; work started for the last one stops touching the card. */
  const palmEpoch = useRef(0);
  const palmMoving = useRef(false);

  async function patchAsset(patch: Record<string, unknown>) {
    const { db } = await import("../store");
    const { ref, update } = await import("../store");
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
    // An invited owner's page has no Palm card.
    if (!isPartner()) void loadPalmStatus();
  }, []);

  // Another entity: start the card clean.
  useEffect(() => {
    setEditing(false);
    setSavedAt(null);
    setForm({});
    palmEpoch.current++;
    palmSeq.current++;
    // A sync for the last entity stops at its next step (it checks the epoch); its results aren't this one's.
    setPalmSync(null);
    syncingRef.current = false;
    setPalmRa(undefined);
    setPalmDocs(null);
    setRegistryChoices(null);
    setPalmError("");
    setPalmBusy(null);
  }, [id]);

  // A formation under way: ask Palm every half minute (webhooks land faster; this covers the gaps).
  const formation = palmMode ? asset?.palm?.[palmMode]?.formation : undefined;
  const formationId = formation && !isFormationDone(formation) ? formation.filingId : null;
  const [formationError, setFormationError] = useState("");
  useEffect(() => {
    if (!palmMode || !formationId || !id) return;
    let alive = true;
    const tick = () =>
      palmCall<{ patch: Record<string, unknown> }>("form-status", { assetId: id, filingId: formationId, mode: palmMode })
        .then(() => alive && setFormationError(""))
        .catch((err) => alive && setFormationError(err instanceof PalmUnavailable ? "" : (err as Error).message));
    void tick();
    const timer = window.setInterval(tick, 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [palmMode, formationId, id]);

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

  /**
   * Palm's agent service and mail for this entity; the record follows when the
   * agent actually changes. Says what it found (the sync reports it); with
   * `waitForImport`, only once the documents are saved.
   */
  async function refreshPalm(
    businessId: string,
    opts: { busy?: boolean; keepError?: boolean; waitForImport?: boolean } = {},
  ): Promise<{ service?: RaService | null; documents?: number; saved?: number; failed?: number; truncated?: boolean; error?: string } | null> {
    const mode = palmMode;
    if (!mode) return null;
    const seq = ++palmSeq.current;
    const busy = opts.busy ?? true;
    if (busy) setPalmBusy("refresh");
    if (!opts.keepError) setPalmError("");
    try {
      const [raR, docsR] = await Promise.allSettled([
        palmCall<{ service: RaService | null }>("ra", { businessId, mode }),
        palmCall<{ documents: PalmDocument[]; truncated?: boolean }>("documents", { businessId, mode }),
      ]);
      if (seq !== palmSeq.current) return null;
      const found: { service?: RaService | null; documents?: number; saved?: number; failed?: number; truncated?: boolean; error?: string } = {};
      if (docsR.status === "fulfilled") {
        setPalmDocs(sortDocuments(docsR.value.documents));
        found.documents = docsR.value.documents.length;
        found.truncated = !!docsR.value.truncated;
        const saving = importPalmDocuments(docsR.value.documents, mode);
        if (opts.waitForImport) Object.assign(found, await saving);
      } else found.error = (docsR.reason as Error)?.message;
      if (raR.status === "rejected") {
        if (!opts.keepError) showPalmError(raR.reason);
        return { ...found, error: (raR.reason as Error)?.message };
      }
      const service = raR.value.service;
      found.service = service;
      setPalmRa(service);
      const current = assetRef.current;
      if (!current) return found;
      // The whole service (provider, dates, why a change was refused), and the agent on record when it changes.
      await patchAsset(raPatch(current, service, mode));
      if (docsR.status === "rejected" && !opts.keepError) showPalmError(docsR.reason);
      return found;
    } finally {
      if (busy) setPalmBusy(null);
    }
  }

  /** Read the state's record: by file number when we have it, otherwise find the entity by name. Returns why it couldn't, or null. */
  async function checkStateRecord(choice?: RegistryRecord): Promise<string | null> {
    const current = assetRef.current;
    const mode = palmMode;
    if (!current || !mode) return "Palm isn't connected.";
    const jurisdiction = palmJurisdiction(current.state);
    if (!jurisdiction) {
      setPalmError("Set the entity's state first.");
      return "Set the entity's state first.";
    }
    const epoch = palmEpoch.current;
    setPalmBusy("record");
    setPalmError("");
    try {
      const found = await lookupStateRecord({ ...current, assetId: id }, mode, choice);
      if (epoch !== palmEpoch.current) return "The page moved on.";
      if (found.kind === "error") {
        setPalmError(found.message);
        return found.message;
      }
      if (found.kind === "choices") {
        setRegistryChoices(found.results);
        if (found.message) setPalmError(found.message);
        return found.message ?? "More than one registry entry matched. Pick the right one under Compliance → State record.";
      }
      // The state's people fill an empty People list (live only; documents later replace it).
      const live = assetRef.current ?? current;
      await patchAsset({ ...found.patch, ...peoplePatch(live, live.ownerId ? assetNames[live.ownerId] : null, found.record, mode === "live") });
      if (epoch === palmEpoch.current) setRegistryChoices(null);
      return null;
    } catch (err) {
      if (epoch === palmEpoch.current) showPalmError(err);
      return err instanceof PalmUnavailable ? "Palm isn't connected." : (err as Error).message;
    } finally {
      if (epoch === palmEpoch.current) setPalmBusy(null);
    }
  }

  /**
   * Read a foreign registration's record (e.g. Arizona's, for a Delaware LLC
   * run from Phoenix) through Palm, and fill the agent and file number from it
   * where ours are blank. Returns why it couldn't, or null.
   */
  async function checkForeignRecord(code: string): Promise<string | null> {
    const current = assetRef.current;
    const mode = palmMode;
    if (!current) return null;
    if (!mode) return "Connect Palm to read the state's record.";
    const f = current.foreign?.[code] ?? {};
    const epoch = palmEpoch.current;
    setForeignBusy(code);
    try {
      const found = await lookupStateRecord({ name: current.name, state: code, fileNumber: f.fileNumber, registeredAgent: f.agent, registeredAgentAddress: f.agentAddress, assetId: id }, mode);
      // Another entity opened meanwhile: this record isn't for the one on screen now.
      if (epoch !== palmEpoch.current) return "The page moved on.";
      if (found.kind === "error") return found.message;
      if (found.kind === "choices") {
        return found.results.length
          ? `More than one ${code} registry entry matched. Add the ${code} file number under Edit, then check again.`
          : `${code} has no registration for “${current.name}” yet. Once it's filed, add the file number under Edit.`;
      }
      const rec = found.record;
      const live = mode === "live";
      await patchAsset({
        [`foreign/${code}/record`]: JSON.parse(JSON.stringify(rec)),
        ...(live && !f.fileNumber && rec.registrationNumber ? { [`foreign/${code}/fileNumber`]: rec.registrationNumber } : {}),
        ...(live && !f.agent && rec.agent ? { [`foreign/${code}/agent`]: rec.agent } : {}),
        ...(live && !f.agentAddress && rec.agentAddress && (!f.agent || normalizeName(f.agent) === normalizeName(rec.agent ?? "")) ? { [`foreign/${code}/agentAddress`]: rec.agentAddress } : {}),
      });
      return null;
    } catch (err) {
      return err instanceof PalmUnavailable ? "Connect Palm to read the state's record." : (err as Error).message;
    } finally {
      setForeignBusy(null);
    }
  }

  // ── Sync everything with Palm ─────────────────────────────────────────
  //
  // One click reads everything Palm knows about the entity, in the order each
  // step needs: the state's records first (the paid part, priced up front),
  // then Palm's own copy of the business, its agent and mail, the formation
  // under way, and Palm's open questions. It reads and fills blanks; it never
  // files anything, adds the entity to Palm, or changes its agent.

  /** Bumped so the open-questions card asks Palm again. */
  const [palmCasesTick, setPalmCasesTick] = useState(0);
  const [palmSync, setPalmSync] = useState<PalmSyncState | null>(null);
  const syncingRef = useRef(false);

  /** What a sync reads and what it costs now (live: billed; test: free). */
  function palmSyncPlan() {
    const current = assetRef.current;
    return current ? stateReadCost(current, palmMode) : { states: [], cents: 0 };
  }

  async function syncWithPalm() {
    const current = assetRef.current;
    const mode = palmMode;
    if (!current || !mode || syncingRef.current) return;
    // Every step checks this: once another entity is open, the rest would read and write the wrong one.
    const epoch = palmEpoch.current;
    const moved = () => epoch !== palmEpoch.current;
    const plan = palmSyncPlan();
    const businessId = current.palm?.[mode]?.businessId;
    if (plan.cents > 0) {
      const ok = await confirmDialog({
        title: `Sync ${current.name} with Palm?`,
        message: (
          <>
            Reading the state's records is billed by Palm: about <b>{dollars(plan.cents)}</b>. Everything else is free.
          </>
        ),
        details: [
          ...plan.states.map((st) => `${stateName(st.code) || st.code}${st.home ? "" : " (foreign)"} state record: ${dollars(st.cents)}${st.cents < STATE_RECORD_CENTS ? " (file number on record)" : " (name search, then the record)"}`),
          businessId ? "Palm's copy of the business, its agent, and its mail (saved to Documents): free" : "Its agent and mail: read once Palm is its agent",
          "Nothing is filed with the state, and nothing on the record is overwritten: blanks are filled, differences are flagged.",
        ],
        confirmLabel: `Sync · ${dollars(plan.cents)}`,
      });
      if (!ok || moved()) return;
    }
    syncingRef.current = true;
    const lines: PalmSyncLine[] = [];
    const MOVED = new Error("moved");
    const say = (line: PalmSyncLine) => {
      if (moved()) throw MOVED;
      lines.push(line);
      setPalmSync({ running: true, step: line.label, lines: [...lines], cents: plan.cents, mode });
    };
    const step = (label: string) => {
      if (moved()) throw MOVED;
      setPalmSync({ running: true, step: label, lines: [...lines], cents: plan.cents, mode });
    };
    try {
      // 1. The state's records: the home state's (fills the file number Palm needs), then each foreign one.
      for (const st of plan.states) {
        const label = `${stateName(st.code) || st.code}${st.home ? "" : " (foreign)"} record`;
        step(label);
        const why = st.home ? await checkStateRecord() : await checkForeignRecord(st.code);
        const rec = st.home ? assetRef.current?.stateRecord : assetRef.current?.foreign?.[st.code]?.record;
        if (why) say({ label, tone: "warn", text: why });
        else {
          const findings = st.home && rec ? stateFindings(rec, assetRef.current ?? current).filter((f) => f.tone !== "info") : [];
          say({ label, tone: findings.length ? "warn" : "good", text: [rec?.status ? `Read · ${rec.status}` : "Read", ...findings.map((f) => f.text)].join(" ") });
        }
      }
      if (!plan.states.length) say({ label: "State records", tone: "muted", text: formingNow(current) ? "Read once the state approves the formation." : "Nothing to read: no state on record, or it's a trust or dissolved." });

      // 2. Palm's copy of the business, its agent and its mail.
      if (businessId) {
        step("Palm's copy");
        try {
          const latest = assetRef.current ?? current;
          const r = await palmCall<{ renamed: boolean; differences: { field: string; palm: string; ours: string }[] }>("business", {
            mode,
            businessId,
            assetId: id,
            entity: { name: latest.name, ein: latest.ein, fileNumber: latest.fileNumber, formationDate: latest.formationDate, address: latest.address },
          });
          const diff = r.differences.map((d) => `${d.field}: Palm has ${d.palm}, ours is ${d.ours}.`);
          say({
            label: "Palm's copy",
            tone: diff.length ? "warn" : "good",
            text: diff.length ? `${diff.join(" ")} Palm's API can't change these; correct them in Palm Console.` : r.renamed ? "Name updated to match." : "Matches our record.",
          });
        } catch (err) {
          say({ label: "Palm's copy", tone: "bad", text: (err as Error).message });
        }

        step("Agent and mail");
        const found = await refreshPalm(businessId, { busy: false, keepError: true, waitForImport: true });
        if (!found) {
          // Another read of Palm started meanwhile (the Refresh button, say): its answer is the one on the page.
          say({ label: "Agent and mail", tone: "muted", text: "Read again just now by the page; see Compliance." });
        } else {
        const st = found.service?.status ? RA_STATUS[found.service.status] : null;
        say({ label: "Registered agent", tone: found?.error && !found.service ? "bad" : st?.tone === "good" ? "good" : st ? "warn" : "muted", text: found?.error && found.service === undefined ? found.error : st ? st.label : "Palm isn't its agent." });
        if (found?.documents !== undefined) {
          const saved = found.saved ?? 0;
          const failed = found.failed ?? 0;
          say({
            label: "Mail",
            tone: failed ? "warn" : "good",
            text: !found.documents
              ? "No documents at Palm."
              : `${found.documents} document${found.documents === 1 ? "" : "s"} at Palm${
                  mode !== "live" ? " (test mode: not saved to Documents)" : failed ? `; ${saved} newly saved, ${failed} couldn't be saved (sync again)` : saved ? `; ${saved} newly saved to Documents` : "; all already in Documents"
                }${found.truncated ? ". More than 10,000: the oldest weren't read." : "."}`,
          });
        }
        }
      } else {
        say({ label: "Agent and mail", tone: "muted", text: "Not in Palm yet. Its agent and mail are read once Palm is the agent (Compliance → Make Palm the agent)." });
      }

      // 3. A formation under way, and Palm's open questions.
      if (formationId) {
        step("Formation");
        try {
          await palmCall("form-status", { assetId: id, filingId: formationId, mode });
          const f = assetRef.current?.palm?.[mode]?.formation;
          say({ label: "Formation", tone: "good", text: f?.status ? `Filing: ${f.status.replace(/_/g, " ")}` : "Up to date." });
        } catch (err) {
          say({ label: "Formation", tone: "bad", text: (err as Error).message });
        }
      }
      if (businessId || formationId) {
        step("Palm's questions");
        try {
          const { cases } = await palmCall<{ cases: { status: string }[] }>("cases", { assetId: id, mode });
          const waiting = cases.filter((c) => c.status === "needs_response").length;
          say({ label: "Palm's questions", tone: waiting ? "warn" : "good", text: waiting ? `${waiting} waiting on an answer (Compliance).` : "None open." });
          setPalmCasesTick((n) => n + 1);
        } catch (err) {
          say({ label: "Palm's questions", tone: "bad", text: (err as Error).message });
        }
      }
      if (moved()) throw MOVED;
      await patchAsset({ [`palm/${mode}/syncedAt`]: Date.now() });
    } catch (err) {
      if (err !== MOVED) throw err;
    } finally {
      // Left for another entity: its page has its own state now (reset when it opened).
      if (!moved()) {
        syncingRef.current = false;
        setPalmSync({ running: false, step: "", lines: [...lines], cents: plan.cents, mode, at: Date.now() });
      }
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
      await patchAsset({ [`palm/${mode}/ra`]: { status: service.status, name: service.name ?? null, address: formatPalmAddress(service.address) ?? null, checkedAt: Date.now() } });
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
      const { db, authReady } = await import("../store");
      await authReady;
      const { ref, update } = await import("../store");
      const patch: Record<string, unknown> = { profile: JSON.parse(JSON.stringify(profile)) };
      // The owners the governing documents list feed the paperwork checks,
      // unless a more specific document already supplied them.
      const owners = profile.members.filter((m) => m.name?.trim());
      if (owners.length && (!current.members?.length || current.membersSource === "governing documents" || fromStateRecord(current.membersSource))) {
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
      const { db, authReady } = await import("../store");
      await authReady;
      const { ref, update } = await import("../store");
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
    const { db, authReady } = await import("../store");
    await authReady;
    const { ref, update } = await import("../store");
    await update(ref(db, `assets/${id}`), {
      [field]: v,
      // A tax class taken from the document check counts as confirmed.
      ...(field === "llcType" ? { llcTypeSource: "Matched by the document check", llcTypeConflict: null } : {}),
    });
  }

  async function applyOwner(ownerId: string) {
    const { db, authReady } = await import("../store");
    await authReady;
    const { ref, update } = await import("../store");
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

  /** Copy a link to the document that expires (a signed link), never the permanent storage URL. */
  async function handleCopyDocUrl(doc: AssetDoc) {
    try {
      await copyStoredFileLink(doc);
    } catch (err) {
      await alertDialog("Couldn't copy a link", err instanceof Error ? err.message : undefined);
      return;
    }
    setCopiedDocId(doc.id);
    setTimeout(() => setCopiedDocId((v) => (v === doc.id ? null : v)), 1500);
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
      const { db, authReady } = await import("../store");
      await authReady;
      const { ref, update } = await import("../store");
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

  // ── Paperwork BFO writes ────────────────────────────────────────────────

  /** Put a generated PDF in Documents and file it in its slot (`replace`: in place of what's there, which stays in Documents). */
  async function fileGenerated(kind: FileKind, blob: Blob, name: string, replace = false) {
    setSlot(kind, { error: null, uploading: true, progress: 0 });
    try {
      const doc = await uploadDocFile(new File([blob], name, { type: "application/pdf" }), (pct) => setSlot(kind, { progress: pct }));
      if (replace)
        await patchAsset({
          [kind]: { url: doc.url, fileName: doc.name, size: doc.size ?? 0, contentType: "application/pdf", uploadedAt: Date.now(), storagePath: "", docId: doc.id } satisfies UploadedFile,
        });
      else await fileDocument(kind, doc);
    } catch (err) {
      setSlot(kind, { error: err instanceof Error ? err.message : "Couldn't save it." });
    } finally {
      setSlot(kind, { uploading: false, progress: 0 });
    }
  }

  const lookupAsset = (oid: string) => allAssets[oid] as Rec | undefined;

  /** One of the family's entities, by name: its mailing (else principal) address, for an owner that's a company here. */
  const assetAddressByName = (name: string): string | null => {
    const want = name.trim().toLowerCase();
    const hit = Object.values(allAssets).find((a) => (a.name ?? "").trim().toLowerCase() === want);
    return hit ? (hit.mailingAddress || hit.address || null) : null;
  };

  /** Fill in the IRS's W-9 from the record (a disregarded LLC's goes in its owner's name and TIN). */
  async function generateW9(replace = false) {
    const current = assetRef.current;
    if (!current) return;
    const data = w9Data({ ...current, ownerId: current.ownerId } as Rec, lookupAsset);
    const ok = await confirmDialog({
      title: "Fill in the W-9?",
      message: data.business
        ? `It's disregarded, so the W-9 is in ${data.name || "its owner"}'s name and TIN, with ${data.business} on line 2. It's left unsigned and editable.`
        : "BFO fills in the IRS's form from the record. It's left unsigned and editable.",
      details: data.notes.length ? data.notes : ["Everything it needs is on record."],
      confirmLabel: "Fill it in",
    });
    if (!ok) return;
    try {
      const form = await fetch("/forms/fw9.pdf").then((r) => {
        if (!r.ok) throw new Error("Couldn't load the IRS form.");
        return r.arrayBuffer();
      });
      const blob = await fillW9(data, form);
      await fileGenerated("w9", blob, `W-9 - ${current.name}.pdf`, replace);
    } catch (err) {
      setSlot("w9", { error: err instanceof Error ? err.message : "Couldn't fill in the W-9." });
    }
  }

  /** Draft the LLC's operating agreement from its members, state and tax class. */
  async function generateOperatingAgreement(replace = false) {
    const current = assetRef.current;
    if (!current) return;
    if (!canDraftAgreement(current)) {
      await alertDialog("Only for LLCs", "BFO drafts LLC operating agreements. Upload the bylaws or partnership agreement instead.");
      return;
    }
    const input = oaInput({ ...current } as Rec & { name: string }, lookupAsset);
    const problems = oaProblems(input);
    if (problems.length) {
      await alertDialog("Not enough to draft it yet", problems.join(" "));
      return;
    }
    const ok = await confirmDialog({
      title: replace ? "Draft the operating agreement again?" : "Draft the operating agreement?",
      message: `A ${input.members.length === 1 ? "single-member" : `${input.members.length}-member`}, ${input.managed === "managers" ? "manager" : "member"}-managed agreement under ${stateName(input.state)} law, effective ${fmtDate(input.effective)}. Have counsel read it before it's signed.`,
      details: input.members.map((m) => `${m.name}: ${m.percent}%`),
      confirmLabel: "Draft it",
    });
    if (!ok) return;
    try {
      const blob = await operatingAgreementPdf(operatingAgreement(input), current.name);
      await fileGenerated("operatingAgreement", blob, `Operating Agreement - ${current.name}.pdf`, replace);
      if (!current.operatingAgreementDate) await patchAsset({ operatingAgreementDate: input.effective });
    } catch (err) {
      setSlot("operatingAgreement", { error: err instanceof Error ? err.message : "Couldn't draft the agreement." });
    }
  }

  // ── Closing the entity down (app/entity-closing.ts) ──

  const today = () => new Date().toISOString().slice(0, 10);

  async function startClosing() {
    const current = assetRef.current;
    if (!current || current.closing) return;
    const ok = await confirmDialog({
      title: `Start closing ${current.name}?`,
      message: "BFO lists every step to close it down: the owners' consent, winding up, the state filing, the final return, the EIN, the agent and the mail. Nothing is filed until you do each step.",
      details: ["You can stop at any point and the entity stays as it is.", "Palm can't file a dissolution; the state filing is done on the state's site, linked from each step."],
      confirmLabel: "Start closing",
    });
    if (!ok) return;
    await patchAsset({ closing: { startedAt: today(), steps: {} } });
  }

  async function cancelClosing() {
    const current = assetRef.current;
    if (!current?.closing) return;
    const ok = await confirmDialog({ title: "Stop closing it?", message: "The steps marked done are cleared. Nothing filed with a state or the IRS is undone.", confirmLabel: "Stop closing", tone: "danger" });
    if (ok) await patchAsset({ closing: null });
  }

  async function markClosingStep(key: string, done: boolean) {
    await patchAsset({ [`closing/steps/${key.replace(/[/.#$[\]]/g, "_")}`]: done ? today() : null });
  }

  async function finishClosing() {
    const current = assetRef.current;
    if (!current?.closing) return;
    const left = stepsLeft(current);
    const ok = await confirmDialog({
      title: `Mark ${current.name} dissolved?`,
      message: "Its status becomes Dissolved: it drops out of compliance checks and the daily state check, and its record stays here.",
      details: left.length ? [`Still open: ${left.map((s) => s.title).join("; ")}.`] : ["Every step is done."],
      confirmLabel: "Mark dissolved",
      tone: left.length ? "danger" : "default",
    });
    if (ok) await patchAsset({ status: "Dissolved", "closing/closedAt": today() });
  }

  /** Ask Palm to stop serving as registered agent (only once the state has accepted the dissolution). */
  async function endPalmAgent(): Promise<string | null> {
    const current = assetRef.current;
    const businessId = current?.palm?.live?.businessId;
    if (!current || !businessId) return "This entity isn't linked to Palm.";
    const ok = await confirmDialog({
      title: "End Palm's registered agent service?",
      message: `Palm stops being ${current.name}'s registered agent. Do this only after the state has accepted the dissolution: a live entity without an agent falls out of good standing.`,
      confirmLabel: "End Palm's service",
      tone: "danger",
      requireText: current.name,
    });
    if (!ok) return null;
    try {
      const { service } = await palmCall<{ service: RaService }>("ra-end", { mode: "live", businessId, assetId: id });
      await patchAsset({ "palm/live/ra": { status: service.status, name: service.name ?? null, address: formatPalmAddress(service.address) ?? null, checkedAt: Date.now() }, "closing/steps/agent": today() });
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  }

  /** Draft a closing paper into Documents: the owners' consent to dissolve, or the letter closing the EIN account. */
  async function generateClosingDoc(kind: "consent" | "ein-letter"): Promise<string | null> {
    const current = assetRef.current;
    if (!current) return null;
    const { dissolutionConsent, dissolutionConsentPdf, einLetter, einLetterPdf } = await import("../closing-docs");
    try {
      let blob: Blob;
      let name: string;
      if (kind === "consent") {
        const doc = dissolutionConsent({ ...current } as Rec & { name: string }, lookupAsset);
        if (!doc.signers.length) return "Add its owners on the Owners tab first: the consent is signed by each of them.";
        blob = await dissolutionConsentPdf(doc, current.name);
        name = `Consent to Dissolve - ${current.name}.pdf`;
      } else {
        const letter = einLetter({ ...current } as Rec & { name: string }, current.closing?.steps?.["state:" + (stateCode(current.state) ?? "home")] ?? null);
        if (!letter.ein) return "No EIN on record.";
        blob = await einLetterPdf(letter);
        name = `IRS Letter to Close EIN Account - ${current.name}.pdf`;
      }
      const doc = await uploadDocFile(new File([blob], name, { type: "application/pdf" }), () => {});
      await openStoredFile(doc);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Couldn't draft it.";
    }
  }

  /** Fill in the IRS's Form 8822-B for an address change; it goes into Documents, unsigned. */
  async function generate8822B() {
    const current = assetRef.current;
    if (!current) return;
    const data = f8822bData(current);
    if (!data.ein) {
      await alertDialog("No EIN on record", data.notes[0]);
      return;
    }
    const ok = await confirmDialog({
      title: "Fill in Form 8822-B?",
      message: `${data.name} (${data.ein}), from ${data.oldAddress || "the old address"} to ${data.newAddress}. Sign it, then mail it to ${data.mailTo}.`,
      details: data.notes.length ? data.notes : ["Covers its tax returns (line 1). Signature, title and phone are left for you."],
      confirmLabel: "Fill it in",
    });
    if (!ok) return;
    const form = await fetch("/forms/f8822b.pdf").then((r) => {
      if (!r.ok) throw new Error("Couldn't load the IRS form.");
      return r.arrayBuffer();
    });
    const blob = await fill8822B(data, form);
    const doc = await uploadDocFile(new File([blob], `Form 8822-B - ${current.name}.pdf`, { type: "application/pdf" }), () => {});
    await openStoredFile(doc);
  }

  /** Mark where the address change has been reported (or undo it). */
  async function markAddressStep(step: "state" | "irs" | "banks", done: boolean) {
    await patchAsset({ [`addressUpdates/${step}`]: done ? new Date().toISOString().slice(0, 10) : null });
  }

  /**
   * Every document Palm holds for the entity, saved to Documents once: the
   * state's certificate, the IRS's EIN letter and the like also fill their
   * empty slot; notices, legal papers, receipts and agent confirmations are
   * kept as they are. Live mode only (sandbox files aren't the entity's), and
   * only for someone who can change the record. Returns how many were saved.
   */
  async function importPalmDocuments(list: PalmDocument[], mode: PalmMode): Promise<{ saved: number; failed: number }> {
    // One import at a time in this tab: a second (the page's refresh and a sync, say) waits, then finds them saved.
    const run = importQueue.current.then(() => importPalmDocumentsNow(list, mode));
    importQueue.current = run.catch(() => undefined);
    return run;
  }
  const importQueue = useRef<Promise<unknown>>(Promise.resolve());

  async function importPalmDocumentsNow(list: PalmDocument[], mode: PalmMode): Promise<{ saved: number; failed: number }> {
    const current = assetRef.current;
    if (!current || mode !== "live" || !id || !canChangeRecord()) return { saved: 0, failed: 0 };
    const epoch = palmEpoch.current;
    // What Documents holds now, read fresh: the list on screen may not have loaded yet.
    const { db, ref: dbRef, get, set } = await import("../store");
    const stored = ((await get(dbRef(db, `assets/${id}/documents`))).val() ?? {}) as Record<string, { palmDocumentId?: string }>;
    const have = new Set(Object.values(stored).map((d) => d?.palmDocumentId).filter(Boolean));
    let saved = 0;
    let failed = 0;
    // Oldest first, so Documents reads in the order Palm received them.
    for (const d of [...list].sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))) {
      if (epoch !== palmEpoch.current) break; // another entity opened: stop here, its page imports its own
      if (have.has(d.id)) continue;
      const kind = docKindOf(d);
      const slot = [kind, ...(d.types ?? []), d.type ?? ""].map((k) => PALM_SLOT[k]).find(Boolean);
      // Keyed by Palm's id (as the server's sync keys it), so two imports of one document land on one entry.
      const key = palmDocKey(d.id);
      try {
        if ((await get(dbRef(db, `assets/${id}/documents/${key}`))).exists()) continue;
        const blob = await fetchPalmDocument(d);
        const when = (d.created_at ?? d.upload_date ?? "").slice(0, 10);
        const name = d.filename || (slot ? `${filingTitle(slot, current)}.pdf` : `${DOC_LABEL[kind] ?? "Palm document"}${when ? ` ${when}` : ""}.pdf`);
        const file = new File([blob], name, { type: blob.type || "application/pdf" });
        const stored = await uploadToStorage(file, () => {}, () => {});
        const record = {
          name: name.replace(/\.[^.]+$/, ""),
          url: stored.url,
          storagePath: stored.path,
          storageProvider: "supabase" as const,
          size: file.size,
          contentType: file.type,
          createdAt: Date.now(),
          palmDocumentId: d.id,
          ...(kind ? { palmType: kind } : {}),
        };
        await set(dbRef(db, `assets/${id}/documents/${key}`), record);
        if (slot && !assetRef.current?.[slot]) await fileDocument(slot, { id: key, ...record } as AssetDoc);
        saved++;
      } catch (err) {
        console.error("Palm document import failed", d.id, err);
        failed++;
      }
    }
    return { saved, failed };
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
      const { db, ref: dbRef, update } = await import("../store");

      // The slot's own earlier file (not one filed from Documents) goes.
      const prior = asset?.[kind];
      if (prior?.storagePath && !prior.docId) {
        try {
          await deleteStoredFile(prior.storagePath);
        } catch {
          // ignore
        }
      }

      const stored = await uploadToStorage(file, (pct) => {
        if (pct > 0) setSlot(kind, { error: null });
        setSlot(kind, { progress: pct });
      }, () => setSlot(kind, { error: "Upload is stuck. Check your connection and try again." }));

      const meta: UploadedFile = {
        url: stored.url,
        fileName: file.name,
        size: file.size,
        contentType: file.type || "application/pdf",
        uploadedAt: Date.now(),
        storagePath: stored.path,
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
      const { db, authReady } = await import("../store");
      await authReady;
      const { ref: dbRef, update } = await import("../store");
      await update(dbRef(db, `assets/${id}`), { [kind]: null });
      await update(dbRef(db, `assets/${id}/documents/${file.docId}`), { autoFileSkip: true });
      return;
    }
    if (!(await confirmDialog({ title: `Remove the uploaded ${label}?`, message: "The file is deleted.", tone: "danger", confirmLabel: "Remove" }))) return;
    try {
      const { db, ref: dbRef, update } = await import("../store");
      try {
        if (file.storagePath) await deleteStoredFile(file.storagePath);
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
    const { db, authReady } = await import("../store");
    await authReady;
    const { ref, get, update, remove, set } = await import("../store");

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
          await deleteStoredFile(d.storagePath!);
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
    const { db } = await import("../store");
    const { ref, update } = await import("../store");
    await update(ref(db, `assets/${id}/corp`), { [field]: value });
  }

  async function addDirector() {
    if (!dirForm.name.trim()) return;
    const { db } = await import("../store");
    const { push, ref } = await import("../store");
    await push(ref(db, `assets/${id}/corp/directors`), { ...dirForm, name: dirForm.name.trim() });
    setDirForm({ name: "", title: "Director", since: "" });
    setAddingDirector(false);
  }

  async function removeDirector(dirId: string) {
    const { db } = await import("../store");
    const { ref, remove } = await import("../store");
    await remove(ref(db, `assets/${id}/corp/directors/${dirId}`));
  }

  async function addOfficer() {
    if (!offForm.name.trim() || !offForm.title.trim()) return;
    const { db } = await import("../store");
    const { push, ref } = await import("../store");
    await push(ref(db, `assets/${id}/corp/officers`), { ...offForm, name: offForm.name.trim(), title: offForm.title.trim() });
    setOffForm({ name: "", title: "", since: "" });
    setAddingOfficer(false);
  }

  async function removeOfficer(offId: string) {
    const { db } = await import("../store");
    const { ref, remove } = await import("../store");
    await remove(ref(db, `assets/${id}/corp/officers/${offId}`));
  }

  async function addShareholder() {
    if (!shForm.name.trim()) return;
    const { db } = await import("../store");
    const { push, ref } = await import("../store");
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
    const { db } = await import("../store");
    const { ref, remove } = await import("../store");
    await remove(ref(db, `assets/${id}/corp/shareholders/${shId}`));
  }

  async function generateMSATemplates() {
    if (!asset) return;
    const { db } = await import("../store");
    const { push, ref } = await import("../store");
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
    const { db } = await import("../store");
    const { push, ref } = await import("../store");
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
    const { db } = await import("../store");
    const { ref, remove } = await import("../store");
    await remove(ref(db, `assets/${id}/contracts/${contractId}`));
  }

  async function updateContractStatus(contractId: string, status: "draft" | "active" | "terminated") {
    const { db } = await import("../store");
    const { ref, update } = await import("../store");
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
    const { db } = await import("../store");
    const { ref, update } = await import("../store");
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

  return {
    id,
    tabParam,
    navigate,
    asset,
    setAsset,
    docs,
    setDocs,
    loading,
    setLoading,
    loadError,
    retryLoad,
    editing,
    setEditing,
    cancelEditing,
    savedAt,
    form,
    setForm,
    pendingScroll,
    activeTabRef,
    tabPath,
    goToTab,
    corpData,
    setCorpData,
    corpTab,
    setCorpTab,
    addingDirector,
    setAddingDirector,
    addingOfficer,
    setAddingOfficer,
    addingShareholder,
    setAddingShareholder,
    dirForm,
    setDirForm,
    offForm,
    setOffForm,
    shForm,
    setShForm,
    contracts,
    setContracts,
    addingContract,
    setAddingContract,
    contractForm,
    setContractForm,
    docName,
    setDocName,
    docUrl,
    setDocUrl,
    uploadState,
    setUploadState,
    kindsFor,
    filingNotes,
    setFilingNotes,
    sorting,
    setSorting,
    aiDown,
    setAiDownState,
    aiDownRef,
    setAiDown,
    scan,
    setScan,
    scanHideTimer,
    assetRef,
    claimedRef,
    setSlot,
    docDrop,
    setDocDrop,
    docQueueRef,
    docBatchRef,
    copiedDocId,
    setCopiedDocId,
    renamingDocId,
    setRenamingDocId,
    showLinkForm,
    setShowLinkForm,
    copied,
    setCopied,
    copiedEin,
    showDone,
    setShowDone,
    verifying,
    setVerifying,
    verifyError,
    setVerifyError,
    showMatches,
    setShowMatches,
    assetNames,
    setAssetNames,
    allAssets,
    setAllAssets,
    showRecommended,
    setShowRecommended,
    editingContractId,
    setEditingContractId,
    editContractForm,
    setEditContractForm,
    editBaseRef,
    startEditing,
    handleSave,
    handleAddDoc,
    handleDeleteDoc,
    uploadDocFile,
    fileDocument,
    applyTaxClass,
    applyRecordFacts,
    acceptDocumentTaxClass,
    dismissTaxClassConflict,
    fillTrustPeople,
    autoFile,
    autoFiledOnLoad,
    enriching,
    enrichFromDocument,
    recordValues,
    profiling,
    setProfiling,
    profileError,
    setProfileError,
    profileTried,
    palmStatus,
    setPalmStatus,
    formation,
    formationError,
    palmRa,
    setPalmRa,
    palmDocs,
    setPalmDocs,
    palmBusy,
    setPalmBusy,
    palmError,
    setPalmError,
    registryChoices,
    setRegistryChoices,
    palmMode,
    palmInbox,
    setPalmInbox,
    palmSeq,
    palmEpoch,
    palmMoving,
    patchAsset,
    loadPalmStatus,
    showPalmError,
    palmBusinessId,
    refreshPalm,
    checkStateRecord,
    checkForeignRecord,
    palmSync,
    setPalmSync,
    palmSyncPlan,
    syncWithPalm,
    palmCasesTick,
    assetAddressByName,
    startClosing,
    cancelClosing,
    markClosingStep,
    finishClosing,
    endPalmAgent,
    generateClosingDoc,
    foreignBusy,
    moveAgentToPalm,
    buildProfile,
    documentsForReading,
    runVerification,
    applyFinding,
    applyOwner,
    scanLibrary,
    handleUploadDocs,
    handleCopyDocUrl,
    handleRenameDoc,
    formatBytes,
    handleUploadFile,
    generateW9,
    generateOperatingAgreement,
    generate8822B,
    markAddressStep,
    handleDeleteFile,
    deleting,
    setDeleting,
    handleDeleteAsset,
    updateCorpField,
    addDirector,
    removeDirector,
    addOfficer,
    removeOfficer,
    addShareholder,
    removeShareholder,
    generateMSATemplates,
    addContract,
    deleteContract,
    updateContractStatus,
    startEditContract,
    saveEditContract,
    toggleService,
    directors,
    officers,
    shareholders,
    copyValue,
    handleCopyEin,
  };
}

export type EntityPage = ReturnType<typeof useEntityPage>;
