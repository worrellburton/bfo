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

const ROLES: Role[] = ["owner", "admin", "member", "viewer"];
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

      try {
        const created = await sb<AppUser[]>("app_users", {
          method: "POST",
          prefer: "return=representation",
          body: [patch],
        });
        return res.status(201).json({ user: publicUser(created[0]) });
      } catch (err) {
        if (err instanceof Error && err.message.includes("duplicate key")) {
          return fail(res, 409, "already_exists", "That phone number or email is already a user.");
        }
        throw err;
      }
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

    try {
      const updated = await sb<AppUser[]>(`app_users?id=eq.${target.id}`, {
        method: "PATCH",
        prefer: "return=representation",
        body: patch,
      });
      // Losing access kills any live sessions.
      if (patch.status !== undefined && patch.status !== "approved") {
        await sb(`app_sessions?user_id=eq.${target.id}`, { method: "DELETE" });
      }
      return res.status(200).json({ user: publicUser(updated[0]) });
    } catch (err) {
      if (err instanceof Error && err.message.includes("duplicate key")) {
        return fail(res, 409, "already_exists", "That phone number or email is already a user.");
      }
      throw err;
    }
  } catch (err) {
    return handleError(res, err);
  }
}
