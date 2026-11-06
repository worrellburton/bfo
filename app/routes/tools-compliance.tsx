/**
 * Tools → Entity compliance. Every entity assessed from the state's record
 * (through Palm), its agent, what it must file and whether that's recorded,
 * its paperwork and its records (app/compliance-map.ts), drawn two ways: the
 * ownership map (owners on the left, what they own to the right, each line
 * labelled with the share) and a list. Choosing one opens what needs doing
 * and the checks behind it; "Check with the state" reads records through
 * Palm, after saying what it costs. Built on the design system
 * (docs/DESIGN.md). These are BFO's checks of the records it holds, not a
 * legal opinion.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { stateReadCost, type StateReadable } from "../../lib/state-reads";
import { stateRecordCents } from "../../lib/palm-pricing";
import { authFetch, canWrite, getUser, isAdmin } from "../auth";
import {
  assessAll,
  byUrgency,
  PILLARS,
  STALE_DAYS,
  summarize,
  TIER_LABEL,
  treeLevels,
  type Assessment,
  type EntityInput,
  type Fix,
  type PillarKey,
  type PillarStatus,
  type Tier,
} from "../compliance-map";
import { effectiveRecord, lookupStateRecord, palmCall, PalmUnavailable, type PalmMode } from "../palm";
import { PalmCostLine } from "../palm-usage";
import {
  Banner,
  Button,
  buttonClasses,
  Card,
  confirm,
  cx,
  Disclosure,
  Empty,
  format,
  Icon,
  IconButton,
  LinkButton,
  Page,
  PageHeader,
  SearchField,
  Segmented,
  Select,
  Sheet,
  Skeleton,
  Status,
  Table,
  Toolbar,
  useDocumentTitle,
  useMedia,
  usePhone,
  type Column,
  type Tone,
} from "../ui";

export function meta() {
  return [{ title: "Entity compliance · BFO" }];
}

type View = "map" | "list";
type Filter = "all" | Tier | "unverified";
type Note = { tone: "ok" | "warn" | "bad"; text: string };

const TIER_TONE: Record<Tier, Tone> = { act: "negative", attention: "warning", clear: "neutral" };
const STATUS_WORD: Record<PillarStatus, string> = { good: "In order", warn: "Needs a look", bad: "Problem", missing: "Not known or not recorded", na: "Doesn't apply" };
const money = (cents: number) => format.money(cents / 100);
const stamp = (ms: number) => format.date(new Date(ms), "medium");

/** One check's state as a shape and a colour, never colour alone (§8.7). */
function Shape({ s, label }: { s: PillarStatus; label?: string }) {
  const name = s === "good" ? "check" : s === "warn" ? "warning" : s === "bad" ? "x" : s === "na" ? "minus" : null;
  const colour = s === "warn" ? "text-warning" : s === "bad" ? "text-negative" : "text-ink-3";
  return (
    <span className={cx("inline-flex size-4 items-center justify-center", colour)} title={label}>
      {name ? (
        <Icon name={name} size={16} />
      ) : (
        <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
          <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" />
        </svg>
      )}
      <span className="sr-only">{label ?? STATUS_WORD[s]}</span>
    </span>
  );
}

/** "AZ · LLC · Disregarded". */
const metaLine = (a: Assessment) =>
  [a.state, a.type, a.taxClass ? `${a.taxClass.label}${a.taxClass.assumed ? (a.type === "Trust" ? " (from its name)" : " (default)") : ""}` : null].filter(Boolean).join(" · ");

/** What needs doing first, in a few words; nothing at all when nothing does. */
const topLine = (a: Assessment) => {
  const f = a.fixes[0];
  return f ? (a.pillars.find((p) => p.key === f.pillar)?.summary ?? f.text) : null;
};

// ── Page ─────────────────────────────────────────────────────────────────

