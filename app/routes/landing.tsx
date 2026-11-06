import { useEffect, useState } from "react";
import { Link } from "react-router";
import { homePath, isAuthenticated } from "../auth";
import { useBrandLogo, useHomeAnimation } from "../brand";
import { DoorMark, DoorSky } from "../door";
import { reducedMotion, useScreenLock, useTypefaceReady } from "../door-state";
import { DoorFooter } from "../sign-in-door";
import { DOOR_FOCUS, useDoorChrome } from "../sign-in-style";
import { cx } from "../ui";

export function meta() {
  return [{ title: "Burton Family Office" }, { name: "description", content: "The private system of the Burton Family Office, for people the office has invited." }];
}

/**
 * The front door: the mark over the backdrop the owner chose in the gallery
 * (app/home-animations; the "home-animation" brand setting), and one way in.
 * The mark waits for its typeface, then comes in letter by letter; once it
 * has landed, a quiet "Sign in" fades in below it ("Open BFO" when this
 * device is already signed in; the door stays the ritual, nothing
 * redirects), with the footer every public screen carries: Terms, Privacy,
 * a way to reach the office and who runs BFO (docs/DESIGN.md §11.7, §13).
 * The grain holds still. On a phone the page is locked: nothing scrolls or
 * bounces. Reduced motion gets one still frame with everything in place.
 */
export default function Landing() {
  const [still, setStill] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const logo = useBrandLogo();
  const backdrop = useHomeAnimation();
  const ready = useTypefaceReady(logo);
  useScreenLock();
  useDoorChrome();
  useEffect(() => {
    setStill(reducedMotion());
    setSignedIn(isAuthenticated());
  }, []);
  // Until the setting is known, nothing is drawn: no backdrop flashes in and then changes.
  if (backdrop === undefined) return <div data-theme="dark" className="door" />;
  return (
    <div data-theme="dark" className={`door ${ready ? "door-ready" : ""} ${still ? "door-still" : ""}`}>
      <DoorSky id={backdrop} still={still} />
      <div aria-hidden className="door-grain" style={{ animation: "none" }} />
      <div aria-hidden className="door-vignette" />
      <main className="door-center">
        <DoorMark logo={logo} still={still} />
      </main>
      {ready && (
        <div
          className="ds-reveal absolute inset-x-0 bottom-0 flex flex-col items-center px-6 pb-[max(calc(env(safe-area-inset-bottom)+16px),24px)] font-sans"
          // After the O has landed (door-letter: 0.3s + 2 × 0.14s + 1.3s); at once in the still frame.
          style={{ animationDelay: still ? "0s" : "1.9s", animationDuration: still ? "0s" : "400ms" }}
        >
          <Link
            to={signedIn ? homePath() : "/login"}
            className={cx("inline-flex min-h-[44px] items-center px-4 text-section font-medium text-door-ink-2 transition-colors duration-(--dur-1) hover:text-door-ink", DOOR_FOCUS)}
          >
            {signedIn ? "Open BFO" : "Sign in"}
          </Link>
          <DoorFooter className="mt-6 w-full max-w-[560px]" />
        </div>
      )}
    </div>
  );
}
