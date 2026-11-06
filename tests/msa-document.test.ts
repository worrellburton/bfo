import { describe, expect, it } from "vitest";
import { msaSections, serviceLines, type MsaInput } from "../app/entity/msa-document";

const base: MsaInput = {
  manager: {
    name: "Northwind Holdings, LLC",
    type: "LLC",
    state: "Nevada",
    principalOffice: "100 Example Way, Suite 1, Reno, NV 89501",
    noticeAddress: "PO Box 1, Phoenix, AZ 85001",
    tradeName: null,
  },
  client: { name: "Alder Partners, PLLC", state: "Arizona", form: "professional limited liability company", affiliate: false },
  contract: {
    counterparty: "Alder Partners, PLLC",
    fee: "8000",
    frequency: "Monthly",
    effectiveDate: "2026-07-01",
    term: "Annual, auto-renewing",
    status: "draft",
    services: ["Bookkeeping & Accounting", "Tax Coordination & Planning"],
  },
  governingLaw: "Nevada",
  signers: { manager: { name: "Alex Rivera", title: "Manager" } },
};
const text = (s: ReturnType<typeof msaSections>) => [s.recital, ...s.articles.flatMap((a) => [a.heading, ...a.paragraphs.map((p) => p.text)])].join("\n");

describe("the agreement's words come from the record", () => {
  it("names the parties, the addresses and the law from the record, in long dates and real money", () => {
    const s = msaSections(base);
    const all = text(s);
    expect(s.recital).toContain("Northwind Holdings, LLC, a Nevada limited liability company (“Manager”)");
    expect(s.recital).toContain("Alder Partners, PLLC, an Arizona professional limited liability company (“Client”)");
    expect(s.recital).toContain("effective as of July 1, 2026");
    expect(s.recital).not.toContain("2026-07-01");
    expect(all).toContain("a management fee of $8,000.00 (eight thousand dollars) per month");
    expect(all).not.toMatch(/per monthly|8000 per/);
    expect(all).toContain("Notices to Manager go to PO Box 1, Phoenix, AZ 85001. Manager’s principal office is 100 Example Way, Suite 1, Reno, NV 89501.");
    expect(all).toContain("governed by the laws of the State of Nevada");
    expect(s.gaps).toEqual([]);
    expect(s.masthead).toBe("Northwind Holdings, LLC");
  });

  it("prints a trade name only when one is on record, and uses it as the masthead when chosen", () => {
    expect(msaSections(base).recital).not.toContain("doing business as");
    const s = msaSections({ ...base, manager: { ...base.manager, tradeName: "Northwind Office" }, contract: { ...base.contract, masthead: "trade" } });
    expect(s.recital).toContain("doing business as Northwind Office");
    expect(s.masthead).toBe("Northwind Office");
    expect(msaSections({ ...base, manager: { ...base.manager, tradeName: "Northwind Office" }, contract: { ...base.contract, masthead: "legal" } }).masthead).toBe("Northwind Holdings, LLC");
  });

  it("only calls the client an affiliate when it is one", () => {
    expect(msaSections(base).recital).not.toContain("affiliate");
    expect(msaSections({ ...base, client: { ...base.client, affiliate: true } }).recital).toContain("an affiliate of Manager");
  });

  it("carries the protections an outside services agreement needs", () => {
    const all = text(msaSections(base));
    for (const words of [
      "independent contractor",
      "do not include legal advice",
      "Form W-9",
      "indirect, incidental, consequential",
      "twelve (12) months",
      "counterparts",
      "electronic",
      "unenforceable",
      "not a waiver",
      "survive",
    ]) {
      expect(all).toContain(words);
    }
  });

  it("defines the referral fee, keeps both sides gross, and has the client stand behind its professional rules", () => {
    const all = text(msaSections({ ...base, contract: { ...base.contract, referralCredit: true, referralTerms: "10% of the referred client’s first-year fees" } }));
    expect(all).toContain("a referral fee of 10% of the referred client’s first-year fees");
    expect(all).toContain("neither is netted against the other");
    expect(all).toContain("professional rules");
  });

  it("lists what the record lacks instead of inventing it", () => {
    const s = msaSections({
      ...base,
      manager: { ...base.manager, principalOffice: null, noticeAddress: null },
      contract: { ...base.contract, fee: "", services: [], referralCredit: true, referralTerms: "" },
      governingLaw: "",
      signers: { manager: null },
    });
    expect(s.gaps).toEqual([
      "the Manager’s principal office",
      "a fee",
      "at least one service",
      "the governing law (the entity’s home state)",
      "who signs for the Manager",
      "how the referral fee is worked out",
    ]);
  });

  it("folds old service names into new and lists each once", () => {
    expect(serviceLines(["AI & Technology Management", "AI Agent & Automation Development", "Fractional CFO"])).toEqual(["AI, Automation & Technology Management", "Fractional CFO"]);
  });
});
