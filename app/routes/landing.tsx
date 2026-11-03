import { useEffect, useState } from "react";
import { lockupOf, modelOf, useBrandLogo } from "../brand";
import { BrandLockup } from "../brand-lockup";
import { Logo3D } from "../logo-3d";
import { Orrery } from "../orrery";

export function meta() {
  return [{ title: "Burton Family Office" }, { name: "description", content: "Burton Family Office" }];
}

const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The front door: the mark, and nothing else, over the orrery (app/orrery.tsx):
 * a family's holdings as a system of rings in orbit around one light, drawn
 * in WebGL. Grain and a vignette sit over it in CSS. The mark waits for its
 * typeface, then comes in letter by letter. On a phone the page is locked:
 * nothing scrolls or bounces. Reduced motion gets one still frame and the
 * mark already in.
 */
export default function Landing() {
  const [ready, setReady] = useState(false);
  const [still, setStill] = useState(false);
  const logo = useBrandLogo();
  const model = modelOf(logo);
  const lockup = lockupOf(logo);

  useEffect(() => {
    setStill(reduced());
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      setReady(true);
    };
    const fonts = document.fonts;
    if (fonts?.load) fonts.load(`${lockup.font.weight} 10px "${lockup.font.family}"`).then(go, go);
    else go();
    const t = setTimeout(go, 700);
    return () => clearTimeout(t);
  }, [lockup.font.family, lockup.font.weight]);

  // Locked to the screen: no scrolling, no rubber-banding, while this page is up.
  useEffect(() => {
    document.documentElement.classList.add("door-lock");
    document.body.classList.add("door-lock");
    return () => {
      document.documentElement.classList.remove("door-lock");
      document.body.classList.remove("door-lock");
    };
  }, []);

  return (
    <div className={`door ${ready ? "door-ready" : ""} ${still ? "door-still" : ""}`}>
      <Orrery still={still} />
      <div aria-hidden className="door-grain" />
      <div aria-hidden className="door-vignette" />
      <main className="door-center">
        {model ? (
          <h1 className="landing-logo door-mark" aria-label="BFO">
            <Logo3D src={model.glbUrl} poster={model.posterUrl} className="landing-logo-model" interactive spin={!still} exposure={1.1} />
          </h1>
        ) : (
          <h1 className="door-mark m-0">
            <BrandLockup font={lockup.font} finish={lockup.finish} size="hero" letters />
          </h1>
        )}
      </main>
    </div>
  );
}
