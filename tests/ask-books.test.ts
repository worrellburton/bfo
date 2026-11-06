import { beforeEach, describe, expect, it, vi } from "vitest";

// Ask BFO's books totals must equal the P&L in Books › Reports for the same
// rows and the same entity choice: both are run here on one ledger, the P&L
// through its real report function against a mocked database.

type Row = Record<string, unknown>;
let ledger: Row[] = [];
let prefs: Row[] = [];

function json(body: unknown[]): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "content-range": `0-${Math.max(body.length - 1, 0)}/${body.length}` } });
}

/** Just enough PostgREST: account_id in / not in, the rest ignored. */
function scoped(path: string): Row[] {
  const p = decodeURIComponent(path);
  const ids = (re: RegExp) => (re.exec(p)?.[1] ?? "").split(",").map((s) => s.replace(/"/g, "").trim());
  let rows = ledger;
  if (/account_id=in\./.test(p)) {
    const keep = ids(/account_id=in\.\(([^)]*)\)/);
    rows = rows.filter((r) => keep.includes(String(r.account_id)));
  }
  if (/account_id=not\.in\./.test(p)) {
    const drop = ids(/account_id=not\.in\.\(([^)]*)\)/);
    rows = rows.filter((r) => !drop.includes(String(r.account_id)));
  }
  return rows;
}

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    sbFetch: async (path: string) => {
      if (path.startsWith("plaid_account_prefs")) return json(prefs);
      if (path.startsWith("book_loans")) return json([{ id: "loan-1", name: "Note to bank" }]);
      if (path.startsWith("book_transactions")) return json(scoped(path));
      return json([]);
    },
  };
});

import { entitySelection, pnlPlace, pnlSummary, type LedgerRow } from "../lib/ask-books";
import { pnlReport } from "../lib/books/statements";

const base = { txn_type: "normal", intercompany: false, type_override: null, loan_id: null, plaid_category: null, counterparty_account_id: null, pending: false };
const row = (id: string, account_id: string, date: string, amount: number, book_category: string | null, extra: Row = {}): Row => ({
  ...base,
  transaction_id: id,
  account_id,
  date,
  amount,
  book_category,
  ...extra,
});

beforeEach(() => {
  prefs = [
    { account_id: "acc-a", entity_id: "ent-a", entity_name: "Northwind Holdings, LLC", hidden: false },
    { account_id: "acc-b", entity_id: "ent-b", entity_name: "Alder Trust", hidden: false },
    { account_id: "acc-hidden", entity_id: "ent-a", entity_name: "Northwind Holdings, LLC", hidden: true },
  ];
  ledger = [
    row("t01", "acc-a", "2026-01-05", -5000, "4000 Rental Income"),
    row("t02", "acc-a", "2026-01-09", 1200, "6100 Professional Fees"),
    // A refund into an expense account reduces that expense; it isn't income.
    row("t03", "acc-a", "2026-02-02", -45.5, "6450 Dues & Subscriptions"),
    row("t04", "acc-a", "2026-02-03", 99.99, "6450 Dues & Subscriptions"),
    row("t05", "acc-b", "2026-02-10", 300, "7100 Interest Expense"),
    // Uncategorized: filed by sign, and reported as uncategorized.
    row("t06", "acc-b", "2026-03-01", -800, null, { plaid_category: "INCOME" }),
    row("t07", "acc-b", "2026-03-02", 210.25, null, { plaid_category: "GENERAL_MERCHANDISE" }),
    // Set aside: a transfer, a loan payment, a 9000s flow account typed normal.
    row("t08", "acc-a", "2026-03-05", 2500, null, { txn_type: "transfer" }),
    row("t09", "acc-a", "2026-03-06", 1500, "6900 Other Operating Expenses", { loan_id: "loan-1" }),
    row("t10", "acc-b", "2026-03-07", 400, "9200 Owner Distributions"),
    // Intercompany: both legs inside "all"; under one entity, the other leg is outside.
    row("t11", "acc-a", "2026-04-01", 1000, null, { intercompany: true, counterparty_account_id: "acc-b" }),
    row("t12", "acc-b", "2026-04-01", -1000, null, { intercompany: true, counterparty_account_id: "acc-a" }),
    // The person's override beats the rules.
    row("t13", "acc-a", "2026-04-15", -75, "4100 Interest Income", { txn_type: "transfer", type_override: "normal" }),
    // A hidden account never counts.
    row("t14", "acc-hidden", "2026-05-01", -99999, "4000 Rental Income"),
  ];
});

type Pnl = {
  revenue: { label: string; total: number }[];
  operating: { label: string; total: number }[];
  other: { label: string; total: number }[];
  net_total: number;
};

