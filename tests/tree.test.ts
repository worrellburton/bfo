import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectionValue, compareKeys, einProblem, noteRules, ownerStamps, parseOps, parsePath, simulate, structuralChanges, structuralRefusal, touchedRows, valueAt, type TreeOp } from "../lib/tree";
import { firebaseFilesOf, forgetImports, movedFilePath } from "../lib/firebase-bridge";
import { isDocumentPath } from "../lib/document-path";

// ── Mocks: Supabase REST (sb), the session, and Firebase/Storage (global fetch) ──

type Call = { method: string; path: string; body?: any; prefer?: string };
const sbCalls: Call[] = [];
let sbRoutes: Array<[RegExp, (c: Call) => unknown]> = [];
let me: Record<string, unknown> | null = null;

const sbMock = vi.fn(async (path: string, init: { method?: string; body?: unknown; prefer?: string } = {}) => {
  const c: Call = { method: init.method ?? "GET", path: decodeURIComponent(path), body: init.body, prefer: init.prefer };
  sbCalls.push(c);
  const hit = sbRoutes.find(([re]) => re.test(`${c.method} ${c.path}`));
  return hit ? hit[1](c) : [];
});

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    sb: (...a: unknown[]) => (sbMock as (...x: unknown[]) => unknown)(...a),
    currentUser: async () => me,
  };
});

import handler from "../api/tree";

const member = { id: "u1", name: "Robert", role: "member", status: "approved" };
const viewer = { ...member, role: "viewer" };

function call(method: string, opts: { query?: Record<string, string>; body?: unknown } = {}) {
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
  return Promise.resolve(handler({ method, query: opts.query ?? {}, body: opts.body, headers: {} } as any, res)).then(() => out);
}

const imported = [/GET tree_imports\?collection=eq\./, () => [{ collection: "x", status: "done", started_at: "2026-10-17T00:00:00Z", files_done: true }]] as const;

beforeEach(() => {
  process.env.SUPABASE_URL = "https://sb.test";
  process.env.SUPABASE_SERVICE_KEY = "k";
  sbCalls.length = 0;
  sbRoutes = [[imported[0], imported[1]]];
  me = member;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 500 })),
  );
});
afterEach(() => vi.unstubAllGlobals());

// ── Pure helpers ──────────────────────────────────────────────────────

describe("paths", () => {
  it("splits and checks a path", () => {
    expect(parsePath("assets/x/documents/d")).toEqual(["assets", "x", "documents", "d"]);
    expect(parsePath("/assets//x/")).toEqual(["assets", "x"]);
    expect(parsePath("")).toEqual([]);
    expect(parsePath("users/x")).toBeNull(); // not a tree collection
    expect(parsePath("agents")).toBeNull(); // the old Office agents hold provider API keys
    expect(parsePath("assets/a.b")).toBeNull();
    expect(parsePath("assets/a$b")).toBeNull();
    expect(parsePath(42)).toBeNull();
  });

  it("reads a value out of a row, Firebase style", () => {
    const data = { name: "A", corp: { directors: { d1: { name: "Jo" } } }, list: [1, 2] };
    expect(valueAt(data, [])).toEqual(data);
    expect(valueAt(data, ["corp", "directors", "d1", "name"])).toBe("Jo");
    expect(valueAt(data, ["list", "1"])).toBe(2);
    expect(valueAt(data, ["nope", "deeper"])).toBeNull();
    expect(valueAt("str", ["x"])).toBeNull();
  });

  it("orders children as Firebase did: numbers first, then strings", () => {
    expect(["b", "10", "a", "2", "-M1"].sort(compareKeys)).toEqual(["2", "10", "-M1", "a", "b"]);
    expect(
      collectionValue([
        { id: "b", data: 1 },
        { id: "a", data: 2 },
      ]),
    ).toEqual({ a: 2, b: 1 });
    expect(
      Object.keys(
        collectionValue([
          { id: "b", data: 1 },
          { id: "a", data: 2 },
        ]) as object,
      ),
    ).toEqual(["a", "b"]);
    expect(collectionValue([])).toBeNull();
  });
});

