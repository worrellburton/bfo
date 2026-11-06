/**
 * The Document page for the Terms of use and the Privacy notice (docs/DESIGN.md
 * §8.18): a top bar with the wordmark and a way back, the title with its
 * effective date and version, "The short version", a list of linked sections,
 * reading text at 68 characters, numbered sections anyone can link to
 * (#section-id), and a footer with the sibling document, the office's contact
 * and who runs BFO. It follows the theme, signed in or not, and works as a
 * plain page with nothing else around it (it sits outside the app shell).
 */

import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { homePath, isAuthenticated } from "./auth";
import { lockupOf, useBrandLogo } from "./brand";
import { Wordmark } from "./brand-lockup";
import { Card, Icon, TextLink, format, useDocumentTitle } from "./ui";
import { OPERATOR_LINE, PRIVACY_EMAIL } from "../lib/terms";

export type LegalSection = { id: string; title: string; body: ReactNode };

export function LegalPage({
  title,
  version,
  effective,
  summary,
  sections,
  sibling,
}: {
  title: string;
  version: string;
  /** The effective date, a calendar date (YYYY-MM-DD). */
  effective: string;
  /** "The short version": a few plain sentences, as a list. */
  summary: ReactNode[];
  sections: LegalSection[];
  sibling: { to: string; label: string };
}) {
  useDocumentTitle(title);
  const navigate = useNavigate();
  const lockup = lockupOf(useBrandLogo());
  const signedIn = typeof window !== "undefined" && isAuthenticated();
  const home = signedIn ? homePath() : "/";
  const back = () => {
    if (typeof window !== "undefined" && window.history.length > 1) navigate(-1);
    else navigate(home);
  };

  return (
    <div className="ds min-h-dvh bg-page text-body text-ink">
      <header className="border-b border-line bg-page pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 w-full max-w-reading items-center justify-between px-(--gutter)">
          <button type="button" onClick={back} className="-ml-2 inline-flex h-11 cursor-pointer items-center gap-1 rounded-control px-2 text-small font-medium text-ink-2 hover:text-ink">
            <Icon name="chevronLeft" size={16} />
            Back
          </button>
          <Link to={home} className="rounded-control px-2 text-ink" aria-label={signedIn ? "BFO home" : "BFO"}>
            <Wordmark font={lockup.font} size={20} />
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-reading px-(--gutter) pt-8 pb-24 md:pt-12">
        <h1 className="text-heading text-balance">{title}</h1>
        <p className="mt-1 text-body text-ink-2">
          Effective {format.date(effective, "long")} · Version {version}
        </p>

        <Card title="The short version" className="mt-6">
          <ul className="flex list-disc flex-col gap-2 pl-5 text-reading marker:text-ink-3">
            {summary.map((s, i) => (
              <li key={i} className="max-w-[68ch]">
                {s}
              </li>
            ))}
          </ul>
        </Card>

        <nav aria-label="Sections" className="mt-8">
          <h2 className="text-small font-medium text-ink-2">Contents</h2>
          <ol className="mt-2 list-decimal gap-x-8 pl-5 text-body marker:text-ink-3 sm:columns-2">
            {sections.map((s) => (
              <li key={s.id} className="break-inside-avoid py-[2px]">
                <a href={`#${s.id}`} className="text-accent underline-offset-[3px] hover:text-accent-hover hover:underline touch:inline-flex touch:min-h-[44px] touch:items-center">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-10 flex flex-col gap-10">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-6">
              <h2 id={`${s.id}-title`} className="text-title text-balance">
                {i + 1}. {s.title}
              </h2>
              <div className="mt-3 flex max-w-[68ch] flex-col gap-4 text-reading text-ink [&_li]:pl-1 [&_ol]:flex [&_ol]:list-decimal [&_ol]:flex-col [&_ol]:gap-2 [&_ol]:pl-5 [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-5 [&_ul]:marker:text-ink-3">
                {s.body}
              </div>
            </section>
          ))}
        </div>

        <footer className="mt-16 flex flex-col gap-2 border-t border-line pt-6 text-small text-ink-2">
          <p className="flex flex-wrap gap-x-4">
            <TextLink to={sibling.to}>{sibling.label}</TextLink>
            <TextLink to={home}>{signedIn ? "Back to BFO" : "BFO home"}</TextLink>
          </p>
          <p>
            {OPERATOR_LINE}. Questions, requests and notices:{" "}
            <TextLink inline to={`mailto:${PRIVACY_EMAIL}`}>
              {PRIVACY_EMAIL}
            </TextLink>
            .
          </p>
        </footer>
      </main>
    </div>
  );
}

/** A mailto link to the office's privacy address, inline. */
export function PrivacyEmail() {
  return (
    <TextLink inline to={`mailto:${PRIVACY_EMAIL}`}>
      {PRIVACY_EMAIL}
    </TextLink>
  );
}
