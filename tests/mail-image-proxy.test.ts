import { beforeEach, describe, expect, it, vi } from "vitest";

// The mail image proxy fetches what a sender's <img> points at: it must stay
// on the public internet, through DNS, through every redirect, and on the
// address it checked even if the name resolves differently a moment later.

import { PassThrough } from "node:stream";

const dns: Record<string, string[]> = {};
vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) => {
    const found = dns[host];
    if (!found) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    return found.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  },
}));

/** Each request: the URL asked for and the address it would connect to. */
const fetched: string[] = [];
const connectedTo: string[] = [];
function fakeRequest(url: URL, opts: { lookup: (h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) => void }, onResponse: (res: unknown) => void) {
  const u = url.href;
  fetched.push(u);
  opts.lookup(url.hostname, {}, (_err: unknown, address: unknown) => connectedTo.push(String(address)));
  const reply = (status: number, headers: Record<string, string>, body?: Uint8Array) => {
    const res = Object.assign(new PassThrough(), { statusCode: status, headers });
    queueMicrotask(() => {
      onResponse(res);
      res.end(body ? Buffer.from(body) : undefined);
    });
  };
  if (u === "https://sender.example/inside.png") reply(302, { location: "http://127.0.0.1:9123/admin.png" });
  else if (u === "https://sender.example/hop.png") reply(302, { location: "https://cdn.example/a.png" });
  else if (u === "https://sender.example/rebound.png") reply(302, { location: "http://127.0.0.1.nip.io/x.png" });
  else if (u === "https://sender.example/loop.png") reply(302, { location: "/loop.png" });
  else reply(200, { "content-type": "image/png" }, new Uint8Array([1, 2, 3]));
  return { on: () => undefined, end: () => undefined };
}
vi.mock("node:https", () => ({ request: fakeRequest }));
vi.mock("node:http", () => ({ request: fakeRequest }));

import handler from "../api/mail-image";
import { publicAddress, signImageUrl } from "../lib/mail-image";

describe("publicAddress", () => {
  it("accepts public addresses", () => {
    for (const a of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8"]) expect(publicAddress(a)).toBe(true);
  });
  it("refuses loopback, private, link-local, CGNAT and reserved addresses", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fc00::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "999.1.1.1"]) {
      expect(publicAddress(a)).toBe(false);
    }
  });
});

describe("/api/mail-image", () => {
  beforeEach(() => {
    process.env.MAIL_IMAGE_SECRET = "test-secret";
    fetched.length = 0;
    for (const k of Object.keys(dns)) delete dns[k];
    Object.assign(dns, { "sender.example": ["93.184.216.34"], "cdn.example": ["93.184.216.35"], "127.0.0.1.nip.io": ["127.0.0.1"], "twofaced.example": ["93.184.216.36", "10.0.0.5"] });
    connectedTo.length = 0;
  });

  async function get(u: string) {
    const out: { status: number; headers: Record<string, string> } = { status: 0, headers: {} };
    const res: any = {
      status: (c: number) => ((out.status = c), res),
      setHeader: (k: string, v: string) => ((out.headers[k] = v), res),
      end: () => res,
      send: () => res,
    };
    await handler({ method: "GET", query: { u, s: signImageUrl(u) } } as any, res);
    return out;
  }

  it("fetches a public picture, following a redirect to another public host", async () => {
    expect((await get("https://sender.example/hop.png")).status).toBe(200);
    expect(fetched).toEqual(["https://sender.example/hop.png", "https://cdn.example/a.png"]);
  });

  it("connects to the address it checked, not to a later DNS answer", async () => {
    expect((await get("https://sender.example/pic.png")).status).toBe(200);
    expect(connectedTo).toEqual(["93.184.216.34"]);
  });

  it("refuses a hostname that resolves to an internal address", async () => {
    expect((await get("http://127.0.0.1.nip.io/x.png")).status).toBe(502);
    expect((await get("https://twofaced.example/x.png")).status).toBe(502);
    expect(fetched).toEqual([]);
  });

  it("refuses a redirect to a bare address, an odd port or an internal name", async () => {
    expect((await get("https://sender.example/inside.png")).status).toBe(502);
    expect((await get("https://sender.example/rebound.png")).status).toBe(502);
    expect(fetched).toEqual(["https://sender.example/inside.png", "https://sender.example/rebound.png"]);
  });

  it("stops after three redirects", async () => {
    expect((await get("https://sender.example/loop.png")).status).toBe(502);
    expect(fetched).toHaveLength(4);
  });
});
