import { describe, expect, it } from "vitest";
import { betterVendor } from "../lib/vendor-parse";

describe("betterVendor", () => {
  it("maps curated descriptors", () => {
    expect(betterVendor("TRUIST MORTG PAYMENT 12345", "Burton")).toBe("Truist Mortgage");
    expect(betterVendor("ONLINE TRANSFER TO CHECKING", null)).toBeNull();
  });
  it("keeps a real Plaid merchant", () => {
    expect(betterVendor("POS 1234 HOME DEPOT #402", "The Home Depot")).toBe("The Home Depot");
  });
});
