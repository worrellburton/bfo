import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { method: string; path: string; body?: any };
const calls: Call[] = [];
let total: string = "1";
let fromIp: string = "0";
let recent: Array<{ created_at: string }> = [];
const verifyStart = vi.fn(async () => "ver_1");

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    verifyStart: (...a: unknown[]) => (verifyStart as (...x: unknown[]) => unknown)(...a),
    sb: async (path: string, init: { method?: string; body?: unknown } = {}) => {
      const c = { method: init.method ?? "GET", path: decodeURIComponent(path), body: init.body };
      calls.push(c);
      if (c.method === "POST" && c.path.startsWith("login_codes")) return [{ id: "held-1", created_at: "2026-10-23T12:00:00.123456+00:00" }];
      if (c.method === "GET" && c.path.startsWith("app_users")) return [{ id: "u1", status: "approved" }];
      if (c.method === "GET" && c.path.startsWith("login_codes")) return recent;
      return [];
    },
    sbFetch: async (path: string) => {
      calls.push({ method: "COUNT", path: decodeURIComponent(path) });
      const n = path.includes("ip=eq.") ? fromIp : total;
      return new Response("[]", { headers: { "content-range": `0-0/${n}` } });
    },
  };
});

import handler from "../api/auth/request-code";

function call(body: unknown, headers: Record<string, string> = {}) {
  const out: { status: number; json?: any } = { status: 0 };
  const res: any = {
    status: (c: number) => ((out.status = c), res),
    json: (j: unknown) => ((out.json = j), res),
    end: () => res,
    setHeader() {},
  };
  return Promise.resolve(handler({ method: "POST", body, headers } as any, res)).then(() => out);
}

beforeEach(() => {
  calls.length = 0;
  total = "1";
  fromIp = "0";
  recent = [];
  verifyStart.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("/api/auth/request-code", () => {
  it("writes the code's row before counting or sending, and counts only the rows up to it", async () => {
    const r = await call({ phone: "+19175550100" });
    expect(r.status).toBe(200);
    expect(calls[0]).toMatchObject({ method: "POST", path: "login_codes?select=id,created_at", body: [expect.objectContaining({ consumed: true })] });
    expect(calls[1].method).toBe("COUNT");
    expect(calls[1].path).toContain("&created_at=lte.2026-10-23T12:00:00.123456+00:00");
    // The per-number throttle looks only at codes asked for before this one.
    expect(calls.find((c) => c.method === "GET" && c.path.startsWith("login_codes"))!.path).toContain("&created_at=lt.2026-10-23T12:00:00.123456+00:00");
    expect(calls.at(-1)).toMatchObject({ method: "PATCH", path: "login_codes?id=eq.held-1", body: { code_hash: "bird:ver_1", consumed: false } });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("refuses past the hourly cap, sends nothing, and takes its row out", async () => {
    total = "61";
    const r = await call({ phone: "+19175550100" });
    expect(r).toMatchObject({ status: 429, json: { error: "busy" } });
    expect(verifyStart).not.toHaveBeenCalled();
    expect(calls.at(-1)).toEqual({ method: "DELETE", path: "login_codes?id=eq.held-1", body: undefined });
    // The cap itself (60) still sends.
    total = "60";
    expect((await call({ phone: "+19175550100" })).status).toBe(200);
  });

  it("fails closed when the count is unknown", async () => {
    total = "*";
    const r = await call({ phone: "+19175550100" });
    expect(r.status).toBe(500);
    expect(verifyStart).not.toHaveBeenCalled();
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "login_codes?id=eq.held-1" });
  });

  it("stores the caller's address and caps codes per address per ten minutes", async () => {
    const headers = { "x-forwarded-for": "203.0.113.9, 10.0.0.1" };
    fromIp = "4";
    const ok = await call({ phone: "+19175550100" }, headers);
    expect(ok.status).toBe(200);
    expect(calls[0]).toMatchObject({ method: "POST", body: [expect.objectContaining({ ip: "203.0.113.9" })] });
    const ipCount = calls.find((c) => c.method === "COUNT" && c.path.includes("ip=eq."))!;
    expect(ipCount.path).toContain("ip=eq.203.0.113.9");
    expect(ipCount.path).toContain("&created_at=lt.2026-10-23T12:00:00.123456+00:00");
    // The count runs before the account lookup, so a refusal says nothing about who has an account.
    expect(calls.indexOf(ipCount)).toBeLessThan(calls.findIndex((c) => c.method === "GET" && c.path.startsWith("app_users")));

    calls.length = 0;
    verifyStart.mockClear();
    fromIp = "5";
    const r = await call({ phone: "+19175550199" }, headers);
    expect(r).toMatchObject({ status: 429, json: { error: "rate_limited" } });
    expect(verifyStart).not.toHaveBeenCalled();
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "login_codes?id=eq.held-1" });
  });

  it("skips the per-address cap when no address came through", async () => {
    const r = await call({ phone: "+19175550100" }, { "x-forwarded-for": "not an address" });
    expect(r.status).toBe(200);
    expect(calls[0]).toMatchObject({ body: [expect.objectContaining({ ip: null })] });
    expect(calls.some((c) => c.method === "COUNT" && c.path.includes("ip=eq."))).toBe(false);
  });

  it("takes its row out when the per-number throttle refuses", async () => {
    recent = [{ created_at: new Date().toISOString() }];
    expect((await call({ phone: "+19175550100" })).json).toMatchObject({ error: "too_soon" });
    expect(verifyStart).not.toHaveBeenCalled();
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "login_codes?id=eq.held-1" });
  });
});
