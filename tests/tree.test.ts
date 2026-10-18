import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectionValue, compareKeys, parseOps, parsePath, touchedRows, valueAt } from "../lib/tree";
import { firebaseFilesOf, forgetImports } from "../lib/firebase-bridge";

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
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
});
afterEach(() => vi.unstubAllGlobals());

// ── Pure helpers ──────────────────────────────────────────────────────

describe("paths", () => {
  it("splits and checks a path", () => {
    expect(parsePath("assets/x/documents/d")).toEqual(["assets", "x", "documents", "d"]);
    expect(parsePath("/assets//x/")).toEqual(["assets", "x"]);
    expect(parsePath("")).toEqual([]);
    expect(parsePath("users/x")).toBeNull(); // not a tree collection
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
    expect(collectionValue([{ id: "b", data: 1 }, { id: "a", data: 2 }])).toEqual({ a: 2, b: 1 });
    expect(Object.keys(collectionValue([{ id: "b", data: 1 }, { id: "a", data: 2 }]) as object)).toEqual(["a", "b"]);
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
});

// ── The endpoint ──────────────────────────────────────────────────────

describe("/api/tree", () => {
  it("needs a session, and a path in the tree", async () => {
    me = null;
    expect(await call("GET", { query: { path: "assets" } })).toEqual({ status: 401, json: { error: "unauthorized" } });
    me = member;
    expect(await call("GET", { query: { path: "users" } })).toEqual({ status: 400, json: { error: "bad_path" } });
    expect(await call("GET", { query: { path: "" } })).toEqual({ status: 400, json: { error: "bad_path" } });
  });

  it("reads a collection as one object, and any node inside a row", async () => {
    sbRoutes.push([/GET tree_nodes\?collection=eq\.notes&select=collection,id,data,updated_at&order=id/, () => [
      { collection: "notes", id: "b", data: { text: "two" }, updated_at: "t" },
      { collection: "notes", id: "a", data: { text: "one" }, updated_at: "t" },
    ]]);
    sbRoutes.push([/GET tree_nodes\?collection=eq\.notes&id=in\./, () => [{ collection: "notes", id: "a", data: { text: "one", tags: { x: 1 } }, updated_at: "t" }]]);
    expect((await call("GET", { query: { path: "notes" } })).json).toEqual({ value: { a: { text: "one" }, b: { text: "two" } }, updated: { a: "t", b: "t" } });
    expect((await call("GET", { query: { path: "notes/a/tags/x" } })).json).toEqual({ value: 1 });
    expect((await call("GET", { query: { path: "notes/a/missing" } })).json).toEqual({ value: null });
    expect((await call("GET", { query: { path: "notes", view: "index" } })).json).toEqual({ rows: [] });
  });

  it("copies every collection out of Firebase on the first request", async () => {
    sbRoutes = [
      [/GET tree_imports/, () => []],
      [/POST tree_imports/, () => [{ collection: "agents", status: "running" }]],
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("identitytoolkit")) return new Response(JSON.stringify({ idToken: "tok" }));
        if (url.includes("/agents.json")) return new Response(JSON.stringify({ n1: { text: "hi" }, n2: { text: "there" } }));
        // Firebase answers "null" for a node that was never written.
        if (url.includes(".json?auth=")) return new Response("null");
        return new Response("{}", { status: 404 });
      })
    );
    // Firebase holds only agents; the other collections come back empty and are marked done too.
    forgetImports();
    expect((await call("GET", { query: { path: "notes" } })).status).toBe(200);
    const inserted = sbCalls.find((c) => c.method === "POST" && c.path.startsWith("tree_nodes"));
    expect(inserted?.body).toEqual([
      { collection: "agents", id: "n1", data: { text: "hi" } },
      { collection: "agents", id: "n2", data: { text: "there" } },
    ]);
    expect(sbCalls.find((c) => c.method === "PATCH" && c.path.startsWith("tree_imports?collection=eq.agents"))?.body).toMatchObject({ status: "done", count: 2 });
    expect(sbCalls.filter((c) => c.method === "PATCH" && c.path.startsWith("tree_imports")).map((c) => c.body.status)).toEqual(["done", "done", "done", "done", "done"]);
  });

  it("writes through tree_apply and hands back the rows touched", async () => {
    sbRoutes.push([/GET tree_nodes\?collection=eq\.assets&id=in\./, () => [{ collection: "assets", id: "x", data: { name: "A", ein: "1" }, updated_at: "t2" }]]);
    const r = await call("POST", { body: { ops: [{ op: "update", path: "assets/x", value: { ein: "1" } }, { op: "set", path: "assets/gone", value: null }] } });
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
});
