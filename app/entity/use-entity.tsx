import { useEffect, useRef, useState } from "react";
import { closingSteps, stepsLeft } from "../entity-closing";
import { RETENTION_DAYS } from "../../lib/entity-archive";
import { confirm, format, toast } from "../ui";
import { ownedBy } from "./derive";
import { isFormationDone } from "../formation";
import { raPatch } from "../../lib/palm-agent";
import { peoplePatch } from "../../lib/registry";
import { palmDocKey } from "../../lib/palm-docs";
import { dollars, STATE_RECORD_CENTS } from "../../lib/palm-pricing";
import { stateReadCost } from "../../lib/state-reads";
import { formingNow } from "../entity-addresses";
import {
  canDraftAgreement,
  f8822bData,
  fill8822B,
  fillW9,
  oaInput,
  oaProblems,
  operatingAgreement,
  operatingAgreementPdfWithBoxes,
  PALM_SLOT,
  w9Data,
  type Rec,
  type SignsFor,
} from "../paperwork-generate";
import { useNavigate, useParams } from "react-router";
import { authFetch, getUser, isAdmin, isPartner } from "../auth";
import { entityType, TAX_CLASSES } from "../entity-completeness";
import { alertDialog, confirmDialog } from "../confirm-dialog";
import { copyStoredFileLink, openStoredFile, SIGNED_LINK_MINUTES, storagePathOf, type StoredFileRef } from "../stored-file";
import { signApi } from "../sign/api";
import {
  DOC_LABEL,
  docKindOf,
  BUNDLE_FRESH_MS,
  fetchPalmDocument,
  effectiveRecord,
  formatAddress as formatPalmAddress,
  fromBundle,
  heldSeed,
  lookupStateRecord,
  normalizeName,
  palmCall,
  PalmCallError,
  palmJurisdiction,
  PalmUnavailable,
  RA_STATUS,
  recordLapsed,
  sameAddressText,
  sortDocuments,
  stateFindings,
  type PalmBundle,
  type PalmBundlePart,
  type PalmBundlePartName,
  type PalmDocument,
  type PalmLink,
  type PalmMode,
  type RaService,
  type RegistryRecord,
  type SeedHold,
} from "../palm";
import { documentRules, stateCode, stateName, type PaperworkInput } from "../entity-paperwork";
import {
  MSA_SERVICES,
  LEDGER_LOUISE_SUBS,
  normalizeServices,
  fmtDate,
  FILING_KINDS,
  filingTitle,
  guessFiling,
  CLASSIFIER_KIND,
  TAX_CLASS_KINDS,
  BY_HAND,
  fromDatabase,
  type Asset,
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
  tidyEin,
  docKind,
  changedFields,
  fieldList,
  KEY_FIELDS,
  FIELD_LABEL,
  normEntityName,
  withoutEntityName,
  type Member,
  type Proposal,
  type RemovedDoc,
} from "./model";

/**
 * Everything the entity page knows and does — the record and its documents,
 * filing, reading and verifying documents, Palm, contracts, corporate
 * records, editing and deleting — with no markup. The views render it.
 * (Moved unchanged from the old single-file page.)
 */
/** Foreign registrations as typed: blank fields dropped, a state with nothing left dropped (null when none). */
type PalmSyncLine = { label: string; tone: "good" | "warn" | "bad" | "muted"; text: string };
/** A sync with Palm under way (`step` is what it's reading) or just finished (`at`). */
type PalmSyncState = { running: boolean; step: string; lines: PalmSyncLine[]; cents: number; mode: PalmMode; at?: number };

