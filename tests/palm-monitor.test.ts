import { beforeEach, describe, expect, it, vi } from "vitest";

const sbMock = vi.fn();
const palmMock = vi.fn();
vi.mock("../lib/auth.js", () => ({ sb: (...a: unknown[]) => sbMock(...(a as [])) }));
vi.mock("../lib/palm.js", async (orig) => ({ ...(await orig<typeof import("../lib/palm")>()), palm: (...a: unknown[]) => palmMock(...(a as [])) }));
vi.mock("../lib/tree.js", () => ({ applyOps: vi.fn(), readCollection: vi.fn(async () => []) }));
vi.mock("../lib/activity.js", () => ({ logActivity: vi.fn() }));

import { PalmError } from "../lib/palm";
import { checkEin, einName, MonitorError, registrationsOf, startMonitor, stopMonitor, type MonitorRow } from "../lib/palm-monitor";
import { palmFilingDeadlines } from "../app/entity/derive";

const BIZ = "0b8d6a3e-1111-4222-8333-944455556666";
const SUB = { id: "5a5a5a5a-1111-4222-8333-944455556666", resource_id: BIZ, status: "active" };
const by = { id: "u1", name: "Bobby" };

describe("registrationsOf", () => {
  it("lists home then foreign, with what Palm can find each by", () => {
    const regs = registrationsOf({
      name: "Ledger Louise, LLC",
      type: "LLC",
      state: "Arizona",
      fileNumber: " L123 ",
      foreign: { NV: { record: { mode: "live", checkedAt: 1, palmId: "1234-5678-9012" } }, CA: { notNeeded: true } },
    } as never);
    expect(regs).toEqual([
      { state: "AZ", home: true, fileNumber: "L123", palmId: null },
      { state: "NV", home: false, fileNumber: null, palmId: "1234-5678-9012" },
    ]);
  });
  it("has nothing for a trust", () => {
    expect(registrationsOf({ name: "Burton Family Trust", type: "Trust", state: "Arizona" } as never)).toEqual([]);
  });
});

describe("startMonitor", () => {
  beforeEach(() => {
    sbMock.mockReset();
    palmMock.mockReset();
  });

  it("watches the home state through the linked business", async () => {
    sbMock.mockResolvedValueOnce([]).mockResolvedValueOnce(null);
    palmMock.mockResolvedValueOnce(SUB);
    const row = await startMonitor({ assetId: "a1", reg: { state: "AZ", home: true, fileNumber: "L1", palmId: null }, linkedBusinessId: BIZ, mode: "live", by });
    expect(palmMock.mock.calls[0][0]).toBe(`/v1/business/${BIZ}/subscription`);
    expect(palmMock.mock.calls[0][1]).toMatchObject({ method: "POST", body: { event_types: ["business.registration.updated", "business.filing.due", "business.filing.overdue"], metadata: { bfo_asset_id: "a1", state: "AZ" } } });
    expect(row).toMatchObject({ business_id: BIZ, asset_id: "a1", state: "AZ", status: "active", mode: "live" });
    expect(sbMock.mock.calls[1][0]).toBe("palm_monitors?on_conflict=business_id,mode");
  });

  it("finds a foreign registration on the registry by its file number, else Palm's id", async () => {
    sbMock.mockResolvedValue([]);
    palmMock.mockResolvedValue(SUB);
    await startMonitor({ assetId: "a1", reg: { state: "NV", home: false, fileNumber: "E99", palmId: "p1" }, linkedBusinessId: BIZ, mode: "test", by });
    expect(palmMock.mock.calls[0][0]).toBe("/v1/business/subscription");
    expect(palmMock.mock.calls[0][1].body).toMatchObject({ registration_jurisdiction: "US-NV", registration_number: "E99" });
    await startMonitor({ assetId: "a1", reg: { state: "NV", home: false, fileNumber: null, palmId: "p1" }, linkedBusinessId: null, mode: "test", by });
    expect(palmMock.mock.calls[1][1].body).toMatchObject({ palm_id: "p1" });
    expect(palmMock.mock.calls[1][1].body.registration_number).toBeUndefined();
  });

  it("says what's missing rather than calling Palm without a way to find it", async () => {
    sbMock.mockResolvedValue([]);
    await expect(startMonitor({ assetId: "a1", reg: { state: "NV", home: false, fileNumber: null, palmId: null }, linkedBusinessId: null, mode: "live", by })).rejects.toBeInstanceOf(MonitorError);
    expect(palmMock).not.toHaveBeenCalled();
  });

  it("takes the subscription already at Palm for a linked business", async () => {
    sbMock.mockResolvedValue([]);
    palmMock.mockRejectedValueOnce(new PalmError(409, "exists")).mockResolvedValueOnce(SUB);
    const row = await startMonitor({ assetId: "a1", reg: { state: "AZ", home: true, fileNumber: "L1", palmId: null }, linkedBusinessId: BIZ, mode: "live", by });
    expect(palmMock.mock.calls[1]).toEqual([`/v1/business/${BIZ}/subscription`]);
    expect(row.business_id).toBe(BIZ);
  });

  it("doesn't start a second one for a state already watched", async () => {
    const on: MonitorRow = { business_id: BIZ, mode: "live", asset_id: "a1", state: "AZ", subscription_id: null, status: "active", started_at: "", started_by: null, ended_at: null };
    sbMock.mockResolvedValueOnce([on]);
    expect(await startMonitor({ assetId: "a1", reg: { state: "AZ", home: true, fileNumber: "L1", palmId: null }, linkedBusinessId: BIZ, mode: "live", by })).toBe(on);
    expect(palmMock).not.toHaveBeenCalled();
  });

  it("stops one already gone at Palm", async () => {
    palmMock.mockRejectedValueOnce(new PalmError(404, "gone"));
    sbMock.mockResolvedValueOnce(null);
    await stopMonitor({ business_id: BIZ, mode: "live" } as MonitorRow);
    expect(sbMock.mock.calls[0][1]).toMatchObject({ method: "PATCH", body: { status: "canceled" } });
  });
});

