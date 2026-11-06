import { describe, expect, it } from "vitest";
import {
  annualized,
  countsAsContracted,
  deletable,
  familyEntityNamed,
  feeAmount,
  feeClause,
  feeShort,
  frequencyOf,
  looksProfessional,
  moneyInWords,
  numberWords,
  partyDescription,
  pastDueUnsigned,
  periodsElapsed,
  renewal,
  stageOf,
  termsEditable,
} from "../app/entity/contract-terms";

describe("the fee as money", () => {
  it("reads the amount, or a legacy string typed any way, as a number", () => {
    expect(feeAmount({ amount: 8000 })).toBe(8000);
    expect(feeAmount({ fee: "8000" })).toBe(8000);
    expect(feeAmount({ fee: "8000.00" })).toBe(8000);
    expect(feeAmount({ fee: "$1,250.50" })).toBe(1250.5);
    expect(feeAmount({ fee: "" })).toBeNull();
    expect(feeAmount({ fee: "about five hundred" })).toBeNull();
    expect(feeAmount({ amount: 500, fee: "$9" })).toBe(500);
  });

  it("names the frequency, whatever case it was stored in", () => {
    expect(frequencyOf("Monthly")).toBe("Monthly");
    expect(frequencyOf("monthly")).toBe("Monthly");
    expect(frequencyOf("Annually")).toBe("Annually");
    expect(frequencyOf("One-time")).toBe("One-time");
    expect(frequencyOf("weekly")).toBeNull();
  });

  it("says the fee as people read it, never “8000 per monthly”", () => {
    expect(feeShort({ fee: "8000", frequency: "Monthly" })).toBe("$8,000.00 a month");
    expect(feeShort({ amount: 500, frequency: "Quarterly" })).toBe("$500.00 a quarter");
    expect(feeShort({ amount: 2500, frequency: "One-time" })).toBe("$2,500.00 one time");
    expect(feeShort({ fee: "", frequency: "Monthly" })).toBe("");
  });

  it("writes the price term the way a signed instrument does", () => {
    expect(feeClause({ fee: "8000", frequency: "Monthly" })).toBe("a management fee of $8,000.00 (eight thousand dollars) per month");
    expect(feeClause({ amount: 1250.5, frequency: "Annually" })).toBe("a management fee of $1,250.50 (one thousand two hundred fifty dollars and fifty cents) per year");
    expect(feeClause({ amount: 2500, frequency: "One-time" })).toBe("a one-time management fee of $2,500.00 (two thousand five hundred dollars)");
    expect(feeClause({ fee: "" })).toBeNull();
  });

  it("spells numbers in words", () => {
    expect(numberWords(0)).toBe("zero");
    expect(numberWords(21)).toBe("twenty-one");
    expect(numberWords(1001)).toBe("one thousand one");
    expect(numberWords(2_345_678)).toBe("two million three hundred forty-five thousand six hundred seventy-eight");
    expect(moneyInWords(1)).toBe("$1.00 (one dollar)");
  });

  it("annualizes recurring fees, not a one-time fee", () => {
    expect(annualized({ amount: 8000, frequency: "Monthly" })).toBe(96000);
    expect(annualized({ amount: 500, frequency: "Quarterly" })).toBe(2000);
    expect(annualized({ amount: 500, frequency: "One-time" })).toBeNull();
  });
});

