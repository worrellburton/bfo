import { describe, expect, it } from "vitest";
import { layoutEstate, mapEntities } from "../app/routes/estate-map";

describe("the estate map", () => {
  it("follows ownership on the records, with outside owners as partners", () => {
    const nodes = mapEntities(
      {
        t: { name: "Burton Family Revocable Trust", type: "Trust" },
        ll: { name: "Ledger Louise, LLC", ownerId: "t" },
        tal: {
          name: "TallulahMD LLC",
          ownerId: "ll",
          members: [
            { name: "Ledger Louise, LLC", percent: 50, role: "Member" },
            { name: "Sameh Elguizaoui", percent: 50, role: "Member" },
          ],
        },
        old: { name: "Gone, LLC", ownerId: "ll", status: "Dissolved" },
      },
      { "ledger louise, llc": 600 },
    );
    expect(nodes.map((n) => [n.name, n.parentId])).toEqual([
      ["Ledger Louise, LLC", "t"],
      ["Burton Family Revocable Trust", null],
      ["TallulahMD LLC", "ll"],
    ]);
    expect(nodes.find((n) => n.id === "tal")).toMatchObject({ partners: [{ name: "Sameh Elguizaoui", percent: 50 }], share: 50 });
  });

  it("keeps a holding company's subsidiaries in one vertical outline, a sub-subsidiary indented under its owner", () => {
    const entities = mapEntities({
      t: { name: "Burton Family Revocable Trust", type: "Trust" },
      sun: { name: "Sundown Investments", ownerId: "t" },
      other: { name: "Other Holdings", ownerId: "t" },
      pal: { name: "Palomino Ranch", ownerId: "sun" },
      hes: { name: "FDJ Hesperia", ownerId: "sun" },
      cfs: { name: "FDJ CFS", ownerId: "hes" },
    });
    const { byId, edges } = layoutEstate(entities);
    const sun = byId.get("sun")!;
    const other = byId.get("other")!;
    const pal = byId.get("pal")!;
    const hes = byId.get("hes")!;
    const cfs = byId.get("cfs")!;
    // The trust's holding companies sit side by side.
    expect(other.y).toBe(sun.y);
    expect(other.x + other.w).toBeLessThan(sun.x);
    // Under Sundown, one column: Hesperia and Palomino at the same step in, one above the other.
    expect(pal.x).toBe(hes.x);
    expect(pal.x).toBeGreaterThan(sun.x);
    expect(pal.y).not.toBe(hes.y);
    // FDJ CFS is directly under Hesperia, one step further in, joined to it by its own elbow.
    expect(cfs.y).toBeGreaterThan(hes.y + hes.h);
    expect(cfs.x - hes.x).toBe(hes.x - sun.x);
    const below = [pal, cfs].filter((b) => b.y > hes.y).sort((a, b) => a.y - b.y)[0];
    expect(below.id).toBe("cfs");
    expect(edges.find((e) => e.id === "cfs")?.parentId).toBe("hes");
    // Nothing of Sundown's column spills under Other Holdings.
    expect(Math.min(pal.x, cfs.x)).toBeGreaterThan(other.x + other.w);
  });
});
