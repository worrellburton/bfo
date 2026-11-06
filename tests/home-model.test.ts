import { describe, expect, it } from "vitest";
import { flowSide, inRange, shareOf, sixMonths, typeCounts, type Pnl } from "../app/home-model";

// Home's figures come from the P&L itself; these check how Home reads it.

const zeros = () => Array(12).fill(0) as number[];
const pnl = (year: number, rev: number[], op: number[], other = zeros()): Pnl => ({
  year,
  revenue: [
    { label: "4000 Rental Income", monthly: zeros(), total: 9000 },
    { label: "Income", monthly: zeros(), total: 800 },
  ],
  operating: [
    { label: "6100 Professional Fees", monthly: zeros(), total: 1200 },
    { label: "6450 Dues & Subscriptions", monthly: zeros(), total: 54.49 },
    { label: "General merchandise", monthly: zeros(), total: 210.25 },
  ],
  other: [{ label: "7100 Interest Expense", monthly: zeros(), total: 300 }],
  revenue_monthly: rev,
  operating_monthly: op,
  other_monthly: other,
});

describe("income and expenses, as the P&L has them", () => {
  const p = pnl(2026, zeros(), zeros());
  it("totals each side the way the P&L's Total column does, and says how much is uncategorized", () => {
    const income = flowSide(p, "income");
    expect(income.total).toBe(9800);
    expect(income.uncategorized).toBe(800);
    const expenses = flowSide(p, "expenses");
    expect(expenses.total).toBeCloseTo(1764.74, 2);
    expect(expenses.uncategorized).toBe(210.25);
    expect(expenses.lines.map((l) => l.section)).toEqual(["operating", "other", "operating", "operating"]);
    expect(expenses.lines[0]).toEqual({ label: "6100 Professional Fees", total: 1200, section: "operating" });
  });
  it("takes six months from this year's P&L, and last year's in the spring", () => {
    const rev = zeros().map((_, i) => (i + 1) * 100);
    const thisYear = pnl(
      2026,
      rev,
      zeros(),
      zeros().map(() => 5),
    );
    const lastYear = pnl(
      2025,
      rev.map((v) => v * 10),
      zeros(),
    );
    const nov = sixMonths(new Date(2026, 10, 6), "income", thisYear, null);
    expect(nov.map((m) => m.key)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(nov.map((m) => m.value)).toEqual([600, 700, 800, 900, 1000, 1100]);
    const feb = sixMonths(new Date(2026, 1, 3), "expenses", thisYear, lastYear);
    expect(feb.map((m) => m.key)).toEqual(["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(feb.map((m) => m.value)).toEqual([0, 0, 0, 0, 5, 5]);
    expect(sixMonths(new Date(2026, 1, 3), "income", thisYear, null)[0].value).toBeNull();
  });
});

describe("the treasury range", () => {
  it("is calendar days back from the latest snapshot, not a count of rows", () => {
    const rows = [{ day: "2026-08-10" }, { day: "2026-09-20" }, { day: "2026-10-07" }, { day: "2026-10-08" }, { day: "2026-11-06" }];
    expect(inRange(rows, 30).map((r) => r.day)).toEqual(["2026-10-07", "2026-10-08", "2026-11-06"]);
    expect(inRange(rows, Infinity)).toHaveLength(5);
  });
});

describe("the holding structure", () => {
  it("shows a parent's share from the member list, and says when it's only the largest", () => {
    expect(shareOf({ members: [{ name: "Northwind Holdings, LLC", percent: 100 }] }, "Northwind Holdings LLC")).toBe("100%");
    expect(
      shareOf(
        {
          members: [
            { name: "Northwind Holdings, LLC", percent: "60" },
            { name: "A. Person", percent: 40 },
          ],
        },
        "Northwind Holdings, LLC",
      ),
    ).toBe("60% · largest owner");
    expect(shareOf({ members: [] }, "Northwind Holdings, LLC")).toBeNull();
  });
  it("counts every type, so the parts add up", () => {
    expect(typeCounts(["LLC", "LLC", "C-Corp", "LP", "Trust"])).toBe("2 LLCs · 1 C-Corp · 1 LP · 1 trust");
  });
});
