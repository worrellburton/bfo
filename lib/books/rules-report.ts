import { fetchAll } from "../db-pages.js";
import { kindOf, orderRules, overlaps, ruleMatches, type TaughtRule } from "./ledger.js";
import { ok, type Reply } from "./types.js";

/**
 * The Rules page's read (GET /api/books/ledger?report=rules): every taught
 * rule in the order the books try them (exact payee first, then the more
 * specific text), each with how many transactions it reaches now with the
 * same matcher the sync uses, how many it has filed (its history), the
 * other rules that reach the same rows, and who made it and why. The
 * built-in chart rules follow, read-only.
 *
 * HTTP surface: none here; api/books/ledger.ts serves it.
 * Who may call it: anyone signed in (the router checks).
 * Env: SUPABASE_URL and SUPABASE_SERVICE_KEY (through fetchAll).
 */

type Rule = TaughtRule & { id: string; created_at: string; created_by_name?: string | null; reason?: string | null };

export async function rulesLedgerReport(builtIns: Array<{ match: string; category: string | null; type: string | null; payeeOnly: boolean; plaid: string | null }>): Promise<Reply> {
  const [rules, txns, loans, prefs] = await Promise.all([
    fetchAll<Rule>("book_rules?select=*&order=id.asc"),
    fetchAll<{ transaction_id: string; merchant_name: string | null; name: string | null; date: string; account_id: string }>("book_transactions?select=transaction_id,merchant_name,name,date,account_id&order=transaction_id.asc"),
    fetchAll<{ id: string; name: string }>("book_loans?select=id,name&order=id.asc"),
    fetchAll<{ account_id: string; entity_id: string | null }>("plaid_account_prefs?select=account_id,entity_id&order=account_id.asc"),
  ]);
  const entity = new Map(prefs.map((p) => [p.account_id, p.entity_id]));
  const rows = txns.map((t) => ({ name: t.name, merchant_name: t.merchant_name, date: t.date, entity_id: entity.get(t.account_id) ?? null }));
  const ordered = orderRules(rules);

  // Filed: the rows each rule's history says it changed (source "rule:<id>").
  const filed = new Map<string, Set<string>>();
  try {
    for (const e of await fetchAll<{ transaction_id: string; source: string }>("book_txn_log?select=transaction_id,source&source=like.rule:*&order=id.asc")) {
      const id = e.source.slice(5);
      (filed.get(id) ?? filed.set(id, new Set()).get(id)!).add(e.transaction_id);
    }
  } catch {
    // the count is context, not the rule
  }

  const over = overlaps(ordered, rows);
  const loanName = new Map(loans.map((l) => [l.id, l.name]));
  return ok({
    rules: ordered.map((r, i) => ({
      id: r.id,
      position: i + 1,
      match: r.match,
      match_kind: kindOf(r),
      book_category: r.book_category ?? null,
      vendor_name: r.vendor_name ?? null,
      type_override: r.type_override ?? null,
      loan_id: r.loan_id ?? null,
      loan_name: r.loan_id ? (loanName.get(r.loan_id) ?? null) : null,
      created_at: r.created_at,
      created_by_name: r.created_by_name ?? null,
      reason: r.reason ?? null,
      matches: rows.filter((t) => ruleMatches(r, t)).length,
      filed: filed.get(r.id)?.size ?? null,
      overlaps: (over.get(r.id) ?? []).map((id) => {
        const o = rules.find((x) => x.id === id);
        return { id, match: o?.match ?? "", wins: !!o && ordered.indexOf(o) < i };
      }),
    })),
    built_in: builtIns,
  });
}
