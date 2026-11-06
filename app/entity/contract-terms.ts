/**
 * An MSA's terms as words and numbers, and where a contract stands. Pure:
 * shared by the Contracts tab (agreements.tsx), the contract page and its
 * PDF (contract-pdf.tsx, msa-document.ts), and tested in
 * tests/contract-terms.test.ts.
 *
 * - The fee is money: `amount` (dollars) on the record, or a legacy `fee`
 *   string ("8000", "$500") read as a number. It prints "$8,000.00" and
 *   "per month", never "8000 per monthly".
 * - A contract's stage comes from what happened to it, not from a picker:
 *   signed (a completed signature request or a recorded signed copy), out
 *   for signature, a draft, terminated or archived. A legacy "active" with
 *   nothing signed reads "Active, not signed".
 * - Parties are described from the record: "Northwind Holdings, LLC, a
 *   Nevada limited liability company".
 */

import { date as formatDate, isoDate, money } from "../ui/format";

export type Frequency = "Monthly" | "Quarterly" | "Annually" | "One-time";
export const FREQUENCIES: Frequency[] = ["Monthly", "Quarterly", "Annually", "One-time"];

export const TERM_MONTHLY = "Month to month";
export const TERM_AUTO = "Annual, auto-renewing";
export const TERM_FIXED = "Annual, fixed term";
/** The term, and what Article III says about it. */
export const TERMS: { value: string; hint: string }[] = [
  { value: TERM_MONTHLY, hint: "Runs month to month; either party may end it on 30 days’ written notice." },
  { value: TERM_FIXED, hint: "Ends after one year; renewing it takes both parties in writing." },
  { value: TERM_AUTO, hint: "Renews each year unless either party gives notice 30 days before it renews." },
];

/** The contract fields this file reads; the stored record may carry more. */
export type ContractTerms = {
  counterparty: string;
  /** Legacy: the fee as typed ("8000", "$500"). New records keep it in step with `amount`. */
  fee?: string | number | null;
  /** The fee in dollars. */
  amount?: number | null;
  frequency?: string | null;
  effectiveDate?: string | null;
  term?: string | null;
  status?: "draft" | "active" | "terminated" | string | null;
  role?: "manager" | "managed" | string | null;
  /** The date the agreement was signed by both parties (YYYY-MM-DD), when recorded. */
  signedOn?: string | null;
  terminatedOn?: string | null;
  noticeGivenOn?: string | null;
  archivedAt?: number | null;
};

// ── Money ────────────────────────────────────────────────────────────────

/** The fee in dollars: `amount` when set, else the legacy string read as a number; null when there's none. */
export function feeAmount(c: Pick<ContractTerms, "amount" | "fee">): number | null {
  if (typeof c.amount === "number" && Number.isFinite(c.amount)) return c.amount;
  if (typeof c.fee === "number" && Number.isFinite(c.fee)) return c.fee;
  const raw = String(c.fee ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

/** A frequency as typed or stored, as one of the four ("monthly" → Monthly); null when it isn't one. */
export function frequencyOf(raw?: string | null): Frequency | null {
  const t = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (/^month/.test(t)) return "Monthly";
  if (/^quarter/.test(t)) return "Quarterly";
  if (/^(annual|year)/.test(t)) return "Annually";
  if (/^one/.test(t)) return "One-time";
  return null;
}

const PER: Record<Frequency, { per: string; short: string; perYear: number | null }> = {
  Monthly: { per: "per month", short: "a month", perYear: 12 },
  Quarterly: { per: "per quarter", short: "a quarter", perYear: 4 },
  Annually: { per: "per year", short: "a year", perYear: 1 },
  "One-time": { per: "", short: "one time", perYear: null },
};

/** "$8,000.00 a month", "$500.00 a quarter", "$2,500.00 one time"; "" when there's no fee on record. */
export function feeShort(c: Pick<ContractTerms, "amount" | "fee" | "frequency">): string {
  const n = feeAmount(c);
  if (n === null) return "";
  const f = frequencyOf(c.frequency);
  return f ? `${money(n)} ${PER[f].short}` : money(n);
}

/** What the contract brings in (or costs) in a year: the fee times its periods; null for a one-time fee or no fee. */
export function annualized(c: Pick<ContractTerms, "amount" | "fee" | "frequency">): number | null {
  const n = feeAmount(c);
  const f = frequencyOf(c.frequency);
  if (n === null || !f || PER[f].perYear === null) return null;
  return Math.round(n * PER[f].perYear! * 100) / 100;
}

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function under1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} hundred`);
  if (r) parts.push(r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? `-${ONES[r % 10]}` : ""}`);
  return parts.join(" ");
}

