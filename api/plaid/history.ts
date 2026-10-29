import type { VercelRequest, VercelResponse } from "@vercel/node";
import { canWrite, cronAuth, currentUser, fail, guard, handleError, sb } from "../../lib/auth.js";
import { recordCronRun } from "../../lib/cron.js";
import { fetchAll } from "../../lib/db-pages.js";
import { getPlaidClient } from "../../lib/plaid.js";
import {
  dayList,
  fetchCloses,
  isCashLike,
  pickMode,
  PLAID_HISTORY_DAYS,
  rebuild,
  type Closes,
  type HPoint,
  type HPosition,
  type HSecurity,
  type HTx,
  type Mode,
} from "../../lib/invest-history.js";

/**
 * Rebuilds the Investments chart's past (lib/invest-history.ts) into
 * investment_history: today's holdings, walked back through up to 24 months
 * of Plaid investment transactions, priced at each day's close.
 *
 * POST                      → { days, from, to, method, error, unpriced, skipped }  (canWrite; the Investments page's button)
 *                             502 prices_unavailable when no closing price could be fetched (nothing is stored)
 * GET  (Bearer CRON_SECRET) → the same, weekly (vercel.json), so new trades and corrected prices land.
 *
 * Accounts hidden in Treasury are left out, as on the page. A connection
 * that can't give holdings or transactions is skipped and named in `skipped`.
 * Env: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV, SUPABASE_URL, SUPABASE_SERVICE_KEY, CRON_SECRET.
 */

class IncompleteBuild extends Error {
  constructor(readonly skipped: string[]) {
    super(`Not rebuilt: ${skipped.join("; ")} couldn't be read, and leaving it out would understate every past day. The last good history is kept.`);
  }
}

class PricesUnavailable extends Error {
  constructor() {
    super("Closing prices couldn't be fetched just now, so the past wasn't rebuilt. Try again later.");
  }
}

type Item = { item_id: string; access_token: string; institution_name: string | null; kind?: string | null };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "POST"])) return;
  try {
    if (req.method === "GET") {
      if (cronAuth(req) !== "ok") return fail(res, 401, "unauthorized");
      return recordCronRun("investment-history", async (run) => {
        const out = await build();
        run.note(`${out.days} days from ${out.from ?? "—"} (${out.method}${out.error != null ? `, ${(out.error * 100).toFixed(2)}% off recorded days` : ""})`);
        if (out.skipped.length) run.failed(`skipped: ${out.skipped.join("; ")}`);
        return res.status(200).json(out);
      });
    }
    const me = await currentUser(req);
    if (!me) return fail(res, 401, "unauthorized");
    if (!canWrite(me)) return fail(res, 403, "forbidden");
    return res.status(200).json(await build());
  } catch (err) {
    if (err instanceof PricesUnavailable) return fail(res, 502, "prices_unavailable", err.message);
    if (err instanceof IncompleteBuild) return fail(res, 502, "incomplete", err.message);
    return handleError(res, err);
  }
}

