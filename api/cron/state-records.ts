import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, handleError, isAdmin, secretMatches } from "../../lib/auth.js";
import { checkStateRecords } from "../../lib/state-records.js";

/**
 * Every entity's state records, read through Palm (lib/state-records.ts):
 * each home state and each state it's registered in as a foreign entity.
 * Records read in the last week are skipped.
 *
 * GET  → the Vercel cron (Bearer CRON_SECRET when set, like books-sync)
 * POST { ids?, force? } → "Check all" from the app (owner or admin)
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  try {
    const cronSecret = process.env.CRON_SECRET;
    const fromCron =
      req.method === "GET" && (cronSecret ? secretMatches(req.headers.authorization, `Bearer ${cronSecret}`) : !!req.headers["x-vercel-cron-schedule"]);
    let opts: { ids?: string[]; force?: boolean } = {};
    if (!fromCron) {
      const user = await currentUser(req);
      if (!user) return res.status(401).json({ error: "unauthorized" });
      if (!isAdmin(user)) return res.status(403).json({ error: "forbidden" });
      const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {}) as { ids?: unknown; force?: unknown };
      opts = { ids: Array.isArray(body.ids) ? body.ids.map(String).slice(0, 200) : undefined, force: body.force === true };
    }
    const results = await checkStateRecords(opts);
    const counts = results.reduce<Record<string, number>>((n, r) => ((n[r.outcome] = (n[r.outcome] ?? 0) + 1), n), {});
    // The outcome of each, for the logs: who wasn't found or matched more than one entry.
    console.log("state-records", JSON.stringify({ counts, results: results.filter((r) => r.outcome !== "fresh") }));
    return res.status(200).json({ counts, results });
  } catch (err) {
    return handleError(res, err);
  }
}
