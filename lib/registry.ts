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
  managers?: string[];
  checkedAt: number;
};

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
  const managers = (r.associates ?? []).filter((a) => a.role === "manager" || a.role === "member" || a.role === "officer" || a.role === "director").map((a) => a.name).filter((n): n is string => !!n);
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
    jurisdiction: r.registration_jurisdiction ?? r.formation_jurisdiction,
    managers,
    checkedAt,
  };
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
