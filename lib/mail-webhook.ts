import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Bird signs its webhooks the Standard Webhooks way
 * (https://www.standardwebhooks.com):
 *
 *   webhook-id         msg_…
 *   webhook-timestamp  unix seconds of this attempt
 *   webhook-signature  "v1,<base64>" — space-separated while a secret rotates
 *
 * The signature is base64(HMAC-SHA256(key, `${id}.${timestamp}.${raw body}`)),
 * where key is the secret minus its "whsec_" prefix, base64-decoded. Pure, so
 * it's tested on its own.
 */

export const TOLERANCE_SECONDS = 5 * 60;

export type WebhookHeaders = { id?: string; timestamp?: string; signature?: string };

function key(secret: string): Buffer {
  return Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** base64 HMAC for one delivery (no "v1," prefix). */
export function webhookSignature(secret: string, id: string, timestamp: string, raw: string): string {
  return createHmac("sha256", key(secret)).update(`${id}.${timestamp}.${raw}`).digest("base64");
}

/** True when the delivery is signed with `secret` and is no more than 5 minutes off. */
export function verifyWebhook(raw: string, headers: WebhookHeaders, secret: string, nowMs = Date.now()): boolean {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  if (!key(secret).length) return false;

  const expected = webhookSignature(secret, id, timestamp, raw);
  return signature
    .split(" ")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("v1,"))
    .some((s) => same(s.slice(3), expected));
}
