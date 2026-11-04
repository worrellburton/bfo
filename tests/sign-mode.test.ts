import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken, type SignatureRequestRow } from "../lib/sign";

/**
 * The signing mode on api/sign.ts: the office sets it while the request is
 * a draft, it's refused once sent, and the signer's page is told which it is.
 * The game is only for TallulahMD LLC's requests (lib/game-entity). The
 * database is one in-memory row and two entities; the office is signed in
 * as an owner.
 */

let row: SignatureRequestRow;
const token = "c".repeat(32);
/** The entities the tree answers with, by id. */
const assets: Record<string, string> = { tallulah: "TallulahMD LLC", other: "Ledger Louise, LLC" };
/** When true, reading the tree fails, as it would in an outage. */
let treeDown = false;

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    sendEmail: vi.fn(async () => {}),
    currentUser: vi.fn(async () => ({ id: "u1", name: "Robert", email: "r@x.com", phone: null, role: "owner", status: "approved" })),
    sb: async (path: string, init: { method?: string; body?: any } = {}) => {
      if (path.startsWith("tree_nodes")) {
        if (treeDown) throw new Error("supabase 503: unavailable");
        const wanted = decodeURIComponent(path);
        return Object.entries(assets)
          .filter(([id]) => wanted.includes(`"${id}"`))
          .map(([id, name]) => ({ collection: "assets", id, data: { name }, updated_at: "2026-11-01T00:00:00Z" }));
      }
      if (!path.startsWith("signature_requests")) return [];
      const method = init.method ?? "GET";
      if (method === "GET") return [structuredClone(row)];
      if (method === "POST") {
        row = { ...row, ...structuredClone(init.body), id: row.id, version: 0 };
        return [structuredClone(row)];
      }
      if (method === "PATCH") {
        const v = new URLSearchParams(path.split("?")[1]).get("version");
        if (v && `eq.${row.version}` !== v) return [];
        row = { ...row, ...structuredClone(init.body) };
        return [structuredClone(row)];
      }
      return [];
    },
  };
});
vi.mock("../lib/storage.js", () => ({
  storageDownload: async () => null,
  storageUpload: async (p: string) => p,
  storageRemove: async () => {},
  storageSignedUrl: async (p: string) => `https://storage.test/${p}`,
}));
vi.mock("../lib/push.js", () => ({ notifyAdmins: async () => 0 }));

const { default: handler } = await import("../api/sign");

function call(method: "GET" | "POST", body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
  const res: any = { statusCode: 200, body: null as any, headers: {} as Record<string, string> };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  res.setHeader = (k: string, v: string) => ((res.headers[k] = v), res);
  res.end = () => res;
  return handler({ method, body, query, headers: {} } as any, res).then(() => res);
}

beforeEach(() => {
  treeDown = false;
  row = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "MSA",
    status: "draft",
    source: "upload",
    asset_id: "tallulah",
    contract_id: null,
    created_by: "u1",
    created_by_name: "Robert",
    original_path: "signatures/x/original.pdf",
    current_path: "signatures/x/original.pdf",
    signed_path: null,
    pages: [{ w: 612, h: 792 }],
    fields: [{ id: "a", party: "a", type: "signature", page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.05 }],
    parties: [{ key: "a", role: "Client", name: "Ada", email: "a@x.com", status: "pending" }],
    events: [],
    created_at: "2026-11-02T10:00:00Z",
    sent_at: null,
    completed_at: null,
    copy_sent_at: null,
    brand: null,
    mode: "normal",
    version: 0,
  };
});

