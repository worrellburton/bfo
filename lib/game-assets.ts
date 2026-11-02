/**
 * The signing game's generated assets (app/sign/game): Judy's voice, the
 * sound effects and the 3D props. They are made on the server, where the
 * API keys live, and stored in the public "brand" bucket under game/…; what's
 * there is kept in brand_settings under "game-assets" and handed to the game
 * by api/game-assets.ts, where it wins over public/game/manifest.json.
 *
 * Pure parts (the lists, the voice choice, the merge) are here for tests;
 * the calls to ElevenLabs, OpenAI and Meshy are thin and marked.
 *
 * Env: ELEVENLABS_API_KEY (Judy and the effects), OPENAI_API_KEY and
 * MESHY_API_KEY (the props; the same keys the logo studio uses, lib/brand.ts),
 * SUPABASE_URL and SUPABASE_SERVICE_KEY (the bucket and the setting).
 */
import { BRAND_BUCKET, copyIn, generateImage, getTask, mergeTask, publicUrl, readSettings, startModel, writeSetting, type ModelState } from "./brand.js";
import { storageUpload } from "./storage.js";

export const SETTING = "game-assets";

/** What's been made so far: each map is name → public URL. */
export type GameAssets = {
  voice: Record<string, string>;
  sounds: Record<string, string>;
  models: Record<string, string>;
  /** The ElevenLabs voice Judy speaks with. */
  judyVoice: { id: string; name: string } | null;
  /** Meshy's progress on each prop. */
  props: Record<string, ModelState & { imageUrl?: string }>;
  updatedAt: number;
};

export const EMPTY_ASSETS: GameAssets = { voice: {}, sounds: {}, models: {}, judyVoice: null, props: {}, updatedAt: 0 };

/** The sound effects: what to ask ElevenLabs for and how long each should be. */
export const EFFECTS: Record<string, { text: string; seconds: number }> = {
  door: { text: "A heavy old wooden theater door creaking slowly open, echoing in a quiet hall, then a soft wooden knock as it settles", seconds: 3.5 },
  sit: { text: "Someone sitting down into a plush velvet cinema seat, a soft cushioned thump and a faint creak of the seat frame", seconds: 1.5 },
  sign: { text: "A fountain pen signing a signature on paper on a wooden desk, quick confident scribble, then the pen set down", seconds: 2.5 },
  jump: { text: "A short, light, cartoon video game jump hop sound, soft and bouncy, like a blocky character leaping", seconds: 0.8 },
  land: { text: "A soft thud of a character landing on a wooden block in a video game, light and quick", seconds: 0.7 },
  fall: { text: "A quick descending whoosh of falling into a dark pit in a video game, ending in a low soft puff", seconds: 1.8 },
};

/** The props: what OpenAI draws, which Meshy then turns into a model. */
export const PROPS: Record<string, string> = {
  seat: "A single plush red velvet movie theater seat with a folding cushion, dark wooden armrests and a gold seat-number plate.",
  plant: "A tall potted palm plant in a terracotta pot.",
  popcorn: "A classic red and gold movie theater popcorn cart with a glass case full of popcorn and a striped roof.",
};

const PROP_STYLE =
  "Rendered as a single clean 3D object in a chunky, blocky, Minecraft-like low-poly voxel style with flat colours and crisp edges, " +
  "seen from a three-quarter front view, centered, filling most of the frame, on a plain pure white background, soft even lighting, no shadows on the ground, no text, no people, nothing else in the picture.";

export const propPrompt = (name: string) => `${PROPS[name]} ${PROP_STYLE}`;

export type Voice = { voice_id: string; name: string; labels?: Record<string, string | undefined> };

