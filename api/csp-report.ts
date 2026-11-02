import type { VercelRequest, VercelResponse } from "@vercel/node";
import { log } from "../lib/log.js";

/**
 * POST /api/csp-report — where the browser sends Content-Security-Policy
 * violations (the report-only policy in vercel.json). No auth: browsers
 * post these on their own. Each report is logged once, trimmed, so a page
 * that loads something the policy doesn't allow shows up in the function
 * logs before the policy is switched from report-only to enforced.
 */

export const config = { api: { bodyParser: { sizeLimit: "16kb" } } };

type Report = { "csp-report"?: Record<string, unknown> } | { type?: string; body?: Record<string, unknown> }[];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  let body: Report | null = null;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(204).end();
  }
  // Both report formats: the legacy `csp-report` object (report-uri) and the Reporting API's array.
  const reports = Array.isArray(body) ? body.map((r) => r.body ?? {}) : [((body ?? {}) as { "csp-report"?: Record<string, unknown> })["csp-report"] ?? {}];
  for (const r of reports.slice(0, 5)) {
    const pick = (k: string) => String(r[k] ?? r[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] ?? "").slice(0, 300);
    log.warn("csp", "policy violation", {
      directive: pick("violated-directive") || pick("effective-directive"),
      blocked: pick("blocked-uri"),
      page: pick("document-uri"),
      source: pick("source-file"),
      line: pick("line-number"),
    });
  }
  return res.status(204).end();
}
