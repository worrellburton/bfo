/**
 * Scan every entity's documents in one pass: read each document not yet
 * read (what it is, the facts it states), file it into its empty slot, fill
 * blank facts, check the tax class against what the documents prove, then
 * read the governing documents into the entity's profile. The same rules as
 * the entity page — blanks are filled, set values are never overwritten, a
 * disagreeing document is flagged as a conflict.
 */

import { authFetch } from "./auth";
import { DOC_KEYS, documentRules, entityType, TAX_CLASSES, type DocKey } from "./entity-paperwork";

type Doc = {
  id: string;
  name: string;
  url: string;
  createdAt?: number;
  size?: number;
  contentType?: string;
  storagePath?: string;
  factsCheckedAt?: number;
  classReadAt?: number;
  autoFileSkip?: boolean;
};

type Asset = Record<string, unknown> & {
  name: string;
  type?: string;
  state?: string;
  llcType?: string;
  llcTypeSource?: string;
  llcTypeConflict?: unknown;
  registeredAgent?: string;
  address?: string;
  members?: unknown[];
  membersSource?: string;
  documents?: Record<string, Omit<Doc, "id">>;
};

const CLASSIFIER_KIND: Record<string, DocKey | undefined> = {
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

export type ScanProgress = {
  entity: string;
  index: number;
  total: number;
  step: string;
  notes: string[];
  done: boolean;
  paused?: string;
};

type Write = (path: string, patch: Record<string, unknown>) => Promise<void>;

class Paused extends Error {}

async function post(path: string, body: unknown) {
  const r = await authFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.status === 503) {
    const b = await r.json().catch(() => ({}));
    throw new Paused(b?.message || "Document reading is paused.");
  }
  if (!r.ok) return null;
  return r.json();
}

/** The tax-class decision shared with the entity page: fill, confirm, or flag. */
function taxPatch(asset: Asset, value: string | null | undefined, evidence: string, docName: string): Record<string, unknown> | null {
  const tc = value?.trim();
  if (!tc) return null;
  const t = entityType(asset);
  if (t === "Trust" || !TAX_CLASSES[t].includes(tc as never)) return null;
  const source = `${evidence || "stated in the document"} (${docName})`;
  if (!asset.llcType) return { llcType: tc, llcTypeSource: source, llcTypeConflict: null };
  if (asset.llcType === tc) return asset.llcTypeSource && asset.llcTypeSource !== "Entered by hand" ? null : { llcTypeSource: source, llcTypeConflict: null };
  return { llcTypeConflict: { value: tc, evidence: evidence || "", docName, at: Date.now() } };
}

/**
 * Scan every entity. `write` applies a patch at a database path; `onProgress`
 * is called as it goes. Stops early (with `paused`) if document reading is
 * unavailable.
 */
export async function scanAllEntities(
  assets: Record<string, Asset>,
  write: Write,
  onProgress: (p: ScanProgress) => void
): Promise<ScanProgress> {
  const entries = Object.entries(assets).filter(([, a]) => a?.name);
  const notes: string[] = [];
  const note = (s: string) => notes.push(s);
  let progress: ScanProgress = { entity: "", index: 0, total: entries.length, step: "", notes, done: false };
  const tick = (p: Partial<ScanProgress>) => onProgress((progress = { ...progress, ...p, notes: [...notes] }));

  try {
    for (const [i, [id, original]] of entries.entries()) {
      const asset: Asset = { ...original };
      const docs: Doc[] = Object.entries(asset.documents ?? {})
        .map(([did, d]) => ({ id: did, ...d }))
        .filter((d) => d.storagePath && /pdf|image\//i.test(d.contentType || ""));
      tick({ entity: asset.name, index: i + 1, step: docs.length ? `Reading ${docs.length} document${docs.length === 1 ? "" : "s"}` : "No documents" });
      if (!docs.length) continue;

      const wanted = new Set(documentRules(asset).map((r) => r.key));
      const filed = new Set(DOC_KEYS.map((k) => (asset[k] as { docId?: string } | undefined)?.docId).filter(Boolean));

      // 1. Read every document not read yet.
      for (const d of docs) {
        if (d.factsCheckedAt && d.classReadAt) continue;
        const facts = await post("/api/documents/classify", { url: d.url, fileName: d.name, contentType: d.contentType });
        const stamp = { factsCheckedAt: Date.now(), classReadAt: Date.now() };
        if (!facts) continue;
        const patch: Record<string, unknown> = {};
        const kind = CLASSIFIER_KIND[facts.kind];
        if (kind && wanted.has(kind) && !asset[kind] && !filed.has(d.id) && !d.autoFileSkip && facts.confidence !== "low") {
          patch[kind] = { url: d.url, fileName: d.name, size: d.size ?? 0, contentType: d.contentType || "application/pdf", uploadedAt: d.createdAt || Date.now(), storagePath: "", docId: d.id };
          filed.add(d.id);
          note(`${asset.name}: filed “${d.name}”`);
        }
        if (facts.ein && !asset.ein && (kind === "einLetter" || kind === "w9")) patch.ein = facts.ein;
        if (facts.registeredAgent && !asset.registeredAgent && entityType(asset) !== "Trust") patch.registeredAgent = facts.registeredAgent;
        if (facts.principalAddress && !asset.address) patch.address = facts.principalAddress;
        Object.assign(patch, taxPatch(asset, facts.taxClassification, facts.taxClassificationEvidence ?? "", d.name) ?? {});
        if (Object.keys(patch).length) {
          await write(`assets/${id}`, patch);
          Object.assign(asset, patch);
        }
        await write(`assets/${id}/documents/${d.id}`, stamp);
      }

      // 2. What the entity is, from its governing documents.
      tick({ step: "Reading the operating agreement" });
      const filedAs = new Map(DOC_KEYS.map((k) => [(asset[k] as { docId?: string } | undefined)?.docId, k] as const));
      const profile = await post("/api/documents/profile", {
        entity: { name: asset.name, type: entityType(asset), state: asset.state },
        documents: docs.map((d) => ({ name: d.name, url: d.url, contentType: d.contentType, filedAs: filedAs.get(d.id) ?? null })),
      });
      if (profile && typeof profile.whatItIs === "string") {
        const patch: Record<string, unknown> = { profile: JSON.parse(JSON.stringify(profile)) };
        const owners = (profile.members ?? []).filter((m: { name?: string }) => m?.name?.trim());
        if (owners.length && (!asset.members?.length || asset.membersSource === "governing documents")) {
          patch.members = owners.map((m: { name: string; percent: number | null }) => ({ name: m.name, percent: m.percent ?? null, role: "member" }));
          patch.membersSource = "governing documents";
        }
        Object.assign(patch, taxPatch(asset, profile.taxTreatment, profile.taxEvidence ?? "", profile.sources?.[0] ?? "the governing documents") ?? {});
        await write(`assets/${id}`, patch);
        if ((asset as { llcTypeConflict?: unknown }).llcTypeConflict == null && patch.llcTypeConflict) {
          note(`${asset.name}: documents say ${(patch.llcTypeConflict as { value: string }).value}, record says ${asset.llcType}`);
        }
      }
    }
    tick({ step: "Done", done: true });
  } catch (err) {
    if (err instanceof Paused) tick({ step: "Paused", done: true, paused: err.message });
    else throw err;
  }
  return progress;
}
