import { beforeEach, describe, expect, it, vi } from "vitest";

// prune-accounts deletes what the banks no longer report. A bank that is only
// unreachable (waiting for re-login) must not count as "everything is gone".

let wellsReachable = false;

vi.mock("../lib/plaid.js", () => ({
  getPlaidClient: () => ({
    accountsGet: async ({ access_token }: { access_token: string }) => {
      if (access_token === "tok-wells") {
        if (!wellsReachable) {
          const err = Object.assign(new Error("login required"), {
            response: { data: { error_code: "ITEM_LOGIN_REQUIRED" } },
          });
          throw err;
        }
        return { data: { accounts: [] } };
      }
      return { data: { accounts: [{ account_id: "merc-1", mask: "1111", subtype: "checking", name: "Checking" }] } };
    },
  }),
}));
vi.mock("../lib/plaid-mappings.js", () => ({ stampIdentity: async () => {}, adoptMappings: async () => 0 }));
vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return { ...actual, currentUser: async () => ({ id: "u1", role: "owner", status: "approved" }) };
});

import handler from "../api/plaid/prune-accounts";

const calls: Array<{ method: string; url: string }> = [];

beforeEach(() => {
  calls.length = 0;
  wellsReachable = false;
  process.env.SUPABASE_URL = "https://db.example";
  process.env.SUPABASE_SERVICE_KEY = "k";
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = decodeURIComponent(String(url)).replace("https://db.example/rest/v1/", "");
    calls.push({ method: init.method ?? "GET", url: u });
    const json = (v: unknown, range = "0-0/1") =>
      new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json", "content-range": range } });
    if (u.startsWith("plaid_items?select")) {
      return json([
        { item_id: "it-merc", access_token: "tok-merc", institution_name: "Mercury" },
        { item_id: "it-wells", access_token: "tok-wells", institution_name: "Wells Fargo" },
      ]);
    }
    if (u.startsWith("plaid_account_prefs?select")) {
      return json([{ account_id: "wells-1", nickname: "Operating", entity_name: "Burton Holdings" }]);
    }
    if (u.startsWith("plaid_account_state?select")) return json([{ account_id: "merc-1" }, { account_id: "wells-1" }]);
    if (u.startsWith("book_transactions?select=account_id")) {
      // The read asks only for rows of accounts the banks didn't report.
      expect(u).toContain('account_id=not.in.("merc-1")');
      expect(u).toContain("order=transaction_id.asc");
      return json([{ account_id: "wells-1" }], "0-0/1");
    }
    return json([], "0-0/412");
  }) as typeof fetch;
});

async function run() {
  const out: { status: number; body?: Record<string, unknown> } = { status: 200 };
  const res: any = {
    status: (s: number) => ((out.status = s), res),
    json: (b: Record<string, unknown>) => ((out.body = b), res),
    end: () => res,
  };
  await handler({ method: "POST", headers: {}, body: {} } as any, res);
  return out;
}

const writes = () => calls.filter((c) => c.method !== "GET");

describe("prune-accounts", () => {
  it("deletes nothing while a bank waits for re-login", async () => {
    const out = await run();
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ pruned: false, unreachable: ["Wells Fargo"], would_remove_book_accounts: 1 });
    expect(writes()).toEqual([]);
  });

  it("removes a closed account once every bank answers", async () => {
    wellsReachable = true;
    const out = await run();
    expect(out.body).toMatchObject({ pruned: true, removed_accounts: 1 });
    const w = writes().map((c) => `${c.method} ${c.url.split("?")[0]}`);
    expect(w).toEqual(["PATCH plaid_account_prefs", "DELETE plaid_account_state", "DELETE book_transactions"]);
  });
});
