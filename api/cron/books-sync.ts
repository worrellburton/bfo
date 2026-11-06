import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getPlaidClient } from "../../lib/plaid.js";
import { canWrite, cronAuth, currentUser, handleError, refuseCron, sbFetch as db, type AppUser } from "../../lib/auth.js";
import { recordCronRun, type CronRun } from "../../lib/cron.js";
import { classify, patchMatching } from "../../lib/books-rules.js";
import { logChanges } from "../../lib/books/audit.js";
import { readLocks } from "../../lib/books/db.js";
import { firstRule, isHandEdit, isLocked, orderRules, type PeriodLock, type TaughtRule } from "../../lib/books/ledger.js";
import { fetchAll } from "../../lib/db-pages.js";
import { inList } from "../../lib/pg-filter.js";
import { betterVendor } from "../../lib/vendor-parse.js";
import { sunriseUtcDate } from "../../lib/sunrise.js";

/**
 * Books runs on Plaid. Every night this pulls new/changed bank transactions
 * through Plaid's sync cursor into book_transactions, stamps each row with the
 * entity its account is mapped to, and flags transfers — including
 * intercompany movements (money between accounts that belong to different
 * entities), which default to "transfer" and can be reclassified as a
 * distribution or a loan.
 *
 * GET  → the Vercel cron (Bearer CRON_SECRET, required)
 * POST → manual "Sync now" from the app (anyone who can write)
 */

const HISTORY_MONTHS = 24;

type UserRule = TaughtRule & { id: string };

/**
 * Rules the user taught (category popup, vendor rename, vendor defaults),
 * in the order they're tried (lib/books/ledger.ts orderRules: an exact payee
 * first, then the more specific text). They beat the built-ins. A failed
 * read throws: syncing without them would overwrite every renamed vendor
 * and taught category with the built-in guess.
 */
async function loadUserRules(): Promise<UserRule[]> {
  return orderRules(await fetchAll<UserRule>("book_rules?select=*&order=id.asc"));
}

type RuleTarget = { name: string | null; merchant_name: string | null; date: string; entity_id: string | null };

function userCategory(rules: UserRule[], row: RuleTarget): string | null {
  return firstRule(rules, row, "book_category")?.book_category ?? null;
}

/** A user-chosen vendor display name for this transaction, if a rule matches. */
function userVendor(rules: UserRule[], row: RuleTarget): string | null {
  return firstRule(rules, row, "vendor_name")?.vendor_name ?? null;
}

/** A vendor-level type the user chose ("all Samir payments are intercompany"). */
function userType(rules: UserRule[], row: RuleTarget): string | null {
  return firstRule(rules, row, "type_override")?.type_override ?? null;
}

/**
 * What the sync must not overwrite: rows with a hand edit on record (every
 * page of the history is read: it outgrew PostgREST's 1,000-row cap; the
 * sync's own entries don't count) and the period locks, with each account's
 * entity to test them.
 */
async function loadGuard(): Promise<{ edited: Set<string>; locks: PeriodLock[]; entityOf: (accountId: string) => string | null }> {
  const [log, locks, prefs] = await Promise.all([
    fetchAll<{ transaction_id: string; field: string; source: string | null }>("book_txn_log?select=transaction_id,field,source&order=id.asc"),
    readLocks(db),
    fetchAll<{ account_id: string; entity_id: string | null }>("plaid_account_prefs?select=account_id,entity_id&order=account_id.asc"),
  ]);
  const entity = new Map(prefs.map((p) => [p.account_id, p.entity_id ?? null]));
  return { edited: new Set(log.filter(isHandEdit).map((e) => e.transaction_id)), locks, entityOf: (a) => entity.get(a) ?? null };
}

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
  intercompany: boolean;
  book_category: string | null;
  type_override?: string;
  entity_id: string | null;
  entity_name: string | null;
  hidden: boolean;
  updated_at: string;
};

function isTransfer(t: any): boolean {
  const primary = t.personal_finance_category?.primary ?? "";
  return primary === "TRANSFER_IN" || primary === "TRANSFER_OUT";
}

/**
 * Mercury embeds the real counterparty in the description
 * ("…via mercury.com; Merchant name: X"), while Plaid's merchant_name carries
 * the *sending* entity. Prefer the named payee as the vendor so the recipient
 * shows through instead of the account owner.
 */
