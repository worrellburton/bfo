import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";

export default function handler(req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;

  // Debug mode — show the auth URL instead of redirecting
  if (req.query.debug === "1") {
    const redirectUri = `https://bfoffice.vercel.app/api/quickbooks/callback`;
    const scope = "com.intuit.quickbooks.accounting";
    const state = "debug-test";
    const authUrl =
      `https://appcenter.intuit.com/connect/oauth2?` +
      `client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scope)}` +
      `&state=${state}`;

    return res.json({
      client_id_set: !!clientId,
      client_id_length: clientId?.length,
      client_id_preview: clientId ? `${clientId.substring(0, 8)}...${clientId.substring(clientId.length - 4)}` : "NOT SET",
      redirect_uri: redirectUri,
      scope,
      auth_url: authUrl,
    });
  }

  if (!clientId) {
    return res.status(500).json({
      error: "QUICKBOOKS_CLIENT_ID environment variable is not set",
      hint: "Add it in Vercel → Project Settings → Environment Variables, then redeploy",
    });
  }

  const redirectUri = `https://bfoffice.vercel.app/api/quickbooks/callback`;
  const scope = "com.intuit.quickbooks.accounting";
  const state = crypto.randomBytes(16).toString("hex");

  const authUrl =
    `https://appcenter.intuit.com/connect/oauth2?` +
    `client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}` +
    `&state=${state}`;

  res.redirect(302, authUrl);
}