describe("the EIN check", () => {
  beforeEach(() => palmMock.mockReset());
  it("asks about the state's spelling once it's been read live", () => {
    expect(einName({ name: "Ledger Louise LLC (100%)" } as never)).toBe("Ledger Louise LLC");
    expect(einName({ name: "Ledger Louise LLC", stateRecord: { mode: "live", checkedAt: 1, name: "LEDGER LOUISE, L.L.C." } } as never)).toBe("LEDGER LOUISE, L.L.C.");
    expect(einName({ name: "Ledger Louise LLC", stateRecord: { mode: "test", checkedAt: 1, name: "SANDBOX CO" } } as never)).toBe("Ledger Louise LLC");
  });
  it("keeps what the IRS said, and simulates only in test mode", async () => {
    palmMock.mockResolvedValueOnce({ verification_id: "v1", matched: null, status: "pending", unavailable_reason: "tin_matching_service_unavailable" });
    const c = await checkEin({ ein: "12-3456789", name: "Acme", mode: "test", usage: { assetId: "a1" }, simulate: "unavailable" });
    expect(palmMock.mock.calls[0][0]).toBe("/v1/tin/verification");
    expect(palmMock.mock.calls[0][1].body).toMatchObject({ tin: "12-3456789", tin_type: "ein", name: "Acme", reference_id: "bfo_a1", metadata: { _simulate: "unavailable" } });
    expect(c).toMatchObject({ matched: null, status: "pending", reason: "tin_matching_service_unavailable", mode: "test" });
    palmMock.mockResolvedValueOnce({ matched: true, status: "completed" });
    await checkEin({ ein: "12-3456789", name: "Acme", mode: "live", usage: {}, simulate: "no_match" });
    expect(palmMock.mock.calls[1][1].body.metadata).toBeUndefined();
  });
});

describe("Palm's filings as deadlines", () => {
  const f = (status: "due" | "overdue", dueDate: string, mode: "test" | "live" = "live") => ({ state: "AZ", typeId: "ar", name: "Annual Report", dueDate, frequency: "annual", status, mode, at: 1 });
  const now = Date.parse("2026-10-23T00:00:00Z");
  it("puts overdue first, counts it as an alert, and drops stale or other-mode ones", () => {
    const r = palmFilingDeadlines({ a: f("due", "2026-12-01"), b: f("overdue", "2026-09-01"), c: f("due", "2026-08-01"), d: f("due", "2026-11-01", "test") }, "live", now);
    expect(r.overdue).toBe(1);
    expect(r.deadlines.map((d) => d.key)).toEqual(["palm_b", "palm_a"]);
    expect(r.deadlines[0].title).toBe("AZ Annual Report (overdue)");
  });
});
