import { sbFetch as db } from "../auth.js";
import { computeLoans } from "../books-loans.js";
import { ACCOUNTS } from "../books-rules.js";
import { fetchAll } from "../db-pages.js";
import { sunriseUtcDate } from "../sunrise.js";
import { orderClause, transactionsFilter } from "./filters.js";
import { getPrefs, withLiveEntity } from "./prefs.js";
import { ok, type BookTxn, type Query, type Reply } from "./types.js";

/**
 * The ledger-level reads: what the Books pages mount with (meta), the
 * filterable transactions list, the learned rules, the sync settings, the
 * loan registry and the bank reconciliation.
 */

// ── #1 The learned rules — everything the books taught themselves ────────

export async function rulesReport(): Promise<Reply> {
  const rules = await fetchAll<any>(
    "book_rules?select=id,match,book_category,vendor_name,type_override,loan_id,created_at&order=created_at.desc"
  );
  // How many transactions each rule currently touches, for context.
  const counts = new Map<string, number>();
  const txns = await fetchAll<{ merchant_name: string | null; name: string | null }>(
    "book_transactions?select=merchant_name,name&order=transaction_id.asc"
  );
  for (const r of rules) {
    const needle = String(r.match).toLowerCase();
    let n = 0;
    for (const t of txns) {
      if (`${t.merchant_name ?? ""} ${t.name ?? ""}`.toLowerCase().includes(needle)) n++;
    }
    counts.set(r.id, n);
  }
  return ok({ rules: rules.map((r: any) => ({ ...r, matches: counts.get(r.id) ?? 0 })) });
}

// ── Books auto-sync settings — the sunrise toggle + when it next fires ────

export async function settingsReport(): Promise<Reply> {
  const sRes = await db("books_settings?id=eq.1&select=*&limit=1");
  const s = sRes.ok ? ((await sRes.json()) as any[])[0] ?? null : null;
  const now = new Date();
  let nextSunrise = sunriseUtcDate(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), s?.sync_lat ?? 32.2226, s?.sync_lng ?? -110.9747);
  // If today's sunrise already passed, show tomorrow's.
  if (nextSunrise && nextSunrise < now) {
    const t = new Date(now.getTime() + 86400000);
    nextSunrise = sunriseUtcDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), s?.sync_lat ?? 32.2226, s?.sync_lng ?? -110.9747);
  }
  return ok({
    sync_at_sunrise: !!s?.sync_at_sunrise,
    last_auto_sync_date: s?.last_auto_sync_date ?? null,
    next_sunrise_utc: nextSunrise ? nextSunrise.toISOString() : null,
  });
}

// ── Meta: entities, categories, loans, vendors, last sync, row count ──────

