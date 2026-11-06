import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxyRemoteImages } from "../lib/mail-image.js";
import Anthropic from "@anthropic-ai/sdk";
import { audit } from "../lib/audit.js";
import { cronAuth, currentUser, fail, guard, handleError, isAdmin, refuseCron, sb, type AppUser } from "../lib/auth.js";
import { recordCronRun } from "../lib/cron.js";
import {
  ACTIVE_ORDER,
  actionSummary,
  activeAfter,
  activeHolds,
  auditLine,
  BirdError,
  BUCKET,
  canSee,
  conversationHeads,
  countRows,
  filterClause,
  folderFilter,
  isHeld,
  liveScope,
  mailSchemaReady,
  pgQuote,
  lastSync,
  mailStatus,
  parseSend,
  problemText,
  purgeExpired,
  purgeMessages,
  restoreMessages,
  scopeFilter,
  searchCondition,
  sendMail,
  SendRefused,
  summaryColumns,
  syncInbound,
  threadCondition,
  threadIds,
  toMessage,
  toSummary,
  trashMessages,
  TRASH_DAYS,
  UUID_RE,
  WITH_ATTACHMENTS,
  type MailFilter,
  type MailFolder,
  type MailHold,
  type MailRecord,
  type MailRow,
  type SummaryRow,
} from "../lib/mail.js";
import { addAlias, listAliases, MAIL_DOMAIN, onOurDomain, removeAlias } from "../lib/mail-address.js";
import { mailFaces, removeMailPhoto, setMailPhoto } from "../lib/mail-photo.js";
import { cleanCompose, composeText } from "../lib/mail-compose.js";
import { figuresChanged, impersonates, splitQuoted } from "../lib/mail-safety.js";
import { storageSignedUrl } from "../lib/storage.js";

/**
 * The signed-in user's mail (lib/mail.ts). The mailbox always comes from the
 * session, never from the request. "Other" — mail to addresses nobody has —
 * is for owners and admins only. Email-only users may use this endpoint;
 * partners may not.
 *
 * GET ?view=
 *   list&folder=active|inbox|sent|archive|other|trash&filter=all|unread|starred|unread-starred[&att=1]&to=<one of my addresses>
 *        &before=<ISO>&beforeId=<uuid>&limit=50 → { messages, hasMore, unread? }
 *     folder=active                  inbox and sent together: each conversation's newest message, latest activity
 *                                    first; pages with before=<threadAt>&beforeKey=<threadKey> of the last row
 *     folder=trash                   deleted mail, kept 30 days (each row carries deletedAt and purgeAt)
 *     att=1                          only mail with attachments (source documents)
 *     …&q=<text>                     searches every folder the caller can see but Trash (folder is ignored)
 *     with filter=all and no search, starred mail is pinned: the first page carries it as `pinned` (Active: each
 *     conversation with a starred message, under its newest), and `messages` never repeats it
 *     with `to`, `unread` is that mailbox's unread received mail
 *   message&id=<uuid>[&conversation=1] → { message }  (marks it read; with conversation=1, its whole conversation)
 *        message.knownSender: the mailbox has written to this sender (pictures may load); message.impersonation: the
 *        display name copies someone in the office from outside; message.kept: "message" | "hold" | null
 *   count                            → { unread, activeUnread, otherUnread, address|null, aliases, canSeeOther, trash,
 *                                        hold|null, canHold, sync: { at, failed, error? } }  (kicks a sync and the purge)
 *   notice                           → { version, acknowledgedAt|null, recordable }  the office-mailbox notice
 *   attachment&id=<uuid>&att=<id>    → { url }  (signed, 5 minutes)
 *   faces                            → { faces: { address: url } }  each user's chosen picture, by every address they have
 *   status                           → setup diagnostics (owner/admin)
 * GET ?cron=purge                    → the daily purge (Bearer $CRON_SECRET only): Trash older than 30 days, held mail kept
 *
 * POST { action, … }:
 *   sync                             → { ingested, error? }
 *   send { sendId, from?, to, cc?, bcc?, subject, text, html?, replyToId?, forwardId?, attachments? } → { message }
 *        html: the editor's formatted body; cleaned to the allowlist (lib/mail-compose.ts), text written from it
 *        from: one of the caller's addresses (main by default)
 *   improve { html, subject?, ack? } → { html }  the same message laid out better: same words and figures, clearer
 *                                    shape. Only the new text goes to Anthropic; the quoted thread stays here. A layout
 *                                    that changed a figure is refused (409 figure_changed). ack: the version of the
 *                                    first-use notice the person accepted, recorded once.
 *   alias-add { address }            → { aliases }  (owner/admin: one more address on their own account; recorded)
 *   alias-remove { address }         → { aliases }  (recorded)
 *   photo-set { data }               → { faces }  the caller's picture for their mail (a small JPEG/PNG/WebP, base64)
 *   photo-remove                     → { faces }  back to initials
 *   move { ids, folder, conversation? } → { ok }  (inbox|archive; received mail only. conversation: the whole
 *                                    conversation, out of Active or (undo) back; any move to the inbox brings it back)
 *   read { ids, read }               → { ok }
 *   star { ids, starred, conversation? } → { ok }  (conversation: unstarring clears every message in their conversations)
 *   trash { ids, conversation? }     → { trashed, archived, kept, purgeAt }  Delete: into Trash for 30 days. Held mail
 *                                    isn't deleted: received mail is archived instead, sent mail stays. (`delete` is
 *                                    the same, for pages loaded before Trash.) Refused (503) until the migration is in.
 *   restore { ids, conversation? }   → { restored }  out of Trash (conversation: every message of theirs in Trash)
 *   purge { ids }                    → { purged, kept }  Delete forever: only mail already in Trash, never held mail
 *   empty-trash                      → { purged, kept }
 *   hold { ids, held }               → { ok }  keep messages for records (owner or admin); only an owner lifts it
 *   hold-all { on, reason? }         → { hold }  a records hold on all mail (owner only)
 *   notice-ack { version }           → { acknowledgedAt, recorded }
 *   Every delete, restore, purge, hold and address change is written to the audit log (lib/audit.ts).
 *
 * "Not yours" is 403/404, never 401 — the browser signs out on 401.
 *
 * Env: ANTHROPIC_API_KEY (improve), CRON_SECRET (the purge), and what lib/mail.ts needs.
 */

