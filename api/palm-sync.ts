import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, handleError, isAdmin } from "../lib/auth.js";
import { palmMode } from "../lib/palm.js";
import { bulkPlan, checkAllEins, monitorAll } from "../lib/palm-monitor.js";
import { syncAllWithPalm } from "../lib/palm-sync.js";

/**
 * "Sync everything with Palm" for every entity (the Entities page): see
 * lib/palm-sync.ts. Owners and admins only, since reading state records is
 * billed by Palm on a live key.
 *
 * POST { ids? } → { mode, entities: [{ id, name, lines: [{ label, tone, text }] }] }
 *
 * The other bulk actions, same shape back (lib/palm-monitor.ts):
 *   { action: "plan" }                 → { mode, monitor: { count, cents, on }, ein: { count, cents, settled } }
 *   { action: "monitor-all", mode }    → Palm watches every registration not yet watched ($1.99/month each, live)
 *   { action: "ein-all", mode }        → the IRS asked about every EIN not yet confirmed (99¢ each, live)
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: "unauthorized" });
    if (!isAdmin(user)) return res.status(403).json({ error: "forbidden", message: "Only an owner or admin can sync with Palm (state records are billed)." });
    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {}) as { ids?: unknown; action?: unknown; mode?: unknown };
    const action = typeof body.action === "string" ? body.action : "sync";
    if (action !== "sync") {
      const mode = palmMode();
      if (!mode) return res.status(503).json({ error: "not_connected", message: "Palm isn't connected." });
      if (action === "plan") return res.status(200).json({ mode, ...(await bulkPlan(mode)) });
      // A billed bulk action runs only in the mode the page showed its price in.
      if (body.mode !== mode) return res.status(409).json({ error: "mode_changed", mode, message: `Palm is now in ${mode} mode. Reload the page and check again before going on.` });
      const by = { id: user.id, name: user.name };
      if (action === "monitor-all") return res.status(200).json({ mode, entities: await monitorAll({ mode, by }) });
      if (action === "ein-all") return res.status(200).json({ mode, entities: await checkAllEins({ mode, by }) });
      return res.status(400).json({ error: "bad_action" });
    }
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter((id) => /^[\w-]{1,80}$/.test(id)).slice(0, 300) : undefined;
    return res.status(200).json(await syncAllWithPalm({ ids, by: { id: user.id, name: user.name } }));
  } catch (err) {
    if (err instanceof Error && /Palm isn't connected/.test(err.message)) return res.status(503).json({ error: "not_connected", message: err.message });
    return handleError(res, err);
  }
}
