import type { VercelRequest, VercelResponse } from "@vercel/node";
import { alertAdmins, alertOnThrow } from "../lib/alert.js";
import { secretMatches } from "../lib/auth.js";
import { getMailItem, saveMail, StableNotConfigured } from "../lib/stable.js";

/**
 * Stable calls this when a piece of mail arrives or changes (mailItem.*,
 * check.*). Stable doesn't sign its webhooks, so the call is only a nudge:
 * it must carry the shared token, and the mail item is then read back from
 * Stable's API by id, never taken from the request.
 *
 * Set up in Stable → Settings → Webhooks: the URL
 * https://<site>/api/stable-webhook?token=<STABLE_WEBHOOK_TOKEN>, with the mailItem events.
 */
// An error nothing below caught alerts the admins (lib/alert.ts) and still answers 500, so Stable retries.
export default alertOnThrow("webhook:stable", "Stable webhook crashed", handle);

async function handle(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const token = process.env.STABLE_WEBHOOK_TOKEN;
  if (!token) return res.status(503).json({ error: "not_configured" });
  const presented = Array.isArray(req.query.token) ? req.query.token[0] : req.query.token;
  if (!secretMatches(presented, token)) return res.status(401).json({ error: "bad_token" });

  const body = (typeof req.body === "string" ? safeJson(req.body) : req.body) as { eventType?: string; data?: Record<string, unknown> } | null;
  const data = body?.data ?? {};
  // Mail events carry the mail item; check events point at the one they came from.
  const id = String((body?.eventType?.startsWith("check.") ? data.mailItemId : data.id) ?? "");
  if (!/^[\w-]{6,64}$/.test(id)) return res.status(200).json({ ok: true, ignored: true });
  try {
    await saveMail([await getMailItem(id)]);
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (err instanceof StableNotConfigured) return res.status(503).json({ error: "not_configured" });
    // Stable doesn't know the piece (deleted, or not ours): nothing to retry.
    if (err instanceof Error && /^stable 404\b/.test(err.message)) return res.status(200).json({ ok: true, ignored: true });
    console.error("stable webhook failed", body?.eventType, id, err);
    await alertAdmins("webhook:stable", "Stable webhook couldn't store a piece of mail", `${body?.eventType ?? "event"} ${id}: ${err instanceof Error ? err.message : String(err)}`);
    // 500 so Stable tries again; the hourly sync catches it otherwise.
    return res.status(500).json({ error: "failed" });
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
