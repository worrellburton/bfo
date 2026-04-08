import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    // Get existing token to revoke with Intuit
    const { data: row } = await supabase
      .from("quickbooks_tokens")
      .select("*")
      .eq("id", 1)
      .single();

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

      await supabase
        .from("quickbooks_tokens")
        .delete()
        .eq("id", 1);
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("Disconnect error:", err);
    res.status(500).json({ error: err.message });
  }
}
