import { describe, expect, it } from "vitest";
import {
  addressState,
  documentRules,
  entityType,
  obligations,
  paperworkChecks,
  stateCode,
  taxClassOf,
  taxHome,
} from "../app/entity-paperwork";
import { entityCompleteness } from "../app/entity-completeness";

const PHX = "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028";
const today = new Date("2026-10-06T12:00:00Z");
const keys = (r: { key: string }[]) => r.map((x) => x.key);

describe("states and types", () => {
  it("reads states from names, codes and addresses", () => {
    expect(stateCode("Arizona")).toBe("AZ");
    expect(stateCode("nv")).toBe("NV");
    expect(stateCode("Narnia")).toBeNull();
    expect(addressState(PHX)).toBe("AZ");
    expect(addressState("540 Hudson #6, New York, NY 10014")).toBe("NY");
  });

  it("knows a limited partnership and a trust from a legacy LLC record", () => {
    expect(entityType({ name: "HSL Placita West Ltd Partnership", type: "LLC" })).toBe("LP");
    expect(entityType({ name: "Burton Family Revocable Trust", type: "LLC" })).toBe("Trust");
    expect(entityType({ name: "Persons Lodge LLC (100%)", type: "LLC" })).toBe("LLC");
  });

  it("applies the IRS default classes", () => {
    expect(taxClassOf({ name: "X, LLC", owner: { name: "Parent, LLC" } }).value).toBe("Disregarded Entity");
    expect(taxClassOf({ name: "X, LLC", ownerCount: 2 }).value).toBe("Partnership");
    expect(taxClassOf({ name: "X Ltd Partnership" }).value).toBe("Partnership");
    expect(taxClassOf({ name: "X, LLC", llcType: "S Corporation" })).toEqual({ value: "S Corporation", isDefault: false });
  });
});

