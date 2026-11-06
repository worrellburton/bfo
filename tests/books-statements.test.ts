import { describe, expect, it } from "vitest";
import {
  apportion,
  buildBlock,
  buildPnl,
  cashFlow,
  cellMatches,
  eliminated,
  figureAt,
  flowSummary,
  incomeExpense,
  incomeStatement,
  placeTxn,
  pnlCell,
  roundCents,
  scopeOf,
  trialBalance,
  unmatchedTransfers,
  type LedgerRow,
  type Scope,
} from "../lib/books/statements";
import { threshold1099, worksheet1099 } from "../lib/books/tax1099";

// The single source: Home, Ask, the ledger strip and the P&L read the same
// rows the same way. Made-up records only.

let n = 0;
const row = (over: Partial<LedgerRow>): LedgerRow => ({
  transaction_id: `t${++n}`,
  account_id: "acc-a",
  date: "2026-10-20",
  amount: 100,
  name: null,
  merchant_name: null,
  entity_id: "E1",
  entity_name: "Northwind Holdings, LLC (100%)",
  plaid_category: null,
  book_category: "6100 Professional Fees",
  txn_type: "normal",
  intercompany: false,
  counterparty_account_id: null,
  type_override: null,
  loan_id: null,
  ...over,
});

const prefs = new Map([
  ["acc-a", { entity_id: "E1", hidden: false }],
  ["acc-b", { entity_id: "E2", hidden: false }],
  ["acc-hid", { entity_id: "E2", hidden: true }],
]);
const ALL_SCOPE: Scope = scopeOf(prefs, null);
const ENTITIES = [
  { id: "E1", name: "Northwind Holdings, LLC" },
  { id: "E2", name: "Alder Family Trust" },
];

describe("placeTxn", () => {
  it("files a chart account to its section and nature", () => {
    expect(placeTxn(row({ amount: -500, book_category: "4000 Rental Income" }))).toMatchObject({ kind: "line", section: "revenue", nature: "income", cents: 50000 });
    expect(placeTxn(row({ amount: 80, book_category: "7000 Mortgage Interest" }))).toMatchObject({ kind: "line", section: "other", nature: "expense", cents: -8000 });
    expect(placeTxn(row({ amount: -900, book_category: "4300 Social Security Income" }))).toMatchObject({ kind: "line", section: "personal", nature: "income" });
    expect(placeTxn(row({ amount: 40, book_category: "6750 Medical" }))).toMatchObject({ kind: "line", section: "personal", nature: "expense" });
  });
  it("keeps uncategorized rows out of the statement", () => {
    expect(placeTxn(row({ book_category: null, plaid_category: "HOME_IMPROVEMENT" }))).toMatchObject({ kind: "uncategorized", account: "Home improvement" });
  });
  it("sends moves of the family's own money to flow groups", () => {
    expect(placeTxn(row({ txn_type: "transfer", book_category: "9100 Internal Transfers" }))).toMatchObject({ kind: "flow", group: "own" });
    expect(placeTxn(row({ book_category: "9150 Credit Card Payments" }))).toMatchObject({ kind: "flow", group: "own" });
    expect(placeTxn(row({ book_category: "9210 Trustee Draws — Amanda" }))).toMatchObject({ kind: "flow", group: "distributions" });
    expect(placeTxn(row({ book_category: "9400 Capital Improvements" }))).toMatchObject({ kind: "flow", group: "capital" });
    expect(placeTxn(row({ loan_id: "L1", book_category: "4000 Rental Income" }))).toMatchObject({ kind: "flow", group: "loans" });
    expect(placeTxn(row({ book_category: "9000 Intercompany" }))).toMatchObject({ kind: "flow", group: "intercompany", eliminated: false });
  });
  it("flags an income or expense account typed as a transfer", () => {
    expect(placeTxn(row({ type_override: "transfer", book_category: "4900 Other Income" }))).toMatchObject({ kind: "flow", group: "conflict" });
  });
});

