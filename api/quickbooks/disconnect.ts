import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@libsql/client";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const db = createClient({
      url: process.env.DATABASE_URL || "",
      authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
    });

    // Revoke token with Intuit
    const result = await db.execute("SELECT * FROM quickbooks_tokens WHERE id = 1");
    const row = result.rows[0];

    if (row) {
      const clientId = process.env.QUICKBOOKS_CLIENT_ID!;
      const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET!;
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

      await fetch("https://developer.api.intuit.com/v2/oauth2/tokens/revoke", {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ token: row.refresh_token }),
      }).catch(() => {});

      await db.execute("DELETE FROM quickbooks_tokens WHERE id = 1");
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("Disconnect error:", err);
    res.status(500).json({ error: err.message });
  }
}
