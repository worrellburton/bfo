import { NavLink, Outlet, useNavigate } from "react-router";
import { useEffect, useRef, useState } from "react";
import { isAuthenticated, logout } from "../auth";
import { useTheme } from "../theme";
import { ParticleCanvas } from "../particles";

const navItems = [
  { to: "/", label: "Home", icon: null },
  { to: "/frameworks", label: "Frameworks", icon: null },
  { to: "/assets", label: "Assets", icon: null },
  { to: "/notes", label: "Notes", icon: null },
  { to: "/office", label: "Office", icon: null },
  { to: "/tools", label: "Tools", icon: null },
  { to: "/tools/quickbooks", label: "Finance", icon: null },
  { to: "/estate-map", label: "Estate Map", icon: null },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      navigate("/login");
    }
  }, [navigate]);

  // Close menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [menuOpen]);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [navigate]);

  if (!isAuthenticated()) return null;

  const isDark = theme === "dark";

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className={`min-h-screen flex relative ${isDark ? "bg-black text-white" : "bg-gray-50 text-gray-900"}`}>
      {/* Particle canvas */}
      <ParticleCanvas themeAware className="absolute inset-0 w-full h-full pointer-events-none" />

      {/* Mobile header bar */}
      <div className={`fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 py-3 lg:hidden ${isDark ? "bg-black/90 backdrop-blur-md border-b border-white/10" : "bg-white/90 backdrop-blur-md border-b border-gray-200"}`}>
        <span className="text-xl font-bold tracking-tight">BFO</span>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-white/10 text-gray-300" : "hover:bg-gray-100 text-gray-600"}`}
        >
          {sidebarOpen ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 h-full z-50 w-64 border-r flex flex-col p-6 shrink-0 relative
        transition-transform duration-200 ease-in-out
        lg:sticky lg:top-0 lg:translate-x-0 lg:w-56 lg:z-10 lg:h-screen
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        ${isDark ? "border-white/10 bg-black" : "border-gray-200 bg-white"}
      `}>
        <span className="text-2xl font-bold tracking-tight mb-10">BFO</span>
        <nav className="flex flex-col gap-1 flex-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? isDark
                      ? "bg-white/10 text-white"
                      : "bg-black/5 text-black"
                    : isDark
                      ? "text-gray-400 hover:text-white hover:bg-white/5"
                      : "text-gray-500 hover:text-black hover:bg-black/5"
                }`
              }
            >
              {item.icon && <span className="inline-flex mr-2">{item.icon}</span>}
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* User + Settings — bottom of sidebar */}
        <div className="relative mt-auto" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer ${
              isDark
                ? "hover:bg-white/5 text-gray-300"
                : "hover:bg-black/5 text-gray-600"
            }`}
          >
            {/* Avatar */}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
              isDark ? "bg-white/10 text-white" : "bg-black/5 text-gray-700"
            }`}>
              W
            </div>
            <span className="flex-1 text-left truncate font-medium">Worrell</span>
            {/* Settings gear */}
            <svg className={`w-4 h-4 shrink-0 ${isDark ? "text-gray-500" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          {/* Popup menu */}
          {menuOpen && (
            <div className={`absolute bottom-full left-0 w-full mb-2 rounded-xl border shadow-lg overflow-hidden ${
              isDark
                ? "bg-[#1a1a1a] border-white/10"
                : "bg-white border-gray-200"
            }`}>
              <button
                onClick={() => toggle()}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors cursor-pointer ${
                  isDark ? "hover:bg-white/5 text-gray-300" : "hover:bg-gray-50 text-gray-700"
                }`}
              >
                {isDark ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
                {isDark ? "Light mode" : "Dark mode"}
              </button>

              <button
                onClick={() => {
                  setMenuOpen(false);
                  setSidebarOpen(false);
                  navigate("/agents");
                }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors cursor-pointer ${
                  isDark ? "hover:bg-white/5 text-gray-300" : "hover:bg-gray-50 text-gray-700"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Manage Agents
              </button>

              <button
                onClick={() => {
                  setMenuOpen(false);
                  setSidebarOpen(false);
                  navigate("/settings");
                }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors cursor-pointer ${
                  isDark ? "hover:bg-white/5 text-gray-300" : "hover:bg-gray-50 text-gray-700"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Settings
              </button>

              <div className={`border-t ${isDark ? "border-white/5" : "border-gray-100"}`} />

              <button
                onClick={() => {
                  setMenuOpen(false);
                  setSidebarOpen(false);
                  handleLogout();
                }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors cursor-pointer ${
                  isDark ? "hover:bg-white/5 text-red-400" : "hover:bg-gray-50 text-red-500"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Log out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-4 pt-16 sm:p-6 sm:pt-16 lg:p-8 lg:pt-8 relative z-10">
        <Outlet />
      </main>
    </div>
  );
}
