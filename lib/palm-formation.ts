import {
  activityQuestions,
  asksMarried,
  CONSTRUCTION_QUESTIONS,
  einMemberCount,
  filersKey,
  OFFICER_ROLES,
  type EinActivity,
  type FilingStatus,
  type FormationAddress,
  type FormationDraft,
  type FormationEin,
  type FormationOfficial,
  type FormationState,
  type FormationStock,
  type PersonName,
  type StateRules,
} from "../app/formation.js";

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
  "contact", "principal_address", "mailing_address", "organizers", "incorporators", "initial_governing_persons", "initial_directors", "initial_officers",
  "stock_structure", "directors", "officers",
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
/** The keys that hold something, so blanks never reach Palm. */
const some = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== undefined && v !== null));
const number = (s: string) => {
  const n = Number(clean(s).replace(/,/g, ""));
  return clean(s) && Number.isFinite(n) ? n : undefined;
};

function address(a: FormationAddress): Record<string, string> {
  return some({
    street_line_1: clean(a.street1),
    street_line_2: clean(a.street2),
    city: clean(a.city),
    region: clean(a.region).toUpperCase(),
    postal_code: clean(a.postal),
    county: clean(a.county),
    country: "US",
  }) as Record<string, string>;
}

const personName = (n: PersonName) => some({ first: clean(n.first), middle: clean(n.middle), last: clean(n.last), suffix: clean(n.suffix) });
const partyName = (kind: "person" | "entity", n: PersonName, entityName: string) =>
  kind === "person" ? { type: "person", ...personName(n) } : { type: "entity", entity_name: clean(entityName) };

/** A manager / director / officer: name, and whatever else was given. */
function official(p: FormationOfficial, principal: Record<string, string>, extra: Record<string, unknown> = {}) {
  return some({
    name: personName(p.name),
    ...extra,
    title: clean(p.title),
    address: p.address ? address(p.address) : principal,
    email: clean(p.email),
    phone: clean(p.phone),
    ssn: clean(p.ssn),
  });
}

/** "yes" / "no" → a boolean; anything else is left out. */
const yesNo = (v: string | undefined) => (v === "yes" ? true : v === "no" ? false : undefined);

function construction(a: EinActivity) {
  const single = yesNo(a.single_trade);
  return some({
    single_trade: single,
    trade: single ? clean(a.trade) : "",
    construction_type: single === false ? a.construction_type : "",
    construction_type_detail: single === false && a.construction_type === "other_structures" ? clean(a.construction_type_detail) : "",
  });
}

/** The principal activity as Palm's discriminated object: the category, and the follow-ups that apply. */
export function principalActivity(a: EinActivity): Record<string, unknown> {
  const out: Record<string, unknown> = { category: a.category };
  if (a.category === "construction") return { ...out, detail: construction(a) };
  for (const q of activityQuestions(a)) {
    if (CONSTRUCTION_QUESTIONS.some((c) => c.key === q.key)) continue;
    const v = q.kind === "yesno" ? yesNo(a[q.key]) : clean(a[q.key]);
    if (v !== undefined && v !== "") out[q.key] = v;
  }
  if (a.category === "real_estate" && a.type === "use_capital_to_build_property") out.construction = construction(a);
  return out;
}

