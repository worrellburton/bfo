/**
 * Which rows of a bank CSV to import (api/books/import-csv.ts). Pure, so the
 * matching rules are testable without a database.
 *
 * A CSV row is skipped when the account already has a row on that date for
 * that amount (from Plaid or an earlier import), so nothing double-counts.
 * The match is by count, not by mere presence: two $25.00 charges on one day
 * in the CSV against one already stored imports the second. A set of
 * date|amount keys would drop it — and genuine same-day repeats (two tolls,
 * two transfers) are common. Which CSV row a stored row absorbs prefers the
 * one with the same description (case and spacing aside), so of "TOLL" and
 * "PARKING" for $25 on one day, with only "PARKING" stored, "TOLL" imports.
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
const norm = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * `rows` and `existing` are both in Books sign (outflows positive); an
 * existing row's `name` is its description (what an earlier import stored).
 * Returns the rows to write, in file order, and how many were already there.
 */
export function planCsvImport<T extends { date: string; amount: number; description: string }>(
  rows: T[],
  existing: Array<{ date: string; amount: number | string; name?: string | null }>
): { rows: PlannedRow<T>[]; skipped: number } {
  // How many stored rows each date|amount still has to absorb, by description.
  const stored = new Map<string, Map<string, number>>();
  for (const e of existing) {
    const key = `${e.date}|${cents(e.amount)}`;
    const byName = stored.get(key) ?? stored.set(key, new Map()).get(key)!;
    byName.set(norm(e.name), (byName.get(norm(e.name)) ?? 0) + 1);
  }
  const keyOf = (r: T) => `${r.date}|${cents(r.amount)}`;
  /** Use up one stored row on that date and amount (with that description, when given). */
  const take = (key: string, name?: string): boolean => {
    const byName = stored.get(key);
    for (const [n, left] of byName ?? []) {
      if (left > 0 && (name === undefined || n === name)) {
        byName!.set(n, left - 1);
        return true;
      }
    }
    return false;
  };
  // Each row first takes a stored row with its own description; only then do
  // the rest take whatever is left on their date and amount, in file order.
  const matched = rows.map((r) => take(keyOf(r), norm(r.description)));

  const seen = new Map<string, number>();
  const out: PlannedRow<T>[] = [];
  let skipped = 0;
  rows.forEach((r, i) => {
    const twin = JSON.stringify([r.date, cents(r.amount), r.description]);
    const occurrence = seen.get(twin) ?? 0;
    seen.set(twin, occurrence + 1);

    if (matched[i] || take(keyOf(r))) {
      skipped += 1;
      return;
    }
    out.push({ ...r, occurrence });
  });
  return { rows: out, skipped };
}
