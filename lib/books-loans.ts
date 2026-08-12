import { sb } from "./auth.js";

/**
 * The loan ledger, shared by the Books Loans page and the Treasury report.
 *
 * A loan's balance = starting_balance + advances − repayments, where the
 * moving parts come from transactions linked by loan_id or carrying the
 * "Name (loan)" category. Categorized transactions whose name matches no
 * registered loan still show up as implicit loans, so marking transactions
 * works before (or without) registering the loan.
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
  const registry = await sb<
    Array<{ id: string; name: string; starting_balance: number; show_on_report: boolean; archived_at: string | null }>
  >("book_loans?archived_at=is.null&select=id,name,starting_balance,show_on_report,archived_at&order=created_at.asc");

  const txns = await sb<LoanTxn[]>(
    "book_transactions?select=*&pending=eq.false" +
      // The ilike pattern is quoted — bare parentheses inside an or=() group
      // break PostgREST's parser and the filter silently matches nothing.
      '&or=(loan_id.not.is.null,book_category.ilike."*(loan)*",intercompany_class.eq.loan)' +
      "&order=date.desc&limit=2000"
  );

  const loans = new Map<string, Loan>();
  for (const row of registry ?? []) {
    loans.set(row.name.toLowerCase(), {
      id: row.id,
      name: row.name,
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
      const name = t.book_category
        ? cleanName(t.book_category)
        : (t.merchant_name || t.name || "Loan").trim();
      const key = (name || "Loan").toLowerCase();
      loan = loans.get(key);
      if (!loan) {
        loan = {
          id: null,
          name: name || "Loan",
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

  const list = [...loans.values()];
  for (const loan of list) loan.outstanding = loan.starting_balance + loan.advanced - loan.repaid;
  list.sort((a, b) => b.outstanding - a.outstanding);

  return { loans: list, totalOutstanding: list.reduce((s, l) => s + l.outstanding, 0) };
}
