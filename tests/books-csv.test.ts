import { describe, expect, it } from "vitest";
import { planCsvImport } from "../lib/books-csv";

const row = (date: string, amount: number, description = "TOLL") => ({ date, amount, description });

describe("planCsvImport", () => {
  it("imports rows the account doesn't have", () => {
    const plan = planCsvImport([row("2026-01-02", 25), row("2026-01-03", 40)], []);
    expect(plan.skipped).toBe(0);
    expect(plan.rows.map((r) => r.date)).toEqual(["2026-01-02", "2026-01-03"]);
  });

  it("skips a row already stored on the same date for the same amount", () => {
    const plan = planCsvImport([row("2026-01-02", 25)], [{ date: "2026-01-02", amount: "25.00" }]);
    expect(plan).toEqual({ rows: [], skipped: 1 });
  });

  it("keeps a genuine same-day repeat when only one is stored", () => {
    const plan = planCsvImport(
      [row("2026-01-02", 25), row("2026-01-02", 25)],
      [{ date: "2026-01-02", amount: 25 }]
    );
    expect(plan.skipped).toBe(1);
    expect(plan.rows).toHaveLength(1);
  });

  it("imports both repeats when none is stored, with distinct occurrences", () => {
    const plan = planCsvImport([row("2026-01-02", 25), row("2026-01-02", 25)], []);
    expect(plan.rows.map((r) => r.occurrence)).toEqual([0, 1]);
  });

  it("counts occurrences over the whole file, so a re-import names twins the same way", () => {
    const file = [row("2026-01-02", 25), row("2026-01-02", 25), row("2026-01-02", 25)];
    const plan = planCsvImport(file, [{ date: "2026-01-02", amount: 25 }]);
    expect(plan.rows.map((r) => r.occurrence)).toEqual([1, 2]);
  });

  it("treats different descriptions as different twins but the same date|amount match", () => {
    const plan = planCsvImport([row("2026-01-02", 25, "A"), row("2026-01-02", 25, "B")], []);
    expect(plan.rows.map((r) => r.occurrence)).toEqual([0, 0]);
  });

  it("matches amounts to the cent, signs included", () => {
    const plan = planCsvImport(
      [row("2026-01-02", 25.004), row("2026-01-02", -25)],
      [{ date: "2026-01-02", amount: 25 }]
    );
    expect(plan.skipped).toBe(1);
    expect(plan.rows.map((r) => r.amount)).toEqual([-25]);
  });

  it("is a no-op when the whole file is already there", () => {
    const file = [row("2026-01-02", 25), row("2026-01-02", 25), row("2026-01-05", 9.99)];
    const stored = file.map((r) => ({ date: r.date, amount: r.amount }));
    expect(planCsvImport(file, stored)).toEqual({ rows: [], skipped: 3 });
  });
});
