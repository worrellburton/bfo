/**
 * Sign-in, step one: text a 6-digit code to a phone number.
 *
 * HTTP: POST { identifier, consent } → { sent, kind, identifier, masked, expiresIn }.
 * Who may call it: anyone (it is the way in). It never says whether a number
 * has an account: every number that passes the caps gets a code, and an
 * unknown or refused number is sorted out at verify-code, after the person
 * has proved they hold the phone. No account row is created here.
 * `consent` is the version of the disclosure under the phone field
 * (lib/terms.ts SMS_CONSENT_VERSION); it is kept with the code's row.
 * Env: BIRD_ACCESS_KEY (through verifyStart), SIGNIN_COUNTRY_CODES and
 * SIGNIN_HOURLY_CAP (optional), SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { CODE_TTL_MS, fail, guard, handleError, normalizeIdentifier, sb, signInAllowed, verifyStart } from "../../lib/auth.js";
import { capsRefusal, clientIp, holdCode, publicRefusal, refuse, release, type Held } from "../../lib/sign-in.js";

// The signing page records a signer's address the same way.
export { clientIp };

function mask(kind: "phone" | "email", value: string): string {
  if (kind === "phone") return `••• ••• ${value.slice(-4)}`;
  const [local, domain] = value.split("@");
  const head = local.slice(0, 2);
  return `${head}${"•".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

/** The disclosure version the caller says they saw; anything unexpected is kept as unknown rather than trusted. */
function consentOf(raw: unknown): string | null {
  return typeof raw === "string" && /^[a-z0-9-]{1,40}$/i.test(raw) ? raw : raw === undefined ? null : "unrecognised";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["POST"])) return;

  let held: Held | undefined;
  let sent = false;
  try {
    const raw = (req.body?.identifier ?? req.body?.phone ?? req.body?.email ?? "") as string;
    const identifier = normalizeIdentifier(raw);
    if (!identifier) {
      return fail(res, 400, "invalid_identifier", "Enter a valid phone number.");
    }
    // Sign-in is by phone only; an email stays on the profile as contact info.
    if (identifier.kind !== "phone") {
      return fail(res, 400, "phone_only", "Sign in with your phone number.");
    }
    // Answers the same for every number, so it says nothing about who has an account.
    if (!signInAllowed(identifier.value)) {
      return fail(res, 400, "unsupported_country", "Sign-in codes can't be sent to numbers in that country.");
    }

    const ip = clientIp(req.headers ?? {});
    held = await holdCode(identifier.value, ip, "sign_in", consentOf(req.body?.consent));
    const refusal = await capsRefusal(held, identifier.value, ip);
    if (refusal) return refuse(res, refusal);

    // Bird Verify generates, delivers and checks the code; we keep only its
    // verification id, namespaced so verify-code knows which path to take.
    const verificationId = await verifyStart(identifier);
    sent = true;
    await sb(`login_codes?id=eq.${held.id}`, {
      method: "PATCH",
      body: {
        code_hash: `bird:${verificationId}`,
        consumed: false,
        expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
      },
    });

    return res.status(200).json({
      sent: true,
      kind: identifier.kind,
      identifier: identifier.value,
      masked: mask(identifier.kind, identifier.value),
      expiresIn: Math.round(CODE_TTL_MS / 1000),
    });
  } catch (err) {
    const plain = publicRefusal(err);
    if (plain) {
      console.error("request-code: the code wasn't sent", { configError: true });
      return refuse(res, plain);
    }
    return handleError(res, err);
  } finally {
    if (held && !sent) await release(held);
  }
}
