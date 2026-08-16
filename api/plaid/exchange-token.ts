import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getPlaidClient } from "../../lib/plaid.js";
import { currentUser } from "../../lib/auth.js";
import { adoptMappings, stampIdentity, type LiveAccount } from "../../lib/plaid-mappings.js";
import { CountryCode } from "plaid";

async function upsertItem(row: {
  item_id: string;
  access_token: string;
  institution_name: string;
  kind: string;
  institution_id: string | null;
  institution_color: string | null;
  institution_logo: string | null;
}) {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_KEY!;
  const r = await fetch(`${url}/rest/v1/plaid_items`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Upsert failed (${r.status}): ${text}`);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });

  const { public_token, institution_name, institution_id, kind } = req.body || {};
  if (!public_token) return res.status(400).json({ error: "Missing public_token" });

  try {
    const client = getPlaidClient();
    const exchangeRes = await client.itemPublicTokenExchange({ public_token });
    const { access_token, item_id } = exchangeRes.data;

    // Pull the institution's brand colour and logo so the Treasury card can
    // wear them. Optional — a failure here shouldn't block the connection.
    let color: string | null = null;
    let logo: string | null = null;
    let name: string | undefined = institution_name;
    if (institution_id) {
      try {
        const inst = await client.institutionsGetById({
          institution_id,
          country_codes: [CountryCode.Us],
          options: { include_optional_metadata: true },
        });
        color = inst.data.institution.primary_color ?? null;
        logo = inst.data.institution.logo ?? null;
        name = name || inst.data.institution.name;
      } catch (err: any) {
        console.error("Plaid institution lookup failed:", err.response?.data || err.message);
      }
    }

    await upsertItem({
      item_id,
      access_token,
      institution_name: name || "Unknown",
      kind: kind === "bank" ? "bank" : "investments",
      institution_id: institution_id ?? null,
      institution_color: color,
      institution_logo: logo,
    });

    // A reconnected account arrives with a new id; hand it back the mapping
    // its previous incarnation carried.
    let adopted = 0;
    try {
      const live = await client.accountsGet({ access_token });
      const accounts: LiveAccount[] = live.data.accounts.map((a) => ({
        account_id: a.account_id,
        institution_name: name || "Unknown",
        mask: a.mask ?? null,
        subtype: a.subtype ?? null,
        name: a.name ?? null,
      }));
      await stampIdentity(accounts);
      adopted = await adoptMappings(accounts);
    } catch (err: any) {
      console.error("mapping adoption failed:", err.response?.data || err.message);
    }

    res.json({ success: true, item_id, adopted_mappings: adopted });
  } catch (err: any) {
    console.error("Plaid exchange error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error_message || err.message });
  }
}
