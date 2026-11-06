import { useNavigate, useSearchParams } from "react-router";
import { useEffect, useRef, useState } from "react";
import { authFetch, getUser, homePath, isAuthenticated, isEmailOnly, isPartner, logout, profileComplete, revalidate, safeNext, type User } from "../auth";
import { CodeEntry, DoorButton, DoorError, DoorField, DoorHeading, DoorLink, DoorScreen } from "../sign-in-door";
import { resendLabel } from "../sign-in-style";
import { LegalLinks } from "../ui";
import { isFullName } from "../../lib/people";
import { needsTerms, SMS_CONSENT_VERSION, TERMS_VERSION } from "../../lib/terms";

export function meta() {
  return [{ title: "Finish setup · BFO" }];
}

/**
 * Finish setup, on the door: what an account still needs after sign-in, one
 * step at a time, each step counted ("Finish setup · 2 of 3").
 *   1. The Terms, when the person hasn't agreed to the current version: a
 *      two-line summary, both links, and "Agree and continue" (recorded by
 *      api/auth/terms.ts with the version, time and address). An outside
 *      partner also agrees to keep what they see confidential.
 *   2. Their full name, once (after that only an admin changes it).
 *   3. The email (or, for Email-only members, the phone) the account lacks,
 *      confirmed with a code before it attaches.
 * A way out on every step: Sign out.
 */

type StepId = "terms" | "name" | "collect" | "code";

function formatPhoneInput(raw: string): string {
  if (raw.trim().startsWith("+")) return `+${raw.replace(/\D/g, "")}`;
  let digits = raw.replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("1")) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** The steps this person still needs, in order. */
function stepsFor(user: User): Array<Exclude<StepId, "code">> {
  const out: Array<Exclude<StepId, "code">> = [];
  if (needsTerms(user as User & { termsVersion?: string | null })) out.push("terms");
  if (!user.name) out.push("name");
  if ((!user.email && !isEmailOnly(user) && !isPartner(user)) || !user.phone) out.push("collect");
  return out;
}

