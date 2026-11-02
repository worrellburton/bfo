// The game in front of the signing page (engine.ts does the 3D). This draws
// the HUD: the start card, the prompts, the pause and "click to play" covers,
// the fade into the signing page, and the way out for anyone it doesn't work
// for. Phones and tablets are told to come back on a computer. The engine and
// three.js load only here, through import(), so the plain signing page never
// carries them.
import { useEffect, useRef, useState } from "react";
import type { Hud, JudyScript, Manifest, SigningGame } from "./engine";

/** How long before "Sign the normal way" is offered, so a browser the game can't run in never blocks a signature. */
const ESCAPE_AFTER_MS = 60_000;

const IDLE: Hud = { phase: "intro", prompt: "", paused: false, needsClick: false, dark: 0, fps: 0, dialogue: null, ticket: false };

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
  preview,
  onDone,
  onSkip,
}: {
  signerName: string;
  title: string;
  brand: string | null;
  /** The office looking at it: a way out at the top instead of a signature at the end. */
  preview?: boolean;
  onDone: () => void;
  onSkip: () => void;
}) {
  const [playable] = useState(canPlayHere);
  const frame = useRef<HTMLDivElement | null>(null);
  const game = useRef<SigningGame | null>(null);
  const [hud, setHud] = useState<Hud>(IDLE);
  const [loading, setLoading] = useState<"loading" | "ready" | "failed">("loading");
  const [escape, setEscape] = useState(false);

  useEffect(() => {
    if (!playable) return;
    const t = setTimeout(() => setEscape(true), ESCAPE_AFTER_MS);
    return () => clearTimeout(t);
  }, [playable]);

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

  if (!playable) {
    return (
      <div className="mx-auto mt-16 max-w-[520px] text-center">
        <p className="auth-eyebrow text-[11px] uppercase tracking-[0.28em] text-amber-300/80">Anything Is Possible</p>
        <h1 className="mt-3 text-[24px] font-semibold leading-tight">You'll need a computer for this one</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-white/65">
          {brand || "Burton Family Office"} sent <span className="text-white">{title}</span> with a short game in front of it, played with a keyboard and a mouse. Open the link from your email on a
          laptop or desktop to play it and sign.
        </p>
      </div>
    );
  }

  const walking = hud.phase === "outside" || hud.phase === "lobby" || hud.phase === "theater" || hud.phase === "exit";

  return (
    <div className="fixed inset-0 z-40 select-none bg-black text-white">
      <div ref={frame} className="absolute inset-0" />

      {/* Top strip: who sent it, what it is. */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex items-start justify-between p-4 text-[12px] text-white/70">
        <div>
          {brand ? <p className="font-[var(--font-brand)] text-[18px] leading-none text-white">{brand}</p> : <p className="font-[var(--font-brand)] text-[20px] leading-none text-white">BFO</p>}
          <p className="mt-1 max-w-[46vw] truncate">{title}</p>
        </div>
        {preview && (
          <div className="pointer-events-auto flex items-center gap-2">
            {hud.phase !== "intro" && <span className="tabular-nums text-[11px] text-white/45">{hud.fps} fps</span>}
            <span className="rounded-full border border-amber-300/50 bg-amber-300/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-200">Preview</span>
            <button type="button" onClick={onSkip} className="h-[32px] rounded-full border border-white/15 px-3 text-[12px] text-white/80 hover:bg-white/10">
              Skip to the signing page
            </button>
          </div>
        )}
      </div>

      {/* Crosshair while walking. */}
      {walking && !hud.paused && (
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-20 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80 ring-2 ring-black/40" />
      )}

      {/* The ticket, once Judy hands it over. */}
      {hud.ticket && hud.phase !== "intro" && (
        <div
          aria-label="Your ticket"
          className="pointer-events-none absolute right-4 top-14 z-20 rotate-3 rounded-md border border-dashed border-amber-200/70 bg-[#f4ede0] px-3 py-1.5 text-[11px] leading-tight text-[#2e0f14] shadow-lg"
        >
          <span className="block text-[9px] font-semibold uppercase tracking-[0.2em] text-[#8c2a2f]">Admit one</span>
          <span className="block font-[var(--font-brand)] text-[13px]">Anything Is Possible</span>
          <span className="block text-[10px] text-[#2e0f14]/70">Row 6, aisle · {signerName}</span>
        </div>
      )}

      {/* Talking to Judy: her subtitles, then Sam's replies. */}
      {hud.dialogue && hud.phase === "talk" && (
        <div className="absolute bottom-0 left-0 right-0 z-30 flex justify-center p-4 pb-6">
          <div className="w-full max-w-[760px]">
            <div role="status" aria-live="polite" className="rounded-2xl border border-white/10 bg-black/75 px-5 py-4 text-center backdrop-blur">
              <span className={`block text-[10.5px] font-semibold uppercase tracking-[0.2em] ${hud.dialogue.speaker === "You" ? "text-white/50" : "text-amber-300"}`}>{hud.dialogue.speaker}</span>
              <span className="mt-1 block text-[17px] leading-snug text-white">{hud.dialogue.text}</span>
              {!hud.dialogue.options && hud.dialogue.speaker !== "You" && <span className="mt-2 block text-[10.5px] text-white/35">Space skips to the end of this line</span>}
            </div>
            {hud.dialogue.options && (
              <div className="mt-2 grid gap-1.5">
                {hud.dialogue.options.map((o, i) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => game.current?.choose(i)}
                    className="flex min-h-[44px] items-center gap-3 rounded-xl border border-white/10 bg-[#0b0b0f]/90 px-4 py-2 text-left text-[14px] text-white/90 backdrop-blur transition-colors hover:border-amber-300/60 hover:bg-white/[0.06]"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/20 text-[11px] text-white/60">{i + 1}</span>
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
        <p
          role="status"
          className="pointer-events-none absolute bottom-10 left-1/2 z-20 max-w-[90vw] -translate-x-1/2 rounded-full bg-black/70 px-5 py-2.5 text-center text-[14px] text-white backdrop-blur"
        >
          {hud.prompt}
        </p>
      )}

      {/* The title screen: what they're here to sign, full screen, Start at the bottom. */}
      {hud.phase === "intro" && (
        <div className="absolute inset-0 z-30 flex flex-col bg-[#07070a]/92 backdrop-blur-sm">
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <p className="auth-eyebrow text-[11px] uppercase tracking-[0.32em] text-amber-300/80">{brand || "Burton Family Office"}</p>
            <p className="mt-6 text-[13px] uppercase tracking-[0.22em] text-white/50">You're here to sign</p>
            <h1 className="mt-3 max-w-[900px] font-[var(--font-brand)] text-[40px] leading-[1.05] text-white sm:text-[56px]">{title}</h1>
            <p className="mt-6 max-w-[640px] text-[15px] leading-relaxed text-white/65">
              Hello, {signerName}. The contract is waiting on the other side of a short film: cross the floating blocks to the theater, get your ticket from Judy, take the seat with your name on it,
              and when the film ends, climb the stairs to the contract.
            </p>
            <dl className="mt-8 grid grid-cols-2 gap-x-10 gap-y-1.5 text-left text-[12.5px] text-white/70 sm:grid-cols-3">
              <dt className="text-white/40">Move</dt>
              <dd>W A S D or arrows</dd>
              <dt className="text-white/40">Look</dt>
              <dd>Mouse</dd>
              <dt className="text-white/40">Jump</dt>
              <dd>Space</dd>
              <dt className="text-white/40">Sit, sign</dt>
              <dd>E</dd>
              <dt className="text-white/40">Free the mouse</dt>
              <dd>Esc</dd>
              <dt className="text-white/40">Seated</dt>
              <dd>Drag to look around</dd>
            </dl>
          </div>
          <div className="flex flex-col items-center gap-3 px-6 pb-10 pt-4">
            <button
              type="button"
              disabled={loading !== "ready"}
              onClick={() => game.current?.begin()}
              className="h-[56px] min-w-[260px] rounded-full bg-white px-10 text-[16px] font-semibold text-black shadow-[0_0_40px_rgba(255,255,255,0.18)] transition-opacity disabled:opacity-50"
            >
              {loading === "loading" ? "Building the theater…" : loading === "failed" ? "The theater couldn't be built" : "Start"}
            </button>
            <p className="text-[11.5px] text-white/35">Anything Is Possible · a short film, then your signature</p>
            {loading === "failed" && (
              <p className="text-[12.5px] text-white/60">
                Your browser couldn't run it.{" "}
                <button type="button" onClick={onSkip} className="underline hover:text-white">
                  Sign the normal way
                </button>
              </p>
            )}
          </div>
        </div>
      )}

      {/* The mouse got free (Escape). */}
      {hud.paused && walking && (
        <button type="button" onClick={() => game.current?.resume()} className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 text-center">
          <span>
            <span className="block text-[20px] font-semibold">Paused</span>
            <span className="mt-1 block text-[13px] text-white/65">Click to keep going</span>
          </span>
        </button>
      )}

      {/* The browser wouldn't start the film by itself. */}
      {hud.needsClick && hud.phase === "movie" && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <span className="rounded-full bg-black/70 px-5 py-3 text-[14px] backdrop-blur">▶ Click to start the film</span>
        </div>
      )}

      {/* The way out, for a browser where it never gets going. Not while Judy is talking: you sit through Judy. */}
      {escape && hud.phase !== "done" && hud.phase !== "talk" && (
        <button type="button" onClick={onSkip} className="absolute bottom-3 right-4 z-30 rounded-full px-3 py-1.5 text-[12px] text-white/45 hover:bg-white/10 hover:text-white">
          Having trouble? Sign the normal way
        </button>
      )}

      {/* The fade into the signing page. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-50 bg-black transition-opacity duration-300" style={{ opacity: hud.dark }} />
    </div>
  );
}
