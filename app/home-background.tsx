import { useEffect, useRef } from "react";

/**
 * Home's backdrop: a faint engineering grid (dots every 24px, hairlines every
 * 96px) that is only really visible where a few slow, soft lights drift over
 * it, plus a handful of tiny "packets" that travel along the hairlines and
 * occasionally turn at an intersection.
 *
 * One fixed, pointer-events-none canvas behind the page content. The grid is
 * rasterised once per size/theme into offscreen canvases, so a frame is just a
 * few gradient fills and two composites. It pauses while the tab is hidden,
 * follows devicePixelRatio and window size, and draws a single still frame
 * under prefers-reduced-motion. Elements marked `data-bg-solid` (the page's
 * cards) are cut out of it, so it only ever shows in the gutters.
 */

const DOT = 24; // dot pitch, CSS px
const MAJOR = 96; // hairline pitch, CSS px

type Palette = {
  ambient: string; // the always-on grid
  lights: [string, string, string]; // rgb triplets for the drifting lights
  lightAlpha: number;
  scanAlpha: number;
  packet: string;
  packetAlpha: number;
};

const DARK: Palette = {
  ambient: "rgba(255,255,255,0.034)",
  lights: ["129,140,248", "34,211,238", "165,180,252"],
  lightAlpha: 0.26,
  scanAlpha: 0.07,
  packet: "165,180,252",
  packetAlpha: 0.38,
};

const LIGHT: Palette = {
  ambient: "rgba(15,23,42,0.04)",
  lights: ["79,70,229", "71,85,105", "14,116,144"],
  lightAlpha: 0.2,
  scanAlpha: 0.05,
  packet: "79,70,229",
  packetAlpha: 0.28,
};

type Packet = {
  x: number;
  y: number;
  axis: 0 | 1; // 0 = moving along x, 1 = along y
  dir: 1 | -1;
  speed: number; // px/s
  trail: { x: number; y: number; t: number }[];
  lastSample: number;
};

