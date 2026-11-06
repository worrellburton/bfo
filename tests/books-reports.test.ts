import { beforeEach, describe, expect, it, vi } from "vitest";

// The year-scoped statements, the review/recurring detectors, the balance
// sheet and the loan/vendor rule actions — one shape test each, so the split
// of api/books/data.ts into lib/books/ can be checked against the contract
// the SPA pages (app/routes/books-*.tsx) read.

type Call = { method: string; path: string; body?: any; headers: Record<string, string> };
type Route = [RegExp, (c: Call) => Response | unknown];

const calls: Call[] = [];
let routes: Route[] = [];
let me: Record<string, unknown> | null = null;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  const h: Record<string, string> = { "content-type": "application/json", ...headers };
  if (Array.isArray(body) && !h["content-range"]) h["content-range"] = `0-${Math.max(body.length - 1, 0)}/${body.length}`;
  return new Response(JSON.stringify(body), { status, headers: h });
}
const failWith = (status: number, text = "boom") => new Response(text, { status });

const sbFetchMock = vi.fn(async (path: string, init: RequestInit = {}) => {
  const c: Call = {
    method: init.method ?? "GET",
    path: decodeURIComponent(path),
    body: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
    headers: { ...((init.headers ?? {}) as Record<string, string>) },
  };
  calls.push(c);
  const hit = routes.find(([re]) => re.test(`${c.method} ${c.path}`));
  const out = hit ? hit[1](c) : [];
  return out instanceof Response ? out : json(out);
});

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    sbFetch: (...a: unknown[]) => (sbFetchMock as (...x: unknown[]) => unknown)(...a),
    sb: async (path: string, init: { method?: string; body?: unknown; prefer?: string } = {}) => {
      const r = (await sbFetchMock(path, {
        method: init.method ?? "GET",
        ...(init.prefer ? { headers: { Prefer: init.prefer } } : {}),
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      })) as Response;
      const text = await r.text();
      if (!r.ok) throw new Error(`supabase ${r.status}: ${text}`);
      return text ? JSON.parse(text) : null;
    },
    currentUser: async () => me,
  };
});
vi.mock("../lib/storage.js", () => ({ storageRemove: async () => {}, storageSignedUrl: async (p: string) => `signed:${p}` }));

import handler from "../api/books/data";
import type { BookTxn } from "../lib/books/types";

const U1 = "11111111-1111-4111-8111-111111111111";
const LOAN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ENT_A = "ent-a";
const ENT_B = "ent-b";
const prefRows = [
  { account_id: "acc-a1", entity_id: ENT_A, entity_name: "Alpha LLC", hidden: false, nickname: "Ops", institution_name: "Chase", mask: "1234" },
  { account_id: "acc-b1", entity_id: ENT_B, entity_name: "Beta Trust", hidden: false, account_name: "Trust Checking" },
  { account_id: "acc-hid", entity_id: ENT_B, entity_name: "Beta Trust", hidden: true },
];

function txn(over: Partial<BookTxn> = {}): BookTxn {
  return {
    transaction_id: "t1",
    account_id: "acc-a1",
    item_id: "item-1",
    date: "2026-03-04",
    name: "ACME",
    merchant_name: "Acme",
    amount: 120,
    pending: false,
    currency: "USD",
    plaid_category: null,
    plaid_category_detailed: null,
    payment_channel: null,
    txn_type: "normal",
    intercompany: false,
    intercompany_class: null,
    counterparty_account_id: null,
    type_override: null,
    book_category: "6100 Professional Fees",
    loan_id: null,
    entity_id: null,
    entity_name: null,
    ...over,
  };
}

async function call(opts: { method?: string; query?: Record<string, string>; body?: unknown } = {}) {
  const out: { status: number; json?: any } = { status: 200 };
  const res: any = {
    status: (c: number) => ((out.status = c), res),
    json: (j: unknown) => ((out.json = j), res),
    end: () => res,
    setHeader() {},
  };
  await handler({ method: opts.method ?? "GET", query: opts.query ?? {}, body: opts.body, headers: {} } as any, res);
  return out;
}
const get = (query: Record<string, string>) => call({ query });
const post = (body: unknown) => call({ method: "POST", body });

