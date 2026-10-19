import { Fragment, useEffect, useRef, type CSSProperties } from "react";
import { Link } from "react-router";
import { lockupOf, useBrandLogo } from "../brand";
import { BrandLockup } from "../brand-lockup";

export function meta() {
  return [
    { title: "BFO - Mission" },
    // Unlisted: reachable by its link, kept out of search results.
    { name: "robots", content: "noindex, nofollow" },
    {
      name: "description",
      content: "Companies with purpose. Profits shared with the people behind them.",
    },
  ];
}

/**
 * The mission, in two lines, on the public layout's backdrop. The words
 * fade up into place (.reveal → .is-in) and the second line catches the
 * gold light. Reduced motion shows it still.
 */

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

      {/* ── The mission, in two lines ───────────────────────────── */}
      <main className="mx-auto flex min-h-[calc(100dvh-140px)] max-w-[1180px] items-center px-6 pb-[10vh] sm:px-10">
        <h1 className="mission-hero narrative-title reveal" style={serif}>
          <Words text="Companies with purpose." step={0.08} delay={0.3} />
          <br />
          <span className="mission-italic">
            <Words text="Profits shared with the people behind them." shimmer step={0.07} delay={0.6} />
          </span>
        </h1>
      </main>
    </div>
  );
}
