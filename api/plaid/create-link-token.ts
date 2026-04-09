import type { VercelRequest, VercelResponse } from "@vercel/node";
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

  try {
    const client = getPlaidClient();
    const response = await client.linkTokenCreate({
      user: { client_user_id: "bfo-user" },
      client_name: "Burton Family Office",
      products: [Products.Investments],
      country_codes: [CountryCode.Us],
      language: "en",
    });

    res.json({ link_token: response.data.link_token });
  } catch (err: any) {
    console.error("Plaid link token error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error_message || err.message });
  }
}
