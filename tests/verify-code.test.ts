import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CODE_ATTEMPTS, hashCode } from "../lib/auth";

/**
 * A fake login_codes table with PostgREST's filter semantics for the one row
 * verify-code touches: a PATCH applies only when every filter in its query
 * string holds against the row *as it is at write time*, and returns the rows
 * it changed. That is what makes two racing guesses distinguishable.
 */
type Row = { id: string; identifier: string; code_hash: string; expires_at: string; attempts: number; consumed: boolean };
let row: Row;
const calls: Array<{ method: string; path: string; body?: any }> = [];
let readsWaiting: Array<() => void> = [];
let readsExpected = 1;

function filtersHold(path: string): boolean {
  const qs = new URLSearchParams(path.split("?")[1]);
  for (const [k, v] of qs) {
    if (k === "select") continue;
    const [op, val] = [v.slice(0, v.indexOf(".")), v.slice(v.indexOf(".") + 1)];
    const cur = (row as any)[k];
    if (op === "eq" && String(cur) !== val) return false;
    if (op === "is" && String(cur) !== val) return false;
    if (op === "lt" && !(Number(cur) < Number(val))) return false;
  }
  return true;
}

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    verifyCheck: async () => "wrong",
    sb: async (path: string, init: { method?: string; body?: any } = {}) => {
      const method = init.method ?? "GET";
      calls.push({ method, path, body: init.body });
      if (method === "GET" && path.startsWith("login_codes")) {
        // Hold every read until all the racing requests have read, so each
        // sees the same attempts count — the worst case for the write.
        await new Promise<void>((resolve) => {
          readsWaiting.push(resolve);
          if (readsWaiting.length >= readsExpected) {
            for (const r of readsWaiting) r();
            readsWaiting = [];
          }
        });
        return row.consumed ? [] : [{ ...row }];
      }
      if (method === "PATCH" && path.startsWith("login_codes")) {
        if (!filtersHold(path)) return [];
        Object.assign(row, init.body);
        return [{ id: row.id }];
      }
      if (method === "GET" && path.startsWith("app_users")) return [{ id: "u1", status: "approved", verified_at: null }];
      if (method === "POST" && path.startsWith("app_sessions")) return [{ token: "tok", expires_at: "2027-01-01T00:00:00Z" }];
      return [];
    },
  };
});

import handler from "../api/auth/verify-code";

const PHONE = "+19175550100";
const CODE = "123456";

function call(code: string) {
  const out: { status: number; json?: any } = { status: 0 };
  const res: any = {
    status: (c: number) => ((out.status = c), res),
    json: (j: unknown) => ((out.json = j), res),
    end: () => res,
    setHeader() {},
  };
  return Promise.resolve(handler({ method: "POST", body: { phone: PHONE, code }, headers: {} } as any, res)).then(() => out);
}

beforeEach(() => {
  calls.length = 0;
  readsWaiting = [];
  readsExpected = 1;
  row = {
    id: "0f0f0f0f-0000-4000-8000-000000000001",
    identifier: PHONE,
    code_hash: hashCode(PHONE, CODE),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    attempts: 0,
    consumed: false,
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("/api/auth/verify-code", () => {
  it("counts a wrong guess with a write conditioned on the count it read", async () => {
    const r = await call("000000");
    expect(r).toMatchObject({ status: 401, json: { error: "wrong_code" } });
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.path).toContain("consumed=is.false");
    expect(patch.path).toContain("attempts=eq.0");
    expect(patch.path).toContain(`attempts=lt.${MAX_CODE_ATTEMPTS}`);
    expect(row.attempts).toBe(1);
  });

  it("lets only one of two racing wrong guesses spend the last attempt", async () => {
    row.attempts = MAX_CODE_ATTEMPTS - 1;
    readsExpected = 2;
    const [a, b] = await Promise.all([call("000000"), call("111111")]);
    // Both read attempts = MAX-1, and both were refused: one spent the attempt,
    // the other found the row already moved and was turned away by the write.
    expect([a.status, b.status].sort()).toEqual([401, 429]);
    expect(row.attempts).toBe(MAX_CODE_ATTEMPTS);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(2);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("lets only one of two racing right guesses sign in (one-time use)", async () => {
    readsExpected = 2;
    const [a, b] = await Promise.all([call(CODE), call(CODE)]);
    expect([a.status, b.status].sort()).toEqual([200, 429]);
    expect(row.consumed).toBe(true);
    expect(row.attempts).toBe(1);
    expect(calls.filter((c) => c.method === "POST" && c.path.startsWith("app_sessions"))).toHaveLength(1);
  });

  it("still refuses an expired or used-up code before any write", async () => {
    row.attempts = MAX_CODE_ATTEMPTS;
    expect((await call(CODE)).json).toMatchObject({ error: "too_many_attempts" });
    row.attempts = 0;
    row.expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await call(CODE)).json).toMatchObject({ error: "code_expired" });
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});
