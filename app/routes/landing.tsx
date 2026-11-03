import { useEffect, useState } from "react";
import { useBrandLogo, useHomeAnimation } from "../brand";
import { DoorMark, DoorSky } from "../door";
import { reducedMotion, useScreenLock, useTypefaceReady } from "../door-state";

export function meta() {
  return [{ title: "Burton Family Office" }, { name: "description", content: "Burton Family Office" }];
}

/**
 * The front door: the mark, and nothing else, over the backdrop the owner
 * chose in the gallery (app/home-animations; the "home-animation" brand
 * setting). Grain and a vignette sit over it in CSS. The mark waits for its
 * typeface, then comes in letter by letter. On a phone the page is locked:
 * nothing scrolls or bounces. Reduced motion gets one still frame and the
 * mark already in.
 */
export default function Landing() {
  const [still, setStill] = useState(false);
  const logo = useBrandLogo();
  const backdrop = useHomeAnimation();
  const ready = useTypefaceReady(logo);
  useScreenLock();
  useEffect(() => setStill(reducedMotion()), []);
  // Until the setting is known, nothing is drawn: no backdrop flashes in and then changes.
  if (backdrop === undefined) return <div className="door" />;
  return (
    <div className={`door ${ready ? "door-ready" : ""} ${still ? "door-still" : ""}`}>
      <DoorSky id={backdrop} still={still} />
      <div aria-hidden className="door-grain" />
      <div aria-hidden className="door-vignette" />
      <main className="door-center">
        <DoorMark logo={logo} still={still} />
      </main>
    </div>
  );
}
