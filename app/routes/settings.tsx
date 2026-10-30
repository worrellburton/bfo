import { Link } from "react-router";
import { useTheme } from "../theme";
import { getUser, isAdmin } from "../auth";
import { BrandStudio } from "../brand-studio";

export function meta() {
  return [{ title: "BFO - Settings" }];
}

export default function Settings() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const admin = isAdmin(getUser());

  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <Link to="/home" aria-label="Back to Home" className={`${isDark ? "text-gray-500 hover:text-white" : "text-gray-500 hover:text-gray-900"} transition-colors max-sm:-ml-2.5 max-sm:inline-flex max-sm:h-[40px] max-sm:w-[40px] max-sm:items-center max-sm:justify-center`}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className={`text-2xl font-bold ${isDark ? "" : "text-gray-900"}`}>Settings</h1>
      </div>
      <p className={`text-sm mb-8 ${isDark ? "text-gray-500" : "text-gray-500"}`}>Customize your BFO experience</p>

      {/* How the app looks lives in Appearance (the user menu); Settings points there. */}
      <section className={`rounded-xl border p-6 ${isDark ? "border-white/10 bg-white/[0.02] glass-card" : "border-gray-200 bg-white"}`}>
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isDark ? "bg-purple-500/10" : "bg-purple-50"}`}>
            <svg className={`w-5 h-5 ${isDark ? "text-purple-400" : "text-purple-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
          </div>
          <div>
            <h2 className={`text-sm font-semibold ${isDark ? "" : "text-gray-900"}`}>Appearance</h2>
            <p className={`text-xs ${isDark ? "text-gray-500" : "text-gray-500"}`}>Light or dark, how solid the cards are and row density are under Appearance in your menu.</p>
          </div>
        </div>
      </section>

      {admin && <BrandStudio isDark={isDark} />}
    </div>
  );
}
