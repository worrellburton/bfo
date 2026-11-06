/**
 * Treasury's rules about accounts, shared by the pages (app/routes/treasury*,
 * investments) and the server (api/plaid/*). Pure: no React, no fetch, no
 * browser globals, so the server imports it too and tests run it directly
 * (tests/treasury-model.test.ts).
 *
 * - Who owns an account: an entity, one person, or joint owners. IRAs, Roth
 *   IRAs, 401(k)s and HSAs belong to a person; a trust can only be named as
 *   their beneficiary (IRC §408(a)). Person and joint accounts sit outside
 *   every entity's Books.
 * - What the custodian's registration says, so a mapping that contradicts it
 *   can be flagged ("Registered as Joint (JTWROS)").
 * - Tax status (taxable, tax-deferred, tax-exempt), defaulted from the type.
 * - Account names without the bank's own mask ("PREMIER CHECKING ...1886").
 */

export type OwnerKind = "entity" | "person" | "joint";
export type TaxStatus = "taxable" | "tax_deferred" | "tax_exempt";
export type Tenancy = "jtwros" | "tenants_in_common" | "community_property" | "tenancy_by_entirety";

export const TAX_STATUS_LABEL: Record<TaxStatus, string> = {
  taxable: "Taxable",
  tax_deferred: "Tax-deferred",
  tax_exempt: "Tax-exempt",
};

export const TENANCY_LABEL: Record<Tenancy, string> = {
  jtwros: "Joint tenants with right of survivorship",
  tenants_in_common: "Tenants in common",
  community_property: "Community property",
  tenancy_by_entirety: "Tenancy by the entirety",
};

const RETIREMENT_SUBTYPES = new Set([
  "ira",
  "roth",
  "roth ira",
  "sep ira",
  "simple ira",
  "sarsep",
  "401a",
  "401k",
  "roth 401k",
  "403b",
  "457b",
  "keogh",
  "thrift savings plan",
  "profit sharing plan",
  "pension",
  "retirement",
  "hsa",
]);
const TAX_EXEMPT_SUBTYPES = new Set(["roth", "roth ira", "roth 401k", "hsa"]);

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** An IRA, Roth, 401(k), 403(b), HSA and the like: owned by one person, never by an entity. */
export function isRetirement(subtype: string | null | undefined, name?: string | null): boolean {
  const s = norm(subtype);
  if (RETIREMENT_SUBTYPES.has(s)) return true;
  const n = norm(name);
  return /\b(ira|roth|401 ?k|403 ?b|457 ?b|hsa)\b/.test(n) && !/\btrust\b/.test(n);
}

export type Registration = { kind: "individual" | "joint" | "retirement" | "trust"; label: string } | null;

/** What the custodian's own account name or type says about how the account is titled. */
export function registration(name: string | null | undefined, subtype: string | null | undefined): Registration {
  const n = norm(name);
  const s = norm(subtype);
  if (/\broth\b/.test(n) || s === "roth" || s === "roth 401k") return { kind: "retirement", label: s === "roth 401k" ? "Roth 401(k)" : "Roth IRA" };
  if (/\brollover ira\b/.test(n)) return { kind: "retirement", label: "Rollover IRA" };
  if (/\btraditional ira\b/.test(n)) return { kind: "retirement", label: "Traditional IRA" };
  if (/\bsep ira\b/.test(n) || s === "sep ira") return { kind: "retirement", label: "SEP IRA" };
  if (isRetirement(subtype, name)) return { kind: "retirement", label: s === "hsa" || /\bhsa\b/.test(n) ? "HSA" : /401 ?k/.test(n) || s === "401k" ? "401(k)" : "IRA" };
  if (/\bjoint\b|\bjtwros\b|\bwros\b/.test(n)) return { kind: "joint", label: /wros/.test(n) ? "Joint (JTWROS)" : "Joint" };
  if (/\bindividual\b/.test(n)) return { kind: "individual", label: "Individual" };
  if (/\btrust\b/.test(n) || s === "trust") return { kind: "trust", label: /living trust/.test(n) ? "Living trust" : "Trust" };
  return null;
}

