/**
 * Palm in the browser: calls go through /api/palm (the key stays on the
 * server). The pure helpers here — matching a registry result to an entity,
 * reading what the state's record says against ours — are tested on their own.
 */

import { authFetch } from "./auth";
import { stateCode } from "./entity-paperwork";
import type { FormationState } from "./formation";
import type { RaSnapshot } from "../lib/palm-agent";
import { activeConfirmation, effectiveRecord, normalizeName, pickRegistryMatch, sameAddressText, toStateRecord, type PalmAddress, type PalmMode, type RegistryRecord, type StateConfirmation, type StateRecord } from "../lib/registry";

export type { PalmAddress, PalmMode, RegistryRecord, StateConfirmation, StateRecord } from "../lib/registry";
export { DOC_LABEL, docKindOf } from "../lib/palm-docs";
import { docKindOf } from "../lib/palm-docs";
export { activeConfirmation, effectiveRecord, formatAddress, normalizeName, pickRegistryMatch, recordLapsed, sameAddressText, toStateRecord } from "../lib/registry";

export type RaService = {
  provider: "palm" | "external" | null;
  status: "pending" | "active" | "termination_requested" | "terminated" | "failed" | "canceled" | null;
  jurisdiction: string | null;
  started_at: string | null;
  ended_at: string | null;
  rejection_reason?: string | null;
  name?: string | null;
  address?: PalmAddress;
};

export type PalmDocument = {
  id: string;
  type?: string;
  types?: string[];
  filename?: string;
  content_type?: string;
  file_size?: number;
  created_at?: string;
  upload_date?: string;
};

/** What BFO keeps on the entity: one link per Palm mode (test and live data never mix). */
export type PalmLink = {
  businessId: string;
  palmId?: string | null;
  linkedAt: number;
  /** The agent service as last read (lib/palm-agent.ts); provider, dates and refusal reason since the sync was added. */
  ra?: { status: RaService["status"]; name?: string | null; address?: string | null; checkedAt: number } & Partial<Omit<RaSnapshot, "status" | "name" | "address" | "checkedAt">>;
  /** When "Sync everything with Palm" last ran. */
  syncedAt?: number;
  /** Set when BFO formed this entity through Palm (app/formation.ts). */
  formation?: FormationState;
};

/** "Nevada" → "US-NV". */
export function palmJurisdiction(state?: string | null): string | null {
  const code = stateCode(state);
  return code ? `US-${code}` : null;
}

export type Finding = { tone: "bad" | "warn" | "info"; text: string };

/** What the state's record says that our record doesn't — the things to act on. */

