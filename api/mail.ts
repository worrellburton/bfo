import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { currentUser, fail, handleError, isAdmin, sb, type AppUser } from "../lib/auth.js";
import {
  ACTIVE_ORDER,
  activeAfter,
  BirdError,
  BUCKET,
  canSee,
  conversationHeads,
  countRows,
  deleteMessages,
  filterClause,
  folderFilter,
  pgQuote,
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
  threadCondition,
  threadIds,
  toMessage,
  toSummary,
  UUID_RE,
  type MailFilter,
  type MailFolder,
  type MailRow,
  type SummaryRow,
} from "../lib/mail.js";
import { addAlias, listAliases, removeAlias } from "../lib/mail-address.js";
import { mailFaces, removeMailPhoto, setMailPhoto } from "../lib/mail-photo.js";
import { cleanCompose, composeText } from "../lib/mail-compose.js";
import { storageSignedUrl } from "../lib/storage.js";

/**
 * The signed-in user's mail (lib/mail.ts). The mailbox always comes from the
 * session, never from the request. "Other" — mail to addresses nobody has —
 * is for owners and admins only. Email-only users may use this endpoint.
 *
 * GET ?view=
 *   list&folder=inbox|sent|archive|other&filter=all|unread|starred&to=<one of my addresses>&before=<ISO>&beforeId=<uuid>&limit=50 → { messages, hasMore }
 *     folder=active                  inbox and sent together: each conversation's newest message, latest activity
 *                                    first; pages with before=<threadAt>&beforeKey=<threadKey> of the last row
 *     …&q=<text>                     searches every folder the caller can see (folder is ignored)
 *     with filter=all and no search, starred mail is pinned: the first page carries it as `pinned` (Active: each
 *     conversation with a starred message, under its newest), and `messages` never repeats it
 *   message&id=<uuid>[&conversation=1] → { message }  (marks it read; with conversation=1, its whole conversation)
 *   count                            → { unread, otherUnread, address|null, aliases, canSeeOther, sync? }  (kicks a sync)
 *   attachment&id=<uuid>&att=<id>    → { url }  (signed, 5 minutes)
 *   faces                            → { faces: { address: url } }  each user's chosen picture, by every address they have
 *   status                           → setup diagnostics (owner/admin)
 *
 * POST { action, … }:
 *   sync                             → { ingested, error? }
 *   send { sendId, from?, to, cc?, bcc?, subject, text, html?, replyToId?, forwardId?, attachments? } → { message }
 *        html: the editor's formatted body; cleaned to the allowlist (lib/mail-compose.ts), text written from it
 *   improve { html, subject? } → { html }  the same message laid out better: same words, clearer shape
 *                                    from: one of the caller's addresses (main by default)
 *   alias-add { address }            → { aliases }  (owner/admin: one more address on their own account)
 *   alias-remove { address }         → { aliases }
 *   photo-set { data }               → { faces }  the caller's picture for their mail (a small JPEG/PNG/WebP, base64)
 *   photo-remove                     → { faces }  back to initials
 *   move { ids, folder, conversation? } → { ok }  (inbox|archive; received mail only. conversation: the whole
 *                                    conversation, out of Active or (undo) back; any move to the inbox brings it back)
 *   read { ids, read }               → { ok }
 *   star { ids, starred, conversation? } → { ok }  (conversation: unstarring clears every message in their conversations)
 *   delete { ids, conversation? }    → { ok }  (for good; conversation: every message in their conversations)
 *
 * "Not yours" is 403/404, never 401 — the browser signs out on 401.
 */

export const config = { api: { bodyParser: { sizeLimit: "5mb" } } };

