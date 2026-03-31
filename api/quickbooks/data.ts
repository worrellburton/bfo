import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@libsql/client";

async function getDb() {
  return createClient({
    url: process.env.DATABASE_URL || "",
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  });
}

async function getTokens(db: ReturnType<typeof createClient>) {
  const result = await db.execute("SELECT * FROM quickbooks_tokens WHERE id = 1");
  return result.rows[0] || null;
}

async function refreshAccessToken(db: ReturnType<typeof createClient>, refreshToken: string) {
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
  const expiresAt = Date.now() + tokens.expires_in * 1000;

  await db.execute({
    sql: `UPDATE quickbooks_tokens SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = datetime('now') WHERE id = 1`,
    args: [tokens.access_token, tokens.refresh_token, expiresAt],
  });

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

  const { report } = req.query;

  if (!report) {
    return res.status(400).json({ error: "Missing report parameter" });
  }

  try {
    const db = await getDb();
    const row = await getTokens(db);

    if (!row) {
      return res.status(401).json({ error: "not_connected", message: "QuickBooks not connected" });
    }

    let accessToken = row.access_token as string;
    const refreshToken = row.refresh_token as string;
    const realmId = row.realm_id as string;
    const expiresAt = row.expires_at as number;

    // Refresh if token expires within 5 minutes
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      accessToken = await refreshAccessToken(db, refreshToken);
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
        data = { connected: true, realmId };
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