/** Judy is an older woman: the library voice whose labels say so best, a middle-aged woman failing that. */
export function pickJudyVoice(voices: Voice[]): { id: string; name: string } | null {
  const female = voices.filter((v) => /female/i.test(v.labels?.gender ?? ""));
  const score = (v: Voice) => {
    const age = (v.labels?.age ?? "").toLowerCase();
    const desc = `${v.labels?.description ?? ""} ${v.labels?.accent ?? ""} ${v.labels?.use_case ?? ""} ${v.name}`.toLowerCase();
    return (age.includes("old") ? 4 : age.includes("middle") ? 2 : 0) + (/mature|warm|grand|older|elder|narrat/.test(desc) ? 1 : 0);
  };
  const best = [...female].sort((a, b) => score(b) - score(a))[0] ?? voices[0];
  return best ? { id: best.voice_id, name: best.name } : null;
}

/** What the game should use: the static manifest, with anything generated on top. */
export function mergeManifest<T extends { voice?: Record<string, string | null | undefined>; sounds?: Record<string, string | null | undefined>; models?: Record<string, string | undefined> }>(
  base: T,
  assets: Pick<GameAssets, "voice" | "sounds" | "models">,
): T & { voice: Record<string, string | null | undefined>; sounds: Record<string, string | null | undefined>; models: Record<string, string | undefined> } {
  return {
    ...base,
    voice: { ...(base.voice ?? {}), ...assets.voice },
    sounds: { ...(base.sounds ?? {}), ...assets.sounds },
    models: { ...(base.models ?? {}), ...assets.models },
  };
}

/** Judy's lines as the studio sends them: ids and text, bounded. */
export function cleanLines(raw: unknown): Array<{ id: string; text: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string; text: string }> = [];
  for (const l of raw.slice(0, 24)) {
    if (!l || typeof l !== "object") continue;
    const { id, text } = l as Record<string, unknown>;
    if (typeof id !== "string" || !/^[a-z0-9_-]{1,24}$/i.test(id) || typeof text !== "string" || !text.trim()) continue;
    out.push({ id, text: text.trim().slice(0, 1500) });
  }
  return out;
}

export async function readAssets(): Promise<GameAssets> {
  const got = (await readSettings([SETTING]))[SETTING] as Partial<GameAssets> | undefined;
  return { ...EMPTY_ASSETS, ...(got ?? {}), voice: { ...(got?.voice ?? {}) }, sounds: { ...(got?.sounds ?? {}) }, models: { ...(got?.models ?? {}) }, props: { ...(got?.props ?? {}) } };
}

export async function writeAssets(assets: GameAssets): Promise<void> {
  await writeSetting(SETTING, { ...assets, updatedAt: Date.now() });
}

/** Which keys the server has (booleans only: never the values). */
export function configured() {
  return { elevenlabs: !!process.env.ELEVENLABS_API_KEY, openai: !!process.env.OPENAI_API_KEY, meshy: !!process.env.MESHY_API_KEY };
}

// ── ElevenLabs ───────────────────────────────────────────────────────────

