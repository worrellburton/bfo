import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "react-router";
import { authFetch } from "../auth";
import { useTheme } from "../theme";
import { Icon, Menu, PATHS, tiers, textInput, ruleBorder, hairline as hairlineOf } from "../books-shared";

export function meta() {
  return [
    { title: "Investments · BFO" },
    { name: "description", content: "Holdings, allocation and income across every brokerage account." },
  ];
}

// ── Data shapes (api/plaid/data?report=investments) ──────────────────────

type InvAccount = {
  item_id: string;
  institution_name: string;
  institution_color: string | null;
  institution_logo: string | null;
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  balance_current: number | null;
  currency: string | null;
  nickname: string | null;
  entity_id: string | null;
  entity_name: string | null;
  holdings_count: number;
  holdings_value: number;
};

type Holding = {
  item_id: string;
  account_id: string;
  security_id: string;
  ticker: string | null;
  name: string;
  type: string | null;
  is_cash_equivalent: boolean;
  money_market: boolean;
  quantity: number;
  price: number;
  price_as_of: string | null;
  value: number;
  cost_basis: number | null;
  currency: string | null;
};

type InvError = { item_id: string; institution: string; code: string | null; reconnect: boolean; message: string };

type Income = {
  last90: number;
  ttm: number;
  dividends90: number;
  interest90: number;
  byMonth: { month: string; dividends: number; interest: number }[];
  bySecurity: { ticker: string | null; name: string; amount: number }[];
} | null;

type InvData = {
  asOf: string;
  accounts: InvAccount[];
  holdings: Holding[];
  errors: InvError[];
  history: { day: string; invested: number }[];
  income: Income;
  activity?: { buys90: number; sells90: number };
};

