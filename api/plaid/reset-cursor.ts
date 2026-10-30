import type { VercelRequest, VercelResponse } from "@vercel/node";
import { canWrite, currentUser, handleError, sbFetch, type AppUser } from "../../lib/auth.js";

/**
 * Clear a connection's transactions cursor so the next Books sync re-pulls its
 * full available history from scratch. Used after a reconnect that extends the
 * requested window (days_requested) — /transactions/sync won't backfill older
 * months on its own once a cursor exists, so we reset it here.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  // currentUser throws PartnerRefused for a partner; handleError answers 403.
  let user: AppUser | null;
  try {
    user = await currentUser(req);
  } catch (err) {
    return handleError(res, err);
  }
  if (!user) return res.status(401).json({ error: "unauthorized" });
  if (!canWrite(user)) return res.status(403).json({ error: "forbidden" });

  const itemId = String(req.body?.item_id ?? "").trim();
  if (!itemId) return res.status(400).json({ error: "missing_item_id" });

  const r = await sbFetch(`plaid_items?item_id=eq.${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ transactions_cursor: null }),
  });
  if (!r.ok) {
    console.error("reset-cursor failed:", (await r.text()).slice(0, 300));
    return res.status(500).json({ error: "reset_failed" });
  }
  return res.status(200).json({ ok: true });
}
