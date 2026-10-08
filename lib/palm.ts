/**
 * Palm (getpalm.com) — state registry records, and registered agent service
 * that Palm provides and files with the state. Server-side only: the API key
 * (PALM_API_KEY, sk_test_… or sk_live_…) never reaches the browser.
 *
 * Test keys run in Palm's sandbox: nothing is filed and nothing is billed.
 * Live keys file with the state and are billed to the Palm account.
 */

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

/** One Palm API call. Throws PalmError with Palm's own explanation on failure. */
export async function palm<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const key = process.env.PALM_API_KEY;
  if (!palmMode(key)) throw new PalmError(503, "Palm isn't connected. Add PALM_API_KEY (sk_test_… or sk_live_…) in Vercel.");
  const r = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await r.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!r.ok) throw new PalmError(r.status, problemMessage(r.status, json), json);
  return json as T;
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
