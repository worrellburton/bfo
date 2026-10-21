import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Palm webhooks: checking the signature, and turning an event into the row
 * BFO keeps (public.palm_events). Pure, so it's tested on its own.
 *
 * Palm signs `${t}.${raw body}` with HMAC-SHA256 and sends
 * `Palm-Signature: t=<unix seconds>,v1=<signature>`. Its docs don't say how
 * the secret or the digest are encoded, so the common forms are accepted —
 * every one of them still needs the secret.
 */

export const TOLERANCE_SECONDS = 5 * 60;

function parseHeader(header: string): { t: string; v1: string[] } | null {
  const parts = header.split(",").map((p) => {
    const i = p.indexOf("=");
    return i < 0 ? [p.trim(), ""] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  });
  const t = parts.find(([k]) => k === "t")?.[1];
  const v1 = parts.filter(([k]) => k === "v1").map(([, v]) => v).filter(Boolean);
  return t && v1.length ? { t, v1 } : null;
}

function keys(secret: string): Buffer[] {
  const out = [Buffer.from(secret)];
  if (secret.startsWith("whsec_")) {
    const bare = secret.slice(6);
    out.push(Buffer.from(bare));
    const decoded = Buffer.from(bare, "base64");
    if (decoded.length) out.push(decoded);
  }
  return out;
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function verifyPalmSignature(raw: string, header: string | undefined, secret: string, nowMs = Date.now()): boolean {
  if (!header || !secret) return false;
  const parsed = parseHeader(header);
  if (!parsed) return false;
  const t = Number(parsed.t);
  if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > TOLERANCE_SECONDS) return false;
  for (const key of keys(secret)) {
    const mac = createHmac("sha256", key).update(`${parsed.t}.${raw}`).digest();
    const candidates = [mac.toString("hex"), mac.toString("base64")];
    if (parsed.v1.some((sig) => candidates.some((c) => same(c, sig)))) return true;
  }
  return false;
}

export type PalmEvent = {
  id: string;
  type: string;
  mode: "test" | "live";
  created_at?: string;
  data?: { object?: Record<string, unknown> };
};

export type PalmEventRow = {
  id: string;
  type: string;
  mode: "test" | "live";
  business_id: string | null;
  document_id: string | null;
  document_type: string | null;
  filename: string | null;
  status: string | null;
  rejection_reason: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
};

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** The kinds of mail that need a person: legal papers first, then state notices. */
export function documentKind(o: Record<string, unknown>): string | null {
  const types = Array.isArray(o.types) ? (o.types as unknown[]).filter((t): t is string => typeof t === "string") : [];
  return types.find((t) => t === "service_of_process") ?? types[0] ?? str(o.type);
}

export function toEventRow(e: PalmEvent): PalmEventRow {
  const o = (e.data?.object ?? {}) as Record<string, unknown>;
  const isDoc = e.type.startsWith("document.");
  const isCase = e.type.startsWith("case.");
  return {
    id: e.id,
    type: e.type,
    mode: e.mode === "test" ? "test" : "live",
    business_id: isDoc
      ? str(o.resource_type) === "business" ? str(o.resource_id) : null
      : isCase
        ? str(o.parent_type) === "business" ? str(o.parent_id) : null
        : str(o.business_id),
    document_id: isDoc ? str(o.id) : null,
    document_type: isDoc ? documentKind(o) : null,
    filename: isDoc ? str(o.filename) : null,
    status: isDoc ? null : str(o.status),
    rejection_reason: str(o.rejection_reason),
    payload: e as unknown as Record<string, unknown>,
    occurred_at: str(e.created_at) ?? new Date().toISOString(),
  };
}
