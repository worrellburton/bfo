import { describe, expect, it } from "vitest";
import { addressState, documentRules, entityType, filingAgency, obligations, paperworkChecks, slotCurrent, stateCode, taxClassIssues, taxClassOf, taxHome } from "../app/entity-paperwork";
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
    expect(entityType({ name: "Burton Trust Holdings, LLC", type: "LLC" })).toBe("LLC");
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
      name: "Ledger Burton, LLC",
      type: "LLC",
      state: "Delaware",
      address: PHX,
      ein: "93-3749778",
      formationDate: "2023-08-17",
      registeredAgent: "Agent",
      registeredAgentAddress: "1 Rodney Sq, Wilmington, DE 19801",
      llcType: "Disregarded Entity",
      articles: {},
      einLetter: {},
      w9: {},
      operatingAgreement: {},
      // Answered: it does business in Arizona, so the registration there counts.
      foreign: { AZ: { confirmed: true } },
    };
    const before = entityCompleteness(base, today);
    expect(before.score).toBeLessThan(100);
    expect(before.missing.map((m) => m.key)).toEqual(expect.arrayContaining(["foreignRegistration", "foreign:AZ"]));
    // Registered there takes the filing and an Arizona statutory agent.
    expect(entityCompleteness({ ...base, foreignRegistration: {} }, today).score).toBeLessThan(100);
    expect(entityCompleteness({ ...base, foreignRegistration: {}, foreign: { AZ: { confirmed: true, agent: "Palm", agentAddress: "2 N Central Ave, Phoenix, AZ 85004" } } }, today).score).toBe(100);
  });

  it("never scores recommended paperwork", () => {
    const r = entityCompleteness({ name: "Sundown, LLC", state: "Arizona", address: PHX }, today);
    expect(r.items.map((i) => i.key)).not.toContain("goodStanding");
    expect(r.recommended.map((i) => i.key)).toContain("goodStanding");
  });
});