function einRequest(d: FormationDraft, e: FormationEin): Record<string, unknown> {
  const llc = d.entityType === "llc";
  const employees = { agricultural: Math.max(0, Math.floor(number(e.employees.agricultural) ?? 0)), other: Math.max(0, Math.floor(number(e.employees.other) ?? 0)) };
  const married = asksMarried(d) ? yesNo(e.marriedCouple) : undefined;
  return some({
    responsible_party: some({ first_name: clean(e.responsible.first), middle_name: clean(e.responsible.middle), last_name: clean(e.responsible.last), ssn: clean(e.responsible.ssn).replace(/-/g, "") }),
    reason: e.reason || "started_new_business",
    reason_detail: e.reason === "other" ? clean(e.reasonDetail) : "",
    fiscal_year_end_month: e.fiscalYearEndMonth || 12,
    expected_employee_count: employees,
    wage_date: employees.agricultural + employees.other > 0 ? e.wageDate : "",
    principal_activity: principalActivity(e.activity),
    principal_activity_detail: clean(e.activityDetail).slice(0, 200) || clean(d.purpose).slice(0, 200),
    has_previous_ein: e.hasPreviousEin,
    previous_ein: e.hasPreviousEin ? clean(e.previousEin) : "",
    trade_name: clean(e.tradeName),
    form_944_election: e.form944,
    owns_highway_vehicle: e.ownsHighwayVehicle,
    involves_gambling: e.involvesGambling,
    files_form_720: e.filesForm720,
    involves_alcohol_tobacco_firearms: e.involvesAtf,
    phone: clean(e.phone),
    mailing_address: e.mailing ? address(e.mailing) : undefined,
    llc_member_count: llc ? einMemberCount(d) : undefined,
    members_are_married_couple: married,
    llc_classification: married ? e.llcClassification : "",
    corporation_subtype: llc ? "" : e.corporationSubtype,
  });
}

function stockStructure(s: FormationStock): Record<string, unknown> {
  if (s.multiClass) {
    const classes = s.classes.map((c) =>
      some({
        class_name: clean(c.name),
        authorized_shares: number(c.authorized),
        issued_shares: number(c.issued),
        par_value_per_share: number(c.par),
        consideration: number(c.consideration),
        rights_and_restrictions: clean(c.rights),
      })
    );
    return some({
      total_authorized_shares: s.classes.reduce((n, c) => n + (number(c.authorized) ?? 0), 0),
      total_consideration: number(s.consideration),
      classes,
    });
  }
  return some({
    total_authorized_shares: number(s.total),
    has_par_value: s.hasPar,
    par_value_per_share: s.hasPar ? number(s.par) : undefined,
    total_consideration: number(s.consideration),
    rights_and_restrictions: clean(s.rights),
  });
}

/**
 * Palm's request body for the draft, every field Palm takes. `assetId` rides
 * along as metadata so webhooks find the entity. An LLC's owners go as its
 * members (Palm has no field for their shares: those live in BFO and the
 * operating agreement), its managers after them; a corporation's people go
 * as its directors and officers.
 */
export function buildFormationRequest(d: FormationDraft, assetId: string): Record<string, unknown> {
  const llc = d.entityType === "llc";
  const principal = address(d.principal);
  const filers = d.organizers.map((o) =>
    some({
      name: partyName(o.kind, o.name, o.entityName),
      address: o.address ? address(o.address) : principal,
      title: clean(o.title),
      email: clean(o.email),
      phone: clean(o.phone),
      entity_type: o.kind === "entity" ? clean(o.entityType) : "",
    })
  );
  const governing = llc
    ? [
        ...d.owners.map((o) =>
          some({
            name: partyName(o.kind, o.name, o.entityName),
            address: o.address ? address(o.address) : principal,
            role: "member",
            title: clean(o.title) || "Member",
            email: clean(o.email),
            phone: clean(o.phone),
            ssn: o.kind === "person" ? clean(o.ssn) : "",
          })
        ),
        ...(d.managed === "managers" ? d.managers.map((m) => official(m, principal, { role: "manager" })) : []),
      ].map((g) => {
        // Managers are people: Palm's name for them carries a type.
        const n = g.name as Record<string, unknown>;
        return n.type ? g : { ...g, name: { type: "person", ...n } };
      })
    : [];
  const a = d.agent;
  const body: Record<string, unknown> = {
    jurisdiction: d.jurisdiction,
    legal_name: clean(d.legalName),
    purpose: clean(d.purpose),
    email: clean(d.email),
    ...some({ phone: clean(d.phone), website: clean(d.website) }),
    ...(/^\d{4}-\d{2}-\d{2}$/.test(d.effectiveDate) ? { effective_date: d.effectiveDate } : {}),
    contact: some({ name: clean(d.contact.name), email: clean(d.contact.email), phone: clean(d.contact.phone) }),
    principal_address: principal,
    ...(d.mailing ? { mailing_address: address(d.mailing) } : {}),
    [filersKey(d.entityType)]: filers,
    ...(llc
      ? governing.length
        ? { initial_governing_persons: governing }
        : {}
      : {
          stock_structure: stockStructure(d.stock),
          ...(d.directors.length ? { initial_directors: d.directors.map((p) => official(p, principal)) } : {}),
          ...(d.officers.length
            ? { initial_officers: d.officers.map((p) => official({ ...p, title: clean(p.title) || (OFFICER_ROLES.find(([r]) => r === p.role)?.[1] ?? "") }, principal, { role: p.role })) }
            : {}),
        }),
    ...(a.provider === "own"
      ? {
          registered_agent: some({
            type: a.kind,
            name: a.kind === "person" ? { type: "person", ...personName(a.name) } : { type: "entity", entity_name: clean(a.entityName) },
            address: address(a.address),
            mailing_address: a.mailing ? address(a.mailing) : undefined,
            email: clean(a.email),
            phone: clean(a.phone),
          }),
        }
      : {}),
    ...(d.ein ? { ein: einRequest(d, d.ein) } : {}),
    ...some({ expedited_tier: clean(d.expeditedTier), note: clean(d.note).slice(0, 2000) }),
    metadata: { bfo_asset_id: assetId },
  };
  // State-specific answers go on top; blanks are left out.
  for (const [k, v] of Object.entries(d.extra ?? {})) {
    if (COMMON_FIELDS.has(k) || v === "" || v === null || v === undefined) continue;
    body[k] = v;
  }
  return body;
}

