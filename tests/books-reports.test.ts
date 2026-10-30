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
  it("groups the year into revenue, operating, other, transfers and intercompany", async () => {
    routes.unshift(rows(ledger), [/^GET book_loans/, () => [{ id: LOAN, name: "Family Loan" }]]);
    const r = await get({ report: "pnl", year: "2026" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ year: 2026, entity: "all", basis: "cash", transaction_count: 7, eliminated_count: 1 });
    expect(r.json.revenue).toEqual([
      { label: "4000 Rental Income", monthly: [1000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], total: 1000 },
      // Uncategorized money-in lands in revenue by sign.
      { label: "Income", monthly: [0, 0, 0, 80, 0, 0, 0, 0, 0, 0, 0, 0], total: 80 },
    ]);
    expect(r.json.operating).toEqual([{ label: "6100 Professional Fees", monthly: [300, 700, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], total: 1000 }]);
    expect(r.json.other[0]).toMatchObject({ label: "7100 Interest Expense", total: 50 });
    expect(r.json.net_total).toBe(1080 - 1000 - 50);
    expect(r.json.transfers).toMatchObject({ total: -500, rows: [{ label: "9100 Transfers", total: -500 }] });
    expect(r.json.intercompany.total).toBe(0);
    // Year filter and hidden-account exclusion are pushed to the database.
    expect(calls[1].path).toContain("&date=gte.2026-01-01&date=lte.2026-12-31");
    expect(calls[1].path).toContain('account_id=not.in.("acc-hid")');
  });

  it("under a partial selection the intercompany leg shows instead of being eliminated", async () => {
    routes.unshift(rows(ledger), [/^GET book_loans/, () => []]);
    const r = await get({ report: "pnl", year: "2026", entity: ENT_A });
    expect(r.json.entity).toBe(ENT_A);
    expect(r.json.eliminated_count).toBe(0);
    expect(r.json.intercompany.out[2]).toBe(200);
    expect(calls[1].path).toContain('account_id=in.("acc-a1")');
  });

  it("defaults a bad year to the current one", async () => {
    routes.unshift(rows([]), [/^GET book_loans/, () => []]);
    expect((await get({ report: "pnl", year: "abcd" })).json.year).toBe(new Date().getFullYear());
  });
});

describe("report=cell", () => {
  beforeEach(() => routes.unshift(rows(ledger), [/^GET book_loans/, () => []]));

  it("returns the rows behind one account × month, newest first", async () => {
    const r = await get({ report: "cell", year: "2026", section: "operating", label: "6100 Professional Fees" });
    expect(r.json.count).toBe(2);
    expect(r.json.transactions.map((t: BookTxn) => t.transaction_id)).toEqual(["e2", "e1"]);
    const feb = await get({ report: "cell", year: "2026", section: "operating", label: "6100 Professional Fees", month: "2" });
    expect(feb.json.transactions.map((t: BookTxn) => t.transaction_id)).toEqual(["e2"]);
  });

  it("knows the net, transfers and intercompany sections", async () => {
    expect((await get({ report: "cell", year: "2026", section: "net" })).json.count).toBe(5);
    expect((await get({ report: "cell", year: "2026", section: "transfers" })).json.transactions[0].transaction_id).toBe("x1");
    expect((await get({ report: "cell", year: "2026", section: "intercompany" })).json.count).toBe(0);
    expect((await get({ report: "cell", year: "2026", section: "intercompany", entity: ENT_A })).json.count).toBe(1);
    expect((await get({ report: "cell", year: "2026", section: "bogus" })).json).toEqual({ transactions: [], count: 0 });
  });
});

describe("report=statements", () => {
  it("builds the trial balance and the cash-flow summary", async () => {
    routes.unshift(rows(ledger));
    const r = await get({ report: "statements", year: "2026" });
    expect(r.json).toMatchObject({ year: 2026, basis: "cash" });
    expect(r.json.trial_balance).toEqual([
      { account: "4000 Rental Income", section: "revenue", debit: 0, credit: 1000, net: -1000 },
      { account: "6100 Professional Fees", section: "operating", debit: 1000, credit: 0, net: 1000 },
      { account: "7100 Interest Expense", section: "other", debit: 50, credit: 0, net: 50 },
      { account: "9000 Intercompany", section: "flow", debit: 200, credit: 0, net: 200 },
      { account: "9100 Transfers", section: "flow", debit: 500, credit: 0, net: 500 },
      { account: "Income", section: "uncategorized", debit: 0, credit: 80, net: -80 },
    ]);
    expect(r.json.totals).toEqual({ debit: 1750, credit: 1080 });
    expect(r.json.cash_flow).toEqual({ operating: -50, financing: -700, uncategorized: 80, net_change: -670 });
  });
});

