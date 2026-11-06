/**
 * Treasury's and Investments' reads from the banks, through Plaid.
 *
 * GET ?report=list                 → the connections
 * GET ?report=treasury             → every bank account with its balance, the
 *                                    change since the prior day's close, its
 *                                    owner, when it was read (asOf) and when the
 *                                    bank last updated it; the accounts that
 *                                    stopped syncing (history kept); and each
 *                                    connection's status
 * GET ?report=account-ledger&account_id=… → that account's Books ledger
 *                                    (every page), for its Treasury page
 * GET ?report=bank-transactions    → the bank's last 180 days through Plaid
 * GET ?report=investments          → positions, the value history and income
 * GET ?report=holdings|balances|transactions → raw reads for one connection
 *
 * Who may call it: any signed-in staff role (viewers included), or the
 * treasury report cron with Bearer CRON_SECRET. Partners get 403
 * (PartnerRefused); email-only users 401.
 * Env: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV; SUPABASE_URL,
 * SUPABASE_SERVICE_KEY; CRON_SECRET.
 *
 * Writes, all of them facts as read: today's balance per account
 * (plaid_account_daily, the last reading of the day wins), the balance last
 * seen (plaid_account_state, which a disconnect keeps as the last balance),
 * and today's headline totals (treasury_daily), which are skipped while any
 * connection is offline so a bank that didn't answer never reads as a drop.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getPlaidClient } from "../../lib/plaid.js";
import { cronAuth, currentUser, fail, handleError, sb } from "../../lib/auth.js";
import { fetchAll } from "../../lib/db-pages.js";
import { incomeAmount, incomeKind as kindOfIncome, priorClose } from "../../lib/plaid-history.js";

async function getItems() {
  return (await sb<any[] | null>("plaid_items?select=*")) ?? [];
}

type AccountPrefs = {
  account_id: string;
  nickname: string | null;
  hidden: boolean;
  entity_id: string | null;
  entity_name: string | null;
  account_name?: string | null;
  institution_name?: string | null;
  mask?: string | null;
  subtype?: string | null;
  archived_at?: string | null;
  // After migration 20261107_treasury_keep_history.sql:
  owner_kind?: string | null;
  owner_names?: string[] | null;
  tenancy?: string | null;
  tax_status?: string | null;
  beneficiary_entity_id?: string | null;
  beneficiary_name?: string | null;
  disconnected_at?: string | null;
  disconnected_reason?: string | null;
  last_balance?: number | string | null;
  last_balance_at?: string | null;
  account_type?: string | null;
  books_through?: string | null;
  successor_account_id?: string | null;
};

/** The owner fields every account carries to the pages (null before the migration). */
function ownerFields(p: AccountPrefs | undefined) {
  return {
    owner_kind: p?.owner_kind ?? null,
    owner_names: p?.owner_names ?? null,
    tenancy: p?.tenancy ?? null,
    tax_status: p?.tax_status ?? null,
    beneficiary_entity_id: p?.beneficiary_entity_id ?? null,
    beneficiary_name: p?.beneficiary_name ?? null,
  };
}

/** A read whose failure just means "nothing known" — the report degrades rather than fails. */
async function readOrEmpty<T>(path: string): Promise<T[]> {
  return (await sb<T[] | null>(path).catch((err) => (console.error(`plaid/data: couldn't read ${path.split("?")[0]}`, err), null))) ?? [];
}

async function getAccountPrefs(): Promise<Map<string, AccountPrefs>> {
  const rows = await readOrEmpty<AccountPrefs>("plaid_account_prefs?select=*");
  return new Map(rows.map((row) => [row.account_id, row]));
}

/** When each account last moved money, from the synced Books history. */
async function getAccountActivity(): Promise<Map<string, string>> {
  const rows = await readOrEmpty<{ account_id: string; last_activity: string | null }>("book_account_activity?select=account_id,last_activity");
  return new Map(rows.filter((x) => x.last_activity).map((x) => [x.account_id, x.last_activity!]));
}

