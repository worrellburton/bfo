import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getPlaidClient } from "../../lib/plaid.js";
import { currentUser } from "../../lib/auth.js";

// A visit older than this counts as a new "login" for change-since purposes.
const ROTATE_AFTER_MS = 30 * 60 * 1000;

function db(path: string, init: RequestInit = {}) {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_KEY!;
  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function getItems() {
  const r = await db("plaid_items?select=*");
  if (!r.ok) throw new Error(`DB error: ${await r.text()}`);
  return r.json();
}

type AccountState = {
  account_id: string;
  balance: number | null;
  seen_at: string;
  prev_balance: number | null;
  prev_seen_at: string | null;
};

type AccountPrefs = {
  account_id: string;
  nickname: string | null;
  hidden: boolean;
  entity_id: string | null;
  entity_name: string | null;
};

async function getAccountPrefs(): Promise<Map<string, AccountPrefs>> {
  const r = await db("plaid_account_prefs?select=*");
  if (!r.ok) return new Map();
  const rows = (await r.json()) as AccountPrefs[];
  return new Map(rows.map((row) => [row.account_id, row]));
}

/** When each account last moved money, from the synced Books history. */
async function getAccountActivity(): Promise<Map<string, string>> {
  const r = await db("book_account_activity?select=account_id,last_activity");
  if (!r.ok) return new Map();
  const rows = (await r.json()) as Array<{ account_id: string; last_activity: string | null }>;
  return new Map(rows.filter((x) => x.last_activity).map((x) => [x.account_id, x.last_activity!]));
}

async function getAccountStates(): Promise<Map<string, AccountState>> {
  const r = await db("plaid_account_state?select=*");
  if (!r.ok) return new Map();
  const rows = (await r.json()) as AccountState[];
  return new Map(rows.map((row) => [row.account_id, row]));
}

async function saveAccountState(
  accountId: string,
  itemId: string,
  balance: number | null,
  prior: AccountState | undefined,
  rotate: boolean,
  now: Date
) {
  const row = {
    account_id: accountId,
    item_id: itemId,
    balance,
    seen_at: now.toISOString(),
    prev_balance: rotate ? prior?.balance ?? null : prior?.prev_balance ?? null,
    prev_seen_at: rotate ? prior?.seen_at ?? null : prior?.prev_seen_at ?? null,
  };
  await db("plaid_account_state", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(row),
  }).catch(() => {});
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // The scheduled report runs without a session; it proves itself with the
  // cron secret instead.
  const cronSecret = process.env.CRON_SECRET;
  const fromCron = !!cronSecret && req.headers["x-internal-cron"] === cronSecret;
  if (!fromCron) {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: "unauthorized" });
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
      const states = await getAccountStates();
      const prefs = await getAccountPrefs();
      const activity = await getAccountActivity();
      const now = new Date();
      const accounts: any[] = [];
      const connections: any[] = [];

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
          connections.push({ ...base, status: "online" });

          for (const a of balRes.data.accounts) {
            // Show every account the connection exposes — a brokerage linked
            // here (Vanguard) has type "investment" and was silently hidden.
            const prior = states.get(a.account_id);
            const current = a.balances.current ?? null;

            // Rotate the snapshot once a visit has gone cold, so "since last
            // login" doesn't collapse to zero on a page refresh.
            const stale = !prior || now.getTime() - new Date(prior.seen_at).getTime() > ROTATE_AFTER_MS;
            const baseline = stale ? prior?.balance ?? null : prior?.prev_balance ?? null;
            const baselineAt = stale ? prior?.seen_at ?? null : prior?.prev_seen_at ?? null;

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
              currency: a.balances.iso_currency_code,
              change: baseline == null || current == null ? null : current - Number(baseline),
              change_since: baselineAt,
              nickname: prefs.get(a.account_id)?.nickname ?? null,
              hidden: prefs.get(a.account_id)?.hidden ?? false,
              entity_id: prefs.get(a.account_id)?.entity_id ?? null,
              entity_name: prefs.get(a.account_id)?.entity_name ?? null,
              last_activity: activity.get(a.account_id) ?? null,
            });

            await saveAccountState(a.account_id, item.item_id, current, prior, stale, now);
          }
        } catch (err: any) {
          const code = err.response?.data?.error_code;
          connections.push({
            ...base,
            status: code === "ITEM_LOGIN_REQUIRED" ? "reconnect" : "offline",
            message: err.response?.data?.error_message || err.message,
          });
        }
      }

      // Record today's headline totals (visible accounts only) so the emailed
      // report can draw a trend line.
      const shown = accounts.filter((a: any) => !a.hidden);
      const totals = {
        day: now.toISOString().slice(0, 10),
        cash: shown.filter((a) => a.type === "depository").reduce((s: number, a: any) => s + (a.balance_current ?? 0), 0),
        invested: shown.filter((a) => a.type === "investment").reduce((s: number, a: any) => s + (a.balance_current ?? 0), 0),
        credit: shown.filter((a) => a.type === "credit").reduce((s: number, a: any) => s + (a.balance_current ?? 0), 0),
        updated_at: now.toISOString(),
      };
      await db("treasury_daily", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(totals),
      }).catch(() => {});

      return res.json({ connections, accounts });
    }

    // Bank transaction history for the spreadsheet view.
    if (report === "bank-transactions") {
      const items = (await getItems()).filter((i: any) => (i.kind ?? "investments") === "bank");
      const target = items.find((i: any) => i.item_id === item_id) ?? items[0];
      if (!target) return res.status(404).json({ error: "not_connected" });

      const now = new Date();
      const start =
        (req.query.start_date as string) ||
        new Date(now.getTime() - 180 * 86_400_000).toISOString().split("T")[0];
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
        db("treasury_daily?select=day,invested&order=day.desc&limit=365")
          .then(async (r) => (r.ok ? ((await r.json()) as Array<{ day: string; invested: number | null }>) : []))
          .catch(() => [] as Array<{ day: string; invested: number | null }>),
      ]);

      // A bank connection is only asked for holdings when it actually carries
      // an investment account — calling the investments product on a plain
      // bank errors (and can enrol the item in a billed product).
      const BROKERAGE = /vanguard|fidelity|schwab|e\*?trade|robinhood|merrill|morgan stanley|wealthfront|betterment|interactive brokers|ameritrade|edward jones|ubs|goldman|webull|m1 finance|public\.com|raymond james|ameriprise|lpl/i;
      // Plaid codes that just mean "no investments here" — not worth a warning.
      const NOT_APPLICABLE = new Set([
        "PRODUCTS_NOT_SUPPORTED",
        "NO_INVESTMENT_ACCOUNTS",
        "NO_INVESTMENT_AUTH_ACCOUNTS",
        "INVALID_PRODUCT",
        "PRODUCT_NOT_ENABLED",
        "NO_ACCOUNTS",
      ]);
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
            if (code && NOT_APPLICABLE.has(code)) return { skip: true as const };
            return {
              error: {
                item_id: item.item_id,
                institution: item.institution_name,
                code: code ?? null,
                reconnect: code === "ITEM_LOGIN_REQUIRED" || code === "PENDING_EXPIRATION" || code === "ITEM_LOCKED",
                message: err?.response?.data?.display_message || err?.response?.data?.error_message || err?.message || "Unavailable",
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
        })
      );

      const accounts: any[] = [];
      const holdings: any[] = [];
      const errors: any[] = [];
      const txns: InvTx[] = [];
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
          if (p?.hidden) continue;
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

      // Income: cash dividends, interest and capital-gain distributions. The
      // matching "reinvestment" buy is the same money again, so it's skipped.
      const incomeKind = (t: InvTx): "dividend" | "interest" | null => {
        const k = `${t.type} ${t.subtype ?? ""}`.toLowerCase();
        if (/reinvest/.test(k) || t.type === "buy" || t.type === "sell") return null;
        if (/interest/.test(k)) return "interest";
        if (/dividend|capital gain|distribution/.test(k)) return "dividend";
        return null;
      };
      const byMonth = new Map<string, { dividends: number; interest: number }>();
      const bySecurity = new Map<string, { ticker: string | null; name: string; amount: number }>();
      let ttm = 0;
      let last90 = 0;
      let div90 = 0;
      let int90 = 0;
      for (const t of txns) {
        const kind = incomeKind(t);
        if (!kind) continue;
        const amt = Math.abs(t.amount);
        const m = byMonth.get(t.date.slice(0, 7)) ?? { dividends: 0, interest: 0 };
        if (kind === "interest") m.interest += amt;
        else m.dividends += amt;
        byMonth.set(t.date.slice(0, 7), m);
        ttm += amt;
        if (t.date >= ninetyAgo) {
          last90 += amt;
          if (kind === "interest") int90 += amt;
          else div90 += amt;
        }
        const key = t.ticker || t.security_name || t.name;
        const s = bySecurity.get(key) ?? { ticker: t.ticker, name: t.security_name || t.name, amount: 0 };
        s.amount += amt;
        bySecurity.set(key, s);
      }

      const recent = txns.filter((t) => t.date >= ninetyAgo);
      const sumType = (type: string) => recent.filter((t) => t.type === type).reduce((s, t) => s + Math.abs(t.amount), 0);

      return res.json({
        asOf: now.toISOString(),
        accounts,
        holdings,
        errors,
        history: history
          .filter((h) => h.invested != null)
          .map((h) => ({ day: h.day, invested: Number(h.invested) }))
          .reverse(),
        income: incomeAvailable
          ? {
              last90,
              ttm,
              dividends90: div90,
              interest90: int90,
              byMonth: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v })),
              bySecurity: [...bySecurity.values()].sort((a, b) => b.amount - a.amount).slice(0, 8),
            }
          : null,
        activity: {
          buys90: sumType("buy"),
          sells90: sumType("sell"),
          recent: recent
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 60),
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
      return res.status(401).json({ error: "not_connected", message: "No Plaid accounts connected" });
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
      return res.status(401).json({ error: "auth_expired", message: "Please reconnect your investment account" });
    }
    res.status(500).json({ error: err.response?.data?.error_message || err.message });
  }
}
