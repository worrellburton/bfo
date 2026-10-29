import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler, { health } from "../api/health";
import { latestRuns } from "../api/ops";
import { alertAdmins } from "../lib/alert";
import { recordCronRun } from "../lib/cron";
import { log } from "../lib/log";

// Supabase over fetch (lib/auth.ts sb): every request lands here.
const calls: { url: string; method: string; body: any }[] = [];
let dbDown = false;
let recentAlerts: unknown[] = [];
const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
  const method = init.method ?? "GET";
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ url, method, body });
  if (dbDown) return new Response("boom", { status: 500 });
  if (url.includes("/rest/v1/ops_alerts?kind=")) return Response.json(recentAlerts);
  if (url.includes("/rest/v1/cron_runs") && method === "POST") return Response.json([{ id: "run-1" }]);
  if (url.includes("/rest/v1/app_users?select=id,role,status")) return Response.json([{ id: "u1", role: "owner", status: "approved", notification_prefs: null }]);
  return Response.json([]);
});

beforeEach(() => {
  calls.length = 0;
  dbDown = false;
  recentAlerts = [];
  process.env.SUPABASE_URL = "https://db.example";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of ["PLAID_CLIENT_ID", "PLAID_SECRET", "PALM_API_KEY", "BIRD_ACCESS_KEY", "BIRD_WORKSPACE_ID", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "VERCEL_GIT_COMMIT_SHA", "APNS_KEY_ID", "APNS_TEAM_ID", "APNS_KEY_P8"]) delete process.env[k];
});

function call(method = "GET") {
  const out: { status: number; json?: any; headers: Record<string, string> } = { status: 0, headers: {} };
  const res: any = {
    status(c: number) { out.status = c; return res; },
    json(j: unknown) { out.json = j; return res; },
    end() { return res; },
    setHeader(k: string, v: string) { out.headers[k] = v; },
  };
  return Promise.resolve(handler({ method, headers: {} } as any, res)).then(() => out);
}

describe("log", () => {
  it("prints one JSON line with the area, the fields and a time", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log.error("cron:x", "threw", { error: new Error("nope"), n: 2 });
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: "error", area: "cron:x", msg: "threw", error: "nope", n: 2 });
    expect(Date.parse(line.at)).toBeGreaterThan(0);
  });
});

describe("health", () => {
  it("reads the database once and reports which providers are configured, without calling them", async () => {
    process.env.PLAID_CLIENT_ID = "c";
    process.env.PLAID_SECRET = "s";
    process.env.ANTHROPIC_API_KEY = "k";
    process.env.VERCEL_GIT_COMMIT_SHA = "abcdef1234567890";
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.headers["Cache-Control"]).toContain("max-age=30");
    expect(r.json).toMatchObject({ ok: true, version: "abcdef123456", checks: { db: true, plaid: true, palm: false, bird: false, apns: false, openai: false, anthropic: true } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/rest/v1/app_users?select=id&limit=1");
  });

  it("is not ok when the database can't be read", async () => {
    dbDown = true;
    const r = await call();
    expect(r.status).toBe(503);
    expect(r.json.ok).toBe(false);
    expect(r.json.checks.db).toBe(false);
  });

  it("is not ok when the database isn't configured", async () => {
    delete process.env.SUPABASE_URL;
    expect((await health()).ok).toBe(false);
  });
});

describe("alertAdmins", () => {
  it("records the alert and tells the owners and admins", async () => {
    expect(await alertAdmins("cron:books-sync", "books-sync cron failed", new Error("Plaid 500"))).toBe("sent");
    const insert = calls.find((c) => c.method === "POST" && c.url.endsWith("/rest/v1/ops_alerts"));
    expect(insert?.body).toEqual({ kind: "cron:books-sync", title: "books-sync cron failed", detail: "Plaid 500" });
  });

  it("doesn't raise the same kind twice within the window", async () => {
    recentAlerts = [{ id: "a1" }];
    expect(await alertAdmins("cron:books-sync", "again", "x")).toBe("duplicate");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("never throws", async () => {
    dbDown = true;
    expect(await alertAdmins("webhook:mail", "t", "d")).toBe("failed");
    delete process.env.SUPABASE_URL;
    expect(await alertAdmins("webhook:mail", "t", "d")).toBe("failed");
  });
});

describe("recordCronRun", () => {
  const finish = () => calls.find((c) => c.method === "PATCH" && c.url.includes("/rest/v1/cron_runs?id=eq.run-1"))?.body;
  const alerted = () => calls.filter((c) => c.method === "POST" && c.url.endsWith("/rest/v1/ops_alerts")).map((c) => c.body);

  it("records a clean run and raises nothing", async () => {
    expect(await recordCronRun("stable", async (run) => (run.note("7 days"), 3))).toBe(3);
    expect(finish()).toMatchObject({ ok: true, note: "7 days" });
    expect(alerted()).toEqual([]);
  });

  it("records a partial failure and alerts once", async () => {
    await recordCronRun("books-sync", async (run) => {
      run.failed("Plaid sync failed for Chase: ITEM_LOGIN_REQUIRED");
      run.failed("Plaid sync failed for Amex: RATE_LIMIT");
    });
    expect(finish()).toMatchObject({ ok: false, note: "Plaid sync failed for Chase: ITEM_LOGIN_REQUIRED\nPlaid sync failed for Amex: RATE_LIMIT" });
    expect(alerted()).toHaveLength(1);
    expect(alerted()[0]).toMatchObject({ kind: "cron:books-sync", title: "books-sync cron didn't finish cleanly" });
  });

  it("records a crash, alerts, and rethrows", async () => {
    await expect(recordCronRun("treasury-report", async () => { throw new Error("no balances"); })).rejects.toThrow("no balances");
    expect(finish()).toMatchObject({ ok: false, note: "no balances" });
    expect(alerted()[0]).toMatchObject({ kind: "cron:treasury-report", title: "treasury-report cron failed", detail: "no balances" });
  });

  it("still runs the job when the run can't be recorded", async () => {
    dbDown = true;
    expect(await recordCronRun("stable", async () => "done")).toBe("done");
  });
});

describe("ops", () => {
  it("shows every scheduled cron, newest run first, including ones that never ran", () => {
    const rows = [
      { id: "2", name: "books-sync", started_at: "2026-10-27T12:00:00Z", finished_at: "2026-10-27T12:01:00Z", ok: true, note: null },
      { id: "1", name: "books-sync", started_at: "2026-10-26T12:00:00Z", finished_at: "2026-10-26T12:01:00Z", ok: false, note: "x" },
      { id: "3", name: "custom", started_at: "2026-10-27T13:00:00Z", finished_at: null, ok: null, note: null },
    ];
    const out = latestRuns(rows);
    expect(out.map((r) => r.name)).toEqual(["treasury-report", "books-sync", "stable", "state-records", "investment-history", "custom"]);
    expect(out[1]).toMatchObject({ id: "2", ok: true });
    expect(out[0]).toMatchObject({ started_at: null, ok: null });
  });
});
