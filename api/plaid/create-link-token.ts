import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getPlaidClient } from "../../lib/plaid.js";
import { currentUser, sb } from "../../lib/auth.js";
import { Products, CountryCode } from "plaid";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });

  // Brokerage connections ask for investments; Treasury asks for transactions
  // so bank balances and history come back.
  const kind = (req.body?.kind as string) === "bank" ? "bank" : "investments";
  const products = kind === "bank" ? [Products.Transactions] : [Products.Investments];

  // Update mode: relink an existing connection instead of adding a new one.
  // With account selection on, the bank's own picker reopens so accounts that
  // were closed (or shouldn't be shared) can be deselected — after which Plaid
  // stops returning them entirely.
  const updateItemId = typeof req.body?.item_id === "string" ? req.body.item_id.trim() : "";

  // Production OAuth banks (Chase, Wells Fargo, BoA…) bounce through a
  // redirect that has to be registered in the Plaid dashboard as well.
  const redirectUri = process.env.PLAID_REDIRECT_URI?.trim();

  try {
    const client = getPlaidClient();

    let accessToken: string | undefined;
    if (updateItemId) {
      const rows = await sb<Array<{ access_token: string }>>(
        `plaid_items?item_id=eq.${encodeURIComponent(updateItemId)}&select=access_token&limit=1`
      );
      if (!rows?.[0]) return res.status(404).json({ error: "unknown_item" });
      accessToken = rows[0].access_token;
    }

    const response = await client.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: "Burton Family Office",
      // Update mode takes no products — the Item already has them.
      ...(accessToken
        ? { access_token: accessToken, update: { account_selection_enabled: true } }
        : { products }),
      country_codes: [CountryCode.Us],
      language: "en",
      // Request the full 730-day window. NOTE: Plaid only honours this on the
      // Item's FIRST historical pull — update mode cannot extend an Item that
      // already pulled at the 90-day default. To deepen an old connection you
      // must remove the Item and add it fresh (this value then takes effect).
      // Wells Fargo checking tops out ~18 months regardless; that's a WF cap.
      ...(kind === "bank" ? { transactions: { days_requested: 730 } } : {}),
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    });

    res.json({ link_token: response.data.link_token });
  } catch (err: any) {
    console.error("Plaid link token error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error_message || err.message });
  }
}
