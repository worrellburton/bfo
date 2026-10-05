import { useEffect, useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { authFetch, getUser } from "../auth";
import { entityCompleteness } from "../entity-completeness";
import { useTheme } from "../theme";

export function meta() {
  return [
    { title: "BFO" },
    { name: "description", content: "Look, feel and perform your best every day." },
  ];
}

// ── Data shapes ──────────────────────────────────────────────────────────

interface Asset {
  id: string;
  name: string;
  type: "LLC" | "C-Corp";
  state?: string;
  ein?: string;
  ownerId?: string;
  formationDate?: string;
  address?: string;
  registeredAgent?: string;
  llcType?: string;
  einLetter?: unknown;
  w9?: unknown;
  articles?: unknown;
  operatingAgreement?: unknown;
}

type TreasuryRow = { day: string; cash: number; invested: number; credit: number };
type FlowWindow = { in: number; out: number; net: number };
type Stream = {
  source: string;
  entity: string | null;
  monthly: number;
  typical: number;
  nextExpected: string | null;
  overdue: boolean;
  cadence: string;
};
type HomeData = {
  treasury: TreasuryRow[] | null;
  flow: { current: FlowWindow; prior: FlowWindow } | null;
  review: { uncategorized: number } | null;
  inflows: { monthly: number; streams: Stream[] } | null;
};

// ── Formatting ───────────────────────────────────────────────────────────

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtUSD = (n: number) => usd0.format(n);
function fmtCompact(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(a >= 1e10 ? 1 : 2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${sign}$${Math.round(a / 1e3)}K`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${Math.round(a)}`;
}
const pctChange = (cur: number, prev: number): number | null =>
  prev > 0 ? ((cur - prev) / prev) * 100 : null;
const fmtPct = (p: number) => `${p >= 0 ? "+" : "−"}${Math.abs(p) < 10 ? Math.abs(p).toFixed(1) : Math.round(Math.abs(p))}%`;

/** ISO day → Date at local noon, so no timezone nudges it a day either way. */
const dayDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);
const shortDay = (iso: string) => dayDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function relDay(iso: string): string {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const diff = Math.round((dayDate(iso).getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff > 1 && diff < 7) return `in ${diff} days`;
  if (diff < -1 && diff > -30) return `${-diff} days ago`;
  return shortDay(iso);
}

// ── Icons (Heroicons outline paths) ──────────────────────────────────────

const ICONS = {
  tag: "M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z M6 6h.008v.008H6V6z",
  clock: "M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z",
  id: "M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z",
  doc: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z",
  check: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  chevron: "M8.25 4.5l7.5 7.5-7.5 7.5",
  arrowUpRight: "M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25",
  map: "M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z",
  building: "M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21",
  bank: "M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z",
  book: "M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25",
  receipt: "M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0c1.1.128 1.907 1.077 1.907 2.185z",
  arrowDown: "M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3",
  arrowUp: "M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18",
  calendar: "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5",
} as const;

function Icon({ name, className = "h-4 w-4", strokeWidth = 1.7 }: { name: keyof typeof ICONS; className?: string; strokeWidth?: number }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={ICONS[name]} />
    </svg>
  );
}

// ── Small visual primitives ──────────────────────────────────────────────

/** Score colour: emerald when done-ish, indigo mid-way, amber when thin. */
function scoreColor(score: number, isDark: boolean): string {
  if (score >= 85) return isDark ? "#34d399" : "#059669";
  if (score >= 50) return isDark ? "#818cf8" : "#4f46e5";
  return isDark ? "#fbbf24" : "#d97706";
}

function Ring({ score, size = 36, stroke = 3, isDark, label = true }: { score: number; size?: number; stroke?: number; isDark: boolean; label?: boolean }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = scoreColor(score, isDark);
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={isDark ? "rgba(255,255,255,0.08)" : "rgba(17,24,39,0.08)"} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(100, score)) / 100)}
          className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-700"
        />
      </svg>
      {label && (
        <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] font-medium tabular-nums" style={{ fontSize: size >= 48 ? 13 : 10 }}>
          {score}
        </span>
      )}
    </span>
  );
}

