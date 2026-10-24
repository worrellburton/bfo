import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { webhookSignature } from "../lib/mail-webhook";
import { extractCode, formatPhone, smsRow } from "../lib/sms-inbound";

describe("extractCode", () => {
  it("finds the code in the usual wordings", () => {
    expect(extractCode("Your Apple Account code is: 482913. Don't share it with anyone.\n\n@apple.com #482913 %apple.com")).toBe("482913");
    expect(extractCode("G-583021 is your Google verification code.")).toBe("583021");
    expect(extractCode("Your Chase one-time passcode is 71920453. Don't share it.")).toBe("71920453");
    expect(extractCode("Use verification code 123-456 to sign in")).toBe("123456");
    expect(extractCode("Your PIN: 4821")).toBe("4821");
    expect(extractCode("@apple.com #902134")).toBe("902134");
    expect(extractCode("Your login code\n\n551 902")).toBe("551902");
  });
  it("leaves out texts with no code, phone numbers and years", () => {
    expect(extractCode("Call us back at (844) 519-2725 when you can")).toBeNull();
    expect(extractCode("See you at the 2026 meeting")).toBeNull();
    expect(extractCode("Reply STOP to opt out")).toBeNull();
    expect(extractCode("Order 123456 shipped; return code window 654321")).toBe("654321");
  });
});

describe("smsRow", () => {
  const event = { type: "sms.received", timestamp: "2026-10-24T15:00:00Z", data: { sms_id: "sms_01abc", from: "+14805551234", to: "+18445192725", text: "Your code is 239104" } };
  it("reads Bird's sms.received", () => {
    expect(smsRow(event, "msg_1")).toMatchObject({ id: "sms_01abc", from_number: "+14805551234", to_number: "+18445192725", body: "Your code is 239104", code: "239104", received_at: "2026-10-24T15:00:00.000Z" });
  });
  it("takes the other field names Bird has used, and the delivery id as a fallback", () => {
    const r = smsRow({ type: "sms.received", data: { originator: { phone_number: "12345" }, recipient: "+18445192725", body: { text: "hi" } } }, "msg_2");
    expect(r).toMatchObject({ id: "msg_2", from_number: "12345", body: "hi", code: null });
  });
  it("is null for anything else", () => {
    expect(smsRow({ type: "email.received", data: {} }, "msg_3")).toBeNull();
    expect(smsRow({ type: "sms.received", data: { text: "no sender" } }, "msg_4")).toBeNull();
  });
});

describe("formatPhone", () => {
  it("formats US numbers and short codes", () => {
    expect(formatPhone("+18445192725")).toBe("(844) 519-2725");
    expect(formatPhone("4805551234")).toBe("(480) 555-1234");
    expect(formatPhone("54321")).toBe("Short code 54321");
    expect(formatPhone("+447700900123")).toBe("+447700900123");
  });
});

// ── The webhook ─────────────────────────────────────────────────────────
const sbMock = vi.fn();
vi.mock("../lib/auth.js", () => ({ sb: (...a: unknown[]) => sbMock(...(a as [])) }));
vi.mock("../lib/mail.js", () => ({ getInbound: vi.fn(), ingestInbound: vi.fn() }));
import handler from "../api/mail-webhook";

const SECRET = "whsec_c2VjcmV0LWtleQ==";
function call(body: string, id = "msg_9") {
  const ts = String(Math.floor(Date.now() / 1000));
  const headers = { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${webhookSignature(SECRET, id, ts, body)}` };
  const req = Object.assign(Readable.from([Buffer.from(body)]), { method: "POST", headers });
  const out: { status: number; json?: any } = { status: 0 };
  const res: any = { status(c: number) { out.status = c; return res; }, json(j: unknown) { out.json = j; return res; } };
  return Promise.resolve(handler(req as any, res)).then(() => out);
}

describe("/api/mail-webhook texts", () => {
  beforeEach(() => {
    process.env.BIRD_WEBHOOK_SECRET = SECRET;
    sbMock.mockReset();
  });
  it("keeps a text once", async () => {
    sbMock.mockResolvedValueOnce(null);
    const body = JSON.stringify({ type: "sms.received", data: { from: "+14805551234", to: "+18445192725", text: "Your code is 239104" } });
    expect((await call(body)).status).toBe(200);
    const [path, init] = sbMock.mock.calls[0];
    expect(path).toBe("sms_messages?on_conflict=id");
    expect(init).toMatchObject({ method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: { id: "msg_9", code: "239104" } });
  });
  it("asks Bird to retry when it can't be kept", async () => {
    sbMock.mockRejectedValueOnce(new Error("db down"));
    const body = JSON.stringify({ type: "sms.received", data: { from: "+14805551234", text: "hi" } });
    expect((await call(body)).status).toBe(500);
  });
});
