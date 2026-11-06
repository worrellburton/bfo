import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest } from "@vercel/node";
import { accessChanges, isFullName, mailboxAllowed, mailboxByDefault, needsTypedConfirm, peopleCsv, roleLabel } from "../lib/people";

// People (lib/people.ts) and its endpoint (api/auth/users.ts): what a change
// to someone's access records, and that Remove keeps the person's history.

describe("lib/people", () => {
  it("names roles plainly and never gives an outside partner a mailbox", () => {
    expect(roleLabel("owner")).toBe("Principal");
    expect(roleLabel("partner")).toBe("Outside partner");
    expect(mailboxByDefault("viewer")).toBe(false);
    expect(mailboxByDefault("member")).toBe(true);
    expect(mailboxAllowed("partner")).toBe(false);
  });

  it("asks for the name typed when a principal or admin is involved", () => {
    expect(needsTypedConfirm("owner")).toBe(true);
    expect(needsTypedConfirm("member", "admin")).toBe(true);
    expect(needsTypedConfirm("member", "viewer")).toBe(false);
  });

  it("wants a first and last name", () => {
    expect(isFullName("Pat Doe")).toBe(true);
    expect(isFullName("Pat")).toBe(false);
    expect(isFullName("  ")).toBe(false);
    expect(isFullName("Pat D.")).toBe(true);
  });

  it("words each change with its before and after", () => {
    const t = { name: "Pat Doe", role: "member" as const, status: "approved" as const, mail_address: "pat@example.com" };
    expect(accessChanges(t, { role: "admin" })).toEqual([{ action: "user.role_change", summary: "Changed Pat Doe from Member to Admin", detail: { from: "member", to: "admin" } }]);
    expect(accessChanges(t, { status: "denied" })[0]).toMatchObject({ action: "user.revoke", summary: "Turned off Pat Doe’s access" });
    expect(accessChanges({ ...t, status: "incoming" }, { status: "approved", role: "viewer" })).toEqual([
      { action: "user.approve", summary: "Approved Pat Doe as Viewer", detail: { from: "incoming", to: "approved", role: "viewer" } },
    ]);
    expect(accessChanges(t, { mail_address: "p@example.com" })[0].detail).toEqual({ from: "pat@example.com", to: "p@example.com" });
    expect(accessChanges(t, { role: "member", name: "Pat Doe" })).toEqual([]);
  });

  it("exports a CSV a spreadsheet reads as text", () => {
    const csv = peopleCsv([
      {
        name: "=Pat, Doe",
        role: "viewer",
        status: "Active",
        phone: "+15555550100",
        email: null,
        mailbox: null,
        grantedAt: "2026-01-01T00:00:00Z",
        grantedBy: "Sam Roe",
        verifiedAt: null,
        lastSignIn: null,
        lastActive: null,
        addedAt: "2026-01-01T00:00:00Z",
      },
    ]);
    const [head, row] = csv.trim().split("\r\n");
    expect(head.split(",")[0]).toBe("Name");
    expect(row.startsWith(`"'=Pat, Doe",Viewer,Active,`)).toBe(true);
  });
});

// ── The endpoint, over a fake Supabase ────────────────────────────────

const ADMIN = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TID = "b1b2b3b4-0000-4000-8000-000000000000";
const TOKEN = "11111111-2222-3333-4444-555555555555";
const base = {
  id: TID,
  name: "Pat Doe",
  email: null,
  phone: "+15555550111",
  role: "member",
  status: "approved",
  created_at: "2026-01-01T00:00:00Z",
  approved_at: "2026-01-02T00:00:00Z",
  verified_at: "2026-01-01T00:00:00Z",
  last_login_at: null,
  last_seen_at: null,
  mail_address: null as string | null,
};
let target: Record<string, unknown>;
let calls: Array<{ method: string; path: string; body?: any }>;

const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
  const method = init.method ?? "GET";
  const path = decodeURIComponent(String(url).replace("https://sb.test/rest/v1/", ""));
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, path, body });
  let out: unknown = [];
  if (path.startsWith("app_sessions?token=")) out = [{ user_id: ADMIN, expires_at: new Date(Date.now() + 86_400_000).toISOString() }];
  else if (path.startsWith(`app_users?id=eq.${ADMIN}`)) out = [{ ...base, id: ADMIN, name: "Sam Roe", role: "owner", last_seen_at: new Date().toISOString() }];
  else if (method === "POST" && path === "app_users") out = [(target = { ...base, id: TID, ...body[0] })];
  else if (method === "PATCH" && path.startsWith(`app_users?id=eq.${TID}`)) out = [(target = { ...target, ...body })];
  else if (method === "GET" && path.startsWith(`app_users?id=eq.${TID}`)) out = [target];
  return new Response(JSON.stringify(out), { status: 200 });
});

