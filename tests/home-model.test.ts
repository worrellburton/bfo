import { describe, expect, it } from "vitest";
import { flowSide, inRange, shareOf, sixMonths, typeCounts, type Pnl } from "../app/home-model";

// Home's figures come from the P&L itself; these check how Home reads it.

const zeros = () => Array(12).fill(0) as number[];
const at = (m: number, v: number) => zeros().map((x, i) => (i === m ? v : x));

/** The earlier P&L shape: arrays by section, uncategorized inside by direction. */
const earlier = (year: number): Pnl => ({
  year,
  revenue: [
    { label: "4000 Rental Income", monthly: at(10, 9000), total: 9000 },
    { label: "Income", monthly: at(1, 800), total: 800 },
  ],
  operating: [
    { label: "6100 Professional Fees", monthly: at(9, 1200), total: 1200 },
    { label: "6450 Dues & Subscriptions", monthly: at(1, 54.49), total: 54.49 },
    { label: "General merchandise", monthly: at(1, 210.25), total: 210.25 },
  ],
  other: [{ label: "7100 Interest Expense", monthly: at(1, 300), total: 300 }],
});

/** The reworked shape: sections with a sign, receipts and disbursements, uncategorized outside. */
const reworked = (year: number): Pnl => ({
  year,
  receipts: 9100,
  disbursements: 1754.49,
  uncategorized: { count: 2, in: 800, out: 210.25 },
  sections: [
    { key: "revenue", sign: "in", lines: [{ label: "4000 Rental Income", figures: { monthly: at(10, 9000), total: 9000 } }] },
    { key: "operating", sign: "out", lines: [{ label: "6100 Professional Fees", figures: { monthly: at(9, 1200), total: 1200 } }, { label: "6450 Dues & Subscriptions", figures: { monthly: at(1, 54.49), total: 54.49 } }] },
    { key: "other", sign: "in", lines: [{ label: "7100 Interest Expense", figures: { monthly: at(1, -300), total: -300 } }] },
    { key: "personal", sign: "in", lines: [{ label: "4300 Social Security", figures: { monthly: at(10, 100), total: 100 } }, { label: "6750 Medical", figures: { monthly: at(10, -200), total: -200 } }] },
  ],
});

describe("income and expenses, as the P&L has them", () => {
  it("reads the reworked statements: receipts and disbursements, uncategorized left out", () => {
    const income = flowSide(reworked(2026), "income");
    expect(income.total).toBe(9100);
    expect(income.lines.map((l) => [l.label, l.total, l.section])).toEqual([
      ["4000 Rental Income", 9000, "revenue"],
      ["4300 Social Security", 100, "personal"],
    ]);
    expect(income).toMatchObject({ uncategorized: 800, uncategorizedInside: false });
    const expenses = flowSide(reworked(2026), "expenses");
    expect(expenses.total).toBe(1754.49);
    expect(expenses.lines.map((l) => [l.label, l.total])).toEqual([
      ["6100 Professional Fees", 1200],
      ["7100 Interest Expense", 300],
      ["6750 Medical", 200],
      ["6450 Dues & Subscriptions", 54.49],
    ]);
    expect(expenses.lines.reduce((s, l) => s + l.total, 0)).toBeCloseTo(expenses.total, 2);
    expect(sixMonths(new Date(2026, 10, 6), "expenses", reworked(2026), null).map((m) => m.value)).toEqual([0, 0, 0, 0, 1200, 200]);
  });

  it("reads the earlier statements, where uncategorized sits inside", () => {
    const income = flowSide(earlier(2026), "income");
    expect(income).toMatchObject({ total: 9800, uncategorized: 800, uncategorizedInside: true });
    const expenses = flowSide(earlier(2026), "expenses");
    expect(expenses.total).toBeCloseTo(1764.74, 2);
    expect(expenses.lines[0]).toMatchObject({ label: "6100 Professional Fees", total: 1200, section: "operating" });
  });

  it("takes six months from this year's P&L, and last year's in the spring", () => {
    const nov = sixMonths(new Date(2026, 10, 6), "income", earlier(2026), null);
    expect(nov.map((m) => m.key)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(nov.map((m) => m.value)).toEqual([0, 0, 0, 0, 0, 9000]);
    const feb = sixMonths(new Date(2026, 1, 3), "expenses", earlier(2026), earlier(2025));
    expect(feb.map((m) => m.key)).toEqual(["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(feb.map((m) => m.value)).toEqual([0, 1200, 0, 0, 0, 564.74]);
    expect(sixMonths(new Date(2026, 1, 3), "income", earlier(2026), null)[0].value).toBeNull();
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
