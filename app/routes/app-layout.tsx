import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommandPalette, ShortcutSheet, useGlobalShortcuts, useTrackRecent, type PageLink } from "../command-palette";
import { OfflineBanner, RouteProgress } from "../shell-status";
import {
  authFetch,
  displayName,
  getUser,
  initials,
  isAdmin,
  isAuthenticated,
  logout,
  revalidate,
} from "../auth";
import { useTheme } from "../theme";
import { ParticleCanvas } from "../particles";
import { SIDEBAR_OPEN_W, SIDEBAR_RAIL_W, useHoverCapable } from "../sidebar";

const iconCls = "w-[18px] h-[18px] shrink-0";
const navItems = [
  {
    to: "/home",
    label: "Home",
    icon: (
      <svg className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
    ),
  },
  {
    to: "/assets",
    label: "Entities",
    icon: (
      <svg className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
      </svg>
    ),
  },
  {
    to: "/treasury",
    label: "Treasury",
    icon: (
      <svg className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l9 5.25v1.5H3v-1.5L12 3zM5.25 10.5v7.5m4.5-7.5v7.5m4.5-7.5v7.5m4.5-7.5v7.5M3 21h18" />
      </svg>
    ),
  },
  {
    to: "/investments",
    label: "Investments",
    icon: (
      <svg className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
      </svg>
    ),
  },
  {
    to: "/books/transactions",
    label: "Books",
    children: [
      {
        to: "/books/transactions",
        label: "Transactions",
        icon: (
          <svg className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-9L21 3m0 0l-4.5 4.5M21 3H7.5" />
          </svg>
        ),
      },
      {
        to: "/books/review",
        label: "Review",
        icon: (
          <svg className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
      },
      {
        to: "/books/calendar",
        label: "Calendar",
        icon: (
          <svg className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
        ),
      },
      {
        to: "/books/reports",
        label: "Reports",
        icon: (
          <svg className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
        ),
      },
      {
        to: "/books/vendors",
        label: "Vendors",
        icon: (
          <svg className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
          </svg>
        ),
      },
      {
        to: "/books/rules",
        label: "Rules",
        icon: (
          <svg className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
        ),
      },
      {
        to: "/books/loans",
        label: "Loans",
        icon: (
          <svg className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
          </svg>
        ),
      },
    ],
    icon: (
      <svg className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    to: "/msas",
    label: "MSAs",
    icon: (
      <svg className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18M9 3v18M15 3v18M3 6a3 3 0 013-3h12a3 3 0 013 3v12a3 3 0 01-3 3H6a3 3 0 01-3-3V6z" />
      </svg>
    ),
  },

];


// The nav reads as two groups — what the family owns, then the work of
// running it — separated by a little air rather than headings.
const SECTION_BREAK = "/books/transactions";

const usersIcon = (
  <svg className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
  </svg>
);

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggle } = useTheme();
  const hoverCapable = useHoverCapable();

  const [user, setUser] = useState(() => getUser());
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const [hovering, setHovering] = useState(false);
  const [pending, setPending] = useState(0);

  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Refresh the custom entity-initials cache once per session.
    void import("../books-shared").then((m) => m.hydrateEntityTags());
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      navigate("/login");
      return;
    }
    // Confirm the session is still good server-side — an owner may have
    // revoked access, or the role may have changed, since the last sign-in.
    revalidate().then((ok) => {
      if (!ok) {
        navigate("/login");
        return;
      }
      const fresh = getUser();
      setUser(fresh);
      // Name plus both identifiers are mandatory — collect whatever is missing.
      if (fresh && (!fresh.name || !fresh.email || !fresh.phone)) navigate("/complete-profile");
    });
  }, [navigate]);

  // The Users badge is the count waiting on approval — the number that is
  // usually the reason someone opens the nav at all.
  useEffect(() => {
    if (!isAdmin(user)) return;
    void (async () => {
      try {
        const res = await authFetch("/api/auth/users");
        if (!res.ok) return;
        const data = await res.json();
        setPending((data.users ?? []).filter((u: any) => u.status === "incoming").length);
      } catch {
        // A missing badge is not worth surfacing.
      }
    })();
  }, [user]);

  // The user menu closes on an outside click and on Escape.
  useEffect(() => {
    if (!userMenuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setUserMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [userMenuOpen]);

  // Every destination the palette can jump to, in nav order.
  const pages = useMemo<PageLink[]>(() => {
    const list: PageLink[] = [];
    for (const item of navItems as any[]) {
      if (item.children) {
        for (const c of item.children) list.push({ to: c.to, label: c.label, section: item.label });
      } else {
        list.push({ to: item.to, label: item.label });
      }
    }
    list.push(
      { to: "/estate-map", label: "Estate map", section: "Entities", keywords: "structure ownership tree" },
      { to: "/treasury/mappings", label: "Account mappings", section: "Treasury" },
      { to: "/notes", label: "Notes" },
      { to: "/notifications", label: "Notifications", keywords: "alerts email report" },
      { to: "/settings", label: "Settings", keywords: "profile preferences" }
    );
    if (isAdmin(user)) list.push({ to: "/users", label: "Users", keywords: "people access approve" });
    return list;
  }, [user]);

  const openPalette = useCallback(() => {
    setDrawerOpen(false);
    setSheetOpen(false);
    setPaletteOpen(true);
  }, []);
  const openSheet = useCallback(() => setSheetOpen(true), []);
  useGlobalShortcuts({ openPalette, openSheet });
  useTrackRecent(pages);

  // The drawer behaves like a sheet: Escape closes it, focus moves into it,
  // and the page behind stops scrolling.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = drawerRef.current?.querySelector<HTMLElement>("a[href], button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [drawerOpen]);

  // Bird-style drill-in nav: a group opens into its own sub-view. `drill`
  // holds the open group's path; "__root__" forces the top level; null follows
  // the current route (so landing on a group's page opens that group). These
  // hooks sit above the signed-out early return so they always run.
  const activeGroupTo =
    (navItems as any[]).find((i) => i.children?.some((c: any) => location.pathname.startsWith(c.to)))?.to ?? null;
  const [drill, setDrill] = useState<string | null>(null);
  useEffect(() => {
    setDrill(activeGroupTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Below lg the rail is an off-canvas drawer; while it's closed its links
  // must not be reachable by Tab.
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  if (!isAuthenticated()) return null;

  const isDark = theme === "dark";

  // The content reflows with the rail: expanding the sidebar pushes the page
  // over (animated by the .sidebar-content transition) instead of covering it.
  const expanded = hovering && hoverCapable;
  const railWidth = expanded ? SIDEBAR_OPEN_W : SIDEBAR_RAIL_W;
  const contentInset = railWidth;
  const showLabels = expanded;
  // The mobile drawer always shows labels, so drill-in navigation works there too.
  const labelsVisible = expanded || drawerOpen;
  const items = navItems;

  const openGroup =
    drill && drill !== "__root__" ? ((items as any[]).find((i) => i.to === drill && i.children) ?? null) : null;

  function go(to: string) {
    setUserMenuOpen(false);
    setDrawerOpen(false);
    navigate(to);
  }

  const menuItemCls = `w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left whitespace-nowrap transition-colors cursor-pointer ${
    isDark ? "hover:bg-white/5 text-gray-300" : "hover:bg-gray-50 text-gray-700"
  }`;

  return (
    <div
      className={`min-h-screen relative ${isDark ? "bg-black text-white" : "bg-gray-50 text-gray-900"}`}
      style={{ ["--rail" as any]: `${railWidth}px`, ["--inset" as any]: `${contentInset}px` }}
    >
      <a href="#main" className="skip-link">Skip to content</a>
      <RouteProgress />

      {/* Drifting aurora — the app shell shares the landing atmosphere and the
          glass surfaces let it show through. */}
      <div aria-hidden className="app-aurora fixed inset-0 pointer-events-none">
        <div className="landing-orb landing-orb-1" />
        <div className="landing-orb landing-orb-2" />
        <div className="landing-orb landing-orb-3" />
      </div>
      <ParticleCanvas themeAware className="absolute inset-0 w-full h-full pointer-events-none" />

      {drawerOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setDrawerOpen(false)} />
      )}

      <aside
        ref={drawerRef}
        inert={!isDesktop && !drawerOpen}
        aria-label="Navigation"
        onTouchStart={(e) => {
          const t = e.touches[0];
          swipeStart.current = drawerOpen ? { x: t.clientX, y: t.clientY } : null;
        }}
        onTouchEnd={(e) => {
          const start = swipeStart.current;
          swipeStart.current = null;
          if (!start) return;
          const t = e.changedTouches[0];
          // A leftward flick closes the drawer, like the native sheet.
          if (start.x - t.clientX > 60 && Math.abs(t.clientY - start.y) < 50) setDrawerOpen(false);
        }}
        onMouseEnter={() => hoverCapable && setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        className={`
          sidebar-rail fixed inset-y-0 left-0 z-50 flex flex-col border-r
          w-[260px] lg:w-[var(--rail)]
          ${drawerOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0
          ${isDark ? "border-white/10 bg-black/55 backdrop-blur-2xl" : "border-gray-200 bg-white/65 backdrop-blur-2xl"}
        `}
      >
        {/* Top: width control, then the wordmark */}
        <div className={`flex items-center gap-2 px-4 h-16 shrink-0 ${showLabels ? "" : "lg:justify-center lg:px-0"}`}>
          <span className={`sidebar-brand ${showLabels ? "" : "sidebar-brand-sm"}`}>BFO</span>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close menu"
            className={`ml-auto flex h-10 w-10 items-center justify-center rounded-full lg:hidden ${
              isDark ? "text-gray-300 hover:bg-white/10" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* Jump to anything — the palette's front door in the rail. */}
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={openPalette}
            title={showLabels ? undefined : "Search (⌘K)"}
            aria-label="Search and jump to"
            className={`flex w-full items-center rounded-lg border text-sm transition-colors cursor-pointer px-3 py-2 ${
              labelsVisible ? "" : "lg:justify-center lg:px-0 lg:border-transparent"
            } ${
              isDark
                ? "border-white/10 bg-white/[0.03] text-gray-400 hover:text-white hover:bg-white/5"
                : "border-gray-200 bg-white/60 text-gray-500 hover:text-black hover:bg-black/5"
            }`}
          >
            <svg className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
              </svg>
            <span className={`ml-2 flex-1 truncate text-left ${labelsVisible ? "" : "lg:hidden"}`}>Search</span>
            <kbd className={`hidden text-[11px] ${labelsVisible ? "lg:inline" : ""} ${isDark ? "text-gray-500" : "text-gray-400"}`}>⌘K</kbd>
          </button>
        </div>

        <nav className="flex flex-col gap-1 flex-1 px-3 overflow-y-auto" aria-label="Main">
          {labelsVisible && openGroup ? (
            /* Drilled-in group: a back header, then its pages as a flat list. */
            <>
              <button
                onClick={() => setDrill("__root__")}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold transition-colors cursor-pointer ${
                  isDark ? "text-gray-300 hover:text-white hover:bg-white/5" : "text-gray-700 hover:text-black hover:bg-black/5"
                }`}
              >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
                <span className="truncate">{openGroup.label}</span>
              </button>
              <div className={`h-px mx-2 my-1 ${isDark ? "bg-white/10" : "bg-gray-200"}`} />
              {openGroup.children.map((c: { to: string; label: string; icon?: React.ReactNode }) => (
                <NavLink
                  key={c.to}
                  to={c.to}
                  onClick={() => setDrawerOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                      isActive
                        ? isDark ? "bg-white/10 text-white font-medium" : "bg-black/5 text-black font-medium"
                        : isDark ? "text-gray-400 hover:text-white hover:bg-white/5" : "text-gray-500 hover:text-black hover:bg-black/5"
                    }`
                  }
                >
                  {c.icon && <span className="shrink-0 inline-flex">{c.icon}</span>}
                  <span className="truncate">{c.label}</span>
                </NavLink>
              ))}
            </>
          ) : (
            /* Top level: leaf items link; grouped items drill in with a chevron. */
            items.map((item) => {
              const children = ("children" in item ? (item as any).children : null) as
                | Array<{ to: string; label: string }>
                | null;
              const groupActive = !!children && children.some((c) => location.pathname.startsWith(c.to));

              if (labelsVisible && children) {
                return (
                  <button
                    key={item.to}
                    onClick={() => setDrill(item.to)}
                    className={`relative flex items-center rounded-lg text-sm font-medium transition-colors px-3 py-2 cursor-pointer ${item.to === SECTION_BREAK ? "mt-4" : ""} ${
                      groupActive
                        ? isDark ? "bg-white/10 text-white" : "bg-black/5 text-black"
                        : isDark ? "text-gray-400 hover:text-white hover:bg-white/5" : "text-gray-500 hover:text-black hover:bg-black/5"
                    }`}
                  >
                    <span className="inline-flex shrink-0">{item.icon}</span>
                    <span className="ml-2 flex-1 truncate text-left">{item.label}</span>
                    <svg className="w-4 h-4 shrink-0 opacity-50" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                );
              }

              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/home"}
                  onClick={() => setDrawerOpen(false)}
                  title={showLabels ? undefined : item.label}
                  aria-label={showLabels ? undefined : item.label}
                  className={({ isActive }) =>
                    `relative flex items-center rounded-lg text-sm font-medium transition-colors px-3 py-2 ${item.to === SECTION_BREAK ? "mt-4" : ""} ${
                      showLabels ? "" : "lg:justify-center lg:px-0"
                    } ${
                      isActive || groupActive
                        ? isDark ? "bg-white/10 text-white" : "bg-black/5 text-black"
                        : isDark ? "text-gray-400 hover:text-white hover:bg-white/5" : "text-gray-500 hover:text-black hover:bg-black/5"
                    }`
                  }
                >
                  <span className="relative inline-flex shrink-0">
                    {item.icon}
                    {"badge" in item && (item as any).badge > 0 && !showLabels && (
                      <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-black text-[10px] font-bold flex items-center justify-center">
                        {(item as any).badge}
                      </span>
                    )}
                  </span>
                  <span className={`ml-2 flex-1 truncate ${showLabels ? "" : "lg:hidden"}`}>{item.label}</span>
                  {"badge" in item && (item as any).badge > 0 && showLabels && (
                    <span className="ml-auto min-w-[18px] h-[18px] px-1.5 rounded-full bg-amber-500 text-black text-[10px] font-bold flex items-center justify-center">
                      {(item as any).badge}
                    </span>
                  )}
                </NavLink>
              );
            })
          )}
        </nav>

        {/* Bottom: the signed-in user, as the menu trigger */}
        <div className="relative mt-auto p-3" ref={userMenuRef}>
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            aria-expanded={userMenuOpen}
            aria-haspopup="menu"
            title={showLabels ? undefined : displayName(user)}
            aria-label={showLabels ? undefined : displayName(user)}
            className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
              showLabels ? "" : "lg:justify-center lg:px-0"
            } ${isDark ? "hover:bg-white/5 text-gray-300" : "hover:bg-black/5 text-gray-600"}`}
          >
            <div
              className={`relative w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                isDark ? "bg-white/10 text-white" : "bg-black/5 text-gray-700"
              }`}
            >
              {initials(user)}
              {pending > 0 && isAdmin(user) && (
                <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ${isDark ? "ring-black" : "ring-white"}`} aria-label={`${pending} waiting for approval`} />
              )}
            </div>
            <span className={`min-w-0 flex-1 text-left ${showLabels ? "" : "lg:hidden"}`}>
              <span className="block truncate font-medium">{displayName(user)}</span>
              <span className={`block truncate text-xs ${isDark ? "text-gray-500" : "text-gray-500"}`}>
                {user?.email || user?.phoneFormatted || "Signed in"}
              </span>
            </span>
          </button>

          {userMenuOpen && (
            <div
              role="menu"
              className={`absolute bottom-full left-3 mb-2 w-56 max-w-[calc(100vw-1.5rem)] rounded-xl border shadow-lg overflow-hidden z-50 ${
                isDark ? "bg-[#1a1a1a] border-white/10" : "bg-white border-gray-200"
              }`}
            >
              <button onClick={() => toggle()} className={menuItemCls} role="menuitem">
                {isDark ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
                {isDark ? "Light mode" : "Dark mode"}
              </button>

              {isAdmin(user) && (
                <button onClick={() => go("/users")} className={menuItemCls} role="menuitem">
                  <span className="inline-flex [&>svg]:h-4 [&>svg]:w-4">{usersIcon}</span>
                  <span className="flex-1">Users</span>
                  {pending > 0 && (
                    <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-amber-500 text-black text-[10px] font-bold flex items-center justify-center">
                      {pending}
                    </span>
                  )}
                </button>
              )}

              <button onClick={() => go("/notifications")} className={menuItemCls} role="menuitem">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1h6z" />
                </svg>
                Notifications
              </button>

              <button onClick={() => go("/settings")} className={menuItemCls} role="menuitem">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Settings
              </button>

              <div className={`border-t ${isDark ? "border-white/5" : "border-gray-100"}`} />

              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  setDrawerOpen(false);
                  logout();
                  navigate("/login");
                }}
                role="menuitem"
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left whitespace-nowrap transition-colors cursor-pointer ${
                  isDark ? "hover:bg-white/5 text-red-400" : "hover:bg-gray-50 text-red-500"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Log out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile top bar — menu upper-left, the wordmark centred. The drawer
          holds every destination, so there is no bottom dock. */}
      <header
        className={`fixed inset-x-0 top-0 z-30 border-b backdrop-blur-2xl lg:hidden ${
          isDark ? "border-white/10 bg-black/60" : "border-gray-200 bg-white/70"
        }`}
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="relative flex h-14 items-center justify-center px-2">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            className={`absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full transition-colors ${
              isDark ? "text-gray-200 hover:bg-white/10" : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            <svg className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <NavLink to="/home" aria-label="BFO home" className="mobile-brand">
            BFO
          </NavLink>
          <button
            type="button"
            onClick={openPalette}
            aria-label="Search and jump to"
            className={`absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full transition-colors ${
              isDark ? "text-gray-200 hover:bg-white/10" : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            <svg className="h-[20px] w-[20px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
              </svg>
          </button>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="sidebar-content outline-none relative z-10 p-4 pt-[calc(4.5rem+env(safe-area-inset-top))] sm:p-6 sm:pt-[calc(5rem+env(safe-area-inset-top))] lg:p-8 lg:ml-[var(--inset)]">
        <Outlet />
      </main>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        pages={pages}
        isDark={isDark}
        actions={[
          { id: "theme", label: isDark ? "Switch to light mode" : "Switch to dark mode", hint: "Appearance", run: () => { toggle(); setPaletteOpen(false); } },
          { id: "shortcuts", label: "Keyboard shortcuts", hint: "?", run: () => { setPaletteOpen(false); setSheetOpen(true); } },
          { id: "logout", label: "Log out", run: () => { setPaletteOpen(false); logout(); navigate("/login"); } },
        ]}
      />
      <ShortcutSheet open={sheetOpen} onClose={() => setSheetOpen(false)} isDark={isDark} />
      <OfflineBanner isDark={isDark} />


    </div>
  );
}