async function call(method: string, body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
  const { default: handler } = await import("../api/auth/users");
  const out: { status: number; json?: any } = { status: 0 };
  const res: any = { status: (c: number) => ((out.status = c), res), json: (j: unknown) => ((out.json = j), res), end: () => res };
  const req = { method, headers: { authorization: `Bearer ${TOKEN}` }, body, query } as unknown as VercelRequest;
  await handler(req, res);
  return out;
}

const audited = () => calls.filter((c) => c.method === "POST" && c.path === "audit_log").map((c) => c.body);

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://sb.test");
  vi.stubEnv("SUPABASE_SERVICE_KEY", "service-key");
  vi.stubGlobal("fetch", fetchMock);
  calls = [];
  target = { ...base };
});

describe("/api/auth/users", () => {
  it("removes someone without erasing them: access off, off the list, history kept, on the record", async () => {
    const r = await call("DELETE", {}, { id: TID });
    expect(r.status).toBe(200);
    expect(calls.some((c) => c.method === "DELETE" && c.path.startsWith("app_users"))).toBe(false);
    const patch = calls.find((c) => c.method === "PATCH" && c.path.startsWith(`app_users?id=eq.${TID}`))!.body;
    expect(patch).toMatchObject({ status: "denied", removed_by: ADMIN, revoked_by: ADMIN });
    expect(calls.some((c) => c.method === "DELETE" && c.path === `app_sessions?user_id=eq.${TID}`)).toBe(true);
    expect(audited()[0]).toMatchObject({ action: "user.remove", actor_name: "Sam Roe", summary: "Removed Pat Doe" });
    expect(r.json.user.removedAt).toEqual(expect.any(String));
  });

  it("keeps the first grant's date when access is turned off", async () => {
    await call("PATCH", { id: TID, status: "denied" });
    const patch = calls.find((c) => c.method === "PATCH" && c.path.startsWith(`app_users?id=eq.${TID}`))!.body;
    expect(patch).not.toHaveProperty("approved_at");
    expect(patch).toMatchObject({ status: "denied", revoked_by: ADMIN });
    expect(audited()[0]).toMatchObject({ action: "user.revoke" });
  });

  it("approves a request only for a verified number, with a role chosen", async () => {
    target = { ...base, status: "incoming", approved_at: null, verified_at: null };
    expect((await call("PATCH", { id: TID, status: "approved", role: "viewer" })).json).toMatchObject({ error: "not_verified" });
    target = { ...base, status: "incoming", approved_at: null };
    expect((await call("PATCH", { id: TID, status: "approved" })).json).toMatchObject({ error: "role_required" });
    const ok = await call("PATCH", { id: TID, status: "approved", role: "viewer" });
    expect(ok.status).toBe(200);
    expect(ok.json.user.mailAddress).toBeNull(); // a viewer gets no mailbox unless asked
    expect(audited().at(-1)).toMatchObject({ action: "user.approve", summary: "Approved Pat Doe as Viewer" });
  });

  it("adds someone only with a full name and a phone, as a Viewer unless told, and records who", async () => {
    expect((await call("POST", { name: "Pat", phone: "555 555 0111" })).json).toMatchObject({ error: "invalid_name" });
    expect((await call("POST", { name: "Pat Doe", email: "pat@example.com" })).json).toMatchObject({ error: "phone_required" });
    const r = await call("POST", { name: "Pat Doe", phone: "555 555 0111" });
    expect(r.status).toBe(201);
    expect(calls.find((c) => c.method === "POST" && c.path === "app_users")!.body[0]).toMatchObject({ role: "viewer", added_by: ADMIN, approved_by: ADMIN });
    expect(audited().at(-1)).toMatchObject({ action: "user.add", summary: "Added Pat Doe as Viewer" });
  });

  it("never gives an outside partner a mailbox", async () => {
    const r = await call("POST", { name: "Pat Doe", phone: "555 555 0111", role: "partner", mailbox: true });
    expect(r.status).toBe(201);
    expect(calls.some((c) => c.path.includes("mail_address=is.null"))).toBe(false);
  });
});
