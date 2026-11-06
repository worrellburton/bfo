// The game in front of the signing page on a computer (engine.ts does the
// 3D). This draws the HUD: the title screen, the prompts, the pause and
// "click to play" covers, the fade into the signing page, and the way past it,
// which is there from the first frame. Phones and tablets go straight to a
// screen whose first choice is to read and sign (screens.tsx). The game is
// optional for everyone; it never stands between a signer and the document.
// The engine and three.js load only here, through import(), so the plain
// signing page never carries them. The HUD is a dark region on the tokens.
import { useEffect, useRef, useState } from "react";
import type { Hud, JudyScript, Manifest, SigningGame } from "./engine";
import { CHROME, PhoneScreen, SkipButton, TitleScreen, type GameDocument } from "./screens";

export { PhoneScreen } from "./screens";

/** How long the controls stay on screen once the game starts. */
const CONTROLS_FOR_MS = 18_000;
const IDLE: Hud = { phase: "intro", prompt: "", paused: false, needsClick: false, dark: 0, fps: 0, objective: "", dialogue: null, ticket: false };

/** True on a computer with a mouse: the game needs pointer lock and a keyboard. */
export function canPlayHere(): boolean {
  if (typeof window === "undefined") return false;
  const fine = window.matchMedia("(pointer: fine)").matches;
  const lock = "requestPointerLock" in document.documentElement;
  const gl = (() => {
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      return false;
    }
  })();
  return fine && lock && gl && window.innerWidth >= 900;
}