describe("dates", () => {
  it("finds the next renewal and the last day to give notice, for an auto-renewing term only", () => {
    expect(renewal({ term: "Annual, auto-renewing", effectiveDate: "2026-07-01" }, "2026-11-06")).toEqual({ renewsOn: "2027-07-01", noticeBy: "2027-06-01" });
    expect(renewal({ term: "Annual, auto-renewing", effectiveDate: "2024-03-15" }, "2026-11-06")).toEqual({ renewsOn: "2027-03-15", noticeBy: "2027-02-13" });
    expect(renewal({ term: "Month to month", effectiveDate: "2026-07-01" }, "2026-11-06")).toBeNull();
  });

  it("counts the fee periods already begun before signing", () => {
    expect(periodsElapsed({ effectiveDate: "2026-07-01", frequency: "Monthly", amount: 8000 }, "2026-11-06")).toEqual({ periods: 5, amount: 40000, unit: "month" });
    expect(periodsElapsed({ effectiveDate: "2026-07-01", frequency: "Quarterly", amount: 500 }, "2026-11-06")).toEqual({ periods: 2, amount: 1000, unit: "quarter" });
    expect(periodsElapsed({ effectiveDate: "2026-12-01", frequency: "Monthly", amount: 8000 }, "2026-11-06")).toBeNull();
  });
});

describe("where a contract stands", () => {
  it("follows signing, not a picker", () => {
    expect(stageOf({ counterparty: "A", status: "draft" })).toBe("draft");
    expect(stageOf({ counterparty: "A", status: "active" })).toBe("unsigned-active");
    expect(stageOf({ counterparty: "A", status: "draft" }, { status: "sent" })).toBe("out");
    expect(stageOf({ counterparty: "A", status: "draft" }, { status: "completed", completed_at: "2026-10-01T12:00:00Z" })).toBe("signed");
    expect(stageOf({ counterparty: "A", status: "active", signedOn: "2026-07-01" })).toBe("signed");
    expect(stageOf({ counterparty: "A", status: "terminated" })).toBe("terminated");
    expect(stageOf({ counterparty: "A", status: "active", archivedAt: 1 })).toBe("archived");
  });

  it("lets only a draft be deleted, and terms change only before anything goes out", () => {
    expect(deletable("draft")).toBe(true);
    expect(deletable("signed")).toBe(false);
    expect(deletable("unsigned-active")).toBe(false);
    expect(termsEditable("out")).toBe(false);
    expect(termsEditable("signed")).toBe(false);
    expect(termsEditable("unsigned-active")).toBe(true);
    expect(countsAsContracted("draft")).toBe(false);
    expect(countsAsContracted("signed")).toBe(true);
  });

  it("flags an unsigned contract past its effective date", () => {
    expect(pastDueUnsigned({ counterparty: "A", effectiveDate: "2026-11-01" }, "draft", "2026-11-06")).toBe(true);
    expect(pastDueUnsigned({ counterparty: "A", effectiveDate: "2026-11-01" }, "signed", "2026-11-06")).toBe(false);
    expect(pastDueUnsigned({ counterparty: "A", effectiveDate: "2026-12-01" }, "draft", "2026-11-06")).toBe(false);
  });
});

describe("parties", () => {
  it("describes a party from the record", () => {
    expect(partyDescription("Northwind Holdings, LLC", "Nevada", "limited liability company")).toBe("Northwind Holdings, LLC, a Nevada limited liability company");
    expect(partyDescription("Alder Partners, PLLC", "Arizona", "professional limited liability company")).toBe("Alder Partners, PLLC, an Arizona professional limited liability company");
    expect(partyDescription("Alex Rivera", "Ohio", "individual")).toBe("Alex Rivera, an individual residing in Ohio");
    expect(partyDescription("Someone", null, null)).toBe("Someone");
  });

  it("knows a family entity by name, and a professional firm", () => {
    const fam = [{ id: "n1", name: "Northwind Holdings, L.L.C." }];
    expect(familyEntityNamed("northwind holdings llc", fam)).toEqual({ id: "n1", name: "Northwind Holdings, L.L.C." });
    expect(familyEntityNamed("Southwind", fam)).toBeNull();
    expect(looksProfessional("Alder Law")).toBe(true);
    expect(looksProfessional("Alder Partners, PLLC")).toBe(true);
    expect(looksProfessional("Northwind Holdings, LLC")).toBe(false);
  });
});
