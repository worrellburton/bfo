/**
 * People: who can sign in to BFO and what each person can do (the People
 * page, app/routes/users.tsx).
 *
 * HTTP:
 *   GET                       → { users, me, review }: everyone, removed people included (the page files them
 *                               under Removed), plus the last access review.
 *   GET ?history=<id>         → { entries }: that person's access history from the audit trail, newest first.
 *   POST { name, phone, email?, role, mailbox? } → { user }: adds someone, with access straight away.
 *   POST { review: true }     → { review }: records that the list was reviewed, by whom and when.
 *   PATCH { id, …fields }     → { user }: approve, turn down, turn off or back on, change role, name, mailbox.
 *   DELETE ?id=<id>           → { user }: removes someone. Nothing is erased: they lose access everywhere,
 *                               leave the list, and keep their history, mailbox address and records.
 * Who may call it: owners (shown as Principal) and admins; only an owner may
 * change an owner or make one. Nobody can change their own role or access.
 * Every change is written to the audit trail (lib/audit.ts) with the before
 * and after; lib/people.ts words it.
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY; MAIL_DOMAIN (through lib/mail-address.ts).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit } from "../../lib/audit.js";
import { currentUser, fail, guard, handleError, isAdmin, normalizeEmail, normalizePhone, publicUser, sb, type AppUser, type Role, type Status } from "../../lib/auth.js";
import { aliasOwner, ensureMailAddress, parseMailAddress } from "../../lib/mail-address.js";
import { accessChanges, isFullName, mailboxAllowed, mailboxByDefault, personLabel, roleLabel } from "../../lib/people.js";
import { isMissingColumn, writeWithOptional } from "../../lib/sign-in.js";

const ROLES: Role[] = ["owner", "admin", "member", "viewer", "email", "partner"];
const STATUSES: Status[] = ["incoming", "approved", "denied"];

/** Columns added by 20261107_people_access_and_consent.sql: written when the database has them, left out when it doesn't yet. */
const TRAIL_COLUMNS = ["added_by", "approved_by", "revoked_at", "revoked_by", "removed_at", "removed_by"] as const;

type Person = AppUser & {
  added_by?: string | null;
  approved_by?: string | null;
  revoked_at?: string | null;
  revoked_by?: string | null;
  removed_at?: string | null;
  removed_by?: string | null;
  terms_version?: string | null;
  terms_accepted_at?: string | null;
};

/** A person as the page reads them: publicUser plus who let them in, when they verified, and whether they were removed. */
export function personOut(u: Person) {
  return {
    ...publicUser(u),
    verifiedAt: u.verified_at ?? null,
    addedBy: u.added_by ?? null,
    approvedBy: u.approved_by ?? null,
    revokedAt: u.revoked_at ?? null,
    removedAt: u.removed_at ?? null,
    removedBy: u.removed_by ?? null,
    termsAcceptedAt: u.terms_accepted_at ?? null,
  };
}

/** Build the column patch shared by create and update, validating as it goes. */
function fields(body: Record<string, unknown>): { patch: Record<string, unknown> } | { error: string; message: string } {
  const patch: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 80);
    if (name && !isFullName(name)) return { error: "invalid_name", message: "Enter their full name, first and last." };
    patch.name = name || null;
  }

  if (body.phone !== undefined) {
    const raw = String(body.phone ?? "").trim();
    if (!raw) patch.phone = null;
    else {
      const phone = normalizePhone(raw);
      if (!phone) return { error: "invalid_phone", message: "Enter a valid phone number." };
      patch.phone = phone;
    }
  }

  if (body.email !== undefined) {
    const raw = String(body.email ?? "").trim();
    if (!raw) patch.email = null;
    else {
      const email = normalizeEmail(raw);
      if (!email) return { error: "invalid_email", message: "Enter a valid email address." };
      patch.email = email;
    }
  }

  // Their address on the family domain: a local part or a full address; empty clears it.
  if (body.mailAddress !== undefined) {
    if (body.mailAddress === null || String(body.mailAddress).trim() === "") patch.mail_address = null;
    else {
      const parsed = parseMailAddress(String(body.mailAddress));
      if ("error" in parsed) return { error: "invalid_mail_address", message: parsed.error };
      patch.mail_address = parsed.address;
    }
  }

  if (body.role !== undefined) {
    if (!ROLES.includes(body.role as Role)) return { error: "invalid_role", message: "Unknown role." };
    patch.role = body.role;
  }

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as Status)) {
      return { error: "invalid_status", message: "Unknown status." };
    }
    patch.status = body.status;
  }

  return { patch };
}

/** Which unique column a write ran into, if it was a duplicate. */
function duplicate(err: unknown): "mail_address" | "identity" | null {
  if (!(err instanceof Error) || !err.message.includes("duplicate key")) return null;
  return err.message.includes("mail_address") ? "mail_address" : "identity";
}

