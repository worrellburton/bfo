import { describe, expect, it } from "vitest";
import { describeChange, editSummary, mergeFields } from "../lib/activity";

const base = { name: "TallulahMD LLC", type: "LLC", state: "Delaware", ein: "", address: "11201 N Tatum Blvd Ste 300, Phoenix, AZ 85028" };

describe("entity activity", () => {
  it("tells field edits plainly, with an owner by name", () => {
    const out = describeChange(base, { ...base, ein: "93-1234567" });
    expect(out).toEqual([{ kind: "edit", summary: "Set the EIN to 93-1234567", detail: { fields: [{ key: "ein", label: "EIN", from: null, to: "93-1234567" }] } }]);
    const two = describeChange({ ...base, ownerId: "a" }, { ...base, ownerId: "b", address: "5227 N 7th St STE 48575, Phoenix, AZ 85014" }, (id) => ({ a: "Ledger Louise, LLC", b: "Burton Family Trust" })[id] ?? null);
    expect(two[0].summary).toBe("Changed the address and owner");
    expect((two[0].detail!.fields as any[]).find((f) => f.key === "ownerId")).toMatchObject({ from: "Ledger Louise, LLC", to: "Burton Family Trust" });
    expect(describeChange({ ...base, notes: "a" }, { ...base, notes: "b" })[0]).toMatchObject({ summary: "Edited the notes", detail: { fields: [{ from: null, to: null }] } });
  });

  it("ignores bookkeeping the app does on its own", () => {
    expect(describeChange({ ...base, llcTypeSource: "x", initials: "T" }, { ...base, llcTypeSource: "y", initials: "TM" })).toEqual([]);
    const doc = { name: "OA.pdf", createdAt: 1 };
    expect(describeChange({ ...base, documents: { d: doc } }, { ...base, documents: { d: { ...doc, factsCheckedAt: 2 } } })).toEqual([]);
  });

  it("tells documents, filings, owners and Palm", () => {
    const before = { ...base, members: [{ name: "Ledger Louise, LLC", percent: 100, role: "Member" }], palm: { live: { businessId: "b", formation: { status: "submitted", ein: { status: "queued" }, openCases: 0 } } } };
    const after = {
      ...base,
      documents: { d1: { name: "Operating Agreement - TallulahMD LLC" } },
      operatingAgreement: { fileName: "Operating Agreement - TallulahMD LLC", docId: "d1" },
      members: [{ name: "Ledger Louise, LLC", percent: 50, role: "Member" }, { name: "Sameh Elguizaoui", percent: 50, role: "Member" }],
      palm: { live: { businessId: "b", formation: { status: "completed", ein: { status: "completed", number: "93-1234567" }, openCases: 0 } } },
    };
    expect(describeChange(before, after).map((e) => e.summary)).toEqual([
      "Owners: added Sameh Elguizaoui; updated Ledger Louise, LLC",
      "Uploaded “Operating Agreement - TallulahMD LLC”",
      "Filed “Operating Agreement - TallulahMD LLC” as the operating agreement",
      "The formation is complete: the state approved it",
      "The IRS issued the EIN 93-1234567",
    ]);
    expect(describeChange(null, { name: "New, LLC" })).toEqual([{ kind: "created", summary: "Added “New, LLC”" }]);
  });

  it("folds one person's run of edits into one line", () => {
    const merged = mergeFields(
      [{ key: "ein", label: "EIN", from: null, to: "93-1" }, { key: "state", label: "State", from: "Arizona", to: "Delaware" }],
      [{ key: "ein", label: "EIN", from: "93-1", to: "93-1234567" }, { key: "state", label: "State", from: "Delaware", to: "Arizona" }]
    );
    expect(merged).toEqual([{ key: "ein", label: "EIN", from: null, to: "93-1234567" }]);
    expect(editSummary(merged)).toBe("Set the EIN to 93-1234567");
  });
});
