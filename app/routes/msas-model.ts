/**
 * The MSAs page's arithmetic: each management services agreement's fee,
 * placed in the months it's billed (monthly every month; quarterly every
 * third month from the effective month; annually on the anniversary;
 * one-time once), only while the agreement is in effect (from its effective
 * date to its termination, or the end of a fixed term), and on the right
 * side of the ledger (fee income when a family entity is the manager, fee
 * expense when it's the one managed). An agreement between two family
 * entities is intercompany and kept out of the totals. Pure, and tested in
 * tests/msas-model.test.ts. The terms themselves are read the way the
 * Contracts tab reads them (app/entity/contract-terms.ts).
 */

import { countsAsContracted, familyEntityNamed, feeAmount, frequencyOf, stageOf, STAGE, type ContractTerms, type Frequency, type Stage } from "../entity/contract-terms";

export type Direction = "income" | "expense";

export type Msa = {
  /** "assetId:contractId". */
  id: string;
  assetId: string;
  /** The family entity that's a party. */
  entity: string;
  counterparty: string;
  direction: Direction;
  /** The other party is one of the family's entities. */
  intercompany: boolean;
  amount: number | null;
  frequency: Frequency | null;
  effective: string | null;
  /** The last day in effect (YYYY-MM-DD), when it ends. */
  ends: string | null;
  term: string;
  stage: Stage;
  status: string;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-07-01", "7/1/2026" or a date string as YYYY-MM-DD; null when it isn't a date. */
export function isoOf(raw?: string | null): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (ISO.test(s.slice(0, 10))) return s.slice(0, 10);
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return null;
}

function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
const dayBefore = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
};

/** The last day an agreement is in effect: the day before its termination, or the end of a fixed one-year term. */
export function endOf(c: ContractTerms & { endDate?: string | null; terminatedAt?: number | null }): string | null {
  const ended = isoOf(c.terminatedOn) ?? isoOf(c.endDate) ?? (c.terminatedAt ? new Date(c.terminatedAt).toISOString().slice(0, 10) : null);
  if (ended) return dayBefore(ended);
  const eff = isoOf(c.effectiveDate);
  if (eff && /fixed/i.test(c.term ?? "")) return dayBefore(addMonths(eff, 12));
  return null;
}

/** One agreement on an entity's record, as the page reads it. */
export function msaFrom(assetId: string, entity: string, contractId: string, c: ContractTerms & { endDate?: string | null; terminatedAt?: number | null }, family: { id: string; name?: string | null }[]): Msa {
  const other = familyEntityNamed(c.counterparty ?? "", family);
  return {
    id: `${assetId}:${contractId}`,
    assetId,
    entity,
    counterparty: (c.counterparty ?? "").trim() || "Counterparty not recorded",
    direction: c.role === "managed" ? "expense" : "income",
    intercompany: !!other && other.id !== assetId,
    amount: feeAmount(c),
    frequency: frequencyOf(c.frequency) ?? (feeAmount(c) != null ? "Monthly" : null),
    effective: isoOf(c.effectiveDate),
    ends: endOf(c),
    term: (c.term ?? "").trim(),
    stage: stageOf(c),
    status: STAGE[stageOf(c)].label,
  };
}

/** Counted with the contracted fees: signed, or recorded as active. */
export const isContracted = (m: Msa) => countsAsContracted(m.stage);

/** Whether the agreement is in effect for any day of a month (month 0–11). */
export function inEffect(m: Msa, year: number, month: number): boolean {
  const first = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const last = addMonths(first, 1);
  if (m.effective && m.effective >= last) return false;
  if (m.ends && m.ends < first) return false;
  return true;
}

/**
 * The fee billed in each month of a year: the amount in the months it falls
 * due, 0 in months in effect with nothing due, null in months not in effect.
 */
export function schedule(m: Msa, year: number): (number | null)[] {
  return Array.from({ length: 12 }, (_, i) => {
    if (!inEffect(m, year, i)) return null;
    if (m.amount == null) return 0;
    const start = m.effective ? { y: +m.effective.slice(0, 4), m: +m.effective.slice(5, 7) - 1 } : null;
    const since = start ? (year - start.y) * 12 + (i - start.m) : i;
    switch (m.frequency) {
      case "Quarterly":
        return since % 3 === 0 ? m.amount : 0;
      case "Annually":
        return since % 12 === 0 ? m.amount : 0;
      case "One-time":
        return since === 0 ? m.amount : 0;
      default:
        return m.amount;
    }
  });
}

/** Whether a row belongs in a year's view at all (in effect for some month of it). */
export const inYear = (m: Msa, year: number) => Array.from({ length: 12 }, (_, i) => inEffect(m, year, i)).some(Boolean);

export const sum = (xs: (number | null)[]) => Math.round(xs.reduce<number>((s, x) => s + (x ?? 0), 0) * 100) / 100;

/** The months in effect, as a range: "Jul–Dec", "Jan–Mar", "All year". */
export function span(m: Msa, year: number, names: string[]): string {
  const on = Array.from({ length: 12 }, (_, i) => inEffect(m, year, i));
  const a = on.indexOf(true);
  const b = on.lastIndexOf(true);
  if (a < 0) return "";
  if (a === 0 && b === 11) return "All year";
  return a === b ? names[a] : `${names[a]}–${names[b]}`;
}

/** The CSV: a scope line, then one row per agreement with both parties, direction, terms and the months; then each side's total. */
export function msaCsv(rows: Msa[], year: number, months: string[]): string {
  const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Agreement with", "Family entity", "Direction", "Intercompany", "Frequency", "Fee", "Effective date", "Ends", "Term", "Status", ...months, "Total"];
  const lines = [[`MSAs ${year}: contracted fees in the months they're billed (not what was billed or received)`].map(esc).join(","), head.map(esc).join(",")];
  for (const m of rows) {
    const s = schedule(m, year);
    lines.push(
      [
        m.counterparty,
        m.entity,
        m.direction === "income" ? "Fee income" : "Fee expense",
        m.intercompany ? "Yes" : "No",
        m.frequency ?? "",
        m.amount ?? "",
        m.effective ?? "",
        m.ends ?? "",
        m.term,
        m.status,
        ...s.map((x) => (x == null ? "" : x.toFixed(2))),
        sum(s).toFixed(2),
      ]
        .map(esc)
        .join(","),
    );
  }
  for (const d of ["income", "expense"] as const) {
    const side = rows.filter((m) => m.direction === d && !m.intercompany);
    if (!side.length) continue;
    const cols = months.map((_, i) => sum(side.map((m) => schedule(m, year)[i])));
    lines.push([`Total fee ${d}, excluding intercompany`, "", "", "", "", "", "", "", "", "", ...cols.map((x) => x.toFixed(2)), sum(cols).toFixed(2)].map(esc).join(","));
  }
  return lines.join("\n");
}
