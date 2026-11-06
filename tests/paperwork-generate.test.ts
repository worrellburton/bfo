import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  f8822bData,
  f8822bMailTo,
  fill8822B,
  fillW9,
  oaInput,
  oaProblems,
  operatingAgreement,
  operatingAgreementPdf,
  operatingAgreementPdfWithBoxes,
  PALM_SLOT,
  stateAddressStep,
  w9Data,
  W9_BOX,
  W9_REVIEW,
  type Rec,
} from "../app/paperwork-generate";
import { sameAddressText, stateFindings } from "../app/palm";

const OFFICE = "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028";
const assets: Record<string, Rec & { name: string }> = {
  trust: { name: "Burton Family Trust", type: "Trust", llcType: "Grantor trust", grantors: "Robert Burton and Jane Burton" },
  louise: { name: "Ledger Louise, LLC", type: "LLC", ownerId: "trust", address: OFFICE },
  part: { name: "Burton Partners, LLC", type: "LLC", llcType: "Partnership", ein: "93-1234567", address: OFFICE },
  tallulah: { name: "TallulahMD LLC", type: "LLC", state: "Delaware", ownerId: "louise", address: OFFICE, registeredAgent: "Palm", formationDate: "2026-10-20" },
  child: { name: "Child, LLC", type: "LLC", ownerId: "part", address: OFFICE },
};
const lookup = (id: string) => assets[id];