describe("eliminated", () => {
  const entityOf = (id: string) => ({ "acc-a": "E1", "acc-b": "E2" })[id];
  it("needs the other leg in Books and in the selection", () => {
    expect(eliminated({ counterparty_account_id: "acc-b" }, null, entityOf)).toBe(true);
    expect(eliminated({ counterparty_account_id: "acc-b" }, ["E1", "E2"], entityOf)).toBe(true);
    expect(eliminated({ counterparty_account_id: "acc-b" }, ["E1"], entityOf)).toBe(false);
  });
  it("an unpaired leg stays visible, even for all entities", () => {
    expect(eliminated({ counterparty_account_id: null }, null, entityOf)).toBe(false);
    expect(eliminated({ counterparty_account_id: "acc-elsewhere" }, null, entityOf)).toBe(false);
  });
  it("a hidden account's leg isn't in the report", () => {
    expect(placeTxn(row({ intercompany: true, counterparty_account_id: "acc-hid" }), ALL_SCOPE)).toMatchObject({ eliminated: false });
    expect(placeTxn(row({ intercompany: true, counterparty_account_id: "acc-b" }), ALL_SCOPE)).toMatchObject({ eliminated: true });
  });
});

describe("whole dollars that foot", () => {
  it("rounds half away from zero", () => {
    expect(roundCents(250)).toBe(3);
    expect(roundCents(-250)).toBe(-3);
    expect(roundCents(249)).toBe(2);
  });
  it("apportions cells to their rounded total", () => {
    const cells = [40, 40, 40, 0];
    const out = apportion(cells, roundCents(120));
    expect(out.reduce((s, v) => s + v, 0)).toBe(1);
    expect(out[3]).toBe(0);
    for (let trial = 0; trial < 200; trial++) {
      const c = Array.from({ length: 12 }, (_, i) => (i % 5 === 3 ? 0 : Math.round((Math.sin(trial * 7 + i) * 1e6) % 99999)));
      const total = roundCents(c.reduce((s, v) => s + v, 0));
      const got = apportion(c, total);
      expect(got.reduce((s, v) => s + v, 0)).toBe(total);
      got.forEach((v, i) => expect(Math.abs(v - c[i] / 100)).toBeLessThan(1.0001));
    }
  });
  it("a block foots and cross-foots, with a rounding line when the lines don't add up", () => {
    // Three lines of $0.40 in January: each shows $0, the section is $1.
    const lines = [0, 1, 2].map((i) => ({ label: `600${i} Line ${i}`, drill: "operating", cells: { monthly: [40, ...Array(11).fill(0)], byEntity: [40, 0] } }));
    const b = buildBlock("operating", "Operating expenses", "out", lines, { months: 12, entities: 2 });
    expect(b.total.total).toBe(1);
    expect(b.rounding).not.toBeNull();
    for (let m = 0; m < 12; m++) expect(b.lines.reduce((s, l) => s + l.figures.monthly[m], 0) + b.rounding!.monthly[m]).toBe(b.total.monthly[m]);
    expect(b.total.monthly.reduce((s, v) => s + v, 0)).toBe(b.total.total);
    expect(b.total.by_entity.reduce((s, v) => s + v, 0)).toBe(b.total.total);
    for (const l of b.lines) expect(l.figures.monthly.reduce((s, v) => s + v, 0)).toBe(l.figures.total);
  });
});

