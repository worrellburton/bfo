import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toEventRow, verifyPalmSignature } from "../lib/palm-webhook";

const SECRET = "whsec_c2VjcmV0LWtleQ==";
const now = 1_790_000_000_000;
const sign = (body: string, key: string | Buffer = SECRET, t = Math.floor(now / 1000), enc: "hex" | "base64" = "hex") =>
  `t=${t},v1=${createHmac("sha256", key).update(`${t}.${body}`).digest(enc)}`;

describe("palm signature", () => {
  const body = JSON.stringify({ id: "evt_1", type: "document.created" });
  it("accepts the common secret and digest encodings", () => {
    expect(verifyPalmSignature(body, sign(body), SECRET, now)).toBe(true);
    expect(verifyPalmSignature(body, sign(body, SECRET, undefined, "base64"), SECRET, now)).toBe(true);
    expect(verifyPalmSignature(body, sign(body, "c2VjcmV0LWtleQ=="), SECRET, now)).toBe(true);
    expect(verifyPalmSignature(body, sign(body, Buffer.from("secret-key")), SECRET, now)).toBe(true);
  });
  it("rejects a wrong secret, a changed body, a stale time and a missing header", () => {
    expect(verifyPalmSignature(body, sign(body, "whsec_other"), SECRET, now)).toBe(false);
    expect(verifyPalmSignature(body + " ", sign(body), SECRET, now)).toBe(false);
    expect(verifyPalmSignature(body, sign(body, SECRET, Math.floor(now / 1000) - 600), SECRET, now)).toBe(false);
    expect(verifyPalmSignature(body, undefined, SECRET, now)).toBe(false);
  });
});

describe("palm event rows", () => {
  it("reads forwarded mail", () => {
    const r = toEventRow({
      id: "evt_2", type: "document.created", mode: "live", created_at: "2026-08-15T12:00:00Z",
      data: { object: { id: "doc1", resource_type: "business", resource_id: "biz1", type: "notice", types: ["notice", "service_of_process"], filename: "summons.pdf" } },
    });
    expect(r).toMatchObject({ business_id: "biz1", document_id: "doc1", document_type: "service_of_process", filename: "summons.pdf", occurred_at: "2026-08-15T12:00:00Z" });
  });
  it("reads an agent change", () => {
    const r = toEventRow({ id: "evt_3", type: "registered_agent.change_failed", mode: "live", data: { object: { business_id: "biz1", status: "active", rejection_reason: "Entity not in good standing" } } });
    expect(r).toMatchObject({ business_id: "biz1", document_id: null, status: "active", rejection_reason: "Entity not in good standing" });
  });
});

// ── The endpoint ────────────────────────────────────────────────────────
const sbMock = vi.fn();
const emailMock = vi.fn(async () => {});
vi.mock("../lib/auth.js", () => ({ sb: (...a: unknown[]) => sbMock(...(a as [])), sendEmail: (...a: unknown[]) => (emailMock as (...x: unknown[]) => Promise<void>)(...a) }));
vi.mock("../lib/palm.js", () => ({
  palmMode: () => "live",
  palm: vi.fn(async () => ({ display_name: "Ledger Louise, LLC", metadata: { bfo_asset_id: "a1" } })),
}));
import handler from "../api/palm-webhook";

function call(body: string, signature?: string) {
  const req = Object.assign(Readable.from([Buffer.from(body)]), { method: "POST", headers: signature ? { "palm-signature": signature } : {} });
  const out: { status: number; json?: any } = { status: 0 };
  const res: any = { status(c: number) { out.status = c; return res; }, json(j: unknown) { out.json = j; return res; } };
  return Promise.resolve(handler(req as any, res)).then(() => out);
}

describe("/api/palm-webhook", () => {
  const event = { id: "evt_9", object: "event", type: "document.created", mode: "live", created_at: new Date(now).toISOString(), data: { object: { id: "d9", resource_type: "business", resource_id: "biz1", types: ["service_of_process"], filename: "summons.pdf" } } };
  const body = JSON.stringify(event);
  beforeEach(() => {
    process.env.PALM_WEBHOOK_SECRET = SECRET;
    sbMock.mockReset();
    emailMock.mockClear();
    vi.useFakeTimers({ now, toFake: ["Date"] });
  });

  it("refuses an unsigned call", async () => {
    expect((await call(body)).status).toBe(401);
    expect(sbMock).not.toHaveBeenCalled();
  });

  it("stores legal papers against the entity and emails the owners once", async () => {
    sbMock.mockResolvedValueOnce([{ id: "evt_9" }]).mockResolvedValueOnce([{ email: "o@example.com" }, { email: "o@example.com" }, { email: null }]);
    const r = await call(body, sign(body));
    expect(r.status).toBe(200);
    const [path, init] = sbMock.mock.calls[0];
    expect(path).toBe("palm_events?on_conflict=id");
    expect(init.body).toMatchObject({ id: "evt_9", asset_id: "a1", document_type: "service_of_process" });
    expect(emailMock).toHaveBeenCalledTimes(1);
    const [to, subject, text] = emailMock.mock.calls[0] as unknown as [string[], string, string];
    expect(to).toEqual(["o@example.com"]);
    expect(subject).toBe("Legal papers served on Ledger Louise, LLC");
    expect(text).toContain("/assets/a1/compliance");
  });

  it("does nothing more for a repeat delivery", async () => {
    sbMock.mockResolvedValueOnce([]);
    expect((await call(body, sign(body))).status).toBe(200);
    expect(emailMock).not.toHaveBeenCalled();
  });
});

describe("case events", () => {
  it("keeps the business a case was opened on", () => {
    const r = toEventRow({ id: "evt_c", type: "case.opened", mode: "live", data: { object: { id: "c1", parent_type: "business", parent_id: "biz9", status: "needs_response", summary: "Need addresses" } } });
    expect(r.business_id).toBe("biz9");
    expect(r.status).toBe("needs_response");
    const f = toEventRow({ id: "evt_d", type: "case.opened", mode: "live", data: { object: { id: "c2", parent_type: "filing", parent_id: "fil1", status: "needs_response" } } });
    expect(f.business_id).toBeNull();
  });
});