describe("W-9", () => {
  it("a disregarded LLC's goes in its taxpaying owner's name, followed up the chain, with the LLC on line 2", () => {
    const d = w9Data(assets.child, lookup);
    expect(d).toMatchObject({ name: "Burton Partners, LLC", business: "Child, LLC", box: W9_BOX.llc, llcLetter: "P", tin: { kind: "ein", digits: "931234567" } });
    expect(d.street).toBe("11201 N Tatum Blvd Ste 300, PMB 44879");
    expect(d.cityStateZip).toBe("Phoenix, AZ 85028");
    expect(d.blocked).toBeNull();
    expect(d.notes[0]).toBe("Line 1 follows the owners: Child, LLC (disregarded) → Burton Partners, LLC (partnership).");
    expect(d.notes.at(-1)).toBe(W9_REVIEW);
  });

  it("through a grantor trust it's a grantor's, whose SSN BFO never has, and with two grantors someone chooses which", () => {
    const d = w9Data(assets.tallulah, lookup);
    expect(d).toMatchObject({ name: "", business: "TallulahMD LLC", box: W9_BOX.individual, tin: null, grantorChoices: ["Robert Burton", "Jane Burton"] });
    expect(d.notes.join(" ")).toContain("Choose one before it's filled in");
    const chosen = w9Data(assets.tallulah, lookup, { grantor: "Jane Burton" });
    expect(chosen.name).toBe("Jane Burton");
    expect(chosen.notes.join(" ")).toContain("Jane Burton's SSN goes in Part I");
  });

  it("an entity that files its own return uses its own name and EIN", () => {
    expect(w9Data(assets.part, lookup)).toMatchObject({ name: "Burton Partners, LLC", business: "", box: W9_BOX.llc, llcLetter: "P", tin: { kind: "ein", digits: "931234567" } });
    const corp = w9Data({ name: "Burton Inc.", type: "C-Corp", llcType: "S Corporation", address: OFFICE }, lookup);
    expect(corp).toMatchObject({ box: W9_BOX.sCorp, tin: null });
    expect(corp.notes).toContain("No EIN on record yet: it goes in Part I once the IRS issues it.");
  });

  it("fills in the IRS's own form", async () => {
    const bytes = readFileSync(new URL("../public/forms/fw9.pdf", import.meta.url));
    const blob = await fillW9(w9Data(assets.child, lookup), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const { PDFDocument } = await import("pdf-lib");
    const form = (await PDFDocument.load(await blob.arrayBuffer())).getForm();
    const P = "topmostSubform[0].Page1[0].";
    expect(form.getTextField(P + "f1_01[0]").getText()).toBe("Burton Partners, LLC");
    expect(form.getTextField(P + "f1_02[0]").getText()).toBe("Child, LLC");
    expect(form.getCheckBox(`${P}Boxes3a-b_ReadOrder[0].c1_1[5]`).isChecked()).toBe(true);
    expect(form.getTextField(`${P}Boxes3a-b_ReadOrder[0].f1_03[0]`).getText()).toBe("P");
    expect(form.getTextField(P + "f1_14[0]").getText()).toBe("93");
    expect(form.getTextField(P + "f1_15[0]").getText()).toBe("1234567");
  });
});

describe("operating agreement", () => {
  it("drafts a single-member agreement from the owner on record, effective but not backdated", () => {
    const input = oaInput(assets.tallulah, lookup);
    expect(input).toMatchObject({ state: "DE", effective: "2026-10-20", managed: "members", taxClass: "Disregarded Entity", members: [{ name: "Ledger Louise, LLC", percent: 100, address: OFFICE }] });
    expect(oaProblems(input)).toEqual([]);
    const doc = operatingAgreement(input);
    expect(doc.title).toBe("Single-Member Operating Agreement");
    expect(doc.subtitle).toBe("of TallulahMD LLC, a Delaware limited liability company");
    expect(doc.preamble).toContain(
      'is entered into by Ledger Louise, LLC, as the sole member of the Company (the "Member") on the dates of their signatures below, and is effective as of October 20, 2026',
    );
    const text = doc.sections.flatMap((s) => s.paragraphs).join(" ");
    expect(text).toContain("6 Del. C. § 18-101");
    expect(text).toContain("disregarded as an entity separate from its owner");
    expect(text).toContain("6 Del. C. § 18-305");
    expect(doc.exhibit.rows).toEqual([["Ledger Louise, LLC", OFFICE, "100%"]]);
    expect(doc.signers).toEqual([{ name: "Ledger Louise, LLC", capacity: "Sole Member" }]);
  });

  it("drafts a multi-member, manager-managed partnership agreement from the members on record", () => {
    const input = oaInput(
      {
        name: "Burton Ventures, LLC",
        type: "LLC",
        state: "Arizona",
        address: OFFICE,
        members: [
          { name: "Ledger Louise, LLC", percent: 60, role: "Member" },
          { name: "Jane Burton", percent: 40, role: "Member" },
          { name: "Robert Burton", percent: null, role: "Manager" },
        ],
      },
      lookup,
      new Date("2026-11-01T12:00:00Z"),
    );
    expect(input).toMatchObject({ managed: "managers", managers: ["Robert Burton"], taxClass: "Partnership", effective: "2026-11-01" });
    expect(input.members.map((m) => m.percent)).toEqual([60, 40]);
    const doc = operatingAgreement(input);
    const text = doc.sections.flatMap((s) => s.paragraphs).join(" ");
    expect(text).toContain("A.R.S. § 29-3101");
    expect(text).toContain("A.R.S. § 29-3410");
    expect(text).toContain("partnership representative");
    expect(text).toContain("its Manager, Robert Burton");
    expect(doc.signers.map((s) => s.capacity)).toEqual(["Member", "Member", "Manager"]);
  });

  it("won't draft without owners whose shares add up", () => {
    expect(oaProblems(oaInput({ name: "Loose, LLC", type: "LLC", state: "NV" }, lookup))).toEqual(["Add its owners: the agreement lists each member and their share."]);
    const uneven = oaInput(
      {
        name: "Uneven, LLC",
        type: "LLC",
        state: "NV",
        members: [
          { name: "A", percent: 50, role: "Member" },
          { name: "B", percent: 30, role: "Member" },
        ],
      },
      lookup,
    );
    expect(oaProblems(uneven)).toEqual(["The members' shares add up to 80%, not 100%."]);
  });

  it("records where the execution page's boxes are, and prints who signs for a company", async () => {
    const lookup2 = (id: string) => (id === "louise" ? assets.louise : undefined);
    const two = oaInput(
      {
        ...assets.tallulah,
        members: [
          { name: "Ledger Louise, LLC", percent: 60, role: "Member" },
          { name: "Sameh Elguizaoui", percent: 40, role: "Member" },
        ],
      },
      lookup2,
    );
    const doc = operatingAgreement(two);
    const { blob, boxes } = await operatingAgreementPdfWithBoxes(doc, "TallulahMD LLC", { "ledger louise, llc": { name: "Robert W. Burton", title: "Manager" } });
    expect(blob.size).toBeGreaterThan(5000);
    // The company (party a) signs through a named manager: signature and date only. The person (party b): signature and date, name printed.
    expect(boxes.map((b) => `${b.party}:${b.type}`)).toEqual(["a:signature", "a:date", "b:signature", "b:date"]);
    for (const b of boxes) {
      expect(b.page).toBeGreaterThan(1);
      expect(b.x).toBeGreaterThan(0);
      expect(b.x + b.w).toBeLessThan(1);
      expect(b.y).toBeGreaterThan(0);
      expect(b.y + b.h).toBeLessThan(1);
    }
    // Nobody named for the company: its printed name is a box too.
    const unnamed = await operatingAgreementPdfWithBoxes(doc, "TallulahMD LLC");
    expect(unnamed.boxes.map((b) => `${b.party}:${b.type}`)).toEqual(["a:signature", "a:date", "a:name", "b:signature", "b:date"]);
  });

  it("lays it out as a PDF", async () => {
    const blob = await operatingAgreementPdf(operatingAgreement(oaInput(assets.tallulah, lookup)), "TallulahMD LLC");
    const head = new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 5));
    expect(head).toBe("%PDF-");
    expect(blob.size).toBeGreaterThan(5000);
  });
});

