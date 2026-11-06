/**
 * Checks that keep mail from being used against the family: a message that
 * asks for money to be sent somewhere (business email compromise), a sender
 * whose display name copies someone in the office from an outside address,
 * a no-reply address, and an AI layout pass that changed a figure. Pure, so
 * the server (lib/mail.ts, api/mail.ts) and the browser (app/mail) share
 * them, and they're tested without a network.
 *
 * HTTP surface: none. Who may call it: anyone; it touches no data.
 * Env: none.
 */

/**
 * Words that mark payment or banking instructions. A message that names
 * these (in its subject, words or attachment names) gets the reader's
 * "confirm by phone" warning: a changed wire or account detail is the most
 * common fraud against a family office.
 */
const PAYMENT_RE = new RegExp(
  [
    String.raw`\bwire\s+(?:transfer|instructions?|details|info(?:rmation)?|the\s+funds|payment)\b`,
    String.raw`\b(?:wiring|remittance)\s+(?:instructions?|details|info(?:rmation)?)\b`,
    String.raw`\bACH\b`,
    String.raw`\brouting\s+(?:number|no\.?|#)`,
    String.raw`\b(?:aba|swift|bic|iban)\b`,
    String.raw`\baccount\s+(?:number|no\.?|#)`,
    String.raw`\b(?:new|updated|changed?|revised)\s+(?:bank(?:ing)?|payment|remittance|wire)\s+(?:details|instructions?|info(?:rmation)?|account)\b`,
    String.raw`\bbank(?:ing)?\s+(?:details|instructions?|information)\s+(?:have|has)\s+changed\b`,
    String.raw`\bremit\s+(?:payment\s+)?to\b`,
  ].join("|"),
  "i",
);

/** True when the message reads like payment or banking instructions. */
export function paymentRisk(parts: { subject?: string | null; text?: string | null; attachmentNames?: string[] }): boolean {
  const names = (parts.attachmentNames ?? []).join(" ").replace(/[_.-]+/g, " ");
  const haystack = `${parts.subject ?? ""}\n${(parts.text ?? "").slice(0, 20_000)}\n${names}`;
  return PAYMENT_RE.test(haystack);
}

const normName = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/["'’.,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * A display name that copies someone in the office ("Jane Doe <jane.doe@
 * gmail.com>" when Jane works here) from outside the office's own domain.
 * Single-word names are too common to flag on their own.
 */
export function impersonates(from: { name?: string | null; email: string }, officeNames: (string | null | undefined)[], ourDomain: string): boolean {
  const domain = from.email.toLowerCase().split("@")[1] ?? "";
  const ours = ourDomain.toLowerCase();
  if (!domain || domain === ours || domain.endsWith(`.${ours}`)) return false;
  const shown = normName(from.name ?? "");
  if (!shown || !shown.includes(" ")) return false;
  return officeNames.some((n) => {
    const office = normName(n ?? "");
    return office.includes(" ") && office === shown;
  });
}

/** no-reply@, do-not-reply@, noreply-…@, mailer-daemon@: addresses that accept nothing. */
export function isNoReply(email: string): boolean {
  const local = (email.split("@")[0] ?? "").toLowerCase();
  return /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|noreply|mailer[-_.]?daemon|bounces?)([-_.+].*)?$/.test(local);
}

/**
 * Every figure in a piece of text, normalised so layout can't hide a change:
 * amounts, account and invoice numbers, dates and times, percentages. "$1,250"
 * and "1250" are the same figure; "Nov 6" keeps its 6. Sorted, so order
 * doesn't matter (a list may be reflowed), but each figure counts.
 */
export function figuresOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    let v = m[0].replace(/,(?=\d{3}\b)/g, "");
    // A trailing separator belongs to the sentence ("on the 6th, then").
    v = v.replace(/[,.]+$/, "");
    if (v.includes(".")) v = v.replace(/\.?0+$/, "") || "0";
    v = v.replace(/^0+(?=\d)/, "");
    out.push(v);
  }
  return out.sort();
}

/** The figures that differ between two versions of a text (those added or lost), empty when they match. */
export function figuresChanged(before: string, after: string): string[] {
  const a = figuresOf(before);
  const b = figuresOf(after);
  const left = new Map<string, number>();
  for (const v of a) left.set(v, (left.get(v) ?? 0) + 1);
  const diff: string[] = [];
  for (const v of b) {
    const n = left.get(v) ?? 0;
    if (n > 0) left.set(v, n - 1);
    else diff.push(v);
  }
  for (const [v, n] of left) for (let i = 0; i < n; i++) diff.push(v);
  return diff;
}

/**
 * A reply's own words and the quoted thread under them, as HTML: the quote
 * is the first top-level <blockquote> and everything after it. Only the own
 * part is sent to the layout service; the quote goes back under it as it was.
 */
export function splitQuoted(html: string): { own: string; quote: string } {
  const at = html.search(/<blockquote\b/i);
  if (at < 0) return { own: html, quote: "" };
  // A forward's or reply's header line ("On … wrote:") sits just above the quote: keep it with the quote.
  const head = html.slice(0, at);
  const lastPara = head.search(/<p\b[^>]*>(?:(?!<p\b)[\s\S])*?\b(?:wrote|Forwarded message)\b(?:(?!<p\b)[\s\S])*$/i);
  const cut = lastPara >= 0 ? lastPara : at;
  return { own: html.slice(0, cut), quote: html.slice(cut) };
}

/** Words in a message that say a file goes with it. */
const MENTIONS_ATTACHMENT = /\b(attach(?:ed|ing|ment|ments)?|enclos(?:ed|ing|ure|ures)|see the (?:file|document)s? (?:below|here))\b/i;

/** The message says something is attached (subject or the person's own words, not a quote). */
export function mentionsAttachment(subject: string, ownText: string): boolean {
  return MENTIONS_ATTACHMENT.test(subject) || MENTIONS_ATTACHMENT.test(ownText);
}
