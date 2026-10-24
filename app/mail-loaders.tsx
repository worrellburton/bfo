import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useTone } from "./entity/ui";

/**
 * Mail's loaders, one scene for each wait, all in the mailbox's own colour
 * (the page sets --mail-hue; the canvases read it):
 *
 *   ListLoader    mail arriving: hundreds of points of light stream down from
 *                 above and settle into the shape of the rows, a pulse runs
 *                 down them, and a few envelopes glide in to land on the rows
 *   SearchLoader  a sonar sweep over a field of mail: the beam swings, each
 *                 message it passes lights up, and the ones that match ping
 *   ReaderLoader  a letter sliding out of its envelope, the ink arriving
 *   Orbit         the small spinner for buttons (Send, Improve design, a file)
 *   SentPlane     a paper plane darting off once a message has gone
 *
 * Under reduced motion each scene is a single still frame.
 */

const stillMotion = () => typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

function readHue(el: Element): number {
  const v = parseFloat(getComputedStyle(el).getPropertyValue("--mail-hue"));
  return Number.isFinite(v) ? v : 245;
}

type Draw = (ctx: CanvasRenderingContext2D, t: number, hue: number) => void;
type Scene = (w: number, h: number) => Draw;

/** Runs a canvas scene: sized for the device, rebuilt on resize, paused while the tab is hidden. */
function useScene(ref: RefObject<HTMLCanvasElement | null>, height: number, scene: Scene, deps: unknown[]) {
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const still = stillMotion();
    let w = 0;
    let draw: Draw = () => {};
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth || canvas.parentElement?.clientWidth || 360;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw = scene(w, height);
    };
    size();
    let hue = readHue(canvas);
    const start = performance.now();
    let raf = 0;
    let frames = 0;
    let running = true;
    const tick = () => {
      if (++frames % 20 === 0) hue = readHue(canvas);
      ctx.clearRect(0, 0, w, height);
      draw(ctx, still ? 9000 : performance.now() - start, hue);
      if (running && !still) raf = requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", size);
    tick();
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", size);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

const TAU = Math.PI * 2;
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

/* ───────────────────────── the list: mail assembling ───────────────────────── */

type Point = { tx: number; ty: number; sx: number; sy: number; delay: number; r: number; ph: number };
type Segment = { idx: number[]; closed: boolean };

function constellation(table: boolean, dark: boolean): Scene {
  return (w, h) => {
    const rows = table ? 8 : 6;
    const rowH = table ? 46 : 92;
    const top = table ? 8 : 10;
    const pts: Point[] = [];
    const segs: Segment[] = [];
    let seg: Segment = { idx: [], closed: false };
    const add = (tx: number, ty: number, row: number) => {
      pts.push({
        tx,
        ty,
        sx: w * 0.5 + (Math.random() - 0.5) * w * 0.9,
        sy: -30 - Math.random() * 180,
        delay: row * 150 + Math.random() * 300,
        r: 1.1 + Math.random() * 1.2,
        ph: Math.random() * TAU,
      });
      seg.idx.push(pts.length - 1);
    };
    const line = (x1: number, x2: number, y: number, row: number, step = 9) => {
      seg = { idx: [], closed: false };
      segs.push(seg);
      for (let x = x1; x <= x2; x += step) add(x, y, row);
    };
    const circle = (cx: number, cy: number, rad: number, row: number, n: number) => {
      seg = { idx: [], closed: true };
      segs.push(seg);
      for (let i = 0; i < n; i++) add(cx + Math.cos((i / n) * TAU) * rad, cy + Math.sin((i / n) * TAU) * rad, row);
    };
    const avatars: { x: number; y: number }[] = [];
    for (let r = 0; r < rows; r++) {
      const cy = top + r * rowH + rowH / 2;
      if (table) {
        circle(28, cy, 11, r, 10);
        avatars.push({ x: 28, y: cy });
        line(50, Math.min(190, w * 0.3), cy, r);
        line(Math.min(210, w * 0.33), Math.min(420, w * 0.6), cy, r);
        line(Math.min(440, w * 0.63), w - 90, cy, r, 11);
        line(w - 64, w - 18, cy, r);
      } else {
        circle(40, cy, 20, r, 16);
        avatars.push({ x: 40, y: cy });
        const x0 = 76;
        const span = w - x0 - 20;
        line(x0, x0 + span * 0.42, cy - 18, r);
        line(w - 56, w - 20, cy - 18, r, 8);
        line(x0, x0 + span * 0.9, cy + 1, r);
        line(x0, x0 + span * 0.62, cy + 19, r);
      }
    }
    // Envelopes gliding in from above to land on a row's picture, one after another.
    const flights = Array.from({ length: 3 }, (_, i) => {
      const to = avatars[(i * 2 + 1) % avatars.length];
      const fromX = w * (0.25 + 0.5 * Math.random());
      return { from: { x: fromX, y: -40 }, ctrl: { x: (fromX + to.x) / 2 + (Math.random() - 0.5) * w * 0.6, y: to.y * 0.35 }, to, offset: 700 + i * 1500, dur: 2800 + i * 250 };
    });
    const light = dark ? 72 : 46;
    const xs = new Float32Array(pts.length);
    const ys = new Float32Array(pts.length);
    const es = new Float32Array(pts.length);

    return (ctx, t, hue) => {
      const col = (a: number, l = light) => `hsl(${hue} 80% ${l}% / ${Math.max(0, Math.min(1, a))})`;
      // A pulse of light travelling down the rows, over and over.
      const waveY = ((t / 2800) % 1) * (h + 200) - 100;
      const glowAt = (y: number) => Math.exp(-((y - waveY) * (y - waveY)) / (2 * 60 * 60));

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const local = t - p.delay;
        const e = local <= 0 ? 0 : easeOut(Math.min(1, local / 1200));
        es[i] = e;
        const drift = (1 - e) * 6 + 0.7;
        xs[i] = p.sx + (p.tx - p.sx) * e + Math.sin(t * 0.0021 + p.ph) * drift;
        ys[i] = p.sy + (p.ty - p.sy) * e + Math.cos(t * 0.0017 + p.ph) * drift;
      }
      // Threads between neighbours once they've nearly arrived: the rows' shapes.
      ctx.lineWidth = 1;
      for (const s of segs) {
        const n = s.idx.length;
        for (let k = s.closed ? 0 : 1; k < n; k++) {
          const a = s.idx[(k - 1 + n) % n];
          const b = s.idx[k];
          const e = Math.min(es[a], es[b]);
          if (e < 0.55) continue;
          const g = glowAt(ys[b]);
          ctx.strokeStyle = col(((e - 0.55) / 0.45) * (0.1 + 0.4 * g));
          ctx.beginPath();
          ctx.moveTo(xs[a], ys[a]);
          ctx.lineTo(xs[b], ys[b]);
          ctx.stroke();
        }
      }
      // The points themselves, brightening and swelling as the pulse passes.
      for (let i = 0; i < pts.length; i++) {
        const e = es[i];
        if (e <= 0) continue;
        const g = glowAt(ys[i]);
        const r = pts[i].r * (0.6 + 0.4 * e) * (1 + g * 0.5);
        if (g > 0.5 && e > 0.9) {
          ctx.fillStyle = col(0.07 * g);
          ctx.beginPath();
          ctx.arc(xs[i], ys[i], r * 2.4, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = col(0.3 * e + 0.6 * g * e, light + g * 12);
        ctx.beginPath();
        ctx.arc(xs[i], ys[i], r, 0, TAU);
        ctx.fill();
      }
      // The envelopes.
      for (const f of flights) {
        if (t < f.offset) continue;
        const u = ((t - f.offset) % f.dur) / f.dur;
        const at = (q: number) => {
          const m = 1 - q;
          return { x: m * m * f.from.x + 2 * m * q * f.ctrl.x + q * q * f.to.x, y: m * m * f.from.y + 2 * m * q * f.ctrl.y + q * q * f.to.y };
        };
        const fade = Math.min(1, u / 0.12, (1 - u) / 0.14);
        // The trail, dots left behind.
        for (let k = 1; k <= 7; k++) {
          const q = u - k * 0.022;
          if (q < 0) break;
          const p = at(q);
          ctx.fillStyle = col(fade * 0.35 * (1 - k / 8));
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.6 * (1 - k / 9), 0, TAU);
          ctx.fill();
        }
        const p = at(u);
        const ahead = at(Math.min(1, u + 0.01));
        const ang = Math.atan2(ahead.y - p.y, ahead.x - p.x) * 0.25; // a hint of banking
        const s = 0.55 + 0.45 * u;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(ang);
        ctx.scale(s, s);
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = col(fade * 0.95, light + 10);
        ctx.fillStyle = col(fade * 0.28);
        ctx.beginPath();
        ctx.roundRect(-10, -7, 20, 14, 2.5);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-10, -7);
        ctx.lineTo(0, 1.5);
        ctx.lineTo(10, -7);
        ctx.stroke();
        ctx.restore();
        // Landing: a ring spreading from the row's picture.
        if (u > 0.9) {
          const k = (u - 0.9) / 0.1;
          ctx.strokeStyle = col((1 - k) * 0.6);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(f.to.x, f.to.y, (table ? 12 : 21) + k * 22, 0, TAU);
          ctx.stroke();
        }
      }
    };
  };
}

