import { beforeEach, describe, expect, it, vi } from "vitest";

const replies: Record<string, unknown> = {};
let status = 200;
vi.mock("../app/auth", () => ({
  authFetch: vi.fn(async (path: string) => ({
    ok: status === 200,
    status,
    json: async () => (status === 503 ? { message: "out of credit" } : replies[path]),
  })),
}));

import { scanAllEntities } from "../app/entity-scan";

const pdf = { name: "Operating Agreement.pdf", url: "https://x/oa.pdf", contentType: "application/pdf", storagePath: "assets/a/oa.pdf" };

function run(asset: Record<string, unknown>) {
  const writes: [string, Record<string, unknown>][] = [];
  return scanAllEntities({ a: asset as never }, async (p, patch) => void writes.push([p, patch]), () => {}).then((r) => ({ r, writes }));
}

describe("scan all entities", () => {
  beforeEach(() => {
    status = 200;
    replies["/api/documents/classify"] = { kind: "operating_agreement", confidence: "high", taxClassification: "Partnership", taxClassificationEvidence: "three members" };
    replies["/api/documents/profile"] = {
      whatItIs: "A holding company.",
      members: [{ name: "Ledger Louise, LLC", percent: 65 }, { name: "Laura Fedele", percent: 20 }],
      taxTreatment: "Partnership",
      taxEvidence: "CP 575 B requires Form 1065",
      sources: ["Operating Agreement.pdf"],
    };
  });

  it("files the document, fills the tax class and saves the profile", async () => {
    const { r, writes } = await run({ name: "Swisshelm, LLC", state: "Arizona", documents: { d1: pdf } });
    expect(r.done).toBe(true);
    const asset = Object.assign({}, ...writes.filter(([p]) => p === "assets/a").map(([, w]) => w));
    expect(asset.operatingAgreement.docId).toBe("d1");
    expect(asset.llcType).toBe("Partnership");
    expect(asset.profile.whatItIs).toBe("A holding company.");
    expect(asset.members).toHaveLength(2);
    expect(writes.find(([p]) => p === "assets/a/documents/d1")?.[1].factsCheckedAt).toBeTypeOf("number");
  });

  it("flags a disagreeing tax class instead of overwriting it", async () => {
    const { writes } = await run({ name: "Swisshelm, LLC", state: "Arizona", llcType: "Disregarded Entity", documents: { d1: pdf } });
    const all = writes.map(([, w]) => w);
    expect(all.some((w) => "llcType" in w)).toBe(false);
    expect(all.find((w) => w.llcTypeConflict)?.llcTypeConflict).toMatchObject({ value: "Partnership" });
  });

  it("keeps owners entered by hand", async () => {
    const { writes } = await run({ name: "X, LLC", members: [{ name: "Hand", percent: 100 }], documents: { d1: pdf } });
    expect(writes.some(([, w]) => "members" in w)).toBe(false);
  });

  it("stops when document reading is paused", async () => {
    status = 503;
    const { r, writes } = await run({ name: "X, LLC", documents: { d1: pdf } });
    expect(r.paused).toBe("out of credit");
    expect(writes).toHaveLength(0);
  });
});
