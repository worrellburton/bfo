import type { VercelRequest, VercelResponse } from "@vercel/node";
import { logActivity } from "../lib/activity.js";
import { audit } from "../lib/audit.js";
import { canWrite, cronAuth, currentUser, fail, guard, handleError, isPartner, refuseCron, sb, sbFetch, type AppUser } from "../lib/auth.js";
import { recordCronRun } from "../lib/cron.js";
import { accessibleAssetIds } from "../lib/entity-access.js";
import { needsReading, readingFailed, readPiece, ReadingUnavailable, toReading } from "../lib/paper-read.js";
import { checksOf, StableNotConfigured, syncStable, type MailRow, type StableMailItem } from "../lib/stable.js";
import { storageSignedUrl } from "../lib/storage.js";
import { readCollection } from "../lib/tree.js";

/**
 * Paper mail from Stable, as BFO keeps it (lib/stable.ts).
 *
 * GET  ?id=x             → { mail }  one piece in full: Stable's details, its checks, who filed it (filing),
 *                                    and what BFO read off it
 * GET  ?assetId=x        → { mail }  one entity's pieces (partners: only their entities, and only pieces
 *                                    staff filed or confirmed; an auto-filed piece waits for staff)
 * GET  ?view=all[&filter=unread|unfiled|checks][&asset=x][&kind=tax,legal][&before=iso]
 *                        → { mail, more, counts, checks, configured, lastSync }  newest first, 100 at a time (staff)
 * GET  ?view=count       → { unread }  for the sidebar's badge (staff)
 * GET  (Vercel cron)     → catches up on the last week (Bearer CRON_SECRET)
 * POST { action: "assign", id, assetId|null }   which entity a piece is for (staff); recorded in the audit
 *                                                log and on both entities' activity
 * POST { action: "confirm", id }                 staff agree with the automatic match, so partners see it
 * POST { action: "link", id, which }             a fresh five-minute link to the envelope or scan, after
 *                                                checking access again ("Open original")
 * POST { action: "read", id }                    mark read
 * POST { action: "read-piece", id, force? }      read the envelope and scan (lib/paper-read.ts) when
 *                                                the reading is out of date; force (staff) reads again
 * POST { action: "sync", days? }                 catch up now (staff); recorded with the hourly runs
 *
 * Who may call it: approved owners, admins and members (staff); viewers read; partners only their
 * entities' confirmed pieces. Env: STABLE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY; CRON_SECRET for the cron.
 */

