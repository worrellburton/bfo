/**
 * Archive an entity instead of deleting it (docs/DESIGN.md §11.1), restore
 * it, or remove a record that was made by mistake. The rules are in
 * lib/entity-archive.ts.
 *
 * POST { assetId, action: "archive" | "restore" | "remove", reason? } → { ok: true }
 *   archive  hides it from the lists and makes it read-only; everything is
 *            kept, and it still exists with the state.
 *   restore  brings it back.
 *   remove   deletes the record, only when nothing is on record for it
 *            (409 keep_it otherwise: archive it). Its place on the Estate
 *            Map goes with it; nothing it owned is re-parented (it owns
 *            nothing, or it couldn't be removed).
 *
 * Who may call it: owners and admins (403 owner_or_admin; a partner gets
 * 403 through currentUser). Each action is written through the tree, so the
 * entity's Activity records it, and to the shared audit trail (lib/audit.ts),
 * which outlives a removed record.
 *
 * Env: SUPABASE_URL and SUPABASE_SERVICE_KEY (through sb() in lib/auth.ts).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit } from "../lib/audit.js";
import { currentUser, fail, guard, handleError, isAdmin, sb } from "../lib/auth.js";
import { archiveRefusal, standingOf, type ArchiveAction } from "../lib/entity-archive.js";
import { applyOps, readRows } from "../lib/tree.js";

const ACTIONS: ArchiveAction[] = ["archive", "restore", "remove"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["POST"])) return;
  try {
    const me = await currentUser(req);
    if (!me) return fail(res, 401, "unauthorized");
    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {})) as { assetId?: unknown; action?: unknown; reason?: unknown };
    const assetId = typeof body.assetId === "string" ? body.assetId.trim() : "";
    const action = ACTIONS.find((a) => a === body.action);
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (!assetId || !/^[^.$#[\]/]{1,768}$/.test(assetId)) return fail(res, 400, "bad_asset");
    if (!action) return fail(res, 400, "bad_action");

    const row = (await readRows("assets", [assetId]))[0];
    const children = (await sb<{ id: string }[]>(`tree_nodes?collection=eq.assets&select=id&data->>ownerId=eq.${encodeURIComponent(assetId)}`)) ?? [];
    const refusal = archiveRefusal(action, row?.data ?? null, { admin: isAdmin(me), childCount: children.length });
    if (refusal) return fail(res, refusal.status, refusal.code, refusal.message);

    const data = (row!.data ?? {}) as Record<string, unknown>;
    const name = typeof data.name === "string" ? data.name : "an entity";
    const actor = { id: me.id, name: me.name || me.email || me.phone || null, source: "user" as const };
    const target = { type: "entity", id: assetId, label: name };

    if (action === "archive") {
      await applyOps([{ op: "update", path: ["assets", assetId], value: { archived: { at: Date.now(), by: actor.name, byId: me.id, reason } } }], actor);
      await audit({ actor: me, action: "entity.archive", target, summary: `Archived ${name}`, detail: { reason: reason || null, ein: typeof data.ein === "string" ? data.ein : null } });
    } else if (action === "restore") {
      await applyOps([{ op: "update", path: ["assets", assetId], value: { archived: null } }], actor);
      await audit({ actor: me, action: "entity.restore", target, summary: `Restored ${name} from the archive` });
    } else {
      // Its node on the Estate Map, by name, goes with it (the map keeps its own tree).
      const map = (await readRows("estate-map", ["entities"]))[0]?.data;
      const nodes = (Array.isArray(map) ? map : map && typeof map === "object" ? Object.values(map) : []) as { id: string; name?: string; parentId?: string | null }[];
      const node = nodes.find((n) => n && n.name?.trim().toLowerCase() === name.trim().toLowerCase());
      const ops: Parameters<typeof applyOps>[0] = [{ op: "set", path: ["assets", assetId], value: null }];
      if (node)
        ops.push({
          op: "set",
          path: ["estate-map", "entities"],
          value: nodes.filter((n) => n && n.id !== node.id).map((n) => (n.parentId === node.id ? { ...n, parentId: node.parentId ?? null } : n)) as never,
        });
      await applyOps(ops, actor);
      await audit({ actor: me, action: "entity.remove", target, summary: `Removed ${name} from BFO (recorded by mistake; nothing was on record)`, detail: { reason: reason || null, standing: standingOf(data, 0) } });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return handleError(res, err);
  }
}
