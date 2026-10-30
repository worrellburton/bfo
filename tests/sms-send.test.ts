import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Texting back from BFO's number (lib/sms-send.ts, lib/sms-compose.ts): the
// number as typed, the segment counter, Bird's refusals in a plain sentence,
// the send through /api/texts, and delivery receipts at /api/mail-webhook,
// which re-read the message from Bird and never move a final status back.

const db: { path: string; init?: any }[] = [];
const bird: { path: string; method: string; body?: any; headers?: Record<string, string> }[] = [];
let rows: any[] = [];
let sendAnswer: { status: number; body: unknown } = { status: 202, body: {} };
let lookup: { status: number; body: unknown } = { status: 200, body: {} };
let me: any = null;

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    currentUser: async () => me,
    sb: async (path: string, init?: any) => {
      db.push({ path, init });
      if (path.startsWith("sms_messages?id=eq.") && !init?.method) return rows;
      return null;
    },
    birdPlatformFetch: async (path: string, init: { method?: string; body?: any; headers?: Record<string, string> } = {}) => {
      bird.push({ path, method: init.method ?? "GET", body: init.body, headers: init.headers });
      const json = (a: { status: number; body: unknown }) => new Response(JSON.stringify(a.body), { status: a.status });
      if (path === "/v1/sms/messages" && init.method === "POST") return json(sendAnswer);
      if (path.startsWith("/v1/sms/messages/")) return json(lookup);
      return json({ status: 404, body: {} });
    },
  };
});
vi.mock("../lib/mail.js", () => ({ getInbound: vi.fn(), ingestInbound: vi.fn() }));
vi.mock("../lib/push.js", () => ({ notifyNewTexts: vi.fn(), notifyAdmins: vi.fn() }));

import { canTextBack, numberKey, smsSegments, toE164 } from "../lib/sms-compose";
import { failureSentence, nextStatus, refusalSentence } from "../lib/sms-send";
import { webhookSignature } from "../lib/mail-webhook";
import texts from "../api/texts";
import webhook from "../api/mail-webhook";

const OURS = "+18445192725";

beforeEach(() => {
  db.length = 0;
  bird.length = 0;
  rows = [];
  me = { id: "u1", name: "Robert", role: "owner", status: "approved" };
  sendAnswer = { status: 202, body: { id: "sms_01out", direction: "outbound", status: "accepted", to: "+14805551234", from: OURS, created_at: "2026-10-30T16:00:00Z" } };
  lookup = { status: 200, body: {} };
  delete process.env.BIRD_SMS_FROM;
});

describe("a number as typed", () => {
  it("takes a US number written any common way", () => {
    for (const typed of ["(480) 555-1234", "480-555-1234", "480.555.1234", "4805551234", "1 480 555 1234", "+1 (480) 555-1234", "+14805551234", " tel:+1-480-555-1234 ", "480 555 1234"]) {
      expect(toE164(typed, OURS)).toEqual({ ok: true, e164: "+14805551234" });
    }
  });
  it("keeps an international number written with + or 011", () => {
    expect(toE164("+44 7700 900123", OURS)).toEqual({ ok: true, e164: "+447700900123" });
    expect(toE164("011 44 7700 900123", OURS)).toEqual({ ok: true, e164: "+447700900123" });
  });
  it("refuses short codes, names, half numbers, impossible area codes and BFO's own number, each with a reason", () => {
    expect(toE164("72975", OURS)).toMatchObject({ ok: false, why: expect.stringMatching(/short code/) });
    expect(toE164("CHASE", OURS)).toMatchObject({ ok: false, why: expect.stringMatching(/not a name/) });
    expect(toE164("555-1234", OURS)).toMatchObject({ ok: false, why: expect.stringMatching(/area code/) });
    expect(toE164("(180) 555-1234", OURS)).toMatchObject({ ok: false });
    expect(toE164("480 155 1234", OURS)).toMatchObject({ ok: false });
    expect(toE164("", OURS)).toMatchObject({ ok: false, why: "Enter a phone number." });
    expect(toE164("480-555-1234 ext 2", OURS)).toMatchObject({ ok: false });
    expect(toE164("(844) 519-2725", OURS)).toMatchObject({ ok: false, why: "That's BFO's own number." });
    expect(toE164("+1 (844) 519-2725", "18445192725")).toMatchObject({ ok: false, why: "That's BFO's own number." });
  });
  it("knows who can be texted back, and matches a conversation however the number is written", () => {
    expect(canTextBack("+14805551234")).toBe(true);
    expect(canTextBack("72975")).toBe(false);
    expect(canTextBack("CHASE")).toBe(false);
    expect(numberKey("+14805551234")).toBe(numberKey("(480) 555-1234"));
    expect(numberKey("72975")).toBe("72975");
  });
});

