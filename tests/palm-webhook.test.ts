import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { monitorPatch, toEventRow, verifyPalmSignature } from "../lib/palm-webhook";

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
const treeRows: { id: string; data: Record<string, unknown> }[] = [];
const applyMock = vi.fn(async () => {});
const activityMock = vi.fn(async () => {});
vi.mock("../lib/tree.js", () => ({ readRows: vi.fn(async () => treeRows), applyOps: (...a: unknown[]) => (applyMock as (...x: unknown[]) => Promise<void>)(...a) }));
vi.mock("../lib/activity.js", () => ({ logActivity: (...a: unknown[]) => (activityMock as (...x: unknown[]) => Promise<void>)(...a) }));
// The admins' alert (lib/alert.ts) is its own thing, tested in tests/ops.test.ts.
const alertMock = vi.fn(async () => "sent");
vi.mock("../lib/alert.js", () => ({
  alertAdmins: (...a: unknown[]) => (alertMock as (...x: unknown[]) => Promise<string>)(...a),
  alertOnThrow: (_kind: string, _title: string, fn: unknown) => fn,
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
    // "Not handled before", the event row, then the owners.
    sbMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "evt_9" }]).mockResolvedValueOnce([{ email: "o@example.com" }, { email: "o@example.com" }, { email: null }]);
    const r = await call(body, sign(body));
    expect(r.status).toBe(200);
    expect(sbMock.mock.calls[0][0]).toBe("palm_events?id=eq.evt_9&select=id&limit=1");
    const [path, init] = sbMock.mock.calls[1];
    expect(path).toBe("palm_events?on_conflict=id");
    expect(init.body).toMatchObject({ id: "evt_9", asset_id: "a1", document_type: "service_of_process" });
    expect(emailMock).toHaveBeenCalledTimes(1);
    const [to, subject, text] = emailMock.mock.calls[0] as unknown as [string[], string, string];
    expect(to).toEqual(["o@example.com"]);
    expect(subject).toBe("Legal papers served on Ledger Louise, LLC");
    expect(text).toContain("/assets/a1/compliance");
  });

  it("does nothing more for a repeat delivery", async () => {
    sbMock.mockResolvedValueOnce([{ id: "evt_9" }]).mockResolvedValueOnce([]);
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

describe("agent events", () => {
  const BIZ = "0b8d6a3e-1111-4222-8333-944455556666";
  const agentEvent = (status: string, created: number) => ({
    id: `evt_ra_${status}_${created}`, object: "event", type: "registered_agent.updated", mode: "live", created_at: new Date(created).toISOString(),
    data: { object: { business_id: BIZ, provider: "palm", status, started_at: "2026-10-01T00:00:00Z", name: "Palm RA", address: { street_line_1: "1 Main St", city: "Reno", region: "NV", postal_code: "89501", country: "US" } } },
  });
  beforeEach(() => {
    process.env.PALM_WEBHOOK_SECRET = SECRET;
    sbMock.mockReset();
    applyMock.mockClear();
    activityMock.mockClear();
    treeRows.length = 0;
    vi.useFakeTimers({ now, toFake: ["Date"] });
  });

  it("finds the entity by its linked business and puts Palm on the record", async () => {
    treeRows.push({ id: "asset-0001", data: { name: "Ledger Louise, LLC", palm: { live: { businessId: BIZ, ra: { status: "pending", checkedAt: now - 60_000 } } } } });
    // "Not handled before", the entity linked to the business, then the event row.
    sbMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "asset-0001", name: "Ledger Louise, LLC" }]).mockResolvedValueOnce([{ id: "x" }]);
    const body = JSON.stringify(agentEvent("active", now));
    expect((await call(body, sign(body))).status).toBe(200);
    expect(sbMock.mock.calls[1][0]).toContain(`data->palm->live->>businessId=eq.${BIZ}`);
    const [ops] = applyMock.mock.calls[0] as unknown as [{ value: Record<string, unknown> }[]];
    expect(ops[0].value).toMatchObject({ registeredAgent: "Palm RA", registeredAgentSource: "Palm, active since 2026-10-01", "palm/live/ra": { status: "active", provider: "palm" } });
    expect(activityMock).toHaveBeenCalledTimes(1);
  });

  it("ignores an event older than what was last read", async () => {
    // Ordered by Palm's own event times: the last one applied was newer.
    treeRows.push({ id: "asset-0001", data: { palm: { live: { businessId: BIZ, ra: { status: "active", checkedAt: now, eventAt: now } } } } });
    sbMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "asset-0001", name: null }]).mockResolvedValueOnce([{ id: "x" }]);
    const body = JSON.stringify(agentEvent("pending", now - 3_600_000));
    expect((await call(body, sign(body))).status).toBe(200);
    expect(applyMock).not.toHaveBeenCalled();
    expect(activityMock).not.toHaveBeenCalled();
  });

  it("does nothing for an event it has already handled", async () => {
    treeRows.push({ id: "asset-0001", data: { palm: { live: { businessId: BIZ, ra: { status: "pending" } } } } });
    sbMock.mockResolvedValueOnce([{ id: "seen" }]).mockResolvedValueOnce([{ id: "asset-0001", name: null }]).mockResolvedValueOnce([]);
    const body = JSON.stringify(agentEvent("active", now));
    expect((await call(body, sign(body))).status).toBe(200);
    expect(applyMock).not.toHaveBeenCalled();
    expect(activityMock).not.toHaveBeenCalled();
  });
});

