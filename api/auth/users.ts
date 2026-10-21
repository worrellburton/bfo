import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  currentUser,
  fail,
  guard,
  handleError,
  isAdmin,
  normalizeEmail,
  normalizePhone,
  publicUser,
  sb,
  type AppUser,
  type Role,
  type Status,
} from "../../lib/auth.js";
import { aliasOwner, ensureMailAddress, parseMailAddress } from "../../lib/mail-address.js";

const ROLES: Role[] = ["owner", "admin", "member", "viewer", "email", "partner"];
const STATUSES: Status[] = ["incoming", "approved", "denied"];

/** Build the column patch shared by create and update, validating as it goes. */
function fields(body: any): { patch: Record<string, unknown> } | { error: string; message: string } {
  const patch: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    patch.name = name || null;
  }

  if (body.phone !== undefined) {
    const raw = String(body.phone).trim();
    if (!raw) patch.phone = null;
    else {
      const phone = normalizePhone(raw);
      if (!phone) return { error: "invalid_phone", message: "Enter a valid phone number." };
      patch.phone = phone;
    }
  }

  if (body.email !== undefined) {
    const raw = String(body.email).trim();
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
    if (!ROLES.includes(body.role)) return { error: "invalid_role", message: "Unknown role." };
    patch.role = body.role;
  }

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) {
      return { error: "invalid_status", message: "Unknown status." };
    }
    patch.status = body.status;
    patch.approved_at = body.status === "approved" ? new Date().toISOString() : null;
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
  if (hit) return fail(res, 409, "already_exists", "That phone number or email is already a user.");
  throw err;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "POST", "PATCH", "DELETE"])) return;

  try {
    const me = await currentUser(req);
    if (!me) return fail(res, 401, "unauthorized");
    if (!isAdmin(me)) return fail(res, 403, "forbidden", "Only owners and admins can manage users.");

    if (req.method === "GET") {
      const users = await sb<AppUser[]>("app_users?select=*&order=created_at.asc");
      return res.status(200).json({
        users: users.map(publicUser),
        me: publicUser(me),
      });
    }

    if (req.method === "POST") {
      const built = fields(req.body ?? {});
      if ("error" in built) return fail(res, 400, built.error, built.message);
      const patch = built.patch;
      if (typeof patch.mail_address === "string" && (await aliasOwner(patch.mail_address))) {
        return fail(res, 409, "address_taken", `${patch.mail_address} is taken.`);
      }
      if (!patch.phone && !patch.email) {
        return fail(res, 400, "missing_identifier", "A phone number or email address is required.");
      }
      if (patch.role === "owner" && me.role !== "owner") {
        return fail(res, 403, "forbidden", "Only an owner can create another owner.");
      }
      // New users added by an admin are approved unless told otherwise.
      if (patch.status === undefined) {
        patch.status = "approved";
        patch.approved_at = new Date().toISOString();
      }
      if (patch.role === undefined) patch.role = "member";

      let user: AppUser;
      try {
        const created = await sb<AppUser[]>("app_users", {
          method: "POST",
          prefer: "return=representation",
          body: [patch],
        });
        user = created[0];
      } catch (err) {
        return failDuplicate(res, err, patch);
      }
      // Assign their address now, from the name the admin typed, so the admin
      // sees it straight away. The user exists either way; an admin can set it.
      await ensureMailAddress(user, { trustName: true }).catch((err) => console.error("users: no mail address yet", err));
      return res.status(201).json({ user: publicUser(user) });
    }

    const id = String(req.method === "DELETE" ? req.query.id ?? "" : req.body?.id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(res, 400, "invalid_id");

    const targets = await sb<AppUser[]>(`app_users?id=eq.${id}&select=*&limit=1`);
    const target = targets?.[0];
    if (!target) return fail(res, 404, "not_found");
    if (target.role === "owner" && me.role !== "owner") {
      return fail(res, 403, "forbidden", "Only an owner can change an owner.");
    }

    if (req.method === "DELETE") {
      if (target.id === me.id) return fail(res, 400, "cannot_remove_self", "You can't remove yourself.");
      await sb(`app_sessions?user_id=eq.${target.id}`, { method: "DELETE" });
      await sb(`app_users?id=eq.${target.id}`, { method: "DELETE" });
      return res.status(200).json({ ok: true });
    }

    // PATCH
    const built = fields(req.body ?? {});
    if ("error" in built) return fail(res, 400, built.error, built.message);
    const patch = built.patch;
    if (Object.keys(patch).length === 0) return fail(res, 400, "nothing_to_update");
    // An extra address on someone's account can't also be a main address.
    if (typeof patch.mail_address === "string" && (await aliasOwner(patch.mail_address))) {
      return fail(res, 409, "address_taken", `${patch.mail_address} is taken.`);
    }

    if (target.id === me.id && patch.role !== undefined && patch.role !== me.role) {
      return fail(res, 400, "cannot_change_own_role", "You can't change your own role.");
    }
    if (target.id === me.id && patch.status !== undefined && patch.status !== "approved") {
      return fail(res, 400, "cannot_lock_self_out", "You can't revoke your own access.");
    }
    if (patch.role === "owner" && me.role !== "owner") {
      return fail(res, 403, "forbidden", "Only an owner can promote someone to owner.");
    }
    // Keep approved_at when a status update isn't actually a status change.
    if (patch.status === target.status) delete patch.approved_at;

    let updated: AppUser[];
    try {
      updated = await sb<AppUser[]>(`app_users?id=eq.${target.id}`, {
        method: "PATCH",
        prefer: "return=representation",
        body: patch,
      });
      // Losing access kills any live sessions, and so does moving in or out of
      // Email only, so a cached session can't keep the old role.
      const emailFlip = patch.role !== undefined && patch.role !== target.role && (patch.role === "email" || target.role === "email");
      if ((patch.status !== undefined && patch.status !== "approved") || emailFlip) {
        await sb(`app_sessions?user_id=eq.${target.id}`, { method: "DELETE" });
      }
    } catch (err) {
      return failDuplicate(res, err, patch);
    }
    const user = updated[0];
    // Give an approved user an address now, before they can pick the name it
    // would come from. Not from that name (they may have chosen it): user-xxxxxx,
    // which an admin can rename. An admin clearing it on purpose is left alone.
    if (user?.status === "approved" && !user.mail_address && patch.mail_address === undefined) {
      await ensureMailAddress(user).catch((err) => console.error("users: no mail address yet", err));
    }
    return res.status(200).json({ user: publicUser(user) });
  } catch (err) {
    return handleError(res, err);
  }
}
