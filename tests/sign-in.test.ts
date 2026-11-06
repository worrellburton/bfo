import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigError, hashCode, type AppUser } from "../lib/auth";

// Sign-in's shared steps (lib/sign-in.ts), what verify-code does once a code is
// right, and the Terms check (lib/terms.ts). sb() is a fake; nothing is sent.

type Call = { method: string; path: string; body?: any };
const calls: Call[] = [];
let account: Partial<AppUser> | null = null;
let codeRow: Record<string, unknown> | null = null;
let failColumn = false;

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    verifyStart: async () => "ver_1",
    sb: async (path: string, init: { method?: string; body?: unknown } = {}) => {
      const c = { method: init.method ?? "GET", path: decodeURIComponent(path), body: init.body as any };
      calls.push(c);
      if (failColumn && c.method === "POST" && c.path.startsWith("login_codes") && JSON.stringify(c.body).includes("consent_version")) {
        throw new Error(`Supabase POST login_codes failed: 400 {"code":"PGRST204","message":"Could not find the 'consent_version' column of 'login_codes' in the schema cache"}`);
      }
      if (c.method === "POST" && c.path.startsWith("login_codes")) return [{ id: "held-1", created_at: "2026-10-23T12:00:00.123456+00:00" }];
      if (c.method === "GET" && c.path.startsWith("login_codes?identifier") && c.path.includes("consumed=is.false")) return codeRow ? [{ ...codeRow }] : [];
      if (c.method === "GET" && c.path.startsWith("login_codes")) return [];
      if (c.method === "PATCH" && c.path.startsWith("login_codes")) return [{ id: "row" }];
      if (c.method === "GET" && c.path.startsWith("app_users")) return account ? [{ ...account }] : [];
      if (c.method === "POST" && c.path === "app_users") return [{ id: "new-1", name: null, role: "viewer", status: "incoming", ...(c.body as any[])[0] }];
      if (c.method === "POST" && c.path.startsWith("app_sessions")) return [{ token: "tok", expires_at: "2027-01-01T00:00:00Z" }];
      return [];
    },
    sbFetch: async () => new Response("[]", { headers: { "content-range": "0-0/1" } }),
  };
});

import { isMissingColumn, lastFour, publicRefusal, purgePaths, signedInUser, writeWithOptional } from "../lib/sign-in";
import { needsTerms, TERMS_VERSION } from "../lib/terms";
import requestCode from "../api/auth/request-code";
import verifyCode, { NOT_ALLOWED } from "../api/auth/verify-code";

function run(handler: (req: any, res: any) => unknown, body: unknown) {
  const out: { status: number; json?: any } = { status: 0 };
  const res: any = {
    status: (c: number) => ((out.status = c), res),
    json: (j: unknown) => ((out.json = j), res),
    end: () => res,
    setHeader() {},
  };
  return Promise.resolve(handler({ method: "POST", body, headers: { "user-agent": "TestBrowser/1.0" }, query: {} }, res)).then(() => out);
}

const PHONE = "+19175550100";
const CODE = "123456";

