import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IMAGE_MODELS, LOGO_STYLES, logoPrompt, mergeTask, styleById } from "../lib/brand";

const { state, sbMock } = vi.hoisted(() => ({ state: { role: "owner" as string | null }, sbMock: vi.fn() }));
vi.mock("../lib/auth.js", () => ({
  currentUser: vi.fn(async () => (state.role ? { id: "u1", role: state.role } : null)),
  canWrite: (u: { role: string }) => u.role !== "viewer",
  isAdmin: (u: { role: string }) => u.role === "owner" || u.role === "admin",
  sb: sbMock,
}));
import handler from "../api/brand";

describe("logo styles", () => {
  it("has six, each a single object on a plain backdrop", () => {
    expect(LOGO_STYLES).toHaveLength(6);
    expect(new Set(LOGO_STYLES.map((s) => s.id)).size).toBe(6);
    const p = logoPrompt(LOGO_STYLES[0], "warmer");
    expect(p).toMatch(/B, F and O/);
    expect(p).toMatch(/studio backdrop/);
    expect(p).toMatch(/Adjustment: warmer\./);
    expect(styleById("chrome")?.name).toBe("Liquid chrome");
    expect(styleById("nope")).toBeNull();
    expect(IMAGE_MODELS[0]).toBe("gpt-image-2");
  });

  it("folds Meshy's task onto the saved model", () => {
    const prev = { taskId: "t", status: "PENDING" as const, progress: 0, createdAt: 1, updatedAt: 1 };
    expect(mergeTask(prev, { id: "t", status: "IN_PROGRESS", progress: 42 })).toMatchObject({ status: "IN_PROGRESS", progress: 42, error: null });
    expect(mergeTask(prev, { id: "t", status: "FAILED", task_error: { message: "bad input" } })).toMatchObject({ status: "FAILED", error: "bad input" });
    expect(mergeTask(prev, { id: "t", status: "SUCCEEDED" }).progress).toBe(100);
  });
});

