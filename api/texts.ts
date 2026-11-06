import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit } from "../lib/audit.js";
import { ConfigError, currentUser, fail, guard, handleError, isAdmin, sb } from "../lib/auth.js";
import { CODE_KEEP_DAYS, CODE_REVEAL_MS, CODE_SHOWN_MS, codeShown, maskCode } from "../lib/sms-compose.js";
import { formatPhone, textNumber } from "../lib/sms-inbound.js";
import { SmsRefused, sendText } from "../lib/sms-send.js";
import type { SmsSetup } from "../lib/sms-setup.js";
import { fixSmsSetup, replayMissedTexts, smsSetup } from "../lib/sms-setup.js";

/**
 * Texts to and from BFO's Bird number, for the Phone page (api/mail-webhook.ts keeps the ones that
 * arrive, and their delivery receipts): sign-in and verification codes for the family office's own
 * accounts, and replies sent from the number, so owners and admins only.
 *
 * A sign-in code is shown in full for ten minutes after it arrives, then masked; the body of a code
 * text never repeats the code. After that, showing it again (show-code) and every copy (code-copied)
 * are recorded in the audit log (lib/audit.ts) with who and when, and each code text carries that
 * record. Code texts older than 90 days lose their body and code for good.
 *
 * GET  ?view=count               → { unread }
 * GET  ?view=setup               → { setup }  can texts reach BFO, and go out? (lib/sms-setup.ts, asks Bird)
 * GET  [?before=<iso>]           → { number, texts, more }  newest first, 500 at a time (before: older than
 *                                  that time). Each: direction ("in" | "out"); a sent one's Bird status, why it
 *                                  failed and who sent it (sentBy); a code text's code while it's shown
 *                                  (codeUntil), codeMasked after, and codeAccess [{ action, by, at }]
 * POST { action: "send", to, text, key?, consent? } → { text }  sends from BFO's number (lib/sms-send.ts) and keeps
 *                                  it; a first text needs consent: true. A refusal is 400/409/422/502 { error, message }
 *                                  with a plain sentence (409 still_sending and 502: retry with the same key)
 * POST { action: "show-code", id } → { code, until, access }  a masked code, shown again for a minute (recorded)
 * POST { action: "code-copied", id } → { access }  records that the person copied the code
 * POST { action: "read", ids }   → mark these read
 * POST { action: "read-all" }    → mark every text read
 * POST { action: "fix-setup" }   → add sms.received and the delivery receipts to Bird's webhook (and un-pause it), then { setup }
 * POST { action: "replay" }      → have Bird resend what failed to reach BFO's verified webhook in the last day, then { setup }
 *
 * Who may call it: approved owners and admins (partners get 403).
 * Env: BIRD_ACCESS_KEY; BIRD_SMS_FROM optional.
 */

type Row = {
  id: string;
  from_number: string;
  to_number: string | null;
  body: string;
  code: string | null;
  received_at: string;
  read_at: string | null;
  direction: "in" | "out" | null;
  status: string | null;
  error: string | null;
  sent_by: string | null;
};

export type CodeAccess = { action: "copy" | "show"; by: string; byId: string | null; at: string };
type AuditRead = { target_id: string; action: string; actor_name: string | null; actor_id: string | null; at: string };

const PAGE = 500;
const ID = /^[\w.:-]{1,200}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/;
const quoted = (ids: string[]) => ids.map((i) => encodeURIComponent(`"${i}"`)).join(",");

/** A row as the page shows it. The code, while shown, is the only place it appears; the body has it masked. Pure. */
export function presentText(r: Row, now: number, names: Map<string, string>, access: Map<string, CodeAccess[]>) {
  const out = r.direction === "out";
  const shown = !!r.code && codeShown(r.received_at, now);
  return {
    id: r.id,
    from: r.from_number,
    to: r.to_number,
    body: r.code ? maskCode(r.body, r.code) : r.body,
    code: shown ? r.code : null,
    codeMasked: !!r.code && !shown,
    codeUntil: r.code ? new Date(Date.parse(r.received_at) + CODE_SHOWN_MS).toISOString() : null,
    codeAccess: r.code ? (access.get(r.id) ?? []) : [],
    receivedAt: r.received_at,
    readAt: r.read_at,
    direction: r.direction ?? "in",
    status: r.status,
    error: r.error,
    // A sent text names who sent it; one with no sender is BFO's automatic answer to HELP.
    sentBy: out ? (r.sent_by ? (names.get(r.sent_by) ?? "Someone in the office") : "BFO") : null,
    sentById: out ? r.sent_by : null,
  };
}

