import type { VercelRequest, VercelResponse } from "@vercel/node";
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

async function getItems() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_KEY!;
  const r = await fetch(`${url}/rest/v1/plaid_items?select=*`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!r.ok) throw new Error(`DB error: ${await r.text()}`);
  return r.json();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "https://bfoffice.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { report, item_id } = req.query;

  try {
    const client = getPlaidClient();

    // List all connected items
    if (report === "list") {
      const items = await getItems();
      return res.json({
        items: (items || []).map((i: any) => ({
          item_id: i.item_id,
          institution_name: i.institution_name,
          created_at: i.created_at,
        })),
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
