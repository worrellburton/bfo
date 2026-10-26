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
  startedAt = 0;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mime = MIME_PREFERENCE.find((m) => MediaRecorder.isTypeSupported?.(m));
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime, audioBitsPerSecond: 32_000 } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(250);
    this.startedAt = Date.now();
  }

  /** The clip so far; the mic is released. */
  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const rec = this.rec;
      const done = () => {
        this.stream?.getTracks().forEach((t) => t.stop());
        this.stream = null;
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
    this.rec = null;
    this.chunks = [];
  }
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

  private release() {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }
}
