/**
 * State registry records as Palm returns them, and the pure helpers that read
 * them: matching a registry result to an entity, putting the state's record
 * in BFO's shape, and comparing names and addresses the way registries write
 * them. Shared by the browser (app/palm.ts) and the server (lib/state-records.ts).
 */

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

/** The state's record as last read through Palm. */
export type StateRecord = {
  mode: PalmMode;
  name?: string;
  status?: RegistryRecord["status"];
  standing?: RegistryRecord["standing"];
  agent?: string | null;
  agentAddress?: string | null;
  /** The business's address as the state has it (principal office). */
  address?: string | null;
  formationDate?: string;
  registrationNumber?: string;
  jurisdiction?: string;
  /** Where it was formed, when that's not where this record is ("US-DE" for a Delaware LLC registered in Arizona). */
  formationJurisdiction?: string;
  /** The state's word for what it is ("Domestic LLC", "Foreign Corporation"). */
  entityType?: string;
  /** Palm's id for the registry entry, to look the same one up again. */
  palmId?: string;
  /** Names only, kept for records read before `people`. */
  managers?: string[];
  /** Everyone the state lists other than the agent: their role, title and address. */
  people?: StatePerson[];
  checkedAt: number;
};

export type StatePerson = { role: string; name: string; title?: string | null; address?: string | null };

/** The roles that run or own an entity (an agent, an organizer or an incorporator doesn't). */
const PEOPLE_ROLES = new Set(["manager", "member", "officer", "director"]);

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
  const pick = (key: (n?: string | null) => string) => {
    const want = key(name);
    const same = results.filter((r) => key(r.name) === want);
    const home = jurisdiction ? same.filter((r) => r.registration_jurisdiction === jurisdiction || r.formation_jurisdiction === jurisdiction) : same;
    const pool = home.length ? home : same;
    return pool.length === 1 ? pool[0] : pool.length > 1 ? "many" : null;
  };
  // The exact name first; then without the entity ending ("Breezewood" is "BREEZEWOOD LLC"), only in its own state.
  const exact = pick(normalizeName);
  if (exact !== null) return exact === "many" ? null : exact;
  const bare = pick(baseName);
  if (bare === null || bare === "many") return null;
  return !jurisdiction || bare.registration_jurisdiction === jurisdiction || bare.formation_jurisdiction === jurisdiction ? bare : null;
}