export const config = { api: { bodyParser: { sizeLimit: "5mb" } } };

const FOLDERS: MailFolder[] = ["active", "inbox", "sent", "archive", "other", "trash"];
const FILTERS: MailFilter[] = ["all", "unread", "starred", "unread-starred"];
/** A timestamp as the API hands it out (occurredAt), kept exact for paging. */
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}(:?\d{2})?)$/;
/** Keep the badge poll quick; anything left is picked up by the next sync. */
const COUNT_SYNC_BUDGET_MS = 8_000;
/** The office-mailbox notice's wording version (app/mail/notice.tsx shows it); a new version asks again. */
export const NOTICE_VERSION = "mail-notice-2026-11";

function param(req: VercelRequest, name: string): string {
  const v = req.query?.[name];
  return String((Array.isArray(v) ? v[0] : v) ?? "");
}

function idList(v: unknown): string[] | null {
  if (!Array.isArray(v) || !v.length || v.length > 200) return null;
  return v.every((x) => typeof x === "string" && UUID_RE.test(x)) ? [...new Set(v as string[])] : null;
}

/**
 * Whole-conversation actions reach the caller's own mail only, admin or not (Active is theirs alone): a
 * catch-all copy can share a thread_key, and mustn't be deleted, archived or marked read along with it.
 */
const ownFilter = (me: AppUser) => `user_id=eq.${me.id}`;

/** The conversations these messages are in (thread_key), among the caller's own mail. */
async function threadKeysOf(ids: string[], me: AppUser): Promise<string[]> {
  const rows = await sb<{ thread_key: string | null }[]>(`mail_messages?id=in.(${ids.join(",")})&${ownFilter(me)}&select=thread_key`);
  return [...new Set((rows ?? []).map((r) => r.thread_key).filter((k): k is string => !!k))];
}

const keysIn = (keys: string[]) => `thread_key=in.(${keys.map(pgQuote).join(",")})`;

/** One of the caller's messages (or a catch-all one, for an admin), or null. Trash included. */
async function findMessage(me: AppUser, admin: boolean, id: string): Promise<MailRow | null> {
  if (!UUID_RE.test(id)) return null;
  const rows = await sb<MailRow[]>(`mail_messages?id=eq.${id}&${scopeFilter(me.id, admin)}&select=*&limit=1`);
  const row = rows?.[0];
  return row && canSee(row, me.id, admin) ? row : null;
}

/** Names of the people in the office, for spotting a display name copied from outside. Read at most every five minutes. */
let officeNames: { at: number; names: (string | null)[] } | null = null;
async function namesInOffice(): Promise<(string | null)[]> {
  if (officeNames && Date.now() - officeNames.at < 5 * 60_000) return officeNames.names;
  const rows = await sb<{ name: string | null }[]>("app_users?status=eq.approved&select=name").catch(() => []);
  officeNames = { at: Date.now(), names: (rows ?? []).map((r) => r.name) };
  return officeNames.names;
}

/** For tests: forget the office's names. */
export function resetOfficeNames() {
  officeNames = null;
}

/** A hold in force that covers the caller's mail (their mailbox, or all mail). */
const holdFor = (holds: MailHold[], me: AppUser) => holds.find((h) => h.user_id === null || h.user_id === me.id) ?? null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "POST"])) return;

  try {
    // The daily purge: the Vercel cron only, which must present Bearer $CRON_SECRET.
    if (req.method === "GET" && param(req, "cron")) {
      const cron = cronAuth(req);
      if (cron !== "ok") return refuseCron(req, res, "mail-purge", cron);
      if (!(await mailSchemaReady())) return res.status(200).json({ purged: 0, skipped: "trash_not_set_up" });
      const purged = await recordCronRun("mail-purge", async (run) => {
        const n = await purgeExpired({ actor: "cron", budgetMs: 40_000 });
        run.note(`${n} message${n === 1 ? "" : "s"} removed from Trash for good`);
        return n;
      });
      return res.status(200).json({ purged });
    }

    const me = await currentUser(req, { allowEmailOnly: true });
    if (!me) return fail(res, 401, "unauthorized");
    const admin = isAdmin(me);
    // Trash and holds need migration 20261107_mail_trash; until then mail works as before and Delete is refused.
    const trash = await mailSchemaReady();
    return req.method === "GET" ? await view(req, res, me, admin, trash) : await act(req, res, me, admin, trash);
  } catch (err) {
    return handleError(res, err);
  }
}

