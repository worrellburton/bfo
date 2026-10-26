import { realtimeSecret, runAskTool } from "./ask-client";

/**
 * The live voice: a WebRTC call to OpenAI's Realtime model (lib/realtime.ts
 * mints the key). The mic track is live only while the person holds to
 * talk; releasing commits the turn and asks for the answer, which comes
 * back as sound and as words. When the model wants one of BFO's lookups,
 * it's run through /api/ask and the result handed back, then the answer
 * continues.
 *
 * One call stays open for the whole conversation. Anything that goes wrong
 * reports through `onError`; the page falls back to the recorded path.
 */

export type LiveStatus = "connecting" | "ready" | "listening" | "thinking" | "speaking";

export type LiveHandlers = {
  onStatus: (s: LiveStatus) => void;
  /** What the person said, once the model has it in words. */
  onUserText: (text: string) => void;
  /** The answer's words as they're spoken, and the whole answer when it's done. */
  onAssistantDelta: (delta: string) => void;
  onAssistantDone: (text: string) => void;
  /** What's being looked up. */
  onTool: (label: string) => void;
  onError: (message: string) => void;
};

export const canLive = () => typeof window !== "undefined" && typeof RTCPeerConnection !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

type Ev = { type: string; [k: string]: unknown };

export class LiveVoice {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mic: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private audio: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private inMeter: AnalyserNode | null = null;
  private outMeter: AnalyserNode | null = null;
  private buf = new Uint8Array(512);
  private answer = "";
  private pendingTools = 0;
  private responding = false;
  private closed = false;
  status: LiveStatus = "connecting";

  constructor(private h: LiveHandlers) {}

  private set(s: LiveStatus) {
    if (this.closed || this.status === s) return;
    this.status = s;
    this.h.onStatus(s);
  }

