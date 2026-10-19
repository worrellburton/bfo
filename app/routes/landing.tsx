import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { lockupOf, modelOf, useBrandLogo } from "../brand";
import { BrandLockup } from "../brand-lockup";
import { Logo3D } from "../logo-3d";
import { ParticleCanvas } from "../particles";

export function meta() {
  return [
    { title: "BFO" },
    {
      name: "description",
      content: "The Burton Family Office puts its resources behind companies that help people, shares what it builds with the people who build it, and holds itself to excellence.",
    },
  ];
}

/**
 * burtonfamilyoffice.com: one page. It opens on BFO; scrolling down, the
 * mark eases back and the mission assembles itself. Each block's words
 * fade into place as it's reached (.reveal → .is-in, word by word), and
 * the closing statement lights up word by word with the scroll itself
 * (--p on .scrub). Mission scrolls there smoothly; nothing reloads.
 * Reduced motion shows everything, still.
 */

const STATS = [
  { value: 76, label: "of the world's net worth sits with the richest 10% of people." },
  { value: 2, label: "is what the poorer half of the world holds between them." },
  { value: 38, label: "of everything gained since 1995 went to the top 1%." },
];

const PRINCIPLES = [
  {
    n: "I",
    title: "Share what we build",
    body: "The people who build our companies should own a piece of what they build. We share ownership and profits with the people who work with us, and give them a real say.",
  },
  {
    n: "II",
    title: "Back work that matters",
    body: "We put our resources into companies that make life better: health and recovery, homes and communities, the land and the people on it. If a business doesn't help people, it isn't for us.",
  },
  {
    n: "III",
    title: "Think long term",
    body: "We'd rather hold for decades than flip for a quick return. We reinvest in the people and places we own, and judge ourselves by what's still standing years from now.",
  },
  {
    n: "IV",
    title: "Do excellent work",
    body: "In the work, in the care, in the details. Doing good is no excuse for doing anything less than our best.",
  },
];

const STATEMENT =
  "The Burton Family Office puts its resources behind companies that help people. We share what we build with the people who build it, and we hold ourselves to excellence in everything we do.";

const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Adds .is-in to each .reveal under the page the first time it scrolls into view. */
function useReveal() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const items = el.querySelectorAll<HTMLElement>(".reveal");
    if (!("IntersectionObserver" in window) || reduced()) {
      items.forEach((n) => n.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("is-in");
          e.target.dispatchEvent(new Event("reveal"));
          io.unobserve(e.target);
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -8% 0px" },
    );
    items.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);
  return root;
}

/**
 * Text whose words fade into place one after another once the nearest
 * .reveal is in. `shimmer` sends a band of gold light through them (on each
 * word, offset so the light still travels the line). The light sits on an
 * inner span: a gradient clipped to text that is itself fading paints as a
 * faint box.
 */
function Words({ text, shimmer = false, step = 0.045, delay = 0 }: { text: string; shimmer?: boolean; step?: number; delay?: number }) {
  const words = text.split(" ");
  return (
    <>
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className="word" style={{ "--w": `${delay + i * step}s`, "--s": `${-i * 0.45}s` } as CSSProperties}>
            {shimmer ? <span className="shimmer">{w}</span> : w}
          </span>
          {i < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </>
  );
}

/** A figure that counts up from zero when its card is revealed. */
function CountUp({ to }: { to: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const host = ref.current?.closest(".reveal");
    if (!host) return;
    let raf = 0;
    const run = () => {
      if (reduced()) return setN(to);
      const start = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / 1600);
        setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    if (host.classList.contains("is-in")) run();
    else host.addEventListener("reveal", run, { once: true });
    return () => {
      cancelAnimationFrame(raf);
      host.removeEventListener("reveal", run);
    };
  }, [to]);
  return <span ref={ref}>{n}</span>;
}

