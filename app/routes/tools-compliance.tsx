import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { authFetch, getUser } from "../auth";
import { confirmDialog } from "../confirm-dialog";
import {
  assessAll,
  PILLARS,
  summarize,
  treeLevels,
  type Assessment,
  type EntityInput,
  type Fix,
  type PillarKey,
  type PillarStatus,
  type Tier,
} from "../compliance-map";
import { dollars, PALM_PRICES, priceSuffix, STATE_RECORD_CENTS, stateRecordCents } from "../../lib/palm-pricing";
import { effectiveRecord, lookupStateRecord, palmCall, PalmUnavailable, type PalmMode } from "../palm";
import { PalmCostCard, PriceTag } from "../palm-usage";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Entity compliance" }];
}

/**
 * Tools → Entity compliance. Every entity scored across eight pillars from
 * its Palm link, the state's record, its agent, paperwork and deadlines
 * (app/compliance-map.ts), drawn two ways: the ownership map (owners on the
 * left, what they own to the right, each entity a ring of eight segments)
 * and a list. Picking one opens what's missing and what to do about it;
 * "Check with the state" reads its record through Palm right here.
 */

type View = "map" | "list";
type Filter = "all" | Tier | "unverified";

// ── Colour ───────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<PillarStatus, { dark: string; light: string }> = {
  good: { dark: "#34d399", light: "#059669" },
  warn: { dark: "#fbbf24", light: "#d97706" },
  bad: { dark: "#fb7185", light: "#e11d48" },
  missing: { dark: "#64748b", light: "#94a3b8" },
  na: { dark: "rgba(255,255,255,0.08)", light: "rgba(0,0,0,0.07)" },
};
const STATUS_LABEL: Record<PillarStatus, string> = { good: "Good", warn: "Needs a look", bad: "Problem", missing: "Missing", na: "Doesn't apply" };
const TIER_LABEL: Record<Tier, string> = { good: "Compliant", attention: "Needs attention", risk: "At risk" };
const TIER_STATUS: Record<Tier, PillarStatus> = { good: "good", attention: "warn", risk: "bad" };

const col = (s: PillarStatus, isDark: boolean) => STATUS_COLOR[s][isDark ? "dark" : "light"];

// ── Rings ────────────────────────────────────────────────────────────────

function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Eight segments, one per pillar, clockwise from the top; the score in the middle. */
function PillarRing({ a, size, isDark, stroke, label = true }: { a: Assessment; size: number; isDark: boolean; stroke?: number; label?: boolean }) {
  const sw = stroke ?? Math.max(3, size * 0.09);
  const r = size / 2 - sw / 2 - 1;
  const n = a.pillars.length;
  const gap = 0.16;
  const step = (Math.PI * 2) / n;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img" aria-label={`${a.score} of 100`}>
      {a.pillars.map((p, i) => {
        const a0 = -Math.PI / 2 + i * step + gap / 2;
        const a1 = a0 + step - gap;
        return (
          <path
            key={p.key}
            d={arc(size / 2, size / 2, r, a0, a1)}
            fill="none"
            stroke={col(p.status, isDark)}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeDasharray={p.status === "missing" ? `${sw * 0.2} ${sw * 0.9}` : undefined}
          >
            <title>{`${PILLARS[i].label}: ${p.summary}`}</title>
          </path>
        );
      })}
      {label && (
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          fontSize={size * 0.3}
          fontWeight={600}
          fill={isDark ? "#fff" : "#111827"}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {a.score}
        </text>
      )}
    </svg>
  );
}

/** The family's score: one sweep, coloured by how far it got. */
function Gauge({ score, isDark }: { score: number; isDark: boolean }) {
  const size = 148;
  const sw = 11;
  const r = size / 2 - sw;
  const c = 2 * Math.PI * r;
  const tone: PillarStatus = score >= 85 ? "good" : score >= 60 ? "warn" : "bad";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <defs>
          <linearGradient id="gauge-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={col(tone, isDark)} stopOpacity="0.55" />
            <stop offset="1" stopColor={col(tone, isDark)} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)"} strokeWidth={sw} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#gauge-g)"
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={`${(c * score) / 100} ${c}`}
          className="cmp-gauge-arc"
          style={{ filter: isDark ? `drop-shadow(0 0 10px ${col(tone, true)}66)` : undefined }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[38px] font-semibold leading-none tabular-nums tracking-tight">{score}</span>
        <span className={`mt-1 text-[10.5px] uppercase tracking-[0.16em] ${isDark ? "text-gray-500" : "text-gray-500/100"}`}>of 100</span>
      </div>
    </div>
  );
}

