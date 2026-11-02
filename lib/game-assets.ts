/**
 * The signing game's generated assets (app/sign/game): Judy's voice, the
 * sound effects and the 3D props. They are made on the server, where the
 * API keys live, and stored in the public "brand" bucket under game/…; what's
 * there is kept in brand_settings under "game-assets" and handed to the game
 * by api/game-assets.ts, where it wins over public/game/manifest.json.
 *
 * The cron (api/cron/game-assets.ts) fills in whatever is missing every few
 * minutes and works through a request list kept in brand_settings under
 * "game-assets-requests": redo Judy (with a particular voice), redo a sound,
 * redo a prop (with a different prompt). Anyone with the database can queue
 * those; the cron clears them as it goes.
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
export const REQUESTS = "game-assets-requests";

/** Work queued for the cron: what to make again, and how. */
export type Requests = {
  /** Record Judy again: every line, or just these ids; with this ElevenLabs voice id, or the library's pick. */
  judy?: { redo?: boolean; voiceId?: string | null; lineIds?: string[] };
  /** Make these effects again (every one when `names` is empty), with a different description if given. */
  sounds?: { redo?: boolean; names?: string[]; text?: Record<string, string> };
  /** Draw and model these props again, with a different description if given. */
  props?: Record<string, { redo?: boolean; prompt?: string }>;
};

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
  step: { text: "A single soft footstep on short grass, close up, quick and quiet", seconds: 0.5 },
  cheer: { text: "A short burst of celebration: a small crowd cheering and clapping with a bright triumphant brass fanfare and a champagne cork pop, joyful, over in a moment", seconds: 3 },
};

/** The props: what OpenAI draws, which Meshy then turns into a model. */
export const PROPS: Record<string, string> = {
  seat: "A single plush red velvet movie theater seat with a folding cushion, dark wooden armrests and a small brass seat-number plate.",
  plant: "A tall potted areca palm in a terracotta pot.",
  popcorn: "A classic red and gold movie theater popcorn cart with a glass case full of popcorn and a striped canopy.",
  judy: "A friendly woman in her late sixties, gray hair in a neat bun, reading glasses on a beaded chain, a lavender cardigan over a white blouse, standing upright with her hands folded in front of her, full body from head to feet, smiling slightly.",
};

const PROP_STYLE =
  "Photorealistic, like a product photograph for a 3D scan: a single subject, centered, seen from a three-quarter front view, filling most of the frame, " +
  "evenly lit from the front with soft studio light, no harsh shadows, on a plain pure white background, no text, no watermark, nothing else in the picture.";

export const propPrompt = (name: string, what = PROPS[name]) => `${what} ${PROP_STYLE}`;

/** Triangle budgets: the seat is drawn 168 times, so it has to be light. */
export const POLYCOUNT: Record<string, number> = { seat: 6000, judy: 16000, plant: 10000, popcorn: 10000 };

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

/**
 * Changes one part of the record: re-reads it right before writing, so a
 * slow job (a minute drawing a picture) never puts back stale copies of
 * everything else that changed meanwhile. Returns the record as written.
 */
export async function patchAssets(change: (a: GameAssets) => void): Promise<GameAssets> {
  const fresh = await readAssets();
  change(fresh);
  await writeAssets(fresh);
  return fresh;
}

export async function readRequests(): Promise<Requests> {
  const got = (await readSettings([REQUESTS]))[REQUESTS];
  return got && typeof got === "object" ? (got as Requests) : {};
}

