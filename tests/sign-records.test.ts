import { beforeEach, describe, expect, it, vi } from "vitest";
import { deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { ESIGN_DISCLOSURE_VERSION, hashToken, sha256Hex, type SignatureRequestRow } from "../lib/sign";

/**
 * The record api/sign.ts keeps: the consent and the evidence of each
 * signature, the fingerprints, the signed copy filed with the entity and sent
 * to the parties, delete only for an unsent draft, archive for the rest, void
 * with a reason, and the signer told when a request was withdrawn. The
 * database is a map of rows (PostgREST's shape), the bucket a map of files,
 * the tree one entity; email and push are fakes that send nothing.
 */

const rows = new Map<string, SignatureRequestRow>();
const files = new Map<string, Uint8Array>();
const calls: Array<{ path: string; method: string; body: any }> = [];
let me = { id: "u1", name: "Robert Burton", role: "owner", status: "approved", email: "r@x.com" };
const tokenA = "a".repeat(32);
const tokenB = "b".repeat(32);
const ID = "11111111-1111-4111-8111-111111111111";

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    sendEmail: vi.fn(async () => {}),
    currentUser: async () => me,
    sb: async (path: string, init: { method?: string; body?: any } = {}) => {
      const method = init.method ?? "GET";
      calls.push({ path, method, body: init.body });
      if (path.startsWith("tree_nodes")) {
        return decodeURIComponent(path).includes('"ent1"') ? [{ collection: "assets", id: "ent1", data: { name: "Northwind Holdings, LLC" }, updated_at: "2026-11-01T00:00:00Z" }] : [];
      }
      if (!path.startsWith("signature_requests")) return [];
      const qs = new URLSearchParams(path.split("?")[1]);
      const byId = qs.get("id")?.replace(/^eq\./, "");
      if (method === "GET") {
        const cs = qs.get("parties");
        if (cs) {
          const want = JSON.parse(decodeURIComponent(cs.slice(3)))[0].tokenHash;
          return [...rows.values()].filter((r) => r.parties.some((p) => p.tokenHash === want)).map((r) => structuredClone(r));
        }
        if (byId) return rows.has(byId) ? [structuredClone(rows.get(byId))] : [];
        return [...rows.values()].map((r) => structuredClone(r));
      }
      if (method === "PATCH" && byId) {
        const r = rows.get(byId);
        if (!r) return [];
        const v = qs.get("version");
        if (v && `eq.${r.version}` !== v) return [];
        const next = { ...r, ...structuredClone(init.body) };
        rows.set(byId, next);
        return [structuredClone(next)];
      }
      if (method === "DELETE" && byId) {
        const r = rows.get(byId);
        // The filter in the path is honoured: only an unsent draft goes.
        if (r && qs.get("status") === "eq.draft" && r.status === "draft" && !r.sent_at) rows.delete(byId);
        return [];
      }
      return [];
    },
  };
});
vi.mock("../lib/db-pages.js", () => ({
  fetchAll: async (path: string) => {
    const qs = new URLSearchParams(path.split("?")[1]);
    const archived = qs.get("archived_at");
    return [...rows.values()].filter((r) => (archived === "is.null" ? !r.archived_at : archived === "not.is.null" ? !!r.archived_at : true)).map((r) => structuredClone(r));
  },
}));
vi.mock("../lib/storage.js", () => ({
  storageDownload: async (p: string) => files.get(p) ?? null,
  storageUpload: async (p: string, bytes: Uint8Array) => (files.set(p, bytes), p),
  storageRemove: async (p: string) => void files.delete(p),
  storageSignedUrl: async (p: string) => `https://storage.test/${p}`,
}));
const pushes: any[] = [];
vi.mock("../lib/push.js", () => ({ notifyAdmins: async (payload: unknown) => (pushes.push(payload), 0) }));

const { default: handler } = await import("../api/sign");
const { sendEmail } = await import("../lib/auth.js");

