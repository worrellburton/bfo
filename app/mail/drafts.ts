import { htmlToText } from "../mail-frame";
import type { MailAddress, MailAttachment, MailMessage } from "../mail-client";
import { fullAddress, fullDate, nameOf, same } from "./helpers";

// ── Compose drafts ───────────────────────────────────────────────────────

export type Draft = {
  title: string;
  /** Which of my addresses it goes out from; the main one when unset. */
  from?: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  text: string;
  replyToId?: string;
  forwardId?: string;
  /** Forward: the original's files, re-attached by the server. */
  carried: MailAttachment[];
  /** Where the cursor starts. */
  focus: "to" | "body";
};

const prefixed = (prefix: "Re" | "Fwd", subject: string) => {
  const s = subject.trim();
  const has = prefix === "Re" ? /^re:/i.test(s) : /^(fwd?|fw):/i.test(s);
  return has ? s : `${prefix}: ${s}`;
};

function bodyText(m: MailMessage): string {
  return (m.text ?? (m.html ? htmlToText(m.html) : "")).replace(/\r\n/g, "\n").trimEnd();
}

function quoted(m: MailMessage): string {
  const lines = bodyText(m)
    .split("\n")
    .map((l) => (l.startsWith(">") ? `>${l}` : `> ${l}`));
  return `\n\nOn ${fullDate(m.occurredAt)}, ${nameOf(m.from)} wrote:\n${lines.join("\n")}`;
}

function uniqueEmails(list: MailAddress[], exclude: string[]): string[] {
  const out: string[] = [];
  for (const a of list) {
    if (!a.email || exclude.some((e) => same(e, a.email)) || out.some((e) => same(e, a.email))) continue;
    out.push(a.email);
  }
  return out;
}

/** `mine`: every address of mine, main first. The reply goes out from the one the message reached me at. */
export function replyDraft(m: MailMessage, mode: "reply" | "all", mine: string[]): Draft {
  // Replying to your own sent mail goes back to the people it went to.
  const targets = m.direction === "out" ? m.to : [m.from];
  const to = uniqueEmails(targets, m.direction === "out" ? mine : []);
  const cc = mode === "all" ? uniqueEmails([...(m.direction === "out" ? [] : m.to), ...m.cc], [...mine, ...to]) : [];
  const via = m.direction === "out" ? m.from.email : m.deliveredTo;
  const from = mine.find((a) => via && same(a, via));
  return {
    title: mode === "all" ? "Reply all" : "Reply",
    ...(from ? { from } : {}),
    to: to.join(", "),
    cc: cc.join(", "),
    bcc: "",
    subject: prefixed("Re", m.subject),
    text: quoted(m),
    replyToId: m.id,
    carried: [],
    focus: "body",
  };
}

export function forwardDraft(m: MailMessage): Draft {
  const head = [
    "---------- Forwarded message ----------",
    `From: ${fullAddress(m.from)}`,
    `Date: ${fullDate(m.occurredAt)}`,
    `Subject: ${m.subject}`,
    `To: ${m.to.map(fullAddress).join(", ")}`,
    ...(m.cc.length ? [`Cc: ${m.cc.map(fullAddress).join(", ")}`] : []),
  ].join("\n");
  return {
    title: "Forward",
    to: "",
    cc: "",
    bcc: "",
    subject: prefixed("Fwd", m.subject),
    text: `\n\n${head}\n\n${bodyText(m)}`,
    forwardId: m.id,
    carried: m.attachments.filter((a) => a.available),
    focus: "to",
  };
}

/** A new message. `from`: the mailbox being looked at, so it goes out from there; unset (All mailboxes), Compose asks. */
export const blankDraft = (from?: string): Draft => ({ title: "New message", ...(from ? { from } : {}), to: "", cc: "", bcc: "", subject: "", text: "", carried: [], focus: "to" });

