import { sb } from "./auth.js";
import { fetchAll } from "./db-pages.js";

/**
 * The loan ledger, shared by the Books Loans page and the Treasury report.
 *
 * HTTP surface: none; read by lib/books/reports.ts (?report=loans), the
 * balance sheet and the Treasury report.
 * Who may call it: server code. Env: SUPABASE_URL and SUPABASE_SERVICE_KEY (through sb and fetchAll).
 *
 * A loan's balance = starting_balance + advances − repayments, where the
 * moving parts come from transactions linked by loan_id or carrying the
 * intercompany loan class. (The old "Name (loan)" category convention is
 * retired; such rows now carry a loan_id.) A loan-class row tied to no
 * registered loan still shows up as an implicit loan, named from its
 * category or vendor.
 */

export type LoanTxn = {
  transaction_id: string;
  account_id: string;
  date: string;
  name: string | null;
  merchant_name: string | null;
  amount: number;
  book_category: string | null;
  intercompany_class: string | null;
  loan_id: string | null;
  [key: string]: unknown;
};

export type Loan = {
  id: string | null; // null = implicit (category-only, not yet registered)
  name: string;
  /** receivable (owed to the family) or payable; null until recorded. */
  direction: string | null;
  /** The entity that holds the loan. */
  holder_entity_name: string | null;
  counterparty: string | null;
  rate: number | null;
  start_date: string | null;
  maturity_date: string | null;
  /** The day the starting balance was counted as of. */
  starting_balance_as_of: string | null;
  hidden_reason: string | null;
  notes: string | null;
  /**
   * Rows filed to 9300 Loans with no loan attached whose payee names this
   * loan's borrower: shown as "not attached yet", never counted until a
   * person attaches them.
   */
  unattached: LoanTxn[];
  show_on_report: boolean;
  starting_balance: number;
  advanced: number;
  repaid: number;
  outstanding: number;
  first_date: string | null;
  last_date: string | null;
  transactions: LoanTxn[];
};

const cleanName = (category: string) => category.replace(/\s*\(loan\)\s*$/i, "").trim();

export async function computeLoans(): Promise<{ loans: Loan[]; totalOutstanding: number }> {
  // select=* so the terms added by migration 20261107 come through once applied.
  const registry = await sb<Array<Record<string, any> & { id: string; name: string; starting_balance: number; show_on_report: boolean; archived_at: string | null }>>("book_loans?archived_at=is.null&select=*&order=created_at.asc");

  // Every page: a balance summed from the first 1,000 rows is silently wrong.
  const txns = await fetchAll<LoanTxn>(
    "book_transactions?select=*&pending=eq.false" +
      // Loans are identified by an explicit loan_id or the intercompany loan
      // class. (The old "Name (loan)" category convention was retired when the
      // chart of accounts went numeric — those rows now carry a loan_id.)
      "&or=(loan_id.not.is.null,intercompany_class.eq.loan)" +
      "&order=date.desc,transaction_id.asc",
  );

  // Entities resolve live from the mappings, not from the stamp written at
  // sync time — the same overlay every other Books read applies.
  const prefs = await sb<Array<{ account_id: string; entity_id: string | null; entity_name: string | null }>>("plaid_account_prefs?select=account_id,entity_id,entity_name&archived_at=is.null");
  const prefByAccount = new Map((prefs ?? []).map((p) => [p.account_id, p]));
  for (const t of txns ?? []) {
    const pref = prefByAccount.get(t.account_id);
    (t as any).entity_id = pref?.entity_id ?? null;
    (t as any).entity_name = pref?.entity_name ?? null;
  }

  const loans = new Map<string, Loan>();
  for (const row of registry ?? []) {
    loans.set(row.name.toLowerCase(), {
      id: row.id,
      name: row.name,
      direction: row.direction ?? null,
      holder_entity_name: row.holder_entity_name ?? null,
      counterparty: row.counterparty ?? null,
      rate: row.rate === null || row.rate === undefined ? null : Number(row.rate),
      start_date: row.start_date ?? null,
      maturity_date: row.maturity_date ?? null,
      starting_balance_as_of: row.starting_balance_as_of ?? null,
      hidden_reason: row.hidden_reason ?? null,
      notes: row.notes ?? null,
      unattached: [],
      show_on_report: row.show_on_report !== false,
      starting_balance: Number(row.starting_balance) || 0,
      advanced: 0,
      repaid: 0,
      outstanding: 0,
      first_date: null,
      last_date: null,
      transactions: [],
    });
  }
  const byId = new Map([...loans.values()].filter((l) => l.id).map((l) => [l.id!, l]));

  for (const t of txns ?? []) {
    let loan: Loan | undefined;
    if (t.loan_id) loan = byId.get(t.loan_id);
    if (!loan) {
      const name = t.book_category ? cleanName(t.book_category) : (t.merchant_name || t.name || "Loan").trim();
      const key = (name || "Loan").toLowerCase();
      loan = loans.get(key);
      if (!loan) {
        loan = {
          id: null,
          name: name || "Loan",
          direction: null,
          holder_entity_name: null,
          counterparty: null,
          rate: null,
          start_date: null,
          maturity_date: null,
          starting_balance_as_of: null,
          hidden_reason: null,
          notes: null,
          unattached: [],
          show_on_report: true,
          starting_balance: 0,
          advanced: 0,
          repaid: 0,
          outstanding: 0,
          first_date: null,
          last_date: null,
          transactions: [],
        };
        loans.set(key, loan);
      }
    }
    // Plaid signs outflows positive: money out = advanced, money in = repaid.
    if (t.amount > 0) loan.advanced += t.amount;
    else loan.repaid += -t.amount;
    if (!loan.first_date || t.date < loan.first_date) loan.first_date = t.date;
    if (!loan.last_date || t.date > loan.last_date) loan.last_date = t.date;
    loan.transactions.push(t);
  }

  // 9300 rows on no loan: listed under the loan whose borrower they name.
  const loose = await unassignedLoanRows();
  for (const t of loose) {
    (t as any).entity_name = prefByAccount.get(t.account_id)?.entity_name ?? null;
    const loan = [...loans.values()].find((l) => l.id && namesBorrower(l, t));
    if (loan) loan.unattached.push(t);
  }

  const list = [...loans.values()];
  for (const loan of list) loan.outstanding = loan.starting_balance + loan.advanced - loan.repaid;
  list.sort((a, b) => b.outstanding - a.outstanding);

  return { loans: list, totalOutstanding: list.reduce((s, l) => s + l.outstanding, 0) };
}

/** Posted rows filed to 9300 Loans that aren't attached to a loan (every page). */
export async function unassignedLoanRows(): Promise<LoanTxn[]> {
  return fetchAll<LoanTxn>("book_transactions?select=*&pending=eq.false&loan_id=is.null&book_category=like.9300*&order=date.desc,transaction_id.asc");
}

const WORDS = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !["national", "limited", "company", "holdings", "group", "services", "recovery", "trust"].includes(w));

/** Whether a row's payee names this loan's borrower (a distinctive word of its name or counterparty). Pure. */
export function namesBorrower(loan: Pick<Loan, "name" | "counterparty">, t: Pick<LoanTxn, "name" | "merchant_name">): boolean {
  const words = new Set([...WORDS(loan.name), ...WORDS(loan.counterparty ?? "")]);
  if (!words.size) return false;
  const text = WORDS(`${t.merchant_name ?? ""} ${t.name ?? ""}`);
  return text.some((w) => words.has(w));
}
