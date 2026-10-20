import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sbCalls: { method: string; path: string; body?: any }[] = [];
let existing: any[] = [];
const uploads: string[] = [];

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    sb: async (path: string, init: { method?: string; body?: unknown } = {}) => {
      sbCalls.push({ method: init.method ?? "GET", path: decodeURIComponent(path), body: init.body });
      if ((init.method ?? "GET") === "GET" && path.startsWith("stable_mail?id=in.")) return existing;
      return [];
    },
  };
});
vi.mock("../lib/storage.js", () => ({
  storageUpload: async (path: string) => (uploads.push(path), path),
  storageSignedUrl: async (path: string) => `https://signed/${path}`,
}));
vi.mock("../lib/tree.js", () => ({ readCollection: async () => [] }));

import { matchEntity, normName, saveMail, type StableMailItem } from "../lib/stable";
import webhook from "../api/stable-webhook";

const entities = [
  { id: "louise", name: "Ledger Louise, LLC" },
  { id: "swiss", name: "Swisshelm Mountain Ventures, LLC" },
  { id: "sun", name: "Sundown Investments, L.L.C." },
];
const item = (over: Partial<StableMailItem> = {}): StableMailItem => ({
  id: "mi_123456",
  from: "Nevada Secretary of State",
  createdAt: "2026-10-21T10:00:00Z",
  imageUrl: "https://stable/envelope",
  recipients: { line1: { text: "LEDGER LOUISE LLC" }, line2: { text: "Robert Burton" } },
  scanDetails: null,
  checks: [],
  ...over,
});

beforeEach(() => {
  sbCalls.length = 0;
  existing = [];
  uploads.length = 0;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.STABLE_WEBHOOK_TOKEN;
  delete process.env.STABLE_API_KEY;
});

describe("which entity a piece is for", () => {
  it("compares names without punctuation or the entity ending", () => {
    expect(normName("Sundown Investments, L.L.C.")).toBe("sundown investments");
    expect(matchEntity(item(), entities)).toBe("louise");
    expect(matchEntity(item({ recipients: { line1: { text: "Robert Burton" }, line2: { text: "Sundown Investments LLC" } } }), entities)).toBe("sun");
  });

  it("finds an entity inside a longer line, and nothing when no name is there", () => {
    expect(matchEntity(item({ recipients: { line1: { text: "Swisshelm Mountain Ventures LLC c/o Robert Burton" } } }), entities)).toBe("swiss");
    expect(matchEntity(item({ recipients: { line1: { text: "Current Resident" } } }), entities)).toBeNull();
  });
});

describe("keeping a piece", () => {
  it("copies the envelope and the scan into BFO, and files it under its entity", async () => {
    await saveMail([item({ scanDetails: { status: "completed", imageUrl: "https://stable/scan", summary: "Annual list due" }, checks: [{}] })], entities);
    expect(uploads).toEqual(["stable/mi_123456/envelope.jpg", "stable/mi_123456/scan.jpg"]);
    const row = sbCalls.find((c) => c.method === "POST")!.body[0];
    expect(row).toMatchObject({ id: "mi_123456", asset_id: "louise", assigned: "auto", from_name: "Nevada Secretary of State", recipient: "LEDGER LOUISE LLC", summary: "Annual list due", checks: 1, scan_status: "completed" });
  });

  it("keeps a choice made by hand, and doesn't copy files twice", async () => {
    existing = [{ id: "mi_123456", asset_id: "swiss", assigned: "hand", envelope_path: "stable/mi_123456/envelope.jpg", scan_path: null, read_at: "2026-10-21T11:00:00Z" }];
    await saveMail([item()], entities);
    expect(uploads).toEqual([]);
    expect(sbCalls.find((c) => c.method === "POST")!.body[0]).toMatchObject({ asset_id: "swiss", assigned: "hand", read_at: "2026-10-21T11:00:00Z" });
  });
});

describe("/api/stable-webhook", () => {
  const call = (query: Record<string, string>, body: unknown) => {
    const out: { status: number; json?: any } = { status: 0 };
    const res: any = { status: (c: number) => ((out.status = c), res), json: (j: unknown) => ((out.json = j), res) };
    return Promise.resolve(webhook({ method: "POST", query, body, headers: {} } as any, res)).then(() => out);
  };

  it("needs the shared token, then reads the piece back from Stable by id", async () => {
    expect((await call({ token: "x" }, {})).status).toBe(503);
    process.env.STABLE_WEBHOOK_TOKEN = "secret-token";
    process.env.STABLE_API_KEY = "k";
    expect((await call({ token: "wrong" }, { eventType: "mailItem.created", data: { id: "mi_123456" } })).status).toBe(401);
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith("https://api.usestable.com") ? new Response(JSON.stringify(item({ from: "From the API" })), { headers: { "content-type": "application/json" } }) : new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    // The request's own copy of the piece is ignored: only its id is used.
    const r = await call({ token: "secret-token" }, { eventType: "mailItem.created", data: { id: "mi_123456", from: "Forged" } });
    expect(r.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.usestable.com/v1/mail-items/mi_123456");
    expect(sbCalls.find((c) => c.method === "POST")!.body[0].from_name).toBe("From the API");
  });
});
