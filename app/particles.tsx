import { useEffect, useRef } from "react";

/**
 * The particle field behind the app: soft glowing motes in the brand's
 * indigo/violet/teal, drifting slowly and joined by hairlines when they
 * come close, with a little depth (near ones are bigger, brighter and move
 * more) and a gentle parallax toward the pointer. It pauses when the tab
 * is hidden, draws crisply on high-density screens, and sits still for
 * anyone who prefers reduced motion.
 */

interface ParticleConfig {
  /** Motes per million square pixels; the count scales with the viewport. */
  density?: number;
  speed?: number;
  connectionDistance?: number;
  /** Picks colours for the current theme (html.light) as it draws. */
  themeAware?: boolean;
  className?: string;
}

type Mote = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 0 (far) … 1 (near) */
  depth: number;
  r: number;
  hue: number;
  /** Phase for the slow twinkle. */
  phase: number;
};

const HUES = [236, 248, 262, 190, 212]; // indigo, violet, purple, teal, sky

export function ParticleCanvas({ density = 56, speed = 0.18, connectionDistance = 150, themeAware = true, className = "" }: ParticleConfig) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let motes: Mote[] = [];
    let anim = 0;
    let last = performance.now();
    // Pointer position in CSS px, eased toward for parallax.
    const target = { x: 0.5, y: 0.5 };
    const look = { x: 0.5, y: 0.5 };

    function seed() {
      const want = Math.round(((width * height) / 1_000_000) * density);
      const count = Math.max(18, Math.min(110, want));
      motes = Array.from({ length: count }, () => {
        const depth = Math.random();
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * speed * (0.4 + depth),
          vy: (Math.random() - 0.5) * speed * (0.4 + depth),
          depth,
          r: 0.6 + depth * 1.9,
          hue: HUES[Math.floor(Math.random() * HUES.length)],
          phase: Math.random() * Math.PI * 2,
        };
      });
    }

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      width = Math.max(1, rect.width || window.innerWidth);
      height = Math.max(1, rect.height || window.innerHeight);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!motes.length) seed();
      else for (const m of motes) {
        m.x = Math.min(m.x, width);
        m.y = Math.min(m.y, height);
      }
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    function palette() {
      const light = themeAware && document.documentElement.classList.contains("light");
      return light
        ? { sat: 70, lum: 42, dot: 0.22, glow: 0.1, line: 0.09 }
        : { sat: 85, lum: 74, dot: 0.8, glow: 0.3, line: 0.14 };
    }

    function frame(now: number) {
      const dt = Math.min(48, now - last) / 16.667; // in 60fps frames
      last = now;
      const p = palette();
      ctx!.clearRect(0, 0, width, height);

      // Parallax eases toward the pointer; everything shifts a few px by depth.
      look.x += (target.x - look.x) * 0.04;
      look.y += (target.y - look.y) * 0.04;
      const px = (look.x - 0.5) * 2;
      const py = (look.y - 0.5) * 2;

      const pos = motes.map((m) => {
        if (!reduceMotion) {
          m.x += m.vx * dt;
          m.y += m.vy * dt;
          // A slow sideways sway so paths aren't ruler-straight.
          m.x += Math.sin(now / 4000 + m.phase) * 0.06 * dt * (0.3 + m.depth);
          if (m.x < -10) m.x = width + 10;
          else if (m.x > width + 10) m.x = -10;
          if (m.y < -10) m.y = height + 10;
          else if (m.y > height + 10) m.y = -10;
        }
        const shift = 14 * m.depth;
        return { x: m.x - px * shift, y: m.y - py * shift };
      });

      // Hairlines between neighbours, fading with distance; near motes draw stronger.
      ctx!.lineWidth = 1;
      for (let i = 0; i < motes.length; i++) {
        for (let j = i + 1; j < motes.length; j++) {
          const dx = pos[i].x - pos[j].x;
          const dy = pos[i].y - pos[j].y;
          const d2 = dx * dx + dy * dy;
          if (d2 > connectionDistance * connectionDistance) continue;
          const d = Math.sqrt(d2);
          const a = p.line * (1 - d / connectionDistance) * (0.5 + (motes[i].depth + motes[j].depth) / 4);
          const hue = (motes[i].hue + motes[j].hue) / 2;
          ctx!.strokeStyle = `hsla(${hue} ${p.sat}% ${p.lum}% / ${a})`;
          ctx!.beginPath();
          ctx!.moveTo(pos[i].x, pos[i].y);
          ctx!.lineTo(pos[j].x, pos[j].y);
          ctx!.stroke();
        }
      }

      // Motes: a soft glow, then a bright core, twinkling slowly.
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        const { x, y } = pos[i];
        const tw = reduceMotion ? 1 : 0.75 + 0.25 * Math.sin(now / 1800 + m.phase);
        const glowR = m.r * 6;
        const g = ctx!.createRadialGradient(x, y, 0, x, y, glowR);
        g.addColorStop(0, `hsla(${m.hue} ${p.sat}% ${p.lum}% / ${p.glow * tw * (0.4 + m.depth)})`);
        g.addColorStop(1, `hsla(${m.hue} ${p.sat}% ${p.lum}% / 0)`);
        ctx!.fillStyle = g;
        ctx!.beginPath();
        ctx!.arc(x, y, glowR, 0, Math.PI * 2);
        ctx!.fill();

        ctx!.fillStyle = `hsla(${m.hue} ${p.sat}% ${p.lum + 10}% / ${p.dot * tw * (0.35 + m.depth * 0.65)})`;
        ctx!.beginPath();
        ctx!.arc(x, y, m.r, 0, Math.PI * 2);
        ctx!.fill();
      }

      if (!reduceMotion) anim = requestAnimationFrame(frame);
    }

    function start() {
      cancelAnimationFrame(anim);
      last = performance.now();
      anim = requestAnimationFrame(frame);
    }
    function onVisibility() {
      if (document.visibilityState === "visible") start();
      else cancelAnimationFrame(anim);
    }
    function onPointer(e: PointerEvent) {
      target.x = e.clientX / window.innerWidth;
      target.y = e.clientY / window.innerHeight;
    }

    start();
    document.addEventListener("visibilitychange", onVisibility);
    if (fine && !reduceMotion) window.addEventListener("pointermove", onPointer, { passive: true });

    return () => {
      cancelAnimationFrame(anim);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointer);
    };
  }, [density, speed, connectionDistance, themeAware]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