// ── Formatting ───────────────────────────────────────────────────────────

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const fmtUSD = (n: number) => usd0.format(n);
const fmtSigned = (n: number) => `${n >= 0 ? "+" : "−"}${usd0.format(Math.abs(n))}`;
function fmtCompact(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(a >= 1e10 ? 1 : 2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${sign}$${Math.round(a / 1e3)}K`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${Math.round(a)}`;
}
function fmtPct(p: number, signed = true): string {
  const a = Math.abs(p);
  const body = a < 10 ? a.toFixed(a < 0.1 && a > 0 ? 2 : 1) : a.toFixed(0);
  return signed ? `${p >= 0 ? "+" : "−"}${body}%` : `${body}%`;
}
const dayDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);
/** "Oct 6", or "Oct 6, 2025" once the day falls outside the current year. */
const shortDay = (iso: string) => {
  const d = dayDate(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
};
const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ── Classification ───────────────────────────────────────────────────────

type AssetClass = "equity" | "etf" | "mutual" | "fixed" | "cash" | "other";

/** Fixed order = fixed colour slot (colour follows the class, never its rank). */
const CLASSES: { key: AssetClass; label: string; dark: string; light: string }[] = [
  { key: "equity", label: "Stocks", dark: "#7f77f1", light: "#4f46e5" },
  { key: "etf", label: "ETFs", dark: "#d95926", light: "#eb6834" },
  { key: "mutual", label: "Mutual funds", dark: "#199e70", light: "#1baf7a" },
  { key: "fixed", label: "Fixed income", dark: "#c98500", light: "#eda100" },
  { key: "cash", label: "Cash & money market", dark: "#d55181", light: "#e87ba4" },
  { key: "other", label: "Other", dark: "#6b7280", light: "#9ca3af" },
];
const CLASS_BY_KEY = new Map(CLASSES.map((c) => [c.key, c]));

function classify(h: Holding): AssetClass {
  if (h.money_market || h.is_cash_equivalent || h.type === "cash") return "cash";
  switch (h.type) {
    case "equity":
      return "equity";
    case "etf":
      return "etf";
    case "mutual fund":
      return "mutual";
    case "fixed income":
      return "fixed";
    default:
      return "other";
  }
}

/** "ira" → "IRA", "brokerage" → "Brokerage", "roth_401k" → "Roth 401k". */
function subtypeLabel(sub: string | null): string | null {
  if (!sub) return null;
  return sub
    .split(/[_\s]+/)
    .map((w) => (/^(ira|sep|hsa|ugma|utma|529|401a|403b|457b|esa|tfsa|rrsp|sipp|isa)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

function accountLabel(a: InvAccount): string {
  const base = a.nickname || a.official_name || a.name || "Account";
  return a.mask && !base.includes(a.mask) ? `${base} ··${a.mask}` : base;
}

/** What an account is worth: its positions when it reports any, else its balance. */
const accountValue = (a: InvAccount) => (a.holdings_count > 0 ? a.holdings_value : a.balance_current ?? 0);

// ── Primitives ───────────────────────────────────────────────────────────

/** Invisible vertical hit-area extension so short controls reach ~40px on touch screens. */
const TAP_Y = "relative after:absolute after:inset-x-0 after:-inset-y-[12px] after:content-[''] lg:after:inset-0";

function Bone({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <div className={`shimmer ${className}`} style={style} aria-hidden />;
}

const RANGES = [
  { key: "30", label: "30D", days: 30 },
  { key: "90", label: "90D", days: 90 },
  { key: "365", label: "1Y", days: 365 },
  { key: "all", label: "All", days: Infinity },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

type Point = { day: string; value: number };

/** Invested value over time: hand-rolled SVG, scrubbable (the Home chart's anatomy). */
function TrendChart({
  points,
  isDark,
  hover,
  setHover,
}: {
  points: Point[];
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
  const gid = isDark ? "inv-trend-d" : "inv-trend-l";

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(f * (points.length - 1)));
  };

  return (
    <div
      className="relative h-[110px] w-full cursor-crosshair touch-pan-y select-none sm:h-[140px]"
      onPointerMove={onMove}
      onPointerDown={onMove}
      onPointerLeave={() => setHover(null)}
      role="img"
      aria-label={`Invested value over the last ${points.length} days`}
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
        <path d={line} fill="none" stroke={accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>

      {last && hover == null && (
        <span className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${(last[0] / W) * 100}%`, top: `${(last[1] / H) * 100}%` }}>
          <span className="absolute inset-0 rounded-full motion-safe:animate-ping" style={{ background: accent, opacity: 0.35 }} />
          <span className="relative block h-2 w-2 rounded-full" style={{ background: accent, boxShadow: `0 0 12px ${accent}` }} />
        </span>
      )}

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
          <PointCard points={points} index={hover!} x={active[0] / W} isDark={isDark} />
        </>
      )}
    </div>
  );
}

/** The scrub popup: the day's value, its move on the prior day and since the range began. */
function PointCard({ points, index, x, isDark }: { points: Point[]; index: number; x: number; isDark: boolean }) {
  const p = points[index];
  if (!p) return null;
  const prev = index > 0 ? points[index - 1] : null;
  const start = points[0];
  const tone = (n: number) =>
    Math.abs(n) < 0.5 ? "text-gray-500" : n > 0 ? (isDark ? "text-emerald-300" : "text-emerald-600") : isDark ? "text-rose-300" : "text-rose-600";
  const pct = (n: number, base: number) => (base ? ` (${fmtPct((n / base) * 100)})` : "");
  const date = dayDate(p.day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const dayMove = prev ? p.value - prev.value : null;
  const rangeMove = p.value - start.value;
  const alignRight = x > 0.55;
  return (
    <div
      className={`pointer-events-none absolute z-20 w-[228px] rounded-xl border p-3 text-[11.5px] shadow-xl backdrop-blur-md ${
        isDark ? "border-white/10 bg-[#0d0f17]/95 text-gray-200 shadow-black/50" : "border-gray-200 bg-white/95 text-gray-800 shadow-gray-900/10"
      }`}
      style={{ left: `${x * 100}%`, top: "50%", transform: `translate(${alignRight ? "calc(-100% - 14px)" : "14px"}, -50%)` }}
    >
      <p className="text-[11px] font-medium text-gray-500">{date}</p>
      <p className="mt-1 text-[16px] font-semibold tabular-nums tracking-[-0.01em]">{fmtUSD(p.value)}</p>
      <div className="mt-1 space-y-0.5 tabular-nums">
        {dayMove != null && (
          <p className="flex justify-between gap-3">
            <span className="text-gray-500">Day change</span>
            <span className={tone(dayMove)}>
              {fmtSigned(dayMove)}
              {pct(dayMove, prev!.value)}
            </span>
          </p>
        )}
        {index > 0 && (
          <p className="flex justify-between gap-3">
            <span className="text-gray-500">Since {shortDay(start.day)}</span>
            <span className={tone(rangeMove)}>
              {fmtSigned(rangeMove)}
              {pct(rangeMove, start.value)}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

/** Institution mark: the Plaid logo when we have it, else a tinted initial. */
function InstitutionDisc({ a, size = 28 }: { a: { institution_name: string; institution_color: string | null; institution_logo: string | null }; size?: number }) {
  if (a.institution_logo) {
    return (
      <img
        src={`data:image/png;base64,${a.institution_logo}`}
        alt=""
        className="shrink-0 rounded-lg bg-white object-contain p-0.5 ring-1 ring-black/5"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold text-white"
      style={{ width: size, height: size, background: a.institution_color || "#6366f1" }}
      aria-hidden
    >
      {(a.institution_name || "?").slice(0, 1)}
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

type SortKey = "name" | "account" | "quantity" | "price" | "value" | "cost" | "gain" | "weight";
type GroupBy = "account" | "institution" | "entity";

export default function Investments() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [data, setData] = useState<InvData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("365");
  const [hover, setHover] = useState<number | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("account");
  const [q, setQ] = useState("");
  const [acct, setAcct] = useState("all");
  const [cls, setCls] = useState<AssetClass | "all">("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "value", dir: "desc" });
  const [incomeHover, setIncomeHover] = useState<number | null>(null);
  const holdingsRef = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    try {
      const r = await authFetch("/api/plaid/data?report=investments");
      const body = await r.json().catch(() => ({}));
      // The API's `message` is written for people; `error` is often a bare code.
      if (!r.ok) throw new Error(body?.message || (r.status >= 500 ? "The server didn't respond. Try again in a moment." : body?.error) || "Couldn't load investments.");
      setData({
        asOf: body.asOf ?? new Date().toISOString(),
        accounts: body.accounts ?? [],
        holdings: body.holdings ?? [],
        errors: body.errors ?? [],
        history: body.history ?? [],
        income: body.income ?? null,
        activity: body.activity,
      });
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Couldn't load investments.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Derived ────────────────────────────────────────────────────────────
  const accounts = data?.accounts ?? [];
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.account_id, a])), [accounts]);
  const total = useMemo(() => accounts.reduce((s, a) => s + accountValue(a), 0), [accounts]);

  const rows = useMemo(
    () =>
      (data?.holdings ?? []).map((h) => {
        const klass = classify(h);
        const gain = klass !== "cash" && h.cost_basis != null && h.cost_basis > 0 ? h.value - h.cost_basis : null;
        const a = accountById.get(h.account_id);
        return {
          ...h,
          klass,
          gain,
          gainPct: gain != null && h.cost_basis ? (gain / h.cost_basis) * 100 : null,
          weight: total > 0 ? (h.value / total) * 100 : 0,
          accountName: a ? accountLabel(a) : "Account",
          institution: a?.institution_name ?? "",
        };
      }),
    [data, accountById, total]
  );

  const gainTotals = useMemo(() => {
    let gain = 0;
    let basis = 0;
    let n = 0;
    for (const r of rows) {
      if (r.gain == null) continue;
      gain += r.gain;
      basis += r.cost_basis ?? 0;
      n++;
    }
    return { gain, basis, n, pct: basis > 0 ? (gain / basis) * 100 : null };
  }, [rows]);

  const allocation = useMemo(() => {
    const sums = new Map<AssetClass, number>();
    for (const r of rows) sums.set(r.klass, (sums.get(r.klass) ?? 0) + r.value);
    // Accounts reporting no positions still count, as "Other".
    for (const a of accounts) if (a.holdings_count === 0 && (a.balance_current ?? 0) > 0) sums.set("other", (sums.get("other") ?? 0) + (a.balance_current ?? 0));
    const sum = [...sums.values()].reduce((s, v) => s + v, 0);
    return CLASSES.filter((c) => (sums.get(c.key) ?? 0) > 0.5).map((c) => ({
      ...c,
      value: sums.get(c.key) ?? 0,
      pct: sum > 0 ? ((sums.get(c.key) ?? 0) / sum) * 100 : 0,
      count: rows.filter((r) => r.klass === c.key).length,
    }));
  }, [rows, accounts]);

  const groups = useMemo(() => {
    const m = new Map<string, { key: string; label: string; sub: string; value: number }>();
    for (const a of accounts) {
      const key = groupBy === "account" ? a.account_id : groupBy === "institution" ? a.institution_name : a.entity_name || "__none__";
      const label = groupBy === "account" ? accountLabel(a) : groupBy === "institution" ? a.institution_name : a.entity_name || "Unmapped";
      const g = m.get(key) ?? {
        key,
        label,
        sub: groupBy === "account" ? [a.institution_name, a.entity_name].filter(Boolean).join(" · ") : "",
        value: 0,
      };
      g.value += accountValue(a);
      m.set(key, g);
    }
    const list = [...m.values()].sort((a, b) => b.value - a.value);
    if (groupBy !== "account")
      for (const g of list) {
        const n = accounts.filter((a) => (groupBy === "institution" ? a.institution_name : a.entity_name || "__none__") === g.key).length;
        g.sub = `${n} account${n === 1 ? "" : "s"}`;
      }
    return list;
  }, [accounts, groupBy]);

  // Trend: the stored daily invested total, plus today's live figure.
  const fullSeries = useMemo(() => {
    const hist = (data?.history ?? []).filter((h) => Number.isFinite(h.invested));
    const firstReal = hist.findIndex((h) => h.invested > 0);
    const pts: Point[] = (firstReal < 0 ? [] : hist.slice(firstReal)).map((h) => ({ day: h.day, value: h.invested }));
    const today = localDay();
    if (total > 0) {
      if (pts.length && pts[pts.length - 1].day >= today) pts[pts.length - 1] = { day: pts[pts.length - 1].day, value: total };
      else if (pts.length) pts.push({ day: today, value: total });
    }
    return pts;
  }, [data, total]);
  const rangeDays = RANGES.find((r) => r.key === range)!.days;
  const series = useMemo(() => {
    if (!Number.isFinite(rangeDays) || !fullSeries.length) return fullSeries;
    const cutoff = new Date(dayDate(fullSeries[fullSeries.length - 1].day).getTime() - rangeDays * 86400000);
    const iso = localDay(cutoff);
    const from = fullSeries.findIndex((p) => p.day >= iso);
    return fullSeries.slice(Math.max(0, from));
  }, [fullSeries, rangeDays]);
  const shown = hover != null && series[hover] ? series[hover] : series[series.length - 1];
  const first = series[0];
  const change = shown && first ? shown.value - first.value : 0;
  const changePct = shown && first && first.value > 0 ? (change / first.value) * 100 : null;

  // Holdings table: filter → sort.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        (acct === "all" || r.account_id === acct) &&
        (cls === "all" || r.klass === cls) &&
        (!needle || `${r.ticker ?? ""} ${r.name} ${r.accountName} ${r.institution}`.toLowerCase().includes(needle))
    );
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (r: (typeof rows)[number]): number | string | null => {
      switch (sort.key) {
        case "name":
          return (r.ticker || r.name).toLowerCase();
        case "account":
          return r.accountName.toLowerCase();
        case "quantity":
          return r.quantity;
        case "price":
          return r.price;
        case "value":
          return r.value;
        case "cost":
          return r.klass === "cash" ? null : r.cost_basis;
        case "gain":
          return r.gainPct;
        case "weight":
          return r.weight;
      }
    };
    return [...list].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null && vb == null) return b.value - a.value;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * dir;
      return ((va as number) - (vb as number)) * dir || b.value - a.value;
    });
  }, [rows, q, acct, cls, sort]);
  const maxWeight = Math.max(0, ...rows.map((r) => r.weight));
  const filteredValue = filtered.reduce((s, r) => s + r.value, 0);
  const isFiltered = acct !== "all" || cls !== "all" || q.trim() !== "";

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" || key === "account" ? "asc" : "desc" }));

  const focusHoldings = (patch: { acct?: string; cls?: AssetClass | "all" }) => {
    if (patch.acct !== undefined) setAcct(patch.acct);
    if (patch.cls !== undefined) setCls(patch.cls);
    requestAnimationFrame(() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      holdingsRef.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    });
  };

  // Income, by calendar month (last 12, oldest first).
  const months = useMemo(() => {
    const now = new Date();
    const byMonth = new Map((data?.income?.byMonth ?? []).map((m) => [m.month, m]));
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const m = byMonth.get(key);
      return {
        key,
        label: d.toLocaleDateString("en-US", { month: "short" }),
        long: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
        dividends: m?.dividends ?? 0,
        interest: m?.interest ?? 0,
        total: (m?.dividends ?? 0) + (m?.interest ?? 0),
      };
    });
  }, [data]);
  const monthMax = Math.max(1, ...months.map((m) => m.total));

  // ── Tokens (Home's card language; Books' table language) ───────────────
  const { t1, t2, t3 } = tiers(isDark);
  const surface = isDark
    ? "border border-white/[0.08] bg-white/[0.02]"
    : "border border-gray-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_1px_3px_rgba(16,24,40,0.03)]";
  const kicker = "text-[12px] font-medium text-gray-500";
  const textMuted = "text-gray-500";
  const textSoft = isDark ? "text-gray-400" : "text-gray-600";
  const hairline = isDark ? "border-white/[0.08]" : "border-gray-200";
  const rowBorder = isDark ? "divide-white/[0.06]" : "divide-gray-100";
  const rowHover = isDark ? "hover:bg-white/[0.025]" : "hover:bg-gray-50/80";
  const accent = isDark ? "#818cf8" : "#4f46e5";
  const accentText = isDark ? "text-[#a5b4fc]" : "text-[#4f46e5]";
  const posText = isDark ? "text-emerald-300" : "text-emerald-600";
  const negText = isDark ? "text-rose-300" : "text-rose-600";
  const posChip = isDark ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : "border-emerald-200 bg-emerald-50 text-emerald-700";
  const negChip = isDark ? "border-rose-500/20 bg-rose-500/10 text-rose-300" : "border-rose-200 bg-rose-50 text-rose-700";
  const chipBase = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums whitespace-nowrap";
  const linkQuiet = `${TAP_Y} text-[11px] ${textMuted} ${isDark ? "hover:text-gray-200" : "hover:text-gray-900"}`;
  const segWrap = `flex rounded-lg border p-0.5 ${hairline} ${isDark ? "bg-white/[0.02]" : "bg-gray-50"}`;
  const segBtn = (on: boolean) =>
    `${TAP_Y} h-6 cursor-pointer rounded-md px-2.5 text-[11px] font-medium transition-colors ${
      on ? (isDark ? "bg-white/[0.09] text-white" : "bg-white text-gray-900 shadow-sm") : `${textMuted} ${isDark ? "hover:text-gray-200" : "hover:text-gray-900"}`
    }`;
  const tickerBadge = `inline-block h-5 min-w-[44px] max-w-[76px] shrink-0 truncate rounded-md px-1.5 text-center leading-5 font-mono text-[10.5px] font-medium tracking-[0.02em] ${
    isDark ? "bg-white/[0.06] text-gray-200" : "bg-gray-100 text-gray-700"
  }`;
  // Every card enters together: one fade + settle, no stagger.
  const enter = "motion-safe:animate-[bfo-pop_0.5s_cubic-bezier(0.16,1,0.3,1)_both]";
  const gainTone = (n: number | null) => (n == null || Math.abs(n) < 0.5 ? t2 : n > 0 ? posText : negText);

  const firstLoad = loading && !data;
  const empty = !loading && !!data && accounts.length === 0;
  const asOf = data ? new Date(data.asOf) : null;
  const institutions = [...new Set(accounts.map((a) => a.institution_name))];

  // ── Pieces ─────────────────────────────────────────────────────────────

  const sortTh = (label: string, key: SortKey, align: "left" | "right" = "left", className = "") => {
    const active = sort.key === key;
    const caret = (
      <Icon
        d={active && sort.dir === "asc" ? PATHS.up : PATHS.down}
        strokeWidth={2}
        className={`h-3 w-3 shrink-0 transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover/th:opacity-60"}`}
      />
    );
    return (
      <th
        scope="col"
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
        className={`group/th px-2 py-2.5 font-medium first:pl-5 last:pr-5 ${align === "right" ? "text-right" : ""} ${className}`}
      >
        <button
          type="button"
          onClick={() => onSort(key)}
          className={`-mx-1.5 -my-0.5 inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 transition-colors ${
            active ? t1 : isDark ? "hover:bg-white/[0.04] hover:text-gray-100" : "hover:bg-gray-100 hover:text-gray-900"
          }`}
        >
          {align === "right" && caret}
          {label}
          {align !== "right" && caret}
        </button>
      </th>
    );
  };

  const classDot = (k: AssetClass) => {
    const c = CLASS_BY_KEY.get(k)!;
    return <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: isDark ? c.dark : c.light }} aria-hidden />;
  };

  const errorsBanner =
    data && data.errors.length > 0 ? (
      <div
        role="status"
        className={`flex flex-col gap-2 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${enter} ${
          isDark ? "border-amber-500/20 bg-amber-500/[0.06]" : "border-amber-200 bg-amber-50/70"
        }`}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${isDark ? "bg-amber-500/15 text-amber-300" : "bg-amber-100 text-amber-700"}`}>
            <Icon d={PATHS.sync} className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <div className="min-w-0 text-[12.5px]">
            {data.errors.map((e) => (
              <p key={e.item_id} className={isDark ? "text-amber-100" : "text-amber-900"}>
                <span className="font-medium">{e.institution}</span>{" "}
                {e.reconnect ? "needs reconnecting" : "couldn't be reached just now"}
                <span className={isDark ? "text-amber-200/60" : "text-amber-800/70"}>
                  {" "}
                  — {e.reconnect ? "its positions aren't included below." : "showing everything else."}
                </span>
              </p>
            ))}
          </div>
        </div>
        <Link
          to="/treasury"
          className={`shrink-0 self-start rounded-full border px-3 py-1 text-[11.5px] font-medium transition-colors sm:self-auto relative after:absolute after:inset-x-0 after:-inset-y-[8px] after:content-[''] lg:after:inset-0 ${
            isDark ? "border-amber-500/25 text-amber-200 hover:bg-amber-500/10" : "border-amber-300 text-amber-800 hover:bg-amber-100"
          }`}
        >
          Reconnect in Treasury →
        </Link>
      </div>
    ) : null;

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-[1180px] space-y-3 px-2 tabular-nums sm:space-y-4 sm:px-8 lg:px-12">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold leading-[1.2] tracking-[-0.015em] sm:text-[22px]">Investments</h1>
          <p className={`mt-1 text-[12.5px] ${textSoft}`}>
            {firstLoad ? (
              "Gathering positions…"
            ) : accounts.length ? (
              <>
                {accounts.length} account{accounts.length === 1 ? "" : "s"}
                {institutions.length ? ` at ${institutions.join(", ")}` : ""} · {rows.length} position{rows.length === 1 ? "" : "s"}
              </>
            ) : (
              "Brokerage holdings, allocation and income"
            )}
          </p>
        </div>
        {asOf && !empty && (
          <p className={`flex items-center gap-1.5 text-[11px] ${textMuted}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]" />
            As of {asOf.toLocaleDateString("en-US", { month: "short", day: "numeric" })},{" "}
            {asOf.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          </p>
        )}
      </header>

      {failed && !data && (
        <section className={`rounded-2xl px-5 py-10 text-center ${surface} ${enter}`}>
          <p className="text-[13px] font-medium">Investments couldn't load</p>
          <p className={`mt-1 text-[12px] ${textMuted}`}>{failed}</p>
          <button
            type="button"
            onClick={() => void load()}
            className={`mt-4 inline-flex h-[40px] sm:h-8 cursor-pointer items-center rounded-full border px-4 text-[12px] font-medium ${hairline} ${
              isDark ? "hover:bg-white/[0.05]" : "hover:bg-gray-50"
            }`}
          >
            Try again
          </button>
        </section>
      )}

      {errorsBanner}

      {empty && (
        <section className={`flex flex-col items-center rounded-2xl px-5 py-14 text-center ${surface} ${enter}`}>
          <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${isDark ? "bg-[#818cf8]/10 text-[#a5b4fc]" : "bg-[#4f46e5]/[0.07] text-[#4f46e5]"}`}>
            <Icon d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" className="h-5 w-5" strokeWidth={1.6} />
          </span>
          <p className="mt-4 text-[14px] font-medium">No investment accounts yet</p>
          <p className={`mt-1 max-w-[340px] text-[12.5px] ${textMuted}`}>
            Connect a brokerage in Treasury and its holdings, allocation and income will appear here.
          </p>
          <Link
            to="/treasury"
            className={`mt-5 inline-flex h-8 items-center rounded-full px-4 text-[12px] font-medium text-white transition-colors ${
              isDark ? "bg-[#6366f1] hover:bg-[#818cf8]" : "bg-[#4f46e5] hover:bg-[#4338ca]"
            }`}
          >
            Connect a brokerage in Treasury
          </Link>
        </section>
      )}

      {(firstLoad || (data && !empty)) && (
        <>
          {/* ── Hero: value, gain, trend ─────────────────────────────────── */}
          <section className={`relative overflow-hidden rounded-2xl ${surface} ${enter}`}>
            <div className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent ${isDark ? "via-[#818cf8]/70" : "via-[#4f46e5]/50"} to-transparent`} />
            <div className={`pointer-events-none absolute -top-28 left-1/3 h-48 w-1/2 rounded-full blur-3xl ${isDark ? "bg-[#818cf8]/[0.09]" : "bg-[#4f46e5]/[0.05]"}`} />
            {firstLoad ? (
              <div className="relative space-y-4 p-5 sm:p-6">
                <Bone className="h-3 w-40" />
                <Bone className="h-10 w-64 max-w-full" />
                <Bone className="h-[110px] w-full sm:h-[140px]" />
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Bone className="h-8" />
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
                      Portfolio value
                      {hover != null && shown && (
                        <>
                          <span className="mx-1.5 opacity-50">/</span>
                          {shortDay(shown.day)}
                        </>
                      )}
                    </p>
                    <p className="mt-1.5 text-[24px] font-semibold leading-none tracking-[-0.02em] sm:text-[28px]">
                      {fmtUSD(hover != null && shown ? shown.value : total)}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {series.length >= 2 ? (
                        <>
                          <span className={`${chipBase} ${change >= 0 ? posChip : negChip}`}>
                            <Icon d={change >= 0 ? PATHS.up : PATHS.down} className="h-2.5 w-2.5" strokeWidth={2.4} />
                            {change >= 0 ? "+" : "−"}
                            {fmtCompact(Math.abs(change))}
                            {changePct != null && <span className="opacity-70">· {fmtPct(changePct)}</span>}
                          </span>
                          <span className={`text-[11px] ${textMuted}`}>
                            since {shortDay(first.day)}
                          </span>
                        </>
                      ) : (
                        <span className={`text-[11px] ${textMuted}`}>The trend fills in as daily history accrues.</span>
                      )}
                    </div>
                  </div>
                  {series.length >= 2 && (
                    <div className={segWrap} role="group" aria-label="Range">
                      {RANGES.map((r) => (
                        <button
                          key={r.key}
                          type="button"
                          onClick={() => {
                            setRange(r.key);
                            setHover(null);
                          }}
                          aria-pressed={range === r.key}
                          className={segBtn(range === r.key)}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {series.length >= 2 && (
                  <>
                    <div className="mt-2 px-1 sm:px-2">
                      <TrendChart points={series} isDark={isDark} hover={hover} setHover={setHover} />
                    </div>
                    <div className={`flex justify-between px-5 pb-1 pt-1.5 text-[11px] ${textMuted}`}>
                      <span>{shortDay(first.day)}</span>
                      <span>{shortDay(series[series.length - 1].day)}</span>
                    </div>
                  </>
                )}

                <div className={`mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t px-5 pb-4 pt-3 sm:grid-cols-4 ${hairline}`}>
                  <div className="min-w-0">
                    <p className={kicker}>Unrealized gain</p>
                    <p className={`mt-1 truncate text-[13px] font-medium ${gainTone(gainTotals.n ? gainTotals.gain : null)}`}>
                      {gainTotals.n ? (
                        <>
                          {fmtSigned(gainTotals.gain)}
                          {gainTotals.pct != null && <span className="ml-1.5 text-[11.5px] opacity-80">{fmtPct(gainTotals.pct)}</span>}
                        </>
                      ) : (
                        "—"
                      )}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className={kicker}>Cost basis</p>
                    <p className="mt-1 truncate text-[13px] font-medium">{gainTotals.n ? fmtUSD(gainTotals.basis) : "—"}</p>
                    <p className={`truncate text-[10.5px] ${textMuted}`}>
                      {gainTotals.n ? `${gainTotals.n} position${gainTotals.n === 1 ? "" : "s"}, ex-cash` : "Not reported"}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className={kicker}>Income · 12 mo</p>
                    <p className="mt-1 truncate text-[13px] font-medium">{data?.income ? fmtUSD(data.income.ttm) : "—"}</p>
                    {data?.income && total > 0 && (
                      <p className={`truncate text-[10.5px] ${textMuted}`}>{fmtPct((data.income.ttm / total) * 100, false)} trailing yield</p>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className={kicker}>Cash & money market</p>
                    {(() => {
                      const c = allocation.find((a) => a.key === "cash");
                      return (
                        <>
                          <p className="mt-1 truncate text-[13px] font-medium">{c ? fmtUSD(c.value) : "—"}</p>
                          {c && <p className={`truncate text-[10.5px] ${textMuted}`}>{fmtPct(c.pct, false)} of portfolio</p>}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* ── Allocation ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-12">
            <section className={`overflow-hidden rounded-2xl lg:col-span-7 ${surface} ${enter}`}>
              <div className={`flex items-center justify-between gap-3 border-b px-5 py-3.5 ${hairline}`}>
                <p className={kicker}>Allocation by asset type</p>
                {cls !== "all" && (
                  <button type="button" onClick={() => setCls("all")} className={`cursor-pointer ${linkQuiet}`}>
                    Clear filter
                  </button>
                )}
              </div>
              {firstLoad ? (
                <div className="space-y-4 p-5">
                  <Bone className="h-2.5 w-full" />
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Bone className="h-3 flex-1" style={{ maxWidth: `${60 - i * 8}%` }} />
                      <Bone className="ml-auto h-3 w-20" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-5 pb-3 pt-4">
                  {/* Segmented bar: 2px surface gaps between fills, rounded ends. */}
                  <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={allocation.map((a) => `${a.label} ${fmtPct(a.pct, false)}`).join(", ")}>
                    {allocation.map((a) => (
                      <span
                        key={a.key}
                        className={`h-full transition-opacity first:rounded-l-full last:rounded-r-full ${cls !== "all" && cls !== a.key ? "opacity-30" : ""}`}
                        style={{ width: `${a.pct}%`, minWidth: 3, background: isDark ? a.dark : a.light }}
                        title={`${a.label} · ${fmtUSD(a.value)} · ${fmtPct(a.pct, false)}`}
                      />
                    ))}
                  </div>
                  <ul className={`mt-3 divide-y ${rowBorder}`}>
                    {allocation.map((a) => {
                      const on = cls === a.key;
                      return (
                        <li key={a.key}>
                          <button
                            type="button"
                            onClick={() => focusHoldings({ cls: on ? "all" : a.key })}
                            aria-pressed={on}
                            className={`-mx-2 flex w-[calc(100%+1rem)] cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors ${rowHover} ${
                              on ? (isDark ? "bg-white/[0.04]" : "bg-gray-50") : ""
                            }`}
                            title="Show these holdings"
                          >
                            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: isDark ? a.dark : a.light }} aria-hidden />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] font-medium">{a.label}</span>
                              <span className={`block text-[11px] ${textMuted}`}>
                                {a.count ? `${a.count} holding${a.count === 1 ? "" : "s"}` : "Account balance"}
                              </span>
                            </span>
                            <span className="text-right">
                              <span className="block text-[12.5px] font-medium">{fmtUSD(a.value)}</span>
                              <span className={`block text-[11px] ${textMuted}`}>{fmtPct(a.pct, false)}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </section>

            <section className={`overflow-hidden rounded-2xl lg:col-span-5 ${surface} ${enter}`}>
              <div className={`flex items-center justify-between gap-3 border-b px-5 py-3 ${hairline}`}>
                <p className={kicker}>Where it sits</p>
                <div className={segWrap} role="group" aria-label="Group by">
                  {(["account", "institution", "entity"] as const).map((g) => (
                    <button key={g} type="button" aria-pressed={groupBy === g} onClick={() => setGroupBy(g)} className={segBtn(groupBy === g)}>
                      {g === "account" ? "Account" : g === "institution" ? "Institution" : "Entity"}
                    </button>
                  ))}
                </div>
              </div>
              {firstLoad ? (
                <div className="space-y-4 p-5">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="space-y-2">
                      <Bone className="h-3" style={{ width: `${55 - i * 10}%` }} />
                      <Bone className="h-1.5 w-full" />
                    </div>
                  ))}
                </div>
              ) : (
                <ul className="space-y-3.5 px-5 py-4">
                  {groups.map((g) => {
                    const pct = total > 0 ? (g.value / total) * 100 : 0;
                    return (
                      <li key={g.key}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate text-[12.5px] font-medium">{g.label}</span>
                            {g.sub && <span className={`block truncate text-[11px] ${textMuted}`}>{g.sub}</span>}
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="text-[12.5px] font-medium">{fmtUSD(g.value)}</span>
                            <span className={`ml-2 text-[11px] ${textMuted}`}>{fmtPct(pct, false)}</span>
                          </span>
                        </div>
                        <div className={`mt-1.5 h-1.5 overflow-hidden rounded-full ${isDark ? "bg-white/[0.05]" : "bg-gray-100"}`}>
                          <div className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${pct}%`, background: accent }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          {/* ── Holdings ───────────────────────────────────────────────── */}
          <section ref={holdingsRef} className={`scroll-mt-4 overflow-hidden rounded-2xl ${surface} ${enter}`}>
            <div className={`flex flex-col gap-3 border-b px-4 py-3 sm:px-5 lg:flex-row lg:items-center ${ruleBorder(isDark)}`}>
              <div className="flex min-w-0 items-baseline gap-2.5 lg:mr-auto">
                <p className={kicker}>Holdings</p>
                {!firstLoad && (
                  <span className={`text-[11px] ${textMuted}`}>
                    {isFiltered ? `${filtered.length} of ${rows.length} · ${fmtUSD(filteredValue)}` : `${rows.length} positions`}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
                  <Icon d={PATHS.search} className={`pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${t3}`} strokeWidth={2} />
                  <input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search ticker or name"
                    aria-label="Search holdings"
                    className={`h-[40px] w-full cursor-text rounded-full border pl-9 pr-4 text-[16px] placeholder:text-sm sm:h-9 sm:text-sm [&::-webkit-search-cancel-button]:appearance-none ${textInput(isDark)}`}
                  />
                </div>
                {accounts.length > 1 && (
                  <div className="max-w-[260px] [&>button]:max-w-full">
                    <Menu
                      value={acct}
                      isDark={isDark}
                      size="md"
                      label="Account"
                      onChange={setAcct}
                      options={[
                        { value: "all", label: "All accounts" },
                        ...accounts.map((a) => ({ value: a.account_id, label: accountLabel(a), hint: a.institution_name })),
                      ]}
                    />
                  </div>
                )}
                {cls !== "all" && (
                  <button
                    type="button"
                    onClick={() => setCls("all")}
                    className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium ${hairline} ${
                      isDark ? "hover:bg-white/[0.05]" : "hover:bg-gray-50"
                    }`}
                  >
                    {classDot(cls)}
                    {CLASS_BY_KEY.get(cls)!.label}
                    <Icon d={PATHS.close} className="h-3 w-3 opacity-60" strokeWidth={2} />
                  </button>
                )}
              </div>
            </div>

            {firstLoad ? (
              <div className="space-y-0">
                {Array.from({ length: 7 }, (_, i) => (
                  <div key={i} className={`flex items-center gap-3 px-5 py-3 ${i ? `border-t ${hairlineOf(isDark)}` : ""}`}>
                    <Bone className="h-5 w-11" />
                    <Bone className="h-3 w-48" />
                    <Bone className="ml-auto h-3 w-20" />
                    <Bone className="hidden h-3 w-16 sm:block" />
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-14 text-center">
                <Icon d={PATHS.search} className={`mx-auto h-6 w-6 ${t3}`} strokeWidth={1.4} />
                <p className={`mt-3 text-sm font-medium ${t1}`}>{rows.length ? "No holdings match" : "No positions reported"}</p>
                <p className={`mt-1 text-xs ${t2}`}>
                  {rows.length ? "Try a different search or account." : "These accounts report balances but no individual positions."}
                </p>
                {isFiltered && (
                  <button
                    type="button"
                    onClick={() => {
                      setQ("");
                      setAcct("all");
                      setCls("all");
                    }}
                    className={`mt-3 cursor-pointer text-[12px] font-medium ${accentText}`}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Table: sm and up */}
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full min-w-[640px] text-sm tabular-nums">
                    <thead>
                      <tr className={`border-b text-left text-xs font-medium ${t2} ${ruleBorder(isDark)}`}>
                        {sortTh("Holding", "name")}
                        {sortTh("Account", "account", "left", "hidden lg:table-cell")}
                        {sortTh("Quantity", "quantity", "right", "hidden xl:table-cell")}
                        {sortTh("Price", "price", "right", "hidden md:table-cell")}
                        {sortTh("Value", "value", "right")}
                        {sortTh("Cost basis", "cost", "right", "hidden lg:table-cell")}
                        {sortTh("Gain / loss", "gain", "right")}
                        {sortTh("Weight", "weight", "right", "w-[120px]")}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r, i) => (
                        <tr key={`${r.account_id}-${r.security_id}`} className={`transition-colors ${i ? `border-t ${hairlineOf(isDark)}` : ""} ${isDark ? "hover:bg-white/[0.03]" : "hover:bg-gray-50"}`}>
                          <td className="py-2.5 pl-5 pr-2">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className={tickerBadge} title={r.ticker ?? undefined}>{r.ticker || "—"}</span>
                              <span className="min-w-0">
                                <span className={`block max-w-[320px] truncate text-[13px] ${t1}`} title={r.name}>
                                  {r.name}
                                </span>
                                <span className={`flex items-center gap-1.5 text-[11px] ${t2}`}>
                                  {classDot(r.klass)}
                                  {CLASS_BY_KEY.get(r.klass)!.label}
                                  <span className="lg:hidden">· {r.accountName}</span>
                                </span>
                              </span>
                            </div>
                          </td>
                          <td className={`hidden max-w-[200px] truncate px-2 py-2.5 text-[12.5px] lg:table-cell ${t2}`} title={`${r.institution} · ${r.accountName}`}>
                            {r.accountName}
                          </td>
                          <td className={`hidden px-2 py-2.5 text-right text-[12.5px] xl:table-cell ${t2}`}>{qtyFmt.format(r.quantity)}</td>
                          <td className={`hidden px-2 py-2.5 text-right text-[12.5px] md:table-cell ${t2}`}>{usd2.format(r.price)}</td>
                          <td className={`px-2 py-2.5 text-right text-[13px] font-medium ${t1}`}>{fmtUSD(r.value)}</td>
                          <td className={`hidden px-2 py-2.5 text-right text-[12.5px] lg:table-cell ${t2}`}>
                            {r.klass === "cash" || r.cost_basis == null ? "—" : fmtUSD(r.cost_basis)}
                          </td>
                          <td className="px-2 py-2.5 text-right">
                            {r.gain == null ? (
                              <span className={t3}>—</span>
                            ) : (
                              <span className={`inline-flex flex-col items-end leading-tight ${gainTone(r.gain)}`}>
                                <span className="text-[12.5px] font-medium">{fmtSigned(r.gain)}</span>
                                {r.gainPct != null && <span className="text-[11px] opacity-80">{fmtPct(r.gainPct)}</span>}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 pl-2 pr-5 text-right">
                            <span className="inline-flex items-center justify-end gap-2">
                              <span className={`hidden h-1 w-12 overflow-hidden rounded-full md:block ${isDark ? "bg-white/[0.06]" : "bg-gray-100"}`} aria-hidden>
                                <span className="block h-full rounded-full" style={{ width: `${maxWeight > 0 ? (r.weight / maxWeight) * 100 : 0}%`, background: accent }} />
                              </span>
                              <span className={`w-11 text-[12px] ${t2}`}>{fmtPct(r.weight, false)}</span>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Cards: phones */}
                <div className="flex flex-col gap-2 p-3 sm:hidden">
                  <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 no-scrollbar">
                    {(
                      [
                        ["value", "Value"],
                        ["gain", "Gain"],
                        ["weight", "Weight"],
                        ["name", "A–Z"],
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => onSort(k)}
                        aria-pressed={sort.key === k}
                        className={`inline-flex h-[40px] shrink-0 cursor-pointer items-center gap-1 rounded-full border px-3.5 text-[12px] font-medium ${hairline} ${
                          sort.key === k ? (isDark ? "bg-white/[0.08] text-white" : "bg-gray-900 text-white") : t2
                        }`}
                      >
                        {label}
                        {sort.key === k && <Icon d={sort.dir === "asc" ? PATHS.up : PATHS.down} className="h-3 w-3" strokeWidth={2} />}
                      </button>
                    ))}
                  </div>
                  {filtered.map((r) => (
                    <div key={`${r.account_id}-${r.security_id}`} className={`rounded-xl border p-3 ${isDark ? "border-white/[0.08] bg-white/[0.02]" : "border-gray-200 bg-white"}`}>
                      <div className="flex items-start gap-3">
                        <span className={`${tickerBadge} mt-0.5`}>{r.ticker || "—"}</span>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-[13px] font-medium ${t1}`}>{r.name}</span>
                          <span className={`block truncate text-[11px] ${t2}`}>{r.accountName}</span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className={`block text-[13px] font-medium ${t1}`}>{fmtUSD(r.value)}</span>
                          {r.gain != null ? (
                            <span className={`block text-[11px] ${gainTone(r.gain)}`}>
                              {fmtSigned(r.gain)}
                              {r.gainPct != null && ` · ${fmtPct(r.gainPct)}`}
                            </span>
                          ) : (
                            <span className={`block text-[11px] ${t3}`}>{CLASS_BY_KEY.get(r.klass)!.label}</span>
                          )}
                        </span>
                      </div>
                      <div className={`mt-2.5 flex items-center justify-between border-t pt-2 text-[11px] ${t2} ${hairlineOf(isDark)}`}>
                        <span>
                          {qtyFmt.format(r.quantity)} × {usd2.format(r.price)}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          {classDot(r.klass)}
                          {fmtPct(r.weight, false)} of portfolio
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* ── Accounts + Income ──────────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-12">
            <section className={`overflow-hidden rounded-2xl lg:col-span-7 ${surface} ${enter}`}>
              <div className={`flex items-center justify-between gap-3 border-b px-5 py-3.5 ${hairline}`}>
                <p className={kicker}>Accounts</p>
                <Link to="/treasury" className={linkQuiet}>
                  Treasury →
                </Link>
              </div>
              {firstLoad ? (
                <div className="space-y-3 p-5">
                  {[0, 1].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Bone className="h-8 w-8 shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <Bone className="h-3 w-1/2" />
                        <Bone className="h-2.5 w-1/3" />
                      </div>
                      <Bone className="h-3 w-20" />
                    </div>
                  ))}
                </div>
              ) : (
                <ul className={`divide-y ${rowBorder}`}>
                  {[...accounts]
                    .sort((a, b) => accountValue(b) - accountValue(a))
                    .map((a) => {
                      const v = accountValue(a);
                      const on = acct === a.account_id;
                      return (
                        <li key={a.account_id}>
                          <button
                            type="button"
                            onClick={() => focusHoldings({ acct: on ? "all" : a.account_id, cls: "all" })}
                            className={`flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left transition-colors ${rowHover} ${
                              on ? (isDark ? "bg-white/[0.035]" : "bg-gray-50") : ""
                            }`}
                            title="Show this account's holdings"
                          >
                            <InstitutionDisc a={a} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] font-medium">{accountLabel(a)}</span>
                              <span className={`block truncate text-[11px] ${textMuted}`}>
                                {[a.institution_name, subtypeLabel(a.subtype), a.entity_name]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block text-[12.5px] font-medium">{fmtUSD(v)}</span>
                              <span className={`block text-[11px] ${textMuted}`}>
                                {a.holdings_count} holding{a.holdings_count === 1 ? "" : "s"}
                                {total > 0 ? ` · ${fmtPct((v / total) * 100, false)}` : ""}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  {data?.errors.map((e) => (
                    <li key={`err-${e.item_id}`} className="flex items-center gap-3 px-5 py-3">
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${isDark ? "bg-amber-500/10 text-amber-300" : "bg-amber-50 text-amber-600"}`}>
                        <Icon d={PATHS.sync} className="h-3.5 w-3.5" strokeWidth={2} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium">{e.institution}</span>
                        <span className={`block truncate text-[11px] ${textMuted}`}>
                          {e.reconnect ? "Needs reconnecting" : "Temporarily unavailable"}
                        </span>
                      </span>
                      <Link to="/treasury" className={`${TAP_Y} shrink-0 text-[11.5px] font-medium ${accentText} hover:underline`}>
                        Reconnect →
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={`overflow-hidden rounded-2xl lg:col-span-5 ${surface} ${enter}`}>
              <div className={`flex items-center justify-between gap-3 border-b px-5 py-3.5 ${hairline}`}>
                <p className={kicker}>Dividends & interest</p>
                {data?.income && <span className={`text-[11px] ${textMuted}`}>Cash paid, reinvestments excluded</span>}
              </div>
              {firstLoad ? (
                <div className="space-y-4 p-5">
                  <div className="grid grid-cols-2 gap-4">
                    <Bone className="h-10" />
                    <Bone className="h-10" />
                  </div>
                  <Bone className="h-[72px] w-full" />
                </div>
              ) : !data?.income ? (
                <div className="px-5 py-10 text-center">
                  <p className={`text-[12px] ${textMuted}`}>Income history isn't available from these connections yet.</p>
                </div>
              ) : (
                <div className="px-5 pb-4 pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="min-w-0">
                      <p className={kicker}>Last 90 days</p>
                      <p className="mt-1 text-[18px] font-semibold tracking-[-0.01em]">{fmtUSD(data.income.last90)}</p>
                      <p className={`truncate text-[11px] ${textMuted}`}>
                        {fmtUSD(data.income.dividends90)} dividends · {fmtUSD(data.income.interest90)} interest
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className={kicker}>Trailing 12 months</p>
                      <p className="mt-1 text-[18px] font-semibold tracking-[-0.01em]">{fmtUSD(data.income.ttm)}</p>
                      <p className={`truncate text-[11px] ${textMuted}`}>≈ {fmtUSD(data.income.ttm / 12)} / month</p>
                    </div>
                  </div>

                  {/* Monthly bars: one hue, rounded tops on a shared baseline. */}
                  <div className="mt-4">
                    <div className="flex h-[72px] items-end gap-[3px]" onPointerLeave={() => setIncomeHover(null)}>
                      {months.map((m, i) => (
                        <div
                          key={m.key}
                          className="flex h-full flex-1 cursor-default items-end"
                          onPointerEnter={() => setIncomeHover(i)}
                          aria-label={`${m.long}: ${fmtUSD(m.total)}`}
                        >
                          <div
                            className="w-full rounded-t-[4px] transition-opacity"
                            style={{
                              height: `${Math.max(m.total > 0 ? 4 : 1.5, (m.total / monthMax) * 100)}%`,
                              background: m.total > 0 ? accent : isDark ? "rgba(255,255,255,0.08)" : "rgba(17,24,39,0.08)",
                              opacity: incomeHover == null || incomeHover === i ? 1 : 0.4,
                            }}
                          />
                        </div>
                      ))}
                    </div>
                    <div className={`mt-1.5 flex justify-between text-[10.5px] ${textMuted}`}>
                      <span>{months[0].label}</span>
                      <span>{months[months.length - 1].label}</span>
                    </div>
                    <p className={`mt-2 h-4 text-[11.5px] ${textSoft}`} aria-live="polite">
                      {incomeHover != null ? (
                        <>
                          <span className={isDark ? "text-gray-100" : "text-gray-900"}>{months[incomeHover].long}</span> ·{" "}
                          {fmtUSD(months[incomeHover].total)}
                          {months[incomeHover].total > 0 && (
                            <span className={textMuted}>
                              {" "}
                              ({fmtUSD(months[incomeHover].dividends)} div · {fmtUSD(months[incomeHover].interest)} int)
                            </span>
                          )}
                        </>
                      ) : (
                        <span className={textMuted}>Point at a month for its detail</span>
                      )}
                    </p>
                  </div>

                  {data.income.bySecurity.length > 0 && (
                    <div className={`mt-3 border-t pt-3 ${hairline}`}>
                      <p className={kicker}>Top payers · 12 mo</p>
                      <ul className="mt-2 space-y-1.5">
                        {data.income.bySecurity.slice(0, 5).map((s) => (
                          <li key={`${s.ticker}-${s.name}`} className="flex items-center gap-2.5">
                            <span className={tickerBadge}>{s.ticker || "—"}</span>
                            <span className={`min-w-0 flex-1 truncate text-[12px] ${textSoft}`}>{s.name}</span>
                            <span className="shrink-0 text-[12px] font-medium">{fmtUSD(s.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