async function both(selection: string[] | null) {
  const reply = await pnlReport({ year: "2026", entity: selection ? selection.join(",") : "all" }, "pnl");
  const pnl = reply.body as Pnl;
  const visible = prefs.filter((p) => !p.hidden);
  const accounts = visible.filter((p) => !selection || selection.includes(String(p.entity_id))).map((p) => p.account_id);
  const rows = ledger.filter((r) => accounts.includes(r.account_id)).map((r) => ({ ...r, entity_name: prefs.find((p) => p.account_id === r.account_id)?.entity_name ?? null })) as LedgerRow[];
  const entityOf = (id: string) => prefs.find((p) => p.account_id === id)?.entity_id as string | undefined;
  return { pnl, mine: pnlSummary(rows, selection, entityOf) };
}

const byAccount = (lines: { label: string; total: number }[]) => Object.fromEntries(lines.map((l) => [l.label, Math.round(l.total * 100) / 100]));
const mineByAccount = (lines: { accounts: { account: string; amount: number }[] }) => Object.fromEntries(lines.accounts.map((a) => [a.account, a.amount]));

describe("Ask's books totals tie to the P&L", () => {
  it("for all entities, account by account and in total", async () => {
    const { pnl, mine } = await both(null);
    expect(mineByAccount(mine.revenue)).toEqual(byAccount(pnl.revenue));
    expect(mineByAccount(mine.operatingExpenses)).toEqual(byAccount(pnl.operating));
    expect(mineByAccount(mine.otherExpenses)).toEqual(byAccount(pnl.other));
    expect(mine.netIncome).toBeCloseTo(pnl.net_total, 2);
    // The figures themselves, so a change on either side shows here.
    expect(mine.revenue.total).toBe(5875);
    expect(mine.operatingExpenses.total).toBe(1464.74);
    expect(mine.otherExpenses.total).toBe(300);
    expect(mine.uncategorized).toEqual({ count: 2, moneyIn: 800, moneyOut: 210.25 });
    expect(mine.transfersAndLoans).toEqual({ count: 3, moneyIn: 0, moneyOut: 4400 });
    expect(mine.intercompany.eliminated).toBe(2);
  });

  it("for one entity, where an intercompany leg stays visible", async () => {
    const { pnl, mine } = await both(["ent-a"]);
    expect(mineByAccount(mine.revenue)).toEqual(byAccount(pnl.revenue));
    expect(mineByAccount(mine.operatingExpenses)).toEqual(byAccount(pnl.operating));
    expect(mine.netIncome).toBeCloseTo(pnl.net_total, 2);
    expect(mine.intercompany).toEqual({ count: 1, moneyIn: 0, moneyOut: 1000, eliminated: 0 });
  });
});

describe("placing a row", () => {
  const none = () => undefined;
  it("files uncategorized rows by sign, and says so", () => {
    expect(pnlPlace({ ...base, account_id: "x", amount: -10, book_category: null } as LedgerRow, null, none)).toEqual({
      kind: "statement",
      section: "revenue",
      account: "Uncategorized",
      uncategorized: true,
    });
    expect(pnlPlace({ ...base, account_id: "x", amount: 10, book_category: "6100 Professional Fees" } as LedgerRow, null, none)).toEqual({
      kind: "statement",
      section: "operating",
      account: "6100 Professional Fees",
      uncategorized: false,
    });
  });
  it("sets aside loans and flow accounts even when typed normal", () => {
    expect(pnlPlace({ ...base, account_id: "x", amount: 10, book_category: "6100 Professional Fees", loan_id: "l" } as LedgerRow, null, none).kind).toBe("loan");
    expect(pnlPlace({ ...base, account_id: "x", amount: 10, book_category: "9200 Owner Distributions" } as LedgerRow, null, none).kind).toBe("flow");
  });
});

describe("naming an entity", () => {
  const list = [
    { entity_id: "ent-a", entity_name: "Northwind Holdings, LLC" },
    { entity_id: "ent-b", entity_name: "Alder Trust" },
    { entity_id: null, entity_name: null },
  ];
  it("resolves through the account mappings, loosely", () => {
    expect(entitySelection(list, "northwind holdings llc")).toEqual({ ids: ["ent-a"], names: ["Northwind Holdings, LLC"] });
    expect(entitySelection(list, "Alder")).toEqual({ ids: ["ent-b"], names: ["Alder Trust"] });
  });
  it("says which entities exist when nothing matches", () => {
    const r = entitySelection(list, "Nobody");
    expect("error" in r && r.known).toEqual(["Alder Trust", "Northwind Holdings, LLC"]);
  });
});
