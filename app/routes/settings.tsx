import { Link } from "react-router";
import { useTheme } from "../theme";
import { BACKGROUNDS, WebGLPreview, type BackgroundId } from "../webgl-backgrounds";

export function meta() {
  return [{ title: "BFO - Settings" }];
}

export default function Settings() {
  const { theme, toggle, backgroundId, setBackgroundId } = useTheme();
  const isDark = theme === "dark";

  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <Link to="/tools" className={`${isDark ? "text-gray-500 hover:text-white" : "text-gray-400 hover:text-gray-900"} transition-colors`}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className={`text-2xl font-bold ${isDark ? "" : "text-gray-900"}`}>Settings</h1>
      </div>
      <p className={`text-sm mb-8 ${isDark ? "text-gray-500" : "text-gray-500"}`}>Customize your BFO experience</p>

      {/* Appearance Section */}
      <section className={`rounded-xl border p-6 ${isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white"}`}>
        <div className="flex items-center gap-3 mb-6">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isDark ? "bg-purple-500/10" : "bg-purple-50"}`}>
            <svg className={`w-5 h-5 ${isDark ? "text-purple-400" : "text-purple-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
          </div>
          <div>
            <h2 className={`text-sm font-semibold ${isDark ? "" : "text-gray-900"}`}>Appearance</h2>
            <p className={`text-xs ${isDark ? "text-gray-500" : "text-gray-500"}`}>Theme and background for the BF Access portal</p>
          </div>
        </div>

        {/* Theme Toggle */}
        <div className="mb-6">
          <label className={`text-xs font-medium uppercase tracking-wider mb-3 block ${isDark ? "text-gray-400" : "text-gray-500"}`}>Theme</label>
          <div className="flex gap-2">
            <button
              onClick={() => { if (isDark) toggle(); }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium transition-all ${
                !isDark
                  ? "bg-blue-500/10 text-blue-600 border border-blue-500/20"
                  : isDark ? "border border-white/10 text-gray-400 hover:border-white/20" : "border border-gray-200 text-gray-500 hover:border-gray-400"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              Light
            </button>
            <button
              onClick={() => { if (!isDark) toggle(); }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium transition-all ${
                isDark
                  ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                  : "border border-gray-200 text-gray-500 hover:border-gray-400"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
              Dark
            </button>
          </div>
        </div>

        {/* WebGL Background Picker */}
        <div>
          <label className={`text-xs font-medium uppercase tracking-wider mb-3 block ${isDark ? "text-gray-400" : "text-gray-500"}`}>
            BF Access Background
          </label>
          <p className={`text-xs mb-4 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
            Choose a dynamic background for the public BF Access portal pages
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {BACKGROUNDS.map((bg) => {
              const selected = backgroundId === bg.id;
              return (
                <button
                  key={bg.id}
                  onClick={() => setBackgroundId(bg.id)}
                  className={`group relative rounded-xl overflow-hidden transition-all ${
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
                    <div className={`text-[10px] ${isDark ? "text-gray-500" : "text-gray-400"}`}>{bg.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
