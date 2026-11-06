/**
 * Tabs (docs/DESIGN.md §8.11): sections of one page or record, where the URL
 * changes (Overview, Documents, Owners). Under the page header; 40px tall
 * (44 on touch); body 500 ink-2; the current tab ink with a 2px ink
 * underline on the bar's hairline; 24px between tabs; an optional Count
 * (the number of things in it that need the person). On phones, five or
 * more tabs collapse into a section button that opens a sheet listing every
 * section. Route tabs are links with aria-current. Not for filtering a list
 * (that is Segmented), and never tabs inside tabs.
 */

import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { cx } from "./cx";
import { Icon } from "./icon";
import { usePhone } from "./media";
import { Sheet } from "./overlay";
import { Count } from "./status";

export type TabItem = {
  to: string;
  label: string;
  /** Things in it that need the person. */
  count?: number;
  /** Match only this exact path (an index tab such as Overview). */
  end?: boolean;
};

export function Tabs({ label, items }: { /** The tab bar's name ("Sections"). */ label: string; items: TabItem[] }) {
  const phone = usePhone();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const isCurrent = (t: TabItem) => (t.end ? location.pathname === t.to : location.pathname === t.to || location.pathname.startsWith(`${t.to}/`));
  const current = items.find(isCurrent) ?? items[0];

  if (phone && items.length >= 5) {
    return (
      <div className="ds border-b border-line">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="flex min-h-[44px] w-full cursor-pointer items-center justify-between gap-2 text-left text-body font-medium text-ink"
        >
          <span className="flex items-center gap-2">
            <span className="sr-only">Section: </span>
            {current?.label}
            {current?.count ? <Count n={current.count} tone="attention" /> : null}
          </span>
          <Icon name="chevronDown" className="text-ink-3" />
        </button>
        <Sheet open={open} onClose={() => setOpen(false)} title="Sections">
          <nav aria-label={label}>
            <ul>
              {items.map((t) => (
                <li key={t.to}>
                  <button
                    type="button"
                    aria-current={t === current ? "page" : undefined}
                    onClick={() => {
                      setOpen(false);
                      navigate(t.to);
                    }}
                    className={cx(
                      "flex min-h-[48px] w-full cursor-pointer items-center gap-2 rounded-control px-2 text-left text-body hover:bg-hover",
                      t === current ? "font-medium text-ink" : "text-ink",
                    )}
                  >
                    <span className="flex-1">{t.label}</span>
                    {t.count ? <Count n={t.count} tone="attention" /> : null}
                    {t === current && <Icon name="check" className="text-accent" />}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </Sheet>
      </div>
    );
  }

  return (
    <nav aria-label={label} className="ds border-b border-line">
      <ul className="-mb-px flex gap-6 overflow-x-auto">
        {items.map((t) => (
          <li key={t.to} className="shrink-0">
            <NavLink
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cx("flex h-10 items-center gap-2 border-b-2 text-body font-medium whitespace-nowrap touch:h-11", isActive ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink")
              }
            >
              {t.label}
              {t.count ? <Count n={t.count} tone="attention" /> : null}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
