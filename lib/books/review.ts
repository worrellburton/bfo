import { sectionOf } from "../books-rules.js";
import { effType, label } from "../books-report.js";
import { fetchAll } from "../db-pages.js";
import { getPrefs, scopeFilter, withLiveEntity } from "./prefs.js";
import { ok, type BookTxn, type Reply } from "./types.js";

/**
 * What wants a human's eyes: the review queue (uncategorized, low-confidence,
 * duplicates, outliers) and the recurring-stream detector.
 */

// ── #2 + #8 Review queue: uncategorized, low-confidence, duplicates,
//    and outliers — everything that wants a human's eyes ──────────────────

export async function reviewReport(): Promise<Reply> {
  const prefs = await getPrefs();
  const rows = withLiveEntity(
    await fetchAll<BookTxn>(`book_transactions?select=*&pending=eq.false${scopeFilter(prefs, null)}&order=transaction_id.asc`),
    prefs
  );
  const slim = (t: BookTxn) => ({
    transaction_id: t.transaction_id,
    date: t.date,
    name: t.name,
    merchant_name: t.merchant_name,
    amount: t.amount,
    book_category: t.book_category,
    entity_name: t.entity_name,
    account_id: t.account_id,
    item_id: t.item_id,
  });

  // Uncategorized (no account) and low-confidence (still in a catch-all).
  const uncategorized = rows.filter((t) => !t.book_category);
  const CATCHALL = new Set(["6900 Other Operating Expenses", "4900 Other Income"]);
  const lowConfidence = rows.filter((t) => t.book_category && CATCHALL.has(t.book_category));

  // Duplicates: same account + date + amount. Cross-source (more than one
  // feed) is a near-certain double; same-feed repeats are "possible".
  const groups = new Map<string, BookTxn[]>();
  for (const t of rows) {
    const key = `${t.account_id}|${t.date}|${Math.round(t.amount * 100)}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  const duplicates = [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({
      count: g.length,
      cross_source: new Set(g.map((t) => t.item_id)).size > 1,
      amount: g[0].amount,
      date: g[0].date,
      rows: g.map(slim),
    }))
    .sort((a, b) => Number(b.cross_source) - Number(a.cross_source) || Math.abs(b.amount) - Math.abs(a.amount));

  // Outliers: the biggest P&L-affecting items, for a sanity read.
  const outliers = rows
    .filter((t) => effType(t) === "normal" && sectionOf(label(t)) !== "flow")
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 15)
    .map(slim);

  return ok({
    counts: {
      uncategorized: uncategorized.length,
      low_confidence: lowConfidence.length,
      duplicate_groups: duplicates.length,
    },
    uncategorized: uncategorized.slice(0, 100).map(slim),
    low_confidence: lowConfidence.slice(0, 100).map(slim),
    duplicates: duplicates.slice(0, 50),
    outliers,
  });
}

// ── #7 Recurring detection: streams that repeat on a cadence ─────────────

export async function recurringReport(): Promise<Reply> {
  const prefs = await getPrefs();
  const rows = withLiveEntity(
    await fetchAll<BookTxn>(
      `book_transactions?select=*&pending=eq.false${scopeFilter(prefs, null)}&order=date.asc,transaction_id.asc`
    ),
    prefs
  );
  // Group by vendor identity (only real P&L / spend rows).
  const byVendor = new Map<string, BookTxn[]>();
  for (const t of rows) {
    if (effType(t) === "intercompany") continue;
    const v = (t.merchant_name || t.name || "").trim();
    if (!v) continue;
    (byVendor.get(v) ?? byVendor.set(v, []).get(v)!).push(t);
  }

  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const cadenceOf = (gap: number): { name: string; days: number } | null => {
    if (gap >= 6 && gap <= 8) return { name: "weekly", days: 7 };
    if (gap >= 12 && gap <= 16) return { name: "biweekly", days: 14 };
    if (gap >= 26 && gap <= 35) return { name: "monthly", days: 30 };
    if (gap >= 58 && gap <= 64) return { name: "bimonthly", days: 61 };
    if (gap >= 85 && gap <= 96) return { name: "quarterly", days: 91 };
    if (gap >= 350 && gap <= 380) return { name: "yearly", days: 365 };
    return null;
  };

  const dayMs = 86400000;
  const streams: any[] = [];
  for (const [vendor, txns] of byVendor) {
    if (txns.length < 3) continue;
    const dates = txns.map((t) => Date.parse(t.date));
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) gaps.push(Math.round((dates[i] - dates[i - 1]) / dayMs));
    const g = median(gaps);
    const cadence = cadenceOf(g);
    if (!cadence) continue;
    // Regular enough? Most gaps should sit near the median.
    const regular = gaps.filter((x) => Math.abs(x - g) <= Math.max(3, g * 0.2)).length;
    if (regular / gaps.length < 0.6) continue;

    const amounts = txns.map((t) => t.amount);
    const avg = amounts.reduce((s, v) => s + v, 0) / amounts.length;
    const last = txns[txns.length - 1];
    const dom = median(txns.map((t) => Number(t.date.slice(8, 10))));
    streams.push({
      vendor,
      cadence: cadence.name,
      cadence_days: cadence.days,
      avg_amount: Math.round(avg),
      last_amount: last.amount,
      count: txns.length,
      last_date: last.date,
      day_of_month: dom,
      account: last.book_category,
      entity_name: last.entity_name,
      next_expected: new Date(Date.parse(last.date) + cadence.days * dayMs).toISOString().slice(0, 10),
    });
  }
  streams.sort((a, b) => Math.abs(b.avg_amount) - Math.abs(a.avg_amount));
  return ok({ streams });
}
