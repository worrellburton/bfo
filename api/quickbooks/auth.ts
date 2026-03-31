import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";

export default function handler(req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
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
