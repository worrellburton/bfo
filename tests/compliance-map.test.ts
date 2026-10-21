import { describe, expect, it } from "vitest";
import { assessAll, assessEntity, summarize, treeLevels, type EntityInput } from "../app/compliance-map";

const today = new Date("2026-10-19T12:00:00Z");
const DAY = 86_400_000;
const pillar = (a: ReturnType<typeof assessEntity>, key: string) => a.pillars.find((p) => p.key === key)!;

describe("assessEntity", () => {
  it("asks for the state check when nothing has been read, and says what to do", () => {
    const a = assessEntity("e1", { name: "Quail Lakes Apartments, LLC", type: "LLC", state: "Arizona" }, {}, "live", today);
    expect(pillar(a, "palm")).toMatchObject({ status: "missing", fix: { action: "check-state" } });
    expect(pillar(a, "state")).toMatchObject({ status: "missing", summary: "Never checked with the state" });
    expect(pillar(a, "standing").status).toBe("missing");
    expect(pillar(a, "agent")).toMatchObject({ status: "missing", label: "Statutory agent" });
    expect(a.unverified).toBe(true);
    expect(a.tier).toBe("risk"); // required paperwork is missing too
    // Reading the state comes first, and is asked for once.
    expect(a.fixes[0]).toMatchObject({ action: "check-state", pillar: "state" });
    expect(a.fixes.filter((f) => f.action === "check-state")).toHaveLength(1);
    expect(a.fixes[1].status).toBe("bad");
  });

  it("flags a canceled entity that isn't in good standing, unless it's marked closed", () => {
    const rec = { mode: "live" as const, status: "canceled" as const, standing: { registration: "not_compliant" as const }, checkedAt: today.getTime() - DAY };
    const base: EntityInput = { name: "Ledger Louise, LLC", type: "LLC", state: "Nevada", stateRecord: rec, palm: { live: { businessId: "b", linkedAt: 1 } } };
    const a = assessEntity("e2", base, {}, "live", today);
    expect(pillar(a, "palm").status).toBe("good");
    expect(pillar(a, "state")).toMatchObject({ status: "bad", summary: "The state lists it as canceled" });
    expect(pillar(a, "state").fix?.text).toMatch(/reinstatement with the Nevada Secretary of State/);
    expect(pillar(a, "standing").status).toBe("bad");
    expect(a.tier).toBe("risk");

    const closed = assessEntity("e2", { ...base, status: "Dissolved" }, {}, "live", today);
    expect(pillar(closed, "state").status).toBe("warn");
    expect(pillar(closed, "standing").status).toBe("warn");
    expect(pillar(closed, "deadlines").status).toBe("na");
  });

  it("trusts a fresh active record and asks again once it's stale", () => {
    const rec = { mode: "live" as const, status: "active" as const, standing: { registration: "compliant" as const }, agent: "Palm", checkedAt: today.getTime() - 3 * DAY };
    const a = assessEntity("e3", { name: "Sundown", type: "LLC", state: "Arizona", stateRecord: rec }, {}, "live", today);
    expect(pillar(a, "state")).toMatchObject({ status: "good", summary: "Active, read 3 days ago" });
    expect(pillar(a, "standing").status).toBe("good");
    expect(pillar(a, "tax").status).toBe("na"); // Arizona reports no tax standing
    expect(pillar(a, "agent")).toMatchObject({ status: "good", summary: "Palm" });
    expect(pillar(a, "palm").status).toBe("warn"); // read, but not added to Palm
    expect(a.unverified).toBe(false);

    const old = assessEntity("e3", { name: "Sundown", type: "LLC", state: "Arizona", stateRecord: { ...rec, checkedAt: today.getTime() - 60 * DAY } }, {}, "live", today);
    expect(pillar(old, "state")).toMatchObject({ status: "warn", fix: { action: "check-state" } });
  });

  it("ignores a record from the other Palm mode", () => {
    const rec = { mode: "test" as const, status: "active" as const, checkedAt: today.getTime() };
    const a = assessEntity("e4", { name: "X", type: "LLC", state: "Delaware", stateRecord: rec }, {}, "live", today);
    expect(pillar(a, "state").status).toBe("missing");
  });

  it("leaves a trust out of the state pillars", () => {
    const a = assessEntity("t", { name: "Burton Family Revocable Trust", type: "Trust", state: "Arizona" }, {}, "live", today);
    for (const k of ["palm", "state", "standing", "tax", "agent"]) expect(pillar(a, k).status).toBe("na");
    expect(a.unverified).toBe(false);
  });

  it("asks for the state of formation before any state check", () => {
    const a = assessEntity("vq", { name: "VisionQuest", type: "C-Corp", state: "" }, {}, "live", today);
    expect(a.fixes[0]).toMatchObject({ pillar: "state", status: "bad", cta: "Open entity" });
    expect(a.fixes.some((f) => f.action === "check-state")).toBe(false);
  });

  it("says Palm isn't connected rather than blaming the entity", () => {
    const a = assessEntity("e5", { name: "X", type: "LLC", state: "Arizona" }, {}, null, today);
    expect(pillar(a, "palm")).toMatchObject({ status: "missing", summary: "Palm isn't connected" });
  });
});

describe("the family view", () => {
  const all: Record<string, EntityInput> = {
    trust: { name: "Trust", type: "Trust", state: "Arizona" },
    hold: { name: "Holdco", type: "LLC", state: "Nevada", ownerId: "trust" },
    b: { name: "Beta", type: "LLC", state: "Arizona", ownerId: "hold" },
    a: { name: "Alpha", type: "LLC", state: "Arizona", ownerId: "hold" },
    loose: { name: "Loose", type: "LLC", state: "Arizona", ownerId: "gone" },
    blank: { name: "" },
  };

  it("lays owners out before what they own, by name, and keeps orphans at the top", () => {
    const levels = treeLevels(assessAll(all, "live", today));
    expect(levels.map((c) => c.map((a) => a.name))).toEqual([["Loose", "Trust"], ["Holdco"], ["Alpha", "Beta"]]);
  });

  it("survives an ownership loop", () => {
    const loop = { x: { name: "X", type: "LLC", ownerId: "y" }, y: { name: "Y", type: "LLC", ownerId: "x" } };
    expect(treeLevels(assessAll(loop, "live", today)).flat()).toHaveLength(2);
  });

  it("sums the tiers and the coverage", () => {
    const s = summarize(assessAll(all, "live", today));
    expect(s.total).toBe(5); // the nameless record is skipped
    expect(s.good + s.attention + s.risk).toBe(5);
    expect(s.unverified).toBe(4);
    expect(s.coverage.find((c) => c.key === "state")?.counts.na).toBe(1);
  });
});
