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

  if (!playable) return <PhoneScreen title={title} brand={brand} document={document} preview={preview} onSkip={onSkip} />;

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

      {/* The next goal, small at the top. */}
      {hud.objective && walking && !hud.paused && (
        <p className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-amber-200/90 backdrop-blur">
          {hud.objective}
        </p>
      )}

      {/* Crosshair while walking. */}
      {walking && !hud.paused && (
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-20 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80 ring-2 ring-black/40" />
      )}

      {/* The ticket, once Judy hands it over. */}
      {hud.ticket && hud.phase !== "intro" && (
        <div
          aria-label="Your ticket"
          className="pointer-events-none absolute right-4 top-14 z-20 rotate-3 rounded-md border border-dashed border-amber-200/70 bg-[#f4ede0] px-3 py-1.5 text-[11px] leading-tight text-[#2e0f14] shadow-lg"
          style={{ animation: "ticket-in 600ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both" }}
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
              <span className={`flex items-center justify-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.2em] ${hud.dialogue.speaker === "You" ? "text-white/50" : "text-amber-300"}`}>
                {hud.dialogue.speaker}
                {!hud.dialogue.options && hud.dialogue.speaker !== "You" && (
                  <span aria-hidden className="flex items-end gap-[2px]">
                    {[0, 1, 2, 3].map((i) => (
                      <span key={i} className="block w-[3px] rounded-sm bg-amber-300" style={{ height: 8, animation: `speaking 700ms ease-in-out ${i * 120}ms infinite alternate` }} />
                    ))}
                  </span>
                )}
              </span>
              <span className="mt-1 block text-[17px] leading-snug text-white">{hud.dialogue.text}</span>
              {!hud.dialogue.options && hud.dialogue.speaker !== "You" && <span className="mt-2 block text-[10.5px] text-white/35">Space skips to the end of this line</span>}
            </div>
            {hud.dialogue.options && (
              <div className="mt-2 grid gap-1.5">
                {hud.dialogue.options.map((o, i) => (
                  <button
                    key={o}
                    type="button"
                    style={{ animation: `reply-in 320ms ease-out ${i * 90}ms both` }}
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

      {/* The title screen: the document to sign, full screen, Start at the bottom. */}
      {hud.phase === "intro" && (
        <div className="absolute inset-0 z-30 flex flex-col bg-[#07070a]/92 backdrop-blur-sm">
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
              <div className="mt-6 flex w-full max-w-[560px] items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left" style={rise(3)}>
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
            <p className="mt-6 max-w-[640px] text-[15px] leading-relaxed text-white/65" style={rise(4)}>
              Hello, {signerName}. To get to it, cross the floating blocks to the theater, collect your ticket from Judy, take the seat with your name on it, watch the film, and climb the stairs to
              the contract. Then you sign.
            </p>
            <dl className="mt-8 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-left text-[12.5px] text-white/70 sm:grid-cols-[auto_1fr_auto_1fr_auto_1fr] sm:gap-x-8" style={rise(5)}>
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
          <div className="flex flex-col items-center gap-3 px-6 pb-10 pt-4" style={rise(6)}>
            <button
              type="button"
              disabled={loading !== "ready"}
              onClick={() => game.current?.begin()}
              className="h-[56px] min-w-[260px] rounded-full bg-white px-10 text-[16px] font-semibold text-black shadow-[0_0_40px_rgba(255,255,255,0.18)] transition-opacity disabled:opacity-50"
            >
              {loading === "loading" ? "Building the theater…" : loading === "failed" ? "The theater couldn't be built" : `Start, then sign ${document ? document.fileName : title}`}
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

      <style>{`
        @keyframes ticket-in { from { transform: translate(120px, -40px) rotate(25deg); opacity: 0; } to { transform: translate(0, 0) rotate(3deg); opacity: 1; } }
        @keyframes reply-in { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes speaking { from { height: 3px; } to { height: 11px; } }
        @keyframes rise-in { from { transform: translateY(14px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>

      {/* The fade into the signing page. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-50 bg-black transition-opacity duration-300" style={{ opacity: hud.dark }} />
    </div>
  );
}

/** Staggered entrance for the title screen's rows. */
const rise = (i: number): React.CSSProperties => ({ animation: `rise-in 600ms cubic-bezier(0.2, 0.8, 0.2, 1) ${120 + i * 110}ms both` });

/**
 * What a phone or tablet gets instead of the game: the document by name,
 * the little animated island scene, and the way to come back on a computer
 * (copy the link, read the PDF now).
 */
function PhoneScreen({
  title,
  brand,
  document,
  preview,
  onSkip,
}: {
  title: string;
  brand: string | null;
  document?: { fileName: string; pages: number; sentBy: string | null; role: string; signPages: number[]; downloadUrl?: string | null };
  preview?: boolean;
  onSkip: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* the address bar still has it */
    }
  };
  const fileName = document?.fileName ?? `${title}.pdf`;
  return (
    <div className="min-h-dvh bg-[#07070a] text-white">
      <style>{`
        @keyframes rise-in { from { transform: translateY(14px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes float-y { from { transform: translateY(0); } to { transform: translateY(-10px); } }
        @keyframes drift { from { transform: translateX(-30px); } to { transform: translateX(30px); } }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
        @keyframes beam { from { opacity: 0.25; } to { opacity: 0.6; } }
      `}</style>
      <div className="mx-auto max-w-[520px] px-5 pb-12 pt-6">
        <p className="auth-eyebrow text-center text-[10.5px] uppercase tracking-[0.3em] text-amber-300/80" style={rise(0)}>
          {brand || "Burton Family Office"}
        </p>

        {/* The document, first. */}
        <div className="mt-5 flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4" style={rise(1)}>
          <span className="flex h-16 w-12 shrink-0 items-center justify-center rounded-md bg-[#f4ede0] text-[10px] font-bold uppercase tracking-wider text-[#8c2a2f] shadow-lg">PDF</span>
          <span className="min-w-0">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-white/45">Waiting for your signature</span>
            <span className="mt-1 block break-words text-[17px] font-semibold leading-snug text-white">{fileName}</span>
            {document && (
              <span className="mt-1 block text-[12.5px] text-white/55">
                {document.pages} page{document.pages === 1 ? "" : "s"}
                {document.sentBy ? ` · from ${document.sentBy}` : ""} · you sign as {document.role}
                {document.signPages.length > 0 ? ` · signature on page ${document.signPages.join(", ")}` : ""}
              </span>
            )}
          </span>
        </div>

        {/* The island, the theater, the sky: a small animated scene. */}
        <div
          className="relative mt-5 h-[220px] overflow-hidden rounded-2xl border border-white/10"
          style={{ ...rise(2), background: "linear-gradient(180deg, #2f6fc4 0%, #6fa9e6 55%, #c9ddf0 100%)" }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="absolute rounded-full bg-white/90"
              style={{
                width: 70 + i * 22,
                height: 26 + i * 6,
                left: `${8 + i * 22}%`,
                top: `${12 + (i % 2) * 22}%`,
                filter: "blur(0.5px)",
                animation: `drift ${7 + i * 2}s ease-in-out ${i * 0.7}s infinite alternate`,
              }}
            />
          ))}
          {/* The far island with the theater on it. */}
          <div className="absolute left-1/2 top-[44%] -translate-x-1/2" style={{ animation: "float-y 3.6s ease-in-out infinite alternate" }}>
            <div className="relative mx-auto h-[46px] w-[120px]">
              <div className="absolute inset-x-[18px] bottom-0 h-[28px] rounded-sm bg-[#8c2a2f]" />
              <div className="absolute inset-x-[10px] bottom-[26px] h-[14px] rounded-sm bg-[#14141a]" />
              <div className="absolute inset-x-[14px] bottom-[29px] flex justify-between px-1">
                {[0, 1, 2, 3, 4, 5, 6].map((b) => (
                  <span key={b} className="block h-[3px] w-[3px] rounded-full bg-amber-200" style={{ animation: `blink 0.7s ease-in-out ${(b % 2) * 0.35}s infinite` }} />
                ))}
              </div>
              <div className="absolute bottom-0 left-1/2 h-[10px] w-[8px] -translate-x-1/2 bg-[#5a3a1a]" />
            </div>
            <div className="h-[18px] w-[160px] rounded-[40%] bg-[#4f8a34] shadow-[0_18px_0_-6px_#5e452a]" />
          </div>
          {/* The blocks between the islands. */}
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="absolute h-[9px] w-[16px] rounded-[2px] bg-[#4f8a34] shadow-[0_5px_0_0_#5e452a]"
              style={{ left: `${30 + i * 9}%`, top: `${80 - i * 5}%`, animation: `float-y ${2.4 + i * 0.3}s ease-in-out ${i * 0.25}s infinite alternate` }}
            />
          ))}
          {/* The near island, at the bottom. */}
          <div className="absolute -bottom-[26px] left-[-10%] h-[70px] w-[70%] rounded-[50%] bg-[#4f8a34] shadow-[0_26px_0_-8px_#5e452a]" />
          <div className="absolute bottom-[6px] left-3 rounded-full bg-black/35 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-white/85">Anything Is Possible</div>
        </div>

        <h1 className="mt-6 text-[24px] font-semibold leading-tight" style={rise(3)}>
          This one's best on a computer
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-white/65" style={rise(4)}>
          Before the signature there's a short game, played with a keyboard and a mouse: across the floating blocks to the theater, a ticket from Judy, a seat with your name on it, a film, and a
          staircase to the contract. Open this same link on a laptop or desktop and it starts there.
        </p>

        <div className="mt-6 grid gap-2" style={rise(5)}>
          <button type="button" onClick={copy} className="flex h-[48px] items-center justify-center gap-2 rounded-xl bg-white text-[14px] font-semibold text-black">
            {copied ? "Link copied" : "Copy the link for your computer"}
          </button>
          {document?.downloadUrl && (
            <a href={document.downloadUrl} className="flex h-[48px] items-center justify-center rounded-xl border border-white/15 text-[14px] font-medium text-white/85">
              Read {fileName} now
            </a>
          )}
          {preview && (
            <button type="button" onClick={onSkip} className="flex h-[44px] items-center justify-center text-[13px] text-white/50">
              Skip to the signing page (preview)
            </button>
          )}
        </div>
        <p className="mt-8 text-center text-[11px] text-white/30">{brand ? "Signed electronically" : "Signed through BFO · burtonfamilyoffice.com"}</p>
      </div>
    </div>
  );
}
