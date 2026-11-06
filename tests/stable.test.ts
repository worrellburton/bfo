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

import { centsOf, checksOf, entityKey, matchEntity, normName, saveMail, type StableMailItem } from "../lib/stable";
import webhook from "../api/stable-webhook";

const entities = [
  { id: "north", name: "Northwind Holdings, LLC" },
  { id: "alder", name: "Alder Ridge Ventures, LLC" },
  { id: "sun", name: "Sundial Investments, L.L.C." },
];
const item = (over: Partial<StableMailItem> = {}): StableMailItem => ({
  id: "mi_123456",
  from: "Nevada Secretary of State",
  createdAt: "2026-10-21T10:00:00Z",
  imageUrl: "https://stable/envelope",
  recipients: { line1: { text: "NORTHWIND HOLDINGS LLC" }, line2: { text: "A Rivera" } },
  scanDetails: null,
  checks: [],
  ...over,
});

beforeEach(() => {
  sbCalls.length = 0;
  existing = [];
  uploads.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.STABLE_WEBHOOK_TOKEN;
  delete process.env.STABLE_API_KEY;
});

describe("which entity a piece is for", () => {
  it("compares full names, entity type included, without punctuation", () => {
    expect(normName("Sundial Investments, L.L.C.")).toBe("sundial investments");
    expect(entityKey("Sundial Investments, L.L.C.")).toBe("sundial investments llc");
    expect(entityKey("The Alder Ridge Trust")).toBe("alder ridge trust");
    expect(entityKey("Northwind Holdings Incorporated")).toBe("northwind holdings inc");
    expect(matchEntity(item(), entities)).toBe("north");
    expect(matchEntity(item({ recipients: { line1: { text: "A Rivera" }, line2: { text: "Sundial Investments LLC" } } }), entities)).toBe("sun");
  });

  it("finds a full name inside a longer line, and nothing when no name is there", () => {
    expect(matchEntity(item({ recipients: { line1: { text: "Alder Ridge Ventures LLC c/o A Rivera" } } }), entities)).toBe("alder");
    expect(matchEntity(item({ recipients: { line1: { text: "Current Resident" } } }), entities)).toBeNull();
  });

  it("files nothing on a name without its entity type", () => {
    expect(matchEntity(item({ recipients: { line1: { text: "NORTHWIND HOLDINGS" } } }), entities)).toBeNull();
  });

  it("files nothing when two entities share a name once the type is set aside", () => {
    const twins = [...entities, { id: "north-trust", name: "Northwind Holdings Trust" }];
    expect(matchEntity(item(), twins)).toBeNull();
    expect(matchEntity(item({ recipients: { line1: { text: "NORTHWIND HOLDINGS TRUST" } } }), twins)).toBeNull();
  });

  it("files nothing when the envelope names two different entities", () => {
    expect(matchEntity(item({ recipients: { line1: { text: "Northwind Holdings LLC" }, line2: { text: "Sundial Investments LLC" } } }), entities)).toBeNull();
  });
});

describe("checks inside a piece", () => {
  it("reads each check's details, and an amount only when its unit is plain", () => {
    const [a, b, c] = checksOf({
      checks: [
        {
          amountCents: 124000,
          payerName: "Acme Tenant Co",
          checkNumber: 1042,
          checkDate: "2026-10-28",
          payee: "Northwind Holdings LLC",
          depositDetails: { status: "completed", depositedAt: "2026-10-30", account: "Operating •• 4821" },
        },
        { amount: "$1,250.50", from: { name: "Second Payer" } },
        { amount: 5000 },
      ],
    });
    expect(a).toEqual({
      amountCents: 124000,
      payer: "Acme Tenant Co",
      payee: "Northwind Holdings LLC",
      number: "1042",
      date: "2026-10-28",
      status: "completed",
      depositedAt: "2026-10-30",
      account: "Operating •• 4821",
    });
    expect(b).toMatchObject({ amountCents: 125050, payer: "Second Payer" });
    // A bare whole number could be dollars or cents: not guessed.
    expect(c.amountCents).toBeNull();
    expect(centsOf({ amount: 12.5 })).toBe(1250);
    expect(checksOf(null)).toEqual([]);
  });
});

describe("keeping a piece", () => {
  it("copies the envelope and the scan into BFO, and files it under its entity", async () => {
    await saveMail([item({ scanDetails: { status: "completed", imageUrl: "https://stable/scan", summary: "Annual list due" }, checks: [{}] })], entities);
    expect(uploads).toEqual(["stable/mi_123456/envelope.jpg", "stable/mi_123456/scan.jpg"]);
    const row = sbCalls.find((c) => c.method === "POST")!.body[0];
    expect(row).toMatchObject({
      id: "mi_123456",
      asset_id: "north",
      assigned: "auto",
      from_name: "Nevada Secretary of State",
      recipient: "NORTHWIND HOLDINGS LLC",
      summary: "Annual list due",
      checks: 1,
      scan_status: "completed",
    });
  });

  it("unfiles an automatic match that today's rules don't make, but keeps the old one when the entity list can't be read", async () => {
    existing = [{ id: "mi_123456", asset_id: "alder", assigned: "auto", envelope_path: "stable/mi_123456/envelope.jpg", scan_path: null, read_at: null }];
    await saveMail([item({ recipients: { line1: { text: "Current Resident" } } })], entities);
    expect(sbCalls.find((c) => c.method === "POST")!.body[0]).toMatchObject({ asset_id: null, assigned: "auto" });
    sbCalls.length = 0;
    await saveMail([item({ recipients: { line1: { text: "Current Resident" } } })], []);
    expect(sbCalls.find((c) => c.method === "POST")!.body[0]).toMatchObject({ asset_id: "alder" });
  });

  it("keeps a choice made by hand, and doesn't copy files twice", async () => {
    existing = [{ id: "mi_123456", asset_id: "alder", assigned: "hand", envelope_path: "stable/mi_123456/envelope.jpg", scan_path: null, read_at: "2026-10-21T11:00:00Z" }];
    await saveMail([item()], entities);
    expect(uploads).toEqual([]);
    expect(sbCalls.find((c) => c.method === "POST")!.body[0]).toMatchObject({ asset_id: "alder", assigned: "hand", read_at: "2026-10-21T11:00:00Z" });
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
      url.startsWith("https://api.usestable.com")
        ? new Response(JSON.stringify(item({ from: "From the API" })), { headers: { "content-type": "application/json" } })
        : new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    // The request's own copy of the piece is ignored: only its id is used.
    const r = await call({ token: "secret-token" }, { eventType: "mailItem.created", data: { id: "mi_123456", from: "Forged" } });
    expect(r.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.usestable.com/v1/mail-items/mi_123456");
    expect(sbCalls.find((c) => c.method === "POST")!.body[0].from_name).toBe("From the API");
    // A piece Stable doesn't know isn't retried.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"statusCode":404}', { status: 404 })),
    );
    expect(await call({ token: "secret-token" }, { eventType: "mailItem.created", data: { id: "mi_gone00" } })).toEqual({ status: 200, json: { ok: true, ignored: true } });
  });
});
