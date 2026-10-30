import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, handleError, isAdmin, type AppUser } from "../lib/auth.js";
import {
  BRAND_BUCKET,
  copyIn,
  generateImage,
  getTask,
  LOGO_STYLES,
  logoPrompt,
  mergeTask,
  ProviderError,
  publicUrl,
  readSettings,
  startModel,
  styleById,
  writeSetting,
  type Logo,
  type ModelState,
  type Sheet,
} from "../lib/brand.js";
import { storageUpload } from "../lib/storage.js";

/**
 * The BFO logo (lib/brand.ts).
 *
 *   GET  /api/brand                → { logo }: the 3D logo in use, for anyone (the landing page is public)
 *   GET  /api/brand?studio=1       → owner/admin: the style sheet, each style's model, what's configured
 *   POST /api/brand { action }     → owner/admin:
 *     generate     { styleId, tweak? }  OpenAI draws that style (≈30–60 s); replaces the sheet's entry
 *     model        { styleId }          Meshy starts turning the picture into a model
 *     model-status { styleId }          Meshy's progress; on success the GLB is copied into the bucket
 *     use          { styleId | null, as? }  the site shows this style: as "lockup" (default) its
 *                                         type in the paired font, as "3d" its model; null: back to the wordmark
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    const studio = req.query.studio === "1";
    if (!studio) {
      const { logo = null } = await readSettings(["logo"]);
      res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=600");
      return res.status(200).json({ logo });
    }
    // currentUser throws PartnerRefused for a partner; handleError answers 403.
    let user: AppUser | null;
    try {
      user = await currentUser(req);
    } catch (err) {
      return handleError(res, err);
    }
    if (!user) return res.status(401).json({ error: "unauthorized" });
    if (!isAdmin(user)) return res.status(403).json({ error: "forbidden" });
    const keys = ["logo", "sheet", ...LOGO_STYLES.map((s) => `model:${s.id}`)];
    const all = await readSettings(keys);
    return res.status(200).json({
      configured: { openai: !!process.env.OPENAI_API_KEY, meshy: !!process.env.MESHY_API_KEY },
      styles: LOGO_STYLES.map((s) => ({ id: s.id, name: s.name, blurb: s.blurb, font: s.font, finish: s.finish, prompt: logoPrompt(s) })),
      sheet: (all.sheet as Sheet | undefined) ?? { styles: {}, generatedAt: 0 },
      models: Object.fromEntries(LOGO_STYLES.map((s) => [s.id, (all[`model:${s.id}`] as ModelState | undefined) ?? null])),
      logo: (all.logo as Logo | undefined) ?? null,
    });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  // currentUser throws PartnerRefused for a partner; handleError answers 403.
  let user: AppUser | null;
  try {
    user = await currentUser(req);
  } catch (err) {
    return handleError(res, err);
  }
  if (!user) return res.status(401).json({ error: "unauthorized" });
  if (!isAdmin(user)) return res.status(403).json({ error: "forbidden", message: "Only an owner or admin can change the logo." });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const action = String(body.action ?? "");
  try {
    switch (action) {
      case "generate": {
        const style = styleById(body.styleId);
        if (!style) return res.status(400).json({ error: "bad_style" });
        const prompt = logoPrompt(style, typeof body.tweak === "string" ? body.tweak : undefined);
        const { png, model } = await generateImage(prompt);
        const imagePath = `logo/${style.id}/${Date.now()}.png`;
        await storageUpload(imagePath, png, "image/png", BRAND_BUCKET);
        const { sheet } = await readSettings(["sheet"]);
        const next: Sheet = { styles: { ...((sheet as Sheet | undefined)?.styles ?? {}) }, generatedAt: Date.now() };
        next.styles[style.id] = { imageUrl: publicUrl(imagePath), imagePath, prompt, model, createdAt: Date.now() };
        await writeSetting("sheet", next);
        // A new picture means the old model no longer matches it.
        await writeSetting(`model:${style.id}`, null);
        return res.status(200).json({ entry: next.styles[style.id] });
      }

      case "model": {
        const style = styleById(body.styleId);
        if (!style) return res.status(400).json({ error: "bad_style" });
        const { sheet } = await readSettings(["sheet"]);
        const entry = (sheet as Sheet | undefined)?.styles?.[style.id];
        if (!entry) return res.status(409).json({ error: "no_image", message: "Draw this style first." });
        const taskId = await startModel(entry.imageUrl);
        const state: ModelState = { taskId, status: "PENDING", progress: 0, createdAt: Date.now(), updatedAt: Date.now() };
        await writeSetting(`model:${style.id}`, state);
        return res.status(200).json({ model: state });
      }

      case "model-status": {
        const style = styleById(body.styleId);
        if (!style) return res.status(400).json({ error: "bad_style" });
        const prev = (await readSettings([`model:${style.id}`]))[`model:${style.id}`] as ModelState | undefined;
        if (!prev) return res.status(404).json({ error: "not_found" });
        if (prev.status === "SUCCEEDED" || prev.status === "FAILED" || prev.status === "CANCELED") return res.status(200).json({ model: prev });
        const task = await getTask(prev.taskId);
        let state = mergeTask(prev, task);
        if (task.status === "SUCCEEDED" && task.model_urls?.glb) {
          const stamp = Date.now();
          const glbUrl = await copyIn(task.model_urls.glb, `logo/${style.id}/${stamp}.glb`, "model/gltf-binary");
          const usdzUrl = task.model_urls.usdz ? await copyIn(task.model_urls.usdz, `logo/${style.id}/${stamp}.usdz`, "model/vnd.usdz+zip").catch((err) => (console.error("brand: couldn't copy the usdz model", err), null)) : null;
          const poster = task.alpha_thumbnail_url ?? task.thumbnail_url;
          const posterUrl = poster ? await copyIn(poster, `logo/${style.id}/${stamp}-poster.png`, "image/png").catch((err) => (console.error("brand: couldn't copy the poster", err), null)) : null;
          state = { ...state, glbUrl, usdzUrl, posterUrl };
        }
        await writeSetting(`model:${style.id}`, state);
        return res.status(200).json({ model: state });
      }

      case "use": {
        if (body.styleId === null || body.styleId === undefined || body.styleId === "") {
          await writeSetting("logo", null);
          return res.status(200).json({ logo: null });
        }
        const style = styleById(body.styleId);
        if (!style) return res.status(400).json({ error: "bad_style" });
        const all = await readSettings(["sheet", `model:${style.id}`]);
        const model = all[`model:${style.id}`] as ModelState | undefined;
        const entry = (all.sheet as Sheet | undefined)?.styles?.[style.id];
        if (!entry) return res.status(409).json({ error: "no_image", message: "Draw this style first." });
        const base = { styleId: style.id, font: style.font, finish: style.finish, imageUrl: entry.imageUrl, updatedAt: Date.now() };
        let logo: Logo;
        if (body.as === "3d") {
          if (!model?.glbUrl) return res.status(409).json({ error: "no_model", message: "Build the 3D model first." });
          logo = { ...base, kind: "3d", glbUrl: model.glbUrl, usdzUrl: model.usdzUrl ?? null, posterUrl: model.posterUrl ?? null };
        } else {
          logo = { ...base, kind: "lockup" };
        }
        await writeSetting("logo", logo);
        return res.status(200).json({ logo });
      }

      default:
        return res.status(400).json({ error: "unknown_action" });
    }
  } catch (err) {
    if (err instanceof ProviderError) {
      const status = err.status === 503 ? 503 : err.status === 429 ? 429 : 502;
      return res.status(status).json({ error: err.provider, message: err.message });
    }
    console.error("brand:", err);
    return res.status(500).json({ error: "failed", message: err instanceof Error ? err.message : "Something went wrong." });
  }
}
