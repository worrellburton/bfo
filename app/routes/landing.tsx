import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router";
import { lockupOf, modelOf, useBrandLogo } from "../brand";
import { BrandLockup } from "../brand-lockup";
import { Logo3D } from "../logo-3d";

export function meta() {
  return [{ title: "Burton Family Office" }, { name: "description", content: "Burton Family Office — the private office of Ledger Louise, LLC." }];
}

/** Whether the landing page has already been seen this visit: coming back from /mission, it doesn't replay its entrance. */
let shown = false;

const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
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
  const [still, setStill] = useState(false);
  // The lockup waits for its typeface, so it never flashes in a fallback font.
  const [ready, setReady] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const logo = useBrandLogo();
  const model = modelOf(logo);
  const lockup = lockupOf(logo);
  const enter = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    shown = true;
    setStill(reduced());
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      setReady(true);
    };
    const fonts = document.fonts;
    if (fonts?.load) {
      Promise.all([fonts.load(`${lockup.font.weight} 10px "${lockup.font.family}"`), fonts.load('400 10px "Inter"')]).then(go, go);
    } else go();
    // A slow network shouldn't hold the page: most of a second at most.
    const t = setTimeout(go, 700);
    return () => clearTimeout(t);
  }, [lockup.font.family, lockup.font.weight]);

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
        {model ? (
          <h1 className="landing-logo mx-auto" aria-label="BFO">
            <Logo3D src={model.glbUrl} poster={model.posterUrl} className="landing-logo-model" interactive spin={!still} exposure={1.1} />
          </h1>
        ) : (
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
    </div>
  );
}