// A ledger with the awkward cases: refunds, fractions of a cent apart,
// uncategorized rows, transfers, intercompany legs, personal items, a loan.
const now = new Date("2026-10-27T12:00:00Z");
const ledger: LedgerRow[] = [
  row({ date: "2026-10-20", amount: -1000.4, book_category: "4000 Rental Income", merchant_name: "Tenant" }),
  row({ date: "2026-10-21", amount: 25.25, book_category: "4000 Rental Income", merchant_name: "Tenant refund" }),
  row({ date: "2026-10-15", amount: 250.33, book_category: "6100 Professional Fees", merchant_name: "Keyt Law" }),
  row({ date: "2026-10-16", amount: -50.11, book_category: "6100 Professional Fees", merchant_name: "Keyt Law refund" }),
  row({ date: "2026-10-12", amount: 2238.07, book_category: "7000 Mortgage Interest" }),
  row({ date: "2026-10-11", amount: -1650.5, book_category: "4300 Social Security Income", account_id: "acc-b", entity_id: "E2" }),
  row({ date: "2026-10-10", amount: 310.49, book_category: "6750 Medical", account_id: "acc-b", entity_id: "E2" }),
  row({ date: "2026-10-09", amount: 99.99, book_category: null, plaid_category: "HOME_IMPROVEMENT" }),
  row({ date: "2026-10-08", amount: 500, txn_type: "transfer", book_category: "9100 Internal Transfers" }),
  row({ date: "2026-10-08", amount: -500, txn_type: "transfer", book_category: "9100 Internal Transfers", account_id: "acc-b", entity_id: "E2" }),
  row({ date: "2026-10-07", amount: 1200, intercompany: true, counterparty_account_id: "acc-b", book_category: "9000 Intercompany" }),
  row({ date: "2026-10-07", amount: 75, intercompany: true, counterparty_account_id: null, book_category: "9000 Intercompany" }),
  row({ date: "2026-10-06", amount: -300, loan_id: "L1", book_category: "9300 Loans" }),
  row({ date: "2026-09-10", amount: -400.01, book_category: "4000 Rental Income" }),
  row({ date: "2026-09-05", amount: 100.02, book_category: "6100 Professional Fees" }),
  row({ date: "2026-03-05", amount: 0.4, book_category: "6250 Utilities" }),
  row({ date: "2026-03-06", amount: 0.4, book_category: "6300 Repairs & Maintenance" }),
  row({ date: "2026-03-07", amount: 0.4, book_category: "6400 Bank & Card Fees" }),
];

const cents = (v: number) => Math.round(v * 100);

describe("Home, Ask, the ledger strip and the P&L agree to the cent", () => {
  it("over the same rows", () => {
    const ask = incomeStatement(ledger, ALL_SCOPE);
    const pnl = buildPnl(ledger, ALL_SCOPE, { year: 2026, entities: ENTITIES });
    const strip = incomeExpense(ledger, ALL_SCOPE);

    // Receipts: rent net of its refund, plus Social Security (personal).
    expect(cents(ask.receipts)).toBe(100040 - 2525 + 40001 + 165050);
    // Disbursements: fees net of the refund, mortgage interest, medical, the three small bills.
    expect(cents(ask.disbursements)).toBe(25033 - 5011 + 10002 + 223807 + 31049 + 120);
    expect(cents(ask.net)).toBe(cents(ask.receipts) - cents(ask.disbursements));

    expect(pnl.receipts).toBe(ask.receipts);
    expect(pnl.disbursements).toBe(ask.disbursements);
    expect(pnl.net_exact).toBe(ask.net);
    expect(pnl.net.exact).toBe(ask.net);
    expect(strip.income).toBe(ask.receipts);
    expect(strip.expenses).toBe(ask.disbursements);

    // Each section's exact total is the same in both.
    for (const b of pnl.sections) expect(b.total.exact).toBe(ask.sections[b.key as keyof typeof ask.sections].total);
    expect(pnl.operating_income.exact).toBe(ask.operatingIncome);

    // Uncategorized rows are beside the totals, in all three.
    expect(ask.uncategorized).toMatchObject({ out: 99.99, count: 1 });
    expect(strip.uncategorized).toEqual(ask.uncategorized);
    expect(pnl.uncategorized.total.exact).toBe(-99.99);
  });

  it("Home's 30-day window is the same sum over its own days", () => {
    const home = flowSummary(ledger, now, () => "Northwind Holdings, LLC (100%)", 40, ALL_SCOPE);
    const windowRows = ledger.filter((t) => t.date > "2026-09-27" && t.date <= "2026-10-27");
    const ask = incomeStatement(windowRows, ALL_SCOPE);
    expect(home.current.in).toBe(ask.receipts);
    expect(home.current.out).toBe(ask.disbursements);
    expect(home.current.net).toBe(ask.net);
    expect(home.current.uncategorized).toEqual(ask.uncategorized);
    // The month bars are the P&L's months, to the cent.
    const pnl = buildPnl(ledger, ALL_SCOPE, { year: 2026, entities: ENTITIES });
    const oct = incomeStatement(
      ledger.filter((t) => t.date.startsWith("2026-10")),
      ALL_SCOPE,
    );
    expect(home.months.find((m) => m.month === "2026-10")).toEqual({ month: "2026-10", in: oct.receipts, out: oct.disbursements });
    expect(pnl.receipts).toBe(incomeStatement(ledger, ALL_SCOPE).receipts);
    // A refund nets in its account: it shows in the out list as a negative amount, not as income.
    expect(home.recentOut.find((r) => r.who === "Keyt Law refund")?.amount).toBe(-50.11);
    expect(home.recentIn.find((r) => r.who === "Keyt Law refund")).toBeUndefined();
    expect(home.recentIn[0].entity).toBe("Northwind Holdings, LLC");
  });
});

