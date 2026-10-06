import { describe, expect, it } from "vitest";
import { entityCompleteness, entityType } from "../app/entity-completeness";

describe("entityType", () => {
  it("reads a legacy LLC record named Trust as a trust", () => {
    expect(entityType({ name: "Burton Family Revocable Trust", type: "LLC" })).toBe("Trust");
    expect(entityType({ name: "Ledger Louise, LLC", type: "LLC" })).toBe("LLC");
    expect(entityType({ name: "Trustworthy Inc", type: "C-Corp" })).toBe("C-Corp");
  });
});

describe("entityCompleteness", () => {
  it("weights an LLC to 100", () => {
    const full = entityCompleteness({
      name: "A, LLC", type: "LLC", ein: "12-3456789", state: "Nevada", formationDate: "2020-01-01",
      address: "1 Main", registeredAgent: "Agent", llcType: "Partnership",
      einLetter: {}, w9: {}, articles: {}, operatingAgreement: {}, annualReport: {},
    });
    expect(full.score).toBe(100);
    expect(full.missing).toEqual([]);
    expect(entityCompleteness({ name: "A, LLC", type: "LLC" }).score).toBe(0);
  });

  it("lists the heaviest gaps first", () => {
    const { missing } = entityCompleteness({ name: "A, LLC", type: "LLC", ein: "12-3456789" });
    expect(missing[0].key).toBe("articles");
    expect(missing.every((m, i) => i === 0 || missing[i - 1].weight >= m.weight)).toBe(true);
  });

  it("holds a trust to a trust's paperwork", () => {
    const r = entityCompleteness({ name: "Burton Family Revocable Trust", type: "LLC" });
    expect(r.items.map((i) => i.key)).toContain("trustAgreement");
    expect(r.items.map((i) => i.key)).not.toContain("articles");
  });

  it("does not ask a grantor trust for its own EIN", () => {
    const grantor = entityCompleteness({ name: "X Trust", type: "Trust", llcType: "Grantor trust" });
    expect(grantor.items.find((i) => i.key === "ein")?.done).toBe(true);
    const other = entityCompleteness({ name: "X Trust", type: "Trust", llcType: "Non-grantor trust" });
    expect(other.items.find((i) => i.key === "ein")?.done).toBe(false);
  });
});
