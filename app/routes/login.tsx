import { useNavigate, useSearchParams } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, addingAccount, cancelAddAccount, displayName, homePath, isAuthenticated, profileComplete, safeNext, verifyCode, type User } from "../auth";
import { CodeEntry, DoorButton, DoorError, DoorField, DoorHeading, DoorLink, DoorScreen } from "../sign-in-door";
import { resendLabel } from "../sign-in-style";
import { LegalLinks } from "../ui";
import { needsTerms, RETENTION, SMS_CONSENT_VERSION } from "../../lib/terms";

export function meta() {
  return [{ title: "Sign in · BFO" }];
}

/**
 * Sign-in: a phone number, then the 6-digit code texted to it. The door's
 * world (app/sign-in-door.tsx): the owner's sky held still, the lockup, one
 * question, one field, one button. The disclosure about the text and the
 * Terms and Privacy links sit under the field, where the number is given
 * (docs/DESIGN.md §11.4); the version shown is sent with the request.
 * After a right code: Finish setup if the Terms, a name or an email are
 * still needed, else where the person was going.
 */

const RESEND_SECONDS = 45;
const CODE_LEN = 6;

type Step = "identifier" | "code" | "pending";

function formatPhone(raw: string): string {
  if (raw.trim().startsWith("+")) return `+${raw.replace(/\D/g, "")}`;
  let digits = raw.replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("1")) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function isValidPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return value.trim().startsWith("+") ? digits.length >= 8 : digits.length === 10;
}

/**
 * Ask for a code, sending the version of the disclosure on screen so the
 * server keeps it with the code. (app/auth.ts requestCode doesn't take the
 * version yet; this is the same call with it.)
 */