function mercuryPayee(name: string | null | undefined): string | null {
  if (!name || !/via mercury\.com;\s*merchant name:/i.test(name)) return null;
  const m = name.match(/merchant name:\s*(.+)$/i);
  return m?.[1]?.trim() || null;
}

/**
 * When a pending transaction posts, Plaid adds the posted one (naming the
 * pending id) and removes the pending one. Whatever a person decided on the
 * pending row (its account, type, vendor, loan, note) and its receipts move
 * to the posted row, with a history entry, so the removal loses nothing.
 */
async function carryPending(txns: Array<{ transaction_id: string; pending_transaction_id?: string | null }>, editedIds: ReadonlySet<string>) {
  for (const t of txns) {
    const from = t.pending_transaction_id;
    if (!from || !editedIds.has(from) || from === t.transaction_id) continue;
    try {
      const r = await db(`book_transactions?transaction_id=eq.${encodeURIComponent(from)}&select=book_category,type_override,merchant_name,loan_id,txn_type,intercompany&limit=1`);
      const prior = r.ok ? ((await r.json()) as Array<Record<string, unknown>>)[0] : null;
      if (!prior) continue;
      await db(`book_txn_receipt?transaction_id=eq.${encodeURIComponent(from)}`, { method: "PATCH", body: JSON.stringify({ transaction_id: t.transaction_id }) });
      // Written after the upsert below creates the posted row; the history
      // notes the carry, which also guards the row from later syncs.
      pendingCarry.set(t.transaction_id, { from, values: prior });
    } catch (err) {
      console.error("books-sync: couldn't carry a pending row's edits", err instanceof Error ? err.message : err);
    }
  }
}

/** Posted id → the pending row it replaces and the values a person set there (applied after the upsert). */
const pendingCarry = new Map<string, { from: string; values: Record<string, unknown> }>();

async function applyPendingCarry() {
  for (const [to, { from, values }] of pendingCarry) {
    const r = await db(`book_transactions?transaction_id=eq.${encodeURIComponent(to)}`, { method: "PATCH", body: JSON.stringify(values) });
    const decided = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== null && k !== "txn_type" && k !== "intercompany"));
    if (r.ok && Object.keys(decided).length) await logChanges([to], null, decided, `pending:${from}`, null);
  }
  pendingCarry.clear();
}

async function upsertChunked(rows: Array<Record<string, unknown>>) {
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
  // A first sync pairs two years of transfers: more than one 1,000-row page.
  const transfers = await fetchAll<{
    transaction_id: string;
    account_id: string;
    date: string;
    amount: number;
    entity_id: string | null;
    intercompany: boolean;
  }>(`book_transactions?txn_type=eq.transfer&date=gte.${sinceDate}` + `&select=transaction_id,account_id,date,amount,entity_id,intercompany&order=date.asc,transaction_id.asc`);

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
        (candidate) => !taken.has(candidate.transaction_id) && candidate.account_id !== out.account_id && Math.abs(new Date(candidate.date).getTime() - new Date(out.date).getTime()) <= 3 * 86_400_000,
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
    }).catch((err) => console.error(`books-sync: couldn't mark ${u.id} intercompany`, err));
  }
  // Fresh intercompany rows default to "transfer"; a user's reclassification
  // (distribution/loan) is never overwritten because we only fill nulls.
  if (updates.length) {
    await db(`book_transactions?intercompany=eq.true&intercompany_class=is.null`, {
      method: "PATCH",
      body: JSON.stringify({ intercompany_class: "transfer" }),
    }).catch((err) => console.error("books-sync: couldn't default intercompany_class", err));
  }
  return updates.length;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  // GET is the cron and only the cron: it must present Bearer $CRON_SECRET
  // (lib/auth.ts cronAuth). A person syncs with POST and a session.
  const fromCron = req.method === "GET";
  if (fromCron) {
    const cron = cronAuth(req);
    if (cron !== "ok") return refuseCron(req, res, "books-sync", cron);
  } else {
    // currentUser throws PartnerRefused for a partner; handleError answers 403.
    let user: AppUser | null;
    try {
      user = await currentUser(req);
    } catch (err) {
      return handleError(res, err);
    }
    if (!user) return res.status(401).json({ error: "unauthorized" });
    if (!canWrite(user)) return res.status(403).json({ error: "forbidden" });
  }

  // The scheduled run is recorded (cron_runs) and alerts the admins when a
  // bank's sync fails or the run doesn't finish; a person's "Sync now" isn't.
  if (fromCron) return recordCronRun("books-sync", (run) => sync(req, res, true, run));
  return sync(req, res, false, null);
}

