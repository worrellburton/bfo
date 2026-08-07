import { useNavigate } from "react-router";
import { useState, useEffect, useRef } from "react";
import { authFetch, isAuthenticated, setSession } from "../auth";
import { ParticleCanvas } from "../particles";

type Step = "identifier" | "code" | "pending";

export default function Login() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("identifier");
  const [identifier, setIdentifier] = useState("");
  const [channel, setChannel] = useState<"sms" | "email">("email");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAuthenticated()) {
      navigate("/home");
    }
  }, [navigate]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  function fail(message: string) {
    setError(message);
    setShake(true);
    setTimeout(() => setShake(false), 500);
  }

  async function requestCode() {
    setBusy(true);
    setError("");
    try {
      const data = await authFetch("request-code", { identifier });
      setChannel(data.channel === "sms" ? "sms" : "email");
      setCode("");
      setStep("code");
      setResendIn(30);
    } catch (err: any) {
      fail(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(value: string) {
    setBusy(true);
    setError("");
    try {
      const data = await authFetch("verify-code", { identifier, code: value });
      if (data.status === "approved" && data.token) {
        setSession(data.token, data.user);
        navigate("/home");
      } else {
        setStep("pending");
      }
    } catch (err: any) {
      setCode("");
      fail(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleIdentifierSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!busy) requestCode();
  }

  function handleCodeChange(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    setError("");
    if (digits.length === 6 && !busy) {
      verifyCode(digits);
    }
  }

  const destination = channel === "sms" ? "text message" : "email";

  return (
    <div className="min-h-dvh bg-black flex items-center justify-center relative overflow-hidden">
      <ParticleCanvas
        count={60}
        speed={0.3}
        maxRadius={1.5}
        connectionDistance={120}
        dotOpacity={0.2}
        lineOpacity={0.03}
        className="absolute inset-0 w-full h-full"
      />

      <div className={`w-full max-w-sm text-center px-6 relative z-10 ${shake ? "animate-shake" : ""}`}>
        <h1 className="text-5xl font-bold text-white tracking-tight mb-2">BFO</h1>

        {step === "identifier" && (
          <>
            <p className="text-gray-500 text-sm mb-8 sm:mb-12">
              Sign in with your email or mobile number
            </p>
            <form onSubmit={handleIdentifierSubmit}>
              <input
                type="text"
                name="identifier"
                inputMode="email"
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value);
                  setError("");
                }}
                placeholder="Email or mobile number"
                required
                autoFocus
                autoComplete="username"
                className="w-full px-4 py-3 bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.12)] rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-[rgba(255,255,255,0.25)] text-center text-[17px] transition-colors"
              />
              {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full mt-4 py-3 bg-white text-black font-semibold rounded-xl hover:bg-gray-200 transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50"
              >
                {busy ? "Sending code..." : "Continue"}
              </button>
            </form>
          </>
        )}

        {step === "code" && (
          <>
            <p className="text-gray-500 text-sm mb-2">
              Enter the 6-digit code sent by {destination} to
            </p>
            <p className="text-gray-300 text-sm mb-8 font-medium break-all">{identifier}</p>

            <div className="flex justify-center gap-3 mb-6 h-4">
              {Array.from({ length: code.length }).map((_, i) => (
                <div
                  key={i}
                  className="w-3 h-3 rounded-full bg-white animate-pop"
                  style={{ animationDelay: `${i * 30}ms` }}
                />
              ))}
            </div>

            <input
              ref={codeRef}
              type="text"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => handleCodeChange(e.target.value)}
              placeholder="6-digit code"
              className="w-full px-4 py-3 bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.12)] rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-[rgba(255,255,255,0.25)] text-center text-[17px] tracking-[0.3em] transition-colors"
            />
            {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
            {busy && <p className="text-gray-500 text-sm mt-3">Verifying...</p>}

            <div className="flex items-center justify-center gap-4 mt-6 text-sm">
              <button
                type="button"
                onClick={() => {
                  setStep("identifier");
                  setCode("");
                  setError("");
                }}
                className="text-gray-500 hover:text-white transition-colors cursor-pointer"
              >
                Change email / number
              </button>
              <span className="text-gray-700">·</span>
              <button
                type="button"
                disabled={resendIn > 0 || busy}
                onClick={requestCode}
                className="text-gray-500 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
              </button>
            </div>
          </>
        )}

        {step === "pending" && (
          <>
            <div className="w-14 h-14 mx-auto mb-6 rounded-full bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.12)] flex items-center justify-center">
              <svg className="w-7 h-7 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-white text-lg font-semibold mb-2">Access requested</h2>
            <p className="text-gray-500 text-sm leading-relaxed mb-8">
              Your identity is verified and your request has been sent.
              You'll get a {destination} as soon as access is granted.
            </p>
            <button
              type="button"
              onClick={() => {
                setStep("identifier");
                setIdentifier("");
                setCode("");
                setError("");
              }}
              className="text-gray-500 hover:text-white text-sm transition-colors cursor-pointer"
            >
              Back to sign in
            </button>
          </>
        )}
      </div>

      <style>{`
        @keyframes pop {
          0% { transform: scale(0); opacity: 0; }
          50% { transform: scale(1.3); }
          100% { transform: scale(1); opacity: 1; }
        }
        .animate-pop {
          animation: pop 0.2s ease-out forwards;
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-10px); }
          40% { transform: translateX(10px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
        .animate-shake {
          animation: shake 0.4s ease-out;
        }
      `}</style>
    </div>
  );
}
