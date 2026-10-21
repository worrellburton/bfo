import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { method: string; path: string; body?: any };
const sbCalls: Call[] = [];
let users: any[] = [];
let access: any[] = [];
let me: any = null;
const texts: [string, string][] = [];
const emails: string[] = [];

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    currentUser: async () => me,
    sendSms: async (to: string, text: string) => void texts.push([to, text]),
    sendEmail: async (to: string) => void emails.push(to),
    sb: async (path: string, init: { method?: string; body?: any } = {}) => {
      const c = { method: init.method ?? "GET", path: decodeURIComponent(path), body: init.body };
      sbCalls.push(c);
      if (c.method === "GET" && c.path.startsWith("app_users?phone=eq.")) return users.filter((u) => c.path.includes(`eq.${u.phone}&`));
      if (c.method === "GET" && c.path.startsWith("app_users?email=eq.")) return users.filter((u) => u.email && c.path.includes(`eq.${u.email}&`));
      if (c.method === "GET" && c.path.startsWith("app_users?id=in.")) return users;
      if (c.method === "GET" && c.path.startsWith("app_users?id=eq.")) return users.filter((u) => c.path.includes(u.id));
      if (c.method === "POST" && c.path === "app_users") {
        const u = { id: "00000000-0000-4000-8000-00000000000" + (users.length + 1), last_login_at: null, ...c.body[0] };
        users.push(u);
        return [u];
      }
      if (c.method === "POST" && c.path.startsWith("entity_access")) {
        access = access.filter((a) => !(a.user_id === c.body[0].user_id && a.asset_id === c.body[0].asset_id)).concat(c.body);
        return null;
      }
      if (c.method === "GET" && c.path.startsWith("entity_access?asset_id=eq.")) return access;
      if (c.method === "GET" && c.path.startsWith("entity_access?user_id=eq.")) return access.filter((a) => c.path.includes(a.user_id));
      if (c.method === "DELETE" && c.path.startsWith("entity_access")) {
        access = access.filter((a) => !c.path.includes(a.user_id));
        return null;
      }
      return [];
    },
  };
});
vi.mock("../lib/tree.js", () => ({ readRows: async (_: string, ids: string[]) => ids.map((id) => ({ id, data: { name: "TallulahMD LLC" } })) }));

import handler from "../api/members";

const admin = { id: "a1", name: "Robert Burton", role: "owner", status: "approved" };
function call(method: string, body?: unknown, query: Record<string, string> = {}) {
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
    end() {
      return res;
    },
  };
  return Promise.resolve(handler({ method, body, query, headers: {} } as any, res)).then(() => out);
}

beforeEach(() => {
  sbCalls.length = 0;
  users = [];
  access = [];
  texts.length = 0;
  emails.length = 0;
  me = admin;
});

describe("/api/members", () => {
  it("invites someone new: a partner account, the entity, and a text and email to sign in", async () => {
    const r = await call("POST", { action: "invite", assetId: "tallulah", memberName: "Ledger Louise, LLC", name: "Jane Doe", phone: "(602) 555-0100", email: "Jane@Example.com" });
    expect(r.status).toBe(200);
    expect(users[0]).toMatchObject({ name: "Jane Doe", phone: "+16025550100", email: "jane@example.com", role: "partner", status: "approved" });
    expect(access).toEqual([expect.objectContaining({ user_id: users[0].id, asset_id: "tallulah", member_name: "Ledger Louise, LLC", invited_by: "a1" })]);
    expect(texts[0][0]).toBe("+16025550100");
    expect(texts[0][1]).toContain("Robert Burton invited you to BFO to see TallulahMD LLC");
    expect(emails).toEqual(["jane@example.com"]);
    expect(r.json.sent).toEqual({ sms: true, email: true });
    expect(r.json.people).toEqual([expect.objectContaining({ name: "Jane Doe", memberName: "Ledger Louise, LLC", role: "partner" })]);
  });

  it("gives an existing account the entity without making a second one", async () => {
    users = [{ id: "00000000-0000-4000-8000-000000000009", name: "Sam", phone: "+16025550100", email: null, role: "member", status: "approved" }];
    await call("POST", { action: "invite", assetId: "tallulah", name: "Sam", phone: "602-555-0100" });
    expect(users).toHaveLength(1);
    expect(access[0].user_id).toBe("00000000-0000-4000-8000-000000000009");
    expect(texts[0][1]).toContain("added you to TallulahMD LLC");
  });

  it("takes access away, signing out a partner left with nothing", async () => {
    await call("POST", { action: "invite", assetId: "tallulah", name: "Jane Doe", phone: "6025550100" });
    const id = users[0].id;
    expect((await call("POST", { action: "revoke", assetId: "tallulah", userId: id })).json.people).toEqual([]);
    expect(sbCalls.some((c) => c.method === "DELETE" && c.path === `app_sessions?user_id=eq.${id}`)).toBe(true);
  });

  it("is for owners and admins, and needs a phone to sign in with", async () => {
    me = { ...admin, role: "member" };
    expect((await call("GET", undefined, { assetId: "tallulah" })).status).toBe(403);
    me = admin;
    expect((await call("POST", { action: "invite", assetId: "tallulah", name: "Jane" })).json.error).toBe("bad_phone");
  });
});
