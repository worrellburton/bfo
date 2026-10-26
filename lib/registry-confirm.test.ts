import { describe, expect, it } from "vitest";
import { activeConfirmation, effectiveRecord, type StateRecord } from "./registry";

const stale: StateRecord = { mode: "live", status: "canceled", standing: { registration: "not_compliant" }, checkedAt: 1 };
const now = Date.UTC(2026, 9, 26);
const confirmed = { at: now, by: "Robert Burton", palmStatus: "canceled" as const, palmRegistration: "not_compliant" as const };

describe("state confirmation", () => {
  it("overrides the stale reading it was made against", () => {
    expect(activeConfirmation(stale, confirmed, now)).toBe(confirmed);
    const r = effectiveRecord(stale, confirmed, now);
    expect(r.status).toBe("active");
    expect(r.standing?.registration).toBe("compliant");
  });
  it("lets a different reading through", () => {
    const revoked = { ...stale, status: "inactive" as const };
    expect(effectiveRecord(revoked, confirmed, now).status).toBe("inactive");
  });
  it("is moot once Palm agrees, and expires after a year", () => {
    expect(activeConfirmation({ ...stale, status: "active", standing: { registration: "compliant" } }, confirmed, now)).toBeNull();
    expect(activeConfirmation(stale, confirmed, now + 400 * 86_400_000)).toBeNull();
  });
});
