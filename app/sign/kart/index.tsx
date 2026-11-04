// The race in front of the signing page (engine.ts does the 3D). This draws
// the HUD: the title screen, the controls, the countdown, the lap counter,
// the timer and the position, Judy's subtitles, the pause cover, the result
// card with "Go sign", the fade into the signing page, and the way out for
// anyone it doesn't work for. Phones and tablets get the theater's phone
// screen. The engine and three.js load only here, through import(), so the
// plain signing page never carries them. The props are the theater gate's
// exactly, so app/routes/sign.tsx can mount either.
import { useEffect, useRef, useState } from "react";
import { canPlayHere, PhoneScreen } from "../game";
import type { KartHud, KartManifest, KartRace, KartScript } from "./engine";

/** How long before "Sign the normal way" is offered, so a browser the game can't run in never blocks a signature. */
const ESCAPE_AFTER_MS = 60_000;
/** How long the controls stay on screen once the race is on. */
const CONTROLS_FOR_MS = 12_000;

const IDLE: KartHud = { phase: "intro", lap: 1, laps: 3, position: 2, time: 0, countdown: null, paused: false, dark: 0, fps: 0, dialogue: null, result: null, prompt: "" };

/** What /api/game-assets answers: the keys that begin "kart-" (sounds) and "k-" (voice) are this game's; `music` is optional. */
type Made = { sounds?: Record<string, string | null>; voice?: Record<string, string>; music?: Record<string, string | null> };

