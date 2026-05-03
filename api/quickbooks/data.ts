import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
}

// Upsert token row keyed by realm_id (primary key)
async function saveToken(row: {
  realm_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  updated_at: string;
}) {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_KEY!;
  const res = await fetch(`${url}/rest/v1/quickbooks_tokens`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upsert failed (${res.status}): ${text}`);
  }
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

  await saveToken({
    realm_id: realmId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
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

  const { report, realm_id } = req.query;

  if (!report) {
    return res.status(400).json({ error: "Missing report parameter" });
  }

  try {
    const supabase = getSupabase();

    // Debug endpoint
    if (report === "debug") {
      const { data: rows, error: dbError, count } = await supabase
        .from("quickbooks_tokens")
        .select("*", { count: "exact" });

      // Check table schema
      const { data: schemaRows, error: schemaError } = await supabase
        .rpc("", {}).then(() => ({ data: null, error: null })).catch(() => ({ data: null, error: null }));

      // Test write capability using raw REST upsert
      // Note: uses a dedicated test row that persists (JS client delete is unsafe)
      let writeTest = "not_tested";
      try {
        await saveToken({
          realm_id: "__debug_test__",
          access_token: "test",
          refresh_token: "test",
          expires_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        writeTest = "ok";
      } catch (e: any) {
        writeTest = `error: ${e.message}`;
      }

      // For each connected company, check if token is valid
      const companyDetails = await Promise.all(
        (rows || []).map(async (r: any) => {
          const tokenExpired = new Date(r.expires_at).getTime() < Date.now();
          const tokenExpiresIn = Math.round((new Date(r.expires_at).getTime() - Date.now()) / 60000);
          let companyName = "";
          let apiTest = "not_tested";
          try {
            let token = r.access_token;
            if (tokenExpired) {
              try {
                token = await refreshAccessToken(supabase, r.refresh_token, r.realm_id);
                apiTest = "token_refreshed";
              } catch (e: any) {
                apiTest = `refresh_failed: ${e.message}`;
                return {
                  realm_id: r.realm_id,
                  updated_at: r.updated_at,
                  token_expired: tokenExpired,
                  token_expires_in_min: tokenExpiresIn,
                  has_access_token: !!r.access_token,
                  has_refresh_token: !!r.refresh_token,
                  access_token_preview: r.access_token ? `${r.access_token.substring(0, 10)}...` : "EMPTY",
                  api_test: apiTest,
                  company_name: "",
                };
              }
            }
            const info = await qboFetch(token, r.realm_id, `companyinfo/${r.realm_id}`);
            companyName = info?.CompanyInfo?.CompanyName || "";
            apiTest = "ok";
          } catch (e: any) {
            apiTest = `failed: ${e.message}`;
          }
          return {
            realm_id: r.realm_id,
            company_name: companyName,
            updated_at: r.updated_at,
            token_expired: tokenExpired,
            token_expires_in_min: tokenExpiresIn,
            has_access_token: !!r.access_token,
            has_refresh_token: !!r.refresh_token,
            access_token_preview: r.access_token ? `${r.access_token.substring(0, 10)}...` : "EMPTY",
            api_test: apiTest,
          };
        })
      );

      return res.json({
        timestamp: new Date().toISOString(),
        env: {
          supabase_url_set: !!process.env.SUPABASE_URL,
          service_key_set: !!process.env.SUPABASE_SERVICE_KEY,
          supabase_url_preview: process.env.SUPABASE_URL ? process.env.SUPABASE_URL.substring(0, 30) + "..." : "NOT SET",
          qb_client_id_set: !!process.env.QUICKBOOKS_CLIENT_ID,
          qb_client_id_preview: process.env.QUICKBOOKS_CLIENT_ID ? `${process.env.QUICKBOOKS_CLIENT_ID.substring(0, 8)}...` : "NOT SET",
        },
        database: {
          db_error: dbError?.message || null,
          row_count: count,
          write_test: writeTest,
        },
        companies: companyDetails,
      });
    }

    // List all connected companies
    if (report === "list") {
      const { data: rows, error: dbError } = await supabase
        .from("quickbooks_tokens")
        .select("*");
      if (dbError) {
        return res.status(500).json({ error: "db_error", message: dbError.message });
      }
      // Skip debug/internal rows, and enrich each with its real CompanyName
      const realRows = (rows || []).filter(
        (r: any) => r.realm_id && !String(r.realm_id).startsWith("__"),
      );
      const companies = await Promise.all(
        realRows.map(async (r: any) => {
          let companyName = "";
          let status: "ok" | "auth_expired" | "error" = "ok";
          let errorMessage: string | undefined;
          try {
            let token = r.access_token;
            const tokenExpired = new Date(r.expires_at).getTime() < Date.now();
            if (tokenExpired) {
              try {
                token = await refreshAccessToken(supabase, r.refresh_token, r.realm_id);
              } catch (e: any) {
                status = "auth_expired";
                errorMessage = e?.message || "Token refresh failed";
                throw e;
              }
            }
            const info = await qboFetch(token, r.realm_id, `companyinfo/${r.realm_id}`);
            companyName = info?.CompanyInfo?.CompanyName || "";
          } catch (e: any) {
            if (status === "ok") {
              const msg = String(e?.message || "");
              status = msg.includes("401") ? "auth_expired" : "error";
              errorMessage = msg || "QuickBooks API error";
            }
          }
          return {
            realm_id: r.realm_id,
            company_name: companyName,
            updated_at: r.updated_at,
            status,
            error: errorMessage,
          };
        }),
      );
      return res.json({ companies });
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
      case "profit-loss-monthly": {
        const plYear = (req.query.year as string) || String(new Date().getFullYear());
        const plStart = `${plYear}-01-01`;
        const plEnd = `${plYear}-12-31`;
        data = await qboFetch(
          accessToken,
          realmId,
          `reports/ProfitAndLoss?start_date=${plStart}&end_date=${plEnd}&summarize_column_by=Month&minorversion=75`
        );
        break;
      }
      case "trial-balance": {
        const tbDate = (req.query.as_of as string) || `${new Date().getFullYear()}-12-31`;
        data = await qboFetch(
          accessToken,
          realmId,
          `reports/TrialBalance?date_macro=&as_of=${tbDate}&minorversion=75`
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
      case "general-ledger": {
        const glStart = (req.query.start_date as string) || `${new Date().getFullYear()}-01-01`;
        const glEnd = (req.query.end_date as string) || new Date().toISOString().split("T")[0];
        data = await qboFetch(
          accessToken,
          realmId,
          `reports/GeneralLedger?start_date=${glStart}&end_date=${glEnd}&columns=tx_date,txn_type,doc_num,name,memo,account_name,subt_nat_amount,rbal_nat_amount&minorversion=75`
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