describe("buildPnl", () => {
  const pnl = buildPnl(ledger, ALL_SCOPE, { year: 2026, entities: ENTITIES, loanNames: new Map([["L1", "Harbor note"]]) });

  it("foots: lines and rounding add to each section; sections add to the net", () => {
    for (const b of pnl.sections) {
      const shown = b.lines.reduce((s, l) => s + l.figures.total, 0) + (b.rounding?.total ?? 0);
      expect(shown).toBe(b.total.total);
      expect(b.total.total).toBe(roundCents(cents(b.total.exact)));
    }
    const [rev, op, other, personal] = pnl.sections;
    expect(pnl.net.total).toBe(rev.total.total - op.total.total + other.total.total + personal.total.total);
    // Three $0.40 bills show as dashes and a $1 rounding line in March.
    expect(op.rounding?.monthly[2]).toBe(1);
  });

  it("cross-foots: months and entities each add to the period", () => {
    for (const f of [...pnl.sections.map((b) => b.total), pnl.net, pnl.operating_income]) {
      expect(f.monthly.reduce((s, v) => s + v, 0)).toBe(f.total);
      expect(f.by_entity.reduce((s, v) => s + v, 0)).toBe(f.total);
    }
    expect(pnl.columns.entities.map((e) => e.name)).toEqual(["Northwind Holdings, LLC", "Alder Family Trust"]);
  });

  it("other income (expense) reads money in positive, so the mortgage is negative", () => {
    expect(pnl.sections.find((b) => b.key === "other")!.total.total).toBe(-2238);
  });

  it("checks that transfers between own accounts net, and eliminates only matched intercompany", () => {
    const own = pnl.flows.find((b) => b.key === "flow:own")!;
    expect(own.check).toEqual({ unmatched: 0, unmatched_count: 0 });
    const ic = pnl.flows.find((b) => b.key === "flow:intercompany")!;
    expect(ic.total.exact).toBe(-75);
    expect(pnl.eliminated).toMatchObject({ out: 1200, count: 1 });
    expect(pnl.flows.find((b) => b.key === "flow:loans")!.lines[0].label).toBe("Harbor note (loan)");
  });

  it("a cell's drill-down sums to the figure it was opened from", () => {
    const rent = ledger.filter((t) => cellMatches(t, ALL_SCOPE, "revenue", "4000 Rental Income"));
    const f = pnlCell(pnl, "revenue", "4000 Rental Income")!;
    expect(rent.reduce((s, t) => s - Math.round(Number(t.amount) * 100), 0) / 100).toBe(f.exact);
    expect(figureAt(f, pnl, { month: 10 })).toBe(Math.round(1000.4 - 25.25));
    expect(figureAt(f, pnl, { entity: "E1" })).toBe(f.total);
  });
});