describe("Palm's documents", () => {
  it("fill the slots the state and the IRS issue", () => {
    expect(PALM_SLOT.certificate_of_formation).toBe("articles");
    expect(PALM_SLOT.ein_letter).toBe("einLetter");
    expect(PALM_SLOT.service_of_process).toBeUndefined();
  });
});

describe("address change", () => {
  const moved = { name: "Swisshelm Mountain Ventures, LLC", ein: "93-1234567", address: "5227 N 7th St STE 48575, Phoenix, AZ 85014", previousAddress: OFFICE };

  it("fills in the IRS's Form 8822-B", async () => {
    const data = f8822bData(moved);
    expect(data).toMatchObject({ ein: "93-1234567", mailTo: "Internal Revenue Service, Ogden, UT 84201-0023", notes: [] });
    const bytes = readFileSync(new URL("../public/forms/f8822b.pdf", import.meta.url));
    const blob = await fill8822B(data, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const { PDFDocument } = await import("pdf-lib");
    const form = (await PDFDocument.load(await blob.arrayBuffer())).getForm();
    const P = "topmostSubform[0].Page1[0].";
    expect(form.getCheckBox(P + "c1_2[0]").isChecked()).toBe(true);
    expect(form.getTextField(P + "Line4aReadOrder[0].f1_1[0]").getText()).toBe("Swisshelm Mountain Ventures, LLC");
    expect(form.getTextField(P + "Line4bReadOrder[0].f1_2[0]").getText()).toBe("93-1234567");
    expect(form.getTextField(P + "f1_3[0]").getText()).toBe(OFFICE);
    expect(form.getTextField(P + "f1_7[0]").getText()).toBe("5227 N 7th St STE 48575, Phoenix, AZ 85014");
  });

  it("knows who needs one and where it's mailed", () => {
    expect(f8822bData({ ...moved, ein: "00-0000000" }).ein).toBeNull();
    expect(f8822bMailTo("540 Hudson #6, New York, NY 10014")).toBe("Internal Revenue Service, Kansas City, MO 64999");
    expect(stateAddressStep("Arizona", "LLC")).toMatchObject({ needed: true, url: "https://arizonabusinesscenter.azcc.gov/" });
    expect(stateAddressStep("Nevada", "LLC").needed).toBe(true);
    expect(stateAddressStep("Delaware", "LLC").needed).toBe(false);
  });

  it("compares the state's address the way people write it", () => {
    expect(sameAddressText("5227 North 7th Street Suite 48575, Phoenix, AZ 85014-1234", "5227 N 7th St STE 48575, Phoenix, AZ 85014")).toBe(true);
    expect(sameAddressText(OFFICE, "5227 N 7th St STE 48575, Phoenix, AZ 85014")).toBe(false);
    const findings = stateFindings({ mode: "live", address: OFFICE, checkedAt: 0 }, { address: "5227 N 7th St STE 48575, Phoenix, AZ 85014" });
    expect(findings[0].text).toContain("The state has 11201 N Tatum Blvd");
  });
});

describe("operating agreement wording and execution page", () => {
  it("sets a typed purpose into a sentence and leaves a full one alone", async () => {
    const { purposeSentence } = await import("../app/paperwork-generate");
    expect(purposeSentence("any lawful business")).toBe(
      "The purpose of the Company is to engage in any lawful business, and in any other lawful act or activity for which a limited liability company may be formed under the Act.",
    );
    expect(purposeSentence("to operate a medical practice.")).toMatch(/^The purpose of the Company is to engage in a medical practice, and/);
    expect(purposeSentence("The Company's purpose is to hold real estate.")).toBe("The Company's purpose is to hold real estate.");
    expect(purposeSentence("")).toMatch(/^The purpose of the Company is to engage in any lawful act/);
  });

  it("names each signer's share on the signature page", async () => {
    const { operatingAgreement } = await import("../app/paperwork-generate");
    const doc = operatingAgreement({
      name: "X LLC",
      state: "DE",
      effective: "2026-01-01",
      address: "",
      registeredAgent: "",
      purpose: "",
      managed: "members",
      managers: [],
      taxClass: "Partnership",
      members: [
        { name: "A LLC", percent: 60, address: "" },
        { name: "Bea Person", percent: 40, address: "" },
      ],
    });
    expect(doc.signers).toEqual([
      { name: "A LLC", capacity: "Member", share: "60%" },
      { name: "Bea Person", capacity: "Member", share: "40%" },
    ]);
    const single = operatingAgreement({
      name: "Y LLC",
      state: "DE",
      effective: "2026-01-01",
      address: "",
      registeredAgent: "",
      purpose: "",
      managed: "members",
      managers: [],
      taxClass: "Disregarded Entity",
      members: [{ name: "Solo", percent: 100, address: "" }],
    });
    expect(single.signers[0]).toEqual({ name: "Solo", capacity: "Sole Member", share: undefined });
  });
});

// Made-up records for the tax-class rules.
describe("W-9 and the agreement wait for the tax class", () => {
  const recs: Record<string, Rec & { name: string }> = {
    revocable: { name: "Rivera Family Revocable Trust", type: "Trust", grantors: "Alex Rivera" },
    grantor: { name: "Rivera Grantor Trust", type: "Trust", llcType: "Grantor trust", grantors: "Alex Rivera" },
    hold: { name: "Northwind Holdings, LLC", type: "LLC", llcType: "Disregarded Entity", ownerId: "revocable", address: OFFICE },
    held: { name: "Alder Ridge, LLC", type: "LLC", llcType: "Disregarded Entity", ownerId: "grantor", address: OFFICE },
    multi: {
      name: "Harbor Point, LLC",
      type: "LLC",
      state: "Arizona",
      llcType: "Disregarded Entity",
      ownerId: "hold",
      ein: "00-0000001",
      address: OFFICE,
      members: [
        { name: "Northwind Holdings, LLC", percent: 65, role: "Member" },
        { name: "Sam Lee", percent: 20, role: "Member" },
        { name: "Pat Kim", percent: 15, role: "Member" },
      ],
    },
  };
  const find = (id: string) => recs[id];

  it("refuses a W-9 for a multi-member LLC recorded as disregarded", async () => {
    const d = w9Data(recs.multi, find);
    expect(d.blocked).toMatch(/several owners/);
    expect(d.name).toBe("");
    await expect(fillW9(d, new ArrayBuffer(0))).rejects.toThrow(/Settle the tax classification/);
  });

  it("never uses a grantor's SSN on an assumed class, and follows a recorded grantor trust", () => {
    const assumed = w9Data(recs.hold, find);
    expect(assumed).toMatchObject({ name: "", blocked: null });
    expect(assumed.notes.join(" ")).toContain("tax classification isn't on record");
    const recorded = w9Data(recs.held, find);
    expect(recorded).toMatchObject({ name: "Alex Rivera", business: "Alder Ridge, LLC", box: W9_BOX.individual });
    expect(recorded.chain.map((c) => c.as)).toEqual(["disregarded", "grantor trust", "grantor"]);
  });

  it("won't draft the agreement while the class conflicts, and names the Arizona agency and agent", () => {
    const input = oaInput(recs.multi, find);
    expect(oaProblems(input).join(" ")).toMatch(/Settle its tax classification first/);
    const ok = oaInput({ ...recs.multi, llcType: "Partnership", stateRecord: { mode: "live", checkedAt: 1, formationDate: "2023-09-11" } as never }, find);
    expect(oaProblems(ok)).toEqual([]);
    expect(ok).toMatchObject({ effective: "2023-09-11", effectiveFrom: "state" });
    const doc = operatingAgreement(ok);
    const text = doc.sections.flatMap((x) => x.paragraphs).join(" ");
    expect(text).toContain("with the Arizona Corporation Commission");
    expect(text).toContain("statutory agent in Arizona");
    expect(doc.sections.map((x) => x.heading)).toContain("Offices and Statutory agent");
    expect(text).toContain("partnership representative");
  });
});
