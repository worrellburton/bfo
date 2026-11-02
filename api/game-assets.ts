import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, fail, guard, handleError, isAdmin, secretMatches } from "../lib/auth.js";
import { ProviderError } from "../lib/brand.js";
import { AssetError, checkProp, cleanLines, configured, listVoices, makeSounds, PROPS, readAssets, startProp, voiceJudy } from "../lib/game-assets.js";

/**
 * The signing game's generated assets (lib/game-assets.ts): made here, on
 * the server, with the keys Vercel holds, and stored in the public brand
 * bucket. The game reads them without an account (a signer has none).
 *
 *   GET  /api/game-assets            → { voice, sounds, models }  anyone: what the game should use over its static manifest
 *   GET  /api/game-assets?studio=1   → the studio: everything, plus which keys the server has (booleans)
 *   POST { action }                  → the studio:
 *     voices                                        the ElevenLabs library: [{ id, name, labels }], to choose Judy's
 *     judy        { lines: [{ id, text }], redo?, voiceId? }  voices a few of Judy's lines per call → { assets, remaining }; call until
 *                                                   remaining is 0; a voiceId switches Judy's voice and starts her over
 *     sounds      { redo? }                         a few sound effects per call → { assets, remaining }
 *     prop        { name }                          OpenAI draws it, Meshy starts the model → { assets }
 *     prop-status { name }                          Meshy's progress; on success the GLB lands in the bucket → { assets }
 *
 * The studio is for a signed-in owner or admin, or a caller presenting
 * Bearer $GAME_JOB_TOKEN: a token minted for a Claude session so it can make
 * and remake the assets from outside, with the provider keys staying here.
 * Without that env var the token path is off.
 *
 * Env: ELEVENLABS_API_KEY, OPENAI_API_KEY, MESHY_API_KEY, GAME_JOB_TOKEN (optional), SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "POST"])) return;
  try {
    if (req.method === "GET" && req.query.studio !== "1") {
      const { voice, sounds, models } = await readAssets();
      res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=600");
      return res.status(200).json({ voice, sounds, models });
    }
    // The job token first (it isn't a session, so currentUser would refuse it); then a signed-in owner or admin.
    const token = process.env.GAME_JOB_TOKEN;
    const byToken = !!token && secretMatches(req.headers.authorization, `Bearer ${token}`);
    if (!byToken) {
      const me = await currentUser(req);
      if (!me) return fail(res, 401, "unauthorized");
      if (!isAdmin(me)) return fail(res, 403, "forbidden");
    }

    if (req.method === "GET") return res.status(200).json({ assets: await readAssets(), configured: configured(), props: Object.keys(PROPS) });

    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {})) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const redo = body.redo === true;
    switch (action) {
      case "voices": {
        const voices = await listVoices();
        return res.status(200).json({ voices: voices.map((v) => ({ id: v.voice_id, name: v.name, labels: v.labels ?? {} })) });
      }
      case "judy": {
        const lines = cleanLines(body.lines);
        if (!lines.length) return fail(res, 400, "no_lines", "Send Judy's lines.");
        const voiceId = typeof body.voiceId === "string" && /^[\w-]{1,64}$/.test(body.voiceId) ? body.voiceId : undefined;
        return res.status(200).json(await voiceJudy(lines, redo, 4, voiceId));
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
