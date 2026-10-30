import { beforeEach, describe, expect, it, vi } from "vitest";

// The Treasury report is the whole office's balances: it goes to staff only.
// A partner can't schedule it, and stale prefs on a user whose role became
// partner don't send it either.

vi.mock("../lib/books-loans.js", () => ({ computeLoans: async () => ({ loans: [] }) }));

import preferences from "../api/auth/preferences";
import cron from "../api/cron/treasury-report";

const DAILY = { treasuryReport: { frequency: "daily", recipients: ["friend@elsewhere.example"] } };
const PARTNER = { id: "p1", name: "Pat", email: "pat@outside.example", role: "partner", status: "approved", last_seen_at: new Date().toISOString() };
const STAFF = { id: "s1", name: "Sam", email: "sam@burtonfamilyoffice.com", role: "member", status: "approved" };

const emails: unknown[] = [];
let saved: unknown;
let stored: Record<string, unknown> = {};
let recipientQuery = "";

beforeEach(() => {
  emails.length = 0;
  saved = undefined;
  stored = {};
  process.env.SUPABASE_URL = "https://db.example";
  process.env.SUPABASE_SERVICE_KEY = "k";
  process.env.CRON_SECRET = "cron-secret";
  process.env.BIRD_ACCESS_KEY = "bk_us1_testtoken";
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = decodeURIComponent(String(url));
    const method = init.method ?? "GET";
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json", "content-range": "0-0/1" } });
    if (u.includes("bird.com/v1/email/messages")) {
      emails.push(JSON.parse(String(init.body)).to);
      return json({ id: "m1" });
    }
    if (u.includes("/api/plaid/data")) {
      if (u.includes("report=treasury")) {
        return json({
          connections: [{ institution_name: "Wells Fargo", status: "online" }],
          accounts: [{ item_id: "i", account_id: "a1", institution_name: "Wells Fargo", institution_color: null, name: "Operating", official_name: null, nickname: null, mask: "1886", type: "depository", subtype: "checking", entity_name: "Burton Holdings", balance_current: 1000, balance_available: 1000, balance_limit: null, currency: "USD", change: 10 }],
        });
      }
      return json({ transactions: [] });
    }
    const path = u.split("/rest/v1/")[1] ?? "";
    if (path.startsWith("app_sessions")) return json([{ user_id: "p1", expires_at: "2099-01-01" }]);
    if (path.startsWith("app_users?id=eq.p1") && method === "PATCH") {
      saved = JSON.parse(String(init.body)).notification_prefs;
      return json([{ notification_prefs: saved }]);
    }
    if (path.startsWith("app_users?id=eq.p1")) return json([{ ...PARTNER, notification_prefs: stored }]);
    if (path.startsWith("app_users?status=eq.approved")) {
      recipientQuery = path;
      // Even if a partner row came back, the cron must leave it out.
      return json([{ ...PARTNER, notification_prefs: DAILY }, { ...STAFF, notification_prefs: { treasuryReport: { frequency: "daily" } } }]);
    }
    if (path.startsWith("cron_runs") && method === "POST") return json([{ id: "r1" }]);
    return json([]);
  }) as typeof fetch;
});

function fakeRes() {
  const out: { status: number; body?: any } = { status: 200 };
  const res: any = {
    status: (s: number) => ((out.status = s), res),
    json: (b: unknown) => ((out.body = b), res),
    end: () => res,
    setHeader: () => res,
  };
  return { res, out };
}

describe("treasury report recipients", () => {
  it("a partner's saved prefs keep only phone notices", async () => {
    const { res, out } = fakeRes();
    await preferences(
      { method: "PUT", headers: { authorization: "Bearer 22222222-2222-2222-2222-222222222222" }, body: { preferences: { ...DAILY, push: { mail: false } } } } as any,
      res
    );
    expect(out.status).toBe(200);
    expect(saved).toEqual({ push: { mail: false } });
  });

  it("a partner's save that leaves out push keeps the push setting already stored", async () => {
    stored = { push: { mail: false } };
    const { res, out } = fakeRes();
    await preferences({ method: "PUT", headers: { authorization: "Bearer 22222222-2222-2222-2222-222222222222" }, body: { preferences: DAILY } } as any, res);
    expect(out.status).toBe(200);
    expect(saved).toEqual({ push: { mail: false } });
  });

  it("the daily cron emails staff only", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, out } = fakeRes();
    await cron({ method: "GET", headers: { authorization: "Bearer cron-secret" }, query: {} } as any, res);
    expect(out.status).toBe(200);
    expect(recipientQuery).toContain("role=in.(owner,admin,member,viewer)");
    expect(emails).toEqual([["sam@burtonfamilyoffice.com"]]);
  });
});
