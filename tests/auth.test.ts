import type { VercelRequest } from "@vercel/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canWrite,
  currentUser,
  isEmailOnly,
  normalizeIdentifier,
  normalizePhone,
  safeEqual,
  secretMatches,
  type AppUser,
} from "../lib/auth";
import { MAIL_DOMAIN, addressCandidates, ensureMailAddress, onOurDomain, parseMailAddress } from "../lib/mail-address";
import usersHandler from "../api/auth/users";

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
  it("lets owners, admins and members write", () => {
    expect(canWrite(user("owner"))).toBe(true);
    expect(canWrite(user("admin"))).toBe(true);
    expect(canWrite(user("member"))).toBe(true);
    expect(canWrite(user("viewer"))).toBe(false);
  });
  it("never lets email-only users write", () => {
    expect(canWrite(user("email"))).toBe(false);
  });
});

describe("isEmailOnly", () => {
  it("is true only for the email role", () => {
    expect(isEmailOnly({ role: "email" })).toBe(true);
    for (const role of ["owner", "admin", "member", "viewer"] as const) {
      expect(isEmailOnly({ role })).toBe(false);
    }
  });
});

describe("currentUser", () => {
  const token = "11111111-2222-3333-4444-555555555555";
  const req = { headers: { authorization: `Bearer ${token}` } } as unknown as VercelRequest;
  const person = (role: AppUser["role"]): AppUser => ({
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    name: "Robert Burton",
    email: null,
    phone: "+15205550100",
    role,
    status: "approved",
    created_at: "2026-01-01T00:00:00Z",
    approved_at: "2026-01-01T00:00:00Z",
    verified_at: null,
    last_login_at: null,
    last_seen_at: new Date().toISOString(), // fresh, so no last-seen write
    mail_address: "robert@burtonfamilyoffice.com",
  });
  const fetchMock = vi.fn();

  function serve(user: AppUser) {
    fetchMock.mockImplementation(async (url: string) => {
      const body = url.includes("/app_sessions?")
        ? [{ user_id: user.id, expires_at: new Date(Date.now() + 86_400_000).toISOString() }]
        : url.includes("/app_users?")
          ? [user]
          : null;
      return new Response(JSON.stringify(body), { status: body ? 200 : 404 });
    });
  }

  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "https://sb.test");
    vi.stubEnv("SUPABASE_SERVICE_KEY", "service-key");
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("refuses an email-only user unless the endpoint opts in", async () => {
    serve(person("email"));
    expect(await currentUser(req)).toBeNull();
    const user = await currentUser(req, { allowEmailOnly: true });
    expect(user?.role).toBe("email");
    expect(fetchMock).toHaveBeenCalledTimes(4); // session + user, twice
  });

  it("lets everyone else through either way", async () => {
    serve(person("member"));
    expect((await currentUser(req))?.role).toBe("member");
    expect((await currentUser(req, { allowEmailOnly: true }))?.role).toBe("member");
  });
});

describe("onOurDomain", () => {
  it("matches the domain and its subdomains only", () => {
    expect(onOurDomain(`robert@${MAIL_DOMAIN}`)).toBe(true);
    expect(onOurDomain(`robert@hq.${MAIL_DOMAIN}`)).toBe(true);
    expect(onOurDomain(`robert@evil${MAIL_DOMAIN}`)).toBe(false);
    expect(onOurDomain("robert@example.com")).toBe(false);
  });
});

describe("parseMailAddress", () => {
  it("takes a bare local part or a full address on our domain", () => {
    expect(parseMailAddress("Robert")).toEqual({ address: `robert@${MAIL_DOMAIN}` });
    expect(parseMailAddress(` Robert.Burton@${MAIL_DOMAIN.toUpperCase()} `)).toEqual({
      address: `robert.burton@${MAIL_DOMAIN}`,
    });
  });
  it("refuses other domains, junk and reserved names", () => {
    for (const input of ["robert@gmail.com", "", "  ", "bad name", "a..b", ".robert", "robert-", "admin", "postmaster", null, 42]) {
      expect(parseMailAddress(input)).toHaveProperty("error");
    }
  });
  it("keeps shared role addresses for nobody", () => {
    for (const input of ["accounting", "finance", "legal", "office", "invoices", "contact", "hr", "payroll", "team", "mail", "hello", "it", `Sales@${MAIL_DOMAIN}`]) {
      expect(parseMailAddress(input)).toHaveProperty("error");
    }
  });
});

describe("addressCandidates", () => {
  const id = "a1b2c3d4-0000-0000-0000-000000000000";
  it("starts from the first name, then first.last", () => {
    const list = addressCandidates("Robert Burton", id);
    expect(list.slice(0, 4)).toEqual(["robert", "robert.burton", "rburton", "robert.burton2"]);
    expect(list[list.length - 1]).toBe("user-a1b2c3");
  });
  it("strips accents and skips reserved names", () => {
    expect(addressCandidates("José Núñez", id)[0]).toBe("jose");
    const admin = addressCandidates("Admin", id);
    expect(admin).not.toContain("admin");
    expect(admin[0]).toBe("admin2");
  });
  it("falls back to an id-based address without a name", () => {
    expect(addressCandidates(null, id)).toEqual(["user-a1b2c3"]);
    expect(addressCandidates("  ", id)).toEqual(["user-a1b2c3"]);
  });
});

// ── Assigning addresses, and the users endpoint ───────────────────────

