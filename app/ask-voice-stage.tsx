import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "./ask-client";
import { revealWords } from "./ask-voice";
import { ParticleGlobe, type GlobeMode } from "./particle-globe";
import { cx, Spinner, useFinePointer } from "./ui";

/**
 * The voice conversation: a particle globe that shows listening, thinking
 * and speaking, the words being said under it, and a hold-to-talk button.
 * What the person said shows as they said it; the answer's words appear as
 * the voice reaches them. Once there's an exchange, it runs down the side as
 * a transcript, with what each answer read.
 *
 * The voice room is a brand moment, so it's drawn in the door's night
 * palette (docs/DESIGN.md §2.7); the page around it sets data-theme="dark"
 * and fills the content area, so it never sits as a dark box in a light page.
 * One line says what to do (under the button); the line above the words is
 * live status only, announced to screen readers.
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
};

const globeMode = (s: VoiceStatus): GlobeMode =>
  s === "listening" ? "listening" : s === "transcribing" || s === "thinking" || s === "connecting" ? "thinking" : s === "speaking" ? "speaking" : "idle";

export function VoiceStage({ status, tools, caption, messages, micAvailable, error, firstName, level, progress, onHoldStart, onHoldEnd, onHush }: Props) {
  const holding = useRef(false);
  const transcript = useRef<HTMLDivElement>(null);
  const keyboard = useFinePointer();

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
      return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName) || !!el.closest("[role=dialog],[role=menu],[role=listbox]"));
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
  const live =
    status === "listening"
      ? "Listening. Let go to send."
      : status === "connecting"
        ? "Connecting…"
        : status === "transcribing"
          ? "Writing down what you said…"
          : status === "thinking"
            ? `${tools.length ? tools[tools.length - 1] : "Thinking"}…`
            : status === "speaking"
              ? "Speaking"
              : "";
  const hasTranscript = messages.length > 0 || !!caption;

  return (
    <div className={cx("grid h-full min-h-0 text-door-ink", hasTranscript && "lg:grid-cols-[minmax(0,1fr)_320px]")}>
      {/* The stage */}
      <section className="relative flex min-h-0 flex-col items-center justify-center gap-6 px-4 py-6">
        <div className="relative aspect-square w-[min(48vw,32vh,320px)] max-sm:w-[min(56vw,26vh)]">
          <ParticleGlobe mode={globeMode(status)} level={level} className="absolute inset-[-30%] h-[160%] w-[160%]" />
        </div>

        {/* Live status: only while something is happening. */}
        <p role="status" aria-live="polite" className={cx("min-h-[20px] text-small", status === "listening" ? "text-door-ink" : "text-door-ink-2")}>
          {live}
        </p>

        {/* The words */}
        <div className="flex min-h-[96px] w-full max-w-[640px] items-start justify-center text-center">
          {caption ? (
            caption.role === "user" ? (
              <p className="text-reading text-door-ink-2">“{shown}”</p>
            ) : (
              <p className="text-title font-normal text-door-ink">
                {shown}
                {status === "speaking" && shown.length < caption.text.length && <span className="ask-caret" aria-hidden />}
              </p>
            )
          ) : !messages.length && status === "idle" ? (
            <p className="text-heading text-door-ink">{firstName ? `Hello, ${firstName}. ` : "Hello. "}What would you like to know about the office?</p>
          ) : null}
        </div>
        {error && (
          <p role="alert" className="max-w-[560px] text-center text-small text-door-error">
            {error}
          </p>
        )}

        {/* Hold to talk */}
        <div className="flex flex-col items-center gap-4">
          {status === "speaking" ? (
            <button
              type="button"
              onClick={onHush}
              className="inline-flex h-(--control-sm) cursor-pointer items-center gap-2 rounded-full border border-door-edge px-4 text-small text-door-ink hover:border-door-ink-2"
            >
              <span className="size-[10px] rounded-[2px] bg-current" aria-hidden />
              Stop speaking
            </button>
          ) : (
            <span className="h-(--control-sm)" aria-hidden />
          )}
          <button
            type="button"
            disabled={!micAvailable || busy}
            aria-label="Hold to talk"
            aria-pressed={status === "listening"}
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
            className={cx(
              "voice-hold grid size-[84px] cursor-pointer place-items-center rounded-full border select-none disabled:cursor-default disabled:border-door-edge disabled:text-door-ink-3",
              status === "listening" ? "voice-hold-on border-danger bg-danger text-on-danger" : "border-door-edge text-door-ink hover:border-door-ink-2",
            )}
            style={{ touchAction: "none", WebkitUserSelect: "none" }}
          >
            {busy ? (
              <Spinner className="size-[24px]" />
            ) : (
              <svg className="size-[32px]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
                />
              </svg>
            )}
          </button>
          <p className="text-small text-door-ink-2">{!micAvailable ? "This browser has no microphone. Use Text instead." : keyboard ? "Hold to talk, or hold Space" : "Hold to talk"}</p>
        </div>
        <p className="max-w-[520px] text-center text-caption text-pretty text-door-ink-2">
          Answers come from BFO’s records and can be wrong. Not legal or tax advice. Your voice goes to OpenAI to be understood and answered; the words are saved to History.
        </p>
      </section>

      {/* The transcript, once there is one */}
      {hasTranscript && (
        <aside aria-label="Transcript" className="hidden min-h-0 flex-col border-l border-door-edge lg:flex">
          <h2 className="px-5 pt-5 text-small font-medium text-door-ink-2">Transcript</h2>
          <div ref={transcript} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {messages.map((m, i) => (
              <Line key={i} m={m} />
            ))}
            {caption && !messages.some((m) => m.role === caption.role && m.text === caption.text) && <Line m={{ role: caption.role, text: caption.text }} live />}
          </div>
          <p className="border-t border-door-edge px-5 py-3 text-caption text-door-ink-2">Saved to History until you delete it.</p>
        </aside>
      )}
    </div>
  );
}

function Line({ m, live = false }: { m: ChatMessage; live?: boolean }) {
  const you = m.role === "user";
  return (
    <div>
      <p className="mb-1 text-caption font-medium text-door-ink-2">{you ? "You" : live ? "BFO, speaking" : "BFO"}</p>
      <p className={cx("text-small whitespace-pre-wrap", you ? "text-door-ink-2" : "text-door-ink")}>{m.text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*/g, "")}</p>
      {!you && m.sources && m.sources.length > 0 && <p className="mt-1 text-caption text-door-ink-2">Read: {m.sources.map((s) => s.detail ?? s.label).join(" · ")}</p>}
    </div>
  );
}
