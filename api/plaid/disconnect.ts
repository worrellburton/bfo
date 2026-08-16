import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser } from "../../lib/auth.js";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

function getPlaidClient() {
  const config = new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV || "sandbox"],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!,
        "PLAID-SECRET": process.env.PLAID_SECRET!,
      },
    },
  });
  return new PlaidApi(config);
}

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

  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });

  const item_id = String(req.query.item_id ?? "").trim();
  if (!item_id) return res.status(400).json({ error: "Missing item_id" });
  const enc = encodeURIComponent(item_id);

  try {
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_KEY!;
    const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    const rest = (path: string, init?: RequestInit) => fetch(`${url}/rest/v1/${path}`, { ...init, headers });

    // Revoke the item with Plaid (best-effort — a dead token shouldn't block cleanup).
    const itemRes = await rest(`plaid_items?item_id=eq.${enc}&select=access_token`);
    const items = (await itemRes.json().catch(() => [])) as Array<{ access_token: string }>;
    if (items[0]?.access_token) {
      try {
        await getPlaidClient().itemRemove({ access_token: items[0].access_token });
      } catch {
        /* already revoked or unreachable — proceed with local cleanup */
      }
    }

    // Every account_id that belongs to this item, from both places that track it,
    // so the per-account prefs (entity mapping, nickname, hidden) get cleared too.
    const accountIds = new Set<string>();
    for (const p of [
      `plaid_account_state?item_id=eq.${enc}&select=account_id`,
      `book_transactions?item_id=eq.${enc}&select=account_id`,
    ]) {
      const rows = (await rest(p).then((r) => r.json()).catch(() => [])) as Array<{ account_id: string }>;
      for (const r of rows) if (r.account_id) accountIds.add(r.account_id);
    }

    // Item-scoped deletes.
    await rest(`book_transactions?item_id=eq.${enc}`, { method: "DELETE" });
    await rest(`plaid_account_state?item_id=eq.${enc}`, { method: "DELETE" });
    if (accountIds.size) {
      const list = [...accountIds].map((a) => `"${a.replace(/"/g, "")}"`).join(",");
      await rest(`plaid_account_prefs?account_id=in.(${list})`, { method: "DELETE" });
    }
    await rest(`plaid_items?item_id=eq.${enc}`, { method: "DELETE" });

    res.json({ success: true, cleared_accounts: accountIds.size });
  } catch (err: any) {
    console.error("Plaid disconnect error:", err.message);
    res.status(500).json({ error: err.message });
  }
}
