import { Link } from "react-router";
import { useTheme } from "../theme";
import { BACKGROUNDS, WebGLPreview, type BackgroundId } from "../webgl-backgrounds";
import { getUser, isAdmin } from "../auth";
import { BrandStudio } from "../brand-studio";

export function meta() {
  return [{ title: "BFO - Settings" }];
}

export default function Settings() {
  const { theme, backgroundId, setBackgroundId } = useTheme();
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

      {/* Appearance Section */}
      <section className={`rounded-xl border p-6 ${isDark ? "border-white/10 bg-white/[0.02] glass-card" : "border-gray-200 bg-white"}`}>
        <div className="flex items-center gap-3 mb-6">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isDark ? "bg-purple-500/10" : "bg-purple-50"}`}>
            <svg className={`w-5 h-5 ${isDark ? "text-purple-400" : "text-purple-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
          </div>
          <div>
            <h2 className={`text-sm font-semibold ${isDark ? "" : "text-gray-900"}`}>Background</h2>
            <p className={`text-xs ${isDark ? "text-gray-500" : "text-gray-500"}`}>The moving background behind the public BF Access pages</p>
          </div>
        </div>

        {/* Light or dark lives in Appearance (the user menu), with the rest of how the app looks. */}
        <p className={`mb-6 text-xs ${isDark ? "text-gray-500" : "text-gray-500"}`}>Light or dark, how solid the cards are and row density are under Appearance in your menu.</p>

        {/* WebGL Background Picker */}
        <div>
          <label className={`text-xs font-medium uppercase tracking-wider mb-3 block ${isDark ? "text-gray-400" : "text-gray-500"}`}>
            BF Access Background
          </label>
          <p className={`text-xs mb-4 ${isDark ? "text-gray-500" : "text-gray-500"}`}>
            Choose a dynamic background for the public BF Access portal pages
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {BACKGROUNDS.map((bg) => {
              const selected = backgroundId === bg.id;
              return (
                <button
                  key={bg.id}
                  onClick={() => setBackgroundId(bg.id)}
                  aria-pressed={selected}
                  className={`group relative rounded-xl text-left overflow-hidden transition-all ${
                    selected
                      ? isDark
                        ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-black"
                        : "ring-2 ring-blue-500 ring-offset-2 ring-offset-white"
                      : isDark
                        ? "border border-white/10 hover:border-white/20"
                        : "border border-gray-200 hover:border-gray-400"
                  }`}
                >
                  <div className="aspect-[16/10] relative">
                    <WebGLPreview backgroundId={bg.id} dark={isDark} />
                    {selected && (
                      <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                      </div>
                    )}
                  </div>
                  <div className={`px-2.5 py-2 ${isDark ? "bg-white/[0.03]" : "bg-gray-50"}`}>
                    <div className={`text-xs font-medium ${isDark ? "" : "text-gray-900"}`}>{bg.label}</div>
                    <div className={`text-[10px] ${isDark ? "text-gray-500" : "text-gray-500"}`}>{bg.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {admin && <BrandStudio isDark={isDark} />}
    </div>
  );
}
