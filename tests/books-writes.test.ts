import { beforeEach, describe, expect, it, vi } from "vitest";

// The Books write paths (lib/books/writes.ts, lib/books/receipts.ts) against
// a fake PostgREST: every request lands in `calls`; `routes` answers by regex
// on "METHOD path". Nothing reaches the network.

type Call = { method: string; path: string; body?: any; headers: Record<string, string> };
type Route = [RegExp, (c: Call) => Response | unknown];
const calls: Call[] = [];
let routes: Route[] = [];

function json(body: unknown, status = 200): Response {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (Array.isArray(body)) h["content-range"] = `0-${Math.max(body.length - 1, 0)}/${body.length}`;
  return new Response(JSON.stringify(body), { status, headers: h });
}
const failWith = (status: number, text = "boom") => new Response(text, { status });

const dbMock = vi.fn(async (path: string, init: RequestInit = {}) => {
  const c: Call = {
    method: init.method ?? "GET",
    path: decodeURIComponent(path),
    body: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
    headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)),
  };
  calls.push(c);
  const hit = routes.find(([re]) => re.test(`${c.method} ${c.path}`));
  const out = hit ? hit[1](c) : [];
  return out instanceof Response ? out : json(out);
});

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return { ...actual, sbFetch: (...a: unknown[]) => (dbMock as (...x: unknown[]) => unknown)(...a) };
});
const auditMock = vi.fn(async (_e: unknown) => true);
vi.mock("../lib/audit.js", () => ({ audit: (e: unknown) => auditMock(e) }));
vi.mock("../lib/storage.js", () => ({ storageRemove: vi.fn(), storageSignedUrl: async (p: string) => `https://signed.example/${p}` }));

import { batchUpdate, categorizeVendor, closePeriod, deleteRule, editTransaction, reopenPeriod, restoreValues, vendorSettings } from "../lib/books/writes";
import { addReceipt, deleteReceipt } from "../lib/books/receipts";

const user = { id: "11111111-1111-4111-8111-111111111111", name: "Pat", role: "member" } as any;
const admin = { ...user, role: "admin" };
const RULE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const prefs = [{ account_id: "acc", entity_id: "e1", entity_name: "Alpha LLC" }];
const row = (id: string, over: Record<string, unknown> = {}) => ({
  transaction_id: id,
  account_id: "acc",
  date: "2026-03-04",
  amount: 120,
  name: "ACME PAYMENT",
  merchant_name: "Acme",
  book_category: "6900 Other Operating Expenses",
  type_override: null,
  loan_id: null,
  txn_type: "normal",
  intercompany: false,
  ...over,
});
const patches = () => calls.filter((c) => c.method === "PATCH" && c.path.startsWith("book_transactions"));
const logs = () => calls.filter((c) => c.method === "POST" && c.path === "book_txn_log").flatMap((c) => c.body);

beforeEach(() => {
  calls.length = 0;
  auditMock.mockClear();
  routes = [
    [/^GET plaid_account_prefs/, () => prefs],
    [/^GET books_periods/, () => []],
    [/^POST book_txn_log/, () => json([], 201)],
    [/^PATCH book_transactions/, () => json([])],
  ];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("categorize all", () => {
  it("saves the rule with who made it, refiles what it reaches, logs each row and returns the Undo", async () => {
    routes.unshift(
      [/^GET book_rules/, () => []],
      [/^POST book_rules/, (c) => json([{ id: RULE, ...c.body }], 201)],
      [/^GET book_transactions\?select=transaction_id,account_id/, () => [row("t1"), row("t2", { merchant_name: "Acme Hardware" }), row("t3", { merchant_name: "Other", name: "OTHER" })]],
    );
    const r = await categorizeVendor({ body: { match: "Acme", match_kind: "vendor", book_category: "6100 Professional Fees" }, user });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ applied: 1, skipped_locked: 0 });
    const save = calls.find((c) => c.method === "POST" && c.path === "book_rules")!;
    expect(save.body).toMatchObject({ match: "Acme", match_kind: "vendor", created_by: user.id, created_by_name: "Pat" });
    expect(patches()[0].path).toBe('book_transactions?transaction_id=in.("t1")');
    // The account settles the type too.
    expect(patches()[0].body).toEqual({ book_category: "6100 Professional Fees", intercompany: false, txn_type: "normal", type_override: null });
    expect(logs().find((l: any) => l.field === "book_category")).toMatchObject({ transaction_id: "t1", old_value: "6900 Other Operating Expenses", source: `rule:${RULE}`, actor: user.id });
    expect((r.body as any).undo).toEqual([{ transaction_id: "t1", values: { book_category: "6900 Other Operating Expenses" } }]);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "books.refile", count: 1 }));
  });

  it("leaves rows in a closed period alone and says how many", async () => {
    routes.unshift(
      [/^GET books_periods/, () => [{ entity_id: "e1", closed_through: "2025-12-31", reopened_at: null }]],
      [/^GET book_rules/, () => []],
      [/^POST book_rules/, (c) => json([{ id: RULE, ...c.body }], 201)],
      [/^GET book_transactions\?select=transaction_id,account_id/, () => [row("old", { date: "2025-06-01" }), row("new")]],
    );
    const r = await categorizeVendor({ body: { match: "Acme", match_kind: "vendor", book_category: "6100 Professional Fees" }, user });
    expect(r.body).toMatchObject({ applied: 1, skipped_locked: 1 });
    expect(patches()[0].path).toBe('book_transactions?transaction_id=in.("new")');
  });

  it("a rule saved for new arrivals only touches no rows", async () => {
    routes.unshift([/^GET book_rules/, () => []], [/^POST book_rules/, (c) => json([{ id: RULE, ...c.body }], 201)]);
    const r = await categorizeVendor({ body: { match: "Acme", book_category: "6100 Professional Fees", apply: false }, user });
    expect(r.body).toMatchObject({ applied: 0 });
    expect(patches()).toEqual([]);
  });

  it("a failed rule save changes nothing", async () => {
    routes.unshift([/^GET book_rules/, () => []], [/^POST book_rules/, () => failWith(500)]);
    const r = await categorizeVendor({ body: { match: "Acme", book_category: "6100 Professional Fees" }, user });
    expect(r.status).toBe(500);
    expect(patches()).toEqual([]);
  });
});