async function view(req: VercelRequest, res: VercelResponse, me: AppUser, admin: boolean, trash: boolean) {
  switch (param(req, "view")) {
    case "list": {
      const folder = (param(req, "folder") || "inbox") as MailFolder;
      if (!FOLDERS.includes(folder)) return fail(res, 400, "bad_folder");
      if (folder === "other" && !admin) return fail(res, 403, "forbidden");
      if (folder === "trash" && !trash) return res.status(200).json({ messages: [], hasMore: false });
      const filter = (param(req, "filter") || "all") as MailFilter;
      if (!FILTERS.includes(filter)) return fail(res, 400, "bad_filter");
      const narrow = `${filterClause(filter)}${param(req, "att") === "1" ? WITH_ATTACHMENTS : ""}`;
      const limit = Math.min(Math.max(Math.floor(Number(param(req, "limit"))) || 50, 1), 100);
      // Page on (occurred_at, id) after the last row shown, so rows sharing its time aren't skipped.
      const before = param(req, "before");
      const beforeId = param(req, "beforeId");
      const beforeKey = param(req, "beforeKey");
      if (before && (!TIMESTAMP_RE.test(before) || Number.isNaN(Date.parse(before)))) return fail(res, 400, "bad_before");
      if (beforeId && (!before || !UUID_RE.test(beforeId))) return fail(res, 400, "bad_before");
      if (beforeKey && (!before || beforeKey.length > 1000)) return fail(res, 400, "bad_before");
      const q = param(req, "q");
      const searching = !!searchCondition(q);
      // Active lists conversations, not messages (a search still lists messages).
      const active = folder === "active" && !searching;
      const at = encodeURIComponent(`"${before}"`);
      // One mailbox: mail that came in to that address of mine, or went out from it.
      const to = param(req, "to").trim().toLowerCase();
      let box = "";
      let received = "";
      if (to) {
        const main = (me.mail_address ?? "").toLowerCase();
        const mine = main ? [main, ...(await listAliases(me.id)).map((a) => a.toLowerCase())] : [];
        if (!mine.includes(to)) return fail(res, 400, "bad_mailbox");
        const v = encodeURIComponent(`"${to}"`);
        // Mail from before extra addresses existed has no delivered-to: it came to the main one.
        received = to === main ? `or(delivered_to.eq.${v},delivered_to.is.null)` : `delivered_to.eq.${v}`;
        box = folder === "sent" ? `from_email.eq.${v}` : folder === "active" || folder === "trash" ? `or(and(direction.eq.out,from_email.eq.${v}),and(direction.eq.in,${received}))` : received;
      }
      // A search looks through everything the caller may see but Trash, whatever folder is open.
      const where = searching ? liveScope(me.id, admin, { trash }) : folderFilter(folder, me.id, admin, { trash });
      // Starred mail sits at the top, whatever its date: carried on the first page as `pinned`, and kept out of
      // the dated list on every page so paging stays on time alone. Not in a search, a narrowed list or Trash.
      const pins = filter === "all" && !narrow && !searching && folder !== "trash";
      const inBox = box ? `&and=(${box})` : "";
      const columns = summaryColumns();
      // One mailbox's own unread count (the tabs' badge), on its first page.
      const unread =
        to && received && !before && (folder === "active" || folder === "inbox")
          ? await countRows("mail_messages", `${folderFilter("inbox", me.id, admin, { trash })}&read_at=is.null&and=(${received})`)
          : undefined;
      // Active pins each conversation with a starred message in it.
      // At most 30 conversations (Active) or 100 messages are pinned; any more stay in the dated list, by date.
      const starredKeys =
        pins && active
          ? [
              ...new Set(
                ((await sb<{ thread_key: string | null }[]>(`mail_messages?${where}&starred_at=not.is.null${inBox}&select=thread_key&order=starred_at.desc&limit=200`)) ?? [])
                  .map((r) => r.thread_key)
                  .filter((k): k is string => !!k),
              ),
            ].slice(0, 30)
          : [];
      // Each starred conversation's newest message, from one bounded read. Only the conversations that made it
      // into the read are pinned and kept out of the dated list (on every page), so none shows nowhere.
      const pinnedHeads = starredKeys.length
        ? conversationHeads(
            (await sb<SummaryRow[]>(`mail_messages?${where}&${keysIn(starredKeys)}${inBox}&select=${before ? "id,thread_key" : columns}&order=${ACTIVE_ORDER}&limit=400`)) ?? [],
            100,
            Infinity,
          ).heads
        : [];
      const keyList = pinnedHeads
        .map((r) => r.thread_key)
        .filter((k): k is string => !!k)
        .map(pgQuote)
        .join(",");
      const pinnedRows =
        pins && !active ? ((await sb<SummaryRow[]>(`mail_messages?${where}&starred_at=not.is.null${inBox}&select=${before ? "id" : columns}&order=occurred_at.desc,id.desc&limit=100`)) ?? []) : [];
      // Paging and search go in one and=(…), so neither clashes with the or=(…) an admin's scope uses.
      const conditions = [
        keyList ? `or(thread_key.is.null,thread_key.not.in.(${keyList}))` : "",
        pinnedRows.length ? `id.not.in.(${pinnedRows.map((r) => r.id).join(",")})` : "",
        !before
          ? ""
          : active
            ? beforeKey
              ? activeAfter(before, beforeKey)
              : `thread_at.lt.${at}`
            : beforeId
              ? `or(occurred_at.lt.${at},and(occurred_at.eq.${at},id.lt.${beforeId}))`
              : `occurred_at.lt.${at}`,
        searchCondition(q),
        box,
      ].filter(Boolean);
      const extra = conditions.length ? `&and=(${conditions.join(",")})` : "";
      const withUnread = unread === undefined ? {} : { unread };
      if (active) {
        const pinned = before ? [] : pinnedHeads;
        // A conversation's messages come together, newest first; read enough to fill a page of them.
        const fetched = Math.min(limit * 4, 400);
        const rows = await sb<SummaryRow[]>(`mail_messages?${where}${narrow}${extra}&select=${columns}&order=${ACTIVE_ORDER}&limit=${fetched}`);
        const { heads, more } = conversationHeads(rows ?? [], limit, fetched);
        // A conversation shows unread while any message in it is, not just its newest.
        const keys = [...heads, ...pinned].map((r) => r.thread_key).filter((k): k is string => !!k);
        const unreadKeys = new Set(
          keys.length ? ((await sb<{ thread_key: string }[]>(`mail_messages?${where}&read_at=is.null&direction=eq.in&${keysIn(keys)}&select=thread_key`)) ?? []).map((r) => r.thread_key) : [],
        );
        const head = (r: SummaryRow) => ({ ...toSummary(r), ...(r.thread_key && unreadKeys.has(r.thread_key) ? { read: false } : {}) });
        // A pinned conversation shows starred, whichever of its messages carries the star.
        return res.status(200).json({ messages: heads.map(head), hasMore: more, ...(pins ? { pinned: pinned.map((r) => ({ ...head(r), starred: true })) } : {}), ...withUnread });
      }
      const pinned = before ? [] : pinnedRows;
      const rows = await sb<SummaryRow[]>(`mail_messages?${where}${narrow}${extra}` + `&select=${columns}&order=occurred_at.desc,id.desc&limit=${limit + 1}`);
      return res.status(200).json({
        messages: (rows ?? []).slice(0, limit).map(toSummary),
        hasMore: (rows ?? []).length > limit,
        ...(pins ? { pinned: pinned.map(toSummary) } : {}),
        ...withUnread,
      });
    }

    case "message": {
      const row = await findMessage(me, admin, param(req, "id"));
      if (!row) return fail(res, 404, "not_found");
      // peek=1: fetched ahead of a tap (the finger is on the row); nothing is marked read until it's really opened.
      const peek = param(req, "peek") === "1";
      if (!row.read_at && !peek) {
        row.read_at = new Date().toISOString();
        await sb(`mail_messages?id=eq.${row.id}`, { method: "PATCH", body: { read_at: row.read_at } });
      }
      // Opened from Active, the row stood for the whole conversation: it's all read now.
      if (!peek && param(req, "conversation") === "1" && row.thread_key) {
        await sb(`mail_messages?${keysIn([row.thread_key])}&read_at=is.null&${ownFilter(me)}`, { method: "PATCH", body: { read_at: new Date().toISOString() } });
      }
      const from = (row.from_email ?? "").toLowerCase();
      const [knownSender, names, holds] = await Promise.all([
        row.direction === "out" || !from ? true : wroteTo(me, from, row),
        row.direction === "in" && from ? namesInOffice() : Promise.resolve([] as (string | null)[]),
        trash ? activeHolds() : Promise.resolve([] as MailHold[]),
      ]);
      const impersonation = row.direction === "in" && !!from && impersonates({ name: row.from_name, email: from }, names, MAIL_DOMAIN);
      const kept = row.held_at ? "message" : isHeld(row, holds) ? "hold" : null;
      return res.status(200).json({ message: { ...withProxiedImages(toMessage(row)), knownSender, impersonation, kept } });
    }

    case "thread": {
      // The conversation the message is in, newest first: linked by Message-ID, In-Reply-To and References.
      const row = await findMessage(me, admin, param(req, "id"));
      if (!row) return fail(res, 404, "not_found");
      // A conversation shows what's still there: mail in Trash stays in Trash (the opened message aside).
      const scope = liveScope(me.id, admin, { trash });
      const found = new Map<string, MailRow>([[row.id, row]]);
      let ids = threadIds(row);
      for (let round = 0; round < 2 && ids.length; round++) {
        const cond = threadCondition(ids);
        if (!cond) break;
        const rows = await sb<MailRow[]>(`mail_messages?${scope}&${cond}&select=*&order=occurred_at.desc&limit=40`);
        for (const r of rows ?? []) if (canSee(r, me.id, admin)) found.set(r.id, r);
        const next = [...new Set([...found.values()].flatMap(threadIds))];
        if (next.length === ids.length) break;
        ids = next;
      }
      const messages = [...found.values()]
        .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)))
        .slice(0, 40)
        .map(toMessage)
        .map(withProxiedImages);
      return res.status(200).json({ messages });
    }

    case "count": {
      // An admin assigns addresses; until then there's none (never one from a name the user typed).
      const address = me.mail_address ?? null;
      const aliases = address ? await listAliases(me.id) : [];
      const sync = await syncInbound({ budgetMs: COUNT_SYNC_BUDGET_MS }).catch((err) => ({ ingested: 0, error: problemText(err), skipped: false }));
      // This instance ran the sync (at most one does every 30 seconds): it also clears Trash past 30 days.
      if (trash && !sync.skipped) await purgeExpired({ budgetMs: 3_000 }).catch((err) => console.error("mail: the purge didn't finish", err));
      const [unread, otherUnread, activeKeys, holds, last] = await Promise.all([
        countRows("mail_messages", `${folderFilter("inbox", me.id, admin, { trash })}&read_at=is.null`),
        admin ? countRows("mail_messages", `${folderFilter("other", me.id, admin, { trash })}&read_at=is.null`) : 0,
        sb<{ thread_key: string | null }[]>(`mail_messages?${folderFilter("active", me.id, admin, { trash })}&read_at=is.null&direction=eq.in&select=thread_key&limit=1000`),
        trash ? activeHolds() : Promise.resolve([] as MailHold[]),
        sync.skipped ? lastSync() : Promise.resolve({ at: new Date().toISOString(), error: sync.error ?? null }),
      ]);
      const activeUnread = new Set((activeKeys ?? []).map((r) => r.thread_key ?? "")).size;
      const hold = holdFor(holds, me);
      // Everyone sees when mail was last checked and whether it worked; only owners and admins see the reason.
      const status = { at: last.at, failed: !!last.error, ...(admin && last.error ? { error: last.error } : {}) };
      return res.status(200).json({
        unread,
        activeUnread,
        otherUnread,
        address,
        aliases,
        canSeeOther: admin,
        trash,
        hold: hold ? { since: hold.set_at, reason: hold.reason, all: hold.user_id === null } : null,
        canHold: me.role === "owner",
        sync: status,
      });
    }

    case "notice": {
      const rows = await sb<{ at: string; detail: { version?: string } | null }[]>(`audit_log?actor_id=eq.${me.id}&action=eq.mail.notice_ack&select=at,detail&order=at.desc&limit=20`).catch(
        () => null,
      );
      const hit = (rows ?? []).find((r) => r.detail?.version === NOTICE_VERSION);
      return res.status(200).json({ version: NOTICE_VERSION, acknowledgedAt: hit?.at ?? null, recordable: rows !== null });
    }

    case "attachment": {
      const row = await findMessage(me, admin, param(req, "id"));
      const att = row?.attachments?.find((a) => a.id === param(req, "att"));
      if (!att?.path) return fail(res, 404, "not_found");
      const url = await storageSignedUrl(att.path, 300, BUCKET, att.filename || "attachment");
      if (!url) return fail(res, 404, "not_found");
      return res.status(200).json({ url });
    }

    case "faces":
      return res.status(200).json({ faces: await mailFaces() });

    case "status": {
      if (!admin) return fail(res, 403, "forbidden");
      return res.status(200).json(await mailStatus());
    }

    default:
      return fail(res, 400, "bad_view");
  }
}

