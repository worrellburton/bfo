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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { item_id } = req.query;
  if (!item_id) return res.status(400).json({ error: "Missing item_id" });

  try {
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_KEY!;
    const headers = { apikey: key, Authorization: `Bearer ${key}` };

    // Get the access token
    const getRes = await fetch(`${url}/rest/v1/plaid_items?item_id=eq.${item_id}&select=access_token`, { headers });
    const items = await getRes.json();

    if (items && items.length > 0) {
      // Revoke with Plaid
      try {
        const client = getPlaidClient();
        await client.itemRemove({ access_token: items[0].access_token });
      } catch {}

      // Delete from database
      await fetch(`${url}/rest/v1/plaid_items?item_id=eq.${item_id}`, {
        method: "DELETE",
        headers,
      });
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("Plaid disconnect error:", err.message);
    res.status(500).json({ error: err.message });
  }
}
