import { afterEach, describe, expect, it, vi } from "vitest";
import { loginPath, safeNext } from "../app/auth";

// Sign-in comes back to the page that sent you there (app-layout's guard →
// /login?next=…), but only ever to a page of this app.
describe("safeNext", () => {
  it("keeps a path in this app, query and all", () => {
    expect(safeNext("/tools/signatures/abc")).toBe("/tools/signatures/abc");
    expect(safeNext("/inbox?m=123&f=other")).toBe("/inbox?m=123&f=other");
    expect(safeNext("/treasury/acc1")).toBe("/treasury/acc1");
  });

  it("refuses anything that could leave the site", () => {
    expect(safeNext("https://evil.example/")).toBeNull();
    expect(safeNext("//evil.example/")).toBeNull();
    expect(safeNext("/\\evil.example/")).toBeNull();
    expect(safeNext("/\t/evil.example/")).toBeNull();
    expect(safeNext("javascript:alert(1)")).toBeNull();
    expect(safeNext("treasury")).toBeNull();
    expect(safeNext("")).toBeNull();
    expect(safeNext(null)).toBeNull();
  });

  it("never sends you back to the sign-in pages", () => {
    expect(safeNext("/login")).toBeNull();
    expect(safeNext("/login?next=/home")).toBeNull();
    expect(safeNext("/complete-profile")).toBeNull();
    expect(safeNext("/loginx")).toBe("/loginx");
  });
});

describe("loginPath", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("carries the page being opened", () => {
    vi.stubGlobal("window", { location: { pathname: "/inbox", search: "?m=abc" } });
    expect(loginPath()).toBe("/login?next=%2Finbox%3Fm%3Dabc");
  });

  it("is plain /login from the root or the sign-in pages", () => {
    vi.stubGlobal("window", { location: { pathname: "/", search: "" } });
    expect(loginPath()).toBe("/login");
    vi.stubGlobal("window", { location: { pathname: "/login", search: "" } });
    expect(loginPath()).toBe("/login");
  });
});
