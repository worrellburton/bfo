import { describe, expect, it } from "vitest";
import { alertTitle, easternHour, groupAlerts, jobStatus, scheduleLine } from "../app/notifications-model";

describe("when the Treasury report goes out", () => {
  it("is said from the choice and the cron's real hour, which moves with daylight saving", () => {
    expect(easternHour(new Date("2026-11-09T00:00:00Z"))).toBe("7 AM");
    expect(easternHour(new Date("2026-07-06T00:00:00Z"))).toBe("8 AM");
    expect(scheduleLine({ frequency: "weekly", dayOfWeek: 1 }, 2, new Date("2026-11-09T00:00:00Z"))).toBe("Goes out every Monday at about 7 AM Eastern to you and 2 others.");
    expect(scheduleLine({ frequency: "monthly", dayOfMonth: 2 }, 0, new Date("2026-11-09T00:00:00Z"))).toBe("Goes out on the 2nd of each month at about 7 AM Eastern to you.");
    expect(scheduleLine({ frequency: "off" }, 0)).toBeNull();
  });
});

describe("scheduled jobs in words", () => {
  const now = new Date("2026-11-06T18:00:00Z");
  it("flags a job that never ran, failed, or is late; a skip says so", () => {
    expect(jobStatus({ name: "investment-history", started_at: null, finished_at: null, ok: null, note: null }, now)).toMatchObject({ tone: "warning", text: "Hasn’t run yet" });
    expect(jobStatus({ name: "books-sync", started_at: "2026-11-06T17:00:00Z", finished_at: "2026-11-06T17:01:00Z", ok: false, note: "Plaid said no" }, now)).toMatchObject({ tone: "negative", text: "Failed 1 hour ago" });
    expect(jobStatus({ name: "books-sync", started_at: "2026-11-04T12:00:00Z", finished_at: "2026-11-04T12:01:00Z", ok: true, note: "skipped: before sunrise (2026-11-04T11:45:00.000Z)" }, now)).toMatchObject({ tone: "warning", text: "Skipped Nov 4", note: null });
    expect(jobStatus({ name: "stable", started_at: "2026-11-06T17:20:00Z", finished_at: "2026-11-06T17:21:00Z", ok: true, note: '{"fresh":21}' }, now)).toMatchObject({ tone: "neutral", text: "Ran 40 min ago", note: null });
  });
});

describe("alerts", () => {
  it("group repeats into one row with a count, newest first", () => {
    const g = groupAlerts([
      { id: "a", kind: "cron:state-records", title: "Registry check failed", detail: "x", created_at: "2026-10-28T00:00:00Z", acknowledged_at: null },
      { id: "b", kind: "cron:state-records", title: "Registry check failed", detail: "y", created_at: "2026-10-29T00:00:00Z", acknowledged_at: null },
      { id: "c", kind: "cron:game-assets", title: "game-assets cron didn't finish cleanly", detail: null, created_at: "2026-11-05T00:00:00Z", acknowledged_at: null },
      { id: "d", kind: "cron:stable", title: "Seen", detail: null, created_at: "2026-11-05T00:00:00Z", acknowledged_at: "2026-11-05T01:00:00Z" },
    ]);
    expect(g.map((x) => [x.times, x.ids])).toEqual([
      [1, ["c"]],
      [2, ["a", "b"]],
    ]);
    expect(g[1].detail).toBe("y");
    expect(alertTitle(g[0])).toBe("Signing game pictures didn't finish cleanly");
  });
});
