import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "documents";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Supabase env vars not set");
  return createClient(url, key);
}

function sanitizePathSegment(s: string) {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { assetId, fileName, contentType } = (req.body || {}) as {
    assetId?: string;
    fileName?: string;
    contentType?: string;
  };

  if (!assetId || !fileName) {
    return res.status(400).json({ error: "missing_params" });
  }

  try {
    const supabase = getSupabase();
    const safeAsset = sanitizePathSegment(assetId);
    const safeName = sanitizePathSegment(fileName);
    const path = `assets/${safeAsset}/${Date.now()}-${safeName}`;

    // Create a signed upload URL valid for a one-time PUT.
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);

    if (error || !data) {
      return res.status(500).json({ error: "signed_url_failed", message: error?.message });
    }

    // Public URL the client can share once the upload finishes.
    const {
      data: { publicUrl },
    } = supabase.storage.from(BUCKET).getPublicUrl(path);

    return res.status(200).json({
      path,
      token: data.token,
      signedUrl: data.signedUrl,
      publicUrl,
      contentType: contentType || "application/octet-stream",
    });
  } catch (err: any) {
    console.error("upload-url failed", err);
    return res.status(500).json({ error: "server_error", message: err?.message });
  }
}
