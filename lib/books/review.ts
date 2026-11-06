import { sectionOf } from "../books-rules.js";
import { effType, label } from "../books-report.js";
import { fetchAll } from "../db-pages.js";
import { sbFetch as db } from "../auth.js";
import { getPrefs, scopeFilter, withLiveEntity } from "./prefs.js";
import { ok, type BookTxn, type Pref, type Reply } from "./types.js";

/**
 * What wants a person's eyes, and the regular payments calendar.
 *
 *   reviewReport — the review desk: rows with no account, rows still in a
 *   catch-all account, bare checks with no payee, rows whose bank category
 *   contradicts their account, possible duplicates (with the account and
 *   entity, unless a person settled them), the largest items, and the bank
 *   tie-out: opening balance + activity = computed balance, against the
 *   bank's balance and when it was seen.
 *
 *   recurringReport — payments that repeat on a cadence, projected forward:
 *   own-money moves kept apart, streams that stopped marked stale, amounts
 *   as the typical (median) payment of the same direction.
 *
 * HTTP surface: none here; api/books/data.ts serves ?report=review and
 * ?report=recurring.
 * Who may call it: anyone signed in (the router checks).
 * Env: SUPABASE_URL and SUPABASE_SERVICE_KEY (through fetchAll and sbFetch).
 */

const INVESTMENT = /ira|401|403|brokerage|roth|sep|simple|529|hsa|investment|keogh|annuity|pension|retirement|trust|mutual/i;

/** "Operating checking •• 4821" — a nickname or tidied name, then the mask (always). */
function accountName(pref: Pref | undefined, fallback: string): string {
  const base = (pref?.nickname || pref?.account_name || "Account").trim();
  return pref?.mask ? `${base} •• ${pref.mask}` : base || fallback;
}

type Slim = ReturnType<typeof slimOf>;
function slimOf(t: BookTxn, prefs: Map<string, Pref>) {
  return {
    transaction_id: t.transaction_id,
    date: t.date,
    name: t.name,
    merchant_name: t.merchant_name,
    amount: Number(t.amount),
    book_category: t.book_category,
    plaid_category_detailed: t.plaid_category_detailed,
    entity_name: t.entity_name,
    account_id: t.account_id,
    account_name: accountName(prefs.get(t.account_id), t.account_id),
    item_id: t.item_id,
  };
}

/** The bank says "tax payment" (or the description names a tax authority) but the account isn't a tax or flow account. */
function contradicts(t: BookTxn): boolean {
  const detail = (t.plaid_category_detailed ?? "").toUpperCase();
  const text = `${t.merchant_name ?? ""} ${t.name ?? ""}`;
  const taxy = /TAX_PAYMENT/.test(detail) || /internal revenue|revenue agency|\bgcrevenu|dept of rev|franchise tax/i.test(text);
  if (!taxy || !t.book_category) return false;
  const code = t.book_category.slice(0, 4);
  return code !== "6700" && sectionOf(t.book_category) !== "flow";
}

async function settledGroups(): Promise<Map<string, { decided_by_name: string | null; decided_at: string }>> {
  const r = await db("book_duplicate_reviews?select=group_key,decision,decided_by_name,decided_at&decision=eq.separate");
  // Before the ledger migration there is no such table: nothing is settled yet.
  if (!r.ok) return new Map();
  return new Map(((await r.json()) as Array<{ group_key: string; decided_by_name: string | null; decided_at: string }>).map((g) => [g.group_key, g]));
}

async function openings(): Promise<Map<string, { opening_balance: number; as_of: string; set_by_name: string | null }>> {
  const r = await db("book_account_openings?select=account_id,opening_balance,as_of,set_by_name");
  if (!r.ok) return new Map();
  return new Map(((await r.json()) as Array<{ account_id: string; opening_balance: number; as_of: string; set_by_name: string | null }>).map((o) => [o.account_id, { ...o, opening_balance: Number(o.opening_balance) }]));
}

