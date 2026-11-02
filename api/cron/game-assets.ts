import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cronAuth, guard, handleError, refuseCron } from "../../lib/auth.js";
import { recordCronRun } from "../../lib/cron.js";
import { fillMissing } from "../../lib/game-assets.js";

/**
 * The signing game's assets, kept complete by Vercel (lib/game-assets.ts):
 * every few minutes this voices any of Judy's lines that aren't voiced,
 * makes any sound effect that's missing, moves each prop along at Meshy,
 * and works the request list (brand_settings "game-assets-requests": redo
 * Judy with a given voice, redo a sound, redo a prop with a new prompt).
 * Nothing to do is a cheap no-op.
 *
 * GET → the Vercel cron only (Bearer CRON_SECRET, required). Stops starting
 * work 240 s in; the next run picks up the rest.
 *
 * Env: CRON_SECRET, ELEVENLABS_API_KEY, OPENAI_API_KEY, MESHY_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */

const SITE = "https://www.burtonfamilyoffice.com";
const BUDGET_MS = 240_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET"])) return;
  const cron = cronAuth(req);
  if (cron !== "ok") return refuseCron(req, res, "game-assets", cron);
  try {
    const out = await recordCronRun("game-assets", async (run) => {
      const summary = await fillMissing({ deadline: Date.now() + BUDGET_MS, judyUrl: `${SITE}/game/judy.json` });
      run.note(JSON.stringify(summary));
      if (summary.errors.length) run.failed(summary.errors.join("; "));
      return summary;
    });
    return res.status(200).json(out);
  } catch (err) {
    return handleError(res, err);
  }
}
