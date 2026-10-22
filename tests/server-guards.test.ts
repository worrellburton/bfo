import type { VercelRequest } from "@vercel/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cronAuth, handleError, ConfigError, refuseCron, signInAllowed } from "../lib/auth";

describe("signInAllowed", () => {
  it("allows only +1 numbers by default", () => {
    expect(signInAllowed("+19177148771", undefined)).toBe(true);
    expect(signInAllowed("+442079460958", undefined)).toBe(false);
    expect(signInAllowed("+79161234567", undefined)).toBe(false);
  });

  it("treats a blank list as the default", () => {
    expect(signInAllowed("+19177148771", "  ")).toBe(true);
    expect(signInAllowed("+442079460958", "")).toBe(false);
  });

  it("reads a comma list, with or without plus signs and spaces", () => {
    expect(signInAllowed("+442079460958", "+1, 44")).toBe(true);
    expect(signInAllowed("+19177148771", "+1, 44")).toBe(true);
    expect(signInAllowed("+33612345678", "+1, 44")).toBe(false);
  });

  it("matches longer country codes in full", () => {
    expect(signInAllowed("+353861234567", "+353")).toBe(true);
    expect(signInAllowed("+351912345678", "+353")).toBe(false);
  });

  it("ignores entries that aren't country codes", () => {
    expect(signInAllowed("+19177148771", "abc, +")).toBe(false);
  });

  it("allows any country with *", () => {
    expect(signInAllowed("+79161234567", "*")).toBe(true);
  });

  it("refuses anything that isn't E.164", () => {
    expect(signInAllowed("9177148771", "+1")).toBe(false);
    expect(signInAllowed("", "*")).toBe(false);
  });

  it("reads SIGNIN_COUNTRY_CODES when no list is passed", () => {
    vi.stubEnv("SIGNIN_COUNTRY_CODES", "+44");
    expect(signInAllowed("+442079460958")).toBe(true);
    expect(signInAllowed("+19177148771")).toBe(false);
    vi.unstubAllEnvs();
  });
});

function fakeRes() {
  const out: { status?: number; json?: any } = {};
  const res: any = { status: (c: number) => ((out.status = c), res), json: (j: unknown) => ((out.json = j), res) };
  return { res, out };
}

const req = (headers: Record<string, string>) => ({ headers }) as unknown as VercelRequest;

describe("cronAuth", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed when CRON_SECRET is unset, even with Vercel's schedule header", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(cronAuth(req({ "x-vercel-cron-schedule": "0 12 * * *" }))).toBe("unconfigured");
  });

  it("requires the Bearer secret; the schedule header alone doesn't pass", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(cronAuth(req({ "x-vercel-cron-schedule": "0 12 * * *" }))).toBe("unauthorized");
    expect(cronAuth(req({ authorization: "Bearer wrong" }))).toBe("unauthorized");
    expect(cronAuth(req({ authorization: "Bearer s3cret" }))).toBe("ok");
  });

  it("answers 503 when unconfigured and 401 when wrong", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const a = fakeRes();
    refuseCron(req({}), a.res, "test", "unconfigured");
    expect(a.out.status).toBe(503);
    expect(a.out.json.error).toBe("cron_secret_missing");
    const b = fakeRes();
    refuseCron(req({}), b.res, "test", "unauthorized");
    expect(b.out).toEqual({ status: 401, json: { error: "unauthorized" } });
  });
});

describe("handleError", () => {
  it("keeps database detail out of the response", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, out } = fakeRes();
    handleError(res, new Error('supabase 400: {"message":"column app_users.secret does not exist"}'));
    expect(out.status).toBe(500);
    expect(out.json.error).toBe("server_error");
    expect(JSON.stringify(out.json)).not.toMatch(/app_users|supabase/);
    expect(log).toHaveBeenCalled();
  });

  it("still explains configuration problems", () => {
    const { res, out } = fakeRes();
    handleError(res, new ConfigError("BIRD_ACCESS_KEY is not set"));
    expect(out).toEqual({ status: 503, json: { error: "not_configured", message: "BIRD_ACCESS_KEY is not set" } });
  });
});
