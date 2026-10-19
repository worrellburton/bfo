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
  const cls =
    tone === "accent"
      ? isDark
        ? "bg-[#818cf8] text-black"
        : "bg-[#4f46e5] text-white"
      : isDark
        ? "bg-white/90 text-black"
        : "bg-gray-900 text-white";
  return (
    <span className={`ml-auto min-w-[20px] h-[20px] px-1.5 rounded-full text-[10.5px] font-semibold tabular-nums flex items-center justify-center ${cls}`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function SidebarNav({
  items,
  isDark,
  showLabels,
  labelsVisible,
  onNavigate,
}: {
  items: NavItem[];
  isDark: boolean;
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

  const rowBase = "nav-row group/row relative flex items-center rounded-[10px] text-[13.5px] font-medium transition-colors duration-150 h-9 px-3";
  const idle = isDark ? "text-gray-400 hover:text-white hover:bg-white/[0.06]" : "text-gray-500 hover:text-black hover:bg-black/[0.04]";
  const lit = isDark ? "bg-white/[0.09] text-white" : "bg-black/[0.06] text-black";
  const on = `nav-row-on ${lit}`;
  const collapsed = showLabels ? "" : "lg:justify-center lg:px-0";

  return (
    <nav className="flex flex-col gap-0.5 flex-1 px-3 pb-3 overflow-y-auto overscroll-contain" aria-label="Main">
      {items.map((item) => {
        const kids = item.children;
        const active = kids ? groupOf(item) : childActive({ to: item.to, label: item.label }, location.pathname, search);
        const gap = item.breakBefore ? (labelsVisible ? "mt-5" : "mt-3") : "";
        const total = item.badge ?? kids?.reduce((s, c) => s + (c.badge ?? 0), 0) ?? 0;

        const iconWithDot = (
          <span className="relative inline-flex shrink-0">
            {item.icon}
            {total > 0 && !showLabels && (
              <span
                className={`absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold tabular-nums flex items-center justify-center ring-2 ${
                  labelsVisible ? "hidden" : ""
                } ${isDark ? "bg-[#818cf8] text-black ring-black" : "bg-[#4f46e5] text-white ring-white"}`}
              >
                {total > 99 ? "99+" : total}
              </span>
            )}
          </span>
        );

        // A leaf, or a group on the collapsed rail: one link.
        if (!kids || !labelsVisible) {
          return (
            <div key={item.to} className={gap}>
              <Link
                to={kids ? kids[0].to : item.to}
                onClick={onNavigate}
                title={showLabels ? undefined : item.label}
                aria-label={showLabels ? undefined : item.label}
                aria-current={active ? "page" : undefined}
                className={`${rowBase} ${collapsed} ${active ? on : idle}`}
              >
                {iconWithDot}
                <span className={`ml-2.5 flex-1 truncate ${showLabels ? "" : "lg:hidden"}`}>{item.label}</span>
                {showLabels || labelsVisible ? <Badge n={total} tone="accent" isDark={isDark} /> : null}
              </Link>
            </div>
          );
        }

        const isOpen = open.has(item.to);
        const panel = `nav-panel-${item.to.replace(/\W+/g, "-")}`;
        return (
          <div key={item.to} className={gap}>
            <button
              type="button"
              onClick={() => toggle(item.to)}
              aria-expanded={isOpen}
              aria-controls={panel}
              className={`${rowBase} w-full cursor-pointer ${active && !isOpen ? on : isOpen ? lit : idle}`}
            >
              {iconWithDot}
              <span className="ml-2.5 flex-1 truncate text-left">{item.label}</span>
              {!isOpen && <Badge n={total} tone="accent" isDark={isDark} />}
              <svg
                className={`ml-2 h-4 w-4 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""} ${isDark ? "text-gray-500" : "text-gray-400"}`}
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
                        className={`flex items-center gap-2.5 rounded-[9px] h-[34px] px-2.5 text-[13px] transition-colors duration-150 ${
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
