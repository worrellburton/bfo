import { beforeEach, describe, expect, it, vi } from "vitest";

// Can texts reach BFO? The Phone page asks Bird (lib/sms-setup.ts): the mail
// webhook must carry sms.received, the number must take SMS, and a signed
// test text must be accepted. The fix only ever adds to the webhook.

const calls: { path: string; method: string; body?: any }[] = [];
let hooks: any[] = [];
let numbers: any[] = [];
let test: any = { status: "delivered", response_status_code: 200, response_duration_ms: 90 };
let me: any = null;
let birdDown = false;

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    currentUser: async () => me,
    birdPlatformFetch: async (path: string, init: { method?: string; body?: any } = {}) => {
      const method = init.method ?? "GET";
      calls.push({ path, method, body: init.body });
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
      if (birdDown) return json({ error: "unauthorized" }, 401);
      if (path.startsWith("/v1/webhooks?")) return json({ data: hooks, next_cursor: null });
      if (path.startsWith("/v1/numbers?")) return json({ data: numbers, next_cursor: null });
      if (/^\/v1\/webhooks\/[^/]+\/test$/.test(path)) return json(test);
      if (/^\/v1\/webhooks\/[^/]+$/.test(path) && method === "PATCH") {
        hooks = hooks.map((h) => (path.endsWith(h.id) ? { ...h, ...init.body } : h));
        return json(hooks[0]);
      }
      return json({}, 404);
    },
  };
});

import { diagnose, fixBody, mailHook } from "../lib/sms-setup";
import handler from "../api/texts";

const NUMBER = "+18445192725";
const MAIL_ONLY = { id: "wh_1", url: "https://www.burtonfamilyoffice.com/api/mail-webhook", events: ["email.received"], status: "active" };
const TOLL_FREE = { id: "nda_1", number: NUMBER, number_type: "toll_free", capabilities: ["sms", "voice"], status: "active" };

function call(method: string, query: Record<string, string> = {}, body?: unknown) {
  const out: { status: number; json?: any } = { status: 0 };
  const res: any = { status: (c: number) => ((out.status = c), res), json: (j: unknown) => ((out.json = j), res) };
  return Promise.resolve(handler({ method, query, body, headers: {} } as any, res)).then(() => out);
}

beforeEach(() => {
  calls.length = 0;
  hooks = [MAIL_ONLY];
  numbers = [TOLL_FREE];
  test = { status: "delivered", response_status_code: 200, response_duration_ms: 90 };
  me = { id: "u1", name: "Robert", role: "owner", status: "approved" };
  birdDown = false;
});

describe("diagnose", () => {
  it("finds the webhook that delivers mail, and says texts aren't in it", () => {
    const other = { id: "wh_0", url: "https://elsewhere.example/hook", events: ["sms.received"], status: "active" };
    expect(mailHook([other, MAIL_ONLY])?.id).toBe("wh_1");
    const d = diagnose([other, MAIL_ONLY], [TOLL_FREE], NUMBER);
    expect(d.ok).toBe(false);
    expect(d.problems.map((p) => [p.code, p.fixable])).toEqual([["missing_event", true]]);
  });

  it("is happy when the webhook carries texts, the number takes SMS and the test was accepted", () => {
    const d = diagnose([{ ...MAIL_ONLY, events: ["email.received", "sms.received"] }], [{ ...TOLL_FREE, number: "18445192725" }], NUMBER, { status: "delivered", response_status_code: 200 });
    expect(d).toMatchObject({ ok: true, problems: [], test: { delivered: true, code: 200 } });
  });

  it("names each other way texts can't arrive", () => {
    const d = diagnose(
      [{ ...MAIL_ONLY, url: "https://burtonfamilyoffice.com/api/mail-webhook", events: ["email.received", "sms.received"], status: "paused" }],
      [{ ...TOLL_FREE, capabilities: ["voice"] }],
      NUMBER,
      { status: "failed", response_status_code: 401 }
    );
    expect(d.problems.map((p) => p.code)).toEqual(["wrong_host", "paused", "test_failed", "no_sms"]);
    expect(d.problems.find((p) => p.code === "test_failed")?.message).toMatch(/BIRD_WEBHOOK_SECRET/);
    expect(diagnose([], [], NUMBER).problems.map((p) => [p.code, p.fixable])).toEqual([["no_webhook", false], ["no_number", false]]);
  });

  it("fixes by adding to the webhook, never by taking away", () => {
    expect(fixBody(MAIL_ONLY)).toEqual({ events: ["email.received", "sms.received"] });
    expect(fixBody({ ...MAIL_ONLY, url: "https://burtonfamilyoffice.com/api/mail-webhook", status: "paused" })).toEqual({
      events: ["email.received", "sms.received"],
      url: "https://www.burtonfamilyoffice.com/api/mail-webhook",
      status: "active",
    });
    expect(fixBody({ ...MAIL_ONLY, events: ["email.received", "sms.received"] })).toBeNull();
  });
});

describe("/api/texts setup", () => {
  it("asks Bird and sends a signed test text", async () => {
    const out = await call("GET", { view: "setup" });
    expect(out.status).toBe(200);
    expect(out.json.setup.problems.map((p: any) => p.code)).toEqual(["missing_event"]);
    expect(calls.find((c) => c.path === "/v1/webhooks/wh_1/test")?.body).toEqual({ event_type: "sms.received" });
    expect(calls.find((c) => c.path.startsWith("/v1/numbers?"))?.path).toContain("number=%2B18445192725");
  });

  it("fixes the webhook, keeping its mail event, then checks again", async () => {
    const out = await call("POST", {}, { action: "fix-setup" });
    expect(calls.filter((c) => c.method === "PATCH")).toEqual([{ path: "/v1/webhooks/wh_1", method: "PATCH", body: { events: ["email.received", "sms.received"] } }]);
    expect(out.json.setup).toMatchObject({ ok: true, problems: [] });
  });

  it("says plainly when Bird can't be asked", async () => {
    birdDown = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await call("GET", { view: "setup" });
    expect(out.status).toBe(200);
    expect(out.json.setup).toBeNull();
    expect(out.json.error).toMatch(/^Bird \/v1\/webhooks 401/);
  });

  it("is for owners and admins only", async () => {
    me = { ...me, role: "member" };
    expect((await call("GET", { view: "setup" })).status).toBe(403);
    expect((await call("POST", {}, { action: "fix-setup" })).status).toBe(403);
    expect(calls).toEqual([]);
  });
});
