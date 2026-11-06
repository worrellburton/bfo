import { beforeEach, describe, expect, it, vi } from "vitest";

// Ask BFO's books answers must be the P&L's own figures: books_summary is
// run here through Ask's tool, and Books › Reports' P&L through its report,
// on one ledger and one entity choice, against a mocked database.

type Row = Record<string, unknown>;
let ledger: Row[] = [];
let prefs: Row[] = [];

function json(body: unknown[]): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "content-range": `0-${Math.max(body.length - 1, 0)}/${body.length}` } });
}

/** Just enough PostgREST: account_id in / not in, the date range and pending; the rest ignored. */
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
  const from = /date=gte\.(\d{4}-\d{2}-\d{2})/.exec(p)?.[1];
  const to = /date=lte\.(\d{4}-\d{2}-\d{2})/.exec(p)?.[1];
  if (from) rows = rows.filter((r) => String(r.date) >= from);
  if (to) rows = rows.filter((r) => String(r.date) <= to);
  if (/pending=eq\.false/.test(p)) rows = rows.filter((r) => !r.pending);
  return rows;
}

function answer(path: string): Response {
  if (path.startsWith("plaid_account_prefs")) return json(prefs);
  if (path.startsWith("book_loans")) return json([{ id: "loan-1", name: "Note to bank" }]);
  if (path.startsWith("book_transactions")) return json(scoped(path));
  return json([]);
}

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    sbFetch: async (path: string) => answer(path),
    sb: async (path: string) => (await answer(path)).json(),
  };
});

import { entitySelection, pnlSummary, scopeOf, type LedgerRow } from "../lib/ask-books";
import { runTool, type Scope } from "../lib/ask";
import { pnlReport } from "../lib/books/statements";

const staff: Scope = { user: { id: "u1", name: "Alex Rivera", role: "owner", email: null, mail_address: null }, admin: true, staff: true, assetIds: null };

const base = { txn_type: "normal", intercompany: false, type_override: null, loan_id: null, plaid_category: null, counterparty_account_id: null, pending: false };
const row = (id: string, account_id: string, date: string, amount: number, book_category: string | null, extra: Row = {}): Row => ({ ...base, transaction_id: id, account_id, date, amount, book_category, ...extra });

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
    // Uncategorized: outside every total until it's filed.
    row("t06", "acc-b", "2026-03-01", -800, null, { plaid_category: "INCOME" }),
    row("t07", "acc-b", "2026-03-02", 210.25, null, { plaid_category: "GENERAL_MERCHANDISE" }),
    // Set aside: a transfer, a loan payment, a 9000s account typed normal.
    row("t08", "acc-a", "2026-03-05", 2500, null, { txn_type: "transfer" }),
    row("t09", "acc-a", "2026-03-06", 1500, "6900 Other Operating Expenses", { loan_id: "loan-1" }),
    row("t10", "acc-b", "2026-03-07", 400, "9200 Owner Distributions"),
    // Intercompany: both legs inside "all"; under one entity, the other leg is outside.
    row("t11", "acc-a", "2026-04-01", 1000, null, { intercompany: true, counterparty_account_id: "acc-b" }),
    row("t12", "acc-b", "2026-04-01", -1000, null, { intercompany: true, counterparty_account_id: "acc-a" }),
    // The person's override beats the rules.
    row("t13", "acc-a", "2026-04-15", -75, "4100 Interest Income", { txn_type: "transfer", type_override: "normal" }),
    // A hidden account and a pending row never count.
    row("t14", "acc-hidden", "2026-05-01", -99999, "4000 Rental Income"),
    row("t15", "acc-a", "2026-05-02", -12345, "4000 Rental Income", { pending: true }),
  ];
});

const asked = async (input: Record<string, unknown>) => JSON.parse(await runTool("books_summary", input, staff)) as Record<string, any>;

describe("Ask's books answers are the P&L's figures", () => {
  it("for all entities over the year", async () => {
    const ask = await asked({ from: "2026-01-01", to: "2026-12-31" });
    const pnl = (await pnlReport({ year: "2026", entity: "all" }, "pnl")).body as Record<string, any>;
    expect(ask.receipts).toBe(pnl.receipts);
    expect(ask.disbursements).toBe(pnl.disbursements);
    expect(ask.net).toBe(pnl.net_exact);
    // The figures themselves, so a change on either side shows here.
    expect(ask.receipts).toBe(5075);
    expect(ask.disbursements).toBe(1554.49);
    expect(ask.uncategorized).toMatchObject({ count: 2, in: 800, out: 210.25 });
    expect(ask.eliminated.count).toBe(2);
    expect(ask.basis).toMatch(/Cash basis, posted/);
  });

  it("for one entity, named loosely, scoped by its accounts", async () => {
    const ask = await asked({ from: "2026-01-01", to: "2026-12-31", entity: "northwind holdings llc" });
    const pnl = (await pnlReport({ year: "2026", entity: "ent-a" }, "pnl")).body as Record<string, any>;
    expect(ask.entity).toBe("Northwind Holdings, LLC");
    expect(ask.receipts).toBe(pnl.receipts);
    expect(ask.disbursements).toBe(pnl.disbursements);
    expect(ask.net).toBe(pnl.net_exact);
    expect(ask.flows.intercompany.count).toBe(1);
  });

  it("for a window inside the year", async () => {
    const ask = await asked({ from: "2026-02-01", to: "2026-02-28" });
    expect(ask.receipts).toBe(0);
    expect(ask.disbursements).toBe(354.49);
  });

  it("says which entities exist when the name matches none", async () => {
    const ask = await asked({ from: "2026-01-01", to: "2026-12-31", entity: "Nobody" });
    expect(ask.error).toMatch(/No bank account/);
    expect(ask.entities).toEqual(["Alder Trust", "Northwind Holdings, LLC"]);
  });
});

describe("per entity", () => {
  it("adds up to the whole", () => {
    const rows = ledger.filter((r) => !r.pending && r.account_id !== "acc-hidden").map((r) => ({ ...r, entity_name: prefs.find((p) => p.account_id === r.account_id)?.entity_name })) as LedgerRow[];
    const s = pnlSummary(
      rows,
      scopeOf(new Map(prefs.map((p) => [String(p.account_id), p as never])), null),
    );
    expect(s.byEntity.reduce((t, e) => t + e.receipts, 0)).toBeCloseTo(s.receipts, 2);
  });
});

describe("naming an entity", () => {
  const list = [
    { entity_id: "ent-a", entity_name: "Northwind Holdings, LLC" },
    { entity_id: "ent-b", entity_name: "Alder Trust" },
    { entity_id: null, entity_name: null },
  ];
  it("resolves through the account mappings, loosely", () => {
    expect(entitySelection(list, "Alder")).toEqual({ ids: ["ent-b"], names: ["Alder Trust"] });
  });
});