describe("operations", () => {
  it("accepts sets and updates on rows and fields", () => {
    const ops = parseOps({
      ops: [
        { op: "set", path: "assets/x", value: { name: "A" } },
        { op: "update", path: "assets/x", value: { ein: "1", "corp/directors/d1": null } },
        { op: "update", path: "", value: { "frameworks/f/assetId": "x" } },
        { op: "set", path: "assets/x/documents/d", value: null },
      ],
    });
    expect(Array.isArray(ops)).toBe(true);
    expect((ops as any[])[2]).toEqual({ op: "update", path: [], value: { "frameworks/f/assetId": "x" } });
    expect((ops as any[])[3].value).toBeNull();
  });

  it("refuses whole-collection writes, odd shapes and bad paths", () => {
    expect(parseOps({})).toMatchObject({ error: "bad_ops" });
    expect(parseOps({ ops: [{ op: "set", path: "assets", value: {} }] })).toMatchObject({ error: "bad_path" });
    expect(parseOps({ ops: [{ op: "update", path: "", value: { assets: {} } }] })).toMatchObject({ error: "bad_path" });
    expect(parseOps({ ops: [{ op: "delete", path: "assets/x" }] })).toMatchObject({ error: "bad_op" });
    expect(parseOps({ ops: [{ op: "update", path: "assets/x", value: [1] }] })).toMatchObject({ error: "bad_value" });
    expect(parseOps({ ops: [{ op: "set", path: "assets/x", value: { n: Number.NaN } }] })).toMatchObject({ error: "bad_value" });
    expect(parseOps({ ops: [{ op: "update", path: "assets/x", value: { "a.b": 1 } }] })).toMatchObject({ error: "bad_path" });
    expect(parseOps({ ops: [{ op: "set", path: "secrets/x", value: 1 }] })).toMatchObject({ error: "bad_path" });
  });

  it('refuses update keys with an empty segment, which tree_apply would keep as a field named ""', () => {
    for (const key of ["/abc", "a//b", "a/", ""]) {
      expect(parseOps({ ops: [{ op: "update", path: "assets/x", value: { [key]: 1 } }] })).toMatchObject({ error: "bad_path" });
    }
    expect(parseOps({ ops: [{ op: "update", path: "", value: { "/assets/x/name": "A" } }] })).toMatchObject({ error: "bad_path" });
  });

  it("names the rows an operation touches", () => {
    const ops = parseOps({
      ops: [
        { op: "update", path: "assets/x", value: { a: 1 } },
        { op: "update", path: "", value: { "frameworks/f/assetId": "x", "assets/x/name": "A" } },
        { op: "set", path: "notes/n", value: null },
      ],
    }) as any[];
    expect(touchedRows(ops)).toEqual([
      { collection: "assets", id: "x" },
      { collection: "frameworks", id: "f" },
      { collection: "notes", id: "n" },
    ]);
  });
});

