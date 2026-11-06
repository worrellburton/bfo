import { useEffect, useRef, useState } from "react";
import { brandCall, loadStudio, setLogoNow, type Logo, type ModelState, type SheetEntry, type Studio } from "./brand";
import { Logo3D } from "./logo-3d";
import { loadBrandFont } from "./brand-lockup";
import { Badge, Banner, Button, Card, Dialog, Field, IconButton, Menu, Segmented, Skeleton, Spinner, Textarea, confirm, cx, format, toast, type MenuItem } from "./ui";

/**
 * The logo studio on Settings (principals and admins). Six ways to set the
 * office's name, each in its own typeface: before anything is drawn each
 * shows as live type; "Draw all six" has a picture drawn of each (a paid
 * call, priced and confirmed first). "Use this" sets the logo across BFO in
 * that typeface; a picture can also become a 3D model for the front door.
 * Every change and every paid call is recorded by api/brand.ts, and the last
 * change shows at the foot of the card.
 */

type StudioMore = Studio & {
  /** About what one drawing and one 3D model cost, in cents (api/brand.ts); absent from an older server. */
  costCents?: { draw: number; model: number };
  lastChange?: { at: string; by: string | null; summary: string } | null;
};

/** What a person is told when a call fails: plain, no provider names. */
function plain(e: unknown): string {
  const msg = e instanceof Error ? e.message : "";
  return /fetch|network/i.test(msg) || !msg || /openai|meshy|api|key|5\d\d/i.test(msg) ? "That didn’t go through. Try again in a moment." : msg;
}

const about = (cents: number) => `about ${format.money(cents / 100)}`;

