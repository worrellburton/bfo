import { describe, expect, it } from "vitest";
import { cashBuckets, closeOn, dayList, fitError, isCashLike, parseCloses, pickMode, rebuild, type HSecurity } from "../lib/invest-history";

const secs = new Map<string, HSecurity>([
  ["FUND", { security_id: "FUND", ticker: "VTSAX", name: "Total Stock", cash: false, price: 110 }],
  ["MM", { security_id: "MM", ticker: "VMFXX", name: "Federal Money Market", cash: true, price: 1 }],
]);
const closes = new Map<string, Array<[string, number]>>([
  ["VTSAX", [["2026-10-01", 100], ["2026-10-02", 105], ["2026-10-05", 110]]],
]);

describe("helpers", () => {
  it("lists days and carries a close over weekends", () => {
    expect(dayList("2026-10-01", "2026-10-04")).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    const s = closes.get("VTSAX");
    expect(closeOn(s, "2026-10-03")).toBe(105);
    expect(closeOn(s, "2026-09-30")).toBeNull();
    expect(closeOn(s, "2026-10-06")).toBe(110);
  });
  it("knows cash", () => {
    expect(isCashLike("VMFXX", null)).toBe(true);
    expect(isCashLike("CUR:USD", null)).toBe(true);
    expect(isCashLike("VTSAX", "Vanguard Total Stock Market")).toBe(false);
    expect(cashBuckets([{ account_id: "a", security_id: "MM", quantity: 5 }, { account_id: "a", security_id: "FUND", quantity: 1 }], secs).get("a")).toBe("MM");
  });
  it("reads Yahoo's chart answer", () => {
    // 2026-10-01 20:00 UTC is 16:00 in New York.
    const got = parseCloses({ chart: { result: [{ timestamp: [1790884800, 1790971200], indicators: { quote: [{ close: [100.5, null] }] } }] } });
    expect(got).toEqual([["2026-10-01", 100.5]]);
  });
});

describe("rebuild", () => {
  const days = dayList("2026-10-01", "2026-10-05");

  it("prices today's holdings on each day when nothing traded", () => {
    const { points } = rebuild([{ account_id: "a", security_id: "FUND", quantity: 10 }, { account_id: "a", security_id: "MM", quantity: 500 }], [], secs, closes, days, "units");
    expect(points.map((p) => p.value)).toEqual([1500, 1550, 1550, 1550, 1600]);
  });

  it("undoes a buy reported with both legs (units)", () => {
    // On Oct 2: bought 5 FUND at 105 out of the settlement fund; both legs reported.
    const txns = [
      { date: "2026-10-02", account_id: "a", security_id: "FUND", quantity: 5, amount: 525, type: "buy", subtype: "buy" },
      { date: "2026-10-02", account_id: "a", security_id: "MM", quantity: -525, amount: -525, type: "sell", subtype: "sell" },
    ];
    const { points } = rebuild([{ account_id: "a", security_id: "FUND", quantity: 10 }, { account_id: "a", security_id: "MM", quantity: 0 }], txns, secs, closes, days, "units");
    // Oct 1: 5 FUND at 100 + 525 cash = 1025. A trade at the day's price doesn't change the value.
    expect(points[0]).toEqual({ day: "2026-10-01", value: 1025 });
    expect(points[1].value).toBe(1050);
  });

  it("moves the cash itself when the sweep isn't reported (cash-flows)", () => {
    const txns = [{ date: "2026-10-02", account_id: "a", security_id: "FUND", quantity: 5, amount: 525, type: "buy", subtype: "buy" }];
    const pos = [{ account_id: "a", security_id: "FUND", quantity: 10 }, { account_id: "a", security_id: "MM", quantity: 0 }];
    expect(rebuild(pos, txns, secs, closes, days, "cash-flows").points[0].value).toBe(1025);
    // Read as units, the same data loses the $525: the buy looks like money appearing.
    expect(rebuild(pos, txns, secs, closes, days, "units").points[0].value).toBe(500);
  });

  it("takes a deposit out of the past", () => {
    const txns = [{ date: "2026-10-05", account_id: "a", security_id: null, quantity: 0, amount: -1000, type: "cash", subtype: "deposit" }];
    const { points } = rebuild([{ account_id: "a", security_id: "MM", quantity: 1500 }], txns, secs, closes, days, "cash-flows");
    expect(points.map((p) => p.value)).toEqual([500, 500, 500, 500, 1500]);
  });

  it("holds today's price for a security with no closes, and says so", () => {
    const s = new Map(secs);
    s.set("X", { security_id: "X", ticker: null, name: "Private fund", cash: false, price: 20 });
    const { points, unpriced } = rebuild([{ account_id: "a", security_id: "X", quantity: 3 }], [], s, closes, days, "units");
    expect(points[0].value).toBe(60);
    expect(unpriced).toEqual(["Private fund"]);
  });
});

describe("choosing the reading", () => {
  it("keeps the one closer to what was recorded", () => {
    const recorded = [{ day: "2026-10-01", value: 1000 }];
    const units = [{ day: "2026-10-01", value: 500 }];
    const flows = [{ day: "2026-10-01", value: 1010 }];
    expect(fitError(flows, recorded)).toBeCloseTo(0.01);
    expect(pickMode({ units, "cash-flows": flows }, recorded)).toEqual({ mode: "cash-flows", error: expect.closeTo(0.01) });
    expect(pickMode({ units, "cash-flows": flows }, [])).toEqual({ mode: "units", error: null });
  });
});
