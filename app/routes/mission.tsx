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
 * The mission, told as the family office's story in one continuous
 * narrative on the public layout's backdrop. Each paragraph's words fade up
 * into place as it scrolls into view (.reveal → .is-in), and the last line
 * catches the gold light. Reduced motion shows it all, still.
 */

/** The story, start to finish: one narrative, read straight through. */
const STORY = [
  "The Burton Family Office didn't begin with a business plan. It began with people who were generous long before they were in business. When someone needed help, they said yes and worked out the details later. They weren't financiers. They simply believed that what you have is meant to do some good.",
  "Generosity like that is a good place to start, but good intentions need good management to last. Over the years we learned to keep careful books, to make decisions slowly and well, and to build companies that stand on their own rather than lean on a gift. The heart was always there. The discipline came with time.",
  "What hasn't changed is the question. Every decision still starts where theirs did: who does this help? We answer it now with more experience and over a longer horizon, but we ask it the same way, and we still mean it.",
  "So today we own and operate companies whose work is helping people, whether that's getting well, finding a place to call home, or caring for the land and the people on it. We run them carefully, we stay for the long haul, and the people who work in them share in what we build together.",
];

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
 * word, offset so the light still travels the line): app.css .gold-sheen,
 * a gold copy of the word seen through a moving mask.
 */
function Words({ text, shimmer = false, step = 0.045, delay = 0 }: { text: string; shimmer?: boolean; step?: number; delay?: number }) {
  const words = text.split(" ");
  return (
    <>
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className="word" style={{ "--w": `${delay + i * step}s`, "--s": `${-i * 0.45}s` } as CSSProperties}>
            {shimmer ? (
              <span className="gold-sheen" data-text={w}>
                {w}
              </span>
            ) : (
              w
            )}
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
  const serif = { fontFamily: "var(--font-brand)" };

  // A fresh visit starts at the top, not wherever the landing page was.
  useEffect(() => window.scrollTo(0, 0), []);

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

      {/* ── The story ──────────────────────────────────────────────── */}
      <article className="narrative mx-auto max-w-[780px] px-6 pb-24 pt-[14vh] sm:px-10">
        <h1 className="mission-hero narrative-title reveal" style={serif}>
          <Words text="It started with people" step={0.08} delay={0.3} />{" "}
          <span className="mission-italic">
            <Words text="who wanted to help." shimmer step={0.08} delay={0.65} />
          </span>
        </h1>
        {STORY.map((para, i) => (
          <p key={i} className="narrative-p reveal" style={serif}>
            <Words text={para} step={0.012} delay={i === 0 ? 1.1 : 0.05} />
          </p>
        ))}
        <p className="narrative-p narrative-end reveal" style={serif}>
          <Words text="Same heart. More business sense." shimmer step={0.09} delay={0.1} />
        </p>
      </article>

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