beforeEach(() => {
  calls.length = 0;
  account = null;
  failColumn = false;
  codeRow = { id: "0f0f0f0f-0000-4000-8000-000000000001", identifier: PHONE, code_hash: hashCode(PHONE, CODE), expires_at: new Date(Date.now() + 60_000).toISOString(), attempts: 0, consumed: false };
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("lib/sign-in", () => {
  it("tells a caller nothing about providers or settings", () => {
    expect(publicRefusal(new ConfigError("BIRD_ACCESS_KEY is not in the bk_{region}_{token} format Verify expects."))).toEqual({
      status: 503,
      error: "unavailable",
      message: "Sign-in isn't available right now. Try again later.",
    });
    expect(publicRefusal(new ConfigError("Bird Verify rejected the request (500): upstream text"))?.message).not.toMatch(/Bird|500|upstream/);
    expect(publicRefusal(new ConfigError("Too many codes requested for this address. Wait a minute and try again."))?.status).toBe(429);
    expect(publicRefusal(new Error("anything else"))).toBeNull();
  });

  it("purges only old codes and requests that never had access", () => {
    const [codes, waiting] = purgePaths(new Date("2026-11-06T00:00:00Z"));
    expect(decodeURIComponent(codes)).toBe("login_codes?created_at=lt.2026-08-08T00:00:00.000Z&select=id");
    expect(decodeURIComponent(waiting)).toContain("status=eq.incoming");
    expect(waiting).toContain("approved_at=is.null");
    expect(waiting).toContain("mail_address=is.null");
    expect(decodeURIComponent(waiting)).toContain("created_at=lt.2026-10-07T00:00:00.000Z");
  });

  it("writes again without a column the database doesn't have yet, and only then", async () => {
    const write = vi.fn(async (b: Record<string, unknown>) => {
      if ("consent_version" in b) throw new Error("PGRST204 Could not find the 'consent_version' column");
      return b;
    });
    expect(await writeWithOptional(write, { a: 1, consent_version: "x" }, ["consent_version"])).toEqual({ a: 1 });
    expect(write).toHaveBeenCalledTimes(2);
    await expect(writeWithOptional(async () => Promise.reject(new Error("duplicate key")), { a: 1, consent_version: "x" }, ["consent_version"])).rejects.toThrow("duplicate key");
    expect(isMissingColumn(new Error("column app_users.removed_at does not exist"))).toBe(true);
  });

  it("keeps only the last four of a number", () => {
    expect(lastFour("+19175550100")).toBe("•• 0100");
  });
});

describe("the Terms check", () => {
  it("asks only when the server tracks agreement and the version is old or missing", () => {
    expect(needsTerms({ termsVersion: null })).toBe(true);
    expect(needsTerms({ termsVersion: "2020-01-01" })).toBe(true);
    expect(needsTerms({ termsVersion: TERMS_VERSION })).toBe(false);
    expect(needsTerms({})).toBe(false);
    expect(needsTerms(null)).toBe(false);
  });

  it("sends the agreed version only when the database has the column", () => {
    const base = {
      id: "u",
      name: "A B",
      email: null,
      phone: PHONE,
      role: "member",
      status: "approved",
      created_at: "",
      approved_at: null,
      verified_at: null,
      last_login_at: null,
      last_seen_at: null,
      mail_address: null,
    } as AppUser;
    expect(signedInUser(base)).not.toHaveProperty("termsVersion");
    expect(signedInUser({ ...base, terms_version: null } as AppUser)).toMatchObject({ termsVersion: null });
  });
});

describe("/api/auth/request-code", () => {
  it("keeps the disclosure version with the code, and never looks up the account", async () => {
    const r = await run(requestCode, { identifier: PHONE, consent: "sms-2026-11-06" });
    expect(r.status).toBe(200);
    expect(calls[0].body[0]).toMatchObject({ consent_version: "sms-2026-11-06", consumed: true });
    expect(calls.some((c) => c.path.startsWith("app_users"))).toBe(false);
  });

  it("still sends when the consent column isn't there yet", async () => {
    failColumn = true;
    const r = await run(requestCode, { identifier: PHONE, consent: "sms-2026-11-06" });
    expect(r.status).toBe(200);
    expect(calls.filter((c) => c.method === "POST" && c.path.startsWith("login_codes"))).toHaveLength(2);
  });
});

describe("/api/auth/verify-code, once the code is right", () => {
  it("turns an unknown number into a request to join that can change nothing", async () => {
    const r = await run(verifyCode, { phone: PHONE, code: CODE });
    expect(r.json).toMatchObject({ verified: true, status: "incoming", token: null });
    const created = calls.find((c) => c.method === "POST" && c.path === "app_users")!;
    expect(created.body[0]).toMatchObject({ phone: PHONE, role: "viewer", status: "incoming", verified_at: expect.any(String) });
    expect(calls.find((c) => c.path.startsWith("audit_log"))?.body).toMatchObject({ action: "user.request", target_label: "•• 0100" });
  });

  it("gives a refused number one plain answer, after the code, and records it", async () => {
    account = { id: "u1", name: "Pat Doe", role: "member", status: "denied", verified_at: "2026-01-01T00:00:00Z" };
    const r = await run(verifyCode, { phone: PHONE, code: CODE });
    expect(r).toMatchObject({ status: 403, json: { error: "not_allowed", message: NOT_ALLOWED } });
    expect(calls.some((c) => c.path.startsWith("app_sessions"))).toBe(false);
    expect(calls.find((c) => c.path.startsWith("audit_log"))?.body).toMatchObject({ action: "auth.sign_in_refused" });
  });

  it("records a sign-in with the device, never the session token", async () => {
    account = { id: "u1", name: "Pat Doe", role: "member", status: "approved", verified_at: "2026-01-01T00:00:00Z" };
    const r = await run(verifyCode, { phone: PHONE, code: CODE });
    expect(r.status).toBe(200);
    const entry = calls.find((c) => c.path.startsWith("audit_log") && c.body.action === "auth.sign_in")!.body;
    expect(entry.detail).toMatchObject({ device: "TestBrowser/1.0" });
    expect(JSON.stringify(entry)).not.toContain("tok");
  });

  it("records a wrong code against the number's last four when there's no account", async () => {
    const r = await run(verifyCode, { phone: PHONE, code: "000000" });
    expect(r.status).toBe(401);
    const entry = calls.find((c) => c.path.startsWith("audit_log"))!.body;
    expect(entry).toMatchObject({ action: "auth.code_wrong", target_type: "phone", target_id: "•• 0100" });
    expect(JSON.stringify(entry)).not.toContain(PHONE);
  });
});