/** A whole number in words, as a contract writes it: 8000 → "eight thousand". */
export function numberWords(n: number): string {
  const whole = Math.floor(Math.abs(n));
  if (whole === 0) return "zero";
  const scales: [number, string][] = [
    [1e9, "billion"],
    [1e6, "million"],
    [1e3, "thousand"],
  ];
  let rest = whole;
  const parts: string[] = [];
  for (const [size, word] of scales) {
    const k = Math.floor(rest / size);
    if (k) {
      parts.push(`${under1000(k)} ${word}`);
      rest %= size;
    }
  }
  if (rest) parts.push(under1000(rest));
  return parts.join(" ");
}

/** "$8,000.00 (eight thousand dollars)"; cents are named when there are any. */
export function moneyInWords(n: number): string {
  const cents = Math.round((n - Math.floor(n)) * 100);
  const dollars = Math.floor(n);
  const words = `${numberWords(dollars)} dollar${dollars === 1 ? "" : "s"}${cents ? ` and ${numberWords(cents)} cent${cents === 1 ? "" : "s"}` : ""}`;
  return `${money(n)} (${words})`;
}

/**
 * The price term as the agreement states it: "a management fee of $8,000.00
 * (eight thousand dollars) per month", or "a one-time management fee of …".
 * Null when there's no fee on record (the agreement can't go out without one).
 */
export function feeClause(c: Pick<ContractTerms, "amount" | "fee" | "frequency">): string | null {
  const n = feeAmount(c);
  if (n === null) return null;
  const f = frequencyOf(c.frequency) ?? "Monthly";
  if (f === "One-time") return `a one-time management fee of ${moneyInWords(n)}`;
  return `a management fee of ${moneyInWords(n)} ${PER[f].per}`;
}

/** The billing period's name for invoicing ("each month"); a one-time fee is invoiced once. */
export function billingPeriod(freq?: string | null): string {
  const f = frequencyOf(freq) ?? "Monthly";
  return f === "Monthly" ? "each calendar month" : f === "Quarterly" ? "each calendar quarter" : f === "Annually" ? "each year of the term" : "once, on the Effective Date";
}

// ── Dates ────────────────────────────────────────────────────────────────

/** Today as YYYY-MM-DD in the viewer's zone (not UTC: an evening entry in Arizona stays today). */
export const todayLocal = (now: Date = new Date()): string => isoDate(now);

/** "July 1, 2026", for the document; "" when not a date. */
export const longDate = (iso?: string | null): string => (iso ? formatDate(iso, "long") : "");

function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * For an auto-renewing contract: when it next renews and the last day either
 * party can give notice not to renew (30 days before, per §3.1). Null for any
 * other term or without an effective date.
 */
export function renewal(c: Pick<ContractTerms, "term" | "effectiveDate">, today: string = todayLocal()): { renewsOn: string; noticeBy: string } | null {
  if (!/auto-renew/i.test(c.term ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(c.effectiveDate ?? "")) return null;
  let years = 1;
  let next = addMonths(c.effectiveDate!, 12);
  while (next <= today) next = addMonths(c.effectiveDate!, 12 * ++years);
  return { renewsOn: next, noticeBy: addDays(next, -30) };
}

/**
 * Fee periods that have started between the effective date and today: what
 * signing now would make due for time already passed. Null when the
 * effective date isn't past or the fee is one-time.
 */
export function periodsElapsed(
  c: Pick<ContractTerms, "effectiveDate" | "frequency" | "amount" | "fee">,
  today: string = todayLocal(),
): { periods: number; amount: number | null; unit: string } | null {
  const eff = c.effectiveDate ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eff) || eff >= today) return null;
  const f = frequencyOf(c.frequency) ?? "Monthly";
  if (f === "One-time") return null;
  const step = f === "Monthly" ? 1 : f === "Quarterly" ? 3 : 12;
  let periods = 0;
  while (addMonths(eff, step * periods) <= today) periods++;
  const n = feeAmount(c);
  const unit = f === "Monthly" ? "month" : f === "Quarterly" ? "quarter" : "year";
  return { periods, amount: n === null ? null : Math.round(n * periods * 100) / 100, unit };
}

// ── Where a contract stands ──────────────────────────────────────────────

export type Stage = "draft" | "out" | "signed" | "unsigned-active" | "terminated" | "archived";

