/**
 * What Palm bills per API call (its price sheet), and which call is which
 * product. Everything else we call (businesses, filings, the registered agent
 * service, documents, cases) isn't billed per call: filings carry the state's
 * own fee, shown before submitting.
 *
 * Pure: used by the server to log each billed call (palm_usage) and by pages
 * to show the price before a click.
 */

export type PalmProduct = "search" | "detail" | "name_eligibility" | "monitor" | "verify_business" | "verify_person" | "verify_tin";

export const PALM_PRICES: Record<PalmProduct, { label: string; what: string; cents: number; per: "call" | "month per entity" }> = {
  search: { label: "Search", what: "Search across 125M registry records", cents: 75, per: "call" },
  detail: { label: "Detail", what: "Everything the state has on one business", cents: 129, per: "call" },
  name_eligibility: { label: "Name eligibility", what: "Real-time registry name check", cents: 75, per: "call" },
  monitor: { label: "Monitor", what: "What changed on a business and what's next", cents: 199, per: "month per entity" },
  verify_business: { label: "Verify a business", what: "Real, registered and in good standing", cents: 299, per: "call" },
  verify_person: { label: "Verify a person", what: "Identity (KYC) check", cents: 199, per: "call" },
  verify_tin: { label: "Verify a TIN", what: "An EIN checked against IRS records", cents: 99, per: "call" },
};

/** Reading one state's record: a name search, then the record itself. Less with a file number on file (detail only). */
export const STATE_RECORD_CENTS = PALM_PRICES.search.cents + PALM_PRICES.detail.cents;

/** The billed product a Palm API call is, or null when it isn't billed per call. */
export function palmProduct(method: string, path: string): PalmProduct | null {
  const p = path.split("?")[0];
  const m = method.toUpperCase();
  if (m === "POST" && p === "/v1/business/registry/search") return "search";
  if (m === "GET" && /^\/v1\/business\/registry\/[^/]+\/name-eligibility$/.test(p)) return "name_eligibility";
  if (m === "GET" && /^\/v1\/business\/registry\/[^/]+\/[^/]+$/.test(p)) return "detail";
  if (/^\/v1\/(verify|verification)\/(business|entity)/.test(p)) return "verify_business";
  if (/^\/v1\/(verify|verification)\/(person|identity|kyc)/.test(p)) return "verify_person";
  if (/^\/v1\/(verify|verification)\/(tin|ein)/.test(p)) return "verify_tin";
  if (m === "POST" && /^\/v1\/(business\/[^/]+\/)?monitor/.test(p)) return "monitor";
  return null;
}

/** 204 → "$2.04"; 0 → "$0.00". */
export function dollars(cents: number): string {
  return `$${(Math.round(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Reading one state's record: just the detail when its file number is on record. */
export function stateRecordCents(hasFileNumber: boolean): number {
  return hasFileNumber ? PALM_PRICES.detail.cents : STATE_RECORD_CENTS;
}

/** " · $2.04" for a button label when Palm is live (billed); "" in test mode (free). */
export function priceSuffix(mode: string | null | undefined, cents: number): string {
  return mode === "live" ? ` · ${dollars(cents)}` : "";
}