describe("a vendor's default", () => {
  it("from now on only: stores the rule and leaves the history alone", async () => {
    routes.unshift([/^GET book_rules/, () => []], [/^POST book_rules/, (c) => json([{ id: RULE, ...c.body }], 201)]);
    const r = await vendorSettings({ body: { match: "Acme", book_category: "6100 Professional Fees", backfill: false }, user });
    expect(r.status).toBe(200);
    expect(patches()).toEqual([]);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "books.vendor_default" }));
  });
});

describe("batch edits", () => {
  it("writes a note beside the bank's description, never over it, and logs old values", async () => {
    routes.unshift([/^GET book_transactions\?transaction_id=in/, () => [row("t1"), row("t2", { loan_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })]]);
    const r = await batchUpdate({ body: { transaction_ids: ["t1", "t2"], name: "Quarterly rent", book_category: "6350 Rent Expense" }, user });
    expect(r.status).toBe(200);
    const body = patches()[0].body;
    expect(body.name).toBeUndefined();
    expect(body).toMatchObject({ memo: "Quarterly rent", book_category: "6350 Rent Expense", loan_id: null });
    const loanLog = logs().filter((l: any) => l.field === "loan_id");
    expect(loanLog).toEqual([expect.objectContaining({ transaction_id: "t2", old_value: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", new_value: null, source: "batch" })]);
    expect(logs().find((l: any) => l.field === "book_category" && l.transaction_id === "t1")).toMatchObject({ old_value: "6900 Other Operating Expenses" });
  });

  it("refuses the whole batch when a row is in a closed period", async () => {
    routes.unshift(
      [/^GET books_periods/, () => [{ entity_id: null, closed_through: "2026-12-31", reopened_at: null }]],
      [/^GET book_transactions\?transaction_id=in/, () => [row("t1")]],
    );
    const r = await batchUpdate({ body: { transaction_ids: ["t1"], book_category: "6350 Rent Expense" }, user });
    expect(r.status).toBe(409);
    expect((r.body as any).error).toBe("period_closed");
    expect(patches()).toEqual([]);
  });

  it("validates the selection and the patch", async () => {
    expect((await batchUpdate({ body: { transaction_ids: [] }, user })).body).toEqual({ error: "bad_selection" });
    expect((await batchUpdate({ body: { transaction_ids: ["t1"] }, user })).body).toEqual({ error: "nothing_to_update" });
    expect((await batchUpdate({ body: { transaction_ids: ["t1"], type_override: "loan" }, user })).body).toEqual({ error: "invalid_type" });
  });
});

describe("undo", () => {
  it("puts each row's values back, logged as an undo", async () => {
    routes.unshift([/^GET book_transactions\?transaction_id=in/, () => [row("t1", { book_category: "6100 Professional Fees" })]]);
    const r = await restoreValues({ body: { changes: [{ transaction_id: "t1", values: { book_category: "6900 Other Operating Expenses", name: "ignored" } }] }, user });
    expect(r.body).toEqual({ restored: 1 });
    expect(patches()[0].body).toEqual({ book_category: "6900 Other Operating Expenses" });
    expect(logs()[0]).toMatchObject({ source: "undo", old_value: "6100 Professional Fees" });
  });
});

describe("the plain edit", () => {
  it("refuses a row in a closed period", async () => {
    routes.unshift(
      [/^GET books_periods/, () => [{ entity_id: "e1", closed_through: "2026-06-30", reopened_at: null }]],
      [/^GET book_transactions\?transaction_id=in/, () => [row("t1")]],
    );
    const r = await editTransaction({ body: { transaction_id: "t1", book_category: "6100 Professional Fees" }, user });
    expect(r.status).toBe(409);
  });

  it("saves, settles the type, and logs old → new with the person", async () => {
    routes.unshift(
      [/^GET book_transactions\?transaction_id=in/, () => [row("t1", { txn_type: "transfer", book_category: "9100 Internal Transfers" })]],
      [/^PATCH book_transactions\?transaction_id=eq/, (c) => json([{ ...row("t1"), ...c.body }])],
    );
    const r = await editTransaction({ body: { transaction_id: "t1", book_category: "6000 Salaries & Wages" }, user });
    expect(r.status).toBe(200);
    const patch = calls.find((c) => c.method === "PATCH")!.body;
    expect(patch).toMatchObject({ book_category: "6000 Salaries & Wages", txn_type: "normal", intercompany: false });
    expect(logs().map((l: any) => l.field)).toEqual(expect.arrayContaining(["book_category", "txn_type"]));
    expect(logs()[0]).toMatchObject({ actor: user.id, actor_name: "Pat", source: "edit" });
  });
});

describe("rules", () => {
  it("delete keeps the whole rule in the audit trail and hands it back for an Undo", async () => {
    routes.unshift([/^GET book_rules\?id=eq/, () => [{ id: RULE, match: "Acme", book_category: "6100 Professional Fees" }]], [/^DELETE book_rules/, () => json([])]);
    const r = await deleteRule({ body: { rule_id: RULE }, user });
    expect(r.body).toMatchObject({ deleted: true, rule: { match: "Acme" } });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "books.rule_delete", detail: { rule: expect.objectContaining({ match: "Acme" }) } }));
  });
});

describe("period close", () => {
  it("is for admins, through a past day, and reopening needs a reason", async () => {
    expect((await closePeriod({ body: { closed_through: "2025-12-31" }, user })).status).toBe(403);
    expect((await closePeriod({ body: { closed_through: "2999-12-31" }, user: admin })).status).toBe(400);
    routes.unshift([/^POST books_periods/, (c) => json([{ id: 1, ...c.body }], 201)]);
    const r = await closePeriod({ body: { closed_through: "2025-12-31", entity_id: "e1", entity_name: "Alpha LLC", reason: "2025 return filed" }, user: admin });
    expect(r.status).toBe(200);
    expect((await reopenPeriod({ body: { id: 1, reason: "" }, user: admin })).status).toBe(400);
  });

  it("before the migration, says the lock needs a database update", async () => {
    routes.unshift([/^POST books_periods/, () => failWith(404, '{"code":"PGRST205","message":"Could not find the table"}')]);
    const r = await closePeriod({ body: { closed_through: "2025-12-31" }, user: admin });
    expect(r.status).toBe(409);
    expect((r.body as any).error).toBe("needs_migration");
  });
});

describe("receipts", () => {
  it("records who added one, and notes it in the history", async () => {
    routes.unshift([/^POST book_txn_receipt/, (c) => json([{ id: 7, ...c.body }], 201)]);
    const r = await addReceipt({ body: { transaction_id: "t1", url: "https://docs.example/r.pdf" }, user });
    expect((r.body as any).receipt).toMatchObject({ id: 7, uploaded_by: user.id });
    expect(logs()[0]).toMatchObject({ field: "receipt", source: "receipt" });
  });

  it("removing one keeps the record and the file", async () => {
    routes.unshift(
      [/^GET book_txn_receipt\?id=eq.7/, () => [{ id: 7, transaction_id: "t1", label: "Invoice", url: null, path: "t1/a.pdf" }]],
      [/^GET book_transactions\?transaction_id=eq.t1/, () => [{ date: "2026-03-04", account_id: "acc" }]],
      [/^PATCH book_txn_receipt/, () => json([])],
    );
    const r = await deleteReceipt({ body: { id: 7, reason: "Wrong file" }, user });
    expect(r.body).toEqual({ removed: true });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ removed_by: user.id, removed_reason: "Wrong file" });
  });

  it("is refused in a closed period", async () => {
    routes.unshift(
      [/^GET books_periods/, () => [{ entity_id: null, closed_through: "2026-12-31", reopened_at: null }]],
      [/^GET book_txn_receipt\?id=eq.7/, () => [{ id: 7, transaction_id: "t1", label: "Invoice", url: null, path: "t1/a.pdf" }]],
      [/^GET book_transactions\?transaction_id=eq.t1/, () => [{ date: "2026-03-04", account_id: "acc" }]],
    );
    expect((await deleteReceipt({ body: { id: 7 }, user })).status).toBe(409);
  });
});