export default function Landing() {
  const [still, setStill] = useState(false);
  const logo = useBrandLogo();
  const model = modelOf(logo);
  const lockup = lockupOf(logo);
  const root = useReveal();
  const scrub = useRef<HTMLElement>(null);
  const mission = useRef<HTMLElement>(null);
  const [past, setPast] = useState(false);

  useEffect(() => setStill(reduced()), []);

  // The scroll drives two things: the hero easing back (--hero, 0 → 1 over
  // the first screen) and the statement lighting up (--p on .scrub).
  useEffect(() => {
    const doc = document.documentElement;
    if (reduced()) {
      scrub.current?.style.setProperty("--p", "1");
      return;
    }
    let raf = 0;
    const update = () => {
      raf = 0;
      const vh = window.innerHeight;
      const y = window.scrollY;
      doc.style.setProperty("--hero", String(Math.min(1, y / vh)));
      setPast(y > vh * 0.75);
      const s = scrub.current;
      if (s) {
        const r = s.getBoundingClientRect();
        const travel = r.height - vh;
        s.style.setProperty("--p", String(Math.max(0, Math.min(1, -r.top / Math.max(1, travel * 0.85)))));
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      doc.style.removeProperty("--hero");
    };
  }, []);

  const toMission = () => mission.current?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth" });
  const toTop = () => window.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" });
  const serif = { fontFamily: "var(--font-brand)" };
  const statementWords = STATEMENT.split(" ");

  return (
    <div ref={root} className="site relative bg-black text-white">
      {/* The backdrop stays put while the page scrolls over it. */}
      <div aria-hidden className="fixed inset-0 overflow-hidden">
        <div className="landing-orb landing-orb-1" />
        <div className="landing-orb landing-orb-2" />
        <div className="landing-orb landing-orb-3" />
        {!still && <ParticleCanvas density={60} speed={0.24} connectionDistance={130} className="absolute inset-0 h-full w-full" />}
      </div>

      {/* Past the first screen, a small mark that takes you back up. */}
      <button type="button" onClick={toTop} aria-label="Back to the top" className={`site-mark ${past ? "site-mark-on" : ""}`} tabIndex={past ? 0 : -1}>
        <BrandLockup font={lockup.font} finish={lockup.finish} size="mark" />
      </button>

      <div className="relative z-10">
        {/* ── BFO ──────────────────────────────────────────────────── */}
        <section className="site-hero flex min-h-dvh items-center justify-center">
          <div className="site-hero-inner text-center select-none px-6">
            {model ? (
              <h1 className="landing-logo mx-auto" aria-label="BFO">
                <Logo3D src={model.glbUrl} poster={model.posterUrl} className="landing-logo-model" interactive spin={!still} exposure={1.1} />
              </h1>
            ) : (
              <h1 className="m-0">
                <BrandLockup font={lockup.font} finish={lockup.finish} size="hero" />
              </h1>
            )}
            <p className="landing-sub uppercase mt-4 sm:mt-6">Ledger Louise, LLC</p>
            <div className="landing-fade-in mt-10 sm:mt-12">
              <button type="button" onClick={toMission} className="mission-link">
                <span>Mission</span>
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
                </svg>
              </button>
            </div>
          </div>
          <div className="site-cue" aria-hidden>
            <span />
          </div>
        </section>

        <div className="site-copy">
          {/* ── The mission, in a line ─────────────────────────────── */}
          <section ref={mission} id="mission" className="mx-auto flex min-h-dvh max-w-[1180px] flex-col justify-center px-6 py-24 text-center sm:px-10">
            <p className="mission-eyebrow reveal justify-center">
              <Words text="Our mission" />
            </p>
            <h2 className="mission-hero reveal mt-6" style={serif}>
              <Words text="Our resources, put to work" shimmer step={0.08} delay={0.15} />
              <br />
              <span className="mission-italic">
                <Words text="for people." shimmer step={0.08} delay={0.55} />
              </span>
            </h2>
            <p className="mission-lede reveal mx-auto mt-10 max-w-[700px]">
              <Words
                text="We're a family office. Most family offices exist to grow a family's money. We'd rather put our time, our energy and our resources behind companies that make people's lives better, and share what we build with the people who build it."
                step={0.022}
                delay={0.2}
              />
            </p>
          </section>

          {/* ── The world as it is ─────────────────────────────────── */}
          <section className="mx-auto max-w-[1180px] px-6 py-20 sm:px-10 sm:py-28">
            <p className="mission-eyebrow reveal">
              <Words text="The world as it is" />
            </p>
            <h2 className="mission-h2 reveal mt-5 max-w-[860px]" style={serif}>
              <Words text="A small share of people own most of what there is to own." step={0.05} delay={0.1} />
            </h2>
            <div className="mt-14 grid gap-5 sm:grid-cols-3">
              {STATS.map((s, i) => (
                <div key={s.value} className="mission-stat reveal reveal-block" style={{ "--d": `${0.12 * i}s` } as CSSProperties}>
                  <p className="mission-figure" style={serif}>
                    <CountUp to={s.value} />
                    <span className="mission-pct">%</span>
                  </p>
                  <p className="mission-stat-label">{s.label}</p>
                </div>
              ))}
            </div>
            <p className="mission-body reveal mt-14 max-w-[860px]">
              <Words
                text="Much of it grows out of sight, in private equity and private funds, where the returns go to a small circle of owners and the people doing the work rarely share in what they build. That's how capitalism is mostly practiced."
                step={0.018}
              />
            </p>
            <p className="mission-turn reveal mt-6 max-w-[860px]" style={serif}>
              <Words text="We think there's a better way to practice it." shimmer step={0.07} delay={0.1} />
            </p>
            <p className="mission-source reveal reveal-block mt-8" style={{ "--d": "0.3s" } as CSSProperties}>
              Figures: World Inequality Report 2022, World Inequality Lab (2021 data).
            </p>
          </section>

          {/* ── What we believe ────────────────────────────────────── */}
          <section className="mx-auto max-w-[1180px] px-6 py-20 sm:px-10 sm:py-28">
            <p className="mission-eyebrow reveal">
              <Words text="What we believe" />
            </p>
            <h2 className="mission-h2 reveal mt-5 max-w-[860px]" style={serif}>
              <Words text="People first. Returns follow." step={0.08} delay={0.1} />
            </h2>
            <div className="mission-grid mt-14 grid gap-px overflow-hidden rounded-3xl sm:grid-cols-2">
              {PRINCIPLES.map((p, i) => (
                <article key={p.n} className="mission-principle reveal">
                  <span className="mission-numeral word" style={{ ...serif, "--w": `${0.1 * (i % 2)}s` } as CSSProperties}>
                    {p.n}
                  </span>
                  <h3 className="mission-h3" style={serif}>
                    <Words text={p.title} step={0.06} delay={0.1 + 0.1 * (i % 2)} />
                  </h3>
                  <p className="mission-body mt-3">
                    <Words text={p.body} step={0.014} delay={0.3 + 0.1 * (i % 2)} />
                  </p>
                </article>
              ))}
            </div>
          </section>

          {/* ── The statement: lights up word by word with the scroll ── */}
          <section ref={scrub} className="scrub relative" style={{ "--n": statementWords.length } as CSSProperties}>
            <div className="scrub-stage sticky top-0 mx-auto flex min-h-dvh max-w-[1000px] flex-col justify-center px-6 py-16 text-center sm:px-10">
              <p className="mission-eyebrow justify-center">Our mission</p>
              <blockquote className="mission-statement mt-8" style={serif}>
                {statementWords.map((w, i) => (
                  <Fragment key={i}>
                    <span className="scrub-word" style={{ "--i": i } as CSSProperties}>
                      {w}
                    </span>
                    {i < statementWords.length - 1 ? " " : null}
                  </Fragment>
                ))}
              </blockquote>
              <p className="mission-coda scrub-tail mt-10" style={serif}>
                <span className="shimmer">Because the things worth building are built together.</span>
              </p>
            </div>
          </section>

          <footer className="flex flex-col items-center gap-6 px-6 pb-14 pt-10 text-center">
            <button type="button" onClick={toTop} className="mission-link">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
              </svg>
              <span>Back to top</span>
            </button>
            <p className="mission-foot">Burton Family Office · Ledger Louise, LLC</p>
          </footer>
        </div>
      </div>
    </div>
  );
}