export function RaceGate({
  signerName,
  title,
  brand,
  document,
  preview,
  onDone,
  onSkip,
}: {
  signerName: string;
  title: string;
  brand: string | null;
  /** The document itself, for the title screen: its file name, length, who sent it, and where the signature goes. */
  document?: { fileName: string; pages: number; sentBy: string | null; role: string; signPages: number[]; downloadUrl?: string | null };
  /** The office looking at it: a way out at the top instead of a signature at the end. */
  preview?: boolean;
  onDone: () => void;
  onSkip: () => void;
}) {
  const [playable] = useState(canPlayHere);
  const frame = useRef<HTMLDivElement | null>(null);
  const game = useRef<KartRace | null>(null);
  const [hud, setHud] = useState<KartHud>(IDLE);
  const [loading, setLoading] = useState<"loading" | "ready" | "failed">("loading");
  const [escape, setEscape] = useState(false);
  const [controls, setControls] = useState(true);
  useEffect(() => {
    if (hud.phase !== "racing") return;
    const t = setTimeout(() => setControls(false), CONTROLS_FOR_MS);
    return () => clearTimeout(t);
  }, [hud.phase]);

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

  if (!playable) return <PhoneScreen title={title} brand={brand} document={document} preview={preview} onSkip={onSkip} />;

  const racing = hud.phase === "racing" || hud.phase === "finished";
  const inPlay = hud.phase === "ready" || hud.phase === "countdown" || hud.phase === "racing";
  const judyName = hud.dialogue?.speaker ?? "Judy";

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
          </div>
        )}
      </div>

      {/* The race: lap, time, position. */}
      {racing && !hud.paused && (
        <>
          <div className="pointer-events-none absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2 text-white">
            <span className="rounded-full border border-white/10 bg-black/55 px-4 py-1.5 text-[12px] font-semibold uppercase tracking-[0.2em] text-amber-200 backdrop-blur">
              Lap {hud.lap}/{hud.laps}
            </span>
            <span className="rounded-full border border-white/10 bg-black/55 px-4 py-1.5 font-mono text-[15px] tabular-nums tracking-wide backdrop-blur">{clock(hud.time)}</span>
          </div>
          <div className="pointer-events-none absolute bottom-8 left-6 z-20 flex items-end gap-1 text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.7)]">
            <span className={`font-[var(--font-brand)] text-[84px] leading-none ${hud.position === 1 ? "text-amber-300" : "text-white"}`}>{hud.position}</span>
            <span className="mb-3 text-[20px] text-white/70">{hud.position === 1 ? "st" : "nd"}</span>
          </div>
        </>
      )}

      {/* The controls, until the race has been on a while. Only the keys: nothing is given away. */}
      {controls && inPlay && !hud.paused && (
        <div
          className="pointer-events-none absolute bottom-[92px] left-1/2 z-20 w-[min(92vw,620px)] -translate-x-1/2 rounded-2xl border border-white/10 bg-black/55 px-5 py-4 backdrop-blur"
          style={{ animation: "reply-in 0.5s ease-out both" }}
        >
          <p className="mb-2 flex items-center gap-2 text-[13px] text-amber-200/90">
            <span aria-hidden>🔊</span>
            Turn your sound on.
          </p>
          <p className="text-[11px] uppercase tracking-[0.22em] text-amber-200/90">Controls</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 text-[12.5px] text-white/80 sm:grid-cols-[auto_1fr_auto_1fr_auto_1fr] sm:gap-x-7">
            <dt className="text-white/40">Go</dt>
            <dd>W or ↑</dd>
            <dt className="text-white/40">Brake</dt>
            <dd>S or ↓</dd>
            <dt className="text-white/40">Steer</dt>
            <dd>A D or ← →</dd>
            <dt className="text-white/40">Drift</dt>
            <dd>Hold Shift, let go for a boost</dd>
            <dt className="text-white/40">Jump</dt>
            <dd>Space</dd>
            <dt className="text-white/40">Pause</dt>
            <dd>Esc</dd>
          </dl>
        </div>
      )}

      {/* The countdown. */}
      {hud.countdown !== null && !hud.paused && (
        <div key={hud.countdown} className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center" style={{ animation: "count-in 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) both" }}>
          <span className={`font-[var(--font-brand)] leading-none drop-shadow-[0_4px_30px_rgba(0,0,0,0.8)] ${hud.countdown === 0 ? "text-[150px] text-amber-300" : "text-[180px] text-white"}`}>
            {hud.countdown === 0 ? "GO!" : hud.countdown}
          </span>
        </div>
      )}

      {/* Judy, over the pit radio. */}
      {hud.dialogue && (
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-30 flex justify-center p-4 pb-6">
          <div role="status" aria-live="polite" className="w-full max-w-[760px] rounded-2xl border border-white/10 bg-black/75 px-5 py-4 text-center backdrop-blur">
            <span className="flex items-center justify-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-amber-300">
              {judyName}
              <span aria-hidden className="flex items-end gap-[2px]">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="block w-[3px] rounded-sm bg-amber-300" style={{ height: 8, animation: `speaking 700ms ease-in-out ${i * 120}ms infinite alternate` }} />
                ))}
              </span>
            </span>
            <span className="mt-1 block text-[17px] leading-snug text-white">{hud.dialogue.text}</span>
          </div>
        </div>
      )}

      {/* A hint. */}
      {hud.prompt && hud.phase !== "intro" && !hud.dialogue && !hud.paused && (
        <p
          role="status"
          className="pointer-events-none absolute bottom-10 left-1/2 z-20 max-w-[90vw] -translate-x-1/2 rounded-full bg-black/70 px-5 py-2.5 text-center text-[14px] text-white backdrop-blur"
        >
          {hud.prompt}
        </p>
      )}

      {/* The title screen: the document to sign, full screen, Start at the bottom. */}
      {hud.phase === "intro" && (
        <div className="absolute inset-0 z-30 flex flex-col bg-[#07070a]">
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <p className="auth-eyebrow text-[11px] uppercase tracking-[0.32em] text-amber-300/80" style={rise(0)}>
              {brand || "Burton Family Office"}
            </p>
            <p className="mt-6 text-[13px] uppercase tracking-[0.22em] text-white/50" style={rise(1)}>
              A document is waiting for your signature
            </p>
            <h1 className="mt-3 max-w-[900px] font-[var(--font-brand)] text-[40px] leading-[1.05] text-white sm:text-[56px]" style={rise(2)}>
              {title}
            </h1>
            {document && (
              <div className="mt-6 flex w-full max-w-[560px] items-center gap-4 rounded-2xl border border-[#2a2a33] bg-[#141419] p-4 text-left" style={rise(3)}>
                <span className="flex h-14 w-11 shrink-0 items-center justify-center rounded-md bg-[#f4ede0] text-[10px] font-bold uppercase tracking-wider text-[#8c2a2f] shadow">PDF</span>
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium text-white">{document.fileName}</span>
                  <span className="mt-0.5 block text-[12.5px] text-white/55">
                    {document.pages} page{document.pages === 1 ? "" : "s"}
                    {document.sentBy ? ` · sent by ${document.sentBy}` : ""} · you sign as {document.role}
                  </span>
                  {document.signPages.length > 0 && <span className="mt-0.5 block text-[12.5px] text-amber-200/90">Your signature goes on page {document.signPages.join(", ")}</span>}
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-col items-center gap-3 px-6 pb-10 pt-4" style={rise(4)}>
            <button
              type="button"
              disabled={loading !== "ready"}
              onClick={() => game.current?.begin()}
              className="h-[56px] min-w-[260px] rounded-full bg-white px-10 text-[16px] font-semibold text-black shadow-[0_0_40px_rgba(255,255,255,0.18)] transition-opacity disabled:opacity-50"
            >
              {loading === "failed" ? "The track couldn't be built" : "Start signing"}
            </button>
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

      {/* Paused (Escape, or the tab went away). */}
      {hud.paused && inPlay && (
        <button type="button" onClick={() => game.current?.resume()} className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 text-center">
          <span>
            <span className="block text-[20px] font-semibold">Paused</span>
            <span className="mt-1 block text-[13px] text-white/65">Click to keep going</span>
          </span>
        </button>
      )}

      {/* The result. */}
      {hud.result && (hud.phase === "finished" || hud.phase === "done") && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center px-6">
          <div
            className="pointer-events-auto w-full max-w-[460px] rounded-3xl border border-white/10 bg-[#0b0b0f]/90 px-8 py-8 text-center backdrop-blur"
            style={{ animation: "rise-in 600ms cubic-bezier(0.2, 0.8, 0.2, 1) both" }}
          >
            <p className="text-[11px] uppercase tracking-[0.32em] text-amber-300/80">{hud.result.won ? "Checkered flag" : "Second place"}</p>
            <h2 className="mt-3 font-[var(--font-brand)] text-[44px] leading-none text-white">{hud.result.won ? "You beat Judy" : "Judy won"}</h2>
            <p className="mt-3 font-mono text-[22px] tabular-nums text-white/80">{clock(hud.result.time)}</p>
            <p className="mt-1 text-[12.5px] text-white/50">Three laps{hud.result.won ? ". She'll want a rematch." : ". She says you've still got the spreadsheet to do."}</p>
            <button
              type="button"
              onClick={() => game.current?.goSign()}
              disabled={hud.phase === "done"}
              className="mt-6 h-[52px] min-w-[220px] rounded-full bg-white px-10 text-[16px] font-semibold text-black shadow-[0_0_40px_rgba(255,255,255,0.18)] transition-opacity disabled:opacity-60"
            >
              Go sign
            </button>
          </div>
        </div>
      )}

      {/* The way out, for a browser where it never gets going. */}
      {escape && hud.phase !== "done" && (
        <button type="button" onClick={onSkip} className="absolute bottom-3 right-4 z-30 rounded-full px-3 py-1.5 text-[12px] text-white/45 hover:bg-white/10 hover:text-white">
          Having trouble? Sign the normal way
        </button>
      )}

      <style>{`
        @keyframes reply-in { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes speaking { from { height: 3px; } to { height: 11px; } }
        @keyframes rise-in { from { transform: translateY(14px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes count-in { from { transform: scale(1.6); opacity: 0; } 30% { transform: scale(1); opacity: 1; } 80% { opacity: 1; } to { transform: scale(0.9); opacity: 0; } }
      `}</style>

      {/* The fade into the signing page. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-50 bg-black transition-opacity duration-500" style={{ opacity: hud.dark }} />
    </div>
  );
}

/** Staggered entrance for the title screen's rows. */
const rise = (i: number): React.CSSProperties => ({ animation: `rise-in 600ms cubic-bezier(0.2, 0.8, 0.2, 1) ${120 + i * 110}ms both` });

/** Seconds as m:ss.t. */
function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}
