import { beforeEach, describe, expect, it, vi } from "vitest";

// prune-accounts reconciles Treasury with what the banks still report. An
// account a bank stops reporting keeps its Books history: it is marked, never
// deleted. A bank that is only unreachable (waiting for re-login) must not
// count as "everything is gone". Plaid is mocked.

let wellsReachable = false;

vi.mock("../lib/plaid.js", () => ({
  getPlaidClient: () => ({
    accountsGet: async ({ access_token }: { access_token: string }) => {
      if (access_token === "tok-wells") {
        if (!wellsReachable) throw Object.assign(new Error("login required"), { response: { data: { error_code: "ITEM_LOGIN_REQUIRED" } } });
        return { data: { accounts: [] } };
      }
      return { data: { accounts: [{ account_id: "merc-1", mask: "1111", subtype: "checking", name: "Checking", type: "depository" }] } };
    },
  }),
}));
vi.mock("../lib/plaid-mappings.js", () => ({ stampIdentity: async () => {}, adoptMappings: async () => 0, keepColumnsReady: async () => true }));
let role = "owner";
vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return { ...actual, currentUser: async () => ({ id: "u1", name: "Tester", role, status: "approved" }) };
});

import handler from "../api/plaid/prune-accounts";

const calls: Array<{ method: string; url: string; body: unknown }> = [];

beforeEach(() => {
  calls.length = 0;
  wellsReachable = false;
  role = "owner";
  process.env.SUPABASE_URL = "https://db.example";
  process.env.SUPABASE_SERVICE_KEY = "k";
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = decodeURIComponent(String(url)).replace("https://db.example/rest/v1/", "");
    calls.push({ method: init.method ?? "GET", url: u, body: init.body ? JSON.parse(String(init.body)) : null });
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json", "content-range": `0-0/${Array.isArray(v) ? v.length : 0}` } });
    if ((init.method ?? "GET") !== "GET") return new Response(null, { status: 204 });
    if (u.startsWith("plaid_items?select")) {
      return json([
        { item_id: "it-merc", access_token: "tok-merc", institution_name: "Mercury" },
        { item_id: "it-wells", access_token: "tok-wells", institution_name: "Wells Fargo" },
      ]);
    }
    if (u.startsWith("plaid_account_prefs?select"))
      return json([
        {
          account_id: "wells-1",
          nickname: "Operating",
          hidden: false,
          entity_id: "e1",
          entity_name: "Northwind Holdings, LLC",
          account_name: "Checking",
          mask: "2222",
          institution_name: "Wells Fargo",
          disconnected_at: null,
        },
      ]);
    if (u.startsWith("plaid_account_state?select"))
      return json([
        { account_id: "merc-1", balance: 5, seen_at: "2026-11-05T00:00:00Z" },
        { account_id: "wells-1", balance: 900, seen_at: "2026-11-05T00:00:00Z" },
      ]);
    if (u.startsWith("book_transactions?")) {
      expect(u).toContain("order=transaction_id.asc");
      return json([
        { account_id: "wells-1", date: "2025-02-01" },
        { account_id: "wells-1", date: "2026-09-30" },
      ]);
    }
    return json([]);
  }) as typeof fetch;
});

async function run(body: Record<string, unknown> = {}) {
  const out: { status: number; body?: any } = { status: 200 };
  const res: any = { status: (s: number) => ((out.status = s), res), json: (b: unknown) => ((out.body = b), res), end: () => res };
  await handler({ method: "POST", headers: {}, body } as any, res);
  return out;
}

const writes = () => calls.filter((c) => c.method !== "GET");

describe("prune-accounts", () => {
  it("changes nothing while a bank waits for re-login", async () => {
    const out = await run();
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ pruned: false, unreachable: ["Wells Fargo"] });
    expect(out.body.stopped[0]).toMatchObject({ account_id: "wells-1", books: { count: 2, from: "2025-02-01", to: "2026-09-30" } });
    expect(writes()).toEqual([]);
  });

  it("keeps a stopped account's ledger and marks it, once every bank answers", async () => {
    wellsReachable = true;
    const out = await run();
    expect(out.body).toMatchObject({ pruned: true, kept_transactions: 2 });
    const w = writes().map((c) => `${c.method} ${c.url.split("?")[0]}`);
    expect(w).toEqual(["POST plaid_account_prefs", "DELETE plaid_account_state", "POST audit_log"]);
    expect(writes().some((c) => c.url.startsWith("book_transactions"))).toBe(false);
    const marked = (writes()[0].body as any[])[0];
    expect(marked).toMatchObject({ account_id: "wells-1", disconnected_reason: "not_shared", last_balance: 900, books_through: "2026-09-30", archived_at: null });
  });

  it("only reports on a dry run", async () => {
    wellsReachable = true;
    const out = await run({ dry_run: true });
    expect(out.body.pruned).toBe(false);
    expect(writes()).toEqual([]);
  });

  it("is for owners and admins only", async () => {
    role = "viewer";
    const out = await run();
    expect(out.status).toBe(403);
  });
});