/** Whether the mailbox has written to this sender before: their pictures may load. The office's own verified mail counts. */
async function wroteTo(me: AppUser, from: string, row: MailRow): Promise<boolean> {
  if (onOurDomain(from) && (row.spf_pass === true || row.dkim_pass === true)) return true;
  const rows = await sb<{ id: string }[]>(`mail_messages?user_id=eq.${me.id}&direction=eq.out&to_addrs=cs.${encodeURIComponent(JSON.stringify([{ email: from }]))}&select=id&limit=1`).catch(() => []);
  return !!rows?.length;
}

async function act(req: VercelRequest, res: VercelResponse, me: AppUser, admin: boolean, trash: boolean) {
  let body = req.body ?? {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return fail(res, 400, "bad_json");
    }
  }
  const scope = scopeFilter(me.id, admin);
  const live = liveScope(me.id, admin, { trash });

  switch (String(body?.action ?? "")) {
    case "sync": {
      const r = await syncInbound().catch((err) => ({ ingested: 0, error: problemText(err) }));
      // The reason is for owners and admins; everyone else learns only that it didn't work.
      return res.status(200).json(r.error ? { ingested: r.ingested, ...(admin ? { error: r.error } : { failed: true }) } : { ingested: r.ingested });
    }

    case "send":
      return send(res, me, admin, body);

    case "improve":
      return improve(res, me, body);

    // More addresses on the caller's own account. Owners and admins only, as
    // they're the ones who hand out addresses (role addresses included).
    case "alias-add": {
      if (!admin) return fail(res, 403, "forbidden", "Ask an owner or admin to add an address.");
      if (!me.mail_address) return fail(res, 400, "no_address", "Your account needs its main address first.");
      const r = await addAlias(me, body.address);
      if ("error" in r) return fail(res, r.error === "address_taken" ? 409 : 400, r.error, r.message);
      await audit({ actor: me, action: "mail.alias_add", target: { type: "mail_address", id: r.address, label: r.address }, summary: `Added the address ${r.address}` });
      return res.status(200).json({ aliases: await listAliases(me.id) });
    }

    case "alias-remove": {
      if (!admin) return fail(res, 403, "forbidden");
      if (typeof body.address !== "string" || !body.address.trim()) return fail(res, 400, "bad_address");
      const address = body.address.trim().toLowerCase();
      await removeAlias(me.id, address);
      await audit({
        actor: me,
        action: "mail.alias_remove",
        target: { type: "mail_address", id: address, label: address },
        summary: `Removed the address ${address}; new mail to it goes to Unclaimed`,
      });
      return res.status(200).json({ aliases: await listAliases(me.id) });
    }

    // The caller's own picture, and only theirs.
    case "photo-set": {
      const r = await setMailPhoto(me, body.data);
      if ("error" in r) return fail(res, r.error === "photo_too_large" ? 413 : 400, r.error, r.message);
      return res.status(200).json({ faces: await mailFaces() });
    }

    case "photo-remove":
      await removeMailPhoto(me);
      return res.status(200).json({ faces: await mailFaces() });

    case "move": {
      const ids = idList(body.ids);
      if (!ids) return fail(res, 400, "bad_ids");
      if (body.folder !== "inbox" && body.folder !== "archive") return fail(res, 400, "bad_folder");
      const keys = await threadKeysOf(ids, me);
      const own = ownFilter(me);
      if (body.folder === "archive" && body.conversation === true && keys.length) {
        // Archived from Active: the conversation's received mail moves, and the whole of it (sent copies
        // too, which stay in Out) leaves Active until a new message arrives in it or it moves back.
        await sb(`mail_messages?${keysIn(keys)}&direction=eq.in&folder=eq.inbox&${own}`, { method: "PATCH", body: { folder: "archive" } });
        await sb(`mail_messages?${keysIn(keys)}&${own}`, { method: "PATCH", body: { active_hidden: true } });
        return res.status(200).json({ ok: true });
      }
      await sb(`mail_messages?id=in.(${ids.join(",")})&direction=eq.in&${live}`, { method: "PATCH", body: { folder: body.folder } });
      // The whole conversation back (undoing an archive from Active): all of its archived received mail.
      if (body.folder === "inbox" && body.conversation === true && keys.length) {
        await sb(`mail_messages?${keysIn(keys)}&direction=eq.in&folder=eq.archive&${own}`, { method: "PATCH", body: { folder: "inbox" } });
      }
      // Back to the inbox: the conversation is in Active again.
      if (body.folder === "inbox" && keys.length) await sb(`mail_messages?${keysIn(keys)}&active_hidden=is.true&${own}`, { method: "PATCH", body: { active_hidden: false } });
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
      // Active shows a conversation starred when any message in it is: unstarring it there clears them all.
      if (!body.starred && body.conversation === true) {
        const keys = await threadKeysOf(ids, me);
        if (keys.length) {
          await sb(`mail_messages?${keysIn(keys)}&starred_at=not.is.null&${ownFilter(me)}`, { method: "PATCH", body: { starred_at: null } });
        }
      }
      return res.status(200).json({ ok: true });
    }

    // Delete: into Trash for 30 days, with who did it. `delete` is the name pages loaded before Trash still send.
    case "trash":
    case "delete": {
      const ids = idList(body.ids);
      if (!ids) return fail(res, 400, "bad_ids");
      if (!trash) return fail(res, 503, "trash_not_ready", "Deleting is off until Trash is set up, so nothing was deleted. Archive it instead.");
      // From Active, a row is a conversation: every message in it goes.
      let all = ids;
      const keys = body.conversation === true ? await threadKeysOf(ids, me) : [];
      if (keys.length) {
        const rows = await sb<{ id: string }[]>(`mail_messages?${keysIn(keys)}&${ownFilter(me)}&deleted_at=is.null&select=id`);
        all = [...new Set([...ids, ...(rows ?? []).map((r) => r.id)])].slice(0, 1000);
      }
      const holds = await activeHolds();
      const done = await trashMessages(all, scope, me.id, holds);
      // A held conversation archived from Active leaves Active, as an archive from there does.
      const heldKeys = [...new Set([...done.archived, ...done.kept].map((r) => r.thread_key).filter((k): k is string => !!k && keys.includes(k)))];
      if (heldKeys.length) await sb(`mail_messages?${keysIn(heldKeys)}&${ownFilter(me)}`, { method: "PATCH", body: { active_hidden: true } });
      await recordDelete(me, done, body.conversation === true);
      const now = new Date().toISOString();
      return res.status(200).json({
        ok: true,
        trashed: done.trashed.map((r) => r.id),
        archived: done.archived.map((r) => r.id),
        kept: done.kept.map((r) => r.id),
        purgeAt: new Date(Date.parse(now) + TRASH_DAYS * 86_400_000).toISOString(),
      });
    }

    case "restore": {
      const ids = idList(body.ids);
      if (!ids) return fail(res, 400, "bad_ids");
      if (!trash) return fail(res, 503, "trash_not_ready", "Trash isn't set up yet.");
      let all = ids;
      if (body.conversation === true) {
        const keys = await threadKeysOf(ids, me);
        const rows = keys.length ? await sb<{ id: string }[]>(`mail_messages?${keysIn(keys)}&${ownFilter(me)}&deleted_at=not.is.null&select=id`) : [];
        all = [...new Set([...ids, ...(rows ?? []).map((r) => r.id)])].slice(0, 1000);
      }
      const restored = await restoreMessages(all, scope);
      if (restored.length) {
        await audit({
          actor: me,
          action: "mail.restore",
          target: restored.length === 1 ? { type: "mail", id: restored[0].id, label: restored[0].subject ?? null } : null,
          count: restored.length,
          summary: actionSummary("Restored", restored, " from Trash"),
          detail: { messages: restored.map(auditLine) },
        });
      }
      return res.status(200).json({ ok: true, restored: restored.map((r) => r.id) });
    }

    case "purge":
    case "empty-trash": {
      if (!trash) return fail(res, 503, "trash_not_ready", "Trash isn't set up yet.");
      const ids = body.action === "purge" ? idList(body.ids) : null;
      if (body.action === "purge" && !ids) return fail(res, 400, "bad_ids");
      const holds = await activeHolds();
      const { purged, kept } = await purgeMessages({ ids, scope, holds, limit: 1000 });
      if (purged.length) {
        await audit({
          actor: me,
          action: "mail.purge",
          target: purged.length === 1 ? { type: "mail", id: purged[0].id, label: purged[0].subject ?? null } : null,
          count: purged.length,
          summary: actionSummary("Deleted", purged, " for good, with their files, from Trash"),
          detail: { reason: body.action === "purge" ? "deleted_forever" : "emptied_trash", messages: purged.map(auditLine) },
        });
      }
      return res.status(200).json({ ok: true, purged: purged.length, kept: kept.length });
    }

    // Keep messages for records: an owner or admin sets it; only an owner lifts it.
    case "hold": {
      const ids = idList(body.ids);
      if (!ids) return fail(res, 400, "bad_ids");
      if (typeof body.held !== "boolean") return fail(res, 400, "bad_held");
      if (!trash) return fail(res, 503, "trash_not_ready", "Holds aren't set up yet.");
      if (body.held ? !admin : me.role !== "owner") return fail(res, 403, "forbidden", body.held ? "Ask an owner or admin to keep it for records." : "Only an owner can stop keeping it for records.");
      const rows = (await sb<MailRecord[]>(`mail_messages?id=in.(${ids.join(",")})&${scope}&select=id,subject,from_email,to_addrs,occurred_at,direction,user_id,folder,held_at,thread_key`)) ?? [];
      if (!rows.length) return fail(res, 404, "not_found");
      await sb(`mail_messages?id=in.(${rows.map((r) => r.id).join(",")})&${scope}`, {
        method: "PATCH",
        body: body.held ? { held_at: new Date().toISOString(), held_by: me.id } : { held_at: null, held_by: null },
      });
      await audit({
        actor: me,
        action: body.held ? "mail.hold" : "mail.release",
        target: rows.length === 1 ? { type: "mail", id: rows[0].id, label: rows[0].subject ?? null } : null,
        count: rows.length,
        summary: body.held ? actionSummary("Kept", rows, " for records") : actionSummary("Stopped keeping", rows, " for records"),
        detail: { messages: rows.map(auditLine) },
      });
      return res.status(200).json({ ok: true });
    }

    // A records hold on all mail: nothing is deleted or removed from Trash while it's on.
    case "hold-all": {
      if (me.role !== "owner") return fail(res, 403, "forbidden", "Only an owner can put mail on hold or lift it.");
      if (typeof body.on !== "boolean") return fail(res, 400, "bad_on");
      if (!trash) return fail(res, 503, "trash_not_ready", "Holds aren't set up yet.");
      const reason = typeof body.reason === "string" ? body.reason.replace(/\s+/g, " ").trim().slice(0, 300) : "";
      const current = (await activeHolds()).filter((h) => h.user_id === null);
      if (body.on && !current.length) {
        await sb("mail_holds", { method: "POST", body: { user_id: null, reason: reason || null, set_by: me.id }, prefer: "return=minimal" });
        await audit({
          actor: me,
          action: "mail.hold_all",
          target: { type: "mail_hold", id: "all", label: "All mail" },
          summary: "Put all mail on hold for records",
          detail: { reason: reason || null },
        });
      } else if (!body.on && current.length) {
        await sb(`mail_holds?id=in.(${current.map((h) => h.id).join(",")})`, { method: "PATCH", body: { lifted_at: new Date().toISOString(), lifted_by: me.id } });
        await audit({ actor: me, action: "mail.release_all", target: { type: "mail_hold", id: "all", label: "All mail" }, summary: "Lifted the records hold on all mail" });
      }
      const after = (await activeHolds()).find((h) => h.user_id === null) ?? null;
      return res.status(200).json({ hold: after ? { since: after.set_at, reason: after.reason, all: true } : null });
    }

    case "notice-ack": {
      const version = typeof body.version === "string" ? body.version.slice(0, 60) : "";
      if (version !== NOTICE_VERSION) return fail(res, 400, "bad_version");
      const recorded = await audit({
        actor: me,
        action: "mail.notice_ack",
        target: { type: "user", id: me.id, label: me.name ?? null },
        summary: "Read the notice about office mailboxes",
        detail: { version },
      });
      return res.status(200).json({ acknowledgedAt: new Date().toISOString(), recorded });
    }

    default:
      return fail(res, 400, "bad_action");
  }
}

