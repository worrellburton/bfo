import type Anthropic from "@anthropic-ai/sdk";

/**
 * OpenAI's Realtime API for the voice conversation: the model that listens
 * and speaks itself (the one behind ChatGPT's voice), reached from the
 * browser over WebRTC with a short-lived key minted here. The office's
 * lookups (lib/ask.ts tools) are handed to it as functions; when it calls
 * one, the browser asks /api/ask to run it and passes the result back.
 *
 * The GA API (client secrets, /v1/realtime/calls) first; the earlier beta
 * (sessions, /v1/realtime?model=) when an account only has that.
 */

export const REALTIME_MODEL = "gpt-realtime";
export const REALTIME_MODEL_BETA = "gpt-4o-realtime-preview";
/** The most natural of the voices: Marin on the GA model, Coral on the beta one. */
export const REALTIME_VOICE = "marin";
export const REALTIME_VOICE_BETA = "coral";
const TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
/** How long the key stays good for starting the call. */
const SECRET_SECONDS = 600;

export type RealtimeSecret = { secret: string; model: string; voice: string; api: "ga" | "beta"; expiresAt: number };

export class RealtimeError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** A tool as the Realtime API wants it. */
export function realtimeTools(tools: Anthropic.Messages.Tool[]): { type: "function"; name: string; description: string; parameters: unknown }[] {
  return tools.map((t) => ({ type: "function", name: t.name, description: t.description ?? "", parameters: t.input_schema }));
}

/** The system prompt, with what speaking aloud changes. */
export function spokenInstructions(prompt: string): string {
  return `${prompt}

You are speaking aloud, in a live voice conversation:
- Answer in a few short sentences. Say the most useful thing first. No lists, no tables, no markdown, no links; say names, dates and amounts in plain words ("about twelve thousand dollars", "November fourteenth").
- Look things up with the tools before stating a fact, and while you do, say nothing or at most a few words ("One moment.").
- If what you heard was unclear, ask back in one short sentence rather than guessing.
- Keep an even, unhurried, warm tone, like a trusted assistant across the desk.`;
}

export async function mintRealtimeSecret(opts: { instructions: string; tools: Anthropic.Messages.Tool[]; names: string[] }): Promise<RealtimeSecret> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new RealtimeError(503, "Voice isn't set up (OPENAI_API_KEY).");
  const transcriptionPrompt = opts.names.length ? `Names that may come up: ${opts.names.slice(0, 60).join(", ")}.` : undefined;
  const tools = realtimeTools(opts.tools);
  const expiresAt = Date.now() + SECRET_SECONDS * 1000;

  // GA: a client secret carrying the whole session.
  const ga = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: SECRET_SECONDS },
      session: {
        type: "realtime",
        model: REALTIME_MODEL,
        instructions: opts.instructions,
        tools,
        tool_choice: "auto",
        audio: {
          input: {
            // Hold to talk: the browser says when a turn ends.
            turn_detection: null,
            noise_reduction: { type: "near_field" },
            transcription: { model: TRANSCRIBE_MODEL, language: "en", ...(transcriptionPrompt ? { prompt: transcriptionPrompt } : {}) },
          },
          output: { voice: REALTIME_VOICE },
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (ga.ok) {
    const j = (await ga.json()) as { value?: string; expires_at?: number };
    if (j.value) return { secret: j.value, model: REALTIME_MODEL, voice: REALTIME_VOICE, api: "ga", expiresAt: j.expires_at ? j.expires_at * 1000 : expiresAt };
  }
  const gaText = await ga.text().catch(() => "");
  if (ga.status === 401) throw new RealtimeError(502, "OpenAI rejected the API key.");

  // Beta: a session.
  const beta = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "OpenAI-Beta": "realtime=v1" },
    body: JSON.stringify({
      model: REALTIME_MODEL_BETA,
      voice: REALTIME_VOICE_BETA,
      modalities: ["audio", "text"],
      instructions: opts.instructions,
      tools,
      tool_choice: "auto",
      turn_detection: null,
      input_audio_transcription: { model: TRANSCRIBE_MODEL, language: "en", ...(transcriptionPrompt ? { prompt: transcriptionPrompt } : {}) },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (beta.ok) {
    const j = (await beta.json()) as { client_secret?: { value?: string; expires_at?: number } };
    if (j.client_secret?.value) return { secret: j.client_secret.value, model: REALTIME_MODEL_BETA, voice: REALTIME_VOICE_BETA, api: "beta", expiresAt: j.client_secret.expires_at ? j.client_secret.expires_at * 1000 : expiresAt };
  }
  const betaText = await beta.text().catch(() => "");
  throw new RealtimeError(502, `The live voice isn't available right now (${ga.status}: ${problem(gaText)}; ${beta.status}: ${problem(betaText)}).`);
}

function problem(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } };
    if (j.error?.message) return j.error.message.slice(0, 160);
  } catch {
    /* not JSON */
  }
  return body.slice(0, 120) || "no detail";
}
