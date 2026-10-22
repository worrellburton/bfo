import { beforeEach, describe, expect, it, vi } from "vitest";

const BIZ = "0b8d6a3e-1111-4222-8333-944455556666";
const applied: { path: string[]; value: Record<string, unknown> }[] = [];
const uploads: string[] = [];
let rows: { id: string; data: Record<string, unknown> }[] = [];
let mode: "test" | "live" = "live";

vi.mock("../lib/state-records.js", () => ({
  checkStateRecords: vi.fn(async () => [{ id: "a1", name: "Ledger Louise, LLC", state: "NV", outcome: "read", detail: "active" }]),
}));
vi.mock("../lib/tree.js", () => ({
  readCollection: vi.fn(async () => rows),
  readRows: vi.fn(async (_c: string, ids: string[]) => rows.filter((r) => ids.includes(r.id))),
  applyOps: vi.fn(async (ops: { path: string[]; value: Record<string, unknown> }[]) => {
    applied.push(...ops);
    return [];
  }),
}));
vi.mock("../lib/storage.js", () => ({ storageUpload: vi.fn(async (path: string) => (uploads.push(path), path)) }));
vi.mock("../lib/palm.js", async (orig) => {
  const actual = await orig<typeof import("../lib/palm")>();
  return {
    ...actual,
    palmMode: () => mode,
    palm: vi.fn(async (path: string, init: { method?: string } = {}) => {
      if (path.endsWith("/registered-agent")) return { provider: "palm", status: "active", name: "Palm RA", started_at: "2026-10-01T00:00:00Z" };
      if (path === `/v1/business/${BIZ}` && !init.method) return { display_name: "Old Name", metadata: { bfo_asset_id: "a1" }, vault: { "business.ein": "99-9999999" } };
      if (path.startsWith("/v1/case")) return { data: [{ id: "c1", status: "needs_response" }] };
      return {};
    }),
    listPalmDocuments: vi.fn(async () => ({
      documents: [
        { id: "d-old", type: "notice" },
        { id: "d-cert", types: ["certificate_of_formation"], filename: "Certificate.pdf", created_at: "2026-09-01" },
        { id: "d-notice", types: ["notice"], created_at: "2026-10-01" },
      ],
      truncated: false,
    })),
    palmFile: vi.fn(async () => ({ bytes: Buffer.from("%PDF-1.4"), contentType: "application/pdf", disposition: null })),
  };
});

import { palmDocKey } from "../lib/palm-docs";
import { syncAllWithPalm } from "../lib/palm-sync";

describe("syncing every entity with Palm", () => {
  beforeEach(() => {
    applied.length = 0;
    uploads.length = 0;
    mode = "live";
    rows = [
      { id: "a1", data: { name: "Ledger Louise, LLC", type: "LLC", ein: "12-3456789", documents: { k0: { palmDocumentId: "d-old" } }, palm: { live: { businessId: BIZ } } } },
      { id: "t1", data: { name: "Burton Trust", type: "Trust" } },
      { id: "a2", data: { name: "Unlinked LLC", type: "LLC" } },
    ];
  });

  it("reads the states, then the agent, Palm's copy, the mail and the questions of each one Palm holds", async () => {
    const r = await syncAllWithPalm({ by: { id: "u1", name: "Bobby" } });
    const a1 = r.entities.find((e) => e.id === "a1")!;
    expect(a1.lines.map((l) => [l.label, l.tone])).toEqual([
      ["NV record", "good"],
      ["Registered agent", "good"],
      ["Palm's copy", "warn"],
      ["Mail", "good"],
      ["Palm's questions", "warn"],
    ]);
    expect(a1.lines[2].text).toContain("EIN: Palm has 99-9999999, ours is 12-3456789");
    expect(a1.lines[3].text).toBe("3 at Palm; 2 newly saved to Documents.");
    expect(r.entities.find((e) => e.id === "a2")!.lines).toEqual([{ label: "Agent and mail", tone: "muted", text: "Not in Palm yet." }]);
    expect(r.entities.some((e) => e.id === "t1")).toBe(false);

    // Two new documents saved (the one already in Documents skipped), the certificate filling its slot.
    expect(uploads).toHaveLength(2);
    const docs = applied.filter((o) => Object.keys(o.value).some((k) => k.startsWith("documents/")));
    expect(docs).toHaveLength(2);
    expect(Object.values(docs[0].value)[0]).toMatchObject({ palmDocumentId: "d-cert", name: "Certificate", storageProvider: "supabase" });
    expect(docs[0].value.articles).toMatchObject({ fileName: "Certificate.pdf", storagePath: "" });
    expect(docs[1].value).not.toHaveProperty("articles");
    // The agent and the time of the sync, last.
    const last = applied.at(-1)!.value;
    expect(last).toMatchObject({ registeredAgent: "Palm RA", "palm/live/ra": { status: "active" } });
    expect(typeof last["palm/live/syncedAt"]).toBe("number");
  });

  it("saves no sandbox files in test mode", async () => {
    mode = "test";
    rows[0].data.palm = { test: { businessId: BIZ } };
    const r = await syncAllWithPalm({ by: { id: "u1", name: null } });
    expect(uploads).toEqual([]);
    expect(r.entities.find((e) => e.id === "a1")!.lines.find((l) => l.label === "Mail")!.text).toBe("3 at Palm (test mode: not saved).");
  });

  it("stops before running out of time, and says so", async () => {
    let t = 0;
    const r = await syncAllWithPalm({ by: { id: "u1", name: null }, budgetMs: 10, now: () => (t += 100) });
    expect(r.entities.find((e) => e.id === "a1")!.lines.at(-1)).toEqual({ label: "Agent and mail", tone: "warn", text: "Out of time on this run; sync again to finish." });
  });

  it("keys a Palm document by its Palm id, so two saves of it land on one entry", () => {
    expect(palmDocKey("doc_8f2a-11")).toBe("palm_doc_8f2a-11");
    expect(palmDocKey("a.b/c")).toBe("palm_a_b_c");
  });
});