/** The status word, and the tone of its dot. */
export const STAGE: Record<Stage, { label: string; tone: "neutral" | "info" | "positive" | "warning" | "negative" }> = {
  draft: { label: "Draft", tone: "neutral" },
  out: { label: "Out for signature", tone: "info" },
  signed: { label: "Active", tone: "neutral" },
  "unsigned-active": { label: "Active, not signed", tone: "warning" },
  terminated: { label: "Terminated", tone: "neutral" },
  archived: { label: "Archived", tone: "neutral" },
};

/** A signature request as far as a contract cares. */
export type RequestLike = { status: string; completed_at?: string | null } | null | undefined;

/** Where the contract stands, from what happened to it. */
export function stageOf(c: ContractTerms, request?: RequestLike): Stage {
  if (c.archivedAt) return "archived";
  if (c.status === "terminated" || c.terminatedOn) return "terminated";
  if (c.signedOn || request?.status === "completed") return "signed";
  if (request && (request.status === "sent" || request.status === "partial")) return "out";
  if (c.status === "active") return "unsigned-active";
  return "draft";
}

/** The date both parties signed: the recorded date, else the request's completion. */
export function signedDate(c: ContractTerms, request?: RequestLike): string | null {
  if (c.signedOn) return c.signedOn;
  if (request?.status === "completed" && request.completed_at) return isoDate(new Date(request.completed_at));
  return null;
}

/** Counted in the contracted fees: signed and not ended (a legacy "active" counts too, flagged as unsigned). */
export const countsAsContracted = (s: Stage) => s === "signed" || s === "unsigned-active";

/** The terms may be edited: nothing has gone out and nothing is signed. A signed agreement changes by amendment. */
export const termsEditable = (s: Stage) => s === "draft" || s === "unsigned-active";

/** A draft may be deleted; anything that went out or was signed is kept (archived). */
export const deletable = (s: Stage) => s === "draft";

/** A draft whose effective date has passed without a signature: fees may be accruing on nothing signed. */
export function pastDueUnsigned(c: ContractTerms, s: Stage, today: string = todayLocal()): boolean {
  return (s === "draft" || s === "unsigned-active") && !!c.effectiveDate && c.effectiveDate < today;
}

// ── Parties ──────────────────────────────────────────────────────────────

/** What an entity type is called in a contract. */
export function entityForm(type?: string | null): string {
  switch (type) {
    case "LLC":
      return "limited liability company";
    case "C-Corp":
    case "Corporation":
      return "corporation";
    case "LP":
      return "limited partnership";
    case "Trust":
      return "trust";
    default:
      return type ? type.toLowerCase() : "";
  }
}

/** The counterparty's legal forms, for the contract form's list. */
export const COUNTERPARTY_FORMS = [
  "limited liability company",
  "professional limited liability company",
  "corporation",
  "professional corporation",
  "limited partnership",
  "limited liability partnership",
  "general partnership",
  "trust",
  "individual",
] as const;

const an = (word: string) => (/^[aeio]/i.test(word) ? "an" : "a");

/** "Northwind Holdings, LLC, a Nevada limited liability company"; the name alone when the form isn't known. */
export function partyDescription(name: string, state?: string | null, form?: string | null): string {
  const f = (form ?? "").trim();
  if (!f) return name;
  if (f === "individual") return `${name}, an individual${state ? ` residing in ${state}` : ""}`;
  const what = [state?.trim(), f].filter(Boolean).join(" ");
  return `${name}, ${an(what)} ${what}`;
}

/** A name that reads like a law or other professional firm, whose referral payments are regulated. */
export function looksProfessional(name: string): boolean {
  return /\b(law|legal|attorneys?|counsel|llp|pllc|p\.?\s?c\.?|cpas?|accountants?|accountancy)\b/i.test(name);
}

/** The services a third party's MSA should have counsel look at: advice an outside client pays the family office for. */
export const ADVISORY_SERVICES = new Set(["Tax Coordination & Planning", "Strategic Planning & Advisory", "Fractional CFO", "Bank Account Management", "Financial Management & Oversight"]);

/** The family entity a counterparty is, by name (case, punctuation and "L.L.C." don't matter). */
export function familyEntityNamed(name: string, entities: { id: string; name?: string | null }[]): { id: string; name: string } | null {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/l\.\s*l\.\s*c\.?/g, "llc")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const want = norm(name);
  if (!want) return null;
  const hit = entities.find((e) => e.name && norm(e.name) === want);
  return hit ? { id: hit.id, name: hit.name! } : null;
}