describe("what a write may change", () => {
  const rows = (o: Record<string, unknown>) => new Map(Object.entries(o) as [string, any][]);
  const ops = (list: unknown[]) => parseOps({ ops: list }) as TreeOp[];

  it("plays operations onto rows as tree_apply would", () => {
    const before = rows({ "assets/x": { name: "A", ein: "12-3456789", corp: { d: 1 } } });
    const after = simulate(
      before,
      ops([
        { op: "update", path: "assets/x", value: { ownerId: "t", "corp/d": null } },
        { op: "set", path: "assets/y", value: { name: "B" } },
        { op: "update", path: "", value: { "notes/n/title": "Hi" } },
        { op: "set", path: "assets/z", value: null },
      ]),
    );
    expect(after.get("assets/x")).toEqual({ name: "A", ein: "12-3456789", ownerId: "t" });
    expect(after.get("assets/y")).toEqual({ name: "B" });
    expect(after.get("notes/n")).toEqual({ title: "Hi" });
    expect(after.has("assets/z")).toBe(false);
    expect(before.get("assets/x")).toEqual({ name: "A", ein: "12-3456789", corp: { d: 1 } });
  });

  it("lets members record new entities and fill blanks, and keeps owners, filled facts and deletions for owners and admins", () => {
    const before = rows({ "assets/x": { name: "A", ein: "", type: "LLC" }, "assets/old": { name: "Old" } });
    const judge = (list: unknown[], admin = false) => {
      const o = ops(list);
      const after = simulate(before, o);
      return structuralRefusal(structuralChanges(before, after, [...new Set(touchedRows(o).map((t) => t.id))]), admin);
    };
    expect(judge([{ op: "set", path: "assets/new", value: { name: "N", type: "LLC", ein: "12-3456789", ownerId: "x" } }])).toBeNull();
    expect(judge([{ op: "update", path: "assets/x", value: { ein: "12-3456789", llcType: "Partnership" } }])).toBeNull();
    expect(judge([{ op: "update", path: "assets/x", value: { name: "A" } }])).toBeNull();
    expect(judge([{ op: "update", path: "assets/x", value: { ownerId: "old" } }])).toMatch(/who owns/);
    expect(judge([{ op: "update", path: "assets/x", value: { name: "B" } }])).toMatch(/legal name/);
    expect(judge([{ op: "update", path: "assets/x", value: { type: "C-Corp" } }])).toMatch(/legal form/);
    expect(judge([{ op: "set", path: "assets/old", value: null }])).toMatch(/delete an entity/);
    expect(judge([{ op: "update", path: "assets/x", value: { ownerId: "old", name: "B" } }], true)).toBeNull();
  });

  it("checks an EIN's shape and never takes an SSN", () => {
    expect(einProblem("12-3456789")).toBeNull();
    expect(einProblem("123456789")).toBeNull();
    expect(einProblem("123-45-6789")).toMatch(/Social Security/);
    expect(einProblem("12-345")).toMatch(/9 digits/);
  });

  it("stamps a change of owner with when and by whom, and checks the effective date", () => {
    const before = rows({ "assets/x": { name: "A", ownerId: "t" } });
    const now = new Date("2026-11-06T15:00:00Z");
    const after = simulate(before, ops([{ op: "update", path: "assets/x", value: { ownerId: "y", ownerEffective: "2026-10-01" } }]));
    const changes = structuralChanges(before, after, ["x"]);
    expect(ownerStamps(changes, after, { id: "u1", name: "Robert" }, now)).toEqual([
      { op: "update", path: ["assets", "x"], value: { ownerChangedAt: "2026-11-06T15:00:00.000Z", ownerChangedBy: { id: "u1", name: "Robert" } } },
    ]);
    const bad = simulate(before, ops([{ op: "update", path: "assets/x", value: { ownerId: "y", ownerEffective: "Oct 1" } }]));
    expect(ownerStamps(structuralChanges(before, bad, ["x"]), bad, { id: "u1", name: "Robert" }, now)).toEqual({ error: expect.stringMatching(/date/) });
  });

  it("stamps a new note's author, keeps deleted notes, and lets only the author or an admin change one", () => {
    const now = new Date("2026-11-06T15:00:00Z");
    const before = rows({ "notes/mine": { title: "Mine", createdBy: { id: "u1", name: "R" }, createdAt: 1 }, "notes/theirs": { title: "Theirs", createdBy: { id: "u2", name: "C" }, createdAt: 1 } });
    const rule = (list: unknown[], admin = false) => {
      const o = ops(list);
      return noteRules(before, simulate(before, o), [...new Set(touchedRows(o).map((t) => t.id))], { id: "u1", name: "R", admin }, now);
    };
    expect(rule([{ op: "set", path: "notes/new", value: { title: "T", body: "B", createdBy: { id: "forged" } } }]).stamps).toEqual([
      { op: "update", path: ["notes", "new"], value: { createdBy: { id: "u1", name: "R" }, createdAt: now.getTime(), deletedAt: null, deletedBy: null } },
    ]);
    expect(rule([{ op: "set", path: "notes/mine", value: null }]).refusal).toMatchObject({ status: 409, code: "notes_are_kept" });
    expect(rule([{ op: "update", path: "notes/theirs", value: { deletedAt: 5 } }]).refusal).toMatchObject({ status: 403 });
    expect(rule([{ op: "update", path: "notes/mine", value: { createdBy: { id: "u9" } } }]).refusal).toMatchObject({ status: 400 });
    const del = rule([{ op: "update", path: "notes/mine", value: { deletedAt: 5 } }]);
    expect(del.refusal).toBeUndefined();
    expect(del.stamps).toEqual([{ op: "update", path: ["notes", "mine"], value: { deletedAt: now.getTime(), deletedBy: { id: "u1", name: "R" } } }]);
    expect(del.events).toEqual([{ kind: "delete", id: "mine", title: "Mine" }]);
    expect(rule([{ op: "update", path: "notes/theirs", value: { deletedAt: 5 } }], true).refusal).toBeUndefined();
  });
});

