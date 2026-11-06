import { describe, expect, it } from "vitest";
import { annualPace, classify, gains, monthKeys, monthsBetween } from "../app/investments-model";

describe("gains", () => {
  const tax = (id: string) => (id === "ira" ? ("tax_deferred" as const) : id === "taxable" ? ("taxable" as const) : null);
  it("splits taxable from tax-deferred and names positions with no basis", () => {
    const g = gains(
      [
        { account_id: "taxable", type: "mutual fund", value: 150, cost_basis: 100 },
        { account_id: "ira", type: "etf", value: 80, cost_basis: 50 },
        { account_id: "taxable", type: "equity", value: 40, cost_basis: null },
        { account_id: "taxable", type: "cash", value: 999, cost_basis: null },
      ],
      tax,
    );
    expect(g.taxable).toEqual({ gain: 50, basis: 100, positions: 1 });
    expect(g.deferred).toEqual({ gain: 30, basis: 50, positions: 1 });
    expect(g.noBasis).toEqual({ positions: 1, value: 40 });
  });
  it("counts money market funds as cash", () => {
    expect(classify({ type: "mutual fund", money_market: true })).toBe("cash");
  });
});

describe("income window", () => {
  it("measures the months the transactions cover", () => {
    expect(monthsBetween("2026-07-31", "2026-11-06")).toBe(3.2);
    expect(monthKeys("2026-07-31", "2026-11-06")).toEqual(["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
  });
  it("annualizes only over the window, and not before three months", () => {
    expect(annualPace(29_503, 3.2)).toBeCloseTo(110_636, 0);
    expect(annualPace(1_000, 2)).toBeNull();
  });
});
