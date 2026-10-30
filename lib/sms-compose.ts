/**
 * Writing a text from BFO's number: the number as typed made into E.164, the
 * numbers that can't be texted back (short codes, named senders), and how
 * many SMS segments a text costs, for the composer's counter. Pure string
 * work, so the Phone page (app/routes/phone.tsx) and the send itself
 * (lib/sms-send.ts) use the same rules.
 */

export type Normalized = { ok: true; e164: string } | { ok: false; why: string };

/** Digits that compare across forms: "+1 (844) 519-2725", "8445192725" and "18445192725" are one number. */
export const numberKey = (n: string) => {
  const d = n.replace(/\D/g, "");
  return /^\d{3,6}$/.test(n.trim()) ? n.trim() : d.replace(/^1(?=\d{10}$)/, "") || n.trim().toLowerCase();
};

/** A short code (3 to 6 digits, no +) or a named sender ("CHASE"): it sends, nobody can text it. */
export function canTextBack(n: string | null | undefined): boolean {
  const s = (n ?? "").trim();
  if (!s || /[a-z]/i.test(s)) return false;
  return !/^\d{3,6}$/.test(s);
}

/**
 * A US number typed any common way ("(480) 555-1234", "480.555.1234",
 * "1 480 555 1234", "+1-480-555-1234") as +14805551234; an international one
 * written with + (or 011) kept as E.164. Short codes, letters, and BFO's own
 * number are refused, each with a plain reason.
 */
export function toE164(raw: string, ours?: string | null): Normalized {
  const s = raw.trim().replace(/^tel:/i, "");
  if (!s) return { ok: false, why: "Enter a phone number." };
  if (/[a-z]/i.test(s)) return { ok: false, why: "A text can only go to a phone number, not a name." };
  if (/[^\d\s()+.\-/]/.test(s) || s.indexOf("+") > 0) return { ok: false, why: "That isn't a phone number." };
  const digits = s.replace(/\D/g, "");
  let e164: string;
  if (s.startsWith("+") || digits.startsWith("011")) {
    e164 = `+${s.startsWith("+") ? digits : digits.slice(3)}`;
  } else if (/^\d{3,6}$/.test(s)) {
    return { ok: false, why: "That's a short code. Short codes send texts but can't receive them." };
  } else if (digits.length === 10) {
    e164 = `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    e164 = `+${digits}`;
  } else {
    return { ok: false, why: "That isn't a complete US number: it needs an area code and 7 digits." };
  }
  if (e164.startsWith("+1")) {
    // North American numbers: area code and exchange never start with 0 or 1.
    if (!/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(e164)) return { ok: false, why: "That isn't a complete US number: it needs an area code and 7 digits." };
  } else if (!/^\+[2-9]\d{6,14}$/.test(e164)) {
    return { ok: false, why: "That isn't a complete international number." };
  }
  if (ours && numberKey(ours) === numberKey(e164)) return { ok: false, why: "That's BFO's own number." };
  return { ok: true, e164 };
}

// GSM 03.38: the basic table costs one septet a character; the extension table two.
const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
);
const GSM_EXTENDED = new Set("^{}\\[]~|€\f");

export type Segments = {
  encoding: "GSM_7BIT" | "UCS2";
  /** How many SMS the text goes out as (each one billed). */
  segments: number;
  /** Units used: septets under GSM-7, UTF-16 code units under UCS-2. */
  units: number;
  /** Units still free in the last segment. */
  remaining: number;
};

/**
 * How Bird will split a text: GSM-7 fits 160 septets in one SMS or 153 a
 * part when split (^ { } \ [ ] ~ | € cost two); anything outside GSM-7 (an
 * emoji, a curly quote) makes the whole text UCS-2, 70 code units or 67 a part.
 * A two-unit character never straddles parts.
 */
export function smsSegments(text: string): Segments {
  const chars = [...text];
  const gsm = chars.every((c) => GSM_BASIC.has(c) || GSM_EXTENDED.has(c));
  const cost = (c: string) => (gsm ? (GSM_EXTENDED.has(c) ? 2 : 1) : c.length);
  const [single, part] = gsm ? [160, 153] : [70, 67];
  const units = chars.reduce((n, c) => n + cost(c), 0);
  if (units <= single) return { encoding: gsm ? "GSM_7BIT" : "UCS2", segments: 1, units, remaining: single - units };
  let segments = 1;
  let used = 0;
  for (const c of chars) {
    if (used + cost(c) > part) {
      segments++;
      used = 0;
    }
    used += cost(c);
  }
  return { encoding: gsm ? "GSM_7BIT" : "UCS2", segments, units, remaining: part - used };
}

/** Bird refuses a text over this many segments. */
export const MAX_SEGMENTS = 12;
/** The longest text the Phone page sends, in characters. */
export const MAX_TEXT = 1600;
