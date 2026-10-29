import type { VercelRequest, VercelResponse } from "@vercel/node";
import { logActivity } from "../lib/activity.js";
import { canWrite, cronAuth, currentUser, fail, guard, handleError, isPartner, refuseCron, sb } from "../lib/auth.js";
import { recordCronRun } from "../lib/cron.js";
import { accessibleAssetIds } from "../lib/entity-access.js";
import { needsReading, readPiece, ReadingUnavailable, toReading } from "../lib/paper-read.js";
import { StableNotConfigured, syncStable, type MailRow, type StableMailItem } from "../lib/stable.js";
import { storageSignedUrl } from "../lib/storage.js";

/**
 * Paper mail from Stable, as BFO keeps it (lib/stable.ts).
 *
 * GET  ?id=x             → { mail }  one piece in full: Stable's details and what BFO read off it
 * GET  ?assetId=x        → { mail }  one entity's pieces (partners: only their entities)
 * GET  ?view=all         → { mail, configured }  every piece, newest first (staff)
 * GET  (Vercel cron)     → catches up on the last week (Bearer CRON_SECRET)
 * POST { action: "assign", id, assetId|null }   which entity a piece is for (staff)
 * POST { action: "read", id }                    mark read
 * POST { action: "read-piece", id }              read the envelope and scan (lib/paper-read.ts)
 * POST { action: "sync", days? }                 catch up now (staff)
 */

const ASSET = /^[\w-]{1,128}$/;
const PIECE = /^[\w-]{6,64}$/;

/** A row as the page shows it, with short-lived links to the copies. */
async function present(r: MailRow) {
  // A link that can't be signed just isn't shown; the list still loads.
  const link = (path: string) => storageSignedUrl(path, 3600, "mail").catch((err) => (console.error("stable: couldn't sign a link", err), null));
  const [envelope, scan] = await Promise.all([r.envelope_path ? link(r.envelope_path) : null, r.scan_path ? link(r.scan_path) : null]);
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

/** One piece in full: the list's fields, what else Stable says, and BFO's reading. */
async function presentFull(r: MailRow) {
  const d: StableMailItem = r.data ?? { id: r.id };
  const a = d.location?.address;
  return {
    ...(await present(r)),
    scanIsPdf: !!r.scan_path?.toLowerCase().endsWith(".pdf"),
    barcode: d.barcodeId ?? null,
    receivedAddress: a ? [[a.line1, a.line2].filter(Boolean).join(" "), [a.city, a.state].filter(Boolean).join(", "), a.postalCode].filter(Boolean).join(", ") : null,
    clearAt: d.clearAt ?? null,
    stableReadAt: d.readAt ?? null,
    forwardTracking: d.forwardDetails?.trackingNumber ?? null,
    depositStatus: d.depositDetails?.status ?? null,
    tags: (d.tags ?? []).map((x) => (typeof x === "string" ? x : (x as { name?: string })?.name)).filter((x): x is string => !!x),
    stableBusiness: d.recipients?.business?.name ?? null,
    reading: r.reading ? toReading(r.reading, !!(r.reading as { fromScan?: boolean }).fromScan) : null,
    readingAt: r.reading_at ?? null,
    readingStale: needsReading(r),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "POST"])) return;
  try {
    // The hourly catch-up, for anything a webhook missed. Bearer CRON_SECRET only.
    if (req.method === "GET" && req.query.cron === "1") {
      const cron = cronAuth(req);
      if (cron !== "ok") return refuseCron(req, res, "stable", cron);
      if (!process.env.STABLE_API_KEY) return res.status(200).json({ synced: 0, configured: false });
      // Recorded in cron_runs; a sync that fails leaves the mailbox stale, so the admins hear about it.
      return res.status(200).json({ synced: await recordCronRun("stable", () => syncStable(7)) });
    }

    const me = await currentUser(req, { allowPartner: true });
    if (!me) return fail(res, 401, "unauthorized");
    const partner = isPartner(me);
    const mine = partner ? new Set(await accessibleAssetIds(me.id)) : null;

    if (req.method === "GET") {
      const one = String(req.query.id ?? "");
      if (one) {
        if (!PIECE.test(one)) return fail(res, 400, "bad_id");
        const row = (await sb<MailRow[]>(`stable_mail?id=eq.${encodeURIComponent(one)}&select=*&limit=1`))[0];
        if (!row) return fail(res, 404, "not_found");
        if (mine && !(row.asset_id && mine.has(row.asset_id))) return fail(res, 403, "forbidden");
        return res.status(200).json({ mail: await presentFull(row) });
      }
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
    if (body.action === "read-piece") {
      try {
        await readPiece(row);
      } catch (err) {
        if (err instanceof ReadingUnavailable) return fail(res, 422, "unreadable", err.message);
        throw err;
      }
      const fresh = (await sb<MailRow[]>(`stable_mail?id=eq.${encodeURIComponent(id)}&select=*&limit=1`))[0] ?? row;
      return res.status(200).json({ mail: await presentFull(fresh) });
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
