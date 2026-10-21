import { useEffect, useState } from "react";
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

/**
 * The front door. The backdrop is the public layout's (public-layout.tsx).
 * /mission is unlisted: nothing here links to it, but its link glides back
 * here without a reload.
 */
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
      </div>
    </div>
  );
}