export async function reviewReport(): Promise<Reply> {
  const prefs = await getPrefs();
  const [all, settled, opens, state] = await Promise.all([
    fetchAll<BookTxn>(`book_transactions?select=*${scopeFilter(prefs, null)}&order=transaction_id.asc`),
    settledGroups(),
    openings(),
    fetchAll<{ account_id: string; balance: number | null; seen_at: string | null }>("plaid_account_state?select=account_id,balance,seen_at&order=account_id.asc"),
  ]);
  const rows = withLiveEntity(
    all.filter((t) => !t.pending),
    prefs,
  );
  const slim = (t: BookTxn) => slimOf(t, prefs);

  const uncategorized = rows.filter((t) => !t.book_category && !t.loan_id);
  const CATCHALL = new Set(["6900 Other Operating Expenses", "4900 Other Income"]);
  const lowConfidence = rows.filter((t) => t.book_category && CATCHALL.has(t.book_category));
  const checks = rows.filter((t) => !t.book_category && /^(check|chk)(\s*#?\s*\d+)?$/i.test((t.name ?? "").trim()));
  const mismatched = rows.filter(contradicts);

  // Possible duplicates: the same account, date and amount. Rows from two
  // feeds (the bank feed and an import) are most likely the same payment
  // counted twice; two rows from one feed may be two real payments.
  const groups = new Map<string, BookTxn[]>();
  for (const t of rows) {
    const key = `${t.account_id}|${t.date}|${Math.round(Number(t.amount) * 100)}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  const duplicates = [...groups.entries()]
    .filter(([key, g]) => g.length > 1 && !settled.has(key))
    .map(([key, g]) => ({
      group_key: key,
      count: g.length,
      cross_source: new Set(g.map((t) => t.item_id)).size > 1,
      amount: Number(g[0].amount),
      date: g[0].date,
      account_name: accountName(prefs.get(g[0].account_id), g[0].account_id),
      entity_name: g[0].entity_name,
      rows: g.map(slim),
    }))
    .sort((a, b) => Number(b.cross_source) - Number(a.cross_source) || Math.abs(b.amount) - Math.abs(a.amount));

  // The largest items that reach the P&L, for a sanity read.
  const outliers = rows
    .filter((t) => effType(t) === "normal" && sectionOf(label(t)) !== "flow")
    .sort((a, b) => Math.abs(Number(b.amount)) - Math.abs(Number(a.amount)))
    .slice(0, 15)
    .map(slim);

  // Bank vs books, per account: opening balance (when set) + posted activity
  // after it = the computed balance, against the bank's latest balance.
  // Investment accounts aren't in Books by design and are listed apart.
  const activity = new Map<string, { sum: number; last: string | null }>();
  for (const t of all) {
    if (t.pending) continue;
    const open = opens.get(t.account_id);
    if (open && t.date <= open.as_of) continue;
    const a = activity.get(t.account_id) ?? { sum: 0, last: null };
    a.sum -= Number(t.amount); // money in +
    if (!a.last || t.date > a.last) a.last = t.date;
    activity.set(t.account_id, a);
  }
  const accounts = state
    .map((s) => {
      const pref = prefs.get(s.account_id);
      if (pref?.hidden) return null;
      const subtype = (pref?.subtype ?? "").toLowerCase();
      const investment = INVESTMENT.test(subtype);
      const card = /credit/.test(subtype);
      const open = opens.get(s.account_id) ?? null;
      const act = activity.get(s.account_id);
      const ledger = Math.round(((open?.opening_balance ?? 0) + (act?.sum ?? 0)) * 100) / 100;
      // A card's balance is what's owed; the ledger's net in is the negative of it.
      const bank = s.balance === null || s.balance === undefined ? null : Math.round((card ? -Number(s.balance) : Number(s.balance)) * 100) / 100;
      const difference = open && bank !== null ? Math.round((bank - ledger) * 100) / 100 : null;
      return {
        account_id: s.account_id,
        name: accountName(pref, s.account_id),
        institution: pref?.institution_name ?? null,
        entity_name: pref?.entity_name ?? null,
        mapped: !!pref?.entity_id,
        investment,
        card,
        opening: open,
        activity: Math.round((act?.sum ?? 0) * 100) / 100,
        ledger,
        bank_balance: bank,
        bank_seen_at: s.seen_at,
        ledger_through: act?.last ?? null,
        has_ledger: !!act,
        difference,
        status: investment ? "not_in_books" : !act ? "no_rows" : !open ? "needs_opening" : difference !== null && Math.abs(difference) < 0.005 ? "tied" : "off",
        // Kept for older pages.
        ledger_net: ledger,
      };
    })
    .filter((a): a is NonNullable<typeof a> => !!a)
    .sort((a, b) => Number(a.investment) - Number(b.investment) || (a.entity_name ?? "~").localeCompare(b.entity_name ?? "~") || a.name.localeCompare(b.name));

  return ok({
    counts: {
      uncategorized: uncategorized.length,
      low_confidence: lowConfidence.length,
      duplicate_groups: duplicates.length,
      checks: checks.length,
      mismatched: mismatched.length,
      pending: all.filter((t) => t.pending).length,
    },
    uncategorized: uncategorized.slice(0, 100).map(slim),
    low_confidence: lowConfidence.slice(0, 100).map(slim),
    checks: checks.slice(0, 50).map(slim),
    mismatched: mismatched.slice(0, 50).map(slim),
    duplicates: duplicates.slice(0, 100),
    outliers,
    reconciliation: { accounts, openings_available: opens.size > 0 || (await openingsTable()) },
  });
}

async function openingsTable(): Promise<boolean> {
  const r = await db("book_account_openings?select=account_id&limit=1");
  return r.ok;
}

export type { Slim };

// ── Regular payments, projected ────────────────────────────────────────────

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function cadenceOf(gap: number): { name: string; days: number } | null {
  if (gap >= 6 && gap <= 8) return { name: "weekly", days: 7 };
  if (gap >= 12 && gap <= 16) return { name: "every two weeks", days: 14 };
  if (gap >= 26 && gap <= 35) return { name: "monthly", days: 30 };
  if (gap >= 58 && gap <= 64) return { name: "every two months", days: 61 };
  if (gap >= 85 && gap <= 96) return { name: "quarterly", days: 91 };
  if (gap >= 350 && gap <= 380) return { name: "yearly", days: 365 };
  return null;
}

const DAY = 86_400_000;

/**
 * One vendor's dated amounts as a stream, or null when they don't repeat on
 * a cadence. Pure, so it's tested. Amounts are Plaid-signed (money out
 * positive). The typical amount is the median of the last six payments in
 * the stream's usual direction (refunds and penny tests left out); a stream
 * more than one and a half cadences past its last payment is stale.
 */
export function streamOf(txns: Array<{ date: string; amount: number }>, today: string) {
  if (txns.length < 3) return null;
  const sorted = [...txns].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const dates = sorted.map((t) => Date.parse(`${t.date}T00:00:00Z`));
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) gaps.push(Math.round((dates[i] - dates[i - 1]) / DAY));
  const g = median(gaps);
  const cadence = cadenceOf(g);
  if (!cadence) return null;
  const regular = gaps.filter((x) => Math.abs(x - g) <= Math.max(3, g * 0.2)).length;
  if (regular / gaps.length < 0.6) return null;
  const outs = sorted.filter((t) => t.amount > 0).length;
  const out = outs >= sorted.length - outs;
  const same = sorted.filter((t) => (out ? t.amount > 0 : t.amount < 0));
  const typical = Math.round(median(same.slice(-6).map((t) => t.amount)) * 100) / 100;
  const last = sorted[sorted.length - 1];
  const sinceLast = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last.date}T00:00:00Z`)) / DAY;
  return {
    cadence: cadence.name,
    cadence_days: cadence.days,
    typical_amount: typical,
    direction: out ? ("out" as const) : ("in" as const),
    last_amount: last.amount,
    last_date: last.date,
    count: sorted.length,
    day_of_month: median(sorted.map((t) => Number(t.date.slice(8, 10)))),
    stale: sinceLast > cadence.days * 1.5,
    next_expected: new Date(Date.parse(`${last.date}T00:00:00Z`) + cadence.days * DAY).toISOString().slice(0, 10),
    recent_dates: sorted.slice(-8).map((t) => t.date),
  };
}

export async function recurringReport(): Promise<Reply> {
  const prefs = await getPrefs();
  const rows = withLiveEntity(await fetchAll<BookTxn>(`book_transactions?select=*&pending=eq.false${scopeFilter(prefs, null)}&order=date.asc,transaction_id.asc`), prefs);
  const today = new Date().toISOString().slice(0, 10);
  // Group by vendor; own-money moves (transfers, intercompany, flow accounts) form their own lane.
  const byVendor = new Map<string, BookTxn[]>();
  for (const t of rows) {
    const v = (t.merchant_name || t.name || "").trim();
    if (!v) continue;
    (byVendor.get(v) ?? byVendor.set(v, []).get(v)!).push(t);
  }
  const streams: Array<Record<string, unknown>> = [];
  for (const [vendor, txns] of byVendor) {
    const s = streamOf(
      txns.map((t) => ({ date: t.date, amount: Number(t.amount) })),
      today,
    );
    if (!s) continue;
    const last = txns[txns.length - 1];
    const own = effType(last) !== "normal" || sectionOf(label(last)) === "flow";
    streams.push({
      vendor,
      ...s,
      // Older pages read these.
      avg_amount: s.typical_amount,
      own_money: own,
      account: last.book_category,
      entity_name: last.entity_name,
    });
  }
  streams.sort((a, b) => Math.abs(Number(b.typical_amount)) - Math.abs(Number(a.typical_amount)));
  return ok({ streams, as_of: today });
}
