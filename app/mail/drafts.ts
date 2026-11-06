import { htmlToText } from "../mail-frame";
import type { MailAddress, MailAttachment, MailMessage } from "../mail-client";
import { isNoReply } from "../../lib/mail-safety";
import { fullAddress, quoteStamp, same, senderLabel } from "./helpers";

// ── Compose drafts ───────────────────────────────────────────────────────

export type Draft = {
  /** The composer's title: "New message", "Reply to Northwind", "Forward". */
  title: string;
  /** Which of my addresses it goes out from; asked for when unset and there are several. */
  from?: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  /** The person's own words (empty for a reply: they write above the quote). */
  text: string;
  /** The quoted original (a reply) or the forwarded message, sent under the person's words; shown collapsed. */
  quote: string;
  /** "Show quoted text" or "Show forwarded message". */
  quoteLabel?: string;
  replyToId?: string;
  forwardId?: string;
  /** Forward: the original's files, re-attached by the server. */
  carried: MailAttachment[];
  /** Forward: the original's files BFO doesn't have, which can't go with it. */
  missing: string[];
  /** Names for addresses the composer shows as chips ("Northwind" for no-reply@…). */
  names: Record<string, string>;
  /** Reply: the sender asked for replies to go elsewhere (Reply-To): where, and the address it replaced. */
  replyToNote?: { to: string; insteadOf: string };
  /** Reply: the original's sender couldn't be verified. */
  unverifiedOriginal?: boolean;
  /** Where the cursor starts. */
  focus: "to" | "body";
  /** The send's id, kept when a message is reopened so a retry is the same send (never two). */
  sendId?: string;
  /** Reopened after Undo or a failed send: the body and files as they were, and what went wrong. */
  restore?: { html: string; files: File[]; error?: string };
};

const prefixed = (prefix: "Re" | "Fwd", subject: string) => {
  const s = subject.trim();
  const has = prefix === "Re" ? /^re:/i.test(s) : /^(fwd?|fw):/i.test(s);
  return has ? s : `${prefix}: ${s}`;
};

function bodyText(m: MailMessage): string {
  return (m.text ?? (m.html ? htmlToText(m.html) : "")).replace(/\r\n/g, "\n").trimEnd();
}

/** The quote under a reply, with a header the recipient keeps for good: the year and the zone, and the sender as the reader names them. */
function quoted(m: MailMessage): string {
  const lines = bodyText(m)
    .split("\n")
    .map((l) => (l.startsWith(">") ? `>${l}` : `> ${l}`));
  return `On ${quoteStamp(m.occurredAt)}, ${fullAddress({ email: m.from.email, name: m.from.name?.trim() || senderLabel(m.from) })} wrote:\n${lines.join("\n")}`;
}

function uniqueEmails(list: MailAddress[], exclude: string[]): string[] {
  const out: string[] = [];
  for (const a of list) {
    if (!a.email || exclude.some((e) => same(e, a.email)) || out.some((e) => same(e, a.email))) continue;
    out.push(a.email);
  }
  return out;
}

const namesOf = (list: MailAddress[]) => Object.fromEntries(list.map((a) => [a.email.toLowerCase(), a.name?.trim() || senderLabel(a)]));

/**
 * `mine`: every address of mine, main first. The reply goes out from the one
 * the message reached me at, and to the Reply-To the sender gave, when it
 * gave one (a notice sent from a no-reply address usually does).
 */
export function replyDraft(m: MailMessage, mode: "reply" | "all", mine: string[]): Draft {
  const replyTo = m.direction === "in" ? (m.replyTo ?? []).filter((a) => !same(a.email, m.from.email)) : [];
  // Replying to your own sent mail goes back to the people it went to.
  const targets = m.direction === "out" ? m.to : replyTo.length ? replyTo : [m.from];
  const to = uniqueEmails(targets, m.direction === "out" ? mine : []);
  const cc = mode === "all" ? uniqueEmails([...(m.direction === "out" ? [] : m.to), ...m.cc], [...mine, ...to]) : [];
  const via = m.direction === "out" ? m.from.email : m.deliveredTo;
  const from = mine.find((a) => via && same(a, via));
  const who = m.direction === "out" ? (m.to[0] ? senderLabel(m.to[0]) : "") : senderLabel(m.from);
  return {
    title: who ? `${mode === "all" ? "Reply all" : "Reply"} to ${who}` : mode === "all" ? "Reply all" : "Reply",
    ...(from ? { from } : {}),
    to: to.join(", "),
    cc: cc.join(", "),
    bcc: "",
    subject: prefixed("Re", m.subject),
    text: "",
    quote: quoted(m),
    quoteLabel: "Show quoted text",
    replyToId: m.id,
    carried: [],
    missing: [],
    names: namesOf([m.from, ...m.to, ...m.cc, ...replyTo]),
    ...(replyTo.length ? { replyToNote: { to: replyTo.map((a) => a.email).join(", "), insteadOf: m.from.email } } : {}),
    ...(m.direction === "in" && (m.unverifiedSender || m.impersonation) ? { unverifiedOriginal: true } : {}),
    focus: "body",
  };
}

export function forwardDraft(m: MailMessage): Draft {
  const missing = m.attachments.filter((a) => !a.available).map((a) => a.filename);
  const head = [
    "---------- Forwarded message ----------",
    `From: ${fullAddress(m.from)}`,
    `Date: ${quoteStamp(m.occurredAt)}`,
    `Subject: ${m.subject}`,
    `To: ${m.to.map(fullAddress).join(", ")}`,
    ...(m.cc.length ? [`Cc: ${m.cc.map(fullAddress).join(", ")}`] : []),
    // A file BFO never kept can't go with the forward: the header says so, so the recipient isn't misled.
    ...(missing.length ? [`Not attached (not kept by BFO): ${missing.join(", ")}`] : []),
  ].join("\n");
  return {
    title: "Forward",
    to: "",
    cc: "",
    bcc: "",
    subject: prefixed("Fwd", m.subject),
    text: "",
    quote: `${head}\n\n${bodyText(m)}`,
    quoteLabel: "Show forwarded message",
    forwardId: m.id,
    carried: m.attachments.filter((a) => a.available),
    missing,
    names: {},
    focus: "to",
  };
}

/** A new message. `from`: the mailbox being looked at, so it goes out from there; unset (all mailboxes), Compose asks. */
export const blankDraft = (from?: string): Draft => ({
  title: "New message",
  ...(from ? { from } : {}),
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  text: "",
  quote: "",
  carried: [],
  missing: [],
  names: {},
  focus: "to",
});

/** No reply will be read at this address. */
export const noReply = (email: string) => isNoReply(email);
