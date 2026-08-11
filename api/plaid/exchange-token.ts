import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, sb } from "../../lib/auth.js";
import { Configuration, CountryCode, PlaidApi, PlaidEnvironments } from "plaid";

function getPlaidClient() {
  const config = new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV || "sandbox"],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!,
        "PLAID-SECRET": process.env.PLAID_SECRET!,
      },
    },
  });
  return new PlaidApi(config);
}

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

/**
 * Plaid mints fresh account_ids for every new connection, so reconnecting a
 * bank would otherwise orphan its nicknames and entity mappings. Each account
 * on the new connection looks for an existing mapping with the same identity
 * — same bank, last four and account kind — and takes it over.
 *
 * An identity matching more than one saved mapping is left alone: better an
 * account arrives unmapped than mapped to the wrong entity.
 */
async function adoptPrefs(
  client: PlaidApi,
  accessToken: string,
  institutionName: string
): Promise<number> {
  try {
    const live = await client.accountsGet({ access_token: accessToken });
    const saved = await sb<
      Array<{
        account_id: string;
        institution_name: string | null;
        mask: string | null;
        subtype: string | null;
        nickname: string | null;
        hidden: boolean;
        entity_id: string | null;
        entity_name: string | null;
      }>
    >(`plaid_account_prefs?institution_name=eq.${encodeURIComponent(institutionName)}&select=*`);
    if (!saved?.length) return 0;

    const liveIds = new Set(live.data.accounts.map((a) => a.account_id));
    let adopted = 0;

    for (const account of live.data.accounts) {
      // Already carries its own row — nothing to adopt.
      if (saved.some((s) => s.account_id === account.account_id)) continue;

      const candidates = saved.filter(
        (s) =>
          s.mask === account.mask &&
          s.subtype === (account.subtype ?? null) &&
          !liveIds.has(s.account_id) && // its old account_id is gone
          (s.entity_id || s.nickname || s.hidden)
      );
      if (candidates.length !== 1) continue;

      const from = candidates[0];
      await sb("plaid_account_prefs", {
        method: "POST",
        prefer: "resolution=merge-duplicates",
        body: {
          account_id: account.account_id,
          nickname: from.nickname,
          hidden: from.hidden,
          entity_id: from.entity_id,
          entity_name: from.entity_name,
          institution_name: institutionName,
          mask: account.mask,
          subtype: account.subtype ?? null,
          account_name: account.name,
          archived_at: null,
          updated_at: new Date().toISOString(),
        },
      });
      adopted += 1;
    }

    // Stamp identity on any remaining new accounts so they survive the *next*
    // reconnect too.
    for (const account of live.data.accounts) {
      await sb("plaid_account_prefs", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: {
          account_id: account.account_id,
          institution_name: institutionName,
          mask: account.mask,
          subtype: account.subtype ?? null,
          account_name: account.name,
        },
      }).catch(() => {});
    }

    return adopted;
  } catch (err: any) {
    console.error("adoptPrefs failed:", err.response?.data || err.message);
    return 0;
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

    const adopted = await adoptPrefs(client, access_token, name || "Unknown");

    res.json({ success: true, item_id, adopted_mappings: adopted });
  } catch (err: any) {
    console.error("Plaid exchange error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error_message || err.message });
  }
}
