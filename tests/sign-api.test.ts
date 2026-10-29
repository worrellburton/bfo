import { beforeEach, describe, expect, it, vi } from "vitest";
import { deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { hashToken, type SignatureRequestRow } from "../lib/sign";

/**
 * api/sign.ts against a fake signature_requests row and a fake bucket. The
 * PATCH honours `version=eq.N` the way PostgREST does: it applies only if the
 * row is still at that version when it's written, and returns what it changed.
 * Reads are held until every racing request has read, so each starts from the
 * same version: the case that used to lose a signature.
 */

let row: SignatureRequestRow;
const files = new Map<string, Uint8Array>();
let readsWaiting: Array<() => void> = [];
let readsExpected = 1;
/** How many reads to hold in lockstep (in groups of readsExpected) before letting reads straight through. */
let gated = 0;

const tokenA = "a".repeat(32);
const tokenB = "b".repeat(32);

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    sendEmail: vi.fn(async () => {}),
    sb: async (path: string, init: { method?: string; body?: any } = {}) => {
      const method = init.method ?? "GET";
      if (!path.startsWith("signature_requests")) return [];
      const qs = new URLSearchParams(path.split("?")[1]);
      if (method === "GET") {
        if (gated > 0) {
          gated--;
          await new Promise<void>((resolve) => {
            readsWaiting.push(resolve);
            if (readsWaiting.length >= readsExpected) {
              for (const r of readsWaiting) r();
              readsWaiting = [];
            }
          });
        }
        const cs = qs.get("parties");
        if (cs) {
          const want = JSON.parse(decodeURIComponent(cs.slice(3)))[0].tokenHash;
          return row.parties.some((p) => p.tokenHash === want) ? [structuredClone(row)] : [];
        }
        return [structuredClone(row)];
      }
      if (method === "PATCH") {
        const v = qs.get("version");
        if (v && `eq.${row.version}` !== v) return [];
        row = { ...row, ...structuredClone(init.body) };
        return [structuredClone(row)];
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

// A real 60×20 PNG (RGBA, a dark band), comfortably past the endpoint's 100-byte floor.
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

function call(body: Record<string, unknown>) {
  const res: any = { statusCode: 200, body: null as any, headers: {} as Record<string, string> };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  res.setHeader = (k: string, v: string) => ((res.headers[k] = v), res);
  res.end = () => res;
  const req: any = { method: "POST", body, query: {}, headers: { "x-real-ip": "10.0.0.1" } };
  return handler(req, res).then(() => res);
}

beforeEach(async () => {
  files.clear();
  readsWaiting = [];
  readsExpected = 1;
  gated = 0;
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  files.set("signatures/x/original.pdf", await doc.save());
  row = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "MSA",
    status: "sent",
    source: "upload",
    asset_id: null,
    contract_id: null,
    created_by: "u1",
    created_by_name: "Robert",
    original_path: "signatures/x/original.pdf",
    current_path: "signatures/x/original.pdf",
    signed_path: null,
    pages: [{ w: 612, h: 792 }],
    fields: [
      { id: "a", party: "a", type: "signature", page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.05 },
      { id: "b", party: "b", type: "signature", page: 1, x: 0.6, y: 0.8, w: 0.3, h: 0.05 },
    ],
    parties: [
      { key: "a", role: "Manager", name: "Robert", email: "r@x.com", status: "sent", tokenHash: hashToken(tokenA) },
      { key: "b", role: "Client", name: "Łukasz", email: "l@x.com", status: "sent", tokenHash: hashToken(tokenB) },
    ],
    events: [],
    created_at: "2026-10-29T10:00:00Z",
    sent_at: "2026-10-29T10:00:00Z",
    completed_at: null,
    copy_sent_at: null,
    brand: null,
    version: 0,
  };
});

describe("signing", () => {
  it("keeps both signatures when both parties sign at the same moment", async () => {
    readsExpected = 2;
    gated = 4;
    const [ra, rb] = await Promise.all([
      call({ action: "sign", token: tokenA, name: "Robert", signature: png, consent: true }),
      call({ action: "sign", token: tokenB, name: "Łukasz Ğül", signature: png, consent: true }),
    ]);
    expect([ra.statusCode, rb.statusCode]).toEqual([200, 200]);
    expect(row.parties.map((p) => p.status)).toEqual(["signed", "signed"]);
    expect(row.status).toBe("completed");
    expect(row.signed_path).toMatch(/^signatures\/.+\/signed-/);
    // The loser's first attempt was removed and retried on the winner's copy: what's left is the
    // original, the first signer's copy, the second signer's copy on top of it, and the signed copy.
    expect(files.has(row.current_path!)).toBe(true);
    expect(files.has(row.signed_path!)).toBe(true);
    expect(files.size).toBe(4);
    expect(row.events.filter((e) => e.kind === "signed")).toHaveLength(2);
  });

  it("refuses a second signature from the same party", async () => {
    readsExpected = 2;
    gated = 4;
    const [r1, r2] = await Promise.all([
      call({ action: "sign", token: tokenA, name: "Robert", signature: png, consent: true }),
      call({ action: "sign", token: tokenA, name: "Robert", signature: png, consent: true }),
    ]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
    expect(row.events.filter((e) => e.kind === "signed")).toHaveLength(1);
    expect(row.status).toBe("partial");
  });

  it("doesn't undo a signature when the other party opens the page at the same moment", async () => {
    // The page's one read and the signer's stamping read start from the same version.
    readsExpected = 2;
    gated = 2;
    const view: any = { statusCode: 200, setHeader: () => view, status: (c: number) => ((view.statusCode = c), view), json: (b: unknown) => ((view.body = b), view), end: () => view };
    await Promise.all([
      call({ action: "sign", token: tokenA, name: "Robert", signature: png, consent: true }),
      handler({ method: "GET", query: { token: tokenB }, headers: {} } as any, view),
    ]);
    expect(row.parties[0].status).toBe("signed");
  });
});
