import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, handleError, isAdmin } from "../lib/auth.js";
import { syncAllWithPalm } from "../lib/palm-sync.js";

/**
 * "Sync everything with Palm" for every entity (the Entities page): see
 * lib/palm-sync.ts. Owners and admins only, since reading state records is
 * billed by Palm on a live key.
 *
 * POST { ids? } → { mode, entities: [{ id, name, lines: [{ label, tone, text }] }] }
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: "unauthorized" });
    if (!isAdmin(user)) return res.status(403).json({ error: "forbidden", message: "Only an owner or admin can sync with Palm (state records are billed)." });
    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {}) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter((id) => /^[\w-]{1,80}$/.test(id)).slice(0, 300) : undefined;
    return res.status(200).json(await syncAllWithPalm({ ids, by: { id: user.id, name: user.name } }));
  } catch (err) {
    if (err instanceof Error && /Palm isn't connected/.test(err.message)) return res.status(503).json({ error: "not_connected", message: err.message });
    return handleError(res, err);
  }
}
