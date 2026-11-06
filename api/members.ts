import type { VercelRequest, VercelResponse } from "@vercel/node";
import { logActivity } from "../lib/activity.js";
import { audit } from "../lib/audit.js";
import { currentUser, fail, formatPhone, guard, handleError, isAdmin, normalizeEmail, normalizePhone, sb, sendEmail, sendSms, type AppUser } from "../lib/auth.js";
import { accessFor, grantAccess, revokeAccess } from "../lib/entity-access.js";
import { readRows } from "../lib/tree.js";

/**
 * An entity's people who can sign in to BFO, and who signs for it.
 *
 * GET  ?assetId=x                    → { people: [...] }   everyone given the entity
 * GET  ?assetId=x&view=signers       → { signers: [{ name, title, email, source }], me: { email } }
 *        Who may sign for the entity, from its record (managers, officers,
 *        acting trustees), each with the email on their BFO account when one
 *        matches the name exactly. The contract page signs with these, never
 *        with the sender's own address for someone else.
 * POST { action: "invite", assetId, memberName, name, phone, email?, consent: true,
 *        confirmUserId?, grantorApproval? }
 *        Finds or creates their account (a "partner": signs in by phone and
 *        sees only the entities they've been given), gives them this entity,
 *        and texts (and emails, when there's an address) them to sign in.
 *        Refuses without the inviter's word that the person agreed to texts
 *        (400 no_consent). When the number already belongs to an account
 *        under another name, answers 409 number_belongs with that account's
 *        name, and goes ahead only when the inviter confirms it's them
 *        (confirmUserId). The consent, and on a revocable trust the
 *        approving grantor, go to the audit trail.
 * POST { action: "revoke", assetId, userId }  → takes the entity away (audited)
 *
 * Who may call it: owners and admins (403 otherwise).
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (sb), and Bird's for the text and
 * email (sendSms, sendEmail in lib/auth.ts).
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

// ── Pure parts (tested in tests/members.test.ts) ─────────────────────────

/** Names compared as people write them: case, punctuation and spacing don't matter. */
export function sameName(a?: string | null, b?: string | null): boolean {
  const n = (s?: string | null) =>
    (s ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return !!n(a) && n(a) === n(b);
}

/** What an invitee will see, said the same way in the dialog, the text and the email. */
export function whatTheySee(kind: "trust" | "entity"): string {
  return kind === "trust" ? "its trust agreement, its documents and the trust’s people" : "its documents, and its owners’ names, shares and addresses";
}

/** The invitation text. Staff already have the app, so they're only told it's shared. Every text says how to stop them. */
export function inviteText(o: { from: string; entity: string; kind: "trust" | "entity"; staff: boolean }): string {
  return o.staff
    ? `BFO: ${o.from} added you to ${o.entity}. Open it at ${SITE}/login. Reply STOP to opt out.`
    : `BFO: ${o.from} invited you to see ${o.entity}: ${whatTheySee(o.kind)}. Sign in with this phone number at ${SITE}/login. Reply STOP to opt out.`;
}

type Rec = Record<string, any>;
const list = <T>(v: T[] | Record<string, T> | null | undefined): T[] => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []);
const split = (s?: string | null) =>
  (s ?? "")
    .split(/\s*(?:,|;|\n|\band\b|&)\s*/i)
    .map((x) => x.trim())
    .filter(Boolean);

export type Signer = { name: string; title: string; email: string | null; source: string };

/**
 * Who may sign for an entity, from its record: an LLC's managers (the owner
 * list, the state's record, the operating agreement), a corporation's
 * officers, a trust's acting trustees. Each gets the email of the BFO account
 * whose name matches exactly; a near match (another middle initial) is
 * someone else, so it gets none.
 */
