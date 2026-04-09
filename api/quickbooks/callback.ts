import type { VercelRequest, VercelResponse } from "@vercel/node";

// Raw REST: check if row exists, then PATCH or INSERT
async function saveToken(row: {
  realm_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  updated_at: string;
}) {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_KEY!;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  // Check if this realm_id already exists
  const checkRes = await fetch(
    `${url}/rest/v1/quickbooks_tokens?realm_id=eq.${row.realm_id}&select=realm_id`,
    { headers }
  );
  const existing = await checkRes.json();

  if (existing && existing.length > 0) {
    // Update existing row
    const patchRes = await fetch(
      `${url}/rest/v1/quickbooks_tokens?realm_id=eq.${row.realm_id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          access_token: row.access_token,
          refresh_token: row.refresh_token,
          expires_at: row.expires_at,
          updated_at: row.updated_at,
        }),
      }
    );
    if (!patchRes.ok) {
      const text = await patchRes.text();
      throw new Error(`PATCH failed (${patchRes.status}): ${text}`);
    }
  } else {
    // Insert new row
    const postRes = await fetch(`${url}/rest/v1/quickbooks_tokens`, {
      method: "POST",
      headers,
      body: JSON.stringify(row),
    });
    if (!postRes.ok) {
      const text = await postRes.text();
      throw new Error(`INSERT failed (${postRes.status}): ${text}`);
    }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code, realmId } = req.query;

  if (!code || !realmId) {
    return res.status(400).send("Missing code or realmId");
  }

  const clientId = process.env.QUICKBOOKS_CLIENT_ID!;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET!;
  const redirectUri = `https://bfoffice.vercel.app/api/quickbooks/callback`;

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  try {
    const tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code as string,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("Token exchange failed:", err);
      return res.redirect(302, `/tools/quickbooks?error=token_exchange_failed`);
    }

    const tokens = await tokenRes.json();
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    await saveToken({
      realm_id: realmId as string,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    });

    res.redirect(302, `/tools/quickbooks?connected=true&realm_id=${realmId}`);
  } catch (err: any) {
    console.error("OAuth callback error:", err);
    res.redirect(302, `/tools/quickbooks?error=callback_failed&detail=${encodeURIComponent(err.message)}`);
  }
}
