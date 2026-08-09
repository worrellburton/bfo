import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, fail, guard, handleError, sb } from "../../lib/auth.js";

/** The signed-in user's own notification settings. No admin rights needed. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "PUT"])) return;

  try {
    const me = await currentUser(req);
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

    const updated = await sb<Array<{ notification_prefs: Record<string, unknown> }>>(
      `app_users?id=eq.${me.id}`,
      {
        method: "PATCH",
        prefer: "return=representation",
        body: { notification_prefs: incoming },
      }
    );
    return res.status(200).json({ preferences: updated?.[0]?.notification_prefs ?? incoming });
  } catch (err) {
    return handleError(res, err);
  }
}