/** The tax status an account most likely has, from its type: a starting point the person confirms. */
export function defaultTaxStatus(subtype: string | null | undefined, name?: string | null, type?: string | null): TaxStatus | null {
  const s = norm(subtype);
  if (TAX_EXEMPT_SUBTYPES.has(s) || /\broth\b/.test(norm(name))) return "tax_exempt";
  if (isRetirement(subtype, name)) return "tax_deferred";
  if (type === "investment" || type === "depository") return "taxable";
  return null;
}

export type OwnedAccount = {
  name?: string | null;
  official_name?: string | null;
  subtype?: string | null;
  entity_id?: string | null;
  owner_kind?: OwnerKind | null;
};

/**
 * Why the chosen owner contradicts the account's registration, in one plain
 * sentence, or null. `entityIsTrust` says whether the mapped entity is a trust.
 */
export function ownerConflict(a: OwnedAccount, entityIsTrust: boolean): string | null {
  const reg = registration(a.official_name || a.name, a.subtype);
  const kind = a.owner_kind ?? (a.entity_id ? "entity" : null);
  if (!reg || kind !== "entity") return null;
  if (reg.kind === "retirement") return `Registered as ${article(reg.label)} ${reg.label}. It belongs to one person; ${entityIsTrust ? "the trust" : "an entity"} can only be named as its beneficiary.`;
  if (reg.kind === "joint") return `Registered as ${reg.label}. It belongs to its joint owners unless it has been retitled${entityIsTrust ? " to the trust" : ""}.`;
  if (reg.kind === "individual") return `Registered as Individual. It belongs to one person unless it has been retitled${entityIsTrust ? " to the trust" : ""}.`;
  return null;
}

const article = (label: string) => (/^[AEIOU]/i.test(label) ? "an" : "a");

export type OwnerInput = {
  owner_kind?: unknown;
  owner_names?: unknown;
  tenancy?: unknown;
  tax_status?: unknown;
  beneficiary_entity_id?: unknown;
  beneficiary_name?: unknown;
  entity_id?: unknown;
  entity_name?: unknown;
};

export type OwnerRow = {
  owner_kind: OwnerKind | null;
  owner_names: string[] | null;
  tenancy: Tenancy | null;
  entity_id: string | null;
  entity_name: string | null;
  beneficiary_entity_id?: string | null;
  beneficiary_name?: string | null;
  tax_status?: TaxStatus | null;
};

/**
 * Check an owner change from a request and turn it into the columns to save.
 * A person or joint owner clears the entity (those accounts sit outside every
 * entity's Books); an entity owner clears the people. A retirement account
 * can't be given to an entity.
 */
