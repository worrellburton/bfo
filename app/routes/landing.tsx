<<<<<<< HEAD
import { useEffect, useRef, useState } from "react";
=======
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router";
>>>>>>> origin/main
import { lockupOf, modelOf, useBrandLogo } from "../brand";
import { BrandLockup } from "../brand-lockup";
import { Logo3D } from "../logo-3d";

export function meta() {
<<<<<<< HEAD
  return [{ title: "Burton Family Office" }, { name: "description", content: "Burton Family Office" }];
=======
  return [{ title: "Burton Family Office" }, { name: "description", content: "Burton Family Office — the private office of Ledger Louise, LLC." }];
>>>>>>> origin/main
}

const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
<<<<<<< HEAD
 * The front door: the mark, and nothing else, on a sky that never stops
 * moving. The sky is one canvas (Sky below): five veils of colour drifting
 * on slow paths, blended with light, and a field of motes that twinkle and
 * lean a little toward the pointer. Grain and a vignette sit over it in
 * CSS. The mark waits for its typeface, then comes in letter by letter.
 * Reduced motion gets one still frame of the sky and the mark already in.
 */
export default function Landing() {
  const [ready, setReady] = useState(false);
=======
 * The front door. The backdrop is the public layout's (public-layout.tsx):
 * aurora, orbs, particles, grain. In front: the mark, letter by letter,
 * a line, the way in. The page listens to the pointer (a little parallax,
 * a spotlight, a magnetic button) unless motion is reduced.
 *
 * /mission is unlisted: nothing here links to it, but its link glides back
 * here without a reload.
 */
export default function Landing() {
  const navigate = useNavigate();
  const [intro] = useState(() => !shown);
>>>>>>> origin/main
  const [still, setStill] = useState(false);
  // The lockup waits for its typeface, so it never flashes in a fallback font.
  const [ready, setReady] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const logo = useBrandLogo();
  const model = modelOf(logo);
  const lockup = lockupOf(logo);
<<<<<<< HEAD

  useEffect(() => {
=======
  const enter = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    shown = true;
>>>>>>> origin/main
    setStill(reduced());
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      setReady(true);
    };
    const fonts = document.fonts;
<<<<<<< HEAD
    if (fonts?.load) fonts.load(`${lockup.font.weight} 10px "${lockup.font.family}"`).then(go, go);
    else go();
=======
    if (fonts?.load) {
      Promise.all([fonts.load(`${lockup.font.weight} 10px "${lockup.font.family}"`), fonts.load('400 10px "Inter"')]).then(go, go);
    } else go();
    // A slow network shouldn't hold the page: most of a second at most.
>>>>>>> origin/main
    const t = setTimeout(go, 700);
    return () => clearTimeout(t);
  }, [lockup.font.family, lockup.font.weight]);

<<<<<<< HEAD
  return (
    <div className={`door ${ready ? "door-ready" : ""} ${still ? "door-still" : ""}`}>
      <Sky still={still} />
      <div aria-hidden className="door-grain" />
      <div aria-hidden className="door-vignette" />
      <main className="door-center">
=======
  // The pointer: parallax and the spotlight (CSS variables on <html>, read by the backdrop too), and the magnetic button.
  useEffect(() => {
    if (reduced() || !window.matchMedia?.("(pointer: fine)").matches) return;
    const root = document.documentElement;
    let raf = 0;
    let px = 0;
    let py = 0;
    let mx = 50;
    let my = 50;
    const apply = () => {
      raf = 0;
      root.style.setProperty("--px", px.toFixed(3));
      root.style.setProperty("--py", py.toFixed(3));
      root.style.setProperty("--mx", `${mx.toFixed(1)}%`);
      root.style.setProperty("--my", `${my.toFixed(1)}%`);
    };
    const onMove = (e: PointerEvent) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      px = (e.clientX / w) * 2 - 1;
      py = (e.clientY / h) * 2 - 1;
      mx = (e.clientX / w) * 100;
      my = (e.clientY / h) * 100;
      const b = enter.current;
      if (b) {
        const r = b.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const near = Math.hypot(dx, dy) < 140;
        b.style.transform = near ? `translate(${(dx * 0.22).toFixed(1)}px, ${(dy * 0.22).toFixed(1)}px)` : "";
      }
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      px = py = 0;
      mx = my = 50;
      if (enter.current) enter.current.style.transform = "";
      if (!raf) raf = requestAnimationFrame(apply);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
      root.style.removeProperty("--px");
      root.style.removeProperty("--py");
      root.style.removeProperty("--mx");
      root.style.removeProperty("--my");
    };
  }, []);

  // Enter goes in; the page dims on its way out.
  const leave = (e?: { preventDefault(): void }) => {
    e?.preventDefault();
    if (leaving) return;
    if (reduced()) return navigate("/login");
    setLeaving(true);
    setTimeout(() => navigate("/login"), 320);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey) leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  const year = new Date().getFullYear();
  const state = `${intro ? "" : "no-intro"} ${ready ? "landing-ready" : ""} ${leaving ? "landing-leaving" : ""} ${still ? "landing-still" : ""}`;

  return (
    <div className={`landing ${state}`}>
      {/* Corner marks, like a letterpress card. */}
      <div aria-hidden className="landing-frame">
        <i />
        <i />
        <i />
        <i />
      </div>

      <header className="landing-top">
        <span className="landing-top-name">Burton Family Office</span>
        <Link to="/login" onClick={leave} className="landing-top-link">
          Sign in
        </Link>
      </header>

      <main className="landing-center" style={{ "--depth": "1" } as CSSProperties}>
        <div aria-hidden className="landing-halo" />
        <svg aria-hidden className="landing-orbit" viewBox="0 0 400 400">
          <circle cx="200" cy="200" r="196" />
          <circle cx="200" cy="200" r="150" />
        </svg>
>>>>>>> origin/main
        {model ? (
          <h1 className="landing-logo door-mark" aria-label="BFO">
            <Logo3D src={model.glbUrl} poster={model.posterUrl} className="landing-logo-model" interactive spin={!still} exposure={1.1} />
          </h1>
        ) : (
<<<<<<< HEAD
          <h1 className="door-mark m-0">
            <BrandLockup font={lockup.font} finish={lockup.finish} size="hero" letters />
          </h1>
        )}
      </main>
=======
          <h1 className="m-0 vt-mark landing-hero">
            <BrandLockup font={lockup.font} finish={lockup.finish} size="hero" letters />
          </h1>
        )}
        <p className="landing-tagline">A private family office</p>
        <p className="landing-sub uppercase">Ledger Louise, LLC</p>
        <Link to="/login" onClick={leave} ref={enter} className="landing-enter">
          <span className="landing-enter-ring" aria-hidden />
          <span className="landing-enter-text">Sign in</span>
          <span className="landing-enter-arrow" aria-hidden>
            →
          </span>
        </Link>
        <p className="landing-hint" aria-hidden>
          or press Enter
        </p>
      </main>

      <footer className="landing-bottom">
        <span>© {year} Ledger Louise, LLC</span>
        <span className="landing-bottom-links">
          <Link to="/legal/terms">Terms</Link>
          <span aria-hidden>·</span>
          <Link to="/legal/privacy">Privacy</Link>
        </span>
      </footer>
