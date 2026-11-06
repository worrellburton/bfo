import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cronAuth, currentUser, handleError, isAdmin, refuseCron, type AppUser } from "../../lib/auth.js";
import { audit } from "../../lib/audit.js";
import { recordCronRun, type CronRun } from "../../lib/cron.js";
import { checkStateRecords } from "../../lib/state-records.js";

/**
 * Every entity's state records, read through Palm (lib/state-records.ts):
 * each home state and each state it's registered in as a foreign entity.
 * Records read in the last week are skipped.
 *
 * GET  → the Vercel cron (Bearer CRON_SECRET, required)
 * POST { ids?, force? } → "Check all" from the app (owner or admin); recorded in the audit log
 *
 * Both stop starting reads 240 s in (the function may run 300 s, and each Palm
 * call up to 20 s); what's left answers "later", for the next run.
 */

const BUDGET_MS = 240_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  try {
    // GET is the cron only, and must present Bearer $CRON_SECRET.
    const fromCron = req.method === "GET";
    const started = Date.now();
    let opts: { ids?: string[]; force?: boolean; by?: { id: string; name: string | null } } = {};
    let actor: AppUser | null = null;
    if (fromCron) {
      const cron = cronAuth(req);
      if (cron !== "ok") return refuseCron(req, res, "state-records", cron);
    } else {
      const user = await currentUser(req);
      if (!user) return res.status(401).json({ error: "unauthorized" });
      if (!isAdmin(user)) return res.status(403).json({ error: "forbidden" });
      const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {})) as { ids?: unknown; force?: unknown };
      actor = user;
      opts = { ids: Array.isArray(body.ids) ? body.ids.map(String).slice(0, 200) : undefined, force: body.force === true, by: { id: user.id, name: user.name } };
    }
    const check = async (run?: CronRun) => {
      const results = await checkStateRecords({ ...opts, deadline: started + BUDGET_MS });
      const counts = results.reduce<Record<string, number>>((n, r) => ((n[r.outcome] = (n[r.outcome] ?? 0) + 1), n), {});
      // The outcome of each, for the logs: who wasn't found or matched more than one entry.
      console.log("state-records", JSON.stringify({ counts, results: results.filter((r) => r.outcome !== "fresh") }));
      if (run) {
        run.note(JSON.stringify(counts));
        // A read that errored leaves that entity's record stale: say so, once per run.
        const errored = results.filter((r) => r.outcome === "error");
        if (errored.length)
          run.failed(`${errored.length} state record${errored.length === 1 ? "" : "s"} couldn't be read: ${errored.map((r) => `${r.name} (${r.state})${r.detail ? `: ${r.detail}` : ""}`).join("; ")}`);
        // A run cut short by its time limit leaves the rest for tomorrow: say so.
        const later = counts.later ?? 0;
        if (later) run.note(`${later} state record${later === 1 ? "" : "s"} left for the next run (out of time)`);
      }
      return { counts, results };
    };
    // The scheduled run is recorded (cron_runs) and alerts the admins when it fails.
    const out = fromCron ? await recordCronRun("state-records", check) : await check();
    // A check someone asked for is billed to the Palm account: who asked, for how many, and what came back.
    if (!fromCron && actor) {
      const read = out.results.filter((r) => r.outcome === "read");
      await audit({
        actor,
        action: "palm.state_check",
        count: new Set(read.map((r) => r.id)).size,
        summary: `Read ${read.length} state record${read.length === 1 ? "" : "s"} through Palm`,
        detail: { asked: opts.ids?.length ?? null, counts: out.counts },
      });
    }
    return res.status(200).json(out);
  } catch (err) {
    return handleError(res, err);
  }
}
