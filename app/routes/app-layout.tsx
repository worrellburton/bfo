import { NavLink, Outlet, useNavigate } from "react-router";
import { useEffect } from "react";
import { isAuthenticated } from "../auth";

const navItems = [
  { to: "/", label: "Home" },
  { to: "/frameworks", label: "Frameworks" },
  { to: "/notes", label: "Notes" },
];

export default function AppLayout() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthenticated()) {
      navigate("/login");
    }
  }, [navigate]);

  if (!isAuthenticated()) return null;

  return (
    <div className="min-h-screen bg-black text-white flex">
      {/* Sidebar */}
      <aside className="w-56 border-r border-white/10 flex flex-col p-6 shrink-0">
        <span className="text-2xl font-bold tracking-tight mb-10">BFO</span>
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8">
        <Outlet />
      </main>
    </div>
  );
}
