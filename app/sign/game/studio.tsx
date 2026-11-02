// The game studio, on the office's preview page: makes Judy's voice, the
// sound effects and the props on the server (api/game-assets.ts), where the
// API keys are, and shows what's there. Folded away until opened.
import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../../auth";
import type { JudyScript } from "./engine";

type ModelState = { taskId: string; status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED"; progress: number; error?: string | null; imageUrl?: string };
type Assets = { voice: Record<string, string>; sounds: Record<string, string>; models: Record<string, string>; judyVoice: { id: string; name: string } | null; props: Record<string, ModelState> };
type Studio = { assets: Assets; configured: { elevenlabs: boolean; openai: boolean; meshy: boolean }; props: string[] };

const PROP_LABEL: Record<string, string> = { seat: "Theater seat", plant: "Potted palm", popcorn: "Popcorn cart" };

export function GameStudio({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [studio, setStudio] = useState<Studio | null>(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const r = await authFetch("/api/game-assets?studio=1");
    const j = (await r.json().catch(() => null)) as (Studio & { message?: string }) | null;
    if (!r.ok || !j) throw new Error(j?.message || "Couldn't read the studio.");
    setStudio(j);
    return j;
  }, []);

  useEffect(() => {
    if (!open) return;
    load().catch((e) => setError(e instanceof Error ? e.message : "Couldn't read the studio."));
  }, [open, load]);

  async function post(body: Record<string, unknown>) {
    const r = await authFetch("/api/game-assets", { method: "POST", body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { assets?: Assets; remaining?: number; message?: string; error?: string };
    if (!r.ok) throw new Error(j.message || j.error || "That didn't work.");
    return j;
  }

  async function run(what: string, work: () => Promise<void>) {
    setBusy(what);
    setError("");
    setNote("");
    try {
      await work();
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy("");
    }
  }

  const voiceJudy = (redo: boolean) =>
    run("judy", async () => {
      const judy = (await fetch("/game/judy.json").then((r) => r.json())) as JudyScript;
      const lines = [judy.greeting, ...judy.rounds.flatMap((r) => [...r.options.map((o) => o.judy), r.core]), judy.final, ...Object.values(judy.extras ?? {})];
      let remaining = lines.length;
      let first = true;
      while (remaining > 0) {
        const j = await post({ action: "judy", lines, redo: redo && first });
        first = false;
        remaining = j.remaining ?? 0;
        setNote(`${lines.length - remaining} of ${lines.length} lines voiced${j.assets?.judyVoice ? ` by ${j.assets.judyVoice.name}` : ""}…`);
      }
      setNote("Judy has her voice.");
    });

  const makeSounds = (redo: boolean) =>
    run("sounds", async () => {
      let remaining = 1;
      let first = true;
      while (remaining > 0) {
        const j = await post({ action: "sounds", redo: redo && first });
        first = false;
        remaining = j.remaining ?? 0;
        setNote(`${Object.keys(j.assets?.sounds ?? {}).length} effects made…`);
      }
      setNote("The sound effects are in.");
    });

  const makeProp = (name: string) =>
    run(name, async () => {
      setNote(`Drawing the ${PROP_LABEL[name]?.toLowerCase() ?? name}…`);
      await post({ action: "prop", name });
      setNote("Meshy is building the model. This takes a few minutes; the status below updates.");
    });

  const checkProp = (name: string) => run(`check-${name}`, async () => void (await post({ action: "prop-status", name })));

  // Meshy's progress, while anything is building.
  useEffect(() => {
    if (!open || !studio) return;
    const building = Object.entries(studio.assets.props).filter(([, p]) => p.status === "PENDING" || p.status === "IN_PROGRESS");
    if (!building.length || busy) return;
    const t = setTimeout(() => {
      Promise.all(building.map(([name]) => post({ action: "prop-status", name })))
        .then(() => load())
        .then(() => onChanged())
        .catch(() => {});
    }, 12000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, studio, busy]);

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed left-4 top-14 z-[60] h-[32px] rounded-full border border-white/15 bg-black/70 px-3 text-[12px] text-white/80 backdrop-blur hover:bg-white/10 max-sm:bottom-4 max-sm:top-auto"
      >
        Game studio
      </button>
    );

  const a = studio?.assets;
  const voiced = Object.keys(a?.voice ?? {}).length;
  const sounds = Object.keys(a?.sounds ?? {}).length;
  const row = "flex items-center justify-between gap-3 py-2";
  const btn = "h-[32px] shrink-0 rounded-full border border-white/15 px-3 text-[12px] text-white/90 hover:bg-white/10 disabled:opacity-40";

  return (
    <div className="fixed left-4 top-14 z-[60] w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl max-sm:bottom-4 max-sm:top-auto border border-white/10 bg-[#0b0b0f]/95 p-4 text-[13px] text-white shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300">Game studio</p>
        <button type="button" onClick={() => setOpen(false)} className="text-[12px] text-white/50 hover:text-white">
          Close
        </button>
      </div>
      <p className="mt-1 text-[12px] text-white/55">Made on the server with the keys Vercel holds, stored in the brand bucket. The game picks them up on its next start.</p>
      {!studio && !error && <p className="mt-3 text-white/60">Loading…</p>}
      {studio && (
        <div className="mt-3 divide-y divide-white/10">
          <div className={row}>
            <div className="min-w-0">
              <p className="font-medium">Judy's voice</p>
              <p className="truncate text-[12px] text-white/55">
                {!studio.configured.elevenlabs ? "ELEVENLABS_API_KEY isn't set on Vercel." : voiced ? `${voiced} lines, voiced by ${a?.judyVoice?.name ?? "ElevenLabs"}.` : "Not voiced yet."}
              </p>
            </div>
            <div className="flex gap-1.5">
              <button type="button" disabled={!!busy || !studio.configured.elevenlabs} onClick={() => voiceJudy(false)} className={btn}>
                {busy === "judy" ? "Voicing…" : voiced ? "Finish" : "Voice Judy"}
              </button>
              {voiced > 0 && (
                <button type="button" disabled={!!busy} onClick={() => voiceJudy(true)} className={btn} title="Record every line again (after editing judy.json)">
                  Redo
                </button>
              )}
            </div>
          </div>
          <div className={row}>
            <div className="min-w-0">
              <p className="font-medium">Sound effects</p>
              <p className="truncate text-[12px] text-white/55">{!studio.configured.elevenlabs ? "ELEVENLABS_API_KEY isn't set on Vercel." : sounds ? `${sounds} of 6 made.` : "None yet."}</p>
            </div>
            <button type="button" disabled={!!busy || !studio.configured.elevenlabs} onClick={() => makeSounds(sounds >= 6)} className={btn}>
              {busy === "sounds" ? "Making…" : sounds >= 6 ? "Redo" : sounds ? "Finish" : "Make them"}
            </button>
          </div>
          {studio.props.map((name) => {
            const p = a?.props[name];
            const done = !!a?.models[name];
            const building = p && (p.status === "PENDING" || p.status === "IN_PROGRESS");
            return (
              <div key={name} className={row}>
                <div className="min-w-0">
                  <p className="font-medium">{PROP_LABEL[name] ?? name}</p>
                  <p className="truncate text-[12px] text-white/55">
                    {!studio.configured.openai || !studio.configured.meshy
                      ? `${!studio.configured.openai ? "OPENAI_API_KEY" : "MESHY_API_KEY"} isn't set on Vercel.`
                      : done
                        ? "Model in use."
                        : building
                          ? `Meshy: ${p.progress}%…`
                          : p?.status === "FAILED"
                            ? `Failed: ${p.error ?? "Meshy couldn't build it."}`
                            : "Blocky placeholder."}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {building && (
                    <button type="button" disabled={!!busy} onClick={() => checkProp(name)} className={btn}>
                      Check
                    </button>
                  )}
                  <button type="button" disabled={!!busy || !studio.configured.openai || !studio.configured.meshy || !!building} onClick={() => makeProp(name)} className={btn}>
                    {busy === name ? "Drawing…" : done ? "Redo" : "Make it"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {(note || error) && <p className={`mt-3 text-[12px] ${error ? "text-red-300" : "text-emerald-300"}`}>{error || note}</p>}
    </div>
  );
}
