import { useEffect, useState } from "react";
import { Link } from "react-router";
import { lockupOf, modelOf, useBrandLogo } from "../brand";
import { BrandLockup } from "../brand-lockup";
import { Logo3D } from "../logo-3d";

export function meta() {
  return [
    { title: "BFO" },
    { name: "description", content: "BFO — Ledger Louise, LLC" },
  ];
}

/** Whether the landing page has already been seen this visit: coming back from /mission, it doesn't replay its entrance. */
let shown = false;

/** The front door. The backdrop is the public layout's (public-layout.tsx); Mission glides to /mission without a reload. */
export default function Landing() {
  const [intro] = useState(() => !shown);
  const [still, setStill] = useState(false);
  const logo = useBrandLogo();
  const model = modelOf(logo);
  const lockup = lockupOf(logo);
  useEffect(() => {
    shown = true;
    setStill(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  }, []);
  return (
    <div className={`flex min-h-dvh items-center justify-center ${intro ? "" : "no-intro"}`}>
      <div className="text-center select-none px-6">
        {model ? (
          <h1 className="landing-logo mx-auto" aria-label="BFO">
            <Logo3D src={model.glbUrl} poster={model.posterUrl} className="landing-logo-model" interactive spin={!still} exposure={1.1} />
          </h1>
        ) : (
          <h1 className="m-0 vt-mark">
            <BrandLockup font={lockup.font} finish={lockup.finish} size="hero" />
          </h1>
        )}
        <p className="landing-sub uppercase mt-4 sm:mt-6">Ledger Louise, LLC</p>
        <div className="landing-fade-in mt-10 sm:mt-12">
          <Link to="/mission" viewTransition prefetch="render" className="mission-link">
            <span>Mission</span>
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}
