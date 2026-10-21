import { sb } from "./auth.js";
import { storageUpload } from "./storage.js";

/**
 * The BFO logo. OpenAI draws six lockups (a reference sheet): "BURTON FAMILY
 * OFFICE" set small above a large "BFO", each in a different typeface. The one
 * you pick goes on the site as live type in its paired Google font, so the
 * logo and the typeface stay one thing. Any lockup can still go to Meshy for a
 * 3D model. Everything lands in the public "brand" bucket; the state lives in
 * brand_settings (key → json).
 */

export const BRAND_BUCKET = "brand";

/** How the site colours the lockup's letters. */
export type Finish = "gold" | "ivory" | "silver";

/** The Google font a lockup is drawn in and the site sets it in. */
export type BrandFont = { family: string; weight: number; css: string };

export type LogoStyle = { id: string; name: string; blurb: string; font: BrandFont; finish: Finish; prompt: string };

/** What every lockup shares: the two lines of type, flat, on a black presentation board. */
const BASE_PROMPT =
  "A luxury brand identity logo lockup for Burton Family Office, a private family office. Two lines of type, centered, and nothing else: " +
  "on top, the words \"BURTON FAMILY OFFICE\" in small, widely letterspaced capitals; below it, much larger, the monogram \"BFO\" (the capital letters B, F and O, exactly those). " +
  "Spell every word exactly as written. Flat, crisp vector artwork, perfectly centered with generous margins, presented on a plain deep black (#0a0a0a) background like a page of a brand reference sheet. " +
  "No mockup, no photo, no extra words, no tagline, no watermark.";

export const LOGO_STYLES: LogoStyle[] = [
  {
    id: "didone",
    name: "Didone",
    blurb: "High-contrast Bodoni, ivory, a hairline rule between the lines.",
    font: { family: "Bodoni Moda", weight: 500, css: "Bodoni+Moda:ital,opsz,wght@0,6..96,400..900;1,6..96,400..900" },
    finish: "ivory",
    prompt: "Typeface: a high-contrast Didone serif like Bodoni, razor-thin hairlines and heavy stems, in warm ivory white. A single fine hairline rule separates the two lines. Editorial, like a couture fashion house.",
  },
  {
    id: "inscription",
    name: "Inscription",
    blurb: "Roman capitals in the Trajan tradition, gold foil.",
    font: { family: "Cinzel", weight: 500, css: "Cinzel:wght@400..900" },
    finish: "gold",
    prompt: "Typeface: classical Roman inscriptional capitals in the Trajan tradition, like Cinzel, with sharp flared serifs. Rendered in rich brushed gold foil with a subtle metallic sheen. Timeless and monumental, like letters cut into marble.",
  },
  {
    id: "monogram",
    name: "Monogram",
    blurb: "Garamond capitals, B F O interlaced, inside a fine gold ring.",
    font: { family: "Cormorant Garamond", weight: 500, css: "Cormorant+Garamond:ital,wght@0,300..700;1,300..700" },
    finish: "gold",
    prompt: "Typeface: an elegant old-style Garamond, like Cormorant Garamond. The letters B, F and O are interlaced into one refined heraldic monogram set inside a thin gold circle, the O wrapping around the B and F. Champagne gold on black. Heritage, like a private bank's seal.",
  },
  {
    id: "geometric",
    name: "Geometric",
    blurb: "Futura-like geometric sans, wide tracking, silver.",
    font: { family: "Jost", weight: 400, css: "Jost:ital,wght@0,100..900;1,100..900" },
    finish: "silver",
    prompt: "Typeface: a pure geometric sans-serif like Futura (Jost), perfect circle O, light-to-regular weight, very wide letterspacing on BFO as well. Brushed platinum silver. Minimal and modern, like an architecture firm or a Swiss private bank.",
  },
  {
    id: "deco",
    name: "Deco",
    blurb: "Fine-line Art Deco capitals with stepped gold sunrays.",
    font: { family: "Italiana", weight: 400, css: "Italiana" },
    finish: "gold",
    prompt: "Typeface: slender high-contrast Art Deco capitals like Italiana. A restrained 1920s Art Deco ornament of fine stepped lines and a small sunray fan frames the BFO monogram. Polished gold line art on black. Glamorous, like a grand Manhattan lobby.",
  },
  {
    id: "editorial",
    name: "Editorial",
    blurb: "Playfair Display, BFO in italic with a swash, ivory.",
    font: { family: "Playfair Display", weight: 600, css: "Playfair+Display:ital,wght@0,400..900;1,400..900" },
    finish: "ivory",
    prompt: "Typeface: a transitional display serif like Playfair Display. \"BURTON FAMILY OFFICE\" in upright small capitals; \"BFO\" large in a graceful italic with a single elegant swash on the F. Warm ivory on black. Literary and confident, like a classic publishing house.",
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

/**
 * The logo on the site. "lockup": live type in the style's font and finish.
 * "3d": the Meshy model (the older shape, saved before lockups, has no kind).
 */
export type Logo = {
  styleId: string;
  kind?: "lockup" | "3d";
  font?: BrandFont;
  finish?: Finish;
  glbUrl?: string | null;
  usdzUrl?: string | null;
  posterUrl?: string | null;
  imageUrl: string;
  updatedAt: number;
};

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
