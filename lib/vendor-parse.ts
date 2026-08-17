/**
 * Vendor extraction from raw bank descriptors.
 *
 * Plaid's merchant_name is often just a family surname ("Burton") because the
 * descriptor carries the account holder's name, which buries the real payee.
 * This module recognises the real counterparty:
 *
 *   1. KNOWN patterns — curated descriptor → clean vendor mappings.
 *   2. A generic ACH parse — leading alpha words before the id/date noise.
 *   3. Plaid's merchant_name, unless it's just a family name.
 */

// A null vendor means "this movement has no counterparty" — an internal
// transfer is not a vendor, so those rows deliberately stay vendor-less.
const KNOWN: Array<[RegExp, string | null]> = [
  [/truist mortg/i, "Truist Mortgage"],
  [/vanguard/i, "Vanguard"],
  [/capital one/i, "Capital One"],
  [/intuit|qbooks|quickbooks/i, "Intuit QuickBooks"],
  [/prog preferred ins|progressive/i, "Progressive Insurance"],
  [/children interna/i, "Children International"],
  [/bmobnk|bmo bank|bmo harris/i, "BMO Bank"],
  [/az dept of rev/i, "AZ Dept of Revenue"],
  [/evolve bank/i, "Evolve Bank"],
  [/distributing to trust/i, null],
  [/online transfer (to|from)/i, null],
  [/choice financial|partnering with choice/i, null],
  [/incoming wire|^wt fed#|^wt seq#/i, null],
  [/citi card|citi autopay/i, "Citi Card"],
  [/wf credit card/i, "Wells Fargo Card"],
  [/internal revenue|\birs\b/i, "IRS"],
  [/\baetna\b/i, "Aetna"],
  [/\bkfhp\b|kaiser/i, "Kaiser Permanente"],
  [/tep corporate|tucson electric/i, "Tucson Electric Power"],
  [/social security|ssa treas/i, "Social Security Administration"],
  [/mobile deposit/i, null],
  [/atm withdrawal|withdrawal authorized/i, null],
];

/** Just the family's names — a merchant label that adds no information. */
const FAMILY_NAME = /^\s*(robert\s+|claire\s+|amanda\s+|worrell\s+)?(l\s+|b\s+)?burton(\s*(jr|sr|ii|iii))?\s*$/i;

const STOPWORDS = new Set([
  "ach", "pmt", "payment", "paymt", "olb", "mtgpmt", "webxfr", "ck", "des",
  "ccd", "ppd", "web", "dir", "dbt", "prem", "ins", "epay", "billpay", "bill",
  "autopay", "auto", "pay", "online", "sched", "transfer", "to", "from", "of",
  "the", "business",
]);

const PREFIXES = [
  /^business to business ach\s+/i,
  /^online sched payment\s+/i,
  /^purchase authorized on \d{1,2}\/\d{1,2}\s+/i,
  /^recurring payment authorized on \d{1,2}\/\d{1,2}\s+/i,
];

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bLlc\b/g, "LLC")
    .replace(/\bPllc\b/g, "PLLC")
    .replace(/\bPc\b/g, "PC");
}

/** Generic parse: the leading alpha words of a descriptor, minus the noise. */
function genericParse(description: string): string | null {
  let s = description.trim();
  for (const p of PREFIXES) s = s.replace(p, "");
  const words: string[] = [];
  for (const raw of s.split(/\s+/)) {
    const w = raw.replace(/[^a-zA-Z&.'-]/g, "");
    // Stop at the id/date noise — any token that is mostly digits.
    if (w.length < raw.length - 1 || !w) break;
    words.push(w);
    if (words.length >= 4) break;
  }
  // Trim descriptor stopwords off the tail.
  while (words.length && STOPWORDS.has(words[words.length - 1].toLowerCase())) words.pop();
  const out = words.join(" ").trim();
  if (out.length < 4) return null;
  if (FAMILY_NAME.test(out)) return null;
  return titleCase(out);
}

/**
 * An explicit "Merchant name: X" embedded in the descriptor — the feed
 * telling us the counterparty outright. Family/trust names are ignored
 * (they're the account holder, not a vendor).
 */
function embeddedMerchant(desc: string): string | null {
  const m = /merchant name:\s*([^;]+)/i.exec(desc);
  if (!m) return null;
  const v = m[1].trim().replace(/\s+/g, " ");
  if (!v || FAMILY_NAME.test(v) || /burton family/i.test(v)) return null;
  // One of the family's own bank accounts is a transfer leg, not a vendor.
  if (/••|\bx{4,}\d|^(mercury|wells fargo)\b.*\b(checking|savings|credit)\b/i.test(v)) return null;
  // Preserve real casing; only tame ALL-CAPS feeds.
  return v === v.toUpperCase() ? titleCase(v) : v;
}

/**
 * The best vendor we can derive for a transaction. An explicit embedded
 * merchant wins; curated patterns next; a real Plaid merchant is kept; a
 * family-surname merchant is replaced by whatever the descriptor reveals.
 */
export function betterVendor(description: string | null, plaidMerchant: string | null): string | null {
  const desc = (description ?? "").trim();
  const embedded = embeddedMerchant(desc);
  if (embedded) return embedded;
  for (const [re, vendor] of KNOWN) if (re.test(desc)) return vendor;
  const merchant = (plaidMerchant ?? "").trim();
  if (merchant && !FAMILY_NAME.test(merchant)) return merchant;
  return genericParse(desc) ?? (merchant || null);
}
