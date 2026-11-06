import { describe, expect, it } from "vitest";
import {
  applyOwnerChange,
  capTableChecks,
  classificationNote,
  historyWords,
  legacyStrings,
  linkedEntity,
  managersOnRecord,
  nextOwnerId,
  ownerRoles,
  trustPatch,
  trustPeopleOf,
  type OwnerRow,
} from "../app/entity/people-model";

const three: OwnerRow[] = [
  { name: "Northwind Holdings, LLC", percent: 65, role: "Member", entityId: "nw" },
  { name: "Alex Rivera", percent: 20, role: "Member" },
  { name: "Sam Lee", percent: 15, role: "Member" },
];

describe("managers on record", () => {
  it("never concludes how an entity is run from an empty list", () => {
    const m = managersOnRecord({ members: [{ name: "Northwind Holdings, LLC", percent: 100, role: "Member" }] });
    expect(m.list).toEqual([]);
    expect(m.source).toBeNull();
    expect(m.managerManaged).toBe(false);
  });

  it("reads the state's record, with its source, when the owner list has none", () => {
    const m = managersOnRecord({
      members: [{ name: "Northwind Holdings, LLC", percent: 100, role: "Member" }],
      state: "Nevada",
      stateRecord: {
        mode: "live",
        checkedAt: 1,
        people: [
          { role: "Manager", name: "Alex Rivera" },
          { role: "Registered Agent", name: "Agent Co" },
        ],
      },
    });
    expect(m.list.map((x) => x.name)).toEqual(["Alex Rivera"]);
    expect(m.source).toBe("Nevada’s record");
    expect(m.onOwnerList).toBe(false);
    expect(m.missing).toHaveLength(1);
    expect(m.managerManaged).toBe(true);
  });

  it("falls back to the operating agreement as read by AI, and says so", () => {
    const m = managersOnRecord({ profile: { managers: ["Sam Lee"], management: "Manager-managed" } as never });
    expect(m.source).toBe("The operating agreement, read by AI");
    expect(m.managerManaged).toBe(true);
  });
});

