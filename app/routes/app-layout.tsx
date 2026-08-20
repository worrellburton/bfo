import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useEffect, useRef, useState } from "react";
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
    to: "/tools",
    label: "Tools",
    icon: (
      <svg className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
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
    to: "/books/calendar",
    label: "In Progress",
    children: [
      {
        to: "/books/calendar",
        label: "Calendar",
        icon: (
          <svg className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
        ),
      },
    ],
    icon: (
      <svg className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
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
  {
    to: "/tools/taxes",
    label: "Taxes",
    icon: (
      <svg className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0c1.1.128 1.907 1.077 1.907 2.185zM9.75 9h.008v.008H9.75V9zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 4.5h.008v.008h-.008V13.5zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
      </svg>
    ),
  },
];


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
  const items = isAdmin(user)
    ? [...navItems, { to: "/users", label: "Users", icon: usersIcon, badge: pending }]
    : navItems;

  // Bird-style drill-in nav: a group opens into its own sub-view. `drill`
  // holds the open group's path; "__root__" forces the top level; null follows
  // the current route (so landing on a group's page opens that group).
  const activeGroupTo =
    (items as any[]).find((i) => i.children?.some((c: any) => location.pathname.startsWith(c.to)))?.to ?? null;
  const [drill, setDrill] = useState<string | null>(null);
  useEffect(() => {
    setDrill(activeGroupTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);
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
                    className={`relative flex items-center rounded-lg text-sm font-medium transition-colors px-3 py-2 cursor-pointer ${
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
                    `relative flex items-center rounded-lg text-sm font-medium transition-colors px-3 py-2 ${
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

        {/* Sunrise / sunset — a visible theme switch that sits above the user. */}
        <div className="mt-auto px-3 pt-1">
          <button
            onClick={() => toggle()}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            title={isDark ? "Sunrise — light mode" : "Sunset — dark mode"}
            className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg transition-colors cursor-pointer ${
              showLabels ? "" : "lg:justify-center lg:px-0"
            } ${isDark ? "hover:bg-white/5 text-gray-300" : "hover:bg-black/5 text-gray-600"}`}
          >
            <span className="relative inline-flex shrink-0 w-5 h-5 items-center justify-center">
              {isDark ? (
                <svg className="w-4 h-4 text-indigo-300" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              )}
            </span>
            <span className={`flex-1 text-left text-sm font-medium ${showLabels ? "" : "lg:hidden"}`}>
              {isDark ? "Sunset" : "Sunrise"}
            </span>
            {/* The track slides between sunrise (amber) and sunset (indigo). */}
            <span
              className={`relative w-10 h-[22px] rounded-full transition-colors shrink-0 ${showLabels ? "" : "lg:hidden"} ${
                isDark ? "bg-indigo-500/30" : "bg-amber-400/70"
              }`}
              aria-hidden
            >
              <span
                className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                  isDark ? "translate-x-[3px]" : "translate-x-[21px]"
                }`}
              />
            </span>
          </button>
        </div>

        {/* Bottom: the signed-in user, as the menu trigger */}
        <div className="relative p-3" ref={userMenuRef}>
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
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                isDark ? "bg-white/10 text-white" : "bg-black/5 text-gray-700"
              }`}
            >
              {initials(user)}
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

      <main className="sidebar-content relative z-10 p-4 pb-28 sm:p-6 sm:pb-28 lg:p-8 lg:pb-8 lg:ml-[var(--inset)]">
        <Outlet />
      </main>

      {/* Mobile dock — floating glass pill, primary destinations only */}
      <nav
        aria-label="Quick navigation"
        className="mobile-dock fixed bottom-4 left-1/2 -translate-x-1/2 z-40 lg:hidden"
      >
        {["Entities", "Treasury", "Home", "Books", "Tools"].map((label) => {
          const item = navItems.find((n) => n.label === label);
          if (!item) return null;
          const active =
            item.to === "/home"
              ? location.pathname === "/home"
              : item.label === "Books"
                ? location.pathname.startsWith("/books")
                : location.pathname.startsWith(item.to);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={`mobile-dock-item ${active ? "mobile-dock-item-active" : ""} ${
                isDark ? "text-gray-300" : "text-gray-600"
              }`}
            >
              {item.icon}
            </NavLink>
          );
        })}
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          className={`mobile-dock-item text-[11px] font-bold ${isDark ? "text-gray-300" : "text-gray-600"}`}
        >
          {initials(user)}
        </button>
      </nav>

    </div>
  );
}