// Made-up records: periods, records of filing, and the returns the rule book now knows.
describe("periods", () => {
  const nov = new Date("2026-11-06T12:00:00Z");
  const nv = { name: "Northwind Holdings, LLC", state: "Nevada", formationDate: "2023-08-11" };
  const annual = (o: ReturnType<typeof obligations>) => o.find((x) => x.key === "state-annual")!;

  it("keeps the period that came due beside the next one, unrecorded until someone says", () => {
    const a = annual(obligations(nv, nov));
    expect(a.last).toMatchObject({ key: "state-annual-2026", label: "2026", due: "2026-08-31", status: "unrecorded", daysLate: 67 });
    expect(a.next).toMatchObject({ key: "state-annual-2027", due: "2027-08-31", status: "upcoming" });
    expect(a.due).toBe("2027-08-31");
    expect(a.overdue).toBeFalsy();
  });

  it("calls it overdue when the state shows filings behind, and puts it first", () => {
    const rec = { mode: "live", checkedAt: Date.parse("2026-11-02"), status: "active", standing: { registration: "not_compliant" } };
    const o = obligations({ ...nv, stateRecord: rec }, nov);
    expect(o[0].key).toBe("state-annual");
    expect(o[0]).toMatchObject({ overdue: true, due: "2026-08-31", lateFee: "$75 list + $100 license" });
    expect(o[0].consequence).toMatch(/revokes its charter/);
  });

  it("takes the state's word that it's current when read after the due date, but not a sandbox read", () => {
    const ok = { mode: "live", checkedAt: Date.parse("2026-10-01"), status: "active", standing: { registration: "compliant" } };
    expect(annual(obligations({ ...nv, stateRecord: ok }, nov)).last).toMatchObject({ status: "current", source: "state" });
    expect(annual(obligations({ ...nv, stateRecord: { ...ok, mode: "test" } }, nov)).last?.status).toBe("unrecorded");
    expect(annual(obligations({ ...nv, stateRecord: { ...ok, checkedAt: Date.parse("2026-07-01") } }, nov)).last?.status).toBe("unrecorded");
  });

  it("counts a period recorded as filed, or that year's copy in Documents", () => {
    const filed = annual(obligations({ ...nv, filedPeriods: { "state-annual-2026": { on: "2026-08-20", confirmation: "X1" } } }, nov));
    expect(filed.last).toMatchObject({ status: "filed", record: { on: "2026-08-20" } });
    expect(annual(obligations({ ...nv, annualReportYear: 2026 }, nov)).last).toMatchObject({ status: "filed", source: "documents" });
  });

  it("moves a return to its extended date, and back to unrecorded once that passes", () => {
    const p = { name: "Alder, LLC", llcType: "Partnership", formationDate: "2020-01-01" };
    const ext = { "fed-2025": { on: "2026-03-10", kind: "extended" as const } };
    const sep = obligations({ ...p, filedPeriods: ext }, new Date("2026-09-01T12:00:00Z")).find((x) => x.key === "fed")!;
    expect(sep.last).toMatchObject({ status: "extended", extendedTo: "2026-09-15" });
    expect(sep.due).toBe("2026-09-15");
    const later = obligations({ ...p, filedPeriods: ext }, nov).find((x) => x.key === "fed")!;
    expect(later.last).toMatchObject({ status: "unrecorded", daysLate: 52 });
  });

  it("has no past period before the entity existed, and follows a fiscal year", () => {
    expect(obligations({ name: "New, LLC", llcType: "Partnership", formationDate: "2026-06-01" }, nov).find((x) => x.key === "fed")!.last).toBeNull();
    const fy = obligations({ name: "Fiscal, Inc", type: "C-Corp", taxYearEnd: 6 }, nov).find((x) => x.key === "fed")!;
    expect(fy.last).toMatchObject({ label: "FY ending Jun 30, 2026", due: "2026-10-15" });
    expect(fy.next).toMatchObject({ label: "FY ending Jun 30, 2027", due: "2027-10-15" });
  });

  it("adds Arizona's returns, estimates and information returns, the last two only on their condition", () => {
    const keys = (o: ReturnType<typeof obligations>) => o.map((x) => x.key);
    const az = obligations({ name: "Alder, LLC", state: "Arizona", llcType: "Partnership" }, nov);
    expect(az.find((x) => x.key === "az-return")).toMatchObject({ title: "Arizona Form 165 (partnership return)", due: "2027-03-15" });
    const corp = obligations({ name: "Alder, Inc", type: "C-Corp", state: "Arizona" }, nov);
    expect(keys(corp)).toEqual(expect.arrayContaining(["fed", "az-return", "fed-estimates", "1099"]));
    const est = corp.find((x) => x.key === "fed-estimates")!;
    expect(est).toMatchObject({ due: null, when: "2026-12-15" });
    expect(est.conditional).toMatch(/\$500/);
    expect(corp.find((x) => x.key === "1099")?.conditional).toMatch(/\$2,000 or more for services in 2026/);
    expect(corp.at(-1)?.conditional).toBeTruthy(); // conditional ones last
  });

  it("says where a disregarded LLC's income goes, and the owners' estimates when it's a 1040", () => {
    const o = obligations({ name: "Alder, LLC", llcType: "Disregarded Entity" }, nov, "Alex Rivera’s Form 1040");
    expect(o.find((x) => x.key === "fed")?.note).toMatch(/Schedule C if it runs a business/);
    expect(o.find((x) => x.key === "owner-estimates")?.when).toBe("2027-01-15");
  });

  it("doesn't assume a trust's class: revocable by name is read as grantor, otherwise unknown", () => {
    expect(obligations({ name: "Rivera Family Revocable Trust", type: "Trust" }, nov).find((x) => x.key === "fed")?.note).toMatch(/read as a grantor trust/);
    expect(obligations({ name: "Rivera Family Trust", type: "Trust" }, nov).find((x) => x.key === "fed")).toMatchObject({ title: "Tax classification unknown", missing: "Tax classification" });
    expect(paperworkChecks({ name: "Rivera Family Trust", type: "Trust", trustees: "A" }).map((i) => i.key)).toContain("trust-class");
  });

  it("names a slot stale when the annual report on file is for an older year", () => {
    const r = documentRules({ ...nv, annualReport: {} }, nov).find((x) => x.key === "annualReport")!;
    expect(r.period).toBe(2026);
    expect(slotCurrent(r, { ...nv, annualReport: {}, annualReportYear: 2025 })).toBe(false);
    expect(slotCurrent(r, { ...nv, annualReport: {}, annualReportYear: 2026 })).toBe(true);
  });
});

describe("tax home and conflicts", () => {
  const recs: Record<string, any> = {
    t: { name: "Rivera Family Trust", type: "Trust", llcType: "Grantor trust", grantors: "Alex Rivera, Sam Rivera" },
    u: { name: "Rivera Holding Trust", type: "Trust" },
    a: { name: "Alder, LLC", llcType: "Disregarded Entity", ownerId: "t" },
    b: { name: "Birch, LLC", llcType: "Disregarded Entity", ownerId: "u" },
  };
  const find = (id: string) => recs[id];
  it("names the grantors and the trust they report through", () => {
    expect(taxHome(recs.a, find)).toEqual({ name: "Alex Rivera and Sam Rivera", form: "Form 1040", via: "Rivera Family Trust" });
    expect(taxHome(recs.b, find)).toMatchObject({ form: "return", unknown: true });
    expect(taxHome({ ...recs.a, ownerCount: 3 }, find)).toBeNull();
  });
  it("lists the tax-class issues that hold paperwork back", () => {
    expect(taxClassIssues({ name: "X, LLC", llcType: "Disregarded Entity", ownerCount: 3 }).map((i) => i.key)).toEqual(["disregarded-many-owners"]);
    expect(taxClassIssues({ name: "X, LLC", llcType: "Partnership", ownerCount: 2, llcTypeConflict: { value: "S Corporation", docName: "Form 2553" } }).map((i) => i.key)).toEqual(["doc-class"]);
    expect(filingAgency("Arizona", "LLC")).toBe("Arizona Corporation Commission");
    expect(filingAgency("AZ", "LP")).toBe("Arizona Secretary of State");
    expect(filingAgency("Nevada")).toBe("Nevada Secretary of State");
  });
});