export function GameGate({
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
  const game = useRef<SigningGame | null>(null);
  const [hud, setHud] = useState<Hud>(IDLE);
  const [loading, setLoading] = useState<"loading" | "ready" | "failed">("loading");
  // The controls show for the first stretch of the walk, then get out of the way.
  const [controls, setControls] = useState(true);
  useEffect(() => {
    if (hud.phase !== "outside") return;
    const t = setTimeout(() => setControls(false), CONTROLS_FOR_MS);
    return () => clearTimeout(t);
  }, [hud.phase]);

  useEffect(() => {
    if (!playable || !frame.current) return;
    let cancelled = false;
    const el = frame.current;
    (async () => {
      const [{ SigningGame, EMPTY_MANIFEST }, manifest, judy, made] = await Promise.all([
        import("./engine"),
        fetch("/game/manifest.json")
          .then((r): Promise<Partial<Manifest>> => (r.ok ? r.json() : Promise.resolve({})))
          .catch((): Partial<Manifest> => ({})),
        fetch("/game/judy.json")
          .then((r): Promise<JudyScript | null> => (r.ok ? r.json() : Promise.resolve(null)))
          .catch((): JudyScript | null => null),
        // What the game studio made on the server (api/game-assets.ts) wins over the static manifest.
        fetch("/api/game-assets")
          .then((r): Promise<Partial<Pick<Manifest, "voice" | "sounds" | "models">>> => (r.ok ? r.json() : Promise.resolve({})))
          .catch((): Partial<Pick<Manifest, "voice" | "sounds" | "models">> => ({})),
      ]);
      if (cancelled) return;
      const m: Manifest = {
        ...EMPTY_MANIFEST,
        ...manifest,
        sounds: { ...(manifest.sounds ?? {}), ...(made.sounds ?? {}) },
        models: { ...(manifest.models ?? {}), ...(made.models ?? {}) },
        voice: { ...(manifest.voice ?? {}), ...(made.voice ?? {}) },
      };
      try {
        game.current = new SigningGame(el, { signerName, title, manifest: m, judy: judy && judy.rounds ? judy : null, onHud: setHud, onDone });
        setLoading("ready");
      } catch (err) {
        console.error("signing game:", err);
        setLoading("failed");
      }
    })();
    return () => {
      cancelled = true;
      game.current?.dispose();
      game.current = null;
    };
    // The game is built once for this signer and document; the callbacks it holds are stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playable, signerName, title]);

  if (!playable) return <PhoneScreen title={title} brand={brand} document={document} preview={preview} kind="film" onSkip={onSkip} onDecline={onDecline} />;

  const walking = hud.phase === "outside" || hud.phase === "lobby" || hud.phase === "theater" || hud.phase === "exit";

  return (
    <div data-theme="dark" className="ds fixed inset-0 z-40 bg-page text-ink select-none">
      <div ref={frame} className="absolute inset-0" />

      {/* Top strip: who sent it, what it is. */}
      <div className="pointer-events-none absolute top-0 right-0 left-0 z-20 flex items-start justify-between p-4 text-small text-ink-2">
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
            <span className="rounded-full bg-sunken px-3 py-1 text-caption font-medium text-ink-2">Preview · Theater</span>
          </div>
        )}
      </div>

      {/* The next goal, small at the top. */}
      {hud.objective && walking && !hud.paused && (
        <p className="pointer-events-none absolute top-4 left-1/2 z-20 -translate-x-1/2 rounded-full px-3 py-1 text-small text-brand-ivory" style={CHROME}>
          {hud.objective}
        </p>
      )}

      {/* The controls, at the start of the game: on the island, until the signer has had a look at them. Only the keys: no story, nothing is given away. */}
      {controls && hud.phase === "outside" && !hud.paused && (
        <div
          className="pointer-events-none absolute bottom-[92px] left-1/2 z-20 w-[min(92vw,620px)] -translate-x-1/2 rounded-card px-5 py-4"
          style={{ ...CHROME, animation: "reply-in 0.5s ease-out both" }}
        >
          <p className="mb-2 text-small text-brand-ivory">Turn your sound on.</p>
          <p className="text-small font-medium text-ink">Controls</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 text-small text-ink sm:grid-cols-[auto_1fr_auto_1fr_auto_1fr] sm:gap-x-8">
            <dt className="text-ink-2">Move</dt>
            <dd>W A S D or arrows</dd>
            <dt className="text-ink-2">Look</dt>
            <dd>Mouse</dd>
            <dt className="text-ink-2">Jump</dt>
            <dd>Space</dd>
            <dt className="text-ink-2">Sit, sign</dt>
            <dd>E</dd>
            <dt className="text-ink-2">Free the mouse</dt>
            <dd>Esc</dd>
            <dt className="text-ink-2">Seated</dt>
            <dd>Move the mouse to look around</dd>
          </dl>
        </div>
      )}

      {/* Crosshair while walking. */}
      {walking && !hud.paused && <div aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 z-20 size-[6px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" />}

      {/* Talking to Judy: her subtitles, then Sam's replies. */}
      {hud.dialogue && (hud.phase === "talk" || hud.phase === "movie") && (
        <div className="absolute right-0 bottom-0 left-0 z-30 flex justify-center p-4 pb-6">
          <div className="w-full max-w-[760px]">
            <div role="status" aria-live="polite" className="rounded-card px-5 py-4 text-center" style={CHROME}>
              <span className={`flex items-center justify-center gap-2 text-small font-medium ${hud.dialogue.speaker === "You" ? "text-ink-2" : "text-brand-ivory"}`}>
                {hud.dialogue.speaker}
                {!hud.dialogue.options && hud.dialogue.speaker !== "You" && (
                  <span aria-hidden className="flex items-end gap-[2px]">
                    {[0, 1, 2, 3].map((i) => (
                      <span key={i} className="block w-[3px] rounded-mark bg-brand-ivory" style={{ height: 8, animation: `speaking 700ms ease-in-out ${i * 120}ms infinite alternate` }} />
                    ))}
                  </span>
                )}
              </span>
              <span className="mt-1 block text-title font-normal text-ink">{hud.dialogue.text}</span>
            </div>
            {hud.dialogue.options && (
              <div className="mt-2 grid gap-2">
                {hud.dialogue.options.map((o, i) => (
                  <button
                    key={o}
                    type="button"
                    style={{ animation: `reply-in 320ms ease-out ${i * 90}ms both` }}
                    onClick={() => game.current?.choose(i)}
                    className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-control border border-line-strong bg-overlay px-4 py-2 text-left text-body text-ink hover:bg-hover"
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-edge text-caption text-ink-2">{i + 1}</span>
                    {o}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* What to do next. */}
      {hud.prompt && hud.phase !== "intro" && (
        <p role="status" className="pointer-events-none absolute bottom-10 left-1/2 z-20 max-w-[90vw] -translate-x-1/2 rounded-full px-5 py-2 text-center text-body text-ink" style={CHROME}>
          {hud.prompt}
        </p>
      )}

      {/* The title screen: the document, what comes first, and the ways in and out. */}
      {hud.phase === "intro" && (
        <TitleScreen title={title} brand={brand} document={document} preview={preview} kind="film" loading={loading} onStart={() => game.current?.begin()} onSkip={onSkip} onDecline={onDecline} />
      )}

      {/* The mouse got free (Escape). */}
      {hud.paused && walking && (
        <button type="button" onClick={() => game.current?.resume()} className="absolute inset-0 z-30 flex cursor-pointer items-center justify-center text-center" style={CHROME}>
          <span>
            <span className="block text-title">Paused</span>
            <span className="mt-1 block text-body text-ink-2">Click to keep going</span>
          </span>
        </button>
      )}

      {/* The browser wouldn't start the film by itself. */}
      {hud.needsClick && hud.phase === "movie" && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <span className="rounded-full px-5 py-3 text-body" style={CHROME}>
            Click to start the film
          </span>
        </div>
      )}

      {/* The way past it, at any moment once it's running. */}
      {hud.phase !== "intro" && hud.phase !== "done" && <SkipButton onSkip={onSkip} />}

      <style>{`
        @keyframes reply-in { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes speaking { from { height: 3px; } to { height: 11px; } }
        @media (prefers-reduced-motion: reduce) { [style*="reply-in"], [style*="speaking"] { animation: none !important; } }
      `}</style>

      {/* The fade into the signing page. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-50 bg-page transition-opacity duration-300" style={{ opacity: hud.dark }} />
    </div>
  );
}
