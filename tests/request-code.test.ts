import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { method: string; path: string; body?: any };
const calls: Call[] = [];
let total: string = "1";
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
      return new Response("[]", { headers: { "content-range": `0-0/${total}` } });
    },
  };
});

import handler from "../api/auth/request-code";

function call(body: unknown) {
  const out: { status: number; json?: any } = { status: 0 };
  const res: any = {
    status: (c: number) => ((out.status = c), res),
    json: (j: unknown) => ((out.json = j), res),
    end: () => res,
    setHeader() {},
  };
  return Promise.resolve(handler({ method: "POST", body, headers: {} } as any, res)).then(() => out);
}

beforeEach(() => {
  calls.length = 0;
  total = "1";
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

  it("takes its row out when the per-number throttle refuses", async () => {
    recent = [{ created_at: new Date().toISOString() }];
    expect((await call({ phone: "+19175550100" })).json).toMatchObject({ error: "too_soon" });
    expect(verifyStart).not.toHaveBeenCalled();
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "login_codes?id=eq.held-1" });
  });
});
