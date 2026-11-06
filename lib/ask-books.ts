/**
 * Ask BFO's books arithmetic: income and expenses for any date range,
 * counted the way the P&L in Books › Reports counts them
 * (lib/books/statements.ts, pnlReport), so Ask, Home and Reports give the
 * same answer to "how much did we spend" for the same days.
 *
 * The rules, all taken from the P&L's own exported pieces in
 * lib/books-report.ts and lib/books-accounts.ts:
 *  - a row's kind is effType(): a loan attachment wins, then the person's
 *    override, then the sync's reading;
 *  - transfers, loan movements and anything booked to a 9000s "flow" account
 *    are the family moving its own money, set aside;
 *  - an intercompany row is set aside, and eliminated when both legs'
 *    entities are in the selection (eliminated());
 *  - every other row lands in its account's statement section (revenue,
 *    operating, other) and nets inside the account, so a refund reduces the
 *    expense it refunds instead of counting as income;
 *  - a row with no chart account is filed by its sign (money in under
 *    revenue, money out under operating expenses) and reported separately as
 *    uncategorized, so the answer can say how much of a total is unreviewed.
 *
 * HTTP surface: none; lib/ask.ts's books_summary tool calls it.
 * Who may call it: server code, for staff (partners never get the books tools).
 * Env: none (pure).
 */

import { sectionOf } from "./books-accounts.js";
import { effType, eliminated, label, type ReportTxn } from "./books-report.js";

/** The columns a ledger row needs to be placed on the P&L. */
export const PNL_COLUMNS = "transaction_id,date,amount,account_id,book_category,plaid_category,txn_type,type_override,intercompany,counterparty_account_id,loan_id";

export type LedgerRow = Pick<ReportTxn, "account_id" | "amount" | "book_category" | "plaid_category" | "loan_id" | "type_override" | "intercompany" | "txn_type"> & {
  counterparty_account_id?: string | null;
  entity_name?: string | null;
};

export type PnlSection = "revenue" | "operating" | "other";

/** Where one row lands on the P&L. */
export type Placement = { kind: "statement"; section: PnlSection; account: string; uncategorized: boolean } | { kind: "transfer" | "loan" | "flow" | "intercompany" | "eliminated" };

/** One row's place, the way pnlReport files it. */
export function pnlPlace(t: LedgerRow, selection: string[] | null, entityOfAccount: (accountId: string) => string | null | undefined): Placement {
  const eff = effType(t);
  if (eff === "intercompany") return eliminated({ counterparty_account_id: t.counterparty_account_id ?? null }, selection, entityOfAccount) ? { kind: "eliminated" } : { kind: "intercompany" };
  if (eff === "transfer" || eff === "loan") return { kind: eff };
  const account = label(t);
  const section = sectionOf(account);
  if (section === "flow") return { kind: "flow" };
  if (section === "revenue" || section === "operating" || section === "other") return { kind: "statement", section, account, uncategorized: false };
  return { kind: "statement", section: Number(t.amount) < 0 ? "revenue" : "operating", account, uncategorized: true };
}

const cents = (n: number) => Math.round(n * 100) / 100;

type Lines = { total: number; accounts: { account: string; amount: number }[] };
type Moves = { count: number; moneyIn: number; moneyOut: number };

export type PnlSummary = {
  transactions: number;
  /** Inflows positive; refunds into an income account reduce it. */
  revenue: Lines;
  /** 6000s: outflows positive; refunds reduce the account they refund. */
  operatingExpenses: Lines;
  /** 7000s: outflows positive. */
  otherExpenses: Lines;
  operatingIncome: number;
  netIncome: number;
  /** Rows with no chart account, already inside the totals above by their sign. */
  uncategorized: Moves;
  /** Not income or expense: transfers between the family's accounts, loan movements and 9000s flow accounts. */
  transfersAndLoans: Moves;
  /** Moves between family entities: left out; `eliminated` when both sides are in the selection. */
  intercompany: Moves & { eliminated: number };
  byEntity: { entity: string; revenue: number; expenses: number; netIncome: number }[];
};

/**
 * Income-statement totals for a set of posted rows. `selection` is the
 * entity ids asked about (null: all), as the P&L takes it, so intercompany
 * eliminations match Reports for the same choice.
 */
export function pnlSummary(rows: LedgerRow[], selection: string[] | null, entityOfAccount: (accountId: string) => string | null | undefined): PnlSummary {
  const sections: Record<PnlSection, Map<string, number>> = { revenue: new Map(), operating: new Map(), other: new Map() };
  const uncategorized: Moves = { count: 0, moneyIn: 0, moneyOut: 0 };
  const transfersAndLoans: Moves = { count: 0, moneyIn: 0, moneyOut: 0 };
  const intercompany = { count: 0, moneyIn: 0, moneyOut: 0, eliminated: 0 };
  const byEntity = new Map<string, { revenue: number; expenses: number }>();
  const tally = (m: Moves, amount: number) => {
    m.count += 1;
    if (amount < 0) m.moneyIn += -amount;
    else m.moneyOut += amount;
  };

  for (const t of rows) {
    const amount = Number(t.amount);
    const place = pnlPlace(t, selection, entityOfAccount);
    if (place.kind === "eliminated") {
      intercompany.eliminated += 1;
      continue;
    }
    if (place.kind === "intercompany") {
      tally(intercompany, amount);
      continue;
    }
    if (place.kind !== "statement") {
      tally(transfersAndLoans, amount);
      continue;
    }
    // Revenue carries inflows positive; the expense sections carry outflows positive.
    const signed = place.section === "revenue" ? -amount : amount;
    const lines = sections[place.section];
    lines.set(place.account, (lines.get(place.account) ?? 0) + signed);
    if (place.uncategorized) tally(uncategorized, amount);
    const who = t.entity_name?.trim() || "No entity";
    const e = byEntity.get(who) ?? { revenue: 0, expenses: 0 };
    if (place.section === "revenue") e.revenue += signed;
    else e.expenses += signed;
    byEntity.set(who, e);
  }

  const lines = (m: Map<string, number>): Lines => {
    const accounts = [...m.entries()].map(([account, amount]) => ({ account, amount: cents(amount) })).sort((a, b) => b.amount - a.amount || a.account.localeCompare(b.account));
    return { total: cents([...m.values()].reduce((s, v) => s + v, 0)), accounts };
  };
  const revenue = lines(sections.revenue);
  const operatingExpenses = lines(sections.operating);
  const otherExpenses = lines(sections.other);
  const round = <T extends Moves>(m: T): T => ({ ...m, moneyIn: cents(m.moneyIn), moneyOut: cents(m.moneyOut) });
  return {
    transactions: rows.length,
    revenue,
    operatingExpenses,
    otherExpenses,
    operatingIncome: cents(revenue.total - operatingExpenses.total),
    netIncome: cents(revenue.total - operatingExpenses.total - otherExpenses.total),
    uncategorized: round(uncategorized),
    transfersAndLoans: round(transfersAndLoans),
    intercompany: round(intercompany),
    byEntity: [...byEntity.entries()]
      .map(([entity, v]) => ({ entity, revenue: cents(v.revenue), expenses: cents(v.expenses), netIncome: cents(v.revenue - v.expenses) }))
      .sort((a, b) => b.revenue + b.expenses - (a.revenue + a.expenses) || a.entity.localeCompare(b.entity)),
  };
}

/** "Ledger Louise, LLC" and "ledger louise llc" are the same name. */
const loose = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
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
