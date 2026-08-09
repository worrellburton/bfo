import { ParticleCanvas } from "../particles";

export function meta() {
  return [
    { title: "BFO" },
    { name: "description", content: "BFO — Ledger Louise, LLC" },
  ];
}

export default function Landing() {
  return (
    <div className="min-h-dvh bg-black relative overflow-hidden flex items-center justify-center">
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

      {/* Wordmark */}
      <div className="relative z-10 text-center select-none px-6">
        <h1 className="landing-title font-bold tracking-tight leading-none">BFO</h1>
        <p className="landing-sub uppercase mt-4 sm:mt-6">Ledger Louise, LLC</p>
      </div>
    </div>
  );
}