/** One audit line for what Delete did: what went to Trash, and what a hold kept. Never the words. */
async function recordDelete(me: AppUser, done: { trashed: MailRecord[]; archived: MailRecord[]; kept: MailRecord[] }, conversation: boolean) {
  if (done.trashed.length) {
    await audit({
      actor: me,
      action: "mail.trash",
      target: done.trashed.length === 1 ? { type: "mail", id: done.trashed[0].id, label: done.trashed[0].subject ?? null } : null,
      count: done.trashed.length,
      summary: actionSummary("Moved", done.trashed, ` to Trash; removed for good after ${TRASH_DAYS} days`),
      detail: { conversation, messages: done.trashed.map(auditLine) },
    });
  }
  const held = [...done.archived, ...done.kept];
  if (held.length) {
    await audit({
      actor: me,
      action: "mail.delete_held",
      count: held.length,
      summary: actionSummary("Kept", held, " instead of deleting: mail on hold isn't deleted"),
      detail: { archived: done.archived.map((r) => r.id), kept: done.kept.map((r) => r.id), messages: held.map(auditLine) },
    });
  }
}

const IMPROVE_MODEL = "claude-sonnet-5-5";

const IMPROVE_INSTRUCTIONS = `You lay out business emails so they read clearly and look polished and professional. You change the layout, not the message.

Rules:
- Keep every word's meaning. Keep every name, address, number, date and request exactly. Don't add facts, promises or new requests, and don't drop any.
- You may: split it into short paragraphs; put an address on its own lines (one line per part); turn a run of requests or steps into a numbered list, and a run of parallel items into a bulleted list; bold the few things a reader must not miss (an account number, an address, a deadline), sparingly; fix spelling, capitalization and punctuation.
- Keep the greeting and the sign-off, each in its own paragraph, and the sign-off's lines together with line breaks.
- No headings, no emoji, no colors, no tables.

Answer with the email body only, as an HTML fragment using just these tags: p, br, strong, em, ul, ol, li, a. No <html> or <body>, no code fences, no commentary.`;

