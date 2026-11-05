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

  it("keeps a company's subsidiaries in one vertical outline, a sub-subsidiary indented under its owner, while the top levels spread", () => {
    const entities = mapEntities({
      t: { name: "Burton Family Revocable Trust", type: "Trust" },
      ll: { name: "Ledger Louise", ownerId: "t" },
      sun: { name: "Sundown Investments", ownerId: "ll" },
      other: { name: "Other Holdings", ownerId: "ll" },
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
    // Ledger Louise's companies sit side by side under it, as the trust's holding companies do.
    expect(byId.get("ll")!.y).toBeGreaterThan(byId.get("t")!.y);
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

  it("with Owners on, a person or outside company sits above the entity they own a share of, with a line down into it", () => {
    const assets = {
      t: { name: "Burton Family Revocable Trust", type: "Trust" },
      ll: { name: "Ledger Louise, LLC", ownerId: "t" },
      sun: { name: "Sundown Investments", ownerId: "ll" },
      // A row child (the top levels spread): its owner keeps to the right of the parent's line.
      tal: {
        name: "TallulahMD LLC",
        ownerId: "ll",
        members: [
          { name: "Ledger Louise, LLC", percent: 50, role: "Member" },
          { name: "Sameh Elguizaoui", percent: 50, role: "Member" },
        ],
      },
      // A stacked child (a subsidiary's subsidiary): its owner takes a band above it inside the stack.
      pal: {
        name: "Palomino Ranch",
        ownerId: "sun",
        members: [
          { name: "Sundown Investments", percent: 70, role: "Member" },
          { name: "Jane Doe", percent: 30, role: "Member" },
        ],
      },
      hes: { name: "FDJ Hesperia", ownerId: "sun" },
    };
    const off = layoutEstate(mapEntities(assets));
    expect(off.boxes.some((b) => b.kind === "owner")).toBe(false);

    const entities = mapEntities(assets, {}, { people: true });
    const sam = entities.find((e) => e.name === "Sameh Elguizaoui")!;
    const jane = entities.find((e) => e.name === "Jane Doe")!;
    // An owner isn't a child of anything: it points at what it owns.
    expect(sam).toMatchObject({ parentId: null, person: { percent: 50, of: "tal" } });
    expect(jane.person).toEqual({ percent: 30, of: "pal" });

    const { byId, edges, childrenOf } = layoutEstate(entities);
    for (const [owner, owned] of [
      [sam.id, "tal"],
      [jane.id, "pal"],
    ] as const) {
      const o = byId.get(owner)!;
      const e = byId.get(owned)!;
      expect(o.kind).toBe("owner");
      // Directly above the entity, within its width, a short gap between them.
      expect(o.y + o.h).toBeLessThan(e.y);
      expect(e.y - (o.y + o.h)).toBeLessThanOrEqual(20);
      expect(o.x).toBeGreaterThanOrEqual(e.x);
      expect(o.x + o.w).toBeLessThanOrEqual(e.x + e.w + 1);
      // A straight line from the owner down into the entity's top edge, marked as an owner's line.
      const line = edges.find((d) => d.id === owner)!;
      expect(line).toMatchObject({ parentId: owned, owner: true });
      expect(line.d).toBe(`M ${o.x + o.w / 2} ${o.y + o.h} V ${e.y}`);
      // Not counted among the entity's subsidiaries.
      expect(childrenOf.get(owned) ?? []).not.toContain(owner);
    }
    // The entity's own line to its owner entity is still there, and still goes up to that entity.
    expect(edges.find((d) => d.id === "tal")).toMatchObject({ parentId: "ll" });
    expect(edges.find((d) => d.id === "tal")!.owner).toBeFalsy();
    expect(edges.find((d) => d.id === "pal")).toMatchObject({ parentId: "sun" });
    // In the row, Sameh's card leaves the parent's line, which comes down into the left part of TallulahMD's card.
    const tal = byId.get("tal")!;
    // The elbow ends "… Q x busY x busY+r V childY": x is where it comes down.
    const drop = Number(/(\S+) \S+ V \S+$/.exec(edges.find((d) => d.id === "tal")!.d)![1]);
    expect(drop).toBeLessThan(byId.get(sam.id)!.x);
    expect(drop).toBeGreaterThan(tal.x);
    // The owner and its line never overlap another entity's card.
    for (const b of [byId.get(sam.id)!, byId.get(jane.id)!]) {
      for (const other of byId.values()) {
        if (other.id === b.id) continue;
        const apart = b.x + b.w <= other.x || other.x + other.w <= b.x || b.y + b.h <= other.y || other.y + other.h <= b.y;
        expect(apart).toBe(true);
      }
    }
  });
});
