/**
 * Agreeing to the Terms of use: the "Agree and continue" step after sign-in
 * (app/routes/complete-profile.tsx), shown when someone hasn't agreed to the
 * current version (lib/terms.ts TERMS_VERSION).
 *
 * HTTP: POST { version } → { termsVersion, acceptedAt, recorded }.
 * Who may call it: any signed-in person, partners and Email-only members
 * included (they agree too). Only the current version can be agreed to.
 * What is kept: the version, the time and the network address on the
 * person's record, and an entry in the audit trail. If the database doesn't
 * have the columns yet (migration 20261107 not applied), the audit entry is
 * still written and `recorded` is false, so no one is locked out.
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit } from "../../lib/audit.js";
import { currentUser, fail, guard, handleError, isPartner, sb } from "../../lib/auth.js";
import { clientIp, deviceOf, isMissingColumn } from "../../lib/sign-in.js";
import { TERMS_VERSION } from "../../lib/terms.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["POST"])) return;

  try {
    const me = await currentUser(req, { allowEmailOnly: true, allowPartner: true });
    if (!me) return fail(res, 401, "unauthorized");

    if (req.body?.version !== TERMS_VERSION) {
      return fail(res, 409, "terms_changed", "The Terms changed while this page was open. Reload to read the current version.");
    }

    const acceptedAt = new Date().toISOString();
    const ip = clientIp(req.headers ?? {});
    let recorded = true;
    try {
      await sb(`app_users?id=eq.${me.id}`, { method: "PATCH", body: { terms_version: TERMS_VERSION, terms_accepted_at: acceptedAt, terms_accepted_ip: ip } });
    } catch (err) {
      if (!isMissingColumn(err)) throw err;
      recorded = false;
    }
    await audit({
      actor: me,
      action: "auth.terms_accept",
      target: { type: "user", id: me.id, label: me.name },
      summary: `${me.name ?? "Someone"} agreed to the Terms of use (${TERMS_VERSION})${isPartner(me) ? " and to keep what they see in BFO confidential" : ""}`,
      detail: { version: TERMS_VERSION, ip, device: deviceOf(req.headers ?? {}), confidentiality: isPartner(me) },
    });
    return res.status(200).json({ termsVersion: TERMS_VERSION, acceptedAt, recorded });
  } catch (err) {
    return handleError(res, err);
  }
}