describe("cash flow and trial balance", () => {
  it("operating activities tie to the P&L, and the net change is every row", () => {
    const cf = cashFlow(ledger, ALL_SCOPE);
    expect(cf.ties_to_pnl).toBe(true);
    const all = ledger.reduce((s, t) => s - Math.round(Number(t.amount) * 100), 0) / 100;
    expect(cf.net_change_exact).toBe(all);
    expect(cf.net_change).toBe(cf.blocks.reduce((s, b) => s + b.total, 0));
    for (const b of cf.blocks) expect(b.lines.reduce((s, l) => s + l.amount, 0)).toBe(b.total);
  });

  it("the trial balance balances to the cent", () => {
    const tb = trialBalance(ledger, ALL_SCOPE, (id) => ({ name: id === "acc-a" ? "Operating •• 4821" : "Trust checking •• 7310", detail: null }));
    expect(tb.totals.debit).toBe(tb.totals.credit);
    expect(tb.rows[0].group).toBe("Bank and card accounts");
    const sum = (k: "debit" | "credit") => tb.rows.reduce((s, r) => s + Math.round(r[k] * 100), 0) / 100;
    expect(sum("debit")).toBe(tb.totals.debit);
    expect(sum("credit")).toBe(tb.totals.credit);
  });
});

describe("unmatchedTransfers", () => {
  it("pairs an out and an in of the same amount in different accounts within days", () => {
    const legs = [
      { transaction_id: "o", account_id: "a", date: "2026-01-01", amount: 100 },
      { transaction_id: "i", account_id: "b", date: "2026-01-03", amount: -100 },
      { transaction_id: "x", account_id: "a", date: "2026-01-05", amount: 70 },
      { transaction_id: "same", account_id: "a", date: "2026-01-05", amount: -70 },
    ];
    expect(unmatchedTransfers(legs).map((t) => t.transaction_id)).toEqual(["x", "same"]);
  });
});

describe("the 1099 worksheet", () => {
  it("uses the threshold for the year the payments were made", () => {
    expect(threshold1099(2025).amount).toBe(600);
    expect(threshold1099(2026)).toEqual({ amount: 2000, note: null });
    expect(threshold1099(2027).note).toMatch(/indexed/);
  });

  it("lists contractors, sets wages apart, and leaves out taxes and card payments with the reason", () => {
    const rows = [
      row({ amount: 1500, book_category: "6150 Contract Services", merchant_name: "Cedar Builders" }),
      row({ amount: 800, book_category: "6150 Contract Services", merchant_name: "Cedar Builders" }),
      // Paid to the same contractor but filed as a transfer, with no other leg: it counts.
      row({ amount: 300, txn_type: "transfer", book_category: "9100 Internal Transfers", merchant_name: "Cedar Builders" }),
      row({ amount: 2500, book_category: "6100 Professional Fees", name: "GCREVENU Tax payment", merchant_name: null }),
      row({ amount: 3000, book_category: "6150 Contract Services", merchant_name: "Pine Fuel", payment_channel: "in store" } as Partial<LedgerRow>),
      row({ amount: 900, book_category: "6000 Salaries & Wages", name: "Send Money via mercury.com; Merchant name: Sam Rivera" }),
      row({ amount: 1900, book_category: "6000 Salaries & Wages", merchant_name: "Gusto" }),
      row({ amount: 1999, book_category: "6350 Rent Expense", merchant_name: "Harbor Storage" }),
    ];
    const w = worksheet1099(rows, ALL_SCOPE, 2026, () => false);
    expect(w.threshold).toBe(2000);
    expect(w.candidates).toEqual([expect.objectContaining({ payee: "Cedar Builders", form: "NEC", paid: 2600, count: 3, via_transfers: 300, entity: "Northwind Holdings, LLC" })]);
    expect(w.below_threshold).toBe(1);
    expect(w.wages).toEqual([expect.objectContaining({ payee: "Sam Rivera", paid: 900 })]);
    expect(w.excluded.map((e) => e.reason)).toEqual([expect.stringMatching(/card/), expect.stringMatching(/government/)]);
  });
});