>>>>>>> origin/main
    </div>
  );
}

/** A veil of colour: a soft radial light that wanders on its own slow path. */
type Veil = { h: number; s: number; l: number; a: number; r: number; ax: number; ay: number; fx: number; fy: number; px: number; py: number };
type Mote = { x: number; y: number; z: number; r: number; p: number; h: number };

const VEILS: Veil[] = [
  { h: 222, s: 80, l: 52, a: 0.5, r: 0.62, ax: 0.42, ay: 0.3, fx: 0.11, fy: 0.08, px: 0.2, py: 1.1 },
  { h: 262, s: 70, l: 50, a: 0.42, r: 0.58, ax: 0.38, ay: 0.34, fx: 0.07, fy: 0.12, px: 2.1, py: 0.4 },
  { h: 182, s: 70, l: 46, a: 0.3, r: 0.5, ax: 0.3, ay: 0.4, fx: 0.09, fy: 0.06, px: 4.0, py: 2.6 },
  { h: 42, s: 72, l: 56, a: 0.22, r: 0.46, ax: 0.34, ay: 0.26, fx: 0.05, fy: 0.1, px: 1.3, py: 3.3 },
  { h: 36, s: 30, l: 86, a: 0.1, r: 0.36, ax: 0.2, ay: 0.2, fx: 0.13, fy: 0.09, px: 5.2, py: 0.9 },
];

