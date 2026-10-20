import type { FilingStatus, FormationAddress, FormationDraft, FormationState } from "../app/formation";
import { ownerName } from "./formation-owners.js";

/**
 * Forming an entity through Palm, server side: the wizard's draft becomes
 * Palm's formation request, a state's requirement schema becomes the extra
 * fields the wizard must ask for, and a Palm filing becomes what the entity's
 * record keeps. Pure, so it's tested without a network.
 */

export type { FormationDraft, FormationState };

/** Fields every formation has; anything else in a state's schema is state-specific. */
const COMMON_FIELDS = new Set([
  "jurisdiction", "legal_name", "entity_name", "purpose", "phone", "email", "website", "effective_date",
  "contact", "principal_address", "mailing_address", "organizers", "incorporators", "initial_governing_persons", "directors", "officers",
  "registered_agent", "ein", "fein", "note", "metadata", "expedited_tier", "idempotency_key",
]);

export type ExtraField = {
  key: string;
  label: string;
  description: string | null;
  type: "string" | "number" | "boolean" | "enum";
  options: string[];
  required: boolean;
};

const titleCase = (key: string) => key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** The state-specific fields in a requirement schema, flattened to things a form can ask. Nested objects are skipped. */
export function extraFields(schema: unknown): ExtraField[] {
  const s = (schema ?? {}) as { properties?: Record<string, Record<string, unknown>>; required?: string[] };
  const required = new Set(s.required ?? []);
  const out: ExtraField[] = [];
  for (const [key, def] of Object.entries(s.properties ?? {})) {
    if (COMMON_FIELDS.has(key) || !def || typeof def !== "object") continue;
    const type = Array.isArray(def.type) ? (def.type as string[]).find((t) => t !== "null") : def.type;
    const options = Array.isArray(def.enum) ? (def.enum as unknown[]).filter((v): v is string => typeof v === "string") : [];
    let kind: ExtraField["type"];
    if (options.length) kind = "enum";
    else if (type === "boolean") kind = "boolean";
    else if (type === "number" || type === "integer") kind = "number";
    else if (type === "string" || type === undefined) kind = "string";
    else continue; // objects and arrays: not something a flat form can take
    out.push({
      key,
      label: typeof def.title === "string" && def.title ? def.title : titleCase(key),
      description: typeof def.description === "string" ? def.description : null,
      type: kind,
      options,
      required: required.has(key),
    });
  }
  return out;
}

const clean = (s: string | undefined | null) => (s ?? "").trim();

function address(a: FormationAddress): Record<string, string> {
  return {
    street_line_1: clean(a.street1),
    ...(clean(a.street2) ? { street_line_2: clean(a.street2) } : {}),
    city: clean(a.city),
    region: clean(a.region).toUpperCase(),
    postal_code: clean(a.postal),
    country: "US",
  };
}

/**
 * Palm's request body for the draft. `assetId` rides along as metadata so
 * webhooks find the entity. An LLC's owners go to Palm as its members (Palm
 * has no field for their shares: those live in BFO and the operating
 * agreement).
 */
export function buildFormationRequest(d: FormationDraft, assetId: string): Record<string, unknown> {
  const principal = address(d.principal);
  const people = d.entityType === "llc" ? "organizers" : "incorporators";
  const members =
    d.entityType === "llc"
      ? (d.owners ?? []).map((o) => ({
          name: o.kind === "person" ? { type: "person", first: clean(o.first), last: clean(o.last) } : { type: "entity", entity_name: ownerName(o) },
          address: o.address ? address(o.address) : principal,
          role: "member",
          title: "Member",
        }))
      : [];
  const governing = [
    ...members,
    ...d.governors.map((g) => ({
      name: { type: "person", first: clean(g.first), last: clean(g.last) },
      role: g.role,
      ...(clean(g.title) ? { title: clean(g.title) } : {}),
    })),
  ];
  const body: Record<string, unknown> = {
    jurisdiction: d.jurisdiction,
    legal_name: clean(d.legalName),
    purpose: clean(d.purpose),
    email: clean(d.email),
    ...(clean(d.phone) ? { phone: clean(d.phone) } : {}),
    ...(clean(d.website) ? { website: clean(d.website) } : {}),
    ...(/^\d{4}-\d{2}-\d{2}$/.test(d.effectiveDate) ? { effective_date: d.effectiveDate } : {}),
    contact: { name: clean(d.contact.name), email: clean(d.contact.email), ...(clean(d.contact.phone) ? { phone: clean(d.contact.phone) } : {}) },
    principal_address: principal,
    ...(d.mailingSame ? {} : { mailing_address: address(d.mailing) }),
    [people]: d.organizers.map((o) => ({
      name: { type: "person", first: clean(o.first), last: clean(o.last) },
      address: o.address ? address(o.address) : principal,
      ...(clean(o.title) ? { title: clean(o.title) } : {}),
    })),
    ...(governing.length ? { initial_governing_persons: governing } : {}),
    ...(d.agent.provider === "own"
      ? {
          registered_agent: {
            type: d.agent.kind,
            name: clean(d.agent.name),
            address: address(d.agent.address),
            ...(clean(d.agent.email) ? { email: clean(d.agent.email) } : {}),
            ...(clean(d.agent.phone) ? { phone: clean(d.agent.phone) } : {}),
          },
        }
      : {}),
    ...(d.ein
      ? {
          ein: {
            responsible_party: { first_name: clean(d.ein.first), last_name: clean(d.ein.last), ssn: clean(d.ein.ssn).replace(/-/g, "") },
            reason: "started_new_business",
            fiscal_year_end_month: d.ein.fiscalYearEndMonth || 12,
            expected_employee_count: { agricultural: 0, other: 0 },
            principal_activity: { category: d.ein.activity, ...(clean(d.ein.activityDetail) ? { detail: clean(d.ein.activityDetail) } : {}) },
            principal_activity_detail: clean(d.ein.activityDetail) || clean(d.purpose).slice(0, 200),
            has_previous_ein: false,
            ...(d.entityType === "llc" ? { llc_member_count: Math.max(1, members.length + d.governors.filter((g) => g.role === "member").length) } : {}),
          },
        }
      : {}),
    ...(clean(d.expeditedTier) ? { expedited_tier: clean(d.expeditedTier) } : {}),
    ...(clean(d.note) ? { note: clean(d.note).slice(0, 2000) } : {}),
    metadata: { bfo_asset_id: assetId },
  };
  // State-specific answers go on top; blanks are left out.
  for (const [k, v] of Object.entries(d.extra ?? {})) {
    if (COMMON_FIELDS.has(k) || v === "" || v === null || v === undefined) continue;
    body[k] = v;
  }
  return body;
}

