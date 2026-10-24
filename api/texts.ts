import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, fail, guard, handleError, isAdmin, sb } from "../lib/auth.js";

/**
 * Texts to BFO's Bird number, for the Phone page (api/mail-webhook.ts keeps them): sign-in and
 * verification codes for the family office's own accounts, so owners and
 * admins only.
 *
 * GET  ?view=count               → { unread }
 * GET                            → { number, texts }  newest first (the last 200)
 * POST { action: "read", ids }   → mark these read
 * POST { action: "read-all" }    → mark every text read
 */

type Row = { id: string; from_number: string; to_number: string | null; body: string; code: string | null; received_at: string; read_at: string | null };

/** The number texts come in on: BIRD_SMS_FROM when it's set, else the toll-free line BFO holds at Bird. */
export const TEXT_NUMBER = () => process.env.BIRD_SMS_FROM?.trim() || "+18445192725";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "POST"])) return;
  try {
    const me = await currentUser(req);
    if (!me) return fail(res, 401, "unauthorized");
    if (!isAdmin(me)) return fail(res, 403, "forbidden", "Only an owner or admin sees the office's texts.");

    if (req.method === "GET") {
      if (req.query.view === "count") {
        const rows = await sb<{ id: string }[]>("sms_messages?read_at=is.null&select=id&limit=100");
        return res.status(200).json({ unread: rows.length });
      }
      const rows = await sb<Row[]>("sms_messages?select=id,from_number,to_number,body,code,received_at,read_at&order=received_at.desc&limit=200");
      return res.status(200).json({
        number: TEXT_NUMBER(),
        texts: rows.map((r) => ({ id: r.id, from: r.from_number, to: r.to_number, body: r.body, code: r.code, receivedAt: r.received_at, readAt: r.read_at })),
      });
    }

    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {}) as { action?: string; ids?: unknown };
    const stamp = { read_at: new Date().toISOString(), read_by: me.id };
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
