// The race in front of the signing page on a computer (engine.ts does the
// 3D). This draws the HUD: the title screen, the controls, the countdown, the
// lap counter, the timer and the position, Judy's subtitles, the pause cover;
// in the finale the letterbox bars, the on-foot objective, crosshair, reach
// prompt and taping ring, then Judy's win with "Go to the signing page" (the
// hand-over is automatic after her last line); the fade into the signing
// page, and the way past the race, there from the first frame. Phones and
// tablets get the shared phone screen, whose first choice is to read and sign
// (app/sign/game/screens.tsx). The race is optional; the signing page and its
// consent are the same after it. The engine and three.js load only here,
// through import(). The props are the theater gate's exactly, so
// app/routes/sign.tsx can mount either. The HUD is a dark region on the tokens.
import { useEffect, useRef, useState } from "react";
import { canPlayHere } from "../game";
import { CHROME, PhoneScreen, SkipButton, TitleScreen, type GameDocument } from "../game/screens";
import type { KartHud, KartManifest, KartRace, KartScript } from "./engine";
/** How long the controls stay on screen once the race is on. */
const CONTROLS_FOR_MS = 12_000;

/** How long the on-foot controls stay up. */
const FOOT_CONTROLS_FOR_MS = 10_000;

const IDLE: KartHud = {
  phase: "intro",
  lap: 1,
  laps: 2,
  position: 2,
  time: 0,
  countdown: null,
  paused: false,
  dark: 0,
  fps: 0,
  dialogue: null,
  result: null,
  prompt: "",
  cinematic: false,
  firstPerson: false,
  objective: "",
  reach: "",
  progress: null,
};

/** What /api/game-assets answers: the keys that begin "kart-" (sounds) and "k-" (voice) are this game's; `music` and `models` are optional. */
type Made = { sounds?: Record<string, string | null>; voice?: Record<string, string>; music?: Record<string, string | null>; models?: Record<string, string | null> };

