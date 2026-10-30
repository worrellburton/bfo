import { beforeEach, describe, expect, it, vi } from "vitest";

// Can texts reach BFO? The Phone page asks Bird (lib/sms-setup.ts): the mail
// webhook must carry sms.received, the number must take SMS, and a signed
// test text must be accepted. The fix only ever adds to the webhook. Beyond
// that: delivery receipts on the webhook (not blocking), whether the number
// may text the US, and texts that failed to arrive, replayed on BFO's own
// verified webhook only.

const calls: { path: string; method: string; body?: any }[] = [];
let hooks: any[] = [];
let numbers: any[] = [];
let test: any = { status: "delivered", response_status_code: 200, response_duration_ms: 90 };
let me: any = null;
let birdDown = false;
let refused = false;
let senders: any[] = [];
let attempts: any[] = [];
let replayStatus = 202;
const QUOTA = { error: { type: "rate_limit_error", name: "WebhookReplayQuotaExceeded", message: "quota", quota: { limit: 20 } } };
let replayError: unknown = QUOTA;

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    currentUser: async () => me,
    birdPlatformFetch: async (path: string, init: { method?: string; body?: any } = {}) => {
      const method = init.method ?? "GET";
      calls.push({ path, method, body: init.body });
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
      if (birdDown) return json({ error: "unavailable" }, 503);
      if (refused) return json({ error: { name: "InsufficientScope", message: `This request requires the "${path.startsWith("/v1/numbers") ? "numbers:read" : "webhooks:read"}" scope.` } }, 403);
      if (path.startsWith("/v1/webhooks?")) return json({ data: hooks, next_cursor: null });
      if (path.startsWith("/v1/numbers?")) return json({ data: numbers, next_cursor: null });
      if (path.startsWith("/v1/sms/senders?")) return json({ data: senders, next_cursor: null });
      if (/^\/v1\/webhooks\/[^/]+\/attempts\?/.test(path)) return json({ data: attempts, next_cursor: null, prev_cursor: null, refresh_cursor: null });
      if (/^\/v1\/webhooks\/[^/]+\/replay$/.test(path)) return replayStatus === 202 ? new Response(null, { status: 202 }) : json(replayError, replayStatus);
      if (/^\/v1\/webhooks\/[^/]+\/test$/.test(path)) return json(test);
      if (/^\/v1\/webhooks\/[^/]+$/.test(path) && method === "PATCH") {
        hooks = hooks.map((h) => (path.endsWith(h.id) ? { ...h, ...init.body } : h));
        return json(hooks[0]);
      }
      return json({}, 404);
    },
  };
});

import { diagnose, fixBody, mailHook, missedTexts, sendingReadiness, SMS_STATUS_EVENTS } from "../lib/sms-setup";
import handler from "../api/texts";

const NUMBER = "+18445192725";
const MAIL_ONLY = { id: "wh_1", url: "https://www.burtonfamilyoffice.com/api/mail-webhook", events: ["email.received"], status: "active" };
const TOLL_FREE = { id: "nda_1", number: NUMBER, number_type: "toll_free", capabilities: ["sms", "voice"], status: "active" };
/** Everything BFO's webhook should carry: mail, texts, and the receipts for texts BFO sends. */
const ALL = ["email.received", "sms.received", ...SMS_STATUS_EVENTS];
const SENDER = { id: "sms_sender_1", sender: NUMBER, status: "active", destinations: { active: ["US"], pending: [], needs_attention: [] }, next: [] };

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
  refused = false;
  senders = [SENDER];
  attempts = [];
  replayStatus = 202;
  replayError = QUOTA;
});