describe("segments", () => {
  it("fits 160 plain characters in one text and splits longer ones 153 a part", () => {
    expect(smsSegments("a".repeat(160))).toMatchObject({ encoding: "GSM_7BIT", segments: 1, remaining: 0 });
    expect(smsSegments("a".repeat(161))).toMatchObject({ segments: 2, remaining: 153 * 2 - 161 });
    expect(smsSegments("a".repeat(306))).toMatchObject({ segments: 2, remaining: 0 });
    expect(smsSegments("a".repeat(307)).segments).toBe(3);
  });
  it("counts GSM's two-unit characters twice, and never splits one", () => {
    expect(smsSegments("€".repeat(80))).toMatchObject({ encoding: "GSM_7BIT", segments: 1, units: 160 });
    expect(smsSegments("€".repeat(81)).segments).toBe(2);
    // 152 plain then a two-unit character: it moves whole to the second part.
    expect(smsSegments(`${"a".repeat(152)}€${"a".repeat(10)}`)).toMatchObject({ segments: 2, remaining: 153 - 12 });
  });
  it("goes to UCS-2 for an emoji or a curly quote: 70 in one, 67 a part, an emoji costing two", () => {
    expect(smsSegments("It’s here")).toMatchObject({ encoding: "UCS2", segments: 1, remaining: 61 });
    expect(smsSegments("é".repeat(70))).toMatchObject({ encoding: "GSM_7BIT" });
    expect(smsSegments("ç".repeat(70))).toMatchObject({ encoding: "UCS2", segments: 1 });
    expect(smsSegments("ç".repeat(71))).toMatchObject({ segments: 2 });
    expect(smsSegments("😀".repeat(35))).toMatchObject({ segments: 1, units: 70 });
    expect(smsSegments("😀".repeat(36)).segments).toBe(2);
  });
});