export function RaceGate({
  signerName,
  title,
  brand,
  document,
  preview,
  onDone,
  onSkip,
  onDecline,
}: {
  signerName: string;
  title: string;
  brand: string | null;
  /** The document itself, for the title screen: its file name, length, who sent it, and where the signature goes. */
  document?: GameDocument;
  /** The office looking at it: a way out at the top instead of a signature at the end. */
  preview?: boolean;
  onDone: () => void;
  /** Straight to the signing page (from the first frame). */
  onSkip: () => void;
  /** Straight to the signing page with the decline open. */
  onDecline?: () => void;
}) {
  const [playable] = useState(canPlayHere);
  const frame = useRef<HTMLDivElement | null>(null);
  const game = useRef<KartRace | null>(null);
  const [hud, setHud] = useState<KartHud>(IDLE);
  const [loading, setLoading] = useState<"loading" | "ready" | "failed">("loading");
  const [controls, setControls] = useState(true);
  useEffect(() => {
    if (hud.phase !== "racing") return;
    const t = setTimeout(() => setControls(false), CONTROLS_FOR_MS);
    return () => clearTimeout(t);
  }, [hud.phase]);
  const [footControls, setFootControls] = useState(true);
  useEffect(() => {
    if (!hud.firstPerson) return;
    const t = setTimeout(() => setFootControls(false), FOOT_CONTROLS_FOR_MS);
    return () => clearTimeout(t);
  }, [hud.firstPerson]);

  useEffect(() => {
    if (!playable || !frame.current) return;
    let cancelled = false;
    const el = frame.current;
    (async () => {
      const [{ KartRace, EMPTY_KART_MANIFEST }, manifest, judy, made] = await Promise.all([
        import("./engine"),
        fetch("/kart/manifest.json")
          .then((r): Promise<Partial<KartManifest>> => (r.ok ? r.json() : Promise.resolve({})))
          .catch((): Partial<KartManifest> => ({})),
        fetch("/kart/judy.json")
          .then((r): Promise<KartScript | null> => (r.ok ? r.json() : Promise.resolve(null)))
          .catch((): KartScript | null => null),
        // What the game studio made on the server (api/game-assets.ts) wins over the static manifest.
        fetch("/api/game-assets")
          .then((r): Promise<Made> => (r.ok ? r.json() : Promise.resolve({})))
          .catch((): Made => ({})),
      ]);
      if (cancelled) return;
      const sounds: KartManifest["sounds"] = { ...(manifest.sounds ?? {}) };
      for (const [key, url] of Object.entries(made.sounds ?? {})) if (key.startsWith("kart-") && url) sounds[key as keyof KartManifest["sounds"]] = url;
      const voice: KartManifest["voice"] = { ...(manifest.voice ?? {}) };
      for (const [id, url] of Object.entries(made.voice ?? {})) if (id.startsWith("k-") && url) voice[id] = url;
      const m: KartManifest = {
        ...EMPTY_KART_MANIFEST,
        ...manifest,
        music: made.music?.["kart-laps"] || manifest.music || null,
        musicFinal: made.music?.["kart-final"] || manifest.musicFinal || null,
        sounds,
        voice,
        models: { judy: made.models?.judy || manifest.models?.judy || null },
      };
      try {
        game.current = new KartRace(el, { signerName, title, manifest: m, judy: judy && Array.isArray(judy.lines) ? judy : null, onHud: setHud, onDone });
        setLoading("ready");
      } catch (err) {
        console.error("kart race:", err);
        setLoading("failed");
      }
    })();
    return () => {
      cancelled = true;
      game.current?.dispose();
      game.current = null;
    };
    // The race is built once for this signer and document; the callbacks it holds are stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playable, signerName, title]);

  if (!playable) return <PhoneScreen title={title} brand={brand} document={document} preview={preview} kind="race" onSkip={onSkip} onDecline={onDecline} />;

  const racing = hud.phase === "racing";
  const inPlay = hud.phase === "ready" || hud.phase === "countdown" || hud.phase === "racing" || hud.phase === "finale" || hud.phase === "finished";
  /** The cut scenes and Sam on foot show none of the race HUD. */
  const bare = hud.cinematic || hud.firstPerson;
  const judyName = hud.dialogue?.speaker ?? "Judy";

  return (
    <div data-theme="dark" className="ds fixed inset-0 z-40 bg-page text-ink select-none">
      <div ref={frame} className="absolute inset-0" />

      {/* The letterbox of the finale's cut scenes. */}
      <div aria-hidden className="pointer-events-none absolute top-0 right-0 left-0 z-10 bg-page transition-[height] duration-700 ease-out" style={{ height: hud.cinematic ? "12vh" : 0 }} />
      <div aria-hidden className="pointer-events-none absolute right-0 bottom-0 left-0 z-10 bg-page transition-[height] duration-700 ease-out" style={{ height: hud.cinematic ? "12vh" : 0 }} />

      {/* Top strip: who sent it, what it is. */}
      <div className={`pointer-events-none absolute top-0 right-0 left-0 z-20 flex items-start justify-between p-4 text-small text-ink-2 transition-opacity duration-500 ${bare ? "opacity-0" : ""}`}>
        <div>
          {brand ? (
            <p className="text-section text-ink">{brand}</p>
          ) : (
            <p className="font-brand leading-none text-ink" style={{ fontSize: 20 }}>
              BFO
            </p>
          )}
          <p className="mt-1 max-w-[46vw] truncate">{title}</p>
        </div>
        {preview && hud.phase !== "intro" && (
          <div className="pointer-events-auto flex items-center gap-2">
            <span className="text-caption text-ink-2 tabular-nums">{hud.fps} fps</span>
            <span className="rounded-full bg-sunken px-3 py-1 text-caption font-medium text-ink-2">Preview · Race</span>
          </div>
        )}
      </div>

      {/* The race: lap, time, position. */}
      {racing && !hud.paused && (
        <>
          <div className="pointer-events-none absolute top-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 text-ink">
            <span className="rounded-full px-4 py-1 text-small font-medium text-brand-ivory" style={CHROME}>
              Lap {hud.lap} of {hud.laps}
            </span>
            <span className="rounded-full px-4 py-1 text-section tabular-nums" style={CHROME}>
              {clock(hud.time)}
            </span>
          </div>
          <div className="pointer-events-none absolute bottom-8 left-6 z-20 flex items-end gap-1 text-ink">
            <span className={`font-brand leading-none ${hud.position === 1 ? "text-brand-ivory" : "text-ink"}`} style={{ fontSize: 84 }}>
              {hud.position}
            </span>
            <span className="mb-3 text-title font-normal text-ink-2">{hud.position === 1 ? "st" : "nd"}</span>
          </div>
        </>
      )}

      {/* The controls, until the race has been on a while. Only the keys: nothing is given away. */}
      {controls && (hud.phase === "ready" || hud.phase === "countdown" || hud.phase === "racing") && !hud.paused && (
        <div
          className="pointer-events-none absolute bottom-[92px] left-1/2 z-20 w-[min(92vw,620px)] -translate-x-1/2 rounded-card px-5 py-4"
          style={{ ...CHROME, animation: "reply-in 0.5s ease-out both" }}
        >
          <p className="mb-2 text-small text-brand-ivory">Turn your sound on.</p>
          <p className="text-small font-medium text-ink">Controls</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 text-small text-ink sm:grid-cols-[auto_1fr_auto_1fr_auto_1fr] sm:gap-x-8">
            <dt className="text-ink-2">Go</dt>
            <dd>W or ↑</dd>
            <dt className="text-ink-2">Brake</dt>
            <dd>S or ↓</dd>
            <dt className="text-ink-2">Steer</dt>
            <dd>A D or ← →</dd>
            <dt className="text-ink-2">Drift</dt>
            <dd>Hold Shift, let go for a boost</dd>
            <dt className="text-ink-2">Jump</dt>
            <dd>Space</dd>
            <dt className="text-ink-2">Pause</dt>
            <dd>Esc</dd>
          </dl>
        </div>
      )}

      {/* The countdown. */}
      {hud.countdown !== null && !hud.paused && (
        <div key={hud.countdown} className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center" style={{ animation: "count-in 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) both" }}>
          <span className={`font-brand leading-none ${hud.countdown === 0 ? "text-brand-ivory" : "text-ink"}`} style={{ fontSize: hud.countdown === 0 ? 150 : 180 }}>
            {hud.countdown === 0 ? "Go" : hud.countdown}
          </span>
        </div>
      )}

      {/* On foot: what to do, a crosshair, what's in reach, the taping ring, and the keys for a while. */}
      {hud.firstPerson && !hud.paused && (
        <>
          {hud.objective && (
            <div className="pointer-events-none absolute top-4 left-1/2 z-20 -translate-x-1/2" style={{ animation: "reply-in 0.5s ease-out both" }} key={hud.objective}>
              <span className="block rounded-full px-5 py-2 text-small font-medium text-brand-ivory" style={CHROME}>
                {hud.objective}
              </span>
            </div>
          )}
          <div aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 z-20 size-[6px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" />
          {hud.progress !== null && (
            <svg aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 text-brand-ivory" width="84" height="84" viewBox="0 0 84 84">
              <circle cx="42" cy="42" r="34" fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth="7" />
              <circle
                cx="42"
                cy="42"
                r="34"
                fill="none"
                stroke="currentColor"
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 34}
                strokeDashoffset={2 * Math.PI * 34 * (1 - hud.progress)}
                transform="rotate(-90 42 42)"
              />
            </svg>
          )}
          {hud.reach && (
            <p role="status" className="pointer-events-none absolute top-[calc(50%+56px)] left-1/2 z-20 -translate-x-1/2 rounded-full px-4 py-1 text-body whitespace-nowrap text-ink" style={CHROME}>
              {hud.reach}
            </p>
          )}
          {footControls && (
            <div className="pointer-events-none absolute top-16 right-6 z-20 rounded-card px-4 py-3" style={{ ...CHROME, animation: "reply-in 0.5s ease-out both" }}>
              <p className="text-small font-medium text-ink">On foot</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 text-small text-ink">
                <dt className="text-ink-2">Walk</dt>
                <dd>W S or ↑ ↓</dd>
                <dt className="text-ink-2">Turn</dt>
                <dd>A D or ← →, or click and use the mouse</dd>
                <dt className="text-ink-2">Pick up, tape</dt>
                <dd>E</dd>
              </dl>
            </div>
          )}
        </>
      )}

      {/* Judy, over the pit radio. */}
      {hud.dialogue && (
        <div className="pointer-events-none absolute right-0 bottom-0 left-0 z-30 flex justify-center p-4 pb-6">
          <div role="status" aria-live="polite" className="w-full max-w-[760px] rounded-card px-5 py-4 text-center" style={CHROME}>
            <span className="flex items-center justify-center gap-2 text-small font-medium text-brand-ivory">
              {judyName}
              <span aria-hidden className="flex items-end gap-[2px]">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="block w-[3px] rounded-mark bg-brand-ivory" style={{ height: 8, animation: `speaking 700ms ease-in-out ${i * 120}ms infinite alternate` }} />
                ))}
              </span>
            </span>
            <span className="mt-1 block text-title font-normal text-ink">{hud.dialogue.text}</span>
          </div>
        </div>
      )}

      {/* A hint. */}
      {hud.prompt && hud.phase !== "intro" && !hud.dialogue && !hud.paused && (
        <p role="status" className="pointer-events-none absolute bottom-10 left-1/2 z-20 max-w-[90vw] -translate-x-1/2 rounded-full px-5 py-2 text-center text-body text-ink" style={CHROME}>
          {hud.prompt}
        </p>
      )}

      {/* The title screen: the document, what comes first, and the ways in and out. */}
      {hud.phase === "intro" && (
        <TitleScreen title={title} brand={brand} document={document} preview={preview} kind="race" loading={loading} onStart={() => game.current?.begin()} onSkip={onSkip} onDecline={onDecline} />
      )}

      {/* Paused (Escape, or the tab went away). */}
      {hud.paused && inPlay && (
        <button type="button" onClick={() => game.current?.resume()} className="absolute inset-0 z-30 flex cursor-pointer items-center justify-center text-center" style={CHROME}>
          <span>
            <span className="block text-title">Paused</span>
            <span className="mt-1 block text-body text-ink-2">Click to keep going</span>
          </span>
        </button>
      )}

      {/* Judy's win: a small card under the letterbox while she laughs; the hand-over comes on its own, or now. */}
      {hud.result && (hud.phase === "finished" || hud.phase === "done") && (
        <div className="pointer-events-none absolute top-[calc(12vh+16px)] right-0 left-0 z-30 flex justify-center px-6">
          <div
            className="pointer-events-auto flex items-center gap-5 rounded-card border border-line-strong bg-overlay px-6 py-4"
            style={{ animation: "reply-in 600ms cubic-bezier(0.2, 0.8, 0.2, 1) both" }}
          >
            <div>
              <p className="text-small text-ink-2">Checkered flag</p>
              <p className="mt-1 text-heading">Judy wins</p>
              <p className="mt-1 text-small text-ink-2">
                Two laps, one arm, a roll of tape · <span className="tabular-nums text-ink">{clock(hud.result.time)}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => game.current?.goSign()}
              disabled={hud.phase === "done"}
              className="h-11 shrink-0 cursor-pointer rounded-control bg-ink px-5 text-body font-medium text-ink-inverse hover:bg-primary-hover disabled:bg-selected disabled:text-ink-disabled"
            >
              Go to the signing page
            </button>
          </div>
        </div>
      )}

      {/* The way past it, at any moment once it's running. */}
      {hud.phase !== "intro" && hud.phase !== "done" && !hud.result && <SkipButton onSkip={onSkip} />}

      <style>{`
        @keyframes reply-in { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes speaking { from { height: 3px; } to { height: 11px; } }
        @keyframes count-in { from { transform: scale(1.6); opacity: 0; } 30% { transform: scale(1); opacity: 1; } 80% { opacity: 1; } to { transform: scale(0.9); opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { [style*="reply-in"], [style*="speaking"], [style*="count-in"] { animation: none !important; } }
      `}</style>

      {/* The fade into the signing page. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-50 bg-page transition-opacity duration-500" style={{ opacity: hud.dark }} />
    </div>
  );
}

/** Seconds as m:ss.t. */
function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}