/** The version of the composer's first-use notice for Tidy layout (app/mail/composer.tsx). */
const TIDY_NOTICE_VERSION = "mail-tidy-2026-11";

/**
 * The same message, laid out better (Tidy layout). Only the person's own
 * words go to Anthropic: the quoted thread under them (other people's words)
 * stays here and goes back under the result as it was. A layout that changed
 * any figure (an amount, a date, an account or invoice number) is refused,
 * so the message is never sent altered.
 */
async function improve(res: VercelResponse, me: AppUser, body: Record<string, unknown>) {
  const html = typeof body.html === "string" ? body.html : "";
  const clean = cleanCompose(html);
  const { own, quote } = splitQuoted(clean);
  if (!composeText(own).trim()) return fail(res, 400, "empty", "Write the message first.");
  if (own.length > 60_000) return fail(res, 413, "too_long", "That message is too long to tidy.");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail(res, 503, "not_configured", "Tidy layout isn't set up.");
  if (body.ack === TIDY_NOTICE_VERSION) {
    await audit({
      actor: me,
      action: "mail.ai_ack",
      target: { type: "user", id: me.id, label: me.name ?? null },
      summary: "Read the notice about Tidy layout (AI)",
      detail: { version: TIDY_NOTICE_VERSION },
    });
  }
  const subject = typeof body.subject === "string" ? body.subject.slice(0, 300) : "";
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: IMPROVE_MODEL,
    max_tokens: 8000,
    output_config: { effort: "low" },
    system: IMPROVE_INSTRUCTIONS,
    messages: [{ role: "user", content: `${subject ? `Subject: ${subject}\n\n` : ""}${own}` }],
  });
  const out = message.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .replace(/^```(?:html)?\s*|```\s*$/g, "")
    .trim();
  const improved = cleanCompose(out);
  if (!composeText(improved).trim()) return fail(res, 502, "empty_response", "Couldn't tidy it just now. Try again.");
  const changed = figuresChanged(composeText(own), composeText(improved));
  if (changed.length) return fail(res, 409, "figure_changed", "The new layout changed a figure, so it wasn't used. Your message is as you wrote it.");
  return res.status(200).json({ html: improved + quote });
}