describe("report=tax1099", () => {
  it("totals payments to service vendors at or above the $600 threshold", async () => {
    routes.unshift(rows([
      ...ledger,
      txn({ transaction_id: "c1", amount: 599, book_category: "6150 Contract Services", merchant_name: "Small Fry" }),
      txn({ transaction_id: "c2", amount: 1200, book_category: "6150 Contract Services", merchant_name: "Builder", type_override: "transfer" }),
    ]));
    const r = await get({ report: "tax1099", year: "2026" });
    expect(r.json).toEqual({
      year: 2026,
      threshold: 600,
      vendors: [{ vendor: "Lawyer", entity: "Alpha LLC", paid: 1000, count: 2, account: "6100 Professional Fees" }],
    });
  });

  it("scopes to the selected entity", async () => {
    routes.unshift(rows(ledger));
    await get({ report: "tax1099", year: "2026", entity: ENT_B });
    const path = calls.find((c) => c.path.startsWith("book_transactions"))!.path;
    expect(path).toContain(`account_id=in.("acc-b1","acc-hid")`);
  });

  it("applies the threshold per paying entity", async () => {
    routes.unshift(rows([
      txn({ transaction_id: "p1", amount: 400, book_category: "6150 Contract Services", merchant_name: "Painter" }),
      txn({ transaction_id: "p2", amount: 400, book_category: "6150 Contract Services", merchant_name: "painter ", account_id: "acc-b1" }),
      txn({ transaction_id: "p3", amount: 300, book_category: "6150 Contract Services", merchant_name: "Painter", account_id: "acc-b1" }),
    ]));
    const r = await get({ report: "tax1099", year: "2026" });
    expect(r.json.vendors).toEqual([{ vendor: "painter", entity: "Beta Trust", paid: 700, count: 2, account: "6150 Contract Services" }]);
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
    routes.unshift(rows([
      txn({ transaction_id: "a", amount: 10, book_category: null }),
      txn({ transaction_id: "b", amount: 10, item_id: "item-2" }),
      txn({ transaction_id: "c", amount: 10 }),
      txn({ transaction_id: "d", amount: 9999, book_category: "6900 Other Operating Expenses" }),
      txn({ transaction_id: "e", amount: 5000, txn_type: "transfer", book_category: "9100 Transfers" }),
    ]));
    const r = await get({ report: "review" });
    expect(r.json.counts).toEqual({ uncategorized: 1, low_confidence: 1, duplicate_groups: 1 });
    expect(r.json.uncategorized[0]).toEqual({
      transaction_id: "a", date: "2026-03-04", name: "ACME", merchant_name: "Acme", amount: 10,
      book_category: null, entity_name: "Alpha LLC", account_id: "acc-a1", item_id: "item-1",
    });
    expect(r.json.duplicates[0]).toMatchObject({ count: 3, cross_source: true, amount: 10 });
    expect(r.json.outliers.map((t: any) => t.transaction_id)).toEqual(["d", "a", "b", "c"]);
  });
});

describe("report=recurring", () => {
  it("detects a monthly stream and projects the next date", async () => {
    const monthly = ["2026-01-05", "2026-02-05", "2026-03-06", "2026-04-05"].map((date, i) =>
      txn({ transaction_id: `m${i}`, date, amount: 49.99, merchant_name: "Netflix", book_category: "6450 Dues & Subscriptions" })
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
      [/^GET book_transactions\?select=account_id,amount/, () => [
        { account_id: "acc-a1", amount: 100 },
        { account_id: "acc-a1", amount: -350.5 },
        { account_id: "acc-hid", amount: 1 },
      ]],
      [/^GET plaid_account_state/, () => [
        { account_id: "acc-a1", balance: "250.5" },
        { account_id: "acc-b1", balance: 10 },
        { account_id: "acc-hid", balance: 99 },
      ]],
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
    { account_id: "acc-a1", institution_name: "Chase", mask: "1234", subtype: "checking", account_name: "Ops", nickname: null, entity_id: ENT_A, entity_name: "Alpha LLC", hidden: false, archived_at: null },
    { account_id: "acc-a2", institution_name: "Schwab", mask: null, subtype: "brokerage", account_name: null, nickname: "Nest egg", entity_id: ENT_A, entity_name: null, hidden: false, archived_at: null },
    { account_id: "acc-b1", institution_name: "Amex", mask: "9", subtype: "credit card", account_name: null, nickname: null, entity_id: ENT_B, entity_name: "Beta Trust", hidden: false, archived_at: null },
    { account_id: "acc-hid", institution_name: null, mask: null, subtype: "checking", account_name: null, nickname: null, entity_id: ENT_B, entity_name: "Beta Trust", hidden: true, archived_at: null },
    { account_id: "acc-zero", institution_name: null, mask: null, subtype: "checking", account_name: null, nickname: null, entity_id: ENT_A, entity_name: "Alpha LLC", hidden: false, archived_at: null },
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
    expect(r.json.entity).toBe("all");
    expect(r.json.sections.cash).toEqual({ rows: [{ label: "Alpha LLC", detail: "Chase · ····1234 · checking", balance: 1000 }], total: 1000 });
    expect(r.json.sections.investments.rows).toEqual([{ label: "Nest egg", detail: "Schwab · brokerage", balance: 5000 }]);
    expect(r.json.sections.credit.rows).toEqual([{ label: "Beta Trust", detail: "Amex · ····9 · credit card", balance: -300 }]);
    expect(r.json.sections.loans).toEqual({ rows: [{ label: "Family Loan", detail: "loan receivable", balance: 1000 }], total: 1000 });
    expect(r.json).toMatchObject({ total_assets: 7000, total_liabilities: -300, net_worth: 7300 });
  });

  it("a single entity's sheet leaves the family-level loans out", async () => {
    const r = await get({ report: "balance-sheet", entity: ENT_A });
    expect(r.json.entity).toBe(ENT_A);
    expect(r.json.sections.loans).toEqual({ rows: [], total: 0 });
    expect(r.json.sections.credit.rows).toEqual([]);
    expect(r.json.total_assets).toBe(6000);
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
      [/^GET book_rules/, () => [{ id: "r1", match: "acme", book_category: "6100 Professional Fees" }, { id: "r2", match: "zzz" }]],
      [/^GET book_transactions/, () => [{ merchant_name: "ACME Inc", name: "x" }, { merchant_name: null, name: "pay acme" }, { merchant_name: "Other", name: null }]],
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
