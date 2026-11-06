import { useEffect, useState, type Ref } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Count, Menu, Tooltip, cx, type MenuItem } from "./ui";
import { Glyph } from "./shell-icons";
import { activeGroup, leafActive, type NavEntry } from "./shell-model";

/**
 * The nav's rows (docs/DESIGN.md §9.1–9.3), drawn from the model in
 * app/shell-model.ts.
 *
 * - NavList: the expanded sidebar and the drawer. Rows 32px (44 on touch),
 *   an icon and the label in ink-2; the current page is the `selected` fill
 *   with its label in ink at 500, and nothing else marks it. A group (Mail,
 *   Books, Tools) opens in place; its pages are label-only rows indented to
 *   the parent's label, with no tree lines. The group holding the current
 *   page opens by itself; on desktop the other open groups are remembered,
 *   in the drawer they aren't.
 * - RailNav: the collapsed 64px rail. 44px icon buttons, each with a tooltip
 *   naming it and its count; a count is an 8px accent dot. A group's icon
 *   opens a menu of its pages.
 */

const OPEN_KEY = "bfo.nav.open";

function readOpen(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const countLabel = (label: string, n: number | undefined) => (n ? `${label}, ${n} new` : label);

const ROW = "flex min-h-(--row-menu) w-full items-center gap-2 rounded-control px-3 text-left text-body transition-colors duration-(--dur-1)";
const IDLE = "text-ink-2 hover:bg-hover hover:text-ink";
const CURRENT = "bg-selected font-medium text-ink";

export function NavList({
  nav,
  onNavigate,
  remember = true,
}: {
  nav: NavEntry[];
  onNavigate?: () => void;
  /** Restore and save which groups are open (desktop); the drawer opens only the current one. */ remember?: boolean;
}) {
  const { pathname, search } = useLocation();
  const here = activeGroup(nav, pathname, search);
  const [open, setOpen] = useState<Set<string>>(() => new Set([...(remember && typeof window !== "undefined" ? readOpen() : []), ...(here ? [here] : [])]));

  // Landing on a group's page opens that group.
  useEffect(() => {
    if (here) setOpen((s) => (s.has(here) ? s : new Set(s).add(here)));
  }, [here]);
  useEffect(() => {
    if (!remember) return;
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...open]));
    } catch {
      // Remembering is a nicety.
    }
  }, [open, remember]);

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <ul className="flex flex-col gap-[2px]">
      {nav.map((e) => {
        const gap = e.gapBefore ? "mt-4" : "";
        if (!e.children) {
          const on = leafActive(e, pathname, search);
          return (
            <li key={e.id} className={gap}>
              <Link to={e.to} onClick={onNavigate} aria-current={on ? "page" : undefined} className={cx(ROW, on ? CURRENT : IDLE)}>
                <Glyph name={e.glyph} />
                <span className="min-w-0 flex-1 truncate">{e.label}</span>
                <Count n={e.count ?? 0} label={e.count ? `${e.count} new` : undefined} />
              </Link>
            </li>
          );
        }
        const isOpen = open.has(e.id);
        const holds = here === e.id;
        const panel = `nav-group-${e.id}`;
        return (
          <li key={e.id} className={gap}>
            <button type="button" onClick={() => toggle(e.id)} aria-expanded={isOpen} aria-controls={panel} className={cx(ROW, "cursor-pointer", holds && !isOpen ? CURRENT : IDLE)}>
              <Glyph name={e.glyph} />
              <span className="min-w-0 flex-1 truncate">{e.label}</span>
              {!isOpen && <Count n={e.count ?? 0} label={e.count ? `${e.count} new` : undefined} />}
              <svg
                className={cx("size-[16px] shrink-0 text-ink-3 transition-transform duration-(--dur-3)", isOpen && "rotate-180")}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <ul id={panel} hidden={!isOpen} className="mt-[2px] flex flex-col gap-[2px]">
              {e.children.map((c) => {
                const on = leafActive(c, pathname, search);
                return (
                  <li key={c.to}>
                    <Link
                      to={c.to}
                      onClick={onNavigate}
                      aria-current={on ? "page" : undefined}
                      aria-label={c.count ? countLabel(c.label, c.count) : undefined}
                      className={cx(ROW, "pl-[36px] touch:pl-[40px]", on ? CURRENT : IDLE)}
                    >
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      <Count n={c.count ?? 0} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

/** A 44px square on the rail: an icon, a tooltip naming it, and a dot when it has a count. Takes a Menu's ref and handlers. */
function RailButton({ entry, current, ref, ...rest }: { entry: NavEntry; current: boolean; ref?: Ref<HTMLButtonElement> } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Tooltip label={countLabel(entry.label, entry.count)}>
      <button
        ref={ref}
        type="button"
        aria-label={countLabel(entry.label, entry.count)}
        className={cx("relative flex size-[44px] cursor-pointer items-center justify-center rounded-control transition-colors duration-(--dur-1)", current ? "bg-selected text-ink" : IDLE)}
        {...rest}
      >
        <Glyph name={entry.glyph} size={20} />
        {!!entry.count && <span aria-hidden="true" className="absolute top-[9px] right-[9px] size-2 rounded-full bg-accent" />}
      </button>
    </Tooltip>
  );
}

export function RailNav({ nav }: { nav: NavEntry[] }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const here = activeGroup(nav, pathname, search);
  return (
    <ul className="flex flex-col items-center gap-1">
      {nav.map((e) => {
        const gap = e.gapBefore ? "mt-4" : "";
        if (!e.children) {
          const on = leafActive(e, pathname, search);
          return (
            <li key={e.id} className={gap}>
              <Tooltip label={countLabel(e.label, e.count)}>
                <Link
                  to={e.to}
                  aria-label={countLabel(e.label, e.count)}
                  aria-current={on ? "page" : undefined}
                  className={cx("relative flex size-[44px] items-center justify-center rounded-control transition-colors duration-(--dur-1)", on ? "bg-selected text-ink" : IDLE)}
                >
                  <Glyph name={e.glyph} size={20} />
                  {!!e.count && <span aria-hidden="true" className="absolute top-[9px] right-[9px] size-2 rounded-full bg-accent" />}
                </Link>
              </Tooltip>
            </li>
          );
        }
        const items: MenuItem[] = e.children.map((c) => ({
          label: c.label,
          hint: c.count ? String(c.count) : undefined,
          checked: leafActive(c, pathname, search),
          onSelect: () => navigate(c.to),
        }));
        return (
          <li key={e.id} className={gap}>
            <Menu label={e.label} items={items} trigger={<RailButton entry={e} current={here === e.id} />} />
          </li>
        );
      })}
    </ul>
  );
}
