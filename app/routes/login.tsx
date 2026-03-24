import { useNavigate } from "react-router";
import { useState, useEffect } from "react";
import { authenticate, isAuthenticated } from "../auth";
import { ParticleCanvas } from "../particles";

export default function Login() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) {
      navigate("/");
    }
  }, [navigate]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (authenticate(password)) {
      navigate("/");
    } else {
      setError("Incorrect password");
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  }

  const dots = password.length;

  return (
    <div className="min-h-screen bg-black flex items-center justify-center relative overflow-hidden">
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
        <p className="text-gray-500 text-sm mb-12">Enter password to continue</p>

        <form onSubmit={handleSubmit}>
          <div className="flex justify-center gap-3 mb-8 h-4">
            {Array.from({ length: Math.max(dots, 0) }).map((_, i) => (
              <div
                key={i}
                className="w-3 h-3 rounded-full bg-white animate-pop"
                style={{ animationDelay: `${i * 30}ms` }}
              />
            ))}
          </div>

          <input
            type="password"
            name="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError("");
            }}
            placeholder="Type password..."
            required
            autoFocus
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-white/20 text-center text-lg tracking-[0.3em] transition-colors"
          />

          {error && (
            <p className="text-red-400 text-sm mt-3">{error}</p>
          )}

          <button
            type="submit"
            className="w-full mt-4 py-3 bg-white text-black font-semibold rounded-xl hover:bg-gray-200 transition-all cursor-pointer active:scale-[0.98]"
          >
            Enter
          </button>
        </form>
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
