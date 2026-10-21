import { describe, expect, it } from "vitest";
import { caseAnswer, caseDefaults, type PalmCase } from "../app/palm-cases";

const c: PalmCase = {
  id: "c1",
  kind: "missing_information",
  status: "needs_response",
  summary: "Additional information needed to complete your filing.",
  opened_at: "2026-10-21T10:00:00Z",
  request: {
    fields: [
      { name: "principal_address", type: "object", description: "Principal business address" },
      { name: "mailing_address", type: "object", description: "Mailing address" },
      { name: "note", type: "string", description: "Anything else", required: false },
    ],
  },
};

describe("answering Palm's questions", () => {
  it("fills addresses from the entity and sends Palm's address shape", () => {
    const values = caseDefaults(c, { name: "TallulahMD LLC", address: "5227 N 7th St STE 48575, Phoenix, AZ 85014" });
    const answer = caseAnswer(c, values);
    const want = { street_line_1: "5227 N 7th St", street_line_2: "STE 48575", city: "Phoenix", region: "AZ", postal_code: "85014", country: "US" };
    expect(answer).toEqual({ fields: { principal_address: want, mailing_address: want } });
  });

  it("says what's still missing", () => {
    expect(caseAnswer(c, caseDefaults(c, {}))).toEqual({ missing: ["Principal business address", "Mailing address"] });
  });
});