describe("diagnose", () => {
  it("finds the webhook that delivers mail, and says texts aren't in it", () => {
    const other = { id: "wh_0", url: "https://elsewhere.example/hook", events: ["sms.received"], status: "active" };
    expect(mailHook([other, MAIL_ONLY])?.id).toBe("wh_1");
    const d = diagnose([other, MAIL_ONLY], [TOLL_FREE], NUMBER);
    expect(d.ok).toBe(false);
    expect(d.problems.map((p) => [p.code, p.fixable, p.blocking])).toEqual([
      ["missing_event", true, true],
      ["missing_receipts", true, false],
    ]);
  });

  it("is happy when the webhook carries texts, the number takes SMS and the test was accepted", () => {
    const d = diagnose([{ ...MAIL_ONLY, events: ALL }], [{ ...TOLL_FREE, number: "18445192725" }], NUMBER, { wh_1: { status: "delivered", response_status_code: 200 } });
    expect(d).toMatchObject({ ok: true, problems: [], test: { delivered: true, code: 200 } });
  });

  it("calls texts fine without delivery receipts, but says they're missing and can be added", () => {
    const d = diagnose([{ ...MAIL_ONLY, events: ["email.received", "sms.received", "sms.delivered"] }], [TOLL_FREE], NUMBER, { wh_1: { status: "delivered", response_status_code: 200 } });
    expect(d.ok).toBe(true);
    expect(d.problems).toEqual([expect.objectContaining({ code: "missing_receipts", fixable: true, blocking: false })]);
    expect(d.problems[0].message).toMatch(/Sent but never Delivered/);
  });

  it("names each other way texts can't arrive", () => {
    const d = diagnose(
      [{ ...MAIL_ONLY, url: "https://burtonfamilyoffice.com/api/mail-webhook", events: ALL, status: "paused" }],
      [{ ...TOLL_FREE, capabilities: ["voice"] }],
      NUMBER,
      { wh_1: { status: "failed", response_status_code: 401 } }
    );
    expect(d.problems.map((p) => p.code)).toEqual(["wrong_host", "paused", "test_failed", "no_sms"]);
    expect(d.problems.find((p) => p.code === "test_failed")?.message).toMatch(/BIRD_WEBHOOK_SECRET/);
    expect(diagnose([], [], NUMBER).problems.map((p) => [p.code, p.fixable])).toEqual([["no_webhook", false], ["no_number", false]]);
  });

  it("never takes another site's webhook in the same Bird workspace for BFO's, nor changes it", () => {
    const impact = { id: "wh_9", url: "https://www.impactadvisory.llc/api/mail-webhook", events: ["email.received", "sms.received"], status: "active" };
    expect(mailHook([impact])).toBeNull();
    expect(fixBody(impact)).toBeNull();
    const d = diagnose([impact], [TOLL_FREE], NUMBER);
    expect(d.problems.map((p) => [p.code, p.fixable])).toEqual([["no_webhook", false]]);
    expect(d.problems[0].message).toMatch(/Create webhook.*BIRD_WEBHOOK_SECRET.*Leave other sites' webhooks/);
  });

  it("with two webhooks pointing at BFO, takes the one BFO's secret verifies, and flags the other", () => {
    const mine = { id: "wh_new", url: "https://www.burtonfamilyoffice.com/api/mail-webhook", events: ALL, status: "active" };
    const repointed = { id: "wh_old", url: "https://www.burtonfamilyoffice.com/api/mail-webhook", events: ALL, status: "active" };
    const d = diagnose([repointed, mine], [TOLL_FREE], NUMBER, { wh_old: { status: "failed", response_status_code: 401 }, wh_new: { status: "delivered", response_status_code: 200 } });
    expect(d.webhook?.id).toBe("wh_new");
    expect(d.problems.map((p) => p.code)).toEqual(["other_hook"]);
    const neither = diagnose([repointed, mine], [TOLL_FREE], NUMBER, { wh_old: { status: "failed", response_status_code: 401 }, wh_new: { status: "failed", response_status_code: 401 } });
    expect(neither.problems[0].message).toMatch(/2 webhooks in Bird point at BFO.*matches none/);
  });

  it("fixes by adding to the webhook, never by taking away", () => {
    expect(fixBody(MAIL_ONLY)).toEqual({ events: ALL });
    expect(fixBody({ ...MAIL_ONLY, url: "https://burtonfamilyoffice.com/api/mail-webhook", status: "paused" })).toEqual({
      events: ALL,
      url: "https://www.burtonfamilyoffice.com/api/mail-webhook",
      status: "active",
    });
    // Texts already on: only the missing receipts are added, after what's there.
    expect(fixBody({ ...MAIL_ONLY, events: ["email.received", "sms.received", "sms.delivered", "custom.event"] })).toEqual({
      events: ["email.received", "sms.received", "sms.delivered", "custom.event", "sms.sent", "sms.undelivered", "sms.failed", "sms.rejected", "sms.expired"],
    });
    expect(fixBody({ ...MAIL_ONLY, events: ALL })).toBeNull();
  });
});

describe("when Bird's key lacks a permission", () => {
  it("reads the permission Bird names", async () => {
    const { scopeIn } = await import("../lib/sms-setup");
    expect(scopeIn('{"error":{"name":"InsufficientScope","message":"This request requires the \\"numbers:read\\" scope, which your credential has not been granted."}}')).toBe("numbers:read");
    expect(scopeIn("nope")).toBeNull();
  });
  it("still checks the webhook when the number can't be looked up, and says so", () => {
    const d = diagnose([{ ...MAIL_ONLY, events: ALL }], { unreadable: true, status: 403, scope: "numbers:read" }, NUMBER, { wh_1: { status: "delivered", response_status_code: 200 } });
    expect(d.ok).toBe(true);
    expect(d.notes[0]).toMatch(/numbers:read/);
  });
  it("can't call it fine without seeing the webhook, and says how to fix it by hand", () => {
    const d = diagnose({ unreadable: true, status: 403, scope: "webhooks:read" }, [TOLL_FREE], NUMBER);
    expect(d.ok).toBe(false);
    expect(d.problems[0]).toMatchObject({ code: "cant_read_webhooks", fixable: false });
    expect(d.problems[0].message).toMatch(/webhooks:read.*tick sms\.received/);
  });
});

describe("/api/texts setup", () => {
  it("asks Bird and sends a signed test text", async () => {
    const out = await call("GET", { view: "setup" });
    expect(out.status).toBe(200);
    expect(out.json.setup.problems.map((p: any) => p.code)).toEqual(["missing_event", "missing_receipts"]);
    expect(calls.find((c) => c.path === "/v1/webhooks/wh_1/test")?.body).toEqual({ event_type: "sms.received" });
    expect(calls.find((c) => c.path.startsWith("/v1/numbers?"))?.path).toContain("number=%2B18445192725");
  });

  it("leaves another site's webhook untouched when asked to fix", async () => {
    hooks = [{ id: "wh_9", url: "https://www.impactadvisory.llc/api/mail-webhook", events: ["email.received"], status: "active" }];
    const out = await call("POST", {}, { action: "fix-setup" });
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
    expect(out.json.setup.problems[0].code).toBe("no_webhook");
  });

  it("fixes the webhook, keeping its mail event, then checks again", async () => {
    const out = await call("POST", {}, { action: "fix-setup" });
    expect(calls.filter((c) => c.method === "PATCH")).toEqual([{ path: "/v1/webhooks/wh_1", method: "PATCH", body: { events: ALL } }]);
    expect(out.json.setup).toMatchObject({ ok: true, problems: [] });
  });

  it("says plainly when Bird can't be asked", async () => {
    birdDown = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await call("GET", { view: "setup" });
    expect(out.status).toBe(200);
    expect(out.json.setup).toBeNull();
    expect(out.json.error).toMatch(/^Bird \/v1\/webhooks 503/);
  });

  it("names the permission Bird's key is missing instead of failing", async () => {
    refused = true;
    const out = await call("GET", { view: "setup" });
    expect(out.json.setup.problems.map((p: any) => p.code)).toEqual(["cant_read_webhooks"]);
    expect(out.json.setup.notes[0]).toMatch(/numbers:read/);
  });

  it("is for owners and admins only", async () => {
    me = { ...me, role: "member" };
    expect((await call("GET", { view: "setup" })).status).toBe(403);
    expect((await call("POST", {}, { action: "fix-setup" })).status).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe("can BFO's number text out", () => {
  it("is ready when the US is among the sender's active destinations", () => {
    expect(sendingReadiness([SENDER], NUMBER)).toMatchObject({ ready: true, state: "ready" });
  });
  it("says plainly when the toll-free verification is under review, refused, or the number's ownership isn't settled", () => {
    const pending = sendingReadiness([{ ...SENDER, status: "pending_registrations", destinations: { active: [], pending: ["US"], needs_attention: [] } }], NUMBER);
    expect(pending).toMatchObject({ ready: false, state: "pending" });
    expect(pending.message).toMatch(/toll-free verification is under review/);
    const refused = sendingReadiness([{ ...SENDER, destinations: { active: [], pending: [], needs_attention: ["US"] }, next: [{ kind: "external", description: "Resubmit the verification with an opt-in screenshot." }] }], NUMBER);
    expect(refused).toMatchObject({ ready: false, state: "needs_attention" });
    expect(refused.message).toMatch(/refused.*Bird says: Resubmit the verification/);
    expect(sendingReadiness([{ ...SENDER, status: "pending_number_ownership", destinations: { active: [], pending: [], needs_attention: ["US"] } }], NUMBER)).toMatchObject({ state: "ownership" });
    expect(sendingReadiness([{ ...SENDER, destinations: { active: ["CA"], pending: [], needs_attention: [] } }], NUMBER).message).toMatch(/submit the toll-free verification/);
    expect(sendingReadiness([], NUMBER)).toMatchObject({ ready: false, state: "unknown" });
  });
  it("looks up the sender by the number's id, and names a refused permission as a note", async () => {
    hooks = [{ ...MAIL_ONLY, events: ALL }];
    const out = await call("GET", { view: "setup" });
    expect(calls.find((c) => c.path.startsWith("/v1/sms/senders?"))?.path).toContain("number_id=nda_1");
    expect(out.json.setup).toMatchObject({ ok: true, sending: { ready: true }, missed: 0 });
    const d = diagnose([{ ...MAIL_ONLY, events: ALL }], [TOLL_FREE], NUMBER, { wh_1: { status: "delivered", response_status_code: 200 } }, { senders: { unreadable: true, status: 403, scope: "sms:read" } });
    expect(d).toMatchObject({ ok: true, sending: null });
    expect(d.notes[0]).toMatch(/Sending wasn't checked.*"sms:read"/);
  });
});

describe("missed texts", () => {
  const at = "2026-10-30T10:00:00Z";
  it("counts texts whose delivery failed and never got through, once each", () => {
    expect(
      missedTexts([
        { id: "a1", event_id: "ev_1", event_type: "sms.received", status: "failed", attempted_at: at },
        { id: "a2", event_id: "ev_1", event_type: "sms.received", status: "failed", attempted_at: at },
        { id: "a3", event_id: "ev_2", event_type: "sms.received", status: "failed", attempted_at: at },
        { id: "a4", event_id: "ev_2", event_type: "sms.received", status: "delivered", attempted_at: at },
        { id: "a5", event_id: "ev_3", event_type: "email.received", status: "failed", attempted_at: at },
        { id: "a6", event_id: null, event_type: "sms.received", status: "failed", attempted_at: at },
        { id: "a7", event_id: "ev_4", event_type: "sms.received", status: "pending", attempted_at: at },
      ])
    ).toBe(2);
  });
  it("reads attempts only for the webhook BFO's own secret verifies, over the last day", async () => {
    const impact = { id: "wh_9", url: "https://www.impactadvisory.llc/api/mail-webhook", events: ALL, status: "active" };
    hooks = [impact, { ...MAIL_ONLY, events: ALL }];
    attempts = [{ id: "a1", event_id: "ev_1", event_type: "sms.received", status: "failed", attempted_at: "2026-10-30T10:00:00Z" }];
    const out = await call("GET", { view: "setup" });
    const asked = calls.filter((c) => c.path.includes("/attempts"));
    expect(asked.map((c) => c.path.split("?")[0])).toEqual(["/v1/webhooks/wh_1/attempts"]);
    const after = new URLSearchParams(asked[0].path.split("?")[1]).get("after")!;
    expect(Date.now() - Date.parse(after)).toBeGreaterThan(23.9 * 3600_000);
    expect(out.json.setup.missed).toBe(1);
  });
  it("doesn't count anything when no webhook passed BFO's signed test", async () => {
    hooks = [{ ...MAIL_ONLY, events: ALL }];
    test = { status: "failed", response_status_code: 401 };
    const out = await call("GET", { view: "setup" });
    expect(calls.some((c) => c.path.includes("/attempts"))).toBe(false);
    expect(out.json.setup.missed).toBeNull();
  });
});

describe("/api/texts replay", () => {
  it("replays the last day on BFO's verified webhook only, then checks again", async () => {
    const impact = { id: "wh_9", url: "https://www.impactadvisory.llc/api/mail-webhook", events: ALL, status: "active" };
    hooks = [impact, { ...MAIL_ONLY, events: ALL }];
    const out = await call("POST", {}, { action: "replay" });
    const replays = calls.filter((c) => c.path.endsWith("/replay"));
    expect(replays.map((c) => [c.path, c.method])).toEqual([["/v1/webhooks/wh_1/replay", "POST"]]);
    expect(Date.parse(replays[0].body.until) - Date.parse(replays[0].body.since)).toBe(24 * 3600_000);
    expect(out.json.setup).toMatchObject({ replayed: true, ok: true });
    expect(calls.filter((c) => c.path.startsWith("/v1/webhooks/wh_9")).map((c) => c.path)).toEqual([]);
  });
  it("never replays a webhook BFO's secret doesn't verify (another site's, re-pointed here)", async () => {
    hooks = [{ ...MAIL_ONLY, events: ALL }];
    test = { status: "failed", response_status_code: 401 };
    const out = await call("POST", {}, { action: "replay" });
    expect(calls.some((c) => c.path.endsWith("/replay"))).toBe(false);
    expect(out.json.setup.replayed).toBeUndefined();
  });
  it("says so when Bird's daily replays are used up", async () => {
    hooks = [{ ...MAIL_ONLY, events: ALL }];
    replayStatus = 429;
    const out = await call("POST", {}, { action: "replay" });
    expect(out.json.setup.replayed).toBeUndefined();
    expect(out.json.setup.notes[0]).toMatch(/replays a day.*Try again tomorrow/);
  });
  it("tells an ordinary rate limit apart from the daily cap", async () => {
    hooks = [{ ...MAIL_ONLY, events: ALL }];
    replayStatus = 429;
    replayError = { error: { type: "rate_limit_error", code: "E01002", name: "RateLimited", message: "Slow down." } };
    const out = await call("POST", {}, { action: "replay" });
    expect(out.json.setup.notes[0]).toMatch(/Try again in a minute/);
    expect(out.json.setup.notes[0]).not.toMatch(/tomorrow/);
  });
  it("doesn't spend a replay on a paused webhook, which redelivers nothing", async () => {
    hooks = [{ ...MAIL_ONLY, events: ALL, status: "paused" }];
    const out = await call("POST", {}, { action: "replay" });
    expect(calls.some((c) => c.path.endsWith("/replay"))).toBe(false);
    expect(out.json.setup.replayed).toBeUndefined();
    expect(out.json.setup.notes[0]).toMatch(/paused/);
  });
  it("is for owners and admins only", async () => {
    me = { ...me, role: "member" };
    expect((await call("POST", {}, { action: "replay" })).status).toBe(403);
    expect(calls).toEqual([]);
  });
});