const ASSET = /^[\w-]{1,128}$/;
const PIECE = /^[\w-]{6,64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/;
const KINDS = new Set(["bill", "statement", "check", "tax", "government", "legal", "bank", "insurance", "notice", "personal", "marketing", "other"]);
const PAGE = 100;
/** Links to the copies last five minutes: long enough to load, too short to pass around. */
const LINK_SECONDS = 300;
const WRITERS = "Only owners, admins and members can file paper mail or check Stable.";

type FilingEntry = { from: string | null; to: string | null; by: string; at: string; confirmed?: boolean };
type AuditRead = { target_id: string; action: string; actor_name: string | null; at: string; detail: Record<string, unknown> | null };

/** Who filed each piece, newest first, from the audit log (empty while it isn't applied). */
async function filingFor(ids: string[]): Promise<Map<string, FilingEntry[]>> {
  const out = new Map<string, FilingEntry[]>();
  if (!ids.length) return out;
  try {
    const list = ids.map((i) => encodeURIComponent(`"${i}"`)).join(",");
    const rows =
      (await sb<AuditRead[] | null>(
        `audit_log?target_type=eq.paper_mail&target_id=in.(${list})&action=in.(paper_mail.file,paper_mail.unfile,paper_mail.confirm)&select=target_id,action,actor_name,at,detail&order=at.desc&limit=1000`,
      )) ?? [];
    for (const a of rows) {
      const d = a.detail ?? {};
      const entry: FilingEntry = {
        from: typeof d.from === "string" ? d.from : null,
        to: typeof d.to === "string" ? d.to : null,
        by: a.actor_name || "Someone in the office",
        at: a.at,
        ...(a.action === "paper_mail.confirm" ? { confirmed: true } : {}),
      };
      out.set(a.target_id, [...(out.get(a.target_id) ?? []), entry]);
    }
  } catch {
    // No audit log yet: the page simply shows no history.
  }
  return out;
}

/** "5227 N 7th St #100, Phoenix, AZ 85014": line 1 and 2, then "City, ST ZIP". Pure. */
export function addressLine(a: { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postalCode?: string | null } | null | undefined): string | null {
  if (!a) return null;
  const street = [a.line1, a.line2].filter(Boolean).join(" ").trim();
  const place = [a.city, [a.state, a.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ").trim();
  return [street, place].filter(Boolean).join(", ") || null;
}

/** A row as the page shows it, with short-lived links to the copies. */
async function present(r: MailRow, filing?: FilingEntry[]) {
  // A link that can't be signed just isn't shown; the list still loads.
  const link = (path: string) => storageSignedUrl(path, LINK_SECONDS, "mail").catch((err) => (console.error("stable: couldn't sign a link", { failed: !!err }), null));
  const [envelope, scan] = await Promise.all([r.envelope_path ? link(r.envelope_path) : null, r.scan_path ? link(r.scan_path) : null]);
  const reading = r.reading ? toReading(r.reading, !!(r.reading as { fromScan?: boolean }).fromScan) : null;
  const checks = checksOf(r.data);
  const known = checks.filter((c) => c.amountCents !== null);
  const filed = filing?.find((f) => !f.confirmed) ?? null;
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
    /** The checks' total, in cents, when Stable gave every amount; null otherwise. */
    checkCents: checks.length && known.length === checks.length ? known.reduce((n, c) => n + (c.amountCents ?? 0), 0) : null,
    checkPayer: checks.find((c) => c.payer)?.payer ?? null,
    forwardStatus: r.forward_status,
    shredStatus: r.shred_status,
    returnedToSender: r.returned_to_sender,
    archivedAt: r.archived_at,
    readAt: r.read_at,
    kind: reading?.kind ?? null,
    urgency: reading?.urgency ?? null,
    filedBy: filed ? filed.by : null,
    filedAt: filed ? filed.at : null,
  };
}

/** One piece in full: the list's fields, what else Stable says, its checks and filing history, and BFO's reading. */
async function presentFull(r: MailRow) {
  const d: StableMailItem = r.data ?? { id: r.id };
  const filing = (await filingFor([r.id])).get(r.id) ?? [];
  return {
    ...(await present(r, filing)),
    scanIsPdf: !!r.scan_path?.toLowerCase().endsWith(".pdf"),
    barcode: d.barcodeId ?? null,
    receivedAddress: addressLine(d.location?.address),
    clearAt: d.clearAt ?? null,
    stableReadAt: d.readAt ?? null,
    forwardTracking: d.forwardDetails?.trackingNumber ?? null,
    depositStatus: d.depositDetails?.status ?? null,
    checkList: checksOf(d),
    filing,
    tags: (d.tags ?? []).map((x) => (typeof x === "string" ? x : (x as { name?: string })?.name)).filter((x): x is string => !!x),
    stableBusiness: d.recipients?.business?.name ?? null,
    reading: r.reading ? toReading(r.reading, !!(r.reading as { fromScan?: boolean }).fromScan) : null,
    readingAt: r.reading_at ?? null,
    readingStale: needsReading(r),
    readingFailed: readingFailed(r),
  };
}

/** Rows matching a filter, counted without reading them. */
async function count(filter: string): Promise<number | null> {
  try {
    const res = await sbFetch(`stable_mail?select=id&limit=1${filter}`, { headers: { Prefer: "count=exact" } });
    if (!res.ok) return null;
    const total = Number((res.headers.get("content-range") ?? "").split("/")[1]);
    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}

/** When BFO last heard from Stable (the hourly catch-up or Check now), and whether the newest try failed. */
async function lastSync(): Promise<{ at: string | null; failedAt: string | null } | null> {
  try {
    const runs =
      (await sb<{ started_at: string; finished_at: string | null; ok: boolean | null }[] | null>("cron_runs?name=eq.stable&select=started_at,finished_at,ok&order=started_at.desc&limit=20")) ?? [];
    const good = runs.find((x) => x.ok === true);
    const newest = runs.find((x) => x.finished_at);
    return { at: good?.finished_at ?? null, failedAt: newest && newest.ok === false ? newest.finished_at : null };
  } catch {
    return null;
  }
}

/** The checks across every piece that has one: how many, the total of the amounts Stable gave, and since when. */
async function checkSummary(): Promise<{ pieces: number; checks: number; cents: number; unknown: number; since: string | null }> {
  const rows = (await sb<{ received_at: string | null; data: StableMailItem | null }[] | null>("stable_mail?checks=gt.0&select=received_at,data&order=received_at.asc.nullslast&limit=1000")) ?? [];
  let checks = 0;
  let cents = 0;
  let unknown = 0;
  for (const r of rows) {
    for (const c of checksOf(r.data)) {
      checks++;
      if (c.amountCents === null) unknown++;
      else cents += c.amountCents;
    }
  }
  return { pieces: rows.length, checks, cents, unknown, since: rows[0]?.received_at ?? null };
}

/** Entity names by id, for activity lines ("Moved to Northwind Holdings, LLC"). */
async function entityNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.some(Boolean)) return out;
  try {
    for (const r of await readCollection("assets")) {
      const name = (r.data as { name?: string } | null)?.name;
      if (name) out.set(r.id, name);
    }
  } catch {
    // Ids stand in for names.
  }
  return out;
}

const actorOf = (me: AppUser) => ({ id: me.id, name: me.name || me.email || null, role: me.role });

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
    /** A partner sees a piece only on their entity, and only once staff filed or confirmed it. */
    const partnerMay = (row: MailRow) => !mine || (!!row.asset_id && mine.has(row.asset_id) && row.assigned === "hand");

    if (req.method === "GET") {
      const one = String(req.query.id ?? "");
      if (one) {
        if (!PIECE.test(one)) return fail(res, 400, "bad_id");
        const row = (await sb<MailRow[]>(`stable_mail?id=eq.${encodeURIComponent(one)}&select=*&limit=1`))[0];
        if (!row) return fail(res, 404, "not_found");
        if (!partnerMay(row)) return fail(res, 403, "forbidden");
        const full = await presentFull(row);
        // Partners never get the office's own filing record.
        return res.status(200).json({ mail: partner ? { ...full, filing: [], filedBy: null, filedAt: null } : full });
      }
      const assetId = String(req.query.assetId ?? "");
      if (assetId) {
        if (!ASSET.test(assetId)) return fail(res, 400, "bad_asset");
        if (mine && !mine.has(assetId)) return fail(res, 403, "forbidden");
        const rows = await sb<MailRow[]>(`stable_mail?asset_id=eq.${encodeURIComponent(assetId)}${partner ? "&assigned=eq.hand" : ""}&select=*&order=received_at.desc.nullslast&limit=100`);
        return res.status(200).json({ mail: await Promise.all(rows.map((r) => present(r))) });
      }
      if (partner) return fail(res, 403, "forbidden");
      if (req.query.view === "count") return res.status(200).json({ unread: (await count("&read_at=is.null")) ?? 0 });

      const filter = String(req.query.filter ?? "");
      const parts: string[] = [];
      if (filter === "unread") parts.push("read_at=is.null");
      else if (filter === "unfiled") parts.push("asset_id=is.null");
      else if (filter === "checks") parts.push("checks=gt.0");
      const asset = String(req.query.asset ?? "");
      if (asset && ASSET.test(asset)) parts.push(`asset_id=eq.${encodeURIComponent(asset)}`);
      const kinds = String(req.query.kind ?? "")
        .split(",")
        .filter((k) => KINDS.has(k));
      if (kinds.length) parts.push(`reading->>kind=in.(${kinds.join(",")})`);
      const before = String(req.query.before ?? "");
      if (ISO.test(before)) parts.push(`received_at=lt.${encodeURIComponent(before)}`);
      const where = parts.map((p) => `&${p}`).join("");
      const rows = (await sb<MailRow[] | null>(`stable_mail?select=*${where}&order=received_at.desc.nullslast,id.desc&limit=${PAGE}`)) ?? [];
      const filing = await filingFor(rows.map((r) => r.id));
      const [mail, all, unread, unfiled, withChecks, checks, sync] = await Promise.all([
        Promise.all(rows.map((r) => present(r, filing.get(r.id)))),
        count(""),
        count("&read_at=is.null"),
        count("&asset_id=is.null"),
        count("&checks=gt.0"),
        filter === "checks" ? checkSummary().catch(() => null) : Promise.resolve(null),
        lastSync(),
      ]);
      return res.status(200).json({
        mail,
        more: rows.length === PAGE,
        counts: { all, unread, unfiled, checks: withChecks },
        checks,
        configured: !!process.env.STABLE_API_KEY,
        lastSync: sync,
      });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = String(body.id ?? "");
    if (body.action === "sync") {
      if (!canWrite(me)) return fail(res, 403, "forbidden", WRITERS);
      const days = Math.min(365, Math.max(1, Number(body.days) || 30));
      // Recorded with the hourly runs, so "Checked with Stable" counts it.
      const synced = await recordCronRun("stable", async (run) => {
        run.note(`Run by hand: the last ${days} days`);
        return syncStable(days);
      });
      return res.status(200).json({ synced, lastSync: await lastSync() });
    }
    if (!PIECE.test(id)) return fail(res, 400, "bad_id");
    const row = (await sb<MailRow[]>(`stable_mail?id=eq.${encodeURIComponent(id)}&select=*&limit=1`))[0];
    if (!row) return fail(res, 404, "not_found");
    if (!partnerMay(row)) return fail(res, 403, "forbidden");

    if (body.action === "read") {
      // Read means the office has seen it: a partner opening a piece leaves it unread for staff.
      if (!row.read_at && !partner) await sb(`stable_mail?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: { read_at: new Date().toISOString() } });
      return res.status(200).json({ ok: true });
    }
    if (body.action === "link") {
      // Access was checked again above; the link itself lasts five minutes.
      const path = body.which === "envelope" ? row.envelope_path : row.scan_path;
      if (!path) return fail(res, 404, "not_found");
      const url = await storageSignedUrl(path, LINK_SECONDS, "mail");
      if (!url) return fail(res, 404, "not_found");
      return res.status(200).json({ url });
    }
    if (body.action === "read-piece") {
      // Each reading is a paid model call: only when the copies changed, or staff ask again.
      if (!needsReading(row) && !(body.force === true && canWrite(me))) return res.status(200).json({ mail: await presentFull(row) });
      try {
        await readPiece(row);
      } catch (err) {
        if (err instanceof ReadingUnavailable) return fail(res, 422, "unreadable", err.message);
        throw err;
      }
      const fresh = (await sb<MailRow[]>(`stable_mail?id=eq.${encodeURIComponent(id)}&select=*&limit=1`))[0] ?? row;
      const full = await presentFull(fresh);
      return res.status(200).json({ mail: partner ? { ...full, filing: [], filedBy: null, filedAt: null } : full });
    }
    if (body.action === "confirm") {
      if (!canWrite(me)) return fail(res, 403, "forbidden", WRITERS);
      if (!row.asset_id) return fail(res, 409, "not_filed", "Choose an entity first.");
      const [updated] = await sb<MailRow[]>(`stable_mail?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", prefer: "return=representation", body: { assigned: "hand" } });
      const names = await entityNames([row.asset_id]);
      const label = `Paper mail from ${row.from_name || "an unknown sender"}`;
      await audit({
        actor: actorOf(me),
        action: "paper_mail.confirm",
        target: { type: "paper_mail", id, label },
        summary: `Confirmed ${label} belongs to ${names.get(row.asset_id) ?? "its entity"}`,
        detail: { to: row.asset_id },
      });
      const fresh = updated ?? { ...row, assigned: "hand" as const };
      return res.status(200).json({ mail: await present(fresh, (await filingFor([id])).get(id)) });
    }
    if (body.action === "assign") {
      if (!canWrite(me)) return fail(res, 403, "forbidden", WRITERS);
      const assetId = body.assetId == null || body.assetId === "" ? null : String(body.assetId);
      if (assetId && !ASSET.test(assetId)) return fail(res, 400, "bad_asset");
      const prior = row.asset_id;
      const [updated] = await sb<MailRow[]>(`stable_mail?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        prefer: "return=representation",
        body: { asset_id: assetId, assigned: "hand" },
      });
      if (prior !== assetId) {
        const names = await entityNames([prior, assetId]);
        const name = (x: string | null) => (x ? (names.get(x) ?? "another entity") : "no entity");
        const from = row.from_name || "an unknown sender";
        const label = `Paper mail from ${from}`;
        await audit({
          actor: actorOf(me),
          action: assetId ? "paper_mail.file" : "paper_mail.unfile",
          target: { type: "paper_mail", id, label },
          summary: assetId ? `Filed ${label} under ${name(assetId)}${prior ? `, from ${name(prior)}` : ""}` : `Unfiled ${label} from ${name(prior)}`,
          detail: { from: prior, to: assetId },
        });
        const who = { id: me.id, name: me.name || me.email, source: "user" as const };
        if (assetId) await logActivity(assetId, who, [{ kind: "mail", summary: `Filed paper mail from ${from} here`, detail: { mailId: id } }]);
        if (prior)
          await logActivity(prior, who, [
            { kind: "mail", summary: assetId ? `Moved paper mail from ${from} to ${name(assetId)}` : `Unfiled paper mail from ${from}`, detail: { mailId: id, to: assetId } },
          ]);
      }
      return res.status(200).json({ mail: await present(updated ?? { ...row, asset_id: assetId, assigned: "hand" }, (await filingFor([id])).get(id)) });
    }
    return fail(res, 400, "unknown_action");
  } catch (err) {
    if (err instanceof StableNotConfigured) return fail(res, 503, "not_configured", "Paper mail isn't connected yet.");
    return handleError(res, err);
  }
}