export default function EntityCompliance() {
  useDocumentTitle("Entity compliance");
  const [params, setParams] = useSearchParams();
  const view: View = params.get("view") === "list" ? "list" : "map";
  const [assets, setAssets] = useState<Record<string, EntityInput> | null>(null);
  const [palm, setPalm] = useState<{ mode: PalmMode | null; loaded: boolean }>({ mode: null, loaded: false });
  const [filter, setFilter] = useState<Filter>("all");
  const [pillarFilter, setPillarFilter] = useState<PillarKey | null>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [checking, setChecking] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [bulk, setBulk] = useState<{ total: number } | null>(null);
  /** Bumped after a check, so the Palm cost line re-reads the bill. */
  const [costKey, setCostKey] = useState(0);
  const user = getUser();
  const canCheckOne = canWrite(user);
  const canCheckAll = isAdmin(user);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    void (async () => {
      const { db, ref, onValue } = await import("../store");
      unsub = onValue(ref(db, "assets"), (snap) => setAssets((snap.val() as Record<string, EntityInput>) ?? {}));
    })();
    return () => unsub?.();
  }, []);

  useEffect(() => {
    palmCall<{ configured: boolean; mode: PalmMode | null }>("status")
      .then((s) => setPalm({ mode: s.mode, loaded: true }))
      .catch(() => setPalm({ mode: null, loaded: true }));
  }, []);

  const list = useMemo(() => (assets ? assessAll(assets, palm.mode) : []), [assets, palm.mode]);
  const sum = useMemo(() => summarize(list), [list]);
  const names = useMemo(() => Object.fromEntries(Object.entries(assets ?? {}).map(([id, a]) => [id, a.name ?? ""])), [assets]);
  const byId = useMemo(() => new Map(list.map((a) => [a.id, a])), [list]);

  const matches = (a: Assessment) => {
    if (filter === "unverified" ? !a.unverified : filter !== "all" && a.tier !== filter) return false;
    if (pillarFilter) {
      const s = a.pillars.find((p) => p.key === pillarFilter)?.status;
      if (s === "good" || s === "na") return false;
    }
    if (q.trim() && !a.name.toLowerCase().includes(q.trim().toLowerCase())) return false;
    return true;
  };

  const setView = (v: View) => {
    const next = new URLSearchParams(params);
    if (v === "list") next.set("view", "list");
    else next.delete("view");
    setParams(next, { replace: true });
  };

  /** Read one entity's home-state record through Palm, after saying what it costs. */
  async function checkOne(id: string) {
    const a = assets?.[id];
    const mode = palm.mode;
    if (!a || !mode) return;
    const live = mode === "live";
    const cents = stateRecordCents(!!a.fileNumber);
    const ok = await confirm({
      title: `Read ${a.name}'s state record?`,
      message: "Palm reads its status, standing and agent from its home state. Nothing is filed.",
      ...(live
        ? { receipt: { lines: [{ label: a.fileNumber ? "The record, by its file number" : "A name search, then the record", cents }] }, details: ["Billed to the Palm account."] }
        : { details: ["Palm is in test mode: nothing is billed."] }),
      confirmLabel: live ? `Read it for ${money(cents)}` : "Read it",
      tone: live ? "commit" : "default",
    });
    if (!ok) return;
    setChecking((s) => new Set(s).add(id));
    try {
      const found = await lookupStateRecord({ name: a.name ?? "", state: a.state, fileNumber: a.fileNumber, assetId: id }, mode);
      if (found.kind === "record") {
        const { db, ref, update } = await import("../store");
        await update(ref(db, `assets/${id}`), found.patch);
        const st = effectiveRecord(found.record, a.stateConfirmed).status;
        setNotes((n) => ({ ...n, [id]: st && st !== "active" ? { tone: "bad", text: `Read just now: the state lists it as ${st}.` } : { tone: "ok", text: "Read from the state just now." } }));
      } else {
        const text = found.kind === "choices" ? (found.message ?? `${found.results.length} registry entries could be this one. Pick the right one on its Compliance tab.`) : found.message;
        setNotes((n) => ({ ...n, [id]: { tone: "warn", text } }));
      }
    } catch (err) {
      const text = err instanceof PalmUnavailable ? "Palm isn't connected." : err instanceof Error ? err.message : "Couldn't reach Palm.";
      setNotes((n) => ({ ...n, [id]: { tone: "bad", text } }));
    } finally {
      setChecking((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      setCostKey((k) => k + 1);
    }
  }

  /** Never read, or read too long ago: what "Check with the state" reads. */
  const staleMs = STALE_DAYS * 86_400_000;
  const toCheck = list.filter((a) => a.type !== "Trust" && a.state && (a.unverified || (!!a.standing.asOf && Date.now() - a.standing.asOf > staleMs)));

  async function checkAll() {
    const mode = palm.mode;
    if (!toCheck.length || !mode || !assets) return;
    const live = mode === "live";
    const costs = toCheck.map((a) => stateReadCost(assets[a.id] as StateReadable, mode));
    const states = costs.flatMap((c) => c.states);
    const home = states.filter((s) => s.home);
    const foreign = states.filter((s) => !s.home);
    const homeCents = home.reduce((n, s) => n + s.cents, 0);
    const foreignCents = foreign.reduce((n, s) => n + s.cents, 0);
    const never = toCheck.filter((a) => a.unverified).length;
    const stale = toCheck.length - never;
    const n = toCheck.length;
    const what = [never ? `${never} never read` : null, stale ? `${stale} read more than ${STALE_DAYS} days ago` : null].filter(Boolean).join(" and ");
    const ok = await confirm({
      title: `Check ${format.count(n, "entity", "entities")} with the state?`,
      object: { names: toCheck.map((a) => a.name) },
      message: `${what.charAt(0).toUpperCase()}${what.slice(1)}. Palm reads each one's status, standing and agent, in its home state and in each state it's registered in. Nothing is filed.`,
      ...(live
        ? {
            receipt: {
              lines: [
                { label: `${format.count(home.length, "home-state record")}`, cents: homeCents },
                ...(foreign.length ? [{ label: `${format.count(foreign.length, "record")} in other states`, cents: foreignCents }] : []),
              ],
            },
            details: ["Billed to the Palm account. A name that matches more than one registry entry is left for you to pick on its Compliance tab."],
          }
        : { details: ["Palm is in test mode: the records come from its sandbox, and nothing is billed."] }),
      confirmLabel: live ? `Check ${n} for ${money(homeCents + foreignCents)}` : `Check ${n}`,
      tone: live ? "commit" : "default",
    });
    if (!ok) return;
    const ids = toCheck.map((a) => a.id);
    // One run on the server (api/cron/state-records.ts): the home state and each foreign state.
    setBulk({ total: ids.length });
    try {
      const r = await authFetch("/api/cron/state-records", { method: "POST", body: JSON.stringify({ ids, force: true }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Couldn't check the records.");
      const said: Record<string, Note> = {};
      for (const x of (j.results ?? []) as { id: string; state: string; outcome: string; detail?: string }[]) {
        const prev = said[x.id];
        const line: Note | null =
          x.outcome === "read"
            ? { tone: "ok", text: `${x.state}: read just now.` }
            : x.outcome === "not_found"
              ? { tone: "warn", text: `${x.state}: no registry entry matched the name. Add its file number under Edit.` }
              : x.outcome === "ambiguous"
                ? { tone: "warn", text: `${x.state}: more than one registry entry matched. Pick the right one on its Compliance tab.` }
                : x.outcome === "error"
                  ? { tone: "bad", text: `${x.state}: couldn't be read. Try again later.` }
                  : x.outcome === "later"
                    ? { tone: "warn", text: `${x.state}: not read this time (ran out of time). Check again to read the rest.` }
                    : null;
        if (!line) continue;
        said[x.id] = prev ? { tone: prev.tone === "bad" || line.tone === "bad" ? "bad" : prev.tone === "warn" || line.tone === "warn" ? "warn" : "ok", text: `${prev.text} ${line.text}` } : line;
      }
      setNotes((m) => ({ ...m, ...said }));
    } catch (err) {
      setNotes((m) => ({ ...m, ...Object.fromEntries(ids.map((id) => [id, { tone: "bad" as const, text: (err as Error).message }])) }));
    } finally {
      setBulk(null);
      setCostKey((k) => k + 1);
    }
  }

  const sel = selected ? (byId.get(selected) ?? null) : null;
  const asOf = sum.oldestRead ? `state records read since ${stamp(sum.oldestRead)}` : "no state records read yet";
  const checkButton =
    canCheckAll && palm.mode && toCheck.length > 0 ? (
      <Button variant="primary" icon="sync" busy={!!bulk} busyLabel={`Checking ${bulk?.total ?? toCheck.length}…`} onClick={() => void checkAll()}>
        Check {toCheck.length} with the state
      </Button>
    ) : undefined;
  const viewSwitch = (
    <Segmented
      label="View"
      value={view}
      onChange={setView}
      options={[
        { value: "map", label: "Map" },
        { value: "list", label: "List" },
      ]}
    />
  );

  return (
    <Page
      width="full"
      header={
        <PageHeader
          title="Entity compliance"
          context={assets ? `${format.count(sum.total, "entity", "entities")} · ${asOf} · BFO's checks, not a legal opinion` : "Reading the family's entities"}
          primary={checkButton}
        />
      }
    >
      {!assets ? (
        <Skeleton kind="card" rows={6} />
      ) : !list.length ? (
        <Empty
          size="page"
          title="No entities yet"
          action={
            <LinkButton to="/assets" variant="primary">
              Open Entities
            </LinkButton>
          }
        >
          Entities added on the Entities page are checked here against their states, their filings and their paperwork.
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          <Summary sum={sum} filter={filter} setFilter={setFilter} palmLoaded={palm.loaded} mode={palm.mode} />
          {canCheckOne && palm.mode && <PalmCostLine names={names} refreshKey={costKey} />}
          <Toolbar
            search={<SearchField value={q} onChange={setQ} placeholder="Search entities" label="Search entities" />}
            filters={
              <Select
                label="Check"
                size="sm"
                value={pillarFilter ?? "any"}
                onChange={(v) => setPillarFilter(v === "any" ? null : (v as PillarKey))}
                options={[{ value: "any", label: "Any check" }, ...PILLARS.map((p) => ({ value: p.key, label: `${p.label} not in order` }))]}
              />
            }
            view={viewSwitch}
            activeFilters={[
              ...(filter !== "all" ? [{ label: filter === "unverified" ? "Not checked with the state" : TIER_LABEL[filter], onRemove: () => setFilter("all") }] : []),
              ...(pillarFilter ? [{ label: `${PILLARS.find((p) => p.key === pillarFilter)?.label} not in order`, onRemove: () => setPillarFilter(null) }] : []),
            ]}
            onClearFilters={() => {
              setFilter("all");
              setPillarFilter(null);
              setQ("");
            }}
          />
          {view === "map" ? (
            <MapView list={list} matches={matches} selected={selected} onSelect={setSelected} checking={checking} />
          ) : (
            <ListView list={list.filter(matches)} onSelect={setSelected} checking={checking} />
          )}
          <Coverage sum={sum} />
          <p className="max-w-[68ch] text-small text-ink-2">
            These are BFO's checks of the records it holds and the states' records read through Palm, as of the dates shown. "In good standing" is only ever the state's own word. The steps are
            general; check with counsel before filing.
          </p>
        </div>
      )}

      {sel && (
        <Detail
          a={sel}
          onClose={() => setSelected(null)}
          canCheck={canCheckOne && !!palm.mode && sel.type !== "Trust" && !!sel.state}
          checking={checking.has(sel.id)}
          note={notes[sel.id]}
          onCheck={() => void checkOne(sel.id)}
          owner={sel.ownerId ? (byId.get(sel.ownerId) ?? null) : null}
          owned={list.filter((x) => x.ownerId === sel.id)}
          onSelect={setSelected}
        />
      )}
    </Page>
  );
}

// ── Summary: one line that is also the filter ────────────────────────────

function Summary({ sum, filter, setFilter, palmLoaded, mode }: { sum: ReturnType<typeof summarize>; filter: Filter; setFilter: (f: Filter) => void; palmLoaded: boolean; mode: PalmMode | null }) {
  const part = (f: Filter, n: number, words: string, tone: Tone) => (
    <button
      type="button"
      aria-pressed={filter === f}
      onClick={() => setFilter(filter === f ? "all" : f)}
      className={cx("inline-flex min-h-[32px] cursor-pointer items-center gap-2 rounded-control px-2 text-body text-ink hover:bg-hover touch:min-h-[44px]", filter === f && "bg-selected")}
    >
      <span aria-hidden="true" className={cx("size-2 rounded-full", tone === "negative" ? "bg-negative" : tone === "warning" ? "bg-warning" : "bg-ink-3")} />
      <span className="tabular-nums">{n}</span> {words}
    </button>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="-mx-2 flex flex-wrap items-center gap-x-1 gap-y-1">
        {part("act", sum.act, sum.act === 1 ? "to act on" : "to act on", "negative")}
        {part("attention", sum.attention, sum.attention === 1 ? "needs attention" : "need attention", "warning")}
        {part("clear", sum.clear, "with no issues found", "neutral")}
      </div>
      <p className="flex flex-wrap items-center gap-x-2 text-small text-ink-2">
        {sum.unverified > 0 && (
          <button
            type="button"
            aria-pressed={filter === "unverified"}
            onClick={() => setFilter(filter === "unverified" ? "all" : "unverified")}
            className={cx("cursor-pointer rounded-control text-left underline decoration-1 underline-offset-[3px] hover:text-ink touch:min-h-[44px]", filter === "unverified" && "text-ink")}
          >
            Of these, {sum.unverified} {sum.unverified === 1 ? "hasn't" : "haven't"} been checked with the state.
          </button>
        )}
        {palmLoaded && !mode && <span>Palm isn't connected, so no state record can be read.</span>}
        {mode === "test" && <span>Palm is in test mode: state records come from its sandbox.</span>}
      </p>
    </div>
  );
}

/** How each check stands across the family, behind a disclosure. */
function Coverage({ sum }: { sum: ReturnType<typeof summarize> }) {
  return (
    <Disclosure label="Each check across the family">
      <div className="mt-2 max-w-[720px] overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-body text-ink">
          <caption className="sr-only">Each check across the family</caption>
          <thead>
            <tr className="text-caption font-medium text-ink-2">
              <th scope="col" className="h-8 border-b border-line-strong pr-3 text-left">
                Check
              </th>
              {(["good", "warn", "bad", "missing"] as PillarStatus[]).map((s) => (
                <th key={s} scope="col" className="h-8 border-b border-line-strong px-3 text-right">
                  <span className="inline-flex items-center gap-1">
                    <Shape s={s} />
                    {s === "good" ? "In order" : s === "warn" ? "A look" : s === "bad" ? "Problem" : "Not known"}
                  </span>
                </th>
              ))}
              <th scope="col" className="h-8 border-b border-line-strong pl-3 text-right">
                Applies to
              </th>
            </tr>
          </thead>
          <tbody>
            {sum.coverage.map((p) => (
              <tr key={p.key}>
                <td className="h-(--row-1) border-b border-line pr-3">{p.label}</td>
                {(["good", "warn", "bad", "missing"] as PillarStatus[]).map((s) => (
                  <td key={s} className={cx("border-b border-line px-3 text-right tabular-nums", p.counts[s] ? "text-ink" : "text-ink-3")}>
                    {p.counts[s] || "—"}
                  </td>
                ))}
                <td className="border-b border-line pl-3 text-right text-ink-2 tabular-nums">{sum.total - p.counts.na}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Disclosure>
  );
}

// ── Map ──────────────────────────────────────────────────────────────────

/** Cards are as wide as the columns allow, between these, so the whole map fits a desktop window. */
const CARD_MIN = 172;
const CARD_MAX = 232;
const GAP = 40;

function EntityCard({ a, dim, selected, onSelect, checking, owner }: { a: Assessment; dim: boolean; selected: boolean; onSelect: (id: string) => void; checking: boolean; owner?: string | null }) {
  const top = topLine(a);
  return (
    <button
      type="button"
      data-id={a.id}
      onClick={() => onSelect(a.id)}
      aria-pressed={selected}
      title={top ?? undefined}
      className={cx(
        "cmp-card flex w-full cursor-pointer flex-col gap-1 rounded-card border border-line bg-raised p-3 text-left hover:bg-hover",
        selected && "outline-2 outline-offset-0 outline-accent outline-solid",
        dim && "opacity-40",
      )}
    >
      <span className="text-body font-medium text-balance break-words text-ink">{a.name}</span>
      {owner && <span className="text-small text-ink-2">Owned by {owner}</span>}
      <span className="text-small text-ink-2">{metaLine(a)}</span>
      <span className="mt-1 flex flex-col gap-[2px]">
        <Status tone={TIER_TONE[a.tier]}>{checking ? "Reading the state…" : TIER_LABEL[a.tier]}</Status>
        {top && <span className="line-clamp-2 text-small text-ink-2">{top}</span>}
      </span>
    </button>
  );
}

function MapView({
  list,
  matches,
  selected,
  onSelect,
  checking,
}: {
  list: Assessment[];
  matches: (a: Assessment) => boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  checking: Set<string>;
}) {
  const levels = useMemo(() => treeLevels(list), [list]);
  const phone = usePhone();
  const canvas = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const [lines, setLines] = useState<{ id: string; parent: string; d: string; x: number; y: number; share: number | null }[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [room, setRoom] = useState(0);
  const cardW = room ? Math.max(CARD_MIN, Math.min(CARD_MAX, Math.floor((room - 56 - (levels.length - 1) * GAP) / Math.max(1, levels.length)))) : CARD_MAX;

  // Draw the ownership lines from where the cards actually landed.
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el || phone) return;
    const draw = () => {
      const base = el.getBoundingClientRect();
      const rect = new Map<string, DOMRect>();
      el.querySelectorAll<HTMLElement>("[data-id]").forEach((n) => rect.set(n.dataset.id!, n.getBoundingClientRect()));
      const out: typeof lines = [];
      for (const a of list) {
        if (!a.ownerId) continue;
        const c = rect.get(a.id);
        const p = rect.get(a.ownerId);
        if (!c || !p) continue;
        const x0 = p.right - base.left;
        const y0 = p.top + p.height / 2 - base.top;
        const x1 = c.left - base.left;
        const y1 = c.top + c.height / 2 - base.top;
        const mx = (x0 + x1) / 2;
        out.push({ id: a.id, parent: a.ownerId, d: `M ${x0} ${y0} C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`, x: x1 - 4, y: y1 - 6, share: a.ownerShare });
      }
      setLines(out);
      setBox({ w: el.scrollWidth, h: el.scrollHeight });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [list, levels, phone, cardW]);

  // Say which way the map continues, with buttons to get there.
  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    const sync = () => {
      setRoom(sc.clientWidth);
      setMore({ left: sc.scrollLeft > 4, right: sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 4 });
    };
    sync();
    sc.addEventListener("scroll", sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(sc);
    return () => {
      sc.removeEventListener("scroll", sync);
      ro.disconnect();
    };
  }, [levels, phone]);

  // The selected entity's chain up to the top.
  const chain = useMemo(() => {
    const ids = new Set<string>();
    const byId = new Map(list.map((a) => [a.id, a]));
    let cur = selected ? byId.get(selected) : undefined;
    while (cur && !ids.has(cur.id)) {
      ids.add(cur.id);
      cur = cur.ownerId ? byId.get(cur.ownerId) : undefined;
    }
    return ids;
  }, [selected, list]);

  if (phone) {
    // An outline: 16px a level, and past the third level a caption instead of more indent.
    const byId = new Map(list.map((a) => [a.id, a]));
    const kids = (id: string | null) => list.filter((a) => (a.ownerId && byId.has(a.ownerId) ? a.ownerId : null) === id).sort((x, y) => x.name.localeCompare(y.name));
    const rows: ReactNode[] = [];
    const walk = (a: Assessment, depth: number, seen: Set<string>) => {
      const owner = a.ownerId ? byId.get(a.ownerId) : undefined;
      rows.push(
        <li key={a.id} style={{ paddingLeft: Math.min(depth, 2) * 16 }}>
          <EntityCard
            a={a}
            dim={!matches(a)}
            selected={selected === a.id}
            onSelect={onSelect}
            checking={checking.has(a.id)}
            owner={depth >= 3 && owner ? `${owner.name}${a.ownerShare != null ? ` (${format.percent(a.ownerShare, { decimals: 2, trim: true })})` : ""}` : null}
          />
        </li>,
      );
      if (seen.has(a.id)) return;
      for (const c of kids(a.id)) walk(c, depth + 1, new Set(seen).add(a.id));
    };
    for (const a of kids(null)) walk(a, 0, new Set());
    return <ul className="flex flex-col gap-2">{rows}</ul>;
  }

  const scrollBy = (dir: 1 | -1) => scroller.current?.scrollBy({ left: dir * (cardW + GAP) * 2, behavior: "smooth" });

  return (
    <Card flush>
      <div>
        <div ref={scroller} className="overflow-x-auto overscroll-x-contain">
          <div ref={canvas} className="relative flex min-w-max p-6" style={{ gap: GAP }}>
            <svg className="pointer-events-none absolute top-0 left-0 text-line-strong" width={box.w} height={box.h} aria-hidden="true">
              {lines.map((l) => {
                const lit = chain.has(l.id) && chain.has(l.parent);
                return <path key={l.id} d={l.d} fill="none" stroke="currentColor" className={lit ? "text-accent" : undefined} strokeWidth={lit ? 2 : 1} />;
              })}
              {lines.map((l) =>
                l.share != null ? (
                  <text key={`${l.id}-share`} x={l.x} y={l.y} textAnchor="end" className="fill-current text-caption text-ink-2" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {format.percent(l.share, { decimals: 2, trim: true })}
                  </text>
                ) : null,
              )}
            </svg>
            {levels.map((column, i) => (
              <div key={i} className="relative flex flex-col justify-center gap-3" style={{ width: cardW }}>
                {column.map((a) => (
                  <EntityCard key={a.id} a={a} dim={!matches(a)} selected={selected === a.id} onSelect={onSelect} checking={checking.has(a.id)} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3">
        <p className="min-w-0 flex-1 text-small text-ink-2">
          Owners on the left, what they own to the right. A line's figure is the owner's share, from the members list; no figure means none is recorded.
        </p>
        {(more.left || more.right) && (
          <span className="flex shrink-0 items-center gap-1">
            <span className="text-small text-ink-2">{more.right ? "More to the right" : "More to the left"}</span>
            <IconButton icon="chevronLeft" variant="secondary" label="Scroll the map left" disabled={!more.left} onClick={() => scrollBy(-1)} />
            <IconButton icon="chevronRight" variant="secondary" label="Scroll the map right" disabled={!more.right} onClick={() => scrollBy(1)} />
          </span>
        )}
      </div>
    </Card>
  );
}

// ── List ─────────────────────────────────────────────────────────────────

function ListView({ list, onSelect, checking }: { list: Assessment[]; onSelect: (id: string) => void; checking: Set<string> }) {
  const rows = useMemo(() => [...list].sort(byUrgency), [list]);
  const shown = PILLARS.filter((p) => p.key !== "palm");
  const columns: Column<Assessment>[] = [
    {
      key: "name",
      header: "Entity",
      sort: (a, b) => a.name.localeCompare(b.name),
      render: (a) => (
        <span className="flex flex-col py-1">
          <span className="text-body text-ink">{a.name}</span>
          <span className="text-small text-ink-2">{metaLine(a)}</span>
        </span>
      ),
    },
    {
      key: "tier",
      header: "Status",
      width: "160px",
      sort: byUrgency,
      render: (a) => <Status tone={TIER_TONE[a.tier]}>{checking.has(a.id) ? "Reading…" : TIER_LABEL[a.tier]}</Status>,
    },
    {
      key: "standing",
      header: "The state says",
      width: "190px",
      render: (a) => (
        <span className="flex flex-col py-1">
          <span className="text-small text-ink">{a.standing.word}</span>
          {a.standing.asOf ? (
            <span className={cx("text-caption", Date.now() - a.standing.asOf > STALE_DAYS * 86_400_000 ? "text-warning" : "text-ink-3")}>read {format.date(new Date(a.standing.asOf), "short")}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "checks",
      header: "Checks",
      width: "196px",
      render: (a) => (
        <span className="inline-flex gap-[6px]">
          {shown.map((p) => {
            const pl = a.pillars.find((x) => x.key === p.key)!;
            return <Shape key={p.key} s={pl.status} label={`${pl.label}: ${pl.summary}`} />;
          })}
        </span>
      ),
    },
    {
      key: "next",
      header: "Next step",
      render: (a) => <span className="line-clamp-2 text-small text-ink-2">{a.fixes[0]?.text ?? "Nothing to do"}</span>,
    },
  ];
  return (
    <Card flush>
      <Table
        caption="Entity compliance"
        columns={columns}
        rows={rows}
        rowKey={(a) => a.id}
        onRowClick={(a) => onSelect(a.id)}
        empty={<Empty>No entities match.</Empty>}
        phoneRow={(a) => ({
          title: a.name,
          secondary: `${TIER_LABEL[a.tier]}${topLine(a) ? ` · ${topLine(a)}` : ""}`,
          leading: <span aria-hidden="true" className={cx("size-2 rounded-full", a.tier === "act" ? "bg-negative" : a.tier === "attention" ? "bg-warning" : "bg-ink-3")} />,
          onClick: () => onSelect(a.id),
        })}
      />
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-5 py-3 text-small text-ink-2">
        <span>Checks, left to right: {shown.map((p) => p.short).join(", ")}.</span>
        {(["good", "warn", "bad", "missing", "na"] as PillarStatus[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <Shape s={s} label="" />
            {STATUS_WORD[s]}
          </span>
        ))}
      </div>
    </Card>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────

function Detail({
  a,
  onClose,
  canCheck,
  checking,
  note,
  onCheck,
  owner,
  owned,
  onSelect,
}: {
  a: Assessment;
  onClose: () => void;
  canCheck: boolean;
  checking: boolean;
  note?: Note;
  onCheck: () => void;
  owner: Assessment | null;
  owned: Assessment[];
  onSelect: (id: string) => void;
}) {
  const wide = useMedia("(min-width: 640px)");
  const applies = a.pillars.filter((p) => p.status !== "na");
  const na = a.pillars.filter((p) => p.status === "na");
  const s = a.standing;
  const fixAction = (f: Fix) => {
    if (f.action === "check-state")
      return canCheck ? (
        <Button size="sm" icon="sync" busy={checking} busyLabel="Reading the state's record…" onClick={onCheck}>
          {f.cta}…
        </Button>
      ) : null;
    if (!f.href || !f.cta) return null;
    return /^https?:/.test(f.href) ? (
      <a href={f.href} target="_blank" rel="noopener noreferrer" className={buttonClasses({ size: "sm" })}>
        {f.cta}
        <Icon name="external" size={16} />
        <span className="sr-only">, opens in a new tab</span>
      </a>
    ) : (
      <LinkButton to={f.href} size="sm">
        {f.cta}
      </LinkButton>
    );
  };

  return (
    <Sheet
      open
      onClose={onClose}
      side="right"
      title={a.name}
      description={metaLine(a)}
      footer={
        <LinkButton to={`/assets/${encodeURIComponent(a.id)}/compliance`} variant="primary" full={!wide}>
          Open the entity
        </LinkButton>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Status tone={TIER_TONE[a.tier]}>{TIER_LABEL[a.tier]}</Status>
          <p className="text-small text-ink-2">
            {s.tone === "none"
              ? "A trust files nothing with a state."
              : s.asOf
                ? `${s.state ?? "The state"}: ${s.word}, ${s.confirmed ? "seen on its own site" : "read through Palm"} ${stamp(s.asOf)}.`
                : `${s.state ?? "The state"}: not checked yet.`}
          </p>
          {note && <Banner tone={note.tone === "ok" ? "positive" : note.tone === "warn" ? "warning" : "negative"}>{note.text}</Banner>}
        </div>

        <section className="flex flex-col gap-3">
          <h3 className="text-small font-semibold text-ink">{a.fixes.length ? "What needs doing" : "Nothing needs doing in what BFO checks"}</h3>
          {a.fixes.length > 0 && (
            <ol className="flex flex-col gap-4">
              {a.fixes.map((f, i) => {
                const p = a.pillars.find((x) => x.key === f.pillar)!;
                return (
                  <li key={f.pillar} className="flex gap-3">
                    <span className="mt-[2px] text-small text-ink-3 tabular-nums">{i + 1}.</span>
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="flex items-start gap-2">
                        <Shape s={f.status} />
                        <span className="text-body text-ink">
                          {p.label}: <span className="text-ink-2">{p.summary}</span>
                        </span>
                      </span>
                      <p className="text-small text-pretty text-ink-2">{f.text}</p>
                      <div className="pt-1">{fixAction(f)}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-small font-semibold text-ink">Checks</h3>
          <ul className="flex flex-col divide-y divide-line">
            {applies.map((p) => (
              <li key={p.key} className="flex items-start gap-3 py-2">
                <Shape s={p.status} />
                <span className="w-[136px] shrink-0 text-small text-ink">{p.label}</span>
                <span className="min-w-0 flex-1 text-small text-ink-2">{p.summary}</span>
              </li>
            ))}
          </ul>
          {na.length > 0 && (
            <Disclosure label={`${na.length} don't apply${a.type === "Trust" ? " to a trust" : ""}`}>
              <ul className="flex flex-col gap-1 pb-1 text-small text-ink-2">
                {na.map((p) => (
                  <li key={p.key}>
                    {p.label}: {p.summary}
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
          <p className="text-small text-ink-2">
            Record completeness on its page: {format.percent(a.record.score, { decimals: 0 })}
            {a.record.todo ? `, ${format.count(a.record.todo, "item")} to add` : ""}. That's how complete the record is; these checks are what the state and the rules ask of it.
          </p>
        </section>

        {(owner || owned.length > 0) && (
          <section className="flex flex-col gap-2">
            <h3 className="text-small font-semibold text-ink">Ownership</h3>
            <ul className="flex flex-col divide-y divide-line">
              {owner && <Relative label="Owned by" a={owner} share={a.ownerShare} onSelect={onSelect} />}
              {owned.map((o) => (
                <Relative key={o.id} label="Owns" a={o} share={o.ownerShare} onSelect={onSelect} />
              ))}
            </ul>
          </section>
        )}

        <p className="text-small text-ink-2">BFO's checks of the records it holds, not a legal opinion. The steps are general; check with counsel before filing.</p>
      </div>
    </Sheet>
  );
}

function Relative({ label, a, share, onSelect }: { label: string; a: Assessment; share: number | null; onSelect: (id: string) => void }) {
  return (
    <li>
      <button type="button" onClick={() => onSelect(a.id)} className="flex w-full cursor-pointer items-center gap-3 py-2 text-left hover:bg-hover touch:min-h-[44px]">
        <span className="min-w-0 flex-1">
          <span className="block text-small text-ink-2">
            {label}
            {share != null ? `, ${format.percent(share, { decimals: 2, trim: true })}` : ", share not recorded"}
          </span>
          <span className="block text-body break-words text-ink">{a.name}</span>
        </span>
        <Status tone={TIER_TONE[a.tier]}>{TIER_LABEL[a.tier]}</Status>
        <Icon name="chevronRight" size={16} className="text-ink-3" />
      </button>
    </li>
  );
}
