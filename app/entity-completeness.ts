/**
 * How complete an entity's record is, weighted to 100 — the same weights the
 * entity page uses for its Completeness card, so Home, the Entities list and
 * the entity page always agree on the score. A trust is held to a trust's
 * paperwork, not an LLC's.
 */

export type EntityType = "LLC" | "C-Corp" | "Trust";

export type CompletenessInput = {
  name?: string;
  type?: EntityType | string;
  ein?: string;
  state?: string;
  formationDate?: string;
  address?: string;
  registeredAgent?: string;
  llcType?: string;
  trustees?: string;
  grantors?: string;
  beneficiaries?: string;
  einLetter?: unknown;
  w9?: unknown;
  articles?: unknown;
  operatingAgreement?: unknown;
  trustAgreement?: unknown;
  trustCertificate?: unknown;
};

export type CompletenessItem = { key: string; label: string; weight: number; done: boolean; filing?: boolean };

/**
 * The entity's real type. Older records stored every non-Inc as "LLC" — a
 * trust among them — so a name that says "Trust" on an LLC record reads as
 * a trust until someone saves the type.
 */
export function entityType(a: { name?: string; type?: string }): EntityType {
  if (a.type === "Trust") return "Trust";
  if (a.type === "C-Corp") return "C-Corp";
  if (/\btrust\b/i.test(a.name ?? "")) return "Trust";
  return "LLC";
}

/** Tax classifications that fit each type. */
export const TAX_CLASSES: Record<EntityType, string[]> = {
  LLC: ["Disregarded Entity", "Partnership", "C Corporation"],
  "C-Corp": ["C Corporation"],
  Trust: ["Grantor trust", "Non-grantor trust"],
};

export function entityCompleteness(a: CompletenessInput): { score: number; items: CompletenessItem[]; missing: CompletenessItem[] } {
  const type = entityType(a);
  let items: CompletenessItem[];
  if (type === "Trust") {
    // A revocable (grantor) trust reports under the grantor's SSN, so it
    // needs no EIN of its own; anything else should have one.
    const grantor = /^grantor/i.test(a.llcType ?? "");
    items = [
      { key: "trustAgreement", label: "Trust agreement", weight: 26, done: !!a.trustAgreement, filing: true },
      { key: "trustCertificate", label: "Certification of trust", weight: 16, done: !!a.trustCertificate, filing: true },
      { key: "trustees", label: "Trustees", weight: 12, done: !!a.trustees?.trim() },
      { key: "grantors", label: "Grantors", weight: 8, done: !!a.grantors?.trim() },
      { key: "beneficiaries", label: "Beneficiaries", weight: 6, done: !!a.beneficiaries?.trim() },
      { key: "formationDate", label: "Trust date", weight: 8, done: !!a.formationDate },
      { key: "state", label: "Governing law", weight: 6, done: !!a.state?.trim() },
      { key: "llcType", label: "Tax classification", weight: 6, done: TAX_CLASSES.Trust.includes(a.llcType ?? "") },
      { key: "ein", label: grantor ? "Tax ID (grantor's SSN)" : "EIN", weight: 8, done: grantor || !!a.ein?.trim() },
      { key: "address", label: "Mailing address", weight: 4, done: !!a.address?.trim() },
    ];
  } else {
    const corp = type === "C-Corp";
    items = [
      { key: "ein", label: "EIN", weight: 12, done: !!a.ein?.trim() },
      { key: "state", label: "State of formation", weight: 6, done: !!a.state?.trim() },
      { key: "formationDate", label: "Formation date", weight: 6, done: !!a.formationDate },
      { key: "address", label: "Principal address", weight: 6, done: !!a.address?.trim() },
      { key: "registeredAgent", label: "Registered agent", weight: 6, done: !!a.registeredAgent?.trim() },
      ...(corp ? [] : [{ key: "llcType", label: "Tax classification", weight: 6, done: !!a.llcType }]),
      { key: "einLetter", label: "EIN letter", weight: 14, done: !!a.einLetter, filing: true },
      { key: "w9", label: "W-9", weight: 10, done: !!a.w9, filing: true },
      { key: "articles", label: corp ? "Certificate of Incorporation" : "Articles of Organization", weight: 18, done: !!a.articles, filing: true },
      { key: "operatingAgreement", label: corp ? "Bylaws" : "Operating Agreement", weight: 16, done: !!a.operatingAgreement, filing: true },
    ];
  }
  const total = items.reduce((s, i) => s + i.weight, 0);
  const got = items.reduce((s, i) => s + (i.done ? i.weight : 0), 0);
  const missing = items.filter((i) => !i.done).sort((x, y) => y.weight - x.weight);
  return { score: Math.round((got / total) * 100), items, missing };
}
