import { haptic } from "../native";
import { format } from "../ui";
import type { MailAddress } from "../mail-client";
import { tidySnippet } from "../../lib/mail-snippet";

// ── Small helpers ────────────────────────────────────────────────────────

export const nameOf = (a: MailAddress) => a.name?.trim() || a.email;

/** Mailboxes where the part before @ is the person, not the company. */
const PERSONAL_MAIL = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|mac|aol|proton|protonmail|pm|fastmail|hey|comcast|att|verizon|sbcglobal)\.(com|net|me|ch|org)$/i;

/**
 * Who a message is from, as a person would say it: the display name, else the
 * person's handle for personal mailboxes, else the company from the domain
 * ("no-reply-3ksj…@mail.example.com" → "Example"). The full address is
 * always one tap away in the reader.
 */
export function senderLabel(a: MailAddress): string {
  const name = a.name?.trim();
  if (name) return name;
  const [local = "", domain = ""] = a.email.toLowerCase().split("@");
  if (!domain) return a.email;
  if (PERSONAL_MAIL.test(domain)) return local.split("+")[0] || a.email;
  const parts = domain.split(".").filter(Boolean);
  // Drop the TLD (and a country second level like .co.uk), then any mail/email/mg subdomain.
  let labels = parts.slice(0, parts.length > 2 && parts[parts.length - 2].length <= 3 ? -2 : -1);
  labels = labels.filter((l) => !/^(mail|email|e|mg|smtp|mailer|send|notify|notifications?|news|info|m|em|bounce|bounces)\d*$/.test(l));
  const brand = labels[labels.length - 1] || parts[0];
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

/**
 * A recipient as a line names them: "me" for any of my addresses, a person's
 * name when the mail gave one, the local part for the office's own addresses
 * ("office@"), else the sender-style label.
 */
export function recipientLabel(a: MailAddress, mine: string[]): string {
  if (mine.some((m) => same(m, a.email))) return "me";
  if (a.name?.trim()) return a.name.trim();
  const officeDomain = (mine[0] ?? "").split("@")[1]?.toLowerCase();
  const [local, domain] = a.email.toLowerCase().split("@");
  if (officeDomain && domain === officeDomain) return `${local}@`;
  return senderLabel(a);
}

export const fullAddress = (a: MailAddress) => (a.name?.trim() ? `${a.name.trim()} <${a.email}>` : a.email);
export const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
export const domainOf = (email: string) => (email.split("@")[1] ?? "").toLowerCase();

/** A stored preview, tidied the way the server now writes them (entities, Markdown, padding, help-desk wrapping). */
export const cleanSnippet = (snippet: string) => tidySnippet(snippet);

/** "Today", "Yesterday", a weekday within the week, else the date: the phone list's day groups. */
export function dayGroup(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** A row's date (§10.5 short): the time today, "Nov 5" this year, "Nov 5, 2025" before. */
export function listDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (d.toDateString() === now.toDateString()) return format.time(d);
  return format.date(d, "short", { now });
}

const stampFormat = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", o);

/**
 * The full record of when (§10.5 audit): "Fri, Nov 6, 2026, 5:21 AM MST",
 * always with the year and the zone. For the reader's details and every
 * hover title on a date.
 */
export function fullStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return stampFormat({ weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })
    .format(d)
    .replace(/[\u202f\u00a0]/g, " ");
}

/**
 * The date in a reply's or forward's header, which the recipient keeps for
 * good: "Fri, Nov 6, 2026 at 5:21 AM MST".
 */
export function quoteStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = stampFormat({ weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(d);
  const at = stampFormat({ hour: "numeric", minute: "2-digit", timeZoneName: "short" })
    .format(d)
    .replace(/[\u202f\u00a0]/g, " ");
  return `${day} at ${at}`;
}

/** A file size: "820 KB", "1.4 MB". */
export function bytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** A light tap: native haptics in the iPhone app (app/native.ts). */
export function tap() {
  haptic();
}
