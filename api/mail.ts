import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, fail, handleError, isAdmin, sb, type AppUser } from "../lib/auth.js";
import {
  BirdError,
  BUCKET,
  canSee,
  countRows,
  deleteMessages,
  filterClause,
  folderFilter,
  lastSync,
  mailStatus,
  parseSend,
  problemText,
  scopeFilter,
  searchCondition,
  sendMail,
  SendRefused,
  SUMMARY_COLUMNS,
  syncInbound,
  toMessage,
  toSummary,
  UUID_RE,
  type MailFilter,
  type MailFolder,
  type MailRow,
  type SummaryRow,
} from "../lib/mail.js";
import { storageSignedUrl } from "../lib/storage.js";

/**
 * The signed-in user's mail (lib/mail.ts). The mailbox always comes from the
 * session, never from the request. "Other" — mail to addresses nobody has —
 * is for owners and admins only. Email-only users may use this endpoint.
 *
 * GET ?view=
 *   list&folder=inbox|sent|archive|other&filter=all|unread|starred&before=<ISO>&beforeId=<uuid>&limit=50 → { messages, hasMore }
 *     …&q=<text>                     searches every folder the caller can see (folder is ignored)
 *   message&id=<uuid>                → { message }  (marks it read)
 *   count                            → { unread, otherUnread, address|null, canSeeOther, sync? }  (kicks a sync)
 *   attachment&id=<uuid>&att=<id>    → { url }  (signed, 5 minutes)
 *   status                           → setup diagnostics (owner/admin)
 *
 * POST { action, … }:
 *   sync                             → { ingested, error? }
 *   send { sendId, to, cc?, bcc?, subject, text, replyToId?, forwardId?, attachments? } → { message }
 *   move { ids, folder }             → { ok }  (inbox|archive; received mail only)
 *   read { ids, read }               → { ok }
 *   star { ids, starred }            → { ok }
 *   delete { ids }                   → { ok }  (for good)
 *
 * "Not yours" is 403/404, never 401 — the browser signs out on 401.
 */

export const config = { api: { bodyParser: { sizeLimit: "5mb" } } };

const FOLDERS: MailFolder[] = ["inbox", "sent", "archive", "other"];
const FILTERS: MailFilter[] = ["all", "unread", "starred"];
/** A timestamp as the API hands it out (occurredAt), kept exact for paging. */
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}(:?\d{2})?)$/;
/** Keep the badge poll quick; anything left is picked up by the next sync. */
const COUNT_SYNC_BUDGET_MS = 8_000;

function param(req: VercelRequest, name: string): string {
  const v = req.query?.[name];
  return String((Array.isArray(v) ? v[0] : v) ?? "");
}

function idList(v: unknown): string[] | null {
  if (!Array.isArray(v) || !v.length || v.length > 200) return null;
  return v.every((x) => typeof x === "string" && UUID_RE.test(x)) ? [...new Set(v as string[])] : null;
}

/** One of the caller's messages (or a catch-all one, for an admin), or null. */
async function findMessage(me: AppUser, admin: boolean, id: string): Promise<MailRow | null> {
  if (!UUID_RE.test(id)) return null;
  const rows = await sb<MailRow[]>(`mail_messages?id=eq.${id}&${scopeFilter(me.id, admin)}&select=*&limit=1`);
  const row = rows?.[0];
  return row && canSee(row, me.id, admin) ? row : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") return fail(res, 405, "method_not_allowed");

  try {
    const me = await currentUser(req, { allowEmailOnly: true });
    if (!me) return fail(res, 401, "unauthorized");
    const admin = isAdmin(me);
    return req.method === "GET" ? await view(req, res, me, admin) : await act(req, res, me, admin);
  } catch (err) {
    return handleError(res, err);
  }
}

