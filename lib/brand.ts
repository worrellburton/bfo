import { sb } from "./auth.js";
import { storageUpload } from "./storage.js";

/**
 * The BFO logo, made in two steps: OpenAI draws six styles of a "BFO" mark as
 * a physical object (the style sheet), then Meshy turns the chosen one into a
 * textured 3D model (GLB) the site shows with <model-viewer>. Everything lands
 * in the public "brand" bucket; the state lives in brand_settings (key → json).
 */

export const BRAND_BUCKET = "brand";

export type LogoStyle = { id: string; name: string; blurb: string; prompt: string };

/** What every style shares: one object, centered, lit for a 3D scan. */
const BASE_PROMPT =
  "A logo mark for \"BFO\", a private family office. The three capital letters B, F and O, exactly those and nothing else, as one single solid physical object. " +
  "Centered, three-quarter front view, filling most of the frame, on a plain seamless light-gray studio backdrop with soft even studio lighting and only a faint contact shadow. " +
  "Photorealistic product render, sharp edges, no extra text, no reflections of surroundings, no people.";

export const LOGO_STYLES: LogoStyle[] = [
  {
    id: "monolith",
    name: "Monolith",
    blurb: "One block of polished black stone, letters cut through.",
    prompt: "Style: a single thick slab of polished black obsidian with the letters BFO carved as one piece, geometric grotesque sans-serif, deep bevelled edges, subtle brushed-steel inlay along the edges, serious and quiet.",
  },
  {
    id: "chrome",
    name: "Liquid chrome",
    blurb: "Rounded mirror-chrome letters, soft and heavy.",
    prompt: "Style: BFO in heavy rounded sans-serif letters made of liquid mirror chrome, surfaces smooth and bulbous as if poured, cool studio reflections, letters fused together at the joins.",
  },
  {
    id: "glass",
    name: "Aurora glass",
    blurb: "Frosted glass lit from inside with indigo and violet.",
    prompt: "Style: BFO in a modern sans-serif cut from thick frosted glass, translucent, glowing softly from within with indigo (#818cf8) and violet (#c4b5fd) light, light refracting at the edges, clean and luminous.",
  },
  {
    id: "signet",
    name: "Signet",
    blurb: "A brass seal with the BFO monogram embossed.",
    prompt: "Style: a round brass signet seal, like a coin or wax stamp, with an interlocking BFO monogram embossed in relief at the center and a thin raised ring around the rim, aged warm brass with soft patina.",
  },
  {
    id: "cube",
    name: "Three faces",
    blurb: "Navy block, one letter inlaid on each visible face.",
    prompt: "Style: a matte deep-navy cube seen from a corner so three faces show, with B, F and O each inlaid in polished gold on one face, one letter per face, crisp and architectural.",
  },
  {
    id: "serif",
    name: "Inline serif",
    blurb: "Extruded slab-serif wordmark, matte black, one indigo line.",
    prompt: "Style: BFO as a wide extruded slab-serif wordmark in matte charcoal black, deep extrusion so the letters read as solid bars, a single thin indigo inline running along the front faces, understated luxury.",
  },
];

export const styleById = (id: unknown): LogoStyle | null => LOGO_STYLES.find((s) => s.id === id) ?? null;

export function logoPrompt(style: LogoStyle, tweak?: string): string {
  const extra = (tweak ?? "").trim().slice(0, 600);
  return `${BASE_PROMPT} ${style.prompt}${extra ? ` Adjustment: ${extra}.` : ""}`;
}

export type SheetEntry = { imageUrl: string; imagePath: string; prompt: string; model: string; createdAt: number };
export type Sheet = { styles: Record<string, SheetEntry>; generatedAt: number };

