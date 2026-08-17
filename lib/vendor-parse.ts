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

const KNOWN: Array<[RegExp, string]> = [
  [/truist mortg/i, "Truist Mortgage"],
  [/vanguard/i, "Vanguard"],
  [/capital one/i, "Capital One"],
  [/intuit|qbooks|quickbooks/i, "Intuit QuickBooks"],
  [/prog preferred ins|progressive/i, "Progressive Insurance"],
  [/children interna/i, "Children International"],
  [/bmobnk|bmo bank|bmo harris/i, "BMO Bank"],
  [/az dept of rev/i, "AZ Dept of Revenue"],
  [/evolve bank/i, "Evolve Bank"],
  [/distributing to trust/i, "Trust Distribution"],
  [/online transfer (to|from)/i, "Internal Transfer"],
  [/choice financial|partnering with choice/i, "Internal Transfer"],
  [/incoming wire|^wt fed#|^wt seq#/i, "Wire Transfer"],
  [/citi card|citi autopay/i, "Citi Card"],
  [/wf credit card/i, "Wells Fargo Card"],
  [/internal revenue|\birs\b/i, "IRS"],
  [/\baetna\b/i, "Aetna"],
  [/\bkfhp\b|kaiser/i, "Kaiser Permanente"],
  [/tep corporate|tucson electric/i, "Tucson Electric Power"],
  [/social security|ssa treas/i, "Social Security Administration"],
  [/mobile deposit/i, "Mobile Deposit"],
  [/atm withdrawal|withdrawal authorized/i, "ATM Withdrawal"],
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
 * The best vendor we can derive for a transaction. Curated patterns win;
 * a real Plaid merchant is kept; a family-surname merchant is replaced by
 * whatever the descriptor reveals.
 */
export function betterVendor(description: string | null, plaidMerchant: string | null): string | null {
  const desc = (description ?? "").trim();
  for (const [re, vendor] of KNOWN) if (re.test(desc)) return vendor;
  const merchant = (plaidMerchant ?? "").trim();
  if (merchant && !FAMILY_NAME.test(merchant)) return merchant;
  return genericParse(desc) ?? (merchant || null);
}
