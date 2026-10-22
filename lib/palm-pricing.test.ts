import { describe, expect, it } from "vitest";
import { dollars, palmProduct, priceSuffix, stateRecordCents, STATE_RECORD_CENTS } from "./palm-pricing";

describe("palmProduct", () => {
  it("names the billed calls", () => {
    expect(palmProduct("POST", "/v1/business/registry/search")).toBe("search");
    expect(palmProduct("GET", "/v1/business/registry/US-AZ/L12345678")).toBe("detail");
    expect(palmProduct("GET", "/v1/business/registry/US-DE/name-eligibility?name=x")).toBe("name_eligibility");
  });
  it("leaves the rest unbilled", () => {
    expect(palmProduct("GET", "/v1/business/abc")).toBeNull();
    expect(palmProduct("POST", "/v1/business/search")).toBeNull();
    expect(palmProduct("GET", "/v1/filing/formation/fee?x=1")).toBeNull();
    expect(palmProduct("PATCH", "/v1/business/abc/registered-agent")).toBeNull();
  });
});

describe("prices", () => {
  it("adds a search and a detail for a state record", () => {
    expect(STATE_RECORD_CENTS).toBe(204);
    expect(stateRecordCents(true)).toBe(129);
    expect(dollars(204)).toBe("$2.04");
  });
  it("shows a price only when live", () => {
    expect(priceSuffix("live", 75)).toBe(" · $0.75");
    expect(priceSuffix("test", 75)).toBe("");
  });
});
