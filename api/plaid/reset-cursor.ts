/**
 * Clear a connection's transactions cursor so the next Books sync re-pulls its
 * full available history from scratch. Used after a reconnect that extends the
 * requested window (days_requested): /transactions/sync won't backfill older
 * months on its own once a cursor exists, so it is reset here. Re-pulled rows
 * merge on their transaction ids; nothing is deleted.
 *
 * POST { item_id } → { ok: true }
 *
 * Who may call it: owners and admins (isAdmin), after update mode. Partners
 * get 403 (PartnerRefused).
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, fail, handleError, isAdmin, sbFetch, type AppUser } from "../../lib/auth.js";
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
  if (!isAdmin(user)) return fail(res, 403, "forbidden", "Only an owner or admin can change a bank connection.");

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
