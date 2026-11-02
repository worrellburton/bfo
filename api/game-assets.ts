import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, fail, guard, handleError, isAdmin } from "../lib/auth.js";
import { ProviderError } from "../lib/brand.js";
import { AssetError, checkProp, cleanLines, configured, makeSounds, PROPS, readAssets, startProp, voiceJudy } from "../lib/game-assets.js";

/**
 * The signing game's generated assets (lib/game-assets.ts): made here, on
 * the server, with the keys Vercel holds, and stored in the public brand
 * bucket. The game reads them without an account (a signer has none).
 *
 *   GET  /api/game-assets            → { voice, sounds, models }  anyone: what the game should use over its static manifest
 *   GET  /api/game-assets?studio=1   → owner/admin: everything, plus which keys the server has (booleans)
 *   POST { action }                  → owner/admin:
 *     judy        { lines: [{ id, text }], redo? }  voices a few of Judy's lines per call → { assets, remaining }; call until remaining is 0
 *     sounds      { redo? }                         a few sound effects per call → { assets, remaining }
 *     prop        { name }                          OpenAI draws it, Meshy starts the model → { assets }
 *     prop-status { name }                          Meshy's progress; on success the GLB lands in the bucket → { assets }
 *
 * Env: ELEVENLABS_API_KEY, OPENAI_API_KEY, MESHY_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "POST"])) return;
  try {
    if (req.method === "GET" && req.query.studio !== "1") {
      const { voice, sounds, models } = await readAssets();
      res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=600");
      return res.status(200).json({ voice, sounds, models });
    }
    const me = await currentUser(req);
    if (!me) return fail(res, 401, "unauthorized");
    if (!isAdmin(me)) return fail(res, 403, "forbidden");

    if (req.method === "GET") return res.status(200).json({ assets: await readAssets(), configured: configured(), props: Object.keys(PROPS) });

    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {})) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const redo = body.redo === true;
    switch (action) {
      case "judy": {
        const lines = cleanLines(body.lines);
        if (!lines.length) return fail(res, 400, "no_lines", "Send Judy's lines.");
        return res.status(200).json(await voiceJudy(lines, redo));
      }
      case "sounds":
        return res.status(200).json(await makeSounds(redo));
      case "prop": {
        const name = String(body.name ?? "");
        if (!PROPS[name]) return fail(res, 400, "bad_prop");
        return res.status(200).json({ assets: await startProp(name) });
      }
      case "prop-status": {
        const name = String(body.name ?? "");
        if (!PROPS[name]) return fail(res, 400, "bad_prop");
        return res.status(200).json({ assets: await checkProp(name) });
      }
      default:
        return fail(res, 400, "unknown_action");
    }
  } catch (err) {
    if (err instanceof AssetError || err instanceof ProviderError) return fail(res, err.status >= 400 && err.status < 600 ? err.status : 502, `${err.provider}_failed`, err.message);
    return handleError(res, err);
  }
}