async function sync(req: VercelRequest, res: VercelResponse, fromCron: boolean, run: CronRun | null) {
  // Sunrise gate — only for the automatic cron run. The cron fires a few times
  // across the morning window; on each fire we sync once, at the first fire on
  // or after today's local sunrise, and only if the toggle is on. A person
  // hitting "Sync now" always syncs immediately (this gate is skipped).
  if (fromCron) {
    try {
      const sRes = await db("books_settings?id=eq.1&select=*&limit=1");
      const s = sRes.ok ? ((await sRes.json()) as any[])[0] : null;
      if (!s?.sync_at_sunrise) {
        run?.note("skipped: sunrise sync is off");
        return res.status(200).json({ skipped: "sunrise_sync_disabled" });
      }
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      if (s.last_auto_sync_date === today) {
        run?.note("skipped: already synced today");
        return res.status(200).json({ skipped: "already_synced_today" });
      }
      const sunrise = sunriseUtcDate(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), s.sync_lat, s.sync_lng);
      if (sunrise && now < sunrise) {
        run?.note(`skipped: before sunrise (${sunrise.toISOString()})`);
        return res.status(200).json({ skipped: "before_sunrise", sunrise_utc: sunrise.toISOString() });
      }
      // Fall through and sync; today's date is claimed only after it succeeds
      // (below), so a failed run retries at the next window rather than being
      // skipped for the day. Upserts are idempotent, so the rare overlap of
      // two morning fires is harmless.
    } catch (err: any) {
      console.error("sunrise gate error:", err.message);
      run?.note(`sunrise gate couldn't be read (${err.message}); synced anyway`);
      // On a gate failure, fall through and sync — missing a sync is worse.
    }
  }

  // Re-run the chart-of-accounts rules over everything already synced, so
  // history reflects the current chart. Rows a person decided (a hand edit
  // on record) and rows in a closed period are left alone; every row that
  // changes is logged with source "sync".
  if (req.method === "POST" && req.body?.recategorize) {
    try {
      const [userRules, guard] = await Promise.all([loadUserRules(), loadGuard()]);
      const rows = await fetchAll<{ transaction_id: string; name: string | null; merchant_name: string | null; plaid_category: string | null; date: string; account_id: string; book_category: string | null; txn_type: string; intercompany: boolean }>(
        "book_transactions?select=transaction_id,name,merchant_name,plaid_category,date,account_id,book_category,txn_type,intercompany&order=transaction_id.asc",
      );
      const groups = new Map<string, typeof rows>();
      let kept = 0;
      for (const t of rows) {
        const entityId = guard.entityOf(t.account_id);
        if (guard.edited.has(t.transaction_id) || isLocked({ date: t.date, entity_id: entityId }, guard.locks)) {
          kept++;
          continue;
        }
        const taught = userCategory(userRules, { name: t.name, merchant_name: t.merchant_name, date: t.date, entity_id: entityId });
        const cls = classify(t.name, t.merchant_name, t.plaid_category, taught);
        if (cls.category === t.book_category) continue;
        const key = JSON.stringify([cls.category, cls.type]);
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
      }
      let updated = 0;
      for (const [key, group] of groups) {
        const [category, type] = JSON.parse(key) as [string | null, string | null];
        const patch: Record<string, unknown> = { book_category: category };
        if (type === "intercompany") {
          patch.intercompany = true;
          patch.txn_type = "transfer";
        } else if (type) {
          patch.txn_type = type;
          patch.intercompany = false;
        }
        for (let i = 0; i < group.length; i += 200) {
          const part = group.slice(i, i + 200);
          const r = await db(`book_transactions?transaction_id=in.(${inList(part.map((t) => t.transaction_id))})`, {
            method: "PATCH",
            body: JSON.stringify(patch),
          });
          if (!r.ok) continue;
          updated += part.length;
          await logChanges(
            part.map((t) => t.transaction_id),
            new Map(part.map((t) => [t.transaction_id, t as unknown as Record<string, unknown>])),
            { book_category: category },
            "sync",
            null,
          );
        }
      }
      return res.status(200).json({ recategorized: true, updated, kept, rules_groups: groups.size });
    } catch (err: any) {
      console.error("recategorize error:", err.message);
      return res.status(500).json({ error: "recategorize_failed" });
    }
  }

  try {
    const client = getPlaidClient();

    const itemsRes = await db("plaid_items?select=*");
    if (!itemsRes.ok) throw new Error(`DB error: ${await itemsRes.text()}`);
    const items = ((await itemsRes.json()) as any[]).filter((i) => (i.kind ?? "investments") === "bank");

    const userRules = await loadUserRules();

    // Rows a person decided (a hand edit on record) and rows in a closed
    // period: the bank refresh keeps their vendor, account and type and only
    // updates the mechanical columns. A failed read aborts the sync: an empty
    // set here would treat every edit as never made and overwrite it.
    const guard = await loadGuard();
    const editedIds = guard.edited;

    // Likewise the account mappings: without them every upserted row would be
    // stamped with no entity.
    const prefs = new Map<string, any>((await fetchAll<any>("plaid_account_prefs?select=*&order=account_id.asc")).map((p) => [p.account_id, p]));

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
        // Plaid can mutate the item mid-pagination; the documented recovery is
        // to restart from the original cursor. Upserts are idempotent, so a
        // single restart is safe.
        for (let attempt = 0; ; attempt++) {
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
                  const entityId: string | null = pref?.entity_id ?? null;
                  // The payee as the books would name it, then any rename a
                  // person taught; the taught rules are tested against both.
                  const base = mercuryPayee(t.name) ?? betterVendor(t.name ?? null, t.merchant_name ?? null);
                  const raw: RuleTarget = { name: t.name ?? null, merchant_name: t.merchant_name ?? base, date: t.date, entity_id: entityId };
                  const named: RuleTarget = { ...raw, merchant_name: base };
                  const merchant = userVendor(userRules, named) ?? userVendor(userRules, raw) ?? base;
                  const target: RuleTarget = { ...raw, merchant_name: merchant };
                  // The chart-of-accounts rules classify each transaction; a
                  // rule that forces a type beats the Plaid heuristic. A
                  // user's type_override (not written here) beats both, and a
                  // user-taught category rule beats the built-in chart.
                  const taught = userCategory(userRules, target) ?? userCategory(userRules, raw);
                  const cls = classify(t.name ?? null, t.merchant_name ?? null, t.personal_finance_category?.primary ?? null, taught);
                  const heuristic = isTransfer(t) ? "transfer" : "normal";
                  const ut = userType(userRules, target) ?? userType(userRules, raw);
                  return {
                    transaction_id: t.transaction_id,
                    account_id: t.account_id,
                    item_id: item.item_id,
                    date: t.date,
                    name: t.name ?? null,
                    merchant_name: merchant,
                    amount: t.amount,
                    pending: !!t.pending,
                    currency: t.iso_currency_code ?? null,
                    plaid_category: t.personal_finance_category?.primary ?? null,
                    plaid_category_detailed: t.personal_finance_category?.detailed ?? null,
                    payment_channel: t.payment_channel ?? null,
                    txn_type: (cls.type === "intercompany" ? "transfer" : (cls.type ?? heuristic)) as "normal" | "transfer",
                    intercompany: cls.type === "intercompany",
                    book_category: cls.category,
                    // A vendor-level type rule rides in as the row's override.
                    ...(ut ? { type_override: ut } : {}),
                    entity_id: entityId,
                    entity_name: pref?.entity_name ?? null,
                    hidden: pref?.hidden ?? false,
                    updated_at: now,
                  };
                });
              // A posted row that replaces a pending one inherits what a
              // person decided on the pending row, and its receipts.
              await carryPending([...data.added, ...data.modified], editedIds);
              // Hand-edited rows keep the fields a person set; everything else
              // gets the full refresh. Each partition keeps uniform keys, which
              // the PostgREST bulk upsert requires.
              const kept = (r: TxnRow) => editedIds.has(r.transaction_id) || isLocked({ date: r.date, entity_id: r.entity_id }, guard.locks);
              const fresh = rows.filter((r) => !kept(r));
              const guarded = rows.filter(kept).map(({ merchant_name, name, book_category, type_override, ...keep }) => keep);
              await upsertChunked(fresh.filter((r) => r.type_override === undefined));
              await upsertChunked(fresh.filter((r) => r.type_override !== undefined));
              await upsertChunked(guarded);
              await applyPendingCarry();
              added += data.added.length;
              modified += data.modified.length;

              if (data.removed.length) {
                const ids = inList(data.removed.map((t) => t.transaction_id).filter(Boolean));
                // fetch resolves on HTTP errors, so check ok: a failed delete must
                // throw before the cursor below moves past these removals for good.
                const del = await db(`book_transactions?transaction_id=in.(${ids})`, { method: "DELETE" });
                if (!del.ok) throw new Error(`delete of removed transactions failed: ${(await del.text()).slice(0, 300)}`);
                removed += data.removed.length;
              }

              cursor = data.next_cursor;
              hasMore = data.has_more;
            }
            break;
          } catch (pageErr: any) {
            if (pageErr.response?.data?.error_code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && attempt === 0) {
              cursor = item.transactions_cursor || undefined;
              added = 0;
              modified = 0;
              removed = 0;
              continue;
            }
            throw pageErr;
          }
        }

        await db(`plaid_items?item_id=eq.${encodeURIComponent(item.item_id)}`, {
          method: "PATCH",
          body: JSON.stringify({ transactions_cursor: cursor }),
        });

        summary.push({ institution: item.institution_name, first_sync: firstSync, added, modified, removed });
      } catch (err: any) {
        // Plaid's error code is safe to show; anything else stays in the log.
        console.error(`books-sync: ${item.institution_name} failed:`, err.response?.data || err.message);
        // That bank's transactions are now stale: the admins hear about it (once per run).
        run?.failed(`Plaid sync failed for ${item.institution_name}: ${err.response?.data?.error_code || err.message || "sync_failed"}`);
        summary.push({
          institution: item.institution_name,
          error: err.response?.data?.error_code || "sync_failed",
        });
      }
    }

    // Nightly runs only need to re-pair recent activity; a first sync pairs
    // the whole window.
    const anyFirst = summary.some((s) => s.first_sync);
    const pairSince = anyFirst ? cutoffDay : new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const intercompanyMarked = await markIntercompany(pairSince);

    // Auto-attach rules: descriptions the user tied to a loan. Only unset
    // rows are filled, so a manual detach isn't fought over — but a new
    // arrival matching the rule always lands on its loan.
    try {
      const loanRules = await db("book_rules?loan_id=not.is.null&select=match,loan_id");
      if (loanRules.ok) {
        for (const rule of (await loanRules.json()) as Array<{ match: string; loan_id: string }>) {
          // Same literal-substring matcher as the app's immediate apply.
          await patchMatching(db, rule.match, "loan_id=is.null", { loan_id: rule.loan_id });
        }
      }
    } catch (err) {
      // loan attachment is retried next sync
      console.error("books-sync: loan rules didn't apply", err);
    }

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
      }).catch((err) => console.error(`books-sync: couldn't restamp entity on ${accountId}`, err));
    }

    // Mark today's automatic run complete, so later morning fires skip it.
    if (fromCron) {
      await db("books_settings?id=eq.1", {
        method: "PATCH",
        body: JSON.stringify({ last_auto_sync_date: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() }),
      }).catch((err) => console.error("books-sync: couldn't record today's automatic run", err));
    }

    return res.status(200).json({ synced: true, items: summary, intercompany_marked: intercompanyMarked });
  } catch (err: any) {
    // The detail (raw Plaid or database text) stays in the log.
    console.error("books-sync error:", err.response?.data || err.message);
    run?.failed(`The sync didn't finish: ${err.response?.data?.error_code || err.message || "sync_failed"}`);
    return res.status(500).json({ error: "sync_failed", message: "The sync didn't finish. Try again." });
  }
}
