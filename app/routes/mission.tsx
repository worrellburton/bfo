import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { lockupOf, useBrandLogo } from "../brand";
import { BrandLockup } from "../brand-lockup";

export function meta() {
  return [
    { title: "BFO - Mission" },
    { name: "description", content: "The Burton Family Office puts capital to work for people: companies that help humanity, ownership shared with the people who build them, and excellence in everything we do." },
  ];
}

/**
 * The mission, on the public layout's backdrop. Lines fade up as they reach
 * the screen ([data-reveal] → .is-in), the key lines shimmer, and the
 * figures count up once they're seen. Under reduced motion everything is
 * simply there.
 */

const STATS = [
  { value: 76, label: "of the world's wealth is held by its richest 10%." },
  { value: 2, label: "is all that the poorer half of humanity holds." },
  { value: 38, label: "of all new wealth since 1995 went to the top 1%." },
];

const PRINCIPLES = [
  {
    n: "I",
    title: "Share what we build",
    body: "The people who build our companies should own part of what they build. We put real ownership, profit sharing and a voice in the hands of the people who work with us, because wealth that is shared is wealth that is earned.",
  },
  {
    n: "II",
    title: "Back work that matters",
    body: "We invest in companies that make life measurably better: health and recovery, homes and communities, the land and the people on it. If a business doesn't help people, it doesn't need our capital.",
  },
  {
    n: "III",
    title: "Think in generations",
    body: "Patient capital, not quick exits. We hold for decades, reinvest in the people and places we own, and measure success by what is still standing long after us.",
  },
  {
    n: "IV",
    title: "Be excellent",
    body: "In the work, in the care, in the details. A purpose is never an excuse for doing anything less than our best.",
  },
];

/** Adds .is-in to each [data-reveal] inside the page the first time it scrolls into view. */
function useReveal() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const items = el.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!("IntersectionObserver" in window) || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
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
      { threshold: 0.18, rootMargin: "0px 0px -6% 0px" },
    );
    items.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);
  return root;
}

