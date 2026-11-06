/**
 * Page, PageHeader and ErrorPage (docs/DESIGN.md §5, §8.18).
 *
 * <Page> switches a page onto the system: it adds the `ds` scope (so legacy
 * utilities inside it mean what they say, §4.2), body text in ink, and one
 * of three containers centred in the content area: reading (720), workspace
 * (1200) or full. The shell's <main> supplies the gutter and the top and
 * bottom padding. A file that imports Page is strict for check:design.
 *
 * <PageHeader> is the one header on every signed-in page: an optional back
 * link, the title (heading), an optional one-line context (scope and
 * freshness), and the actions: on desktop "…", secondary, then one primary;
 * on phones at most a "+" (when the primary creates) and "…".
 */

import type { ReactNode } from "react";
import { Link } from "react-router";
import { homePath } from "../auth";
import { Button, IconButton } from "./button";
import { cx } from "./cx";
import { Icon } from "./icon";
import { usePhone } from "./media";
import { Menu, type MenuItem } from "./overlay";
import { openPalette } from "./page-title";
import { Disclosure } from "./states";

const WIDTH = { reading: "max-w-reading", workspace: "max-w-workspace", full: "" } as const;

export function Page({
  width = "workspace",
  header,
  children,
  className,
}: {
  /** reading: forms, settings, statements, legal. workspace (default): most pages. full: wide tables and maps. */
  width?: "reading" | "workspace" | "full";
  /** A <PageHeader>. */
  header?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("ds mx-auto w-full min-w-0 text-body text-ink", WIDTH[width], className)}>
      {header}
      <div className={cx("flex flex-col gap-8", header ? "mt-6" : "")}>{children}</div>
    </div>
  );
}

export function PageHeader({
  title,
  context,
  back,
  primary,
  secondary,
  menu,
  create,
}: {
  /** The page's name, as in the nav and the tab title. */
  title: string;
  /** One line in ink-2: what the page shows, its scope and freshness ("9 entities · as of Nov 6, 2026"). */
  context?: ReactNode;
  /** Sub-pages: the parent's route and name. */
  back?: { to: string; label: string };
  /** The one primary action (a Button variant="primary"). On phones, when it doesn't create, it goes full width under the context line. */
  primary?: ReactNode;
  /** Secondary Buttons, left of the primary on desktop. On phones they sit under the context line; prefer `menu` items there. */
  secondary?: ReactNode;
  /** The "…" overflow: every other action. */
  menu?: MenuItem[];
  /** A primary action that creates something: a "+" on phones, a primary Button with its label on desktop (unless `primary` is given). */
  create?: { label: string; onClick: () => void };
}) {
  const phone = usePhone();
  const more = menu && menu.length > 0 && <Menu label="More actions" align="end" items={menu} trigger={<IconButton icon="more" label="More actions" variant={phone ? "quiet" : "secondary"} />} />;
  return (
    <header className="ds flex flex-col">
      {back && (
        <Link to={back.to} className="mb-2 inline-flex h-8 items-center gap-1 self-start text-small font-medium text-ink-2 hover:text-ink touch:h-11">
          <Icon name="chevronLeft" size={16} />
          {back.label}
        </Link>
      )}
      <div className="flex items-start gap-3">
        <h1 className="min-w-0 flex-1 text-heading text-balance text-ink">{title}</h1>
        {phone ? (
          (create || more) && (
            <div className="-mt-2 -mr-2 flex shrink-0 items-center">
              {create && <IconButton icon="plus" label={create.label} noTooltip onClick={create.onClick} />}
              {more}
            </div>
          )
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            {more}
            {secondary}
            {primary ??
              (create && (
                <Button variant="primary" icon="plus" onClick={create.onClick}>
                  {create.label}
                </Button>
              ))}
          </div>
        )}
      </div>
      {context && <div className="mt-1 text-body text-ink-2">{context}</div>}
      {phone && (secondary || (primary && !create)) && (
        <div className="mt-4 flex flex-col gap-2">
          {primary && !create && <div className="flex [&>*]:w-full">{primary}</div>}
          {secondary && <div className="flex flex-wrap gap-2">{secondary}</div>}
        </div>
      )}
    </header>
  );
}

/**
 * Not found and Error, one component for the in-app route and the root error
 * boundary (§8.18), following the theme. A title, one plain sentence, "Go to
 * Home" (or "Reload" for an error, with "Go to Home" beside it), a "Search
 * BFO" link, and "Technical details" for errors.
 */
export function ErrorPage({
  kind,
  detail,
  home,
}: {
  kind: "not-found" | "error";
  /** The error's message (and stack in development), behind "Technical details". */ detail?: string;
  /** Where "Go to Home" goes; the person's home by default. */ home?: string;
}) {
  const to = home ?? homePath();
  const missing = kind === "not-found";
  return (
    <div className="ds mx-auto flex w-full max-w-reading flex-col items-start gap-2 pt-16 text-body text-ink">
      <h1 className="text-heading text-balance text-ink">{missing ? "We couldn’t find that page" : "Something went wrong"}</h1>
      <p className="max-w-[60ch] text-body text-pretty text-ink-2">
        {missing
          ? "The address may be mistyped, or the page has moved."
          : "The page stopped before it finished loading. Reloading usually fixes it; if it keeps happening, tell the office what you were doing."}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {missing ? (
          <Button variant="primary" onClick={() => window.location.assign(to)}>
            Go to Home
          </Button>
        ) : (
          <>
            <Button onClick={() => window.location.assign(to)}>Go to Home</Button>
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </>
        )}
      </div>
      <button type="button" onClick={openPalette} className="mt-2 inline-flex cursor-pointer items-center gap-1 text-body text-accent hover:text-accent-hover hover:underline touch:min-h-[44px]">
        Search BFO
        <Icon name="chevronRight" size={16} />
      </button>
      {!missing && detail && (
        <Disclosure label="Technical details" className="mt-4 w-full">
          <pre className="mt-2 max-h-64 overflow-auto rounded-card bg-sunken p-4 font-mono text-caption whitespace-pre-wrap text-ink-2">
            <code>{detail}</code>
          </pre>
        </Disclosure>
      )}
    </div>
  );
}
