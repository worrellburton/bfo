import type { Pref } from "./types.js";
import { scopeFilter } from "./prefs.js";

/**
 * Query-string → PostgREST filter for the transactions ledger. Pure, so the
 * exact filter text the page and its summary share can be asserted in tests.
 *
 * HTTP surface: none; read by lib/books/reports.ts (?report=transactions).
 * Who may call it: server code. Env: none.
 */

/** Comma-separated entity ids, or null meaning "all". */
export function parseEntities(raw: string | undefined): string[] | null {
  if (!raw || raw === "all") return null;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length ? ids : null;
}

/**
 * A free-text search term made safe for a PostgREST `ilike.*term*` inside an
 * or=() filter. Comma and parens are PostgREST or=() structure — turn them
 * (and any typed *) into wildcards so a literal "Burton, Robert" still matches
 * across the punctuation. The LIKE metacharacters _ and % are escaped. Not
 * URL-encoded: callers encode when they splice it into a path.
 */
export function likeTerm(q: string): string {
  return q
    .replace(/[,()*]/g, "*")
    .replace(/([\\%_])/g, "\\$1")
    .trim();
}

/** A four-digit year from the query, else the current year. */
export function yearOf(raw: unknown): string {
  return /^\d{4}$/.test(String(raw)) ? String(raw) : String(new Date().getFullYear());
}

/**
 * Optional sort: sort=<key>.<dir>, whitelisted to real columns. The
 * transaction_id tiebreaker keeps pagination stable across pages.
 */
const SORT_COLUMNS: Record<string, string> = {
  date: "date",
  amount: "amount",
  vendor: "merchant_name",
  account: "book_category",
  entity: "entity_name",
  description: "name",
};

export function orderClause(sort: unknown): string {
  const [sortKey, sortDirRaw] = String(sort ?? "").split(".");
  const sortCol = SORT_COLUMNS[sortKey];
  const sortDir = sortDirRaw === "asc" ? "asc" : "desc";
  return sortCol ? `&order=${sortCol}.${sortDir}.nullslast,transaction_id.asc` : "&order=date.desc,transaction_id.asc";
}

/**
 * A period as the ledger's `year` parameter carries it: "2026" (a year),
 * "2026-11" (a month), "2026-Q3" (a quarter) or "2026-01-01..2026-11-06" (a
 * range). Null for anything else (all time).
 */
export function periodSpan(raw: unknown): { from: string; to: string } | null {
  const s = String(raw ?? "").trim();
  let m = /^(\d{4})$/.exec(s);
  if (m) return { from: `${m[1]}-01-01`, to: `${m[1]}-12-31` };
  m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(s);
  if (m) {
    const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
    return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}` };
  }
  m = /^(\d{4})-Q([1-4])$/.exec(s);
  if (m) {
    const q = Number(m[2]);
    const startMonth = (q - 1) * 3 + 1;
    const end = new Date(Date.UTC(Number(m[1]), startMonth + 2, 0)).getUTCDate();
    return { from: `${m[1]}-${String(startMonth).padStart(2, "0")}-01`, to: `${m[1]}-${String(startMonth + 2).padStart(2, "0")}-${end}` };
  }
  m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(s);
  if (m && m[1] <= m[2]) return { from: m[1], to: m[2] };
  return null;
}

type TxnQuery = { entity?: string; type?: string; q?: string; year?: string };

/**
 * The row filter for ?report=transactions: entity scope, year, an
 * override-aware type filter (kept server-side for correct counts), and the
 * free-text search. Built once and shared by the page query and the summary.
 */
export function transactionsFilter(prefs: Map<string, Pref>, { entity, type, q, year }: TxnQuery): string {
  const selection = entity === "unmapped" ? ("unmapped" as const) : parseEntities(entity);
  let filter = scopeFilter(prefs, selection);
  const span = periodSpan(year);
  if (span) filter += `&date=gte.${span.from}&date=lte.${span.to}`;
  // Override-aware type filters, kept server-side for correct counts.
  if (type === "transfers") {
    filter += `&or=(type_override.eq.transfer,and(type_override.is.null,txn_type.eq.transfer,intercompany.is.false))`;
  } else if (type === "intercompany") {
    filter += `&or=(type_override.eq.intercompany,and(type_override.is.null,intercompany.is.true))`;
  } else if (type === "uncategorized") {
    filter += `&book_category=is.null`;
  } else if (type === "revenue") {
    filter += `&book_category=like.4*`;
  } else if (type === "expenses") {
    filter += `&or=(book_category.like.6*,book_category.like.7*)`;
  }
  if (q) {
    const safe = likeTerm(q);
    if (safe) filter += `&or=(name.ilike.*${encodeURIComponent(safe)}*,merchant_name.ilike.*${encodeURIComponent(safe)}*)`;
  }
  return filter;
}