export class AssetError extends Error {
  constructor(
    public provider: "elevenlabs" | "openai" | "meshy",
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function errorText(text: string, fallback: string): string {
  try {
    const j = JSON.parse(text);
    return j?.detail?.message ?? j?.detail ?? j?.error?.message ?? j?.message ?? fallback;
  } catch {
    return text.slice(0, 200) || fallback;
  }
}

async function elevenLabs(path: string, init: { method?: string; body?: unknown; accept?: string } = {}): Promise<Response> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new AssetError("elevenlabs", 503, "ELEVENLABS_API_KEY is not set");
  const r = await fetch(`https://api.elevenlabs.io/v1${path}`, {
    method: init.method ?? "GET",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: init.accept ?? "application/json" },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!r.ok) throw new AssetError("elevenlabs", r.status, errorText(await r.text(), `ElevenLabs ${r.status}`));
  return r;
}

/** The account's voices, for choosing Judy's. */
export async function listVoices(): Promise<Voice[]> {
  const r = await elevenLabs("/voices");
  const j = (await r.json()) as { voices?: Voice[] };
  return j.voices ?? [];
}

/** One line in Judy's voice, as MP3 bytes. */
export async function speak(voiceId: string, text: string): Promise<Uint8Array> {
  const r = await elevenLabs(`/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    accept: "audio/mpeg",
    body: { text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true } },
  });
  return new Uint8Array(await r.arrayBuffer());
}

/** One sound effect, as MP3 bytes. */
export async function soundEffect(text: string, seconds: number): Promise<Uint8Array> {
  const r = await elevenLabs("/sound-generation", { method: "POST", accept: "audio/mpeg", body: { text, duration_seconds: seconds, prompt_influence: 0.4 } });
  return new Uint8Array(await r.arrayBuffer());
}

// ── The work, a few items per call (a function has minutes, not hours) ───

/** Voices the next `batch` of Judy's lines that aren't done yet; returns what's left. */
export async function voiceJudy(lines: Array<{ id: string; text: string }>, redo: boolean, batch = 4): Promise<{ assets: GameAssets; remaining: number }> {
  const assets = await readAssets();
  if (!assets.judyVoice) {
    assets.judyVoice = pickJudyVoice(await listVoices());
    if (!assets.judyVoice) throw new AssetError("elevenlabs", 502, "The ElevenLabs account has no voices.");
  }
  const todo = lines.filter((l) => redo || !assets.voice[l.id]);
  for (const line of todo.slice(0, batch)) {
    const bytes = await speak(assets.judyVoice.id, line.text);
    const path = `game/voice/judy-${line.id}-${Date.now().toString(36)}.mp3`;
    await storageUpload(path, bytes, "audio/mpeg", BRAND_BUCKET);
    assets.voice[line.id] = publicUrl(path);
    await writeAssets(assets);
  }
  return { assets, remaining: Math.max(0, todo.length - batch) };
}

/** Makes the next `batch` of sound effects that aren't done yet; returns what's left. */
export async function makeSounds(redo: boolean, batch = 3): Promise<{ assets: GameAssets; remaining: number }> {
  const assets = await readAssets();
  const todo = Object.entries(EFFECTS).filter(([name]) => redo || !assets.sounds[name]);
  for (const [name, effect] of todo.slice(0, batch)) {
    const bytes = await soundEffect(effect.text, effect.seconds);
    const path = `game/sounds/${name}-${Date.now().toString(36)}.mp3`;
    await storageUpload(path, bytes, "audio/mpeg", BRAND_BUCKET);
    assets.sounds[name] = publicUrl(path);
    await writeAssets(assets);
  }
  return { assets, remaining: Math.max(0, todo.length - batch) };
}

/** Draws a prop with OpenAI and hands the picture to Meshy; the model arrives through checkProp. */
export async function startProp(name: string): Promise<GameAssets> {
  if (!PROPS[name]) throw new AssetError("meshy", 400, `No such prop: ${name}`);
  const assets = await readAssets();
  const { png } = await generateImage(propPrompt(name));
  const imagePath = `game/models/${name}-${Date.now().toString(36)}.png`;
  await storageUpload(imagePath, png, "image/png", BRAND_BUCKET);
  const imageUrl = publicUrl(imagePath);
  const taskId = await startModel(imageUrl);
  assets.props[name] = { taskId, status: "PENDING", progress: 0, createdAt: Date.now(), updatedAt: Date.now(), imageUrl };
  await writeAssets(assets);
  return assets;
}

/** Asks Meshy how a prop is doing; once it's done the GLB is copied into the bucket and the game uses it. */
export async function checkProp(name: string): Promise<GameAssets> {
  const assets = await readAssets();
  const prev = assets.props[name];
  if (!prev) throw new AssetError("meshy", 404, `${name} hasn't been started.`);
  if (prev.status === "SUCCEEDED" || prev.status === "FAILED" || prev.status === "CANCELED") return assets;
  const task = await getTask(prev.taskId);
  let state: ModelState & { imageUrl?: string } = { ...mergeTask(prev, task), imageUrl: prev.imageUrl };
  if (task.status === "SUCCEEDED" && task.model_urls?.glb) {
    const glbUrl = await copyIn(task.model_urls.glb, `game/models/${name}-${Date.now().toString(36)}.glb`, "model/gltf-binary");
    state = { ...state, glbUrl };
    assets.models[name] = glbUrl;
  }
  assets.props[name] = state;
  await writeAssets(assets);
  return assets;
}
