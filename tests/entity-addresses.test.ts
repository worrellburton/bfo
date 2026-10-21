import { describe, expect, it } from "vitest";
import { entityAddresses, foreignStates } from "../app/entity-addresses";
import { describeChange } from "../lib/activity";

const STABLE = "5227 N 7th St STE 48575, Phoenix, AZ 85014";
const PALM_DE = "8 The Green, Ste A, Dover, DE 19901";

describe("an entity's addresses", () => {
  const tallulah = { name: "TallulahMD LLC", type: "LLC", state: "Delaware", address: STABLE, registeredAgent: "Palm Registered Agents LLC", registeredAgentAddress: PALM_DE };

  it("keeps the principal office, mailing address and an agent per state apart", () => {
    const a = entityAddresses(tallulah);
    expect(a.principal.value).toBe(STABLE);
    expect(a.mailing).toMatchObject({ value: STABLE, same: true });
    expect(a.agents.map((g) => [g.state, g.term, g.home])).toEqual([["DE", "Registered agent", true], ["AZ", "Statutory agent", false]]);
    // Its address is in Phoenix: BFO asks whether it does business in Arizona.
    expect(a.gaps[0]).toMatchObject({ tone: "warn", where: "Statutory agent · Arizona" });
    expect(a.agents[1].ask).toBe(true);
  });

  it("refuses an agent at a mailbox or out of state", () => {
    const g = entityAddresses({ ...tallulah, registeredAgentAddress: STABLE }).agents[0];
    expect(g.checks.map((c) => c.text)).toEqual([
      "An agent's address must be a street address where papers can be handed over, not a PO box or mailbox.",
      "The agent's address is in Arizona; it must be in Delaware.",
    ]);
    expect(entityAddresses({ ...tallulah, registeredAgentAddress: "PO Box 12, Dover, DE 19901" }).agents[0].checks[0].tone).toBe("bad");
  });

  it("checks each against the state's own record", () => {
    const rec = { mode: "live" as const, agent: "Palm Registered Agents, LLC", agentAddress: "8 The Green Suite A, Dover, DE 19901", address: "11201 N Tatum Blvd, Phoenix, AZ 85028", checkedAt: 0 };
    const a = entityAddresses({ ...tallulah, stateRecord: rec, foreign: { AZ: { agent: "Palm", agentAddress: "2 N Central Ave, Phoenix, AZ 85004" } } });
    expect(a.principal.checks).toEqual([{ tone: "warn", text: "The state has 11201 N Tatum Blvd, Phoenix, AZ 85028." }]);
    expect(a.agents[0].checks).toEqual([{ tone: "good", text: "Matches Delaware's record" }]);
    expect(a.agents[1].checks).toEqual([]);
    expect(entityAddresses({ ...tallulah, stateRecord: { ...rec, agentAddress: "1 Other St, Dover, DE 19901" } }).agents[0].checks[0].text).toBe("Delaware's record has the agent at 1 Other St, Dover, DE 19901.");
  });

  it("lists every state it's registered in, home state aside", () => {
    expect(foreignStates({ state: "Delaware", address: STABLE, foreign: { NV: {}, DE: {} } })).toEqual(["AZ", "NV"]);
    expect(foreignStates({ state: "Arizona", address: STABLE })).toEqual([]);
    expect(entityAddresses({ name: "Burton Family Trust", type: "Trust", state: "Arizona", address: STABLE }).agents).toEqual([]);
  });

  it("shows another state's agent in the activity", () => {
    const out = describeChange({ name: "T" }, { name: "T", foreign: { AZ: { agent: "Palm" } }, mailingAddress: STABLE });
    expect(out[0].summary).toBe("Changed the mailing address and AZ agent");
  });
});

describe("a state with no registration", () => {
  it("says it isn't registered there yet", () => {
    const a = entityAddresses({ name: "Ledger Louise, LLC", type: "LLC", state: "Nevada", address: "5227 N 7th St STE 48575, Phoenix, AZ 85014", registeredAgent: "NW", registeredAgentAddress: "732 S 6th St, Las Vegas, NV 89101", registryMiss: { AZ: { outcome: "not_found", at: Date.parse("2026-10-20T21:40:00Z") } }, foreign: { AZ: { confirmed: true } } });
    expect(a.agents[1].checks[0].text).toMatch(/^Not registered in Arizona: its registry had no entry for this name \(checked Oct 20\)/);
  });
});

describe("an entity formed through BFO, still with the state", () => {
  const forming = {
    name: "TallulahMD LLC", type: "LLC", state: "Delaware", address: "5227 N 7th St STE 48575, Phoenix, AZ 85014",
    palm: { live: { formation: { status: "processing", registeredAgent: { status: "pending" } } } },
    registryMiss: { DE: { outcome: "not_found" as const, at: 0 }, AZ: { outcome: "not_found" as const, at: 0 } },
  };

  it("has Palm as its agent to be, and no registry miss", () => {
    const g = entityAddresses(forming).agents[0];
    expect(g).toMatchObject({ name: "Palm", palm: true });
    expect(g.checks).toEqual([{ tone: "info", text: "Palm becomes the registered agent when Delaware approves the formation; its address shows then." }]);
  });

  it("asks about Arizona instead of assuming, and drops it once told it's only mail", () => {
    const az = entityAddresses(forming).agents[1];
    expect(az.ask).toBe(true);
    expect(az.checks[0].text).toMatch(/^Its address is in Arizona\. If it does business there/);
    const mailOnly = entityAddresses({ ...forming, foreign: { AZ: { notNeeded: true } } });
    expect(mailOnly.agents.map((g) => g.state)).toEqual(["DE"]);
    expect(mailOnly.notNeeded).toEqual(["AZ"]);
    expect(entityAddresses({ ...forming, foreign: { AZ: { confirmed: true } } }).agents[1].checks[0].tone).toBe("bad");
  });
});

describe("is Palm the agent", () => {
  it("believes Palm unless the record and the state both name someone else", async () => {
    const { palmServes } = await import("../app/entity-addresses");
    const active = { palm: { live: { ra: { status: "active" } } } };
    expect(palmServes(active)).toBe(true);
    expect(palmServes({ ...active, registeredAgent: "Palm Registered Agents LLC" })).toBe(true);
    expect(palmServes({ ...active, registeredAgent: "Northwest Registered Agent LLC", stateRecord: { mode: "live", agent: "Northwest Registered Agent LLC", checkedAt: 0 } })).toBe(false);
    expect(palmServes({ registeredAgentSource: "Palm stopped serving 2026-01-01 — confirm the current agent" })).toBe(false);
  });
});
