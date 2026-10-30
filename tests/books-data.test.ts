import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks: Supabase REST (sbFetch/sb), the session, and Storage ────────────
//
// Every DB request the endpoint makes lands in `calls`; `routes` answers by
// regex on "METHOD path" (path URL-decoded). Unmatched requests get an empty
// list, so each test states only what it cares about.

type Call = { method: string; path: string; body?: any; headers: Record<string, string> };
type Route = [RegExp, (c: Call) => Response | unknown];

const calls: Call[] = [];
let routes: Route[] = [];
let me: Record<string, unknown> | null = null;

/** A PostgREST-ish JSON reply; arrays carry the content-range fetchAll reads. */
function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  const h: Record<string, string> = { "content-type": "application/json", ...headers };
  if (Array.isArray(body) && !h["content-range"]) h["content-range"] = `0-${Math.max(body.length - 1, 0)}/${body.length}`;
  return new Response(JSON.stringify(body), { status, headers: h });
}
const failWith = (status: number, text = "boom") => new Response(text, { status });

const sbFetchMock = vi.fn(async (path: string, init: RequestInit = {}) => {
  const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
  const c: Call = {
    method: init.method ?? "GET",
    path: decodeURIComponent(path),
    body: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
    headers,
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
    // `sb` in the real module calls its own sbFetch, so route it through the fake too.
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

const storageRemove = vi.fn(async (_path: string) => {});
const storageSignedUrl = vi.fn(async (path: string) => `https://signed.example/${path}`);
vi.mock("../lib/storage.js", () => ({
  storageRemove: (...a: unknown[]) => (storageRemove as (...x: unknown[]) => unknown)(...a),
  storageSignedUrl: (...a: unknown[]) => (storageSignedUrl as (...x: unknown[]) => unknown)(...a),
}));

import handler from "../api/books/data";
import { likeTerm, orderClause, parseEntities, transactionsFilter } from "../lib/books/filters";
import { scopeFilter, withLiveEntity } from "../lib/books/prefs";
import type { BookTxn, Pref } from "../lib/books/types";

// ── Fixtures ──────────────────────────────────────────────────────────────

const U1 = "11111111-1111-4111-8111-111111111111";
const RULE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const member = { id: U1, name: "Robert", role: "member", status: "approved" };
const viewer = { ...member, role: "viewer" };

const ENT_A = "ent-a";
const ENT_B = "ent-b";
const prefs = new Map<string, Pref>([
  ["acc-a1", { account_id: "acc-a1", entity_id: ENT_A, entity_name: "Alpha LLC", hidden: false }],
  ["acc-a2", { account_id: "acc-a2", entity_id: ENT_A, entity_name: "Alpha LLC", hidden: false }],
  ["acc-b1", { account_id: "acc-b1", entity_id: ENT_B, entity_name: "Beta Trust", hidden: false }],
  ["acc-hid", { account_id: "acc-hid", entity_id: ENT_B, entity_name: "Beta Trust", hidden: true }],
  ["acc-none", { account_id: "acc-none", entity_id: null, entity_name: null, hidden: false }],
]);
const prefRows = [...prefs.values()];

function txn(over: Partial<BookTxn> = {}): BookTxn {
  return {
    transaction_id: "t1",
    account_id: "acc-a1",
    item_id: "item-1",
    date: "2026-03-04",
    name: "ACH_PMT ACME",
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
    entity_id: "stale",
    entity_name: "Stale Name",
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

const txnCalls = () => calls.filter((c) => c.path.startsWith("book_transactions"));
const patches = () => calls.filter((c) => c.method === "PATCH");

beforeEach(() => {
  calls.length = 0;
  routes = [[/^GET plaid_account_prefs/, () => prefRows]];
  me = member;
  storageRemove.mockClear();
  storageSignedUrl.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ── Pure filter building ──────────────────────────────────────────────────

describe("likeTerm", () => {
  it("escapes the LIKE metacharacters so ACH_PMT and 50% match literally", () => {
    expect(likeTerm("ACH_PMT")).toBe("ACH\\_PMT");
    expect(likeTerm("50% off")).toBe("50\\% off");
    expect(likeTerm("a\\b")).toBe("a\\\\b");
  });

  it("widens PostgREST or=() structure and typed wildcards to *", () => {
    expect(likeTerm("Burton, Robert")).toBe("Burton* Robert");
    expect(likeTerm("Fee (monthly) *")).toBe("Fee *monthly* *");
  });

  it("trims and leaves empty input empty", () => {
    expect(likeTerm("  acme  ")).toBe("acme");
    expect(likeTerm("   ")).toBe("");
  });
});

describe("parseEntities", () => {
  it("treats missing, 'all' and an empty list as everything", () => {
    expect(parseEntities(undefined)).toBeNull();
    expect(parseEntities("all")).toBeNull();
    expect(parseEntities(" , ")).toBeNull();
  });
  it("splits a comma list and drops blanks", () => {
    expect(parseEntities("a, b,,c")).toEqual(["a", "b", "c"]);
  });
});

describe("orderClause", () => {
  it("maps whitelisted keys to real columns with the id tiebreaker", () => {
    expect(orderClause("vendor.asc")).toBe("&order=merchant_name.asc.nullslast,transaction_id.asc");
    expect(orderClause("account.desc")).toBe("&order=book_category.desc.nullslast,transaction_id.asc");
  });
  it("falls back to date desc for unknown columns and to desc for a bad direction", () => {
    expect(orderClause("drop table.asc")).toBe("&order=date.desc,transaction_id.asc");
    expect(orderClause(undefined)).toBe("&order=date.desc,transaction_id.asc");
    expect(orderClause("amount.sideways")).toBe("&order=amount.desc.nullslast,transaction_id.asc");
  });
});

describe("scopeFilter / withLiveEntity", () => {
  it("always excludes hidden accounts", () => {
    expect(scopeFilter(prefs, null)).toBe('&account_id=not.in.("acc-hid")');
  });
  it("selects the accounts mapped to the chosen entities", () => {
    expect(scopeFilter(prefs, [ENT_A])).toBe('&account_id=not.in.("acc-hid")&account_id=in.("acc-a1","acc-a2")');
  });
  it("matches nothing when no account maps to the selection", () => {
    expect(scopeFilter(prefs, ["ent-zzz"])).toContain('&account_id=in.("none")');
  });
  it("unmapped means every account without an entity", () => {
    expect(scopeFilter(prefs, "unmapped")).toBe(
      '&account_id=not.in.("acc-hid")&account_id=not.in.("acc-a1","acc-a2","acc-b1","acc-hid")'
    );
  });
  it("overlays the live mapping over the stamped entity", () => {
    const [a, b] = withLiveEntity([txn(), txn({ account_id: "acc-unknown" })], prefs);
    expect([a.entity_id, a.entity_name]).toEqual([ENT_A, "Alpha LLC"]);
    expect([b.entity_id, b.entity_name]).toEqual([null, null]);
  });
});

describe("transactionsFilter", () => {
  it("adds the year span only for a four-digit year", () => {
    expect(transactionsFilter(prefs, { year: "2025" })).toContain("&date=gte.2025-01-01&date=lte.2025-12-31");
    expect(transactionsFilter(prefs, { year: "20x5" })).not.toContain("date=");
  });

  it("keeps every type filter override-aware and server-side", () => {
    expect(transactionsFilter(prefs, { type: "transfers" })).toContain(
      "&or=(type_override.eq.transfer,and(type_override.is.null,txn_type.eq.transfer,intercompany.is.false))"
    );
    expect(transactionsFilter(prefs, { type: "intercompany" })).toContain(
      "&or=(type_override.eq.intercompany,and(type_override.is.null,intercompany.is.true))"
    );
    expect(transactionsFilter(prefs, { type: "uncategorized" })).toContain("&book_category=is.null");
    expect(transactionsFilter(prefs, { type: "revenue" })).toContain("&book_category=like.4*");
    expect(transactionsFilter(prefs, { type: "expenses" })).toContain("&or=(book_category.like.6*,book_category.like.7*)");
    expect(transactionsFilter(prefs, { type: "bogus" })).toBe(scopeFilter(prefs, null));
  });

  it("escapes and encodes the search term", () => {
    const f = transactionsFilter(prefs, { q: "ACH_PMT 50%, (x)" });
    const safe = encodeURIComponent("ACH\\_PMT 50\\%* *x*");
    expect(f).toContain(`&or=(name.ilike.*${safe}*,merchant_name.ilike.*${safe}*)`);
  });

  it("drops a search that is only whitespace", () => {
    expect(transactionsFilter(prefs, { q: "   " })).toBe(scopeFilter(prefs, null));
  });

  it("composes entity, year, type and search in that order", () => {
    const f = transactionsFilter(prefs, { entity: ENT_B, year: "2026", type: "uncategorized", q: "x" });
    expect(f).toBe(
      '&account_id=not.in.("acc-hid")&account_id=in.("acc-b1","acc-hid")' +
        "&date=gte.2026-01-01&date=lte.2026-12-31&book_category=is.null&or=(name.ilike.*x*,merchant_name.ilike.*x*)"
    );
  });
});

// ── Auth and routing ──────────────────────────────────────────────────────

describe("auth and routing", () => {
  it("answers 401 without a session", async () => {
    me = null;
    expect(await get({ report: "meta" })).toEqual({ status: 401, json: { error: "unauthorized" } });
  });

  it("lets a viewer read but refuses every write with 403", async () => {
    me = viewer;
    const actions = [
      "create_loan", "update_loan", "loan_rule", "delete_rule", "categorize_vendor", "vendor_settings",
      "batch_update", "add_receipt", "set_sunrise_sync", "delete_receipt",
    ];
    for (const action of actions) {
      expect(await post({ action }), action).toEqual({ status: 403, json: { error: "forbidden" } });
    }
    expect(await post({ transaction_id: "t1", book_category: "x" })).toEqual({ status: 403, json: { error: "forbidden" } });
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
    expect((await get({ report: "settings" })).status).toBe(200);
  });

  it("rejects other methods with 405 and unknown reports with 400", async () => {
    expect((await call({ method: "PUT", body: {} })).status).toBe(405);
    const r = await get({ report: "nope" });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("unknown_report");
  });

  it("does not let Object.prototype names reach the dispatch tables", async () => {
    expect((await get({ report: "constructor" })).json.error).toBe("unknown_report");
    expect((await post({ action: "constructor" })).json.error).toBe("missing_transaction_id");
  });

  it("turns a thrown DB error into a generic 500", async () => {
    routes.unshift([/^GET book_transactions/, () => failWith(500, "relation does not exist")]);
    const r = await get({ report: "transactions" });
    expect(r.status).toBe(500);
    expect(r.json.error).toBe("books_data_failed");
    expect(JSON.stringify(r.json)).not.toMatch(/relation/);
  });
});

// ── Transactions report ───────────────────────────────────────────────────

describe("report=transactions", () => {
  const page = [txn({ transaction_id: "t1" }), txn({ transaction_id: "t2", account_id: "acc-b1", amount: -40 })];

  it("pages with Range + count, overlays live entities, and sums the whole filtered set", async () => {
    routes.unshift(
      [/^GET book_transactions\?select=\*/, () => json(page, 200, { "content-range": "0-1/57" })],
      [/^GET book_transactions\?select=date,amount/, () => [
        { date: "2026-01-02", amount: 120 },
        { date: "2026-02-03", amount: "-40.5" },
        { date: "2026-03-04", amount: 10.25 },
      ]]
    );
    const r = await get({ report: "transactions", entity: ENT_A, type: "expenses", q: "ac_me", limit: "2", sort: "amount.asc" });
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(57);
    expect(r.json.offset).toBe(0);
    expect(r.json.limit).toBe(2);
    expect(r.json.transactions.map((t: BookTxn) => t.entity_name)).toEqual(["Alpha LLC", "Beta Trust"]);
    expect(r.json.summary).toEqual({ count: 3, expenses: 130.25, income: 40.5, first: "2026-01-02", last: "2026-03-04" });

    const [pageCall, sumCall] = txnCalls();
    // The fake records paths URL-decoded, so compare against the decoded filter.
    const filter = decodeURIComponent(transactionsFilter(prefs, { entity: ENT_A, type: "expenses", q: "ac_me" }));
    expect(pageCall.path).toBe(`book_transactions?select=*${filter}&order=amount.asc.nullslast,transaction_id.asc`);
    expect(pageCall.headers).toEqual({ Range: "0-1", Prefer: "count=exact" });
    expect(sumCall.path).toBe(
      `book_transactions?select=date,amount,book_category,plaid_category,loan_id,type_override,intercompany,txn_type${filter}&order=date.asc,transaction_id.asc`
    );
  });

  it("leaves transfers, card payments, roll-ups and loans out of income and expenses", async () => {
    routes.unshift(
      [/^GET book_transactions\?select=\*/, () => json(page, 200, { "content-range": "0-1/2" })],
      [/^GET book_transactions\?select=date,amount/, () => [
        txn({ date: "2026-01-02", amount: 100, book_category: "6100 Professional Fees" }),
        txn({ date: "2026-01-03", amount: -1000, book_category: "4000 Rental Income" }),
        // Card autopay, both legs, and a transfer to savings, both legs.
        txn({ date: "2026-01-04", amount: 100, book_category: "9150 Credit Card Payments" }),
        txn({ date: "2026-01-04", amount: -100, book_category: "9150 Credit Card Payments" }),
        txn({ date: "2026-01-05", amount: 5000, txn_type: "transfer", book_category: null }),
        txn({ date: "2026-01-05", amount: -5000, txn_type: "transfer", book_category: null }),
        txn({ date: "2026-01-06", amount: 250, intercompany: true }),
        txn({ date: "2026-01-07", amount: 900, loan_id: "loan-1" }),
      ]]
    );
    const r = await get({ report: "transactions" });
    expect(r.json.summary).toEqual({ count: 8, expenses: 100, income: 1000, first: "2026-01-02", last: "2026-01-07" });
  });

  it("summary=0 skips the totals query", async () => {
    routes.unshift([/^GET book_transactions\?select=\*/, () => json(page, 200, { "content-range": "0-1/2" })]);
    const r = await get({ report: "transactions", q: "acme", limit: "5", summary: "0" });
    expect(r.json.summary).toBeNull();
    expect(txnCalls()).toHaveLength(1);
  });

  it("later pages carry no summary and respect the offset", async () => {
    routes.unshift([/^GET book_transactions\?select=\*/, () => json(page, 200, { "content-range": "100-101/300" })]);
    const r = await get({ report: "transactions", offset: "100", limit: "50" });
    expect(r.json.summary).toBeNull();
    expect(r.json.offset).toBe(100);
    expect(txnCalls()[0].headers.Range).toBe("100-149");
  });

  it("caps the page size at 500 and defaults a bad limit to 100", async () => {
    await get({ report: "transactions", limit: "9999", summary: "0" });
    expect(txnCalls()[0].headers.Range).toBe("0-499");
    calls.length = 0;
    await get({ report: "transactions", limit: "abc", summary: "0" });
    expect(txnCalls()[0].headers.Range).toBe("0-99");
  });
});

// ── Home and meta ─────────────────────────────────────────────────────────

describe("report=home", () => {
  it("returns the four dashboard parts in one round trip", async () => {
    routes.unshift(
      [/^GET treasury_daily/, () => [
        { day: "2026-10-02", cash: "100", invested: 50, credit: null },
        { day: "2026-10-01", cash: 90, invested: "40", credit: 5 },
      ]],
      [/^GET book_transactions\?select=transaction_id&pending=eq.false&book_category=is.null/, () =>
        json([], 200, { "content-range": "0-0/12" })],
    );
    const r = await get({ report: "home" });
    expect(r.status).toBe(200);
    expect(Object.keys(r.json).sort()).toEqual(["flow", "inflows", "review", "treasury"]);
    // Oldest first, numbers coerced.
    expect(r.json.treasury).toEqual([
      { day: "2026-10-01", cash: 90, invested: 40, credit: 5 },
      { day: "2026-10-02", cash: 100, invested: 50, credit: 0 },
    ]);
    expect(r.json.review).toEqual({ uncategorized: 12 });
    expect(r.json.flow).toMatchObject({ months: expect.any(Array), recentIn: [], recentOut: [], current: { in: 0, out: 0, net: 0 } });
    expect(r.json.inflows).toEqual({ monthly: 0, streams: [] });
    // Hidden accounts stay out of the flow and review queries.
    const review = calls.find((c) => c.path.includes("book_category=is.null"))!;
    expect(review.path).toContain('account_id=not.in.("acc-hid")');
    expect(review.headers).toEqual({ Range: "0-0", Prefer: "count=exact" });
  });

  it("fails each part soft to null instead of blanking the page", async () => {
    routes.unshift([/^GET treasury_daily/, () => failWith(500)]);
    const r = await get({ report: "home" });
    expect(r.status).toBe(200);
    expect(r.json.treasury).toBeNull();
    expect(r.json.review).toEqual({ uncategorized: 0 });
  });
});

describe("report=meta", () => {
  it("lists sorted entities, the chart unioned with filed accounts, distinct vendors and the row count", async () => {
    routes.unshift(
      [/^GET book_transactions\?select=transaction_id&limit=1/, () => json([{ transaction_id: "t" }], 200, { "content-range": "0-0/4321" })],
      [/^GET book_transactions\?select=updated_at/, () => [{ updated_at: "2026-10-26T12:00:00Z" }]],
      [/^GET book_transactions\?select=merchant_name,name,book_category/, () => [
        { merchant_name: "Zed Co", name: "x", book_category: "6100 Professional Fees" },
        { merchant_name: null, name: " Acme ", book_category: "Custom Manual Account" },
        { merchant_name: "Acme", name: "y", book_category: null },
      ]],
      [/^GET book_loans/, () => [{ id: "l1", name: "Family Loan" }]],
    );
    const r = await get({ report: "meta" });
    expect(r.status).toBe(200);
    expect(r.json.entities).toEqual([{ id: ENT_A, name: "Alpha LLC" }, { id: ENT_B, name: "Beta Trust" }]);
    expect(r.json.categories).toContain("6100 Professional Fees");
    expect(r.json.categories).toContain("Custom Manual Account");
    expect(r.json.categories).toEqual([...r.json.categories].sort((a: string, b: string) => a.localeCompare(b)));
    expect(r.json.vendors).toEqual(["Acme", "Zed Co"]);
    expect(r.json.loans).toEqual([{ id: "l1", name: "Family Loan" }]);
    expect(r.json.total_transactions).toBe(4321);
    expect(r.json.last_synced_at).toBe("2026-10-26T12:00:00Z");
  });
});

// ── Rules: categorize_vendor / delete_rule ────────────────────────────────

describe("action=categorize_vendor", () => {
  const matching = [
    { transaction_id: "t1", name: "ACH_PMT ACME", merchant_name: null },
    { transaction_id: "t2", name: "acme corp", merchant_name: null },
    { transaction_id: "t3", name: "unrelated", merchant_name: "ACM" }, // ilike widened, JS says no
  ];

  it("replaces the old rule, saves the new one and applies it to matching rows", async () => {
    routes.unshift(
      [/^GET book_rules/, () => [{ id: RULE, match: "ACME" }, { id: "other", match: "zzz" }]],
      [/^POST book_rules/, () => json([{ id: "new" }], 201)],
      [/^GET book_transactions\?select=transaction_id,name,merchant_name/, () => matching],
      [/^PATCH book_transactions/, () => json([])],
    );
    const r = await post({ action: "categorize_vendor", match: "acme", book_category: "6100 Professional Fees" });
    expect(r).toEqual({ status: 200, json: { applied: 2, rule: { match: "acme", book_category: "6100 Professional Fees" } } });

    const del = calls.find((c) => c.method === "DELETE")!;
    expect(del.path).toBe(`book_rules?id=eq.${RULE}`);
    const save = calls.find((c) => c.method === "POST" && c.path === "book_rules")!;
    expect(save.body).toEqual({ match: "acme", book_category: "6100 Professional Fees" });
    const [patch] = patches();
    expect(patch.path).toBe('book_transactions?transaction_id=in.("t1","t2")');
    // The account also settles the mechanical type.
    expect(patch.body).toEqual({ book_category: "6100 Professional Fees", intercompany: false, txn_type: "normal" });
  });

  it("a failed rule save is a 500 and patches nothing", async () => {
    routes.unshift([/^POST book_rules/, () => failWith(500)]);
    const r = await post({ action: "categorize_vendor", match: "acme", book_category: "6100 Professional Fees" });
    expect(r.status).toBe(500);
    expect(r.json.error).toBe("rule_failed");
    expect(patches()).toEqual([]);
  });

  it("needs both the text and the account", async () => {
    expect((await post({ action: "categorize_vendor", match: "acme" })).json).toEqual({ error: "missing_fields" });
    expect(calls).toEqual([]);
  });
});

describe("action=delete_rule", () => {
  it("rejects anything but a uuid", async () => {
    expect(await post({ action: "delete_rule", rule_id: "1 or 1=1" })).toEqual({ status: 400, json: { error: "missing_rule_id" } });
    expect(calls).toEqual([]);
  });
  it("reports a failed delete", async () => {
    routes.unshift([/^DELETE book_rules/, () => failWith(500)]);
    const r = await post({ action: "delete_rule", rule_id: RULE });
    expect(r.status).toBe(500);
    expect(r.json.error).toBe("rule_failed");
  });
  it("deletes by id", async () => {
    expect(await post({ action: "delete_rule", rule_id: RULE })).toEqual({ status: 200, json: { deleted: true } });
    expect(calls).toEqual([expect.objectContaining({ method: "DELETE", path: `book_rules?id=eq.${RULE}` })]);
  });
});

// ── batch_update ──────────────────────────────────────────────────────────

describe("action=batch_update", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);

  it("patches in chunks of 200 and logs only the chosen fields", async () => {
    routes.unshift([/^PATCH book_transactions/, () => json([])], [/^POST book_txn_log/, () => json([], 201)]);
    const r = await post({ action: "batch_update", transaction_ids: ids(250), book_category: "6200 Insurance", merchant_name: " Geico " });
    expect(r).toEqual({ status: 200, json: { updated: 250 } });
    expect(patches()).toHaveLength(2);
    expect(patches()[0].body).toEqual({ merchant_name: "Geico", book_category: "6200 Insurance", loan_id: null });
    const log = calls.find((c) => c.path === "book_txn_log")!;
    expect(log.body).toHaveLength(500); // 250 rows × 2 fields
    expect(log.body.map((x: any) => x.field)).not.toContain("loan_id");
    expect(log.body[0]).toMatchObject({ transaction_id: "t0", source: "batch", actor: U1, old_value: null });
  });

  it("a failed chunk is a 500 that says how many were updated", async () => {
    let n = 0;
    routes.unshift([/^PATCH book_transactions/, () => (n++ === 0 ? json([]) : failWith(500, "nope"))]);
    const r = await post({ action: "batch_update", transaction_ids: ids(250), name: "Desc" });
    expect(r.status).toBe(500);
    expect(r.json).toEqual({ error: "update_failed", message: "Only 200 of 250 were updated.", updated: 200 });
    expect(calls.find((c) => c.path === "book_txn_log")).toBeUndefined();
  });

  it("a lost audit write is reported even though the rows saved", async () => {
    routes.unshift([/^PATCH book_transactions/, () => json([])], [/^POST book_txn_log/, () => failWith(500)]);
    const r = await post({ action: "batch_update", transaction_ids: ids(3), name: "Desc" });
    expect(r.status).toBe(500);
    expect(r.json).toMatchObject({ error: "history_failed", updated: 3 });
    expect(calls.filter((c) => c.path === "book_txn_log")).toHaveLength(2); // one retry
  });

  it("validates the selection and the patch", async () => {
    expect((await post({ action: "batch_update", transaction_ids: [] })).json).toEqual({ error: "bad_selection" });
    expect((await post({ action: "batch_update", transaction_ids: ids(501), name: "x" })).json).toEqual({ error: "bad_selection" });
    expect((await post({ action: "batch_update", transaction_ids: ["t1"] })).json).toEqual({ error: "nothing_to_update" });
    expect((await post({ action: "batch_update", transaction_ids: ["t1"], type_override: "loan" })).json).toEqual({ error: "invalid_type" });
    expect((await post({ action: "batch_update", transaction_ids: ["t1"], merchant_name: "  " })).json).toEqual({ error: "empty_vendor" });
    expect(calls).toEqual([]);
  });
});

// ── set_sunrise_sync ──────────────────────────────────────────────────────

describe("action=set_sunrise_sync", () => {
  it("writes the toggle to the single settings row", async () => {
    routes.unshift([/^PATCH books_settings/, () => json([])]);
    expect(await post({ action: "set_sunrise_sync", enabled: "yes" })).toEqual({ status: 200, json: { sync_at_sunrise: true } });
    const [p] = patches();
    expect(p.path).toBe("books_settings?id=eq.1");
    expect(p.body).toMatchObject({ sync_at_sunrise: true, updated_at: expect.stringMatching(/^\d{4}-/) });
  });
  it("coerces a missing flag to off and reports a failed save", async () => {
    routes.unshift([/^PATCH books_settings/, () => failWith(500)]);
    const r = await post({ action: "set_sunrise_sync" });
    expect(r.status).toBe(500);
    expect(r.json.error).toBe("settings_failed");
    expect(patches()[0].body.sync_at_sunrise).toBe(false);
  });
});

// ── Receipts ──────────────────────────────────────────────────────────────

describe("receipts", () => {
  it("add_receipt wants a transaction and an http(s) url", async () => {
    expect((await post({ action: "add_receipt", url: "https://x.y/z" })).json).toEqual({ error: "missing_transaction_id" });
    expect((await post({ action: "add_receipt", transaction_id: "t1", url: "ftp://x.y/z" })).json).toEqual({ error: "bad_url" });
    expect(calls).toEqual([]);
  });

  it("add_receipt stores the link and hands back the row", async () => {
    routes.unshift([/^POST book_txn_receipt/, (c) => json([{ id: 7, ...c.body }], 201)]);
    const r = await post({ action: "add_receipt", transaction_id: " t1 ", url: "https://docs.example/r.pdf", label: "Invoice" });
    expect(r.status).toBe(200);
    expect(r.json.receipt).toEqual({ id: 7, transaction_id: "t1", url: "https://docs.example/r.pdf", label: "Invoice" });
    expect(calls[0].headers.Prefer).toBe("return=representation");
  });

  it("add_receipt reports a failed insert", async () => {
    routes.unshift([/^POST book_txn_receipt/, () => failWith(500)]);
    expect(await post({ action: "add_receipt", transaction_id: "t1", url: "https://docs.example/r.pdf" })).toEqual({
      status: 500,
      json: { error: "receipt_failed" },
    });
  });

  it("delete_receipt rejects a non-integer id", async () => {
    expect(await post({ action: "delete_receipt", id: "7; drop" })).toEqual({ status: 400, json: { error: "bad_id" } });
    expect(calls).toEqual([]);
  });

  it("delete_receipt removes the stored object before the row", async () => {
    routes.unshift([/^GET book_txn_receipt\?id=eq.7/, () => [{ path: "receipts/t1/r.pdf" }]]);
    expect(await post({ action: "delete_receipt", id: 7 })).toEqual({ status: 200, json: { deleted: true } });
    expect(storageRemove).toHaveBeenCalledWith("receipts/t1/r.pdf");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET book_txn_receipt?id=eq.7&select=path&limit=1",
      "DELETE book_txn_receipt?id=eq.7",
    ]);
  });

  it("delete_receipt leaves storage alone for an external link", async () => {
    routes.unshift([/^GET book_txn_receipt\?id=eq.8/, () => [{ path: null }]]);
    await post({ action: "delete_receipt", id: 8 });
    expect(storageRemove).not.toHaveBeenCalled();
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
  });

  it("report=history signs storage-backed receipts and keeps external urls", async () => {
    routes.unshift(
      [/^GET book_txn_log/, () => [{ field: "book_category", old_value: null, new_value: "6100 Professional Fees" }]],
      [/^GET book_txn_receipt/, () => [
        { id: 1, path: "receipts/t1/a.pdf", url: null },
        { id: 2, path: null, url: "https://docs.example/b.pdf" },
      ]],
    );
    const r = await get({ report: "history", transaction_id: "t1" });
    expect(r.status).toBe(200);
    expect(r.json.log).toHaveLength(1);
    expect(r.json.receipts.map((x: any) => x.url)).toEqual(["https://signed.example/receipts/t1/a.pdf", "https://docs.example/b.pdf"]);
    expect((await get({ report: "history" })).json).toEqual({ error: "missing_transaction_id" });
  });
});

// ── The plain edit ────────────────────────────────────────────────────────

describe("POST {transaction_id, …}", () => {
  it("validates before touching the database", async () => {
    expect((await post({ book_category: "x" })).json).toEqual({ error: "missing_transaction_id" });
    expect((await post({ transaction_id: "t1" })).json).toEqual({ error: "nothing_to_update" });
    expect((await post({ transaction_id: "t1", type_override: "loan" })).json).toEqual({ error: "invalid_type" });
    expect((await post({ transaction_id: "t1", loan_id: "not-a-uuid" })).json).toEqual({ error: "invalid_loan_id" });
    expect(calls).toEqual([]);
  });

  it("saves, logs old → new for the fields that changed, and returns the row", async () => {
    routes.unshift(
      [/^GET book_transactions\?transaction_id=eq.t1&select=book_category/, () => [
        { book_category: "6900 Other Operating Expenses", type_override: null, loan_id: null, merchant_name: "Acme", name: "x" },
      ]],
      [/^PATCH book_transactions/, () => json([txn({ book_category: "6100 Professional Fees" })])],
      [/^POST book_txn_log/, () => json([], 201)],
    );
    const r = await post({ transaction_id: "t1", book_category: " 6100 Professional Fees ", type_override: null });
    expect(r.status).toBe(200);
    expect(r.json.transaction.book_category).toBe("6100 Professional Fees");
    const log = calls.find((c) => c.path === "book_txn_log")!;
    // type_override null → null is unchanged, so only the account is logged.
    expect(log.body).toEqual([
      {
        transaction_id: "t1",
        field: "book_category",
        old_value: "6900 Other Operating Expenses",
        new_value: "6100 Professional Fees",
        source: "edit",
        actor: U1,
      },
    ]);
  });

  it("a row that no longer exists is a 404", async () => {
    routes.unshift([/^PATCH book_transactions/, () => json([])]);
    expect(await post({ transaction_id: "gone", book_category: "x" })).toEqual({ status: 404, json: { error: "not_found" } });
  });
});