export default function CompleteProfile() {
  const navigate = useNavigate();
  // Where sign-in was headed (login's `next`), once the profile is done.
  const next = safeNext(useSearchParams()[0].get("next"));
  const [user, setUser] = useState<User | null>(null);
  const [plan, setPlan] = useState<Array<Exclude<StepId, "code">>>([]);
  const [step, setStep] = useState<StepId | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      navigate("/login", { replace: true });
      return;
    }
    const u = getUser();
    if (!u) return;
    const steps = stepsFor(u);
    if (steps.length === 0 && profileComplete(u)) {
      navigate(next ?? homePath(u), { replace: true });
      return;
    }
    setUser(u);
    setPlan(steps);
    setStep(steps[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  useEffect(() => {
    if (step === "code") codeInput.current?.focus();
  }, [step]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // What the account lacks: an email for most people, a phone for Email-only members.
  const missing: "email" | "phone" = user && !user.phone ? "phone" : "email";
  const isEmail = missing === "email";

  /** On to the next step in the plan, or into the app. */
  async function advance(from: Exclude<StepId, "code">) {
    const at = plan.indexOf(from);
    const following = plan[at + 1];
    setError("");
    if (following) {
      setStep(following);
      return;
    }
    setSuccess(true);
    await revalidate();
    setTimeout(() => navigate(next ?? homePath(getUser()), { replace: true }), 600);
  }

  async function call(path: string, body: Record<string, string>) {
    const res = await authFetch(path, { method: "POST", body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status >= 500 ? "That didn’t go through. Try again in a moment." : (data?.message ?? "That didn’t work. Try again."));
    return data;
  }

  async function agree() {
    setBusy(true);
    setError("");
    try {
      await call("/api/auth/terms", { version: TERMS_VERSION });
      await revalidate();
      await advance("terms");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t record that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveName() {
    const trimmed = name.trim().replace(/\s+/g, " ");
    if (!isFullName(trimmed)) {
      setError("Enter your full name, first and last.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await call("/api/auth/complete-profile", { name: trimmed });
      await revalidate();
      await advance("name");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save your name.");
    } finally {
      setBusy(false);
    }
  }

  async function send(to: string) {
    setBusy(true);
    setError("");
    try {
      await call("/api/auth/complete-profile", isEmail ? { identifier: to } : { identifier: to, consent: SMS_CONSENT_VERSION });
      setSentTo(to);
      setCode("");
      setCooldown(45);
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t send a code.");
    } finally {
      setBusy(false);
    }
  }

  async function check(submitted: string) {
    if (busy || submitted.length !== 6) return;
    setBusy(true);
    setError("");
    try {
      await call("/api/auth/complete-profile", { identifier: sentTo, code: submitted });
      await advance("collect");
    } catch (err) {
      setCode("");
      setError(err instanceof Error ? err.message : "Couldn’t check that code.");
      codeInput.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    logout();
    window.location.assign("/login");
  }

  if (!user || !step) return null;
  const position = step === "code" ? plan.indexOf("collect") : plan.indexOf(step);
  const stepLine = plan.length > 1 ? `Finish setup · ${position + 1} of ${plan.length}` : "Finish setup";
  const last = position === plan.length - 1;
  const partner = isPartner(user);

  return (
    <DoorScreen legalInFooter={!(step === "terms" || (step === "collect" && !isEmail))}>
      {step === "terms" && (
        <div key="terms" className="ds-reveal">
          <DoorHeading step={stepLine} title="Before you go in.">
            <ul className="mt-1 flex flex-col gap-2 text-left">
              <li>BFO is the Burton Family Office’s private system. Use it only for the office’s work, keep your sign-in to yourself, and keep what you see confidential.</li>
              <li>
                We keep what BFO needs to run and share it only with the services that run it and the people the office lets in. Answers and drafts made by AI can be wrong; check them before you rely
                on them.
              </li>
            </ul>
            <LegalLinks tone="door" className="mt-3 text-small touch:[&_a]:inline-flex touch:[&_a]:min-h-[44px] touch:[&_a]:items-center" />
          </DoorHeading>
          <p className="mt-6 text-small text-pretty text-door-ink-2">
            Choosing Agree and continue means you agree to the Terms of use and have read the Privacy notice
            {partner ? ", and that you’ll keep what you see in BFO confidential and use it only for the work you were invited for." : "."}
          </p>
          <DoorButton type="button" className="mt-4" onClick={() => void agree()} busy={busy} busyLabel="Saving…" success={success && "You’re in"}>
            Agree and continue
          </DoorButton>
          <DoorError>{error}</DoorError>
        </div>
      )}

      {step === "name" && (
        <form
          key="name"
          className="ds-reveal"
          onSubmit={(e) => {
            e.preventDefault();
            void saveName();
          }}
        >
          <DoorHeading step={stepLine} title="Your name.">
            Your full name, as it should appear on documents you send and in the record of changes.
          </DoorHeading>
          <div className="mt-8">
            <DoorField
              label="Your full name"
              words
              id="name"
              type="text"
              autoComplete="name"
              autoFocus
              required
              invalid={!!error}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
              placeholder="First and last name"
            />
          </div>
          <DoorButton type="submit" className="mt-6" disabled={busy || !isFullName(name)} busy={busy} busyLabel="Saving…" success={success && "You’re in"}>
            {last ? "Finish" : "Continue"}
          </DoorButton>
          <DoorError>{error}</DoorError>
        </form>
      )}

      {step === "collect" && (
        <form
          key="collect"
          className="ds-reveal"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) void send(value.trim());
          }}
        >
          <DoorHeading step={stepLine} title={isEmail ? "Your email." : "Your mobile number."}>
            {isEmail
              ? "Where BFO sends your copies of documents, replies to documents you send for signature, and the Treasury report if you turn it on. It isn’t used to sign in."
              : "We’ll text a 6-digit code to confirm it, from BFO. Message and data rates may apply. Sending the code confirms the number is yours."}
          </DoorHeading>
          <div className="mt-8">
            <DoorField
              label={isEmail ? "Email" : "Mobile number"}
              words={isEmail}
              id="value"
              type={isEmail ? "email" : "tel"}
              inputMode={isEmail ? "email" : "tel"}
              autoComplete={isEmail ? "email" : "tel"}
              autoFocus
              required
              invalid={!!error}
              value={value}
              onChange={(e) => {
                setValue(isEmail ? e.target.value : formatPhoneInput(e.target.value));
                setError("");
              }}
              placeholder={isEmail ? "you@example.com" : "(555) 123-4567"}
            />
          </div>
          {isEmail && user.mailAddress && value.trim().toLowerCase() !== user.mailAddress && (
            <DoorLink className="mt-2" onClick={() => setValue(user.mailAddress ?? "")}>
              Use {user.mailAddress}
            </DoorLink>
          )}
          {!isEmail && <LegalLinks tone="door" className="mt-3 text-small touch:[&_a]:inline-flex touch:[&_a]:min-h-[44px] touch:[&_a]:items-center" />}
          <DoorButton type="submit" className="mt-6" disabled={busy || !value.trim()} busy={busy} busyLabel="Sending…">
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
            void check(code);
          }}
        >
          <DoorHeading step={stepLine} title={isEmail ? "Check your email." : "Check your phone."}>
            We sent a 6-digit code to <span className="break-all text-door-ink">{sentTo}</span>. It works for 10 minutes.
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
              onComplete={(v) => void check(v)}
            />
          </div>
          <DoorButton type="submit" className="mt-6" disabled={busy || code.length !== 6} busy={busy && !success} busyLabel="Checking…" success={success && "You’re in"}>
            {last ? "Finish" : "Continue"}
          </DoorButton>
          <DoorError>{error}</DoorError>
          <div className="mt-4 flex items-center justify-between">
            <DoorLink
              onClick={() => {
                setStep("collect");
                setCode("");
                setError("");
              }}
            >
              {isEmail ? "Change email" : "Change number"}
            </DoorLink>
            <DoorLink disabled={cooldown > 0 || busy} onClick={() => void send(sentTo)} aria-live="polite">
              {resendLabel(cooldown)}
            </DoorLink>
          </div>
        </form>
      )}

      <DoorLink className="mt-6" onClick={signOut}>
        Sign out
      </DoorLink>
    </DoorScreen>
  );
}
