/**
 * Texts to BFO's Bird number: Bird's sms.received event turned into the row
 * kept in public.sms_messages, and the verification code pulled out of the
 * text. Pure, so it's tested on its own.
 *
 * Bird documents the event as { type, timestamp, data } with the sender, our
 * number and the text in data; field names have varied between its pages
 * (from/originator, to/recipient, text/body), so each is read by any of them.
 */

export type SmsRow = {
  id: string;
  from_number: string;
  to_number: string | null;
  body: string;
  code: string | null;
  received_at: string;
  payload: Record<string, unknown>;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

/** A phone number field that may be a string or { phone_number | identifierValue | number }. */
function phone(v: unknown): string | null {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return str(o.phone_number) ?? str(o.phoneNumber) ?? str(o.identifierValue) ?? str(o.number) ?? null;
  }
  return str(v);
}

/** The row for one sms.received delivery, or null when it isn't one. `deliveryId` is the webhook-id header. */
export function smsRow(event: unknown, deliveryId: string | undefined): SmsRow | null {
  const e = (event ?? {}) as { type?: string; timestamp?: string; data?: Record<string, unknown> };
  if (e.type !== "sms.received" || !e.data) return null;
  const d = e.data;
  const from = phone(d.from) ?? phone(d.originator) ?? phone(d.sender);
  const body = str(d.text) ?? str(d.body) ?? str((d.body as { text?: unknown } | undefined)?.text) ?? "";
  // Bird's own id for the text when it gives one; else the delivery's (retries reuse it).
  const id = str(d.sms_id) ?? str(d.id) ?? str(d.message_id) ?? deliveryId ?? null;
  if (!from || !id || !/^[\w.:-]{1,200}$/.test(id)) return null;
  const at = str(d.received_at) ?? str(d.created_at) ?? str(e.timestamp);
  return {
    id,
    from_number: from.slice(0, 40),
    to_number: (phone(d.to) ?? phone(d.recipient))?.slice(0, 40) ?? null,
    body: body.slice(0, 5000),
    code: extractCode(body),
    received_at: at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : new Date().toISOString(),
    payload: e as Record<string, unknown>,
  };
}

/**
 * The one-time code in a text, when there is one: before "is your … code",
 * after "code", "PIN" or "passcode"; Apple's "#123456" line; or a lone
 * 6-digit number. "123-456" comes back as "123456". Never a phone number or
 * a year.
 */
export function extractCode(text: string): string | null {
  const t = text.replace(/\s+/g, " ");
  const tidy = (c: string) => c.replace(/[\s-]/g, "");
  // "G-583021 is your Google verification code": the code first.
  const first = /(?<!\d)(\d{4,8}) is your\b[^.\d]{0,60}\b(?:code|pin|passcode|password|otp)\b/i.exec(t);
  if (first) return first[1];
  const named = /\b(?:code|pin|passcode|password|otp|verification)\b[^0-9]{0,24}(\d{3}[- ]\d{3}|\d{4,8})(?!\d)/i.exec(t);
  if (named) return tidy(named[1]);
  const hash = /#(\d{4,8})\b/.exec(t);
  if (hash) return hash[1];
  const split = /(?<![\d+])(\d{3}-\d{3})(?![\d-])/.exec(t);
  if (split) return tidy(split[1]);
  const six = t.match(/(?<![\d+()-])\d{6}(?![\d-])/g);
  if (six?.length === 1) return six[0];
  return null;
}

/** "+18445192725" → "(844) 519-2725"; a short code → "Short code 12345"; anything else as it came. */
export function formatPhone(n: string | null | undefined): string {
  const s = (n ?? "").trim();
  const digits = s.replace(/\D/g, "");
  if (/^\d{4,6}$/.test(s)) return `Short code ${s}`;
  const us = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits.length === 10 ? digits : null;
  if (us && (s.startsWith("+1") || digits.length === 10)) return `(${us.slice(0, 3)}) ${us.slice(3, 6)}-${us.slice(6)}`;
  return s;
}
