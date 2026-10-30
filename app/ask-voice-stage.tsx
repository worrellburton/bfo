import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "./ask-client";
import { revealWords } from "./ask-voice";
import { ParticleGlobe, type GlobeMode } from "./particle-globe";

/**
 * The voice conversation (the default face of Ask BFO): a particle globe,
 * the words being said under it, and a hold-to-talk button. What the person
 * said shows as they said it; the answer's words appear as the voice reaches
 * them. The whole exchange runs down the side as a transcript.
 *
 * Always dark, like the landing page, whatever the app's theme.
 */

export type VoiceStatus = "idle" | "connecting" | "listening" | "transcribing" | "thinking" | "speaking";

export type Caption = { role: "user" | "assistant"; text: string } | null;

type Props = {
  status: VoiceStatus;
  /** What the assistant is looking up, while thinking. */
  tools: string[];
  caption: Caption;
  messages: ChatMessage[];
  micAvailable: boolean;
  error: string | null;
  firstName?: string | null;
  /** The mic's level while listening (0–1), and how far the voice is through the answer (0–1). */
  level: () => number;
  progress: () => number;
  onHoldStart: () => void;
  onHoldEnd: () => void;
  /** Stop the voice mid-answer. */
  onHush: () => void;
  onType: () => void;
};

const globeMode = (s: VoiceStatus): GlobeMode => (s === "listening" ? "listening" : s === "transcribing" || s === "thinking" || s === "connecting" ? "thinking" : s === "speaking" ? "speaking" : "idle");

