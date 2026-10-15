import { sb, type AppUser } from "./auth.js";

/**
 * Each BFO user's address on the family domain: robert@burtonfamilyoffice.com.
 * Assigned when an admin adds or approves them, editable by an admin. Stored
 * lowercase in app_users.mail_address (unique).
 */

export const MAIL_DOMAIN = (process.env.MAIL_DOMAIN?.trim().toLowerCase() || "burtonfamilyoffice.com").replace(/^@/, "");

/**
 * Local parts no person gets: role addresses, and the system sender
 * (reports@) whose replies belong in the shared "Other" folder.
 */
const RESERVED = new Set([
  "abuse", "accounting", "admin", "administrator", "billing", "bounce", "bounces", "careers",
  "contact", "dmarc", "finance", "hello", "help", "hostmaster", "hr", "info", "invoices", "it",
  "jobs", "legal", "mail", "mailer-daemon", "marketing", "no-reply", "noreply", "office", "ops",
  "payroll", "postmaster", "press", "privacy", "reports", "root", "sales", "security", "support",
  "team", "webmaster",
]);

const LOCAL_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

/** The address for a local part on our domain. */
export function addressFor(local: string): string {
  return `${local}@${MAIL_DOMAIN}`;
}

/** True when the address is on the family domain. */
export function isOurAddress(address: string): boolean {
  return address.toLowerCase().endsWith(`@${MAIL_DOMAIN}`);
}

/** True for the family domain or any subdomain of it (for spotting forged senders). */
export function onOurDomain(address: string): boolean {
  const domain = address.toLowerCase().split("@").pop() ?? "";
  return domain === MAIL_DOMAIN || domain.endsWith(`.${MAIL_DOMAIN}`);
}

/**
 * Validate an address an admin typed: a bare local part ("robert") or a full
 * address on our domain. Returns the lowercase address, or an error message.
 */
export function parseMailAddress(input: unknown): { address: string } | { error: string } {
  if (typeof input !== "string") return { error: "Enter an address." };
  let value = input.trim().toLowerCase();
  if (!value) return { error: "Enter an address." };
  if (value.includes("@")) {
    if (!isOurAddress(value)) return { error: `Use an address ending in @${MAIL_DOMAIN}.` };
    value = value.slice(0, -(MAIL_DOMAIN.length + 1));
  }
  if (!LOCAL_RE.test(value) || /\.\./.test(value)) {
    return { error: "Use letters, numbers, dots, dashes or underscores." };
  }
  if (RESERVED.has(value)) return { error: `${addressFor(value)} is reserved.` };
  return { address: addressFor(value) };
}

/** Candidate local parts for a person, best first: "robert", "robert.burton", "robert.burton2"… */
export function addressCandidates(name: string | null, id: string): string[] {
  const words = (name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const out: string[] = [];
  const push = (l: string) => {
    const local = l.slice(0, 64).replace(/^[._-]+|[._-]+$/g, "");
    if (local && LOCAL_RE.test(local) && !RESERVED.has(local) && !out.includes(local)) out.push(local);
  };
  if (words.length) {
    const first = words[0];
    const last = words.length > 1 ? words[words.length - 1] : "";
    push(first);
    if (last) push(`${first}.${last}`);
    if (last) push(`${first[0]}${last}`);
    for (let n = 2; n <= 9; n++) push(`${last ? `${first}.${last}` : first}${n}`);
  }
  push(`user-${id.replace(/-/g, "").slice(0, 6)}`);
  return out;
}

/**
 * The user's address, assigning one the first time. A clash with another
 * user (unique constraint) moves on to the next candidate.
 *
 * Only a name an admin typed (`trustName`) picks a readable address; a name
 * people chose for themselves could claim robert@ or accounting@, so they
 * get user-xxxxxx until an admin renames it.
 */
export async function ensureMailAddress(
  user: Pick<AppUser, "id" | "name" | "mail_address">,
  opts: { trustName?: boolean } = {}
): Promise<string> {
  if (user.mail_address) return user.mail_address;
  for (const local of addressCandidates(opts.trustName ? user.name : null, user.id)) {
    const address = addressFor(local);
    try {
      // Only fill an empty slot, so two requests racing for the same user agree.
      const rows = await sb<Array<{ mail_address: string | null }>>(
        `app_users?id=eq.${user.id}&mail_address=is.null`,
        { method: "PATCH", body: { mail_address: address }, prefer: "return=representation" }
      );
      if (rows?.length) {
        user.mail_address = address;
        return address;
      }
      // Someone else already set it: read what it is now.
      const now = await sb<Array<{ mail_address: string | null }>>(`app_users?id=eq.${user.id}&select=mail_address&limit=1`);
      if (now?.[0]?.mail_address) {
        user.mail_address = now[0].mail_address;
        return now[0].mail_address;
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("duplicate key")) continue;
      throw err;
    }
  }
  throw new Error("couldn't assign a mail address");
}
