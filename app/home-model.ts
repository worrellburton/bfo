/**
 * Home's arithmetic, kept apart from the page so it can be tested: the
 * P&L's sides as Home shows them, the six months of bars, the treasury
 * range by calendar date, the ownership share on a link of the tree, and
 * the entity count line.
 */

import { sectionOf } from "../lib/books-accounts";
import { count, isoDate, percent } from "./ui/format";

export type PnlLine = { label: string; monthly: number[]; total: number };
export type Pnl = { year: number; revenue: PnlLine[]; operating: PnlLine[]; other: PnlLine[]; revenue_monthly: number[]; operating_monthly: number[]; other_monthly: number[] };
export type FlowKind = "income" | "expenses";
export type FlowLine = { label: string; total: number; section: "revenue" | "operating" | "other" };
export type Member = { name?: string; percent?: number | string | null; role?: string | null };

const DAY = 86_400_000;
/** A calendar day ("2026-11-06") as a UTC noon instant, so arithmetic never slips a day. */
export const dayMs = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);

/**
 * One side of the P&L, year to date: its total, its accounts largest first,
 * and how much of it is still uncategorized (a label with no chart account,
 * which the P&L files by direction).
 */
export function flowSide(pnl: Pick<Pnl, "revenue" | "operating" | "other">, kind: FlowKind): { total: number; lines: FlowLine[]; uncategorized: number } {
  const lines: FlowLine[] =
    kind === "income"
      ? pnl.revenue.map((l) => ({ label: l.label, total: l.total, section: "revenue" as const }))
      : [...pnl.operating.map((l) => ({ label: l.label, total: l.total, section: "operating" as const })), ...pnl.other.map((l) => ({ label: l.label, total: l.total, section: "other" as const }))];
  const total = lines.reduce((s, l) => s + l.total, 0);
  const uncategorized = lines.filter((l) => sectionOf(l.label) === null).reduce((s, l) => s + l.total, 0);
  return { total, lines: [...lines].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label)), uncategorized };
}

/** The six calendar months ending this month, from this year's P&L and, early in the year, last year's. */
export function sixMonths(now: Date, kind: FlowKind, thisYear: Pnl, lastYear: Pnl | null): { key: string; value: number | null }[] {
  const out: { key: string; value: number | null }[] = [];
  for (let i = 5; i >= 0; i--) {
    // The person's own calendar month, not UTC's.
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    const p = y === thisYear.year ? thisYear : lastYear && y === lastYear.year ? lastYear : null;
    const value = p ? (kind === "income" ? p.revenue_monthly[m] : p.operating_monthly[m] + p.other_monthly[m]) : null;
    out.push({ key: `${y}-${String(m + 1).padStart(2, "0")}`, value });
  }
  return out;
}

/** The points inside a calendar range ending on the latest day: day ≥ latest − N days. */
export function inRange<T extends { day: string }>(all: T[], days: number): T[] {
  if (!all.length || !Number.isFinite(days)) return all;
  const cutoff = isoDate(new Date(dayMs(all[all.length - 1].day) - days * DAY));
  return all.filter((p) => p.day >= cutoff);
}

const loose = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\(\s*\d+(\.\d+)?\s*%\s*\)/g, " ")
    .replace(/\b(llc|l\.l\.c\.|inc|corp|corporation|lp|ltd|trust)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The parent's share of a child, from the child's member list: "100%", or
 * "60% · largest owner" when others hold the rest. Null when the members
 * aren't on record (the tree then says only that the parent is the largest
 * owner on file).
 */
export function shareOf(child: { members?: Member[] }, parentName: string): string | null {
  const members = (child.members ?? []).filter((m) => m?.name);
  const mine = members.find((m) => loose(m.name) === loose(parentName));
  const pct = mine ? Number.parseFloat(String(mine.percent ?? "")) : Number.NaN;
  if (!Number.isFinite(pct)) return null;
  if (pct >= 99.995) return "100%";
  return `${percent(pct, { decimals: 2, trim: true })} · largest owner`;
}

/** "14 LLCs · 3 C-Corps · 1 LP · 1 trust": every type present, so the parts add up to the whole. */
export function typeCounts(types: string[]): string {
  const order: [string, string, string][] = [
    ["LLC", "LLC", "LLCs"],
    ["C-Corp", "C-Corp", "C-Corps"],
    ["LP", "LP", "LPs"],
    ["Trust", "trust", "trusts"],
  ];
  return order
    .map(([t, one, many]) => {
      const n = types.filter((x) => x === t).length;
      return n ? count(n, one, many) : null;
    })
    .filter(Boolean)
    .join(" · ");
}
