/**
 * Palm in the browser: calls go through /api/palm (the key stays on the
 * server). The pure helpers here — matching a registry result to an entity,
 * reading what the state's record says against ours — are tested on their own.
 */

import { authFetch } from "./auth";
import { stateCode } from "./entity-paperwork";

export type PalmMode = "test" | "live";

export type PalmAddress = { street_line_1?: string; street_line_2?: string; city?: string; region?: string; postal_code?: string; country?: string } | null | undefined;

export type RegistryRecord = {
  palm_id?: string;
  name?: string;
  formation_jurisdiction?: string;
  registration_jurisdiction?: string;
  status?: "active" | "inactive" | "dissolved" | "expired" | "merged" | "withdrawn" | "pending" | "canceled";
  entity_type?: string;
  formation_date?: string;
  registration_number?: string;
  principal_address?: PalmAddress;
  associates?: { role?: string; name?: string; title?: string; type?: string; address?: PalmAddress }[];
  standing?: { registration?: "compliant" | "not_compliant"; tax?: "compliant" | "not_compliant"; agent?: "compliant" | "not_compliant" };
};

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
export type PalmLink = { businessId: string; palmId?: string | null; linkedAt: number; ra?: { status: RaService["status"]; name?: string | null; checkedAt: number } };

/** The state's record as last read through Palm. */
export type StateRecord = {
  mode: PalmMode;
  name?: string;
  status?: RegistryRecord["status"];
  standing?: RegistryRecord["standing"];
  agent?: string | null;
  agentAddress?: string | null;
  formationDate?: string;
  registrationNumber?: string;
  jurisdiction?: string;
  managers?: string[];
  checkedAt: number;
};

/** "Nevada" → "US-NV". */
export function palmJurisdiction(state?: string | null): string | null {
  const code = stateCode(state);
  return code ? `US-${code}` : null;
}

export function formatAddress(a: PalmAddress): string | null {
  if (!a) return null;
  const line = [a.street_line_1, a.street_line_2].filter(Boolean).join(", ");
  const city = [a.city, [a.region, a.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [line, city].filter(Boolean).join(", ") || null;
}

/** Names compared the way a registry writes them: case, punctuation and "L.L.C." vs "LLC" don't matter. */
export function normalizeName(name?: string | null): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/l\.\s*l\.\s*c\.?/g, "llc")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The one registry result that is this entity, or null when it's ambiguous. */
export function pickRegistryMatch<T extends { name?: string; registration_jurisdiction?: string; formation_jurisdiction?: string }>(
  results: T[],
  name: string,
  jurisdiction?: string | null,
): T | null {
  const want = normalizeName(name);
  const same = results.filter((r) => normalizeName(r.name) === want);
  const home = jurisdiction ? same.filter((r) => r.registration_jurisdiction === jurisdiction || r.formation_jurisdiction === jurisdiction) : same;
  const pool = home.length ? home : same;
  return pool.length === 1 ? pool[0] : null;
}

export function toStateRecord(r: RegistryRecord, mode: PalmMode, checkedAt = Date.now()): StateRecord {
  const agent = (r.associates ?? []).find((a) => a.role === "agent");
  const managers = (r.associates ?? []).filter((a) => a.role === "manager" || a.role === "member" || a.role === "officer" || a.role === "director").map((a) => a.name).filter((n): n is string => !!n);
  return {
    mode,
    name: r.name,
    status: r.status,
    standing: r.standing,
    agent: agent?.name ?? null,
    agentAddress: formatAddress(agent?.address),
    formationDate: r.formation_date,
    registrationNumber: r.registration_number,
    jurisdiction: r.registration_jurisdiction ?? r.formation_jurisdiction,
    managers,
    checkedAt,
  };
}

export type Finding = { tone: "bad" | "warn" | "info"; text: string };

/** What the state's record says that our record doesn't — the things to act on. */
export function stateFindings(rec: StateRecord, asset: { name?: string; registeredAgent?: string; formationDate?: string }): Finding[] {
  const out: Finding[] = [];
  if (rec.status && rec.status !== "active") out.push({ tone: "bad", text: `The state lists it as ${rec.status}, not active.` });
  const s = rec.standing ?? {};
  if (s.registration === "not_compliant") out.push({ tone: "bad", text: "Not in good standing: a required state filing or fee is outstanding." });
  if (s.tax === "not_compliant") out.push({ tone: "bad", text: "Not compliant on state tax." });
  if (s.agent === "not_compliant") out.push({ tone: "bad", text: "The registered agent on file isn't valid." });
  if (rec.agent && asset.registeredAgent && normalizeName(rec.agent) !== normalizeName(asset.registeredAgent)) {
    out.push({ tone: "warn", text: `The state has ${rec.agent} as registered agent; our record says ${asset.registeredAgent}.` });
  }
  if (rec.formationDate && asset.formationDate && rec.formationDate.slice(0, 10) !== asset.formationDate) {
    out.push({ tone: "warn", text: `The state's formation date is ${rec.formationDate.slice(0, 10)}; our record says ${asset.formationDate}.` });
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

/** Forwarded mail and agent paperwork, most urgent first. */
export const DOC_LABEL: Record<string, string> = {
  service_of_process: "Legal papers served",
  notice: "Notice from the state",
  mail: "Mail",
  ra_change_confirmation: "Agent change confirmed",
  ra_resignation: "Agent resignation",
  receipt: "Receipt",
  filing_confirmation: "Filing confirmation",
  certificate_of_formation: "Certificate of formation",
  articles_of_incorporation: "Articles",
  ein_letter: "EIN letter",
  welcome_letter: "Welcome letter",
};

/** A document's kind: `types` is current, `type` is Palm's deprecated single value. */
export function docKindOf(d: PalmDocument): string {
  return d.types?.find((t) => t === "service_of_process") ?? d.types?.[0] ?? d.type ?? "";
}

export function sortDocuments(docs: PalmDocument[]): PalmDocument[] {
  const rank = (d: PalmDocument) => (docKindOf(d) === "service_of_process" ? 0 : docKindOf(d) === "notice" ? 1 : 2);
  return [...docs].sort((a, b) => rank(a) - rank(b) || String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
}

export class PalmUnavailable extends Error {}

/** One action against /api/palm. Throws with Palm's explanation on failure. */
export async function palmCall<T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = await authFetch("/api/palm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  const json = await r.json().catch(() => ({}));
  if (r.status === 503 && json?.error === "not_connected") throw new PalmUnavailable(json.message);
  if (!r.ok) throw new Error(json?.message || `Palm request failed (${r.status}).`);
  return json as T;
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
