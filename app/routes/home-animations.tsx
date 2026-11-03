import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { authFetch, getUser } from "../auth";
import { setHomeAnimationNow, useBrandLogo, useHomeAnimation } from "../brand";
import { DoorMark, DoorSky } from "../door";
import { reducedMotion, useScreenLock, useTypefaceReady } from "../door-state";
import { BACKDROPS, backdropById, DEFAULT_BACKDROP } from "../home-animations";
import { canPreviewGame } from "../sign/preview";

export function meta() {
  return [{ title: "Home page animation · BFO" }];
}

/**
 * The owner's gallery of home-page backdrops (app/home-animations): each one
 * full screen with the mark over it, exactly as the front door would show
 * it. The strip along the bottom flips between them (the arrow keys too),
 * and "Use on the home page" makes one the site's (api/brand.ts
 * "home-animation"). ?pick=<id> opens on that one; ?bare=1 hides the strip,
 * for screenshots.
 */
export default function HomeAnimations() {
  const user = getUser();
  const [params, setParams] = useSearchParams();
  const logo = useBrandLogo();
  const live = useHomeAnimation();
  const ready = useTypefaceReady(logo);
  const [still, setStill] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useScreenLock();
  useEffect(() => setStill(reducedMotion()), []);

  const bare = params.get("bare") === "1";
  const picked = backdropById(params.get("pick") ?? live ?? DEFAULT_BACKDROP);
  const index = BACKDROPS.findIndex((b) => b.id === picked.id);
  const pick = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("pick", id);
    setParams(next, { replace: true });
  };
  const step = (d: number) => pick(BACKDROPS[(index + d + BACKDROPS.length) % BACKDROPS.length].id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  async function makeItLive() {
    setBusy(true);
    setError("");
    try {
      const r = await authFetch("/api/brand", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "home-animation", id: picked.id }) });
      if (!r.ok) throw new Error(`Couldn't save it (${r.status}).`);
      setHomeAnimationNow(picked.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save it.");
    } finally {
      setBusy(false);
    }
  }

  if (!canPreviewGame(user)) return <Navigate to="/home" replace />;
  const isLive = (live ?? DEFAULT_BACKDROP) === picked.id;

  return (
    <div className={`door ${ready ? "door-ready" : ""} ${still ? "door-still" : ""}`}>
      <DoorSky id={picked.id} still={still} />
      <div aria-hidden className="door-grain" />
      <div aria-hidden className="door-vignette" />
      <main className="door-center" key={picked.id}>
        <DoorMark logo={logo} still={still} />
      </main>
      {!bare && (
        <>
          <Link to="/home" className="gallery-exit">
            ← Back to BFO
          </Link>
          <div className="gallery-strip" role="region" aria-label="Home page backdrops">
            <button type="button" className="gallery-arrow" aria-label="Previous" onClick={() => step(-1)}>
              ←
            </button>
            <div className="gallery-cards">
              {BACKDROPS.map((b, i) => (
                <button key={b.id} type="button" className={`gallery-card ${b.id === picked.id ? "is-on" : ""}`} onClick={() => pick(b.id)} aria-pressed={b.id === picked.id}>
                  <span className="gallery-card-n">{i + 1}</span>
                  <span className="gallery-card-name">
                    {b.name}
                    {(live ?? DEFAULT_BACKDROP) === b.id && <span className="gallery-live">Live</span>}
                  </span>
                  <span className="gallery-card-line">{b.line}</span>
                </button>
              ))}
            </div>
            <button type="button" className="gallery-arrow" aria-label="Next" onClick={() => step(1)}>
              →
            </button>
            <div className="gallery-use">
              <button type="button" className="gallery-use-btn" onClick={() => void makeItLive()} disabled={busy || isLive}>
                {isLive ? "On the home page" : busy ? "Saving…" : "Use on the home page"}
              </button>
              {error && <span className="gallery-error">{error}</span>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
