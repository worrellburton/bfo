import { useEffect, useRef } from "react";

/**
 * A globe of particles, the face of Ask BFO's voice: ivory points on a
 * sphere, turning slowly. It breathes with the person's voice while they
 * hold to talk, spins and shimmers while the answer is being worked out,
 * and pulses in time while the answer is spoken.
 *
 * Plain 2D canvas: the sphere is rotated and projected by hand, which is
 * light enough for a phone. Reduced motion draws it still.
 */

export type GlobeMode = "idle" | "listening" | "thinking" | "speaking";

type Point = { x: number; y: number; z: number; seed: number };

const COUNT = 1100;

/** Points spread evenly over a sphere (a Fibonacci lattice). */
function lattice(n: number): Point[] {
  const out: Point[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = golden * i;
    out.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r, seed: Math.random() });
  }
  return out;
}

export function ParticleGlobe({ mode, level, className = "" }: { mode: GlobeMode; level?: () => number; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  const levelRef = useRef(level);
  modeRef.current = mode;
  levelRef.current = level;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const points = lattice(COUNT);
    let w = 0;
    let h = 0;
    let dpr = 1;
    const fit = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = el.clientWidth;
      h = el.clientHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);

    let yaw = 0;
    let pitch = 0.35;
    let activity = 0; // 0 idle … 1 lit up
    let swell = 0; // the radius's breathing
    let voice = 0; // the smoothed mic level
    let raf = 0;
    let t0 = performance.now();

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - t0) / 1000);
      t0 = now;
      const t = now / 1000;
      const m = modeRef.current;
      const targetActivity = m === "idle" ? 0 : m === "listening" ? 0.55 : m === "thinking" ? 0.8 : 1;
      activity += (targetActivity - activity) * Math.min(1, dt * 3);
      const speed = m === "thinking" ? 0.9 : m === "speaking" ? 0.35 : m === "listening" ? 0.22 : 0.12;
      if (!still) {
        yaw += dt * speed;
        pitch = 0.35 + Math.sin(t * 0.25) * 0.12;
      }
      // What the radius does: the voice (listening), a pulse (speaking), a slow breath (idle), a shimmer (thinking).
      let want = Math.sin(t * 0.8) * 0.012;
      if (m === "listening") {
        const lv = levelRef.current?.() ?? 0;
        voice += (lv - voice) * Math.min(1, dt * 14);
        want = voice * 0.28;
      } else if (m === "speaking") {
        want = (Math.abs(Math.sin(t * 6.3)) * 0.5 + Math.abs(Math.sin(t * 9.1)) * 0.3) * 0.09;
      } else if (m === "thinking") {
        want = Math.sin(t * 2.2) * 0.02;
      }
      swell += (want - swell) * Math.min(1, dt * 10);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) * 0.31 * (1 + swell);
      const f = R * 2.8;

      // Halo: brighter the more is going on.
      const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.9);
      halo.addColorStop(0, `rgba(165, 180, 252, ${0.05 + activity * 0.1})`);
      halo.addColorStop(0.55, `rgba(129, 140, 248, ${0.02 + activity * 0.05})`);
      halo.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);

      const cy_ = Math.cos(yaw);
      const sy_ = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      // Back to front, so near points sit on top.
      const projected: { x: number; y: number; z: number; seed: number }[] = [];
      for (const p of points) {
        // yaw about Y, then pitch about X
        const x1 = p.x * cy_ - p.z * sy_;
        const z1 = p.x * sy_ + p.z * cy_;
        const y2 = p.y * cp - z1 * sp;
        const z2 = p.y * sp + z1 * cp;
        projected.push({ x: x1, y: y2, z: z2, seed: p.seed });
      }
      projected.sort((a, b) => a.z - b.z);
      for (const p of projected) {
        const scale = f / (f - p.z * R);
        const x = cx + p.x * R * scale;
        const y = cy + p.y * R * scale;
        const depth = (p.z + 1) / 2; // 0 far … 1 near
        let alpha = 0.12 + depth * 0.75;
        let size = 0.9 + depth * 1.5;
        if (m === "thinking" && !still) {
          // A shimmer running over the surface.
          const flicker = 0.5 + 0.5 * Math.sin(t * 5 + p.seed * 40);
          alpha *= 0.6 + flicker * 0.7;
          size *= 0.85 + flicker * 0.4;
        }
        alpha *= 0.75 + activity * 0.35;
        // Ivory, with a touch of the backdrop's blue in the far points.
        const g = Math.round(237 - (1 - depth) * 24);
        const b = Math.round(224 + (1 - depth) * 20);
        ctx.fillStyle = `rgba(244, ${g}, ${b}, ${Math.min(1, alpha)})`;
        ctx.beginPath();
        ctx.arc(x, y, size * (0.9 + activity * 0.25), 0, Math.PI * 2);
        ctx.fill();
      }
      if (!still) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvas} className={className} aria-hidden />;
}