describe("signing mode", () => {
  it("is stored on create, and anything unknown is the plain page", async () => {
    const r = await call("POST", { action: "create", title: "Game MSA", mode: "game", assetId: "tallulah" });
    expect(r.statusCode).toBe(200);
    expect(r.body.request.mode).toBe("game");
    const r2 = await call("POST", { action: "create", title: "Odd", mode: "arcade" });
    expect(r2.body.request.mode).toBe("normal");
  });

  it("changes while a draft and not once sent", async () => {
    const r = await call("POST", { action: "update", id: row.id, mode: "game" });
    expect(r.statusCode).toBe(200);
    expect(row.mode).toBe("game");
    row.status = "sent";
    const r2 = await call("POST", { action: "update", id: row.id, mode: "normal" });
    expect(r2.statusCode).toBe(409);
    expect(row.mode).toBe("game");
    // Sending the same mode again is not a change.
    const r3 = await call("POST", { action: "update", id: row.id, mode: "game", title: "MSA 2" });
    expect(r3.statusCode).toBe(200);
  });

  it("tells the signer's page which mode it is, and 'normal' for rows from before the column", async () => {
    row.status = "sent";
    row.mode = "game";
    row.parties[0] = { ...row.parties[0], status: "sent", tokenHash: hashToken(token) };
    const r = await call("GET", {}, { token });
    expect(r.statusCode).toBe(200);
    expect(r.body.mode).toBe("game");
    delete (row as Partial<SignatureRequestRow>).mode;
    const r2 = await call("GET", {}, { token });
    expect(r2.body.mode).toBe("normal");
  });

  it("is only for TallulahMD LLC: any other entity, or none, can't have it", async () => {
    const r = await call("POST", { action: "create", title: "Game MSA", mode: "game", assetId: "other" });
    expect(r.statusCode).toBe(409);
    expect(r.body.error).toBe("game_not_for_entity");
    expect(r.body.message).toContain("TallulahMD LLC");
    const r2 = await call("POST", { action: "create", title: "Game MSA", mode: "game" });
    expect(r2.statusCode).toBe(409);
    row.asset_id = "other";
    const r3 = await call("POST", { action: "update", id: row.id, mode: "game" });
    expect(r3.statusCode).toBe(409);
    expect(row.mode).toBe("normal");
    row.asset_id = null;
    const r4 = await call("POST", { action: "update", id: row.id, mode: "game" });
    expect(r4.statusCode).toBe(409);
    expect(row.mode).toBe("normal");
    // The plain page is for everyone.
    const r5 = await call("POST", { action: "update", id: row.id, mode: "normal", title: "MSA 2" });
    expect(r5.statusCode).toBe(200);
    expect(row.title).toBe("MSA 2");
  });

  it("won't send another entity's request as the game, and its signer gets the plain page whatever the row says", async () => {
    row.asset_id = "other";
    row.mode = "game";
    const r = await call("POST", { action: "send", id: row.id });
    expect(r.statusCode).toBe(409);
    expect(r.body.error).toBe("game_not_for_entity");
    expect(row.status).toBe("draft");
    row.status = "sent";
    row.parties[0] = { ...row.parties[0], status: "sent", tokenHash: hashToken(token) };
    const r2 = await call("GET", {}, { token });
    expect(r2.statusCode).toBe(200);
    expect(r2.body.mode).toBe("normal");
  });

  it("tells the office page whether a draft may go out as the game", async () => {
    const r = await call("GET", {}, { id: row.id });
    expect(r.statusCode).toBe(200);
    expect(r.body.gameAllowed).toBe(true);
    row.asset_id = "other";
    expect((await call("GET", {}, { id: row.id })).body.gameAllowed).toBe(false);
    // Once sent, how they sign is settled: nothing to choose.
    row.asset_id = "tallulah";
    row.status = "sent";
    expect((await call("GET", {}, { id: row.id })).body.gameAllowed).toBe(false);
  });

  it("reminds another entity's game-mode signer about the plain page, not the theater", async () => {
    const { sendEmail } = await import("../lib/auth.js");
    row.asset_id = "other";
    row.mode = "game";
    row.status = "sent";
    row.parties[0] = { ...row.parties[0], status: "sent", tokenHash: hashToken(token) };
    const r = await call("POST", { action: "remind", id: row.id });
    expect(r.statusCode).toBe(200);
    const sent = vi.mocked(sendEmail).mock.calls.at(-1)!;
    expect(String(sent[2])).not.toMatch(/open the link on a computer/);
    expect(String(sent[3])).toContain("Review and sign");
    expect(String(sent[3])).not.toContain("Play and sign");
  });

  it("reminds as a normal request when asked, while the link still opens the game", async () => {
    const { sendEmail } = await import("../lib/auth.js");
    row.mode = "game";
    row.status = "sent";
    row.parties[0] = { ...row.parties[0], status: "sent", tokenHash: hashToken(token) };
    const r = await call("POST", { action: "remind", id: row.id, plain: true });
    expect(r.statusCode).toBe(200);
    const sent = vi.mocked(sendEmail).mock.calls.at(-1)!;
    const text = String(sent[2]);
    expect(text).toContain("Review and sign");
    expect(text).not.toMatch(/game|theater|film|open the link on a computer/i);
    expect(String(sent[3])).not.toContain("Play and sign");
    // The record says how it went out.
    expect(r.body.request.events.at(-1)).toMatchObject({ kind: "reminded", note: "as a normal request" });
    // The fresh link opens the game all the same.
    const fresh = text.match(/\/sign\/([A-Za-z0-9_-]+)/)![1];
    const view = await call("GET", {}, { token: fresh });
    expect(view.statusCode).toBe(200);
    expect(view.body.mode).toBe("game");
    // Without the flag, a reminder still says it's the game, and the record carries no note.
    const r2 = await call("POST", { action: "remind", id: row.id });
    expect(String(vi.mocked(sendEmail).mock.calls.at(-1)![3])).toContain("Play and sign");
    expect(r2.body.request.events.at(-1).kind).toBe("reminded");
    expect(r2.body.request.events.at(-1).note).toBeUndefined();
  });

  it("gives the signer the plain page, not an error, when the entity can't be read", async () => {
    row.mode = "game";
    row.status = "sent";
    row.parties[0] = { ...row.parties[0], status: "sent", tokenHash: hashToken(token) };
    treeDown = true;
    const r = await call("GET", {}, { token });
    expect(r.statusCode).toBe(200);
    expect(r.body.mode).toBe("normal");
    // The office page, too, is answered rather than failed.
    row.status = "draft";
    const r2 = await call("GET", {}, { id: row.id });
    expect(r2.statusCode).toBe(200);
    expect(r2.body.gameAllowed).toBe(false);
  });

  it("sends the game email when the mode is game", async () => {
    const { sendEmail } = await import("../lib/auth.js");
    row.mode = "game";
    const r = await call("POST", { action: "send", id: row.id });
    expect(r.statusCode).toBe(200);
    const sent = vi.mocked(sendEmail).mock.calls.at(-1)!;
    expect(String(sent[2])).toMatch(/open the link on a computer/);
    expect(String(sent[3])).toContain("Play and sign");
  });
});
