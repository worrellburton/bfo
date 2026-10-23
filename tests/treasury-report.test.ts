import { describe, expect, it, vi } from "vitest";

let refuse: "partner" | "db" = "partner";

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    currentUser: async () => {
      if (refuse === "partner") throw new actual.PartnerRefused("Not available to entity owners.");
      throw new Error('supabase 500: {"message":"relation app_sessions does not exist"}');
    },
  };
});

import handler from "../api/cron/treasury-report";

function call() {
  const out: { status: number; json?: any } = { status: 0 };
  const res: any = {
    status: (c: number) => ((out.status = c), res),
    json: (j: unknown) => ((out.json = j), res),
    end: () => res,
    setHeader() {},
  };
  return Promise.resolve(handler({ method: "POST", body: {}, headers: {} } as any, res)).then(() => out);
}

describe("treasury report sample (POST)", () => {
  it("answers a partner 403, not a failed send", async () => {
    refuse = "partner";
    expect(await call()).toEqual({ status: 403, json: { error: "forbidden", message: "Not available to entity owners." } });
  });

  it("keeps database detail out of a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    refuse = "db";
    const r = await call();
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.json)).not.toMatch(/supabase|app_sessions/);
  });
});