export async function metaReport(): Promise<Reply> {
  // One combined scan feeds both the categories and the vendors list, and
  // every independent lookup runs in parallel — this endpoint fires on
  // nearly every Books page mount, so round trips are the whole cost.
  const [prefs, countRes, lastRes, scanRows, loanRows] = await Promise.all([
    getPrefs(),
    db("book_transactions?select=transaction_id&limit=1", { headers: { Prefer: "count=exact" } }),
    db("book_transactions?select=updated_at&order=updated_at.desc&limit=1"),
    fetchAll<{ merchant_name: string | null; name: string | null; book_category: string | null }>(
      "book_transactions?select=merchant_name,name,book_category&order=transaction_id.asc"
    ),
    fetchAll<{ id: string; name: string }>("book_loans?archived_at=is.null&select=id,name&order=name.asc"),
  ]);

  const seen = new Map<string, string>();
  for (const p of prefs.values()) if (p.entity_id) seen.set(p.entity_id, p.entity_name ?? p.entity_id);
  const entities = [...seen.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const total = Number(countRes.headers.get("content-range")?.split("/")[1] ?? 0);
  const last = lastRes.ok ? ((await lastRes.json()) as any[])[0]?.updated_at ?? null : null;

  // The canonical chart of accounts, unioned with anything already filed in
  // the data, so every account (incl. manual-only ones) is always offered.
  const categories = [
    ...new Set([...ACCOUNTS, ...scanRows.map((r) => r.book_category).filter((c): c is string => !!c)]),
  ].sort((a, b) => a.localeCompare(b));

  // Distinct vendor display names — feeds batch autoselect and vendor merge.
  const vendors = [
    ...new Set(scanRows.map((v) => (v.merchant_name || v.name || "").trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));

  return ok({ entities, categories, loans: loanRows, vendors, total_transactions: total, last_synced_at: last });
}

// ── Transactions: filterable, paginated rows (full detail) ───────────────

export async function transactionsReport(query: Query): Promise<Reply> {
  const { entity, type, q, year } = query as Record<string, string | undefined>;
  const limit = Math.min(Number(query.limit ?? 100) || 100, 500);
  const offset = Number(query.offset ?? 0) || 0;

  const prefs = await getPrefs();
  // The filter is built once and shared by the page query and the summary.
  const filter = transactionsFilter(prefs, { entity, type, q, year });
  const path = `book_transactions?select=*${filter}` + orderClause(query.sort);

  const r = await db(path, {
    headers: { Range: `${offset}-${offset + limit - 1}`, Prefer: "count=exact" },
  });
  if (!r.ok) throw new Error(`DB error: ${(await r.text()).slice(0, 300)}`);
  const rows = (await r.json()) as BookTxn[];
  const total = Number(r.headers.get("content-range")?.split("/")[1] ?? rows.length);

  // The first page also carries totals for the whole filtered set — the
  // strip above the ledger (count, outflows, inflows, date span). Later
  // pages skip it; the numbers don't change as you scroll.
  let summary: { count: number; expenses: number; income: number; first: string | null; last: string | null } | null = null;
  // summary=0 skips it: a quick lookup (the home page's search) wants a few rows, not the totals.
  if (offset === 0 && query.summary !== "0") {
    const all = await fetchAll<{ date: string; amount: number | string }>(
      `book_transactions?select=date,amount${filter}&order=date.asc,transaction_id.asc`
    );
    let expenses = 0;
    let income = 0;
    for (const t of all) {
      const a = Number(t.amount);
      if (a > 0) expenses += a;
      else income -= a;
    }
    summary = {
      count: all.length,
      expenses: Math.round(expenses * 100) / 100,
      income: Math.round(income * 100) / 100,
      first: all[0]?.date ?? null,
      last: all[all.length - 1]?.date ?? null,
    };
  }
  return ok({ transactions: withLiveEntity(rows, prefs), total, offset, limit, summary });
}

// ── #3 Reconciliation: does the ledger tie to each bank balance? ─────────

export async function reconciliationReport(): Promise<Reply> {
  const prefs = await getPrefs();
  const rows = await fetchAll<{ account_id: string; amount: number }>(
    `book_transactions?select=account_id,amount&pending=eq.false&order=transaction_id.asc`
  );
  const ledger = new Map<string, number>();
  for (const t of rows) ledger.set(t.account_id, (ledger.get(t.account_id) ?? 0) - t.amount); // inflow +
  const state = await fetchAll<{ account_id: string; balance: number }>(
    "plaid_account_state?select=account_id,balance"
  );
  const accounts = state
    .map((s) => {
      const pref = prefs.get(s.account_id);
      if (pref?.hidden) return null;
      const ledgerNet = Math.round((ledger.get(s.account_id) ?? 0) * 100) / 100;
      const bankBalance = Math.round(Number(s.balance) * 100) / 100;
      return {
        account_id: s.account_id,
        name: pref?.nickname || pref?.account_name || pref?.mask || s.account_id,
        institution: pref?.institution_name ?? null,
        entity_name: pref?.entity_name ?? null,
        ledger_net: ledgerNet,
        bank_balance: bankBalance,
        has_ledger: ledger.has(s.account_id),
      };
    })
    .filter(Boolean);
  return ok({ accounts });
}

// ── Loans: the registry with its auto-attach rules ───────────────────────

export async function loansReport(): Promise<Reply> {
  const { loans, totalOutstanding } = await computeLoans();
  const rules = await fetchAll<{ id: string; match: string; loan_id: string | null }>(
    "book_rules?loan_id=not.is.null&select=id,match,loan_id"
  );
  return ok({ loans, rules, total_outstanding: totalOutstanding });
}
