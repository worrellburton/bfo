import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "documents";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Supabase env vars not set");
  return createClient(url, key);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { path } = (req.body || {}) as { path?: string };
  if (!path) return res.status(400).json({ error: "missing_path" });

  try {
    const supabase = getSupabase();
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) {
      return res.status(500).json({ error: "delete_failed", message: error.message });
    }
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error("document delete failed", err);
    return res.status(500).json({ error: "server_error", message: err?.message });
  }
}