describe("Bird's refusals, in plain words", () => {
  const err = (name: string, message: string, type = "precondition_error") => JSON.stringify({ error: { type, code: "E07001", name, message, doc_url: "x", request_id: "r" } });
  it("names each refusal Bird documents for a send, by its name and never its message", () => {
    // A `from` the workspace doesn't hold: BIRD_SMS_FROM, not the toll-free verification (its name has "sender" in it).
    expect(refusalSentence(422, err("SMSSenderNotConfigured", "Sender is not registered for toll-free."))).toMatch(/isn't a sender in this Bird workspace.*BIRD_SMS_FROM/);
    expect(refusalSentence(422, err("SMSSenderNotConfigured", "x"))).not.toMatch(/toll-free/);
    expect(refusalSentence(422, err("SenderCategoryNotPermitted", "x"))).toMatch(/toll-free verification/);
    expect(refusalSentence(422, err("SMSInvalidRecipient", "x", "validation_error"))).toMatch(/isn't a valid phone number/);
    expect(refusalSentence(422, JSON.stringify({ error: { type: "validation_error", name: "ValidationFailed", message: "Invalid field values.", param: "to" } }))).toMatch(/isn't a valid phone number/);
    expect(refusalSentence(422, JSON.stringify({ error: { type: "validation_error", name: "ValidationFailed", message: "x", details: [{ param: "to", message: "bad" }] } }))).toMatch(/valid phone number/);
    expect(refusalSentence(402, err("InsufficientBalance", "x", "billing_error"))).toMatch(/balance is too low/);
    expect(refusalSentence(429, err("RateLimited", "x", "rate_limit_error"))).toMatch(/Wait a minute/);
    expect(refusalSentence(403, err("InsufficientScope", 'This request requires the "sms:write" scope.', "permission_error"))).toMatch(/"sms:write"/);
    expect(refusalSentence(503, err("IdempotencyUnavailable", "x", "service_unavailable_error"))).toMatch(/Try again in a minute/);
    expect(refusalSentence(503, "upstream down")).toMatch(/Try again in a minute/);
    expect(refusalSentence(409, JSON.stringify({ error: { type: "conflict_error", code: "E01004", name: "request_in_progress", message: "x" } }))).toMatch(/still sending/);
    // A message that reads like a known case isn't classified by it.
    expect(refusalSentence(422, err("SMSUnsupportedFeature", "recipient opted out; invalid phone number; toll-free"))).toMatch(/^Bird didn't send it \(HTTP 422/);
    expect(refusalSentence(422, JSON.stringify({ error: { name: "Weird", message: "Something else.", remediation: "Do the thing." } }))).toBe("Bird didn't send it (HTTP 422: Do the thing.).");
    expect(refusalSentence(422, err("Weird", "Something else."))).toBe("Bird didn't send it (HTTP 422: Something else.).");
  });
  it("says why a sent text wasn't delivered", () => {
    expect(failureSentence({ code: "landline_unreachable", description: "Landline" }, "failed")).toMatch(/landline/);
    expect(failureSentence({ code: "carrier_new_thing", description: "Carrier filtered as spam" }, "undelivered")).toBe("Carrier filtered as spam");
    expect(failureSentence(null, "expired")).toMatch(/in time/);
    expect(failureSentence(null, "delivered")).toBeNull();
  });
});

describe("status order", () => {
  it("moves forward and never back from a final status", () => {
    expect(nextStatus("accepted", "sent")).toBe("sent");
    expect(nextStatus("sent", "delivered")).toBe("delivered");
    expect(nextStatus(null, "failed")).toBe("failed");
    expect(nextStatus("delivered", "sent")).toBeNull();
    expect(nextStatus("delivered", "failed")).toBeNull();
    expect(nextStatus("failed", "delivered")).toBeNull();
    expect(nextStatus("sent", "accepted")).toBeNull();
    expect(nextStatus("sent", "sent")).toBeNull();
  });
});

function callTexts(method: string, body?: unknown) {
  const out: { status: number; json?: any } = { status: 0 };
  const res: any = { status: (c: number) => ((out.status = c), res), json: (j: unknown) => ((out.json = j), res) };
  return Promise.resolve(texts({ method, query: {}, body, headers: {} } as any, res)).then(() => out);
}

describe("/api/texts send", () => {
  it("sends from BFO's number as a service text and keeps it as an outbound row", async () => {
    const out = await callTexts("POST", { action: "send", to: "(480) 555-1234", text: "  On my way.  ", key: "0b5c7c1e-6f7d-4c55-9d7b-1f0a2b3c4d5e" });
    expect(out.status).toBe(200);
    expect(bird).toEqual([
      { path: "/v1/sms/messages", method: "POST", body: { to: "+14805551234", from: OURS, text: "On my way.", category: "service" }, headers: { "Idempotency-Key": "0b5c7c1e-6f7d-4c55-9d7b-1f0a2b3c4d5e" } },
    ]);
    const stored = db.find((c) => c.path === "sms_messages?on_conflict=id");
    expect(stored?.init.body).toMatchObject({
      id: "sms_01out",
      direction: "out",
      from_number: OURS,
      to_number: "+14805551234",
      body: "On my way.",
      received_at: "2026-10-30T16:00:00.000Z",
      sent_by: "u1",
      read_by: "u1",
      status: "accepted",
    });
    expect(stored?.init.body.read_at).toBeTruthy();
    expect(out.json.text).toMatchObject({ id: "sms_01out", direction: "out", to: "+14805551234", status: "accepted", body: "On my way." });
  });

  it("refuses before asking Bird: a bad number, an empty text, one too long", async () => {
    expect(await callTexts("POST", { action: "send", to: "72975", text: "hi" })).toMatchObject({ status: 400, json: { error: "bad_number", message: expect.stringMatching(/short code/) } });
    expect(await callTexts("POST", { action: "send", to: "4805551234", text: "   " })).toMatchObject({ status: 400, json: { error: "empty" } });
    expect(await callTexts("POST", { action: "send", to: "4805551234", text: "a".repeat(1601) })).toMatchObject({ status: 400, json: { error: "too_long" } });
    expect(await callTexts("POST", { action: "send", to: "4805551234", text: "😀".repeat(500) })).toMatchObject({ status: 400, json: { error: "too_long", message: expect.stringMatching(/12 parts/) } });
    expect(await callTexts("POST", { action: "send", to: "8445192725", text: "hi" })).toMatchObject({ status: 400, json: { message: "That's BFO's own number." } });
    expect(await callTexts("POST", { action: "send", text: "hi" })).toMatchObject({ status: 400 });
    expect(bird).toEqual([]);
    expect(db).toEqual([]);
  });

  it("answers Bird's refusal with one plain sentence and keeps nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    sendAnswer = { status: 422, body: { error: { type: "validation_error", code: "E00002", name: "ValidationFailed", message: "to +14805551234 is not valid", param: "to", details: [{ param: "to", message: "+14805551234" }], doc_url: "x", request_id: "r" } } };
    const out = await callTexts("POST", { action: "send", to: "4805551234", text: "hi" });
    expect(out).toMatchObject({ status: 422, json: { error: "bird_refused", message: expect.stringMatching(/valid phone number/) } });
    expect(db).toEqual([]);
    // The log keeps Bird's structured answer, never its message (which can quote the number).
    expect(warn).toHaveBeenCalledWith("sms-send: Bird refused a text", { status: 422, type: "validation_error", code: "E00002", name: "ValidationFailed", param: "to" });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/480/);
    sendAnswer = { status: 402, body: { error: { type: "billing_error", name: "InsufficientBalance", message: "x" } } };
    expect((await callTexts("POST", { action: "send", to: "4805551234", text: "hi" })).json.message).toMatch(/balance/);
  });

  it("tells the page to keep its key while Bird is still on an earlier try, and after a 5xx", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    sendAnswer = { status: 409, body: { error: { type: "conflict_error", code: "E01004", name: "request_in_progress", message: "x" } } };
    expect(await callTexts("POST", { action: "send", to: "4805551234", text: "hi", key: "0b5c7c1e-6f7d-4c55" })).toMatchObject({ status: 409, json: { error: "still_sending", message: expect.stringMatching(/still sending/) } });
    sendAnswer = { status: 503, body: { error: { type: "service_unavailable_error", code: "E01033", name: "IdempotencyUnavailable", message: "x" } } };
    expect((await callTexts("POST", { action: "send", to: "4805551234", text: "hi" })).status).toBe(502);
    // A key used for a different text (E01005) is a plain refusal: the page makes a new one.
    sendAnswer = { status: 409, body: { error: { type: "conflict_error", code: "E01005", name: "idempotency_key_reuse", message: "x" } } };
    expect((await callTexts("POST", { action: "send", to: "4805551234", text: "hi" })).status).toBe(422);
  });

  it("keeps the reason when Bird's 202 already says the text was refused", async () => {
    sendAnswer = { status: 202, body: { id: "sms_01out", status: "rejected", to: "+14805551234", from: OURS, last_error: { code: "recipient_opted_out", description: "Opted out" } } };
    const out = await callTexts("POST", { action: "send", to: "4805551234", text: "hi" });
    expect(db.find((c) => c.path === "sms_messages?on_conflict=id")?.init.body).toMatchObject({ status: "rejected", error: expect.stringMatching(/opted out/) });
    expect(out.json.text).toMatchObject({ status: "rejected", error: expect.stringMatching(/opted out/) });
  });

  it("is for owners and admins only, like reading", async () => {
    me = { ...me, role: "member" };
    expect((await callTexts("POST", { action: "send", to: "4805551234", text: "hi" })).status).toBe(403);
    expect(bird).toEqual([]);
  });
});

// ── Delivery receipts ─────────────────────────────────────────────────────
const SECRET = "whsec_c2VjcmV0LWtleQ==";
function deliver(event: unknown, id = `msg_${Math.random().toString(36).slice(2)}`) {
  const body = JSON.stringify(event);
  const ts = String(Math.floor(Date.now() / 1000));
  const headers = { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${webhookSignature(SECRET, id, ts, body)}` };
  const req = Object.assign(Readable.from([Buffer.from(body)]), { method: "POST", headers });
  const out: { status: number; json?: any } = { status: 0 };
  const res: any = { status: (c: number) => ((out.status = c), res), json: (j: unknown) => ((out.json = j), res) };
  return Promise.resolve(webhook(req as any, res)).then(() => out);
}
const receipt = (type: string, extra: Record<string, unknown> = {}) => ({
  type,
  timestamp: "2026-10-30T16:00:05Z",
  data: { sms_id: "sms_01out", workspace_id: "ws_1", to: "+14805551234", from: OURS, tags: null, metadata: null, segments: { count: 1, encoding: "GSM_7BIT", characters: 2 }, ...extra },
});
const patches = () => db.filter((c) => c.init?.method === "PATCH");

describe("/api/mail-webhook delivery receipts", () => {
  beforeEach(() => {
    process.env.BIRD_WEBHOOK_SECRET = SECRET;
  });

  it("moves a sent text to delivered, reading the status from Bird, not the event", async () => {
    rows = [{ id: "sms_01out", status: "sent" }];
    lookup = { status: 200, body: { id: "sms_01out", status: "delivered" } };
    expect(await deliver(receipt("sms.delivered"))).toMatchObject({ status: 200, json: { ok: true, updated: true } });
    expect(bird).toEqual([{ path: "/v1/sms/messages/sms_01out", method: "GET", body: undefined, headers: undefined }]);
    expect(patches()).toEqual([
      { path: "sms_messages?id=eq.sms_01out&direction=eq.out&or=(status.is.null,status.in.(scheduled,accepted,sent))", init: { method: "PATCH", body: { status: "delivered", error: null }, prefer: "return=minimal" } },
    ]);
  });

  it("lets the further of two receipts at once win: delivered lands even after sent moved the row", async () => {
    // Both read the row at accepted; sms.sent's PATCH landed first. sms.delivered's guard still matches a row now at sent.
    rows = [{ id: "sms_01out", status: "accepted" }];
    lookup = { status: 200, body: { id: "sms_01out", status: "delivered" } };
    await deliver(receipt("sms.delivered"));
    lookup = { status: 200, body: { id: "sms_01out", status: "sent" } };
    await deliver(receipt("sms.sent"));
    const [delivered, sent] = patches();
    expect(delivered.path).toMatch(/or=\(status\.is\.null,status\.in\.\(scheduled,accepted,sent\)\)$/);
    // And a late sent can't overwrite delivered: its guard leaves out sent and every final status.
    expect(sent.path).toMatch(/or=\(status\.is\.null,status\.in\.\(scheduled,accepted\)\)$/);
  });

  it("keeps why it wasn't delivered", async () => {
    rows = [{ id: "sms_01out", status: null }];
    lookup = { status: 200, body: { id: "sms_01out", status: "failed", last_error: { code: "recipient_opted_out", description: "Opted out", occurred_at: "2026-10-30T16:00:04Z" } } };
    await deliver(receipt("sms.failed", { error: { code: "recipient_opted_out", description: "Opted out", occurred_at: "2026-10-30T16:00:04Z" } }));
    expect(patches()[0]).toMatchObject({ path: "sms_messages?id=eq.sms_01out&direction=eq.out&or=(status.is.null,status.in.(scheduled,accepted,sent))", init: { body: { status: "failed", error: expect.stringMatching(/opted out/) } } });
  });

  it("never takes a final status back when a late receipt arrives out of order", async () => {
    rows = [{ id: "sms_01out", status: "delivered" }];
    lookup = { status: 200, body: { id: "sms_01out", status: "sent" } };
    expect((await deliver(receipt("sms.sent"))).json).toEqual({ ok: true, unchanged: true });
    rows = [{ id: "sms_01out", status: "failed" }];
    lookup = { status: 200, body: { id: "sms_01out", status: "delivered" } };
    expect((await deliver(receipt("sms.delivered"))).json).toEqual({ ok: true, unchanged: true });
    expect(patches()).toEqual([]);
  });

  it("ignores a receipt for a text BFO didn't send, without asking Bird", async () => {
    rows = [];
    expect(await deliver(receipt("sms.delivered", { sms_id: "sms_01impact", from: "+18885550100" }))).toMatchObject({ status: 200, json: { ok: true, ignored: true } });
    expect(db[0].path).toBe("sms_messages?id=eq.sms_01impact&direction=eq.out&select=id,status");
    expect(bird).toEqual([]);
    expect((await deliver({ type: "sms.sent" })).json).toEqual({ ok: true, ignored: true });
  });

  it("asks Bird to deliver again a receipt for BFO's text that beat its row into the table", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rows = [];
    lookup = { status: 200, body: { id: "sms_01out", status: "rejected", from: OURS, created_at: new Date().toISOString() } };
    expect((await deliver(receipt("sms.rejected"))).status).toBe(500);
    expect(bird).toEqual([{ path: "/v1/sms/messages/sms_01out", method: "GET", body: undefined, headers: undefined }]);
    // The event's sender is only a hint: Bird's own answer says whose it is.
    lookup = { status: 200, body: { id: "sms_01out", status: "rejected", from: "+18885550100" } };
    expect(await deliver(receipt("sms.rejected"))).toMatchObject({ status: 200, json: { ignored: true } });
    expect(patches()).toEqual([]);
  });

  it("lets go of a receipt for BFO's text that was never kept here, such as a member invitation", async () => {
    rows = [];
    lookup = { status: 200, body: { id: "sms_01invite", status: "delivered", from: OURS, created_at: new Date(Date.now() - 20 * 60_000).toISOString() } };
    expect(await deliver(receipt("sms.delivered"))).toMatchObject({ status: 200, json: { ignored: true } });
    lookup = { status: 200, body: { id: "sms_01invite", status: "delivered", from: OURS } };
    expect(await deliver(receipt("sms.delivered"))).toMatchObject({ status: 200, json: { ignored: true } });
    expect(patches()).toEqual([]);
  });

  it("asks Bird to retry when the message can't be read back", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rows = [{ id: "sms_01out", status: "sent" }];
    lookup = { status: 503, body: {} };
    expect((await deliver(receipt("sms.delivered"))).status).toBe(500);
    expect(patches()).toEqual([]);
  });

  it("refuses an unsigned receipt", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(receipt("sms.delivered")))]), { method: "POST", headers: {} });
    const out: { status: number } = { status: 0 };
    const res: any = { status: (c: number) => ((out.status = c), res), json: () => res };
    await webhook(req as any, res);
    expect(out.status).toBe(401);
    expect(db).toEqual([]);
  });
});