async function build() {
  const client = getPlaidClient();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - PLAID_HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);

  const [items, prefs, recordedRows] = await Promise.all([
    sb<Item[] | null>("plaid_items?select=item_id,access_token,institution_name,kind").then((r) => r ?? []),
    sb<Array<{ account_id: string; hidden: boolean | null }> | null>("plaid_account_prefs?select=account_id,hidden").then((r) => r ?? []),
    fetchAll<{ day: string; invested: number | null }>("treasury_daily?select=day,invested&order=day.asc"),
  ]);
  const hidden = new Set(prefs.filter((p) => p.hidden).map((p) => p.account_id));

  const positions: HPosition[] = [];
  const txns: HTx[] = [];
  const securities = new Map<string, HSecurity>();
  const skipped: string[] = [];
  let earliestTx: string | null = null;

  for (const item of items) {
    const label = item.institution_name || item.item_id;
    // A bank linked for Treasury is only asked about investments when it has an investment account:
    // asking a plain bank errors, and can enrol it in a billed product.
    if ((item.kind ?? "investments") === "bank") {
      try {
        const acc = (await client.accountsGet({ access_token: item.access_token })).data;
        if (!acc.accounts.some((a) => a.type === "investment")) continue;
      } catch {
        continue;
      }
    }
    let holdings;
    try {
      holdings = (await client.investmentsHoldingsGet({ access_token: item.access_token })).data;
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { error_code?: string } } })?.response?.data?.error_code;
      // A plain bank has no investments: not worth naming.
      if (!code || !/NO_INVESTMENT|PRODUCTS_NOT_SUPPORTED|NO_ACCOUNTS|INVALID_PRODUCT|PRODUCT_NOT_ENABLED/.test(code))
        skipped.push(`${label} (${code === "ADDITIONAL_CONSENT_REQUIRED" ? "holdings not shared with BFO yet" : code ?? "holdings unavailable"})`);
      continue;
    }
    const accounts = new Set(
      holdings.accounts
        .filter((a) => !hidden.has(a.account_id) && (a.type === "investment" || holdings.holdings.some((h) => h.account_id === a.account_id)))
        .map((a) => a.account_id)
    );
    if (!accounts.size) continue;
    const addSecurity = (s: (typeof holdings.securities)[number]) => {
      if (securities.has(s.security_id)) return;
      securities.set(s.security_id, {
        security_id: s.security_id,
        ticker: s.ticker_symbol ?? null,
        name: s.name ?? null,
        cash: isCashLike(s.ticker_symbol ?? null, s.name ?? null, s.type ?? null, !!s.is_cash_equivalent),
        price: s.close_price ?? null,
      });
    };
    holdings.securities.forEach(addSecurity);
    for (const h of holdings.holdings) {
      if (!accounts.has(h.account_id)) continue;
      positions.push({ account_id: h.account_id, security_id: h.security_id, quantity: h.quantity });
      const s = securities.get(h.security_id);
      if (s && h.institution_price) s.price = h.institution_price;
    }

    try {
      let offset = 0;
      for (let page = 0; page < 40; page++) {
        const r = (
          await client.investmentsTransactionsGet({ access_token: item.access_token, start_date: start, end_date: today, options: { count: 500, offset } })
        ).data;
        r.securities.forEach(addSecurity);
        for (const t of r.investment_transactions) {
          if (!accounts.has(t.account_id)) continue;
          txns.push({
            date: t.date,
            account_id: t.account_id,
            security_id: t.security_id ?? null,
            quantity: t.quantity ?? 0,
            amount: t.amount ?? 0,
            type: String(t.type),
            subtype: t.subtype ? String(t.subtype) : null,
          });
          if (!earliestTx || t.date < earliestTx) earliestTx = t.date;
        }
        offset += r.investment_transactions.length;
        if (!r.investment_transactions.length || offset >= r.total_investment_transactions) break;
      }
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { error_code?: string } } })?.response?.data?.error_code;
      skipped.push(`${label} (transactions ${code ?? "unavailable"})`);
    }
  }

  if (!positions.length) return { days: 0, from: null, to: null, method: "units" as Mode, error: null, unpriced: [], skipped, earliestTx };

  // Closing prices for everything held at any point in the window.
  const tickers = new Set<string>();
  const held = new Set([...positions.map((p) => p.security_id), ...txns.map((t) => t.security_id).filter((s): s is string => !!s)]);
  for (const sid of held) {
    const s = securities.get(sid);
    if (s && !s.cash && s.ticker) tickers.add(s.ticker.toUpperCase());
  }
  const closes: Closes = new Map();
  await Promise.all(
    [...tickers].map(async (t) => {
      try {
        closes.set(t, await fetchCloses(t, start));
      } catch (err) {
        console.error("invest-history: no closes for", t, err instanceof Error ? err.message : err);
      }
    })
  );

  // Without any prices the past would be today's prices on old share counts: a flat, made-up line. Stop instead.
  if (tickers.size > 0 && closes.size === 0) throw new PricesUnavailable();

  // Only as far back as the transactions reach: before them, the share counts aren't known.
  const from = earliestTx && earliestTx > start ? earliestTx : start;
  const days = dayList(from, today);
  const results = {
    units: rebuild(positions, txns, securities, closes, days, "units"),
    "cash-flows": rebuild(positions, txns, securities, closes, days, "cash-flows"),
  };
  const recorded: HPoint[] = recordedRows.filter((r) => r.invested != null && r.invested > 0).map((r) => ({ day: r.day, value: Number(r.invested) }));
  const { mode, error } = pickMode({ units: results.units.points, "cash-flows": results["cash-flows"].points }, recorded);
  const chosen = results[mode];

  // A brokerage that couldn't be read would be missing from (or frozen in) every past day: keep the last good build.
  if (skipped.length) throw new IncompleteBuild(skipped);

  // Write the new series, then drop what the previous build had that this one doesn't:
  // a failure partway leaves the old series, not a hole.
  const builtAt = new Date().toISOString();
  for (let i = 0; i < chosen.points.length; i += 500) {
    await sb("investment_history", {
      method: "POST",
      prefer: "resolution=merge-duplicates",
      body: chosen.points.slice(i, i + 500).map((p) => ({ day: p.day, value: p.value, method: mode, built_at: builtAt })),
    });
  }
  await sb(`investment_history?built_at=neq.${encodeURIComponent(builtAt)}`, { method: "DELETE" });

  return { days: chosen.points.length, from, to: today, method: mode, error, unpriced: chosen.unpriced, skipped, earliestTx, priced: [...closes.keys()].length, tickers: tickers.size };
}
