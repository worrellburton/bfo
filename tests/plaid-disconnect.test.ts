import { beforeEach, describe, expect, it, vi } from "vitest";

// Disconnect removes everything under the item. A delete that fails (fetch
// resolves on HTTP errors) must stop the run before the item itself goes, so
// the connection stays listed and can be disconnected again.

const itemRemove = vi.fn(async () => ({}));
vi.mock("../lib/plaid.js", () => ({ getPlaidClient: () => ({ itemRemove }) }));
vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return { ...actual, currentUser: async () => ({ id: "u1", role: "owner", status: "approved" }) };
});

import handler from "../api/plaid/disconnect";

const calls: string[] = [];
let failBooks = false;

beforeEach(() => {
  calls.length = 0;
  failBooks = false;
  itemRemove.mockClear();
  process.env.SUPABASE_URL = "https://db.example";
  process.env.SUPABASE_SERVICE_KEY = "k";
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = decodeURIComponent(String(url)).replace("https://db.example/rest/v1/", "");
    const method = init.method ?? "GET";
    calls.push(`${method} ${u.split("?")[0]}`);
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
    if (method === "DELETE" && u.startsWith("book_transactions") && failBooks) return json({ message: "canceling statement due to statement timeout" }, 500);
    if (u.startsWith("plaid_items?") && method === "GET") return json([{ access_token: "tok" }]);
    if (method === "GET") return json([{ account_id: "acc1" }]);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
});

async function run() {
  const out: { status: number; body?: any } = { status: 200 };
  const res: any = { status: (s: number) => ((out.status = s), res), json: (b: unknown) => ((out.body = b), res), end: () => res };
  await handler({ method: "POST", headers: {}, query: { item_id: "item1" }, body: {} } as any, res);
  return out;
}

describe("plaid disconnect", () => {
  it("clears the item's rows, revokes it, then removes it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await run();
    expect(out.body).toEqual({ success: true, cleared_accounts: 1 });
    expect(calls.filter((c) => c.startsWith("DELETE"))).toEqual([
      "DELETE plaid_account_prefs",
      "DELETE book_transactions",
      "DELETE plaid_account_state",
      "DELETE plaid_items",
    ]);
    expect(itemRemove).toHaveBeenCalledTimes(1);
  });

  it("stops before removing the item when a delete fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    failBooks = true;
    const out = await run();
    expect(out.status).toBe(500);
    expect(calls).not.toContain("DELETE plaid_items");
    expect(calls).not.toContain("DELETE plaid_account_state");
    expect(itemRemove).not.toHaveBeenCalled();
  });
});
