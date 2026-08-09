import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser } from "../../lib/auth.js";
import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from "plaid";

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
  res.setHeader("Access-Control-Allow-Origin", "https://bfoffice.vercel.app");
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

  // Production OAuth banks (Chase, Wells Fargo, BoA…) bounce through a
  // redirect that has to be registered in the Plaid dashboard as well.
  const redirectUri = process.env.PLAID_REDIRECT_URI?.trim();

  try {
    const client = getPlaidClient();
    const response = await client.linkTokenCreate({
      user: { client_user_id: "bfo-user" },
      client_name: "Burton Family Office",
      products,
      country_codes: [CountryCode.Us],
      language: "en",
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    });

    res.json({ link_token: response.data.link_token });
  } catch (err: any) {
    console.error("Plaid link token error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error_message || err.message });
  }
}
