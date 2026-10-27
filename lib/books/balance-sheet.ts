import { computeLoans } from "../books-loans.js";
import { fetchAll } from "../db-pages.js";
import { parseEntities } from "./filters.js";
import { ok, type Query, type Reply } from "./types.js";

/**
 * ?report=balance-sheet — what the family owns and owes, as of the last
 * balance snapshot. Cash and investments from the connected accounts, loans
 * receivable from the ledger, credit cards as liabilities.
 */
export async function balanceSheetReport(query: Query): Promise<Reply> {
  const selection = parseEntities(String(query.entity ?? "all"));

  const identities = await fetchAll<{
    account_id: string;
    institution_name: string | null;
    mask: string | null;
    subtype: string | null;
    account_name: string | null;
    nickname: string | null;
    entity_id: string | null;
    entity_name: string | null;
    hidden: boolean;
    archived_at: string | null;
  }>("plaid_account_prefs?select=*&archived_at=is.null");
  const states = await fetchAll<{ account_id: string; balance: number | null; seen_at: string }>(
    "plaid_account_state?select=account_id,balance,seen_at"
  );
  const stateBy = new Map(states.map((st) => [st.account_id, st]));

  const INVESTISH = /ira|brokerage|trust|401|403|roth|529|pension|annuity|mutual/i;
  // Loan/mortgage/line-of-credit accounts are liabilities, not cash —
  // without them here their principal would land in the cash bucket and
  // inflate assets. (Plaid's account `type` would be the fuller signal;
  // we key on subtype since that's what we store.)
  const LIABILITY = /credit|mortgage|line of credit|heloc|home equity|student|overdraft|paypal/i;
  type Row = { label: string; detail: string; balance: number };
  const cash: Row[] = [];
  const investments: Row[] = [];
  const credit: Row[] = [];
  let asOf: string | null = null;

  for (const id of identities) {
    if (id.hidden) continue;
    if (selection && (!id.entity_id || !selection.includes(id.entity_id))) continue;
    const st = stateBy.get(id.account_id);
    if (!st || st.balance == null) continue; // no snapshot = not on the sheet
    if (Math.abs(Number(st.balance)) < 0.005) continue;
    if (!asOf || st.seen_at > asOf) asOf = st.seen_at;

    const subtype = (id.subtype ?? "").toLowerCase();
    const label = id.entity_name || id.nickname || id.account_name || "Account";
    const detailBits = [id.institution_name, id.mask ? `····${id.mask}` : null, id.subtype]
      .filter(Boolean)
      .join(" · ");
    const row: Row = { label, detail: detailBits, balance: Number(st.balance) };

    if (LIABILITY.test(subtype)) credit.push(row);
    else if (INVESTISH.test(subtype)) investments.push(row);
    else cash.push(row);
  }

  const byBalance = (a: Row, b: Row) => b.balance - a.balance;
  cash.sort(byBalance);
  investments.sort(byBalance);
  credit.sort(byBalance);

  // Loans receivable are family-level — book_loans carries no entity — so
  // they belong only to the all-entities sheet. Adding them to a single
  // entity's totals would attribute the whole loan book to that one entity
  // (and count it again for the next), overstating per-entity net worth.
  const loanRows =
    selection === null
      ? (await computeLoans()).loans
          .filter((l) => Math.abs(l.outstanding) >= 0.005)
          .map((l) => ({
            label: l.name,
            detail: l.id ? "loan receivable" : "from categories",
            balance: l.outstanding,
          }))
      : [];

  const sum = (rows: Row[]) => rows.reduce((total, r) => total + r.balance, 0);
  const totals = {
    cash: sum(cash),
    investments: sum(investments),
    loans: sum(loanRows),
    credit: sum(credit),
  };
  const totalAssets = totals.cash + totals.investments + totals.loans;

  return ok({
    as_of: asOf,
    entity: selection ? selection.join(",") : "all",
    sections: {
      cash: { rows: cash, total: totals.cash },
      investments: { rows: investments, total: totals.investments },
      loans: { rows: loanRows, total: totals.loans },
      credit: { rows: credit, total: totals.credit },
    },
    total_assets: totalAssets,
    total_liabilities: totals.credit,
    net_worth: totalAssets - totals.credit,
  });
}
