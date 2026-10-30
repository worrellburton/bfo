import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getPlaidClient } from "../../lib/plaid.js";
import { canWrite, currentUser, fail, handleError, sbFetch, type AppUser } from "../../lib/auth.js";

/**
 * Disconnect a bank connection — and leave the database clean.
 *
 * Plaid re-links a bank as a brand-new Item with fresh account_ids and
 * transaction_ids, so any rows left behind under the OLD ids would double up
 * against the reconnected data. This removes everything scoped to the item —
 * transactions, per-account state, per-account prefs, and the item itself.
 *
 * What we deliberately KEEP: book_rules. Those hold every categorization,
 * vendor rename, and type override the user taught, keyed by transaction
 * description — not by account. They survive the disconnect and re-apply
 * automatically the next time the reconnected account syncs, so vendors and
 * categories come back on their own.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // currentUser throws PartnerRefused for a partner; handleError answers 403.
  let user: AppUser | null;
  try {
    user = await currentUser(req);
  } catch (err) {
    return handleError(res, err);
  }
  if (!user) return res.status(401).json({ error: "unauthorized" });
  if (!canWrite(user)) return res.status(403).json({ error: "forbidden" });

  const item_id = String(req.query.item_id ?? "").trim();
  if (!item_id) return res.status(400).json({ error: "Missing item_id" });
  const enc = encodeURIComponent(item_id);

  try {
    const rest = (path: string, init?: RequestInit) => sbFetch(path, init);
    // fetch resolves on HTTP errors, so check ok: a cleanup that didn't happen
    // must stop the run while the item is still listed, so it can be retried.
    const del = async (path: string) => {
      const r = await rest(path, { method: "DELETE" });
      if (!r.ok) throw new Error(`delete ${path.split("?")[0]} failed: ${r.status}`);
    };

    const itemRes = await rest(`plaid_items?item_id=eq.${enc}&select=access_token`);
    const items = (await itemRes.json().catch((err) => (console.error("plaid/disconnect: couldn't read the item", err), []))) as Array<{ access_token: string }>;

    // Every account_id that belongs to this item, from both places that track it,
    // so the per-account prefs (entity mapping, nickname, hidden) get cleared too.
    const accountIds = new Set<string>();
    for (const p of [
      `plaid_account_state?item_id=eq.${enc}&select=account_id`,
      `book_transactions?item_id=eq.${enc}&select=account_id`,
    ]) {
      const rows = (await rest(p).then((r) => r.json()).catch((err) => (console.error("plaid/disconnect: couldn't list the item's accounts", err), []))) as Array<{ account_id: string }>;
      for (const r of rows) if (r.account_id) accountIds.add(r.account_id);
    }

    // Item-scoped deletes. The prefs go first (their ids are found through the
    // rows below, so a retry still finds them) and the item itself goes last.
    if (accountIds.size) {
      const list = [...accountIds].map((a) => `"${a.replace(/"/g, "")}"`).join(",");
      await del(`plaid_account_prefs?account_id=in.(${list})`);
    }
    await del(`book_transactions?item_id=eq.${enc}`);
    await del(`plaid_account_state?item_id=eq.${enc}`);

    // Revoke the item with Plaid once the local cleanup is done (best-effort —
    // a dead token shouldn't block the disconnect).
    if (items[0]?.access_token) {
      try {
        await getPlaidClient().itemRemove({ access_token: items[0].access_token });
      } catch (err) {
        // Already revoked or unreachable: the disconnect goes ahead regardless.
        console.error("plaid/disconnect: itemRemove failed", err);
      }
    }
    await del(`plaid_items?item_id=eq.${enc}`);

    res.json({ success: true, cleared_accounts: accountIds.size });
  } catch (err: any) {
    console.error("Plaid disconnect error:", err.message);
    return fail(res, 500, "server_error", "Couldn't finish disconnecting. Try again.");
  }
}
