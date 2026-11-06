import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { authFetch, getUser } from "../auth";
import { entityCompleteness, entityType } from "../entity-completeness";
import { obligations, stateName, type PaperworkInput } from "../entity-paperwork";
import { dayMs, flowSide, inRange, shareOf, sixMonths, typeCounts, type FlowKind, type FlowLine, type Member, type Pnl } from "../home-model";
import { HomeSearch } from "../home-search";
import { DOC_LABEL, palmCall } from "../palm";
import { Banner, Button, Card, cx, Empty, format, List, ListRow, Page, PageHeader, Segmented, Skeleton, TextLink, useDocumentTitle } from "../ui";

/**
 * Home: what needs the person today, then the money, then the holding
 * structure (docs/DESIGN.md: a still page, one display figure, figures that
 * say their period, basis and freshness).
 *
 * - Needs attention: only what can be acted on now (registered-agent mail,
 *   transactions to categorize, possible duplicates, late income, filings
 *   due, a state with no record of an entity). Record gaps sit below it under
 *   "Records to complete". "Nothing needs you" is said only when every part
 *   loaded.
 * - Cash and investments: bank and brokerage balances from Treasury, by
 *   calendar range, with what isn't included said under it.
 * - Income and Expenses: the P&L's own figures (GET /api/books/data
 *   ?report=pnl, the matrix Books › Reports shows), year to date, so Home
 *   and Reports can't disagree. Each account opens the P&L cell behind it.
 * - Coming in: recurring and planned income from the books' calendar, with
 *   a row for the streams not listed so the rows add up to the headline.
 */

export function meta() {
  return [{ title: "Home · BFO" }, { name: "description", content: "Your family office, at a glance." }];
}

// ── Data shapes ──────────────────────────────────────────────────────────

interface Asset {
  id: string;
  name: string;
  type: "LLC" | "C-Corp" | "LP" | "Trust";
  state?: string;
  ein?: string;
  ownerId?: string;
  formationDate?: string;
  address?: string;
  registeredAgent?: string;
  llcType?: string;
  fileNumber?: string;
  members?: Member[];
  foreign?: Record<string, { fileNumber?: string; notNeeded?: boolean; record?: unknown }>;
  stateRecord?: PaperworkInput["stateRecord"];
  palm?: Record<string, { formation?: { status?: string } } | undefined>;
  registryMiss?: Record<string, { outcome: "not_found" | "ambiguous"; at: number; mode?: "test" | "live" }>;
  einLetter?: unknown;
  w9?: unknown;
  articles?: unknown;
  operatingAgreement?: unknown;
}

type TreasuryRow = { day: string; cash: number; invested: number; credit: number };
type Stream = {
  source: string;
  entity: string | null;
  monthly: number;
  typical: number;
  nextExpected: string | null;
  overdue: boolean;
  cadence: string;
  /** "detected" from the books, or "planned" (typed in); older servers leave it out. */
  basis?: string;
  note?: string | null;
};
type HomeData = {
  treasury: TreasuryRow[] | null;
  review: { uncategorized: number } | null;
  inflows: { monthly: number; streams: Stream[] } | null;
};

/** One request's state: loading, its answer, or a failure the page says out loud. */
type Load<T> = { state: "loading" } | { state: "ok"; data: T } | { state: "failed" };

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const r = await authFetch(url, { signal });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as T;
}

function useJson<T>(url: string | null, attempt = 0): Load<T> {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  useEffect(() => {
    if (!url) return;
    const ctl = new AbortController();
    setLoad({ state: "loading" });
    getJson<T>(url, ctl.signal)
      .then((data) => setLoad({ state: "ok", data }))
      .catch(() => !ctl.signal.aborted && setLoad({ state: "failed" }));
    return () => ctl.abort();
  }, [url, attempt]);
  return load;
}

// ── Dates ────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const todayIso = () => format.isoDate(new Date());

/** "today", "tomorrow", "in 3 days" within a week; otherwise null (the date says it). */
function soon(iso: string): string | null {
  const diff = Math.round((dayMs(iso) - dayMs(todayIso())) / DAY);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff > 1 && diff < 7) return `In ${diff} days`;
  return null;
}

// ── Holding structure ────────────────────────────────────────────────────

type Scored = Asset & ReturnType<typeof entityCompleteness>;
type TreeRow = { e: Scored; parent: Scored | null; depth: number };
type TreeGroup = { key: string; head: Scored | null; title: string; caption: string; rows: TreeRow[] };

/**
 * Folds the ownership tree into a card: chains (each top-level owner walked
 * down while it has a single holding child), then a group per company under
 * the end of a chain with its subsidiaries, a group for what's held directly,
 * and one for entities with no parent on file.
 */
