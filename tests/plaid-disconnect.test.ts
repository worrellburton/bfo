import { beforeEach, describe, expect, it, vi } from "vitest";

// Disconnect stops the feed and keeps the books: it revokes the link at Plaid
// first, and only then marks the accounts and forgets the token. It never
// deletes a Books transaction, and if Plaid can't confirm the revocation
// nothing changes. Plaid is mocked; nothing here reaches the network.

let removeError: unknown = null;
const itemRemove = vi.fn(async () => {
  if (removeError) throw removeError;
  return {};
});
vi.mock("../lib/plaid.js", () => ({ getPlaidClient: () => ({ itemRemove }) }));
let role = "owner";
vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return { ...actual, currentUser: async () => ({ id: "u1", name: "Tester", role, status: "approved" }) };
});

import handler from "../api/plaid/disconnect";

const calls: Array<{ method: string; url: string; body: unknown }> = [];
let migrated = true;

beforeEach(() => {
  calls.length = 0;
  removeError = null;
  migrated = true;
  role = "owner";
  itemRemove.mockClear();
  process.env.SUPABASE_URL = "https://db.example";
  process.env.SUPABASE_SERVICE_KEY = "k";
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = decodeURIComponent(String(url)).replace("https://db.example/rest/v1/", "");
    const method = init.method ?? "GET";
    calls.push({ method, url: u, body: init.body ? JSON.parse(String(init.body)) : null });
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "content-range": `0-0/${Array.isArray(v) ? v.length : 0}` } });
    if (method !== "GET") return new Response(null, { status: 204 });
    if (u.startsWith("plaid_items?")) return json([{ item_id: "item1", access_token: "tok", institution_name: "Northwind Bank" }]);
    if (u.startsWith("plaid_account_state?")) return json([{ account_id: "acc1", balance: 1250, seen_at: "2026-11-05T12:00:00Z" }]);
    if (u.startsWith("book_transactions?item_id")) return json([{ account_id: "acc1" }, { account_id: "acc1" }]);
    if (u.startsWith("book_transactions?account_id"))
      return json([
        { account_id: "acc1", date: "2025-01-04" },
        { account_id: "acc1", date: "2026-10-30" },
        { account_id: "acc1", date: "2026-03-02" },
      ]);
    if (u.startsWith("plaid_account_prefs?select=disconnected_at")) return migrated ? json([]) : json({ message: "column does not exist" }, 400);
    if (u.startsWith("plaid_account_prefs?account_id"))
      return json([
        {
          account_id: "acc1",
          nickname: "Operating",
          hidden: false,
          entity_id: "ent1",
          entity_name: "Northwind Holdings, LLC",
          account_name: "Checking",
          mask: "4821",
          subtype: "checking",
          account_type: "depository",
          disconnected_at: null,
        },
      ]);
    return json([]);
  }) as typeof fetch;
});

async function run(method = "POST") {
  const out: { status: number; body?: any } = { status: 200 };
  const res: any = { status: (s: number) => ((out.status = s), res), json: (b: unknown) => ((out.body = b), res), end: () => res, setHeader() {} };
  await handler({ method, headers: {}, query: { item_id: "item1" }, body: {} } as any, res);
  return out;
}

const writes = () => calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url.split("?")[0]}`);

describe("plaid disconnect", () => {
  it("previews what it affects without calling Plaid or writing", async () => {
    const out = await run("GET");
    expect(out.status).toBe(200);
    expect(out.body.institution_name).toBe("Northwind Bank");
    expect(out.body.books).toEqual({ count: 3, from: "2025-01-04", to: "2026-10-30" });
    expect(out.body.accounts[0]).toMatchObject({ mask: "4821", balance: 1250, entity_name: "Northwind Holdings, LLC" });
    expect(itemRemove).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it("revokes first, keeps the ledger and marks the accounts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await run();
    expect(out.body).toEqual({ success: true, kept_accounts: 1, kept_transactions: 3 });
    expect(itemRemove).toHaveBeenCalledTimes(1);
    const w = writes();
    expect(w.filter((x) => x.includes("book_transactions"))).toEqual([]);
    expect(w).toEqual(["POST plaid_account_prefs", "DELETE plaid_account_state", "DELETE plaid_items", "POST audit_log", "POST entity_activity"]);
    const kept = calls.find((c) => c.method === "POST" && c.url.startsWith("plaid_account_prefs"))!.body as any[];
    expect(kept[0]).toMatchObject({ account_id: "acc1", disconnected_reason: "disconnected", last_balance: 1250, books_through: "2026-10-30", archived_at: null });
  });

  it("changes nothing when Plaid can't confirm the revocation", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    removeError = Object.assign(new Error("down"), { response: { data: { error_code: "INTERNAL_SERVER_ERROR" } } });
    const out = await run();
    expect(out.status).toBe(502);
    expect(writes()).toEqual([]);
  });

  it("finishes when Plaid says the link is already gone", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    removeError = Object.assign(new Error("gone"), { response: { data: { error_code: "ITEM_NOT_FOUND" } } });
    const out = await run();
    expect(out.body.success).toBe(true);
    expect(writes()).toContain("DELETE plaid_items");
  });

  it("refuses before revoking when the migration isn't applied", async () => {
    migrated = false;
    const out = await run();
    expect(out.status).toBe(503);
    expect(itemRemove).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it("is for owners and admins only", async () => {
    role = "member";
    const out = await run();
    expect(out.status).toBe(403);
    expect(itemRemove).not.toHaveBeenCalled();
  });
});