export function validateOwner(input: OwnerInput, account: { subtype?: string | null; name?: string | null }): { ok: true; row: OwnerRow } | { ok: false; message: string } {
  const kind = input.owner_kind === undefined || input.owner_kind === null || input.owner_kind === "" ? (input.entity_id ? "entity" : null) : String(input.owner_kind);
  if (kind !== null && kind !== "entity" && kind !== "person" && kind !== "joint") return { ok: false, message: "Choose an entity, a person or joint owners." };
  const clean = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const out: OwnerRow = { owner_kind: kind as OwnerKind | null, owner_names: null, tenancy: null, entity_id: null, entity_name: null };

  if (kind === "entity" || kind === null) {
    out.entity_id = clean(input.entity_id, 120) || null;
    out.entity_name = clean(input.entity_name, 120) || null;
    if (kind === "entity" && !out.entity_id) return { ok: false, message: "Choose the entity." };
    if (out.entity_id && isRetirement(account.subtype, account.name)) {
      return { ok: false, message: "A retirement account belongs to one person. Choose the person, and name the entity as beneficiary if it is one." };
    }
    if (!out.entity_id) out.owner_kind = null;
  } else {
    const names = (Array.isArray(input.owner_names) ? input.owner_names : [])
      .map((n) => clean(n, 80))
      .filter(Boolean)
      .slice(0, 4);
    if (kind === "person" && names.length !== 1) return { ok: false, message: "Name the person who owns the account." };
    if (kind === "joint" && names.length < 2) return { ok: false, message: "Name both joint owners." };
    if (kind === "joint" && isRetirement(account.subtype, account.name)) return { ok: false, message: "A retirement account can't be held jointly." };
    out.owner_names = names;
    if (kind === "joint") {
      const t = String(input.tenancy ?? "");
      if (!(t in TENANCY_LABEL)) return { ok: false, message: "Choose how the joint owners hold the account." };
      out.tenancy = t as Tenancy;
    }
  }
  if (input.beneficiary_entity_id !== undefined) {
    out.beneficiary_entity_id = clean(input.beneficiary_entity_id, 120) || null;
    out.beneficiary_name = out.beneficiary_entity_id ? clean(input.beneficiary_name, 120) || null : null;
  }
  if (input.tax_status !== undefined) {
    const t = input.tax_status === null || input.tax_status === "" ? null : String(input.tax_status);
    if (t !== null && !(t in TAX_STATUS_LABEL)) return { ok: false, message: "Choose taxable, tax-deferred or tax-exempt." };
    out.tax_status = t as TaxStatus | null;
  }
  return { ok: true, row: out };
}

/** The bank's own mask inside a name ("PREMIER CHECKING ...1886", "Card x4521") removed, since the app adds its own. */
export function stripBankMask(name: string | null | undefined, mask: string | null | undefined): string {
  let s = (name ?? "").trim();
  if (mask) {
    const m = mask.replace(/\D/g, "");
    if (m) s = s.replace(new RegExp(`\\s*[-–—(]?\\s*(?:\\.{2,}|[x*•·]+|#|ending in|acct\\.?|account)?\\s*${m}\\)?\\s*$`, "i"), "");
  }
  return s.trim();
}

/** Who owns an account, as a group key and a label for headings. */
export function ownerOf(a: { owner_kind?: OwnerKind | null; owner_names?: string[] | null; entity_id?: string | null }, entityName: (id: string) => string | null): { key: string; label: string; kind: "entity" | "person" | "joint" | "none" } {
  if (a.owner_kind === "person" && a.owner_names?.length) return { key: `person:${a.owner_names[0].toLowerCase()}`, label: a.owner_names[0], kind: "person" };
  if (a.owner_kind === "joint" && a.owner_names?.length) {
    const names = [...a.owner_names].sort((x, y) => x.localeCompare(y));
    return { key: `joint:${names.join("|").toLowerCase()}`, label: names.join(" & "), kind: "joint" };
  }
  if (a.entity_id) {
    const name = entityName(a.entity_id);
    if (name) return { key: `entity:${a.entity_id}`, label: name, kind: "entity" };
  }
  return { key: "none", label: "No owner yet", kind: "none" };
}

/** Days an empty account may sit unmoved before it reads as dormant. */
export const DORMANT_DAYS = 90;

/** Empty, and no money has moved in DORMANT_DAYS (or ever). */
export function isDormant(a: { balance_current: number | null; last_activity: string | null }, now: Date = new Date()): boolean {
  if (Math.abs(a.balance_current ?? 0) >= 0.005) return false;
  if (!a.last_activity) return true;
  const days = (now.getTime() - new Date(`${a.last_activity.slice(0, 10)}T12:00:00Z`).getTime()) / 86_400_000;
  return days > DORMANT_DAYS;
}

/** Cards and loans: balances owed, shown as owed and subtracted from a total. */
export function isDebt(a: { type: string | null | undefined }): boolean {
  return a.type === "credit" || a.type === "loan";
}