const FOLDERS: MailFolder[] = ["active", "inbox", "sent", "archive", "other"];
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
      const beforeKey = param(req, "beforeKey");
      if (before && (!TIMESTAMP_RE.test(before) || Number.isNaN(Date.parse(before)))) return fail(res, 400, "bad_before");
      if (beforeId && (!before || !UUID_RE.test(beforeId))) return fail(res, 400, "bad_before");
      if (beforeKey && (!before || beforeKey.length > 1000)) return fail(res, 400, "bad_before");
      // Active lists conversations, not messages (a search still lists messages).
      const active = folder === "active" && !searchCondition(param(req, "q"));
      const at = encodeURIComponent(`"${before}"`);
      // One mailbox: mail that came in to that address of mine, or went out from it.
      const to = param(req, "to").trim().toLowerCase();
      let box = "";
      if (to) {
        const main = (me.mail_address ?? "").toLowerCase();
        const mine = main ? [main, ...(await listAliases(me.id)).map((a) => a.toLowerCase())] : [];
        if (!mine.includes(to)) return fail(res, 400, "bad_mailbox");
        const v = encodeURIComponent(`"${to}"`);
        // Mail from before extra addresses existed has no delivered-to: it came to the main one.
        const received = to === main ? `or(delivered_to.eq.${v},delivered_to.is.null)` : `delivered_to.eq.${v}`;
        box =
          folder === "sent"
            ? `from_email.eq.${v}`
            : folder === "active"
              ? `or(and(direction.eq.out,from_email.eq.${v}),and(direction.eq.in,${received}))`
              : received;
      }
      // A search looks through everything the caller may see, whatever folder is open.
      const where = searchCondition(param(req, "q")) ? scopeFilter(me.id, admin) : folderFilter(folder, me.id, admin);
      // Starred mail sits at the top, whatever its date: carried on the first page as `pinned`, and kept out of
      // the dated list on every page so paging stays on time alone. Not in a search or a narrowed list.
      const pins = filter === "all" && !searchCondition(param(req, "q"));
      const inBox = box ? `&and=(${box})` : "";
      // Active pins each conversation with a starred message in it.
      // At most 30 conversations (Active) or 100 messages are pinned; any more stay in the dated list, by date.
      const starredKeys =
        pins && active
          ? [...new Set(((await sb<{ thread_key: string | null }[]>(`mail_messages?${where}&starred_at=not.is.null${inBox}&select=thread_key&order=starred_at.desc&limit=200`)) ?? []).map((r) => r.thread_key).filter((k): k is string => !!k))].slice(0, 30)
          : [];
      // Each starred conversation's newest message, from one bounded read. Only the conversations that made it
      // into the read are pinned and kept out of the dated list (on every page), so none shows nowhere.
      const pinnedHeads = starredKeys.length
        ? conversationHeads(
            (await sb<SummaryRow[]>(`mail_messages?${where}&${keysIn(starredKeys)}${inBox}&select=${before ? "id,thread_key" : SUMMARY_COLUMNS}&order=${ACTIVE_ORDER}&limit=400`)) ?? [],
            100,
            Infinity
          ).heads
        : [];
      const keyList = pinnedHeads.map((r) => r.thread_key).filter((k): k is string => !!k).map(pgQuote).join(",");
      const pinnedRows =
        pins && !active
          ? ((await sb<SummaryRow[]>(`mail_messages?${where}&starred_at=not.is.null${inBox}&select=${before ? "id" : SUMMARY_COLUMNS}&order=occurred_at.desc,id.desc&limit=100`)) ?? [])
          : [];
      // Paging and search go in one and=(…), so neither clashes with the or=(…) an admin's scope uses.
      const conditions = [
        keyList ? `or(thread_key.is.null,thread_key.not.in.(${keyList}))` : "",
        pinnedRows.length ? `id.not.in.(${pinnedRows.map((r) => r.id).join(",")})` : "",
        !before
          ? ""
          : active
            ? beforeKey ? activeAfter(before, beforeKey) : `thread_at.lt.${at}`
            : beforeId ? `or(occurred_at.lt.${at},and(occurred_at.eq.${at},id.lt.${beforeId}))` : `occurred_at.lt.${at}`,
        searchCondition(param(req, "q")),
        box,
      ].filter(Boolean);
      const extra = conditions.length ? `&and=(${conditions.join(",")})` : "";
      if (active) {
        const pinned = before ? [] : pinnedHeads;
        // A conversation's messages come together, newest first; read enough to fill a page of them.
        const fetched = Math.min(limit * 4, 400);
        const rows = await sb<SummaryRow[]>(
          `mail_messages?${where}${filterClause(filter)}${extra}&select=${SUMMARY_COLUMNS}&order=${ACTIVE_ORDER}&limit=${fetched}`
        );
        const { heads, more } = conversationHeads(rows ?? [], limit, fetched);
        // A conversation shows unread while any message in it is, not just its newest.
        const keys = [...heads, ...pinned].map((r) => r.thread_key).filter((k): k is string => !!k);
        const unread = new Set(
          keys.length ? ((await sb<{ thread_key: string }[]>(`mail_messages?${where}&read_at=is.null&direction=eq.in&${keysIn(keys)}&select=thread_key`)) ?? []).map((r) => r.thread_key) : []
        );
        const head = (r: SummaryRow) => ({ ...toSummary(r), ...(r.thread_key && unread.has(r.thread_key) ? { read: false } : {}) });
        // A pinned conversation shows starred, whichever of its messages carries the star.
        return res.status(200).json({ messages: heads.map(head), hasMore: more, ...(pins ? { pinned: pinned.map((r) => ({ ...head(r), starred: true })) } : {}) });
      }
      const pinned = before ? [] : pinnedRows;
      const rows = await sb<SummaryRow[]>(
        `mail_messages?${where}${filterClause(filter)}${extra}` +
          `&select=${SUMMARY_COLUMNS}&order=occurred_at.desc,id.desc&limit=${limit + 1}`
      );
      return res.status(200).json({
        messages: (rows ?? []).slice(0, limit).map(toSummary),
        hasMore: (rows ?? []).length > limit,
        ...(pins ? { pinned: pinned.map(toSummary) } : {}),
      });
    }

    case "message": {
      const row = await findMessage(me, admin, param(req, "id"));
      if (!row) return fail(res, 404, "not_found");
      if (!row.read_at) {
        row.read_at = new Date().toISOString();
        await sb(`mail_messages?id=eq.${row.id}`, { method: "PATCH", body: { read_at: row.read_at } });
      }
      // Opened from Active, the row stood for the whole conversation: it's all read now.
      if (param(req, "conversation") === "1" && row.thread_key) {
        await sb(`mail_messages?${keysIn([row.thread_key])}&read_at=is.null&${ownFilter(me)}`, { method: "PATCH", body: { read_at: new Date().toISOString() } });
      }
      return res.status(200).json({ message: toMessage(row) });
    }

    case "thread": {
      // The conversation the message is in, newest first: linked by Message-ID, In-Reply-To and References.
      const row = await findMessage(me, admin, param(req, "id"));
      if (!row) return fail(res, 404, "not_found");
      const scope = scopeFilter(me.id, admin);
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
      const messages = [...found.values()].sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at))).slice(0, 40).map(toMessage);
      return res.status(200).json({ messages });
    }

    case "count": {
      // An admin assigns addresses; until then there's none (never one from a name the user typed).
      const address = me.mail_address ?? null;
      const aliases = address ? await listAliases(me.id) : [];
      const sync = await syncInbound({ budgetMs: COUNT_SYNC_BUDGET_MS }).catch((err) => ({ ingested: 0, error: problemText(err), skipped: false }));
      const [unread, otherUnread] = await Promise.all([
        countRows("mail_messages", `${folderFilter("inbox", me.id, admin)}&read_at=is.null`),
        admin ? countRows("mail_messages", `${folderFilter("other", me.id, admin)}&read_at=is.null`) : 0,
      ]);
      const counts = { unread, otherUnread, address, aliases, canSeeOther: admin };
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

    case "improve":
      return improve(res, body);

    // More addresses on the caller's own account. Owners and admins only, as
    // they're the ones who hand out addresses (role addresses included).
    case "alias-add": {
      if (!admin) return fail(res, 403, "forbidden", "Ask an owner or admin to add an address.");
      if (!me.mail_address) return fail(res, 400, "no_address", "Your account needs its main address first.");
      const r = await addAlias(me, body.address);
      if ("error" in r) return fail(res, r.error === "address_taken" ? 409 : 400, r.error, r.message);
      return res.status(200).json({ aliases: await listAliases(me.id) });
    }

    case "alias-remove": {
      if (!admin) return fail(res, 403, "forbidden");
      if (typeof body.address !== "string" || !body.address.trim()) return fail(res, 400, "bad_address");
      await removeAlias(me.id, body.address.trim());
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
      await sb(`mail_messages?id=in.(${ids.join(",")})&direction=eq.in&${scope}`, { method: "PATCH", body: { folder: body.folder } });
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

    case "delete": {
      const ids = idList(body.ids);
      if (!ids) return fail(res, 400, "bad_ids");
      // From Active, a row is a conversation: every message in it goes.
      let all = ids;
      if (body.conversation === true) {
        const keys = await threadKeysOf(ids, me);
        const rows = keys.length ? await sb<{ id: string }[]>(`mail_messages?${keysIn(keys)}&${ownFilter(me)}&select=id`) : [];
        all = [...new Set([...ids, ...(rows ?? []).map((r) => r.id)])];
      }
      await deleteMessages(all, scope);
      return res.status(200).json({ ok: true });
    }

    default:
      return fail(res, 400, "bad_action");
  }
}

