import { describe, expect, it } from "vitest";
import { patchFor, statesToRead } from "../lib/state-records";

const rec = (over = {}) => ({ mode: "live" as const, agent: "Northwest Registered Agent LLC", agentAddress: "4539 N 22nd St, Ste N, Phoenix, AZ 85016", registrationNumber: "L123", checkedAt: 1, ...over });

describe("reading every state record", () => {
  it("reads the home state, then each state it's registered in as foreign", () => {
    expect(statesToRead({ name: "TallulahMD LLC", type: "LLC", state: "Delaware", address: "5227 N 7th St STE 48575, Phoenix, AZ 85014", foreign: { NV: {} } })).toEqual([
      { code: "DE", home: true },
      { code: "AZ", home: false },
      { code: "NV", home: false },
    ]);
    expect(statesToRead({ name: "Burton Family Trust", type: "Trust", state: "Arizona" })).toEqual([]);
  });

  it("fills only blanks, and never copies the Secretary of State in as agent", () => {
    expect(patchFor({ name: "X", fileNumber: "" }, "AZ", true, rec(), true)).toMatchObject({ fileNumber: "L123", registeredAgent: "Northwest Registered Agent LLC", registeredAgentAddress: "4539 N 22nd St, Ste N, Phoenix, AZ 85016" });
    const kept = patchFor({ name: "X", fileNumber: "F1", registeredAgent: "Someone Else", registeredAgentAddress: "" }, "AZ", true, rec(), true);
    expect(Object.keys(kept)).toEqual(["stateRecord"]);
    expect(Object.keys(patchFor({ name: "X", fileNumber: "F1" }, "DE", true, rec({ agent: "DELAWARE SECRETARY OF STATE" }), true))).toEqual(["stateRecord"]);
    expect(patchFor({ name: "X" }, "AZ", false, rec(), true)).toMatchObject({ "foreign/AZ/fileNumber": "L123", "foreign/AZ/agent": "Northwest Registered Agent LLC" });
    expect(Object.keys(patchFor({ name: "X" }, "AZ", false, rec(), false))).toEqual(["foreign/AZ/record"]);
  });
});

describe("matching a registry entry", () => {
  it("finds an entity whose name on record leaves off its ending or carries a note", async () => {
    const { pickRegistryMatch, searchName } = await import("../lib/registry");
    const results = [{ name: "BREEZEWOOD, LLC", registration_jurisdiction: "US-AZ" }, { name: "BREEZEWOOD HOLDINGS LLC", registration_jurisdiction: "US-AZ" }];
    expect(searchName("Breezewood (100%)")).toBe("Breezewood");
    expect(pickRegistryMatch(results, "Breezewood (100%)", "US-AZ")?.name).toBe("BREEZEWOOD, LLC");
    expect(pickRegistryMatch([{ name: "BREEZEWOOD LLC", registration_jurisdiction: "US-NV" }], "Breezewood", "US-AZ")).toBeNull();
  });
});

describe("what the daily check skips", () => {
  it("skips an entity still being formed, and a state it only gets mail in", () => {
    expect(statesToRead({ name: "T LLC", type: "LLC", state: "Delaware", palm: { live: { formation: { status: "processing" } } } })).toEqual([]);
    expect(statesToRead({ name: "T LLC", type: "LLC", state: "Delaware", address: "1 Main St, Phoenix, AZ 85014", foreign: { AZ: { notNeeded: true } } })).toEqual([{ code: "DE", home: true }]);
  });
});
