import type { VercelRequest, VercelResponse } from "@vercel/node";
import { logActivity } from "../lib/activity.js";
import { currentUser, fail, formatPhone, guard, handleError, isAdmin, normalizeEmail, normalizePhone, sb, sendEmail, sendSms, type AppUser } from "../lib/auth.js";
import { accessFor, grantAccess, revokeAccess } from "../lib/entity-access.js";
import { readRows } from "../lib/tree.js";

/**
 * An entity's owners and members, and who of them can sign in to BFO.
 *
 * GET  ?assetId=x                                   → { people: [...] }  everyone given the entity
 * POST { action: "invite", assetId, memberName, name, phone, email? }
 *        Finds or creates their account (a "partner": signs in by phone and
 *        sees only the entities they've been given), gives them this entity,
 *        and texts them (and emails, when there's an address) to sign in.
 * POST { action: "revoke", assetId, userId }       → takes the entity away
 *
 * Owners and admins only.
 */

const SITE = "https://www.burtonfamilyoffice.com";
const ASSET_ID = /^[\w-]{1,128}$/;

const person = (r: Awaited<ReturnType<typeof accessFor>>[number]) => ({
  userId: r.user_id,
  memberName: r.member_name,
  name: r.user.name,
  phone: formatPhone(r.user.phone),
  email: r.user.email,
  role: r.user.role,
  status: r.user.status,
  invitedAt: r.invited_at,
  lastLoginAt: r.user.last_login_at,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "POST"])) return;
  try {
    const me = await currentUser(req);
    if (!me) return fail(res, 401, "unauthorized");
    if (!isAdmin(me)) return fail(res, 403, "forbidden", "Only owners and admins can invite people.");

    if (req.method === "GET") {
      const assetId = String(req.query.assetId ?? "");
      if (!ASSET_ID.test(assetId)) return fail(res, 400, "bad_asset");
      return res.status(200).json({ people: (await accessFor(assetId)).map(person) });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const assetId = String(body.assetId ?? "");
    if (!ASSET_ID.test(assetId)) return fail(res, 400, "bad_asset");
    const asset = (await readRows("assets", [assetId]))[0];
    if (!asset) return fail(res, 404, "not_found");
    const entityName = String((asset.data as { name?: string } | null)?.name ?? "the entity");

    if (body.action === "revoke") {
      const userId = String(body.userId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(userId)) return fail(res, 400, "bad_user");
      await revokeAccess(userId, assetId);
      const gone = (await sb<AppUser[]>(`app_users?id=eq.${userId}&select=name,phone&limit=1`))[0];
      await logActivity(assetId, { id: me.id, name: me.name || me.email, source: "user" }, [{ kind: "access", summary: `Took away ${gone?.name || "someone"}'s access` }]);
      // A partner with nothing left to see is signed out everywhere.
      const left = await sb<{ asset_id: string }[]>(`entity_access?user_id=eq.${userId}&select=asset_id&limit=1`);
      const users = await sb<AppUser[]>(`app_users?id=eq.${userId}&select=role&limit=1`);
      if (!left.length && users[0]?.role === "partner") await sb(`app_sessions?user_id=eq.${userId}`, { method: "DELETE" });
      return res.status(200).json({ people: (await accessFor(assetId)).map(person) });
    }

    if (body.action !== "invite") return fail(res, 400, "unknown_action");
    const name = String(body.name ?? "").trim().slice(0, 120);
    const memberName = String(body.memberName ?? "").trim().slice(0, 200) || name;
    const phone = normalizePhone(String(body.phone ?? ""));
    const rawEmail = String(body.email ?? "").trim();
    const email = rawEmail ? normalizeEmail(rawEmail) : null;
    if (!name) return fail(res, 400, "no_name", "Who are you inviting?");
    if (!phone) return fail(res, 400, "bad_phone", "Enter a mobile number: they sign in with it.");
    if (rawEmail && !email) return fail(res, 400, "bad_email", "Check the email address.");

    // Their account: the one with this phone (or email), or a new partner.
    let user = (await sb<AppUser[]>(`app_users?phone=eq.${encodeURIComponent(phone)}&select=*&limit=1`))[0];
    if (!user && email) {
      user = (await sb<AppUser[]>(`app_users?email=eq.${encodeURIComponent(email)}&select=*&limit=1`))[0];
      if (user && user.phone && user.phone !== phone) return fail(res, 409, "email_taken", `${email} belongs to an account with another phone number.`);
    }
    const now = new Date().toISOString();
    if (!user) {
      const created = await sb<AppUser[]>("app_users", {
        method: "POST",
        prefer: "return=representation",
        body: [{ name, phone, ...(email ? { email } : {}), role: "partner", status: "approved", approved_at: now }],
      });
      user = created[0];
    } else {
      const patch: Record<string, unknown> = {};
      if (!user.phone) patch.phone = phone;
      if (!user.email && email) patch.email = email;
      if (!user.name) patch.name = name;
      // A partner turned away before is let back in by a new invitation; staff keep what they have.
      if (user.role === "partner" && user.status !== "approved") Object.assign(patch, { status: "approved", approved_at: now });
      if (Object.keys(patch).length) user = (await sb<AppUser[]>(`app_users?id=eq.${user.id}`, { method: "PATCH", prefer: "return=representation", body: patch }))[0];
    }

    await grantAccess(user.id, assetId, memberName, me.id);
    await logActivity(assetId, { id: me.id, name: me.name || me.email, source: "user" }, [{ kind: "access", summary: `Invited ${user.name || name} to BFO` }]);

    // Tell them. Staff already have the whole app, so they're only told it's shared.
    const from = me.name?.trim() || "Burton Family Office";
    const staff = user.role !== "partner";
    const text = staff
      ? `${from} added you to ${entityName} on BFO: ${SITE}/login`
      : `${from} invited you to BFO to see ${entityName}: its documents, operating agreement and more. Sign in with this phone number at ${SITE}/login`;
    const sent = { sms: false, email: false };
    try {
      await sendSms(phone, text);
      sent.sms = true;
    } catch (err) {
      console.error("members: invite text failed", err);
    }
    if (email) {
      try {
        await sendEmail(email, `${from} invited you to BFO`, `${text}\n`, inviteHtml(from, entityName, formatPhone(phone)));
        sent.email = true;
      } catch (err) {
        console.error("members: invite email failed", err);
      }
    }
    return res.status(200).json({ sent, people: (await accessFor(assetId)).map(person) });
  } catch (err) {
    return handleError(res, err);
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function inviteHtml(from: string, entity: string, phone: string): string {
  return `<!doctype html><html><body style="margin:0;background:#000;padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:460px;background:#0b0b0b;border:1px solid rgba(255,255,255,0.12);border-radius:20px;" cellpadding="0" cellspacing="0">
      <tr><td style="padding:40px 34px;text-align:center;">
        <div style="font-family:'Playfair Display',Georgia,serif;font-size:13px;letter-spacing:0.28em;text-transform:uppercase;color:rgba(255,255,255,0.5);">Burton Family Office</div>
        <div style="margin-top:6px;font-family:'Playfair Display',Georgia,serif;font-size:40px;color:#ffffff;">BFO</div>
        <div style="margin:28px 0 8px;font-size:15px;line-height:1.6;color:rgba(255,255,255,0.8);">${esc(from)} invited you to see<br/><strong style="color:#fff;">${esc(entity)}</strong></div>
        <div style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.5);">Its documents, operating agreement and more, in one place.</div>
        <a href="${SITE}/login" style="display:inline-block;margin-top:26px;padding:12px 26px;border-radius:12px;background:#ffffff;color:#000;font-size:14px;font-weight:600;text-decoration:none;">Sign in to BFO</a>
        <div style="margin-top:20px;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.4);">Sign in with ${esc(phone)}. We'll text you a code.</div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