function buildStructure(scored: Scored[], byId: Map<string, Scored>, childrenOf: Map<string, string[]>) {
  const byName = (a: Scored, b: Scored) => a.name.localeCompare(b.name);
  const kids = (id: string) =>
    (childrenOf.get(id) ?? [])
      .map((k) => byId.get(k))
      .filter((k): k is Scored => !!k)
      .sort(byName);
  const seen = new Set<string>();
  const subtree = (parent: Scored, depth: number, out: TreeRow[]) => {
    for (const k of kids(parent.id)) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      out.push({ e: k, parent, depth });
      subtree(k, depth + 1, out);
    }
    return out;
  };
  const count = (id: string, s = new Set<string>()): number => kids(id).reduce((n, k) => (s.has(k.id) ? n : (s.add(k.id), n + 1 + count(k.id, s))), 0);

  const roots = scored.filter((a) => !a.ownerId || !byId.has(a.ownerId));
  const owners = roots.filter((r) => kids(r.id).length > 0).sort((a, b) => count(b.id) - count(a.id) || byName(a, b));
  const loose_: Scored[] = roots.filter((r) => kids(r.id).length === 0);

  const chains: { links: Scored[]; holds: number; total: number }[] = [];
  const groups: TreeGroup[] = [];
  for (const root of owners) {
    seen.add(root.id);
    const links = [root];
    let end = root;
    for (;;) {
      const k = kids(end.id);
      if (k.length !== 1 || kids(k[0].id).length === 0 || seen.has(k[0].id)) break;
      end = k[0];
      seen.add(end.id);
      links.push(end);
    }
    const direct: TreeRow[] = [];
    const children = kids(end.id).filter((c) => !seen.has(c.id));
    for (const c of children) {
      seen.add(c.id);
      if (kids(c.id).length) {
        const rows = subtree(c, 0, []);
        const share = shareOf(c, end.name);
        groups.push({
          key: c.id,
          head: c,
          title: c.name,
          caption: [`Held by ${end.name}`, share ?? "largest owner on file", format.count(rows.length, "entity", "entities") + " under it"].join(" · "),
          rows,
        });
      } else direct.push({ e: c, parent: end, depth: 0 });
    }
    if (direct.length) groups.push({ key: `direct-${end.id}`, head: null, title: `Held directly by ${end.name}`, caption: "Its largest owner on file", rows: direct });
    chains.push({ links, holds: children.length, total: count(root.id) });
  }
  // Anything a cycle kept out of the tree still deserves a place.
  for (const a of scored) if (!seen.has(a.id) && !loose_.includes(a)) loose_.push(a);
  if (loose_.length) {
    groups.push({
      key: "unlinked",
      head: null,
      title: "No parent on file",
      caption: format.count(loose_.length, "entity", "entities"),
      rows: loose_.sort((a, b) => (a.type === b.type ? byName(a, b) : a.type === "LLC" ? -1 : 1)).map((e) => ({ e, parent: null, depth: 0 })),
    });
  }
  return { chains, groups };
}

// ── Income and expenses from the P&L ─────────────────────────────────────

const monthName = (key: string, style: "short" | "long" = "short") => new Date(`${key}-15T12:00:00Z`).toLocaleDateString("en-US", { month: style, timeZone: "UTC" });