/** A figure that counts up from zero when its card is revealed. */
function CountUp({ to }: { to: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const host = ref.current?.closest("[data-reveal]");
    if (!host) return;
    let raf = 0;
    const run = () => {
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return setN(to);
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

/**
 * Words that fade up one after another. A shimmer goes on each word (a
 * gradient clipped to text doesn't reach into animated children), offset so
 * the light still travels across the line.
 */
function Words({ text, start = 0, step = 0.09, shimmer = false, className = "" }: { text: string; start?: number; step?: number; shimmer?: boolean; className?: string }) {
  return (
    <span className={className}>
      {text.split(" ").map((w, i, arr) => (
        <Fragment key={i}>
          <span
            className={`mission-word ${shimmer ? "mission-shimmer" : ""}`}
            style={{ animationDelay: shimmer ? `${start + i * step}s, ${-i * 0.45}s` : `${start + i * step}s` }}
          >
            {w}
          </span>
          {i < arr.length - 1 ? " " : null}
        </Fragment>
      ))}
    </span>
  );
}

export default function Mission() {
  const lockup = lockupOf(useBrandLogo());
  const root = useReveal();
  // A fresh visit starts at the top, not wherever the landing page was.
  useEffect(() => window.scrollTo(0, 0), []);
  const serif = { fontFamily: "var(--font-brand)" };

  return (
    <div ref={root} className="mission">
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
      <section className="mx-auto flex min-h-[78dvh] max-w-[1180px] flex-col justify-center px-6 py-20 text-center sm:px-10">
        <p className="mission-eyebrow mission-word" style={{ animationDelay: "0.15s" }}>
          Our mission
        </p>
        <h1 className="mission-hero mt-6" style={serif}>
          <Words text="Wealth, put to work" start={0.35} shimmer />
          <br />
          <Words text="for people." start={0.75} shimmer className="mission-italic" />
        </h1>
        <p className="mission-lede mx-auto mt-10 max-w-[680px] mission-word" style={{ animationDelay: "1.35s" }}>
          Family offices were built to do one thing: keep wealth in the family and make it grow. Ours is built to ask a better question. What is wealth <em>for</em>?
        </p>
        <div className="mission-scroll mission-word" style={{ animationDelay: "2.1s" }} aria-hidden>
          <span />
        </div>
      </section>

      {/* ── The world as it is ─────────────────────────────────────── */}
      <section className="mx-auto max-w-[1180px] px-6 py-20 sm:px-10 sm:py-28">
        <p data-reveal className="mission-eyebrow reveal">The world as it is</p>
        <h2 data-reveal className="mission-h2 reveal mt-5 max-w-[860px]" style={{ ...serif, ["--d" as string]: "0.1s" }}>
          Most of the world's wealth belongs to very few of its people.
        </h2>
        <div className="mt-14 grid gap-5 sm:grid-cols-3">
          {STATS.map((s, i) => (
            <div key={s.value} data-reveal className="mission-stat reveal" style={{ ["--d" as string]: `${0.12 * i}s` }}>
              <p className="mission-figure" style={serif}>
                <CountUp to={s.value} />
                <span className="mission-pct">%</span>
              </p>
              <p className="mission-stat-label">{s.label}</p>
            </div>
          ))}
        </div>
        <p data-reveal className="mission-body reveal mt-14 max-w-[860px]" style={{ ["--d" as string]: "0.1s" }}>
          Much of it compounds out of sight, in private equity and private funds, where the returns go to a small circle of owners and the people who do the work rarely share in what they build. That is capitalism as it is mostly practiced.
        </p>
        <p data-reveal className="mission-turn reveal mt-6 max-w-[860px]" style={{ ...serif, ["--d" as string]: "0.25s" }}>
          <span className="mission-shimmer">It is not the only way to practice it.</span>
        </p>
        <p data-reveal className="mission-source reveal mt-8" style={{ ["--d" as string]: "0.35s" }}>
          Figures: World Inequality Report 2022, World Inequality Lab (2021 data).
        </p>
      </section>

      {/* ── What we believe ────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1180px] px-6 py-20 sm:px-10 sm:py-28">
        <p data-reveal className="mission-eyebrow reveal">What we believe</p>
        <h2 data-reveal className="mission-h2 reveal mt-5 max-w-[860px]" style={{ ...serif, ["--d" as string]: "0.1s" }}>
          Less of an endeavor in capital. More of one in people.
        </h2>
        <div className="mt-14 grid gap-px overflow-hidden rounded-3xl sm:grid-cols-2 mission-grid">
          {PRINCIPLES.map((p, i) => (
            <article key={p.n} data-reveal className="mission-principle reveal" style={{ ["--d" as string]: `${0.1 * (i % 2)}s` }}>
              <span className="mission-numeral" style={serif}>
                {p.n}
              </span>
              <h3 className="mission-h3" style={serif}>
                {p.title}
              </h3>
              <p className="mission-body mt-3">{p.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── The statement ──────────────────────────────────────────── */}
      <section className="mx-auto flex min-h-[80dvh] max-w-[1000px] flex-col justify-center px-6 py-24 text-center sm:px-10">
        <p data-reveal className="mission-eyebrow reveal">Our mission</p>
        <blockquote data-reveal className="mission-statement reveal mt-8" style={{ ...serif, ["--d" as string]: "0.15s" }}>
          <span className="mission-shimmer">
            The Burton Family Office puts capital to work for people. We invest in companies that help humanity, we share what we build with the people who build it, and we hold ourselves to excellence in everything we do.
          </span>
        </blockquote>
        <p data-reveal className="mission-coda reveal mt-10" style={{ ...serif, ["--d" as string]: "0.45s" }}>
          Because wealth means the most when it is shared.
        </p>
        <div data-reveal className="reveal mt-16" style={{ ["--d" as string]: "0.6s" }}>
          <Link to="/" viewTransition prefetch="render" className="mission-link">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            <span>Home</span>
          </Link>
        </div>
      </section>

      <footer className="pb-10 text-center">
        <p className="mission-foot">Burton Family Office</p>
      </footer>
    </div>
  );
}
