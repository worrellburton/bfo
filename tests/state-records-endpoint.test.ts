import { describe, expect, it, vi } from "vitest";

// "Check all" and the daily cron run inside a 300 s function: they must hand
// checkStateRecords a deadline, so a long run ends with "later" instead of
// being killed mid-loop (which shows every entity as failed).

const seen: Array<{ deadline?: number; force?: boolean }> = [];
vi.mock("../lib/state-records.js", () => ({
  checkStateRecords: async (opts: { deadline?: number; force?: boolean }) => {
    seen.push(opts);
    return [
      { id: "a1", name: "One LLC", state: "DE", outcome: "read" },
      { id: "a2", name: "Two LLC", state: "DE", outcome: "later" },
    ];
  },
}));
vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return { ...actual, currentUser: async () => ({ id: "u1", name: "Rob", role: "owner", status: "approved" }) };
});

import handler from "../api/cron/state-records";

describe("state-records endpoint", () => {
  it("passes a deadline well under the function limit", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const out: { status: number; body?: any } = { status: 0 };
    const res: any = { status: (s: number) => ((out.status = s), res), json: (b: unknown) => ((out.body = b), res), end: () => res };
    const before = Date.now();
    await handler({ method: "POST", headers: {}, body: { ids: ["a1", "a2"], force: true } } as any, res);
    expect(out.status).toBe(200);
    expect(out.body.counts).toEqual({ read: 1, later: 1 });
    const { deadline, force } = seen[0];
    expect(force).toBe(true);
    expect(deadline).toBeGreaterThanOrEqual(before + 200_000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 260_000);
  });
});
