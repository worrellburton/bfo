import { describe, expect, it } from "vitest";
import { pushId } from "../app/store";

describe("push ids", () => {
  it("are 20 chars and sort by time, then by creation order within one millisecond", () => {
    const a = pushId(1_700_000_000_000);
    const b = pushId(1_700_000_000_000);
    const c = pushId(1_700_000_000_001);
    expect(a).toHaveLength(20);
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
    expect(a.slice(0, 8)).toBe(b.slice(0, 8));
    expect(/^[-0-9A-Z_a-z]{20}$/.test(a)).toBe(true);
  });
});
