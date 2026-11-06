import { describe, expect, it } from "vitest";
import { defaultTaxStatus, isDormant, isRetirement, ownerConflict, ownerOf, registration, stripBankMask, validateOwner } from "../app/treasury-model";

describe("registration and ownership", () => {
  it("reads the custodian's registration from the account name", () => {
    expect(registration("TRADITIONAL_IRA", "ira")).toEqual({ kind: "retirement", label: "Traditional IRA" });
    expect(registration("ROLLOVER_IRA", "ira")).toEqual({ kind: "retirement", label: "Rollover IRA" });
    expect(registration("JOINT_TENANTS_WROS", "brokerage")).toEqual({ kind: "joint", label: "Joint (JTWROS)" });
    expect(registration("INDIVIDUAL", "brokerage")).toEqual({ kind: "individual", label: "Individual" });
    expect(registration("LIVING_TRUST", "trust")).toEqual({ kind: "trust", label: "Living trust" });
    expect(registration("Operating checking", "checking")).toBeNull();
  });

  it("flags an IRA or a personal account mapped to an entity", () => {
    expect(ownerConflict({ name: "TRADITIONAL_IRA", subtype: "ira", entity_id: "t1" }, true)).toMatch(
      /^Registered as a Traditional IRA\. It belongs to one person; the trust can only be named as its beneficiary\.$/,
    );
    expect(ownerConflict({ name: "JOINT_TENANTS_WROS", subtype: "brokerage", entity_id: "t1" }, true)).toMatch(/joint owners unless it has been retitled to the trust/);
    expect(ownerConflict({ name: "TRADITIONAL_IRA", subtype: "ira", owner_kind: "person" }, true)).toBeNull();
    expect(ownerConflict({ name: "LIVING_TRUST", subtype: "trust", entity_id: "t1" }, true)).toBeNull();
  });

  it("defaults tax status from the type", () => {
    expect(defaultTaxStatus("ira", "TRADITIONAL_IRA")).toBe("tax_deferred");
    expect(defaultTaxStatus("roth", null)).toBe("tax_exempt");
    expect(defaultTaxStatus("brokerage", "INDIVIDUAL", "investment")).toBe("taxable");
    expect(isRetirement("401k")).toBe(true);
    expect(isRetirement("trust", "LIVING_TRUST")).toBe(false);
  });
});

describe("validateOwner", () => {
  it("clears the entity for a person or joint owner", () => {
    const r = validateOwner(
      { owner_kind: "person", owner_names: [" Alex Rivera "], tax_status: "tax_deferred", beneficiary_entity_id: "t1", beneficiary_name: "Rivera Family Trust" },
      { subtype: "ira" },
    );
    expect(r).toEqual({
      ok: true,
      row: {
        owner_kind: "person",
        owner_names: ["Alex Rivera"],
        tenancy: null,
        entity_id: null,
        entity_name: null,
        tax_status: "tax_deferred",
        beneficiary_entity_id: "t1",
        beneficiary_name: "Rivera Family Trust",
      },
    });
  });
  it("refuses to give a retirement account to an entity or to joint owners", () => {
    expect(validateOwner({ entity_id: "t1", entity_name: "Trust" }, { subtype: "ira" }).ok).toBe(false);
    expect(validateOwner({ owner_kind: "joint", owner_names: ["A", "B"], tenancy: "jtwros" }, { subtype: "roth" }).ok).toBe(false);
  });
  it("needs both joint owners and their form of ownership", () => {
    expect(validateOwner({ owner_kind: "joint", owner_names: ["A"] }, {}).ok).toBe(false);
    expect(validateOwner({ owner_kind: "joint", owner_names: ["A", "B"] }, {}).ok).toBe(false);
    expect(validateOwner({ owner_kind: "joint", owner_names: ["A", "B"], tenancy: "jtwros" }, {}).ok).toBe(true);
  });
  it("treats an empty entity as no owner", () => {
    expect(validateOwner({ entity_id: "" }, {})).toEqual({ ok: true, row: { owner_kind: null, owner_names: null, tenancy: null, entity_id: null, entity_name: null } });
  });
});

describe("names and states", () => {
  it("drops the bank's own mask from a name", () => {
    expect(stripBankMask("PREMIER CHECKING ...1886", "1886")).toBe("PREMIER CHECKING");
    expect(stripBankMask("Card x4521", "4521")).toBe("Card");
    expect(stripBankMask("Savings", "4521")).toBe("Savings");
  });
  it("groups by the true owner", () => {
    const name = (id: string) => (id === "e1" ? "Northwind Holdings, LLC" : null);
    expect(ownerOf({ owner_kind: "person", owner_names: ["Alex Rivera"] }, name)).toEqual({ key: "person:alex rivera", label: "Alex Rivera", kind: "person" });
    expect(ownerOf({ owner_kind: "joint", owner_names: ["Sam", "Alex"] }, name).label).toBe("Alex & Sam");
    expect(ownerOf({ entity_id: "e1" }, name).label).toBe("Northwind Holdings, LLC");
    expect(ownerOf({ entity_id: "gone" }, name).kind).toBe("none");
  });
  it("reads an empty, unmoved account as dormant", () => {
    const now = new Date("2026-11-06T12:00:00Z");
    expect(isDormant({ balance_current: 0, last_activity: null }, now)).toBe(true);
    expect(isDormant({ balance_current: 0, last_activity: "2026-10-01" }, now)).toBe(false);
    expect(isDormant({ balance_current: 0, last_activity: "2026-07-01" }, now)).toBe(true);
    expect(isDormant({ balance_current: 12, last_activity: null }, now)).toBe(false);
  });
});
