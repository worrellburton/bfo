import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useEntity } from "./context";
import { fmtDate } from "./model";
import { Button, Count, Dot, Icon, IconButton, useTone } from "./ui";

/** The entity card: who it is, the facts people copy most, and how complete its record is. */
export function EntityHeader() {
  const { page, view, asset, tabPath } = useEntity();
  const t = useTone();
  const { etype, isTrust, glyph, score, filedCount, scoredKinds } = view;
  const owner = asset.ownerId ? page.assetNames[asset.ownerId] : undefined;
  const formed = fmtDate(asset.formationDate);
  const trustees = (asset.trustees ?? "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);

  const meta = [etype, asset.state || "No state", asset.llcType].filter(Boolean) as string[];

  return (
    <section className={`overflow-hidden rounded-2xl border ${t.surface}`}>
      <div className="px-5 pb-4 pt-4 sm:px-6 sm:pt-5">
        <Link to="/assets" className={`inline-flex items-center gap-1 text-[12px] transition-colors max-sm:min-h-[40px] ${t.muted} ${t.dark ? "hover:text-white" : "hover:text-gray-900"}`}>
          <Icon name="chevronLeft" className="h-3 w-3" strokeWidth={2.25} />
          Entities
        </Link>
        <div className="mt-3 flex items-start gap-3.5">
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
                  <Link to={`/assets/${asset.ownerId}`} className={`hover:underline ${t.soft}`}>
                    {owner}
                  </Link>
                </span>
              )}{" "}
              {asset.status && (
                <Dot tone={asset.status === "Active" ? "good" : "warn"} className="ml-1 align-middle">
                  {asset.status}
                </Dot>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button icon="edit" onClick={() => (page.editing ? page.setEditing(false) : page.startEditing())} aria-expanded={page.editing} aria-label={page.editing ? "Cancel editing" : "Edit"}>
              <span className="max-sm:hidden">{page.editing ? "Cancel" : "Edit"}</span>
            </Button>
            <MoreMenu />
          </div>
        </div>
      </div>

      <dl className={`grid grid-cols-2 border-t sm:grid-cols-4 ${t.line}`}>
        {isTrust && !asset.ein ? (
          <Metric label="Trustees" value={String(trustees.length)} sub={trustees[0]} />
        ) : (
          <CopyMetric id="ein" label="EIN" value={asset.ein} mono />
        )}
        <CopyMetric id="formed" label={isTrust ? "Trust date" : etype === "C-Corp" ? "Incorporated" : "Formed"} value={formed} />
        <Metric label="Completeness" value={`${score}`} sub="/ 100" />
        <Link to={tabPath("documents")} className={`block transition-colors ${t.hover}`}>
          <Metric label="Paperwork" value={`${filedCount}/${scoredKinds.length}`} sub={filedCount === scoredKinds.length ? "complete" : "on file"} />
        </Link>
      </dl>
    </section>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const t = useTone();
  return (
    <div className="min-w-0 px-5 py-3 sm:px-6">
      <dt className={`text-[11.5px] ${t.muted}`}>{label}</dt>
      <dd className={`mt-0.5 truncate text-[15px] font-medium tabular-nums ${t.text}`}>
        {value}
        {sub && <span className={`ml-1.5 text-[11px] font-normal ${t.muted}`}>{sub}</span>}
      </dd>
    </div>
  );
}

/** A fact you can click to copy. */
function CopyMetric({ id, label, value, mono = false }: { id: string; label: string; value?: string; mono?: boolean }) {
  const { page } = useEntity();
  const t = useTone();
  if (!value) return <Metric label={label} value="—" />;
  const done = page.copied === id;
  return (
    <button
      type="button"
      onClick={() => page.copyValue(id, value)}
      title={`Copy ${label}`}
      aria-label={`${label} ${value}. Copy`}
      className={`group/copy block min-w-0 cursor-pointer px-5 py-3 text-left transition-colors sm:px-6 ${t.hover}`}
    >
      <span className={`flex items-center gap-1.5 text-[11.5px] ${t.muted}`}>
        {label}
        <span aria-live="polite" className={`inline-flex items-center gap-1 ${done ? (t.dark ? "text-emerald-400" : "text-emerald-600") : "opacity-60 sm:opacity-0 sm:group-hover/copy:opacity-100"}`}>
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
  const { page } = useEntity();
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
      <IconButton icon="more" label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div
          role="menu"
          className={`absolute right-0 top-full z-30 mt-1 min-w-[160px] overflow-hidden rounded-xl border py-1 shadow-lg ${
            t.dark ? "border-white/10 bg-[#111114]" : "border-gray-200 bg-white"
          }`}
        >
          <button
            type="button"
            role="menuitem"
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
  // On a phone the menu scrolls sideways: keep the current category in view, moving only the menu.
  useEffect(() => {
    const el = active.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const left = el.offsetLeft - box.offsetLeft;
    if (left < box.scrollLeft || left + el.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollTo({ left: Math.max(0, left - 8) });
  }, [view.tab, page.loading]);
  return (
    <nav aria-label="Entity sections" className="sticky top-[calc(3.5rem+env(safe-area-inset-top)+8px)] z-20 lg:top-3">
      <div
        className={`flex gap-1 rounded-xl border p-1 [overflow-x:auto] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
          t.dark ? "border-white/[0.07] bg-[#0b0b0f]/95 backdrop-blur-xl" : "border-gray-200 bg-white/95 backdrop-blur-xl"
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
                on ? (t.dark ? "bg-white/[0.09] text-white" : "bg-gray-900 text-white") : t.dark ? "text-gray-400 hover:text-gray-200" : "text-gray-500 hover:text-gray-900"
              }`}
            >
              {tab.label}
              <Count n={tab.count} alert={tab.alert} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
