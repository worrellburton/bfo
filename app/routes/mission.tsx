import { Fragment, useEffect, useRef, type CSSProperties } from "react";
import { Link } from "react-router";
import { lockupOf, useBrandLogo } from "../brand";
import { BrandLockup } from "../brand-lockup";

export function meta() {
  return [
    { title: "BFO - Mission" },
    {
      name: "description",
      content: "The Burton Family Office began with people who wanted to help, and it still does. We build and operate companies that help people.",
    },
  ];
}

/**
 * The mission, told as the family office's story, on the public layout's
 * backdrop. Each block's words fade up into place as it scrolls into view
 * (.reveal → .is-in), and the closing statement lights up word by word with
 * the scroll itself (--p on .scrub). Reduced motion shows it all, still.
 */

const CHAPTERS = [
  {
    n: "I",
    label: "Where it began",
    title: "Generous first.",
    body: "The Burton Family Office didn't begin with a business plan. It began with people who were generous long before they were in business. When someone needed help, they said yes and worked out the details later. They weren't financiers. They simply believed that what you have is meant to do some good.",
  },
  {
    n: "II",
    label: "What we learned",
    title: "Then we learned the business.",
    body: "Good intentions need good management to last. Over the years we learned to keep careful books, to make decisions slowly and well, and to build companies that stand on their own rather than lean on a gift. The heart was always there. The discipline came with time.",
  },
  {
    n: "III",
    label: "What stayed the same",
    title: "The question hasn't changed.",
    body: "Every decision still starts where theirs did: who does this help? We answer it now with more experience and over a longer horizon, but we ask it the same way, and we still mean it.",
  },
  {
    n: "IV",
    label: "Where we are now",
    title: "Companies that help people.",
    body: "Today we own and operate companies whose work is helping people, whether that's getting well, finding a place to call home, or caring for the land and the people on it. We run them carefully, we stay for the long haul, and the people who work in them share in what we build together.",
  },
];

const STATEMENT =
  "The Burton Family Office began with people who wanted to help, and it still does. We build and operate companies that help people, and we run them with the care and discipline they deserve.";

const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Adds .is-in to each .reveal under the page the first time it scrolls into view. */
function useReveal() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const items = el.querySelectorAll<HTMLElement>(".reveal");
    if (!("IntersectionObserver" in window) || reduced()) {
      items.forEach((n) => n.classList.add("is-in", "is-lit"));
      return;
    }
    const timers: number[] = [];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const t = e.target;
          t.classList.add("is-in");
          // The gold light comes on once the words have settled (see .is-lit in app.css).
          timers.push(window.setTimeout(() => t.classList.add("is-lit"), 2400));
          io.unobserve(t);
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -8% 0px" },
    );
    items.forEach((n) => io.observe(n));
    return () => {
      io.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);
  return root;
}

/**
 * Text whose words fade into place one after another once the nearest
 * .reveal is in. `shimmer` sends a band of gold light through them (on each
 * word, offset so the light still travels the line) once they've settled:
 * a gradient clipped to text paints as a faint box while anything around it
 * is fading.
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

export default function Mission() {
  const lockup = lockupOf(useBrandLogo());
  const root = useReveal();
  const scrub = useRef<HTMLElement>(null);
  const serif = { fontFamily: "var(--font-brand)" };
  const statementWords = STATEMENT.split(" ");

  // A fresh visit starts at the top, not wherever the landing page was.
  useEffect(() => window.scrollTo(0, 0), []);

  // The closing statement lights up as its tall section scrolls by.
  useEffect(() => {
    const s = scrub.current;
    if (!s) return;
    if (reduced()) {
      s.style.setProperty("--p", "1");
      return;
    }
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = s.getBoundingClientRect();
      const travel = r.height - window.innerHeight;
      s.style.setProperty("--p", String(Math.max(0, Math.min(1, -r.top / Math.max(1, travel * 0.85)))));
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
    };
  }, []);

  return (
    <div ref={root} className="site">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="mx-auto flex max-w-[1180px] items-center justify-between px-6 pt-6 sm:px-10 sm:pt-8">
        <Link to="/" viewTransition prefetch="render" aria-label="Burton Family Office home" className="vt-mark mission-mark">
          <BrandLockup font={lockup.font} finish={lockup.finish} size="compact" />
        </Link>
        <Link to="/" viewTransition prefetch="render" className="mission-back">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Home
        </Link>
      </header>

      {/* ── Opening ────────────────────────────────────────────────── */}
      <section className="relative mx-auto flex min-h-[86dvh] max-w-[1180px] flex-col justify-center px-6 pb-28 pt-16 text-center sm:px-10">
        <p className="mission-eyebrow reveal justify-center">
          <Words text="Our story" delay={0.1} />
        </p>
        <h1 className="mission-hero reveal mt-6" style={serif}>
          <Words text="It started with people" step={0.08} delay={0.3} />
          <br />
          <span className="mission-italic">
            <Words text="who wanted to help." shimmer step={0.08} delay={0.65} />
          </span>
        </h1>
        <p className="mission-lede reveal mx-auto mt-10 max-w-[680px]">
          <Words
            text="Long before there was a family office, there was a family that gave. This is how that became the Burton Family Office, and why it still works the way it does."
            step={0.022}
            delay={1.1}
          />
        </p>
        <div className="site-cue" aria-hidden>
          <span />
        </div>
      </section>

      {/* ── The story ──────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1180px] px-6 sm:px-10">
        {CHAPTERS.map((c) => (
          <article key={c.n} className="chapter reveal grid gap-6 py-16 sm:py-24 md:grid-cols-[230px_minmax(0,1fr)] md:gap-14">
            <div className="chapter-side">
              <span className="chapter-numeral word" style={serif}>
                {c.n}
              </span>
              <p className="chapter-label word" style={{ "--w": "0.08s" } as CSSProperties}>
                {c.label}
              </p>
            </div>
            <div className="max-w-[760px]">
              <h2 className="mission-h2" style={serif}>
                <Words text={c.title} step={0.07} delay={0.15} />
              </h2>
              <p className="chapter-body mt-6">
                <Words text={c.body} step={0.012} delay={0.45} />
              </p>
            </div>
          </article>
        ))}
      </section>

      {/* ── The statement: lights up word by word with the scroll ── */}
      <section ref={scrub} className="scrub relative" style={{ "--n": statementWords.length } as CSSProperties}>
        <div className="sticky top-0 mx-auto flex min-h-dvh max-w-[1000px] flex-col justify-center px-6 py-16 text-center sm:px-10">
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
            Same heart. More business sense.
          </p>
        </div>
      </section>

      <footer className="flex flex-col items-center gap-6 px-6 pb-14 pt-10 text-center">
        <Link to="/" viewTransition prefetch="render" className="mission-link">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          <span>Home</span>
        </Link>
        <p className="mission-foot">Burton Family Office</p>
      </footer>
    </div>
  );
}
