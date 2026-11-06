/**
 * Ask BFO's books figures: the P&L's own arithmetic, imported from
 * lib/books/statements.ts (placeTxn, incomeStatement, scopeOf), the one
 * place income and spending are counted. Ask, Home and Books › Reports give
 * the same answer to "how much did we spend" for the same rows and entities.
 * What this file adds is only what a spoken or written answer needs around
 * those figures: the entity a typed name means, and the totals per entity.
 *
 * HTTP surface: none; lib/ask.ts's books tools call it.
 * Who may call it: server code, for staff (partners never get the books tools).
 * Env: none (pure).
 */

import { incomeStatement, placeTxn, type IncomeStatement, type Placement, type PlaceableTxn, type Scope } from "./books/statements.js";

export { scopeOf } from "./books/statements.js";

/** The columns a ledger row needs to be placed on the P&L. */
export const PNL_COLUMNS = "transaction_id,date,amount,account_id,book_category,plaid_category,txn_type,type_override,intercompany,counterparty_account_id,loan_id";

export type LedgerRow = PlaceableTxn & { account_id: string; entity_name?: string | null };

/** Where one row lands on the P&L (lib/books/statements.ts placeTxn). */
export function pnlPlace(t: LedgerRow, scope: Scope): Placement {
  return placeTxn(t, scope);
}

export type AskBooks = IncomeStatement & {
  /** The same statement, entity by entity (the live mapping's names). */
  byEntity: { entity: string; receipts: number; disbursements: number; net: number; uncategorized: number }[];
};

/** The P&L's totals for these rows and this scope, and the same per entity. */
export function pnlSummary(rows: LedgerRow[], scope: Scope): AskBooks {
  const all = incomeStatement(rows, scope);
  const groups = new Map<string, LedgerRow[]>();
  for (const t of rows) {
    const who = t.entity_name?.trim() || "No entity";
    (groups.get(who) ?? groups.set(who, []).get(who)!).push(t);
  }
  const byEntity = [...groups.entries()]
    .map(([entity, list]) => {
      const s = incomeStatement(list, scope);
      return { entity, receipts: s.receipts, disbursements: s.disbursements, net: s.net, uncategorized: s.uncategorized.count };
    })
    .sort((a, b) => b.receipts + b.disbursements - (a.receipts + a.disbursements) || a.entity.localeCompare(b.entity));
  return { ...all, byEntity };
}

/** "Ledger Louise, LLC" and "ledger louise llc" are the same name. */
const loose = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\(\s*[^)]*\)/g, " ")
    .replace(/\b(llc|l\.l\.c\.|inc|corp|corporation|lp|trust)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The entity a typed name means, resolved against the live account mappings
 * (plaid_account_prefs), the way Books scopes a report: by the accounts
 * mapped to the entity now, not by the name stamped on each row at sync.
 * Exact (loose) match first, then a containing one.
 */
export function entitySelection(prefs: Iterable<{ entity_id: string | null; entity_name: string | null }>, typed: unknown): { ids: string[]; names: string[] } | { error: string; known: string[] } {
  const entities = new Map<string, string>();
  for (const p of prefs) if (p.entity_id) entities.set(p.entity_id, p.entity_name ?? p.entity_id);
  const want = loose(typed);
  const all = [...entities.entries()];
  const known = all.map(([, name]) => name).sort((a, b) => a.localeCompare(b));
  if (!want) return { error: "Name an entity.", known };
  const exact = all.filter(([, name]) => loose(name) === want);
  const hits = exact.length ? exact : all.filter(([, name]) => loose(name).includes(want) || want.includes(loose(name)));
  if (!hits.length) return { error: `No bank account is mapped to an entity called “${String(typed)}”.`, known };
  return { ids: hits.map(([id]) => id), names: hits.map(([, name]) => name) };
}
