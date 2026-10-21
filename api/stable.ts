import type { VercelRequest, VercelResponse } from "@vercel/node";
import { logActivity } from "../lib/activity.js";
import { canWrite, currentUser, fail, guard, handleError, isPartner, sb, secretMatches } from "../lib/auth.js";
import { accessibleAssetIds } from "../lib/entity-access.js";
import { StableNotConfigured, syncStable, type MailRow } from "../lib/stable.js";
import { storageSignedUrl } from "../lib/storage.js";

/**
 * Paper mail from Stable, as BFO keeps it (lib/stable.ts).
 *
 * GET  ?assetId=x        → { mail }  one entity's pieces (partners: only their entities)
 * GET  ?view=all         → { mail, configured }  every piece, newest first (staff)
 * GET  (Vercel cron)     → catches up on the last week (Bearer CRON_SECRET)
 * POST { action: "assign", id, assetId|null }   which entity a piece is for (staff)
 * POST { action: "read", id }                    mark read
 * POST { action: "sync", days? }                 catch up now (staff)
 */

const ASSET = /^[\w-]{1,128}$/;
const PIECE = /^[\w-]{6,64}$/;

/** A row as the page shows it, with short-lived links to the copies. */
async function present(r: MailRow) {
  const [envelope, scan] = await Promise.all([
    r.envelope_path ? storageSignedUrl(r.envelope_path, 3600, "mail") : null,
    r.scan_path ? storageSignedUrl(r.scan_path, 3600, "mail") : null,
  ]);
  return {
    id: r.id,
    assetId: r.asset_id,
    assigned: r.assigned,
    from: r.from_name,
    recipient: r.recipient,
    recipient2: r.recipient2,
    receivedAt: r.received_at,
    envelopeUrl: envelope,
    scanUrl: scan,
    scanStatus: r.scan_status,
    summary: r.summary,
    checks: r.checks,
    forwardStatus: r.forward_status,
    shredStatus: r.shred_status,
    returnedToSender: r.returned_to_sender,
    archivedAt: r.archived_at,
    readAt: r.read_at,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "POST"])) return;
  try {
    // The hourly catch-up, for anything a webhook missed.
    const cron = process.env.CRON_SECRET;
    if (req.method === "GET" && req.query.cron === "1") {
      const ok = cron ? secretMatches(req.headers.authorization, `Bearer ${cron}`) : !!req.headers["x-vercel-cron-schedule"];
      if (!ok) return fail(res, 401, "unauthorized");
      if (!process.env.STABLE_API_KEY) return res.status(200).json({ synced: 0, configured: false });
      return res.status(200).json({ synced: await syncStable(7) });
    }

    const me = await currentUser(req, { allowPartner: true });
    if (!me) return fail(res, 401, "unauthorized");
    const partner = isPartner(me);
    const mine = partner ? new Set(await accessibleAssetIds(me.id)) : null;

    if (req.method === "GET") {
      const assetId = String(req.query.assetId ?? "");
      if (assetId) {
        if (!ASSET.test(assetId)) return fail(res, 400, "bad_asset");
        if (mine && !mine.has(assetId)) return fail(res, 403, "forbidden");
        const rows = await sb<MailRow[]>(`stable_mail?asset_id=eq.${encodeURIComponent(assetId)}&select=*&order=received_at.desc.nullslast&limit=100`);
        return res.status(200).json({ mail: await Promise.all(rows.map(present)) });
      }
      if (partner) return fail(res, 403, "forbidden");
      const rows = await sb<MailRow[]>(`stable_mail?select=*&order=received_at.desc.nullslast&limit=300`);
      return res.status(200).json({ mail: await Promise.all(rows.map(present)), configured: !!process.env.STABLE_API_KEY });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = String(body.id ?? "");
    if (body.action === "sync") {
      if (!canWrite(me)) return fail(res, 403, "forbidden");
      const days = Math.min(365, Math.max(1, Number(body.days) || 30));
      return res.status(200).json({ synced: await syncStable(days) });
    }
    if (!PIECE.test(id)) return fail(res, 400, "bad_id");
    const row = (await sb<MailRow[]>(`stable_mail?id=eq.${encodeURIComponent(id)}&select=*&limit=1`))[0];
    if (!row) return fail(res, 404, "not_found");
    if (mine && !(row.asset_id && mine.has(row.asset_id))) return fail(res, 403, "forbidden");

    if (body.action === "read") {
      if (!row.read_at) await sb(`stable_mail?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: { read_at: new Date().toISOString() } });
      return res.status(200).json({ ok: true });
    }
    if (body.action === "assign") {
      if (!canWrite(me)) return fail(res, 403, "forbidden");
      const assetId = body.assetId == null || body.assetId === "" ? null : String(body.assetId);
      if (assetId && !ASSET.test(assetId)) return fail(res, 400, "bad_asset");
      const [updated] = await sb<MailRow[]>(`stable_mail?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        prefer: "return=representation",
        body: { asset_id: assetId, assigned: "hand" },
      });
      if (assetId && updated) await logActivity(assetId, { id: me.id, name: me.name || me.email, source: "user" }, [{ kind: "mail", summary: `Filed paper mail from ${updated.from_name || "an unknown sender"} here`, detail: { mailId: id } }]);
      return res.status(200).json({ mail: await present(updated) });
    }
    return fail(res, 400, "unknown_action");
  } catch (err) {
    if (err instanceof StableNotConfigured) return fail(res, 503, "not_configured", err.message);
    return handleError(res, err);
  }
}