async function send(res: VercelResponse, me: AppUser, admin: boolean, body: Record<string, unknown>) {
  if (!me.mail_address) return fail(res, 400, "no_address", "You don't have an address yet. Ask an admin.");
  const request = parseSend(body);
  if ("error" in request) return fail(res, 400, request.error, request.message);

  const originalId = request.replyToId ?? request.forwardId;
  const original = originalId ? await findMessage(me, admin, originalId) : null;
  if (originalId && !original) return fail(res, 400, "not_found", "The original message wasn't found.");

  // Send as the main address or one of the caller's extra ones, never anyone else's.
  let from = me.mail_address;
  if (typeof body.from === "string" && body.from.trim() && body.from.trim().toLowerCase() !== from) {
    const wanted = body.from.trim().toLowerCase();
    if (!(await listAliases(me.id)).includes(wanted)) return fail(res, 400, "bad_from", "You can only send from your own addresses.");
    from = wanted;
  }

  // sendMail checks the daily limit (mail_sends) just before calling Bird; going over is a SendRefused.
  try {
    const row = await sendMail({ id: me.id, name: me.name, address: from }, request, original);
    return res.status(200).json({ message: toSummary(row) });
  } catch (err) {
    if (err instanceof SendRefused) return fail(res, 400, err.code, err.message);
    if (err instanceof BirdError) {
      // The provider's own words stay in the log; the person learns what happened and what to do.
      console.error("mail: send refused", { status: err.status });
      const unsure = err.status >= 500 || err.status === 0;
      return fail(
        res,
        502,
        "send_failed",
        unsure ? "We couldn't tell whether it was sent. Check Sent in a minute before you try again." : "It wasn't sent. Check the addresses and try again; if it keeps happening, tell the office.",
      );
    }
    throw err;
  }
}

/** A message as served: its remote pictures pointed at /api/mail-image (lib/mail-image.ts). */
function withProxiedImages<T extends { html: string | null }>(m: T): T {
  return m.html ? { ...m, html: proxyRemoteImages(m.html) } : m;
}