export function signersFromRecord(data: Rec | null, users: Pick<AppUser, "name" | "email" | "status">[]): Signer[] {
  if (!data) return [];
  const out: Omit<Signer, "email">[] = [];
  const add = (name: string, title: string, source: string) => {
    if (name && !out.some((s) => sameName(s.name, name))) out.push({ name: name.trim(), title, source });
  };
  if (data.type === "Trust") {
    const people = list<Rec>(data.trustPeople);
    const acting = people.length ? people.filter((p) => p.role === "trustee").map((p) => String(p.name)) : split(data.trustees);
    for (const n of acting) add(n, "Trustee", "The trust’s people");
  } else if (data.type === "C-Corp") {
    for (const o of list<Rec>(data.corp?.officers)) if (!o.until) add(String(o.name ?? ""), String(o.title ?? "Officer"), "Officers");
  } else {
    for (const m of list<Rec>(data.members)) if (/manag/i.test(m.role ?? "")) add(String(m.name ?? ""), /managing member/i.test(m.role) ? "Managing member" : "Manager", "The owner list");
    for (const p of list<Rec>(data.stateRecord?.people)) if (/manager/i.test(p.role ?? "") || /^manager$/i.test(p.title ?? "")) add(String(p.name ?? ""), "Manager", "The state’s record");
    for (const n of list<string>(data.stateRecord?.managers)) add(String(n), "Manager", "The state’s record");
    for (const n of list<string>(data.profile?.managers)) add(String(n), "Manager", "The operating agreement");
  }
  return out.map((s) => {
    const hit = users.filter((u) => u.status === "approved" && u.email && sameName(u.name, s.name));
    return { ...s, email: hit.length === 1 ? hit[0].email : null };
  });
}

