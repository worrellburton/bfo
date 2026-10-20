import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fillW9, oaInput, oaProblems, operatingAgreement, operatingAgreementPdf, PALM_SLOT, w9Data, W9_BOX, type Rec } from "../app/paperwork-generate";

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
    expect(d.notes).toEqual([]);
  });

  it("through a grantor trust it's the grantor's, whose SSN BFO never has", () => {
    const d = w9Data(assets.tallulah, lookup);
    expect(d).toMatchObject({ name: "Robert Burton", business: "TallulahMD LLC", box: W9_BOX.individual, tin: null });
    expect(d.notes[0]).toContain("SSN goes in Part I");
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
  it("drafts a single-member agreement from the owner on record", () => {
    const input = oaInput(assets.tallulah, lookup);
    expect(input).toMatchObject({ state: "DE", effective: "2026-10-20", managed: "members", taxClass: "Disregarded Entity", members: [{ name: "Ledger Louise, LLC", percent: 100, address: OFFICE }] });
    expect(oaProblems(input)).toEqual([]);
    const doc = operatingAgreement(input);
    expect(doc.title).toBe("Single-Member Operating Agreement");
    expect(doc.subtitle).toBe("of TallulahMD LLC, a Delaware limited liability company");
    expect(doc.preamble).toContain("effective as of October 20, 2026 by Ledger Louise, LLC, as the sole member");
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
      new Date("2026-11-01T12:00:00Z")
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
    const uneven = oaInput({ name: "Uneven, LLC", type: "LLC", state: "NV", members: [{ name: "A", percent: 50, role: "Member" }, { name: "B", percent: 30, role: "Member" }] }, lookup);
    expect(oaProblems(uneven)).toEqual(["The members' shares add up to 80%, not 100%."]);
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
