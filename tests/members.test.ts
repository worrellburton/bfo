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
let assetData: Record<string, unknown> = { name: "Northwind Holdings, LLC", type: "LLC" };
vi.mock("../lib/tree.js", () => ({ readRows: async (_: string, ids: string[]) => ids.map((id) => ({ id, data: assetData })) }));

import handler, { inviteText, signersFromRecord } from "../api/members";

const admin = { id: "a1", name: "Alex Rivera", role: "owner", status: "approved" };
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
  assetData = { name: "Northwind Holdings, LLC", type: "LLC" };
});

describe("/api/members", () => {
  it("invites someone new: a partner account, the entity, and a text and email to sign in", async () => {
    const r = await call("POST", { action: "invite", assetId: "northwind", memberName: "Alder Holdings, LLC", name: "Jane Doe", phone: "(602) 555-0100", email: "Jane@Example.com", consent: true });
    expect(r.status).toBe(200);
    expect(users[0]).toMatchObject({ name: "Jane Doe", phone: "+16025550100", email: "jane@example.com", role: "partner", status: "approved" });
    expect(access).toEqual([expect.objectContaining({ user_id: users[0].id, asset_id: "northwind", member_name: "Alder Holdings, LLC", invited_by: "a1" })]);
    expect(texts[0][0]).toBe("+16025550100");
    expect(texts[0][1]).toContain("Alex Rivera invited you to see Northwind Holdings, LLC: its documents, and its owners’ names, shares and addresses.");
    expect(texts[0][1]).toMatch(/Reply STOP to opt out\.$/);
    expect(texts[0][1]).not.toContain("and more");
    // The inviter's word on consent goes to the audit trail.
    const auditRow = sbCalls.find((c) => c.method === "POST" && c.path.startsWith("audit_log"));
    expect(auditRow?.body).toMatchObject({ action: "entity.access_grant", detail: expect.objectContaining({ textConsent: expect.objectContaining({ confirmedBy: "a1", phoneLast4: "0100" }) }) });
    expect(emails).toEqual(["jane@example.com"]);
    expect(r.json.sent).toEqual({ sms: true, email: true });
    expect(r.json.people).toEqual([expect.objectContaining({ name: "Jane Doe", memberName: "Alder Holdings, LLC", role: "partner" })]);
  });

  it("gives an existing account the entity without making a second one", async () => {
    users = [{ id: "00000000-0000-4000-8000-000000000009", name: "Sam", phone: "+16025550100", email: null, role: "member", status: "approved" }];
    await call("POST", { action: "invite", assetId: "northwind", name: "Sam", phone: "602-555-0100", consent: true });
    expect(users).toHaveLength(1);
    expect(access[0].user_id).toBe("00000000-0000-4000-8000-000000000009");
    expect(texts[0][1]).toContain("added you to Northwind Holdings, LLC");
  });

  it("takes access away, signing out a partner left with nothing", async () => {
    await call("POST", { action: "invite", assetId: "northwind", name: "Jane Doe", phone: "6025550100", consent: true });
    const id = users[0].id;
    expect((await call("POST", { action: "revoke", assetId: "northwind", userId: id })).json.people).toEqual([]);
    expect(sbCalls.some((c) => c.method === "DELETE" && c.path === `app_sessions?user_id=eq.${id}`)).toBe(true);
  });

  it("is for owners and admins, and needs a phone to sign in with", async () => {
    me = { ...admin, role: "member" };
    expect((await call("GET", undefined, { assetId: "northwind" })).status).toBe(403);
    me = admin;
    expect((await call("POST", { action: "invite", assetId: "northwind", name: "Jane", consent: true })).json.error).toBe("bad_phone");
  });

  it("won't text anyone without the inviter's word that they agreed", async () => {
    const r = await call("POST", { action: "invite", assetId: "northwind", name: "Jane Doe", phone: "6025550100" });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("no_consent");
    expect(texts).toEqual([]);
    expect(access).toEqual([]);
  });

  it("stops when the number is someone else's account, and goes ahead once the inviter confirms it's them", async () => {
    users = [{ id: "00000000-0000-4000-8000-000000000009", name: "Sam Lee", phone: "+16025550100", email: null, role: "partner", status: "approved" }];
    const r = await call("POST", { action: "invite", assetId: "northwind", name: "Jane Doe", phone: "602-555-0100", consent: true });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ error: "number_belongs", account: { id: "00000000-0000-4000-8000-000000000009", name: "Sam Lee" } });
    expect(access).toEqual([]);
    const ok = await call("POST", { action: "invite", assetId: "northwind", name: "Jane Doe", phone: "602-555-0100", consent: true, confirmUserId: "00000000-0000-4000-8000-000000000009" });
    expect(ok.status).toBe(200);
    expect(access[0].user_id).toBe("00000000-0000-4000-8000-000000000009");
  });

  it("says a trust's invitees see its trust agreement, not an operating agreement", async () => {
    assetData = { name: "Rivera Family Trust", type: "Trust" };
    await call("POST", { action: "invite", assetId: "rivera", name: "Jane Doe", phone: "6025550100", consent: true });
    expect(texts[0][1]).toContain("its trust agreement, its documents and the trust’s people");
    expect(inviteText({ from: "A", entity: "B", kind: "entity", staff: false })).not.toContain("operating agreement");
  });
});

describe("who signs for an entity", () => {
  const users = [
    { name: "Alex Rivera", email: "alex@example.com", status: "approved" as const },
    { name: "Alex J. Rivera", email: "other@example.com", status: "approved" as const },
  ];

  it("takes an LLC's managers from the record, with an email only for an exact name match", () => {
    const s = signersFromRecord(
      {
        type: "LLC",
        members: [{ name: "Northwind Holdings, LLC", role: "Member", percent: 100 }],
        stateRecord: {
          people: [
            { role: "Manager", name: "Alex Rivera" },
            { role: "Manager", name: "Sam Lee" },
          ],
        },
      },
      users,
    );
    expect(s).toEqual([
      { name: "Alex Rivera", title: "Manager", email: "alex@example.com", source: "The state’s record" },
      { name: "Sam Lee", title: "Manager", email: null, source: "The state’s record" },
    ]);
  });

  it("takes a corporation's sitting officers and a trust's acting trustees", () => {
    expect(
      signersFromRecord({ type: "C-Corp", corp: { officers: { a: { name: "Sam Lee", title: "President" }, b: { name: "Jo Park", title: "Secretary", until: "2025-01-01" } } } }, users).map(
        (s) => s.name,
      ),
    ).toEqual(["Sam Lee"]);
    expect(
      signersFromRecord(
        {
          type: "Trust",
          trustPeople: [
            { name: "Alex Rivera", role: "trustee" },
            { name: "Sam Lee", role: "successor" },
          ],
        },
        users,
      ).map((s) => [s.name, s.title]),
    ).toEqual([["Alex Rivera", "Trustee"]]);
  });
});