describe("files still in Firebase", () => {
  it("finds documents and filing slots, skipping what already moved", () => {
    const asset = {
      name: "A",
      documents: {
        d1: { name: "Old", url: "https://firebasestorage.googleapis.com/v0/b/x/o/a.pdf?alt=media&token=t", storagePath: "assets/a/a.pdf", contentType: "application/pdf" },
        d2: { name: "New", url: "https://sb.test/storage/v1/object/public/documents/assets/a/b.pdf", storagePath: "assets/a/b.pdf", storageProvider: "supabase" },
        d3: { name: "Link", url: "https://example.com" },
      },
      w9: { fileName: "w9.pdf", url: "https://firebasestorage.googleapis.com/v0/b/x/o/w9.pdf?alt=media", storagePath: "assets/a/w9/w9.pdf", size: 1 },
      articles: { fileName: "filed.pdf", url: "https://firebasestorage.googleapis.com/v0/b/x/o/f.pdf", storagePath: "", docId: "d1" },
    };
    expect(firebaseFilesOf("a", asset).map((f) => f.path.join("/"))).toEqual(["assets/a/documents/d1", "assets/a/w9"]);
    expect(firebaseFilesOf("a", null)).toEqual([]);
  });

  it("moves a file to a document path, its extension taken from the last segment and made safe", () => {
    expect(movedFilePath("a", "Operating Agreement.pdf", "assets/a/oa.pdf", 1)).toBe("assets/a/1-Operating_Agreement.pdf");
    for (const firebase of ["assets/a.v2/scan", "assets/a/x.p?d#f", "assets/a/x.../..", "assets/a/x.%2e%2e", "noext", "assets/a/.hidden", "assets/a/trailing."]) {
      const p = movedFilePath("a", "Scan", firebase, 1);
      expect(isDocumentPath(p), `${firebase} → ${p}`).toBe(true);
      expect(p.split("/")).toHaveLength(3);
    }
    expect(movedFilePath("a", "Scan", "assets/a.v2/scan", 1)).toBe("assets/a/1-Scan");
  });
});

// ── The endpoint ──────────────────────────────────────────────────────

