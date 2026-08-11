import { useNavigate } from "react-router";
import { useEffect, useRef, useState } from "react";
import { authFetch, getUser, isAuthenticated, revalidate } from "../auth";
import { ParticleCanvas } from "../particles";

export function meta() {
  return [{ title: "Finish setup — BFO" }];
}

// Same always-dark styling as /login (literal rgba so the light-mode rescue
// layer can't wash it out).
const CARD = "auth-card";
const FIELD = "auth-field";

function formatPhoneInput(raw: string): string {
  if (raw.trim().startsWith("+")) return `+${raw.replace(/\D/g, "")}`;
  let digits = raw.replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("1")) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export default function CompleteProfile() {
  const navigate = useNavigate();
  const [missing, setMissing] = useState<"email" | "phone" | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"name" | "collect" | "code">("collect");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const [success, setSuccess] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      navigate("/login");
      return;
    }
    const user = getUser();
    if (!user) return;
    // Name comes first, then whichever identifier is missing.
    if (!user.email) setMissing("email");
    else if (!user.phone) setMissing("phone");
    if (!user.name) setStep("name");
    else if (user.email && user.phone) navigate("/home"); // nothing to collect
  }, [navigate]);

  useEffect(() => {
    if (step === "code") codeInput.current?.focus();
  }, [step]);

  function shakeOut(message: string) {
    setError(message);
    setShake(true);
    setTimeout(() => setShake(false), 450);
  }

  async function call(body: Record<string, string>) {
    const res = await authFetch("/api/auth/complete-profile", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message ?? "That didn't work. Try again.");
    return data;
  }

  async function saveName() {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      shakeOut("Enter your full name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await call({ name: trimmed });
      await revalidate();
      if (missing) setStep("collect");
      else {
        setSuccess(true);
        setTimeout(() => navigate("/home"), 700);
      }
    } catch (err) {
      shakeOut(err instanceof Error ? err.message : "Couldn't save your name.");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);
    setError("");
    try {
      await call({ identifier: value });
      setSentTo(value);
      setCode("");
      setStep("code");
    } catch (err) {
      shakeOut(err instanceof Error ? err.message : "Couldn't send a code.");
    } finally {
      setBusy(false);
    }
  }

  async function check(submitted: string) {
    if (busy || submitted.length !== 6) return;
    setBusy(true);
    setError("");
    try {
      await call({ identifier: sentTo, code: submitted });
      setSuccess(true);
      await revalidate(); // pull the updated user into the stored session
      setTimeout(() => navigate("/home"), 700);
    } catch (err) {
      setCode("");
      shakeOut(err instanceof Error ? err.message : "Couldn't verify that code.");
      codeInput.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  if (!missing && step !== "name") return null;
  const isEmail = missing === "email";

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
        <h1 className="landing-title landing-title-sm font-bold tracking-tight leading-none select-none">BFO</h1>
        <p className="landing-sub landing-sub-sm uppercase mt-3">Ledger Louise, LLC</p>

        <div className={`mt-10 p-6 text-left ${CARD}`}>
          {step === "name" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveName();
              }}
            >
              <label
                htmlFor="name"
                className="block text-[11px] uppercase tracking-[0.2em] text-white/40 mb-1"
              >
                Your name
              </label>
              <p className="text-white/50 text-xs mb-3">
                So everyone knows who's who — this is how you'll appear across BFO.
              </p>
              <input
                id="name"
                type="text"
                autoComplete="name"
                autoFocus
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError("");
                }}
                placeholder="First and last name"
                className={`${FIELD} auth-delay-1 text-[16px] ${success ? "auth-field-success" : ""}`}
              />
              <button
                type="submit"
                disabled={busy || name.trim().length < 2}
                className="auth-btn auth-in auth-delay-2 mt-4"
              >
                {success ? "All set" : busy ? "Saving…" : missing ? "Continue" : "Finish"}
              </button>
            </form>
          ) : step === "collect" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <label
                htmlFor="value"
                className="block text-[11px] uppercase tracking-[0.2em] text-white/40 mb-1"
              >
                {isEmail ? "Add your email" : "Add your phone"}
              </label>
              <p className="text-white/50 text-xs mb-3">
                Every account needs both a phone number and an email. One more step and you're in.
              </p>
              <input
                id="value"
                type="text"
                inputMode={isEmail ? "email" : "tel"}
                autoComplete={isEmail ? "email" : "tel"}
                autoFocus
                required
                value={value}
                onChange={(e) => {
                  setValue(isEmail ? e.target.value : formatPhoneInput(e.target.value));
                  setError("");
                }}
                placeholder={isEmail ? "you@example.com" : "(555) 123-4567"}
                className={`${FIELD} auth-delay-1 text-[16px]`}
              />
              <button
                type="submit"
                disabled={busy || !value.trim()}
                className="auth-btn auth-in auth-delay-2 mt-4"
              >
                {busy ? "Sending…" : "Send code"}
              </button>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void check(code);
              }}
            >
              <label htmlFor="code" className="block text-[11px] uppercase tracking-[0.2em] text-white/40 mb-1">
                Enter code
              </label>
              <p className="text-white/50 text-xs mb-3">Sent to {sentTo}</p>
              <input
                ref={codeInput}
                id="code"
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
                  if (next.length === 6) void check(next);
                }}
                placeholder="······"
                className={`${FIELD} auth-delay-1 text-center text-[22px] tracking-[0.5em] pl-[calc(1rem+0.5em)] ${success ? "auth-field-success" : error ? "auth-field-error" : ""}`}
              />
              <button
                type="submit"
                disabled={busy || code.length !== 6}
                className="auth-btn auth-in auth-delay-2 mt-4"
              >
                {success ? "All set" : busy ? "Verifying…" : "Finish"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("collect");
                  setCode("");
                  setError("");
                }}
                className="mt-4 text-xs text-white/40 hover:text-white/70 transition-colors cursor-pointer"
              >
                ← Change
              </button>
            </form>
          )}

          {error && <p className="text-red-400/90 text-sm mt-4 text-center">{error}</p>}
        </div>
      </div>
    </div>
  );
}
