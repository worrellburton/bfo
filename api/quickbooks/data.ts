import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
}

async function refreshAccessToken(supabase: ReturnType<typeof createClient>, refreshToken: string, realmId: string) {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID!;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET!;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${await res.text()}`);
  }

  const tokens = await res.json();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabase
    .from("quickbooks_tokens")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("realm_id", realmId);

  return tokens.access_token;
}

async function qboFetch(accessToken: string, realmId: string, endpoint: string) {
  const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;
  const res = await fetch(`${baseUrl}/${endpoint}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`QBO API error (${res.status}): ${err}`);
  }

  return res.json();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "https://bfoffice.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { report, realm_id } = req.query;

  if (!report) {
    return res.status(400).json({ error: "Missing report parameter" });
  }

  try {
    const supabase = getSupabase();

    // List all connected companies
    if (report === "list") {
      const { data: rows, error: dbError } = await supabase
        .from("quickbooks_tokens")
        .select("realm_id, company_name, updated_at");
      if (dbError) {
        return res.status(500).json({ error: "db_error", message: dbError.message });
      }
      return res.json({ companies: rows || [] });
    }

    // For all other reports, need a specific company
    // If realm_id provided, use it; otherwise use the first connected company
    let query = supabase.from("quickbooks_tokens").select("*");
    if (realm_id) {
      query = query.eq("realm_id", realm_id as string);
    }
    const { data: rows, error: dbError } = await query;

    if (dbError || !rows || rows.length === 0) {
      return res.status(401).json({ error: "not_connected", message: "QuickBooks not connected" });
    }

    const row = realm_id ? rows[0] : rows[0];

    let accessToken = row.access_token as string;
    const refreshToken = row.refresh_token as string;
    const realmId = row.realm_id as string;
    const expiresAt = new Date(row.expires_at).getTime();

    // Refresh if token expires within 5 minutes
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      accessToken = await refreshAccessToken(supabase, refreshToken, realmId);
    }

    let data;
    switch (report) {
      case "company-info":
        data = await qboFetch(accessToken, realmId, "companyinfo/" + realmId);
        break;
      case "profit-loss":
        data = await qboFetch(accessToken, realmId, "reports/ProfitAndLoss?minorversion=75");
        break;
      case "balance-sheet":
        data = await qboFetch(accessToken, realmId, "reports/BalanceSheet?minorversion=75");
        break;
      case "profit-loss-detail": {
        const startDate = (req.query.start_date as string) || "2024-01-01";
        const endDate = (req.query.end_date as string) || new Date().toISOString().split("T")[0];
        data = await qboFetch(
          accessToken,
          realmId,
          `reports/ProfitAndLoss?start_date=${startDate}&end_date=${endDate}&minorversion=75`
        );
        break;
      }
      case "balance-sheet-detail": {
        const asOf = (req.query.as_of as string) || new Date().toISOString().split("T")[0];
        data = await qboFetch(
          accessToken,
          realmId,
          `reports/BalanceSheet?date_macro=&as_of=${asOf}&minorversion=75`
        );
        break;
      }
      case "accounts":
        data = await qboFetch(
          accessToken,
          realmId,
          "query?query=" + encodeURIComponent("SELECT * FROM Account MAXRESULTS 1000")
        );
        break;
      case "status":
        data = { connected: true, realmId, companyName: row.company_name };
        break;
      default:
        return res.status(400).json({ error: "Unknown report type" });
    }

    res.json(data);
  } catch (err: any) {
    console.error("QBO data error:", err);
    if (err.message?.includes("401") || err.message?.includes("Token refresh failed")) {
      return res.status(401).json({ error: "auth_expired", message: "Please reconnect QuickBooks" });
    }
    res.status(500).json({ error: "fetch_failed", message: err.message });
  }
}