export function VoiceStage({ status, tools, caption, messages, micAvailable, error, firstName, level, progress, onHoldStart, onHoldEnd, onHush, onType }: Props) {
  const holding = useRef(false);
  const transcript = useRef<HTMLDivElement>(null);

  // While the answer is spoken, redraw every frame so its words keep pace with the voice.
  const [, setFrame] = useState(0);
  useEffect(() => {
    if (status !== "speaking") return;
    let raf = 0;
    const tick = () => {
      setFrame((f) => f + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status]);
  const shown = !caption ? "" : caption.role === "assistant" && status === "speaking" ? revealWords(caption.text, progress()) : caption.text;

  // The transcript follows the latest exchange.
  useEffect(() => {
    const el = transcript.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, status]);

  // Hold the space bar to talk, when nothing else has the keyboard.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || typing(e) || holding.current) return;
      e.preventDefault();
      holding.current = true;
      onHoldStart();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !holding.current) return;
      e.preventDefault();
      holding.current = false;
      onHoldEnd();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [onHoldStart, onHoldEnd]);

  const busy = status === "transcribing" || status === "thinking" || status === "connecting";
  const statusLine =
    status === "listening"
      ? "Listening"
      : status === "connecting"
        ? "Connecting"
      : status === "transcribing"
        ? "Writing down what you said"
        : status === "thinking"
          ? tools.length
            ? tools[tools.length - 1]
            : "Thinking"
          : status === "speaking"
            ? "Speaking"
            : messages.length
              ? "Hold to ask something else"
              : micAvailable
                ? "Hold the button and ask"
                : "This browser has no microphone";

  const ivory = "text-[#f4ede0]";

  return (
    <div className="relative grid h-full min-h-0 overflow-hidden rounded-2xl bg-black text-[#f4ede0] lg:grid-cols-[minmax(0,1fr)_300px]">
      <div aria-hidden className="absolute inset-0">
        <div className="landing-orb landing-orb-1 opacity-60" />
        <div className="landing-orb landing-orb-3 opacity-50" />
      </div>

      {/* The stage */}
      <section className="relative flex min-h-0 flex-col items-center">
        <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
          <button type="button" onClick={onType} className="auth-link inline-flex h-9 max-md:h-[44px] md:pointer-coarse:h-[44px] items-center gap-1.5 rounded-full border border-[#f4ede0]/15 px-3.5 hover:border-[#f4ede0]/35">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h10" />
            </svg>
            Type
          </button>
        </div>

        <div className="relative flex w-full flex-1 flex-col items-center justify-center px-6 pt-6">
          <div className="relative aspect-square w-[min(50vw,38vh,360px)] max-sm:w-[min(62vw,30vh)]">
            <ParticleGlobe mode={globeMode(status)} level={level} className="absolute inset-[-30%] h-[160%] w-[160%]" />
          </div>

          <p className={`auth-eyebrow mt-12 flex items-center gap-2 ${busy || status === "speaking" || status === "listening" ? "text-[#f4ede0]/70" : ""}`}>
            {(busy || status === "listening" || status === "speaking") && <span className={`h-1.5 w-1.5 rounded-full ${status === "listening" ? "bg-red-400 ask-pulse" : status === "speaking" ? "bg-[#f4ede0] ask-pulse" : "bg-[#818cf8] ask-pulse"}`} />}
            {statusLine}
          </p>

          {/* The words */}
          <div className="mt-5 flex min-h-[7.5rem] w-full max-w-[640px] items-start justify-center text-center">
            {caption ? (
              caption.role === "user" ? (
                <p className="text-[16px] leading-relaxed text-[#f4ede0]/70 sm:text-[17px]">
                  <span className="text-[#f4ede0]/35">“</span>
                  {shown}
                  <span className="text-[#f4ede0]/35">”</span>
                </p>
              ) : (
                <p className={`font-brand text-[19px] leading-[1.45] sm:text-[23px] ${ivory}`}>
                  {shown}
                  {status === "speaking" && shown.length < caption.text.length && <span className="ask-caret" aria-hidden />}
                </p>
              )
            ) : !messages.length && status === "idle" ? (
              <p className={`font-brand text-[22px] leading-[1.35] sm:text-[26px] ${ivory}`}>{firstName ? `Hello, ${firstName}. ` : "Hello. "}Ask me anything about the office.</p>
            ) : null}
          </div>
          {error && (
            <p role="alert" className="mt-2 text-[12.5px] text-red-300/90">
              {error}
            </p>
          )}
        </div>

        {/* Hold to talk */}
        <div className="relative flex w-full flex-col items-center gap-3 pb-6 pt-2">
          {status === "speaking" ? (
            <button type="button" onClick={onHush} className="auth-link inline-flex h-9 max-md:h-[44px] md:pointer-coarse:h-[44px] items-center gap-2 rounded-full border border-[#f4ede0]/15 px-4 hover:border-[#f4ede0]/35">
              <span className="h-2.5 w-2.5 rounded-[2px] bg-current" />
              Stop
            </button>
          ) : (
            <span className="auth-link h-9 max-md:h-[44px] md:pointer-coarse:h-[44px]" aria-hidden />
          )}
          <button
            type="button"
            disabled={!micAvailable || busy}
            aria-label="Hold to talk"
            onPointerDown={(e) => {
              if (e.button !== 0 || holding.current) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              holding.current = true;
              onHoldStart();
            }}
            onPointerUp={() => {
              if (!holding.current) return;
              holding.current = false;
              onHoldEnd();
            }}
            onPointerCancel={() => {
              if (!holding.current) return;
              holding.current = false;
              onHoldEnd();
            }}
            onContextMenu={(e) => e.preventDefault()}
            className={`voice-hold grid h-[84px] w-[84px] cursor-pointer select-none place-items-center rounded-full border transition-transform disabled:cursor-default disabled:opacity-40 ${
              status === "listening" ? "voice-hold-on scale-110 border-red-400/60 bg-red-500/90 text-white" : "border-[#f4ede0]/25 bg-[#f4ede0]/[0.06] text-[#f4ede0] hover:bg-[#f4ede0]/[0.12] active:scale-95"
            }`}
            style={{ touchAction: "none", WebkitUserSelect: "none" }}
          >
            {busy ? (
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <svg className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              </svg>
            )}
          </button>
          <p className="auth-eyebrow text-[#f4ede0]/40">{status === "listening" ? "Release to send" : "Hold to talk · or hold space"}</p>
        </div>
      </section>

      {/* The transcript */}
      <aside className="relative hidden min-h-0 flex-col border-l border-[#f4ede0]/10 lg:flex">
        <p className="auth-eyebrow px-5 pt-5 text-left" style={{ marginRight: 0 }}>
          Transcript
        </p>
        <div ref={transcript} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {messages.length === 0 && !caption ? <p className="text-[12.5px] text-[#f4ede0]/35">What you say and what it answers will run here.</p> : null}
          {messages.map((m, i) => (
            <Line key={i} m={m} />
          ))}
          {caption && !messages.some((m) => m.role === caption.role && m.text === caption.text) && <Line m={{ role: caption.role, text: caption.text }} live />}
        </div>
      </aside>
    </div>
  );
}

function Line({ m, live = false }: { m: ChatMessage; live?: boolean }) {
  const you = m.role === "user";
  return (
    <div className={live ? "opacity-70" : ""}>
      <p className={`mb-1 text-[10px] uppercase tracking-[0.22em] ${you ? "text-[#f4ede0]/35" : "text-[#a5b4fc]/70"}`}>{you ? "You" : "BFO"}</p>
      <p className={`whitespace-pre-wrap text-[12.5px] leading-relaxed ${you ? "text-[#f4ede0]/75" : "text-[#f4ede0]/90"}`}>{m.text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*/g, "")}</p>
    </div>
  );
}
