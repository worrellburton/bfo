import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanLines, mergeManifest, pickJudyVoice, propPrompt } from "../lib/game-assets";

/**
 * The game studio (api/game-assets.ts, lib/game-assets.ts): the pure parts,
 * then the endpoint against a fake setting store, a fake bucket and fake
 * providers (fetch is stubbed; no network).
 */

const settings = new Map<string, unknown>();
const uploads = new Map<string, number>();

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    currentUser: vi.fn(async (req: { headers?: Record<string, string> }) =>
      req.headers?.authorization === "Bearer x" ? { id: "u1", name: "Robert", email: "r@x.com", phone: null, role: "owner", status: "approved" } : null,
    ),
    sb: async (path: string, init: { method?: string; body?: any } = {}) => {
      if (!path.startsWith("brand_settings")) return [];
      if ((init.method ?? "GET") === "GET") {
        const m = /key=in\.\((.*)\)/.exec(decodeURIComponent(path));
        const keys = m ? m[1].split(",").map((k) => k.replace(/"/g, "")) : [];
        return keys.filter((k) => settings.has(k)).map((k) => ({ key: k, value: settings.get(k) }));
      }
      if (init.method === "POST") for (const row of init.body) settings.set(row.key, row.value);
      if (init.method === "DELETE") {
        const m = /key=eq\.([^&]+)/.exec(decodeURIComponent(path));
        if (m) settings.delete(m[1]);
      }
      return [];
    },
  };
});
vi.mock("../lib/storage.js", () => ({
  storageUpload: async (p: string, bytes: Uint8Array) => (uploads.set(p, bytes.length), p),
}));

const { default: handler } = await import("../api/game-assets");
const { default: cron } = await import("../api/cron/game-assets");

function mockRes() {
  const res: any = { statusCode: 200, body: null as any, headers: {} as Record<string, string> };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  res.setHeader = (k: string, v: string) => ((res.headers[k] = v), res);
  res.end = () => res;
  return res;
}

function call(method: "GET" | "POST", body: Record<string, unknown> = {}, query: Record<string, string> = {}, auth = true) {
  const res = mockRes();
  return handler({ method, body, query, headers: auth ? { authorization: "Bearer x" } : {} } as any, res).then(() => res);
}

const mp3 = new Uint8Array(2000);
let fetchLog: string[] = [];

beforeEach(() => {
  settings.clear();
  uploads.clear();
  fetchLog = [];
  process.env.ELEVENLABS_API_KEY = "test";
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string }) => {
      fetchLog.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/v1/shared-voices"))
        return new Response(JSON.stringify({ voices: [{ public_owner_id: "own1", voice_id: "shared1", name: "Dorothy", cloned_by_count: 900, free_users_allowed: true }] }), { status: 200 });
      if (url.includes("/v1/voices/add/")) return new Response(JSON.stringify({ voice_id: "added1" }), { status: 200 });
      if (url.endsWith("/v1/voices"))
        return new Response(
          JSON.stringify({
            voices: [
              { voice_id: "m1", name: "Brian", labels: { gender: "male", age: "old" } },
              { voice_id: "f1", name: "Alice", labels: { gender: "female", age: "young" } },
              { voice_id: "f2", name: "Grace", labels: { gender: "female", age: "old", description: "warm" } },
            ],
          }),
          { status: 200 },
        );
      if (url.includes("/text-to-speech/") || url.endsWith("/sound-generation")) return new Response(mp3, { status: 200, headers: { "Content-Type": "audio/mpeg" } });
      if (url.endsWith("/game/judy.json"))
        return new Response(
          JSON.stringify({
            greeting: { id: "greeting", text: "Oh. Hey, Sam." },
            rounds: [{ options: [{ judy: { id: "r1a", text: "A ticket." } }], core: { id: "r1", text: "So the machine." } }],
            final: { id: "final", text: "Here's a ticket." },
          }),
          { status: 200 },
        );
      return new Response("nope", { status: 404 });
    }),
  );
});

