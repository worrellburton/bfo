/**
 * Investments' arithmetic, pure so it is tested (tests/investments-model.test.ts):
 * asset classes, unrealized gain split by tax status with the positions that
 * have no reported basis named rather than silently dropped, and the window
 * the income figures really cover (Plaid may hold far less than a year).
 */
import type { TaxStatus } from "./treasury-model";

export type AssetClass = "equity" | "etf" | "mutual" | "fixed" | "cash" | "other";

export const CLASS_LABEL: Record<AssetClass, string> = {
  equity: "Stocks",
  etf: "ETFs",
  mutual: "Mutual funds",
  fixed: "Fixed income",
  cash: "Cash and money market",
  other: "Other",
};

/** A fixed colour per class (docs/DESIGN.md §2.4): cash and other are neutrals. */
export const CLASS_COLOUR: Record<AssetClass, string> = {
  equity: "bg-chart-1",
  etf: "bg-chart-2",
  mutual: "bg-chart-3",
  fixed: "bg-chart-4",
  cash: "bg-chart-5",
  other: "bg-chart-other",
};

export const CLASS_ORDER: AssetClass[] = ["equity", "etf", "mutual", "fixed", "cash", "other"];

export type HoldingLike = { type: string | null; is_cash_equivalent?: boolean; money_market?: boolean; value: number; cost_basis: number | null; account_id: string };

export function classify(h: Pick<HoldingLike, "type" | "is_cash_equivalent" | "money_market">): AssetClass {
  if (h.money_market || h.is_cash_equivalent || h.type === "cash") return "cash";
  switch (h.type) {
    case "equity":
      return "equity";
    case "etf":
      return "etf";
    case "mutual fund":
      return "mutual";
    case "fixed income":
      return "fixed";
    default:
      return "other";
  }
}

export type GainSummary = {
  taxable: { gain: number; basis: number; positions: number };
  deferred: { gain: number; basis: number; positions: number };
  /** Non-cash positions with no reported cost basis: left out of the gain, and said so. */
  noBasis: { positions: number; value: number };
};

/**
 * Unrealized gain, split: taxable accounts (where it has tax meaning) apart
 * from tax-deferred and tax-exempt ones. Cash has no gain; a position with no
 * basis is counted in `noBasis`, never as zero gain.
 */
export function gains(holdings: HoldingLike[], taxOf: (accountId: string) => TaxStatus | null): GainSummary {
  const out: GainSummary = { taxable: { gain: 0, basis: 0, positions: 0 }, deferred: { gain: 0, basis: 0, positions: 0 }, noBasis: { positions: 0, value: 0 } };
  for (const h of holdings) {
    if (classify(h) === "cash") continue;
    if (h.cost_basis == null || !(h.cost_basis > 0)) {
      out.noBasis.positions += 1;
      out.noBasis.value += h.value;
      continue;
    }
    const bucket = taxOf(h.account_id) === "taxable" || taxOf(h.account_id) === null ? out.taxable : out.deferred;
    bucket.gain += h.value - h.cost_basis;
    bucket.basis += h.cost_basis;
    bucket.positions += 1;
  }
  return out;
}

/** Months between two calendar dates, to one decimal: the window income covers. */
export function monthsBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.round(((b - a) / (365.25 / 12) / 86_400_000) * 10) / 10;
}

/** The calendar months from `from` to `to`, oldest first ("2026-08"). */
export function monthKeys(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 36) break;
  }
  return out;
}

/**
 * Income at the pace of the covered window, a year's worth; null until the
 * window is long enough (three months) to say anything.
 */
export function annualPace(total: number, months: number): number | null {
  if (months < 3) return null;
  return (total / months) * 12;
}
