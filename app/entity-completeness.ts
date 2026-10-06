/**
 * How complete an entity's record is, weighted to 100 — the same score on
 * the entity page, the Entities list, Home and the Estate Map. The documents
 * that count come from the paperwork rule book (entity-paperwork.ts), so an
 * Arizona corporation is held to Arizona's annual report, a Delaware LLC run
 * from Phoenix to its Arizona registration, an S corporation to its election,
 * and a trust to a trust's paperwork. "Recommended" documents are listed but
 * never scored.
 */

import {
  agentTerm,
  documentRules,
  entityType,
  stateCode,
  TAX_CLASSES,
  type DocKey,
  type DocRule,
  type EntityType,
  type PaperworkInput,
} from "./entity-paperwork";

export { entityType, TAX_CLASSES };
export type { EntityType };

export type CompletenessInput = PaperworkInput;

export type CompletenessItem = {
  key: string;
  label: string;
  weight: number;
  done: boolean;
  /** A document slot (vs a key fact). */
  filing?: boolean;
  level?: DocRule["level"];
};

export type Completeness = {
  score: number;
  items: CompletenessItem[];
  missing: CompletenessItem[];
  /** Good-practice documents: shown, never scored. */
  recommended: CompletenessItem[];
};

export function entityCompleteness(a: CompletenessInput, today = new Date()): Completeness {
  const type = entityType(a);
  const st = stateCode(a.state);
  let facts: CompletenessItem[];
  if (type === "Trust") {
    // A revocable (grantor) trust reports under the grantor's SSN, so it
    // needs no EIN of its own; anything else should have one.
    const grantor = /^grantor/i.test(a.llcType ?? "");
    facts = [
      { key: "trustees", label: "Trustees", weight: 12, done: !!a.trustees?.trim() },
      { key: "grantors", label: "Grantors", weight: 8, done: !!a.grantors?.trim() },
      { key: "beneficiaries", label: "Beneficiaries", weight: 6, done: !!a.beneficiaries?.trim() },
      { key: "formationDate", label: "Trust date", weight: 8, done: !!a.formationDate },
      { key: "state", label: "Governing law", weight: 6, done: !!a.state?.trim() },
      { key: "llcType", label: "Tax classification", weight: 6, done: TAX_CLASSES.Trust.includes((a.llcType ?? "") as never) },
      { key: "ein", label: grantor ? "Tax ID (grantor's SSN)" : "EIN", weight: 8, done: grantor || !!a.ein?.trim() },
      { key: "address", label: "Mailing address", weight: 4, done: !!a.address?.trim() },
    ];
  } else {
    facts = [
      { key: "ein", label: "EIN", weight: 12, done: !!a.ein?.trim() },
      { key: "state", label: "State of formation", weight: 6, done: !!a.state?.trim() },
      { key: "formationDate", label: "Formation date", weight: 6, done: !!a.formationDate },
      { key: "address", label: "Principal address", weight: 6, done: !!a.address?.trim() },
      { key: "registeredAgent", label: agentTerm(st), weight: 6, done: !!a.registeredAgent?.trim() },
      { key: "llcType", label: "Tax classification", weight: 6, done: TAX_CLASSES[type].includes((a.llcType ?? "") as never) },
    ];
  }

  const rules = documentRules(a, today);
  const docItem = (r: DocRule): CompletenessItem => ({
    key: r.key,
    label: r.title,
    weight: r.weight,
    done: !!a[r.key as DocKey],
    filing: true,
    level: r.level,
  });
  const scoredDocs = rules.filter((r) => r.level !== "recommended").map(docItem);
  const recommended = rules.filter((r) => r.level === "recommended").map(docItem);

  // Trusts list their documents first; companies their key facts first.
  const items = type === "Trust" ? [...scoredDocs, ...facts] : [...facts, ...scoredDocs];
  const total = items.reduce((s, i) => s + i.weight, 0);
  const got = items.reduce((s, i) => s + (i.done ? i.weight : 0), 0);
  const missing = items.filter((i) => !i.done).sort((x, y) => y.weight - x.weight);
  return { score: total ? Math.round((got / total) * 100) : 0, items, missing, recommended };
}
