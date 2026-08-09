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
  res.setHeader("Access-Control-Allow-Origin", "https://bfoffice.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });

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
      const now = new Date();
      const accounts: any[] = [];
      const connections: any[] = [];

      for (const item of items) {
        const base = {
          item_id: item.item_id,
          institution_name: item.institution_name,
          institution_color: item.institution_color ?? null,
          institution_logo: item.institution_logo ?? null,
        };
        try {
          const balRes = await client.accountsGet({ access_token: item.access_token });
          connections.push({ ...base, status: "online" });

          for (const a of balRes.data.accounts) {
            if (a.type !== "depository" && a.type !== "credit") continue;
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
              currency: a.balances.iso_currency_code,
              change: baseline == null || current == null ? null : current - Number(baseline),
              change_since: baselineAt,
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