export function HomeBackground({ isDark }: { isDark: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const darkRef = useRef(isDark);
  const redrawRef = useRef<() => void>(() => {});

  useEffect(() => {
    darkRef.current = isDark;
    redrawRef.current();
  }, [isDark]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = reduceMq.matches;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let mask: HTMLCanvasElement | null = null; // opaque white grid shape
    let ambient: HTMLCanvasElement | null = null; // pre-tinted faint grid
    let builtFor: boolean | null = null; // theme the ambient layer was tinted for
    let raf = 0;
    let last = 0;
    const t0 = performance.now();
    let packets: Packet[] = [];

    const offscreen = () => document.createElement("canvas");

    function buildMask() {
      mask = offscreen();
      mask.width = canvas!.width;
      mask.height = canvas!.height;
      const m = mask.getContext("2d")!;
      m.fillStyle = "#fff";
      m.strokeStyle = "#fff";
      // Dots
      const r = Math.max(1, Math.round(0.9 * dpr));
      for (let y = DOT; y < h; y += DOT) {
        for (let x = DOT; x < w; x += DOT) {
          m.fillRect(Math.round(x * dpr) - (r >> 1), Math.round(y * dpr) - (r >> 1), r, r);
        }
      }
      // Hairlines, aligned to device pixels so they stay one pixel crisp.
      m.lineWidth = 1;
      m.globalAlpha = 0.55;
      m.beginPath();
      for (let x = MAJOR; x < w; x += MAJOR) {
        const px = Math.round(x * dpr) + 0.5;
        m.moveTo(px, 0);
        m.lineTo(px, canvas!.height);
      }
      for (let y = MAJOR; y < h; y += MAJOR) {
        const py = Math.round(y * dpr) + 0.5;
        m.moveTo(0, py);
        m.lineTo(canvas!.width, py);
      }
      m.stroke();
      builtFor = null;
    }

    function buildAmbient() {
      if (!mask) return;
      const dark = darkRef.current;
      ambient = offscreen();
      ambient.width = mask.width;
      ambient.height = mask.height;
      const a = ambient.getContext("2d")!;
      a.fillStyle = (dark ? DARK : LIGHT).ambient;
      a.fillRect(0, 0, ambient.width, ambient.height);
      a.globalCompositeOperation = "destination-in";
      a.drawImage(mask, 0, 0);
      builtFor = dark;
    }

    function spawn(p?: Packet): Packet {
      const axis: 0 | 1 = Math.random() < 0.6 ? 0 : 1;
      const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      const lanes = Math.max(1, Math.floor((axis === 0 ? h : w) / MAJOR) - 1);
      const lane = (1 + Math.floor(Math.random() * lanes)) * MAJOR;
      const span = axis === 0 ? w : h;
      const start = dir === 1 ? -40 - Math.random() * span * 0.5 : span + 40 + Math.random() * span * 0.5;
      const q = p ?? ({} as Packet);
      q.axis = axis;
      q.dir = dir;
      q.speed = 34 + Math.random() * 40;
      q.x = axis === 0 ? start : lane;
      q.y = axis === 0 ? lane : start;
      q.trail = [];
      q.lastSample = 0;
      return q;
    }

    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      buildMask();
      buildAmbient();
      if (!packets.length) packets = Array.from({ length: w < 640 ? 4 : 7 }, () => spawn());
      for (const p of packets) if (p.x > w + 400 || p.y > h + 400) spawn(p);
    }

    function draw(now: number) {
      const dark = darkRef.current;
      const pal = dark ? DARK : LIGHT;
      if (builtFor !== dark) buildAmbient();
      const t = (now - t0) / 1000;
      const W = canvas!.width;
      const H = canvas!.height;

      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.globalCompositeOperation = "source-over";
      ctx!.clearRect(0, 0, W, H);

      // Live only in the gutters: cards marked [data-bg-solid] are cut out, so
      // nothing moves behind the (translucent) glass or under text.
      ctx!.save();
      ctx!.beginPath();
      ctx!.rect(0, 0, W, H);
      for (const el of document.querySelectorAll<HTMLElement>("[data-bg-solid]")) {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > h || !r.width) continue;
        const x = r.left * dpr - dpr;
        const y = r.top * dpr - dpr;
        const rw = r.width * dpr + 2 * dpr;
        const rh = r.height * dpr + 2 * dpr;
        if (typeof ctx!.roundRect === "function") ctx!.roundRect(x, y, rw, rh, 16 * dpr);
        else ctx!.rect(x, y, rw, rh);
      }
      ctx!.clip("evenodd");

      // 1. Lights: slow Lissajous drifts, plus a soft band scanning downward.
      const R = Math.max(W, H) * 0.32;
      const lights = [
        { x: 0.5 + 0.38 * Math.sin(t * 0.045), y: 0.32 + 0.24 * Math.sin(t * 0.031 + 1.2), c: pal.lights[0], k: 1 },
        { x: 0.5 + 0.42 * Math.sin(t * 0.033 + 2.4), y: 0.62 + 0.26 * Math.cos(t * 0.027), c: pal.lights[1], k: 0.75 },
        { x: 0.5 + 0.3 * Math.cos(t * 0.052 + 4.1), y: 0.5 + 0.34 * Math.sin(t * 0.041 + 3.3), c: pal.lights[2], k: 0.6 },
      ];
      for (const l of lights) {
        const cx = l.x * W;
        const cy = l.y * H;
        const g = ctx!.createRadialGradient(cx, cy, 0, cx, cy, R);
        g.addColorStop(0, `rgba(${l.c},${pal.lightAlpha * l.k})`);
        g.addColorStop(0.45, `rgba(${l.c},${pal.lightAlpha * l.k * 0.35})`);
        g.addColorStop(1, `rgba(${l.c},0)`);
        ctx!.fillStyle = g;
        ctx!.fillRect(cx - R, cy - R, R * 2, R * 2);
      }
      const period = 16;
      const scanY = (((t % period) / period) * 1.4 - 0.2) * H;
      const band = 140 * dpr;
      const sg = ctx!.createLinearGradient(0, scanY - band, 0, scanY + band);
      sg.addColorStop(0, `rgba(${pal.lights[0]},0)`);
      sg.addColorStop(0.5, `rgba(${pal.lights[0]},${pal.scanAlpha})`);
      sg.addColorStop(1, `rgba(${pal.lights[0]},0)`);
      ctx!.fillStyle = sg;
      ctx!.fillRect(0, scanY - band, W, band * 2);

      // 2. Keep the light only where the grid is.
      if (mask) {
        ctx!.globalCompositeOperation = "destination-in";
        ctx!.drawImage(mask, 0, 0);
      }

      // 3. The always-on faint grid.
      ctx!.globalCompositeOperation = "source-over";
      if (ambient) ctx!.drawImage(ambient, 0, 0);

      // 4. Packets with fading trails.
      if (!reduced) {
        ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx!.lineCap = "round";
        const TRAIL = 2.4; // seconds of tail
        for (const p of packets) {
          const pts = [...p.trail, { x: p.x, y: p.y, t }];
          for (let i = 1; i < pts.length; i++) {
            const age = t - pts[i].t;
            const a = pal.packetAlpha * Math.max(0, 1 - age / TRAIL) ** 2;
            if (a < 0.004) continue;
            ctx!.strokeStyle = `rgba(${pal.packet},${a})`;
            ctx!.lineWidth = 1;
            ctx!.beginPath();
            ctx!.moveTo(pts[i - 1].x, pts[i - 1].y);
            ctx!.lineTo(pts[i].x, pts[i].y);
            ctx!.stroke();
          }
          ctx!.fillStyle = `rgba(${pal.packet},${pal.packetAlpha * 1.6})`;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, 1.3, 0, Math.PI * 2);
          ctx!.fill();
        }
      }
      ctx!.restore();
    }

    function step(dt: number, t: number) {
      for (const p of packets) {
        const move = p.speed * dt * p.dir;
        const along = p.axis === 0 ? p.x : p.y;
        const next = along + move;
        // Did we cross an intersection? Maybe turn there.
        const a = Math.floor(along / MAJOR);
        const b = Math.floor(next / MAJOR);
        if (a !== b && Math.random() < 0.22) {
          const at = (p.dir === 1 ? b : a) * MAJOR;
          if (p.axis === 0) p.x = at;
          else p.y = at;
          p.trail.push({ x: p.x, y: p.y, t });
          p.axis = p.axis === 0 ? 1 : 0;
          p.dir = Math.random() < 0.5 ? 1 : -1;
        } else if (p.axis === 0) p.x = next;
        else p.y = next;

        if (t - p.lastSample > 0.08) {
          p.trail.push({ x: p.x, y: p.y, t });
          p.lastSample = t;
        }
        while (p.trail.length && t - p.trail[0].t > 2.6) p.trail.shift();
        if (p.x < -420 || p.x > w + 420 || p.y < -420 || p.y > h + 420) spawn(p);
      }
    }

    function frame(now: number) {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      step(dt, (now - t0) / 1000);
      draw(now);
      raf = requestAnimationFrame(frame);
    }

    function start() {
      cancelAnimationFrame(raf);
      last = 0;
      if (reduced) {
        // One still frame: lights parked at their t=0 positions, no packets.
        draw(t0);
        return;
      }
      if (document.visibilityState === "visible") raf = requestAnimationFrame(frame);
    }

    redrawRef.current = () => {
      if (reduced) draw(t0);
    };

    const onResize = () => {
      resize();
      if (reduced) draw(t0);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") cancelAnimationFrame(raf);
      else start();
    };
    const onScroll = () => {
      if (reduced) draw(t0);
    };
    const onMotion = () => {
      reduced = reduceMq.matches;
      start();
    };

    // The still (reduced-motion) frame cuts the cards out where they were when
    // it was drawn; redraw it when the page reflows (data arriving, a card
    // growing) so the grid never shows through a card.
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => reduced && draw(t0)) : null;
    ro?.observe(document.body);

    resize();
    start();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    reduceMq.addEventListener("change", onMotion);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      redrawRef.current = () => {};
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      reduceMq.removeEventListener("change", onMotion);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full motion-safe:animate-[bfo-fade_1.2s_ease-out_both]"
    />
  );
}