function failDuplicate(res: VercelResponse, err: unknown, patch: Record<string, unknown>) {
  const hit = duplicate(err);
  if (hit === "mail_address") return fail(res, 409, "address_taken", `${patch.mail_address} is taken.`);
  if (hit) return fail(res, 409, "already_exists", "That phone number or email is already on someone’s account.");
  throw err;
}

/** Write a patch to one person, leaving out the trail columns if the database doesn't have them yet. */
async function writePerson(id: string, patch: Record<string, unknown>): Promise<Person[]> {
  return writeWithOptional((body) => sb<Person[]>(`app_users?id=eq.${id}`, { method: "PATCH", prefer: "return=representation", body }), patch, TRAIL_COLUMNS);
}

/** The audit trail's rows about people, or nothing when the trail isn't there yet. */
async function trail<T>(path: string): Promise<T[]> {
  try {
    return (await sb<T[]>(path)) ?? [];
  } catch (err) {
    if (/PGRST205|42P01|does not exist|Could not find the table/i.test(err instanceof Error ? err.message : "") || isMissingColumn(err)) return [];
    throw err;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "POST", "PATCH", "DELETE"])) return;

  try {
    const me = await currentUser(req);
    if (!me) return fail(res, 401, "unauthorized");
    if (!isAdmin(me)) return fail(res, 403, "forbidden", "Only principals and admins can manage people.");

    if (req.method === "GET") {
      const historyFor = typeof req.query?.history === "string" ? req.query.history : "";
      if (historyFor) {
        if (!/^[0-9a-f-]{36}$/i.test(historyFor)) return fail(res, 400, "invalid_id");
        const entries = await trail<{ at: string; actor_name: string | null; action: string; summary: string }>(
          `audit_log?target_type=eq.user&target_id=eq.${historyFor}&select=at,actor_name,action,summary&order=at.desc&limit=50`,
        );
        return res.status(200).json({ entries });
      }
      // A family office's access list is small; ordered on a unique column all the same.
      const users = await sb<Person[]>("app_users?select=*&order=created_at.asc,id.asc&limit=1000");
      const [review] = await trail<{ at: string; actor_name: string | null }>("audit_log?action=eq.user.access_review&select=at,actor_name&order=at.desc&limit=1");
      return res.status(200).json({
        users: users.map(personOut),
        me: personOut(me),
        review: review ? { at: review.at, by: review.actor_name } : null,
      });
    }

    if (req.method === "POST") {
      const body = (req.body ?? {}) as Record<string, unknown>;

      if (body.review === true) {
        const at = new Date().toISOString();
        const written = await audit({ actor: me, action: "user.access_review", summary: `${personLabel(me)} reviewed who has access to BFO` });
        if (!written) return fail(res, 503, "not_recorded", "The review couldn’t be recorded. Try again later.");
        return res.status(200).json({ review: { at, by: me.name } });
      }

      const built = fields(body);
      if ("error" in built) return fail(res, 400, built.error, built.message);
      const patch = built.patch;
      if (!patch.name) return fail(res, 400, "name_required", "Enter their full name, first and last.");
      if (!patch.phone) return fail(res, 400, "phone_required", "Enter their mobile number. It’s how they sign in.");
      if (typeof patch.mail_address === "string" && (await aliasOwner(patch.mail_address))) {
        return fail(res, 409, "address_taken", `${patch.mail_address} is taken.`);
      }
      const role = (patch.role as Role | undefined) ?? "viewer";
      if (role === "owner" && me.role !== "owner") {
        return fail(res, 403, "forbidden", "Only a principal can add another principal.");
      }
      const now = new Date().toISOString();
      Object.assign(patch, { role, status: "approved", approved_at: now, added_by: me.id, approved_by: me.id });

      let user: Person;
      try {
        const created = await writeWithOptional((b) => sb<Person[]>("app_users", { method: "POST", prefer: "return=representation", body: [b] }), patch, TRAIL_COLUMNS);
        user = created[0];
      } catch (err) {
        return failDuplicate(res, err, patch);
      }
      // A mailbox on the family domain, from the name the admin typed, when the
      // role reads mail (or the admin asked for one). Never for an outside partner.
      const wantsMailbox = mailboxAllowed(role) && (typeof body.mailbox === "boolean" ? body.mailbox : mailboxByDefault(role));
      if (wantsMailbox && !user.mail_address) {
        const address = await ensureMailAddress(user, { trustName: true }).catch((err) => (console.error("users: no mail address yet", err), null));
        if (address) user = { ...user, mail_address: address };
      }
      await audit({
        actor: me,
        action: "user.add",
        target: { type: "user", id: user.id, label: user.name },
        summary: `Added ${personLabel(user)} as ${roleLabel(role)}`,
        detail: { role, mailbox: user.mail_address ?? null },
      });
      return res.status(201).json({ user: personOut(user) });
    }

    const id = String(req.method === "DELETE" ? (req.query?.id ?? "") : ((req.body as Record<string, unknown> | undefined)?.id ?? ""));
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(res, 400, "invalid_id");

    const targets = await sb<Person[]>(`app_users?id=eq.${id}&select=*&limit=1`);
    const target = targets?.[0];
    if (!target) return fail(res, 404, "not_found");
    if (target.role === "owner" && me.role !== "owner") {
      return fail(res, 403, "forbidden", "Only a principal can change another principal.");
    }
    const label = { type: "user", id: target.id, label: target.name };

    if (req.method === "DELETE") {
      if (target.id === me.id) return fail(res, 400, "cannot_remove_self", "You can’t remove yourself.");
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = { status: "denied", removed_at: now, removed_by: me.id };
      if (target.status === "approved") Object.assign(patch, { revoked_at: now, revoked_by: me.id });
      const [user] = await writePerson(target.id, patch);
      await sb(`app_sessions?user_id=eq.${target.id}`, { method: "DELETE" });
      await audit({
        actor: me,
        action: "user.remove",
        target: label,
        summary: `Removed ${personLabel(target)}`,
        detail: { role: target.role, from: target.status, mailbox: target.mail_address ?? null },
      });
      return res.status(200).json({ user: personOut(user ?? { ...target, ...patch }) });
    }

    // PATCH
    const body = (req.body ?? {}) as Record<string, unknown>;
    const built = fields(body);
    if ("error" in built) return fail(res, 400, built.error, built.message);
    const patch = built.patch;
    if (Object.keys(patch).length === 0) return fail(res, 400, "nothing_to_update");
    // An extra address on someone's account can't also be a main address.
    if (typeof patch.mail_address === "string" && (await aliasOwner(patch.mail_address))) {
      return fail(res, 409, "address_taken", `${patch.mail_address} is taken.`);
    }

    if (target.id === me.id && patch.role !== undefined && patch.role !== me.role) {
      return fail(res, 400, "cannot_change_own_role", "You can’t change your own role.");
    }
    if (target.id === me.id && patch.status !== undefined && patch.status !== "approved") {
      return fail(res, 400, "cannot_lock_self_out", "You can’t turn off your own access.");
    }
    if (patch.role === "owner" && me.role !== "owner") {
      return fail(res, 403, "forbidden", "Only a principal can make someone a principal.");
    }

    const now = new Date().toISOString();
    const statusChange = patch.status !== undefined && patch.status !== target.status;
    if (!statusChange) delete patch.status;
    if (statusChange && patch.status === "approved") {
      // A request to join is approved only with a choice of role, a full name,
      // and a number that proved itself with a code.
      if (target.status === "incoming") {
        if (!target.verified_at) return fail(res, 409, "not_verified", "This number never confirmed its code, so it can’t be approved. Turn it down, or add the person yourself.");
        if (patch.role === undefined) return fail(res, 400, "role_required", "Choose what they can do before approving.");
        if (!isFullName((patch.name as string | null | undefined) ?? target.name)) return fail(res, 400, "name_required", "Enter their full name before approving.");
      }
      // The first grant keeps its date and who gave it; turning access back on doesn't erase them.
      if (!target.approved_at) Object.assign(patch, { approved_at: now, approved_by: me.id });
      Object.assign(patch, { revoked_at: null, revoked_by: null, removed_at: null, removed_by: null });
    }
    if (statusChange && patch.status === "denied" && target.status === "approved") Object.assign(patch, { revoked_at: now, revoked_by: me.id });

    let updated: Person[];
    try {
      updated = await writePerson(target.id, patch);
      // Losing access kills any live sessions, and so does moving in or out of
      // Email only, so a cached session can't keep the old role.
      const emailFlip = patch.role !== undefined && patch.role !== target.role && (patch.role === "email" || target.role === "email");
      if ((statusChange && patch.status !== "approved") || emailFlip) {
        await sb(`app_sessions?user_id=eq.${target.id}`, { method: "DELETE" });
      }
    } catch (err) {
      return failDuplicate(res, err, patch);
    }
    let user = updated[0];
    // Give an approved user an address now, before they can pick the name it
    // would come from. Not from that name (they may have chosen it): user-xxxxxx,
    // which an admin can rename. Only for a role that reads mail, or when the
    // admin asks; never an outside partner. An admin clearing it is left alone.
    const role = (user?.role ?? target.role) as Role;
    const wantsMailbox = mailboxAllowed(role) && (typeof body.mailbox === "boolean" ? body.mailbox : mailboxByDefault(role));
    if (user?.status === "approved" && !user.mail_address && patch.mail_address === undefined && wantsMailbox) {
      const address = await ensureMailAddress(user).catch((err) => (console.error("users: no mail address yet", err), null));
      if (address) user = { ...user, mail_address: address };
    }
    for (const change of accessChanges(target, patch)) {
      await audit({ actor: me, action: change.action, target: label, summary: change.summary, detail: change.detail });
    }
    return res.status(200).json({ user: personOut(user) });
  } catch (err) {
    return handleError(res, err);
  }
}