describe("pure parts", () => {
  it("picks the oldest-sounding woman for Judy", () => {
    expect(
      pickJudyVoice([
        { voice_id: "a", name: "Brian", labels: { gender: "male", age: "old" } },
        { voice_id: "b", name: "Alice", labels: { gender: "female", age: "young" } },
        { voice_id: "c", name: "Grace", labels: { gender: "female", age: "middle_aged" } },
        { voice_id: "d", name: "Dorothy", labels: { gender: "female", age: "old" } },
      ]),
    ).toEqual({ id: "d", name: "Dorothy" });
    expect(pickJudyVoice([{ voice_id: "only", name: "Only" }])).toEqual({ id: "only", name: "Only" });
    expect(pickJudyVoice([])).toBeNull();
  });
  it("lets what was made win over the static manifest", () => {
    const m = mergeManifest(
      { movie: "/x.mp4", voice: { r1: "/static.mp3" }, sounds: { door: null }, models: {} },
      { voice: { r1: "https://b/r1.mp3" }, sounds: { door: "https://b/door.mp3" }, models: { seat: "https://b/seat.glb" } },
    );
    expect(m.movie).toBe("/x.mp4");
    expect(m.voice.r1).toBe("https://b/r1.mp3");
    expect(m.sounds.door).toBe("https://b/door.mp3");
    expect(m.models.seat).toBe("https://b/seat.glb");
  });
  it("keeps only well-formed lines", () => {
    expect(cleanLines([{ id: "r1", text: " hi " }, { id: "bad id!", text: "x" }, { id: "r2", text: "" }, "junk"])).toEqual([{ id: "r1", text: "hi" }]);
    expect(cleanLines("nope")).toEqual([]);
  });
  it("styles every prop the same way", () => {
    expect(propPrompt("seat")).toMatch(/velvet.*Photorealistic/);
    expect(propPrompt("judy")).toMatch(/cardigan.*Photorealistic/);
  });
});

describe("api/game-assets", () => {
  it("tells anyone what's there, and nothing else", async () => {
    settings.set("game-assets", { voice: { r1: "https://b/r1.mp3" }, sounds: {}, models: {}, judyVoice: { id: "f2", name: "Grace" }, props: {} });
    const r = await call("GET", {}, {}, false);
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ voice: { r1: "https://b/r1.mp3" }, sounds: {}, models: {} });
    expect(r.headers["Cache-Control"]).toMatch(/s-maxage/);
  });

  it("voices Judy a few lines at a time with an older woman's voice", async () => {
    const lines = Array.from({ length: 6 }, (_, i) => ({ id: `l${i}`, text: `Line ${i}` }));
    const r1 = await call("POST", { action: "judy", lines });
    expect(r1.statusCode).toBe(200);
    expect(r1.body.remaining).toBe(2);
    expect(r1.body.assets.judyVoice).toEqual({ id: "f2", name: "Grace" });
    expect(Object.keys(r1.body.assets.voice)).toHaveLength(4);
    expect(r1.body.assets.voice.l0).toMatch(/^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/public\/brand\/game\/voice\/judy-l0-/);
    const r2 = await call("POST", { action: "judy", lines });
    expect(r2.body.remaining).toBe(0);
    expect(Object.keys(r2.body.assets.voice)).toHaveLength(6);
    // The voice was chosen once, and every clip went through ElevenLabs.
    expect(fetchLog.filter((l) => l.endsWith("/v1/voices"))).toHaveLength(1);
    expect(fetchLog.filter((l) => l.includes("/text-to-speech/f2"))).toHaveLength(6);
    expect(uploads.size).toBe(6);
  });

  it("adopts an older woman's voice from the shared library", async () => {
    const r = await call("POST", { action: "older-voice" });
    expect(r.statusCode).toBe(200);
    expect(r.body.voice).toEqual({ id: "added1", name: "Judy (Dorothy)" });
    expect(fetchLog.some((l) => l.includes("/v1/voices/add/own1/shared1"))).toBe(true);
  });

  it("lists the library and records Judy again in a chosen voice", async () => {
    const v = await call("POST", { action: "voices" });
    expect(v.statusCode).toBe(200);
    expect(v.body.voices.map((x: { name: string }) => x.name)).toEqual(["Brian", "Alice", "Grace"]);
    const lines = [{ id: "l0", text: "Hello" }];
    await call("POST", { action: "judy", lines });
    const r = await call("POST", { action: "judy", lines, voiceId: "f1" });
    expect(r.body.assets.judyVoice).toEqual({ id: "f1", name: "Alice" });
    expect(fetchLog.filter((l) => l.includes("/text-to-speech/f1"))).toHaveLength(1);
  });

  it("makes the sound effects in batches", async () => {
    const r1 = await call("POST", { action: "sounds" });
    expect(r1.body.remaining).toBe(4);
    const r2 = await call("POST", { action: "sounds" });
    expect(r2.body.remaining).toBe(1);
    const r3 = await call("POST", { action: "sounds" });
    expect(r3.body.remaining).toBe(0);
    expect(Object.keys(r3.body.assets.sounds).sort()).toEqual(["door", "fall", "jump", "land", "sign", "sit", "step"]);
  });

  it("says plainly when a key is missing", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const r = await call("POST", { action: "sounds" });
    expect(r.statusCode).toBe(503);
    expect(r.body.error).toBe("elevenlabs_failed");
  });

  it("refuses the studio to anyone not signed in as staff", async () => {
    delete process.env.GAME_JOB_TOKEN;
    const r = await call("GET", {}, { studio: "1" }, false);
    expect(r.statusCode).toBe(401);
    const r2 = await call("POST", { action: "prop", name: "throne" });
    expect(r2.statusCode).toBe(400);
  });

  it("lets the job token in, and nothing like it", async () => {
    const withAuth = async (authorization: string) => {
      const res = mockRes();
      await handler({ method: "GET", query: { studio: "1" }, headers: { authorization } } as any, res);
      return res;
    };
    process.env.GAME_JOB_TOKEN = "job-token-123";
    const ok = await withAuth("Bearer job-token-123");
    expect(ok.statusCode).toBe(200);
    expect(ok.body.configured.elevenlabs).toBe(true);
    expect((await withAuth("Bearer job-token-124")).statusCode).toBe(401);
    delete process.env.GAME_JOB_TOKEN;
    expect((await withAuth("Bearer job-token-123")).statusCode).toBe(401);
  });
});