describe("/api/brand", () => {
  const fetchMock = vi.fn();
  const reply = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, json: async () => body });
  function call(method: string, body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    const out: { status: number; json?: any; headers: Record<string, string> } = { status: 0, headers: {} };
    const res: any = {
      status(c: number) {
        out.status = c;
        return res;
      },
      json(j: unknown) {
        out.json = j;
        return res;
      },
      setHeader(k: string, v: string) {
        out.headers[k] = v;
      },
      end() {
        return res;
      },
    };
    return Promise.resolve(handler({ method, body, query, headers: {} } as any, res)).then(() => out);
  }
  const settings: Record<string, unknown> = {};
  beforeEach(() => {
    state.role = "owner";
    process.env.OPENAI_API_KEY = "sk-x";
    process.env.MESHY_API_KEY = "msy-x";
    process.env.SUPABASE_URL = "https://sb.test";
    process.env.SUPABASE_SERVICE_KEY = "svc";
    for (const k of Object.keys(settings)) delete settings[k];
    fetchMock.mockReset();
    sbMock.mockReset();
    // brand_settings in memory
    sbMock.mockImplementation(async (path: string, init?: { method?: string; body?: any }) => {
      if (path.startsWith("brand_settings?key=in.")) {
        const keys = decodeURIComponent(path.slice("brand_settings?key=in.(".length, path.indexOf(")"))).split(",").map((k) => k.replace(/"/g, ""));
        return keys.filter((k) => k in settings).map((k) => ({ key: k, value: settings[k] }));
      }
      if (path.startsWith("brand_settings?on_conflict")) {
        for (const row of init!.body) settings[row.key] = row.value;
        return null;
      }
      if (path.startsWith("brand_settings?key=eq.")) {
        delete settings[decodeURIComponent(path.slice("brand_settings?key=eq.".length))];
        return null;
      }
      throw new Error(`unexpected sb ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
    delete process.env.MESHY_API_KEY;
  });

  it("gives anyone the logo in use, cached, and only admins the studio", async () => {
    settings.logo = { styleId: "chrome", glbUrl: "https://sb.test/x.glb" };
    state.role = null;
    const r = await call("GET");
    expect(r.json.logo.styleId).toBe("chrome");
    expect(r.headers["Cache-Control"]).toMatch(/s-maxage/);
    expect((await call("GET", {}, { studio: "1" })).status).toBe(401);
    state.role = "member";
    expect((await call("GET", {}, { studio: "1" })).status).toBe(403);
    expect((await call("POST", { action: "generate", styleId: "chrome" })).status).toBe(403);
    state.role = "admin";
    const s = await call("GET", {}, { studio: "1" });
    expect(s.json.configured).toEqual({ openai: true, meshy: true });
    expect(s.json.styles).toHaveLength(6);
    expect(s.json.models.chrome).toBeNull();
  });

  it("draws a style with OpenAI, falling back to an older image model, and stores it", async () => {
    fetchMock
      .mockResolvedValueOnce(reply(404, { error: { message: "The model `gpt-image-2` does not exist or you do not have access to it." } }))
      .mockResolvedValueOnce(reply(200, { data: [{ b64_json: Buffer.from("png!").toString("base64") }] }))
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "" }); // storage upload
    settings[`model:glass`] = { taskId: "old", status: "SUCCEEDED" };
    const r = await call("POST", { action: "generate", styleId: "glass", tweak: "cooler" });
    expect(r.status).toBe(200);
    expect(r.json.entry.model).toBe("gpt-image-1.5");
    expect(r.json.entry.imageUrl).toMatch(/^https:\/\/sb\.test\/storage\/v1\/object\/public\/brand\/logo\/glass\/\d+\.png$/);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ model: "gpt-image-1.5", size: "1024x1024", quality: "high" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).prompt).toMatch(/Adjustment: cooler/);
    expect(fetchMock.mock.calls[2][0]).toMatch(/\/storage\/v1\/object\/brand\/logo\/glass\//);
    expect((settings.sheet as any).styles.glass.prompt).toMatch(/frosted glass/);
    expect(settings["model:glass"]).toBeUndefined(); // the old model no longer matches the new picture
  });

  it("builds the model with Meshy and copies the result in once it succeeds", async () => {
    expect((await call("POST", { action: "model", styleId: "signet" })).status).toBe(409);
    settings.sheet = { styles: { signet: { imageUrl: "https://sb.test/storage/v1/object/public/brand/logo/signet/1.png", imagePath: "logo/signet/1.png", prompt: "", model: "gpt-image-2", createdAt: 1 } }, generatedAt: 1 };
    fetchMock.mockResolvedValueOnce(reply(202, { result: "task_1" }));
    const started = await call("POST", { action: "model", styleId: "signet" });
    expect(started.json.model).toMatchObject({ taskId: "task_1", status: "PENDING" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.meshy.ai/openapi/v1/image-to-3d");
    expect(JSON.parse(init.body)).toMatchObject({ image_url: expect.stringContaining("/signet/1.png"), should_texture: true, enable_pbr: true, target_formats: ["glb", "usdz"] });

    fetchMock.mockResolvedValueOnce(reply(200, { id: "task_1", status: "IN_PROGRESS", progress: 55 }));
    expect((await call("POST", { action: "model-status", styleId: "signet" })).json.model).toMatchObject({ status: "IN_PROGRESS", progress: 55 });

    fetchMock
      .mockResolvedValueOnce(reply(200, { id: "task_1", status: "SUCCEEDED", progress: 100, model_urls: { glb: "https://assets.meshy.ai/x.glb", usdz: "https://assets.meshy.ai/x.usdz" }, alpha_thumbnail_url: "https://assets.meshy.ai/x.png" }))
      .mockResolvedValueOnce(reply(200, {})) // glb download
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "" }) // glb upload
      .mockResolvedValueOnce(reply(200, {})) // usdz download
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "" })
      .mockResolvedValueOnce(reply(200, {})) // poster download
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "" });
    const done = await call("POST", { action: "model-status", styleId: "signet" });
    expect(done.json.model.status).toBe("SUCCEEDED");
    expect(done.json.model.glbUrl).toMatch(/\/brand\/logo\/signet\/\d+\.glb$/);
    expect(done.json.model.posterUrl).toMatch(/-poster\.png$/);
    // a finished model isn't asked about again
    const calls = fetchMock.mock.calls.length;
    expect((await call("POST", { action: "model-status", styleId: "signet" })).json.model.status).toBe("SUCCEEDED");
    expect(fetchMock.mock.calls.length).toBe(calls);

    // and it can go on the site, then come off
    const used = await call("POST", { action: "use", styleId: "signet" });
    expect(used.json.logo).toMatchObject({ styleId: "signet", glbUrl: done.json.model.glbUrl });
    expect((await call("GET")).json.logo.styleId).toBe("signet");
    expect((await call("POST", { action: "use", styleId: null })).json.logo).toBeNull();
    expect(settings.logo).toBeUndefined();
  });

  it("says when a key is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await call("POST", { action: "generate", styleId: "cube" });
    expect(r.status).toBe(503);
    expect(r.json.error).toBe("openai");
  });
});