export function BrandStudio() {
  const [studio, setStudio] = useState<StudioMore | null>(null);
  const [error, setError] = useState("");
  const [drawing, setDrawing] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState<Set<string>>(new Set());
  const [using, setUsing] = useState<string | null>(null);
  const [view, setView] = useState<Record<string, "picture" | "model">>({});
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    loadStudio()
      .then((st) => {
        st.styles.forEach((s) => loadBrandFont(s.font));
        setStudio(st as StudioMore);
      })
      .catch((e) => setError(plain(e)));
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
  const cost = studio?.costCents;

  async function draw(id: string, tweak?: string) {
    if (drawing.has(id)) return;
    mark(setDrawing, id, true);
    setError("");
    try {
      const r = await brandCall<{ entry: SheetEntry }>("generate", { styleId: id, tweak: tweak || undefined });
      patchEntry(id, r.entry);
      patchModel(id, null);
      setView((v) => ({ ...v, [id]: "picture" }));
    } catch (e) {
      setError(plain(e));
    } finally {
      mark(setDrawing, id, false);
    }
  }

  async function drawAll() {
    if (!studio) return;
    const n = studio.styles.length;
    const ok = await confirm({
      title: `Draw all ${n} logos?`,
      message: "Each one is drawn as a picture, in its own typeface. It takes about a minute, and the pictures replace any drawn before.",
      receipt: cost ? { lines: [{ label: `${n} drawings`, cents: n * cost.draw, estimate: true }], mode: "live" } : undefined,
      confirmLabel: cost ? `Draw for ${about(n * cost.draw)}` : `Draw all ${n}`,
      tone: "commit",
    });
    if (!ok) return;
    await Promise.all(studio.styles.map((s) => draw(s.id)));
  }

  async function redraw(id: string, name: string, tweak?: string) {
    const ok = await confirm({
      title: `Redraw ${name}?`,
      message: tweak ? `Drawn again with your note: “${tweak}”. The new picture replaces this one.` : "The new picture replaces this one.",
      receipt: cost ? { lines: [{ label: "1 drawing", cents: cost.draw, estimate: true }], mode: "live" } : undefined,
      confirmLabel: cost ? `Redraw for ${about(cost.draw)}` : "Redraw",
      tone: "commit",
    });
    if (ok) await draw(id, tweak);
  }

  async function build(id: string, name: string) {
    if (starting.has(id)) return;
    const ok = await confirm({
      title: `Make ${name} in 3D?`,
      message: "The picture becomes a 3D model the front door can show. It takes a few minutes; you can leave this page.",
      receipt: cost ? { lines: [{ label: "1 model", cents: cost.model, estimate: true }], mode: "live" } : undefined,
      confirmLabel: cost ? `Make it for ${about(cost.model)}` : "Make it 3D",
      tone: "commit",
    });
    if (!ok) return;
    mark(setStarting, id, true);
    setError("");
    try {
      const r = await brandCall<{ model: ModelState }>("model", { styleId: id });
      patchModel(id, r.model);
    } catch (e) {
      setError(plain(e));
    } finally {
      mark(setStarting, id, false);
    }
  }

  async function applyLogo(id: string | null, as: "lockup" | "3d" = "lockup", name?: string) {
    setUsing(id ?? "none");
    setError("");
    try {
      const r = await brandCall<{ logo: Logo | null }>("use", { styleId: id, as });
      setStudio((s) => (s ? { ...s, logo: r.logo } : s));
      setLogoNow(r.logo);
      toast({ message: id ? `The logo is now ${name ?? "this style"}${as === "3d" ? " in 3D" : ""}` : "The logo is back to the wordmark" });
    } catch (e) {
      setError(plain(e));
    } finally {
      setUsing(null);
    }
  }

  // Models under way: ask every few seconds until they finish.
  const pending = studio
    ? Object.entries(studio.models)
        .filter(([, m]) => m && (m.status === "PENDING" || m.status === "IN_PROGRESS"))
        .map(([id]) => id)
    : [];
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
          if (live) setError(plain(e));
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

  const anyDrawing = drawing.size > 0;
  const hasAny = !!studio && Object.keys(studio.sheet.styles).length > 0;
  const ready = !!studio?.configured.openai;
  const noteStyle = studio?.styles.find((s) => s.id === noteFor);

  const header = studio && ready && (
    <Button variant={hasAny ? "secondary" : "primary"} size="sm" onClick={() => void drawAll()} disabled={anyDrawing} busy={anyDrawing} busyLabel="Drawing…">
      {hasAny ? "Redraw all" : "Draw all six"}
    </Button>
  );

  return (
    <Card
      title="Logo"
      action={header || undefined}
      menu={studio?.logo ? [{ label: "Go back to the wordmark", onSelect: () => void applyLogo(null) }] : undefined}
      footer={
        <div className="flex w-full flex-col gap-1 text-small text-ink-2">
          <p>
            Each picture takes about a minute to draw{cost ? `, ${about(cost.draw)} each` : ""}. Pictures drawn by AI can’t be copyrighted; the logo BFO uses is set in type. Clear any new mark before
            using it outside BFO.
          </p>
          {studio?.lastChange && (
            <p>
              {studio.lastChange.summary}
              {studio.lastChange.by ? `, by ${studio.lastChange.by}` : ""}, {format.date(studio.lastChange.at, "medium")}.
            </p>
          )}
        </div>
      }
    >
      <p className="max-w-[68ch] text-body text-ink-2">Six ways to set the name. Pick one and it becomes the logo across BFO.</p>

      {!studio && !error && (
        <div className="mt-4">
          <Skeleton kind="card" />
        </div>
      )}
      {studio && !ready && (
        <Banner tone="info" className="mt-4">
          Drawing isn’t set up yet. You can still use any style as live type once it has a picture.
        </Banner>
      )}
      {error && (
        <Banner tone="negative" className="mt-4" onDismiss={() => setError("")}>
          {error}
        </Banner>
      )}

      {studio && (
        <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {studio.styles.map((s) => {
            const entry = studio.sheet.styles[s.id];
            const model = studio.models[s.id];
            const inUse = studio.logo?.styleId === s.id;
            const inUse3D = inUse && !!studio.logo?.glbUrl && studio.logo.kind !== "lockup";
            const isDrawing = drawing.has(s.id);
            const building = !!model && (model.status === "PENDING" || model.status === "IN_PROGRESS");
            const built = model?.status === "SUCCEEDED" && !!model.glbUrl;
            const showModel = built && (view[s.id] ?? "picture") === "model";
            const font = { fontFamily: `"${s.font.family}", Georgia, serif`, fontWeight: s.font.weight };
            const more: MenuItem[] = entry
              ? [
                  { label: "Redraw", hint: cost ? about(cost.draw) : undefined, onSelect: () => void redraw(s.id, s.name), disabled: !ready || isDrawing },
                  {
                    label: "Redraw with a note…",
                    onSelect: () => {
                      setNote("");
                      setNoteFor(s.id);
                    },
                    disabled: !ready || isDrawing,
                  },
                  { divider: true },
                  ...(!built
                    ? [
                        {
                          label: model?.status === "FAILED" ? "Try 3D again" : "Make it 3D",
                          hint: cost ? about(cost.model) : undefined,
                          onSelect: () => void build(s.id, s.name),
                          disabled: building || starting.has(s.id) || !studio.configured.meshy,
                          disabledReason: studio.configured.meshy ? undefined : "3D isn’t set up yet",
                        },
                      ]
                    : [
                        ...(!inUse3D ? [{ label: "Use in 3D on the front door", onSelect: () => void applyLogo(s.id, "3d", s.name), disabled: using !== null }] : []),
                        {
                          label: "Make the 3D model again",
                          hint: cost ? about(cost.model) : undefined,
                          onSelect: () => void build(s.id, s.name),
                          disabled: starting.has(s.id) || !studio.configured.meshy,
                        },
                      ]),
                ]
              : [];
            return (
              <li key={s.id} className={cx("flex flex-col overflow-hidden rounded-card border bg-raised", inUse ? "border-accent ring-1 ring-accent" : "border-line")}>
                <div className="relative aspect-[3/2] bg-sunken">
                  {showModel && model?.glbUrl ? (
                    <Logo3D src={model.glbUrl} poster={model.posterUrl} className="h-full w-full" interactive />
                  ) : entry ? (
                    <img src={entry.imageUrl} alt={`The ${s.name} logo, as drawn`} className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    // Before anything is drawn: the real thing, set live in the typeface.
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-ink" style={font} aria-label={`${s.name}: BFO set in ${s.font.family}`} role="img">
                      <span className="text-display leading-none tracking-[0.06em]" style={font}>
                        BFO
                      </span>
                      <span className="text-caption tracking-[0.2em]" style={font}>
                        Burton Family Office
                      </span>
                    </div>
                  )}
                  {isDrawing && (
                    <div className="absolute inset-0 flex items-center justify-center bg-sunken">
                      <span className="inline-flex items-center gap-2 text-small font-medium text-ink" role="status">
                        <Spinner />
                        Drawing…
                      </span>
                    </div>
                  )}
                  {inUse && (
                    <span className="absolute top-3 left-3">
                      <Badge icon="check">{inUse3D ? "In use, 3D" : "In use"}</Badge>
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div className="min-w-0">
                    <h3 className="text-small font-medium text-ink">{s.name}</h3>
                    <p className="mt-1 text-caption text-ink-2">{s.blurb}</p>
                    <p className="mt-2 truncate text-title font-normal text-ink" style={font} title={`Typeface: ${s.font.family}`}>
                      {s.font.family}
                    </p>
                  </div>
                  {built && (
                    <Segmented
                      label={`Show ${s.name} as`}
                      value={view[s.id] ?? "picture"}
                      onChange={(v) => setView((cur) => ({ ...cur, [s.id]: v }))}
                      options={[
                        { value: "picture", label: "Picture" },
                        { value: "model", label: "3D" },
                      ]}
                    />
                  )}
                  {building && model && (
                    <div role="status">
                      <div className="flex justify-between text-small text-ink-2">
                        <span>Making the 3D model</span>
                        <span className="tabular-nums">{format.percent(model.progress, { decimals: 0 })}</span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-sunken">
                        <div className="h-full rounded-full bg-accent transition-[width] duration-(--dur-3)" style={{ width: `${Math.max(3, model.progress)}%` }} />
                      </div>
                    </div>
                  )}
                  {model?.status === "FAILED" && <p className="text-small text-negative">The 3D model didn’t work out. Try again from the menu.</p>}
                  {entry && (
                    <div className="mt-auto flex items-center gap-2">
                      {(!inUse || inUse3D) && (
                        <Button variant="primary" size="sm" onClick={() => void applyLogo(s.id, "lockup", s.name)} disabled={using !== null} busy={using === s.id} busyLabel="Switching…">
                          Use this
                        </Button>
                      )}
                      <Menu label={`More for ${s.name}`} align="end" items={more} trigger={<IconButton icon="more" label={`More for ${s.name}`} className="ml-auto" />} />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={!!noteFor}
        onClose={() => setNoteFor(null)}
        title={`Redraw ${noteStyle?.name ?? ""} with a note`}
        dirty={!!note.trim()}
        footer={
          <>
            <Button onClick={() => setNoteFor(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!note.trim()}
              onClick={() => {
                const id = noteFor;
                setNoteFor(null);
                if (id && noteStyle) void redraw(id, noteStyle.name, note.trim());
              }}
            >
              Redraw with this note
            </Button>
          </>
        }
      >
        <Field label="What to change" hint="For example: warmer gold, thinner letters, more rounded.">
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </Field>
      </Dialog>
    </Card>
  );
}
