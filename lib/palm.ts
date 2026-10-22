/**
 * Palm (getpalm.com) — state registry records, and registered agent service
 * that Palm provides and files with the state. Server-side only: the API key
 * (PALM_API_KEY, sk_test_… or sk_live_…) never reaches the browser.
 *
 * Test keys run in Palm's sandbox: nothing is filed and nothing is billed.
 * Live keys file with the state and are billed to the Palm account.
 */

import { sb } from "./auth.js";
import { PALM_PRICES, palmProduct } from "./palm-pricing.js";
import { sameAddressText } from "./registry.js";

const BASE = "https://api.getpalm.com";
const TIMEOUT_MS = 20_000;

export type PalmMode = "test" | "live";

export function palmMode(key = process.env.PALM_API_KEY): PalmMode | null {
  if (!key) return null;
  if (key.startsWith("sk_live_")) return "live";
  if (key.startsWith("sk_test_")) return "test";
  return null;
}

export class PalmError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
  }
}

/** Who or what a billed call was for, kept with it in palm_usage. */
export type PalmUsage = { actorId?: string | null; actorName?: string | null; assetId?: string | null; reason?: string };

/**
 * One Palm API call. Throws PalmError with Palm's own explanation on failure.
 * A call Palm bills for (lib/palm-pricing.ts) is logged in palm_usage.
 */
export async function palm<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; usage?: PalmUsage } = {}
): Promise<T> {
  const key = process.env.PALM_API_KEY;
  const mode = palmMode(key);
  if (!mode) throw new PalmError(503, "Palm isn't connected. Add PALM_API_KEY (sk_test_… or sk_live_…) in Vercel.");
  const method = init.method ?? "GET";
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await r.text();
  const product = palmProduct(method, path);
  if (product && r.ok) await logUsage(mode, product, method, path, r.status, init.usage);
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!r.ok) throw new PalmError(r.status, problemMessage(r.status, json), json);
  return json as T;
}

/**
 * A file from Palm (a document's content): the same key, mode check and
 * timeout as every other call, and PalmError with Palm's explanation on failure.
 */
export async function palmFile(path: string): Promise<{ bytes: Buffer; contentType: string; disposition: string | null }> {
  const key = process.env.PALM_API_KEY;
  if (!palmMode(key)) throw new PalmError(503, "Palm isn't connected. Add PALM_API_KEY (sk_test_… or sk_live_…) in Vercel.");
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    throw new PalmError(r.status, problemMessage(r.status, json), json);
  }
  return {
    bytes: Buffer.from(await r.arrayBuffer()),
    contentType: (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase(),
    disposition: r.headers.get("content-disposition"),
  };
}

/** A document Palm holds for a business (GET /v1/business/{id}/document). */
export type PalmDocumentRow = { id: string; type?: string; types?: string[]; filename?: string; content_type?: string; file_size?: number; created_at?: string; upload_date?: string };

/**
 * Every document Palm holds for a business, following every page so nothing
 * (legal papers above all) is cut off; the bound only stops a runaway cursor.
 */
export async function listPalmDocuments(businessId: string): Promise<{ documents: PalmDocumentRow[]; truncated: boolean }> {
  const documents: PalmDocumentRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    const q: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const r: { data?: PalmDocumentRow[]; has_more?: boolean; next_cursor?: string | null } = await palm(`/v1/business/${businessId}/document?limit=100${q}`);
    documents.push(...(r?.data ?? []));
    if (!r?.has_more || !r.next_cursor || r.next_cursor === cursor) return { documents, truncated: false };
    cursor = r.next_cursor;
  }
  return { documents, truncated: true };
}

/** A billed call, written down; a call that can't be logged still goes through. */
async function logUsage(mode: PalmMode, product: string, method: string, path: string, status: number, usage: PalmUsage | undefined) {
  const price = PALM_PRICES[product as keyof typeof PALM_PRICES];
  await sb("palm_usage", {
    method: "POST",
    body: {
      mode,
      product,
      // The sandbox isn't billed.
      cents: mode === "live" ? price.cents : 0,
      method,
      path: path.slice(0, 300),
      status,
      actor_id: usage?.actorId ?? null,
      actor_name: usage?.actorName?.slice(0, 120) ?? null,
      asset_id: usage?.assetId ?? null,
      reason: usage?.reason?.slice(0, 120) ?? null,
    },
    prefer: "return=minimal",
  }).catch((err) => console.error("palm: couldn't log a billed call", err));
}

