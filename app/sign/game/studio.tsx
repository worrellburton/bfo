// The game studio, on the office's preview page: makes Judy's voice, the
// sound effects and the props on the server (api/game-assets.ts), where the
// API keys are, and shows what's there. Folded away until opened. A dark
// panel on the tokens, inside the safe area, above the game's covers.
import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../../auth";
import { Button } from "../../ui";
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
      <div data-theme="dark" className="ds fixed z-modal" style={{ left: "max(16px, env(safe-area-inset-left))", bottom: "max(16px, env(safe-area-inset-bottom))" }}>
        <Button size="sm" className="bg-overlay" onClick={() => setOpen(true)}>
          Game studio
        </Button>
      </div>
    );

  const a = studio?.assets;
  const voiced = Object.keys(a?.voice ?? {}).length;
  const sounds = Object.keys(a?.sounds ?? {}).length;
  const row = "flex items-center justify-between gap-3 py-2";

  return (
    <div
      data-theme="dark"
      className="ds fixed z-modal w-[360px] max-w-[calc(100vw-32px)] rounded-card border border-line-strong bg-overlay p-4 text-body text-ink shadow-(--elevation-2)"
      style={{ left: "max(16px, env(safe-area-inset-left))", bottom: "max(16px, env(safe-area-inset-bottom))" }}
    >
      <div className="flex items-center justify-between">
        <p className="text-section">Game studio</p>
        <Button variant="quiet" size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      <p className="mt-1 text-small text-ink-2">Made on the server with its own keys, and kept with the brand files. The game picks them up on its next start.</p>
      {!studio && !error && <p className="mt-3 text-small text-ink-2">Reading what’s there…</p>}
      {studio && (
        <div className="mt-3 divide-y divide-line">
          <div className={row}>
            <div className="min-w-0">
              <p className="font-medium">Judy’s voice</p>
              <p className="truncate text-small text-ink-2">
                {!studio.configured.elevenlabs
                  ? "The voice service isn’t set up on the server."
                  : voiced
                    ? `${voiced} lines, voiced by ${a?.judyVoice?.name ?? "the voice service"}.`
                    : "Not voiced yet."}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={!!busy || !studio.configured.elevenlabs} busy={busy === "judy"} busyLabel="Voicing…" onClick={() => voiceJudy(false)}>
                {voiced ? "Finish" : "Voice Judy"}
              </Button>
              {voiced > 0 && (
                <Button size="sm" disabled={!!busy} onClick={() => voiceJudy(true)} title="Record every line again (after editing judy.json)">
                  Redo
                </Button>
              )}
            </div>
          </div>
          <div className={row}>
            <div className="min-w-0">
              <p className="font-medium">Sound effects</p>
              <p className="truncate text-small text-ink-2">{!studio.configured.elevenlabs ? "The voice service isn’t set up on the server." : sounds ? `${sounds} of 6 made.` : "None yet."}</p>
            </div>
            <Button size="sm" disabled={!!busy || !studio.configured.elevenlabs} busy={busy === "sounds"} busyLabel="Making…" onClick={() => makeSounds(sounds >= 6)}>
              {sounds >= 6 ? "Redo" : sounds ? "Finish" : "Make them"}
            </Button>
          </div>
          {studio.props.map((name) => {
            const p = a?.props[name];
            const done = !!a?.models[name];
            const building = p && (p.status === "PENDING" || p.status === "IN_PROGRESS");
            return (
              <div key={name} className={row}>
                <div className="min-w-0">
                  <p className="font-medium">{PROP_LABEL[name] ?? name}</p>
                  <p className="truncate text-small text-ink-2">
                    {!studio.configured.openai || !studio.configured.meshy
                      ? "The model services aren’t set up on the server."
                      : done
                        ? "Model in use."
                        : building
                          ? `Building: ${p.progress}%`
                          : p?.status === "FAILED"
                            ? `Failed: ${p.error ?? "the model couldn’t be built."}`
                            : "Blocky placeholder."}
                  </p>
                </div>
                <div className="flex gap-2">
                  {building && (
                    <Button size="sm" disabled={!!busy} onClick={() => checkProp(name)}>
                      Check
                    </Button>
                  )}
                  <Button size="sm" disabled={!!busy || !studio.configured.openai || !studio.configured.meshy || !!building} busy={busy === name} busyLabel="Drawing…" onClick={() => makeProp(name)}>
                    {done ? "Redo" : "Make it"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {(note || error) && <p className={`mt-3 text-small ${error ? "text-negative" : "text-ink-2"}`}>{error || note}</p>}
    </div>
  );
}