/**
 * What a state's requirement schema adds to the common fields: which nested
 * ones it requires (a county, an organizer's email) and the values it allows
 * (a title from a set list). Paths are dotted, arrays without an index.
 */
export function stateRules(schema: unknown): StateRules {
  const root = (schema ?? {}) as Record<string, unknown>;
  const defs = { ...((root.$defs as object) ?? {}), ...((root.definitions as object) ?? {}) } as Record<string, Record<string, unknown>>;
  const out: StateRules = {};
  const resolve = (node: unknown, depth: number): Record<string, unknown> | null => {
    if (!node || typeof node !== "object" || depth > 8) return null;
    let n = node as Record<string, unknown>;
    if (typeof n.$ref === "string") {
      const key = n.$ref.replace(/^#\/(\$defs|definitions)\//, "");
      n = { ...(defs[key] ?? {}), ...n };
    }
    // allOf: one object made of its parts.
    if (Array.isArray(n.allOf)) {
      const parts = (n.allOf as unknown[]).map((x) => resolve(x, depth + 1) ?? {});
      n = {
        ...Object.assign({}, ...parts),
        ...n,
        properties: Object.assign({}, ...parts.map((x) => x.properties ?? {}), n.properties ?? {}),
        required: [...parts.flatMap((x) => (Array.isArray(x.required) ? x.required : [])), ...(Array.isArray(n.required) ? n.required : [])],
      };
    }
    return n;
  };
  const walk = (node: unknown, path: string, depth: number) => {
    const n = resolve(node, depth);
    if (!n || depth > 6) return;
    if (n.type === "array" || n.items) return walk(n.items, path, depth + 1);
    const props = (n.properties ?? {}) as Record<string, unknown>;
    const required = new Set(Array.isArray(n.required) ? (n.required as string[]) : []);
    for (const [key, child] of Object.entries(props)) {
      const p = path ? `${path}.${key}` : key;
      const c = resolve(child, depth + 1) ?? {};
      const options = Array.isArray(c.enum) ? (c.enum as unknown[]).filter((v): v is string => typeof v === "string") : [];
      out[p] = { required: required.has(key), options, description: typeof c.description === "string" ? c.description : null };
      walk(c, p, depth + 1);
    }
  };
  walk(root, "", 0);
  return out;
}

/** The draft with anything secret removed, for logs and the record. */
export function redactDraft(d: FormationDraft): FormationDraft {
  const off = <T extends { ssn: string }>(list: T[]) => list.map((p) => ({ ...p, ssn: "" }));
  return {
    ...d,
    owners: off(d.owners),
    managers: off(d.managers),
    directors: off(d.directors),
    officers: off(d.officers),
    ein: d.ein ? { ...d.ein, responsible: { ...d.ein.responsible, ssn: "" } } : null,
  };
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