async function view(req: VercelRequest, res: VercelResponse, me: AppUser, admin: boolean) {
  switch (param(req, "view")) {
    case "list": {
      const folder = (param(req, "folder") || "inbox") as MailFolder;
      if (!FOLDERS.includes(folder)) return fail(res, 400, "bad_folder");
      if (folder === "other" && !admin) return fail(res, 403, "forbidden");
      const filter = (param(req, "filter") || "all") as MailFilter;
      if (!FILTERS.includes(filter)) return fail(res, 400, "bad_filter");
      const limit = Math.min(Math.max(Math.floor(Number(param(req, "limit"))) || 50, 1), 100);
      // Page on (occurred_at, id) after the last row shown, so rows sharing its time aren't skipped.
      const before = param(req, "before");
      const beforeId = param(req, "beforeId");
      if (before && (!TIMESTAMP_RE.test(before) || Number.isNaN(Date.parse(before)))) return fail(res, 400, "bad_before");
      if (beforeId && (!before || !UUID_RE.test(beforeId))) return fail(res, 400, "bad_before");
      const at = encodeURIComponent(`"${before}"`);
      // Paging and search go in one and=(…), so neither clashes with the or=(…) an admin's scope uses.
      const conditions = [
        !before ? "" : beforeId ? `or(occurred_at.lt.${at},and(occurred_at.eq.${at},id.lt.${beforeId}))` : `occurred_at.lt.${at}`,
        searchCondition(param(req, "q")),
      ].filter(Boolean);
      const extra = conditions.length ? `&and=(${conditions.join(",")})` : "";
      // A search looks through everything the caller may see, whatever folder is open.
      const where = searchCondition(param(req, "q")) ? scopeFilter(me.id, admin) : folderFilter(folder, me.id, admin);
      const rows = await sb<SummaryRow[]>(
        `mail_messages?${where}${filterClause(filter)}${extra}` +
          `&select=${SUMMARY_COLUMNS}&order=occurred_at.desc,id.desc&limit=${limit + 1}`
      );
      return res.status(200).json({ messages: (rows ?? []).slice(0, limit).map(toSummary), hasMore: (rows ?? []).length > limit });
    }

    case "message": {
      const row = await findMessage(me, admin, param(req, "id"));
      if (!row) return fail(res, 404, "not_found");
      if (!row.read_at) {
        row.read_at = new Date().toISOString();
        await sb(`mail_messages?id=eq.${row.id}`, { method: "PATCH", body: { read_at: row.read_at } });
      }
      return res.status(200).json({ message: toMessage(row) });
    }

    case "count": {
      // An admin assigns addresses; until then there's none (never one from a name the user typed).
      const address = me.mail_address ?? null;
      const sync = await syncInbound({ budgetMs: COUNT_SYNC_BUDGET_MS }).catch((err) => ({ ingested: 0, error: problemText(err), skipped: false }));
      const [unread, otherUnread] = await Promise.all([
        countRows("mail_messages", `${folderFilter("inbox", me.id, admin)}&read_at=is.null`),
        admin ? countRows("mail_messages", `${folderFilter("other", me.id, admin)}&read_at=is.null`) : 0,
      ]);
      const counts = { unread, otherUnread, address, canSeeOther: admin };
      if (!admin) return res.status(200).json(counts);
      const error = sync.skipped ? (await lastSync()).error : sync.error;
      return res.status(200).json({ ...counts, sync: error ? { error } : {} });
    }

    case "attachment": {
      const row = await findMessage(me, admin, param(req, "id"));
      const att = row?.attachments?.find((a) => a.id === param(req, "att"));
      if (!att?.path) return fail(res, 404, "not_found");
      const url = await storageSignedUrl(att.path, 300, BUCKET, att.filename || "attachment");
      if (!url) return fail(res, 404, "not_found");
      return res.status(200).json({ url });
    }

    case "status": {
      if (!admin) return fail(res, 403, "forbidden");
      return res.status(200).json(await mailStatus());
    }

    default:
      return fail(res, 400, "bad_view");
  }
}

async function act(req: VercelRequest, res: VercelResponse, me: AppUser, admin: boolean) {
  let body = req.body ?? {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return fail(res, 400, "bad_json");
    }
  }
  const scope = scopeFilter(me.id, admin);

  switch (String(body?.action ?? "")) {
    case "sync": {
      const r = await syncInbound().catch((err) => ({ ingested: 0, error: problemText(err) }));
      return res.status(200).json(r.error ? { ingested: r.ingested, error: r.error } : { ingested: r.ingested });
    }

    case "send":
      return send(res, me, admin, body);

    case "move": {
      const ids = idList(body.ids);
      if (!ids) return fail(res, 400, "bad_ids");
      if (body.folder !== "inbox" && body.folder !== "archive") return fail(res, 400, "bad_folder");
      await sb(`mail_messages?id=in.(${ids.join(",")})&direction=eq.in&${scope}`, { method: "PATCH", body: { folder: body.folder } });
      return res.status(200).json({ ok: true });
    }

    case "read": {
      const ids = idList(body.ids);
      if (!ids) return fail(res, 400, "bad_ids");
      if (typeof body.read !== "boolean") return fail(res, 400, "bad_read");
      await sb(`mail_messages?id=in.(${ids.join(",")})&${scope}`, {
        method: "PATCH",
        body: { read_at: body.read ? new Date().toISOString() : null },
      });
      return res.status(200).json({ ok: true });
    }

    case "star": {
      const ids = idList(body.ids);
      if (!ids) return fail(res, 400, "bad_ids");
      if (typeof body.starred !== "boolean") return fail(res, 400, "bad_starred");
      await sb(`mail_messages?id=in.(${ids.join(",")})&${scope}`, {
        method: "PATCH",
        body: { starred_at: body.starred ? new Date().toISOString() : null },
      });
      return res.status(200).json({ ok: true });
    }

    case "delete": {
      const ids = idList(body.ids);
      if (!ids) return fail(res, 400, "bad_ids");
      await deleteMessages(ids, scope);
      return res.status(200).json({ ok: true });
    }

    default:
      return fail(res, 400, "bad_action");
  }
}

async function send(res: VercelResponse, me: AppUser, admin: boolean, body: Record<string, unknown>) {
  if (!me.mail_address) return fail(res, 400, "no_address", "You don't have an address yet. Ask an admin.");
  const request = parseSend(body);
  if ("error" in request) return fail(res, 400, request.error, request.message);

  const originalId = request.replyToId ?? request.forwardId;
  const original = originalId ? await findMessage(me, admin, originalId) : null;
  if (originalId && !original) return fail(res, 400, "not_found", "The original message wasn't found.");

  // sendMail checks the daily limit (mail_sends) just before calling Bird; going over is a SendRefused.
  try {
    const row = await sendMail({ id: me.id, name: me.name, address: me.mail_address }, request, original);
    return res.status(200).json({ message: toSummary(row) });
  } catch (err) {
    if (err instanceof SendRefused) return fail(res, 400, err.code, err.message);
    if (err instanceof BirdError) return fail(res, 502, "send_failed", err.message);
    throw err;
  }
}
