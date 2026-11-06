import { describe, expect, it } from "vitest";
import { ESIGN_DISCLOSURE_VERSION } from "../lib/sign";
import { consentPoints, DISCLOSURE_VERSION, disclosureSections } from "../app/sign/disclosure";

/** The disclosure the signer reads and the version the server records with their consent are one and the same. */
describe("the electronic records disclosure", () => {
  it("carries the version the server records", () => {
    expect(DISCLOSURE_VERSION).toBe(ESIGN_DISCLOSURE_VERSION);
  });
  it("covers what ESIGN asks a consumer to be told", () => {
    const text = disclosureSections("Northwind Holdings, LLC")
      .flatMap((s) => [s.heading, ...s.paragraphs])
      .join(" ");
    expect(text).toMatch(/paper copy/i);
    expect(text).toMatch(/no charge/i);
    expect(text).toMatch(/withdraw/i);
    expect(text).toMatch(/web browser/i);
    expect(text).toMatch(/email address changes/i);
    expect(text).toMatch(/this document only/i);
    expect(text).toContain("Northwind Holdings, LLC");
    expect(consentPoints("Northwind Holdings, LLC")).toHaveLength(4);
  });
});
