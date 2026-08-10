import { useNavigate, useSearchParams } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, adoptToken, isAuthenticated, requestCode, verifyCode } from "../auth";
import { ParticleCanvas } from "../particles";

export function meta() {
  return [{ title: "Sign in — BFO" }];
}

const RESEND_SECONDS = 45;
const CODE_LEN = 6;

type Step = "identifier" | "code" | "pending";
type Mode = "phone" | "email";

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

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
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
  const [mode, setMode] = useState<Mode>("phone");
  const [identifier, setIdentifier] = useState("");
  const [masked, setMasked] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [success, setSuccess] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const idInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const submittedCode = useRef("");

  const [params] = useSearchParams();

  useEffect(() => {
    if (isAuthenticated()) {
      navigate("/home");
      return;
    }
    const handoff = params.get("t");
    if (handoff) {
      setBusy(true);
      adoptToken(handoff).then((ok) => {
        setBusy(false);
        if (ok) navigate("/home");
        else shakeOut("That sign-in link is no longer valid.");
      });
    }
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
    () => (mode === "phone" ? isValidPhone(identifier) : isValidEmail(identifier)),
    [mode, identifier]
  );

  function shakeOut(message: string) {
    setError(message);
    setShake(true);
    setTimeout(() => setShake(false), 450);
  }

  function onIdentifierChange(raw: string) {
    setError("");
    // Letters or @ mean an email is being typed, whatever the chip says.
    if (mode === "phone" && /[a-zA-Z@]/.test(raw)) {
      setMode("email");
      setIdentifier(raw);
      return;
    }
    setIdentifier(mode === "phone" ? formatPhone(raw) : raw);
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setIdentifier("");
    setError("");
    idInput.current?.focus();
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
        const complete = res.user?.email && res.user?.phone;
        setTimeout(() => navigate(complete ? "/home" : "/complete-profile"), 700);
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

      <ParticleCanvas
        count={70}
        speed={0.25}
        maxRadius={1.6}
        connectionDistance={130}
        dotOpacity={0.25}
        lineOpacity={0.04}
        className="absolute inset-0 w-full h-full"
      />

      <div className={`relative z-10 w-full max-w-sm px-6 text-center ${shake ? "landing-shake" : ""}`}>
        <h1 className="landing-title landing-title-sm font-bold tracking-tight leading-none select-none">
          BFO
        </h1>

        <div className="auth-card mt-10 p-6 text-left">
          {step === "identifier" && (
            <form
              key="identifier"
              onSubmit={(e) => {
                e.preventDefault();
                if (valid) void send(identifier);
              }}
            >
              <div className="auth-in flex items-center justify-between mb-3">
                <label
                  htmlFor="identifier"
                  className="block text-[11px] uppercase tracking-[0.2em] text-white/40"
                >
                  Sign in
                </label>
                {/* Keyboard-correct entry modes, not one field guessing */}
                <div className="flex rounded-full border border-white/10 p-0.5">
                  {(["phone", "email"] as Mode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => switchMode(m)}
                      className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors cursor-pointer ${
                        mode === m ? "bg-white text-black" : "text-white/45 hover:text-white/80"
                      }`}
                    >
                      {m === "phone" ? "Phone" : "Email"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative">
                <input
                  ref={idInput}
                  id="identifier"
                  name="identifier"
                  type={mode === "email" ? "email" : "text"}
                  inputMode={mode === "phone" ? "tel" : "email"}
                  autoComplete={mode === "phone" ? "tel" : "email"}
                  autoFocus
                  required
                  value={identifier}
                  onChange={(e) => onIdentifierChange(e.target.value)}
                  placeholder={mode === "phone" ? "(555) 123-4567" : "you@example.com"}
                  className={`auth-field auth-delay-1 auth-field-ghost text-[16px] ${error ? "auth-field-error" : ""}`}
                />
                <AnimatedValue value={identifier} />
              </div>

              <button type="submit" disabled={busy || !valid} className="auth-btn auth-in auth-delay-2 mt-4">
                {busy ? (
                  <>
                    <Spinner /> Sending…
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
              <label
                htmlFor="code"
                className="auth-in block text-[11px] uppercase tracking-[0.2em] text-white/40 mb-1"
              >
                Enter code
              </label>
              <p className="auth-in text-white/50 text-xs mb-4">Sent to {masked}</p>

              {/* Six cells; a hidden input keeps typing, paste and iOS
                  code-autofill working exactly as before */}
              <div
                className="relative auth-in auth-delay-1"
                onClick={() => codeInput.current?.focus()}
              >
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
                <div className="flex gap-2 justify-between" aria-hidden>
                  {cells.map((ch, i) => (
                    <div
                      key={i}
                      className={`auth-otp-cell ${ch ? "auth-otp-filled" : ""} ${
                        !success && !error && i === activeCell && code.length < CODE_LEN
                          ? "auth-otp-active"
                          : ""
                      } ${success ? "auth-otp-success" : ""} ${error ? "auth-otp-error" : ""}`}
                    >
                      {ch && <span key={`${i}-${ch}`} className="auth-char">{ch}</span>}
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={busy || code.length !== CODE_LEN}
                className="auth-btn auth-in auth-delay-2 mt-5"
              >
                {success ? (
                  "Welcome back"
                ) : busy ? (
                  <>
                    <Spinner /> Verifying…
                  </>
                ) : (
                  "Continue"
                )}
              </button>

              <p className="auth-in auth-delay-3 text-white/25 text-[11px] mt-3 text-center">
                You'll stay signed in on this device for 30 days.
              </p>

              <div className="flex items-center justify-between mt-4 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setStep("identifier");
                    setCode("");
                    setError("");
                  }}
                  className="text-white/40 hover:text-white/70 transition-colors cursor-pointer"
                >
                  ← Change
                </button>
                <button
                  type="button"
                  disabled={cooldown > 0 || busy}
                  onClick={() => void send(sentTo)}
                  className="relative overflow-hidden px-3 py-1.5 rounded-full border border-white/10 text-white/40 hover:text-white/70 transition-colors cursor-pointer disabled:hover:text-white/40 disabled:cursor-not-allowed"
                >
                  {cooldown > 0 && (
                    <span
                      className="absolute inset-y-0 left-0 bg-white/[0.06]"
                      style={{ width: `${(cooldown / RESEND_SECONDS) * 100}%` }}
                    />
                  )}
                  <span className="relative">
                    {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                  </span>
                </button>
              </div>
            </form>
          )}

          {step === "pending" && (
            <div key="pending" className="text-center py-2 auth-in">
              <div className="mx-auto w-10 h-10 rounded-full border border-white/15 bg-[rgba(255,255,255,0.06)] flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-white/70" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m5-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-white font-medium">You're verified</p>
              <p className="text-white/45 text-sm mt-2 leading-relaxed">
                An owner needs to approve access for {masked}. You'll be able to sign in once they do.
              </p>
              <button
                type="button"
                onClick={() => {
                  setStep("identifier");
                  setCode("");
                  setError("");
                }}
                className="mt-5 text-xs text-white/40 hover:text-white/70 transition-colors cursor-pointer"
              >
                ← Start over
              </button>
            </div>
          )}

          {error && <p className="text-red-400/90 text-sm mt-4 text-center">{error}</p>}
        </div>
      </div>
    </div>
  );
}
