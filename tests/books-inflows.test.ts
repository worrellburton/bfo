import { describe, expect, it } from "vitest";
import { anticipateInflows, cadenceFromGap, type InflowRow } from "../lib/books-inflows";

const row = (date: string, amount: number, merchant: string, extra: Partial<InflowRow> = {}): InflowRow => ({
  date, amount, merchant_name: merchant, name: merchant, book_category: "4000 Rental Income", entity_name: "FDJ Hesperia, LLC",
  type_override: null, txn_type: "special", intercompany: false, loan_id: null, ...extra,
});

describe("cadenceFromGap", () => {
  it("recognises the usual rhythms", () => {
    expect(cadenceFromGap(7)).toBe("weekly");
    expect(cadenceFromGap(14)).toBe("biweekly");
    expect(cadenceFromGap(31)).toBe("monthly");
    expect(cadenceFromGap(91)).toBe("quarterly");
    expect(cadenceFromGap(365)).toBe("yearly");
    expect(cadenceFromGap(50)).toBeNull();
  });
});

describe("anticipateInflows", () => {
  const today = new Date("2026-10-01T12:00:00Z");
  const rent = ["2026-06-08", "2026-07-08", "2026-08-08", "2026-09-08"].map((d) => row(d, -17334, "Focus Hospitality"));

  it("detects a monthly income stream and when it comes next", () => {
    const a = anticipateInflows(rent, today);
    const s = a.streams.find((x) => x.source === "Focus Hospitality");
    expect(s?.cadence).toBe("monthly");
    expect(Math.round(s!.monthly)).toBeGreaterThan(17000);
    expect(s?.nextExpected?.startsWith("2026-10")).toBe(true);
  });

  it("ignores outflows, transfers, roll-ups and loan legs", () => {
    const noise = [
      ...rent.map((r) => ({ ...r, amount: 17334 })),
      ...rent.map((r) => ({ ...r, merchant_name: "Transfer", name: "Transfer", type_override: "transfer" })),
      ...rent.map((r) => ({ ...r, merchant_name: "Rollup", name: "Rollup", intercompany: true })),
      ...rent.map((r) => ({ ...r, merchant_name: "Loan", name: "Loan", loan_id: "l1" })),
    ];
    expect(anticipateInflows(noise, today).streams).toEqual([]);
  });

  it("merges a bank-truncated spelling into its stream", () => {
    const mixed = [...rent.slice(0, 3), { ...rent[3], merchant_name: "FOCUS HOSPITALIT", name: "FOCUS HOSPITALIT" }];
    const a = anticipateInflows(mixed, today);
    expect(a.streams).toHaveLength(1);
    expect(a.streams[0].count).toBe(4);
  });
});
