/**
 * People: who has access to BFO and what each role reaches, in one place for
 * the People page (app/routes/users.tsx) and its endpoint (api/auth/users.ts).
 * Pure: role names and what each can see and change, which changes need the
 * name typed to confirm, how a change to someone's access reads in the audit
 * trail, and the export an access review downloads.
 *
 * HTTP surface: none.
 * Who may call it: anyone; nothing here is secret.
 * Env: none.
 */

export type Role = "owner" | "admin" | "member" | "viewer" | "email" | "partner";
export type Status = "incoming" | "approved" | "denied";

/** The roles in the order the page offers them, narrowest last. */
export const ROLE_ORDER: Role[] = ["owner", "admin", "member", "viewer", "email", "partner"];

/**
 * Each role's name and, in one line, what it reaches. "Principal" is the
 * app's top tier (stored as `owner`); it is not ownership of any entity.
 * "Outside partner" (stored as `partner`) is for the office's CPA, counsel
 * and other outsiders, who see only the entities shared with them.
 */
export const ROLES: Record<Role, { label: string; reach: string }> = {
  owner: { label: "Principal", reach: "Everything, including People, the office’s texts and the shared mail. Can make other principals." },
  admin: { label: "Admin", reach: "Everything, including People, the office’s texts and the shared mail. Can’t change a principal." },
  member: { label: "Member", reach: "Sees and changes the office’s records: entities, Books, Treasury and documents." },
  viewer: { label: "Viewer", reach: "Sees the office’s records and changes nothing." },
  email: { label: "Mail only", reach: "Only their own mailbox on the family domain." },
  partner: { label: "Outside partner", reach: "Only the entities you share with them, without staff notes, contracts or verification. No mail." },
};

export const roleLabel = (r: Role | string | null | undefined): string => (r && r in ROLES ? ROLES[r as Role].label : "No role");

/** The roles that get a mailbox on the family domain unless the admin says otherwise. A partner never gets one: mail to it would reach no one. */
export function mailboxByDefault(role: Role): boolean {
  return role === "owner" || role === "admin" || role === "member" || role === "email";
}
export function mailboxAllowed(role: Role): boolean {
  return role !== "partner";
}

/** Removing, or changing the role of, a principal or an admin needs their name typed (docs/DESIGN.md §11.2). */
export function needsTypedConfirm(from: Role, to?: Role): boolean {
  const high = (r: Role) => r === "owner" || r === "admin";
  return high(from) || (to !== undefined && high(to));
}

/** A full name: at least two words of letters (an initial counts), so records and signatures carry more than a first name. */
export function isFullName(raw: string | null | undefined): boolean {
  const words = (raw ?? "").trim().split(/\s+/).filter((w) => /\p{L}/u.test(w));
  return words.length >= 2;
}

/** The person's name for a sentence: their name, else their number, else their email. */
export function personLabel(u: { name?: string | null; phoneFormatted?: string | null; phone?: string | null; email?: string | null }): string {
  return u.name?.trim() || u.phoneFormatted || u.phone || u.email || "someone";
}

export type AccessChange = { action: string; summary: string; detail: Record<string, unknown> };

/**
 * How a change to someone's account reads in the audit trail: one entry per
 * kind of change, each a plain sentence with the before and after. `target`
 * is the record before the change; `patch` holds the columns being written.
 */
export function accessChanges(target: { name: string | null; role: Role; status: Status; mail_address?: string | null; phone?: string | null; email?: string | null }, patch: Record<string, unknown>): AccessChange[] {
  const who = target.name?.trim() || target.phone || target.email || "someone";
  const out: AccessChange[] = [];
  const nextRole = (patch.role as Role | undefined) ?? target.role;

  if (patch.status !== undefined && patch.status !== target.status) {
    const to = patch.status as Status;
    if (target.status === "incoming" && to === "approved") out.push({ action: "user.approve", summary: `Approved ${who} as ${roleLabel(nextRole)}`, detail: { from: target.status, to, role: nextRole } });
    else if (target.status === "incoming" && to === "denied") out.push({ action: "user.deny", summary: `Turned down ${who}’s request to join`, detail: { from: target.status, to } });
    else if (to === "denied") out.push({ action: "user.revoke", summary: `Turned off ${who}’s access`, detail: { from: target.status, to } });
    else if (to === "approved") out.push({ action: "user.restore", summary: `Turned ${who}’s access back on`, detail: { from: target.status, to } });
  }
  if (patch.role !== undefined && patch.role !== target.role && !(target.status === "incoming" && patch.status === "approved")) {
    out.push({ action: "user.role_change", summary: `Changed ${who} from ${roleLabel(target.role)} to ${roleLabel(patch.role as Role)}`, detail: { from: target.role, to: patch.role } });
  }
  if (patch.name !== undefined && (patch.name ?? null) !== (target.name ?? null)) {
    out.push({ action: "user.rename", summary: target.name ? `Renamed ${target.name} to ${patch.name ?? "no name"}` : `Named ${who} ${patch.name}`, detail: { from: target.name, to: patch.name } });
  }
  if (patch.mail_address !== undefined && (patch.mail_address ?? null) !== (target.mail_address ?? null)) {
    out.push({
      action: "user.mailbox_change",
      summary: patch.mail_address ? `Changed ${who}’s mailbox to ${patch.mail_address}` : `Took away ${who}’s mailbox`,
      detail: { from: target.mail_address ?? null, to: patch.mail_address ?? null },
    });
  }
  for (const key of ["phone", "email"] as const) {
    if (patch[key] !== undefined && (patch[key] ?? null) !== (target[key] ?? null)) {
      out.push({ action: "user.contact_change", summary: `Changed ${who}’s sign-in ${key === "phone" ? "number" : "email"}`, detail: { field: key, from: target[key] ?? null, to: patch[key] ?? null } });
    }
  }
  return out;
}

/** One person as the export lists them. */
export type ExportRow = {
  name: string | null;
  role: Role;
  status: string;
  phone: string | null;
  email: string | null;
  mailbox: string | null;
  grantedAt: string | null;
  grantedBy: string | null;
  verifiedAt: string | null;
  lastSignIn: string | null;
  lastActive: string | null;
  addedAt: string | null;
};

const csvCell = (v: string | null | undefined): string => {
  const s = v ?? "";
  // A cell that starts like a formula is read as text by spreadsheets.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** The access list as CSV, for a periodic access review. Dates stay as stored (ISO, UTC). */
export function peopleCsv(rows: ExportRow[]): string {
  const head = ["Name", "Role", "Status", "Signs in with", "Email", "Mailbox", "Access granted", "Granted by", "Number verified", "Last signed in", "Last active", "Added"];
  const lines = rows.map((r) => [r.name, roleLabel(r.role), r.status, r.phone, r.email, r.mailbox, r.grantedAt, r.grantedBy, r.verifiedAt, r.lastSignIn, r.lastActive, r.addedAt].map(csvCell).join(","));
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}
