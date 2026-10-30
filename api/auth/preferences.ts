import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, fail, guard, handleError, isPartner, sb } from "../../lib/auth.js";

/**
 * The signed-in user's own notification settings. No admin rights needed.
 * A partner keeps only their phone notices (`push`): the Treasury report is
 * the whole office's, so it is staff-only.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "PUT"])) return;

  try {
    const me = await currentUser(req, { allowPartner: true });
    if (!me) return fail(res, 401, "unauthorized");

    if (req.method === "GET") {
      const rows = await sb<Array<{ notification_prefs: Record<string, unknown> }>>(
        `app_users?id=eq.${me.id}&select=notification_prefs&limit=1`
      );
      return res.status(200).json({ preferences: rows?.[0]?.notification_prefs ?? {} });
    }

    const incoming = req.body?.preferences;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      return fail(res, 400, "invalid_preferences");
    }

    let prefs: Record<string, unknown> = incoming;
    if (isPartner(me)) {
      // Only `push`; a save that leaves it out keeps the one already stored.
      const stored = "push" in incoming ? null : (await sb<Array<{ notification_prefs: Record<string, unknown> | null }>>(`app_users?id=eq.${me.id}&select=notification_prefs&limit=1`))?.[0]?.notification_prefs;
      const push = "push" in incoming ? (incoming as Record<string, unknown>).push : stored?.push;
      prefs = push === undefined ? {} : { push };
    }
    const updated = await sb<Array<{ notification_prefs: Record<string, unknown> }>>(
      `app_users?id=eq.${me.id}`,
      {
        method: "PATCH",
        prefer: "return=representation",
        body: { notification_prefs: prefs },
      }
    );
    return res.status(200).json({ preferences: updated?.[0]?.notification_prefs ?? prefs });
  } catch (err) {
    return handleError(res, err);
  }
}
