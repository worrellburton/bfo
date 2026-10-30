import { beforeEach, describe, expect, it, vi } from "vitest";

// Each reading is a paid model call: these check it's made once per set of
// copies, a failure after the call is remembered, and an unreadable scan isn't
// claimed as read.

type Call = { method: string; path: string; body?: any };
const sbCalls: Call[] = [];
let rows: Record<string, any> = {};
let me: any = null;
let files: Record<string, { bytes: Uint8Array; contentType: string } | null> = {};
let replies: any[] = [];
let modelCalls = 0;

vi.mock("@anthropic-ai/sdk", () => {
  class BadRequestError extends Error {}
  class Anthropic {
    static BadRequestError = BadRequestError;
    messages = {
      create: async () => {
        modelCalls++;
        return replies.shift();
      },
    };
  }
  return { default: Anthropic };
});
vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    currentUser: async () => me,
    sb: async (path: string, init: { method?: string; body?: any } = {}) => {
      const c = { method: init.method ?? "GET", path: decodeURIComponent(path), body: init.body };
      sbCalls.push(c);
      const id = /^stable_mail\?id=eq\.([\w-]+)/.exec(c.path)?.[1];
      if (!id) return [];
      if (c.method === "PATCH") {
        rows[id] = { ...rows[id], ...c.body };
        return [rows[id]];
      }
      return rows[id] ? [rows[id]] : [];
    },
  };
});
vi.mock("../lib/storage.js", () => ({
  storageRead: async (path: string) => files[path] ?? null,
  storageSignedUrl: async (path: string) => `https://signed/${path}`,
}));
vi.mock("../lib/tree.js", () => ({ readCollection: async () => [] }));
vi.mock("../lib/entity-access.js", () => ({ accessibleAssetIds: async () => ["louise"] }));

import { needsReading, readingFailed, readingKey, readPiece, ReadingUnavailable } from "../lib/paper-read";
import handler from "../api/stable";

const ENV = "stable/mi_123456/envelope.jpg";
const SCAN = "stable/mi_123456/scan.pdf";
const jpeg = { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" };
const pdf = { bytes: new Uint8Array([4, 5, 6]), contentType: "application/pdf" };
const ok = (over: Record<string, unknown> = {}) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify({ headline: "A bill", kind: "bill", urgency: "action", envelopeText: [], ...over }) }],
});
const row = (over: Record<string, unknown> = {}) => ({ id: "mi_123456", asset_id: "louise", envelope_path: ENV, scan_path: null, reading: null, reading_from: null, ...over });

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
  rows = {};
  files = { [ENV]: jpeg, [SCAN]: pdf };
  replies = [];
  modelCalls = 0;
  me = { id: "u1", name: "Robert", role: "member", status: "approved" };
  process.env.ANTHROPIC_API_KEY = "test";
});