export type ModelState = {
  taskId: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED";
  progress: number;
  glbUrl?: string | null;
  usdzUrl?: string | null;
  posterUrl?: string | null;
  error?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type Logo = { styleId: string; glbUrl: string; usdzUrl?: string | null; posterUrl: string | null; imageUrl: string; updatedAt: number };

// ── Settings (brand_settings: key → json) ────────────────────────────────

export async function readSettings(keys: string[]): Promise<Record<string, unknown>> {
  if (!keys.length) return {};
  const list = keys.map((k) => `"${k}"`).join(",");
  const rows = await sb<{ key: string; value: unknown }[]>(`brand_settings?key=in.(${encodeURIComponent(list)})&select=key,value`);
  return Object.fromEntries((rows ?? []).map((r) => [r.key, r.value]));
}

export async function writeSetting(key: string, value: unknown): Promise<void> {
  if (value === null) {
    await sb(`brand_settings?key=eq.${encodeURIComponent(key)}`, { method: "DELETE", prefer: "return=minimal" });
    return;
  }
  await sb("brand_settings?on_conflict=key", { method: "POST", body: [{ key, value, updated_at: new Date().toISOString() }], prefer: "resolution=merge-duplicates,return=minimal" });
}

export function publicUrl(path: string): string {
  return `${(process.env.SUPABASE_URL ?? "").replace(/\/$/, "")}/storage/v1/object/public/${BRAND_BUCKET}/${path}`;
}

// ── OpenAI: the picture ──────────────────────────────────────────────────

/** Newest first; an account without the newest falls through to the next. */
export const IMAGE_MODELS = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1"];

export class ProviderError extends Error {
  constructor(public provider: "openai" | "meshy", public status: number, message: string) {
    super(message);
  }
}

function errorMessage(text: string, fallback: string): string {
  try {
    const j = JSON.parse(text);
    return j?.error?.message ?? j?.message ?? j?.detail ?? fallback;
  } catch {
    return text.slice(0, 200) || fallback;
  }
}

/** One square PNG of the prompt. Returns the bytes and the model that drew them. */
export async function generateImage(prompt: string, models: string[] = IMAGE_MODELS): Promise<{ png: Uint8Array; model: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new ProviderError("openai", 503, "OPENAI_API_KEY is not set");
  let last: ProviderError | null = null;
  for (const model of models) {
    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, n: 1, size: "1024x1024", quality: "high", output_format: "png", moderation: "low" }),
    });
    const text = await r.text();
    if (!r.ok) {
      const message = errorMessage(text, `OpenAI ${r.status}`);
      last = new ProviderError("openai", r.status, message);
      // A model this key can't use: try the next one. Anything else is final.
      if ((r.status === 404 || r.status === 400 || r.status === 403) && /model|not found|does not exist|access|unsupported/i.test(message)) continue;
      throw last;
    }
    const data = JSON.parse(text) as { data?: { b64_json?: string }[] };
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new ProviderError("openai", 502, "OpenAI returned no image.");
    return { png: new Uint8Array(Buffer.from(b64, "base64")), model };
  }
  throw last ?? new ProviderError("openai", 502, "No image model answered.");
}

// ── Meshy: the model ─────────────────────────────────────────────────────

const MESHY = "https://api.meshy.ai/openapi/v1";

async function meshy<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const key = process.env.MESHY_API_KEY;
  if (!key) throw new ProviderError("meshy", 503, "MESHY_API_KEY is not set");
  const r = await fetch(`${MESHY}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await r.text();
  if (!r.ok) throw new ProviderError("meshy", r.status, errorMessage(text, `Meshy ${r.status}`));
  return (text ? JSON.parse(text) : null) as T;
}

/** Start turning the picture into a textured model. Returns Meshy's task id. */
export async function startModel(imageUrl: string): Promise<string> {
  const r = await meshy<{ result: string }>("/image-to-3d", {
    method: "POST",
    body: {
      image_url: imageUrl,
      ai_model: "latest",
      should_texture: true,
      enable_pbr: true,
      texture_resolution: "2k",
      target_formats: ["glb", "usdz"],
      origin_at: "center",
      alpha_thumbnail: true,
    },
  });
  if (!r?.result) throw new ProviderError("meshy", 502, "Meshy didn't start the task.");
  return r.result;
}

export type MeshyTask = {
  id: string;
  status: ModelState["status"];
  progress?: number;
  model_urls?: { glb?: string; usdz?: string };
  thumbnail_url?: string;
  alpha_thumbnail_url?: string;
  task_error?: { message?: string } | null;
};

export const getTask = (taskId: string) => meshy<MeshyTask>(`/image-to-3d/${encodeURIComponent(taskId)}`);

/** Meshy's answer folded onto what we keep. Files are copied in only once the task succeeds (the caller does that). */
export function mergeTask(prev: ModelState, task: MeshyTask): ModelState {
  return {
    ...prev,
    status: task.status,
    progress: task.status === "SUCCEEDED" ? 100 : (task.progress ?? prev.progress ?? 0),
    error: task.status === "FAILED" ? (task.task_error?.message ?? "Meshy couldn't build the model.") : task.status === "CANCELED" ? "Canceled at Meshy." : null,
    updatedAt: Date.now(),
  };
}

/** Download a Meshy result into the brand bucket (their links expire). */
export async function copyIn(url: string, path: string, contentType: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new ProviderError("meshy", 502, `Couldn't download the model (${r.status}).`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  await storageUpload(path, bytes, contentType, BRAND_BUCKET);
  return publicUrl(path);
}
