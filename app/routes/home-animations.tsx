import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { authFetch, getUser, isAdmin } from "../auth";
import { setHomeAnimationNow, useBrandLogo, useHomeAnimation } from "../brand";
import { DoorMark, DoorSky } from "../door";
import { reducedMotion, useScreenLock, useTypefaceReady } from "../door-state";
import { BACKDROPS, backdropById, DEFAULT_BACKDROP } from "../home-animations";
import { Icon, Spinner } from "../ui";

export function meta() {
  return [{ title: "Home page animation · BFO" }];
}

/**
 * The owner's gallery of home-page backdrops (app/home-animations): each one
 * full screen with the mark over it, exactly as the front door would show
 * it. The strip along the bottom flips between them (the arrow keys too):
 * five cards on wider screens, one caption with position dots on a phone.
 * "Use this one on the home page" makes one the site's (api/brand.ts
 * "home-animation"); when the one shown is already live, a line says so.
 * Always dark, like the door it previews (docs/DESIGN.md §2.1).
 * ?pick=<id> opens on that one; ?bare=1 hides the strip, for screenshots.
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
      if (!r.ok) throw new Error("Couldn’t make it the home page’s backdrop. Try again.");
      setHomeAnimationNow(picked.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t make it the home page’s backdrop. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // The same rule the server applies to saving it (api/brand.ts: owner or admin).
  if (!isAdmin(user)) return <Navigate to="/home" replace />;
  const isLive = (live ?? DEFAULT_BACKDROP) === picked.id;

  return (
    <div data-theme="dark" className={`door ${ready ? "door-ready" : ""} ${still ? "door-still" : ""}`}>
      <DoorSky id={picked.id} still={still} />
      <div aria-hidden className="door-grain" />
      <div aria-hidden className="door-vignette" />
      <main className="door-center" key={picked.id}>
        <DoorMark logo={logo} still={still} />
      </main>
      {!bare && (
        <div className="ds">
          <Link
            to="/home"
            className="fixed top-[max(12px,env(safe-area-inset-top))] left-[max(12px,env(safe-area-inset-left))] z-fab inline-flex h-11 items-center gap-1 rounded-full bg-door px-4 text-small text-door-ink-2 hover:text-door-ink"
          >
            <Icon name="chevronLeft" size={16} />
            Back to BFO
          </Link>
          <div
            role="region"
            aria-label="Home page backdrops"
            className="fixed bottom-[max(12px,env(safe-area-inset-bottom))] left-1/2 z-fab flex w-[min(calc(100vw-24px),1180px)] -translate-x-1/2 flex-col gap-3 rounded-card border border-door-edge bg-door p-3 text-door-ink"
          >
            {error && (
              <p role="alert" className="text-center text-small text-door-error">
                {error}
              </p>
            )}
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Previous backdrop" onClick={() => step(-1)} className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border border-door-edge text-door-ink-2 hover:text-door-ink">
                <Icon name="chevronLeft" size={20} />
              </button>
              {/* Phones: one caption, with dots for where it is in the set. */}
              <div className="min-w-0 flex-1 text-center md:hidden" aria-live="polite">
                <p className="text-body font-medium">
                  <span className="text-door-ink-2 tabular-nums">{index + 1} of {BACKDROPS.length} · </span>
                  {picked.name}
                </p>
                <p className="mt-1 line-clamp-2 text-small text-door-ink-2">{picked.line}</p>
                <div className="mt-2 flex justify-center gap-2" aria-hidden>
                  {BACKDROPS.map((b) => (
                    <span key={b.id} className={`size-[6px] rounded-full ${b.id === picked.id ? "bg-door-ink" : "bg-door-edge"}`} />
                  ))}
                </div>
              </div>
              {/* Wider screens: the five, side by side. */}
              <div className="hidden min-w-0 flex-1 grid-cols-5 gap-2 md:grid">
                {BACKDROPS.map((b, i) => {
                  const on = b.id === picked.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => pick(b.id)}
                      aria-pressed={on}
                      className={`flex min-w-0 cursor-pointer flex-col content-start items-start gap-1 rounded-control border px-3 py-2 text-left ${on ? "border-door-success" : "border-door-edge hover:border-door-ink-2"}`}
                    >
                      <span className="flex w-full items-center gap-2 text-small font-medium">
                        <span className="text-door-ink-2 tabular-nums">{i + 1}</span>
                        <span className="min-w-0 truncate">{b.name}</span>
                        {(live ?? DEFAULT_BACKDROP) === b.id && <span className="ml-auto shrink-0 rounded-full border border-door-edge px-2 text-caption text-door-ink-2">Live</span>}
                      </span>
                      <span className="line-clamp-3 text-caption text-door-ink-2">{b.line}</span>
                    </button>
                  );
                })}
              </div>
              <button type="button" aria-label="Next backdrop" onClick={() => step(1)} className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border border-door-edge text-door-ink-2 hover:text-door-ink">
                <Icon name="chevronRight" size={20} />
              </button>
            </div>
            <div className="flex min-h-11 items-center justify-center">
              {isLive ? (
                <p className="text-small text-door-ink-2">This is on the home page.</p>
              ) : (
                <button
                  type="button"
                  onClick={() => void makeItLive()}
                  disabled={busy}
                  className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full bg-door-ink px-5 text-body font-medium text-door disabled:cursor-default"
                >
                  {busy && <Spinner />}
                  {busy ? "Saving…" : "Use this one on the home page"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