describe("mail addresses and user changes", () => {
  const ADMIN_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const TID = "b1b2b3b4-0000-4000-8000-000000000000";
  const token = "11111111-2222-3333-4444-555555555555";
  const base: AppUser = {
    id: TID,
    name: null,
    email: null,
    phone: "+15205550111",
    role: "member",
    status: "approved",
    created_at: "2026-01-01T00:00:00Z",
    approved_at: null,
    verified_at: null,
    last_login_at: null,
    last_seen_at: new Date().toISOString(),
    mail_address: null,
  };
  const admin: AppUser = { ...base, id: ADMIN_ID, name: "Owner", role: "owner", mail_address: `owner@${MAIL_DOMAIN}` };
  let target: AppUser;
  let calls: { method: string; path: string; body?: any }[];

  // Supabase over fetch: the session, the admin, and one target user.
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const path = decodeURIComponent(String(url).replace("https://sb.test/rest/v1/", ""));
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    let out: unknown = [];
    if (path.startsWith("app_sessions?token=")) out = [{ user_id: ADMIN_ID, expires_at: new Date(Date.now() + 86_400_000).toISOString() }];
    else if (path.startsWith(`app_users?id=eq.${ADMIN_ID}`)) out = [admin];
    else if (method === "POST" && path === "app_users") out = [(target = { ...base, ...body[0] })];
    else if (method === "PATCH" && path === `app_users?id=eq.${TID}&mail_address=is.null`) {
      out = target.mail_address ? [] : [(target = { ...target, ...body })];
    } else if (method === "PATCH" && path === `app_users?id=eq.${TID}`) out = [(target = { ...target, ...body })];
    else if (method === "GET" && path.startsWith(`app_users?id=eq.${TID}`)) out = [target];
    return new Response(JSON.stringify(out), { status: 200 });
  });

  function call(method: string, body: Record<string, unknown>) {
    const out: { status: number; json?: any } = { status: 0 };
    const res: any = {
      status(c: number) {
        out.status = c;
        return res;
      },
      json(j: unknown) {
        out.json = j;
        return res;
      },
      end: () => res,
    };
    const req = { method, headers: { authorization: `Bearer ${token}` }, body, query: {} } as unknown as VercelRequest;
    return Promise.resolve(usersHandler(req, res)).then(() => out);
  }

  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "https://sb.test");
    vi.stubEnv("SUPABASE_SERVICE_KEY", "service-key");
    vi.stubGlobal("fetch", fetchMock);
    calls = [];
    target = { ...base };
  });
  afterEach(() => {
    fetchMock.mockClear();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("builds an address from the name only when the name is trusted", async () => {
    expect(await ensureMailAddress({ id: TID, name: "Robert Burton", mail_address: null })).toBe(`user-b1b2b3@${MAIL_DOMAIN}`);
    target = { ...base };
    expect(await ensureMailAddress({ id: TID, name: "Robert Burton", mail_address: null }, { trustName: true })).toBe(`robert@${MAIL_DOMAIN}`);
    calls = [];
    expect(await ensureMailAddress({ id: TID, name: "Robert Burton", mail_address: `rb@${MAIL_DOMAIN}` })).toBe(`rb@${MAIL_DOMAIN}`);
    expect(calls).toEqual([]);
  });

  it("gives a user an admin adds an address from the name the admin typed", async () => {
    const r = await call("POST", { name: "Amanda Burton", phone: "520 555 0111", role: "email" });
    expect(r.status).toBe(201);
    expect(r.json.user.mailAddress).toBe(`amanda@${MAIL_DOMAIN}`);
  });

  it("gives a self-registered user user-xxxxxx at approval, not one from the name they typed", async () => {
    target = { ...base, name: "Accounting Team", role: "email", status: "incoming" };
    const r = await call("PATCH", { id: TID, status: "approved" });
    expect(r.status).toBe(200);
    expect(r.json.user.mailAddress).toBe(`user-b1b2b3@${MAIL_DOMAIN}`);
    expect(calls.find((c) => c.path === `app_users?id=eq.${TID}&mail_address=is.null`)?.body).toEqual({ mail_address: `user-b1b2b3@${MAIL_DOMAIN}` });
  });

  it("leaves an address an admin just cleared, and a user who isn't approved, without one", async () => {
    target = { ...base, mail_address: `robert@${MAIL_DOMAIN}` };
    const cleared = await call("PATCH", { id: TID, mailAddress: null });
    expect(cleared.json.user.mailAddress).toBeNull();
    target = { ...base, status: "incoming" };
    await call("PATCH", { id: TID, name: "Robert" });
    expect(calls.some((c) => c.path.includes("mail_address=is.null"))).toBe(false);
  });

  it("signs a user out when they move into or out of Email only", async () => {
    const signOuts = () => calls.filter((c) => c.method === "DELETE" && c.path === `app_sessions?user_id=eq.${TID}`).length;
    target = { ...base, mail_address: `robert@${MAIL_DOMAIN}` };
    await call("PATCH", { id: TID, role: "viewer" });
    expect(signOuts()).toBe(0);
    await call("PATCH", { id: TID, role: "email" });
    expect(signOuts()).toBe(1);
    await call("PATCH", { id: TID, role: "email" });
    expect(signOuts()).toBe(1);
    await call("PATCH", { id: TID, role: "member" });
    expect(signOuts()).toBe(2);
  });
});

describe("partners", () => {
  it("are refused with 403, never the 401 that would sign them out", async () => {
    const { handleError, PartnerRefused } = await import("../lib/auth");
    const out: { status?: number; json?: unknown } = {};
    const res: any = { status: (c: number) => ((out.status = c), res), json: (j: unknown) => ((out.json = j), res) };
    handleError(res, new PartnerRefused("Not available to entity owners."));
    expect(out).toEqual({ status: 403, json: { error: "forbidden", message: "Not available to entity owners." } });
  });
});
