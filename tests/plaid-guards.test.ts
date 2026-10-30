import { describe, expect, it, vi } from "vitest";

// currentUser refuses a partner by throwing; every Plaid endpoint must turn
// that into a 403, not let it escape as a crashed function (a 500).
vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    currentUser: async () => {
      throw new actual.PartnerRefused("Not available to entity owners.");
    },
  };
});

import data from "../api/plaid/data";
import accountPrefs from "../api/plaid/account-prefs";
import disconnect from "../api/plaid/disconnect";
import createLinkToken from "../api/plaid/create-link-token";
import exchangeToken from "../api/plaid/exchange-token";
import pruneAccounts from "../api/plaid/prune-accounts";
import resetCursor from "../api/plaid/reset-cursor";

type Handler = (req: any, res: any) => unknown;

async function call(handler: Handler, method: string) {
  const out: { status: number; json?: unknown } = { status: 0 };
  const res: any = {
    status: (c: number) => ((out.status = c), res),
    json: (j: unknown) => ((out.json = j), res),
    end: () => res,
    setHeader() {},
  };
  await handler({ method, body: {}, query: { report: "treasury", item_id: "x" }, headers: {} }, res);
  return out;
}

describe("Plaid endpoints refuse a partner with 403", () => {
  const cases: Array<[string, Handler, string]> = [
    ["data", data, "GET"],
    ["account-prefs", accountPrefs, "POST"],
    ["disconnect", disconnect, "POST"],
    ["create-link-token", createLinkToken, "POST"],
    ["exchange-token", exchangeToken, "POST"],
    ["prune-accounts", pruneAccounts, "POST"],
    ["reset-cursor", resetCursor, "POST"],
  ];
  for (const [name, handler, method] of cases) {
    it(name, async () => {
      expect(await call(handler, method)).toEqual({
        status: 403,
        json: { error: "forbidden", message: "Not available to entity owners." },
      });
    });
  }
});
