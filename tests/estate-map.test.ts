import { describe, expect, it } from "vitest";
import { mapEntities } from "../app/routes/estate-map";

describe("the estate map", () => {
  it("follows ownership on the records, with outside owners as partners", () => {
    const nodes = mapEntities(
      {
        t: { name: "Burton Family Revocable Trust", type: "Trust" },
        ll: { name: "Ledger Louise, LLC", ownerId: "t" },
        tal: { name: "TallulahMD LLC", ownerId: "ll", members: [{ name: "Ledger Louise, LLC", percent: 50, role: "Member" }, { name: "Sameh Elguizaoui", percent: 50, role: "Member" }] },
        old: { name: "Gone, LLC", ownerId: "ll", status: "Dissolved" },
      },
      { "ledger louise, llc": 600 }
    );
    expect(nodes.map((n) => [n.name, n.parentId])).toEqual([
      ["Ledger Louise, LLC", "t"],
      ["Burton Family Revocable Trust", null],
      ["TallulahMD LLC", "ll"],
    ]);
    expect(nodes.find((n) => n.id === "tal")).toMatchObject({ partners: [{ name: "Sameh Elguizaoui", percent: 50 }], share: 50 });
  });
});
