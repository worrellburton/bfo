/**
 * Voice for Ask BFO, through OpenAI: what was said becomes text
 * (transcription), and an answer becomes speech. Server-side only: the key
 * (OPENAI_API_KEY) never reaches the browser.
 */

const TRANSCRIBE_MODELS = ["gpt-4o-mini-transcribe", "whisper-1"];
const SPEECH_MODELS = ["gpt-4o-mini-tts", "tts-1"];
/** A warm, even voice. */
const VOICE = "nova";
/** A long answer is read in part: past this the listener would rather read. */
const SPEECH_MAX = 1800;

export class VoiceError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function key(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new VoiceError(503, "Voice isn't set up (OPENAI_API_KEY).");
  return k;
}

/** Spoken audio (webm/opus, mp4, wav…) → text. */
export async function transcribe(audio: Uint8Array, mime: string, hint?: string): Promise<string> {
  const ext = mime.includes("mp4") || mime.includes("m4a") ? "m4a" : mime.includes("wav") ? "wav" : mime.includes("ogg") ? "ogg" : mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : "webm";
  let last: VoiceError | null = null;
  for (const model of TRANSCRIBE_MODELS) {
    const form = new FormData();
    form.append("file", new Blob([audio as BlobPart], { type: mime || "audio/webm" }), `speech.${ext}`);
    form.append("model", model);
    form.append("language", "en");
    if (hint) form.append("prompt", hint.slice(0, 400));
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key()}` }, body: form, signal: AbortSignal.timeout(30_000) });
    if (r.ok) {
      const j = (await r.json()) as { text?: string };
      return (j.text ?? "").trim();
    }
    const text = await r.text();
    last = new VoiceError(r.status, problem(r.status, text));
    // An account without this model: try the older one.
    if (!(r.status === 404 || (r.status === 400 && /model/i.test(text)))) break;
  }
  throw last ?? new VoiceError(502, "Couldn't transcribe that.");
}

/** Text → mp3 bytes. */
export async function speak(text: string): Promise<Uint8Array> {
  const input = spokenForm(text).slice(0, SPEECH_MAX);
  if (!input.trim()) throw new VoiceError(400, "Nothing to say.");
  let last: VoiceError | null = null;
  for (const model of SPEECH_MODELS) {
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, voice: VOICE, input, response_format: "mp3", ...(model.startsWith("gpt-4o") ? { instructions: "Calm, clear and unhurried, like a trusted assistant reading a short note aloud." } : {}) }),
      signal: AbortSignal.timeout(45_000),
    });
    if (r.ok) return new Uint8Array(await r.arrayBuffer());
    const body = await r.text();
    last = new VoiceError(r.status, problem(r.status, body));
    if (!(r.status === 404 || (r.status === 400 && /model/i.test(body)))) break;
  }
  throw last ?? new VoiceError(502, "Couldn't read that aloud.");
}

function problem(status: number, body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } };
    if (j.error?.message) return j.error.message.slice(0, 200);
  } catch {
    /* not JSON */
  }
  if (status === 401) return "OpenAI rejected the API key.";
  if (status === 429) return "OpenAI is rate-limiting requests. Try again in a moment.";
  return `OpenAI returned ${status}.`;
}

/**
 * The answer as something to read aloud: links become their words, emphasis
 * marks go, a table reads as one line per row, list markers become pauses.
 */
export function spokenForm(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let header: string[] | null = null;
  for (const raw of lines) {
    let line = raw.trim();
    if (!line) {
      header = null;
      out.push("");
      continue;
    }
    if (/^\|?\s*:?-{2,}/.test(line) && line.includes("-")) continue; // the table's rule
    if (line.startsWith("|")) {
      const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      if (!header) {
        header = cells;
        continue;
      }
      out.push(cells.map((c, i) => (header![i] && i > 0 ? `${header![i]}: ${c}` : c)).join(", ") + ".");
      continue;
    }
    line = line.replace(/^#{1,4}\s+/, "").replace(/^\s*[-*•]\s+/, "").replace(/^\s*\d{1,3}[.)]\s+/, "");
    line = line.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/`([^`]+)`/g, "$1");
    out.push(line);
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
