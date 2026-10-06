import { describe, expect, it } from "vitest";
import { categorize, classify, counterpartyText, typeForCategory } from "../lib/books-rules";

describe("counterpartyText", () => {
  it("reads only the payee segment of a Mercury descriptor", () => {
    expect(counterpartyText("Send Money via mercury.com; Merchant name: Earthcare Landscapes", "Burton")).toBe("Earthcare Landscapes");
    expect(counterpartyText("POS DEBIT", "Lowe's")).toBe("Lowe's POS DEBIT");
  });
});

describe("categorize", () => {
  it("books taxes before anything else", () => {
    expect(categorize("IRS USATAXPYMT internal revenue", null, "TRANSFER_OUT").category).toBe("6700 Taxes & Licenses");
  });
  it("falls back to Plaid's category", () => {
    expect(categorize("UBER TRIP", "Uber", "TRANSPORTATION").category).toBe("6550 Automobile & Transport");
  });
  it("books home improvement and bank fees", () => {
    expect(categorize("THE HOME DEPOT #402", "The Home Depot", "HOME_IMPROVEMENT").category).toBe("6300 Repairs & Maintenance");
    expect(categorize("MONTHLY SERVICE FEE", null, "BANK_FEES").category).toBe("6400 Bank & Card Fees");
  });
  it("leaves an unknown row genuinely uncategorized", () => {
    expect(categorize("SOMETHING NEW", "Nobody", "SOMETHING_ELSE")).toEqual({ category: null, type: null });
  });
});

describe("typeForCategory", () => {
  it("maps chart sections to row types", () => {
    expect(typeForCategory("6300 Repairs & Maintenance")).toBe("normal");
    expect(typeForCategory("4000 Rental Income")).toBe("normal");
    expect(typeForCategory("9000 Intercompany")).toBe("intercompany");
    expect(typeForCategory("9100 Internal Transfers")).toBe("transfer");
    expect(typeForCategory("9400 Capital Improvements")).toBe("transfer");
    expect(typeForCategory(null)).toBeNull();
  });
});

describe("classify", () => {
  it("lets a taught account decide the category and the type", () => {
    const r = classify("TRANSFER TO PERSONS LODGE", null, "TRANSFER_OUT", "6300 Repairs & Maintenance");
    expect(r).toEqual({ category: "6300 Repairs & Maintenance", type: "normal" });
  });
  it("uses the built-in rules when nothing was taught", () => {
    expect(classify("UBER TRIP", "Uber", "TRANSPORTATION", null).category).toBe("6550 Automobile & Transport");
  });
});
