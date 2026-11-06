/**
 * Home's arithmetic, kept apart from the page so it can be tested: the
 * P&L's sides as Home shows them, the six months of bars, the treasury
 * range by calendar date, the ownership share on a link of the tree, and
 * the entity count line.
 */

import { sectionOf } from "../lib/books-accounts";
import { count, isoDate, percent } from "./ui/format";

export type PnlLine = { label: string; monthly: number[]; total: number };
type Block = { key: string; sign: "in" | "out"; lines: { label: string; figures: { monthly: number[]; total: number; exact?: number } }[] };
/**
 * The P&L as /api/books/data?report=pnl answers. Two shapes: sections[] with
 * receipts and disbursements, uncategorized kept outside every total (the
 * statements as reworked), and the earlier revenue/operating/other arrays,
 * where uncategorized rows sit inside by their direction. Home reads either.
 */
export type Pnl = {
  year: number;
  sections?: Block[];
  receipts?: number;
  disbursements?: number;
  uncategorized?: { count?: number; in?: number; out?: number } | PnlLine[] | null;
  revenue?: PnlLine[];
  operating?: PnlLine[];
  other?: PnlLine[];
};
export type FlowKind = "income" | "expenses";
/** One account on Home's Income or Expenses card: its year-to-date total and months, in the card's direction. */
export type FlowLine = { label: string; total: number; monthly: number[]; section: string };
export type Member = { name?: string; percent?: number | string | null; role?: string | null };

const DAY = 86_400_000;
/** A calendar day ("2026-11-06") as a UTC noon instant, so arithmetic never slips a day. */
export const dayMs = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);

const neg = (xs: number[]) => xs.map((x) => -x);

/** Every statement line, as income (money in positive) or expense (money out positive). */
function pnlLines(p: Pnl): { kind: FlowKind; line: FlowLine }[] {
  if (Array.isArray(p.sections)) {
    return p.sections.flatMap((b) =>
      b.lines.map((l) => {
        const kind: FlowKind = l.label.trim().startsWith("4") ? "income" : "expenses";
        // A block reads money in (sign "in") or money out ("out"); turn each line to its card's direction.
        const flip = (kind === "income") === (b.sign === "out");
        return { kind, line: { label: l.label, section: b.key, total: flip ? -l.figures.total : l.figures.total, monthly: flip ? neg(l.figures.monthly) : l.figures.monthly } };
      }),
    );
  }
  const old = (xs: PnlLine[] | undefined, section: string, kind: FlowKind) => (xs ?? []).map((l) => ({ kind, line: { label: l.label, section, total: l.total, monthly: l.monthly } }));
  return [...old(p.revenue, "revenue", "income"), ...old(p.operating, "operating", "expenses"), ...old(p.other, "other", "expenses")];
}

/**
 * One side of the P&L, year to date: its total (the P&L's receipts or
 * disbursements), its accounts largest first, and what's uncategorized:
 * outside the total in the reworked statements, inside it (by direction)
 * in the earlier ones.
 */
export function flowSide(pnl: Pnl, kind: FlowKind): { total: number; lines: FlowLine[]; uncategorized: number; uncategorizedInside: boolean } {
  const lines = pnlLines(pnl)
    .filter((x) => x.kind === kind)
    .map((x) => x.line);
  const sum = lines.reduce((s, l) => s + l.total, 0);
  const reworked = Array.isArray(pnl.sections);
  const total = reworked ? ((kind === "income" ? pnl.receipts : pnl.disbursements) ?? sum) : sum;
  const unc = pnl.uncategorized && !Array.isArray(pnl.uncategorized) ? pnl.uncategorized : null;
  const uncategorized = reworked ? ((kind === "income" ? unc?.in : unc?.out) ?? 0) : lines.filter((l) => sectionOf(l.label) === null).reduce((s, l) => s + l.total, 0);
  return { total, lines: [...lines].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label)), uncategorized, uncategorizedInside: !reworked };
}

/** The six calendar months ending this month, from this year's P&L and, early in the year, last year's. */
export function sixMonths(now: Date, kind: FlowKind, thisYear: Pnl, lastYear: Pnl | null): { key: string; value: number | null }[] {
  const monthly = (p: Pnl) =>
    pnlLines(p)
      .filter((x) => x.kind === kind)
      .reduce((acc, x) => acc.map((v, i) => v + (x.line.monthly[i] ?? 0)), Array(12).fill(0) as number[]);
  const cache = new Map<Pnl, number[]>();
  const of = (p: Pnl) => cache.get(p) ?? cache.set(p, monthly(p)).get(p)!;
  const out: { key: string; value: number | null }[] = [];
  for (let i = 5; i >= 0; i--) {
    // The person's own calendar month, not UTC's.
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    const p = y === thisYear.year ? thisYear : lastYear && y === lastYear.year ? lastYear : null;
    out.push({ key: `${y}-${String(m + 1).padStart(2, "0")}`, value: p ? Math.round(of(p)[m] * 100) / 100 : null });
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