// ── The endpoint ─────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "POST"])) return;
  try {
    const me = await currentUser(req);
    if (!me) return fail(res, 401, "unauthorized");
    if (!isAdmin(me)) return fail(res, 403, "forbidden", "Only owners and admins can invite people.");

    if (req.method === "GET") {
      const assetId = String(req.query.assetId ?? "");
      if (!ASSET_ID.test(assetId)) return fail(res, 400, "bad_asset");
      if (String(req.query.view ?? "") === "signers") {
        const row = (await readRows("assets", [assetId]))[0];
        if (!row) return fail(res, 404, "not_found");
        const users = await sb<Pick<AppUser, "name" | "email" | "status">[]>("app_users?status=eq.approved&email=not.is.null&select=name,email,status&order=id&limit=1000");
        return res.status(200).json({ signers: signersFromRecord(row.data as Rec, users ?? []), me: { email: me.email } });
      }
      return res.status(200).json({ people: (await accessFor(assetId)).map(person) });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const assetId = String(body.assetId ?? "");
    if (!ASSET_ID.test(assetId)) return fail(res, 400, "bad_asset");
    const asset = (await readRows("assets", [assetId]))[0];
    if (!asset) return fail(res, 404, "not_found");
    const data = (asset.data ?? {}) as { name?: string; type?: string };
    const entityName = String(data.name ?? "the entity");
    const kind = data.type === "Trust" ? "trust" : "entity";
    const actor = { id: me.id, name: me.name || me.email, source: "user" as const };

    if (body.action === "revoke") {
      const userId = String(body.userId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(userId)) return fail(res, 400, "bad_user");
      await revokeAccess(userId, assetId);
      const gone = (await sb<AppUser[]>(`app_users?id=eq.${userId}&select=name,phone&limit=1`))[0];
      await logActivity(assetId, actor, [{ kind: "access", summary: `Took away ${gone?.name || "someone"}'s access` }]);
      await audit({
        actor: me,
        action: "entity.access_revoke",
        target: { type: "entity", id: assetId, label: entityName },
        summary: `Took away ${gone?.name || "someone"}’s access to ${entityName}`,
        detail: { userId },
      });
      // A partner with nothing left to see is signed out everywhere.
      const left = await sb<{ asset_id: string }[]>(`entity_access?user_id=eq.${userId}&select=asset_id&limit=1`);
      const users = await sb<AppUser[]>(`app_users?id=eq.${userId}&select=role&limit=1`);
      if (!left.length && users[0]?.role === "partner") await sb(`app_sessions?user_id=eq.${userId}`, { method: "DELETE" });
      return res.status(200).json({ people: (await accessFor(assetId)).map(person) });
    }

    if (body.action !== "invite") return fail(res, 400, "unknown_action");
    const name = String(body.name ?? "")
      .trim()
      .slice(0, 120);
    const memberName =
      String(body.memberName ?? "")
        .trim()
        .slice(0, 200) || name;
    const phone = normalizePhone(String(body.phone ?? ""));
    const rawEmail = String(body.email ?? "").trim();
    const email = rawEmail ? normalizeEmail(rawEmail) : null;
    const grantorApproval =
      String(body.grantorApproval ?? "")
        .trim()
        .slice(0, 200) || null;
    if (!name) return fail(res, 400, "no_name", "Who are you inviting?");
    if (!phone) return fail(res, 400, "bad_phone", "Enter a mobile number: they sign in with it.");
    if (rawEmail && !email) return fail(res, 400, "bad_email", "Check the email address.");
    if (body.consent !== true) return fail(res, 400, "no_consent", "Confirm they’ve agreed to get texts from BFO at this number.");

    // Their account: the one with this phone (or email), or a new partner.
    let user = (await sb<AppUser[]>(`app_users?phone=eq.${encodeURIComponent(phone)}&select=*&limit=1`))[0];
    if (!user && email) {
      user = (await sb<AppUser[]>(`app_users?email=eq.${encodeURIComponent(email)}&select=*&limit=1`))[0];
      if (user && user.phone && user.phone !== phone) return fail(res, 409, "email_taken", `${email} belongs to an account with another phone number.`);
    }
    // A number (or address) that's someone else's: say whose, and wait for the inviter to confirm it's them.
    if (user && user.name && !sameName(user.name, name) && String(body.confirmUserId ?? "") !== user.id) {
      return res.status(409).json({
        error: "number_belongs",
        message: `This number belongs to ${user.name}’s account.`,
        account: { id: user.id, name: user.name },
      });
    }
    const now = new Date().toISOString();
    const created = !user;
    if (!user) {
      user = (
        await sb<AppUser[]>("app_users", {
          method: "POST",
          prefer: "return=representation",
          body: [{ name, phone, ...(email ? { email } : {}), role: "partner", status: "approved", approved_at: now }],
        })
      )[0];
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
    await logActivity(assetId, actor, [{ kind: "access", summary: `Invited ${user.name || name} to BFO` }]);

    // Tell them.
    const from = me.name?.trim() || "Burton Family Office";
    const staff = user.role !== "partner";
    const text = inviteText({ from, entity: entityName, kind, staff });
    const sent = { sms: false, email: false };
    try {
      await sendSms(phone, text);
      sent.sms = true;
    } catch (err) {
      console.error("members: invite text failed", err instanceof Error ? err.message : "unknown");
    }
    if (email) {
      try {
        await sendEmail(email, `${from} invited you to BFO`, `${text}\n`, inviteHtml(from, entityName, formatPhone(phone), whatTheySee(kind)));
        sent.email = true;
      } catch (err) {
        console.error("members: invite email failed", err instanceof Error ? err.message : "unknown");
      }
    }
    await audit({
      actor: me,
      action: "entity.access_grant",
      target: { type: "entity", id: assetId, label: entityName },
      summary: `Gave ${user.name || name} access to ${entityName}`,
      detail: {
        userId: user.id,
        memberName,
        newAccount: created,
        // The inviter's word that the person agreed to texts at this number, and when.
        textConsent: { confirmedBy: me.id, at: now, phoneLast4: phone.slice(-4) },
        confirmedExistingAccount: String(body.confirmUserId ?? "") === user.id,
        grantorApproval,
        sent,
      },
    });
    return res.status(200).json({ sent, people: (await accessFor(assetId)).map(person) });
  } catch (err) {
    return handleError(res, err);
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function inviteHtml(from: string, entity: string, phone: string, sees: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f7f7f8;padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:460px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;" cellpadding="0" cellspacing="0">
      <tr><td style="padding:32px 28px;">
        <div style="font-family:'Playfair Display',Georgia,serif;font-size:24px;color:#18181b;">BFO</div>
        <div style="margin:20px 0 8px;font-size:15px;line-height:1.6;color:#18181b;">${esc(from)} invited you to see <strong>${esc(entity)}</strong> in BFO: ${esc(sees)}.</div>
        <a href="${SITE}/login" style="display:inline-block;margin-top:16px;padding:10px 20px;border-radius:8px;background:#18181b;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">Sign in to BFO</a>
        <div style="margin-top:20px;font-size:13px;line-height:1.6;color:#52525b;">Sign in with ${esc(phone)}; we’ll text you a code. Reply STOP to any text from BFO to stop them.</div>
        <div style="margin-top:16px;font-size:12px;line-height:1.6;color:#52525b;"><a href="${SITE}/legal/terms" style="color:#52525b;">Terms</a> · <a href="${SITE}/legal/privacy" style="color:#52525b;">Privacy</a></div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