export function stateFindings(
  palmRec: StateRecord,
  asset: { name?: string; registeredAgent?: string; registeredAgentAddress?: string; formationDate?: string; address?: string; stateConfirmed?: StateConfirmation | null },
): Finding[] {
  const out: Finding[] = [];
  // Palm's copy lagging the state's own site, as someone confirmed: judged as the state has it.
  const confirmed = activeConfirmation(palmRec, asset.stateConfirmed);
  const rec = effectiveRecord(palmRec, asset.stateConfirmed);
  if (confirmed) {
    const said = [palmRec.status && palmRec.status !== "active" ? palmRec.status : null, palmRec.standing?.registration === "not_compliant" ? "not in good standing" : null].filter(Boolean).join(", ");
    const when = new Date(confirmed.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    out.push({ tone: "info", text: `Active and in good standing on the state's own site (confirmed ${when}${confirmed.by ? ` by ${confirmed.by}` : ""}${confirmed.note ? `: ${confirmed.note}` : ""}). Palm's copy still says ${said}; it's behind the state.` });
  }
  if (rec.status && rec.status !== "active") out.push({ tone: "bad", text: `The state lists it as ${rec.status}, not active.` });
  const s = rec.standing ?? {};
  if (s.registration === "not_compliant") out.push({ tone: "bad", text: "Not in good standing: a required state filing or fee is outstanding." });
  if (s.tax === "not_compliant") out.push({ tone: "bad", text: "Not compliant on state tax." });
  if (s.agent === "not_compliant") out.push({ tone: "bad", text: "The registered agent on file isn't valid." });
  if (rec.agent && asset.registeredAgent && normalizeName(rec.agent) !== normalizeName(asset.registeredAgent)) {
    out.push({ tone: "warn", text: `The state has ${rec.agent} as registered agent; our record says ${asset.registeredAgent}.` });
  } else if (rec.agentAddress && asset.registeredAgentAddress && !sameAddressText(rec.agentAddress, asset.registeredAgentAddress)) {
    out.push({ tone: "warn", text: `The state has the agent at ${rec.agentAddress}; our record says ${asset.registeredAgentAddress}.` });
  }
  if (rec.formationDate && asset.formationDate && rec.formationDate.slice(0, 10) !== asset.formationDate) {
    out.push({ tone: "warn", text: `The state's formation date is ${rec.formationDate.slice(0, 10)}; our record says ${asset.formationDate}.` });
  }
  if (rec.address && asset.address && !sameAddressText(rec.address, asset.address)) {
    out.push({ tone: "warn", text: `The state has ${rec.address} as its address; our record says ${asset.address}.` });
  }
  if (rec.name && asset.name && normalizeName(rec.name) !== normalizeName(asset.name)) {
    out.push({ tone: "info", text: `The state's legal name is “${rec.name}”.` });
  }
  return out;
}

export const RA_STATUS: Record<NonNullable<RaService["status"]>, { label: string; tone: "good" | "wait" | "bad" | "muted" }> = {
  pending: { label: "Filing the change", tone: "wait" },
  active: { label: "Palm is the agent", tone: "good" },
  termination_requested: { label: "Resigning", tone: "wait" },
  terminated: { label: "Ended", tone: "muted" },
  failed: { label: "Didn't go through", tone: "bad" },
  canceled: { label: "Canceled", tone: "muted" },
};



export function sortDocuments(docs: PalmDocument[]): PalmDocument[] {
  const rank = (d: PalmDocument) => (docKindOf(d) === "service_of_process" ? 0 : docKindOf(d) === "notice" ? 1 : 2);
  return [...docs].sort((a, b) => rank(a) - rank(b) || String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
}

/**
 * What reading the state's record found: the snapshot (with the patch to save
 * on the entity), a list of registry entries to choose from when the name
 * matched more than one or none exactly, or why it couldn't be read.
 * `choice` is the registry entry the user picked from that list.
 */
type StateLookup =
  | { kind: "record"; record: StateRecord; patch: Record<string, unknown> }
  | { kind: "choices"; results: RegistryRecord[]; message?: string }
  | { kind: "error"; message: string };

export async function lookupStateRecord(
  entity: { name: string; state?: string; fileNumber?: string; registeredAgent?: string; registeredAgentAddress?: string; assetId?: string },
  mode: PalmMode,
  choice?: RegistryRecord,
): Promise<StateLookup> {
  const jurisdiction = palmJurisdiction(entity.state);
  if (!jurisdiction) return { kind: "error", message: "Set the entity's state first." };
  let number = choice ? choice.registration_number : entity.fileNumber;
  let where = choice?.registration_jurisdiction || jurisdiction;
  if (choice && !number && choice.palm_id) {
    // A picked entry without its number: look that exact entry up by its Palm ID.
    const { results } = await palmCall<{ results: RegistryRecord[] }>("registry-search", { palmId: choice.palm_id, mode, assetId: entity.assetId });
    number = results.find((r) => r.palm_id === choice.palm_id)?.registration_number;
    where = results[0]?.registration_jurisdiction || where;
  }
  if (choice && !number) return { kind: "error", message: "That registry entry has no file number. Add it by hand under Edit, then check again." };
  if (!number) {
    const { results } = await palmCall<{ results: RegistryRecord[] }>("registry-search", { name: entity.name, jurisdiction, mode, assetId: entity.assetId });
    const match = pickRegistryMatch(results, entity.name, jurisdiction);
    if (!match) {
      return {
        kind: "choices",
        results,
        message: results.length ? undefined : `No ${entity.state} registry entry matched “${entity.name}”. Add the state file number under Edit and try again.`,
      };
    }
    number = match.registration_number;
    where = match.registration_jurisdiction || jurisdiction;
  }
  if (!number) return { kind: "error", message: "The registry result had no file number. Add it by hand under Edit." };
  const { record } = await palmCall<{ record: RegistryRecord }>("registry-detail", { jurisdiction: where, number, mode, assetId: entity.assetId });
  const snapshot = toStateRecord(record, mode);
  const patch: Record<string, unknown> = { stateRecord: JSON.parse(JSON.stringify(snapshot)) };
  if (mode === "live" && !entity.fileNumber && snapshot.registrationNumber) patch.fileNumber = snapshot.registrationNumber;
  // The agent's street address, as the state has it, when ours is blank and it's the same agent.
  if (mode === "live" && !entity.registeredAgentAddress?.trim() && snapshot.agentAddress && (!entity.registeredAgent || normalizeName(entity.registeredAgent) === normalizeName(snapshot.agent ?? ""))) {
    patch.registeredAgentAddress = snapshot.agentAddress;
    if (!entity.registeredAgent && snapshot.agent) patch.registeredAgent = snapshot.agent;
  }
  return { kind: "record", record: snapshot, patch };
}

export class PalmUnavailable extends Error {}

/** A refused Palm action, with the server's error code (e.g. "mode_changed", "business_mismatch"). */
export class PalmCallError extends Error {
  constructor(message: string, public code?: string, public status?: number) {
    super(message);
  }
}

/**
 * One part of the entity page's opening read (action "entity-bundle"): what
 * the part's own action would have answered, or the error it would have
 * failed with. A failed part fails alone.
 */
export type PalmBundlePart<T> = { ok: true; value: T } | { ok: false; error: { code?: string; message: string; status?: number } };

/** The parts a card reads for itself when the bundle hasn't got them. */
export type PalmBundlePartName = "inbox" | "inboxUnread" | "cases" | "monitors";

export type PalmBundle = {
  mode: PalmMode | null;
  /** The business linked in the key's mode, as the server read it; null when the entity isn't in Palm. */
  businessId?: string | null;
  status: PalmBundlePart<{ configured: boolean; mode: PalmMode | null }>;
  ra?: PalmBundlePart<{ service: RaService | null }>;
  documents?: PalmBundlePart<{ documents: PalmDocument[]; truncated?: boolean }>;
  inbox?: PalmBundlePart<{ events: unknown[] }>;
  inboxUnread?: PalmBundlePart<{ events: unknown[] }>;
  cases?: PalmBundlePart<{ cases: unknown[] }>;
  monitors?: PalmBundlePart<{ cents: number; registrations: unknown[] }>;
};

/** How long after the page opens a bundle part still stands in for a card's own read. */
export const BUNDLE_FRESH_MS = 5_000;

/** A card's copy of the part it took, so the same effect run again (React's development re-run) gets the same answer. */
export type SeedHold<T> = { at: string; takenAt: number; part: PalmBundlePart<T> | null };

/** The part for `at` (the card's key and what it asks for), taken once and held while fresh; null means read Palm. */
export function heldSeed<T>(hold: { current: SeedHold<T> | null }, at: string, take: () => PalmBundlePart<T> | null): PalmBundlePart<T> | null {
  if (hold.current?.at !== at || Date.now() - hold.current.takenAt > BUNDLE_FRESH_MS) hold.current = { at, takenAt: Date.now(), part: take() };
  return hold.current.part;
}

/** A bundle part as the matching palmCall would have settled: its value, or the same PalmCallError. */
export function fromBundle<T>(part: PalmBundlePart<T>): Promise<T> {
  return part.ok ? Promise.resolve(part.value) : Promise.reject(new PalmCallError(part.error.message, part.error.code, part.error.status));
}

/** One action against /api/palm. Throws with Palm's explanation on failure. */
export async function palmCall<T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = await authFetch("/api/palm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  const json = await r.json().catch(() => ({}));
  if (r.status === 503 && json?.error === "not_connected") throw new PalmUnavailable(json.message);
  if (!r.ok) throw new PalmCallError(json?.message || `Palm request failed (${r.status}).`, json?.error, r.status);
  return json as T;
}

/** A Palm document's file. */
export async function fetchPalmDocument(doc: PalmDocument): Promise<Blob> {
  const r = await authFetch("/api/palm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "document", documentId: doc.id }),
  });
  if (!r.ok) throw new Error("Couldn't fetch that document from Palm.");
  return r.blob();
}

/** Open a Palm document in a new tab. */
export async function openPalmDocument(doc: PalmDocument): Promise<void> {
  const win = window.open("", "_blank");
  const r = await authFetch("/api/palm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "document", documentId: doc.id }),
  });
  if (!r.ok) {
    win?.close();
    throw new Error("Couldn't open that document.");
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  if (blob.type === "application/pdf" || blob.type.startsWith("image/")) {
    if (win) win.location.href = url;
    else window.location.href = url;
  } else {
    // Not something to render on our origin: save it instead.
    win?.close();
    const a = document.createElement("a");
    a.href = url;
    a.download = doc.filename || "document";
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