/** The draft with anything secret removed, for logs and the record. */
export function redactDraft(d: FormationDraft): FormationDraft {
  return d.ein ? { ...d, ein: { ...d.ein, ssn: "" } } : d;
}

// ── A Palm filing → the entity's record ───────────────────────────────

export type PalmFiling = {
  id: string;
  status: string;
  status_reason?: string | null;
  type?: string;
  entity_type?: string;
  jurisdiction?: string;
  legal_name?: string;
  business_id?: string | null;
  expedited_tier?: string | null;
  created_at?: string;
  updated_at?: string;
  result?: { registration_number?: string | null; formation_date?: string | null; ein_number?: string | null } | null;
  related_items?: Array<{ object: string; id: string; type?: string; status?: string }>;
  documents?: Array<{ id: string }>;
  fee?: { total?: { amount?: number; currency?: string } } | null;
  cases?: Array<{ status?: string }>;
  metadata?: Record<string, string>;
};

const STATUSES: FilingStatus[] = ["queued", "ready_to_file", "processing", "filed", "completed", "canceled"];

export function summarizeFiling(f: PalmFiling, prev?: Partial<FormationState> | null): FormationState {
  const status = (STATUSES.includes(f.status as FilingStatus) ? f.status : "queued") as FilingStatus;
  const einItem = (f.related_items ?? []).find((r) => r.object === "filing" && r.type === "ein");
  const raItem = (f.related_items ?? []).find((r) => r.object === "registered_agent");
  const now = Date.now();
  return {
    filingId: f.id,
    status,
    statusReason: f.status_reason ?? null,
    entityType: f.entity_type === "corporation" || f.entity_type === "professional_corporation" ? "corporation" : "llc",
    jurisdiction: f.jurisdiction ?? prev?.jurisdiction ?? "",
    submittedAt: prev?.submittedAt ?? (f.created_at ? Date.parse(f.created_at) || now : now),
    updatedAt: now,
    expeditedTier: f.expedited_tier ?? prev?.expeditedTier ?? null,
    ein: einItem ? { filingId: einItem.id, status: einItem.status ?? "queued", number: prev?.ein?.number ?? null } : (prev?.ein ?? null),
    registeredAgent: raItem ? { status: raItem.status ?? "pending" } : (prev?.registeredAgent ?? null),
    registrationNumber: f.result?.registration_number ?? prev?.registrationNumber ?? null,
    formationDate: f.result?.formation_date ?? prev?.formationDate ?? null,
    fee: typeof f.fee?.total?.amount === "number" ? { total: f.fee.total.amount, currency: f.fee.total.currency ?? "USD" } : (prev?.fee ?? null),
    documents: f.documents?.length ?? prev?.documents ?? 0,
    openCases: (f.cases ?? []).filter((c) => c.status === "needs_response").length,
  };
}

/**
 * The changes to the entity's record for a filing's state: the formation
 * under palm.<mode>.formation, plus the facts the state hands back. Keys may
 * hold "/" (the tree's nested update).
 */
export function formationPatch(state: FormationState, mode: "test" | "live", businessId?: string | null): Record<string, unknown> {
  const patch: Record<string, unknown> = { [`palm/${mode}/formation`]: state };
  if (businessId) {
    patch[`palm/${mode}/businessId`] = businessId;
    patch[`palm/${mode}/linkedAt`] = state.submittedAt;
  }
  if (state.status === "completed") {
    patch.status = "Active";
    if (state.registrationNumber) patch.fileNumber = state.registrationNumber;
    if (state.formationDate) patch.formationDate = state.formationDate;
    if (state.registeredAgent) {
      patch.registeredAgent = "Palm";
      patch.registeredAgentSource = `Palm, ${state.registeredAgent.status}`;
    }
  } else if (state.status === "canceled") {
    patch.status = "Formation canceled";
  } else {
    patch.status = "Forming";
  }
  if (state.ein?.number) patch.ein = state.ein.number;
  return patch;
}

/** The EIN add-on finishing: its number lands on the entity. */
export function einPatch(einFiling: PalmFiling, mode: "test" | "live", prev: FormationState): Record<string, unknown> {
  const number = einFiling.result?.ein_number ?? null;
  const next: FormationState = { ...prev, updatedAt: Date.now(), ein: { filingId: einFiling.id, status: einFiling.status, number: number ?? prev.ein?.number ?? null } };
  return { [`palm/${mode}/formation`]: next, ...(number ? { ein: number } : {}) };
}
