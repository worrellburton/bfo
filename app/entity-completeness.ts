/**
 * How complete an entity's record is, weighted to 100 — the same weights the
 * entity page uses for its Completeness card, so Home and the entity page
 * always agree on the score.
 */

export type CompletenessInput = {
  type?: "LLC" | "C-Corp" | string;
  ein?: string;
  state?: string;
  formationDate?: string;
  address?: string;
  registeredAgent?: string;
  llcType?: string;
  einLetter?: unknown;
  w9?: unknown;
  articles?: unknown;
  operatingAgreement?: unknown;
};

export type CompletenessItem = { key: string; label: string; weight: number; done: boolean };

export function entityCompleteness(a: CompletenessInput): { score: number; items: CompletenessItem[]; missing: CompletenessItem[] } {
  const corp = a.type === "C-Corp";
  const items: CompletenessItem[] = [
    { key: "ein", label: "EIN", weight: 12, done: !!a.ein?.trim() },
    { key: "state", label: "State of formation", weight: 6, done: !!a.state?.trim() },
    { key: "formationDate", label: "Formation date", weight: 6, done: !!a.formationDate },
    { key: "address", label: "Principal address", weight: 6, done: !!a.address?.trim() },
    { key: "registeredAgent", label: "Registered agent", weight: 6, done: !!a.registeredAgent?.trim() },
    ...(corp ? [] : [{ key: "llcType", label: "Tax classification", weight: 6, done: !!a.llcType }]),
    { key: "einLetter", label: "EIN letter", weight: 14, done: !!a.einLetter },
    { key: "w9", label: "W-9", weight: 10, done: !!a.w9 },
    { key: "articles", label: corp ? "Certificate of Incorporation" : "Articles of Organization", weight: 18, done: !!a.articles },
    { key: "operatingAgreement", label: corp ? "Bylaws" : "Operating Agreement", weight: 16, done: !!a.operatingAgreement },
  ];
  const total = items.reduce((s, i) => s + i.weight, 0);
  const got = items.reduce((s, i) => s + (i.done ? i.weight : 0), 0);
  const missing = items.filter((i) => !i.done).sort((x, y) => y.weight - x.weight);
  return { score: Math.round((got / total) * 100), items, missing };
}
