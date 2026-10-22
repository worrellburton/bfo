import { describe, expect, it } from "vitest";
import { raPatch } from "../lib/palm-agent";
import { businessDifferences } from "../lib/palm";
import { membersFromState, peoplePatch, toStateRecord } from "../lib/registry";
import { stateReadCost } from "../lib/state-reads";

const palmService = { provider: "palm" as const, status: "active" as const, jurisdiction: "US-NV", started_at: "2026-10-01T00:00:00Z", ended_at: null, name: "Palm Registered Agent", address: { street_line_1: "1 Main St", city: "Reno", region: "NV", postal_code: "89501", country: "US" } };

describe("the agent, as Palm reports it", () => {
  it("keeps the whole service, and makes Palm the agent on record when it becomes active (live)", () => {
    const p = raPatch({ registeredAgent: "Northwest", palm: { live: { ra: { status: "pending" } } } }, palmService, "live", 5);
    expect(p["palm/live/ra"]).toEqual({
      status: "active", name: "Palm Registered Agent", address: "1 Main St, Reno, NV 89501", provider: "palm", jurisdiction: "US-NV",
      startedAt: "2026-10-01T00:00:00Z", endedAt: null, rejectionReason: null, checkedAt: 5,
    });
    expect(p).toMatchObject({ registeredAgent: "Palm Registered Agent", registeredAgentSource: "Palm, active since 2026-10-01", registeredAgentAddress: "1 Main St, Reno, NV 89501" });
  });

  it("doesn't rewrite the agent once it's already active, and never in test mode", () => {
    const again = raPatch({ registeredAgent: "Edited by hand", palm: { live: { ra: { status: "active" } } } }, palmService, "live");
    expect(again).not.toHaveProperty("registeredAgent");
    expect(Object.keys(raPatch({}, palmService, "test"))).toEqual(["palm/test/ra"]);
  });

  it("flags the agent to confirm when Palm stops serving", () => {
    const p = raPatch({ registeredAgentSource: "Palm, active since 2026-01-01", palm: { live: { ra: { status: "active" } } } }, { ...palmService, status: "terminated", ended_at: "2026-10-20T00:00:00Z" }, "live");
    expect(p.registeredAgentSource).toBe("Palm stopped serving 2026-10-20 — confirm the current agent");
  });
});

describe("the state's record, kept whole", () => {
  const rec = toStateRecord(
    {
      name: "LEDGER LOUISE, LLC",
      palm_id: "plm_1",
      entity_type: "Foreign LLC",
      formation_jurisdiction: "US-DE",
      registration_jurisdiction: "US-AZ",
      associates: [
        { role: "agent", name: "NORTHWEST" },
        { role: "manager", name: "ROBERT W BURTON", title: "Managing Member", address: { street_line_1: "2 Elm St", city: "Phoenix", region: "AZ", postal_code: "85001" } },
        { role: "member", name: "Burton Holdings LLC" },
        { role: "organizer", name: "Some Filer" },
      ],
    },
    "live",
    Date.parse("2026-10-22T00:00:00Z"),
  );

  it("keeps the type, where it was formed, Palm's id and every person's role, title and address", () => {
    expect(rec).toMatchObject({ entityType: "Foreign LLC", formationJurisdiction: "US-DE", jurisdiction: "US-AZ", palmId: "plm_1" });
    expect(rec.people).toEqual([
      { role: "manager", name: "ROBERT W BURTON", title: "Managing Member", address: "2 Elm St, Phoenix, AZ 85001" },
      { role: "member", name: "Burton Holdings LLC", title: null, address: null },
      { role: "organizer", name: "Some Filer", title: null, address: null },
    ]);
    expect(rec.managers).toEqual(["ROBERT W BURTON", "Burton Holdings LLC"]);
  });

  it("fills an empty People list from it (live), keeping the owning entity", () => {
    expect(membersFromState(rec).map((m) => m.role)).toEqual(["Managing Member", "Member"]);
    const p = peoplePatch({ members: [], ownerId: "a1" }, "Sundown Investments LLC", rec, true);
    expect(p.members).toEqual([
      { name: "Sundown Investments LLC", percent: 100, role: "Member", address: null },
      { name: "ROBERT W BURTON", percent: null, role: "Managing Member", address: "2 Elm St, Phoenix, AZ 85001" },
      { name: "Burton Holdings LLC", percent: null, role: "Member", address: null },
    ]);
    expect(p.membersSource).toBe("State record (AZ), 2026-10-22");
  });

  it("never replaces a list we have, and does nothing in test mode", () => {
    expect(peoplePatch({ members: [{ name: "X" }] }, null, rec, true)).toEqual({});
    expect(peoplePatch({ members: [] }, null, rec, false)).toEqual({});
  });
});

describe("Palm's copy of the business", () => {
  it("lists only real differences", () => {
    const vault = {
      "business.legal_name": "Ledger Louise L.L.C.",
      "business.ein": "123456789",
      "business.registration_number": "E-1",
      "business.address_line_1": "1 Old Rd",
      "business.city": "Reno",
      "business.region": "NV",
      "business.postal_code": "89501",
    };
    const d = businessDifferences(vault, { name: "Ledger Louise, LLC", ein: "12-3456789", fileNumber: "E1", address: "9 New Ave, Reno, NV 89501" });
    expect(d).toEqual([{ field: "Address", palm: "1 Old Rd, Reno, NV 89501", ours: "9 New Ave, Reno, NV 89501" }]);
    expect(businessDifferences({}, { name: "Anything" })).toEqual([]);
  });
});

describe("what a sync costs", () => {
  const entity = { name: "Ledger Louise, LLC", type: "LLC", state: "Nevada", fileNumber: "E1", foreign: { AZ: {}, CA: { notNeeded: true } } };

  it("prices each state: the record alone with a file number, a search first without", () => {
    expect(stateReadCost(entity, "live")).toEqual({ states: [{ code: "NV", home: true, cents: 129 }, { code: "AZ", home: false, cents: 204 }], cents: 333 });
  });

  it("is free in test mode, and for a trust", () => {
    expect(stateReadCost(entity, "test").cents).toBe(0);
    expect(stateReadCost({ ...entity, type: "Trust" }, "live")).toEqual({ states: [], cents: 0 });
  });
});
