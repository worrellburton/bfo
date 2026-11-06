import { describe, expect, it } from "vitest";
import { dissolutionConsent, dissolutionConsentPdf, einLetter, einLetterPdf, signingChain } from "../app/closing-docs";
import { closingBlockers, closingHints, closingSteps, stateFilingFacts, stepsLeft } from "../app/entity-closing";
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
    expect(steps.map((s) => s.key)).toEqual(["consent", "windup", "bank", "state:NV", "withdraw:AZ", "tax", "ein", "agent", "mail"]);
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
    expect(c.signers).toEqual([{ name: "Burton Family Revocable Trust", capacity: "Sole Member", through: [], signatories: [] }]);
    const l = einLetter(louise as never, "2026-11-30");
    expect(l).toMatchObject({ ein: "93-3776895", reason: "The limited liability company has been dissolved on November 30, 2026 and has ceased doing business." });
    for (const blob of [await dissolutionConsentPdf(c, louise.name), await einLetterPdf(l)]) {
      expect(new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    }
  });

  it("follows a company owner up to the people who sign for it", async () => {
    const family: Record<string, Record<string, unknown>> = {
      "sundown investments llc": {
        name: "Sundown Investments, LLC",
        members: [{ name: "Ledger Louise, LLC", percent: 100, role: "member" }],
        profile: { management: "manager-managed", managers: ["Ledger Louise, LLC (Managing Member; signs through Authorized Representative Robert W. Burton)"] },
      },
      "ledger louise llc": {
        name: "Ledger Louise, LLC",
        members: [{ name: "Burton Family Revocable Trust", percent: 100, role: "member" }],
        profile: { management: "manager-managed", managers: ["Robert Ledger Burton", "Claire Burton", "Robert W. Burton (Robert Worrell Burton)", "Amanda Burton Dawson"] },
      },
    };
    const byName = (n: string) =>
      family[
        n
          .toLowerCase()
          .replace(/\s*\(.*?\)\s*/g, " ")
          .replace(/[.,]/g, "")
          .replace(/\s+/g, " ")
          .trim()
      ] as never;
    // Nothing set anywhere: Sundown signs by Ledger Louise, by all four of its managers.
    expect(signingChain("Sundown Investments, LLC", byName)).toEqual({
      through: ["Ledger Louise, LLC, its Manager"],
      signatories: [
        { name: "Robert Ledger Burton", title: "Manager, Ledger Louise, LLC" },
        { name: "Claire Burton", title: "Manager, Ledger Louise, LLC" },
        { name: "Robert W. Burton", title: "Manager, Ledger Louise, LLC" },
        { name: "Amanda Burton Dawson", title: "Manager, Ledger Louise, LLC" },
      ],
    });
    // A signer set on Ledger Louise is inherited by Sundown and by anything Sundown owns.
    family["ledger louise llc"].authorizedSigners = [{ name: "Robert W. Burton", title: "Authorized Representative" }];
    expect(signingChain("Sundown Investments, LLC", byName)).toEqual({
      through: ["Ledger Louise, LLC, its Manager"],
      signatories: [{ name: "Robert W. Burton", title: "Authorized Representative, Ledger Louise, LLC" }],
    });
    // Set on Sundown itself, the chain stops there.
    family["sundown investments llc"].authorizedSigners = [{ name: "Robert W. Burton", title: "Manager" }];
    expect(signingChain("Sundown Investments, LLC", byName)).toEqual({ through: [], signatories: [{ name: "Robert W. Burton", title: "Manager, Sundown Investments, LLC" }] });
    // A company BFO has no record of gets a blank line.
    expect(signingChain("Outside Capital, LLC", byName)).toEqual({ through: [], signatories: [] });
    delete family["sundown investments llc"].authorizedSigners;
    delete family["ledger louise llc"].authorizedSigners;

    const palomino = {
      name: "Palomino Ranch on the Bend, LLC",
      type: "LLC",
      state: "Arizona",
      llcType: "Disregarded Entity",
      members: [{ name: "Sundown Investments, LLC", percent: 100, role: "member" }],
    };
    const c = dissolutionConsent(palomino as never, lookup, byName);
    expect(c.signers).toEqual([
      {
        name: "Sundown Investments, LLC",
        capacity: "Sole Member",
        through: ["Ledger Louise, LLC, its Manager"],
        signatories: expect.arrayContaining([{ name: "Amanda Burton Dawson", title: "Manager, Ledger Louise, LLC" }]),
      },
    ]);
    expect(c.signers[0].signatories).toHaveLength(4);
    const blob = await dissolutionConsentPdf(c, palomino.name);
    expect(new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
  });

  it("says what is still live: owned entities, property on record, money in linked accounts", () => {
    const palomino = { ...louise, id: "pal", name: "Palomino Ranch on the Bend, LLC", state: "Arizona", profile: { properties: [{ description: "3378 E River Rd, Tucson", status: "owned" }] } };
    const others = {
      pal: { name: palomino.name, ownerId: "sun" },
      cfs: { name: "FDJ CFS, LLC", ownerId: "pal" },
      old: { name: "Old Sub, LLC", ownerId: "pal", status: "Dissolved" },
      sun: { name: "Sundown Investments, LLC" },
    };
    const accounts = [
      { account_id: "a", name: "Mercury Checking", mask: "8974", balance_current: 0, entity_id: "pal", institution_name: "Mercury" },
      { account_id: "b", name: "Savings", mask: "1234", balance_current: 1250.5, entity_id: "pal", institution_name: "Chase" },
      { account_id: "c", name: "Other", mask: "9", balance_current: 99, entity_id: "sun", institution_name: "Chase" },
    ];
    const b = closingBlockers(palomino, others, accounts);
    expect(b.map((x) => x.step)).toEqual(["windup", "windup", "bank"]);
    expect(b[0]).toMatchObject({ text: "It still owns FDJ CFS, LLC: move it to its new owner first.", link: { to: "/assets/cfs" } });
    expect(b[1].text).toContain("3378 E River Rd, Tucson");
    expect(b[2].text).toBe("Chase Savings ····1234 still holds $1,250.50.");
    // Sold property and an empty account are not in the way.
    expect(closingBlockers({ ...palomino, profile: { properties: [{ description: "x", status: "sold" }] } }, { sun: others.sun }, [accounts[0]])).toEqual([]);
  });

  it("tells what it already knows about a step", () => {
    const a = { ...louise, id: "pal", state: "Arizona", stateRecord: { status: "terminated" }, registeredAgentSource: "Palm stopped 2026-11-01" };
    const h = closingHints(a, [{ account_id: "a", name: "Mercury Checking", mask: "8974", balance_current: 0, entity_id: "pal", institution_name: "Mercury" }]);
    expect(h).toEqual({ "state:AZ": "Arizona's record shows it terminated.", agent: "Palm has ended its registered agent service.", bank: "Mercury Checking ····8974 is at $0.00." });
    expect(closingHints({ ...louise, id: "x" }, [])).toEqual({ bank: "No bank or brokerage account is linked to it in Treasury." });
    expect(closingHints({ ...louise, id: "x" }, null)).toEqual({});
  });

  it("lists the facts the state's form asks for", () => {
    expect(stateFilingFacts({ name: "Palomino Ranch on the Bend, LLC", type: "LLC", state: "Arizona", fileNumber: "L16787484", formationDate: "2011-05-05" })).toEqual([
      { label: "Exact legal name", value: "Palomino Ranch on the Bend, LLC" },
      { label: "Arizona file number", value: "L16787484" },
      { label: "Formed", value: "2011-05-05" },
      { label: "Statement the form requires", value: "All of the known property and assets of the company have been applied and distributed." },
    ]);
    expect(stateFilingFacts({ ...louise, stateRecord: { registrationNumber: "E340" } }).map((f) => f.label)).toEqual(["Exact legal name", "Nevada file number"]);
  });

  it("shows in the activity", () => {
    const start = { name: "X", closing: { startedAt: "2026-10-21", steps: {} } };
    expect(describeChange({ name: "X" }, start)[0].summary).toBe("Started closing it down");
    expect(describeChange(start, { name: "X", closing: { startedAt: "2026-10-21", steps: { "state:NV": "2026-10-22" } } })[0].summary).toBe("Closing: done with the state filing (NV)");
    const signed = describeChange({ name: "X" }, { name: "X", authorizedSigners: [{ name: "Robert W. Burton", title: "Authorized Representative" }] })[0];
    expect(signed.detail).toMatchObject({ fields: [{ label: "Authorized signers", from: null, to: "Robert W. Burton (Authorized Representative)" }] });
  });
});

