import { useNavigate } from "react-router";
import { useState, useEffect, useRef } from "react";
import { authenticate, isAuthenticated } from "../auth";

export default function Login() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [shake, setShake] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (isAuthenticated()) {
      navigate("/");
    }
  }, [navigate]);

  // Particle background
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    const particles: { x: number; y: number; vx: number; vy: number; r: number; o: number }[] = [];

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < 60; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 1.5 + 0.5,
        o: Math.random() * 0.3 + 0.1,
      });
    }

    function draw() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas!.width;
        if (p.x > canvas!.width) p.x = 0;
        if (p.y < 0) p.y = canvas!.height;
        if (p.y > canvas!.height) p.y = 0;

        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(255, 255, 255, ${p.o})`;
        ctx!.fill();
      }

      // Draw connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx!.beginPath();
            ctx!.moveTo(particles[i].x, particles[i].y);
            ctx!.lineTo(particles[j].x, particles[j].y);
            ctx!.strokeStyle = `rgba(255, 255, 255, ${0.03 * (1 - dist / 120)})`;
            ctx!.stroke();
          }
        }
      }

      animId = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

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

  // Show dots for entered characters
  const dots = password.length;

  return (
    <div className="min-h-screen bg-black flex items-center justify-center relative overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0" />

      <div className={`w-full max-w-sm text-center px-6 relative z-10 ${shake ? "animate-shake" : ""}`}>
        <h1 className="text-5xl font-bold text-white tracking-tight mb-2">BFO</h1>
        <p className="text-gray-500 text-sm mb-12">Enter password to continue</p>

        <form onSubmit={handleSubmit}>
          {/* Password dots display */}
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