function StatusDot({ s, isDark, size = 10 }: { s: PillarStatus; isDark: boolean; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: s === "missing" ? "transparent" : col(s, isDark),
        border: s === "missing" ? `1.5px dashed ${col(s, isDark)}` : undefined,
        boxShadow: isDark && (s === "bad" || s === "good") ? `0 0 8px ${col(s, true)}55` : undefined,
      }}
    />
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function EntityCompliance() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [params, setParams] = useSearchParams();
  const view: View = params.get("view") === "list" ? "list" : "map";
  const [assets, setAssets] = useState<Record<string, EntityInput> | null>(null);
  const [palm, setPalm] = useState<{ mode: PalmMode | null; loaded: boolean }>({ mode: null, loaded: false });
  const [filter, setFilter] = useState<Filter>("all");
  const [pillarFilter, setPillarFilter] = useState<PillarKey | null>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [checking, setChecking] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, { tone: "ok" | "warn" | "bad"; text: string }>>({});
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  /** Bumped after a check, so the Palm costs card re-reads the bill. */
  const [costKey, setCostKey] = useState(0);
  const user = getUser();
  const canEdit = !!user && user.role !== "viewer" && user.role !== "email";

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
  const assetNames = useMemo(() => Object.fromEntries(Object.entries(assets ?? {}).map(([id, a]) => [id, a.name ?? ""])), [assets]);
  const byId = useMemo(() => new Map(list.map((a) => [a.id, a])), [list]);

  const matches = useCallback(
    (a: Assessment) => {
      if (filter === "unverified" ? !a.unverified : filter !== "all" && a.tier !== filter) return false;
      if (pillarFilter) {
        const s = a.pillars.find((p) => p.key === pillarFilter)?.status;
        if (s === "good" || s === "na") return false;
      }
      if (q.trim() && !a.name.toLowerCase().includes(q.trim().toLowerCase())) return false;
      return true;
    },
    [filter, pillarFilter, q],
  );

  const setView = (v: View) => {
    const next = new URLSearchParams(params);
    if (v === "list") next.set("view", "list");
    else next.delete("view");
    setParams(next, { replace: true });
  };

  async function checkOne(id: string): Promise<"ok" | "warn" | "bad"> {
    const a = assets?.[id];
    const mode = palm.mode;
    if (!a || !mode) return "bad";
    setChecking((s) => new Set(s).add(id));
    try {
      const found = await lookupStateRecord({ name: a.name ?? "", state: a.state, fileNumber: a.fileNumber, assetId: id }, mode);
      if (found.kind === "record") {
        const { db, ref, update } = await import("../store");
        await update(ref(db, `assets/${id}`), found.patch);
        const st = effectiveRecord(found.record, a.stateConfirmed).status;
        setNotes((n) => ({ ...n, [id]: st && st !== "active" ? { tone: "bad", text: `Read just now: the state lists it as ${st}.` } : { tone: "ok", text: "Read from the state just now." } }));
        return "ok";
      }
      const text =
        found.kind === "choices"
          ? found.message ?? `${found.results.length} registry entries could be this one. Pick the right one on its Compliance tab.`
          : found.message;
      setNotes((n) => ({ ...n, [id]: { tone: "warn", text } }));
      return "warn";
    } catch (err) {
      const text = err instanceof PalmUnavailable ? "Palm isn't connected." : err instanceof Error ? err.message : "Couldn't reach Palm.";
      setNotes((n) => ({ ...n, [id]: { tone: "bad", text } }));
      return "bad";
    } finally {
      setChecking((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      setCostKey((k) => k + 1);
    }
  }

  async function checkAll() {
    const ids = list.filter((a) => a.type !== "Trust" && a.state && a.pillars.find((p) => p.key === "state")?.status !== "good").map((a) => a.id);
    if (!ids.length || !palm.mode) return;
    const ok = await confirmDialog({
      title: `Check ${ids.length} ${ids.length === 1 ? "entity" : "entities"} with the state?`,
      message: "Palm reads each one's record from its state registry: status, good standing, tax standing and agent. Nothing is filed and nothing changes with the state.",
      details: [
        "Each is read in its home state and in every state it's registered in as a foreign entity.",
        "Where the name matches more than one registry entry, it's left for you to pick on the entity's Compliance tab.",
        palm.mode === "live"
          ? `Palm bills ${dollars(STATE_RECORD_CENTS)} a state (a ${dollars(PALM_PRICES.search.cents)} search and a ${dollars(PALM_PRICES.detail.cents)} detail; just the detail where the file number is on record), so about ${dollars(ids.length * STATE_RECORD_CENTS)} here, more for entities registered in other states too.`
          : "In test mode these calls are free.",
        ...(palm.mode === "test" ? ["Palm is in test mode, so the records come from its sandbox."] : []),
      ],
      confirmLabel: `Check them · about ${dollars(ids.length * STATE_RECORD_CENTS)}`,
    });
    if (!ok) return;
    // One run on the server (api/cron/state-records.ts): the home state and each foreign state.
    setBulk({ done: 0, total: ids.length });
    try {
      const r = await authFetch("/api/cron/state-records", { method: "POST", body: JSON.stringify({ ids, force: true }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Couldn't check the records.");
      const said: Record<string, { tone: "ok" | "warn" | "bad"; text: string }> = {};
      for (const x of (j.results ?? []) as { id: string; state: string; outcome: string; detail?: string }[]) {
        const prev = said[x.id];
        const line =
          x.outcome === "read" ? { tone: "ok" as const, text: `${x.state}: read just now${x.detail ? ` (${x.detail})` : ""}.` }
          : x.outcome === "not_found" ? { tone: "warn" as const, text: `${x.state}: no registry entry matched the name. Add its file number under Edit.` }
          : x.outcome === "ambiguous" ? { tone: "warn" as const, text: `${x.state}: more than one registry entry matched. Pick the right one on its Compliance tab.` }
          : x.outcome === "error" ? { tone: "bad" as const, text: `${x.state}: ${x.detail ?? "couldn't reach Palm"}` }
          : null;
        if (!line) continue;
        said[x.id] = prev ? { tone: prev.tone === "bad" || line.tone === "bad" ? "bad" : prev.tone === "warn" || line.tone === "warn" ? "warn" : "ok", text: `${prev.text} ${line.text}` } : line;
      }
      setNotes((n) => ({ ...n, ...said }));
    } catch (err) {
      setNotes((n) => ({ ...n, ...Object.fromEntries(ids.map((id) => [id, { tone: "bad" as const, text: (err as Error).message }])) }));
    } finally {
      setBulk(null);
      setCostKey((k) => k + 1);
    }
  }

  const sel = selected ? byId.get(selected) ?? null : null;
  const t2 = isDark ? "text-gray-400" : "text-gray-500/100";
  const t3 = isDark ? "text-gray-500" : "text-gray-400/100";
  const card = `rounded-2xl border ${isDark ? "border-white/10 bg-white/[0.02] glass-card" : "border-gray-200 bg-white glass-card"}`;
  const staleOrUnread = list.filter((a) => a.type !== "Trust" && a.state && a.pillars.find((p) => p.key === "state")?.status !== "good").length;

  return (
    <div className="mx-auto max-w-[1400px] pb-16">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className={`text-[11px] font-medium uppercase tracking-[0.18em] ${t3}`}>Tools</p>
          <h1 className="mt-1 text-[20px] font-semibold leading-[1.2] tracking-[-0.015em] sm:text-[22px]">Entity compliance</h1>
          <p className={`mt-1 text-[12.5px] ${t2}`}>
            Every entity read against the state through Palm, its agent, its paperwork and what's due.{" "}
            <PalmBadge mode={palm.mode} loaded={palm.loaded} isDark={isDark} />
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Segmented value={view} onChange={setView} isDark={isDark} />
          {canEdit && palm.mode && staleOrUnread > 0 && (
            <button
              type="button"
              onClick={() => void checkAll()}
              disabled={!!bulk}
              className={`inline-flex h-9 items-center gap-2 rounded-full px-4 text-[12.5px] font-medium transition-colors ${
                isDark ? "bg-white text-black hover:bg-gray-200 disabled:bg-white/30" : "bg-gray-900 text-white hover:bg-gray-800 disabled:bg-gray-300"
              }`}
            >
              {bulk ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Checking {bulk.total} with the states…
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                  Check {staleOrUnread} with the state
                  {palm.mode === "live" && <PriceTag cents={staleOrUnread * STATE_RECORD_CENTS} isDark={!isDark} what="reading these records (about)" className="ml-0.5" />}
                </>
              )}
            </button>
          )}
        </div>
      </header>

      {canEdit && <PalmCostCard isDark={isDark} names={assetNames} refreshKey={costKey} />}

      {!assets ? (
        <div className={`mt-6 h-[300px] animate-pulse ${card}`} />
      ) : !list.length ? (
        <div className={`mt-6 p-10 text-center text-[13px] ${card} ${t2}`}>
          No entities yet. Add them on <Link to="/assets" className="underline">Entities</Link>.
        </div>
      ) : (
        <>
          {/* ── Summary ──────────────────────────────────────────────── */}
          <section className={`mt-5 grid gap-6 p-5 sm:p-6 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.25fr)] ${card}`}>
            <div className="flex items-center gap-5">
              <Gauge score={sum.score} isDark={isDark} />
              <div className="lg:hidden">
                <p className="text-[15px] font-semibold">Family compliance</p>
                <p className={`mt-1 text-[12px] ${t2}`}>Average across {sum.total} entities</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5 self-center">
              <Tile label="Compliant" n={sum.good} s="good" active={filter === "good"} onClick={() => setFilter(filter === "good" ? "all" : "good")} isDark={isDark} />
              <Tile label="Needs attention" n={sum.attention} s="warn" active={filter === "attention"} onClick={() => setFilter(filter === "attention" ? "all" : "attention")} isDark={isDark} />
              <Tile label="At risk" n={sum.risk} s="bad" active={filter === "risk"} onClick={() => setFilter(filter === "risk" ? "all" : "risk")} isDark={isDark} />
              <Tile label="Not checked with the state" n={sum.unverified} s="missing" active={filter === "unverified"} onClick={() => setFilter(filter === "unverified" ? "all" : "unverified")} isDark={isDark} />
            </div>
            <div className="min-w-0">
              <div className="mb-2 flex items-baseline justify-between">
                <p className={`text-[11px] font-medium uppercase tracking-[0.14em] ${t3}`}>Coverage by pillar</p>
                {pillarFilter && (
                  <button type="button" onClick={() => setPillarFilter(null)} className={`text-[11.5px] ${isDark ? "text-indigo-300" : "text-indigo-600"} hover:underline`}>
                    Clear
                  </button>
                )}
              </div>
              <div className="space-y-[7px]">
                {sum.coverage.map((p) => {
                  const applies = sum.total - p.counts.na;
                  const on = pillarFilter === p.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setPillarFilter(on ? null : p.key)}
                      className={`group grid w-full cursor-pointer grid-cols-[112px_minmax(0,1fr)_40px] items-center gap-3 rounded-md text-left ${pillarFilter && !on ? "opacity-40" : ""}`}
                      title={`Show entities where ${p.label.toLowerCase()} isn't good`}
                    >
                      <span className={`truncate text-[12px] ${on ? "font-semibold" : t2} ${isDark ? "group-hover:text-white" : "group-hover:text-black"}`}>{p.label}</span>
                      <span className={`flex h-2.5 overflow-hidden rounded-full ${isDark ? "bg-white/[0.05]" : "bg-black/[0.05]"}`}>
                        {(["good", "warn", "bad", "missing"] as PillarStatus[]).map((s) =>
                          p.counts[s] ? (
                            <span
                              key={s}
                              className="h-full transition-[width] duration-700"
                              style={{
                                width: `${(p.counts[s] / Math.max(1, applies)) * 100}%`,
                                background:
                                  s === "missing"
                                    ? `repeating-linear-gradient(135deg, ${col(s, isDark)} 0 3px, transparent 3px 6px)`
                                    : col(s, isDark),
                              }}
                            />
                          ) : null,
                        )}
                      </span>
                      <span className={`text-right text-[11.5px] tabular-nums ${t3}`}>
                        {p.counts.good}/{applies}
                      </span>
                    </button>
                  );
                })}
              </div>
              <Legend isDark={isDark} />
            </div>
          </section>

          {/* ── Filters ──────────────────────────────────────────────── */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {(["all", "risk", "attention", "good", "unverified"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`h-8 rounded-full px-3.5 text-[12px] font-medium transition-colors ${
                  filter === f
                    ? isDark
                      ? "bg-white text-black"
                      : "bg-gray-900 text-white"
                    : isDark
                      ? "bg-white/[0.05] text-gray-300 hover:bg-white/10"
                      : "bg-black/[0.04] text-gray-600 hover:bg-black/[0.08]"
                }`}
              >
                {f === "all" ? `All ${sum.total}` : f === "unverified" ? `Not checked ${sum.unverified}` : `${TIER_LABEL[f]} ${f === "risk" ? sum.risk : f === "attention" ? sum.attention : sum.good}`}
              </button>
            ))}
            {pillarFilter && (
              <span className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] ${isDark ? "bg-indigo-500/15 text-indigo-200" : "bg-indigo-50 text-indigo-700"}`}>
                {PILLARS.find((p) => p.key === pillarFilter)?.label} not good
                <button type="button" aria-label="Clear pillar filter" onClick={() => setPillarFilter(null)} className="ml-0.5 opacity-70 hover:opacity-100">
                  ×
                </button>
              </span>
            )}
            <div className="ml-auto w-full sm:w-64">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find an entity"
                className={`h-9 w-full rounded-full border px-4 text-[16px] outline-none sm:text-[12.5px] ${
                  isDark ? "border-white/10 bg-white/[0.03] text-white placeholder:text-gray-600 focus:border-white/25" : "border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 focus:border-gray-400"
                }`}
              />
            </div>
          </div>

          {view === "map" ? (
            <MapView list={list} matches={matches} selected={selected} onSelect={setSelected} isDark={isDark} card={card} checking={checking} />
          ) : (
            <ListView list={list.filter(matches)} selected={selected} onSelect={setSelected} isDark={isDark} card={card} checking={checking} />
          )}
        </>
      )}

      {sel && (
        <Detail
          a={sel}
          isDark={isDark}
          onClose={() => setSelected(null)}
          canCheck={canEdit && !!palm.mode && sel.type !== "Trust" && !!sel.state}
          checking={checking.has(sel.id)}
          note={notes[sel.id]}
          onCheck={() => void checkOne(sel.id)}
          price={priceSuffix(palm.mode, stateRecordCents(!!assets?.[sel.id]?.fileNumber))}
          owner={sel.ownerId ? byId.get(sel.ownerId) ?? null : null}
          owned={list.filter((x) => x.ownerId === sel.id)}
          onSelect={setSelected}
        />
      )}
    </div>
  );
}

// ── Header bits ──────────────────────────────────────────────────────────

function PalmBadge({ mode, loaded, isDark }: { mode: PalmMode | null; loaded: boolean; isDark: boolean }) {
  if (!loaded) return null;
  const tone = mode === "live" ? "good" : mode === "test" ? "warn" : "missing";
  return (
    <span className={`ml-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 align-middle text-[11px] font-medium ${isDark ? "bg-white/[0.06]" : "bg-black/[0.05]"}`}>
      <StatusDot s={tone} isDark={isDark} size={7} />
      {mode === "live" ? "Palm live" : mode === "test" ? "Palm test mode" : "Palm not connected"}
    </span>
  );
}

function Segmented({ value, onChange, isDark }: { value: View; onChange: (v: View) => void; isDark: boolean }) {
  const opts: { v: View; label: string; icon: React.ReactNode }[] = [
    {
      v: "map",
      label: "Map",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" aria-hidden>
          <circle cx="5" cy="12" r="2.2" />
          <circle cx="19" cy="6" r="2.2" />
          <circle cx="19" cy="18" r="2.2" />
          <path strokeLinecap="round" d="M7.2 12H11c2 0 2-6 4-6h1.8M11 12c2 0 2 6 4 6h1.8" />
        </svg>
      ),
    },
    {
      v: "list",
      label: "List",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm0 5.25h.007v.008H3.75V12zm0 5.25h.007v.008H3.75v-.008z" />
        </svg>
      ),
    },
  ];
  return (
    <div role="tablist" aria-label="View" className={`inline-flex rounded-full p-0.5 ${isDark ? "bg-white/[0.06]" : "bg-black/[0.05]"}`}>
      {opts.map((o) => (
        <button
          key={o.v}
          role="tab"
          aria-selected={value === o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors ${
            value === o.v ? (isDark ? "bg-white/15 text-white shadow-sm" : "bg-white text-black shadow-sm") : isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-black"
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Tile({ label, n, s, active, onClick, isDark }: { label: string; n: number; s: PillarStatus; active: boolean; onClick: () => void; isDark: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`relative overflow-hidden rounded-xl border p-3.5 text-left transition-colors ${
        active
          ? isDark
            ? "border-white/25 bg-white/[0.07]"
            : "border-gray-400 bg-gray-50"
          : isDark
            ? "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]"
            : "border-gray-200 bg-white hover:bg-gray-50"
      }`}
    >
      <span className="absolute inset-x-0 top-0 h-[2px]" style={{ background: s === "missing" ? `repeating-linear-gradient(90deg, ${col(s, isDark)} 0 4px, transparent 4px 8px)` : col(s, isDark) }} />
      <span className="block text-[26px] font-semibold leading-none tabular-nums">{n}</span>
      <span className={`mt-1.5 flex items-center gap-1.5 text-[11.5px] ${isDark ? "text-gray-400" : "text-gray-500/100"}`}>
        <StatusDot s={s} isDark={isDark} size={7} />
        {label}
      </span>
    </button>
  );
}

function Legend({ isDark }: { isDark: boolean }) {
  return (
    <div className={`mt-3 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] ${isDark ? "text-gray-500" : "text-gray-500/100"}`}>
      {(["good", "warn", "bad", "missing"] as PillarStatus[]).map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <StatusDot s={s} isDark={isDark} size={7} />
          {STATUS_LABEL[s]}
        </span>
      ))}
    </div>
  );
}

// ── Map ──────────────────────────────────────────────────────────────────

function EntityCard({
  a,
  dim,
  selected,
  onSelect,
  isDark,
  checking,
  full = false,
}: {
  a: Assessment;
  dim: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  isDark: boolean;
  checking: boolean;
  /** Fill the row (the phone outline) instead of the map's fixed width. */
  full?: boolean;
}) {
  const s = TIER_STATUS[a.tier];
  const top = a.fixes[0];
  const pillar = top ? a.pillars.find((p) => p.key === top.pillar) : null;
  return (
    <button
      type="button"
      data-id={a.id}
      onClick={() => onSelect(a.id)}
      aria-pressed={selected}
      className={`cmp-card cmp-card-${a.tier} group relative flex ${full ? "w-full" : "w-[248px]"} items-center gap-3 rounded-2xl border p-3 text-left transition-all duration-200 ${
        dim ? "opacity-25 saturate-50" : ""
      } ${selected ? "cmp-card-selected" : ""} ${isDark ? "border-white/10 bg-[#0b0c10]/80 hover:bg-[#12131a]" : "border-gray-200 bg-white/90 hover:bg-white"}`}
      style={{ ["--tier" as string]: col(s, isDark) }}
    >
      <span className="relative">
        <PillarRing a={a} size={50} isDark={isDark} />
        {checking && <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-indigo-400" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[12.5px] font-semibold leading-snug">{a.name}</span>
        <span className={`mt-0.5 flex items-center gap-1.5 text-[10.5px] ${isDark ? "text-gray-500" : "text-gray-500/100"}`}>
          {[a.state, a.type].filter(Boolean).join(" · ")}
          {a.unverified && (
            <span className={`rounded px-1 py-px text-[9.5px] font-medium ${isDark ? "bg-white/[0.07] text-gray-400" : "bg-black/[0.05] text-gray-500"}`}>Not checked</span>
          )}
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-[11px]" style={{ color: col(s, isDark) }}>
          <StatusDot s={s} isDark={isDark} size={6} />
          <span className="truncate">{pillar ? pillar.summary : "All clear"}</span>
        </span>
      </span>
    </button>
  );
}

function MapView({
  list,
  matches,
  selected,
  onSelect,
  isDark,
  card,
  checking,
}: {
  list: Assessment[];
  matches: (a: Assessment) => boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  isDark: boolean;
  card: string;
  checking: Set<string>;
}) {
  const levels = useMemo(() => treeLevels(list), [list]);
  const canvas = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const compact = useCompact();
  const [lines, setLines] = useState<{ id: string; parent: string; d: string; tier: Tier }[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });

  // Draw the ownership lines from where the cards actually landed.
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
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
        out.push({ id: a.id, parent: a.ownerId, d: `M ${x0} ${y0} C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`, tier: a.tier });
      }
      setLines(out);
      setBox({ w: el.scrollWidth, h: el.scrollHeight });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [list, levels, compact]);

  // Fade the edge the map continues past, so it reads as scrollable.
  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    const sync = () => setMore({ left: sc.scrollLeft > 4, right: sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 4 });
    sync();
    sc.addEventListener("scroll", sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(sc);
    return () => {
      sc.removeEventListener("scroll", sync);
      ro.disconnect();
    };
  }, [levels, compact]);

  // The selected entity's chain up to the top, lit.
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

  if (compact) {
    const kids = (id: string | null) => list.filter((a) => (a.ownerId ?? null) === id).sort((x, y) => x.name.localeCompare(y.name));
    const node = (a: Assessment, seen: Set<string>): React.ReactNode => {
      const below = seen.has(a.id) ? [] : kids(a.id);
      const next = new Set(seen).add(a.id);
      return (
        <li key={a.id} className="cmp-branch">
          <EntityCard a={a} dim={!matches(a)} selected={selected === a.id} onSelect={onSelect} isDark={isDark} checking={checking.has(a.id)} full />
          {below.length > 0 && <ul className={`cmp-outline ${isDark ? "nav-tree-dark" : "nav-tree-light"}`}>{below.map((c) => node(c, next))}</ul>}
        </li>
      );
    };
    return (
      <section className={`relative mt-4 p-3 ${card}`}>
        <ul className="space-y-2">{kids(null).map((a) => node(a, new Set()))}</ul>
      </section>
    );
  }

  return (
    <section className={`relative mt-4 overflow-hidden ${card}`}>
      <div className="cmp-map-bg pointer-events-none absolute inset-0" aria-hidden />
      <div className={`pointer-events-none absolute inset-y-0 left-0 z-10 w-16 transition-opacity ${more.left ? "opacity-100" : "opacity-0"}`} style={{ background: `linear-gradient(90deg, ${isDark ? "#07080b" : "#ffffff"}, transparent)` }} aria-hidden />
      <div className={`pointer-events-none absolute inset-y-0 right-0 z-10 w-16 transition-opacity ${more.right ? "opacity-100" : "opacity-0"}`} style={{ background: `linear-gradient(270deg, ${isDark ? "#07080b" : "#ffffff"}, transparent)` }} aria-hidden />
      <div ref={scroller} className="relative overflow-x-auto overscroll-x-contain">
        <div ref={canvas} className="relative flex min-w-max gap-[76px] p-6 sm:p-8">
          <svg className="pointer-events-none absolute left-0 top-0" width={box.w} height={box.h} aria-hidden>
            {lines.map((l) => {
              const lit = chain.has(l.id) && chain.has(l.parent);
              const s = TIER_STATUS[l.tier];
              return (
                <path
                  key={l.id}
                  d={l.d}
                  fill="none"
                  stroke={lit ? col(s, isDark) : isDark ? "rgba(255,255,255,0.13)" : "rgba(0,0,0,0.13)"}
                  strokeWidth={lit ? 2 : 1.25}
                  className={lit ? "cmp-flow" : undefined}
                  strokeDasharray={lit ? "4 6" : undefined}
                />
              );
            })}
          </svg>
          {levels.map((column, i) => (
            <div key={i} className="relative flex flex-col">
              <p className={`mb-4 pl-1 text-[10px] font-medium uppercase tracking-[0.16em] ${isDark ? "text-gray-600" : "text-gray-400/100"}`}>
                {i === 0 ? "Owners" : `Tier ${i + 1}`}
              </p>
              <div className="flex flex-1 flex-col justify-center gap-3">
                {column.map((a) => (
                  <EntityCard key={a.id} a={a} dim={!matches(a)} selected={selected === a.id} onSelect={onSelect} isDark={isDark} checking={checking.has(a.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Phones get the outline instead of the map. */
function useCompact(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setOn(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return on;
}

// ── List ─────────────────────────────────────────────────────────────────

const TIER_ORDER: Record<Tier, number> = { risk: 0, attention: 1, good: 2 };

function ListView({
  list,
  selected,
  onSelect,
  isDark,
  card,
  checking,
}: {
  list: Assessment[];
  selected: string | null;
  onSelect: (id: string) => void;
  isDark: boolean;
  card: string;
  checking: Set<string>;
}) {
  const [sort, setSort] = useState<"urgent" | "name" | "score">("urgent");
  const rows = useMemo(() => {
    const r = [...list];
    if (sort === "name") r.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "score") r.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    else r.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.score - b.score || a.name.localeCompare(b.name));
    return r;
  }, [list, sort]);
  const t3 = isDark ? "text-gray-500" : "text-gray-500/100";
  const head = `text-[10.5px] font-medium uppercase tracking-[0.12em] ${t3}`;

  return (
    <section className={`mt-4 overflow-hidden ${card}`}>
      <div className={`flex items-center justify-between border-b px-4 py-2.5 ${isDark ? "border-white/[0.07]" : "border-gray-100"}`}>
        <span className={`text-[12px] ${t3}`}>
          {rows.length} {rows.length === 1 ? "entity" : "entities"}
        </span>
        <label className={`flex items-center gap-2 text-[12px] ${t3}`}>
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className={`h-8 rounded-lg border px-2 text-[12px] outline-none ${isDark ? "border-white/10 bg-black text-gray-200" : "border-gray-200 bg-white text-gray-800"}`}
          >
            <option value="urgent">Most urgent first</option>
            <option value="score">Highest score</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className={`border-b ${isDark ? "border-white/[0.07]" : "border-gray-100"}`}>
              <th className={`py-2.5 pl-4 pr-3 ${head}`}>Entity</th>
              {PILLARS.map((p) => (
                <th key={p.key} className={`hidden px-1 py-2.5 text-center md:table-cell ${head}`} title={p.label}>
                  {p.short}
                </th>
              ))}
              <th className={`px-3 py-2.5 ${head}`}>Next step</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const top = a.fixes[0];
              return (
                <tr
                  key={a.id}
                  onClick={() => onSelect(a.id)}
                  className={`cursor-pointer border-b transition-colors last:border-0 ${isDark ? "border-white/[0.05] hover:bg-white/[0.03]" : "border-gray-100 hover:bg-gray-50"} ${
                    selected === a.id ? (isDark ? "bg-white/[0.05]" : "bg-gray-50") : ""
                  }`}
                >
                  <td className="py-2.5 pl-4 pr-3">
                    <button type="button" onClick={() => onSelect(a.id)} className="flex items-center gap-3 text-left">
                      <span className="relative">
                        <PillarRing a={a} size={34} isDark={isDark} stroke={3.5} />
                        {checking.has(a.id) && <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-indigo-400" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block max-w-[260px] truncate text-[13px] font-medium">{a.name}</span>
                        <span className={`block text-[11px] ${t3}`}>
                          {[a.state, a.type].filter(Boolean).join(" · ")} · <span style={{ color: col(TIER_STATUS[a.tier], isDark) }}>{TIER_LABEL[a.tier]}</span>
                        </span>
                      </span>
                    </button>
                  </td>
                  {a.pillars.map((p) => (
                    <td key={p.key} className="hidden px-1 py-2.5 text-center md:table-cell" title={`${p.label}: ${p.summary}`}>
                      <span className="inline-flex">
                        <StatusDot s={p.status} isDark={isDark} size={11} />
                      </span>
                    </td>
                  ))}
                  <td className="px-3 py-2.5">
                    <span className={`line-clamp-2 max-w-[340px] text-[12px] ${top ? "" : t3}`}>{top ? top.text : "Nothing to do"}</span>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={PILLARS.length + 2} className={`px-4 py-10 text-center text-[12.5px] ${t3}`}>
                  Nothing matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────

function Detail({
  a,
  isDark,
  onClose,
  canCheck,
  checking,
  note,
  onCheck,
  price = "",
  owner,
  owned,
  onSelect,
}: {
  a: Assessment;
  isDark: boolean;
  onClose: () => void;
  canCheck: boolean;
  checking: boolean;
  note?: { tone: "ok" | "warn" | "bad"; text: string };
  onCheck: () => void;
  /** " · $2.04" when the check is billed. */
  price?: string;
  owner: Assessment | null;
  owned: Assessment[];
  onSelect: (id: string) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const t2 = isDark ? "text-gray-400" : "text-gray-500/100";
  const t3 = isDark ? "text-gray-500" : "text-gray-400/100";
  const s = TIER_STATUS[a.tier];

  const fixButton = (f: Fix) => {
    const cls = `mt-2 inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-medium transition-colors ${
      isDark ? "bg-white/10 text-white hover:bg-white/15" : "bg-gray-900 text-white hover:bg-gray-800"
    }`;
    if (f.action === "check-state") {
      if (!canCheck) return null;
      return (
        <button type="button" onClick={onCheck} disabled={checking} className={cls}>
          {checking && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
          {checking ? "Reading the state's record…" : `${f.cta}${price}`}
        </button>
      );
    }
    if (!f.href || !f.cta) return null;
    return /^https?:/.test(f.href) ? (
      <a href={f.href} target="_blank" rel="noreferrer" className={cls}>
        {f.cta} ↗
      </a>
    ) : (
      <Link to={f.href} className={cls}>
        {f.cta} →
      </Link>
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] lg:bg-black/20" onClick={onClose} aria-hidden />
      <aside
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-label={`${a.name} compliance`}
        className={`cmp-drawer fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col border-l outline-none ${
          isDark ? "border-white/10 bg-[#07080b]/95 text-white backdrop-blur-2xl" : "border-gray-200 bg-white/95 text-gray-900 backdrop-blur-2xl"
        }`}
      >
        <div className="relative overflow-hidden px-6 pb-5 pt-6">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full opacity-25 blur-3xl" style={{ background: col(s, isDark) }} aria-hidden />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full ${isDark ? "text-gray-400 hover:bg-white/10 hover:text-white" : "text-gray-500 hover:bg-gray-100"}`}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <div className="relative flex items-center gap-4">
            <PillarRing a={a} size={92} isDark={isDark} stroke={8} />
            <div className="min-w-0 pr-8">
              <h2 className="text-[17px] font-semibold leading-snug">{a.name}</h2>
              <p className={`mt-0.5 text-[12px] ${t2}`}>{[a.state, a.type].filter(Boolean).join(" · ")}</p>
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium" style={{ background: `${col(s, isDark)}1f`, color: col(s, isDark) }}>
                <StatusDot s={s} isDark={isDark} size={7} />
                {TIER_LABEL[a.tier]}
              </p>
            </div>
          </div>
          {note && (
            <p
              className={`relative mt-4 rounded-lg px-3 py-2 text-[12px] ${
                note.tone === "ok"
                  ? isDark ? "bg-emerald-400/10 text-emerald-200" : "bg-emerald-50 text-emerald-800"
                  : note.tone === "warn"
                    ? isDark ? "bg-amber-400/10 text-amber-200" : "bg-amber-50 text-amber-800"
                    : isDark ? "bg-rose-400/10 text-rose-200" : "bg-rose-50 text-rose-800"
              }`}
            >
              {note.text}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-8">
          {/* What needs to happen */}
          <h3 className={`text-[11px] font-medium uppercase tracking-[0.14em] ${t3}`}>{a.fixes.length ? "What needs to happen" : "Nothing to do"}</h3>
          {a.fixes.length ? (
            <ol className="mt-3 space-y-0">
              {a.fixes.map((f, i) => {
                const p = a.pillars.find((x) => x.key === f.pillar)!;
                return (
                  <li key={f.pillar} className="relative flex gap-3.5 pb-5 last:pb-0">
                    {i < a.fixes.length - 1 && <span className={`absolute left-[11px] top-7 bottom-0 w-px ${isDark ? "bg-white/10" : "bg-gray-200"}`} aria-hidden />}
                    <span
                      className="relative z-[1] flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums"
                      style={{ background: `${col(f.status, isDark)}26`, color: col(f.status, isDark), boxShadow: `inset 0 0 0 1px ${col(f.status, isDark)}55` }}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 pt-0.5">
                      <p className="text-[12.5px] font-semibold">
                        {p.label} <span className={`font-normal ${t2}`}>· {p.summary}</span>
                      </p>
                      <p className={`mt-1 text-[12.5px] leading-relaxed ${isDark ? "text-gray-300" : "text-gray-700"}`}>{f.text}</p>
                      {fixButton(f)}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className={`mt-2 text-[12.5px] ${t2}`}>Every pillar that applies is in order.</p>
          )}

          {/* All eight */}
          <h3 className={`mt-8 text-[11px] font-medium uppercase tracking-[0.14em] ${t3}`}>All pillars</h3>
          <ul className={`mt-2 divide-y rounded-xl border ${isDark ? "divide-white/[0.06] border-white/[0.08]" : "divide-gray-100 border-gray-200"}`}>
            {a.pillars.map((p) => (
              <li key={p.key} className="flex items-center gap-3 px-3.5 py-2.5">
                <StatusDot s={p.status} isDark={isDark} size={9} />
                <span className="w-[112px] shrink-0 text-[12px] font-medium">{p.label}</span>
                <span className={`min-w-0 flex-1 truncate text-right text-[12px] ${p.status === "na" ? t3 : t2}`} title={p.summary}>
                  {p.summary}
                </span>
              </li>
            ))}
          </ul>

          {/* Where it sits */}
          {(owner || owned.length > 0) && (
            <>
              <h3 className={`mt-8 text-[11px] font-medium uppercase tracking-[0.14em] ${t3}`}>Ownership</h3>
              <div className="mt-2 space-y-1.5">
                {owner && <Relative label="Owned by" a={owner} isDark={isDark} onSelect={onSelect} />}
                {owned.map((o) => (
                  <Relative key={o.id} label="Owns" a={o} isDark={isDark} onSelect={onSelect} />
                ))}
              </div>
            </>
          )}
        </div>

        <div className={`border-t px-6 py-4 ${isDark ? "border-white/10" : "border-gray-200"}`}>
          <Link
            to={`/assets/${encodeURIComponent(a.id)}/compliance`}
            className={`flex h-10 w-full items-center justify-center rounded-full text-[13px] font-medium ${isDark ? "bg-white text-black hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-gray-800"}`}
          >
            Open {a.name.length > 28 ? "the entity" : a.name}
          </Link>
        </div>
      </aside>
    </>
  );
}

function Relative({ label, a, isDark, onSelect }: { label: string; a: Assessment; isDark: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(a.id)}
      className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors ${isDark ? "hover:bg-white/[0.05]" : "hover:bg-gray-50"}`}
    >
      <PillarRing a={a} size={30} isDark={isDark} stroke={3} label={false} />
      <span className="min-w-0 flex-1">
        <span className={`block text-[10.5px] uppercase tracking-[0.12em] ${isDark ? "text-gray-500" : "text-gray-400/100"}`}>{label}</span>
        <span className="block truncate text-[12.5px] font-medium">{a.name}</span>
      </span>
      <span className="text-[12px] tabular-nums" style={{ color: col(TIER_STATUS[a.tier], isDark) }}>
        {a.score}
      </span>
    </button>
  );
}