describe("a failed reading", () => {
  it("is remembered after a refusal, so the next open doesn't pay again", async () => {
    const r = row();
    replies = [{ stop_reason: "refusal", content: [] }];
    await expect(readPiece(r as any)).rejects.toBeInstanceOf(ReadingUnavailable);
    expect(modelCalls).toBe(1);
    const patch = sbCalls.find((c) => c.method === "PATCH")!.body;
    expect(patch).not.toHaveProperty("reading");
    const saved = { ...r, ...patch };
    expect(needsReading(saved)).toBe(false);
    expect(readingFailed(saved)).toBe(true);
    // A new scan is a new set of copies: read again.
    expect(needsReading({ ...saved, scan_path: SCAN })).toBe(true);
    expect(readingFailed({ ...saved, scan_path: SCAN })).toBe(false);
  });

  it("is remembered when the model's answer isn't JSON, and says so plainly", async () => {
    replies = [{ stop_reason: "end_turn", content: [{ type: "text", text: '{"headline": "A bi' }] }];
    await expect(readPiece(row() as any)).rejects.toThrow(/couldn't make sense/);
    expect(sbCalls.filter((c) => c.method === "PATCH").map((c) => c.body.reading_from)).toEqual([`failed:${readingKey(row())}`]);
  });
});

describe("a scan BFO can't read", () => {
  it("isn't claimed as read, and the envelope isn't paid for twice", async () => {
    files[SCAN] = null; // too large, an unsupported type, or storage didn't answer
    const r = row({ scan_path: SCAN });
    replies = [ok()];
    const reading = await readPiece(r as any);
    expect(reading.fromScan).toBe(false);
    const saved = { ...r, ...sbCalls.find((c) => c.method === "PATCH")!.body };
    expect(saved.reading_from).toBe(readingKey({ envelope_path: ENV, scan_path: null }));
    expect(needsReading(saved)).toBe(true);
    await expect(readPiece(saved)).rejects.toThrow(/couldn't read the scan/);
    expect(modelCalls).toBe(1);
    // ...and remembered, so the next open doesn't fetch the scan and fail again.
    const after = { ...saved, ...sbCalls.filter((c) => c.method === "PATCH").at(-1)!.body };
    expect(after.reading_from).toBe(`failed:${readingKey(after)}`);
    expect(needsReading(after)).toBe(false);
    expect(readingFailed(after)).toBe(true);
  });
});

describe("POST read-piece", () => {
  it("returns a current reading without calling the model", async () => {
    rows.mi_123456 = row({ reading: { headline: "A bill" }, reading_from: readingKey(row()) });
    const out = await call("POST", { action: "read-piece", id: "mi_123456" });
    expect(out.status).toBe(200);
    expect(out.json.mail.reading.headline).toBe("A bill");
    expect(modelCalls).toBe(0);
  });

  it("doesn't retry a failed reading on open, only when staff ask", async () => {
    rows.mi_123456 = row({ reading_from: `failed:${readingKey(row())}` });
    const opened = await call("POST", { action: "read-piece", id: "mi_123456" });
    expect(opened.json.mail).toMatchObject({ readingStale: false, readingFailed: true });
    expect(modelCalls).toBe(0);
    me = { ...me, role: "viewer" };
    await call("POST", { action: "read-piece", id: "mi_123456", force: true });
    expect(modelCalls).toBe(0);
    me = { ...me, role: "member" };
    replies = [ok()];
    const again = await call("POST", { action: "read-piece", id: "mi_123456", force: true });
    expect(modelCalls).toBe(1);
    expect(again.json.mail).toMatchObject({ readingStale: false, readingFailed: false, reading: { headline: "A bill" } });
  });

  it("reads a piece the first time it's opened", async () => {
    rows.mi_123456 = row();
    replies = [ok()];
    const out = await call("POST", { action: "read-piece", id: "mi_123456" });
    expect(out.status).toBe(200);
    expect(modelCalls).toBe(1);
    expect(out.json.mail.readingStale).toBe(false);
  });
});

describe("marking a piece read", () => {
  it("counts staff, not a partner opening their entity's mail", async () => {
    rows.mi_123456 = row();
    me = { id: "p1", name: "Pat", role: "partner", status: "approved" };
    expect((await call("POST", { action: "read", id: "mi_123456" })).status).toBe(200);
    expect(rows.mi_123456.read_at ?? null).toBeNull();
    me = { id: "u1", name: "Robert", role: "member", status: "approved" };
    await call("POST", { action: "read", id: "mi_123456" });
    expect(rows.mi_123456.read_at).toBeTruthy();
  });
});

describe("filing paper mail", () => {
  it("tells a viewer why they can't", async () => {
    rows.mi_123456 = row();
    me = { ...me, role: "viewer" };
    const out = await call("POST", { action: "assign", id: "mi_123456", assetId: "louise" });
    expect(out.status).toBe(403);
    expect(out.json.message).toMatch(/owners, admins and members/);
    const sync = await call("POST", { action: "sync" });
    expect(sync.status).toBe(403);
    expect(sync.json.message).toMatch(/owners, admins and members/);
  });
});
