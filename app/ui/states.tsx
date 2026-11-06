/**
 * The designed states (docs/DESIGN.md §8.13–8.15, §8.17): Empty, Skeleton,
 * Spinner, Banner, Disclosure and InfoToggle.
 *
 * - Empty says what will be here, who can see it, and offers one action.
 *   No illustrations, and never a count before the data arrives.
 * - Skeletons mirror the final layout and appear only after 300ms; they
 *   leave the moment data arrives. Never a bare "Loading…".
 * - A Banner is a message about a region, at its top. Errors are banners,
 *   never toasts; raw messages sit behind "Technical details".
 * - Disclosure hides long lists ("Done · 10") and technical details.
 * - InfoToggle (i) reveals an explanation in place; never a required
 *   disclosure, never a tooltip.
 */

import { useId, useState, type ReactNode } from "react";
import { IconButton } from "./button";
import { cx } from "./cx";
import { Icon, type IconName } from "./icon";
import { useDelayed } from "./media";

export { Spinner } from "./icon";

export function Empty({
  title,
  children,
  action,
  size = "section",
  className,
}: {
  /** "No notes yet" (page size). */
  title?: string;
  /** One or two sentences: what will be here and who can see it. */
  children: ReactNode;
  /** One primary Button (page), or a standalone link or quiet "Clear filters" (section). Omit for people who can't add. */
  action?: ReactNode;
  /** page: a page or a card body with nothing yet (64px under the header; 24 inside a card). section: one line inside a card. */
  size?: "page" | "section";
  className?: string;
}) {
  if (size === "section") {
    return (
      <div className={cx("ds flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-body text-ink-2", className)}>
        <div className="min-w-0 text-pretty">{children}</div>
        {action}
      </div>
    );
  }
  return (
    <div className={cx("ds flex max-w-[400px] flex-col items-start gap-2 pt-16 in-[.ds-card]:pt-1", className)}>
      {title && <h2 className="text-section text-balance text-ink">{title}</h2>}
      <div className="text-body text-pretty text-ink-2">{children}</div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const WIDTHS = ["w-[72%]", "w-[54%]", "w-[83%]", "w-[61%]", "w-[46%]", "w-[68%]", "w-[77%]", "w-[58%]"];
const SHORT = ["w-[38%]", "w-[29%]", "w-[44%]", "w-[33%]", "w-[24%]", "w-[41%]", "w-[35%]", "w-[27%]"];

function Bar({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx("ds-skeleton block h-[10px] rounded-mark bg-sunken", className)} />;
}

/**
 * Placeholder shapes while data loads, shown only after 300ms.
 * line: one text line. rows: list rows. card: a card with a title and rows.
 * table: rows at the real column widths (`columns`, CSS widths).
 */
export function Skeleton({ kind, rows = 8, columns, className }: { kind: "line" | "rows" | "card" | "table"; rows?: number; columns?: string[]; className?: string }) {
  const shown = useDelayed(true, 300);
  if (!shown) return <span className="sr-only" role="status" />;
  const body =
    kind === "line" ? (
      <Bar className="w-[60%]" />
    ) : kind === "table" ? (
      <div className="flex flex-col">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex h-(--row-1) items-center gap-3 border-b border-line px-5">
            {(columns ?? ["40%", "20%", "20%", "20%"]).map((w, c) => (
              <span key={c} style={{ width: w }} className="flex">
                <Bar className={WIDTHS[(r + c) % WIDTHS.length]} />
              </span>
            ))}
          </div>
        ))}
      </div>
    ) : (
      <div className={cx(kind === "card" && "rounded-card border border-line bg-raised")}>
        {kind === "card" && (
          <div className="flex min-h-[52px] items-center px-5 touch:min-h-[56px] touch:px-4">
            <Bar className="h-[12px] w-[32%]" />
          </div>
        )}
        {Array.from({ length: kind === "card" ? Math.min(rows, 4) : rows }, (_, r) => (
          <div key={r} className="flex h-(--row-2) flex-col justify-center gap-2 border-t border-line px-5 first:border-t-0 touch:px-4">
            <Bar className={WIDTHS[r % WIDTHS.length]} />
            <Bar className={cx("h-[8px]", SHORT[(r + 3) % SHORT.length])} />
          </div>
        ))}
      </div>
    );
  return (
    <div role="status" aria-label="Loading" className={cx("ds", className)}>
      {body}
    </div>
  );
}

const BANNER: Record<"info" | "warning" | "negative" | "positive", { fill: string; ink: string; icon: IconName }> = {
  info: { fill: "bg-info-tint", ink: "text-info", icon: "info" },
  warning: { fill: "bg-warning-tint", ink: "text-warning", icon: "warning" },
  negative: { fill: "bg-negative-tint", ink: "text-negative", icon: "error" },
  positive: { fill: "bg-positive-tint", ink: "text-positive", icon: "check" },
};

export function Banner({
  tone,
  children,
  action,
  onDismiss,
  title,
  className,
}: {
  tone: "info" | "warning" | "negative" | "positive";
  /** What happened and what to do, in ink. */
  children: ReactNode;
  /** An optional 500-weight first sentence. */
  title?: ReactNode;
  /** A quiet Button ("Try again"). */
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const t = BANNER[tone];
  return (
    <div role={tone === "negative" ? "alert" : "status"} className={cx("ds flex items-start gap-3 rounded-card px-4 py-3 text-body text-ink", t.fill, className)}>
      <span className={cx("mt-[2px]", t.ink)}>
        <Icon name={t.icon} size={16} />
      </span>
      <div className="min-w-0 flex-1 text-pretty">
        {title && <span className="font-medium">{title} </span>}
        {children}
      </div>
      {(action || onDismiss) && (
        <div className="-my-1 flex shrink-0 items-center gap-1">
          {action}
          {onDismiss && <IconButton icon="x" label="Dismiss" noTooltip onClick={onDismiss} />}
        </div>
      )}
    </div>
  );
}

export function Disclosure({
  label,
  count,
  defaultOpen = false,
  children,
  className,
}: {
  /** "Done", "Technical details". */
  label: ReactNode;
  /** Shown after the label: "Done · 10". */
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={cx("ds", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[32px] cursor-pointer items-center gap-2 rounded-control text-left text-small font-medium text-ink-2 hover:text-ink touch:min-h-[44px]"
      >
        <span className={cx("inline-flex transition-transform duration-(--dur-3) ease-(--ease-standard)", open && "rotate-90")}>
          <Icon name="chevronRight" size={16} />
        </span>
        <span>
          {label}
          {count !== undefined && <span className="tabular-nums"> · {count}</span>}
        </span>
      </button>
      {open && (
        <div id={id} className="ds-reveal">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * The (i): a quiet button that reveals its text in place, below where it
 * sits (the text spans the row). At most one per card header, and one per
 * row only where a label is genuinely unclear.
 */
export function InfoToggle({
  label,
  children,
  open: controlled,
  onToggle,
}: {
  /** "About the record score". */ label: string;
  children?: ReactNode;
  open?: boolean;
  onToggle?: (open: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const id = useId();
  return (
    <>
      <IconButton
        icon="info"
        label={label}
        noTooltip
        aria-expanded={open}
        aria-controls={children ? id : undefined}
        className="size-[24px]! touch:size-[44px]! -my-1 touch:-my-3"
        onClick={() => {
          setOwn(!open);
          onToggle?.(!open);
        }}
      />
      {children && open && (
        <span id={id} className="ds-reveal block w-full max-w-[68ch] basis-full text-small font-normal text-ink-2">
          {children}
        </span>
      )}
    </>
  );
}
