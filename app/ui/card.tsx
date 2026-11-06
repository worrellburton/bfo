/**
 * Card and Row (docs/DESIGN.md §8.8, §14.3).
 *
 * Card: the container for a group of related content. `raised` fill, a 1px
 * `line` border, radius 12, no shadow. Header: the title in `section`, an
 * optional Count, an optional (i) that reveals the card's explanation under
 * the header, then on the right at most one action and an optional "…".
 * Body padded 20px (16 on touch), or `flush` for a list or table whose rows
 * carry the same side padding. Never a card inside a card: a subsection is
 * a CardSection (a subhead over a hairline).
 *
 * Row: label and value, a 144px label column of small ink-2 on desktop,
 * stacked on phones, at least 44px on touch.
 */

import { useId, useState, type ReactNode } from "react";
import { IconButton } from "./button";
import { cx } from "./cx";
import { Menu, type MenuItem } from "./overlay";
import { Badge, Count } from "./status";
import { InfoToggle } from "./states";

export type { MenuItem } from "./overlay";

export function Card({
  title,
  count,
  countTone,
  info,
  action,
  menu,
  flush = false,
  footer,
  staffOnly = false,
  id,
  className,
  children,
}: {
  title?: ReactNode;
  /** A Count after the title (what needs the person, or what's in it). */
  count?: number;
  countTone?: "neutral" | "attention";
  /** The card's explanation, behind an (i) in the header. Never a required disclosure. */
  info?: ReactNode;
  /** At most one action on the right: a quiet Button or a standalone TextLink. */
  action?: ReactNode;
  /** The card's "…" menu. */
  menu?: MenuItem[];
  /** No body padding, for a List or Table; a hairline then separates header and body. */
  flush?: boolean;
  /** A hairline, then a right-aligned action or "View all". */
  footer?: ReactNode;
  /** A "Staff only" Badge with a lock: partners never receive this card's content (§11.5). */
  staffOnly?: boolean;
  id?: string;
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const infoId = useId();
  const hasHeader = title !== undefined || !!action || !!menu || staffOnly;
  return (
    <section
      id={id}
      aria-labelledby={title !== undefined ? titleId : undefined}
      className={cx("ds ds-card min-w-0 overflow-clip rounded-card border border-line bg-raised text-body text-ink", className)}
    >
      {hasHeader && (
        <header className="px-5 py-3 touch:px-4">
          <div className="flex min-h-[28px] items-center gap-3 touch:min-h-[32px]">
            <h2 id={titleId} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-section text-balance text-ink">
              <span className="min-w-0">{title}</span>
              {count !== undefined && <Count n={count} tone={countTone} />}
              {staffOnly && <Badge icon="lock">Staff only</Badge>}
              {info && <InfoToggle label={typeof title === "string" ? `About ${title}` : "About this"} open={open} onToggle={setOpen} />}
            </h2>
            {(action || menu) && (
              <div className="-my-1 flex shrink-0 items-center gap-1">
                {action}
                {menu && <Menu label={typeof title === "string" ? `${title} actions` : "More actions"} align="end" items={menu} trigger={<IconButton icon="more" label="More actions" />} />}
              </div>
            )}
          </div>
          {info && open && (
            <p id={infoId} className="ds-reveal mt-1 max-w-[68ch] text-small text-pretty text-ink-2">
              {info}
            </p>
          )}
        </header>
      )}
      {children !== undefined && children !== null && (
        <div className={cx(flush ? hasHeader && "border-t border-line" : cx("px-5 pb-5 touch:px-4 touch:pb-4", !hasHeader && "pt-5 touch:pt-4"))}>{children}</div>
      )}
      {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3 touch:px-4">{footer}</div>}
    </section>
  );
}

/** A subsection inside a card: a subhead (small 600 ink) over a hairline. Never a card in a card. */
export function CardSection({ title, children, action }: { title: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="ds mt-5 border-t border-line pt-4 first:mt-0 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-small font-semibold text-ink">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

/**
 * Label and value. Rows inside a card body sit flush against each other with
 * hairlines between; wrap them in <Rows>.
 */
export function Row({
  label,
  children,
  hint,
  action,
  id,
  className,
}: {
  label: ReactNode;
  /** The value. Nothing on record reads "Not on record" in ink-3. */
  children?: ReactNode;
  /** A line under the value in small ink-2. */
  hint?: ReactNode;
  /** One small action at the right (a quiet Button or an IconButton). */
  action?: ReactNode;
  id?: string;
  className?: string;
}) {
  const empty = children === undefined || children === null || children === "";
  return (
    <div id={id} className={cx("ds flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-4 touch:min-h-[44px]", className)}>
      <div className="shrink-0 text-small text-ink-2 sm:w-[144px]">{label}</div>
      <div className="min-w-0 flex-1 text-body break-words text-ink">
        {empty ? <span className="text-ink-3">Not on record</span> : children}
        {hint && <div className="text-small text-ink-2">{hint}</div>}
      </div>
      {action && <div className="-my-1 flex shrink-0 items-center gap-1 self-start sm:self-center">{action}</div>}
    </div>
  );
}

/** Rows with hairlines between them. */
export function Rows({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("ds divide-y divide-line", className)}>{children}</div>;
}