export async function writeRequests(r: Requests | null): Promise<void> {
  await writeSetting(REQUESTS, r && Object.keys(r).length ? r : null);
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

/**
 * An older woman's voice from ElevenLabs's shared library, added to the
 * account so Judy can use it: the most-used English one labelled old and
 * female. Returns what was added, or null when the search finds nothing.
 */
export async function adoptOlderVoice(): Promise<{ id: string; name: string } | null> {
  const r = await elevenLabs("/shared-voices?page_size=30&gender=female&age=old&language=en&sort=cloned_by_count&sort_direction=desc");
  const j = (await r.json()) as { voices?: Array<{ public_owner_id: string; voice_id: string; name: string; cloned_by_count?: number; free_users_allowed?: boolean }> };
  const pick = (j.voices ?? []).find((v) => v.free_users_allowed !== false) ?? j.voices?.[0];
  if (!pick) return null;
  const name = `Judy (${pick.name})`;
  try {
    const added = await elevenLabs(`/voices/add/${encodeURIComponent(pick.public_owner_id)}/${encodeURIComponent(pick.voice_id)}`, { method: "POST", body: { new_name: name } });
    const a = (await added.json()) as { voice_id?: string };
    return { id: a.voice_id ?? pick.voice_id, name };
  } catch (err) {
    // Already in the library under its own id: use it as is.
    if (err instanceof AssetError && /already|exists/i.test(err.message)) return { id: pick.voice_id, name };
    throw err;
  }
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
export async function voiceJudy(lines: Array<{ id: string; text: string }>, redo: boolean, batch = 4, voiceId?: string | null): Promise<{ assets: GameAssets; remaining: number }> {
  let assets = await readAssets();
  if (voiceId && assets.judyVoice?.id !== voiceId) {
    const voices = await listVoices();
    const v = voices.find((x) => x.voice_id === voiceId);
    const judyVoice = { id: voiceId, name: v?.name ?? voiceId };
    assets = await patchAssets((a) => {
      a.judyVoice = judyVoice;
      a.voice = {};
    });
  }
  if (!assets.judyVoice) {
    const judyVoice = pickJudyVoice(await listVoices());
    if (!judyVoice) throw new AssetError("elevenlabs", 502, "The ElevenLabs account has no voices.");
    assets = await patchAssets((a) => (a.judyVoice = judyVoice));
  }
  const voice = assets.judyVoice;
  if (!voice) throw new AssetError("elevenlabs", 502, "Judy has no voice.");
  const todo = lines.filter((l) => redo || !assets.voice[l.id]);
  for (const line of todo.slice(0, batch)) {
    const bytes = await speak(voice.id, line.text);
    const path = `game/voice/judy-${line.id}-${Date.now().toString(36)}.mp3`;
    await storageUpload(path, bytes, "audio/mpeg", BRAND_BUCKET);
    const url = publicUrl(path);
    assets = await patchAssets((a) => (a.voice[line.id] = url));
  }
  return { assets, remaining: Math.max(0, todo.length - batch) };
}

/** Makes the next `batch` of sound effects that aren't done yet; returns what's left. */
export async function makeSounds(redo: boolean, batch = 3, text: Record<string, string> = {}): Promise<{ assets: GameAssets; remaining: number }> {
  let assets = await readAssets();
  const todo = Object.entries(EFFECTS).filter(([name]) => redo || !assets.sounds[name]);
  for (const [name, effect] of todo.slice(0, batch)) {
    const bytes = await soundEffect(text[name] || effect.text, effect.seconds);
    const path = `game/sounds/${name}-${Date.now().toString(36)}.mp3`;
    await storageUpload(path, bytes, "audio/mpeg", BRAND_BUCKET);
    const url = publicUrl(path);
    assets = await patchAssets((a) => (a.sounds[name] = url));
  }
  return { assets, remaining: Math.max(0, todo.length - batch) };
}

/** Draws a prop with OpenAI and hands the picture to Meshy; the model arrives through checkProp. */
export async function startProp(name: string, what?: string): Promise<GameAssets> {
  if (!PROPS[name]) throw new AssetError("meshy", 400, `No such prop: ${name}`);
  const { png } = await generateImage(propPrompt(name, what?.trim() || PROPS[name]));
  const imagePath = `game/models/${name}-${Date.now().toString(36)}.png`;
  await storageUpload(imagePath, png, "image/png", BRAND_BUCKET);
  const imageUrl = publicUrl(imagePath);
  // Light enough to download in a game: 2k textures (the smallest Meshy takes), a polygon budget, GLB only.
  const taskId = await startModel(imageUrl, { texture: "2k", pbr: false, formats: ["glb"], polycount: POLYCOUNT[name] ?? 12000 });
  return patchAssets((a) => (a.props[name] = { taskId, status: "PENDING", progress: 0, createdAt: Date.now(), updatedAt: Date.now(), imageUrl }));
}

/** Asks Meshy how a prop is doing; once it's done the GLB is copied into the bucket and the game uses it. */
export async function checkProp(name: string): Promise<GameAssets> {
  const assets = await readAssets();
  const prev = assets.props[name];
  if (!prev) throw new AssetError("meshy", 404, `${name} hasn't been started.`);
  if (prev.status === "SUCCEEDED" || prev.status === "FAILED" || prev.status === "CANCELED") return assets;
  const task = await getTask(prev.taskId);
  let state: ModelState & { imageUrl?: string } = { ...mergeTask(prev, task), imageUrl: prev.imageUrl };
  let glbUrl: string | undefined;
  if (task.status === "SUCCEEDED" && task.model_urls?.glb) {
    try {
      glbUrl = await copyIn(task.model_urls.glb, `game/models/${name}-${Date.now().toString(36)}.glb`, "model/gltf-binary");
      state = { ...state, glbUrl };
    } catch (err) {
      // A model the bucket won't take (too big) is marked failed rather than fetched again every run; a queued redo makes a lighter one.
      state = { ...state, status: "FAILED", error: `couldn't store the model: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  const done = state;
  return patchAssets((a) => {
    a.props[name] = done;
    if (glbUrl) a.models[name] = glbUrl;
  });
}

// ── The cron: fill in what's missing, and do what was asked ──────────────

export type FillSummary = { voiced: number; sounds: number; props: Record<string, string>; skipped: string[]; errors: string[]; done: boolean };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * One run of the cron, within `deadline`: works the request list first
 * (redo this, with that voice or prompt), then fills in anything missing.
 * Judy's lines come from the site's own judy.json. Each provider error is
 * noted and the rest carries on; the request list is cleared as it's done.
 */
export async function fillMissing(opts: { deadline: number; judyUrl: string }): Promise<FillSummary> {
  const cfg = configured();
  const out: FillSummary = { voiced: 0, sounds: 0, props: {}, skipped: [], errors: [], done: false };
  const time = () => Date.now() < opts.deadline;
  const requests = await readRequests();

  // Judy.
  if (!cfg.elevenlabs) out.skipped.push("judy and sounds: ELEVENLABS_API_KEY isn't set");
  else {
    try {
      const r = await fetch(opts.judyUrl);
      const judy = r.ok ? ((await r.json()) as JudyLike) : null;
      const lines = judy ? [judy.greeting, ...judy.rounds.flatMap((x) => [...x.options.map((o) => o.judy), x.core]), judy.final, ...Object.values(judy.extras ?? {})] : [];
      if (!lines.length) out.errors.push(`judy.json couldn't be read from ${opts.judyUrl}`);
      else {
        const ask = requests.judy;
        if (ask?.redo || ask?.voiceId || ask?.lineIds?.length) {
          await patchAssets((a) => {
            if (ask.voiceId || ask.redo) a.voice = {};
            else for (const id of ask.lineIds ?? []) delete a.voice[id];
          });
        }
        let remaining = 1;
        let first = true;
        while (remaining > 0 && time()) {
          const r2 = await voiceJudy(lines, false, 4, first ? ask?.voiceId : undefined);
          first = false;
          remaining = r2.remaining;
          out.voiced = Object.keys(r2.assets.voice).length;
        }
        if (ask) {
          delete requests.judy;
          await writeRequests(requests);
        }
      }
    } catch (err) {
      out.errors.push(`judy: ${message(err)}`);
    }
    // Sounds.
    try {
      const ask = requests.sounds;
      if (ask?.redo || ask?.names?.length) {
        const names = ask.names?.length ? ask.names : Object.keys(EFFECTS);
        await patchAssets((a) => {
          for (const n of names) delete a.sounds[n];
        });
      }
      let remaining = 1;
      while (remaining > 0 && time()) {
        const r2 = await makeSounds(false, 3, ask?.text ?? {});
        remaining = r2.remaining;
        out.sounds = Object.keys(r2.assets.sounds).length;
      }
      if (ask) {
        delete requests.sounds;
        await writeRequests(requests);
      }
    } catch (err) {
      out.errors.push(`sounds: ${message(err)}`);
    }
  }

  // Props: check the ones Meshy is building; start one that isn't, per run.
  if (!cfg.openai || !cfg.meshy) out.skipped.push(`props: ${!cfg.openai ? "OPENAI_API_KEY" : "MESHY_API_KEY"} isn't set`);
  else {
    let started = false;
    for (const name of Object.keys(PROPS)) {
      const ask = requests.props?.[name];
      try {
        let assets = await readAssets();
        const state = assets.props[name];
        const building = state && (state.status === "PENDING" || state.status === "IN_PROGRESS");
        if (building) {
          assets = await checkProp(name);
          out.props[name] = `${assets.props[name].status} ${assets.props[name].progress}%`;
          continue;
        }
        const wanted = ask?.redo || ask?.prompt;
        if ((wanted || !assets.models[name]) && !started && time()) {
          if (state?.status === "FAILED" && !wanted) {
            out.props[name] = `failed earlier: ${state.error ?? "Meshy couldn't build it"}; queue a redo to try again`;
            continue;
          }
          await startProp(name, ask?.prompt);
          started = true;
          out.props[name] = "started";
          if (ask && requests.props) {
            delete requests.props[name];
            if (!Object.keys(requests.props).length) delete requests.props;
            await writeRequests(requests);
          }
        } else out.props[name] = assets.models[name] ? "done" : "waiting";
      } catch (err) {
        out.errors.push(`${name}: ${message(err)}`);
      }
    }
  }

  const final = await readAssets();
  out.done = Object.keys(final.sounds).length >= Object.keys(EFFECTS).length && Object.keys(PROPS).every((p) => !!final.models[p]) && out.voiced > 0;
  return out;
}

type JudyLike = {
  greeting: { id: string; text: string };
  rounds: Array<{ options: Array<{ judy: { id: string; text: string } }>; core: { id: string; text: string } }>;
  final: { id: string; text: string };
  /** Lines said elsewhere (over the PA during the film). */
  extras?: Record<string, { id: string; text: string }>;
};
