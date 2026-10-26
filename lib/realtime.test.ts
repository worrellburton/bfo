import { describe, expect, it } from "vitest";
import { realtimeTools, spokenInstructions } from "./realtime";

describe("realtime", () => {
  it("hands the tools over as functions", () => {
    const out = realtimeTools([{ name: "list_entities", description: "Every entity.", input_schema: { type: "object", properties: {} } }]);
    expect(out).toEqual([{ type: "function", name: "list_entities", description: "Every entity.", parameters: { type: "object", properties: {} } }]);
  });
  it("adds the spoken manner to the prompt", () => {
    expect(spokenInstructions("Base.")).toMatch(/^Base\.\n\nYou are speaking aloud/);
  });
});
