import { beforeEach, describe, expect, it, vi } from "vitest";

// auth.ts keeps sessions in localStorage (and the "adding" flag in
// sessionStorage); give it in-memory ones and a fake sign-in endpoint.
function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

const user = (id: string, name: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  phone: "+15555550100",
  phoneFormatted: "(555) 555-0100",
  role: "owner",
  status: "approved",
  createdAt: "2026-01-01",
  approvedAt: null,
  lastLoginAt: null,
});

async function load() {
  vi.resetModules();
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  return import("../app/auth");
}

function signInAs(id: string, name: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ verified: true, status: "approved", token: `tok-${id}`, expiresAt: "2099-01-01T00:00:00Z", user: user(id, name) }),
    })),
  );
}

describe("several accounts on one browser", () => {
  let auth: Awaited<ReturnType<typeof load>>;
  beforeEach(async () => {
    auth = await load();
  });

  it("adds a second account without signing out the first, and switches between them", async () => {
    signInAs("a", "Robert");
    await auth.verifyCode("+15555550100", "123456");
    expect(auth.getUser()?.id).toBe("a");
    expect(auth.otherAccounts()).toEqual([]);

    auth.beginAddAccount();
    expect(auth.getUser()).toBeNull();
    expect(auth.addingAccount()?.id).toBe("a");

    signInAs("b", "Office");
    await auth.verifyCode("+15555550101", "123456");
    expect(auth.getUser()?.id).toBe("b");
    expect(auth.getToken()).toBe("tok-b");
    expect(auth.otherAccounts().map((u) => u.id)).toEqual(["a"]);
    expect(auth.addingAccount()).toBeNull();

    expect(auth.switchAccount("a")).toBe(true);
    expect(auth.getUser()?.id).toBe("a");
    expect(auth.getToken()).toBe("tok-a");
    expect(auth.otherAccounts().map((u) => u.id)).toEqual(["b"]);
    expect(auth.switchAccount("nobody")).toBe(false);
  });

  it("goes back to the account it came from when adding is cancelled", async () => {
    signInAs("a", "Robert");
    await auth.verifyCode("+15555550100", "123456");
    auth.beginAddAccount();
    expect(auth.cancelAddAccount()).toBe(true);
    expect(auth.getUser()?.id).toBe("a");
    expect(auth.otherAccounts()).toEqual([]);
  });

  it("signing in the same person again doesn't list them twice", async () => {
    signInAs("a", "Robert");
    await auth.verifyCode("+15555550100", "123456");
    auth.beginAddAccount();
    await auth.verifyCode("+15555550100", "123456");
    expect(auth.getUser()?.id).toBe("a");
    expect(auth.otherAccounts()).toEqual([]);
  });

  it("logging out hands over to the next signed-in account, then to nobody", async () => {
    signInAs("a", "Robert");
    await auth.verifyCode("+15555550100", "123456");
    auth.beginAddAccount();
    signInAs("b", "Office");
    await auth.verifyCode("+15555550101", "123456");

    expect(auth.logout()?.id).toBe("a");
    expect(auth.getUser()?.id).toBe("a");
    expect(auth.otherAccounts()).toEqual([]);
    expect(auth.logout()).toBeNull();
    expect(auth.getUser()).toBeNull();
  });
});

describe("revalidate", () => {
  let auth: Awaited<ReturnType<typeof load>>;
  beforeEach(async () => {
    auth = await load();
    signInAs("a", "Robert");
    await auth.verifyCode("+15555550100", "123456");
  });
  const answer = (status: number, body: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })));

  it("keeps the session through a server error, as it does offline", async () => {
    for (const status of [500, 502, 503]) {
      answer(status, { error: "server_error" });
      expect(await auth.revalidate()).toBe(true);
      expect(auth.getUser()?.id).toBe("a");
    }
  });

  it("signs out only when the server says the session is dead", async () => {
    answer(401, { error: "unauthorized" });
    expect(await auth.revalidate()).toBe(false);
    expect(auth.getUser()).toBeNull();
  });

  it("takes the fresh user from a good answer", async () => {
    answer(200, { user: { ...user("a", "Robert B"), role: "admin" } });
    expect(await auth.revalidate()).toBe(true);
    expect(auth.getUser()?.name).toBe("Robert B");
  });
});