function MonthBars({ months, kind }: { months: { key: string; value: number | null }[]; kind: FlowKind }) {
  const [picked, setPicked] = useState(months.length - 1);
  const peak = Math.max(1, ...months.map((m) => Math.abs(m.value ?? 0)));
  const at = months[picked] ?? months[months.length - 1];
  const current = picked === months.length - 1;
  return (
    <div>
      <div role="radiogroup" aria-label={`${kind === "income" ? "Income" : "Expenses"} by month`} className="flex h-[72px] items-end gap-2">
        {months.map((m, i) => {
          const on = i === picked;
          const last = i === months.length - 1;
          const h = m.value === null ? 0 : Math.max(2, Math.round((Math.abs(m.value) / peak) * 52));
          return (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${monthName(m.key, "long")}${last ? " so far" : ""}: ${m.value === null ? "not on record" : format.money(m.value, { precision: "dollars" })}`}
              onClick={() => setPicked(i)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  const next = Math.max(0, Math.min(months.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)));
                  setPicked(next);
                  (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
                }
              }}
              tabIndex={on ? 0 : -1}
              className="group flex h-full min-w-0 flex-1 cursor-pointer flex-col items-stretch justify-end gap-1 rounded-mark outline-offset-2"
            >
              <span className={cx("block w-full rounded-mark", on ? "bg-ink" : "bg-ink-3 group-hover:bg-ink-2")} style={{ height: h }} />
              <span className={cx("text-center text-caption tabular-nums", on ? "font-medium text-ink" : "text-ink-2")}>{monthName(m.key)}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-small text-ink-2 tabular-nums" aria-live="polite">
        {monthName(at.key, "long")}
        {current ? " so far" : ""}: <span className="font-medium text-ink">{at.value === null ? "Not on record" : format.money(at.value, { precision: "dollars" })}</span>
      </p>
    </div>
  );
}

/** Income or expenses, year to date: the P&L's own total, six months of bars, and the accounts behind it. */
function FlowCard({ kind, pnl, lastYear, load, retry }: { kind: FlowKind; pnl: Pnl | null; lastYear: Pnl | null; load: "loading" | "ok" | "failed"; retry: () => void }) {
  const title = kind === "income" ? "Income" : "Expenses";
  const now = new Date();
  const year = now.getFullYear();
  const period = format.dateRange(`${year}-01-01`, todayIso());
  if (load === "loading") return <Skeleton kind="card" rows={4} />;
  if (load === "failed" || !pnl) {
    return (
      <Card title={title}>
        <Banner
          tone="negative"
          action={
            <Button variant="quiet" size="sm" onClick={retry}>
              Try again
            </Button>
          }
        >
          Couldn’t load the books.
        </Banner>
      </Card>
    );
  }
  const side = flowSide(pnl, kind);
  const months = sixMonths(now, kind, pnl, lastYear);
  const SHOWN = 4;
  const top = side.lines.slice(0, SHOWN);
  const rest = side.lines.slice(SHOWN);
  const restTotal = rest.reduce((s, l) => s + l.total, 0);
  const cell = (l: FlowLine) => `/books/reports/cell?entity=all&year=${year}&section=${l.section}&label=${encodeURIComponent(l.label)}`;
  const name = (label: string) => label.replace(/^\d{4}\s+/, "");
  return (
    <Card title={title} footer={<TextLink to="/books/reports">Open the P&L</TextLink>}>
      <p className="text-small text-ink-2">All entities, combined · {period} · cash basis, posted</p>
      <p className="mt-2 text-heading text-ink tabular-nums">{format.money(side.total, { precision: "dollars" })}</p>
      {Math.abs(side.uncategorized) >= 0.5 && (
        <p className="mt-1 text-small text-ink-2">
          {side.uncategorizedInside ? "Includes" : "Leaves out"} {format.money(side.uncategorized, { precision: "dollars" })} not yet categorized ·{" "}
          <Link to="/books/review" className="text-accent underline underline-offset-[3px] hover:text-accent-hover">
            Review
          </Link>
        </p>
      )}
      <div className="mt-5">
        <MonthBars months={months} kind={kind} />
      </div>
      {side.lines.length > 0 && (
        <div className="-mx-5 mt-5 border-t border-line touch:-mx-4">
          <h3 className="px-5 pt-3 pb-1 text-small font-medium text-ink-2 touch:px-4">By account, year to date</h3>
          <List label={`${title} by account`} className="px-1">
            {top.map((l) => (
              <ListRow key={`${l.section}:${l.label}`} title={name(l.label)} label={l.label} to={cell(l)} trailing={format.money(l.total, { precision: "dollars" })} />
            ))}
            {rest.length > 0 && <ListRow title={`Other · ${format.count(rest.length, "account")}`} to="/books/reports" trailing={format.money(restTotal, { precision: "dollars" })} />}
            <ListRow title={<span className="font-semibold">Total</span>} label="Total" trailing={<span className="font-semibold">{format.money(side.total, { precision: "dollars" })}</span>} />
          </List>
        </div>
      )}
    </Card>
  );
}

// ── Cash and investments ─────────────────────────────────────────────────

const RANGES = [
  { value: "30", label: "30 days", days: 30 },
  { value: "90", label: "90 days", days: 90 },
  { value: "all", label: "All", days: Infinity },
] as const;
type RangeKey = (typeof RANGES)[number]["value"];
type Point = { day: string; value: number; cash: number; invested: number; credit: number };

/** "↓ $323,410 · 8.6%": the arrow carries the direction; the figures are unsigned (§10.2). */
function Change({ from, to, className }: { from: number; to: number; className?: string }) {
  const delta = to - from;
  if (Math.abs(delta) < 0.5) return <span className={cx("text-ink-2", className)}>No change</span>;
  const pct = from ? Math.abs((delta / from) * 100) : null;
  return (
    <span className={cx("inline-flex items-center gap-1 tabular-nums", delta > 0 ? "text-positive" : "text-negative", className)}>
      <span aria-hidden>{delta > 0 ? "↑" : "↓"}</span>
      <span className="sr-only">{delta > 0 ? "Up" : "Down"}</span>
      {format.money(Math.abs(delta), { precision: Math.abs(delta) < 100 ? "cents" : "dollars" })}
      {pct !== null && ` · ${format.percent(pct)}`}
    </span>
  );
}

function TrendChart({ points, active, setActive }: { points: Point[]; active: number | null; setActive: (i: number | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (s && Math.abs(s.w - r.width) < 0.5 && Math.abs(s.h - r.height) < 0.5 ? s : { w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = size?.w || 1000;
  const H = size?.h || 160;
  const { line, area, xy } = useMemo(() => {
    const vals = points.map((p) => p.value);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi - lo < 1) {
      hi += 1;
      lo -= 1;
    }
    const pad = (hi - lo) * 0.15;
    lo -= pad;
    hi += pad;
    const n = points.length;
    const xy = points.map((p, i) => [n === 1 ? W / 2 : (i / (n - 1)) * W, H - ((p.value - lo) / (hi - lo)) * H] as const);
    const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    return { line, area: `${line} L${W},${H} L0,${H} Z`, xy };
  }, [points, W, H]);

  const pick = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setActive(Math.round(f * (points.length - 1)));
  };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const last = points.length - 1;
    const at = active ?? last;
    const next = e.key === "ArrowLeft" ? at - 1 : e.key === "ArrowRight" ? at + 1 : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next === null) {
      if (e.key === "Escape") setActive(null);
      return;
    }
    e.preventDefault();
    setActive(Math.max(0, Math.min(last, next)));
  };
  const lastPt = xy[xy.length - 1];
  const at = active != null ? xy[active] : null;
  const first = points[0];
  const end = points[points.length - 1];
  return (
    <div
      ref={box}
      tabIndex={0}
      role="group"
      aria-roledescription="chart"
      aria-label={`Cash and investments, ${format.dateRange(first.day, end.day)}. Use the arrow keys to read each day.`}
      className="relative h-[120px] w-full cursor-crosshair touch-pan-y rounded-mark select-none touch:h-[96px]"
      onPointerMove={pick}
      onPointerDown={pick}
      onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
      onKeyDown={onKey}
      onBlur={() => setActive(null)}
    >
      {size && (
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} x2={W} y1={Math.round(f * H) + 0.5} y2={Math.round(f * H) + 0.5} stroke="var(--color-line)" />
          ))}
          <path d={area} fill="var(--color-accent-tint)" />
          <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
          {at ? (
            <>
              <line x1={at[0]} x2={at[0]} y1={0} y2={H} stroke="var(--color-line-strong)" />
              <circle cx={at[0]} cy={at[1]} r={4} fill="var(--color-accent)" stroke="var(--color-raised)" strokeWidth={2} />
            </>
          ) : (
            lastPt && <circle cx={lastPt[0]} cy={lastPt[1]} r={3.5} fill="var(--color-accent)" />
          )}
        </svg>
      )}
      {active != null && points[active] && <PointCard points={points} index={active} x={xy[active][0] / W} />}
    </div>
  );
}

/** One day on the chart: its total, what changed since the day before it on record, and the parts. */
function PointCard({ points, index, x }: { points: Point[]; index: number; x: number }) {
  const p = points[index];
  const prev = index > 0 ? points[index - 1] : null;
  const right = x > 0.55;
  const rows: [string, number][] = [
    ["Cash", p.cash],
    ["Invested", p.invested],
    ["Credit owed", p.credit],
  ];
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-1/2 z-popover w-[248px] rounded-card border border-line-strong bg-overlay p-3 text-small text-ink shadow-(--elevation-2)"
      style={{ left: `${x * 100}%`, transform: `translate(${right ? "calc(-100% - 12px)" : "12px"}, -50%)` }}
    >
      <p className="text-caption text-ink-2">{format.date(p.day, "medium")}</p>
      <p className="mt-1 text-body font-medium tabular-nums">{format.money(p.value, { precision: "dollars" })}</p>
      {prev && (
        <p className="mt-1 flex justify-between gap-3">
          <span className="text-ink-2">Since {format.date(prev.day)}</span>
          <Change from={prev.value} to={p.value} />
        </p>
      )}
      <div className="mt-2 flex flex-col gap-1 border-t border-line pt-2 tabular-nums">
        {rows.map(([label, v]) => (
          <p key={label} className="flex justify-between gap-3">
            <span className="text-ink-2">{label}</span>
            <span>{format.money(v, { precision: "dollars" })}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

function CashCard({ treasury, load, retry }: { treasury: TreasuryRow[] | null; load: "loading" | "ok" | "failed"; retry: () => void }) {
  const [range, setRange] = useState<RangeKey>("90");
  const [active, setActive] = useState<number | null>(null);
  const all = useMemo(() => (treasury ?? []).map((t) => ({ day: t.day, value: t.cash + t.invested, cash: t.cash, invested: t.invested, credit: t.credit })), [treasury]);
  const series = useMemo(() => inRange(all, RANGES.find((r) => r.value === range)!.days), [all, range]);
  const latest = all[all.length - 1];
  const head = active != null && series[active] ? series[active] : latest;
  const first = series[0];
  const stale = latest ? dayMs(todayIso()) - dayMs(latest.day) > DAY : false;
  const segment = (full: boolean) => (
    <Segmented
      full={full}
      label="Period"
      value={range}
      onChange={(v) => {
        setRange(v);
        setActive(null);
      }}
      options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
    />
  );
  if (load === "loading") return <Skeleton kind="card" rows={3} />;
  if (load === "failed") {
    return (
      <Card title="Cash and investments">
        <Banner
          tone="negative"
          action={
            <Button variant="quiet" size="sm" onClick={retry}>
              Try again
            </Button>
          }
        >
          Couldn’t load the balances.
        </Banner>
      </Card>
    );
  }
  if (!latest) {
    return (
      <Card title="Cash and investments">
        <Empty>
          No balances yet. They appear here once a bank or brokerage is connected in{" "}
          <TextLink to="/treasury" inline>
            Treasury
          </TextLink>
          .
        </Empty>
      </Card>
    );
  }
  return (
    <Card title="Cash and investments" action={<div className="hidden md:block">{segment(false)}</div>}>
      <div className="flex flex-col gap-1">
        <p className="text-small text-ink-2">{active != null && head ? format.date(head.day, "medium") : "Cash plus investments, all accounts"}</p>
        <p className="text-display text-ink tabular-nums">{format.money(head.value, { precision: "dollars" })}</p>
        <p className="flex flex-wrap items-baseline gap-x-2 text-small">
          {first && first !== head && <Change from={first.value} to={head.value} />}
          {first && first !== head && <span className="text-ink-2">since {format.date(first.day)}</span>}
          <span className={cx(stale ? "text-warning" : "text-ink-2")}>
            {first && first !== head ? "· " : ""}
            {stale ? `Last updated ${format.date(latest.day)}` : format.asOf(latest.day)}
          </span>
        </p>
      </div>
      <div className="mt-4 md:hidden">{segment(true)}</div>
      {series.length >= 2 ? (
        <>
          <div className="mt-4">
            <TrendChart points={series} active={active} setActive={setActive} />
          </div>
          <div className="mt-1 flex justify-between text-caption text-ink-2 tabular-nums">
            <span>{format.date(series[0].day)}</span>
            <span>{format.date(series[series.length - 1].day)}</span>
          </div>
        </>
      ) : (
        <p className="mt-4 text-body text-ink-2">One day on record in this period; the trend shows once there are two.</p>
      )}
      <dl className="mt-5 grid grid-cols-3 gap-4 border-t border-line pt-4">
        {(
          [
            ["Cash", latest.cash],
            ["Invested", latest.invested],
            ["Credit owed", latest.credit],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="min-w-0">
            <dt className="text-small text-ink-2">{label}</dt>
            <dd className="mt-1 text-body font-medium text-ink tabular-nums">{format.money(v, { precision: "dollars" })}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-small text-pretty text-ink-2">
        Bank and brokerage balances from Treasury. Credit owed isn’t subtracted. Real estate, private companies, loans and mortgages aren’t included.{" "}
        <TextLink to="/treasury" inline>
          Treasury
        </TextLink>
      </p>
    </Card>
  );
}

// ── Coming in ────────────────────────────────────────────────────────────

const CADENCE: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly", annual: "Yearly", weekly: "Weekly", biweekly: "Every 2 weeks", one_time: "Once" };

function ComingIn({ inflows, load }: { inflows: HomeData["inflows"]; load: "loading" | "ok" | "failed" }) {
  if (load === "loading") return <Skeleton kind="card" rows={4} />;
  if (load === "failed" || !inflows) {
    return (
      <Card title="Coming in">
        <p className="text-body text-ink-2">Couldn’t load expected income. It’s on the books’ calendar.</p>
      </Card>
    );
  }
  const streams = [...inflows.streams].sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.nextExpected ?? "9999").localeCompare(b.nextExpected ?? "9999"));
  const listed = streams.reduce((s, x) => s + x.monthly, 0);
  const smaller = Math.round(inflows.monthly - listed);
  const planned = streams.filter((s) => s.basis === "planned").reduce((s, x) => s + x.monthly, 0);
  return (
    <Card title="Coming in" action={<TextLink to="/books/calendar">Calendar</TextLink>} flush>
      <div className="px-5 pt-1 pb-3 touch:px-4">
        <p className="text-heading text-ink tabular-nums">
          {format.money(inflows.monthly, { precision: "dollars" })}
          <span className="text-body font-normal text-ink-2"> a month, expected</span>
        </p>
        <p className="mt-1 text-small text-ink-2">
          {planned >= 1
            ? `${format.money(inflows.monthly - planned, { precision: "dollars" })} seen in the books · ${format.money(planned, { precision: "dollars" })} planned`
            : "Recurring income seen in the books"}
        </p>
      </div>
      {streams.length === 0 ? (
        <div className="border-t border-line px-5 py-4 touch:px-4">
          <Empty>No recurring income found yet. Streams appear here after they’ve repeated in the books.</Empty>
        </div>
      ) : (
        <div className="border-t border-line">
          <List label="Expected income" className="px-1">
            {streams.map((s) => {
              const when = s.nextExpected ? (soon(s.nextExpected) ?? format.date(s.nextExpected)) : null;
              const cadence = CADENCE[s.cadence] ?? s.cadence;
              return (
                <ListRow
                  key={s.source}
                  to="/books/calendar"
                  title={s.source}
                  label={s.source}
                  secondary={
                    <>
                      {s.overdue ? <span className="font-medium text-warning">Late · </span> : null}
                      {[
                        s.basis === "planned" ? "Planned" : null,
                        s.cadence === "monthly" ? cadence : `${cadence}, ${format.money(s.typical, { precision: "dollars" })} each`,
                        s.entity,
                        when ?? "No date yet",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </>
                  }
                  trailing={format.money(s.monthly, { precision: "dollars" })}
                />
              );
            })}
            {smaller >= 1 && <ListRow title="Smaller streams" secondary="Not listed here; on the calendar" to="/books/calendar" trailing={format.money(smaller, { precision: "dollars" })} />}
          </List>
          <p className="border-t border-line px-5 py-3 text-small text-ink-2 touch:px-4">Amounts are a month’s share: a quarterly payment counts a third of itself here.</p>
        </div>
      )}
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

type Attn = { key: string; title: string; detail: ReactNode; to: string; tone: "warning" | "neutral" };

export default function Home() {
  useDocumentTitle("Home");
  const [user] = useState(() => (typeof window === "undefined" ? null : getUser()));
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetsLoad, setAssetsLoad] = useState<"loading" | "ok" | "failed">("loading");
  const [assetsTry, setAssetsTry] = useState(0);
  const [homeTry, setHomeTry] = useState(0);
  const [pnlTry, setPnlTry] = useState(0);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { db, authReady, ref, onValue } = await import("../store");
        await authReady;
        if (cancelled) return;
        unsubscribe = onValue(
          ref(db, "assets"),
          (snapshot) => {
            const data = snapshot.val();
            setAssets(
              data
                ? Object.entries(data).map(([id, value]) => {
                    const a = { id, ...(value as Omit<Asset, "id">) };
                    return { ...a, type: entityType(a) };
                  })
                : [],
            );
            setAssetsLoad("ok");
          },
          () => setAssetsLoad("failed"),
        );
      } catch {
        if (!cancelled) setAssetsLoad("failed");
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [assetsTry]);
  const retryAssets = () => {
    setAssetsLoad("loading");
    setAssetsTry((n) => n + 1);
  };

  const now = new Date();
  const year = now.getFullYear();
  const home = useJson<HomeData>("/api/books/data?report=home", homeTry);
  const pnl = useJson<Pnl>(`/api/books/data?report=pnl&entity=all&year=${year}`, pnlTry);
  // Six months back reaches into last year from January to May.
  const lastYear = useJson<Pnl>(now.getMonth() < 5 ? `/api/books/data?report=pnl&entity=all&year=${year - 1}` : null, pnlTry);
  const review = useJson<{ counts: { uncategorized: number; duplicate_groups: number } }>("/api/books/data?report=review", homeTry);

  // Mail Palm received as registered agent and hasn't been opened in BFO yet.
  const [palmMail, setPalmMail] = useState<{ id: string; asset_id: string | null; document_type: string | null; occurred_at: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    palmCall<{ events: { id: string; type: string; asset_id: string | null; document_type: string | null; occurred_at: string }[] }>("inbox", { unread: true })
      .then((r) => !cancelled && setPalmMail(r.events.filter((e) => e.type === "document.created")))
      .catch(() => {
        /* Palm not connected: nothing to show */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Entities ───────────────────────────────────────────────────────────
  const scored = useMemo(() => assets.map((a) => ({ ...a, ...entityCompleteness(a) })), [assets]);
  const byId = useMemo(() => new Map(scored.map((a) => [a.id, a])), [scored]);
  const childrenOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of scored) if (a.ownerId && byId.has(a.ownerId)) (m.get(a.ownerId) ?? m.set(a.ownerId, []).get(a.ownerId)!).push(a.id);
    return m;
  }, [scored, byId]);
  const structure = useMemo(() => buildStructure(scored, byId, childrenOf), [scored, byId, childrenOf]);
  const avgScore = scored.length ? Math.round(scored.reduce((s, a) => s + a.score, 0) / scored.length) : 0;
  // A revocable (grantor) trust uses the grantor's SSN; it has no EIN to miss.
  const noEin = scored.filter((a) => !a.ein?.trim() && !(entityType(a) === "Trust" && !/non-grantor/i.test(a.llcType ?? "")));
  const lowest = scored
    .filter((a) => a.score < 100)
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, 3);
  const stateCount = new Set(scored.map((a) => a.state?.trim()).filter(Boolean)).size;

  // ── Needs attention: only what can be acted on now ─────────────────────
  const homeData = home.state === "ok" ? home.data : null;
  const uncategorized = review.state === "ok" ? review.data.counts.uncategorized : (homeData?.review?.uncategorized ?? null);
  const duplicates = review.state === "ok" ? review.data.counts.duplicate_groups : null;
  const inflows = homeData?.inflows ?? null;
  const late = (inflows?.streams ?? []).filter((s) => s.overdue);
  const dueSoon = useMemo(() => {
    const today = new Date();
    const t0 = dayMs(format.isoDate(today));
    const out: { id: string; entity: string; title: string; due: string; days: number }[] = [];
    for (const a of scored) {
      for (const o of obligations(a, today)) {
        if (!o.due) continue;
        const days = Math.round((dayMs(o.due) - t0) / DAY);
        if (days < 0 || days > (o.key === "fed" ? 30 : 60)) continue;
        out.push({ id: a.id, entity: a.name, title: o.title, due: o.due, days });
      }
    }
    return out.sort((x, y) => x.days - y.days);
  }, [scored]);
  // A state's registry with no entry for an entity that has no record from that state yet, and isn't being formed (as the entity's page reads it).
  const notFound = useMemo(
    () =>
      scored.flatMap((a) => {
        const forming = Object.values(a.palm ?? {}).some((p) => p?.formation && p.formation.status !== "completed" && p.formation.status !== "canceled");
        if (forming) return [];
        const home = (a.state ?? "").trim().toUpperCase();
        return Object.entries(a.registryMiss ?? {})
          .filter(([code, m]) => m?.outcome === "not_found" && m.mode !== "test" && (code === home ? !a.stateRecord : !a.foreign?.[code]?.record && !a.foreign?.[code]?.notNeeded))
          .map(([code]) => ({ a, code, file: code === home ? a.fileNumber : a.foreign?.[code]?.fileNumber }));
      }),
    [scored],
  );

  const attention: Attn[] = [];
  if (palmMail.length > 0) {
    const legal = palmMail.filter((m) => m.document_type === "service_of_process");
    const first = legal[0] ?? palmMail[0];
    const nameOf = (id: string | null) => assets.find((a) => a.id === id)?.name ?? "An entity";
    attention.push({
      key: "palm-mail",
      tone: legal.length ? "warning" : "neutral",
      title:
        palmMail.length === 1
          ? `${nameOf(first.asset_id)}: ${DOC_LABEL[first.document_type ?? ""] ?? "New mail"}`
          : `${format.count(palmMail.length, "new letter")} from the registered agent${legal.length ? ` · ${legal.length} legal` : ""}`,
      detail: legal.length ? "Legal papers usually have a deadline to respond" : "Received by your registered agent",
      to: first.asset_id ? `/assets/${first.asset_id}/compliance` : "/assets",
    });
  }
  for (const n of notFound.slice(0, 3)) {
    attention.push({
      key: `nf-${n.a.id}-${n.code}`,
      tone: "warning",
      title: `${stateName(n.code) || n.code} has no record of ${n.a.name}`,
      detail: `${n.file ? `Nothing under file ${n.file}. ` : ""}Confirm the file number or the entity’s status`,
      to: `/assets/${n.a.id}/compliance`,
    });
  }
  if (dueSoon.length > 0) {
    const first = dueSoon[0];
    attention.push({
      key: "filings-due",
      tone: first.days <= 14 ? "warning" : "neutral",
      title: dueSoon.length === 1 ? `${first.entity}: ${first.title}` : `${format.count(dueSoon.length, "filing")} due by ${format.date(dueSoon[dueSoon.length - 1].due)}`,
      detail:
        dueSoon.length === 1
          ? `Due ${soon(first.due)?.toLowerCase() ?? format.date(first.due)}`
          : dueSoon
              .slice(0, 2)
              .map((d) => `${d.entity}, ${format.date(d.due)}`)
              .join(" · ") + (dueSoon.length > 2 ? ` · ${dueSoon.length - 2} more` : ""),
      to: `/assets/${first.id}/compliance`,
    });
  }
  if (uncategorized) {
    attention.push({
      key: "review",
      tone: "neutral",
      title: `${format.count(uncategorized, "transaction")} to categorize`,
      detail: "Until they are, they’re counted in Income and Expenses by direction",
      to: "/books/review",
    });
  }
  if (duplicates) {
    attention.push({
      key: "dupes",
      tone: "warning",
      title: `${format.count(duplicates, "possible duplicate")} in the books`,
      detail: "Same account, date and amount. Check each before it’s counted twice",
      to: "/books/review",
    });
  }
  for (const s of late.slice(0, 3)) {
    attention.push({
      key: `late-${s.source}`,
      tone: "warning",
      title: `${s.source} hasn’t arrived`,
      detail: `Expected ${s.nextExpected ? format.date(s.nextExpected) : "recently"} · usually ${format.money(s.typical, { precision: "dollars" })}`,
      to: "/books/calendar",
    });
  }
  // "Nothing needs you" only when every part that could add an item loaded.
  const attentionReady = assetsLoad === "ok" && home.state === "ok" && homeData?.review != null;
  const attentionFailed = assetsLoad === "failed" || home.state === "failed" || (home.state === "ok" && homeData?.review == null);

  // ── Header ─────────────────────────────────────────────────────────────
  const hour = now.getHours();
  const greeting = hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = user?.name?.trim().split(/\s+/)[0] ?? "";
  const dateLine = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const pnlLoad = pnl.state === "ok" ? "ok" : pnl.state;
  const pnlData = pnl.state === "ok" ? pnl.data : null;
  const lastYearData = lastYear.state === "ok" ? lastYear.data : null;
  const homeLoad = home.state === "ok" ? "ok" : home.state;

  return (
    <Page width="workspace" header={<PageHeader title={`${greeting}${firstName ? `, ${firstName}` : ""}`} context={dateLine} />}>
      <div className="hidden md:block">
        <HomeSearch />
      </div>

      {/* ── Needs attention ─────────────────────────────────────────── */}
      <Card
        title="Needs attention"
        count={attention.length || undefined}
        countTone="attention"
        flush={attention.length > 0 || noEin.length > 0 || lowest.length > 0}
        action={<TextLink to="/books/review">Review desk</TextLink>}
      >
        {attentionFailed && (
          <div className="px-5 pb-3 touch:px-4">
            <Banner
              tone="negative"
              action={
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => {
                    if (assetsLoad === "failed") retryAssets();
                    setHomeTry((n) => n + 1);
                  }}
                >
                  Try again
                </Button>
              }
            >
              {assetsLoad === "failed" ? "Couldn’t load your entities." : "Couldn’t load the books."} This list may be missing items.
            </Banner>
          </div>
        )}
        {!attentionReady && !attentionFailed && attention.length === 0 ? (
          <Skeleton kind="rows" rows={3} />
        ) : (
          <>
            {attention.length > 0 ? (
              <List label="Needs attention" className="px-1">
                {attention.map((a) => (
                  <ListRow
                    key={a.key}
                    to={a.to}
                    title={a.title}
                    label={a.title}
                    secondary={a.detail}
                    leading={a.tone === "warning" ? <span className="block size-2 rounded-full bg-warning" aria-label="Needs you soon" /> : <span className="block size-2" aria-hidden />}
                  />
                ))}
              </List>
            ) : attentionReady ? (
              <p className={cx("text-body text-ink-2", (noEin.length > 0 || lowest.length > 0) && "px-5 pb-3 touch:px-4")}>Nothing needs you today.</p>
            ) : null}
            {assetsLoad === "ok" && (noEin.length > 0 || lowest.length > 0) && (
              <div className="border-t border-line">
                <h3 className="px-5 pt-3 pb-1 text-small font-medium text-ink-2 touch:px-4">Records to complete</h3>
                <List label="Records to complete" className="px-1">
                  {noEin.length > 0 && (
                    <ListRow
                      to={noEin.length === 1 ? `/assets/${noEin[0].id}` : "/assets"}
                      title={noEin.length === 1 ? `No EIN on file for ${noEin[0].name}` : `No EIN on file for ${format.count(noEin.length, "entity", "entities")}`}
                      secondary={`${noEin
                        .slice(0, 3)
                        .map((a) => a.name)
                        .join(" · ")}${noEin.length > 3 ? ` · ${noEin.length - 3} more` : ""}. Banks usually ask for one`}
                    />
                  )}
                  {lowest.map((a) => (
                    <ListRow
                      key={a.id}
                      to={`/assets/${a.id}`}
                      title={a.name}
                      label={a.name}
                      secondary={`Missing ${a.missing
                        .slice(0, 2)
                        .map((m) => m.label.toLowerCase())
                        .join(" and ")}${a.missing.length > 2 ? `, and ${a.missing.length - 2} more` : ""}`}
                      trailing={<span className="text-small font-normal text-ink-2">{format.percent(a.score, { decimals: 0 })}</span>}
                    />
                  ))}
                </List>
              </div>
            )}
          </>
        )}
      </Card>

      {/* ── Money ───────────────────────────────────────────────────── */}
      <CashCard treasury={homeData?.treasury ?? null} load={homeLoad} retry={() => setHomeTry((n) => n + 1)} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <FlowCard kind="income" pnl={pnlData} lastYear={lastYearData} load={pnlLoad} retry={() => setPnlTry((n) => n + 1)} />
        <FlowCard kind="expenses" pnl={pnlData} lastYear={lastYearData} load={pnlLoad} retry={() => setPnlTry((n) => n + 1)} />
        <ComingIn inflows={inflows} load={homeLoad} />
      </div>

      {/* ── Holding structure ───────────────────────────────────────── */}
      <Card title="Holding structure" action={<TextLink to="/assets">All entities</TextLink>} flush={assetsLoad === "ok" && scored.length > 0}>
        {assetsLoad === "loading" ? (
          <Skeleton kind="rows" rows={4} />
        ) : assetsLoad === "failed" ? (
          <Banner
            tone="negative"
            action={
              <Button variant="quiet" size="sm" onClick={retryAssets}>
                Try again
              </Button>
            }
          >
            Couldn’t load your entities.
          </Banner>
        ) : scored.length === 0 ? (
          <Empty action={<TextLink to="/assets">Add an entity</TextLink>}>No entities yet. The companies and trusts you add appear here with who holds them.</Empty>
        ) : (
          <>
            <div className="px-5 pb-4 text-small text-ink-2 touch:px-4">
              <p className="tabular-nums">
                {[format.count(scored.length, "entity", "entities"), typeCounts(scored.map((a) => a.type)), stateCount ? format.count(stateCount, "state") : null].filter(Boolean).join(" · ")} ·{" "}
                records {format.percent(avgScore, { decimals: 0 })} complete on average
              </p>
              {structure.chains.map((c) => (
                <p key={c.links[0].id} className="mt-1 text-pretty">
                  {c.links.map((e, i) => (
                    <span key={e.id}>
                      {i > 0 && <span aria-label="holds"> › </span>}
                      <Link to={`/assets/${e.id}`} className="text-ink hover:underline">
                        {e.name}
                      </Link>
                    </span>
                  ))}{" "}
                  holds {format.count(c.holds, "company", "companies")}, {format.count(c.total, "entity", "entities")} in all. Each link is the largest owner on file.
                </p>
              ))}
            </div>
            <div className="grid grid-cols-1 border-t border-line md:grid-cols-2">
              {structure.groups.map((g) => (
                <section key={g.key} className="min-w-0 border-line pt-3 max-md:border-t max-md:first:border-t-0 md:border-b md:odd:border-r">
                  <div className="px-5 touch:px-4">
                    <h3 className="text-small font-semibold text-ink">
                      {g.head ? (
                        <Link to={`/assets/${g.head.id}`} className="hover:underline">
                          {g.title}
                        </Link>
                      ) : (
                        g.title
                      )}
                    </h3>
                    <p className="text-caption text-ink-2">{g.caption}</p>
                  </div>
                  <List label={g.title} className="mt-1 px-1 pb-2">
                    {g.rows.map(({ e, parent, depth }) => {
                      const share = parent ? shareOf(e, parent.name) : null;
                      return (
                        <ListRow
                          key={e.id}
                          to={`/assets/${e.id}`}
                          title={e.name}
                          label={e.name}
                          secondary={[e.type, e.llcType, e.state, depth > 0 && parent ? `under ${parent.name}` : null, share].filter(Boolean).join(" · ")}
                          trailing={<span className="text-small font-normal text-ink-2">{format.percent(e.score, { decimals: 0 })}</span>}
                        />
                      );
                    })}
                  </List>
                </section>
              ))}
            </div>
            <p className="px-5 py-3 text-small text-pretty text-ink-2 touch:px-4">
              The percentage on each row is how complete its records are. A share shows where the entity’s member list records it.
            </p>
          </>
        )}
      </Card>
    </Page>
  );
}
