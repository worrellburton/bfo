import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ConfigError, currentUser, fail, guard, handleError, isAdmin, sb } from "../lib/auth.js";
import { textNumber } from "../lib/sms-inbound.js";
import { SmsRefused, sendText } from "../lib/sms-send.js";
import type { SmsSetup } from "../lib/sms-setup.js";
import { fixSmsSetup, replayMissedTexts, smsSetup } from "../lib/sms-setup.js";

/**
 * Texts to and from BFO's Bird number, for the Phone page (api/mail-webhook.ts keeps the ones that
 * arrive, and their delivery receipts): sign-in and verification codes for the family office's own
 * accounts, and replies sent from the number, so owners and admins only.
 *
 * GET  ?view=count               → { unread }
 * GET  ?view=setup               → { setup }  can texts reach BFO, and go out? (lib/sms-setup.ts, asks Bird)
 * GET                            → { number, texts }  newest first (the last 500), each with
 *                                  direction ("in" | "out"), and for a sent one Bird's status and why it failed
 * POST { action: "send", to, text, key? } → { text }  sends from BFO's number (lib/sms-send.ts) and keeps it;
 *                                  a refusal is 400/409/422/502 { error, message } with a plain sentence
 *                                  (409 still_sending and 502: retry with the same key)
 * POST { action: "read", ids }   → mark these read
 * POST { action: "read-all" }    → mark every text read
 * POST { action: "fix-setup" }   → add sms.received and the delivery receipts to Bird's webhook (and un-pause it), then { setup }
 * POST { action: "replay" }      → have Bird resend what failed to reach BFO's verified webhook in the last day, then { setup }
 *
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
};

const TEXT_NUMBER = textNumber;

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

    if (req.method === "GET") {
      if (req.query.view === "setup") return checked(res, () => smsSetup(TEXT_NUMBER()));
      if (req.query.view === "count") {
        const rows = await sb<{ id: string }[]>("sms_messages?read_at=is.null&select=id&limit=100");
        return res.status(200).json({ unread: rows.length });
      }
      const rows = await sb<Row[]>("sms_messages?select=id,from_number,to_number,body,code,received_at,read_at,direction,status,error&order=received_at.desc,id.desc&limit=500");
      return res.status(200).json({
        number: TEXT_NUMBER(),
        texts: rows.map((r) => ({
          id: r.id,
          from: r.from_number,
          to: r.to_number,
          body: r.body,
          code: r.code,
          receivedAt: r.received_at,
          readAt: r.read_at,
          direction: r.direction ?? "in",
          status: r.status,
          error: r.error,
        })),
      });
    }

    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {}) as { action?: string; ids?: unknown; to?: unknown; text?: unknown; key?: unknown };
    const stamp = { read_at: new Date().toISOString(), read_by: me.id };
    if (body.action === "send") {
      if (typeof body.to !== "string" || typeof body.text !== "string") return fail(res, 400, "bad_request", "Give a number and a text.");
      try {
        const text = await sendText({ to: body.to, text: body.text, userId: me.id, key: typeof body.key === "string" ? body.key : undefined });
        return res.status(200).json({ text });
      } catch (err) {
        if (err instanceof SmsRefused) return fail(res, err.httpStatus, err.code, err.message);
        throw err;
      }
    }
    if (body.action === "fix-setup") return checked(res, () => fixSmsSetup(TEXT_NUMBER()));
    if (body.action === "replay") return checked(res, () => replayMissedTexts(TEXT_NUMBER()));
    if (body.action === "read-all") {
      await sb("sms_messages?read_at=is.null", { method: "PATCH", body: stamp, prefer: "return=minimal" });
      return res.status(200).json({ ok: true });
    }
    if (body.action === "read") {
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter((id) => /^[\w.:-]{1,200}$/.test(id)).slice(0, 200);
      if (!ids.length) return fail(res, 400, "missing_ids");
      await sb(`sms_messages?id=in.(${ids.map((i) => `"${i}"`).join(",")})&read_at=is.null`, { method: "PATCH", body: stamp, prefer: "return=minimal" });
      return res.status(200).json({ ok: true });
    }
    return fail(res, 400, "bad_action");
  } catch (err) {
    return handleError(res, err);
  }
}
