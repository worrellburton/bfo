import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  currentUser,
  fail,
  guard,
  handleError,
  normalizeIdentifier,
  publicUser,
  sb,
  verifyCheck,
  verifyStart,
  type AppUser,
} from "../../lib/auth.js";

/**
 * Every account needs both an email and a phone number. Whichever one is
 * missing gets collected here after sign-in — and verified with a code before
 * it attaches, because an unverified address on an account could sign in as
 * that account.
 *
 * POST { identifier }        → sends a code to the new address/number
 * POST { identifier, code }  → checks it and writes the column
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["POST"])) return;

  try {
    const me = await currentUser(req);
    if (!me) return fail(res, 401, "unauthorized");

    const identifier = normalizeIdentifier(String(req.body?.identifier ?? ""));
    if (!identifier) {
      return fail(res, 400, "invalid_identifier", "Enter a valid phone number or email address.");
    }

    const column = identifier.kind === "phone" ? "phone" : "email";
    if (me[column]) {
      return fail(
        res,
        400,
        "already_set",
        column === "phone" ? "Your account already has a phone number." : "Your account already has an email."
      );
    }

    const clash = await sb<Array<{ id: string }>>(
      `app_users?${column}=eq.${encodeURIComponent(identifier.value)}&id=neq.${me.id}&select=id&limit=1`
    );
    if (clash?.[0]) {
      return fail(res, 409, "already_exists", "That's already attached to another user.");
    }

    const code = String(req.body?.code ?? "").replace(/\D/g, "");
    if (!code) {
      await verifyStart(identifier);
      return res.status(200).json({ sent: true, kind: identifier.kind, identifier: identifier.value });
    }

    if (code.length !== 6) return fail(res, 400, "invalid_code", "Enter the 6-digit code.");
    const outcome = await verifyCheck(identifier, code);
    if (outcome === "expired") {
      return fail(res, 400, "code_expired", "That code expired. Request a new one.");
    }
    if (outcome !== "verified") {
      return fail(res, 401, "wrong_code", "That code isn't right.");
    }

    const updated = await sb<AppUser[]>(`app_users?id=eq.${me.id}`, {
      method: "PATCH",
      prefer: "return=representation",
      body: { [column]: identifier.value },
    });
    return res.status(200).json({ user: publicUser(updated[0]) });
  } catch (err) {
    return handleError(res, err);
  }
}
