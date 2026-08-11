import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, sb, sbFetch } from "../../lib/auth.js";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

/**
 * Reconcile what we store against what the banks still report.
 *
 * When an account is closed — or deselected in Plaid's account picker — it
 * stops coming back from Plaid, but its nickname/entity mapping, balance
 * snapshots and synced Books transactions linger. This clears those out so a
 * closed account leaves nothing behind.
 *
 * POST → { removed: [{ account_id, mask, ... }], counts }
 * POST { dry_run: true } → report what would be removed, delete nothing.
 */

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });

  const dryRun = !!req.body?.dry_run;

  try {
    const client = getPlaidClient();
    const items = await sb<Array<{ item_id: string; access_token: string; institution_name: string }>>(
      "plaid_items?select=item_id,access_token,institution_name"
    );

    // Ask every live connection which accounts it still has. A connection we
    // can't reach is skipped rather than treated as "everything is gone".
    const live = new Set<string>();
    const unreachable: string[] = [];
    for (const item of items ?? []) {
      try {
        const r = await client.accountsGet({ access_token: item.access_token });
        for (const a of r.data.accounts) live.add(a.account_id);
      } catch {
        unreachable.push(item.institution_name);
      }
    }
    if (unreachable.length === (items?.length ?? 0)) {
      return res.status(503).json({ error: "no_connections_reachable", banks: unreachable });
    }

    // Only mappings worth keeping count as stale — bare identity rows carry
    // nothing to preserve.
    const prefs = await sb<Array<{ account_id: string; nickname: string | null; entity_name: string | null }>>(
      "plaid_account_prefs?select=account_id,nickname,entity_name&archived_at=is.null" +
        "&or=(entity_id.not.is.null,nickname.not.is.null,hidden.is.true)"
    );
    const states = await sb<Array<{ account_id: string }>>("plaid_account_state?select=account_id");

    const stale = new Set<string>();
    for (const p of prefs ?? []) if (!live.has(p.account_id)) stale.add(p.account_id);
    for (const s of states ?? []) if (!live.has(s.account_id)) stale.add(s.account_id);

    // Books rows for accounts the banks no longer report.
    const bookAccounts = await sb<Array<{ account_id: string }>>(
      "book_transactions?select=account_id"
    );
    const staleBooks = new Set<string>();
    for (const b of bookAccounts ?? []) if (!live.has(b.account_id)) staleBooks.add(b.account_id);

    const removed = [...stale].map((id) => {
      const pref = (prefs ?? []).find((p) => p.account_id === id);
      return { account_id: id, nickname: pref?.nickname ?? null, entity_name: pref?.entity_name ?? null };
    });

    if (dryRun) {
      return res.json({
        dry_run: true,
        live_accounts: live.size,
        would_remove_prefs: removed.length,
        would_remove_book_accounts: staleBooks.size,
        removed,
        unreachable,
      });
    }

    const inList = (ids: Set<string>) => [...ids].map((id) => `"${id}"`).join(",");
    let removedTxns = 0;
    if (stale.size) {
      // Mappings are archived rather than deleted: an account that comes back
      // under a new connection gets its entity and nickname handed back. The
      // archived row is invisible everywhere, since every view is built from
      // the accounts Plaid currently reports.
      await sbFetch(`plaid_account_prefs?account_id=in.(${inList(stale)})`, {
        method: "PATCH",
        body: JSON.stringify({ archived_at: new Date().toISOString() }),
      });
      await sbFetch(`plaid_account_state?account_id=in.(${inList(stale)})`, { method: "DELETE" });
    }
    if (staleBooks.size) {
      const countRes = await sbFetch(
        `book_transactions?account_id=in.(${inList(staleBooks)})&select=transaction_id&limit=1`,
        { headers: { Prefer: "count=exact" } }
      );
      removedTxns = Number(countRes.headers.get("content-range")?.split("/")[1] ?? 0);
      await sbFetch(`book_transactions?account_id=in.(${inList(staleBooks)})`, { method: "DELETE" });
    }

    return res.json({
      pruned: true,
      live_accounts: live.size,
      removed_accounts: removed.length,
      removed_transactions: removedTxns,
      removed,
      unreachable,
    });
  } catch (err: any) {
    console.error("prune-accounts error:", err.response?.data || err.message);
    return res.status(500).json({ error: "prune_failed", message: "Couldn't reconcile accounts." });
  }
}
