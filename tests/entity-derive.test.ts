import { describe, expect, it } from "vitest";
import { deriveEntity } from "../app/entity/derive";
import type { Asset } from "../app/entity/model";

const derive = (asset: Asset) => deriveEntity({ asset, docs: [], contracts: [], allAssets: {}, kindsFor: () => [] });

describe("owners per the record", () => {
  it("counts a Manager who holds a share as an owner, as People does", () => {
    const asset = {
      name: "Sundown Partners, LLC",
      type: "LLC",
      llcType: "Partnership",
      members: [
        { name: "Claire B. Burton", percent: 50, role: "Member" },
        { name: "Robert L. Burton", percent: 50, role: "Manager" },
      ],
    } as Asset;
    const d = derive(asset);
    expect(d.docOwners.map((m) => m.name)).toEqual(["Claire B. Burton", "Robert L. Burton"]);
    expect(d.paper.ownerCount).toBe(2);
    expect(d.issues.map((i) => i.key)).not.toContain("partnership-one-owner");
  });

  it("leaves out a manager with no share, and a member at 0%", () => {
    const asset = {
      name: "Ledger Louise, LLC",
      type: "LLC",
      members: [
        { name: "Claire B. Burton", percent: 100, role: "Member" },
        { name: "Robert L. Burton", percent: null, role: "Manager" },
        { name: "Old Partner", percent: 0, role: "Member" },
      ],
    } as Asset;
    expect(derive(asset).docOwners.map((m) => m.name)).toEqual(["Claire B. Burton"]);
  });
});