const IMPROVE_MODEL = "claude-sonnet-5-5";

const IMPROVE_INSTRUCTIONS = `You lay out business emails so they read clearly and look polished and professional. You change the layout, not the message.

Rules:
- Keep every word's meaning. Keep every name, address, number, date and request exactly. Don't add facts, promises or new requests, and don't drop any.
- You may: split it into short paragraphs; put an address on its own lines (one line per part); turn a run of requests or steps into a numbered list, and a run of parallel items into a bulleted list; bold the few things a reader must not miss (an account number, an address, a deadline), sparingly; fix spelling, capitalization and punctuation.
- Keep the greeting and the sign-off, each in its own paragraph, and the sign-off's lines together with line breaks.
- Leave anything inside <blockquote> (quoted earlier mail) exactly as it is.
- No headings, no emoji, no colors, no tables.

Answer with the email body only, as an HTML fragment using just these tags: p, br, strong, em, ul, ol, li, blockquote, a. No <html> or <body>, no code fences, no commentary.`;

/** The same message, laid out better (the Improve design button). */
async function improve(res: VercelResponse, body: Record<string, unknown>) {
  const html = typeof body.html === "string" ? body.html : "";
  const clean = cleanCompose(html);
  if (!composeText(clean).trim()) return fail(res, 400, "empty", "Write the message first.");
  if (clean.length > 60_000) return fail(res, 413, "too_long", "That message is too long to redesign.");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail(res, 503, "not_configured", "Design help isn't set up (ANTHROPIC_API_KEY).");
  const subject = typeof body.subject === "string" ? body.subject.slice(0, 300) : "";
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: IMPROVE_MODEL,
    max_tokens: 8000,
    output_config: { effort: "low" },
    system: IMPROVE_INSTRUCTIONS,
    messages: [{ role: "user", content: `${subject ? `Subject: ${subject}\n\n` : ""}${clean}` }],
  });
  const out = message.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .replace(/^```(?:html)?\s*|```\s*$/g, "")
    .trim();
  const improved = cleanCompose(out);
  if (!composeText(improved).trim()) return fail(res, 502, "empty_response", "Couldn't redesign it just now. Try again.");
  return res.status(200).json({ html: improved });
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
    if (err instanceof BirdError) return fail(res, 502, "send_failed", err.message);
    throw err;
  }
}