/** The balance last seen, kept so a disconnect can record it. Its prev_* columns are no longer read. */
async function saveAccountStates(rows: Array<{ account_id: string; item_id: string; balance: number | null }>, now: Date) {
  if (!rows.length) return;
  await sb("plaid_account_state", { method: "POST", body: rows.map((r) => ({ ...r, seen_at: now.toISOString() })), prefer: "resolution=merge-duplicates,return=minimal" }).catch((err) =>
    console.error("plaid: couldn't save account state", err instanceof Error ? err.message.slice(0, 80) : "unknown"),
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // The scheduled report runs without a session; it proves itself with
  // Authorization: Bearer $CRON_SECRET, the same credential every cron uses.
  if (cronAuth(req) !== "ok") {
    // currentUser throws PartnerRefused for a partner; handleError answers 403.
    try {
      const user = await currentUser(req);
      if (!user) return res.status(401).json({ error: "unauthorized" });
    } catch (err) {
      return handleError(res, err);
    }
  }

  const { report, item_id } = req.query;

  try {
    const client = getPlaidClient();

    // List all connected items
    if (report === "list") {
      const items = await getItems();
      const kind = req.query.kind as string | undefined;
      return res.json({
        items: (items || [])
          .filter((i: any) => !kind || (i.kind ?? "investments") === kind)
          .map((i: any) => ({
            item_id: i.item_id,
            institution_name: i.institution_name,
            institution_color: i.institution_color ?? null,
            institution_logo: i.institution_logo ?? null,
            kind: i.kind ?? "investments",
            created_at: i.created_at,
          })),
      });
    }

    // Treasury: every bank account across every bank connection, with the
    // change since the previous visit and whether the link is still live.
    if (report === "treasury") {
      const items = (await getItems()).filter((i: any) => (i.kind ?? "investments") === "bank");
      const prefs = await getAccountPrefs();
      const activity = await getAccountActivity();
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const weekAgo = new Date(now.getTime() - 10 * 86_400_000).toISOString().slice(0, 10);
      // The prior close: each account's last recorded balance before today.
      const closes = priorClose(
        await readOrEmpty<{ account_id: string; day: string; balance: number | null }>(`plaid_account_daily?select=account_id,day,balance&day=gte.${weekAgo}&day=lt.${today}`),
        today,
      );
      const accounts: any[] = [];
      const connections: any[] = [];
      const seen: Array<{ account_id: string; item_id: string; balance: number | null }> = [];
      const daily: any[] = [];

      for (const item of items) {
        const base = {
          item_id: item.item_id,
          institution_name: item.institution_name,
          institution_color: item.institution_color ?? null,
          institution_logo: item.institution_logo ?? null,
          created_at: item.created_at ?? null,
        };
        try {
          const balRes = await client.accountsGet({ access_token: item.access_token });
          // When the bank itself last refreshed a balance, where it says so.
          const bankTimes = balRes.data.accounts.map((a) => a.balances.last_updated_datetime).filter((t): t is string => !!t);
          connections.push({ ...base, status: "online", balances_at: now.toISOString(), bank_updated_at: bankTimes.length ? bankTimes.sort()[0] : null });

          for (const a of balRes.data.accounts) {
            // Show every account the connection exposes: a brokerage linked
            // here (Vanguard) has type "investment".
            const current = a.balances.current ?? null;
            const p = prefs.get(a.account_id);
            const close = closes.get(a.account_id);
            accounts.push({
              ...base,
              account_id: a.account_id,
              name: a.name,
              official_name: a.official_name,
              mask: a.mask,
              type: a.type,
              subtype: a.subtype,
              balance_current: current,
              balance_available: a.balances.available,
              balance_limit: a.balances.limit ?? null,
              balance_updated_at: a.balances.last_updated_datetime ?? null,
              currency: a.balances.iso_currency_code,
              // Against the prior day's close, the same for everyone who looks.
              change: close == null || current == null ? null : current - close.balance,
              change_since: close?.day ?? null,
              change_basis: "prior_close",
              nickname: p?.nickname ?? null,
              hidden: p?.hidden ?? false,
              entity_id: p?.entity_id ?? null,
              entity_name: p?.entity_name ?? null,
              ...ownerFields(p),
              last_activity: activity.get(a.account_id) ?? null,
            });
            seen.push({ account_id: a.account_id, item_id: item.item_id, balance: current });
            daily.push({
              account_id: a.account_id,
              day: today,
              balance: current,
              available: a.balances.available ?? null,
              account_type: a.type ?? null,
              item_id: item.item_id,
              hidden: !!p?.hidden,
              recorded_at: now.toISOString(),
            });
          }
        } catch (err: any) {
          const code = err.response?.data?.error_code;
          connections.push({
            ...base,
            status: code === "ITEM_LOGIN_REQUIRED" ? "reconnect" : "offline",
            // Plaid's display_message is written for people; nothing raw reaches the page.
            message: err.response?.data?.display_message ?? null,
          });
        }
      }

      await saveAccountStates(seen, now);
      if (daily.length) {
        await sb("plaid_account_daily", { method: "POST", body: daily, prefer: "resolution=merge-duplicates,return=minimal" }).catch((err) =>
          console.error("plaid: couldn't record daily balances", { tableMissing: /PGRST205|42P01|does not exist/.test(String(err?.message ?? "")) }),
        );
      }

      // Accounts that stopped syncing but whose Books history is kept: listed
      // apart, with their last balance and its date, never in the totals.
      const disconnected = [...prefs.values()]
        .filter((p) => p.disconnected_at && !p.archived_at && !p.successor_account_id)
        .map((p) => ({
          account_id: p.account_id,
          institution_name: p.institution_name ?? null,
          name: p.account_name ?? null,
          nickname: p.nickname ?? null,
          mask: p.mask ?? null,
          subtype: p.subtype ?? null,
          type: p.account_type ?? null,
          last_balance: p.last_balance == null ? null : Number(p.last_balance),
          last_balance_at: p.last_balance_at ?? null,
          disconnected_at: p.disconnected_at,
          reason: p.disconnected_reason ?? null,
          books_through: p.books_through ?? null,
          hidden: !!p.hidden,
          entity_id: p.entity_id ?? null,
          entity_name: p.entity_name ?? null,
          ...ownerFields(p),
        }));

      // Today's headline totals (shown accounts only), for the emailed
      // report's trend line. Only a complete reading is recorded: a bank that
      // didn't answer would otherwise read as a collapse that never happened.
      const complete = connections.every((c) => c.status === "online");
      if (complete) {
        const shown = accounts.filter((a: any) => !a.hidden);
        const totals = {
          day: today,
          cash: shown.filter((a) => a.type === "depository").reduce((s: number, a: any) => s + (a.balance_current ?? 0), 0),
          invested: shown.filter((a) => a.type === "investment").reduce((s: number, a: any) => s + (a.balance_current ?? 0), 0),
          credit: shown.filter((a) => a.type === "credit").reduce((s: number, a: any) => s + (a.balance_current ?? 0), 0),
          updated_at: now.toISOString(),
        };
        await sb("treasury_daily", { method: "POST", body: totals, prefer: "resolution=merge-duplicates" }).catch((err) =>
          console.error("plaid: couldn't record daily totals", err instanceof Error ? err.message.slice(0, 80) : "unknown"),
        );
      }

      return res.json({ asOf: now.toISOString(), complete, connections, accounts, disconnected });
    }

    // One account's Books ledger, every page of it: the record, as Books
    // keeps it (Plaid rows and CSV imports), for the account's Treasury page.
    if (report === "account-ledger") {
      const accountId = String(req.query.account_id ?? "").trim();
      if (!accountId) return fail(res, 400, "missing_account_id");
      const rows = await fetchAll<any>(
        `book_transactions?account_id=eq.${encodeURIComponent(accountId)}&select=transaction_id,date,name,merchant_name,amount,pending,currency,book_category,txn_type,type_override,intercompany,payment_channel,item_id&order=date.desc,transaction_id.desc`,
      );
      return res.json({
        transactions: rows.map((t) => ({
          id: t.transaction_id,
          date: t.date,
          name: t.merchant_name || t.name,
          description: t.name,
          category: t.book_category ?? null,
          amount: Number(t.amount),
          pending: !!t.pending,
          currency: t.currency ?? "USD",
          transfer: (t.type_override ?? t.txn_type) === "transfer" || (t.type_override ?? "") === "intercompany" || !!t.intercompany,
          source: t.item_id === "csv_import" ? "csv" : String(t.transaction_id ?? "").startsWith("mercury_") ? "mercury" : "bank",
        })),
        total: rows.length,
      });
    }

    // Bank transaction history for the spreadsheet view.
    if (report === "bank-transactions") {
      const items = (await getItems()).filter((i: any) => (i.kind ?? "investments") === "bank");
      const target = items.find((i: any) => i.item_id === item_id) ?? items[0];
      if (!target) return res.status(404).json({ error: "not_connected" });

      const now = new Date();
      const start = (req.query.start_date as string) || new Date(now.getTime() - 180 * 86_400_000).toISOString().split("T")[0];
      const end = (req.query.end_date as string) || now.toISOString().split("T")[0];
      const accountId = req.query.account_id as string | undefined;

      try {
        const txRes = await client.transactionsGet({
          access_token: target.access_token,
          start_date: start,
          end_date: end,
          options: {
            count: 500,
            offset: 0,
            ...(accountId ? { account_ids: [accountId] } : {}),
          },
        });
        return res.json({
          transactions: txRes.data.transactions.map((t) => ({
            date: t.date,
            name: t.merchant_name || t.name,
            description: t.name,
            category: t.personal_finance_category?.primary || t.category?.[0] || null,
            amount: t.amount,
            pending: t.pending,
            currency: t.iso_currency_code,
            account_id: t.account_id,
          })),
          total: txRes.data.total_transactions,
          start_date: start,
          end_date: end,
        });
      } catch (err: any) {
        if (err.response?.data?.error_code === "PRODUCT_NOT_READY") {
          return res.status(202).json({
            error: "product_not_ready",
            message: "Plaid is still pulling this account's history. Try again in a minute.",
          });
        }
        throw err;
      }
    }

    // Investments: every brokerage position across every connection, with
    // account prefs applied (hidden accounts dropped, nicknames/entities
    // attached), a year of the daily invested total and a summary of
    // dividend/interest income. Each connection fails on its own.
    if (report === "investments") {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const yearAgo = new Date(now.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
      const ninetyAgo = new Date(now.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);

      const [items, prefs, history] = await Promise.all([
        getItems() as Promise<any[]>,
        getAccountPrefs(),
        readOrEmpty<{ day: string; invested: number | null }>("treasury_daily?select=day,invested&order=day.desc&limit=1000"),
      ]);
      // Before BFO recorded a day, the rebuilt value (api/plaid/history.ts); recorded days always win.
      const rebuilt = await readOrEmpty<{ day: string; value: number }>("investment_history?select=day,value&order=day.asc&limit=1000");

      // A bank connection is only asked for holdings when it actually carries
      // an investment account — calling the investments product on a plain
      // bank errors (and can enrol the item in a billed product).
      const BROKERAGE =
        /vanguard|fidelity|schwab|e\*?trade|robinhood|merrill|morgan stanley|wealthfront|betterment|interactive brokers|ameritrade|edward jones|ubs|goldman|webull|m1 finance|public\.com|raymond james|ameriprise|lpl/i;
      // Plaid codes that just mean "no investments here" — not worth a warning.
      const NOT_APPLICABLE = new Set(["PRODUCTS_NOT_SUPPORTED", "NO_INVESTMENT_ACCOUNTS", "NO_INVESTMENT_AUTH_ACCOUNTS", "INVALID_PRODUCT", "PRODUCT_NOT_ENABLED", "NO_ACCOUNTS"]);
      const isMoneyMarket = (ticker?: string | null, name?: string | null) =>
        ["VMFXX", "VMRXX", "VUSXX", "VMSXX", "VCTXX", "VYFXX", "SPAXX", "FDRXX", "SWVXX", "SNVXX"].includes((ticker ?? "").toUpperCase()) ||
        /money market|cash reserves|federal money|treasury money|settlement fund/i.test(name ?? "");

      type InvTx = {
        date: string;
        account_id: string;
        type: string;
        subtype: string | null;
        name: string;
        ticker: string | null;
        security_name: string | null;
        quantity: number;
        price: number;
        amount: number;
      };

      const perItem = await Promise.all(
        items.map(async (item: any) => {
          const kind = item.kind ?? "investments";
          const base = {
            item_id: item.item_id,
            institution_name: item.institution_name,
            institution_color: item.institution_color ?? null,
            institution_logo: item.institution_logo ?? null,
          };
          const failure = (err: any) => {
            const code: string | undefined = err?.response?.data?.error_code;
            // A brokerage linked through Treasury (transactions only) can't give its holdings until consent for
            // Investments is collected in update mode: the page offers that rather than staying silent.
            const consent = kind === "bank" && BROKERAGE.test(item.institution_name ?? "") && (code === "ADDITIONAL_CONSENT_REQUIRED" || (!!code && NOT_APPLICABLE.has(code)));
            if (code && NOT_APPLICABLE.has(code) && !consent) return { skip: true as const };
            return {
              error: {
                item_id: item.item_id,
                institution: item.institution_name,
                code: code ?? null,
                reconnect: code === "ITEM_LOGIN_REQUIRED" || code === "PENDING_EXPIRATION" || code === "ITEM_LOCKED",
                consent,
                message: consent ? "Connected without access to its holdings." : err?.response?.data?.display_message || err?.response?.data?.error_message || err?.message || "Unavailable",
              },
            };
          };

          // Bank-kind items: a cheap accounts check first.
          if (kind === "bank") {
            try {
              const acc = await client.accountsGet({ access_token: item.access_token });
              if (!acc.data.accounts.some((a) => a.type === "investment")) return { skip: true as const };
            } catch (err: any) {
              // Only worth surfacing here when it's plausibly a brokerage.
              return BROKERAGE.test(item.institution_name ?? "") ? failure(err) : { skip: true as const };
            }
          }

          let holdingsData;
          try {
            holdingsData = (await client.investmentsHoldingsGet({ access_token: item.access_token })).data;
          } catch (err: any) {
            return failure(err);
          }

          // A year of transactions for income; never fatal.
          let txns: InvTx[] = [];
          let txError: string | null = null;
          try {
            let offset = 0;
            for (let page = 0; page < 4; page++) {
              const tx = await client.investmentsTransactionsGet({
                access_token: item.access_token,
                start_date: yearAgo,
                end_date: today,
                options: { count: 500, offset },
              });
              const secs = new Map(tx.data.securities.map((s) => [s.security_id, s]));
              for (const t of tx.data.investment_transactions) {
                const sec = secs.get(t.security_id ?? "");
                txns.push({
                  date: t.date,
                  account_id: t.account_id,
                  type: String(t.type),
                  subtype: t.subtype ? String(t.subtype) : null,
                  name: t.name,
                  ticker: sec?.ticker_symbol ?? null,
                  security_name: sec?.name ?? null,
                  quantity: t.quantity,
                  price: t.price,
                  amount: t.amount,
                });
              }
              offset += tx.data.investment_transactions.length;
              if (!tx.data.investment_transactions.length || offset >= tx.data.total_investment_transactions) break;
            }
          } catch (err: any) {
            txError = err?.response?.data?.error_code || err?.message || "unavailable";
            txns = [];
          }

          return { base, holdings: holdingsData, txns, txError };
        }),
      );

      const accounts: any[] = [];
      const holdings: any[] = [];
      const errors: any[] = [];
      const txns: InvTx[] = [];
      const hiddenAccounts = { count: 0, value: 0 };
      let incomeAvailable = false;

      for (const r of perItem) {
        if ("skip" in r) continue;
        if ("error" in r) {
          errors.push(r.error);
          continue;
        }
        const { base, holdings: data, txns: itemTx, txError } = r;
        if (!txError) incomeAvailable = true;
        const secMap = new Map(data.securities.map((s) => [s.security_id, s]));
        const visible = new Set<string>();

        for (const a of data.accounts) {
          const p = prefs.get(a.account_id);
          if (p?.hidden) {
            // Left out, and said so on the page.
            if (a.type === "investment") {
              hiddenAccounts.count += 1;
              hiddenAccounts.value += a.balances.current ?? 0;
            }
            continue;
          }
          const own = data.holdings.filter((h) => h.account_id === a.account_id);
          // Brokerage accounts only (plus anything that actually holds positions).
          if (a.type !== "investment" && own.length === 0) continue;
          visible.add(a.account_id);
          const held = own.reduce((s, h) => s + (h.institution_value ?? 0), 0);
          accounts.push({
            ...base,
            account_id: a.account_id,
            name: a.name,
            official_name: a.official_name,
            mask: a.mask,
            type: a.type,
            subtype: a.subtype,
            balance_current: a.balances.current,
            currency: a.balances.iso_currency_code,
            nickname: p?.nickname ?? null,
            entity_id: p?.entity_id ?? null,
            entity_name: p?.entity_name ?? null,
            ...ownerFields(p),
            holdings_count: own.length,
            holdings_value: held,
          });
        }

        for (const h of data.holdings) {
          if (!visible.has(h.account_id)) continue;
          const sec = secMap.get(h.security_id);
          const ticker = sec?.ticker_symbol || null;
          const name = sec?.name || "Unknown";
          holdings.push({
            item_id: base.item_id,
            account_id: h.account_id,
            security_id: h.security_id,
            ticker,
            name,
            type: sec?.type || null,
            is_cash_equivalent: !!sec?.is_cash_equivalent,
            money_market: isMoneyMarket(ticker, name),
            quantity: h.quantity,
            price: h.institution_price,
            price_as_of: h.institution_price_as_of ?? null,
            value: h.institution_value,
            cost_basis: h.cost_basis,
            currency: h.iso_currency_code,
          });
        }

        for (const t of itemTx) if (visible.has(t.account_id)) txns.push(t);
      }

      // Income: dividends, interest and capital-gain distributions, by
      // Plaid's exact subtype (lib/plaid-history.ts). A `distribution` (money
      // leaving an IRA), contributions and withdrawals are flows, not income;
      // reinvestments are the same money again. The sign is kept, so a
      // reversal reduces income.
      const byMonth = new Map<string, { dividends: number; interest: number; capitalGains: number }>();
      const bySecurity = new Map<string, { ticker: string | null; name: string; amount: number }>();
      let ttm = 0;
      let last90 = 0;
      let div90 = 0;
      let int90 = 0;
      let cg90 = 0;
      for (const t of txns) {
        const kind = kindOfIncome(t.type, t.subtype);
        if (!kind) continue;
        const amt = incomeAmount(t.amount);
        const m = byMonth.get(t.date.slice(0, 7)) ?? { dividends: 0, interest: 0, capitalGains: 0 };
        if (kind === "interest") m.interest += amt;
        else if (kind === "capital_gain") m.capitalGains += amt;
        else m.dividends += amt;
        byMonth.set(t.date.slice(0, 7), m);
        ttm += amt;
        if (t.date >= ninetyAgo) {
          last90 += amt;
          if (kind === "interest") int90 += amt;
          else if (kind === "capital_gain") cg90 += amt;
          else div90 += amt;
        }
        const key = t.ticker || t.security_name || t.name;
        const s = bySecurity.get(key) ?? { ticker: t.ticker, name: t.security_name || t.name, amount: 0 };
        s.amount += amt;
        bySecurity.set(key, s);
      }
      // The window the transactions actually cover: Plaid may hold far less than a year.
      const coveredFrom = txns.reduce<string | null>((min, t) => (!min || t.date < min ? t.date : min), null);

      const recent = txns.filter((t) => t.date >= ninetyAgo);
      const sumType = (type: string) => recent.filter((t) => t.type === type).reduce((s, t) => s + Math.abs(t.amount), 0);

      const recordedHistory = history
        .filter((h) => h.invested != null)
        .map((h) => ({ day: h.day, invested: Number(h.invested) }))
        .reverse();
      // Rebuilt days lead in up to the first recorded one; from then on only what was recorded shows.
      const firstRecorded = recordedHistory.find((h) => h.invested > 0)?.day ?? "9999-12-31";
      const rebuiltBefore = rebuilt.filter((r) => r.day < firstRecorded).map((r) => ({ day: r.day, invested: Number(r.value) }));
      // Recorded zeros before the first real day would repeat days the rebuilt series already covers.
      if (rebuiltBefore.length)
        recordedHistory.splice(
          0,
          recordedHistory.findIndex((h) => h.day >= firstRecorded),
        );

      return res.json({
        asOf: now.toISOString(),
        accounts,
        holdings,
        errors,
        history: [...rebuiltBefore, ...recordedHistory],
        historyRebuilt: rebuiltBefore.length ? { from: rebuiltBefore[0].day, until: firstRecorded } : null,
        hiddenAccounts,
        income: incomeAvailable
          ? {
              last90,
              ttm,
              from: coveredFrom,
              to: today,
              dividends90: div90,
              interest90: int90,
              capitalGains90: cg90,
              byMonth: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v })),
              bySecurity: [...bySecurity.values()].sort((a, b) => b.amount - a.amount).slice(0, 8),
            }
          : null,
        activity: {
          buys90: sumType("buy"),
          sells90: sumType("sell"),
          recent: recent.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60),
        },
      });
    }

    // For specific reports, need an item
    const items = await getItems();
    let item: any;
    if (item_id) {
      item = items.find((i: any) => i.item_id === item_id);
    } else if (items.length > 0) {
      item = items[0];
    }

    if (!item) {
      return res.status(409).json({ error: "not_connected", message: "No Plaid accounts connected" });
    }

    const accessToken = item.access_token;

    if (report === "holdings") {
      const holdingsRes = await client.investmentsHoldingsGet({ access_token: accessToken });
      const { accounts, holdings, securities } = holdingsRes.data;

      // Map securities by id for easy lookup
      const secMap = new Map(securities.map((s) => [s.security_id, s]));

      return res.json({
        accounts: accounts.map((a) => ({
          account_id: a.account_id,
          name: a.name,
          official_name: a.official_name,
          type: a.type,
          subtype: a.subtype,
          balance_current: a.balances.current,
          balance_available: a.balances.available,
          currency: a.balances.iso_currency_code,
        })),
        holdings: holdings.map((h) => {
          const sec = secMap.get(h.security_id);
          return {
            account_id: h.account_id,
            security_id: h.security_id,
            ticker: sec?.ticker_symbol || null,
            name: sec?.name || "Unknown",
            type: sec?.type || null,
            quantity: h.quantity,
            price: h.institution_price,
            value: h.institution_value,
            cost_basis: h.cost_basis,
            currency: h.iso_currency_code,
          };
        }),
      });
    }

    if (report === "balances") {
      const balRes = await client.accountsGet({ access_token: accessToken });
      return res.json({
        accounts: balRes.data.accounts.map((a) => ({
          account_id: a.account_id,
          name: a.name,
          official_name: a.official_name,
          type: a.type,
          subtype: a.subtype,
          balance_current: a.balances.current,
          balance_available: a.balances.available,
          currency: a.balances.iso_currency_code,
        })),
      });
    }

    if (report === "transactions") {
      const now = new Date();
      const startDate = (req.query.start_date as string) || `${now.getFullYear()}-01-01`;
      const endDate = (req.query.end_date as string) || now.toISOString().split("T")[0];

      const txRes = await client.investmentsTransactionsGet({
        access_token: accessToken,
        start_date: startDate,
        end_date: endDate,
      });

      const secMap = new Map(txRes.data.securities.map((s) => [s.security_id, s]));

      return res.json({
        transactions: txRes.data.investment_transactions.map((t) => {
          const sec = secMap.get(t.security_id || "");
          return {
            date: t.date,
            name: t.name,
            type: t.type,
            subtype: t.subtype,
            ticker: sec?.ticker_symbol || null,
            security_name: sec?.name || null,
            quantity: t.quantity,
            amount: t.amount,
            price: t.price,
            currency: t.iso_currency_code,
          };
        }),
        total: txRes.data.total_investment_transactions,
      });
    }

    return res.status(400).json({ error: "Unknown report type. Use: list, holdings, balances, transactions" });
  } catch (err: any) {
    console.error("Plaid data error:", err.response?.data || err.message);
    if (err.response?.data?.error_code === "ITEM_LOGIN_REQUIRED") {
      return res.status(409).json({ error: "auth_expired", message: "Please reconnect your investment account" });
    }
    // Plaid's display_message is written for people; anything else stays in
    // the log line above (never the raw error: it carries Plaid's credentials).
    const shown = err.response?.data?.display_message;
    return fail(res, 500, "plaid_error", shown || "Something went wrong. Try again.");
  }
}