describe("signing the consent in BFO", () => {
  it("marks where each of two signers signs and dates, and gives up past two", async () => {
    const { dissolutionConsentPdfWithBoxes, signingChain } = await import("../app/closing-docs");
    const two = {
      through: ["Ledger Louise, LLC, its Manager"],
      signatories: [
        { name: "Robert W. Burton", title: "Authorized Representative, Ledger Louise, LLC" },
        { name: "Amanda Burton Dawson", title: "Authorized Representative, Ledger Louise, LLC" },
      ],
    };
    const doc = dissolutionConsent({ ...louise, state: "Arizona", members: [{ name: "Sundown Investments, LLC", percent: 100, role: "member" }] } as never, lookup, () => undefined);
    doc.signers = [{ ...doc.signers[0], ...two }];
    const { blob, boxes } = await dissolutionConsentPdfWithBoxes(doc, louise.name);
    expect(new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    expect(boxes.map((b) => `${b.party}:${b.type}`)).toEqual(["a:signature", "a:date", "b:signature", "b:date"]);
    for (const b of boxes) {
      expect(b.page).toBeGreaterThan(0);
      for (const n of [b.x, b.y, b.w, b.h]) expect(n).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(1);
      expect(b.y + b.h).toBeLessThanOrEqual(1);
    }
    // The date box sits to the right of the signature box on the same line.
    expect(boxes[1].x).toBeGreaterThan(boxes[0].x + boxes[0].w);
    // A person signing for themselves gets boxes too; four managers do not.
    const person = dissolutionConsent({ ...louise, members: [{ name: "Laura Fedele", percent: 100, role: "member" }] } as never, lookup);
    expect((await dissolutionConsentPdfWithBoxes(person, "X")).boxes.map((b) => b.party)).toEqual(["a", "a"]);
    const four = { ...two, signatories: ["A B", "C D", "E F", "G H"].map((name) => ({ name, title: "Manager, Ledger Louise, LLC" })) };
    doc.signers = [{ ...doc.signers[0], ...four }];
    expect((await dissolutionConsentPdfWithBoxes(doc, louise.name)).boxes).toEqual([]);
    expect(signingChain("Nobody, LLC", () => undefined)).toEqual({ through: [], signatories: [] });
  });
});
