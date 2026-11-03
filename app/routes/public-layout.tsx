import { useEffect, useState } from "react";
import { Outlet } from "react-router";
import { ParticleCanvas } from "../particles";

/**
 * The public site (/ and /mission) shares one backdrop: an aurora that
 * slowly turns, drifting orbs (three cool, one warm), the particle field,
 * a spotlight that follows the pointer, film grain, and a vignette with a
 * warm horizon. It mounts once here and keeps moving while the pages
 * change in front of it. Moving between the pages is a view transition
 * (app.css, "Public site"): the backdrop holds still, the BFO mark glides
 * from one page's place for it to the other's, and the rest cross-fades.
 */
export default function PublicLayout() {
  // The orbs and aurora stop under reduced motion (app.css); the particle
  // field is a JS animation loop, so it's left out entirely.
  const [still, setStill] = useState(false);
  useEffect(() => {
    setStill(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  }, []);
  return (
    <div className="public-site relative min-h-dvh bg-black text-white">
      <div aria-hidden className="public-backdrop fixed inset-0 overflow-hidden">
        <div className="landing-aurora" />
        <div className="landing-orbs">
          <div className="landing-orb landing-orb-1" />
          <div className="landing-orb landing-orb-2" />
          <div className="landing-orb landing-orb-3" />
          <div className="landing-orb landing-orb-4" />
        </div>
        {!still && <ParticleCanvas density={60} speed={0.24} connectionDistance={130} className="absolute inset-0 h-full w-full" />}
        <div className="landing-bokeh">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="landing-spot" />
        <div className="landing-grain" />
        <div className="landing-vignette" />
      </div>
      <div className="relative z-10">
        <Outlet />
      </div>
    </div>
  );
}
