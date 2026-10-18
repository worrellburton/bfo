import { useEffect, useState } from "react";
import { ParticleCanvas } from "../particles";
import { useBrandLogo } from "../brand";
import { Logo3D } from "../logo-3d";

export function meta() {
  return [
    { title: "BFO" },
    { name: "description", content: "BFO — Ledger Louise, LLC" },
  ];
}

export default function Landing() {
  // The orbs and wordmark already stop under reduced motion (app.css); the
  // particle field is a JS animation loop, so leave it out entirely.
  const [still, setStill] = useState(false);
  const logo = useBrandLogo();
  useEffect(() => {
    setStill(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  }, []);
  return (
    <div className="min-h-dvh bg-black relative overflow-hidden flex items-center justify-center">
      {/* Drifting aurora orbs */}
      <div aria-hidden className="absolute inset-0">
        <div className="landing-orb landing-orb-1" />
        <div className="landing-orb landing-orb-2" />
        <div className="landing-orb landing-orb-3" />
      </div>

      {/* Particle field */}
      {!still && <ParticleCanvas density={60} speed={0.24} connectionDistance={130} className="absolute inset-0 h-full w-full" />}

      {/* Wordmark */}
      <div className="relative z-10 text-center select-none px-6">
        {logo ? (
          <h1 className="landing-logo mx-auto" aria-label="BFO">
            <Logo3D src={logo.glbUrl} poster={logo.posterUrl} className="landing-logo-model" interactive spin={!still} exposure={1.1} />
          </h1>
        ) : (
          <h1 className="landing-title font-bold tracking-tight leading-none">BFO</h1>
        )}
        <p className="landing-sub uppercase mt-4 sm:mt-6">Ledger Louise, LLC</p>
      </div>
    </div>
  );
}