export function ListLoader({ table = false, label = "Fetching mail" }: { table?: boolean; label?: string }) {
  const t = useTone();
  const phone = useRef<HTMLCanvasElement>(null);
  const wide = useRef<HTMLCanvasElement>(null);
  const phoneH = 6 * 92 + 20;
  const wideH = 8 * 46 + 16;
  useScene(phone, phoneH, constellation(false, t.dark), [t.dark]);
  useScene(wide, wideH, constellation(true, t.dark), [t.dark, table]);
  // The table is a desktop view; phones show the row list whatever the saved view, so the loader does the same.
  return (
    <div role="status" aria-label={label}>
      {table && <canvas ref={wide} aria-hidden="true" className="block w-full max-md:hidden" style={{ height: wideH }} />}
      <div className={table ? "md:hidden" : ""}>
        <canvas ref={phone} aria-hidden="true" className="block w-full" style={{ height: phoneH }} />
        <p className={`loader-caption mt-1 flex items-center justify-center gap-2 pb-24 text-[12px] sm:pb-2 ${t.muted}`}>
          <span className="loader-dot" />
          {label}
          <Dots />
        </p>
      </div>
    </div>
  );
}

/* ───────────────────────── search: a sonar sweep ───────────────────────── */

function sonar(dark: boolean): Scene {
  return (w, h) => {
    const cx = w / 2;
    const cy = -26;
    const R = Math.hypot(w / 2, h + 26) + 4;
    const dots = Array.from({ length: 80 }, () => ({
      a: 0.06 * Math.PI + Math.random() * 0.88 * Math.PI,
      d: 36 + Math.random() * (R - 44),
      lit: 0,
      hit: Math.random() < 0.16,
      r: 1.1 + Math.random() * 1.5,
    }));
    const rings = [0.28, 0.52, 0.76, 1].map((f) => f * R);
    const light = dark ? 72 : 46;
    const grey = (a: number) => (dark ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`);
    return (ctx, t, hue) => {
      const col = (a: number, l = light) => `hsl(${hue} 80% ${l}% / ${Math.max(0, Math.min(1, a))})`;
      // The beam swings across the lower half like a pendulum.
      const phase = t * 0.0011;
      const ang = Math.PI / 2 + Math.sin(phase) * 0.44 * Math.PI;
      const dir = Math.cos(phase) >= 0 ? 1 : -1;
      ctx.lineWidth = 1;
      ctx.strokeStyle = grey(0.055);
      for (const r of rings) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0.04 * Math.PI, 0.96 * Math.PI);
        ctx.stroke();
      }
      // The beam: wedges fading out behind its leading edge.
      for (let k = 0; k < 18; k++) {
        const a0 = ang - dir * k * 0.024;
        const a1 = a0 - dir * 0.026;
        ctx.fillStyle = col(0.13 * (1 - k / 18) * (1 - k / 18));
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, Math.min(a0, a1), Math.max(a0, a1));
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = col(0.75, light + 8);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
      ctx.stroke();
      // The mail: every message the beam passes lights and fades; the matches ping.
      for (const d of dots) {
        const diff = Math.abs(d.a - ang);
        if (diff < 0.035) d.lit = 1;
        else d.lit *= 0.972;
        const x = cx + Math.cos(d.a) * d.d;
        const y = cy + Math.sin(d.a) * d.d;
        if (d.hit) {
          if (d.lit > 0.02) {
            ctx.strokeStyle = col(0.55 * d.lit);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(x, y, d.r + 2 + (1 - d.lit) * 16, 0, TAU);
            ctx.stroke();
          }
          ctx.fillStyle = col(0.3 + 0.7 * d.lit, light + 10 * d.lit);
          ctx.beginPath();
          ctx.arc(x, y, d.r + 0.6 + 1.4 * d.lit, 0, TAU);
          ctx.fill();
        } else {
          ctx.fillStyle = grey(0.09 + 0.4 * d.lit);
          ctx.beginPath();
          ctx.arc(x, y, d.r * 0.85, 0, TAU);
          ctx.fill();
        }
      }
    };
  };
}

export function SearchLoader({ term }: { term: string }) {
  const t = useTone();
  const ref = useRef<HTMLCanvasElement>(null);
  const H = 210;
  useScene(ref, H, sonar(t.dark), [t.dark]);
  return (
    <div role="status" aria-label={`Searching for ${term}`} className="py-1">
      <canvas ref={ref} aria-hidden="true" className="block w-full" style={{ height: H }} />
      <p className={`mt-3 flex items-center justify-center gap-2 pb-2 text-[12px] ${t.muted}`}>
        Searching all mail for <span className={`font-medium ${t.text}`}>“{term}”</span>
        <Dots />
      </p>
    </div>
  );
}

/* ───────────────────────── the reader: a letter coming out ───────────────────────── */

export function ReaderLoader() {
  const t = useTone();
  return (
    <div role="status" aria-label="Opening the message" className="flex flex-col items-center px-5 pb-10 pt-14">
      <svg viewBox="0 0 160 150" className="letter h-[150px] w-[160px] overflow-visible" aria-hidden="true">
        {/* A pool of light under the envelope. */}
        <ellipse cx="80" cy="142" rx="56" ry="6" className="letter-pool" />
        {/* The flap, behind everything, opening upward from the envelope's top edge. */}
        <path d="M24 72 L80 30 L136 72 Z" className="letter-flap" />
        {/* The letter, rising from behind the envelope's body. */}
        <g className="letter-paper">
          <rect x="36" y="76" width="88" height="60" rx="5" className={t.dark ? "fill-white/95" : "fill-white stroke-black/10"} strokeWidth="1" />
          <path d="M48 90 H112" className="letter-ink" strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M48 102 H100" className="letter-ink" strokeWidth="3" strokeLinecap="round" fill="none" style={{ animationDelay: "120ms" }} />
          <path d="M48 114 H108" className="letter-ink" strokeWidth="3" strokeLinecap="round" fill="none" style={{ animationDelay: "240ms" }} />
        </g>
        {/* The envelope's body in front, with the pocket's fold lines. */}
        <rect x="24" y="72" width="112" height="66" rx="8" className="letter-body" />
        <path d="M24 136 L80 100 L136 136" className="letter-pocket" fill="none" strokeWidth="1.2" />
      </svg>
      <p className={`mt-6 flex items-center gap-2 text-[12px] ${t.muted}`}>
        <span className="loader-dot" />
        Opening
        <Dots />
      </p>
    </div>
  );
}

/* ───────────────────────── small pieces ───────────────────────── */

/** Three dots that take turns. */
export function Dots() {
  return (
    <span aria-hidden="true" className="loader-dots inline-flex gap-[3px]">
      <i />
      <i />
      <i />
    </span>
  );
}

/** The small spinner for a button: a ring with a spark going round. */
export function Orbit({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`loader-orbit relative inline-block shrink-0 rounded-full ${className}`}>
      <span className="loader-spark" />
    </span>
  );
}

/** A paper plane darting off, and a check left in its place: the message has gone. */
export function SentPlane({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`relative inline-block shrink-0 ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="plane-off absolute inset-0 h-full w-full">
        <path d="M21 3L3 10.5l8 2.5 2.5 8L21 3z" />
        <path d="M11 13l10-10" />
      </svg>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="plane-check absolute inset-0 h-full w-full">
        <path d="M5 12.5l4.5 4.5L19 7" />
      </svg>
    </span>
  );
}

/** A label that shows the spinner while busy and the plane once done. */
export function BusyLabel({ busy, done, children, doneLabel }: { busy: boolean; done?: boolean; children: ReactNode; doneLabel?: ReactNode }) {
  if (done)
    return (
      <span className="inline-flex items-center gap-1.5">
        <SentPlane />
        {doneLabel ?? children}
      </span>
    );
  if (busy)
    return (
      <span className="inline-flex items-center gap-1.5">
        <Orbit />
        {children}
      </span>
    );
  return <>{children}</>;
}
