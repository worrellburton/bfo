import { describe, expect, it } from "vitest";
import { canWrite, normalizeIdentifier, normalizePhone, safeEqual, secretMatches, type AppUser } from "../lib/auth";

describe("normalizePhone", () => {
  it("assumes +1 for bare US numbers", () => {
    expect(normalizePhone("(917) 714-8771")).toBe("+19177148771");
    expect(normalizePhone("1 917 714 8771")).toBe("+19177148771");
  });
  it("keeps explicit international numbers", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });
  it("rejects junk", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("12")).toBeNull();
  });
});

describe("normalizeIdentifier", () => {
  it("tells phones from emails", () => {
    expect(normalizeIdentifier(" Someone@Example.com ")).toEqual({ kind: "email", value: "someone@example.com" });
    expect(normalizeIdentifier("520-991-1301")).toEqual({ kind: "phone", value: "+15209911301" });
  });
  it("rejects a malformed email", () => {
    expect(normalizeIdentifier("not@an")).toBeNull();
  });
});

describe("secrets", () => {
  it("compares exactly", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
  it("never matches a missing secret or a non-string", () => {
    expect(secretMatches("x", undefined)).toBe(false);
    expect(secretMatches("", "")).toBe(false);
    expect(secretMatches(["Bearer s"], "Bearer s")).toBe(false);
    expect(secretMatches("Bearer s", "Bearer s")).toBe(true);
  });
});

describe("canWrite", () => {
  const user = (role: AppUser["role"]) => ({ role }) as AppUser;
  it("lets everyone but viewers write", () => {
    expect(canWrite(user("owner"))).toBe(true);
    expect(canWrite(user("admin"))).toBe(true);
    expect(canWrite(user("member"))).toBe(true);
    expect(canWrite(user("viewer"))).toBe(false);
  });
});
