/**
 * List and ListRow (docs/DESIGN.md §8.9): the standard row for lists on
 * every screen size, and for tables on phones.
 *
 * One line is --row-1 (40/48), two lines --row-2 (56/64). Leading: an icon
 * in ink-2 or an Avatar. Title in body ink (600 when unread, with an 8px
 * accent dot in a 16px gutter). Secondary in small ink-2, one line. Meta (a
 * time) top right in caption ink-3. Trailing: the one figure that matters,
 * a chevron when the row opens something, or both. Hairlines start at the
 * title's left edge. The whole row opens; at most one inline action; the
 * rest in the row's "…". No hover-only controls on touch.
 */

import type { ReactNode } from "react";
import { Link } from "react-router";
import { IconButton } from "./button";
import { cx } from "./cx";
import { Icon } from "./icon";
import { Menu, type MenuItem } from "./overlay";

export function List({ children, label, className }: { children: ReactNode; /** The list's name for screen readers. */ label?: string; className?: string }) {
  return (
    <ul aria-label={label} className={cx("ds ds-list", className)}>
      {children}
    </ul>
  );
}

export type ListRowProps = {
  title: ReactNode;
  secondary?: ReactNode;
  /** A 16/20px icon in ink-2, or an Avatar (24 for one line, 32 for two). */
  leading?: ReactNode;
  /** Top right, caption ink-3, tabular: a time. */
  meta?: ReactNode;
  /** The value (body 500 ink, tabular, right-aligned). A chevron is added when the row opens something. */
  trailing?: ReactNode;
  /** Opens this route. */
  to?: string;
  /** Opens something in place (a sheet). */
  onClick?: () => void;
  /** Selected: `selected` fill, and with onSelect a checked checkbox. */
  selected?: boolean;
  /** Shows a checkbox before the row (selection mode). */
  onSelect?: (v: boolean) => void;
  /** Unread: the accent dot and a 600 title. */
  unread?: boolean;
  /** The row's "…" menu. */
  menu?: MenuItem[];
  /** At most one inline action, only when the row's state calls for it. */
  action?: ReactNode;
  /** The title's full text, when the title is a node (for the hover title and the menu's name). */
  label?: string;
  className?: string;
};

export function ListRow({ title, secondary, leading, meta, trailing, to, onClick, selected, onSelect, unread, menu, action, label, className }: ListRowProps) {
  const opens = !!(to || onClick);
  const two = secondary !== undefined && secondary !== null;
  const content = (
    <>
      {unread !== undefined && (
        <span className="flex w-4 shrink-0 justify-center self-center" aria-hidden={!unread}>
          {unread && <span className="size-2 rounded-full bg-accent" />}
          {unread && <span className="sr-only">Unread</span>}
        </span>
      )}
      {leading && <span className="flex shrink-0 items-center self-center text-ink-2">{leading}</span>}
      <span className="ds-row-body flex min-w-0 flex-1 items-center gap-3 self-stretch py-2 pr-4">
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cx("min-w-0 flex-1 text-body text-ink line-clamp-2 break-words", unread ? "font-semibold" : "font-normal")} title={label}>
              {title}
            </span>
            {meta && <span className="shrink-0 text-caption text-ink-3 tabular-nums">{meta}</span>}
          </span>
          {two && <span className="block truncate text-small text-ink-2">{secondary}</span>}
        </span>
        {trailing !== undefined && trailing !== null && <span className="shrink-0 text-right text-body font-medium text-ink tabular-nums">{trailing}</span>}
        {opens && !menu && (
          <span className="shrink-0 text-ink-3">
            <Icon name="chevronRight" size={16} />
          </span>
        )}
      </span>
    </>
  );
  const rowCls = cx(
    "flex w-full min-w-0 items-center gap-3 pl-4 text-left outline-offset-[-2px]!",
    two ? "min-h-(--row-2)" : "min-h-(--row-1)",
    !selected && opens && "hover:bg-hover active:bg-selected",
  );
  return (
    <li className={cx("ds group/row relative flex items-stretch", selected && "bg-selected", className)}>
      {onSelect && (
        <label className="flex shrink-0 cursor-pointer items-center pl-4 touch:min-w-[44px]">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={!!selected}
            onChange={(e) => onSelect(e.target.checked)}
            aria-label={label ?? (typeof title === "string" ? `Select ${title}` : "Select")}
          />
          <span
            aria-hidden="true"
            className={cx(
              "inline-flex size-[16px] items-center justify-center rounded-mark border-[1.5px] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-focus-visible:outline-solid touch:size-[20px]",
              selected ? "border-accent bg-accent text-on-accent" : "border-edge bg-field",
            )}
          >
            {selected && (
              <svg viewBox="0 0 16 16" className="size-[12px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3.5 8.5l3 3 6-7" />
              </svg>
            )}
          </span>
        </label>
      )}
      {to ? (
        <Link to={to} className={cx(rowCls, "cursor-pointer")}>
          {content}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={cx(rowCls, "cursor-pointer")}>
          {content}
        </button>
      ) : (
        <div className={rowCls}>{content}</div>
      )}
      {(action || menu) && (
        <span className="ds-row-tail flex shrink-0 items-center gap-1 pr-2">
          {action}
          {menu && (
            <Menu
              label={label ?? (typeof title === "string" ? title : "Row actions")}
              align="end"
              items={menu}
              trigger={<IconButton icon="more" label={`More actions${label ? ` for ${label}` : typeof title === "string" ? ` for ${title}` : ""}`} />}
            />
          )}
        </span>
      )}
    </li>
  );
}
