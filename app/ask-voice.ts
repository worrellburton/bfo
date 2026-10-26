/**
 * The microphone and the speaker for Ask BFO, in the browser.
 *
 * Recorder: holds the mic open while the person talks (MediaRecorder; opus
 * in webm on most browsers, mp4 on Safari) and hands back the clip.
 *
 * Player: plays an answer. Phones only play sound that a tap started, and
 * the answer arrives seconds after the tap, so `unlock()` plays a silent
 * clip in the tap and the real audio rides on that same element later.
 */

export const canRecord = () => typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

const MIME_PREFERENCE = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export class Recorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Uint8Array<ArrayBuffer> | null = null;
  startedAt = 0;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    // The level meter, for the globe to breathe with the voice.
    try {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
      this.buf = new Uint8Array(this.analyser.fftSize);
    } catch {
      this.analyser = null;
    }
    const mime = MIME_PREFERENCE.find((m) => MediaRecorder.isTypeSupported?.(m));
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime, audioBitsPerSecond: 32_000 } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(250);
    this.startedAt = Date.now();
  }

  /** How loud the voice is right now, 0–1. */
  level(): number {
    if (!this.analyser || !this.buf) return 0;
    this.analyser.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) {
      const d = (v - 128) / 128;
      sum += d * d;
    }
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 4);
  }

  private closeMeter() {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.analyser = null;
  }

  /** The clip so far; the mic is released. */
  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const rec = this.rec;
      const done = () => {
        this.stream?.getTracks().forEach((t) => t.stop());
        this.stream = null;
        this.closeMeter();
        const type = rec?.mimeType || this.chunks[0]?.type || "audio/webm";
        resolve(new Blob(this.chunks, { type }));
        this.rec = null;
      };
      if (!rec || rec.state === "inactive") return done();
      rec.onstop = done;
      rec.stop();
    });
  }

  cancel() {
    try {
      this.rec?.stop();
    } catch {
      /* already stopped */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.closeMeter();
    this.rec = null;
    this.chunks = [];
  }
}

/** The first `fraction` of a text, whole words: the caption keeping pace with the voice. */
export function revealWords(text: string, fraction: number): string {
  const words = text.split(/(\s+)/);
  const spoken = words.filter((w) => w.trim()).length;
  const want = Math.max(0, Math.min(spoken, Math.ceil(spoken * Math.max(0, Math.min(1, fraction)))));
  let seen = 0;
  const out: string[] = [];
  for (const w of words) {
    if (w.trim()) {
      if (seen >= want) break;
      seen++;
    }
    out.push(w);
  }
  return out.join("");
}

// A tenth of a second of silence, so a tap can "play" before there's anything to play.
const SILENCE = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTRUoAWgBgkOAGbZHBgG1OF6zM82DWbZaUmMBptgQhGjsyYqc9ae9XFz280948NMBWInluyfIykgqbQ2Zbzos45BpSu6lWbJfAGsbGU9k2YYv7eiUdqtbg==";

export class Player {
  private el: HTMLAudioElement | null = null;
  private url: string | null = null;

  /** Call inside the tap that starts a question, so the answer may sound later. */
  unlock() {
    if (!this.el) {
      this.el = new Audio();
      this.el.preload = "auto";
    }
    if (this.el.paused) {
      this.el.src = SILENCE;
      void this.el.play().catch(() => undefined);
    }
  }

  async play(blob: Blob, onEnd?: () => void): Promise<void> {
    this.stop();
    if (!this.el) this.el = new Audio();
    this.url = URL.createObjectURL(blob);
    this.el.src = this.url;
    this.el.onended = () => {
      this.release();
      onEnd?.();
    };
    await this.el.play();
  }

  stop() {
    if (this.el && !this.el.paused) this.el.pause();
    this.release();
  }

  get playing() {
    return !!this.el && !this.el.paused && !!this.url;
  }

  /** How far through the clip, 0–1 (0 before it starts). */
  progress(): number {
    const el = this.el;
    if (!el || !this.url || !Number.isFinite(el.duration) || el.duration <= 0) return 0;
    return Math.max(0, Math.min(1, el.currentTime / el.duration));
  }

  private release() {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }
}
