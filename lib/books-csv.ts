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
 * nearDuplicates then catches a stored row a day or three off.
 *
 * HTTP surface: none; a library for api/books/import-csv.ts.
 * Who may call it: server code (no I/O). Env: none.
 */

type PlannedRow<T> = T & {
  /**
   * How many earlier rows in this file share the date, amount and
   * description: 0 for the first, 1 for its twin… Folded into the row's id
   * so exact twins don't collapse into one row on upsert.
   */
  occurrence: number;
};

const cents = (amount: number | string) => Math.round(Number(amount) * 100);
const norm = (s: string | null | undefined) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * `rows` and `existing` are both in Books sign (outflows positive); an
 * existing row's `name` is its description (what an earlier import stored).
 * Returns the rows to write, in file order, and how many were already there.
 */
export function planCsvImport<T extends { date: string; amount: number; description: string }>(
  rows: T[],
  existing: Array<{ date: string; amount: number | string; name?: string | null }>,
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

const DAY = 86_400_000;
const words = (s: string | null | undefined) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^\d+$/.test(w)));

/** Shared words over the smaller set: 1 when one description's words are all in the other. */
export function descriptionSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / Math.min(x.size, y.size);
}

/**
 * Of the rows planCsvImport would write, the ones a stored row already
 * covers under a slightly different date: the same amount within `days`
 * days and a similar description (half its words or more). A bank feed
 * often posts a day or two after the statement date, so an exact-date match
 * alone imported those twice. Each stored row covers at most one CSV row.
 * Returns the indexes into `rows` with the stored row each matched.
 */
export function nearDuplicates<T extends { date: string; amount: number; description: string }>(
  rows: T[],
  existing: Array<{ date: string; amount: number | string; name?: string | null; transaction_id?: string }>,
  days = 3,
): Array<{ index: number; existing: { date: string; name: string | null; transaction_id?: string } }> {
  const used = new Set<number>();
  const out: Array<{ index: number; existing: { date: string; name: string | null; transaction_id?: string } }> = [];
  rows.forEach((r, index) => {
    const t = Date.parse(`${r.date}T00:00:00Z`);
    let best = -1;
    let bestScore = 0;
    existing.forEach((e, j) => {
      if (used.has(j) || cents(e.amount) !== cents(r.amount)) return;
      const gap = Math.abs(Date.parse(`${e.date}T00:00:00Z`) - t) / DAY;
      if (gap === 0 || gap > days) return;
      const score = descriptionSimilarity(r.description, e.name);
      if (score >= 0.5 && score > bestScore) {
        best = j;
        bestScore = score;
      }
    });
    if (best >= 0) {
      used.add(best);
      out.push({ index, existing: { date: existing[best].date, name: existing[best].name ?? null, transaction_id: existing[best].transaction_id } });
    }
  });
  return out;
}
