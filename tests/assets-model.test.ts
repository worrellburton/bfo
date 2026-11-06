import { describe, expect, it } from "vitest";
import {
  allocate,
  defaultClass,
  formatEin,
  inStates,
  initialsClash,
  isTrusteeLine,
  missingGroups,
  missingLine,
  ownersOf,
  recordsOf,
  sameName,
  sharedInitials,
  sharesTotal,
  stateChoices,
  taxLine,
  type EntityRec,
} from "../app/routes/assets-model";

// Made-up records only.
const trust: EntityRec = { id: "t", name: "Northwind Family Revocable Trust", type: "Trust", state: "Arizona", trustees: "Alex Rivera and Sam Rivera", grantors: "Alex Rivera, Sam Rivera" };
const holding: EntityRec = {
  id: "h",
  name: "Northwind Holdings, LLC",
  type: "LLC",
  state: "AZ",
  ownerId: "t",
  llcType: "Disregarded Entity",
  members: [{ name: "Alex Rivera and Sam Rivera", percent: null, role: "member" }],
};
const venture: EntityRec = {
  id: "v",
  name: "Alder Ventures, LLC",
  type: "LLC",
  state: "Nevada",
  ownerId: "h",
  llcType: "Disregarded Entity",
  members: [
    { name: "Northwind Holdings, LLC", percent: 80, role: "member" },
    { name: "Jordan Lee", percent: 20, role: "member" },
  ],
  foreign: { AZ: { agent: "" } },
};
const corp: EntityRec = { id: "c", name: "Birch Corp", type: "C-Corp", state: "Delaware" };
const all = new Map([trust, holding, venture, corp].map((e) => [e.id, e]));

describe("the entities list", () => {
  it("splits the missing points by largest remainder, so they add up to what's missing", () => {
    const parts = allocate([18, 16, 14, 8, 8, 6, 6, 6, 6, 3], 80);
    expect(parts.reduce((s, n) => s + n, 0)).toBe(80);
    expect(allocate([1, 1, 1], 10)).toEqual([4, 3, 3]);
    expect(allocate([], 10)).toEqual([]);
    const r = recordsOf(venture, all);
    expect([...r.points.values()].reduce((s, n) => s + n, 0)).toBe(100 - r.score);
  });

  it("reads owners from the members, with the owning trust's trustees counted as the trust", () => {
    expect(isTrusteeLine(holding.members![0], trust)).toBe(true);
    expect(ownersOf(holding, all)).toEqual([{ name: trust.name, percent: null, entityId: "t" }]);
    expect(ownersOf(venture, all)).toEqual([
      { name: holding.name, percent: 80, entityId: "h" },
      { name: "Jordan Lee", percent: 20 },
    ]);
    expect(sharesTotal(ownersOf(venture, all))).toBe(100);
    expect(ownersOf(trust, all)).toEqual([]);
  });

  it("flags a disregarded LLC with several owners as records that disagree", () => {
    const r = recordsOf(venture, all);
    expect(r.conflicts.map((c) => c.key)).toContain("disregarded-many-owners");
    expect(r.tone).toBe("negative");
    expect(recordsOf(holding, all).conflicts).toEqual([]);
  });

  it("flags owners' shares that don't add up to 100%", () => {
    const odd = {
      ...venture,
      llcType: "Partnership",
      members: [
        { name: "Northwind Holdings, LLC", percent: 10, role: "member" },
        { name: "Jordan Lee", percent: 20, role: "member" },
        { name: "Casey Kim", percent: 60, role: "member" },
      ],
    };
    expect(recordsOf(odd, new Map([...all, ["v", odd]])).conflicts.map((c) => c.title)).toContain("Owners' shares add up to 90%");
  });

  it("doesn't ask a trust for an EIN until its tax class is on record", () => {
    const r = recordsOf(trust, all);
    expect(r.items.some((i) => i.key === "ein")).toBe(false);
    expect(r.missing.find((i) => i.key === "llcType")?.label).toBe("Tax classification (grantor or non-grantor)");
    const nonGrantor = { ...trust, llcType: "Non-grantor trust" };
    expect(recordsOf(nonGrantor, all).missing.some((i) => i.key === "ein")).toBe(true);
  });

  it("names the return each entity files, and marks a class it assumed", () => {
    expect(taxLine(venture, all)).toMatchObject({ value: "Disregarded Entity", isDefault: false, files: `On the grantors' Form 1040, through ${trust.name}` });
    expect(taxLine(corp, all)).toMatchObject({ value: "C Corporation", isDefault: true, files: "Form 1120" });
  });

  it("groups and summarises what's missing, the count first and required items first", () => {
    const r = recordsOf(corp, all);
    const groups = missingGroups(r).map((g) => g.label);
    expect(groups[0]).toBe("Facts to record");
    expect(missingLine(r)).toMatch(/^\d+ missing · /);
    expect(missingLine({ ...r, missing: [] })).toBe("Everything on file");
  });

  it("filters by state of formation or foreign registration, folding codes into names", () => {
    const c = stateChoices([trust, holding, venture, corp]);
    expect(c.formed.get("Arizona")).toBe(2);
    expect(c.foreign.get("Arizona")).toBe(1);
    expect(inStates(venture, ["formed:Arizona"])).toBe(false);
    expect(inStates(venture, ["foreign:Arizona"])).toBe(true);
    expect(inStates(holding, ["formed:Arizona"])).toBe(true);
    expect(inStates({ id: "x", name: "X" }, ["none"])).toBe(true);
  });

  it("keeps initials unique", () => {
    const tags = [
      { id: "a", name: "Alder Ventures, LLC", tag: "AV" },
      { id: "b", name: "Birch Corp", tag: "BC" },
      { id: "c", name: "Alder Vista, LLC", tag: "AV" },
    ];
    expect(initialsClash("bc", "a", tags)).toBe("BC is already Birch Corp's initials.");
    expect(initialsClash("AV", "a", tags)).toBe("AV is already Alder Vista, LLC's initials.");
    expect(initialsClash("ZZ", "a", tags)).toBeNull();
    expect(initialsClash("TOO LONG", "a", tags)).toMatch(/4 letters/);
    expect([...sharedInitials(tags)].sort()).toEqual(["a", "c"]);
  });

  it("helps the new-entity form: a name already on record, an EIN as typed, the IRS default class", () => {
    expect(sameName("Northwind Holdings LLC", "northwind holdings, l.l.c.")).toBe(true);
    expect(sameName("Northwind Holdings LLC", "Northwind Partners LLC")).toBe(false);
    expect(sameName("Northwind Holdings LLC", "Northwind Holdings, LLC")).toBe(true);
    expect(formatEin("123456789")).toBe("12-3456789");
    expect(formatEin("12")).toBe("12");
    expect(defaultClass("LLC", "one")).toBe("Disregarded Entity");
    expect(defaultClass("LLC", "several")).toBe("Partnership");
    expect(defaultClass("C-Corp", null)).toBe("C Corporation");
    expect(defaultClass("Trust", null, true)).toBe("Grantor trust");
  });
});
