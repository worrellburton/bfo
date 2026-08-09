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
    return res.status(200).json({ user: publicUser(user) });
  } catch (err) {
    return handleError(res, err);
  }
}