/** A name without its entity ending: "Breezewood, L.L.C." → "breezewood". */
export function baseName(name?: string | null): string {
  return normalizeName(name)
    .replace(/\b(llc|inc|incorporated|corp|corporation|co|company|lp|llp|ltd|limited|partnership|pllc|pc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The name to search a registry with: BFO's notes in parentheses ("(100%)") dropped. */
export function searchName(name: string): string {
  return name.replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim();
}

export function toStateRecord(r: RegistryRecord, mode: PalmMode, checkedAt = Date.now()): StateRecord {
  const agent = (r.associates ?? []).find((a) => a.role === "agent");
  const people: StatePerson[] = (r.associates ?? [])
    .filter((a) => !!a.name && a.role !== "agent")
    .map((a) => ({ role: a.role || "other", name: a.name as string, title: a.title || null, address: formatAddress(a.address) }));
  const managers = people.filter((p) => PEOPLE_ROLES.has(p.role)).map((p) => p.name);
  const where = r.registration_jurisdiction ?? r.formation_jurisdiction;
  return {
    mode,
    name: r.name,
    status: r.status,
    standing: r.standing,
    agent: agent?.name ?? null,
    agentAddress: formatAddress(agent?.address),
    address: formatAddress(r.principal_address),
    formationDate: r.formation_date,
    registrationNumber: r.registration_number,
    jurisdiction: where,
    ...(r.formation_jurisdiction && r.formation_jurisdiction !== where ? { formationJurisdiction: r.formation_jurisdiction } : {}),
    ...(r.entity_type ? { entityType: r.entity_type } : {}),
    ...(r.palm_id ? { palmId: r.palm_id } : {}),
    managers,
    people,
    checkedAt,
  };
}

/**
 * The entity's People list from the state's record, when it has none and the
 * key is live: {} otherwise. An entity owned by another one keeps that owner
 * at 100% (what People showed before), unless the state already names it.
 */
export function peoplePatch(
  a: { members?: unknown[] | Record<string, unknown> | null; ownerId?: string | null },
  ownerName: string | null | undefined,
  rec: StateRecord,
  live: boolean,
): Record<string, unknown> {
  const has = Array.isArray(a.members) ? a.members.length > 0 : !!a.members && Object.keys(a.members).length > 0;
  if (!live || has) return {};
  const people = membersFromState(rec);
  if (!people.length) return {};
  const owner = a.ownerId && ownerName && !people.some((p) => normalizeName(p.name) === normalizeName(ownerName)) ? [{ name: ownerName, percent: 100, role: "Member", address: null }] : [];
  const where = (rec.jurisdiction ?? "").replace(/^US-/, "");
  return { members: [...owner, ...people], membersSource: `State record${where ? ` (${where})` : ""}, ${new Date(rec.checkedAt).toISOString().slice(0, 10)}` };
}

/**
 * The state's people as the entity's People list, for when it has none yet
 * (never over one from documents or typed in): managers, members, officers
 * and directors, with their title and address. No ownership shares: a
 * registry doesn't record them.
 */
export function membersFromState(rec: Pick<StateRecord, "people">): { name: string; percent: null; role: string; address: string | null }[] {
  const role = (p: StatePerson) => (p.title?.trim() ? p.title.trim() : p.role.charAt(0).toUpperCase() + p.role.slice(1));
  const seen = new Set<string>();
  return (rec.people ?? [])
    .filter((p) => PEOPLE_ROLES.has(p.role))
    .filter((p) => {
      const k = normalizeName(p.name);
      return !!k && !seen.has(k) && !!seen.add(k);
    })
    .map((p) => ({ name: p.name, percent: null, role: role(p), address: p.address ?? null }));
}

/** Addresses compared the way people write them: case, punctuation, "Suite"/"Ste"/"#" and ZIP+4 don't matter. */
export function sameAddressText(a?: string | null, b?: string | null): boolean {
  const norm = (s?: string | null) =>
    (s ?? "")
      .toLowerCase()
      .replace(/\b(suite|ste|unit|#)\b\.?/g, " ")
      .replace(/#/g, " ")
      .replace(/\b(\d{5})-\d{4}\b/g, "$1")
      .replace(/\bnorth\b/g, "n")
      .replace(/\bstreet\b/g, "st")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return !!norm(a) && norm(a) === norm(b);
}

/**
 * Someone looked at the state's own site and found the entity active and in
 * good standing while Palm's copy of the record said otherwise (Palm's data
 * lags the state's). Kept with what Palm said at the time, so it covers only
 * that stale reading: a newer Palm reading that agrees makes it moot, and one
 * that says something else again shows as read.
 */
export type StateConfirmation = {
  at: number;
  by?: string | null;
  /** What was seen on the state's site ("Active; annual list filed Oct 13, 2026"). */
  note?: string;
  /** Palm's reading it overrides. */
  palmStatus?: StateRecord["status"] | null;
  palmRegistration?: "compliant" | "not_compliant" | null;
};

/** A confirmation older than this no longer stands in for the state's record. */
const CONFIRMATION_DAYS = 365;

/** Whether Palm's reading looks lapsed: not active, or not in good standing. */
export function recordLapsed(rec: StateRecord | null | undefined): boolean {
  return !!rec && ((!!rec.status && rec.status !== "active") || rec.standing?.registration === "not_compliant");
}

/** The confirmation, when it still covers Palm's current reading of the record. */
export function activeConfirmation(rec: StateRecord | null | undefined, c: StateConfirmation | null | undefined, now = Date.now()): StateConfirmation | null {
  if (!rec || !c || !recordLapsed(rec)) return null;
  if (now - c.at > CONFIRMATION_DAYS * 86_400_000) return null;
  if ((c.palmStatus ?? null) !== (rec.status ?? null)) return null;
  if ((c.palmRegistration ?? null) !== (rec.standing?.registration ?? null)) return null;
  return c;
}

/** The record to judge by: Palm's, or active and in good standing where the state's own site was confirmed to say so. */
export function effectiveRecord(rec: StateRecord, c: StateConfirmation | null | undefined, now = Date.now()): StateRecord {
  if (!activeConfirmation(rec, c, now)) return rec;
  return { ...rec, status: "active", standing: { ...rec.standing, registration: "compliant" } };
}
