import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, fail, guard, handleError, isAdmin, sb } from "../lib/auth.js";

/**
 * The System card on the Notifications page (owners and admins).
 *
 * GET → { alerts, crons }: the last 50 ops_alerts (lib/alert.ts) and each
 *       cron's most recent run from cron_runs (lib/cron.ts).
 * POST { action: "ack", id } → marks an alert acknowledged.
 */

export type OpsAlert = { id: string; kind: string; title: string; detail: string | null; created_at: string; acknowledged_at: string | null };
export type CronRunRow = { id: string; name: string; started_at: string; finished_at: string | null; ok: boolean | null; note: string | null };

/** Every cron Vercel schedules (vercel.json), so one that never ran still shows. */
export const CRON_NAMES = ["treasury-report", "books-sync", "stable", "state-records", "investment-history"];

/** The newest run of each cron, in CRON_NAMES order, then any other name seen. */
export function latestRuns(rows: CronRunRow[]): Array<CronRunRow | { name: string; started_at: null; finished_at: null; ok: null; note: null; id: null }> {
  const latest = new Map<string, CronRunRow>();
  for (const r of rows) if (!latest.has(r.name)) latest.set(r.name, r);
  const names = [...CRON_NAMES, ...[...latest.keys()].filter((n) => !CRON_NAMES.includes(n))];
  return names.map((name) => latest.get(name) ?? { id: null, name, started_at: null, finished_at: null, ok: null, note: null });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "POST"])) return;
  try {
    const me = await currentUser(req);
    if (!me) return fail(res, 401, "unauthorized");
    if (!isAdmin(me)) return fail(res, 403, "forbidden");

    if (req.method === "GET") {
      const [alerts, runs] = await Promise.all([
        sb<OpsAlert[]>("ops_alerts?select=*&order=created_at.desc&limit=50"),
        sb<CronRunRow[]>("cron_runs?select=*&order=started_at.desc&limit=200"),
      ]);
      return res.status(200).json({ alerts: alerts ?? [], crons: latestRuns(runs ?? []) });
    }

    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {}) as { action?: unknown; id?: unknown };
    if (body.action !== "ack") return fail(res, 400, "unknown_action");
    const id = String(body.id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(res, 400, "bad_id");
    const [row] = await sb<OpsAlert[]>(`ops_alerts?id=eq.${id}&acknowledged_at=is.null`, {
      method: "PATCH",
      prefer: "return=representation",
      body: { acknowledged_at: new Date().toISOString() },
    });
    return res.status(200).json({ ok: true, alert: row ?? null });
  } catch (err) {
    return handleError(res, err);
  }
}