function Bone({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <div className={`shimmer ${className}`} style={style} />;
}

// ── Treasury trend chart: hand-rolled SVG, scrubbable ────────────────────

const RANGES = [
  { key: "30", label: "30D", days: 30 },
  { key: "90", label: "90D", days: 90 },
  { key: "all", label: "All", days: Infinity },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

function TrendChart({
  points,
  isDark,
  hover,
  setHover,
}: {
  points: { day: string; value: number }[];
  isDark: boolean;
  hover: number | null;
  setHover: (i: number | null) => void;
}) {
  const W = 1000;
  const H = 200;
  const { line, area, xy, gridYs } = useMemo(() => {
    const vals = points.map((p) => p.value);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi - lo < 1) {
      hi += 1;
      lo -= 1;
    }
    const pad = (hi - lo) * 0.18;
    lo -= pad;
    hi += pad * 0.6;
    const n = points.length;
    const xy = points.map((p, i) => [n === 1 ? W / 2 : (i / (n - 1)) * W, H - ((p.value - lo) / (hi - lo)) * H] as const);
    const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const area = `${line} L${W},${H} L0,${H} Z`;
    const gridYs = [0.25, 0.5, 0.75].map((f) => f * H);
    return { line, area, xy, gridYs };
  }, [points]);

  const accent = isDark ? "#818cf8" : "#4f46e5";
  const last = xy[xy.length - 1];
  const active = hover != null ? xy[hover] : null;
  const gid = isDark ? "home-trend-d" : "home-trend-l";

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(f * (points.length - 1)));
  };

  return (
    <div
      className="relative h-[96px] w-full cursor-crosshair touch-pan-y select-none sm:h-[120px]"
      onPointerMove={onMove}
      onPointerDown={onMove}
      onPointerLeave={() => setHover(null)}
      role="img"
      aria-label={`Cash plus invested over the last ${points.length} days`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity={isDark ? 0.32 : 0.18} />
            <stop offset="100%" stopColor={accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        {gridYs.map((y) => (
          <line
            key={y}
            x1={0}
            x2={W}
            y1={y}
            y2={y}
            stroke={isDark ? "rgba(255,255,255,0.06)" : "rgba(17,24,39,0.06)"}
            strokeDasharray="3 5"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={area} fill={`url(#${gid})`} className="motion-safe:animate-[bfo-fade_0.9s_ease-out_both]" />
        <path d={line} fill="none" stroke={accent} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>

      {/* Live endpoint */}
      {last && hover == null && (
        <span className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${(last[0] / W) * 100}%`, top: `${(last[1] / H) * 100}%` }}>
          <span className="absolute inset-0 rounded-full motion-safe:animate-ping" style={{ background: accent, opacity: 0.35 }} />
          <span className="relative block h-2 w-2 rounded-full" style={{ background: accent, boxShadow: `0 0 12px ${accent}` }} />
        </span>
      )}

      {/* Scrub crosshair */}
      {active && (
        <>
          <span
            className={`pointer-events-none absolute inset-y-0 w-px ${isDark ? "bg-white/20" : "bg-gray-900/15"}`}
            style={{ left: `${(active[0] / W) * 100}%` }}
          />
          <span
            className={`pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${isDark ? "border-gray-950" : "border-white"}`}
            style={{ left: `${(active[0] / W) * 100}%`, top: `${(active[1] / H) * 100}%`, background: accent }}
          />
        </>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [user] = useState(() => (typeof window === "undefined" ? null : getUser()));
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [home, setHome] = useState<HomeData | null>(null);
  const [homeLoading, setHomeLoading] = useState(true);
  const [range, setRange] = useState<RangeKey>("90");
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { db, authReady } = await import("../firebase");
        await authReady;
        const { ref, onValue } = await import("firebase/database");
        if (cancelled) return;
        unsubscribe = onValue(
          ref(db, "assets"),
          (snapshot) => {
            const data = snapshot.val();
            setAssets(
              data
                ? Object.entries(data).map(([id, value]) => ({ id, ...(value as Omit<Asset, "id">) }))
                : []
            );
            setAssetsLoading(false);
          },
          () => setAssetsLoading(false)
        );
      } catch {
        setAssetsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await authFetch("/api/books/data?report=home");
        if (r.ok && !cancelled) setHome((await r.json()) as HomeData);
      } catch {
        /* every card fails soft */
      } finally {
        if (!cancelled) setHomeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Derived: entities ──────────────────────────────────────────────────
  const scored = useMemo(
    () => assets.map((a) => ({ ...a, ...entityCompleteness(a) })),
    [assets]
  );
  const byId = useMemo(() => new Map(scored.map((a) => [a.id, a])), [scored]);
  const childrenOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of scored) if (a.ownerId && byId.has(a.ownerId)) (m.get(a.ownerId) ?? m.set(a.ownerId, []).get(a.ownerId)!).push(a.id);
    return m;
  }, [scored, byId]);
  const descendants = (id: string, seen = new Set<string>()): number => {
    let n = 0;
    for (const c of childrenOf.get(id) ?? []) {
      if (seen.has(c)) continue;
      seen.add(c);
      n += 1 + descendants(c, seen);
    }
    return n;
  };
  const roots = scored
    .filter((a) => !a.ownerId || !byId.has(a.ownerId))
    .map((a) => ({ ...a, subs: descendants(a.id) }))
    .sort((a, b) => b.subs - a.subs || a.name.localeCompare(b.name));
  const avgScore = scored.length ? Math.round(scored.reduce((s, a) => s + a.score, 0) / scored.length) : 0;
  const completeCount = scored.filter((a) => a.score === 100).length;
  const missingEin = scored.filter((a) => !a.ein?.trim());
  const lowest = scored
    .filter((a) => a.score < 100)
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, 3);
  const llcCount = scored.filter((a) => a.type === "LLC").length;
  const corpCount = scored.filter((a) => a.type === "C-Corp").length;
  const stateCount = new Set(scored.map((a) => a.state?.trim()).filter(Boolean)).size;

  // ── Derived: money ─────────────────────────────────────────────────────
  const treasury = home?.treasury?.length ? home.treasury : null;
  const rangeDays = RANGES.find((r) => r.key === range)!.days;
  const series = useMemo(() => {
    if (!treasury) return [];
    const all = treasury.map((t) => ({ day: t.day, value: t.cash + t.invested }));
    return Number.isFinite(rangeDays) ? all.slice(-(rangeDays + 1)) : all;
  }, [treasury, rangeDays]);
  const latest = treasury ? treasury[treasury.length - 1] : null;
  const shown = hover != null && series[hover] ? series[hover] : series[series.length - 1];
  const first = series[0];
  const change = shown && first ? shown.value - first.value : 0;
  const changePct = shown && first && first.value > 0 ? (change / first.value) * 100 : null;

  const flow = home?.flow ?? null;
  const inflows = home?.inflows ?? null;
  const review = home?.review ?? null;
  const upcoming = useMemo(
    () =>
      inflows
        ? [...inflows.streams].sort(
            (a, b) =>
              Number(b.overdue) - Number(a.overdue) ||
              (a.nextExpected ?? "9999").localeCompare(b.nextExpected ?? "9999")
          )
        : [],
    [inflows]
  );
  const overdue = upcoming.filter((s) => s.overdue);
  const nextUp = upcoming.find((s) => !s.overdue && s.nextExpected);

  // ── Needs attention ────────────────────────────────────────────────────
  type Attn = { key: string; icon: keyof typeof ICONS; tone: "amber" | "indigo" | "neutral"; title: ReactNode; detail: ReactNode; to: string; aside?: ReactNode };
  const attention: Attn[] = [];
  if (review && review.uncategorized > 0) {
    attention.push({
      key: "review",
      icon: "tag",
      tone: "amber",
      title: `${review.uncategorized.toLocaleString()} transaction${review.uncategorized === 1 ? "" : "s"} to categorize`,
      detail: "Uncategorized activity keeps the P&L from closing cleanly",
      to: "/books/review",
    });
  }
  for (const s of overdue.slice(0, 3)) {
    attention.push({
      key: `overdue-${s.source}`,
      icon: "clock",
      tone: "amber",
      title: `${s.source} hasn't arrived`,
      detail: `Expected ${s.nextExpected ? relDay(s.nextExpected) : "recently"} · usually ${fmtUSD(s.typical)} ${s.cadence}`,
      to: "/books/calendar",
    });
  }
  if (!assetsLoading && missingEin.length > 0) {
    attention.push({
      key: "ein",
      icon: "id",
      tone: "neutral",
      title: `${missingEin.length} ${missingEin.length === 1 ? "entity is" : "entities are"} missing an EIN`,
      detail: missingEin
        .slice(0, 3)
        .map((a) => a.name)
        .join(", ") + (missingEin.length > 3 ? ` +${missingEin.length - 3} more` : ""),
      to: missingEin.length === 1 ? `/assets/${missingEin[0].id}` : "/assets",
    });
  }
  if (!assetsLoading) {
    for (const a of lowest) {
      attention.push({
        key: `low-${a.id}`,
        icon: "doc",
        tone: "neutral",
        title: a.name,
        detail: `Missing ${a.missing
          .slice(0, 2)
          .map((m) => m.label)
          .join(", ")}${a.missing.length > 2 ? ` +${a.missing.length - 2}` : ""}`,
        to: `/assets/${a.id}`,
        aside: <Ring score={a.score} size={30} stroke={2.5} isDark={isDark} />,
      });
    }
  }
  const attentionReady = !assetsLoading && !homeLoading;

  // ── Tokens ─────────────────────────────────────────────────────────────
  const surface = isDark
    ? "border border-white/[0.08] bg-white/[0.02]"
    : "border border-gray-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_1px_3px_rgba(16,24,40,0.03)]";
  const kicker = "font-mono text-[10px] uppercase tracking-[0.08em] text-gray-500";
  const textMuted = "text-gray-500";
  const textSoft = isDark ? "text-gray-400" : "text-gray-600";
  const hairline = isDark ? "border-white/[0.08]" : "border-gray-200";
  const rowBorder = isDark ? "divide-white/[0.06]" : "divide-gray-100";
  const rowHover = isDark ? "hover:bg-white/[0.025]" : "hover:bg-gray-50/80";
  const accentText = isDark ? "text-[#a5b4fc]" : "text-[#4f46e5]";
  const posChip = isDark ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : "border-emerald-200 bg-emerald-50 text-emerald-700";
  const negChip = isDark ? "border-rose-500/20 bg-rose-500/10 text-rose-300" : "border-rose-200 bg-rose-50 text-rose-700";
  const warnChip = isDark ? "border-amber-500/20 bg-amber-500/10 text-amber-300" : "border-amber-200 bg-amber-50 text-amber-700";
  const neutralChip = isDark ? "border-white/[0.08] bg-white/[0.03] text-gray-400" : "border-gray-200 bg-gray-50 text-gray-600";
  const chipBase = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-medium tabular-nums whitespace-nowrap";
  const toneTile = {
    amber: isDark ? "bg-amber-500/10 text-amber-300" : "bg-amber-50 text-amber-600",
    indigo: isDark ? "bg-[#818cf8]/10 text-[#a5b4fc]" : "bg-[#4f46e5]/[0.07] text-[#4f46e5]",
    neutral: isDark ? "bg-white/[0.04] text-gray-400" : "bg-gray-100 text-gray-500",
  } as const;
  const rise = "motion-safe:animate-[bfo-rise_0.5s_cubic-bezier(0.16,1,0.3,1)_both]";
  const delay = (i: number) => ({ animationDelay: `${i * 60}ms` });

  // ── Header copy ────────────────────────────────────────────────────────
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = user?.name?.trim().split(/\s+/)[0] ?? "";
  const dateLine = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const showHero = homeLoading || !!(treasury && series.length >= 2);
  const showComing = homeLoading || !!inflows;

  // ── KPI tiles ──────────────────────────────────────────────────────────
  const flowDelta = (cur: number, prev: number, upIsGood: boolean) => {
    const p = pctChange(cur, prev);
    if (p == null) return null;
    const good = upIsGood ? p >= 0 : p <= 0;
    return (
      <span className={`${chipBase} ${Math.abs(p) < 1 ? neutralChip : good ? posChip : warnChip}`}>
        <Icon name={p >= 0 ? "arrowUp" : "arrowDown"} className="h-2.5 w-2.5" strokeWidth={2.4} />
        {fmtPct(p)}
      </span>
    );
  };
  const compareBars = (cur: number, prev: number, color: string) => {
    const max = Math.max(cur, prev, 1);
    return (
      <div className="mt-3 space-y-1.5">
        {[
          { label: "30d", v: cur, c: color, o: 1 },
          { label: "prior", v: prev, c: isDark ? "rgba(255,255,255,0.18)" : "rgba(17,24,39,0.14)", o: 1 },
        ].map((b) => (
          <div key={b.label} className="flex items-center gap-2">
            <span className={`w-9 shrink-0 font-mono text-[9.5px] uppercase tracking-[0.1em] ${textMuted}`}>{b.label}</span>
            <span className={`h-1 flex-1 overflow-hidden rounded-full ${isDark ? "bg-white/[0.04]" : "bg-gray-100"}`}>
              <span
                className="block h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700"
                style={{ width: `${Math.max(2, (b.v / max) * 100)}%`, background: b.c }}
              />
            </span>
          </div>
        ))}
      </div>
    );
  };

  type Tile = { key: string; label: string; value: ReactNode; sub: ReactNode; corner?: ReactNode; foot?: ReactNode; to?: string };
  const tiles: (Tile | "loading")[] = [];
  if (homeLoading) tiles.push("loading", "loading", "loading");
  else {
    if (flow) {
      tiles.push({
        key: "in",
        label: "Money in",
        value: fmtCompact(flow.current.in),
        sub: <>30d · vs {fmtCompact(flow.prior.in)} prior</>,
        corner: flowDelta(flow.current.in, flow.prior.in, true),
        foot: compareBars(flow.current.in, flow.prior.in, isDark ? "#34d399" : "#059669"),
        to: "/books/transactions",
      });
      tiles.push({
        key: "out",
        label: "Money out",
        value: fmtCompact(flow.current.out),
        sub: <>30d · vs {fmtCompact(flow.prior.out)} prior</>,
        corner: flowDelta(flow.current.out, flow.prior.out, false),
        foot: compareBars(flow.current.out, flow.prior.out, isDark ? "#818cf8" : "#4f46e5"),
        to: "/books/transactions",
      });
    }
    if (inflows) {
      tiles.push({
        key: "expected",
        label: "Expected / mo",
        value: fmtCompact(inflows.monthly),
        sub: `${inflows.streams.length} recurring source${inflows.streams.length === 1 ? "" : "s"}`,
        foot: (
          <>
            {inflows.monthly > 0 && (
              <div className="mt-3 flex h-1 gap-[2px] overflow-hidden rounded-full">
                {inflows.streams.map((st, k) => (
                  <span
                    key={st.source}
                    className="h-full"
                    style={{
                      width: `${(st.monthly / inflows.monthly) * 100}%`,
                      background: isDark ? "#34d399" : "#059669",
                      opacity: 1 - k * 0.13,
                    }}
                    title={`${st.source}: ${fmtUSD(st.monthly)}/mo`}
                  />
                ))}
              </div>
            )}
            {nextUp?.nextExpected && (
              <p className={`mt-2 truncate text-[11.5px] ${textSoft}`}>
                Next: <span className={isDark ? "text-gray-200" : "text-gray-900"}>{nextUp.source}</span> · {relDay(nextUp.nextExpected)}
              </p>
            )}
          </>
        ),
        to: "/books/calendar",
      });
    }
  }
  if (assetsLoading) tiles.push("loading");
  else if (scored.length) {
    tiles.push({
      key: "complete",
      label: "Completeness",
      value: (
        <>
          {avgScore}
          <span className={`ml-1 text-[13px] font-normal ${textMuted}`}>/ 100</span>
        </>
      ),
      sub: `${completeCount} of ${scored.length} entities at 100`,
      corner: <Ring score={avgScore} size={28} stroke={2.5} isDark={isDark} label={false} />,
      foot: (
        <div className="mt-3 flex h-1 gap-[2px] overflow-hidden rounded-full">
          {[...scored]
            .sort((a, b) => b.score - a.score)
            .map((a) => (
              <span key={a.id} className="h-full flex-1" style={{ background: scoreColor(a.score, isDark), opacity: 0.35 + (a.score / 100) * 0.65 }} title={`${a.name}: ${a.score}`} />
            ))}
        </div>
      ),
      to: "/assets",
    });
  }

  // KPI tiles sit in one row above the chart — four across on desktop.
  const tileGrid = "grid grid-cols-2 gap-3 lg:col-span-12 lg:grid-cols-4";

  const quickLinks: { to: string; label: string; icon: keyof typeof ICONS }[] = [
    { to: "/estate-map", label: "Estate Map", icon: "map" },
    { to: "/assets", label: "Entities", icon: "building" },
    { to: "/treasury", label: "Treasury", icon: "bank" },
    { to: "/books/transactions", label: "Books", icon: "book" },
    { to: "/tools/taxes", label: "Taxes", icon: "receipt" },
  ];

  return (
    <div className="mx-auto max-w-[1280px] space-y-3 sm:space-y-4">
      {/* ── Greeting ─────────────────────────────────────────────────── */}
      <header className={`flex flex-col gap-3 pt-1 sm:flex-row sm:items-end sm:justify-between ${rise}`}>
        <div className="min-w-0">
          <p className={kicker}>{dateLine}</p>
          <h1 className="mt-1.5 text-[20px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[24px]">
            {greeting}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className={`mt-2 flex items-center gap-2 text-[13px] ${textSoft}`}>
            {!attentionReady ? (
              <>
                <span className={`h-1.5 w-1.5 rounded-full ${isDark ? "bg-white/30" : "bg-gray-300"}`} />
                Checking on everything…
              </>
            ) : attention.length ? (
              <>
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inset-0 rounded-full bg-amber-400 opacity-60 motion-safe:animate-ping" />
                  <span className="relative h-1.5 w-1.5 rounded-full bg-amber-400" />
                </span>
                <span>
                  <span className={isDark ? "text-gray-100" : "text-gray-900"}>
                    {attention.length} thing{attention.length === 1 ? "" : "s"}
                  </span>{" "}
                  need{attention.length === 1 ? "s" : ""} you today
                </span>
              </>
            ) : (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                All clear — nothing needs you today
              </>
            )}
          </p>
        </div>
        {latest && (
          <p className={`flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] ${textMuted}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]" />
            Treasury as of {shortDay(latest.day)}
          </p>
        )}
      </header>

      {/* ── Hero + KPI tiles ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        {showHero && (
          <section className={`relative order-last overflow-hidden rounded-2xl lg:col-span-12 ${surface} ${rise}`} style={delay(1)}>
            <div className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent ${isDark ? "via-[#818cf8]/70" : "via-[#4f46e5]/50"} to-transparent`} />
            <div className={`pointer-events-none absolute -top-28 left-1/3 h-48 w-1/2 rounded-full blur-3xl ${isDark ? "bg-[#818cf8]/[0.09]" : "bg-[#4f46e5]/[0.05]"}`} />
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage: `radial-gradient(${isDark ? "rgba(255,255,255,0.055)" : "rgba(17,24,39,0.06)"} 1px, transparent 1px)`,
                backgroundSize: "18px 18px",
                maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.9), transparent 70%)",
                WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,0.9), transparent 70%)",
              }}
            />
            {homeLoading || !shown ? (
              <div className="relative space-y-4 p-5 sm:p-6">
                <Bone className="h-3 w-40" />
                <Bone className="h-10 w-64 max-w-full" />
                <Bone className="h-[96px] w-full sm:h-[120px]" />
                <div className="grid grid-cols-3 gap-4">
                  <Bone className="h-8" />
                  <Bone className="h-8" />
                  <Bone className="h-8" />
                </div>
              </div>
            ) : (
              <div className="relative">
                <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
                  <div className="min-w-0">
                    <p className={kicker}>
                      Net position
                      <span className="mx-1.5 opacity-50">/</span>
                      {hover != null ? shortDay(shown.day) : "cash + invested"}
                    </p>
                    <p className="mt-2 text-[26px] font-semibold leading-none tracking-[-0.025em] tabular-nums sm:text-[32px]">
                      {fmtUSD(shown.value)}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className={`${chipBase} ${change >= 0 ? posChip : negChip}`}>
                        <Icon name={change >= 0 ? "arrowUp" : "arrowDown"} className="h-2.5 w-2.5" strokeWidth={2.4} />
                        {change >= 0 ? "+" : "−"}
                        {fmtCompact(Math.abs(change))}
                        {changePct != null && <span className="opacity-70">· {fmtPct(changePct)}</span>}
                      </span>
                      <span className={`text-[11.5px] ${textMuted}`}>
                        {hover != null ? `since ${shortDay(first.day)}` : `over ${series.length - 1} days`}
                      </span>
                    </div>
                  </div>
                  <div
                    className={`flex rounded-lg border p-0.5 ${hairline} ${isDark ? "bg-white/[0.02]" : "bg-gray-50"}`}
                    role="group"
                    aria-label="Range"
                  >
                    {RANGES.map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => {
                          setRange(r.key);
                          setHover(null);
                        }}
                        aria-pressed={range === r.key}
                        className={`h-6 cursor-pointer rounded-md px-2.5 font-mono text-[10px] tracking-[0.08em] transition-colors ${
                          range === r.key
                            ? isDark
                              ? "bg-white/[0.09] text-white"
                              : "bg-white text-gray-900 shadow-sm"
                            : `${textMuted} ${isDark ? "hover:text-gray-200" : "hover:text-gray-900"}`
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-2 px-1 sm:px-2">
                  <TrendChart points={series} isDark={isDark} hover={hover} setHover={setHover} />
                </div>
                <div className={`flex justify-between px-5 pb-1 pt-1.5 font-mono text-[9.5px] uppercase tracking-[0.08em] sm:px-6 ${textMuted}`}>
                  <span>{shortDay(first.day)}</span>
                  <span>{shortDay(series[series.length - 1].day)}</span>
                </div>

                {latest && (() => {
                  const net = latest.cash + latest.invested;
                  const cashPct = net > 0 ? (latest.cash / net) * 100 : 50;
                  const cashColor = isDark ? "rgba(129,140,248,0.45)" : "rgba(79,70,229,0.35)";
                  const invColor = isDark ? "#818cf8" : "#4f46e5";
                  const parts = [
                    { label: "Cash", value: latest.cash, dot: cashColor },
                    { label: "Invested", value: latest.invested, dot: invColor },
                    { label: "Credit owed", value: latest.credit, dot: isDark ? "rgba(255,255,255,0.25)" : "rgba(17,24,39,0.2)" },
                  ];
                  return (
                    <div className={`mt-2 border-t px-5 pb-4 pt-3 ${hairline}`}>
                      <div className="flex h-1.5 overflow-hidden rounded-full">
                        <span style={{ width: `${cashPct}%`, background: cashColor }} />
                        <span className="ml-[2px] flex-1" style={{ background: invColor }} />
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-3">
                        {parts.map((p) => (
                          <div key={p.label} className="min-w-0">
                            <p className={`flex items-center gap-1.5 ${kicker}`}>
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: p.dot }} />
                              <span className="truncate">{p.label}</span>
                            </p>
                            <p className="mt-1 truncate text-[13px] font-medium tabular-nums">
                              <span className="sm:hidden">{fmtCompact(p.value)}</span>
                              <span className="hidden sm:inline">{fmtUSD(p.value)}</span>
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </section>
        )}

        <div className={tileGrid}>
          {tiles.map((t, i) =>
            t === "loading" ? (
              <div key={`l${i}`} className={`rounded-2xl p-4 ${surface}`}>
                <Bone className="h-2.5 w-20" />
                <Bone className="mt-3 h-6 w-24" />
                <Bone className="mt-2 h-2.5 w-16" />
                <Bone className="mt-4 h-1.5 w-full" />
              </div>
            ) : (
              <Link
                key={t.key}
                to={t.to ?? "/"}
                className={`group relative flex min-w-0 flex-col rounded-2xl p-4 transition-colors ${surface} ${
                  isDark ? "hover:border-white/[0.14] hover:bg-white/[0.035]" : "hover:border-gray-300"
                } ${rise}`}
                style={delay(i + 2)}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className={`${kicker} truncate`}>{t.label}</p>
                  {t.corner ? <span className="-mt-0.5 shrink-0">{t.corner}</span> : null}
                </div>
                <p className="mt-2 text-[20px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{t.value}</p>
                <p className={`mt-1.5 truncate text-[11.5px] ${textMuted}`}>{t.sub}</p>
                <div className="mt-auto">{t.foot}</div>
              </Link>
            )
          )}
        </div>
      </div>

      {/* ── Needs attention + Coming in ──────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-12">
        <section className={`overflow-hidden rounded-2xl ${showComing ? "lg:col-span-7" : "lg:col-span-12"} ${surface} ${rise}`} style={delay(6)}>
          <div className={`flex items-center justify-between gap-3 border-b px-5 py-3.5 ${hairline}`}>
            <div className="flex items-center gap-2.5">
              <p className={kicker}>Needs attention</p>
              {attentionReady && attention.length > 0 && <span className={`${chipBase} ${warnChip}`}>{attention.length}</span>}
            </div>
            <Link to="/books/review" className={`text-[11.5px] ${textMuted} ${isDark ? "hover:text-gray-200" : "hover:text-gray-900"}`}>
              Review desk →
            </Link>
          </div>
          {!attentionReady && attention.length === 0 ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Bone className="h-8 w-8 shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Bone className="h-3" style={{ width: `${70 - i * 12}%` }} />
                    <Bone className="h-2.5" style={{ width: `${50 - i * 8}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : attention.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-5 py-10 text-center">
              <span className={`flex h-10 w-10 items-center justify-center rounded-full ${isDark ? "bg-emerald-500/10 text-emerald-300" : "bg-emerald-50 text-emerald-600"}`}>
                <Icon name="check" className="h-5 w-5" />
              </span>
              <p className="text-[14px] font-medium">All clear</p>
              <p className={`text-[12px] ${textMuted}`}>Books are categorized, inflows on time and records complete.</p>
            </div>
          ) : (
            <ul className={`divide-y ${rowBorder}`}>
              {attention.map((a) => (
                <li key={a.key}>
                  <Link to={a.to} className={`group flex items-center gap-3 px-5 py-3 transition-colors ${rowHover}`}>
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${toneTile[a.tone]}`}>
                      <Icon name={a.icon} className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{a.title}</span>
                      <span className={`block truncate text-[11.5px] ${textMuted}`}>{a.detail}</span>
                    </span>
                    {a.aside}
                    <Icon
                      name="chevron"
                      className={`h-3.5 w-3.5 shrink-0 ${textMuted} transition-transform motion-safe:group-hover:translate-x-0.5`}
                      strokeWidth={2}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {showComing && (
          <section className={`overflow-hidden rounded-2xl lg:col-span-5 ${surface} ${rise}`} style={delay(7)}>
            <div className={`flex items-center justify-between gap-3 border-b px-5 py-3.5 ${hairline}`}>
              <div className="flex min-w-0 items-baseline gap-2.5">
                <p className={kicker}>Coming in</p>
                {inflows && (
                  <span className={`truncate text-[11.5px] tabular-nums ${textMuted}`}>
                    ≈ <span className={accentText}>{fmtUSD(inflows.monthly)}</span> / mo
                  </span>
                )}
              </div>
              <Link to="/books/calendar" className={`shrink-0 text-[11.5px] ${textMuted} ${isDark ? "hover:text-gray-200" : "hover:text-gray-900"}`}>
                Calendar →
              </Link>
            </div>
            {homeLoading ? (
              <div className="space-y-3 p-5">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Bone className="h-9 w-10 shrink-0" />
                    <Bone className="h-3 flex-1" />
                    <Bone className="h-3 w-14" />
                  </div>
                ))}
              </div>
            ) : upcoming.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-5 py-10 text-center">
                <span className={`flex h-10 w-10 items-center justify-center rounded-full ${toneTile.neutral}`}>
                  <Icon name="calendar" className="h-5 w-5" />
                </span>
                <p className={`text-[12px] ${textMuted}`}>No recurring inflows detected yet.</p>
              </div>
            ) : (
              <ul className={`divide-y ${rowBorder}`}>
                {upcoming.map((s) => {
                  const d = s.nextExpected ? dayDate(s.nextExpected) : null;
                  return (
                    <li key={s.source}>
                      <Link to="/books/calendar" className={`flex items-center gap-3 px-5 py-2.5 transition-colors ${rowHover}`}>
                        <span
                          className={`flex w-10 shrink-0 flex-col items-center rounded-lg border py-1 ${
                            s.overdue
                              ? isDark
                                ? "border-amber-500/25 bg-amber-500/[0.06]"
                                : "border-amber-200 bg-amber-50"
                              : `${hairline} ${isDark ? "bg-white/[0.02]" : "bg-gray-50"}`
                          }`}
                        >
                          <span className={`font-mono text-[8.5px] uppercase tracking-[0.08em] ${s.overdue ? "text-amber-400" : textMuted}`}>
                            {d ? d.toLocaleDateString("en-US", { month: "short" }) : "—"}
                          </span>
                          <span className="text-[14px] font-semibold leading-tight tabular-nums">{d ? d.getDate() : "?"}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{s.source}</span>
                          <span className={`block truncate text-[11px] capitalize ${textMuted}`}>
                            {s.overdue ? <span className="text-amber-400 normal-case">Overdue · </span> : null}
                            {s.cadence}
                            {s.entity ? ` · ${s.entity}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-[13px] font-medium tabular-nums">{fmtUSD(s.typical)}</span>
                          {s.nextExpected && <span className={`block text-[10.5px] ${textMuted}`}>{relDay(s.nextExpected)}</span>}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>

      {/* ── Entities ─────────────────────────────────────────────────── */}
      <section className={`rounded-2xl ${surface} ${rise}`} style={delay(8)}>
        <div className={`flex flex-col gap-3 border-b px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between ${hairline}`}>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <p className={kicker}>Holding structure</p>
            {!assetsLoading && (
              <span className={`text-[11.5px] tabular-nums ${textMuted}`}>
                {scored.length} entities · {llcCount} LLC · {corpCount} C-Corp · {stateCount} state{stateCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <nav className="-mx-1 flex flex-wrap gap-1.5" aria-label="Jump to">
            {quickLinks.map((q) => (
              <Link
                key={q.to}
                to={q.to}
                className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] font-medium transition-colors ${hairline} ${
                  isDark ? "text-gray-300 hover:border-white/20 hover:bg-white/[0.04] hover:text-white" : "text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <Icon name={q.icon} className="h-3.5 w-3.5 opacity-70" />
                {q.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="p-3 sm:p-4">
          {assetsLoading ? (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Bone key={i} className="h-[62px]" />
              ))}
            </div>
          ) : roots.length === 0 ? (
            <p className={`px-2 py-6 text-center text-[12px] ${textMuted}`}>
              No entities yet.{" "}
              <Link to="/assets" className={accentText}>
                Add one →
              </Link>
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {roots.map((e) => (
                <Link
                  key={e.id}
                  to={`/assets/${e.id}`}
                  className={`group flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${hairline} ${
                    isDark ? "bg-white/[0.015] hover:border-white/[0.16] hover:bg-white/[0.04]" : "bg-white hover:border-gray-300 hover:bg-gray-50/70"
                  }`}
                >
                  <Ring score={e.score} size={36} stroke={2.75} isDark={isDark} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{e.name}</span>
                    <span className={`mt-0.5 flex items-center gap-1.5 text-[11px] ${textMuted}`}>
                      <span
                        className={`rounded px-1 py-px font-mono text-[9.5px] tracking-[0.04em] ${
                          e.type === "C-Corp"
                            ? isDark
                              ? "bg-[#818cf8]/12 text-[#a5b4fc]"
                              : "bg-[#4f46e5]/[0.07] text-[#4f46e5]"
                            : isDark
                              ? "bg-white/[0.06] text-gray-300"
                              : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {e.type}
                      </span>
                      <span className="truncate">
                        {e.state || "No state"}
                        {e.subs ? ` · ${e.subs} sub${e.subs === 1 ? "" : "s"}` : ""}
                      </span>
                    </span>
                  </span>
                  <Icon
                    name="arrowUpRight"
                    className={`h-3.5 w-3.5 shrink-0 ${textMuted} opacity-0 transition-opacity group-hover:opacity-100`}
                    strokeWidth={2}
                  />
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
