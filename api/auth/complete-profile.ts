/**
 * Finishing setup after a first sign-in (app/routes/complete-profile.tsx):
 * the person's name, then whichever of email or phone the account is
 * missing ("Email only" members and outside partners need no personal
 * email). A new email or phone is verified with a code before it attaches,
 * because an unverified number on an account could sign in as that account.
 *
 * HTTP:
 *   POST { name }                  → { user }: sets the name, once. After that only an admin changes it (People).
 *   POST { identifier, consent? }  → { sent }: sends a code to the new email or phone.
 *   POST { identifier, code }      → { user }: checks it and writes the column.
 * Who may call it: any signed-in person, partners and Email-only members
 * included. A code to a new phone passes the same country check and caps
 * as sign-in (lib/sign-in.ts), and its row can never be used to sign in.
 * Env: BIRD_ACCESS_KEY (through verifyStart and verifyCheck),
 * SIGNIN_COUNTRY_CODES and SIGNIN_HOURLY_CAP (optional), SUPABASE_URL,
 * SUPABASE_SERVICE_KEY.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit } from "../../lib/audit.js";
import { currentUser, fail, guard, handleError, normalizeIdentifier, sb, signInAllowed, verifyCheck, verifyStart, type AppUser } from "../../lib/auth.js";
import { isFullName } from "../../lib/people.js";
import { capsRefusal, clientIp, holdCode, publicRefusal, refuse, release, signedInUser, type Held } from "../../lib/sign-in.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["POST"])) return;

  let held: Held | undefined;
  let sent = false;
  try {
    const me = await currentUser(req, { allowEmailOnly: true, allowPartner: true });
    if (!me) return fail(res, 401, "unauthorized");

    if (req.body?.name !== undefined && req.body?.identifier === undefined) {
      // The name a person gives here is how the records attribute their work;
      // they set it once, and from then on only an admin changes it (logged).
      if (me.name) return fail(res, 409, "name_set", "Your name is already on your account. Ask the office to change it.");
      const name = String(req.body.name).trim().replace(/\s+/g, " ").slice(0, 80);
      if (!isFullName(name)) return fail(res, 400, "invalid_name", "Enter your full name, first and last.");
      const updated = await sb<AppUser[]>(`app_users?id=eq.${me.id}&name=is.null`, {
        method: "PATCH",
        prefer: "return=representation",
        body: { name },
      });
      if (!updated?.[0]) return fail(res, 409, "name_set", "Your name is already on your account. Ask the office to change it.");
      await audit({ actor: { ...me, name }, action: "user.name_set", target: { type: "user", id: me.id, label: name }, summary: `${name} gave their name at sign-in` });
      return res.status(200).json({ user: signedInUser(updated[0]) });
    }

    const identifier = normalizeIdentifier(String(req.body?.identifier ?? ""));
    if (!identifier) {
      return fail(res, 400, "invalid_identifier", "Enter a valid phone number or email address.");
    }

    const column = identifier.kind === "phone" ? "phone" : "email";
    if (me[column]) {
      return fail(res, 400, "already_set", column === "phone" ? "Your account already has a phone number." : "Your account already has an email.");
    }

    const clash = await sb<Array<{ id: string }>>(`app_users?${column}=eq.${encodeURIComponent(identifier.value)}&id=neq.${me.id}&select=id&limit=1`);
    if (clash?.[0]) {
      return fail(res, 409, "already_exists", "That’s already on someone else’s account.");
    }

    const code = String(req.body?.code ?? "").replace(/\D/g, "");
    if (!code) {
      if (identifier.kind === "phone") {
        if (!signInAllowed(identifier.value)) return fail(res, 400, "unsupported_country", "Codes can’t be sent to numbers in that country.");
        const ip = clientIp(req.headers ?? {});
        const consent = typeof req.body?.consent === "string" && /^[a-z0-9-]{1,40}$/i.test(req.body.consent) ? req.body.consent : null;
        held = await holdCode(identifier.value, ip, "profile", consent);
        const refusal = await capsRefusal(held, identifier.value, ip);
        if (refusal) return refuse(res, refusal);
      }
      await verifyStart(identifier);
      sent = true;
      return res.status(200).json({ sent: true, kind: identifier.kind, identifier: identifier.value });
    }

    if (code.length !== 6) return fail(res, 400, "invalid_code", "Enter the 6-digit code.");
    const outcome = await verifyCheck(identifier, code);
    if (outcome === "expired") {
      return fail(res, 400, "code_expired", "That code expired. Request a new one.");
    }
    if (outcome !== "verified") {
      return fail(res, 401, "wrong_code", "That code isn’t right.");
    }

    const updated = await sb<AppUser[]>(`app_users?id=eq.${me.id}`, {
      method: "PATCH",
      prefer: "return=representation",
      body: { [column]: identifier.value },
    });
    await audit({
      actor: me,
      action: "user.contact_change",
      target: { type: "user", id: me.id, label: me.name },
      summary: `${me.name ?? "Someone"} added and confirmed ${column === "phone" ? "a phone number" : "an email address"}`,
      detail: { field: column },
    });
    return res.status(200).json({ user: signedInUser(updated[0]) });
  } catch (err) {
    const plain = publicRefusal(err);
    if (plain) {
      console.error("complete-profile: the code wasn't sent or checked", { configError: true });
      return refuse(res, plain);
    }
    return handleError(res, err);
  } finally {
    if (held && !sent) await release(held);
  }
}