async function requestCode(identifier: string): Promise<{ identifier?: string; masked?: string }> {
  const res = await fetch("/api/auth/request-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, consent: SMS_CONSENT_VERSION }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "error", data?.message ?? "Couldn’t send a code. Try again.");
  return data;
}

/** What the person is told when a request fails; nothing about providers or settings. */
function plain(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.code === "not_configured" || err.status >= 500 ? "Sign-in isn’t available right now. Try again later." : err.message;
  return fallback;
}

export default function Login() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("identifier");
  const [identifier, setIdentifier] = useState("");
  const [masked, setMasked] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const idInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const submittedCode = useRef("");

  const [params] = useSearchParams();
  // The page that sent them here (app-layout's guard), to come back to once signed in.
  const next = safeNext(params.get("next"));
  // Signing in one more account (from the account menu): say so, and offer the way back.
  const [returnTo, setReturnTo] = useState<User | null>(null);
  useEffect(() => setReturnTo(addingAccount()), []);

  useEffect(() => {
    if (isAuthenticated()) navigate(next ?? homePath(), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (step === "code") codeInput.current?.focus();
    if (step === "identifier") idInput.current?.focus();
  }, [step]);

  const valid = useMemo(() => isValidPhone(identifier), [identifier]);

  async function send(value: string) {
    setBusy(true);
    setError("");
    try {
      const res = await requestCode(value);
      setSentTo(res.identifier ?? value);
      setMasked(res.masked ?? "");
      setCode("");
      submittedCode.current = "";
      setCooldown(RESEND_SECONDS);
      setStep("code");
    } catch (err) {
      setError(plain(err, "Couldn’t send a code. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(value: string) {
    if (busy || value.length !== CODE_LEN || submittedCode.current === value) return;
    submittedCode.current = value;
    setBusy(true);
    setError("");
    try {
      const res = await verifyCode(sentTo, value);
      if (res.token) {
        setSuccess(true);
        const ready = profileComplete(res.user) && !needsTerms(res.user as { termsVersion?: string | null } | undefined);
        const to = ready ? (next ?? homePath(res.user)) : `/complete-profile${next ? `?next=${encodeURIComponent(next)}` : ""}`;
        setTimeout(() => navigate(to, { replace: true }), 600);
      } else setStep("pending");
    } catch (err) {
      setCode("");
      submittedCode.current = "";
      setError(plain(err, "Couldn’t check that code. Check your connection and try again."));
      codeInput.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setStep("identifier");
    setCode("");
    setError("");
  }

  // The number as the person typed it, when the server's masked form isn't there.
  const shownNumber = masked || identifier || "your phone";

  return (
    <DoorScreen legalInFooter={step !== "identifier"}>
      {returnTo && (
        <p className="mb-8 text-small text-door-ink-2">
          Adding another account.{" "}
          <DoorLink
            className="inline-flex min-h-0 text-small text-door-ink underline underline-offset-[3px]"
            onClick={() => {
              if (cancelAddAccount()) window.location.assign(homePath(returnTo));
            }}
          >
            Back to {displayName(returnTo)}
          </DoorLink>
        </p>
      )}

      {step === "identifier" && (
        <form
          key="identifier"
          className="ds-reveal"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) void send(identifier);
          }}
        >
          <DoorHeading step="Sign in" title="Your phone number." />
          <div className="mt-8">
            <DoorField
              ref={idInput}
              label="Phone number"
              id="identifier"
              name="identifier"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              autoFocus
              required
              invalid={!!error}
              value={identifier}
              onChange={(e) => {
                setError("");
                setIdentifier(formatPhone(e.target.value));
              }}
              placeholder="(555) 123-4567"
              aria-describedby="sms-consent"
            />
          </div>
          <div id="sms-consent" className="mt-4 text-small text-pretty text-door-ink-2">
            <p>We’ll text a 6-digit code to this number from BFO. Message and data rates may apply. Sending the code confirms the number is yours.</p>
            <LegalLinks tone="door" className="mt-1 text-small touch:[&_a]:inline-flex touch:[&_a]:min-h-[44px] touch:[&_a]:items-center" />
          </div>
          <DoorButton type="submit" className="mt-6" disabled={busy || !valid} busy={busy} busyLabel="Sending…">
            Send code
          </DoorButton>
          <DoorError>{error}</DoorError>
        </form>
      )}

      {step === "code" && (
        <form
          key="code"
          className="ds-reveal"
          onSubmit={(e) => {
            e.preventDefault();
            void submitCode(code);
          }}
        >
          <DoorHeading step="Sign in" title="Check your phone.">
            We sent a 6-digit code to <span className="whitespace-nowrap text-door-ink tabular-nums">{shownNumber}</span>. It works for 10 minutes, and you’ll stay signed in on this device for 30
            days.
          </DoorHeading>
          <div className="mt-6">
            <CodeEntry
              value={code}
              inputRef={codeInput}
              state={success ? "success" : error ? "error" : "idle"}
              onChange={(v) => {
                setCode(v);
                setError("");
              }}
              onComplete={(v) => void submitCode(v)}
            />
          </div>
          <DoorButton type="submit" className="mt-6" disabled={busy || code.length !== CODE_LEN} busy={busy && !success} busyLabel="Checking…" success={success && "You’re in"}>
            Continue
          </DoorButton>
          <DoorError>{error}</DoorError>
          <div className="mt-4 flex items-center justify-between">
            <DoorLink onClick={startOver}>Change number</DoorLink>
            <DoorLink disabled={cooldown > 0 || busy} onClick={() => void send(sentTo)} aria-live="polite">
              {resendLabel(cooldown)}
            </DoorLink>
          </div>
        </form>
      )}

      {step === "pending" && (
        <div key="pending" className="ds-reveal">
          <DoorHeading step="Sign in" title="Waiting for approval.">
            <p>
              Your number <span className="whitespace-nowrap text-door-ink tabular-nums">{shownNumber}</span> is confirmed. Ask the office to approve you; you can sign in as soon as they do.
            </p>
            <p className="mt-2">If no one approves the request within {RETENTION.waitingRequestDays} days, we delete it and your number.</p>
          </DoorHeading>
          <DoorLink className="mt-6" onClick={startOver}>
            Start over
          </DoorLink>
        </div>
      )}
    </DoorScreen>
  );
}
