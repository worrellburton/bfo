import { beforeEach, describe, expect, it, vi } from "vitest";
import { deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { ESIGN_DISCLOSURE_VERSION, hashToken, type SignatureRequestRow } from "../lib/sign";

/**
 * Sending a finished request again (api/sign.ts "resend"), the address box a
 * signer fills in, and the racetrack mode. The database is a map of rows by
 * id with PostgREST's shape (insert, read by id or by a party's token hash,
 * patch at a version), the bucket a map of files, and the tree two entities.
 */

const rows = new Map<string, SignatureRequestRow>();
const files = new Map<string, Uint8Array>();
let inserted = 0;
const assets: Record<string, string> = { tallulah: "TallulahMD LLC", other: "Ledger Louise, LLC" };
const tokenA = "a".repeat(32);
const tokenB = "b".repeat(32);

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    sendEmail: vi.fn(async () => {}),
    currentUser: async () => ({ id: "u1", name: "Robert", role: "owner", status: "approved", email: "r@x.com" }),
    sb: async (path: string, init: { method?: string; body?: any } = {}) => {
      const method = init.method ?? "GET";
      if (path.startsWith("tree_nodes")) {
        const wanted = decodeURIComponent(path);
        return Object.entries(assets)
          .filter(([id]) => wanted.includes(`"${id}"`))
          .map(([id, name]) => ({ collection: "assets", id, data: { name }, updated_at: "2026-11-01T00:00:00Z" }));
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
      if (method === "POST") {
        const id = `22222222-2222-4222-8222-22222222222${++inserted}`;
        const made: SignatureRequestRow = {
          id,
          title: "",
          status: "draft",
          source: "upload",
          asset_id: null,
          contract_id: null,
          created_by: null,
          created_by_name: null,
          original_path: null,
          current_path: null,
          signed_path: null,
          pages: [],
          fields: [],
          parties: [],
          events: [],
          created_at: "2026-11-04T10:00:00Z",
          sent_at: null,
          completed_at: null,
          copy_sent_at: null,
          brand: null,
          mode: "normal",
          version: 0,
          ...structuredClone(init.body),
        };
        rows.set(id, made);
        return [structuredClone(made)];
      }
      if (method === "PATCH" && byId) {
        const r = rows.get(byId);
        if (!r) return [];
        const v = qs.get("version");
        if (v && `eq.${r.version}` !== v) return [];
        const next = { ...r, ...structuredClone(init.body), version: (r.version ?? 0) + 1 };
        rows.set(byId, next);
        return [structuredClone(next)];
      }
      return [];
    },
  };
});
vi.mock("../lib/storage.js", () => ({
  storageDownload: async (p: string) => files.get(p) ?? null,
  storageUpload: async (p: string, bytes: Uint8Array) => (files.set(p, bytes), p),
  storageRemove: async (p: string) => void files.delete(p),
  storageSignedUrl: async (p: string) => `https://storage.test/${p}`,
}));
vi.mock("../lib/push.js", () => ({ notifyAdmins: async () => 0 }));

const { default: handler } = await import("../api/sign");