/** Who has seen or copied each code, newest first, from the audit log. Empty while the log isn't there yet. */
async function codeAccessFor(ids: string[]): Promise<Map<string, CodeAccess[]>> {
  const out = new Map<string, CodeAccess[]>();
  if (!ids.length) return out;
  try {
    const rows =
      (await sb<AuditRead[] | null>(
        `audit_log?target_type=eq.sms_message&target_id=in.(${quoted(ids)})&action=in.(phone.code_copy,phone.code_show)&select=target_id,action,actor_name,actor_id,at&order=at.desc&limit=1000`,
      )) ?? [];
    for (const a of rows) {
      const list = out.get(a.target_id) ?? [];
      list.push({ action: a.action === "phone.code_show" ? "show" : "copy", by: a.actor_name || "Someone in the office", byId: a.actor_id, at: a.at });
      out.set(a.target_id, list);
    }
  } catch {
    // The audit log isn't applied yet: no record to show.
  }
  return out;
}

async function namesFor(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i)))];
  if (!unique.length) return out;
  const rows = (await sb<{ id: string; name: string | null; email: string | null }[] | null>(`app_users?id=in.(${unique.join(",")})&select=id,name,email`)) ?? [];
  for (const u of rows) out.set(u.id, u.name?.trim() || u.email?.split("@")[0] || "Someone in the office");
  return out;
}

let lastPurge = 0;
/**
 * Code texts older than 90 days keep only a masked body: the code, its copy in
 * the body, and Bird's raw event (which repeats the text) are removed. Runs at
 * most every six hours per server, a hundred rows at a time.
 */
async function purgeOldCodes(now = Date.now()): Promise<void> {
  if (now - lastPurge < 6 * 3600_000) return;
  lastPurge = now;
  try {
    const cutoff = new Date(now - CODE_KEEP_DAYS * 86_400_000).toISOString();
    const rows = (await sb<{ id: string; body: string; code: string }[] | null>(`sms_messages?code=not.is.null&received_at=lt.${encodeURIComponent(cutoff)}&select=id,body,code&limit=100`)) ?? [];
    for (const r of rows) {
      if (!ID.test(r.id)) continue;
      await sb(`sms_messages?id=eq.${encodeURIComponent(r.id)}`, { method: "PATCH", body: { body: maskCode(r.body ?? "", r.code), code: null, payload: {} }, prefer: "return=minimal" });
    }
  } catch (err) {
    console.warn("texts: couldn't purge old codes", { failed: true, isError: err instanceof Error });
  }
}