function Sky({ still }: { still: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let motes: Mote[] = [];
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // The pointer, eased: the motes lean toward it a little.
    let tx = 0;
    let ty = 0;
    let lx = 0;
    let ly = 0;

    const size = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(220, (w * h) / 9000));
      seed = 11;
      motes = Array.from({ length: n }, () => ({ x: rnd() * w, y: rnd() * h, z: rnd(), r: 0.5 + rnd() * 1.3, p: rnd() * Math.PI * 2, h: [222, 262, 182, 42][Math.floor(rnd() * 4)] }));
    };

    const draw = (t: number) => {
      const s = t / 1000;
      lx += (tx - lx) * 0.03;
      ly += (ty - ly) * 0.03;
      // The deep ground.
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#05060b";
      ctx.fillRect(0, 0, w, h);
      // The veils, added as light.
      ctx.globalCompositeOperation = "lighter";
      const m = Math.max(w, h);
      for (const v of VEILS) {
        const x = w * (0.5 + v.ax * Math.sin(s * v.fx + v.px));
        const y = h * (0.5 + v.ay * Math.cos(s * v.fy + v.py));
        const r = m * v.r;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `hsla(${v.h}, ${v.s}%, ${v.l}%, ${v.a})`);
        g.addColorStop(0.45, `hsla(${v.h}, ${v.s}%, ${v.l}%, ${v.a * 0.28})`);
        g.addColorStop(1, `hsla(${v.h}, ${v.s}%, ${v.l}%, 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // The motes: nearer ones bigger, brighter, and more moved by the pointer.
      for (const mo of motes) {
        const tw = 0.55 + 0.45 * Math.sin(s * (0.6 + mo.z) + mo.p);
        const x = mo.x + lx * (6 + 22 * mo.z) + Math.sin(s * 0.08 + mo.p) * 6 * mo.z;
        const y = mo.y + ly * (4 + 16 * mo.z) + Math.cos(s * 0.06 + mo.p) * 5 * mo.z;
        const r = mo.r * (0.6 + mo.z);
        ctx.fillStyle = `hsla(${mo.h}, 70%, 80%, ${(0.12 + 0.5 * mo.z) * tw})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        if (mo.z > 0.75) {
          const g = ctx.createRadialGradient(x, y, 0, x, y, r * 6);
          g.addColorStop(0, `hsla(${mo.h}, 80%, 80%, ${0.18 * tw})`);
          g.addColorStop(1, `hsla(${mo.h}, 80%, 80%, 0)`);
          ctx.fillStyle = g;
          ctx.fillRect(x - r * 6, y - r * 6, r * 12, r * 12);
        }
      }
    };

    size();
    if (still) {
      draw(4000);
      const onResize = () => {
        size();
        draw(4000);
      };
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }
    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      // Thirty frames a second is plenty for weather this slow.
      if (t - last < 33) return;
      last = t;
      draw(t);
    };
    const onMove = (e: PointerEvent) => {
      tx = (e.clientX / w) * 2 - 1;
      ty = (e.clientY / h) * 2 - 1;
    };
    const onLeave = () => {
      tx = 0;
      ty = 0;
    };
    const onVisible = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", size);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [still]);
  return <canvas ref={ref} aria-hidden className="door-sky" />;
}
