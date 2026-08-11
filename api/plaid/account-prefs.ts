import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser } from "../../lib/auth.js";

/** Set a bank account's nickname and/or hidden flag. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });

  const { account_id, nickname, hidden, entity_id, entity_name } = req.body ?? {};
  if (!account_id || typeof account_id !== "string") {
    return res.status(400).json({ error: "missing_account_id" });
  }

  const row: Record<string, unknown> = {
    account_id,
    updated_at: new Date().toISOString(),
  };
  if (nickname !== undefined) row.nickname = String(nickname).trim().slice(0, 60) || null;
  if (hidden !== undefined) row.hidden = !!hidden;
  if (entity_id !== undefined) row.entity_id = String(entity_id).trim() || null;
  if (entity_name !== undefined) row.entity_name = String(entity_name).trim().slice(0, 120) || null;

  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_KEY!;
  const r = await fetch(`${url}/rest/v1/plaid_account_prefs`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    return res.status(500).json({ error: "save_failed", message: (await r.text()).slice(0, 200) });
  }
  const saved = (await r.json()) as any[];
  return res.status(200).json({ prefs: saved[0] });
}