describe("monitor events", () => {
  const BIZ = "7c1d2e3f-1111-4222-8333-944455556666";
  const filingEvent = (type: string, created: number, due = "2026-11-01") => ({
    id: `evt_${type}_${created}`, object: "event", type, mode: "live", created_at: new Date(created).toISOString(),
    data: { business: { id: BIZ, palm_id: "1234-5678-9012", legal_name: "Ledger Louise, LLC", registration_jurisdiction_id: "US-AZ" }, object: { type: { id: "annual_report", name: "Annual Report" }, frequency: "annual", due_date: due } },
  });
  const monitorRow = { business_id: BIZ, mode: "live", asset_id: "asset-0001", state: "AZ", subscription_id: "s1", status: "active", started_at: "2026-10-01T00:00:00Z", started_by: null, ended_at: null };
  beforeEach(() => {
    process.env.PALM_WEBHOOK_SECRET = SECRET;
    sbMock.mockReset();
    applyMock.mockClear();
    activityMock.mockClear();
    emailMock.mockClear();
    treeRows.length = 0;
  });

  it("takes the business from data.business", () => {
    expect(toEventRow(filingEvent("business.filing.due", now) as never)).toMatchObject({ business_id: BIZ, status: null });
  });

  it("keeps an overdue filing on the entity and emails the owners", async () => {
    treeRows.push({ id: "asset-0001", data: { name: "Ledger Louise, LLC" } });
    // "Not handled before", the monitor, the owners, then the event row.
    sbMock.mockResolvedValueOnce([]).mockResolvedValueOnce([monitorRow]).mockResolvedValueOnce([{ email: "o@example.com" }]).mockResolvedValueOnce([{ id: "x" }]);
    const body = JSON.stringify(filingEvent("business.filing.overdue", now));
    expect((await call(body, sign(body))).status).toBe(200);
    expect(sbMock.mock.calls[1][0]).toContain(`palm_monitors?business_id=eq.${BIZ}&mode=eq.live`);
    const [ops] = applyMock.mock.calls[0] as unknown as [{ value: Record<string, unknown> }[]];
    expect(ops[0].value).toEqual({ "palmFilings/AZ_annual_report": { state: "AZ", typeId: "annual_report", name: "Annual Report", dueDate: "2026-11-01", frequency: "annual", status: "overdue", mode: "live", at: now } });
    expect(activityMock).toHaveBeenCalledTimes(1);
    expect(emailMock).toHaveBeenCalledTimes(1);
    expect((emailMock.mock.calls[0] as unknown as [string[], string])[1]).toBe("Ledger Louise, LLC: Annual Report is overdue in AZ");
  });

  it("asks Palm to send it again when it couldn't be written", async () => {
    treeRows.push({ id: "asset-0001", data: { name: "Ledger Louise, LLC" } });
    applyMock.mockRejectedValueOnce(new Error("db down"));
    sbMock.mockResolvedValueOnce([]).mockResolvedValueOnce([monitorRow]);
    const body = JSON.stringify(filingEvent("business.filing.due", now));
    expect((await call(body, sign(body))).status).toBe(500);
    expect(sbMock).toHaveBeenCalledTimes(2); // not stored, so the retry is handled
    expect(alertMock).toHaveBeenCalledTimes(1); // and the admins hear about it
    expect((alertMock.mock.calls[0] as unknown as [string, string])[0]).toBe("webhook:palm");
  });
});

