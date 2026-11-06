/**
 * Disconnect a bank connection: stop the feed, keep the books.
 *
 * GET  ?item_id=…  → what disconnecting would affect: the connection's
 *                    accounts (name, last four, last balance, entity) and the
 *                    Books transactions they hold (count and date range).
 *                    Reads the database only; never calls Plaid.
 * POST ?item_id=…  → revoke the connection at Plaid, then mark its accounts
 *                    "disconnected" and forget the access token. Answers
 *                    { success, kept_accounts, kept_transactions }.
 *
 * What a disconnect keeps: every Books transaction of the connection's
 * accounts (Plaid rows and CSV imports, with their categories, loan links,
 * intercompany pairings and type overrides), the accounts' mappings and
 * nicknames, and each account's last known balance and its date
 * (plaid_account_prefs.disconnected_at, last_balance, books_through). A later
 * reconnect continues the same accounts (lib/plaid-mappings.ts).
 *
 * What it removes: the access token (plaid_items) and the per-account change
 * baseline (plaid_account_state), and only after Plaid confirms the link is
 * revoked, or answers that it is already gone. If Plaid can't confirm,
 * nothing changes and the person is asked to try again, so BFO never loses
 * the token of a link that is still live at the bank.
 *
 * Who may call it: owners and admins (isAdmin). Partners get 403
 * (PartnerRefused), members and viewers 403.
 * Env: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV (lib/plaid.ts);
 * SUPABASE_URL, SUPABASE_SERVICE_KEY (lib/auth.ts).
 *
 * Every disconnect is written to the audit log (lib/audit.ts) and to the
 * activity of each entity its accounts were mapped to.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getPlaidClient } from "../../lib/plaid.js";
import { currentUser, fail, guard, handleError, isAdmin, sb } from "../../lib/auth.js";
import { fetchAll } from "../../lib/db-pages.js";
import { inList } from "../../lib/pg-filter.js";
import { audit } from "../../lib/audit.js";
import { logActivity } from "../../lib/activity.js";
import { bookSpans, keepPlan, revocationOutcome, totalSpan, type BookSpan } from "../../lib/plaid-history.js";
import { keepColumnsReady } from "../../lib/plaid-mappings.js";

type Item = { item_id: string; access_token: string; institution_name: string | null };
type State = { account_id: string; balance: number | null; seen_at: string | null };
type Pref = {
  account_id: string;
  nickname: string | null;
  hidden: boolean | null;
  entity_id: string | null;
  entity_name: string | null;
  account_name: string | null;
  mask: string | null;
  subtype: string | null;
  account_type: string | null;
  disconnected_at: string | null;
};

export type DisconnectImpact = {
  item_id: string;
  institution_name: string;
  accounts: Array<{
    account_id: string;
    name: string | null;
    mask: string | null;
    subtype: string | null;
    type: string | null;
    balance: number | null;
    balance_at: string | null;
    entity_id: string | null;
    entity_name: string | null;
    hidden: boolean;
    books: BookSpan;
  }>;
  books: BookSpan;
};

/** Everything the connection's accounts hold, read from the database only. */
async function impactOf(itemId: string): Promise<{ item: Item | null; impact: DisconnectImpact; states: Map<string, State>; prefs: Map<string, Pref>; spans: Map<string, BookSpan> }> {
  const enc = encodeURIComponent(itemId);
  const [items, states, itemBooks] = await Promise.all([
    sb<Item[]>(`plaid_items?item_id=eq.${enc}&select=item_id,access_token,institution_name&limit=1`),
    sb<State[]>(`plaid_account_state?item_id=eq.${enc}&select=account_id,balance,seen_at`),
    // The connection's accounts, as Books knows them. CSV imports carry their
    // own item id, so the rows themselves are counted by account below.
    fetchAll<{ account_id: string }>(`book_transactions?item_id=eq.${enc}&select=account_id&order=transaction_id.asc`),
  ]);
  const item = items?.[0] ?? null;
  const ids = new Set<string>([...(states ?? []).map((s) => s.account_id), ...itemBooks.map((b) => b.account_id)].filter(Boolean));
  const list = ids.size ? inList(ids) : null;
  const [prefRows, bookRows] = list
    ? await Promise.all([
        sb<Pref[]>(`plaid_account_prefs?account_id=in.(${list})&select=account_id,nickname,hidden,entity_id,entity_name,account_name,mask,subtype,account_type,disconnected_at`),
        fetchAll<{ account_id: string; date: string }>(`book_transactions?account_id=in.(${list})&select=account_id,date&order=transaction_id.asc`),
      ])
    : [[] as Pref[], [] as Array<{ account_id: string; date: string }>];
  const prefs = new Map((prefRows ?? []).map((p) => [p.account_id, p]));
  const stateMap = new Map((states ?? []).map((s) => [s.account_id, s]));
  const spans = bookSpans(bookRows);
  const accounts = [...ids].map((id) => {
    const p = prefs.get(id);
    const s = stateMap.get(id);
    return {
      account_id: id,
      name: p?.nickname || p?.account_name || null,
      mask: p?.mask ?? null,
      subtype: p?.subtype ?? null,
      type: p?.account_type ?? null,
      balance: s?.balance ?? null,
      balance_at: s?.seen_at ?? null,
      entity_id: p?.entity_id ?? null,
      entity_name: p?.entity_name ?? null,
      hidden: !!p?.hidden,
      books: spans.get(id) ?? { count: 0, from: null, to: null },
    };
  });
  return {
    item,
    impact: { item_id: itemId, institution_name: item?.institution_name ?? "This bank", accounts, books: totalSpan(spans.values()) },
    states: stateMap,
    prefs,
    spans,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "POST"])) return;

  try {
    // currentUser throws PartnerRefused for a partner; handleError answers 403.
    const user = await currentUser(req);
    if (!user) return fail(res, 401, "unauthorized");
    if (!isAdmin(user)) return fail(res, 403, "forbidden", "Only an owner or admin can disconnect a bank.");

    const itemId = String(req.query.item_id ?? "").trim();
    if (!itemId) return fail(res, 400, "missing_item_id");

    const { item, impact, states, prefs, spans } = await impactOf(itemId);
    if (req.method === "GET") {
      if (!item) return fail(res, 404, "unknown_item", "That connection isn't listed any more.");
      return res.json(impact);
    }
    if (!item) return fail(res, 404, "unknown_item", "That connection isn't listed any more.");

    // Keeping the accounts needs the columns of migration
    // 20261107_treasury_keep_history.sql. Without them nothing is revoked:
    // a link revoked at Plaid that can't be marked here would be stuck.
    if (!(await keepColumnsReady())) {
      return fail(res, 503, "not_ready", "Disconnecting needs a database update that hasn't been applied yet. Nothing changed.");
    }

    // 1. Revoke at Plaid first. Unless Plaid confirms (or says the link is
    //    already gone), nothing below runs and the connection stays listed.
    let outcome: ReturnType<typeof revocationOutcome> = "revoked";
    try {
      await getPlaidClient().itemRemove({ access_token: item.access_token });
    } catch (err) {
      outcome = revocationOutcome(err);
      console.error("plaid/disconnect: itemRemove failed", { already_gone: outcome === "already_gone" });
    }
    if (outcome === "failed") {
      return fail(res, 502, "revoke_failed", `${impact.institution_name} couldn't be disconnected right now, so nothing changed. Try again in a few minutes.`);
    }

    // 2. Keep every account: mark it disconnected with its last balance and
    //    the date its Books history runs to. No transaction is touched.
    const now = new Date();
    const { keep } = keepPlan({ accountIds: impact.accounts.map((a) => a.account_id), reason: "disconnected", states, prefs, spans, now, keepEmpty: true });
    if (keep.length) {
      await sb("plaid_account_prefs", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: keep.map((row) => ({ ...row, institution_name: item.institution_name, updated_by: user.id })),
      });
    }

    // 3. Forget the token and the change baseline. A retry after a failure
    //    here finds the link already gone at Plaid and finishes.
    await sb(`plaid_account_state?item_id=eq.${encodeURIComponent(itemId)}`, { method: "DELETE", prefer: "return=minimal" });
    await sb(`plaid_items?item_id=eq.${encodeURIComponent(itemId)}`, { method: "DELETE", prefer: "return=minimal" });

    const n = impact.accounts.length;
    const kept = impact.books.count;
    await audit({
      actor: user,
      action: "treasury.disconnect",
      target: { type: "bank_connection", id: itemId, label: impact.institution_name },
      count: n,
      summary: `Disconnected ${impact.institution_name}: ${n} account${n === 1 ? "" : "s"} stopped syncing; ${kept} Books transaction${kept === 1 ? "" : "s"} kept`,
      detail: {
        revocation: outcome,
        accounts: impact.accounts.map((a) => ({ mask: a.mask, name: a.name, entity: a.entity_name, last_balance: a.balance, books: a.books.count })),
        books_from: impact.books.from,
        books_to: impact.books.to,
      },
    });

    // Each entity whose accounts stopped syncing hears about it in its activity.
    const byEntity = new Map<string, string[]>();
    for (const a of impact.accounts) if (a.entity_id) byEntity.set(a.entity_id, [...(byEntity.get(a.entity_id) ?? []), a.mask ? `•• ${a.mask}` : (a.name ?? "an account")]);
    for (const [entityId, masks] of byEntity) {
      await logActivity(entityId, { id: user.id, name: user.name, source: "user" }, [
        { kind: "treasury", summary: `${impact.institution_name} disconnected: ${masks.join(", ")} stopped syncing. Books history kept.`, detail: { item_id: itemId, accounts: masks } },
      ]);
    }

    return res.json({ success: true, kept_accounts: n, kept_transactions: kept });
  } catch (err) {
    return handleError(res, err);
  }
}