/** The answer to the key-change question: a correction of the record, or a real change (with its effective date), and why. */
export type KeyChangeNote = { fields: string[]; kind: "correction" | "change"; reason: string; effective?: string | null };

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
    entityNameOnly: false,
  });

  // Doc form
  const [docName, setDocName] = useState("");
  const [docUrl, setDocUrl] = useState("");

  // Formation filing slots (EIN letter, W-9, Articles, Operating Agreement)
  const [uploadState, setUploadState] = useState<Record<FileKind, { uploading: boolean; progress: number; error: string | null; dragOver: boolean }>>(
    () =>
      Object.fromEntries(FILING_KINDS.map((k) => [k, { uploading: false, progress: 0, error: null, dragOver: false }])) as Record<
        FileKind,
        { uploading: boolean; progress: number; error: string | null; dragOver: boolean }
      >,
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
  // Slots being filed right now, with the document going into each.
  const claimedRef = useRef<Map<FileKind, string>>(new Map());
  const setSlot = (k: FileKind, patch: Partial<{ uploading: boolean; progress: number; error: string | null; dragOver: boolean }>) => setUploadState((s) => ({ ...s, [k]: { ...s[k], ...patch } }));

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
    entityNameOnly: false,
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
        () => setLoadError(true),
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
          setAssetNames(
            Object.fromEntries(
              Object.entries(all)
                .filter(([, v]) => v?.name)
                .map(([k, v]) => [k, v.name as string]),
            ),
          );
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
    setSaveError("");
    setKeyChange(null);
    setEditing(true);
    if ((tabParam ?? "overview") === "overview") setTimeout(() => document.getElementById("entity-edit")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    else goToTab("overview", "entity-edit");
  }

  /**
   * Save the edit form. Only fields the person changed override the record,
   * so anything filled in the background meanwhile is kept. A blank status
   * stays blank. A new principal office (or mailing address) records the old
   * one and the date, which starts the Address change steps. A changed tax
   * class joins the class's history with its effective date; `note` (from
   * the key-change question) says whether a key fact was corrected or
   * really changed, and why.
   */
  async function handleSave(note?: KeyChangeNote | null) {
    if (!form.name?.trim()) return;
    const base = editBaseRef.current;
    const live = assetRef.current ?? ({} as Partial<Asset>);
    const pick = <K extends keyof Asset>(k: K) => ((form[k] ?? "") !== (base[k] ?? "") ? form[k] : (live[k] ?? form[k]));
    const { db } = await import("../store");
    const { ref, update } = await import("../store");
    const me = getUser();
    const now = Date.now();
    // Changing the tax class by hand records that it came from a person; a
    // pending document conflict is settled when the hand value matches it.
    const classChanged = (form.llcType ?? "") !== (base.llcType ?? "");
    const conflict = live.llcTypeConflict;
    const provenance = classChanged
      ? {
          llcTypeSource: form.llcType ? BY_HAND : null,
          llcTypeConflict: conflict && conflict.value !== form.llcType ? conflict : null,
          proposed: { ...(live.proposed ?? {}), llcType: null },
          llcTypeHistory: [
            ...(live.llcTypeHistory ?? []),
            {
              value: form.llcType || "",
              from: base.llcType || null,
              kind: note?.kind === "change" ? ("election" as const) : ("correction" as const),
              effective: note?.kind === "change" ? (note.effective ?? null) : null,
              reason: note?.reason ?? null,
              by: me?.name ?? null,
              at: now,
            },
          ],
        }
      : {};
    const agentChanged = (form.registeredAgent ?? "") !== (base.registeredAgent ?? "");
    // A move: the old address and the day, so the Address change card lists who still has the old one.
    const address = String(pick("address") ?? "").trim();
    const mailing = sameAddressText(pick("mailingAddress"), pick("address")) ? "" : String(pick("mailingAddress") ?? "").trim();
    const oldMail = (base.mailingAddress || base.address || "").trim();
    const newMail = mailing || address;
    const moved = !!oldMail && !!newMail && !sameAddressText(oldMail, newMail) && ((form.address ?? "") !== (base.address ?? "") || (form.mailingAddress ?? "") !== (base.mailingAddress ?? ""));
    const move = moved ? { previousAddress: oldMail, addressChangedAt: today(), addressUpdates: null, addressUpdateRefs: null } : {};
    await update(ref(db, `assets/${id}`), {
      ...provenance,
      ...move,
      ...(agentChanged ? { registeredAgentSource: null } : {}),
      ...(note ? { changeNote: { fields: note.fields, kind: note.kind, reason: note.reason, effective: note.effective ?? null, by: me?.name ?? null, at: now } } : {}),
      name: String(pick("name") ?? "").trim(),
      type: form.type,
      state: pick("state") || "",
      ein: tidyEin(pick("ein")),
      registeredAgent: pick("registeredAgent") || "",
      address,
      mailingAddress: mailing,
      registeredAgentAddress: (pick("registeredAgentAddress") || "").trim(),
      foreign: cleanForeign(pick("foreign")),
      formationDate: pick("formationDate") || "",
      // Never a status nobody chose: blank stays blank.
      status: pick("status") || "",
      notes: pick("notes") || "",
      llcType: pick("llcType") || "",
      taxYearEnd: pick("taxYearEnd") || "",
      accountingMethod: pick("accountingMethod") || "",
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
    if (moved) toast({ message: "Saved. The Address change card lists who still has the old address." });
  }

  /** What the form changed, field by field (label, before, after). */
  function formChanges() {
    return changedFields(editBaseRef.current as Record<string, unknown>, form as Record<string, unknown>);
  }

  /** Has the edit form moved from what it started with? */
  function formDirty() {
    const base = editBaseRef.current as Record<string, unknown>;
    const f = form as Record<string, unknown>;
    const same = (a: unknown, b: unknown) => JSON.stringify(a ?? "") === JSON.stringify(b ?? "");
    return Object.keys({ ...base, ...f }).some((k) => !same(f[k], base[k]));
  }

  /**
   * The key facts this edit changes that were already on record (legal name,
   * form, tax class, EIN): each can be a correction or a real change that
   * needs a filing, so Save asks first.
   */
  function keyChanges(): { key: string; label: string; from: string; to: string }[] {
    const base = editBaseRef.current as Record<string, unknown>;
    return formChanges().filter((c) => (KEY_FIELDS as readonly string[]).includes(c.key) && String(base[c.key] ?? "").trim() !== "");
  }

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  /** The key-change question, open while Save waits for its answer. */
  const [keyChange, setKeyChange] = useState<{ key: string; label: string; from: string; to: string }[] | null>(null);

  /** Save from the header, the form or the phone's bar: asks about key facts first, then saves. */
  async function saveEdits(note?: KeyChangeNote | null) {
    if (!form.name?.trim() || saving) return;
    const keys = keyChanges();
    if (keys.length && !note) {
      setKeyChange(keys);
      return;
    }
    setKeyChange(null);
    setSaving(true);
    setSaveError("");
    try {
      await handleSave(note);
    } catch (err) {
      console.error("save failed", err instanceof Error ? err.name : "error");
      setSaveError(err instanceof Error && /owner or an admin/i.test(err.message) ? err.message : "Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  /** Leave the edit form; asks first when that would throw away typing, naming what would be lost. */
  async function cancelEditing() {
    if (formDirty()) {
      const changes = formChanges();
      const ok = await confirm({
        title: "Discard changes?",
        message: changes.length ? `Your edits to ${fieldList(changes.map((c) => c.label))} won’t be saved.` : "Your edits won’t be saved.",
        details: changes
          .filter((c) => c.key !== "notes" && c.key !== "foreign")
          .slice(0, 5)
          .map((c) => `${c.label[0].toUpperCase()}${c.label.slice(1)}: ${c.from || "blank"} → ${c.to || "blank"}`),
        confirmLabel: "Discard changes",
        cancelLabel: "Keep editing",
        focus: "cancel",
      });
      if (!ok) return;
    }
    setKeyChange(null);
    setSaveError("");
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

  /**
   * Take a document out of the library. It moves to Removed, where it's kept
   * and can be restored; only an owner or admin can delete it for good, after
   * RETENTION_DAYS (api/documents/delete.ts). A document on file for a
   * required row, or a signed one, is an owner's or admin's call and asks
   * for its name to be typed.
   */
  async function handleDeleteDoc(docId: string) {
    const current = assetRef.current;
    const doc = docs.find((d) => d.id === docId);
    if (!current || !doc) return;
    const filedAs = FILING_KINDS.filter((k) => current[k]?.docId === docId);
    const titles = filedAs.map((k) => filingTitle(k, current));
    const weighty = filedAs.length > 0 || /\bsigned\b|executed/i.test(doc.name);
    if (weighty && !isAdmin()) {
      await alertDialog("Ask an owner or admin", `${titles.length ? `It’s the ${titles.join(" and ")} on file` : "It’s a signed document"}, so only an owner or an admin can remove it.`);
      return;
    }
    if (current.legalHold) {
      await alertDialog("This entity is on legal hold", "Its documents can’t be removed while the hold is on.");
      return;
    }
    const added = doc.createdAt ? format.date(new Date(doc.createdAt), "medium") : "";
    const ok = await confirm({
      title: "Remove this document?",
      object: { name: doc.name, detail: [docKind(doc) === "LINK" || docKind(doc) === "FILE" ? null : docKind(doc), formatBytes(doc.size), added && `added ${added}`].filter(Boolean).join(" · ") },
      message: `${titles.length ? `It’s the ${titles.join(" and ")} on file, so ${titles.length === 1 ? "that row" : "those rows"} will show as missing. ` : ""}It moves to Removed, where it’s kept and can be restored. An owner or admin can delete it for good after ${RETENTION_DAYS} days.`,
      confirmLabel: "Remove document",
      tone: weighty ? "danger" : "default",
      typeToConfirm: weighty ? doc.name : undefined,
      focus: "cancel",
    });
    if (!ok) return;
    const me = getUser();
    const { id: _id, ...rest } = doc;
    const removed: RemovedDoc = { ...rest, removedAt: Date.now(), removedBy: me?.name ?? null, filedAs: titles.join(", ") || null };
    await patchAsset({
      ...Object.fromEntries(filedAs.map((k) => [k, null])),
      [`documents/${docId}`]: null,
      [`removedDocuments/${docId}`]: JSON.parse(JSON.stringify(removed)),
    });
    toast({ message: `Removed “${doc.name}”`, action: { label: "Undo", run: () => void restoreDoc(docId, filedAs) } });
  }

  /** Put a removed document back in the library (and back on its rows, when they're still empty). */
  async function restoreDoc(docId: string, refile: FileKind[] = []) {
    const current = assetRef.current;
    const r = current?.removedDocuments?.[docId];
    if (!current || !r) return;
    const { removedAt: _a, removedBy: _b, reason: _c, filedAs: _d, ...doc } = r;
    const slots = refile.filter((k) => !current[k]);
    await patchAsset({
      [`documents/${docId}`]: JSON.parse(JSON.stringify(doc)),
      [`removedDocuments/${docId}`]: null,
      ...Object.fromEntries(
        slots.map((k) => [
          k,
          { url: doc.url, fileName: doc.name, size: doc.size ?? 0, contentType: doc.contentType || "application/pdf", uploadedAt: doc.createdAt || Date.now(), storagePath: "", docId } satisfies UploadedFile,
        ]),
      ),
    });
  }

  /**
   * Delete a removed document for good: owners and admins, after the hold,
   * with a reason (the Removed list's dialog asks for it and the typed name;
   * the server checks each). Returns why it couldn't, or null.
   */
  async function purgeDoc(docId: string, reason: string): Promise<string | null> {
    const res = await authFetch("/api/documents/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId: id, docId, reason }),
    });
    if (res.ok) return null;
    const j = await res.json().catch(() => ({}));
    return (j as { message?: string }).message || "It couldn’t be deleted. Try again.";
  }

  /** Put the entity's documents on legal hold, or lift it (owners and admins). */
  async function setLegalHold(on: boolean, note = "") {
    const me = getUser();
    await patchAsset({ legalHold: on ? { at: Date.now(), by: me?.name ?? null, note: note || null } : null });
  }

  // Upload one document: signed URL → PUT with progress → its record in the tree.
  // Throws on failure; progress is reported as a 0–100 fraction of this file.
  async function uploadDocFile(file: File, onProgress: (pct: number) => void, extra: Partial<AssetDoc> = {}) {
    const stored = await uploadToStorage(
      file,
      (pct) => {
        setDocDrop((s) => ({ ...s, error: null }));
        onProgress(pct);
      },
      () => setDocDrop((s) => ({ ...s, error: "Upload is stuck. Check your connection and try again." })),
    );

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
      addedBy: getUser()?.name ?? null,
      ...extra,
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


  // ── Facts read by AI: proposals until a person accepts them (DESIGN.md §11.6) ──

  /** Put a value read by AI from a document on the record as a proposal (never as fact), unless the field is filled or already proposed. */
  function propose(patch: Record<string, unknown>, field: string, value: string | Member[] | null | undefined, doc: { name: string }, source?: string): boolean {
    const current = assetRef.current;
    if (!current || value == null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && !value.length)) return false;
    const have = (current as unknown as Record<string, unknown>)[field];
    if (Array.isArray(have) ? have.length : typeof have === "string" ? have.trim() : have) return false;
    if (current.proposed?.[field] || patch[`proposed/${field}`]) return false;
    const proposal: Proposal = { value, source: source ?? `Read by AI from “${doc.name}”`, docName: doc.name, at: Date.now() };
    patch[`proposed/${field}`] = JSON.parse(JSON.stringify(proposal));
    return true;
  }

  /** The facts a filing states (EIN, dates, state), proposed where the record is blank. Returns what was proposed, in words. */
  function proposeFromFiling(patch: Record<string, unknown>, kind: FileKind, facts: Classified, doc: { name: string }): string[] {
    const out: string[] = [];
    if ((kind === "einLetter" || kind === "w9") && propose(patch, "ein", facts.ein, doc)) out.push(`EIN ${facts.ein}`);
    if (kind === "articles" && facts.date) {
      if (propose(patch, "formationDate", facts.date, doc)) out.push(`formed ${fmtDate(facts.date)}`);
      if (propose(patch, "articlesOfOrgDate", facts.date, doc) && !out.length) out.push(`articles filed ${fmtDate(facts.date)}`);
    }
    if ((kind === "trustAgreement" || kind === "trustCertificate") && propose(patch, "formationDate", facts.date, doc)) out.push(`trust dated ${fmtDate(facts.date ?? "")}`);
    if ((kind === "trustAgreement" || kind === "articles") && propose(patch, "state", facts.state, doc)) out.push(kind === "trustAgreement" ? `governed by ${facts.state} law` : `${facts.state}`);
    if (kind === "operatingAgreement" && propose(patch, "operatingAgreementDate", facts.date, doc)) out.push(`agreement dated ${fmtDate(facts.date ?? "")}`);
    return out;
  }

  /** Accept what AI read: the value goes on the record (and who accepted it is in Activity). */
  async function acceptProposal(field: string) {
    const current = assetRef.current;
    const p = current?.proposed?.[field];
    if (!current || !p) return;
    const extra: Record<string, unknown> =
      field === "llcType"
        ? { llcTypeSource: p.source, llcTypeConflict: null }
        : field === "members"
          ? { membersSource: p.docName ?? "governing documents" }
          : field === "registeredAgent"
            ? { registeredAgentSource: p.source }
            : {};
    await patchAsset({ [field]: p.value, ...extra, [`proposed/${field}`]: null });
  }

  /** Dismiss what AI read: nothing changes on the record. */
  async function dismissProposal(field: string) {
    await patchAsset({ [`proposed/${field}`]: null });
  }

  // ── Auto-filing ─────────────────────────────────────────────────────────
  // Point an empty filing slot at a Documents entry (no second copy) and fill
  // any blank key facts the document states. Never overwrites a filled slot
  // or a filled fact.
  async function fileDocument(kind: FileKind, doc: AssetDoc, facts?: Classified | null): Promise<string[]> {
    const current = assetRef.current;
    if (!current || current[kind] || claimedRef.current.has(kind)) return [];
    claimedRef.current.set(kind, doc.id);
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
    // Only take a document's facts when the reader agrees on what it is, and only as proposals.
    const filled = facts && CLASSIFIER_KIND[facts.kind] === kind ? proposeFromFiling(patch, kind, facts, doc) : [];
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
      if (!propose(patch, "llcType", tc, doc, source)) return;
      note = `tax class ${tc}, to accept`;
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
    if (agent && entityType(current) !== "Trust" && propose(patch, "registeredAgent", agent, doc)) added.push(`agent ${agent}`);
    if (propose(patch, "address", facts.principalAddress?.trim(), doc)) added.push("principal address");
    const owners = (facts.members ?? []).filter((m) => m?.name?.trim());
    const ownerKinds = new Set(["operatingAgreement", "ownershipLedger", "articles", "annualReport"]);
    // Owners from a document replace a list filled from the state's record; they're proposed, not recorded.
    if (owners.length && ownerKinds.has(CLASSIFIER_KIND[facts.kind] ?? "") && (!current.members?.length || fromStateRecord(current.membersSource)) && !current.proposed?.members) {
      const list = owners.map((m) => ({ name: m.name.trim(), percent: typeof m.percent === "number" ? m.percent : null, role: m.role ?? null }));
      patch["proposed/members"] = JSON.parse(JSON.stringify({ value: list, source: `Read by AI from “${doc.name}”`, docName: doc.name, at: Date.now() } satisfies Proposal));
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
    const line = `Read “${doc.name}” · ${added.join(", ")}: accept on Overview`;
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
    const patch: Record<string, unknown> = {};
    const added: string[] = [];
    for (const key of ["trustees", "grantors", "beneficiaries"] as const) {
      const v = facts[key]?.trim();
      if (propose(patch, key, v, doc)) added.push(`${key} ${v}`);
    }
    if (!added.length) return;
    const { db, authReady } = await import("../store");
    await authReady;
    const { ref, update } = await import("../store");
    await update(ref(db, `assets/${id}`), patch);
    const note = `Read “${doc.name}” · ${added.join("; ")}: accept on Overview`;
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
    // Already filed into it, by name, while it was being read.
    if (assetRef.current?.[kind]?.docId === doc.id || claimedRef.current.get(kind) === doc.id) return `Filed “${doc.name}” as ${title}`;
    if (assetRef.current?.[kind] || claimedRef.current.has(kind)) {
      return `${title} already on file — kept “${doc.name}” in Documents`;
    }
    const filled = await fileDocument(kind, doc, facts);
    return `Filed “${doc.name}” as ${title}${filled.length ? ` · read ${filled.join(", ")}: accept on Overview` : ""}`;
  }

  // Documents already in the library whose names say what they are get filed
  // into empty slots on load (name match only — no reading, no cost).
  const autoFiledOnLoad = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!asset || !canChangeRecord()) return;
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
    const classUnconfirmed = entityType(asset) !== "Trust" && (!asset.llcTypeSource || asset.llcTypeSource === BY_HAND) && !asset.llcTypeConflict;
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
      const filled = proposeFromFiling(patch, kind, facts, doc);
      const { db, authReady } = await import("../store");
      await authReady;
      const { ref, update } = await import("../store");
      if (Object.keys(patch).length) await update(ref(db, `assets/${id}`), patch);
      await update(ref(db, `assets/${id}/documents/${doc.id}`), { factsCheckedAt: Date.now(), classReadAt: Date.now() });
      if (filled.length) setFilingNotes((n) => [...n, `Read “${doc.name}” · ${filled.join(", ")}: accept on Overview`]);
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
  /**
   * Parts of the opening bundle the page itself doesn't show, held a few
   * seconds for the cards that do (Mail, Palm's questions, Monitoring). Each
   * is handed out once; a card mounting later reads Palm itself, as before.
   */
  const palmParts = useRef<{ key: string; at: number; parts: Partial<Record<PalmBundlePartName, PalmBundlePart<unknown>>> } | null>(null);
  /** The bundle's reading of the agent and mail when Palm answered before the record arrived; applied once it has. */
  const pendingRead = useRef<{ raR: PromiseSettledResult<{ service: RaService | null }>; docsR: PromiseSettledResult<{ documents: PalmDocument[]; truncated?: boolean }>; mode: PalmMode } | null>(
    null,
  );
  function takePalmPart<T>(name: PalmBundlePartName, key: string): PalmBundlePart<T> | null {
    const held = palmParts.current;
    if (!held || held.key !== key || Date.now() - held.at > BUNDLE_FRESH_MS) return null;
    const part = held.parts[name];
    delete held.parts[name];
    return (part as PalmBundlePart<T> | undefined) ?? null;
  }
  const inboxSeed = useRef<SeedHold<{ events: typeof palmInbox }> | null>(null);
  useEffect(() => {
    if (!palmMode || !id || tabParam !== "compliance") return;
    let live = true;
    // The bundle's copy when the page just opened on this tab; its own read otherwise.
    const key = `${id}:${palmMode}`;
    const seed = heldSeed(inboxSeed, key, () => takePalmPart("inbox", key));
    (seed ? fromBundle(seed) : palmCall<{ events: typeof palmInbox }>("inbox", { assetId: id, mode: palmMode }))
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

  /**
   * What the bundle read of the business: "pending" while it's out, then
   * "<mode>:<businessId>" so the agent-and-mail effect below doesn't read the
   * same thing again, or null when the entity isn't in Palm (or the read failed).
   */
  const bundled = useRef<string | null>(null);

  /**
   * Everything the page reads from Palm when it opens, in one round trip
   * (api/palm.ts "entity-bundle"): the status, then the agent and mail for
   * the business linked in that mode (applied exactly as refreshPalm would),
   * and the parts the cards show, held for them in palmParts.
   */
  async function loadPalmBundle(id: string): Promise<void> {
    // Stale once the page moved to another entity, or another read of Palm started after this one (palmSeq moved past the effect's snapshot).
    const stale = () => bundledFor.current !== id || palmSeq.current !== bundleSeq.current;
    bundled.current = "pending";
    // Only what the cards on this tab would read for themselves.
    const tab = tabParam ?? "overview";
    const parts = ["ra", "documents", ...(tab === "compliance" ? ["inbox", "cases", "monitors"] : tab === "overview" ? ["inboxUnread", "cases"] : [])];
    let b: PalmBundle;
    try {
      b = await palmCall<PalmBundle>("entity-bundle", { assetId: id, parts });
    } catch (err) {
      if (bundledFor.current !== id) return;
      bundled.current = null;
      setPalmStatus({ configured: false, mode: null, error: err instanceof Error ? err.message : "Couldn't reach Palm." });
      return;
    }
    if (bundledFor.current !== id) return;
    const status = b.status?.ok ? b.status.value : { configured: false, mode: null, error: b.status?.error?.message ?? "Palm didn't answer." };
    const mode = status.mode;
    const businessId = mode ? (b.businessId ?? null) : null;
    bundled.current = mode && businessId ? `${mode}:${businessId}` : null;
    palmParts.current = mode ? { key: `${id}:${mode}`, at: Date.now(), parts: { inbox: b.inbox, inboxUnread: b.inboxUnread, cases: b.cases, monitors: b.monitors } } : null;
    setPalmStatus(status);
    if (!mode || !businessId || stale()) return;
    if (palmMoving.current) return; // the move refreshes once it's done
    const settled = <T,>(part: PalmBundlePart<T> | undefined): PromiseSettledResult<T> =>
      part?.ok ? { status: "fulfilled", value: part.value } : { status: "rejected", reason: new PalmCallError(part?.error.message ?? "Palm didn't answer.", part?.error.code, part?.error.status) };
    const read = { raR: settled(b.ra), docsR: settled(b.documents), mode };
    if (!assetRef.current) {
      // Palm answered before the record did (rare): the agent-and-mail effect below applies this once the record is here.
      pendingRead.current = read;
      return;
    }
    setPalmError("");
    await applyPalmRead(read.raR, read.docsR, mode, {});
  }

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
    palmParts.current = null;
    pendingRead.current = null;
  }, [id]);

  // The opening read, once per entity (React's development re-run of a mount effect included).
  const bundledFor = useRef<string | null>(null);
  /** palmSeq as the reset above left it; a read started later moves palmSeq past it, and the bundle's answer is then dropped. */
  const bundleSeq = useRef(0);
  useEffect(() => {
    bundleSeq.current = palmSeq.current;
    // An invited owner's page has no Palm card.
    if (!id || isPartner() || bundledFor.current === id) return;
    bundledFor.current = id;
    void loadPalmBundle(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // The opening bundle reads (or read) the agent and mail along with the status; nothing to do until the business changes.
    if (bundled.current === "pending") return;
    if (palmBusinessId && bundled.current === `${palmMode}:${palmBusinessId}`) {
      // The record has arrived: apply what the bundle read, exactly as a read made now would be.
      const held = pendingRead.current;
      if (held && held.mode === palmMode && assetRef.current) {
        pendingRead.current = null;
        setPalmError("");
        void applyPalmRead(held.raR, held.docsR, held.mode, {});
      }
      return;
    }
    if (!palmBusinessId) {
      // The record is still on its way, but the bundle found the business in this mode: keep what it read.
      if (bundled.current?.startsWith(`${palmMode}:`)) return;
      // Never added to Palm in this mode, so Palm isn't its agent.
      bundled.current = null;
      setPalmRa(null);
      setPalmDocs(null);
      return;
    }
    if (palmMoving.current) return; // the move refreshes once it's done
    bundled.current = null;
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
      return await applyPalmRead(raR, docsR, mode, opts);
    } finally {
      if (busy) setPalmBusy(null);
    }
  }

  /** What a read of the agent service and documents (refreshPalm's, or the opening bundle's) does to the page and the record. */
  async function applyPalmRead(
    raR: PromiseSettledResult<{ service: RaService | null }>,
    docsR: PromiseSettledResult<{ documents: PalmDocument[]; truncated?: boolean }>,
    mode: PalmMode,
    opts: { keepError?: boolean; waitForImport?: boolean },
  ): Promise<{ service?: RaService | null; documents?: number; saved?: number; failed?: number; truncated?: boolean; error?: string }> {
    const found: { service?: RaService | null; documents?: number; saved?: number; failed?: number; truncated?: boolean; error?: string } = {};
    if (docsR.status === "fulfilled") {
      setPalmDocs(sortDocuments(Array.isArray(docsR.value.documents) ? docsR.value.documents : []));
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
      const last = current.palm?.[mode]?.syncedAt;
      const ok = await confirm({
        title: `Sync ${current.name} with Palm?`,
        message: `Palm bills for reading the state’s records: at most ${dollars(plan.cents)}, less when a name search finds nothing. Everything else is free. ${last ? `Last synced ${format.date(new Date(last), "medium")}.` : "Never synced before."}`,
        receipt: {
          lines: plan.states.map((st) => ({
            label: `${stateName(st.code) || st.code}${st.home ? "" : " (foreign)"} state record${st.cents < STATE_RECORD_CENTS ? "" : ", by name"}`,
            cents: st.cents,
          })),
        },
        details: [
          businessId ? "Palm’s copy of the business, its agent and its mail: free. Its mail is saved to Documents." : "Its agent and mail are read once Palm is its agent.",
          ...(businessId ? ["Palm’s display name for it is set to match ours."] : []),
          `Billed to the office’s Palm account and logged against ${current.name}.`,
          "Nothing is filed with the state, and nothing on the record is overwritten: blanks are filled, differences are flagged.",
        ],
        confirmLabel: `Sync for up to ${dollars(plan.cents)}`,
        tone: "commit",
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
          const shown = st.home && rec ? effectiveRecord(rec, (assetRef.current ?? current).stateConfirmed) : rec;
          const notes =
            st.home && rec
              ? stateFindings(rec, assetRef.current ?? current)
                  .filter((f) => f.tone === "info")
                  .map((f) => f.text)
              : [];
          say({ label, tone: findings.length ? "warn" : "good", text: [shown?.status ? `Read · ${shown.status}` : "Read", ...findings.map((f) => f.text), ...notes].join(" ") });
        }
      }
      if (!plan.states.length)
        say({
          label: "State records",
          tone: "muted",
          text: formingNow(current) ? "Read once the state approves the formation." : "Nothing to read: no state on record, or it's a trust or dissolved.",
        });

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
          say({
            label: "Registered agent",
            tone: found?.error && !found.service ? "bad" : st?.tone === "good" ? "good" : st ? "warn" : "muted",
            text: found?.error && found.service === undefined ? found.error : st ? st.label : "Palm isn't its agent.",
          });
          if (found?.documents !== undefined) {
            const saved = found.saved ?? 0;
            const failed = found.failed ?? 0;
            say({
              label: "Mail",
              tone: failed ? "warn" : "good",
              text: !found.documents
                ? "No documents at Palm."
                : `${found.documents} document${found.documents === 1 ? "" : "s"} at Palm${
                    mode !== "live"
                      ? " (test mode: not saved to Documents)"
                      : failed
                        ? `; ${saved} newly saved, ${failed} couldn't be saved (sync again)`
                        : saved
                          ? `; ${saved} newly saved to Documents`
                          : "; all already in Documents"
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
      await alertDialog("Check the state record first", "Palm needs the state's file number for this entity, and it can't be added later. Click “Check state record”, then try again.");
      return;
    }
    const live = mode === "live";
    const oldAgent = current.registeredAgentSource?.startsWith("Palm") ? undefined : current.registeredAgent?.replace(/\.+$/, "");
    const lapsed = rec && recordLapsed(effectiveRecord(rec, current.stateConfirmed));
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
              ? [
                  `The state's record shows ${rec?.status && rec.status !== "active" ? rec.status : "it isn't in good standing"}. The state may refuse the change until the overdue filing and fees are paid.`,
                ]
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
      if (owners.length && (!current.members?.length || fromStateRecord(current.membersSource)) && !current.proposed?.members) {
        const source = profile.sources.length ? profile.sources.join(", ") : "the governing documents";
        patch["proposed/members"] = JSON.parse(
          JSON.stringify({ value: owners.map((m) => ({ name: m.name, percent: m.percent ?? null, role: "member" })), source: `Summary by AI from ${source}`, docName: source, at: Date.now() } satisfies Proposal),
        );
      }
      await update(ref(db, `assets/${id}`), patch);
      if (profile.taxTreatment) {
        await applyTaxClass(
          { kind: "operating_agreement", confidence: "high", ein: null, date: null, state: null, taxClassification: profile.taxTreatment, taxClassificationEvidence: profile.taxEvidence },
          { id: "profile", name: profile.sources[0] ?? "the governing documents", url: "", createdAt: 0 },
        );
      }
    } catch (err) {
      console.error("profile failed", err);
      setProfileError("Couldn't read the documents — try again.");
    } finally {
      setProfiling(false);
    }
  }

  // The summary is read only when someone asks (About's Read button): documents go to Anthropic on a click, not on opening the page.

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
    return [...slotOnly, ...readable.map((d) => ({ name: d.name, url: d.url, contentType: d.contentType, filedAs: filedAs.get(d.id) ?? null }))];
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
          entity: { ...record, owner: asset.ownerId ? (assetNames[asset.ownerId] ?? null) : null },
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
    if (!current || !canChangeRecord()) return;
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
        error: failures.length > 0 ? `${failures.length} of ${total} failed: ${failures.map((f) => `${f.name} (${f.reason})`).join(", ")}` : null,
      }));
    }
  }

  /**
   * Copy a link to the document that expires (a signed link), never the
   * permanent storage URL. Our own files go through the share form of the
   * link endpoint, which records in Activity who copied a link to what.
   */
  async function handleCopyDocUrl(doc: AssetDoc) {
    try {
      if (doc.storagePath) {
        const link = authFetch(`/api/documents/url?${new URLSearchParams({ path: doc.storagePath, share: "1" })}`).then(async (r) => {
          const j = (await r.json().catch(() => ({}))) as { url?: string; message?: string };
          if (!r.ok || !j.url) throw new Error(j.message || "Couldn’t make a link.");
          return j.url;
        });
        if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
          await navigator.clipboard.write([new ClipboardItem({ "text/plain": link.then((u) => new Blob([u], { type: "text/plain" })) })]);
        } else await navigator.clipboard.writeText(await link);
      } else await copyStoredFileLink(doc);
    } catch (err) {
      await alertDialog("Couldn't copy a link", err instanceof Error ? err.message : undefined);
      return;
    }
    setCopiedDocId(doc.id);
    toast({ message: doc.storagePath ? `Copied a ${SIGNED_LINK_MINUTES}-minute link to “${doc.name}”` : "Copied the link" });
    setTimeout(() => setCopiedDocId((v) => (v === doc.id ? null : v)), 1500);
  }

  /** A stored PDF goes out for signature: a request under this entity, the members as the parties, then its page to place the fields and send. */
  /**
   * A stored PDF goes out for signature: a request under this entity, then its page to place the fields and send.
   * The drafted operating agreement brings its own: the signers as the parties (the family's company through its
   * manager, with his email), and the signature, date and name boxes already placed where the draft drew them.
   */
  async function handleSendForSignature(file: StoredFileRef & { docId?: string }, title: string) {
    const path = storagePathOf(file);
    if (!path) {
      await alertDialog("Only files stored in BFO can be sent for signature.");
      return;
    }
    try {
      const drawn = asset?.operatingAgreementSign;
      const known = drawn && file.docId && drawn.docId === file.docId ? drawn : null;
      let parties: Array<{ role: string; name?: string; email?: string }>;
      if (known) {
        parties = known.signers
          .slice(0, 2)
          // Each signer's own address is added on the request's page before it's sent; never the sender's.
          .map((sg) => (sg.by ? { role: `${sg.by.title}, ${sg.name}`, name: sg.by.name, email: "" } : { role: sg.capacity, name: sg.name, email: "" }));
      } else {
        const members = (asset?.members ?? []).filter((m) => m.name?.trim()).slice(0, 2);
        parties = members.length ? members.map((m) => ({ role: m.role?.trim() || "Member", name: m.name.trim() })) : [{ role: "Party A" }, { role: "Party B" }];
      }
      const created = await signApi.act("create", { title: title.trim() || "Document", assetId: id, parties });
      await signApi.attachStored(created.id, path);
      if (known?.boxes.length) {
        const fields = known.boxes.map((b, i) => ({ id: `${b.party}-${b.type}-${i}`, party: b.party, type: b.type, page: b.page, x: b.x, y: b.y, w: b.w, h: b.h }));
        await signApi.act("update", { id: created.id, fields });
      }
      navigate(`/tools/signatures/${created.id}`);
    } catch (err) {
      await alertDialog("Couldn't send it for signature", err instanceof Error ? err.message : undefined);
    }
  }

  /** The rename dialog: the document, and a name suggested by AI when asked. */
  const [renaming, setRenaming] = useState<{ doc: AssetDoc; suggestion: string | null; suggesting: boolean; error: string } | null>(null);

  /** Open the rename dialog for a document (its field starts with the current name). */
  function handleRenameDoc(doc: AssetDoc) {
    setRenaming({ doc, suggestion: null, suggesting: false, error: "" });
  }

  /** Ask AI for a clearer name; it's offered in the dialog, never applied by itself. */
  async function suggestDocName() {
    const r = renaming;
    if (!r) return;
    setRenaming({ ...r, suggesting: true, error: "" });
    setRenamingDocId(r.doc.id);
    try {
      const res = await authFetch("/api/rename-doc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentName: r.doc.name, contentType: r.doc.contentType || "", url: r.doc.url, context: `Entity: ${asset?.name || ""} (${asset?.type || ""})` }),
      });
      const data = (await res.json().catch(() => ({}))) as { name?: string };
      const name = String(data?.name ?? "").trim();
      setRenaming((x) => (x && x.doc.id === r.doc.id ? { ...x, suggesting: false, suggestion: res.ok && name ? name : null, error: res.ok && name ? "" : "Couldn’t suggest a name. Type one instead." } : x));
    } catch {
      setRenaming((x) => (x && x.doc.id === r.doc.id ? { ...x, suggesting: false, error: "Couldn’t suggest a name. Type one instead." } : x));
    } finally {
      setRenamingDocId(null);
    }
  }

  /** Save the name typed in the dialog. */
  async function saveDocName(name: string) {
    const r = renaming;
    const next = name.trim();
    if (!r) return;
    if (!next || next === r.doc.name) {
      setRenaming(null);
      return;
    }
    await patchAsset({ [`documents/${r.doc.id}/name`]: next });
    setRenaming(null);
  }

  function formatBytes(bytes?: number) {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  // ── Paperwork BFO writes ────────────────────────────────────────────────

  /** Put a generated PDF in Documents and file it in its slot (`replace`: in place of what's there, which stays in Documents). */
  /** Saves a generated PDF into Documents and files it in the slot; returns the document's id, or null if it couldn't be saved. */
  async function fileGenerated(kind: FileKind, blob: Blob, name: string, replace = false): Promise<string | null> {
    setSlot(kind, { error: null, uploading: true, progress: 0 });
    try {
      const doc = await uploadDocFile(new File([blob], name, { type: "application/pdf" }), (pct) => setSlot(kind, { progress: pct }), { draft: true });
      if (replace) {
        const prior = assetRef.current?.[kind]?.docId;
        await patchAsset({
          [kind]: { url: doc.url, fileName: doc.name, size: doc.size ?? 0, contentType: "application/pdf", uploadedAt: Date.now(), storagePath: "", docId: doc.id, uploadedBy: getUser()?.name ?? null } satisfies UploadedFile,
          ...(prior && prior !== doc.id ? { [`documents/${prior}/replacedAt`]: Date.now() } : {}),
        });
      }
      else await fileDocument(kind, doc);
      return doc.id;
    } catch (err) {
      setSlot(kind, { error: err instanceof Error ? err.message : "Couldn't save it." });
      return null;
    } finally {
      setSlot(kind, { uploading: false, progress: 0 });
    }
  }

  const lookupAsset = (oid: string) => allAssets[oid] as Rec | undefined;

  /**
   * Who signs for one of the family's own companies: its manager, as its
   * owners list (People) names one. Null when it isn't one of the family's
   * entities or no manager is on record (the request's page then asks).
   */
  function familySigner(name: string): { name: string; title: string } | null {
    const want = normEntityName(name);
    const rec = Object.values(allAssets).find((a) => normEntityName(a.name) === want) as (Rec & { members?: Member[] }) | undefined;
    const manager = (rec?.members ?? []).find((m) => /manager/i.test(m.role ?? "") && m.name?.trim());
    return manager ? { name: manager.name.trim(), title: "Manager" } : null;
  }

  /** One of the family's entities, by name: its mailing (else principal) address, for an owner that's a company here. */
  const assetAddressByName = (name: string): string | null => {
    const want = name.trim().toLowerCase();
    const hit = Object.values(allAssets).find((a) => (a.name ?? "").trim().toLowerCase() === want);
    return hit ? hit.mailingAddress || hit.address || null : null;
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
      const doc = operatingAgreement(input);
      // The family's own company signs through its manager: his name and title go on its block.
      const signsFor: SignsFor = {};
      for (const sg of doc.signers) {
        const by = familySigner(sg.name);
        if (by) signsFor[sg.name.trim().toLowerCase()] = by;
      }
      const { blob, boxes } = await operatingAgreementPdfWithBoxes(doc, current.name, signsFor);
      const docId = await fileGenerated("operatingAgreement", blob, `Operating Agreement - ${current.name}.pdf`, replace);
      const patch: Record<string, unknown> = {};
      if (docId)
        patch.operatingAgreementSign = {
          docId,
          boxes,
          signers: doc.signers.map((sg) => ({ name: sg.name, capacity: sg.capacity, ...(signsFor[sg.name.trim().toLowerCase()] ? { by: signsFor[sg.name.trim().toLowerCase()] } : {}) })),
        };
      if (!current.operatingAgreementDate) patch.operatingAgreementDate = input.effective;
      if (Object.keys(patch).length) await patchAsset(patch);
    } catch (err) {
      setSlot("operatingAgreement", { error: err instanceof Error ? err.message : "Couldn't draft the agreement." });
    }
  }

  // ── Closing the entity down (app/entity-closing.ts) ──

  const today = () => new Date().toISOString().slice(0, 10);

  /** The family's entities this one owns on record (a step each when it's closed, and named when it's archived). */
  function ownedNow() {
    return id ? ownedBy(id, assetRef.current ?? {}, allAssets as never) : [];
  }

  async function startClosing() {
    const current = assetRef.current;
    if (!current || current.closing) return;
    const owned = ownedNow();
    const steps = closingSteps({ ...current, owned, ownerName: current.ownerId ? assetNames[current.ownerId] : null });
    const count = steps.filter((st) => !st.key.startsWith("transfer:")).length;
    const rec = current.stateRecord ? effectiveRecord(current.stateRecord, current.stateConfirmed) : null;
    const behind = !!rec && recordLapsed(rec);
    const where = stateName(stateCode(current.state) ?? "") || current.state || "the state";
    const ok = await confirm({
      title: `Start dissolving ${current.name}?`,
      message: `BFO lists each step, in order, with what it drafts and where it’s filed: ${count} steps from the owners’ consent to the last mail. Nothing is filed until you do it.`,
      details: [
        ...(owned.length ? [`It owns ${owned.length === 1 ? "1 entity" : `${owned.length} entities`}: each interest is transferred first, a step each (${owned.map((o) => o.name).join("; ")}).`] : []),
        ...(behind ? [`${where}’s record shows it behind on a filing or fee. ${where} won’t accept the dissolution until it’s current.`] : []),
        "Until the owners sign the consent or anything is filed, you can stop and nothing changes. A signed consent or a state filing has legal effect that stopping here doesn’t undo.",
        "The state filing is made on the state’s own site; each step links to it.",
      ],
      confirmLabel: "Start dissolving",
    });
    if (!ok) return;
    await patchAsset({ closing: { startedAt: today(), steps: {} } });
  }

  /** Someone checked the state's own site: active and in good standing, whatever Palm's copy says. */
  async function confirmStateActive() {
    const current = assetRef.current;
    const rec = current?.stateRecord;
    if (!current || !rec || !recordLapsed(rec)) return;
    const where = stateName(stateCode(current.state) ?? "") || current.state || "the state";
    const ok = await confirmDialog({
      title: `Does ${where}'s own site show it active?`,
      message: `Palm's copy of the record says ${rec.status && rec.status !== "active" ? rec.status : "it isn't in good standing"}. If the ${where} Secretary of State's business search shows it active, with its filings current, BFO goes by that until Palm's copy changes.`,
      details: ["Look it up on the state's site first: the entity's status, and the date of its last annual list or report.", "A later reading from Palm that says something different shows again."],
      confirmLabel: "Yes, it's active there",
    });
    if (!ok) return;
    const me = getUser();
    await patchAsset({
      stateConfirmed: { at: Date.now(), by: me?.name ?? null, palmStatus: rec.status ?? null, palmRegistration: rec.standing?.registration ?? null },
    });
  }

  async function undoStateConfirmation() {
    await patchAsset({ stateConfirmed: null });
  }

  async function cancelClosing() {
    const current = assetRef.current;
    if (!current?.closing) return;
    const ok = await confirmDialog({
      title: "Stop closing it?",
      message: "The steps marked done are cleared. Nothing filed with a state or the IRS is undone.",
      confirmLabel: "Stop closing",
      tone: "danger",
    });
    if (ok) await patchAsset({ closing: null });
  }

  async function markClosingStep(key: string, done: boolean) {
    await patchAsset({ [`closing/steps/${key.replace(/[/.#$[\]]/g, "_")}`]: done ? today() : null });
  }

  async function finishClosing() {
    const current = assetRef.current;
    if (!current?.closing) return;
    const left = stepsLeft({ ...current, owned: ownedNow(), ownerName: current.ownerId ? assetNames[current.ownerId] : null });
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
      await patchAsset({
        "palm/live/ra": { status: service.status, name: service.name ?? null, address: formatPalmAddress(service.address) ?? null, checkedAt: Date.now() },
        "closing/steps/agent": today(),
      });
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

  /**
   * Mark where the address change has been reported (or undo it), with the
   * day it was sent and a certified-mail tracking or confirmation number.
   */
  async function markAddressStep(step: "state" | "irs" | "banks", done: boolean, proof?: { on: string; ref?: string | null }) {
    const on = proof?.on || today();
    await patchAsset({
      [`addressUpdates/${step}`]: done ? on : null,
      [`addressUpdateRefs/${step}`]: done ? { on, ref: proof?.ref?.trim() || null, by: getUser()?.name ?? null, at: Date.now() } : null,
    });
  }

  /**
   * Answer whether it does business in a state its address is in: owners and
   * admins, with a reason, recorded in Activity. "Yes" means it must register
   * there; "no" means only its mail goes there.
   */
  async function decideForeign(code: string, doesBusiness: boolean, reason: string) {
    if (!isAdmin()) return;
    await patchAsset({
      [`foreign/${code}/confirmed`]: doesBusiness ? true : null,
      [`foreign/${code}/notNeeded`]: doesBusiness ? null : true,
      [`foreign/${code}/decisionReason`]: reason.trim() || null,
      [`foreign/${code}/decidedBy`]: getUser()?.name ?? null,
      [`foreign/${code}/decidedAt`]: Date.now(),
    });
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
    const have = new Set(
      Object.values(stored)
        .map((d) => d?.palmDocumentId)
        .filter(Boolean),
    );
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
        const stored = await uploadToStorage(
          file,
          () => {},
          () => {},
        );
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

  /**
   * Upload a file straight onto a row: it goes into the library (so it's
   * never a copy only the row holds) and onto the row. What the row held
   * before stays in the library as an earlier version.
   */
  async function handleUploadFile(kind: FileKind, file: File) {
    if (!file) return;
    const maxBytes = 25 * 1024 * 1024;
    if (file.size > maxBytes) {
      setSlot(kind, { error: "That file is over 25 MB. Choose a smaller one." });
      return;
    }
    setSlot(kind, { error: null, uploading: true, progress: 0 });
    try {
      const prior = assetRef.current?.[kind];
      const doc = await uploadDocFile(file, (pct) => setSlot(kind, { error: null, progress: pct }));
      const patch: Record<string, unknown> = {
        [kind]: { url: doc.url, fileName: doc.name, size: doc.size ?? 0, contentType: doc.contentType || "application/pdf", uploadedAt: Date.now(), storagePath: "", docId: doc.id, uploadedBy: getUser()?.name ?? null } satisfies UploadedFile,
      };
      if (prior?.docId) patch[`documents/${prior.docId}/replacedAt`] = Date.now();
      else if (prior?.storagePath) {
        // An older upload only the row held: it joins the library as the earlier version, never deleted.
        const keep: Omit<AssetDoc, "id"> = { name: prior.fileName.replace(/\.[^.]+$/, ""), url: prior.url, storagePath: prior.storagePath, storageProvider: "supabase", size: prior.size, contentType: prior.contentType, createdAt: prior.uploadedAt || Date.now(), replacedAt: Date.now(), autoFileSkip: true };
        patch[`documents/kept-${kind}-${prior.uploadedAt || Date.now()}`] = JSON.parse(JSON.stringify(keep));
      }
      await patchAsset(patch);
    } catch (err) {
      console.error(`${kind} upload failed`);
      setSlot(kind, { error: err instanceof Error && /stuck|network/i.test(err.message) ? err.message : "The upload didn’t finish. Check your connection and try again." });
    } finally {
      setSlot(kind, { uploading: false, progress: 0 });
    }
  }

  /**
   * Take a file off its row. One from the library stays there; an older
   * upload only the row held moves to the library's Removed list (kept).
   */
  async function handleDeleteFile(kind: FileKind) {
    const current = assetRef.current;
    const file = current?.[kind];
    if (!current || !file) return;
    const label = filingTitle(kind, current);
    if (
      !(await confirm({
        title: `Take this file off ${label}?`,
        object: { name: file.fileName },
        message: file.docId
          ? `It stays in the Library. ${label} will show as missing until you add another, and Scan library won’t put this one back.`
          : `It moves to the Library’s Removed list, where it’s kept and can be restored. ${label} will show as missing until you add another.`,
        confirmLabel: "Take it off",
      }))
    )
      return;
    if (file.docId) {
      await patchAsset({ [kind]: null, [`documents/${file.docId}/autoFileSkip`]: true });
      return;
    }
    const removedId = `kept-${kind}-${file.uploadedAt || Date.now()}`;
    const removed: RemovedDoc = {
      name: file.fileName.replace(/\.[^.]+$/, ""),
      url: file.url,
      storagePath: file.storagePath,
      storageProvider: "supabase",
      size: file.size,
      contentType: file.contentType,
      createdAt: file.uploadedAt || Date.now(),
      autoFileSkip: true,
      removedAt: Date.now(),
      removedBy: getUser()?.name ?? null,
      filedAs: label,
    };
    await patchAsset({ [kind]: null, [`removedDocuments/${removedId}`]: JSON.parse(JSON.stringify(removed)) });
  }

  const [deleting, setDeleting] = useState(false);

  /** What the entity has on record, for the archive and remove questions. */
  function footprint() {
    const current = assetRef.current;
    const filings = current ? FILING_KINDS.filter((k) => current[k]).length : 0;
    const palmAgent = !!current && (current.palm?.live?.ra?.status === "active" || /^Palm, active/.test(current.registeredAgentSource ?? ""));
    const owned = ownedNow();
    const empty = !!current && !current.ein?.trim() && !docs.length && !Object.keys(current.removedDocuments ?? {}).length && !filings && !contracts.length && !current.members?.length && !owned.length && !current.palm?.live && !current.palm?.test && !current.stateRecord && !current.closing && !current.fileNumber && !current.formationDate;
    return { filings, palmAgent, owned, empty };
  }

  async function archiveCall(action: "archive" | "restore" | "remove", reason = ""): Promise<string | null> {
    const r = await authFetch("/api/entity-archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assetId: id, action, reason }) });
    if (r.ok) return null;
    const j = await r.json().catch(() => ({}));
    return (j as { message?: string }).message || "That didn’t go through. Try again.";
  }

  /**
   * Archive the entity: hidden from the lists and read-only, with everything
   * kept. It doesn't dissolve anything: it stays formed with the state. An
   * admin is offered Dissolve instead when it isn't being closed already.
   */
  async function archiveEntity() {
    const current = assetRef.current;
    if (!current || current.archived) return;
    const f = footprint();
    const where = stateName(stateCode(current.state) ?? "") || current.state || "its state";
    const result = await confirm({
      title: `Archive ${current.name}?`,
      message: `It leaves the entity lists and becomes read-only. Everything is kept: its documents, filings, contracts, owners and activity. You can restore it at any time.`,
      details: [
        entityType(current) === "Trust" ? "This doesn’t end the trust; it only files the record away." : `This doesn’t dissolve it: it stays formed with ${where}, and its filings and fees keep coming due. To end it, dissolve it instead.`,
        ...(f.owned.length ? [`It owns ${f.owned.length === 1 ? "1 entity" : `${f.owned.length} entities`}; their records don’t change.`] : []),
        ...(f.palmAgent ? ["Palm stays its registered agent and keeps billing; its mail still arrives here."] : []),
      ],
      confirmLabel: "Archive",
      alternative: isAdmin() && !current.closing && entityType(current) !== "Trust" ? { label: "Dissolve instead", value: "dissolve" } : undefined,
      focus: "cancel",
    });
    if (!result) return;
    if (typeof result === "object" && result.alternative === "dissolve") {
      await startClosing();
      return;
    }
    setDeleting(true);
    const why = await archiveCall("archive");
    setDeleting(false);
    if (why) {
      await alertDialog("Couldn’t archive it", why);
      return;
    }
    toast({ message: `Archived ${current.name}`, action: { label: "Undo", run: () => void archiveCall("restore") } });
  }

  async function restoreEntity() {
    const why = await archiveCall("restore");
    if (why) await alertDialog("Couldn’t restore it", why);
  }

  /**
   * Remove a record made by mistake: only when nothing at all is on record
   * for it (the server checks again). Anything with standing is archived.
   */
  async function handleDeleteAsset() {
    const current = assetRef.current;
    if (!current || deleting) return;
    if (!footprint().empty) {
      await archiveEntity();
      return;
    }
    const ok = await confirm({
      title: `Remove ${current.name} from BFO?`,
      message: "Nothing is on record for it, so it looks recorded by mistake. This removes BFO’s record only; it doesn’t dissolve anything with a state.",
      confirmLabel: "Remove from BFO",
      tone: "danger",
      irreversible: true,
      typeToConfirm: current.name,
    });
    if (!ok) return;
    setDeleting(true);
    const why = await archiveCall("remove");
    if (why) {
      setDeleting(false);
      await alertDialog("Couldn’t remove it", why);
      return;
    }
    navigate("/assets");
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
      entityNameOnly: contractForm.entityNameOnly,
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
      entityNameOnly: false,
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
      entityNameOnly: c.entityNameOnly ?? false,
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
      entityNameOnly: editContractForm.entityNameOnly,
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
    takePalmPart,
    showPalmError,
    palmBusinessId,
    refreshPalm,
    checkStateRecord,
    checkForeignRecord,
    confirmStateActive,
    undoStateConfirmation,
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
    handleSendForSignature,
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
    // Editing: one save path for the header, the form and the phone's bar.
    saving,
    saveError,
    saveEdits,
    keyChange,
    setKeyChange,
    formChanges,
    // AI-read facts, proposed until accepted.
    acceptProposal,
    dismissProposal,
    // Archive instead of delete.
    archiveEntity,
    restoreEntity,
    footprint,
    ownedNow,
    // Documents kept, not deleted.
    restoreDoc,
    purgeDoc,
    setLegalHold,
    renaming,
    setRenaming,
    suggestDocName,
    saveDocName,
    decideForeign,
  };
}

export type EntityPage = ReturnType<typeof useEntityPage>;
