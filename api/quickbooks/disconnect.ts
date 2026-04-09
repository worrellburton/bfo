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

    const { realm_id } = req.query;

    // If realm_id provided, disconnect that specific company
    // Otherwise disconnect all
    let query = supabase.from("quickbooks_tokens").select("*");
    if (realm_id) {
      query = query.eq("realm_id", realm_id as string);
    }

    const { data: rows } = await query;

    if (rows && rows.length > 0) {
      const clientId = process.env.QUICKBOOKS_CLIENT_ID!;
      const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET!;
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

      // Revoke tokens with Intuit
      for (const row of rows) {
        await fetch("https://developer.api.intuit.com/v2/oauth2/tokens/revoke", {
          method: "POST",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ token: row.refresh_token }),
        }).catch(() => {});
      }

      // Delete from database
      let deleteQuery = supabase.from("quickbooks_tokens").delete();
      if (realm_id) {
        deleteQuery = deleteQuery.eq("realm_id", realm_id as string);
      } else {
        // Delete all — need a filter, use gt to match all
        deleteQuery = deleteQuery.neq("realm_id", "");
      }
      await deleteQuery;
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("Disconnect error:", err);
    res.status(500).json({ error: err.message });
  }
}
