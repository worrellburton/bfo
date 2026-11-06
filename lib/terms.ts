/**
 * The facts the Terms of use, the Privacy notice, sign-in and the server
 * share: who operates BFO, how to reach the office about privacy, the
 * current versions of each text, and how long sign-in records are kept.
 * Pure constants and two small checks, so the browser (app/routes/legal-*,
 * login, complete-profile) and the server (api/auth/*) read one copy.
 *
 * HTTP surface: none.
 * Who may call it: anyone; nothing here is secret.
 * Env: none.
 *
 * Changing the Terms: write the new text, set TERMS_VERSION and
 * TERMS_EFFECTIVE to the effective date, and everyone is asked to agree
 * again at their next sign-in (needsTerms). Counsel reviews every change.
 */

/** The company that runs BFO and is the other party to the Terms. */
export const OPERATOR = {
  legalName: "Ledger Louise, LLC",
  state: "Nevada",
  dba: "Burton Family Office",
  short: "BFO",
} as const;

/** "Ledger Louise, LLC d/b/a Burton Family Office": the one way the operator is named on public screens. */
export const OPERATOR_LINE = `${OPERATOR.legalName} d/b/a ${OPERATOR.dba}`;

/** Where privacy requests, legal notices and reports of unauthorized access go (a role address; it lands in the office's shared mail). */
export const PRIVACY_EMAIL = "privacy@burtonfamilyoffice.com";

/** The Terms of use in force: what sign-in records a person as having agreed to. */
export const TERMS_VERSION = "2026-11-06";
/** The day the current Terms and Privacy notice took effect (a calendar date). */
export const TERMS_EFFECTIVE = "2026-11-06";
/** The Privacy notice's version, shown on the page. */
export const PRIVACY_VERSION = "2026-11-06";

/** The disclosure shown under the phone field when a code is requested; stored with each code. */
export const SMS_CONSENT_VERSION = "sms-2026-11-06";

/** How long sign-in records are kept (stated in the Privacy notice, enforced in lib/sign-in.ts). */
export const RETENTION = {
  /** Sign-in codes, with the network address each came from. */
  loginCodesDays: 90,
  /** A request to join (a verified number no one has approved yet). */
  waitingRequestDays: 30,
} as const;

/**
 * Whether this person still has to agree to the current Terms. A user record
 * without the field at all comes from a server that doesn't track agreement
 * yet: nothing is asked, rather than asking on every sign-in.
 */
export function needsTerms(user: { termsVersion?: string | null } | null | undefined): boolean {
  if (!user || !("termsVersion" in user) || user.termsVersion === undefined) return false;
  return user.termsVersion !== TERMS_VERSION;
}
