/**
 * Reconcile what Treasury lists against what the banks still report, after
 * someone chooses which accounts a connection shares (Plaid's update mode).
 *
 * POST                 → mark accounts the banks stopped reporting as "no
 *                        longer shared", hand mappings to accounts that
 *                        arrived under a new connection, and answer
 *                        { pruned, stopped: [...], adopted_mappings, unreachable }.
 * POST { dry_run: true } → the same answer, changing nothing.
 *
 * Nothing here deletes a Books transaction. An account the bank stops
 * reporting keeps its ledger (Plaid rows and CSV imports), its mapping and
 * its last balance; its prefs row is marked (disconnected_at, reason
 * 'not_shared', books_through), and only an account with nothing to keep (no
 * Books rows, no mapping, no nickname) is archived. Its change baseline
 * (plaid_account_state) is cleared.
 *
 * While any connection can't be reached (a bank waiting for re-login), the run
 * only reports: that bank's accounts are missing from what Plaid returns
 * without having stopped.
 *
 * Who may call it: owners and admins (isAdmin); partners get 403.
 * Env: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV; SUPABASE_URL,
 * SUPABASE_SERVICE_KEY.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getPlaidClient } from "../../lib/plaid.js";
import { currentUser, fail, guard, handleError, isAdmin, sb } from "../../lib/auth.js";
import { fetchAll } from "../../lib/db-pages.js";
import { adoptMappings, keepColumnsReady, stampIdentity, type LiveAccount } from "../../lib/plaid-mappings.js";
import { inList } from "../../lib/pg-filter.js";
import { audit } from "../../lib/audit.js";
import { bookSpans, keepPlan, type KeptPref } from "../../lib/plaid-history.js";

type PrefRow = {
  account_id: string;
  nickname: string | null;
  hidden: boolean | null;
  entity_id: string | null;
  entity_name: string | null;
  account_name: string | null;
  mask: string | null;
  institution_name: string | null;
  disconnected_at?: string | null;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["POST"])) return;

  try {
    // currentUser throws PartnerRefused for a partner; handleError answers 403.
    const user = await currentUser(req);
    if (!user) return fail(res, 401, "unauthorized");
    if (!isAdmin(user)) return fail(res, 403, "forbidden", "Only an owner or admin can change which accounts a bank shares.");

    const dryRun = !!req.body?.dry_run;
    const client = getPlaidClient();
    const items = await sb<Array<{ item_id: string; access_token: string; institution_name: string }>>("plaid_items?select=item_id,access_token,institution_name");

    // Ask every live connection which accounts it still has. A connection we
    // can't reach is skipped rather than treated as "everything is gone".
    const live = new Set<string>();
    const liveAccounts: LiveAccount[] = [];
    const unreachable: string[] = [];
    for (const item of items ?? []) {
      try {
        const r = await client.accountsGet({ access_token: item.access_token });
        for (const a of r.data.accounts) {
          live.add(a.account_id);
          liveAccounts.push({ account_id: a.account_id, institution_name: item.institution_name, mask: a.mask ?? null, subtype: a.subtype ?? null, name: a.name ?? null, type: a.type ?? null });
        }
      } catch {
        unreachable.push(item.institution_name);
      }
    }
    if (unreachable.length === (items?.length ?? 0)) return fail(res, 503, "no_connections_reachable", "No bank could be reached. Try again later.");

    const ready = await keepColumnsReady();
    const prefs = await fetchAll<PrefRow>(
      `plaid_account_prefs?select=account_id,nickname,hidden,entity_id,entity_name,account_name,mask,institution_name${ready ? ",disconnected_at" : ""}&archived_at=is.null&order=account_id.asc`,
    );
    const states = await fetchAll<{ account_id: string; balance: number | null; seen_at: string | null }>("plaid_account_state?select=account_id,balance,seen_at&order=account_id.asc");

    // Accounts that stopped being reported and aren't already marked.
    const stale = new Set<string>();
    for (const p of prefs) if (!live.has(p.account_id) && !p.disconnected_at && (p.entity_id || p.nickname || p.hidden)) stale.add(p.account_id);
    for (const s of states) if (!live.has(s.account_id)) stale.add(s.account_id);
    const prefById = new Map(prefs.map((p) => [p.account_id, p]));
    for (const id of [...stale]) if (prefById.get(id)?.disconnected_at) stale.delete(id);

    // What each holds in Books, every page of it (PostgREST stops at 1,000 rows without saying).
    const bookRows = stale.size ? await fetchAll<{ account_id: string; date: string }>(`book_transactions?account_id=in.(${inList(stale)})&select=account_id,date&order=transaction_id.asc`) : [];
    const spans = bookSpans(bookRows);
    const stopped = [...stale].map((id) => {
      const p = prefById.get(id);
      const span = spans.get(id) ?? { count: 0, from: null, to: null };
      return { account_id: id, name: p?.nickname || p?.account_name || null, mask: p?.mask ?? null, institution_name: p?.institution_name ?? null, entity_name: p?.entity_name ?? null, books: span };
    });

    const reportOnly = dryRun || unreachable.length > 0 || !ready;
    if (reportOnly) {
      // A bank awaiting re-login doesn't stop accounts that arrived under a
      // new connection from getting their mappings handed over.
      let adopted = 0;
      if (!dryRun) {
        await stampIdentity(liveAccounts, ready);
        adopted = await adoptMappings(liveAccounts, ready);
      }
      return res.json({ dry_run: dryRun, pruned: false, adopted_mappings: adopted, live_accounts: live.size, stopped, unreachable, ready });
    }

    const now = new Date();
    const plan = keepPlan({
      accountIds: stale,
      reason: "not_shared",
      states: new Map(states.map((s) => [s.account_id, s])),
      prefs: prefById as Map<string, KeptPref>,
      spans,
      now,
      keepEmpty: false,
    });
    if (plan.keep.length) {
      await sb("plaid_account_prefs", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: plan.keep.map((row) => ({ ...row, updated_by: user.id })),
      });
    }
    if (plan.archive.length) {
      // Nothing to keep behind these: no Books rows, no mapping, no nickname.
      await sb(`plaid_account_prefs?account_id=in.(${inList(plan.archive)})`, { method: "PATCH", prefer: "return=minimal", body: { archived_at: now.toISOString() } });
    }
    if (stale.size) await sb(`plaid_account_state?account_id=in.(${inList(stale)})`, { method: "DELETE", prefer: "return=minimal" });

    await stampIdentity(liveAccounts, ready);
    const adopted = await adoptMappings(liveAccounts, ready);

    if (stale.size) {
      const kept = stopped.reduce((s, a) => s + a.books.count, 0);
      await audit({
        actor: user,
        action: "treasury.accounts_unshared",
        target: { type: "bank_accounts", id: [...stale].sort().join(",").slice(0, 200), label: null },
        count: stale.size,
        summary: `${stale.size} account${stale.size === 1 ? "" : "s"} stopped syncing after the bank's account choice changed; ${kept} Books transaction${kept === 1 ? "" : "s"} kept`,
        detail: { accounts: stopped.map((a) => ({ institution: a.institution_name, mask: a.mask, name: a.name, entity: a.entity_name, books: a.books.count })), archived_empty: plan.archive.length },
      });
    }

    return res.json({ pruned: true, live_accounts: live.size, stopped, kept_transactions: stopped.reduce((s, a) => s + a.books.count, 0), adopted_mappings: adopted, unreachable, ready });
  } catch (err) {
    return handleError(res, err);
  }
}