describe("documents by state and type", () => {
  it("names the formation filing the way each state does", () => {
    expect(documentRules({ name: "Ledger Burton, LLC", state: "Delaware" })[0].title).toBe("Certificate of Formation");
    expect(documentRules({ name: "Sundown, LLC", state: "Arizona" })[0].title).toBe("Articles of Organization");
    expect(documentRules({ name: "VQ", type: "C-Corp", state: "Arizona" })[0].title).toBe("Articles of Incorporation");
    expect(documentRules({ name: "Catalog Digital, Inc", type: "C-Corp", state: "Delaware" })[0].title).toBe("Certificate of Incorporation");
    expect(documentRules({ name: "HSL Placita West Ltd Partnership", state: "Arizona" })[0].title).toBe("Certificate of Limited Partnership");
  });

  it("asks an Arizona LLC for no annual report", () => {
    expect(keys(documentRules({ name: "Sundown, LLC", state: "Arizona", address: PHX, formationDate: "2023-08-16" }, today))).not.toContain("annualReport");
  });

  it("asks Nevada and Arizona corporations for their annual filings", () => {
    const nv = documentRules({ name: "Ledger Louise, LLC", state: "Nevada", address: PHX, formationDate: "2023-08-11" }, today);
    expect(nv.find((r) => r.key === "annualReport")?.level).toBe("required");
    const az = documentRules({ name: "VQ", type: "C-Corp", state: "Arizona", formationDate: "2010-01-01" }, today);
    expect(az.find((r) => r.key === "annualReport")?.title).toMatch(/Arizona Annual Report/);
  });

  it("doesn't ask for an annual report before the first one is due", () => {
    const young = documentRules({ name: "New, LLC", state: "Nevada", formationDate: "2026-06-01" }, today);
    expect(young.find((r) => r.key === "annualReport")?.level).toBe("recommended");
  });

  it("requires foreign registration when formed in one state and run from another", () => {
    const de = documentRules({ name: "Ledger Burton, LLC", state: "Delaware", address: PHX });
    expect(de.find((r) => r.key === "foreignRegistration")?.title).toBe("Arizona Foreign Registration Statement (Form L025)");
    const corp = documentRules({ name: "Catalog Digital, Inc", type: "C-Corp", state: "Delaware", address: "540 Hudson #6, New York, NY 10014" });
    expect(corp.find((r) => r.key === "foreignRegistration")?.title).toBe("New York Application for Authority");
    expect(keys(documentRules({ name: "Sundown, LLC", state: "Arizona", address: PHX }))).not.toContain("foreignRegistration");
  });

  it("requires the S election and its acceptance for an S corporation", () => {
    const r = keys(documentRules({ name: "X, LLC", state: "Arizona", llcType: "S Corporation" }));
    expect(r).toEqual(expect.arrayContaining(["sElection", "sElectionAccepted"]));
    expect(keys(documentRules({ name: "X, LLC", state: "Arizona", llcType: "C Corporation" }))).toContain("classElection");
  });

  it("gives a revocable trust a trust's paperwork and no EIN", () => {
    const r = documentRules({ name: "Burton Family Revocable Trust", type: "Trust", llcType: "Grantor trust", state: "Arizona" });
    expect(keys(r)).toEqual(["trustAgreement", "trustCertificate", "trustSchedule"]);
    const irrevocable = documentRules({ name: "X Trust", type: "Trust", llcType: "Non-grantor trust" });
    expect(keys(irrevocable)).toContain("einLetter");
  });

  it("tells a disregarded LLC its W-9 goes in the owner's name", () => {
    const w9 = documentRules({ name: "Swisshelm, LLC", llcType: "Disregarded Entity" }).find((r) => r.key === "w9");
    expect(w9?.why).toMatch(/owner's name/);
  });
});

describe("deadlines", () => {
  it("puts the Nevada list at the end of the anniversary month", () => {
    const o = obligations({ name: "Ledger Louise, LLC", state: "Nevada", formationDate: "2023-08-11" }, today);
    expect(o.find((x) => x.key === "state-annual")?.due).toBe("2027-08-31");
  });

  it("puts Delaware LLC tax on June 1 and corporate franchise tax on March 1", () => {
    expect(obligations({ name: "Ledger Burton, LLC", state: "Delaware" }, today).find((x) => x.key === "state-annual")?.due).toBe("2027-06-01");
    expect(obligations({ name: "Catalog Digital, Inc", type: "C-Corp", state: "Delaware" }, today).find((x) => x.key === "state-annual")?.due).toBe("2027-03-01");
  });

  it("puts an Arizona corporation's report on its anniversary", () => {
    expect(obligations({ name: "VQ", type: "C-Corp", state: "Arizona", formationDate: "1999-11-20" }, today).find((x) => x.key === "state-annual")?.due).toBe("2026-11-20");
  });

  it("picks the federal return from the tax class", () => {
    expect(obligations({ name: "X, LLC", llcType: "Partnership" }, today).find((x) => x.key === "fed")?.title).toMatch(/1065/);
    expect(obligations({ name: "X, LLC", llcType: "Partnership" }, today).find((x) => x.key === "fed")?.due).toBe("2027-03-15");
    expect(obligations({ name: "X, Inc", type: "C-Corp" }, today).find((x) => x.key === "fed")?.due).toBe("2027-04-15");
    expect(obligations({ name: "X, LLC", llcType: "Disregarded Entity" }, today, "Ledger Louise, LLC's Form 1065").find((x) => x.key === "fed")?.note).toMatch(/Ledger Louise/);
  });

  it("notes the Arizona dormancy check-in for Arizona LLCs", () => {
    expect(obligations({ name: "Sundown, LLC", state: "Arizona" }, today).map((x) => x.key)).toContain("az-dormancy");
  });
});

describe("checks", () => {
  it("flags a partnership with one owner on record", () => {
    const i = paperworkChecks({ name: "Swisshelm, LLC", state: "Arizona", llcType: "Partnership", owner: { name: "Ledger Louise, LLC" }, registeredAgent: "A" });
    expect(i.map((x) => x.key)).toContain("partnership-one-owner");
  });

  it("flags a disregarded LLC with several owners", () => {
    const i = paperworkChecks({ name: "X, LLC", state: "Arizona", llcType: "Disregarded Entity", ownerCount: 2, registeredAgent: "A" });
    expect(i.map((x) => x.key)).toContain("disregarded-many-owners");
  });

  it("flags an S corporation owned by a partnership", () => {
    const i = paperworkChecks({ name: "X, LLC", llcType: "S Corporation", owner: { name: "P, LLC", llcType: "Partnership" } });
    expect(i.map((x) => x.key)).toContain("s-corp-owner");
    const ok = paperworkChecks({ name: "X, LLC", llcType: "S Corporation", owner: { name: "Burton Family Revocable Trust", type: "Trust", llcType: "Grantor trust" } });
    expect(ok.map((x) => x.key)).not.toContain("s-corp-owner");
  });

  it("knows Phoenix needed no publication", () => {
    const i = paperworkChecks({ name: "Sundown, LLC", state: "Arizona", address: PHX, registeredAgent: "A" });
    expect(i.find((x) => x.key === "az-publication")?.title).toMatch(/handled by the ACC/);
  });
});

describe("tax roll-up", () => {
  const recs: Record<string, any> = {
    trust: { name: "Burton Family Revocable Trust", type: "Trust", llcType: "Grantor trust", grantors: "Robert Burton" },
    louise: { name: "Ledger Louise, LLC", llcType: "Disregarded Entity", ownerId: "trust" },
    swiss: { name: "Swisshelm, LLC", llcType: "Disregarded Entity", ownerId: "louise" },
    part: { name: "Partners, LLC", llcType: "Partnership" },
    child: { name: "Child, LLC", llcType: "Disregarded Entity", ownerId: "part" },
  };
  const lookup = (id: string) => recs[id];
  it("follows disregarded owners to the grantor", () => {
    expect(taxHome(recs.swiss, lookup)?.form).toBe("Form 1040");
    expect(taxHome(recs.swiss, lookup)?.name).toMatch(/Robert Burton/);
  });
  it("stops at the first owner that files", () => {
    expect(taxHome(recs.child, lookup)).toEqual({ name: "Partners, LLC", form: "Form 1065" });
    expect(taxHome(recs.part, lookup)).toBeNull();
  });
});

describe("completeness on the rule book", () => {
  it("scores a fully papered Delaware LLC run from Arizona only once it's registered there", () => {
    const base = {
      name: "Ledger Burton, LLC", type: "LLC", state: "Delaware", address: PHX, ein: "93-3749778", formationDate: "2023-08-17",
      registeredAgent: "Agent", llcType: "Disregarded Entity", articles: {}, einLetter: {}, w9: {}, operatingAgreement: {},
    };
    const before = entityCompleteness(base, today);
    expect(before.score).toBeLessThan(100);
    expect(before.missing.map((m) => m.key)).toContain("foreignRegistration");
    expect(entityCompleteness({ ...base, foreignRegistration: {} }, today).score).toBe(100);
  });

  it("never scores recommended paperwork", () => {
    const r = entityCompleteness({ name: "Sundown, LLC", state: "Arizona", address: PHX }, today);
    expect(r.items.map((i) => i.key)).not.toContain("goodStanding");
    expect(r.recommended.map((i) => i.key)).toContain("goodStanding");
  });
});
