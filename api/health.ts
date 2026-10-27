import type { VercelRequest, VercelResponse } from "@vercel/node";
import { apnsConfig } from "../lib/apns.js";
import { sb } from "../lib/auth.js";
import { log } from "../lib/log.js";

/**
 * GET /api/health — is BFO up, and is everything it depends on set up?
 * No auth, cheap, cached 30s: the database gets one tiny read; the providers
 * are only checked for their settings (no paid call is made). `ok` is false
 * only when the database can't be read; a provider that isn't configured is
 * reported as such and nothing more.
 */

export type HealthChecks = { db: boolean; plaid: boolean; palm: boolean; bird: boolean; apns: boolean; openai: boolean; anthropic: boolean };
export type Health = { ok: boolean; checks: HealthChecks; version: string | null; at: string };

const has = (...names: string[]) => names.every((n) => !!process.env[n]?.trim());

export async function health(): Promise<Health> {
  let db = false;
  try {
    await sb("app_users?select=id&limit=1");
    db = true;
  } catch (err) {
    log.error("health", "database read failed", { error: err });
  }
  return {
    ok: db,
    checks: {
      db,
      plaid: has("PLAID_CLIENT_ID", "PLAID_SECRET"),
      palm: has("PALM_API_KEY"),
      bird: has("BIRD_ACCESS_KEY", "BIRD_WORKSPACE_ID"),
      apns: !!apnsConfig(),
      openai: has("OPENAI_API_KEY"),
      anthropic: has("ANTHROPIC_API_KEY"),
    },
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
    at: new Date().toISOString(),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const h = await health();
  res.setHeader("Cache-Control", "public, max-age=30, s-maxage=30");
  return res.status(h.ok ? 200 : 503).json(h);
}
