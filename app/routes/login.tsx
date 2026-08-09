import { useNavigate, useSearchParams } from "react-router";
import { useEffect, useRef, useState } from "react";
import { ApiError, adoptToken, isAuthenticated, requestCode, verifyCode } from "../auth";
import { ParticleCanvas } from "../particles";

export function meta() {
  return [{ title: "Sign in — BFO" }];
}

const RESEND_SECONDS = 45;

type Step = "identifier" | "code" | "pending";

/**
 * Format as a US phone number while the field still looks like one. Anything
 * with a letter or an @ is left alone so an email address can be typed here too.
 */
function formatIdentifier(raw: string): string {
  if (/[a-zA-Z@]/.test(raw)) return raw;

  // An explicit + means the caller is giving a country code — leave it be
  // rather than forcing it into a US shape.
  if (raw.trim().startsWith("+")) return `+${raw.replace(/\D/g, "")}`;

  let digits = raw.replace(/\D/g, "");
  // Autofill and habit both supply a leading US country code. Drop it instead
  // of consuming it as the first digit of the area code.
  if (digits.length > 10 && digits.startsWith("1")) digits = digits.slice(1);
  digits = digits.slice(0, 10);

  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// The app's light-mode rescue layer rewrites bg-white/N utilities to near-white,
// which would wash this screen out — it is always dark, so use literal rgba.
const CARD = "border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.035)]";
const FIELD =
  "w-full px-4 py-3 rounded-xl bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.12)] " +
  "text-white placeholder-[rgba(255,255,255,0.28)] transition-colors focus:outline-none " +
  "focus:border-[rgba(255,255,255,0.30)] focus:bg-[rgba(255,255,255,0.09)]";

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
  const [cooldown, setCooldown] = useState(0);
  const codeInput = useRef<HTMLInputElement>(null);
  const submittedCode = useRef("");

  const [params] = useSearchParams();

  useEffect(() => {
    if (isAuthenticated()) {
      navigate("/home");
      return;
    }
    // A one-time sign-in link carries a session token; adopt it and go.
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
  }, [step]);

  function shakeOut(message: string) {
    setError(message);
    setShake(true);
    setTimeout(() => setShake(false), 450);
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
    if (busy || value.length !== 6 || submittedCode.current === value) return;
    submittedCode.current = value;
    setBusy(true);
    setError("");
    try {
      const res = await verifyCode(sentTo, value);
      if (res.token) navigate("/home");
      else setStep("pending");
    } catch (err) {
      setCode("");
      shakeOut(err instanceof ApiError ? err.message : "Couldn't verify that code.");
      codeInput.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-black relative overflow-hidden flex items-center justify-center">
      {/* Drifting aurora orbs — same atmosphere as the landing splash */}
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
        <p className="landing-sub landing-sub-sm uppercase mt-3">Ledger Louise, LLC</p>

        <div className={`landing-fade-in mt-10 rounded-2xl backdrop-blur-xl p-6 text-left ${CARD}`}>
          {step === "identifier" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(identifier);
              }}
            >
              <label
                htmlFor="identifier"
                className="block text-[11px] uppercase tracking-[0.2em] text-white/40 mb-3"
              >
                Phone or email
              </label>
              <input
                id="identifier"
                name="identifier"
                type="text"
                inputMode="tel"
                autoComplete="tel"
                autoFocus
                required
                value={identifier}
                onChange={(e) => {
                  setIdentifier(formatIdentifier(e.target.value));
                  setError("");
                }}
                placeholder="(555) 123-4567"
                className={`${FIELD} text-[16px]`}
              />
              <button
                type="submit"
                disabled={busy || !identifier.trim()}
                className="w-full mt-4 py-3 bg-white text-black font-semibold rounded-xl hover:bg-white/85 transition-all cursor-pointer active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? "Sending…" : "Send code"}
              </button>
              <p className="text-white/30 text-xs mt-4 leading-relaxed">
                We'll text or email you a one-time code. New numbers need an owner's approval before
                they can get in.
              </p>
            </form>
          )}

          {step === "code" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitCode(code);
              }}
            >
              <label
                htmlFor="code"
                className="block text-[11px] uppercase tracking-[0.2em] text-white/40 mb-1"
              >
                Enter code
              </label>
              <p className="text-white/50 text-xs mb-3">Sent to {masked}</p>
              <input
                ref={codeInput}
                id="code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={code}
                onChange={(e) => {
                  const next = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setCode(next);
                  setError("");
                  if (next.length === 6) void submitCode(next);
                }}
                placeholder="······"
                className={`${FIELD} text-center text-[22px] tracking-[0.5em] pl-[calc(1rem+0.5em)]`}
              />
              <button
                type="submit"
                disabled={busy || code.length !== 6}
                className="w-full mt-4 py-3 bg-white text-black font-semibold rounded-xl hover:bg-white/85 transition-all cursor-pointer active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? "Verifying…" : "Continue"}
              </button>

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
                  className="text-white/40 hover:text-white/70 transition-colors cursor-pointer disabled:hover:text-white/40 disabled:cursor-not-allowed"
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                </button>
              </div>
            </form>
          )}

          {step === "pending" && (
            <div className="text-center py-2">
              <div className="mx-auto w-10 h-10 rounded-full border border-white/15 bg-white/[0.06] flex items-center justify-center mb-4">
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
