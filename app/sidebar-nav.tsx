import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";

/**
 * The rail's main nav. Leaves link straight through; groups (Mail, Books)
 * open in place into a tree: the group's row lights up, a chevron turns, and
 * its pages hang off a thin line with a rounded elbow each (app.css
 * .nav-tree). The group holding the current page opens on its own, and which
 * groups are open is remembered. On the collapsed rail a group is just its
 * icon and goes to its first page.
 */

export type NavChild = {
  to: string;
  label: string;
  icon?: React.ReactNode;
  badge?: number;
  /** When the plain path prefix isn't enough (Mail's folders share /inbox). */
  match?: (pathname: string, search: URLSearchParams) => boolean;
};

export type NavItem = {
  to: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  /** Starts the second half of the nav, after a little air. */
  breakBefore?: boolean;
  /** A heading over this item and the ones after it, in the phone drawer ("The office"). */
  section?: string;
  children?: NavChild[];
};

const OPEN_KEY = "bfo.nav.open";

function readOpen(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function childActive(c: NavChild, pathname: string, search: URLSearchParams): boolean {
  if (c.match) return c.match(pathname, search);
  return pathname === c.to || pathname.startsWith(`${c.to}/`);
}

function Badge({ n, tone, isDark }: { n: number; tone: "accent" | "quiet"; isDark: boolean }) {
  if (n <= 0) return null;
  // A quiet count: tinted, not a solid disc.
  const cls =
    tone === "accent"
      ? isDark
        ? "bg-[#818cf8]/20 text-[#c7d2fe]"
        : "bg-[#4f46e5]/10 text-[#4338ca]"
      : isDark
        ? "bg-white/10 text-gray-300"
        : "bg-black/[0.06] text-gray-600";
  return (
    <span className={`ml-auto min-w-[18px] h-[16px] px-1 rounded-full text-[10px] font-semibold tabular-nums flex items-center justify-center ${cls}`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function SidebarNav({
  items,
  isDark,
  showLabels,
  labelsVisible,
  phone = false,
  onNavigate,
}: {
  items: NavItem[];
  isDark: boolean;
  /** The phone drawer: section headings over the groups of rows. */
  phone?: boolean;
  /** The desktop rail is expanded. */
  showLabels: boolean;
  /** Labels show (expanded rail, or the phone drawer). */
  labelsVisible: boolean;
  onNavigate: () => void;
}) {
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const [open, setOpen] = useState<Set<string>>(() => new Set(typeof window === "undefined" ? [] : readOpen()));

  const groupOf = (item: NavItem) => !!item.children?.some((c) => childActive(c, location.pathname, search));

  // Landing on a group's page opens that group.
  useEffect(() => {
    const here = items.find((i) => i.children && groupOf(i));
    if (here && !open.has(here.to)) setOpen((s) => new Set(s).add(here.to));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...open]));
    } catch {
      // Remembering is a nicety.
    }
  }, [open]);

  const toggle = (to: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(to)) n.delete(to);
      else n.add(to);
      return n;
    });

  // Compact rows: 30px, 13px type, 16px icons, a soft fill for the current page. In the phone drawer and on a touch
  // iPad, thumb-sized (44px): sizes are px because the root font is 11.9px, so rem classes come out at 74% (app/app.css).
  const rowBase = "nav-row group/row relative flex items-center rounded-lg text-[13px] transition-colors duration-150 h-[30px] px-2 max-md:h-[44px] max-md:text-[15px] md:pointer-coarse:h-[44px]";
  const idle = isDark ? "text-gray-300/90 hover:text-white hover:bg-white/[0.05]" : "text-gray-600 hover:text-black hover:bg-black/[0.04]";
  const lit = isDark ? "bg-white/[0.08] text-white" : "bg-black/[0.06] text-black";
  const on = `nav-row-on ${lit}`;
  const collapsed = showLabels ? "" : "md:justify-center md:px-0";

  return (
    <nav className="flex flex-col gap-px flex-1 px-2 pb-3 overflow-y-auto overscroll-contain" aria-label="Main">
      {items.map((item) => {
        const kids = item.children;
        const active = kids ? groupOf(item) : childActive({ to: item.to, label: item.label }, location.pathname, search);
        const gap = item.breakBefore ? (labelsVisible ? "mt-4" : "mt-3") : "";
        const total = item.badge ?? kids?.reduce((s, c) => s + (c.badge ?? 0), 0) ?? 0;
        const heading = phone && item.section ? <p className="nav-eyebrow">{item.section}</p> : null;

        const iconWithDot = (
          <span className="relative inline-flex shrink-0">
            {item.icon}
            {/* On the collapsed rail, a dot (a number would cover the icon); the count is in the label and tooltip. */}
            {total > 0 && !showLabels && (
              <span
                aria-hidden="true"
                className={`absolute -top-[2px] -right-[3px] h-[7px] w-[7px] rounded-full ring-2 ${labelsVisible ? "hidden" : ""} ${
                  isDark ? "bg-[#818cf8] ring-black" : "bg-[#4f46e5] ring-white"
                }`}
              />
            )}
          </span>
        );

        // A leaf, or a group on the collapsed rail: one link.
        if (!kids || !labelsVisible) {
          return (
            <div key={item.to} className={gap}>
              {heading}
              <Link
                to={kids ? kids[0].to : item.to}
                onClick={onNavigate}
                title={showLabels ? undefined : `${item.label}${total ? ` · ${total} new` : ""}`}
                aria-label={showLabels ? undefined : `${item.label}${total ? `, ${total} new` : ""}`}
                aria-current={active ? "page" : undefined}
                className={`${rowBase} ${collapsed} ${active ? on : idle}`}
              >
                {iconWithDot}
                <span className={`ml-2 flex-1 truncate ${showLabels ? "" : "md:hidden"}`}>{item.label}</span>
                {showLabels || labelsVisible ? <Badge n={total} tone="accent" isDark={isDark} /> : null}
              </Link>
            </div>
          );
        }

        const isOpen = open.has(item.to);
        const panel = `nav-panel-${item.to.replace(/\W+/g, "-")}`;
        return (
          <div key={item.to} className={gap}>
            {heading}
            <button
              type="button"
              onClick={() => toggle(item.to)}
              aria-expanded={isOpen}
              aria-controls={panel}
              className={`${rowBase} w-full cursor-pointer ${active && !isOpen ? on : idle}`}
            >
              {iconWithDot}
              <span className="ml-2 flex-1 truncate text-left">{item.label}</span>
              {!isOpen && <Badge n={total} tone="accent" isDark={isDark} />}
              <svg
                className={`ml-2 h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""} ${isDark ? "text-gray-500" : "text-gray-400"}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            <div id={panel} className={`nav-collapse ${isOpen ? "nav-collapse-open" : ""}`} inert={!isOpen}>
              <ul className={`nav-tree ${isDark ? "nav-tree-dark" : "nav-tree-light"}`}>
                {kids.map((c) => {
                  const here = childActive(c, location.pathname, search);
                  return (
                    <li key={c.to} className="nav-branch">
                      <Link
                        to={c.to}
                        onClick={onNavigate}
                        aria-current={here ? "page" : undefined}
                        className={`flex items-center gap-2 rounded-lg h-7 px-2 text-[12.5px] transition-colors duration-150 max-md:h-[40px] max-md:text-[14px] md:pointer-coarse:h-[40px] ${
                          here
                            ? isDark
                              ? "bg-white/[0.08] text-white font-medium"
                              : "bg-black/[0.05] text-black font-medium"
                            : isDark
                              ? "text-gray-400 hover:text-white hover:bg-white/[0.05]"
                              : "text-gray-500 hover:text-black hover:bg-black/[0.04]"
                        }`}
                      >
                        {c.icon && <span className={`inline-flex shrink-0 ${here ? "" : "opacity-80"}`}>{c.icon}</span>}
                        <span className="flex-1 truncate">{c.label}</span>
                        <Badge n={c.badge ?? 0} tone="quiet" isDark={isDark} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
