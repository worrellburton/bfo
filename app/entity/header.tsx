import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { formingNow } from "../entity-addresses";
import { useEntity } from "./context";
import { WITH_FORMATION } from "./derive";
import { fmtDate, fmtStamp, splitNames } from "./model";
import { Button, Count, Dot, Icon, IconButton, toneText, useTone } from "./ui";
import { getUser, isAdmin, isPartner } from "../auth";
import { dollars } from "../../lib/palm-pricing";

/** The entity card: who it is, the facts people copy most, and how complete its record is. */
export function EntityHeader() {
  const { page, view, asset, tabPath, goToTab } = useEntity();
  const t = useTone();
  const { etype, isTrust, glyph, score } = view;
  // What's left, as To do counts it (a formation's own papers aren't left to do while it's under way).
  const toDo = view.missing.filter((i) => !(formingNow(asset) && WITH_FORMATION.has(i.key))).length;
  const owner = asset.ownerId ? page.assetNames[asset.ownerId] : undefined;
  const formed = fmtDate(asset.formationDate);
  const trustees = splitNames(asset.trustees);

  const meta = [etype, asset.state || "No state", asset.llcType].filter(Boolean) as string[];
  // Palm connected, an entity it serves (not a trust), and someone who can change the record.
  const canSyncPalm = !!page.palmMode && !isTrust && ["owner", "admin", "member"].includes(getUser()?.role ?? "");

  return (
    <section className={`overflow-hidden rounded-2xl border ${t.surface}`}>
      <div className="px-5 pb-4 pt-4 sm:px-6 sm:pt-5">
        <nav aria-label="Breadcrumb">
          <Link to="/assets" className={`inline-flex items-center gap-1 text-[12px] transition-colors max-sm:min-h-[40px] ${t.muted} ${t.dark ? "hover:text-white" : "hover:text-gray-900"}`}>
            <Icon name="chevronLeft" className="h-3 w-3" strokeWidth={2.25} />
            Entities
          </Link>
        </nav>
        <div className="mt-3 flex flex-wrap items-start gap-3.5">
          <div
            aria-hidden="true"
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-mono text-[10px] font-semibold tracking-[0.06em] ${
              t.dark ? "bg-white/[0.06] text-gray-300" : "bg-gray-100 text-gray-600"
            }`}
          >
            {glyph}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className={`break-words text-[20px] font-semibold leading-tight tracking-[-0.02em] sm:text-[24px] ${t.text}`}>{asset.name}</h1>
            {/* Each item keeps its separator, so a wrapped line never starts with "·". */}
            <p className={`mt-1 text-[12.5px] leading-relaxed ${t.muted}`}>
              {meta.map((m, i) => (
                <span key={i} className="whitespace-nowrap">
                  {m}
                  {(i < meta.length - 1 || owner) && <span aria-hidden="true" className="mx-1.5">·</span>}
                </span>
              ))}{" "}
              {owner && (
                <span className="whitespace-nowrap">
                  Owned by{" "}
                  <Link
                    to={`/assets/${asset.ownerId}`}
                    className={`relative hover:underline max-sm:after:absolute max-sm:after:-inset-y-3 max-sm:after:inset-x-0 max-sm:after:content-[''] ${t.soft}`}
                  >
                    {owner}
                  </Link>
                </span>
              )}{" "}
              {(() => {
                // One status: dissolved, being closed, or what the record says (Forming, Active…).
                const closing = asset.closing && !asset.closing.closedAt;
                const label = asset.status === "Dissolved" ? "Dissolved" : closing ? "Closing" : asset.status;
                if (!label) return null;
                const tone = label === "Active" ? "good" : label === "Dissolved" ? "muted" : label === "Closing" ? "bad" : "warn";
                return (
                  <Dot tone={tone} className="ml-1 align-middle">
                    {label}
                  </Dot>
                );
              })()}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1 max-sm:w-full max-sm:justify-end">
            {canSyncPalm && <PalmSyncButton />}
            {/* A quiet confirmation once the edit form saves; it clears itself after a few seconds. */}
            {page.savedAt && !page.editing && (
              <span role="status" className={`mr-1 inline-flex items-center gap-1 text-[12px] font-medium ${toneText("good", t.dark)}`}>
                <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2} />
                Saved
              </span>
            )}
            {!isPartner() && <Button icon="edit" onClick={() => (page.editing ? void page.cancelEditing() : page.startEditing())} aria-expanded={page.editing} aria-label={page.editing ? "Cancel editing" : "Edit"}>
              <span className="max-sm:hidden">{page.editing ? "Cancel" : "Edit"}</span>
            </Button>}
            {!isPartner() && <MoreMenu />}
          </div>
        </div>
      </div>

      {canSyncPalm && page.palmSync && <PalmSyncResults />}

      <div className={`grid grid-cols-2 border-t sm:grid-cols-3 ${t.line}`}>
        {isTrust && !asset.ein ? (
          <Metric label="Trustees" value={trustees.length ? trustees[0] : "None on record"} sub={trustees.length > 1 ? `+${trustees.length - 1}` : undefined} />
        ) : (
          <CopyMetric id="ein" label="EIN" value={asset.ein} mono badge={einBadge(asset, page.palmMode)} />
        )}
        <CopyMetric
          id="formed"
          label={isTrust ? "Trust date" : etype === "C-Corp" ? "Incorporated" : etype === "LP" ? "Formed" : "Formation date"}
          value={formed}
        />
        {/* One measure of the record: the ring, and how many things are left (the To do card lists them, so this goes there). */}
        <Link
          to={tabPath("overview")}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            goToTab("overview", "todo");
          }}
          className={`col-span-2 block transition-colors sm:col-span-1 ${t.hover}`}
        >
          <div className="flex min-w-0 items-center gap-3 px-5 py-3 sm:px-6">
            <ScoreRing score={score} />
            <div className="min-w-0">
              <p className={`text-[11.5px] ${t.muted}`}>Record</p>
              <p className={`mt-0.5 truncate text-[15px] font-medium ${t.text}`}>
                {toDo ? `${toDo} to do` : "Complete"}
              </p>
            </div>
          </div>
        </Link>
      </div>
    </section>
  );
}

/**
 * "Sync everything with Palm", with what it should cost: the state records
 * Palm bills for (live key), free in test mode. Asks before spending.
 */
function PalmSyncButton() {
  const { page, asset } = useEntity();
  const t = useTone();
  const running = !!page.palmSync?.running;
  const { cents } = page.palmSyncPlan();
  const mode = page.palmMode;
  const last = mode ? asset.palm?.[mode]?.syncedAt : undefined;
  const cost = mode === "test" ? "free in test mode" : cents ? `est. ${dollars(cents)}` : "free";
  return (
    <Button
      icon="refresh"
      onClick={() => void page.syncWithPalm()}
      disabled={running || !!page.palmBusy}
      aria-label={`Sync everything with Palm, ${cost}`}
      title={last ? `Last synced ${fmtStamp(last)}` : "Read everything Palm and the state have on this entity"}
      className={running ? "[&>svg]:animate-spin" : ""}
    >
      <span className="max-sm:hidden">{running ? "Syncing with Palm…" : "Sync everything with Palm"}</span>
      <span className={`tabular-nums ${t.muted}`}>{cost}</span>
    </Button>
  );
}

/** What the sync found, a line per step; it fills in as the sync runs. */
function PalmSyncResults() {
  const { page } = useEntity();
  const t = useTone();
  const sync = page.palmSync!;
  return (
    <div className={`border-t px-5 py-3 sm:px-6 ${t.line}`} aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <p className={`text-[12px] font-medium ${t.soft}`}>
          {sync.running ? `Syncing with Palm · ${sync.step}…` : `Synced with Palm${sync.mode === "test" ? " (test mode)" : ""}`}
          {!sync.running && sync.cents > 0 && <span className={`font-normal ${t.muted}`}> · state records about {dollars(sync.cents)}</span>}
        </p>
        {!sync.running && <IconButton icon="x" label="Close" onClick={() => page.setPalmSync(null)} />}
      </div>
      <ul className="mt-1.5 space-y-1">
        {sync.lines.map((l, i) => (
          <li key={i} className={`flex items-start gap-2 text-[12.5px] leading-snug ${t.text}`}>
            <span
              aria-hidden="true"
              className={`mt-[0.45em] h-1.5 w-1.5 shrink-0 rounded-full ${l.tone === "good" ? "bg-emerald-400" : l.tone === "warn" ? "bg-amber-400" : l.tone === "bad" ? "bg-red-400" : t.dark ? "bg-gray-600" : "bg-gray-300"}`}
            />
            <span className="min-w-0">
              <span className="font-medium">{l.label}</span>
              <span className={l.tone === "bad" ? toneText("bad", t.dark) : t.muted}> · {l.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The record's completeness as a ring: emerald when complete, indigo most of the way, amber below. */
function ScoreRing({ score }: { score: number }) {
  const t = useTone();
  const r = 15;
  const c = 2 * Math.PI * r;
  const color = score >= 90 ? "#34d399" : score >= 60 ? "#818cf8" : "#fbbf24";
  return (
    <span className="relative inline-grid h-[38px] w-[38px] shrink-0 place-items-center" aria-label={`${score} of 100`}>
      <svg viewBox="0 0 38 38" className="absolute inset-0 -rotate-90">
        <circle cx="19" cy="19" r={r} fill="none" strokeWidth="3" className={t.dark ? "stroke-white/[0.08]" : "stroke-gray-200"} />
        <circle cx="19" cy="19" r={r} fill="none" strokeWidth="3" strokeLinecap="round" stroke={color} strokeDasharray={`${(c * score) / 100} ${c}`} style={{ transition: "stroke-dasharray 600ms ease" }} />
      </svg>
      <span className={`text-[11px] font-semibold tabular-nums ${t.text}`}>{score}</span>
    </span>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const t = useTone();
  return (
    <div className="min-w-0 px-5 py-3 sm:px-6">
      <p className={`text-[11.5px] ${t.muted}`}>{label}</p>
      <p className={`mt-0.5 truncate text-[15px] font-medium tabular-nums ${t.text}`}>
        {value}
        {sub && <span className={`ml-1.5 text-[11px] font-normal ${t.muted}`}>{sub}</span>}
      </p>
    </div>
  );
}

/** A fact you can click to copy. */
/** What the IRS said about this EIN (through Palm), when it was asked about this EIN in this mode. */
function einBadge(asset: { ein?: string; einCheck?: { ein: string; matched: boolean | null; mode: string } }, mode: string | null): { tone: "good" | "bad"; text: string } | undefined {
  const c = asset.einCheck;
  if (!c || c.mode !== mode || c.ein.replace(/\D/g, "") !== (asset.ein ?? "").replace(/\D/g, "")) return undefined;
  if (c.matched === true) return { tone: "good", text: "IRS ✓" };
  if (c.matched === false) return { tone: "bad", text: "IRS mismatch" };
  return undefined;
}

function CopyMetric({ id, label, value, mono = false, badge }: { id: string; label: string; value?: string; mono?: boolean; badge?: { tone: "good" | "bad"; text: string } }) {
  const { page } = useEntity();
  const t = useTone();
  if (!value) return <Metric label={label} value="—" />;
  const done = page.copied === id;
  return (
    <button
      type="button"
      onClick={() => page.copyValue(id, value)}
      title={label === "EIN" ? "Copy EIN" : `Copy ${label.toLowerCase()}`}
      aria-label={`${label} ${value}. Copy`}
      className={`group/copy block min-w-0 cursor-pointer px-5 py-3 text-left transition-colors sm:px-6 ${t.hover}`}
    >
      <span className={`flex items-center gap-1.5 text-[11.5px] ${t.muted}`}>
        {label}
        {badge && (
          <span title={badge.tone === "good" ? "The IRS has this EIN under this legal name" : "The IRS doesn't match this EIN to this legal name (Compliance tab)"} className={`font-medium ${toneText(badge.tone, t.dark)}`}>
            {badge.text}
          </span>
        )}
        <span aria-live="polite" className={`inline-flex items-center gap-1 ${done ? (t.dark ? "text-emerald-400" : "text-emerald-600") : "opacity-60 sm:opacity-0 sm:group-hover/copy:opacity-100 sm:group-focus-visible/copy:opacity-100"}`}>
          <Icon name={done ? "check" : "copy"} className="h-3 w-3" strokeWidth={2} />
          {done ? "Copied" : ""}
        </span>
      </span>
      <span className={`mt-0.5 block truncate text-[15px] font-medium tabular-nums ${mono ? "font-mono tracking-[0.02em]" : ""} ${t.text}`}>{value}</span>
    </button>
  );
}

/** Rarely-used actions: delete. */
function MoreMenu() {
  const { page, asset, goToTab } = useEntity();
  const t = useTone();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <IconButton icon="more" label="More actions" aria-expanded={open} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div
          className={`absolute right-0 top-full z-30 mt-1 min-w-[160px] overflow-hidden rounded-xl border py-1 shadow-lg ${
            t.dark ? "border-white/10 bg-[#111114]" : "border-gray-200 bg-white"
          }`}
        >
          {!asset.closing && asset.type !== "Trust" && isAdmin() && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void page.startClosing().then(() => goToTab("overview"));
              }}
              className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[12.5px] max-sm:min-h-[44px] ${t.dark ? "text-gray-200 hover:bg-white/[0.05]" : "text-gray-800 hover:bg-gray-50"}`}
            >
              <Icon name="x" />
              Close this entity…
            </button>
          )}
          <button
            type="button"
            disabled={page.deleting}
            onClick={() => {
              setOpen(false);
              void page.handleDeleteAsset();
            }}
            className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[12.5px] max-sm:min-h-[44px] ${t.dark ? "text-red-400 hover:bg-red-500/10" : "text-red-600 hover:bg-red-50"}`}
          >
            <Icon name="trash" />
            Delete entity
          </button>
        </div>
      )}
    </div>
  );
}

/** The category menu under the entity card. */
export function CategoryMenu() {
  const { view, tabPath, page } = useEntity();
  const t = useTone();
  const active = useRef<HTMLAnchorElement | null>(null);
  const strip = useRef<HTMLDivElement | null>(null);
  // On a phone the menu scrolls sideways: keep the current category in view, moving only the menu.
  useEffect(() => {
    const el = active.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const left = el.offsetLeft - box.offsetLeft;
    if (left < box.scrollLeft || left + el.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollTo({ left: Math.max(0, left - 8) });
  }, [view.tab, page.loading]);
  // Fade the right edge while more categories sit off-screen, so they're findable.
  const [more, setMore] = useState(false);
  useEffect(() => {
    const box = strip.current;
    if (!box) return;
    const check = () => setMore(box.scrollLeft + box.clientWidth < box.scrollWidth - 1);
    check();
    box.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(box);
    return () => {
      box.removeEventListener("scroll", check);
      ro.disconnect();
    };
  }, [view.tabs.length]);
  // On a phone the strip can't show it scrolls, so it's a button naming the current section that opens the whole list.
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [view.tab]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open]);
  const current = view.tabs.find((tab) => tab.key === view.tab) ?? view.tabs[0];
  const panel = t.dark ? "border-white/[0.07] bg-[#0b0b0f]/95 backdrop-blur-xl" : "border-gray-200 bg-white/95 backdrop-blur-xl";
  return (
    <nav aria-label="Entity sections" className="sticky top-[calc(3.5rem+env(safe-area-inset-top)+8px)] z-20 lg:top-3">
      <div className="relative sm:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="menu"
          className={`flex h-[48px] w-full items-center gap-2 rounded-xl border px-4 text-left ${panel}`}
        >
          <span className={`text-[11px] font-medium uppercase tracking-[0.14em] ${t.muted}`}>Section</span>
          <span className={`flex items-center gap-1.5 text-[14px] font-semibold ${t.text}`}>
            {current.label}
            <Count n={current.count} alert={current.alert} />
          </span>
          <Icon name="chevronDown" className={`ml-auto h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""} ${t.muted}`} strokeWidth={2.25} />
        </button>
        {open && (
          <>
            <button type="button" aria-label="Close sections" onClick={() => setOpen(false)} className="fixed inset-0 z-10 cursor-default bg-black/40" />
            <div role="menu" aria-label="Sections" className={`absolute inset-x-0 top-[calc(100%+6px)] z-20 grid grid-cols-2 gap-1 rounded-xl border p-1.5 shadow-2xl ${panel}`}>
              {view.tabs.map((tab) => {
                const on = tab.key === view.tab;
                return (
                  <Link
                    key={tab.key}
                    role="menuitem"
                    to={tabPath(tab.key)}
                    aria-current={on ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={`flex min-h-[48px] items-center justify-between gap-2 rounded-lg px-3 text-[13.5px] font-medium ${
                      on ? (t.dark ? "bg-white/[0.09] text-white" : "bg-gray-900 text-white") : `${t.text} ${t.hover}`
                    }`}
                  >
                    {tab.label}
                    <Count n={tab.count} alert={tab.alert} />
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
      <div
        className={`rounded-xl border p-1 max-sm:hidden ${panel}`}
      >
        <div
          ref={strip}
          className={`flex gap-1 [overflow-x:auto] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
            more ? "[mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)]" : ""
          }`}
        >
          {view.tabs.map((tab) => {
            const on = tab.key === view.tab;
            return (
              <Link
                key={tab.key}
                to={tabPath(tab.key)}
                ref={on ? active : undefined}
                aria-current={on ? "page" : undefined}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[12.5px] font-medium transition-colors max-sm:h-[40px] max-sm:px-2.5 ${
                  tab.key === "activity" ? "ml-auto" : ""
                } ${
                  on ? (t.dark ? "bg-white/[0.09] text-white" : "bg-gray-900 text-white") : t.dark ? "text-gray-400 hover:text-gray-200" : "text-gray-500 hover:text-gray-900"
                }`}
              >
                {tab.label}
                <Count n={tab.count} alert={tab.alert} />
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
