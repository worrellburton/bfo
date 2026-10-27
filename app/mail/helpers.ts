import { haptic } from "../native";
import type { MailAddress } from "../mail-client";

// ── Small helpers ────────────────────────────────────────────────────────

export const nameOf = (a: MailAddress) => a.name?.trim() || a.email;

/** Mailboxes where the part before @ is the person, not the company. */
const PERSONAL_MAIL = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|mac|aol|proton|protonmail|pm|fastmail|hey|comcast|att|verizon|sbcglobal)\.(com|net|me|ch|org)$/i;

/**
 * Who a message is from, as a person would say it: the display name, else the
 * person's handle for personal mailboxes, else the company from the domain
 * ("no-reply-3ksj…@mail.anthropic.com" → "Anthropic"). The full address is
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

/** A steady hue per sender, so the same person always gets the same colour. */
export function hueOf(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** The company's domain for a logo ("mail.anthropic.com" → "anthropic.com"), or null for a person. */
export function brandDomain(a: MailAddress): string | null {
  const domain = a.email.toLowerCase().split("@")[1] ?? "";
  if (!domain || PERSONAL_MAIL.test(domain)) return null;
  const parts = domain.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  // Keep a country second level (co.uk); otherwise the last two labels.
  const keep = parts.length > 2 && parts[parts.length - 2].length <= 3 ? 3 : 2;
  return parts.slice(-keep).join(".");
}

export const fullAddress = (a: MailAddress) => (a.name?.trim() ? `${a.name.trim()} <${a.email}>` : a.email);
export const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Time today, "Oct 3" this year, else "3/4/25". */
/** A snippet stored before the server learned to leave out a help desk's wrapping: the same tidy, on the way in. */
export function cleanSnippet(snippet: string): string {
  let out = snippet;
  for (let i = 0; i < 4; i++) {
    const next = out.replace(/^\s*(#+-?\s*please type your reply above this line\s*-?#+|[-_=*]{4,}|\[[A-Z0-9]{3,}(?:-[A-Z0-9]{3,})+\])\s*/i, "");
    if (next === out) break;
    out = next;
  }
  return out.replace(/\s*(this (?:email|message) is a service from\b.*|delivered by zendesk.*|sent from my (?:iphone|ipad|android|galaxy|phone).*)$/i, "").trim();
}

/** "Today", "Yesterday", a weekday within the week, else the date: the phone list's separators. */
export function dayGroup(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function listDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
}

export function fullDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(thisYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

/** A tick of haptics on phones that have it (Android; iOS Safari ignores it). */
/** A light tap: native haptics in the iPhone app (app/native.ts). */
export function tap() {
  haptic();
}

