import { beforeEach, describe, expect, it, vi } from "vitest";

let me: any = null;
let access: string[] = [];
let rows: Record<string, unknown> = {};
const signed: { path: string; ttl: number; bucket: string; download?: string }[] = [];

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    currentUser: async (_req: unknown, opts: { allowPartner?: boolean } = {}) => {
      if (me?.role === "partner" && !opts.allowPartner) throw new actual.PartnerRefused("no");
      return me;
    },
  };
});
vi.mock("../lib/entity-access.js", () => ({ accessibleAssetIds: async () => access }));
vi.mock("../lib/tree.js", () => ({ readRows: async (_: string, ids: string[]) => ids.filter((id) => rows[id]).map((id) => ({ id, data: rows[id] })) }));
vi.mock("../lib/storage.js", () => ({
  storageSignedUrl: async (path: string, ttl: number, bucket: string, download?: string) => {
    signed.push({ path, ttl, bucket, download });
    if (path.endsWith("down.pdf")) throw new Error("storage sign failed: 503 upstream");
    return path.endsWith("gone.pdf") ? null : `https://sb.test/storage/v1/object/sign/${bucket}/${path}?token=t`;
  },
}));

import handler from "../api/documents/url";

const P = "assets/e1/1700000000000-OA.pdf";
const PUBLIC = `https://sb.test/storage/v1/object/public/documents/${P}`;

function call(query: Record<string, string>, method = "GET") {
  const out: { status: number; json?: any; headers: Record<string, string> } = { status: 0, headers: {} };
  const res: any = {
    status(c: number) {
      out.status = c;
      return res;
    },
    json(j: unknown) {
      out.json = j;
      return res;
    },
    setHeader(k: string, v: string) {
      out.headers[k] = v;
    },
    end() {
      return res;
    },
  };
  return Promise.resolve(handler({ method, query, headers: {} } as any, res)).then(() => out);
}

beforeEach(() => {
  me = { id: "u1", role: "owner", status: "approved" };
  access = [];
  rows = { e1: { name: "E1", documents: { d1: { name: "OA", url: PUBLIC, storagePath: P, storageProvider: "supabase" } } } };
  signed.length = 0;
});

describe("GET /api/documents/url", () => {
  it("needs a session", async () => {
    me = null;
    expect((await call({ path: P })).status).toBe(401);
    expect(signed).toEqual([]);
  });

  it("signs a 10-minute link in the documents bucket for staff", async () => {
    for (const role of ["owner", "admin", "member", "viewer"]) {
      me = { id: "u1", role, status: "approved" };
      const r = await call({ path: P });
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ url: `https://sb.test/storage/v1/object/sign/documents/${P}?token=t`, expiresIn: 600 });
      expect(r.headers["Cache-Control"]).toContain("no-store");
    }
    expect(signed.every((s) => s.path === P && s.ttl === 600 && s.bucket === "documents")).toBe(true);
  });

  it("accepts a stored public URL and passes a download name", async () => {
    const r = await call({ path: PUBLIC, download: "Operating Agreement.pdf" });
    expect(r.status).toBe(200);
    expect(signed[0]).toEqual({ path: P, ttl: 600, bucket: "documents", download: "Operating Agreement.pdf" });
  });

  it("refuses paths outside assets/ or with traversal", async () => {
    for (const path of ["", "receipts/x.pdf", "assets/e1/../../mail/x", "assets/../x", "https://sb.test/storage/v1/object/public/brand/logo.png"]) {
      const r = await call({ path });
      expect(r.status).toBe(400);
    }
    expect(signed).toEqual([]);
  });

  it("lets a partner read only their own entities' documents", async () => {
    me = { id: "p1", role: "partner", status: "approved" };
    access = ["e1"];
    expect((await call({ path: P })).status).toBe(200);
    access = ["e2"];
    expect((await call({ path: P })).status).toBe(403);
    access = []; // revoked
    expect((await call({ path: PUBLIC })).status).toBe(403);
    expect(signed).toHaveLength(1);
  });

  it("gives a partner only files the entity still shows them", async () => {
    me = { id: "p1", role: "partner", status: "approved" };
    access = ["e1"];
    expect((await call({ path: "assets/e1/1-deleted.pdf" })).status).toBe(403);
    rows.e1 = { name: "E1", notes: { n1: { url: `https://sb.test/storage/v1/object/public/documents/assets/e1/staff.pdf` } } };
    expect((await call({ path: "assets/e1/staff.pdf" })).status).toBe(403);
    rows.e1 = { name: "E1", einLetter: { url: PUBLIC, fileName: "OA.pdf", storagePath: "", docId: "d1" } };
    expect((await call({ path: P })).status).toBe(200);
  });

  it("refuses email-only users and other methods", async () => {
    me = { id: "u2", role: "email", status: "approved" };
    expect((await call({ path: P })).status).toBe(403);
    me = { id: "u1", role: "owner", status: "approved" };
    expect((await call({ path: P }, "POST")).status).toBe(405);
  });

  it("answers 404 when the file is gone", async () => {
    expect((await call({ path: "assets/e1/gone.pdf" })).status).toBe(404);
  });

  it("answers 500, not 404, when Storage itself fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await call({ path: "assets/e1/down.pdf" })).toMatchObject({ status: 500, json: { error: "server_error" } });
  });
});
