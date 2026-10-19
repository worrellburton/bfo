import { useEffect, useRef, useState } from "react";
import { brandCall, loadStudio, setLogoNow, type Logo, type ModelState, type SheetEntry, type Studio } from "./brand";
import { BTN_BASE, ghostBtn, primaryBtn, tiers } from "./books-shared";
import { Logo3D } from "./logo-3d";
import { loadBrandFont } from "./brand-lockup";

/**
 * The logo studio on Settings (owners and admins): OpenAI draws a reference
 * sheet of six "Burton Family Office / BFO" lockups, each in its own typeface.
 * "Use this logo" sets the site's logo in that typeface (live type, not the
 * picture); Meshy can still turn any of them into a 3D model to use instead.
 */
export function BrandStudio({ isDark }: { isDark: boolean }) {
  const { t1, t2, t3 } = tiers(isDark);
  const [studio, setStudio] = useState<Studio | null>(null);
  const [error, setError] = useState("");
  const [drawing, setDrawing] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState<Set<string>>(new Set());
  const [using, setUsing] = useState<string | null>(null);
  const [view, setView] = useState<Record<string, "picture" | "model">>({});
  const [tweak, setTweak] = useState<Record<string, string>>({});
  const [adjusting, setAdjusting] = useState<string | null>(null);

  useEffect(() => {
    loadStudio()
      .then((st) => {
        st.styles.forEach((s) => loadBrandFont(s.font));
        setStudio(st);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const mark = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string, on: boolean) =>
    set((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const patchModel = (id: string, model: ModelState | null) => setStudio((s) => (s ? { ...s, models: { ...s.models, [id]: model } } : s));
  const patchEntry = (id: string, entry: SheetEntry) => setStudio((s) => (s ? { ...s, sheet: { ...s.sheet, styles: { ...s.sheet.styles, [id]: entry } } } : s));

  async function draw(id: string) {
    if (drawing.has(id)) return;
    mark(setDrawing, id, true);
    setError("");
    try {
      const r = await brandCall<{ entry: SheetEntry }>("generate", { styleId: id, tweak: tweak[id] || undefined });
      patchEntry(id, r.entry);
      patchModel(id, null);
      setView((v) => ({ ...v, [id]: "picture" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      mark(setDrawing, id, false);
    }
  }

  async function drawAll() {
    if (!studio) return;
    await Promise.all(studio.styles.map((s) => draw(s.id)));
  }

  async function build(id: string) {
    if (starting.has(id)) return;
    mark(setStarting, id, true);
    setError("");
    try {
      const r = await brandCall<{ model: ModelState }>("model", { styleId: id });
      patchModel(id, r.model);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      mark(setStarting, id, false);
    }
  }

  async function use(id: string | null, as: "lockup" | "3d" = "lockup") {
    setUsing(id ?? "none");
    setError("");
    try {
      const r = await brandCall<{ logo: Logo | null }>("use", { styleId: id, as });
      setStudio((s) => (s ? { ...s, logo: r.logo } : s));
      setLogoNow(r.logo);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUsing(null);
    }
  }

  // Models under way at Meshy: ask every few seconds until they finish.
  const pending = studio ? Object.entries(studio.models).filter(([, m]) => m && (m.status === "PENDING" || m.status === "IN_PROGRESS")).map(([id]) => id) : [];
  const pendingKey = pending.join(",");
  const pollRef = useRef(pending);
  pollRef.current = pending;
  useEffect(() => {
    if (!pendingKey) return;
    let live = true;
    const tick = async () => {
      for (const id of pollRef.current) {
        try {
          const r = await brandCall<{ model: ModelState }>("model-status", { styleId: id });
          if (!live) return;
          patchModel(id, r.model);
          if (r.model.status === "SUCCEEDED") setView((v) => ({ ...v, [id]: "model" }));
        } catch (e) {
          if (live) setError((e as Error).message);
        }
      }
    };
    const timer = window.setInterval(() => void tick(), 7000);
    void tick();
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [pendingKey]);

  const card = `rounded-xl border p-6 ${isDark ? "border-white/10 bg-white/[0.02] glass-card" : "border-gray-200 bg-white"}`;
  const btn = `${BTN_BASE} h-[40px] sm:h-8 px-3 text-xs`;
  const anyDrawing = drawing.size > 0;
  const hasAny = !!studio && Object.keys(studio.sheet.styles).length > 0;

  return (
    <section className={`${card} mt-6`}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${isDark ? "bg-indigo-500/10" : "bg-indigo-50"}`}>
            <svg className={`h-5 w-5 ${isDark ? "text-indigo-400" : "text-indigo-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
            </svg>
          </div>
          <div>
            <h2 className={`text-sm font-semibold ${t1}`}>Logo</h2>
            <p className={`text-xs ${t2}`}>A reference sheet: six "Burton Family Office / BFO" lockups drawn by OpenAI, each in its own typeface. Use one and the site sets its logo in that type.</p>
          </div>
        </div>
        {studio && (
          <div className="flex items-center gap-2">
            {studio.logo && (
              <button type="button" onClick={() => void use(null)} disabled={using !== null} className={`${btn} ${ghostBtn(isDark)}`}>
                {using === "none" ? "Switching…" : "Back to the wordmark"}
              </button>
            )}
            <button type="button" onClick={() => void drawAll()} disabled={anyDrawing || !studio.configured.openai} className={`${btn} ${primaryBtn(isDark)}`}>
              {anyDrawing ? `Drawing ${drawing.size}…` : hasAny ? "Redraw all six" : "Draw the style sheet"}
            </button>
          </div>
        )}
      </div>

      {!studio && !error && <p className={`text-xs ${t2}`}>Loading…</p>}
      {studio && !studio.configured.openai && (
        <p className={`mb-4 rounded-lg border px-3 py-2 text-xs ${isDark ? "border-amber-400/30 bg-amber-400/5 text-amber-200" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
          Add OPENAI_API_KEY in Vercel to draw the lockups.
        </p>
      )}
      {error && (
        <p role="alert" className={`mb-4 text-xs ${isDark ? "text-red-300" : "text-red-600"}`}>
          {error}
        </p>
      )}

      {studio && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {studio.styles.map((s) => {
            const entry = studio.sheet.styles[s.id];
            const model = studio.models[s.id];
            const inUse = studio.logo?.styleId === s.id;
            const inUse3D = inUse && !!studio.logo?.glbUrl && studio.logo.kind !== "lockup";
            const isDrawing = drawing.has(s.id);
            const building = !!model && (model.status === "PENDING" || model.status === "IN_PROGRESS");
            const built = model?.status === "SUCCEEDED" && !!model.glbUrl;
            const showModel = built && (view[s.id] ?? "picture") === "model";
            return (
              <div key={s.id} className={`overflow-hidden rounded-xl border ${inUse ? "ring-2 ring-indigo-500 ring-offset-2 " + (isDark ? "ring-offset-black border-transparent" : "ring-offset-white border-transparent") : isDark ? "border-white/10" : "border-gray-200"}`}>
                <div className={`relative aspect-square ${isDark ? "bg-white/[0.03]" : "bg-gray-50"}`}>
                  {showModel && model?.glbUrl ? (
                    <Logo3D src={model.glbUrl} poster={model.posterUrl} className="h-full w-full" interactive />
                  ) : entry ? (
                    <img src={entry.imageUrl} alt={`${s.name} logo`} className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <div className={`flex h-full w-full items-center justify-center text-[12px] ${t3}`}>{isDrawing ? "" : "Not drawn yet"}</div>
                  )}
                  {isDrawing && (
                    <div className={`absolute inset-0 flex items-center justify-center backdrop-blur-sm ${isDark ? "bg-black/40" : "bg-white/60"}`}>
                      <span className={`inline-flex items-center gap-2 text-xs font-medium ${t1}`}>
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Drawing…
                      </span>
                    </div>
                  )}
                  {building && model && (
                    <div className={`absolute inset-x-0 bottom-0 px-3 py-2 text-[11px] ${isDark ? "bg-black/55 text-gray-200" : "bg-white/80 text-gray-700"}`}>
                      <div className="mb-1 flex justify-between">
                        <span>Meshy is building the model</span>
                        <span className="tabular-nums">{model.progress}%</span>
                      </div>
                      <div className={`h-1 overflow-hidden rounded-full ${isDark ? "bg-white/10" : "bg-gray-200"}`}>
                        <div className="h-full rounded-full bg-indigo-500 transition-[width]" style={{ width: `${Math.max(3, model.progress)}%` }} />
                      </div>
                    </div>
                  )}
                  {inUse && <span className="absolute left-2 top-2 rounded-full bg-indigo-500 px-2 py-0.5 text-[10px] font-semibold text-white">{inUse3D ? "On the site · 3D" : "On the site"}</span>}
                  {built && (
                    <div className={`absolute right-2 top-2 inline-flex rounded-full p-0.5 text-[10px] ${isDark ? "bg-black/55" : "bg-white/85 shadow-sm"}`}>
                      {(["picture", "model"] as const).map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setView((v) => ({ ...v, [s.id]: k }))}
                          className={`cursor-pointer rounded-full px-2 py-0.5 font-medium ${(view[s.id] ?? "picture") === k ? (isDark ? "bg-white/15 text-white" : "bg-gray-900 text-white") : t2}`}
                        >
                          {k === "picture" ? "Picture" : "3D"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className={`px-3.5 py-3 ${isDark ? "bg-white/[0.02]" : "bg-white"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className={`text-xs font-semibold ${t1}`}>{s.name}</div>
                      <div className={`text-[11px] ${t2}`}>{s.blurb}</div>
                      <div className={`mt-1.5 truncate text-[15px] leading-tight ${t1}`} style={{ fontFamily: `"${s.font.family}", Georgia, serif`, fontWeight: s.font.weight }} title={`Typeface: ${s.font.family}`}>
                        {s.font.family} <span className={t3}>· Burton Family Office</span>
                      </div>
                    </div>
                    <button type="button" onClick={() => setAdjusting(adjusting === s.id ? null : s.id)} className={`shrink-0 cursor-pointer text-[11px] font-medium ${isDark ? "text-indigo-300 hover:underline" : "text-indigo-600 hover:underline"}`}>
                      {adjusting === s.id ? "Done" : "Adjust"}
                    </button>
                  </div>
                  {adjusting === s.id && (
                    <textarea
                      rows={2}
                      value={tweak[s.id] ?? ""}
                      onChange={(e) => setTweak((t) => ({ ...t, [s.id]: e.target.value }))}
                      placeholder="e.g. warmer gold, thinner letters, more rounded"
                      className={`mt-2 w-full resize-none rounded-lg border px-2.5 py-1.5 text-[12px] outline-none ${isDark ? "border-white/10 bg-white/[0.04] text-gray-100 placeholder:text-gray-600" : "border-gray-200 bg-white text-gray-900 placeholder:text-gray-400"}`}
                    />
                  )}
                  {model?.status === "FAILED" && <p className={`mt-1.5 text-[11px] ${isDark ? "text-red-300" : "text-red-600"}`}>{model.error ?? "Meshy couldn't build this one."}</p>}
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => void draw(s.id)} disabled={isDrawing || !studio.configured.openai} className={`${btn} ${ghostBtn(isDark)}`}>
                      {entry ? "Redraw" : "Draw"}
                    </button>
                    {entry && (!inUse || inUse3D) && (
                      <button type="button" onClick={() => void use(s.id)} disabled={using !== null} className={`${btn} ${primaryBtn(isDark)}`}>
                        {using === s.id ? "Switching…" : "Use this logo"}
                      </button>
                    )}
                    {entry && !built && (
                      <button type="button" onClick={() => void build(s.id)} disabled={building || starting.has(s.id) || !studio.configured.meshy} title={studio.configured.meshy ? undefined : "Add MESHY_API_KEY in Vercel to build 3D models."} className={`${btn} ${ghostBtn(isDark)}`}>
                        {building ? "Building…" : starting.has(s.id) ? "Starting…" : model?.status === "FAILED" ? "Try 3D again" : "Make it 3D"}
                      </button>
                    )}
                    {built && (
                      <button type="button" onClick={() => void build(s.id)} disabled={starting.has(s.id) || !studio.configured.meshy} className={`${btn} ${ghostBtn(isDark)}`} title="Build a fresh model from the same picture">
                        Rebuild
                      </button>
                    )}
                    {built && !inUse3D && (
                      <button type="button" onClick={() => void use(s.id, "3d")} disabled={using !== null} className={`${btn} ${ghostBtn(isDark)}`}>
                        {using === s.id ? "Switching…" : "Use in 3D"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className={`mt-4 text-[11px] ${t3}`}>
        Drawing takes about a minute per lockup; Meshy takes a few minutes per model. The site sets the chosen logo as live type in its Google font; pictures and models are kept in the brand bucket, so the site never depends on OpenAI or Meshy being up.
      </p>
    </section>
  );
}
