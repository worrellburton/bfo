import { describe, expect, it } from "vitest";
import { dissolutionConsent, dissolutionConsentPdf, einLetter, einLetterPdf } from "../app/closing-docs";
import { closingSteps, stepsLeft } from "../app/entity-closing";
import { describeChange } from "../lib/activity";

const lookup = () => undefined;
const louise = {
  name: "Ledger Louise, LLC",
  type: "LLC",
  state: "Nevada",
  llcType: "Disregarded Entity",
  ein: "93-3776895",
  address: "5227 N 7th St STE 48575, Phoenix, AZ 85014",
  registeredAgent: "Northwest Registered Agent LLC",
  members: [{ name: "Burton Family Revocable Trust", percent: 100, role: "Member" }],
  foreign: { AZ: { confirmed: true } },
};

describe("closing an entity", () => {
  it("lists the steps for its state, tax class and registrations", () => {
    const steps = closingSteps(louise);
    expect(steps.map((s) => s.key)).toEqual(["consent", "windup", "bank", "state:NV", "withdraw:AZ", "tax", "payroll", "books", "ein", "agent", "mail"]);
    expect(steps.find((s) => s.key === "state:NV")).toMatchObject({ title: "File the Certificate of Dissolution with Nevada", link: { label: "Nevada SilverFlume" } });
    expect(steps.find((s) => s.key === "tax")).toMatchObject({ optional: true, title: "Report its last year on the owner's return" });
    expect(closingSteps({ ...louise, state: "Delaware", llcType: "Partnership", foreign: {} }).find((s) => s.key === "state:DE")?.title).toBe("File the Certificate of Cancellation with Delaware");
    expect(stepsLeft({ ...louise, closing: { startedAt: "2026-10-21", steps: { consent: "2026-10-21" } } }).map((s) => s.key)).not.toContain("tax");
  });

  it("ends Palm's service from here only when Palm is the agent", () => {
    expect(closingSteps({ ...louise, registeredAgent: "Palm Registered Agents LLC", palm: { live: { ra: { status: "active" } } } }).find((s) => s.key === "agent")).toMatchObject({
      palmEnd: true,
      title: "End Palm's registered agent service",
    });
    expect(closingSteps(louise).find((s) => s.key === "agent")?.title).toBe("Tell Northwest Registered Agent LLC to stop service");
  });

  it("drafts the consent and the IRS letter", async () => {
    const c = dissolutionConsent(louise as never, lookup);
    expect(c.title).toBe("Written Consent of the Members");
    expect(c.intro).toContain("Chapter 86 of the Nevada Revised Statutes");
    expect(c.resolutions[2].text).toContain("Certificate of Dissolution with the Nevada Secretary of State, a withdrawal of its registration in Arizona");
    expect(c.signers).toEqual([{ name: "Burton Family Revocable Trust", capacity: "Sole Member" }]);
    const l = einLetter(louise as never, "2026-11-30");
    expect(l).toMatchObject({ ein: "93-3776895", reason: "The limited liability company has been dissolved on November 30, 2026 and has ceased doing business." });
    for (const blob of [await dissolutionConsentPdf(c, louise.name), await einLetterPdf(l)]) {
      expect(new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    }
  });

  it("shows in the activity", () => {
    const start = { name: "X", closing: { startedAt: "2026-10-21", steps: {} } };
    expect(describeChange({ name: "X" }, start)[0].summary).toBe("Started closing it down");
    expect(describeChange(start, { name: "X", closing: { startedAt: "2026-10-21", steps: { "state:NV": "2026-10-22" } } })[0].summary).toBe("Closing: done with the state filing (NV)");
  });

  it("transfers what it owns before it ends, and closes its books", () => {
    const steps = closingSteps({ name: "Northwind Holdings, LLC", type: "LLC", state: "NV", llcType: "Partnership", owned: [{ id: "a1", name: "Alder Ridge, LLC", percent: 60 }], ownerName: "Northwind Trust" });
    const transfer = steps.find((s) => s.key === "transfer:a1");
    expect(transfer?.title).toBe("Transfer its interest in Alder Ridge, LLC");
    expect(transfer?.how).toMatch(/60% interest in Alder Ridge, LLC to Northwind Trust/);
    expect(steps.findIndex((s) => s.key === "transfer:a1")).toBeLessThan(steps.findIndex((s) => s.key === "windup"));
    expect(steps.find((s) => s.key === "windup")?.how).toMatch(/positive capital accounts/);
    expect(steps.find((s) => s.key === "tax")?.how).toMatch(/final state partnership return/);
    expect(steps.some((s) => s.key === "books")).toBe(true);
  });

  it("keeps a disregarded entity's own payroll and 1099s, and gives a trust its own steps", () => {
    const llc = closingSteps({ name: "Alder Ridge, LLC", type: "LLC", state: "NV", llcType: "Disregarded Entity" });
    expect(llc.find((s) => s.key === "tax")?.optional).toBe(true);
    expect(llc.find((s) => s.key === "payroll")?.optional).toBeFalsy();
    const trust = closingSteps({ name: "Northwind Family Revocable Trust", type: "Trust", llcType: "Grantor trust" });
    expect(trust.map((s) => s.key)).toEqual(["consent", "windup", "bank", "tax", "mail"]);
    expect(trust.find((s) => s.key === "tax")).toMatchObject({ title: "Report its last year on the grantors' return", optional: true });
    const nonGrantor = closingSteps({ name: "Northwind Irrevocable Trust", type: "Trust", llcType: "Non-grantor trust", ein: "12-3456789" });
    expect(nonGrantor.find((s) => s.key === "tax")?.title).toBe("File its final Form 1041");
    expect(nonGrantor.some((s) => s.key === "ein")).toBe(true);
  });
});