/** A tiny PNG (a dark line), as a signature pad would hand it over. */
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
  const w = 60;
  const h = 20;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (y > 8 && y < 12) raw.writeUInt32BE(0x101018ff, y * (w * 4 + 1) + 1 + x * 4);
  const out = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${out.toString("base64")}`;
})();

function call(method: "GET" | "POST", body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
  const res: any = { statusCode: 200, body: null as any, headers: {} as Record<string, string> };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  res.setHeader = (k: string, v: string) => ((res.headers[k] = v), res);
  res.end = () => res;
  return handler({ method, body, query, headers: { "x-real-ip": "10.0.0.1" } } as any, res).then(() => res);
}

const OLD = "11111111-1111-4111-8111-111111111111";

beforeEach(async () => {
  rows.clear();
  files.clear();
  inserted = 0;
  vi.mocked((await import("../lib/auth.js")).sendEmail).mockClear();
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  files.set("signatures/x/original.pdf", await doc.save());
  files.set("signatures/x/signed.pdf", await doc.save());
  rows.set(OLD, {
    id: OLD,
    title: "Operating Agreement - TallulahMD LLC",
    status: "completed",
    source: "upload",
    asset_id: "tallulah",
    contract_id: null,
    created_by: "u1",
    created_by_name: "Robert",
    original_path: "signatures/x/original.pdf",
    current_path: "signatures/x/signed.pdf",
    signed_path: "signatures/x/signed.pdf",
    pages: [{ w: 612, h: 792 }],
    fields: [
      { id: "fa", party: "a", type: "signature", page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.05 },
      { id: "fb", party: "b", type: "signature", page: 1, x: 0.55, y: 0.8, w: 0.3, h: 0.05 },
      { id: "fd", party: "b", type: "date", page: 1, x: 0.55, y: 0.9, w: 0.2, h: 0.03 },
    ],
    parties: [
      { key: "a", role: "Manager", name: "Robert W. Burton", email: "r@x.com", status: "signed", signedAt: "2026-11-03T02:10:00Z" },
      { key: "b", role: "Member", name: "Sameh Elguizaoui", email: "sam@x.com", status: "signed", signedAt: "2026-11-04T01:00:00Z" },
    ],
    events: [],
    created_at: "2026-11-03T01:59:00Z",
    sent_at: "2026-11-03T02:00:00Z",
    completed_at: "2026-11-04T01:00:00Z",
    copy_sent_at: null,
    brand: null,
    mode: "game",
    version: 3,
  });
});

describe("resend", () => {
  it("sends a finished request again as a new one, with an address box under each signature, as the racetrack, with a plain email", async () => {
    const { sendEmail } = await import("../lib/auth.js");
    // A signed agreement goes out again only with a reason; the address boxes are asked for by party.
    expect((await call("POST", { action: "resend", id: OLD, mode: "race", plain: true })).body.error).toBe("reason");
    const r = await call("POST", { action: "resend", id: OLD, mode: "race", plain: true, address: ["a", "b"], reason: "Both addresses were missing" });
    expect(r.statusCode).toBe(200);
    const made = r.body.request;
    // The two records point at each other.
    expect(made.replaces).toBe(OLD);
    expect(rows.get(OLD)!.replaced_by).toBe(made.id);
    expect(rows.get(OLD)!.events.at(-1)!.note).toContain("Both addresses were missing");
    expect(made.id).not.toBe(OLD);
    expect(made).toMatchObject({ title: "Operating Agreement - TallulahMD LLC", status: "sent", mode: "race", asset_id: "tallulah" });
    // The same document, copied under the new request; the old one and its signed copy untouched.
    expect(made.original_path).toMatch(new RegExp(`^signatures/${made.id}/upload-`));
    expect(files.get(made.original_path)).toEqual(files.get("signatures/x/original.pdf"));
    expect(rows.get(OLD)).toMatchObject({ status: "completed", signed_path: "signatures/x/signed.pdf" });
    expect(rows.get(OLD)!.events.at(-1)).toMatchObject({ kind: "resent" });
    // An Address box under each signature, the other fields as they were.
    const addr = made.fields.filter((f: { type: string }) => f.type === "address");
    expect(addr.map((f: { party: string }) => f.party).sort()).toEqual(["a", "b"]);
    const sam = addr.find((f: { party: string }) => f.party === "b");
    expect(sam).toMatchObject({ page: 1, x: 0.55, w: 0.3 });
    expect(sam.y).toBeGreaterThan(0.85);
    expect(made.fields).toHaveLength(5);
    // Both parties start over, each with a fresh link; the office never sees a token hash.
    expect(made.parties.map((p: { status: string }) => p.status)).toEqual(["sent", "sent"]);
    expect(JSON.stringify(made)).not.toContain("tokenHash");
    expect(rows.get(made.id)!.parties.every((p) => p.tokenHash)).toBe(true);
    // Two emails, worded as a normal request: nothing about a race or a game.
    const mails = vi.mocked(sendEmail).mock.calls;
    expect(mails).toHaveLength(2);
    for (const m of mails) {
      expect(String(m[2])).toContain("Review and sign");
      expect(String(m[2])).not.toMatch(/race|game|track|theater|open the link on a computer/i);
    }
    expect(
      rows
        .get(made.id)!
        .events.filter((e) => e.kind === "emailed")
        .every((e) => e.note === "as a normal request"),
    ).toBe(true);
  });

  it("says what the race is in the email unless asked not to, and the signer's page opens the race", async () => {
    const { sendEmail } = await import("../lib/auth.js");
    const r = await call("POST", { action: "resend", id: OLD, mode: "race", address: ["b"], reason: "Sam's address" });
    expect(r.statusCode).toBe(200);
    expect(r.body.request.fields.filter((f: { type: string }) => f.type === "address").map((f: { party: string }) => f.party)).toEqual(["b"]);
    const text = String(vi.mocked(sendEmail).mock.calls.at(-1)![2]);
    expect(text).toContain("two laps");
    expect(text).toContain("sign straight away");
    // The signer's link opens the race (the fake can't know the token, so the hash is looked up from the row).
    const made = rows.get(r.body.request.id)!;
    const fresh = "f".repeat(32);
    made.parties[1].tokenHash = hashToken(fresh);
    const view = await call("GET", {}, { token: fresh });
    expect(view.statusCode).toBe(200);
    expect(view.body.mode).toBe("race");
    expect(view.body.fields.some((f: { type: string; party: string }) => f.type === "address" && f.party === "b")).toBe(true);
  });

  it("resends a pending request too, voiding it so only the new links work", async () => {
    const old = rows.get(OLD)!;
    old.status = "partial";
    old.signed_path = null;
    old.parties = [
      { key: "a", role: "Manager", name: "Robert W. Burton", email: "r@x.com", status: "signed", tokenHash: hashToken(tokenA) },
      { key: "b", role: "Member", name: "Sameh Elguizaoui", email: "sam@x.com", status: "viewed", tokenHash: hashToken(tokenB) },
    ];
    // A pending one needs no reason: it is voided and replaced.
    const r = await call("POST", { action: "resend", id: OLD, mode: "race", plain: true });
    expect(r.statusCode).toBe(200);
    expect(r.body.request.status).toBe("sent");
    const after = rows.get(OLD)!;
    expect(after.status).toBe("voided");
    expect(after.events.map((e) => e.kind)).toEqual(["resent", "voided"]);
    // Sam's old link no longer signs anything; it tells him the request was replaced.
    const view = await call("GET", {}, { token: tokenB });
    expect(view.statusCode).toBe(200);
    expect(view.body).toMatchObject({ status: "voided", replaced: true });
    expect(view.body.pdfUrl).toBeUndefined();
    const sign = await call("POST", { action: "sign", token: tokenB, name: "Sameh Elguizaoui", signature: png, consent: true, consentVersion: ESIGN_DISCLOSURE_VERSION });
    expect(sign.statusCode).toBe(409);
  });

  it("refuses a resend of a draft, and a game for another entity", async () => {
    rows.get(OLD)!.status = "draft";
    expect((await call("POST", { action: "resend", id: OLD, mode: "race" })).statusCode).toBe(409);
    rows.get(OLD)!.status = "completed";
    rows.get(OLD)!.asset_id = "other";
    const r = await call("POST", { action: "resend", id: OLD, mode: "race" });
    expect(r.statusCode).toBe(409);
    expect(r.body.error).toBe("game_not_for_entity");
    // The plain page is fine for anyone.
    expect((await call("POST", { action: "resend", id: OLD, mode: "normal", reason: "A fresh copy" })).statusCode).toBe(200);
  });
});

describe("the address box", () => {
  it("insists on an address when the signer has a box for one, and stamps it with their signature", async () => {
    const old = rows.get(OLD)!;
    old.status = "sent";
    old.signed_path = null;
    old.current_path = "signatures/x/original.pdf";
    old.fields.push({ id: "fx", party: "b", type: "address", page: 1, x: 0.55, y: 0.86, w: 0.3, h: 0.05 });
    old.parties = [
      { key: "a", role: "Manager", name: "Robert W. Burton", email: "r@x.com", status: "sent", tokenHash: hashToken(tokenA) },
      { key: "b", role: "Member", name: "Sameh Elguizaoui", email: "sam@x.com", status: "sent", tokenHash: hashToken(tokenB) },
    ];
    const without = await call("POST", { action: "sign", token: tokenB, name: "Sameh Elguizaoui", signature: png, consent: true, consentVersion: ESIGN_DISCLOSURE_VERSION });
    expect(without.statusCode).toBe(400);
    expect(without.body.error).toBe("address");
    const r = await call("POST", {
      action: "sign",
      token: tokenB,
      name: "Sameh Elguizaoui",
      signature: png,
      address: "12 Palm Court, Apt 4, Hesperia, CA 92345",
      consent: true,
      consentVersion: ESIGN_DISCLOSURE_VERSION,
    });
    expect(r.statusCode).toBe(200);
    const after = rows.get(OLD)!;
    expect(after.parties[1]).toMatchObject({ status: "signed", address: "12 Palm Court, Apt 4, Hesperia, CA 92345" });
    // The stamped copy is a new file that carries text (the address and the date) and the signature image.
    const stamped = files.get(after.current_path!)!;
    expect(stamped).toBeDefined();
    expect(stamped.byteLength).toBeGreaterThan(files.get("signatures/x/original.pdf")!.byteLength);
    const doc = await PDFDocument.load(stamped);
    expect(doc.getPageCount()).toBe(1);
    // Robert, with no address box, signs without one.
    const a = await call("POST", { action: "sign", token: tokenA, name: "Robert W. Burton", signature: png, consent: true, consentVersion: ESIGN_DISCLOSURE_VERSION });
    expect(a.statusCode).toBe(200);
    expect(rows.get(OLD)!.status).toBe("completed");
  });
});
