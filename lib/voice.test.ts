import { describe, expect, it } from "vitest";
import { spokenForm } from "./voice";

describe("spokenForm", () => {
  it("reads links, emphasis and lists as words", () => {
    expect(spokenForm("**Two** filings are due:\n- [Sundown](/assets/a2) on Nov 14\n- Catalog Digital on `Mar 1`")).toBe("Two filings are due:\nSundown on Nov 14\nCatalog Digital on Mar 1");
  });
  it("reads a table one row at a time, with its headers", () => {
    expect(spokenForm("| Entity | Due | Fee |\n|---|---|---|\n| Sundown | Nov 14 | $45 |")).toBe("Sundown, Due: Nov 14, Fee: $45.");
  });
});
