import { describe, expect, it } from "vitest";
import { linkFacts } from "../lib/palm";

// Made-up records: what a new Palm business is created with.
describe("linkFacts", () => {
  const ours = { formationDate: "2023-08-30", address: "1 Main St, Phoenix, AZ 85004", jurisdiction: "US-AZ" };

  it("takes the state's formation date and address from a live read of the same state", () => {
    const rec = { mode: "live", formationDate: "2023-09-11T00:00:00Z", address: "2 Oak Ave, Tucson, AZ 85701", jurisdiction: "US-AZ" };
    expect(linkFacts(ours, rec)).toEqual({ formationDate: "2023-09-11", address: "2 Oak Ave, Tucson, AZ 85701", from: { formationDate: "state", address: "state" } });
  });

  it("keeps ours for a sandbox read, another state's record, or none", () => {
    const sandbox = { mode: "test", formationDate: "2020-01-01", address: "Sandbox", jurisdiction: "US-AZ" };
    expect(linkFacts(ours, sandbox).from).toEqual({ formationDate: "record", address: "record" });
    expect(linkFacts(ours, { ...sandbox, mode: "live", jurisdiction: "US-NV" }).formationDate).toBe("2023-08-30");
    expect(linkFacts(ours, null)).toMatchObject({ formationDate: "2023-08-30", address: ours.address });
  });

  it("fills a blank from the state, and leaves out what neither has", () => {
    expect(linkFacts({ jurisdiction: "US-AZ" }, { mode: "live", address: "2 Oak Ave, Tucson, AZ 85701" })).toEqual({
      formationDate: undefined,
      address: "2 Oak Ave, Tucson, AZ 85701",
      from: { formationDate: null, address: "state" },
    });
  });
});