describe("partners (invited entity owners)", () => {
  const partner = { id: "p1", name: "Jane", role: "partner", status: "approved" };
  beforeEach(() => {
    me = partner;
    sbRoutes.push([/GET entity_access\?user_id=eq\.p1/, () => [{ asset_id: "mine" }]]);
    sbRoutes.push([
      /GET tree_nodes\?collection=eq\.assets&id=in\./,
      (c) =>
        [
          { collection: "assets", id: "mine", data: { name: "Birch Clinic LLC", notes: "internal", contracts: { c1: {} }, operatingAgreement: { url: "u" } }, updated_at: "t" },
          { collection: "assets", id: "theirs", data: { name: "Other, LLC" }, updated_at: "t" },
        ].filter((r) => c.path.includes(`"${r.id}"`)),
    ]);
  });

  it("read only the entities they were given, without the office's notes and contracts", async () => {
    expect((await call("GET", { query: { path: "assets" } })).json).toEqual({ value: { mine: { name: "Birch Clinic LLC", operatingAgreement: { url: "u" } } }, updated: { mine: "t" } });
    expect((await call("GET", { query: { path: "assets", view: "index" } })).json).toEqual({ rows: [{ id: "mine", updated_at: "t" }] });
    expect((await call("GET", { query: { path: "assets", ids: "mine,theirs" } })).json.rows.map((r: any) => r.id)).toEqual(["mine"]);
    expect((await call("GET", { query: { path: "assets/mine/operatingAgreement/url" } })).json).toEqual({ value: "u" });
    expect((await call("GET", { query: { path: "assets/theirs" } })).status).toBe(403);
    expect((await call("GET", { query: { path: "assets/mine/notes" } })).status).toBe(403);
    expect((await call("GET", { query: { path: "notes" } })).status).toBe(403);
  });

  it("can't write anything", async () => {
    expect((await call("POST", { body: { ops: [{ op: "update", path: "assets/mine", value: { name: "x" } }] } })).status).toBe(403);
  });
});