/** Bird's answer for the setup card; when Bird can't be asked, why (owners and admins only, never a secret). */
async function checked(res: VercelResponse, run: () => Promise<SmsSetup>) {
  try {
    return res.status(200).json({ setup: await run() });
  } catch (err) {
    if (err instanceof ConfigError) return res.status(200).json({ setup: null, error: err.message });
    console.error("texts: setup check failed", err);
    return res.status(200).json({ setup: null, error: err instanceof Error ? err.message.slice(0, 200) : "unknown error" });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "POST"])) return;
  try {
    const me = await currentUser(req);
    if (!me) return fail(res, 401, "unauthorized");
    if (!isAdmin(me)) return fail(res, 403, "forbidden", "Only an owner or admin sees the office's texts.");
    const actor = { id: me.id, name: me.name || me.email || null, role: me.role };

    if (req.method === "GET") {
      if (req.query.view === "setup") return checked(res, () => smsSetup(textNumber()));
      if (req.query.view === "count") {
        const rows = await sb<{ id: string }[]>("sms_messages?read_at=is.null&select=id&limit=100");
        return res.status(200).json({ unread: rows.length });
      }
      await purgeOldCodes();
      const before = String(req.query.before ?? "");
      const older = ISO.test(before) ? `&received_at=lt.${encodeURIComponent(before)}` : "";
      const rows =
        (await sb<Row[] | null>(`sms_messages?select=id,from_number,to_number,body,code,received_at,read_at,direction,status,error,sent_by${older}&order=received_at.desc,id.desc&limit=${PAGE}`)) ??
        [];
      const [names, access] = await Promise.all([namesFor(rows.map((r) => r.sent_by ?? "")), codeAccessFor(rows.filter((r) => r.code).map((r) => r.id))]);
      const now = Date.now();
      return res.status(200).json({ number: textNumber(), texts: rows.map((r) => presentText(r, now, names, access)), more: rows.length === PAGE });
    }

    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {})) as {
      action?: string;
      id?: unknown;
      ids?: unknown;
      to?: unknown;
      text?: unknown;
      key?: unknown;
      consent?: unknown;
    };
    const stamp = { read_at: new Date().toISOString(), read_by: me.id };

    if (body.action === "send") {
      if (typeof body.to !== "string" || typeof body.text !== "string") return fail(res, 400, "bad_request", "Give a number and a text.");
      try {
        const text = await sendText({ to: body.to, text: body.text, userId: me.id, userName: actor.name, key: typeof body.key === "string" ? body.key : undefined, consent: body.consent === true });
        const { first, ...shown } = text;
        const label = formatPhone(text.to);
        if (first)
          await audit({
            actor,
            action: "phone.consent",
            target: { type: "phone_number", id: text.to, label },
            summary: `Confirmed that ${label} agreed to texts from the office`,
          });
        await audit({ actor, action: "phone.send", target: { type: "phone_number", id: text.to, label }, summary: `Texted ${label}`, detail: { messageId: text.id, first } });
        return res.status(200).json({ text: shown });
      } catch (err) {
        if (err instanceof SmsRefused) return fail(res, err.httpStatus, err.code, err.message);
        throw err;
      }
    }

    if (body.action === "show-code" || body.action === "code-copied") {
      const id = String(body.id ?? "");
      if (!ID.test(id)) return fail(res, 400, "bad_id");
      const [row] = (await sb<Row[] | null>(`sms_messages?id=eq.${encodeURIComponent(id)}&select=id,from_number,code,received_at&limit=1`)) ?? [];
      if (!row?.code) return fail(res, 404, "not_found", "That text has no code.");
      const from = formatPhone(row.from_number);
      const showing = body.action === "show-code";
      await audit({
        actor,
        action: showing ? "phone.code_show" : "phone.code_copy",
        target: { type: "sms_message", id, label: `Code from ${from}` },
        summary: showing ? `Showed a masked code from ${from}` : `Copied a code from ${from}`,
      });
      const access = (await codeAccessFor([id])).get(id) ?? [];
      if (!showing) return res.status(200).json({ access });
      return res.status(200).json({ code: row.code, until: new Date(Date.now() + CODE_REVEAL_MS).toISOString(), access });
    }

    if (body.action === "fix-setup") return checked(res, () => fixSmsSetup(textNumber()));
    if (body.action === "replay") return checked(res, () => replayMissedTexts(textNumber()));
    if (body.action === "read-all") {
      await sb("sms_messages?read_at=is.null", { method: "PATCH", body: stamp, prefer: "return=minimal" });
      return res.status(200).json({ ok: true });
    }
    if (body.action === "read") {
      const ids = (Array.isArray(body.ids) ? body.ids : [])
        .map(String)
        .filter((id) => ID.test(id))
        .slice(0, 200);
      if (!ids.length) return fail(res, 400, "missing_ids");
      await sb(`sms_messages?id=in.(${ids.map((i) => `"${i}"`).join(",")})&read_at=is.null`, { method: "PATCH", body: stamp, prefer: "return=minimal" });
      return res.status(200).json({ ok: true });
    }
    return fail(res, 400, "bad_action");
  } catch (err) {
    return handleError(res, err);
  }
}
