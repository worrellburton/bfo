import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { DENSITIES, useAppearance, type Density } from "./appearance";
import { useTheme } from "./theme";

/**
 * The Appearance panel (the sidebar's Appearance button): light or dark, how
 * solid the glass cards are, and how tall the rows are. Everything applies as
 * you change it, and is kept on this browser (app/appearance.ts, app/theme.tsx).
 */
export function AppearancePanel({ onClose }: { onClose: () => void }) {
  const { theme, setTheme } = useTheme();
  const { glass, density, setGlass, setDensity, reset } = useAppearance();
  const dark = theme === "dark";
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      } else if (e.key === "Tab") {
        const items = [...(panel.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input, [tabindex]:not([tabindex='-1'])") ?? [])];
        if (!items.length) return;
        const at = document.activeElement as HTMLElement | null;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey ? at === first || !panel.current?.contains(at) : at === last || !panel.current?.contains(at)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const text = dark ? "text-white" : "text-gray-900";
  const muted = dark ? "text-gray-400" : "text-gray-500";
  const faint = dark ? "text-gray-500" : "text-gray-400";
  const line = dark ? "border-white/10" : "border-gray-200";
  const chip = (on: boolean) =>
    `cursor-pointer rounded-xl border px-3 py-2.5 text-left transition-colors ${
      on ? (dark ? "border-white/40 bg-white/[0.08]" : "border-gray-900 bg-gray-900/[0.04]") : `${line} ${dark ? "hover:bg-white/[0.04]" : "hover:bg-gray-50"}`
    }`;
  const changed = glass !== 0 || density !== "cozy";

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-end justify-center p-3 sm:items-center sm:p-6" onClick={onClose}>
      <div className="palette-backdrop absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bfo-appearance-title"
        onClick={(e) => e.stopPropagation()}
        className={`palette-panel glass-panel relative w-full max-w-[460px] rounded-2xl border shadow-2xl ${text}`}
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className={`flex items-center justify-between gap-3 border-b px-5 py-3.5 ${line}`}>
          <div>
            <h2 id="bfo-appearance-title" className="text-[15px] font-semibold">
              Appearance
            </h2>
            <p className={`text-[12px] ${muted}`}>Changes apply as you make them, on this browser.</p>
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            aria-label="Close"
            className={`flex h-[36px] w-[36px] cursor-pointer items-center justify-center rounded-full ${dark ? "text-gray-300 hover:bg-white/10" : "text-gray-600 hover:bg-gray-100"}`}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="space-y-6 px-5 py-5">
          {/* Light or dark */}
          <section>
            <p className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${faint}`}>Theme</p>
            <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Theme">
              {(["light", "dark"] as const).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={theme === t} onClick={() => setTheme(t)} className={`${chip(theme === t)} flex items-center gap-3`}>
                  <span
                    aria-hidden="true"
                    className={`flex h-9 w-12 shrink-0 items-end gap-1 rounded-lg border p-1.5 ${t === "dark" ? "border-white/15 bg-[#0b0b10]" : "border-gray-200 bg-[#f9fafb]"}`}
                  >
                    <span className={`h-3 w-3 rounded-sm ${t === "dark" ? "bg-white/20" : "bg-gray-300"}`} />
                    <span className={`h-5 flex-1 rounded-sm ${t === "dark" ? "bg-white/10" : "bg-white shadow-sm"}`} />
                  </span>
                  <span>
                    <span className="block text-[13px] font-medium">{t === "dark" ? "Dark" : "Light"}</span>
                    <span className={`block text-[11.5px] ${muted}`}>{t === "dark" ? "Black, with the sky" : "Soft white"}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className={`mt-1.5 text-[11.5px] ${faint}`}>Mail keeps its own light or dark switch.</p>
          </section>

          {/* How solid the cards are */}
          <section>
            <div className="flex items-baseline justify-between">
              <label htmlFor="bfo-glass" className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${faint}`}>
                Glass cards
              </label>
              <span className={`text-[12px] tabular-nums ${muted}`}>{glass === 0 ? "Glass" : glass >= 95 ? "Solid" : `${glass}% solid`}</span>
            </div>
            {/* A card in the panel, so the change shows here as well as behind. */}
            <div className={`glass-card mt-2 rounded-xl border px-4 py-3 ${dark ? "text-gray-200" : "text-gray-800"}`}>
              <div className="flex items-center justify-between gap-3 text-[12.5px]">
                <span>Net position</span>
                <span className={`font-medium tabular-nums ${text}`}>$3,530,627</span>
              </div>
              <div className={`mt-1.5 h-1 rounded-full ${dark ? "bg-white/10" : "bg-gray-200"}`}>
                <div className="h-1 w-2/3 rounded-full bg-[#818cf8]" />
              </div>
            </div>
            <input
              id="bfo-glass"
              type="range"
              min={0}
              max={100}
              step={5}
              value={glass}
              onChange={(e) => setGlass(Number(e.target.value))}
              aria-valuetext={`${glass}% solid`}
              className="bfo-range mt-3 block w-full"
            />
            <div className={`mt-1 flex justify-between text-[11px] ${faint}`}>
              <span>See-through</span>
              <span>Solid</span>
            </div>
          </section>

          {/* How tall the rows are */}
          <section>
            <p className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${faint}`}>Rows</p>
            <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Row density">
              {DENSITIES.map((d) => (
                <button key={d.key} type="button" role="radio" aria-checked={density === d.key} onClick={() => setDensity(d.key as Density)} className={chip(density === d.key)}>
                  <span aria-hidden="true" className="flex h-[26px] flex-col justify-center" style={{ gap: d.key === "compact" ? 3 : d.key === "cozy" ? 5 : 8 }}>
                    {[0, 1, 2].map((i) => (
                      <span key={i} className={`h-[3px] rounded-full ${dark ? "bg-white/30" : "bg-gray-400"}`} style={{ width: ["80%", "60%", "70%"][i] }} />
                    ))}
                  </span>
                  <span className="mt-2 block text-[13px] font-medium">{d.label}</span>
                  <span className={`block text-[11.5px] ${muted}`}>{d.hint}</span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className={`flex items-center justify-between gap-3 border-t px-5 py-3 ${line}`}>
          <button
            type="button"
            onClick={reset}
            disabled={!changed}
            className={`cursor-pointer rounded-full px-3 py-1.5 text-[12.5px] transition-colors disabled:cursor-default disabled:opacity-40 ${dark ? "text-gray-300 hover:bg-white/10" : "text-gray-600 hover:bg-gray-100"}`}
          >
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={onClose}
            className={`cursor-pointer rounded-full px-4 py-1.5 text-[12.5px] font-medium ${dark ? "bg-white text-black hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-gray-700"}`}
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