describe("/api/tree", () => {
  it("needs a session, and a path in the tree", async () => {
    me = null;
    expect(await call("GET", { query: { path: "assets" } })).toEqual({ status: 401, json: { error: "unauthorized" } });
    me = member;
    expect(await call("GET", { query: { path: "users" } })).toEqual({ status: 400, json: { error: "bad_path" } });
    expect(await call("GET", { query: { path: "agents" } })).toEqual({ status: 400, json: { error: "bad_path" } });
    expect(await call("GET", { query: { path: "" } })).toEqual({ status: 400, json: { error: "bad_path" } });
  });

  it("reads a collection as one object, and any node inside a row", async () => {
    sbRoutes.push([
      /GET tree_nodes\?collection=eq\.notes&select=collection,id,data,updated_at&order=id/,
      () => [
        { collection: "notes", id: "b", data: { text: "two" }, updated_at: "t" },
        { collection: "notes", id: "a", data: { text: "one" }, updated_at: "t" },
      ],
    ]);
    sbRoutes.push([/GET tree_nodes\?collection=eq\.notes&id=in\./, () => [{ collection: "notes", id: "a", data: { text: "one", tags: { x: 1 } }, updated_at: "t" }]]);
    expect((await call("GET", { query: { path: "notes" } })).json).toEqual({ value: { a: { text: "one" }, b: { text: "two" } }, updated: { a: "t", b: "t" } });
    expect((await call("GET", { query: { path: "notes/a/tags/x" } })).json).toEqual({ value: 1 });
    expect((await call("GET", { query: { path: "notes/a/missing" } })).json).toEqual({ value: null });
    expect((await call("GET", { query: { path: "notes", view: "index" } })).json).toEqual({ rows: [] });
  });

  it("reads a collection past PostgREST's 1,000-row page, in id order", async () => {
    const all = Array.from({ length: 1500 }, (_, i) => ({ id: `n${String(i).padStart(4, "0")}`, updated_at: "t" }));
    sbRoutes.push([
      /GET tree_nodes\?collection=eq\.notes&select=id,updated_at&order=id&limit=1000&offset=\d+$/,
      (c) => {
        const offset = Number(/offset=(\d+)/.exec(c.path)![1]);
        return all.slice(offset, offset + 1000);
      },
    ]);
    expect((await call("GET", { query: { path: "notes", view: "index" } })).json.rows).toHaveLength(1500);
    expect(sbCalls.filter((c) => c.path.includes("select=id,updated_at")).map((c) => /offset=\d+/.exec(c.path)![0])).toEqual(["offset=0", "offset=1000"]);
  });

  it("quotes backslashes and quotes in the ids it reads", async () => {
    await call("GET", { query: { path: "notes", ids: 'a\\b,c"d' } });
    expect(sbCalls.at(-1)!.path).toContain('id=in.("a\\\\b","c\\"d")');
  });

  it("copies every collection out of Firebase on the first request", async () => {
    sbRoutes = [
      [/GET tree_imports/, () => []],
      [/POST tree_imports/, () => [{ collection: "notes", status: "running" }]],
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("identitytoolkit")) return new Response(JSON.stringify({ idToken: "tok" }));
        if (url.includes("/notes.json")) return new Response(JSON.stringify({ n1: { text: "hi" }, n2: { text: "there" } }));
        // Firebase answers "null" for a node that was never written.
        if (url.includes(".json?auth=")) return new Response("null");
        return new Response("{}", { status: 404 });
      }),
    );
    // Firebase holds only notes; the other collections come back empty and are marked done too.
    forgetImports();
    expect((await call("GET", { query: { path: "notes" } })).status).toBe(200);
    const inserted = sbCalls.find((c) => c.method === "POST" && c.path.startsWith("tree_nodes"));
    expect(inserted?.body).toEqual([
      { collection: "notes", id: "n1", data: { text: "hi" } },
      { collection: "notes", id: "n2", data: { text: "there" } },
    ]);
    expect(sbCalls.find((c) => c.method === "PATCH" && c.path.startsWith("tree_imports?collection=eq.notes"))?.body).toMatchObject({ status: "done", count: 2 });
    expect(sbCalls.filter((c) => c.method === "PATCH" && c.path.startsWith("tree_imports")).map((c) => c.body.status)).toEqual(["done", "done", "done", "done"]);
    // The old Office agents (each holding a provider API key) are never copied or served.
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes("/agents.json"))).toBe(false);
  });

  it("writes through tree_apply and hands back the rows touched", async () => {
    sbRoutes.push([/GET tree_nodes\?collection=eq\.assets&id=in\./, () => [{ collection: "assets", id: "x", data: { name: "A", ein: "1" }, updated_at: "t2" }]]);
    const r = await call("POST", {
      body: {
        ops: [
          { op: "update", path: "assets/x", value: { ein: "1" } },
          { op: "set", path: "assets/gone", value: null },
        ],
      },
    });
    expect(r.status).toBe(200);
    expect(r.json.rows).toEqual([
      { collection: "assets", id: "x", data: { name: "A", ein: "1" }, updated_at: "t2" },
      { collection: "assets", id: "gone", data: null, updated_at: null },
    ]);
    const rpc = sbCalls.find((c) => c.path === "rpc/tree_apply")!;
    expect(rpc.body.ops).toEqual([
      { op: "update", path: ["assets", "x"], value: { ein: "1" } },
      { op: "set", path: ["assets", "gone"], value: null },
    ]);
  });

  it("lets viewers read but not write", async () => {
    me = viewer;
    expect((await call("GET", { query: { path: "notes" } })).status).toBe(200);
    expect(await call("POST", { body: { ops: [{ op: "set", path: "notes/n", value: { text: "x" } }] } })).toEqual({ status: 403, json: { error: "forbidden" } });
    me = member;
    expect((await call("POST", { body: { ops: [{ op: "set", path: "notes", value: {} }] } })).status).toBe(400);
  });

  describe("write rules", () => {
    const admin = { ...member, id: "a1", role: "admin" };
    const entity = (data: Record<string, unknown>) => [/GET tree_nodes\?collection=eq\.assets&id=in\./, () => [{ collection: "assets", id: "x", data, updated_at: "t" }]] as const;

    it("keeps a change of owner for owners and admins, stamps it, and records it in the audit trail", async () => {
      sbRoutes.push([...entity({ name: "Child, LLC", ownerId: "t" })]);
      const body = { ops: [{ op: "update", path: "assets/x", value: { ownerId: "y", ownerEffective: "2026-10-01" } }] };
      expect(await call("POST", { body })).toMatchObject({ status: 403, json: { error: "owner_or_admin" } });
      expect(sbCalls.some((c) => c.path === "rpc/tree_apply")).toBe(false);
      me = admin;
      expect((await call("POST", { body })).status).toBe(200);
      const rpc = sbCalls.find((c) => c.path === "rpc/tree_apply")!;
      expect(rpc.body.ops[1]).toMatchObject({ op: "update", path: ["assets", "x"], value: { ownerChangedBy: { id: "a1", name: "Robert" } } });
      const row = sbCalls.find((c) => c.method === "POST" && c.path === "audit_log")?.body;
      expect(row).toMatchObject({ action: "entity.owner_change", target_id: "x", detail: { from: "t", to: "y", effective: "2026-10-01" } });
    });

    it("refuses an SSN in the EIN field, and an EIN another entity already has", async () => {
      sbRoutes.push([...entity({ name: "Child, LLC" })]);
      expect(await call("POST", { body: { ops: [{ op: "update", path: "assets/x", value: { ein: "123-45-6789" } }] } })).toMatchObject({ status: 400, json: { error: "bad_ein" } });
      sbRoutes.unshift([/GET tree_nodes\?collection=eq\.assets&select=id,name/, () => [{ id: "p", name: "Parent, LLC" }]]);
      const r = await call("POST", { body: { ops: [{ op: "update", path: "assets/x", value: { ein: "12-3456789" } }] } });
      expect(r).toMatchObject({ status: 409, json: { error: "ein_in_use", message: "12-3456789 is already Parent, LLC's EIN." } });
    });

    it("stamps a note with its author and keeps it when deleted", async () => {
      sbRoutes.push([/GET tree_nodes\?collection=eq\.notes&id=in\./, (c) => (c.path.includes('"old"') ? [{ collection: "notes", id: "old", data: { title: "Old", createdBy: { id: "u2" } }, updated_at: "t" }] : [])]);
      expect((await call("POST", { body: { ops: [{ op: "set", path: "notes/n1", value: { title: "T", body: "B" } }] } })).status).toBe(200);
      expect(sbCalls.find((c) => c.path === "rpc/tree_apply")!.body.ops[1]).toMatchObject({ path: ["notes", "n1"], value: { createdBy: { id: "u1", name: "Robert" } } });
      expect((await call("POST", { body: { ops: [{ op: "set", path: "notes/old", value: null }] } })).status).toBe(409);
      expect((await call("POST", { body: { ops: [{ op: "update", path: "notes/old", value: { deletedAt: 1 } }] } })).status).toBe(403);
    });

    it("credits a document scan's writes to the scan, started by the person who ran it", async () => {
      let reads = 0;
      sbRoutes.push([/GET tree_nodes\?collection=eq\.assets&id=in\./, () => [{ collection: "assets", id: "x", data: reads++ ? { name: "Child, LLC", address: "1 Main St" } : { name: "Child, LLC" }, updated_at: "t" }]]);
      expect((await call("POST", { body: { source: "scan", ops: [{ op: "update", path: "assets/x", value: { address: "1 Main St" } }] } })).status).toBe(200);
      const logged = sbCalls.find((c) => c.method === "POST" && c.path.startsWith("entity_activity"))?.body;
      expect(logged?.[0]).toMatchObject({ actor_name: "Document scan, started by Robert", source: "system" });
    });
  });
});
