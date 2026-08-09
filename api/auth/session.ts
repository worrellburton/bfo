import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  bearerToken,
  currentUser,
  fail,
  guard,
  handleError,
  publicUser,
  sb,
} from "../../lib/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "DELETE"])) return;

  try {
    if (req.method === "DELETE") {
      const token = bearerToken(req);
      if (token && /^[0-9a-f-]{36}$/i.test(token)) {
        await sb(`app_sessions?token=eq.${encodeURIComponent(token)}`, { method: "DELETE" });
      }
      return res.status(200).json({ ok: true });
    }

    const user = await currentUser(req);
    if (!user) return fail(res, 401, "unauthorized");

    const token = bearerToken(req)!;
    const rows = await sb<Array<{ expires_at: string }>>(
      `app_sessions?token=eq.${encodeURIComponent(token)}&select=expires_at&limit=1`
    );
    return res
      .status(200)
      .json({ user: publicUser(user), expiresAt: rows?.[0]?.expires_at ?? null });
  } catch (err) {
    return handleError(res, err);
  }
}