const rows = (list: BookTxn[]): Route => [/^GET book_transactions\?select=\*/, () => list];

beforeEach(() => {
  calls.length = 0;
  routes = [[/^GET plaid_account_prefs/, () => prefRows]];
  me = { id: U1, name: "Robert", role: "owner", status: "approved" };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ── P&L, cell, statements, 1099, vendors ──────────────────────────────────

const ledger = [
  txn({ transaction_id: "r1", date: "2026-01-10", amount: -1000, book_category: "4000 Rental Income", merchant_name: "Tenant" }),
  txn({ transaction_id: "e1", date: "2026-01-12", amount: 300, book_category: "6100 Professional Fees", merchant_name: "Lawyer" }),
  txn({ transaction_id: "e2", date: "2026-02-01", amount: 700, book_category: "6100 Professional Fees", merchant_name: "Lawyer" }),
  txn({ transaction_id: "o1", date: "2026-02-15", amount: 50, book_category: "7100 Interest Expense" }),
  txn({ transaction_id: "x1", date: "2026-03-01", amount: 500, txn_type: "transfer", book_category: "9100 Transfers" }),
  txn({ transaction_id: "i1", date: "2026-03-02", amount: 200, intercompany: true, account_id: "acc-a1", counterparty_account_id: "acc-b1", book_category: "9000 Intercompany" }),
  txn({ transaction_id: "u1", date: "2026-04-01", amount: -80, book_category: null, plaid_category: "INCOME" }),
];

describe("report=pnl", () => {
  it("files the year into revenue, expenses, uncategorized and the flow groups, by month and by entity", async () => {
    routes.unshift(rows(ledger), [/^GET book_loans/, () => [{ id: LOAN, name: "Family Loan" }]]);
    const r = await get({ report: "pnl", year: "2026" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ year: 2026, entity: "all", basis: "cash", transaction_count: 7 });
    const block = (key: string) => r.json.sections.find((b: any) => b.key === key);
    expect(block("revenue").lines).toEqual([
      expect.objectContaining({ label: "4000 Rental Income", code: "4000", name: "Rental Income", figures: expect.objectContaining({ total: 1000, exact: 1000 }) }),
    ]);
    expect(block("revenue").lines[0].figures.monthly[0]).toBe(1000);
    expect(block("operating").total).toMatchObject({ total: 1000, monthly: [300, 700, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
    // Other income (expense) reads money in positive: an expense is negative.
    expect(block("other").total.total).toBe(-50);
    // Uncategorized money in is beside the statement, not in revenue.
    expect(r.json.uncategorized).toMatchObject({ count: 1, in: 80 });
    expect(r.json.net.total).toBe(1000 - 1000 - 50);
    expect(r.json.receipts).toBe(1000);
    expect(r.json.disbursements).toBe(1050);
    // The intercompany leg's other side is in Books and selected: eliminated.
    expect(r.json.eliminated).toMatchObject({ out: 200, count: 1 });
    expect(r.json.flows.find((b: any) => b.key === "flow:own").total.total).toBe(-500);
    // Columns by entity, names cleaned, adding to the total.
    expect(r.json.columns.entities.map((e: any) => e.name)).toEqual(["Alpha LLC", "Beta Trust"]);
    expect(block("operating").total.by_entity).toEqual([1000, 0]);
    expect(r.json.period).toEqual({ from: "2026-01-01", to: expect.any(String) });
    // Year filter and hidden-account exclusion are pushed to the database.
    const q = calls.find((c) => c.path.startsWith("book_transactions?select=*"))!.path;
    expect(q).toContain("&date=gte.2026-01-01&date=lte.2026-12-31");
    expect(q).toContain('account_id=not.in.("acc-hid")');
  });

  it("under a partial selection the intercompany leg shows instead of being eliminated", async () => {
    routes.unshift(rows(ledger), [/^GET book_loans/, () => []]);
    const r = await get({ report: "pnl", year: "2026", entity: ENT_A });
    expect(r.json.entity).toBe(ENT_A);
    expect(r.json.eliminated.count).toBe(0);
    expect(r.json.flows.find((b: any) => b.key === "flow:intercompany").total.monthly[2]).toBe(-200);
    expect(calls.find((c) => c.path.startsWith("book_transactions?select=*"))!.path).toContain('account_id=in.("acc-a1")');
  });

  it("defaults a bad year to the current one", async () => {
    routes.unshift(rows([]), [/^GET book_loans/, () => []]);
    expect((await get({ report: "pnl", year: "abcd" })).json.year).toBe(new Date().getFullYear());
  });
});

describe("report=cell", () => {
  beforeEach(() => routes.unshift(rows(ledger), [/^GET book_loans/, () => []]));

  it("returns the rows behind one account × month, newest first, and the figure they tie to", async () => {
    const r = await get({ report: "cell", year: "2026", section: "operating", label: "6100 Professional Fees" });
    expect(r.json.count).toBe(2);
    expect(r.json.transactions.map((t: BookTxn) => t.transaction_id)).toEqual(["e2", "e1"]);
    expect(r.json).toMatchObject({ net: 1000, shown: 1000, basis: "cash", locked: 0 });
    const feb = await get({ report: "cell", year: "2026", section: "operating", label: "6100 Professional Fees", month: "2" });
    expect(feb.json.transactions.map((t: BookTxn) => t.transaction_id)).toEqual(["e2"]);
    expect(feb.json.shown).toBe(700);
  });

  it("knows the net, uncategorized, flow and intercompany sections", async () => {
    expect((await get({ report: "cell", year: "2026", section: "net" })).json.count).toBe(4);
    expect((await get({ report: "cell", year: "2026", section: "uncategorized" })).json.transactions[0].transaction_id).toBe("u1");
    expect((await get({ report: "cell", year: "2026", section: "flow:own" })).json.transactions[0].transaction_id).toBe("x1");
    expect((await get({ report: "cell", year: "2026", section: "transfers" })).json.transactions[0].transaction_id).toBe("x1");
    expect((await get({ report: "cell", year: "2026", section: "intercompany" })).json.count).toBe(0);
    expect((await get({ report: "cell", year: "2026", section: "eliminated" })).json.count).toBe(1);
    expect((await get({ report: "cell", year: "2026", section: "intercompany", entity: ENT_A })).json.count).toBe(1);
    expect((await get({ report: "cell", year: "2026", section: "bogus" })).json).toMatchObject({ transactions: [], count: 0 });
  });

  it("narrows to one entity's column", async () => {
    const r = await get({ report: "cell", year: "2026", section: "operating", col: ENT_B });
    expect(r.json.count).toBe(0);
  });
});

describe("report=statements", () => {
  it("builds a cash flow that ties to the P&L and a trial balance that balances", async () => {
    routes.unshift(rows(ledger));
    const r = await get({ report: "statements", year: "2026" });
    expect(r.json).toMatchObject({ year: 2026, basis: "cash" });
    expect(r.json.cash_flow.ties_to_pnl).toBe(true);
    expect(r.json.cash_flow.blocks.find((b: any) => b.key === "operating").total).toBe(-50);
    // Every row: 1,000 + 80 in, 300 + 700 + 50 + 500 + 200 out.
    expect(r.json.cash_flow.net_change_exact).toBe(-670);
    expect(r.json.trial_balance.totals.debit).toBe(r.json.trial_balance.totals.credit);
    expect(r.json.trial_balance.rows[0]).toMatchObject({ account: "Ops •• 1234", group: "Bank and card accounts", detail: "Alpha LLC" });
    expect(r.json.trial_balance.rows.find((x: any) => x.account === "Income")).toMatchObject({ group: "Uncategorized", credit: 80 });
  });
});

describe("report=tax1099", () => {
  it("lists payees over the year's threshold, with wages and exclusions apart", async () => {
    routes.unshift(
      rows([
        ...ledger,
        txn({ transaction_id: "c1", amount: 1999, book_category: "6150 Contract Services", merchant_name: "Small Fry" }),
        txn({ transaction_id: "c2", amount: 2400, book_category: "6150 Contract Services", merchant_name: "Builder" }),
        txn({ transaction_id: "w1", amount: 900, book_category: "6000 Salaries & Wages", merchant_name: "Pat" }),
      ]),
    );
    const r = await get({ report: "tax1099", year: "2026" });
    expect(r.json).toMatchObject({ year: 2026, threshold: 2000, below_threshold: 2 });
    expect(r.json.candidates).toEqual([expect.objectContaining({ payee: "Builder", entity: "Alpha LLC", form: "NEC", paid: 2400, count: 1 })]);
    expect(r.json.wages).toEqual([expect.objectContaining({ payee: "Pat", paid: 900 })]);
    const last = await get({ report: "tax1099", year: "2025" });
    expect(last.json.threshold).toBe(600);
  });

  it("scopes to the selected entity", async () => {
    routes.unshift(rows(ledger));
    await get({ report: "tax1099", year: "2026", entity: ENT_B });
    const path = calls.find((c) => c.path.startsWith("book_transactions"))!.path;
    expect(path).toContain(`account_id=in.("acc-b1","acc-hid")`);
  });

  it("applies the threshold per paying entity", async () => {
    routes.unshift(
      rows([
        txn({ transaction_id: "p1", amount: 1400, book_category: "6150 Contract Services", merchant_name: "Painter" }),
        txn({ transaction_id: "p2", amount: 1400, book_category: "6150 Contract Services", merchant_name: "painter ", account_id: "acc-b1" }),
        txn({ transaction_id: "p3", amount: 700, book_category: "6150 Contract Services", merchant_name: "Painter", account_id: "acc-b1" }),
      ]),
    );
    const r = await get({ report: "tax1099", year: "2026" });
    expect(r.json.candidates).toEqual([expect.objectContaining({ payee: "painter", entity: "Beta Trust", paid: 2100, count: 2 })]);
  });
});

describe("report=vendors", () => {
  it("builds the vendor × month spend matrix for normal rows only", async () => {
    routes.unshift(rows(ledger));
    const r = await get({ report: "vendors", year: "2026" });
    expect(r.json.year).toBe(2026);
    expect(r.json.vendors[0]).toEqual({
      vendor: "Lawyer",
      count: 2,
      monthly: [300, 700, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      spent: 1000,
      received: 0,
      last_date: "2026-02-01",
      entities: ["Alpha LLC"],
    });
    expect(r.json.vendors.map((v: any) => v.vendor)).not.toContain("9100 Transfers");
    expect(r.json.vendors.find((v: any) => v.vendor === "Tenant")).toMatchObject({ spent: 0, received: 1000 });
  });
});

// ── Review, recurring, reconciliation ─────────────────────────────────────

describe("report=review", () => {
  it("counts the queue and finds cross-source duplicates and outliers", async () => {
    routes.unshift(
      rows([
        txn({ transaction_id: "a", amount: 10, book_category: null }),
        txn({ transaction_id: "b", amount: 10, item_id: "item-2" }),
        txn({ transaction_id: "c", amount: 10 }),
        txn({ transaction_id: "d", amount: 9999, book_category: "6900 Other Operating Expenses" }),
        txn({ transaction_id: "e", amount: 5000, txn_type: "transfer", book_category: "9100 Transfers" }),
      ]),
    );
    const r = await get({ report: "review" });
    expect(r.json.counts).toEqual({ uncategorized: 1, low_confidence: 1, duplicate_groups: 1 });
    expect(r.json.uncategorized[0]).toEqual({
      transaction_id: "a",
      date: "2026-03-04",
      name: "ACME",
      merchant_name: "Acme",
      amount: 10,
      book_category: null,
      entity_name: "Alpha LLC",
      account_id: "acc-a1",
      item_id: "item-1",
    });
    expect(r.json.duplicates[0]).toMatchObject({ count: 3, cross_source: true, amount: 10 });
    expect(r.json.outliers.map((t: any) => t.transaction_id)).toEqual(["d", "a", "b", "c"]);
  });
});

describe("report=recurring", () => {
  it("detects a monthly stream and projects the next date", async () => {
    const monthly = ["2026-01-05", "2026-02-05", "2026-03-06", "2026-04-05"].map((date, i) =>
      txn({ transaction_id: `m${i}`, date, amount: 49.99, merchant_name: "Netflix", book_category: "6450 Dues & Subscriptions" }),
    );
    const noise = ["2026-01-01", "2026-01-03", "2026-02-20"].map((date, i) => txn({ transaction_id: `n${i}`, date, merchant_name: "Random" }));
    routes.unshift(rows([...monthly, ...noise]));
    const r = await get({ report: "recurring" });
    expect(r.json.streams).toEqual([
      {
        vendor: "Netflix",
        cadence: "monthly",
        cadence_days: 30,
        avg_amount: 50,
        last_amount: 49.99,
        count: 4,
        last_date: "2026-04-05",
        day_of_month: 5,
        account: "6450 Dues & Subscriptions",
        entity_name: "Alpha LLC",
        next_expected: "2026-05-05",
      },
    ]);
  });
});

describe("report=reconciliation", () => {
  it("ties each visible bank balance to the ledger's net", async () => {
    routes.unshift(
      [
        /^GET book_transactions\?select=account_id,amount/,
        () => [
          { account_id: "acc-a1", amount: 100 },
          { account_id: "acc-a1", amount: -350.5 },
          { account_id: "acc-hid", amount: 1 },
        ],
      ],
      [
        /^GET plaid_account_state/,
        () => [
          { account_id: "acc-a1", balance: "250.5" },
          { account_id: "acc-b1", balance: 10 },
          { account_id: "acc-hid", balance: 99 },
        ],
      ],
    );
    const r = await get({ report: "reconciliation" });
    expect(r.json.accounts).toEqual([
      { account_id: "acc-a1", name: "Ops", institution: "Chase", entity_name: "Alpha LLC", ledger_net: 250.5, bank_balance: 250.5, has_ledger: true },
      { account_id: "acc-b1", name: "Trust Checking", institution: null, entity_name: "Beta Trust", ledger_net: 0, bank_balance: 10, has_ledger: false },
    ]);
  });
});

// ── Balance sheet, loans, rules, settings ─────────────────────────────────

describe("report=balance-sheet", () => {
  const identities = [
    {
      account_id: "acc-a1",
      institution_name: "Chase",
      mask: "1234",
      subtype: "checking",
      account_name: "Ops",
      nickname: null,
      entity_id: ENT_A,
      entity_name: "Alpha LLC",
      hidden: false,
      archived_at: null,
    },
    {
      account_id: "acc-a2",
      institution_name: "Schwab",
      mask: null,
      subtype: "brokerage",
      account_name: null,
      nickname: "Nest egg",
      entity_id: ENT_A,
      entity_name: null,
      hidden: false,
      archived_at: null,
    },
    {
      account_id: "acc-b1",
      institution_name: "Amex",
      mask: "9",
      subtype: "credit card",
      account_name: null,
      nickname: null,
      entity_id: ENT_B,
      entity_name: "Beta Trust",
      hidden: false,
      archived_at: null,
    },
    {
      account_id: "acc-hid",
      institution_name: null,
      mask: null,
      subtype: "checking",
      account_name: null,
      nickname: null,
      entity_id: ENT_B,
      entity_name: "Beta Trust",
      hidden: true,
      archived_at: null,
    },
    {
      account_id: "acc-zero",
      institution_name: null,
      mask: null,
      subtype: "checking",
      account_name: null,
      nickname: null,
      entity_id: ENT_A,
      entity_name: "Alpha LLC",
      hidden: false,
      archived_at: null,
    },
  ];
  const states = [
    { account_id: "acc-a1", balance: 1000, seen_at: "2026-10-26T01:00:00Z" },
    { account_id: "acc-a2", balance: "5000", seen_at: "2026-10-27T01:00:00Z" },
    { account_id: "acc-b1", balance: -300, seen_at: "2026-10-25T01:00:00Z" },
    { account_id: "acc-hid", balance: 777, seen_at: "2026-10-28T01:00:00Z" },
    { account_id: "acc-zero", balance: 0.001, seen_at: "2026-10-29T01:00:00Z" },
  ];
  beforeEach(() => {
    routes.unshift(
      [/^GET plaid_account_prefs\?select=\*/, () => identities],
      [/^GET plaid_account_state/, () => states],
      [/^GET book_loans/, () => [{ id: LOAN, name: "Family Loan", starting_balance: 1000, show_on_report: true, archived_at: null }]],
      [/^GET book_transactions/, () => []],
    );
  });

  it("sorts accounts into cash, investments and liabilities and adds the loan book", async () => {
    const r = await get({ report: "balance-sheet" });
    expect(r.json.as_of).toBe("2026-10-27T01:00:00Z");
    expect(r.json.earliest_as_of).toBe("2026-10-25T01:00:00Z");
    expect(r.json.entity).toBe("all");
    const section = (key: string) => r.json.sections.find((s: any) => s.key === key);
    expect(section("cash").rows).toEqual([expect.objectContaining({ name: "Ops", mask: "1234", institution: "Chase", type: "Checking", entity: "Alpha LLC", balance: 1000, shown: 1000 })]);
    expect(section("cash").total).toBe(1000);
    expect(section("investments").rows).toEqual([expect.objectContaining({ name: "Nest egg", type: "Brokerage", balance: 5000 })]);
    expect(section("liabilities").rows).toEqual([expect.objectContaining({ type: "Credit card", entity: "Beta Trust", balance: -300 })]);
    expect(section("loans").rows).toEqual([expect.objectContaining({ name: "Family Loan", balance: 1000, notes: ["Holder not recorded"] })]);
    expect(r.json).toMatchObject({ total_assets: 7000, total_liabilities: -300, net_worth: 7300, unavailable: 0 });
  });

  it("a single entity's sheet leaves out loans with no holder, and says so", async () => {
    const r = await get({ report: "balance-sheet", entity: ENT_A });
    expect(r.json.entity).toBe(ENT_A);
    expect(r.json.sections.find((s: any) => s.key === "loans").rows).toEqual([]);
    expect(r.json.sections.find((s: any) => s.key === "liabilities").rows).toEqual([]);
    expect(r.json.total_assets).toBe(6000);
    expect(r.json.unassigned_loans).toBe(1);
  });

  it("lists an account with no reading as unavailable instead of dropping it", async () => {
    routes.unshift([/^GET plaid_account_state/, () => states.filter((s) => s.account_id !== "acc-b1")]);
    const r = await get({ report: "balance-sheet" });
    const card = r.json.sections.find((s: any) => s.key === "liabilities").rows[0];
    expect(card).toMatchObject({ balance: null, notes: ["Balance unavailable"] });
    expect(r.json.unavailable).toBe(1);
    expect(r.json.total_liabilities).toBe(0);
  });
});

describe("report=balance-sheet, individuals' accounts", () => {
  const ira = { account_id: "acc-ira", institution_name: "Cedar Funds", mask: "4712", subtype: "ira", account_name: "IRA", nickname: null, entity_id: ENT_B, entity_name: "Beta Trust (100%)", hidden: false, archived_at: null };
  beforeEach(() => {
    routes.unshift(
      [/^GET plaid_account_prefs\?select=\*/, () => [ira]],
      [/^GET plaid_account_state/, () => [{ account_id: "acc-ira", balance: 1000.4, seen_at: "2026-10-27T01:00:00Z" }]],
      [/^GET book_loans/, () => []],
      [/^GET book_transactions/, () => []],
    );
  });

  it("keeps a retirement account out of the entity's sections and says whose it is", async () => {
    const all = await get({ report: "balance-sheet" });
    const ret = all.json.sections.find((s: any) => s.key === "retirement");
    expect(ret.rows[0]).toMatchObject({ name: "IRA", type: "IRA", entity: "Beta Trust", shown: 1000 });
    expect(ret.rows[0].notes[0]).toMatch(/belongs to its owner, not to Beta Trust/);
    expect(all.json.total_assets).toBe(1000);

    const trust = await get({ report: "balance-sheet", entity: ENT_B });
    expect(trust.json.individual.rows).toHaveLength(1);
    expect(trust.json.individual.counted).toBe(false);
    expect(trust.json.total_assets).toBe(0);
  });
});

describe("report=ledger", () => {
  it("exports the year's posted rows with their bank account and records who took them", async () => {
    routes.unshift(rows(ledger), [/^GET book_txn_receipt/, () => [{ transaction_id: "e1" }]], [/^POST audit_log/, () => json([], 201)]);
    const r = await get({ report: "ledger", year: "2026" });
    expect(r.status).toBe(200);
    expect(r.json.rows).toHaveLength(7);
    expect(r.json.rows.find((x: any) => x.transaction_id === "e1")).toMatchObject({ bank_account: "Ops", mask: "1234", account: "6100 Professional Fees", statement_line: "Operating expenses", type: "normal", receipts: 1 });
    expect(r.json.rows.find((x: any) => x.transaction_id === "u1").statement_line).toBe("Uncategorized");
    const logged = calls.find((c) => c.method === "POST" && c.path.startsWith("audit_log"));
    expect(logged?.body).toMatchObject({ action: "books.export", actor_name: "Robert", count: 7 });
  });
});

describe("report=loans", () => {
  it("returns the registry, its rules and the total outstanding", async () => {
    routes.unshift(
      [/^GET book_loans/, () => [{ id: LOAN, name: "Family Loan", starting_balance: 1000, show_on_report: true, archived_at: null }]],
      [/^GET book_transactions/, () => [txn({ transaction_id: "p1", amount: -250, loan_id: LOAN })]],
      [/^GET book_rules/, () => [{ id: "r1", match: "FAMILY LOAN", loan_id: LOAN }]],
    );
    const r = await get({ report: "loans" });
    expect(r.json.rules).toEqual([{ id: "r1", match: "FAMILY LOAN", loan_id: LOAN }]);
    expect(r.json.loans[0]).toMatchObject({ id: LOAN, name: "Family Loan", outstanding: 750 });
    expect(r.json.total_outstanding).toBe(750);
  });
});

describe("report=rules", () => {
  it("counts how many rows each rule touches", async () => {
    routes.unshift(
      [
        /^GET book_rules/,
        () => [
          { id: "r1", match: "acme", book_category: "6100 Professional Fees" },
          { id: "r2", match: "zzz" },
        ],
      ],
      [
        /^GET book_transactions/,
        () => [
          { merchant_name: "ACME Inc", name: "x" },
          { merchant_name: null, name: "pay acme" },
          { merchant_name: "Other", name: null },
        ],
      ],
    );
    const r = await get({ report: "rules" });
    expect(r.json.rules).toEqual([
      { id: "r1", match: "acme", book_category: "6100 Professional Fees", matches: 2 },
      { id: "r2", match: "zzz", matches: 0 },
    ]);
  });
});

describe("report=settings", () => {
  it("reports the toggle and the next sunrise", async () => {
    routes.unshift([/^GET books_settings/, () => [{ sync_at_sunrise: true, last_auto_sync_date: "2026-10-26" }]]);
    const r = await get({ report: "settings" });
    expect(r.json.sync_at_sunrise).toBe(true);
    expect(r.json.last_auto_sync_date).toBe("2026-10-26");
    expect(Date.parse(r.json.next_sunrise_utc)).toBeGreaterThan(Date.now());
  });
  it("defaults when there is no settings row", async () => {
    expect(await get({ report: "settings" })).toMatchObject({ status: 200, json: { sync_at_sunrise: false, last_auto_sync_date: null } });
  });
});

// ── Loan and vendor actions ───────────────────────────────────────────────

describe("loan actions", () => {
  it("create_loan needs a name and returns the row", async () => {
    expect((await post({ action: "create_loan" })).json).toMatchObject({ error: "missing_name" });
    routes.unshift([/^POST book_loans/, (c) => json([{ id: LOAN, ...c.body }], 201)]);
    const r = await post({ action: "create_loan", name: " Family Loan ", starting_balance: "abc" });
    expect(r.json.loan).toEqual({ id: LOAN, name: "Family Loan", starting_balance: 0 });
  });

  it("update_loan validates, patches only what was sent, and 404s a missing row", async () => {
    expect((await post({ action: "update_loan", loan_id: "x" })).json).toEqual({ error: "missing_loan_id" });
    expect((await post({ action: "update_loan", loan_id: LOAN })).json).toEqual({ error: "nothing_to_update" });
    expect((await post({ action: "update_loan", loan_id: LOAN, starting_balance: "x" })).json).toEqual({ error: "invalid_balance" });
    routes.unshift([/^PATCH book_loans/, (c) => json([{ id: LOAN, ...c.body }])]);
    const r = await post({ action: "update_loan", loan_id: LOAN, archived: true, show_on_report: 0 });
    expect(r.json.loan).toMatchObject({ show_on_report: false, archived_at: expect.stringMatching(/^\d{4}-/) });
    routes.unshift([/^PATCH book_loans/, () => json([])]);
    expect((await post({ action: "update_loan", loan_id: LOAN, name: "x" })).status).toBe(404);
  });

  it("loan_rule saves the rule and attaches matching rows not already on a loan", async () => {
    expect((await post({ action: "loan_rule", match: "ab", loan_id: LOAN })).json.error).toBe("match_too_short");
    expect((await post({ action: "loan_rule", match: "abc", loan_id: "nope" })).json.error).toBe("missing_loan_id");
    routes.unshift(
      [/^POST book_rules/, () => json([{ id: "r9", match: "FAMILY LOAN", loan_id: LOAN }], 201)],
      [/^GET book_transactions/, () => [{ transaction_id: "t1", name: "FAMILY LOAN repay", merchant_name: null }]],
      [/^PATCH book_transactions/, () => json([])],
    );
    const r = await post({ action: "loan_rule", match: "family loan", loan_id: LOAN });
    expect(r.json).toEqual({ rule: { id: "r9", match: "FAMILY LOAN", loan_id: LOAN }, attached: 1 });
    expect(calls.find((c) => c.method === "GET" && c.path.startsWith("book_transactions"))!.path).toContain("&loan_id=is.null");
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ loan_id: LOAN });
  });
});

describe("action=vendor_settings", () => {
  it("validates its inputs", async () => {
    expect((await post({ action: "vendor_settings", match: "a", vendor_name: "x" })).json).toEqual({ error: "missing_match" });
    expect((await post({ action: "vendor_settings", match: "acme" })).json).toEqual({ error: "nothing_to_update" });
    expect((await post({ action: "vendor_settings", match: "acme", vendor_name: " " })).json).toEqual({ error: "empty_name" });
    expect((await post({ action: "vendor_settings", match: "acme", type_override: "loan" })).json).toEqual({ error: "invalid_type" });
    expect(calls).toEqual([]);
  });

  it("merges into the existing rule and patches the rows", async () => {
    routes.unshift(
      [/^GET book_rules/, () => [{ id: "r1", match: "ACME" }]],
      [/^GET book_transactions/, () => [{ transaction_id: "t1", name: "acme", merchant_name: null }]],
      [/^PATCH /, () => json([])],
    );
    const r = await post({ action: "vendor_settings", match: "acme", vendor_name: "Acme Corp", book_category: "9100 Transfers" });
    expect(r.json).toEqual({ applied: 1, vendor_name: "Acme Corp", book_category: "9100 Transfers", type_override: null });
    const rulePatch = calls.find((c) => c.method === "PATCH" && c.path.startsWith("book_rules"))!;
    expect(rulePatch).toMatchObject({ path: "book_rules?id=eq.r1", body: { vendor_name: "Acme Corp", book_category: "9100 Transfers" } });
    const txnPatch = calls.find((c) => c.method === "PATCH" && c.path.startsWith("book_transactions"))!;
    expect(txnPatch.body).toEqual({ merchant_name: "Acme Corp", book_category: "9100 Transfers", intercompany: false, txn_type: "transfer" });
  });

  it("creates the rule when none matches", async () => {
    routes.unshift([/^GET book_rules/, () => []], [/^POST book_rules/, () => json([], 201)]);
    await post({ action: "vendor_settings", match: "new vendor", type_override: "normal" });
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ match: "new vendor", type_override: "normal" });
  });
});

describe("failures", () => {
  it("create_loan and update_loan report a failed write", async () => {
    routes.unshift([/^POST book_loans/, () => failWith(500)], [/^PATCH book_loans/, () => failWith(500)]);
    expect((await post({ action: "create_loan", name: "x" })).json.error).toBe("create_failed");
    expect((await post({ action: "update_loan", loan_id: LOAN, name: "x" })).json.error).toBe("update_failed");
  });
});
