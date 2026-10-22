/**
 * Which rows of a bank CSV to import (api/books/import-csv.ts). Pure, so the
 * matching rules are testable without a database.
 *
 * A CSV row is skipped when the account already has a row on that date for
 * that amount (from Plaid or an earlier import), so nothing double-counts.
 * The match is by count, not by mere presence: two $25.00 charges on one day
 * in the CSV against one already stored imports the second. A set of
 * date|amount keys would drop it — and genuine same-day repeats (two tolls,
 * two transfers) are common.
 */

export type PlannedRow<T> = T & {
  /**
   * How many earlier rows in this file share the date, amount and
   * description: 0 for the first, 1 for its twin… Folded into the row's id
   * so exact twins don't collapse into one row on upsert.
   */
  occurrence: number;
};

const cents = (amount: number | string) => Math.round(Number(amount) * 100);

/**
 * `rows` and `existing` are both in Books sign (outflows positive). Returns
 * the rows to write, in file order, and how many were already there.
 */
export function planCsvImport<T extends { date: string; amount: number; description: string }>(
  rows: T[],
  existing: Array<{ date: string; amount: number | string }>
): { rows: PlannedRow<T>[]; skipped: number } {
  // How many stored rows each date|amount still has to absorb.
  const stored = new Map<string, number>();
  for (const e of existing) {
    const key = `${e.date}|${cents(e.amount)}`;
    stored.set(key, (stored.get(key) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  const out: PlannedRow<T>[] = [];
  let skipped = 0;
  for (const r of rows) {
    const twin = JSON.stringify([r.date, cents(r.amount), r.description]);
    const occurrence = seen.get(twin) ?? 0;
    seen.set(twin, occurrence + 1);

    const key = `${r.date}|${cents(r.amount)}`;
    const left = stored.get(key) ?? 0;
    if (left > 0) {
      stored.set(key, left - 1);
      skipped += 1;
      continue;
    }
    out.push({ ...r, occurrence });
  }
  return { rows: out, skipped };
}
