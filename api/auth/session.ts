/**
 * The caller's own session.
 *
 * HTTP:
 *   GET                    → { user, expiresAt, devices }: who is signed in (with the Terms version they
 *                            agreed to), when this session ends, and how many sessions they have open.
 *   DELETE                 → { ok }: signs this device out.
 *   DELETE ?scope=others   → { ok, signedOut }: signs out every other device, keeping this one.
 * Who may call it: anyone with a session, partners and Email-only members
 * included. Signing out is recorded in the audit trail.
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit } from "../../lib/audit.js";
import { bearerToken, currentUser, fail, guard, handleError, sb, type AppUser } from "../../lib/auth.js";
import { clientIp, deviceOf, signedInUser } from "../../lib/sign-in.js";

const UUID = /^[0-9a-f-]{36}$/i;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "DELETE"])) return;

  try {
    const token = bearerToken(req);
    const where = { ip: clientIp(req.headers ?? {}), device: deviceOf(req.headers ?? {}) };

    if (req.method === "DELETE") {
      if (req.query?.scope === "others") {
        const me = await currentUser(req, { allowEmailOnly: true, allowPartner: true });
        if (!me || !token) return fail(res, 401, "unauthorized");
        const gone = await sb<Array<{ token: string }>>(`app_sessions?user_id=eq.${me.id}&token=neq.${encodeURIComponent(token)}&select=token`, {
          method: "DELETE",
          prefer: "return=representation",
        });
        const n = gone?.length ?? 0;
        await audit({
          actor: me,
          action: "auth.sign_out_others",
          target: { type: "user", id: me.id, label: me.name },
          count: n,
          summary: `${me.name ?? "Someone"} signed out ${n === 1 ? "1 other device" : `${n} other devices`}`,
          detail: where,
        });
        return res.status(200).json({ ok: true, signedOut: n });
      }
      if (token && UUID.test(token)) {
        const gone = await sb<Array<{ user_id: string }>>(`app_sessions?token=eq.${encodeURIComponent(token)}&select=user_id`, { method: "DELETE", prefer: "return=representation" });
        const userId = gone?.[0]?.user_id;
        if (userId) {
          const [who] = (await sb<Array<Pick<AppUser, "id" | "name" | "role">>>(`app_users?id=eq.${userId}&select=id,name,role&limit=1`).catch(() => [])) ?? [];
          if (who) await audit({ actor: who, action: "auth.sign_out", target: { type: "user", id: who.id, label: who.name }, summary: `${who.name ?? "Someone"} signed out`, detail: where });
        }
      }
      return res.status(200).json({ ok: true });
    }

    const user = await currentUser(req, { allowEmailOnly: true, allowPartner: true });
    if (!user || !token) return fail(res, 401, "unauthorized");

    const rows = await sb<Array<{ token: string; expires_at: string }>>(
      `app_sessions?user_id=eq.${user.id}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=token,expires_at&limit=200`,
    );
    const mine = rows?.find((r) => r.token === token);
    return res.status(200).json({ user: signedInUser(user), expiresAt: mine?.expires_at ?? null, devices: rows?.length ?? 1 });
  } catch (err) {
    return handleError(res, err);
  }
}
