import { useNavigate, useSearchParams } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, addingAccount, cancelAddAccount, displayName, homePath, isAuthenticated, profileComplete, requestCode, safeNext, verifyCode, type User } from "../auth";
import { ParticleCanvas } from "../particles";
import { lockupOf, useBrandLogo } from "../brand";
import { BrandLockup } from "../brand-lockup";

export function meta() {
  return [{ title: "Sign in — BFO" }];
}

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
 * The field's text layer: each character rides in on its own little pop, so
 * typing feels like the digits are being dealt onto the glass.
 */
function AnimatedValue({ value, dim }: { value: string; dim?: boolean }) {
  return (
    <span aria-hidden className="auth-anim-layer">
      {value.split("").map((ch, i) => (
        <span key={`${i}-${ch}`} className={`auth-char ${dim ? "opacity-60" : ""}`}>
          {ch === " " ? " " : ch}
        </span>
      ))}
    </span>
  );
}

function Spinner() {
  return <span className="auth-spinner" aria-hidden />;
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
  const [shake, setShake] = useState(false);
  const lockup = lockupOf(useBrandLogo());
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

  const valid = useMemo(
    () => isValidPhone(identifier),
    [identifier]
  );

  function shakeOut(message: string) {
    setError(message);
    setShake(true);
    setTimeout(() => setShake(false), 450);
  }

  function onIdentifierChange(raw: string) {
    setError("");
    setIdentifier(formatPhone(raw));
  }

  async function send(value: string) {
    setBusy(true);
    setError("");
    try {
      const res = await requestCode(value);
      setSentTo(res.identifier);
      setMasked(res.masked);
      setCode("");
      submittedCode.current = "";
      setCooldown(RESEND_SECONDS);
      setStep("code");
    } catch (err) {
      shakeOut(err instanceof ApiError ? err.message : "Couldn't send a code. Try again.");
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
        const to = profileComplete(res.user) ? (next ?? homePath(res.user)) : `/complete-profile${next ? `?next=${encodeURIComponent(next)}` : ""}`;
        setTimeout(() => navigate(to, { replace: true }), 700);
      } else setStep("pending");
    } catch (err) {
      setCode("");
      submittedCode.current = "";
      shakeOut(err instanceof ApiError ? err.message : "Couldn't verify that code.");
      codeInput.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  const cells = Array.from({ length: CODE_LEN }, (_, i) => code[i] ?? "");
  const activeCell = Math.min(code.length, CODE_LEN - 1);

  return (
    <div className="min-h-dvh bg-black relative overflow-hidden flex items-center justify-center">
      <div aria-hidden className="absolute inset-0">
        <div className="landing-orb landing-orb-1" />
        <div className="landing-orb landing-orb-2" />
        <div className="landing-orb landing-orb-3" />
      </div>

      <ParticleCanvas density={60} speed={0.24} connectionDistance={130} className="absolute inset-0 h-full w-full" />

      {/* No card: the lockup, a hairline and the type, set on the same field as the landing page. */}
      <div className={`relative z-10 w-full max-w-[21rem] px-6 text-center ${shake ? "landing-shake" : ""}`}>
        <h1 className="m-0 select-none">
          <BrandLockup font={lockup.font} finish={lockup.finish} size="compact" />
        </h1>

        {returnTo && (
          <p className="auth-in auth-hint mt-8">
            Adding another account.{" "}
            <button
              type="button"
              onClick={() => {
                if (cancelAddAccount()) window.location.assign(homePath(returnTo));
              }}
              className="cursor-pointer text-[#f4ede0]/85 underline-offset-4 hover:underline"
            >
              Back to {displayName(returnTo)}
            </button>
          </p>
        )}

        <div className={returnTo ? "mt-6" : "mt-12"}>
          {step === "identifier" && (
            <form
              key="identifier"
              onSubmit={(e) => {
                e.preventDefault();
                if (valid) void send(identifier);
              }}
            >
              <p className="auth-in auth-eyebrow">Sign in</p>
              <h2 className="auth-in auth-title mt-2.5">Your phone number.</h2>

              <div className="sign-field-wrap auth-in auth-delay-1 mt-7">
                <input
                  ref={idInput}
                  id="identifier"
                  name="identifier"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  autoFocus
                  required
                  aria-label="Phone number"
                  value={identifier}
                  onChange={(e) => onIdentifierChange(e.target.value)}
                  placeholder="(555) 123-4567"
                  className={`sign-field ${error ? "sign-field-error" : ""}`}
                />
                <AnimatedValue value={identifier} />
              </div>
              <p className="auth-in auth-delay-1 auth-hint mt-3">We'll text you a six-digit code.</p>

              <button type="submit" disabled={busy || !valid} className="auth-btn auth-in auth-delay-2 mt-7">
                {busy ? (
                  <>
                    <Spinner /> Sending
                  </>
                ) : (
                  "Send code"
                )}
              </button>
            </form>
          )}

          {step === "code" && (
            <form
              key="code"
              onSubmit={(e) => {
                e.preventDefault();
                void submitCode(code);
              }}
            >
              <p className="auth-in auth-eyebrow">One-time code</p>
              <h2 className="auth-in auth-title mt-2.5">Check your phone.</h2>
              <p className="auth-in auth-hint mt-2">Sent to {masked}</p>

              {/* Six digits on six rules; a hidden input keeps typing, paste and iOS code-autofill working */}
              <div className="relative auth-in auth-delay-1 mt-6" onClick={() => codeInput.current?.focus()}>
                <input
                  ref={codeInput}
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={CODE_LEN}
                  value={code}
                  onChange={(e) => {
                    const next = e.target.value.replace(/\D/g, "").slice(0, CODE_LEN);
                    setCode(next);
                    setError("");
                    if (next.length === CODE_LEN) void submitCode(next);
                  }}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  aria-label="6-digit code"
                />
                <div className="flex gap-3 justify-between" aria-hidden>
                  {cells.map((ch, i) => (
                    <div
                      key={i}
                      className={`sign-cell ${ch ? "sign-cell-filled" : ""} ${
                        !success && !error && i === activeCell && code.length < CODE_LEN ? "sign-cell-active" : ""
                      } ${success ? "sign-cell-success" : ""} ${error ? "sign-cell-error" : ""}`}
                    >
                      {ch && (
                        <span key={`${i}-${ch}`} className="auth-char">
                          {ch}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <button type="submit" disabled={busy || code.length !== CODE_LEN} className="auth-btn auth-in auth-delay-2 mt-7">
                {success ? (
                  "Welcome"
                ) : busy ? (
                  <>
                    <Spinner /> Verifying
                  </>
                ) : (
                  "Continue"
                )}
              </button>

              <p className="auth-in auth-delay-3 auth-foot mt-4">Signed in on this device for 30 days.</p>

              <div className="auth-in auth-delay-3 auth-rule mt-6" />
              <div className="flex items-center justify-between mt-3">
                <button
                  type="button"
                  onClick={() => {
                    setStep("identifier");
                    setCode("");
                    setError("");
                  }}
                  className="auth-link min-h-[40px] -ml-1 px-1"
                >
                  ← Change
                </button>
                <button type="button" disabled={cooldown > 0 || busy} onClick={() => void send(sentTo)} className="auth-link sign-resend">
                  {cooldown > 0 && <span className="sign-resend-fill" style={{ width: `${(cooldown / RESEND_SECONDS) * 100}%` }} />}
                  <span className="relative tabular-nums">{cooldown > 0 ? `Resend · ${cooldown}s` : "Resend code"}</span>
                </button>
              </div>
            </form>
          )}

          {step === "pending" && (
            <div key="pending" className="auth-in">
              <div className="mx-auto w-11 h-11 rounded-full border border-[#f4ede0]/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-[#f4ede0]/75" fill="none" stroke="currentColor" strokeWidth={1.4} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m5-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="auth-eyebrow mt-6">Verified</p>
              <h2 className="auth-title mt-2.5">One more step.</h2>
              <p className="auth-hint mt-3">An owner needs to approve access for {masked}. You'll be able to sign in once they do.</p>
              <button
                type="button"
                onClick={() => {
                  setStep("identifier");
                  setCode("");
                  setError("");
                }}
                className="auth-link mt-6 min-h-[40px] px-2"
              >
                ← Start over
              </button>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-5 text-[12.5px] text-red-300/85">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
