/**
 * Palm's documents (mail and filings it holds for a business): what each kind
 * is called, which paperwork slot a kind fills, and what a saved copy is named.
 * Pure, and shared by the entity page and the server's sync (lib/palm-sync.ts).
 */

/** Palm's document types → the paperwork slot each one fills. */
export const PALM_SLOT: Record<string, "articles" | "einLetter" | "operatingAgreement" | "goodStanding" | "foreignRegistration"> = {
  certificate_of_formation: "articles",
  articles_of_incorporation: "articles",
  ein_letter: "einLetter",
  ein_letter_alternate: "einLetter",
  operating_agreement: "operatingAgreement",
  certificate_of_good_standing: "goodStanding",
  certificate_of_authority: "foreignRegistration",
};

/** Forwarded mail and agent paperwork, most urgent first. */
export const DOC_LABEL: Record<string, string> = {
  service_of_process: "Legal papers served",
  notice: "Notice from the state",
  mail: "Mail",
  ra_change_confirmation: "Agent change confirmed",
  ra_resignation: "Agent resignation",
  receipt: "Receipt",
  filing_confirmation: "Filing confirmation",
  certificate_of_formation: "Certificate of formation",
  articles_of_incorporation: "Articles",
  ein_letter: "EIN letter",
  welcome_letter: "Welcome letter",
};

/** A document's kind: `types` is current, `type` is Palm's deprecated single value. */
export function docKindOf(d: { type?: string; types?: string[] }): string {
  return d.types?.find((t) => t === "service_of_process") ?? d.types?.[0] ?? d.type ?? "";
}

/** The name a saved copy gets: Palm's filename, else its kind and the day it arrived. */
export function palmDocName(d: { filename?: string; type?: string; types?: string[]; created_at?: string; upload_date?: string }): string {
  if (d.filename) return d.filename;
  const kind = docKindOf(d);
  const when = (d.created_at ?? d.upload_date ?? "").slice(0, 10);
  return `${DOC_LABEL[kind] ?? "Palm document"}${when ? ` ${when}` : ""}.pdf`;
}

/**
 * Where a Palm document is saved in the entity's Documents: keyed by Palm's id,
 * so the page and the server (and two tabs) saving it at once write one entry.
 */
export function palmDocKey(palmId: string): string {
  return `palm_${palmId.replace(/[^\w-]/g, "_")}`;
}
