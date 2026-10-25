import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, fail, guard, handleError } from "../lib/auth.js";
import { apnsConfig } from "../lib/apns.js";
import { TOKEN_RE, devicesFor, notifyTest, registerDevice, unregisterDevice } from "../lib/push.js";

/**
 * The iPhone app's push notifications (lib/push.ts). Any signed-in member,
 * for their own devices only.
 *
 * GET                                   → { configured, devices }
 * POST { action: "register", token }    → this phone gets notices for my new mail
 * POST { action: "unregister", token }  → it stops
 * POST { action: "test" }               → a test notice to my phones
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "POST"])) return;
  try {
    const me = await currentUser(req, { allowEmailOnly: true, allowPartner: true });
    if (!me) return fail(res, 401, "unauthorized");

    if (req.method === "GET") {
      const devices = await devicesFor([me.id]);
      return res.status(200).json({ configured: !!apnsConfig(), devices: devices.length });
    }

    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {}) as { action?: string; token?: unknown; platform?: unknown };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    switch (body.action) {
      case "register":
        if (!TOKEN_RE.test(token)) return fail(res, 400, "bad_token");
        await registerDevice(me.id, token, body.platform === "ios" || body.platform === undefined ? "ios" : String(body.platform).slice(0, 16));
        return res.status(200).json({ ok: true });
      case "unregister":
        if (!TOKEN_RE.test(token)) return fail(res, 400, "bad_token");
        await unregisterDevice(me.id, token);
        return res.status(200).json({ ok: true });
      case "test":
        return res.status(200).json(await notifyTest(me.id));
      default:
        return fail(res, 400, "bad_action");
    }
  } catch (err) {
    return handleError(res, err);
  }
}
