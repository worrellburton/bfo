import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, sbFetch as db } from "../../lib/auth.js";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

/**
 * Books runs on Plaid. Every night this pulls new/changed bank transactions
 * through Plaid's sync cursor into book_transactions, stamps each row with the
 * entity its account is mapped to, and flags transfers — including
 * intercompany movements (money between accounts that belong to different
 * entities), which default to "transfer" and can be reclassified as a
 * distribution or a loan.
 *
 * GET  → the Vercel cron (Bearer CRON_SECRET when set)
 * POST → manual "Sync now" from the app (any signed-in user)
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

const HISTORY_MONTHS = 24;

type TxnRow = {
  transaction_id: string;
  account_id: string;
  item_id: string;
  date: string;
  name: string | null;
  merchant_name: string | null;
  amount: number;
  pending: boolean;
  currency: string | null;
  plaid_category: string | null;
  plaid_category_detailed: string | null;
  payment_channel: string | null;
  txn_type: "normal" | "transfer";
  entity_id: string | null;
  entity_name: string | null;
  hidden: boolean;
  updated_at: string;
};

function isTransfer(t: any): boolean {
  const primary = t.personal_finance_category?.primary ?? "";
  return primary === "TRANSFER_IN" || primary === "TRANSFER_OUT";
}

async function upsertChunked(rows: TxnRow[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const r = await db("book_transactions", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(rows.slice(i, i + 500)),
    });
    if (!r.ok) throw new Error(`upsert failed: ${(await r.text()).slice(0, 300)}`);
  }
}

/**
 * Mark transfers that land in a different entity's account as intercompany:
 * same magnitude, opposite direction, within a few days, different entities.
 */
