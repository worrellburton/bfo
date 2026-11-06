import { describe, expect, it } from "vitest";
import { endOf, inYear, msaCsv, msaFrom, schedule, span, sum } from "../app/routes/msas-model";

// Made-up agreements only.
const family = [
  { id: "a", name: "Northwind Holdings, LLC" },
  { id: "b", name: "Alder Ventures, LLC" },
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const base = { counterparty: "Example Advisors", status: "active", term: "Annual, auto-renewing", effectiveDate: "2026-07-01" };

describe("MSAs", () => {
  it("places a monthly fee in each month in effect, and nothing before the effective month", () => {
    const m = msaFrom("a", "Northwind Holdings, LLC", "c", { ...base, fee: "8000", frequency: "Monthly" }, family);
    expect(schedule(m, 2026)).toEqual([null, null, null, null, null, null, 8000, 8000, 8000, 8000, 8000, 8000]);
    expect(sum(schedule(m, 2026))).toBe(48000);
    expect(span(m, 2026, MONTHS)).toBe("Jul–Dec");
  });

  it("bills a quarterly fee every third month from the effective month, an annual one on the anniversary, a one-time fee once", () => {
    const q = msaFrom("a", "N", "c", { ...base, amount: 500, frequency: "Quarterly" }, family);
    expect(sum(schedule(q, 2026))).toBe(1000);
    expect(schedule(q, 2027).filter((x) => x).length).toBe(4);
    const y = msaFrom("a", "N", "c", { ...base, amount: 1200, frequency: "Annually" }, family);
    expect(schedule(y, 2027)).toEqual([0, 0, 0, 0, 0, 0, 1200, 0, 0, 0, 0, 0]);
    const once = msaFrom("a", "N", "c", { ...base, amount: 2500, frequency: "One-time" }, family);
    expect(sum(schedule(once, 2026))).toBe(2500);
    expect(sum(schedule(once, 2027))).toBe(0);
  });

  it("stops at the termination date and at the end of a fixed term", () => {
    const ended = msaFrom("a", "N", "c", { ...base, amount: 100, frequency: "Monthly", status: "terminated", terminatedOn: "2026-10-15" }, family);
    expect(endOf({ ...base, terminatedOn: "2026-10-15" })).toBe("2026-10-14");
    expect(schedule(ended, 2026).slice(6)).toEqual([100, 100, 100, 100, null, null]);
    const fixed = msaFrom("a", "N", "c", { ...base, amount: 100, frequency: "Monthly", term: "Annual, fixed term" }, family);
    expect(schedule(fixed, 2027)).toEqual([100, 100, 100, 100, 100, 100, null, null, null, null, null, null]);
    expect(inYear(fixed, 2028)).toBe(false);
  });

  it("knows which side of the ledger a fee is on, and flags agreements between family entities", () => {
    expect(msaFrom("a", "N", "c", { ...base, amount: 1, role: "manager" }, family).direction).toBe("income");
    expect(msaFrom("a", "N", "c", { ...base, amount: 1, role: "managed" }, family).direction).toBe("expense");
    expect(msaFrom("a", "N", "c", { ...base, amount: 1, counterparty: "Alder Ventures LLC" }, family).intercompany).toBe(true);
    expect(msaFrom("a", "N", "c", { ...base, amount: 1 }, family).intercompany).toBe(false);
  });

  it("exports both parties, the direction and the terms, with each side totalled apart", () => {
    const rows = [
      msaFrom("a", "Northwind Holdings, LLC", "c1", { ...base, amount: 100, frequency: "Monthly" }, family),
      msaFrom("a", "Northwind Holdings, LLC", "c2", { ...base, amount: 50, frequency: "Monthly", role: "managed" }, family),
    ];
    const csv = msaCsv(rows, 2026, MONTHS).split("\n");
    expect(csv[0]).toMatch(/not what was billed/);
    expect(csv[1]).toContain('"Family entity","Direction"');
    expect(csv[2]).toContain('"Northwind Holdings, LLC","Fee income","No","Monthly","100"');
    expect(csv.at(-2)).toMatch(/^"Total fee income, excluding intercompany".*"600.00"$/);
    expect(csv.at(-1)).toMatch(/^"Total fee expense, excluding intercompany".*"300.00"$/);
  });
});