/** Palm's RFC 7807 problem → one readable sentence. */
export function problemMessage(status: number, body: unknown): string {
  const b = (body ?? {}) as { title?: string; detail?: string; errors?: { message?: string; detail?: string }[] };
  const parts = [b.detail || b.title, ...(b.errors ?? []).map((e) => e.message || e.detail)].filter(Boolean);
  if (parts.length) return parts.join(" — ");
  if (status === 401) return "Palm rejected the API key.";
  if (status === 404) return "Palm has no record of that.";
  if (status === 409) return "Palm is already working on a change for this business.";
  if (status === 429) return "Palm is rate-limiting requests. Try again in a minute.";
  return `Palm returned ${status}.`;
}

/** Names compared the way registries write them: case, punctuation and "L.L.C." vs "LLC" don't matter. */
export function normalizeLegalName(name?: string | null): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/l\.\s*l\.\s*c\.?/g, "llc")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "123456789" or "12-3456789" → "12-3456789"; anything else → null. */
export function normalizeEin(ein?: string | null): string | null {
  const m = /^(\d{2})-?(\d{7})$/.exec((ein ?? "").trim());
  return m ? `${m[1]}-${m[2]}` : null;
}

/** "US-NV" — Palm's jurisdiction format. */
export function isJurisdiction(v: unknown): v is string {
  return typeof v === "string" && /^US-[A-Z]{2}$/.test(v);
}

/** Palm's entity_type for one of BFO's entity types. */
export function palmEntityType(type?: string): "llc" | "corporation" | "lp" | "other" {
  if (type === "LLC") return "llc";
  if (type === "C-Corp") return "corporation";
  if (type === "LP") return "lp";
  return "other";
}

/** Split "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028" into Palm's vault fields. */
export function vaultAddress(address?: string): Record<string, string> {
  const m = /^(.*?),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/.exec((address ?? "").trim());
  if (!m) return {};
  const street = m[1].split(",").map((s) => s.trim()).filter(Boolean);
  return {
    "business.address_line_1": street[0],
    ...(street.length > 1 ? { "business.address_line_2": street.slice(1).join(", ") } : {}),
    "business.city": m[2].trim(),
    "business.region": m[3],
    "business.postal_code": m[4],
    "business.country": "US",
  };
}

export type RegisteredAgentService = {
  object: "registered_agent";
  business_id: string;
  provider: "palm" | "external" | null;
  status: "pending" | "active" | "termination_requested" | "terminated" | "failed" | "canceled" | null;
  jurisdiction: string | null;
  started_at: string | null;
  ended_at: string | null;
  rejection_reason?: string | null;
  name?: string | null;
  address?: { street_line_1?: string; street_line_2?: string; city?: string; region?: string; postal_code?: string; country: string } | null;
};

/**
 * Where Palm's copy of the business (its vault, as cached on the business)
 * disagrees with our record. Only fields Palm shows and we have are compared.
 */
export function businessDifferences(vault: Record<string, unknown>, e: { name?: string; ein?: string; fileNumber?: string; formationDate?: string; address?: string }): { field: string; palm: string; ours: string }[] {
  const v = (k: string) => (typeof vault[k] === "string" ? (vault[k] as string).trim() : "");
  const out: { field: string; palm: string; ours: string }[] = [];
  const add = (field: string, palmValue: string, ours: string | undefined, same: (a: string, b: string) => boolean) => {
    if (palmValue && ours?.trim() && !same(palmValue, ours.trim())) out.push({ field, palm: palmValue, ours: ours.trim() });
  };
  add("Legal name", v("business.legal_name"), e.name, (a, b) => normalizeLegalName(a) === normalizeLegalName(b));
  add("EIN", v("business.ein"), e.ein, (a, b) => normalizeEin(a) === normalizeEin(b));
  add("File number", v("business.registration_number"), e.fileNumber, (a, b) => a.replace(/\W/g, "").toLowerCase() === b.replace(/\W/g, "").toLowerCase());
  add("Formation date", v("business.formation_date").slice(0, 10), e.formationDate, (a, b) => a === b.slice(0, 10));
  const palmAddress = [v("business.address_line_1"), v("business.address_line_2"), v("business.city"), [v("business.region"), v("business.postal_code")].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  add("Address", palmAddress, e.address, sameAddressText);
  return out;
}