describe("api/cron/game-assets", () => {
  function cronCall(auth: string | undefined) {
    const res: any = { statusCode: 200, body: null as any, headers: {} as Record<string, string> };
    res.status = (c: number) => ((res.statusCode = c), res);
    res.json = (b: unknown) => ((res.body = b), res);
    res.setHeader = (k: string, v: string) => ((res.headers[k] = v), res);
    res.end = () => res;
    return cron({ method: "GET", query: {}, headers: auth ? { authorization: auth } : {} } as any, res).then(() => res);
  }

  it("only the cron, with the secret", async () => {
    process.env.CRON_SECRET = "s3cret";
    expect((await cronCall(undefined)).statusCode).toBe(401);
    expect((await cronCall("Bearer wrong")).statusCode).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await cronCall("Bearer s3cret")).statusCode).toBe(503);
  });

  it("fills in Judy and the sounds, and says what it skipped", async () => {
    process.env.CRON_SECRET = "s3cret";
    delete process.env.OPENAI_API_KEY;
    delete process.env.MESHY_API_KEY;
    const r = await cronCall("Bearer s3cret");
    expect(r.statusCode).toBe(200);
    expect(r.body.voiced).toBe(4);
    expect(r.body.sounds).toBe(7);
    expect(r.body.skipped.join(" ")).toMatch(/OPENAI_API_KEY/);
    expect(r.body.errors).toEqual([]);
    // Nothing more to do: the next run makes nothing.
    const before = fetchLog.length;
    const r2 = await cronCall("Bearer s3cret");
    expect(r2.body.voiced).toBe(4);
    expect(fetchLog.slice(before).filter((l) => l.includes("text-to-speech") || l.includes("sound-generation"))).toHaveLength(0);
  });

  it("works the request list: Judy again with a chosen voice, one sound again", async () => {
    process.env.CRON_SECRET = "s3cret";
    await cronCall("Bearer s3cret");
    settings.set("game-assets-requests", { judy: { voiceId: "f1" }, sounds: { names: ["door"], text: { door: "A squeaky door" } } });
    const before = fetchLog.length;
    const r = await cronCall("Bearer s3cret");
    expect(r.body.voiced).toBe(4);
    expect(r.body.assets === undefined).toBe(true);
    const made = fetchLog.slice(before);
    expect(made.filter((l) => l.includes("/text-to-speech/f1"))).toHaveLength(4);
    expect(made.filter((l) => l.includes("sound-generation"))).toHaveLength(1);
    expect((settings.get("game-assets") as any).judyVoice).toEqual({ id: "f1", name: "Alice" });
    expect(settings.has("game-assets-requests")).toBe(false);
  });
});