const png = (() => {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(60, 0);
  ihdr.writeUInt32BE(20, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((60 * 4 + 1) * 20);
  for (let y = 9; y < 12; y++) for (let x = 0; x < 60; x++) raw.writeUInt32BE(0x101018ff, y * (60 * 4 + 1) + 1 + x * 4);
  const out = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${out.toString("base64")}`;
})();

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

function call(method: "GET" | "POST", body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
  const res: any = { statusCode: 200, body: null as any };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  res.setHeader = () => res;
  res.end = () => res;
  return handler({ method, body, query, headers: { "x-real-ip": "10.0.0.1", "user-agent": UA } } as any, res).then(() => res);
}

const sign = (token: string, name: string, extra: Record<string, unknown> = {}) =>
  call("POST", { action: "sign", token, name, signature: png, consent: true, consentVersion: ESIGN_DISCLOSURE_VERSION, method: "drawn", timeZone: "America/New_York", ...extra });

let original: Uint8Array;

beforeEach(async () => {
  rows.clear();
  files.clear();
  calls.length = 0;
  pushes.length = 0;
  vi.mocked(sendEmail).mockClear();
  me = { id: "u1", name: "Robert Burton", role: "owner", status: "approved", email: "r@x.com" };
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  original = await doc.save();
  files.set(`signatures/${ID}/upload-1-aaaaaaaa.pdf`, original);
  rows.set(ID, {
    id: ID,
    title: "Operating Agreement – Northwind",
    status: "sent",
    source: "upload",
    asset_id: "ent1",
    contract_id: null,
    created_by: "u1",
    created_by_name: "Robert Burton",
    original_path: `signatures/${ID}/upload-1-aaaaaaaa.pdf`,
    current_path: `signatures/${ID}/upload-1-aaaaaaaa.pdf`,
    signed_path: null,
    pages: [{ w: 612, h: 792 }],
    fields: [
      { id: "fa", party: "a", type: "signature", page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.05 },
      { id: "fn", party: "a", type: "name", page: 1, x: 0.1, y: 0.86, w: 0.4, h: 0.03 },
      { id: "fb", party: "b", type: "signature", page: 1, x: 0.55, y: 0.8, w: 0.3, h: 0.05 },
    ],
    parties: [
      { key: "a", role: "Member", name: "Alex Rivera", entity: "Northwind Holdings, LLC", title: "Manager", email: "alex@x.com", status: "sent", tokenHash: hashToken(tokenA) },
      { key: "b", role: "Member", name: "Sam Lee", email: "sam@x.com", status: "sent", tokenHash: hashToken(tokenB) },
    ],
    events: [],
    created_at: "2026-11-02T10:00:00Z",
    sent_at: "2026-11-02T10:00:00Z",
    completed_at: null,
    copy_sent_at: null,
    brand: null,
    mode: "normal",
    version: 0,
  });
});

describe("a signature's record", () => {
  it("refuses a signature without the consent, or with a disclosure version it doesn't know", async () => {
    expect((await call("POST", { action: "sign", token: tokenA, name: "Alex Rivera", signature: png })).body.error).toBe("consent");
    expect((await call("POST", { action: "sign", token: tokenA, name: "Alex Rivera", signature: png, consent: true, consentVersion: "old" })).body.error).toBe("consent_version");
    expect(rows.get(ID)!.parties[0].status).toBe("sent");
  });

  it("keeps the consent, the address, the device and the method, and writes them to the history", async () => {
    const r = await sign(tokenA, "Alex Rivera");
    expect(r.statusCode).toBe(200);
    const a = rows.get(ID)!.parties[0];
    expect(a).toMatchObject({ status: "signed", ip: "10.0.0.1", device: UA, method: "drawn", via: "page", timeZone: "America/New_York" });
    expect(a.consent).toMatchObject({ version: ESIGN_DISCLOSURE_VERSION, ip: "10.0.0.1", device: UA });
    expect(Date.parse(a.consent!.at)).toBeLessThanOrEqual(Date.parse(a.signedAt!));
    const kinds = rows.get(ID)!.events.map((e) => e.kind);
    expect(kinds).toEqual(["consented", "signed"]);
    expect(rows.get(ID)!.events[0]).toMatchObject({ party: "a", ip: "10.0.0.1", note: `disclosure of ${ESIGN_DISCLOSURE_VERSION}` });
  });

  it("on completion: fingerprints both files, files the signed copy with the entity, and emails every party their copy", async () => {
    await sign(tokenA, "Alex Rivera");
    vi.mocked(sendEmail).mockClear();
    const r = await sign(tokenB, "Sam Lee", { via: "game" });
    expect(r.body.completed).toBe(true);
    const done = rows.get(ID)!;
    expect(done.status).toBe("completed");
    expect(done.original_sha256).toBe(sha256Hex(original));
    expect(done.signed_sha256).toBe(sha256Hex(files.get(done.signed_path!)!));
    expect(done.executed_sha256).toBe(sha256Hex(files.get(done.current_path!)!));
    // Filed with the entity's documents, once, under the entity.
    expect(done.filed_path).toMatch(/^assets\/ent1\/\d+-Operating Agreement Northwind \(signed 11111111\)\.pdf$/);
    expect(files.get(done.filed_path!)).toEqual(files.get(done.signed_path!));
    const filed = calls.find((c) => c.path === "rpc/tree_apply");
    expect(filed?.body.ops[0]).toMatchObject({ op: "set", path: ["assets", "ent1", "documents", `signed-${ID}`], value: { storagePath: done.filed_path, signatureRequestId: ID } });
    // The signed copy went to both parties by itself; the office's notice went too.
    const to = vi.mocked(sendEmail).mock.calls.map((c) => c[0]);
    expect(to).toEqual(expect.arrayContaining(["alex@x.com", "sam@x.com"]));
    expect(done.copy_sent_at).toBeTruthy();
    expect(done.events.filter((e) => e.kind === "copy_sent")).toHaveLength(2);
    // The signer who just finished keeps the link in hand; the other gets a fresh one.
    expect(done.parties[1].tokenHash).toBe(hashToken(tokenB));
    expect(done.parties[0].tokenHash).not.toBe(hashToken(tokenA));
    // The audit trail and the entity's activity record it.
    expect(calls.some((c) => c.path === "audit_log" && c.body.action === "signature.complete")).toBe(true);
    expect(calls.some((c) => c.path === "entity_activity" && c.body[0].summary.includes("signed by everyone"))).toBe(true);
    expect(done.parties[1]).toMatchObject({ via: "game" });
  });

  it("counts an opening from the page, with where and on what, not from the link being fetched", async () => {
    const view = await call("GET", {}, { token: tokenB });
    expect(view.statusCode).toBe(200);
    expect(view.body.disclosureVersion).toBe(ESIGN_DISCLOSURE_VERSION);
    expect(rows.get(ID)!.parties[1].viewedAt).toBeUndefined();
    await call("POST", { action: "opened", token: tokenB });
    expect(rows.get(ID)!.parties[1]).toMatchObject({ status: "viewed", viewIp: "10.0.0.1", viewDevice: UA });
  });

  it("records a decline with its address and device, keeps the reason off the push, and emails the office and the decliner", async () => {
    const r = await call("POST", { action: "decline", token: tokenB, reason: "Wrong effective date" });
    expect(r.statusCode).toBe(200);
    const b = rows.get(ID)!.parties[1];
    expect(b).toMatchObject({ status: "declined", declinedReason: "Wrong effective date", declineIp: "10.0.0.1", declineDevice: UA });
    expect(rows.get(ID)!.status).toBe("declined");
    expect(JSON.stringify(pushes)).not.toContain("Wrong effective date");
    expect(vi.mocked(sendEmail).mock.calls.some((c) => c[0] === "sam@x.com" && String(c[1]).startsWith("You declined"))).toBe(true);
  });

  it("answers an expired link with 410", async () => {
    rows.get(ID)!.parties[1].expiresAt = "2020-01-01T00:00:00Z";
    expect((await call("GET", {}, { token: tokenB })).statusCode).toBe(410);
  });
});

describe("delete, archive and void", () => {
  it("never deletes a request that went out; deletes an unsent draft and its files", async () => {
    const r = await call("POST", { action: "delete", id: ID });
    expect(r.statusCode).toBe(409);
    expect(r.body.error).toBe("kept");
    expect(rows.has(ID)).toBe(true);
    const draft = rows.get(ID)!;
    draft.status = "draft";
    draft.sent_at = null;
    const ok = await call("POST", { action: "delete", id: ID });
    expect(ok.statusCode).toBe(200);
    expect(rows.has(ID)).toBe(false);
    expect(files.size).toBe(0);
    expect(calls.some((c) => c.path === "audit_log" && c.body.action === "signature.delete")).toBe(true);
  });

  it("archives a finished request for an owner or admin, with a reason, and hides it from the list", async () => {
    const row = rows.get(ID)!;
    row.status = "completed";
    me = { ...me, role: "member" };
    expect((await call("POST", { action: "archive", id: ID, reason: "Superseded" })).statusCode).toBe(403);
    me = { ...me, role: "admin" };
    expect((await call("POST", { action: "archive", id: ID })).body.error).toBe("reason");
    const r = await call("POST", { action: "archive", id: ID, reason: "Superseded by the Nov 5 version" });
    expect(r.statusCode).toBe(200);
    expect(rows.get(ID)).toMatchObject({ archived_by: "u1", archived_reason: "Superseded by the Nov 5 version" });
    expect((await call("GET")).body.requests).toHaveLength(0);
    expect((await call("GET", {}, { archived: "1" })).body.requests).toHaveLength(1);
    // Kept whole, and its signer can still open their copy.
    expect(rows.get(ID)!.parties).toHaveLength(2);
    const back = await call("POST", { action: "unarchive", id: ID });
    expect(back.body.request.archived_at).toBeNull();
  });

  it("won't archive an open request: it is voided first", async () => {
    expect((await call("POST", { action: "archive", id: ID, reason: "x" })).body.error).toBe("not_archivable");
  });

  it("voids only with a reason; the signer is then told it was withdrawn, and can't sign", async () => {
    expect((await call("POST", { action: "void", id: ID })).body.error).toBe("reason");
    const r = await call("POST", { action: "void", id: ID, reason: "Wrong effective date", notify: true });
    expect(r.statusCode).toBe(200);
    expect(rows.get(ID)!.events.find((e) => e.kind === "voided")).toMatchObject({ note: "Wrong effective date", by: "u1" });
    expect(rows.get(ID)!.events.filter((e) => e.kind === "withdrawn_sent")).toHaveLength(2);
    expect(vi.mocked(sendEmail).mock.calls.map((c) => c[1])).toEqual(["Operating Agreement – Northwind was withdrawn", "Operating Agreement – Northwind was withdrawn"]);
    const view = await call("GET", {}, { token: tokenB });
    expect(view.statusCode).toBe(200);
    expect(view.body).toMatchObject({ status: "voided" });
    expect(view.body.voidedAt).toBeTruthy();
    expect((await sign(tokenB, "Sam Lee")).statusCode).toBe(409);
  });

  it("refuses to void a signed agreement, pointing at archive", async () => {
    rows.get(ID)!.status = "completed";
    const r = await call("POST", { action: "void", id: ID, reason: "x" });
    expect(r.statusCode).toBe(409);
    expect(r.body.message).toMatch(/Archive it/);
  });
});

describe("what the office may change", () => {
  it("locks the title, the parties and the fields once sent", async () => {
    const r = await call("POST", { action: "update", id: ID, title: "Something else" });
    expect(r.statusCode).toBe(409);
    const p = await call("POST", {
      action: "update",
      id: ID,
      parties: [
        { role: "Member", name: "Alex Rivera", email: "other@x.com" },
        { role: "Member", name: "Sam Lee", email: "sam@x.com" },
      ],
    });
    expect(p.statusCode).toBe(409);
    expect(rows.get(ID)!.parties[0].email).toBe("alex@x.com");
  });

  it("won't send a party's link to the person pressing Send in their place", async () => {
    const row = rows.get(ID)!;
    Object.assign(row, { status: "draft", sent_at: null });
    row.parties[1] = { ...row.parties[1], email: "r@x.com", status: "pending" };
    const r = await call("POST", { action: "send", id: ID });
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/your own address/);
    // The sender may be a party themself.
    row.parties[1] = { ...row.parties[1], name: "Robert W. Burton" };
    expect((await call("POST", { action: "send", id: ID })).statusCode).toBe(200);
  });

  it("names the entity, the accounts and the other versions on the request's page", async () => {
    const r = await call("GET", {}, { id: ID });
    expect(r.body.entityName).toBe("Northwind Holdings, LLC");
    expect(r.body.related).toEqual([]);
  });
});