describe("filing events", () => {
  const FILING = "5a6b7c8d-1111-4222-8333-944455556666";
  const filingEvent = (status: string) => ({
    id: `evt_f_${status}`, object: "event", type: "filing.updated", mode: "live", created_at: new Date(now).toISOString(),
    data: { object: { id: FILING, type: "formation", status, jurisdiction: "DE", metadata: { bfo_asset_id: "asset-abcdef12" } } },
  });
  const formed = { filingId: FILING, status: "completed", jurisdiction: "DE", submittedAt: 1, updatedAt: 2, entityType: "llc" };
  beforeEach(async () => {
    process.env.PALM_WEBHOOK_SECRET = SECRET;
    sbMock.mockReset();
    applyMock.mockClear();
    treeRows.length = 0;
    treeRows.push({ id: "asset-abcdef12", data: { status: "Active", palm: { live: { formation: formed } } } });
    const { palm } = await import("../lib/palm.js");
    vi.mocked(palm).mockClear();
  });

  it("writes the filing as Palm has it now, not the event's copy", async () => {
    const { palm } = await import("../lib/palm.js");
    vi.mocked(palm).mockResolvedValueOnce({ id: FILING, type: "formation", status: "completed", jurisdiction: "DE" });
    // "Not handled before", then the event row.
    sbMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "x" }]);
    const body = JSON.stringify(filingEvent("processing"));
    expect((await call(body, sign(body))).status).toBe(200);
    expect(vi.mocked(palm).mock.calls[0][0]).toBe(`/v1/filing/${FILING}`);
    const [ops] = applyMock.mock.calls[0] as unknown as [{ value: Record<string, unknown> }[]];
    expect(ops[0].value).toMatchObject({ status: "Active", "palm/live/formation": { status: "completed" } });
  });

  it("changes nothing for a redelivered event", async () => {
    sbMock.mockResolvedValueOnce([{ id: "seen" }]).mockResolvedValueOnce([]);
    const body = JSON.stringify(filingEvent("processing"));
    expect((await call(body, sign(body))).status).toBe(200);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("changes nothing when Palm can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { palm } = await import("../lib/palm.js");
    vi.mocked(palm).mockRejectedValueOnce(new Error("palm 502"));
    sbMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "x" }]);
    const body = JSON.stringify(filingEvent("processing"));
    expect((await call(body, sign(body))).status).toBe(200);
    expect(applyMock).not.toHaveBeenCalled();
  });
});

describe("monitorPatch", () => {
  const ev = (type: string, extra: Record<string, unknown> = {}) => ({ id: "e1", type, mode: "live" as const, ...extra });
  it("keeps the latest change to a record", () => {
    const p = monitorPatch(ev("business.registration.updated", { data: { changes: [{ attribute: "status", action: "updated", summary: "Status changed to Inactive", previous_value: "Active", current_value: { v: "Inactive" } }] } }), "AZ", "live", 5);
    expect(p).toEqual({ "palmMonitor/AZ/lastChange": { at: 5, mode: "live", eventId: "e1", changes: [{ attribute: "status", action: "updated", summary: "Status changed to Inactive", from: "Active", to: '{"v":"Inactive"}' }] } });
    expect(monitorPatch(ev("business.registration.updated"), "AZ", "live", 5, { palmMonitor: { AZ: { lastChange: { at: 9 } } } })).toBeNull();
  });
  it("doesn't set an overdue filing back to due", () => {
    const due = ev("business.filing.due", { data: { object: { type: { id: "annual/report", name: "Annual" }, due_date: "2026-11-01T00:00:00Z" } } });
    const prior = { palmFilings: { "AZ_annual_report": { state: "AZ", typeId: "x", name: "Annual", dueDate: "2026-11-01", frequency: null, status: "overdue" as const, mode: "live" as const, at: 1 } } };
    expect(monitorPatch(due, "AZ", "live", 2, prior)).toBeNull();
    expect(Object.keys(monitorPatch(due, "AZ", "live", 2)!)).toEqual(["palmFilings/AZ_annual_report"]);
    expect(monitorPatch(ev("document.created"), "AZ", "live", 2)).toBeNull();
  });
});