describe("ownership changes are transactions", () => {
  it("moves a transfer's share from the named owner, keeping 100%", () => {
    const r = applyOwnerChange(three, { kind: "add", owner: { name: "Jo Park", percent: 10, role: "Member" }, how: "transfer", counterparty: "Northwind Holdings, LLC", effective: "2026-10-01" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.owners.find((m) => m.name === "Northwind Holdings, LLC")?.percent).toBe(55);
    expect(r.total).toBe(100);
    expect(r.entry).toMatchObject({ kind: "add", how: "transfer", name: "Jo Park", to: 10, counterparty: "Northwind Holdings, LLC", effective: "2026-10-01" });
    expect(historyWords(r.entry)).toBe("Jo Park added at 10%, transferred from Northwind Holdings, LLC");
  });

  it("dilutes everyone pro rata for a new issuance", () => {
    const r = applyOwnerChange(three, { kind: "add", owner: { name: "Jo Park", percent: 20, role: "Member" }, how: "issuance", effective: "2026-10-01" });
    expect(r.ok && r.owners.map((m) => m.percent)).toEqual([52, 16, 12, 20]);
  });

  it("refuses a change that leaves the shares off 100%, unless it's a correction", () => {
    const bad = applyOwnerChange(three, { kind: "edit", index: 2, owner: { ...three[2], percent: 20 }, how: "transfer", counterparty: "Nobody", effective: "2026-10-01" });
    expect(bad.ok).toBe(false);
    const fix = applyOwnerChange(three, { kind: "edit", index: 2, owner: { ...three[2], percent: 20 }, how: "correction", effective: null });
    expect(fix.ok && fix.total).toBe(105);
  });

  it("needs a date for anything but a correction, and a share above zero for a new owner", () => {
    expect(applyOwnerChange(three, { kind: "add", owner: { name: "Jo Park", percent: 10, role: "Member" }, how: "transfer", counterparty: "Sam Lee", effective: null })).toMatchObject({
      ok: false,
      field: "effective",
    });
    expect(applyOwnerChange(three, { kind: "add", owner: { name: "Jo Park", percent: 0, role: "Member" }, how: "correction", effective: null })).toMatchObject({ ok: false, field: "share" });
    expect(applyOwnerChange(three, { kind: "add", owner: { name: "alex  rivera", percent: 5, role: "Member" }, how: "correction", effective: null })).toMatchObject({ ok: false, field: "name" });
  });

  it("gives a departing owner's share to the one who received it, or rescales for a redemption", () => {
    const t = applyOwnerChange(three, { kind: "remove", index: 2, how: "transfer", counterparty: "Alex Rivera", effective: "2026-10-01" });
    expect(t.ok && t.owners.map((m) => [m.name, m.percent])).toEqual([
      ["Northwind Holdings, LLC", 65],
      ["Alex Rivera", 35],
    ]);
    const red = applyOwnerChange(three, { kind: "remove", index: 1, how: "redemption", effective: "2026-10-01" });
    expect(red.ok && red.total).toBe(100);
  });
});

describe("what follows from the owner list", () => {
  it("warns when the owner count and the tax class disagree", () => {
    expect(classificationNote("LLC", "Disregarded Entity", 3)?.suggest).toBe("Partnership");
    expect(classificationNote("LLC", "Partnership", 1)?.suggest).toBe("Disregarded Entity");
    expect(classificationNote("LLC", "Partnership", 2)).toBeNull();
    expect(classificationNote("C-Corp", "Disregarded Entity", 3)).toBeNull();
  });

  it("follows the largest family entity for the header's owner, and leaves it alone when none is listed", () => {
    const fam = [
      { id: "nw", name: "Northwind Holdings, LLC" },
      { id: "tr", name: "Rivera Family Trust" },
    ];
    expect(nextOwnerId(three, fam, "nw")).toBe("nw");
    expect(nextOwnerId([{ name: "Alex Rivera", percent: 100, role: "Member" }], fam, "nw")).toBeUndefined();
    const trustRow: OwnerRow = { name: "Alex Rivera, Trustee of the Rivera Family Trust, dated Jan 1, 2020", percent: 100, role: "Member" };
    expect(linkedEntity(trustRow, fam, "tr")).toEqual({ id: "tr", name: "Rivera Family Trust" });
  });

  it("offers roles that fit the entity", () => {
    expect(ownerRoles("LLC")).toEqual(["Member", "Managing member"]);
    expect(ownerRoles("C-Corp")).toEqual(["Shareholder"]);
    expect(ownerRoles("LP")).toEqual(["General partner", "Limited partner"]);
  });
});

describe("a trust's people", () => {
  it("keeps a name with a comma as one person, and writes the strings older readers use", () => {
    const people = [
      { name: "First Fiduciary Trust Company, N.A.", role: "trustee" as const },
      { name: "Alex Rivera", role: "successor" as const, order: 1 },
      { name: "Sam Lee", role: "grantor" as const },
    ];
    const patch = trustPatch(people);
    expect(patch.trustees).toBe("First Fiduciary Trust Company, N.A.");
    expect(patch.successorTrustees).toBe("Alex Rivera");
    const back = trustPeopleOf({ ...(patch as Record<string, string>), trustPeople: people, beneficiaries: "" });
    expect(back.structured).toBe(true);
    expect(back.people).toHaveLength(3);
  });

  it("follows the strings when someone changed them elsewhere, keeping what it knew", () => {
    const people = [
      { name: "Alex Rivera", role: "trustee" as const, since: "2020-01-01" },
      { name: "Sam Lee", role: "beneficiary" as const, class: "remainder" as const },
    ];
    const strings = legacyStrings(people);
    const r = trustPeopleOf({ ...strings, trustees: "Alex Rivera, Jo Park", trustPeople: people });
    expect(r.structured).toBe(false);
    expect(r.people.map((p) => [p.name, p.role])).toEqual([
      ["Alex Rivera", "trustee"],
      ["Jo Park", "trustee"],
      ["Sam Lee", "beneficiary"],
    ]);
    expect(r.people[0].since).toBe("2020-01-01");
    expect(r.people[2].class).toBe("remainder");
  });
});

describe("a corporation's cap table", () => {
  it("flags over-issuance and holdings that don't foot", () => {
    const c = capTableChecks({ authorized: 1000, issued: 1200, holders: [{ name: "Alex Rivera", shares: 600 }] });
    expect(c.map((x) => x.text)).toEqual([
      "1,200 shares are recorded as issued but only 1,000 are authorized: an over-issuance. Check the articles and the stock ledger.",
      "The shareholders hold 600 shares; 1,200 are issued.",
    ]);
  });

  it("checks an S corporation's one class and its holders", () => {
    const c = capTableChecks({
      issued: 100,
      holders: [
        { name: "Alex Rivera", shares: 60, shareClass: "Common", percent: 60 },
        { name: "Northwind Holdings, LLC", shares: 40, shareClass: "Preferred", percent: 40 },
      ],
      taxClass: "S Corporation",
    });
    expect(c.some((x) => /one class of stock/.test(x.text))).toBe(true);
    expect(c.some((x) => /Northwind Holdings, LLC may not be an eligible/.test(x.text))).toBe(true);
  });
});