async function markIntercompany(sinceDate: string): Promise<number> {
  const r = await db(
    `book_transactions?txn_type=eq.transfer&date=gte.${sinceDate}` +
      `&select=transaction_id,account_id,date,amount,entity_id,intercompany&order=date.asc&limit=10000`
  );
  if (!r.ok) return 0;
  const transfers = (await r.json()) as Array<{
    transaction_id: string;
    account_id: string;
    date: string;
    amount: number;
    entity_id: string | null;
    intercompany: boolean;
  }>;

  // Bucket by |amount| in cents, then greedily pair an out-leg with an in-leg
  // from a different account within 3 days.
  const buckets = new Map<number, typeof transfers>();
  for (const t of transfers) {
    const key = Math.round(Math.abs(t.amount) * 100);
    if (!key) continue;
    const list = buckets.get(key) ?? [];
    list.push(t);
    buckets.set(key, list);
  }

  const updates: Array<{ id: string; counterparty: string }> = [];
  for (const list of buckets.values()) {
    const outs = list.filter((t) => t.amount > 0);
    const ins = list.filter((t) => t.amount < 0);
    const taken = new Set<string>();
    for (const out of outs) {
      const match = ins.find(
        (candidate) =>
          !taken.has(candidate.transaction_id) &&
          candidate.account_id !== out.account_id &&
          Math.abs(new Date(candidate.date).getTime() - new Date(out.date).getTime()) <= 3 * 86_400_000
      );
      if (!match) continue;
      taken.add(match.transaction_id);
      // Only a movement between two *different, mapped* entities is intercompany.
      if (out.entity_id && match.entity_id && out.entity_id !== match.entity_id) {
        if (!out.intercompany) updates.push({ id: out.transaction_id, counterparty: match.account_id });
        if (!match.intercompany) updates.push({ id: match.transaction_id, counterparty: out.account_id });
      }
    }
  }

  for (const u of updates) {
    await db(`book_transactions?transaction_id=eq.${encodeURIComponent(u.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ intercompany: true, counterparty_account_id: u.counterparty }),
    }).catch(() => {});
  }
  // Fresh intercompany rows default to "transfer"; a user's reclassification
  // (distribution/loan) is never overwritten because we only fill nulls.
  if (updates.length) {
    await db(`book_transactions?intercompany=eq.true&intercompany_class=is.null`, {
      method: "PATCH",
      body: JSON.stringify({ intercompany_class: "transfer" }),
    }).catch(() => {});
  }
  return updates.length;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  // Cron proves itself with the secret — or, when none is configured, with
  // the x-vercel-cron header Vercel stamps on real cron invocations and
  // strips from outside traffic. A person proves themselves with a session.
  const cronSecret = process.env.CRON_SECRET;
  const fromCron =
    req.method === "GET" &&
    (cronSecret ? req.headers.authorization === `Bearer ${cronSecret}` : !!req.headers["x-vercel-cron"]);
  if (!fromCron) {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const client = getPlaidClient();

    const itemsRes = await db("plaid_items?select=*");
    if (!itemsRes.ok) throw new Error(`DB error: ${await itemsRes.text()}`);
    const items = ((await itemsRes.json()) as any[]).filter((i) => (i.kind ?? "investments") === "bank");

    const prefsRes = await db("plaid_account_prefs?select=*");
    const prefs = new Map<string, any>(
      prefsRes.ok ? ((await prefsRes.json()) as any[]).map((p) => [p.account_id, p]) : []
    );

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - HISTORY_MONTHS);
    const cutoffDay = cutoff.toISOString().slice(0, 10);
    const now = new Date().toISOString();

    const summary: any[] = [];

    for (const item of items) {
      let cursor: string | undefined = item.transactions_cursor || undefined;
      const firstSync = !cursor;
      let added = 0;
      let modified = 0;
      let removed = 0;

      try {
        let hasMore = true;
        while (hasMore) {
          const sync = await client.transactionsSync({
            access_token: item.access_token,
            cursor,
            count: 500,
          });
          const data = sync.data;

          const rows: TxnRow[] = [...data.added, ...data.modified]
            .filter((t) => t.date >= cutoffDay)
            .map((t) => {
              const pref = prefs.get(t.account_id);
              return {
                transaction_id: t.transaction_id,
                account_id: t.account_id,
                item_id: item.item_id,
                date: t.date,
                name: t.name ?? null,
                merchant_name: t.merchant_name ?? null,
                amount: t.amount,
                pending: !!t.pending,
                currency: t.iso_currency_code ?? null,
                plaid_category: t.personal_finance_category?.primary ?? null,
                plaid_category_detailed: t.personal_finance_category?.detailed ?? null,
                payment_channel: t.payment_channel ?? null,
                txn_type: isTransfer(t) ? "transfer" : "normal",
                entity_id: pref?.entity_id ?? null,
                entity_name: pref?.entity_name ?? null,
                hidden: pref?.hidden ?? false,
                updated_at: now,
              };
            });
          await upsertChunked(rows);
          added += data.added.length;
          modified += data.modified.length;

          if (data.removed.length) {
            const ids = data.removed
              .map((t) => t.transaction_id)
              .filter(Boolean)
              .map((id) => `"${id}"`)
              .join(",");
            await db(`book_transactions?transaction_id=in.(${ids})`, { method: "DELETE" }).catch(() => {});
            removed += data.removed.length;
          }

          cursor = data.next_cursor;
          hasMore = data.has_more;
        }

        await db(`plaid_items?item_id=eq.${encodeURIComponent(item.item_id)}`, {
          method: "PATCH",
          body: JSON.stringify({ transactions_cursor: cursor }),
        });

        summary.push({ institution: item.institution_name, first_sync: firstSync, added, modified, removed });
      } catch (err: any) {
        summary.push({
          institution: item.institution_name,
          error: err.response?.data?.error_code || err.message,
        });
      }
    }

    // Nightly runs only need to re-pair recent activity; a first sync pairs
    // the whole window.
    const anyFirst = summary.some((s) => s.first_sync);
    const pairSince = anyFirst
      ? cutoffDay
      : new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const intercompanyMarked = await markIntercompany(pairSince);

    // Keep entity stamps in step with the mappings page — remapping an account
    // moves its whole history to the new entity.
    for (const [accountId, pref] of prefs) {
      await db(`book_transactions?account_id=eq.${encodeURIComponent(accountId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          entity_id: pref.entity_id ?? null,
          entity_name: pref.entity_name ?? null,
          hidden: pref.hidden ?? false,
        }),
      }).catch(() => {});
    }

    return res.status(200).json({ synced: true, items: summary, intercompany_marked: intercompanyMarked });
  } catch (err: any) {
    console.error("books-sync error:", err.response?.data || err.message);
    return res.status(500).json({ error: err.response?.data?.error_message || err.message });
  }
}
