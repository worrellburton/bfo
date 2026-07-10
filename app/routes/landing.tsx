import { Link } from "react-router";
import { ParticleCanvas } from "../particles";

export function meta() {
  return [
    { title: "BFO" },
    { name: "description", content: "BFO — Ledger Louise, LLC" },
  ];
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-black relative overflow-hidden flex items-center justify-center">
      {/* Drifting aurora orbs */}
      <div aria-hidden className="absolute inset-0">
        <div className="landing-orb landing-orb-1" />
        <div className="landing-orb landing-orb-2" />
        <div className="landing-orb landing-orb-3" />
      </div>

      {/* Particle field */}
      <ParticleCanvas
        count={70}
        speed={0.25}
        maxRadius={1.6}
        connectionDistance={130}
        dotOpacity={0.25}
        lineOpacity={0.04}
        className="absolute inset-0 w-full h-full"
      />

      {/* Wordmark — quietly links to the password screen */}
      <Link to="/login" className="relative z-10 text-center select-none outline-none">
        <h1 className="landing-title font-bold tracking-tight leading-none">BFO</h1>
        <p className="landing-sub uppercase mt-4 sm:mt-6">Ledger Louise, LLC</p>
      </Link>

      <style>{`
        .landing-title {
          font-size: clamp(6rem, 22vw, 14rem);
          background: linear-gradient(
            115deg,
            #ffffff 25%,
            #93c5fd 42%,
            #c4b5fd 52%,
            #67e8f9 62%,
            #ffffff 80%
          );
          background-size: 220% auto;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: landing-shimmer 9s linear infinite, landing-rise 1.4s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .landing-sub {
          font-size: clamp(0.7rem, 2.2vw, 1rem);
          letter-spacing: 0.45em;
          margin-right: -0.45em; /* recenter after tracking */
          color: rgba(255, 255, 255, 0.45);
          animation: landing-rise 1.4s cubic-bezier(0.16, 1, 0.3, 1) 0.35s both;
        }
        @keyframes landing-shimmer {
          to { background-position: -220% center; }
        }
        @keyframes landing-rise {
          from { opacity: 0; transform: translateY(24px); filter: blur(8px); }
          to { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
        .landing-orb {
          position: absolute;
          width: 60vmax;
          height: 60vmax;
          border-radius: 9999px;
          filter: blur(90px);
          will-change: transform;
        }
        .landing-orb-1 {
          background: radial-gradient(circle, rgba(59, 130, 246, 0.28), transparent 65%);
          top: -20vmax;
          left: -15vmax;
          animation: landing-drift-1 26s ease-in-out infinite alternate;
        }
        .landing-orb-2 {
          background: radial-gradient(circle, rgba(139, 92, 246, 0.22), transparent 65%);
          bottom: -25vmax;
          right: -15vmax;
          animation: landing-drift-2 32s ease-in-out infinite alternate;
        }
        .landing-orb-3 {
          background: radial-gradient(circle, rgba(45, 212, 191, 0.14), transparent 65%);
          top: 30%;
          left: 35%;
          animation: landing-drift-3 38s ease-in-out infinite alternate;
        }
        @keyframes landing-drift-1 {
          from { transform: translate(0, 0) scale(1); }
          to { transform: translate(18vmax, 12vmax) scale(1.15); }
        }
        @keyframes landing-drift-2 {
          from { transform: translate(0, 0) scale(1.1); }
          to { transform: translate(-16vmax, -10vmax) scale(0.95); }
        }
        @keyframes landing-drift-3 {
          from { transform: translate(-8vmax, 6vmax) scale(0.9); }
          to { transform: translate(10vmax, -8vmax) scale(1.2); }
        }
      `}</style>
    </div>
  );
}