  /** Call inside the press that starts the conversation: the mic prompt and the sound both need a gesture. */
  async connect(): Promise<void> {
    this.set("connecting");
    const [made, mic] = await Promise.all([realtimeSecret(), navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })]);
    if (this.closed) {
      mic.getTracks().forEach((t) => t.stop());
      return;
    }
    this.mic = mic;
    this.track = mic.getAudioTracks()[0] ?? null;
    if (this.track) this.track.enabled = false;

    const pc = new RTCPeerConnection();
    this.pc = pc;
    this.audio = new Audio();
    this.audio.autoplay = true;
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (this.audio) {
        this.audio.srcObject = stream;
        void this.audio.play().catch(() => undefined);
      }
      this.meter(stream, "out");
    };
    if (this.track) pc.addTrack(this.track, mic);
    this.meter(mic, "in");

    const dc = pc.createDataChannel("oai-events");
    this.dc = dc;
    dc.onmessage = (m) => {
      try {
        this.handle(JSON.parse(m.data) as Ev);
      } catch {
        /* not an event */
      }
    };
    const opened = new Promise<void>((resolve, reject) => {
      dc.onopen = () => resolve();
      dc.onerror = () => reject(new Error("The live voice connection failed."));
      setTimeout(() => reject(new Error("The live voice took too long to connect.")), 15_000);
    });
    pc.onconnectionstatechange = () => {
      if (["failed", "disconnected", "closed"].includes(pc.connectionState) && !this.closed) this.h.onError("The live voice connection dropped.");
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const url = made.api === "ga" ? "https://api.openai.com/v1/realtime/calls" : `https://api.openai.com/v1/realtime?model=${encodeURIComponent(made.model)}`;
    const r = await fetch(url, {
      method: "POST",
      body: offer.sdp,
      headers: { Authorization: `Bearer ${made.secret}`, "Content-Type": "application/sdp", ...(made.api === "beta" ? { "OpenAI-Beta": "realtime=v1" } : {}) },
    });
    if (!r.ok) throw new Error(`The live voice refused the call (${r.status}).`);
    await pc.setRemoteDescription({ type: "answer", sdp: await r.text() });
    await opened;
    this.set("ready");
  }

  private meter(stream: MediaStream, which: "in" | "out") {
    try {
      this.ctx ??= new AudioContext();
      const a = this.ctx.createAnalyser();
      a.fftSize = 512;
      this.ctx.createMediaStreamSource(stream).connect(a);
      if (which === "in") this.inMeter = a;
      else this.outMeter = a;
      void this.ctx.resume().catch(() => undefined);
    } catch {
      /* no meter: the globe just breathes on its own */
    }
  }

  /** The voice's level, 0–1: the person's while listening, the model's while speaking. */
  level(): number {
    const a = this.status === "listening" ? this.inMeter : this.outMeter;
    if (!a) return 0;
    a.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) {
      const d = (v - 128) / 128;
      sum += d * d;
    }
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 4);
  }

  private send(ev: Ev) {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(ev));
  }

  /** The person starts talking: anything being said stops, the mic goes live. */
  holdStart() {
    if (this.status === "connecting") return;
    if (this.responding) {
      this.send({ type: "response.cancel" });
      this.send({ type: "output_audio_buffer.clear" });
      this.responding = false;
    }
    this.send({ type: "input_audio_buffer.clear" });
    if (this.track) this.track.enabled = true;
    this.set("listening");
  }

  /** The person is done: the turn goes to the model. */
  holdEnd() {
    if (this.status !== "listening") return;
    if (this.track) this.track.enabled = false;
    this.answer = "";
    this.pendingTools = 0;
    this.responding = true;
    this.send({ type: "input_audio_buffer.commit" });
    this.send({ type: "response.create" });
    this.set("thinking");
  }

  /** Stop the answer mid-sentence. */
  hush() {
    if (!this.responding) return;
    this.send({ type: "response.cancel" });
    this.send({ type: "output_audio_buffer.clear" });
    this.responding = false;
    if (this.answer.trim()) this.h.onAssistantDone(this.answer.trim());
    this.answer = "";
    this.set("ready");
  }

  close() {
    this.closed = true;
    try {
      this.dc?.close();
      this.pc?.close();
    } catch {
      /* already closed */
    }
    this.mic?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    if (this.audio) {
      this.audio.pause();
      this.audio.srcObject = null;
    }
    this.pc = null;
    this.dc = null;
    this.mic = null;
  }

  private handle(ev: Ev) {
    switch (ev.type) {
      case "conversation.item.input_audio_transcription.completed": {
        const text = String(ev.transcript ?? "").trim();
        if (text) this.h.onUserText(text);
        return;
      }
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta": {
        const delta = String(ev.delta ?? "");
        if (!delta) return;
        this.answer += delta;
        this.set("speaking");
        this.h.onAssistantDelta(delta);
        return;
      }
      case "response.function_call_arguments.done": {
        const name = String(ev.name ?? "");
        const callId = String(ev.call_id ?? "");
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(String(ev.arguments || "{}")) as Record<string, unknown>;
        } catch {
          input = {};
        }
        this.pendingTools++;
        this.set("thinking");
        void runAskTool(name, input)
          .then((r) => {
            this.h.onTool(r.label);
            this.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: r.output } });
          })
          .catch((e) => {
            this.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify({ error: (e as Error).message }) } });
          })
          .finally(() => {
            this.pendingTools--;
            if (this.pendingTools === 0 && this.responding) this.send({ type: "response.create" });
          });
        return;
      }
      case "response.done": {
        // A response that only called tools isn't the answer; the next one is.
        const out = ((ev.response as { output?: { type?: string }[] } | undefined)?.output ?? []) as { type?: string }[];
        const calledTools = out.some((o) => o.type === "function_call");
        if (calledTools || this.pendingTools > 0) return;
        this.responding = false;
        const text = this.answer.trim();
        this.answer = "";
        if (text) this.h.onAssistantDone(text);
        // Sound may still be playing; output_audio_buffer.stopped says when it's over.
        if (this.status !== "speaking") this.set("ready");
        return;
      }
      case "output_audio_buffer.stopped":
        if (!this.responding) this.set("ready");
        return;
      case "error": {
        const err = ev.error as { message?: string } | undefined;
        this.h.onError(err?.message ? `The live voice said: ${err.message}` : "The live voice hit an error.");
        return;
      }
      default:
        return;
    }
  }
}
