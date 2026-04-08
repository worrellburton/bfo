import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
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

    const supabase = getSupabase();

    const { error } = await supabase
      .from("quickbooks_tokens")
      .upsert({
        id: 1,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        realm_id: realmId as string,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });

    if (error) {
      console.error("Supabase upsert error:", error);
      return res.redirect(302, `/tools/quickbooks?error=db_error`);
    }

    res.redirect(302, `/tools/quickbooks?connected=true`);
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.redirect(302, `/tools/quickbooks?error=callback_failed`);
  }
}
