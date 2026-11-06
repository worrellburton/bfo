import { beforeEach, describe, expect, it, vi } from "vitest";

// An account's settings: every change lands in the audit trail with its
// before and after, a retirement account can't be given to an entity, and
// viewers can't change anything.

let role = "member";
vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return { ...actual, currentUser: async () => ({ id: "u1", name: "Tester", role, status: "approved" }) };
});

import handler, { changesOf } from "../api/plaid/account-prefs";

const calls: Array<{ method: string; url: string; body: any }> = [];
let existing: Record<string, unknown> = {};

beforeEach(() => {
  calls.length = 0;
  role = "member";
  existing = {
    account_id: "acc1",
    nickname: null,
    hidden: false,
    entity_id: "e1",
    entity_name: "Northwind Holdings, LLC",
    account_name: "Checking",
    mask: "4821",
    subtype: "checking",
    institution_name: "Northwind Bank",
  };
  process.env.SUPABASE_URL = "https://db.example";
  process.env.SUPABASE_SERVICE_KEY = "k";
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = decodeURIComponent(String(url)).replace("https://db.example/rest/v1/", "");
    const method = init.method ?? "GET";
    calls.push({ method, url: u, body: init.body ? JSON.parse(String(init.body)) : null });
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json", "content-range": `0-0/${Array.isArray(v) ? v.length : 0}` } });
    if (method === "GET" && u.startsWith("plaid_account_prefs?account_id")) return json([existing]);
    if (method === "GET" && u.startsWith("plaid_account_prefs?select")) return json([]);
    if (method === "GET" && u.startsWith("book_transactions"))
      return json([
        { account_id: "acc1", date: "2025-03-01" },
        { account_id: "acc1", date: "2026-02-01" },
      ]);
    if (method === "POST" && u.startsWith("plaid_account_prefs")) return json([{ ...existing, ...(JSON.parse(String(init.body)) as object) }]);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
});

async function run(method: string, body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
  const out: { status: number; body?: any } = { status: 200 };
  const res: any = { status: (s: number) => ((out.status = s), res), json: (b: unknown) => ((out.body = b), res), end: () => res };
  await handler({ method, headers: {}, body, query } as any, res);
  return out;
}

describe("account-prefs", () => {
  it("says what a change would reach", async () => {
    const out = await run("GET", {}, { account_id: "acc1" });
    expect(out.body.books).toEqual({ count: 2, from: "2025-03-01", to: "2026-02-01" });
  });

  it("records a hide in the trail with its before and after", async () => {
    await run("POST", { account_id: "acc1", hidden: true });
    const entry = calls.find((c) => c.url.startsWith("audit_log"))!.body;
    expect(entry).toMatchObject({ action: "treasury.account_hide", target_label: "Checking •• 4821", detail: { changes: { hidden: { from: false, to: true } } } });
  });

  it("tells both entities when an account moves", async () => {
    await run("POST", { account_id: "acc1", entity_id: "e2", entity_name: "Alder Partners, LP" });
    expect(calls.filter((c) => c.url.startsWith("entity_activity")).length).toBe(2);
    expect(calls.find((c) => c.url.startsWith("audit_log"))!.body.action).toBe("treasury.account_owner");
  });

  it("won't give an IRA to an entity", async () => {
    existing = { ...existing, subtype: "ira", account_name: "TRADITIONAL_IRA" };
    const out = await run("POST", { account_id: "acc1", entity_id: "e2", entity_name: "Trust" });
    expect(out.status).toBe(422);
    expect(calls.some((c) => c.method === "POST" && c.url.startsWith("plaid_account_prefs"))).toBe(false);
  });

  it("hides several accounts in one call", async () => {
    const out = await run("POST", { account_ids: ["a", "b"], hidden: true });
    expect(out.body).toEqual({ saved: ["a", "b"], failed: [] });
  });

  it("refuses a viewer", async () => {
    role = "viewer";
    expect((await run("POST", { account_id: "acc1", hidden: true })).status).toBe(403);
  });

  it("lists only real changes", () => {
    expect(changesOf({ hidden: false, nickname: null }, { account_id: "x", hidden: false, nickname: "Ops", updated_at: "t" })).toEqual({ nickname: { from: null, to: "Ops" } });
  });
});
