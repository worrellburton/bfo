/**
 * Investments: every brokerage position across the connected accounts, the
 * portfolio's value over time, allocation, unrealized gain split by tax
 * status, and income over the window the data really covers. Positions and
 * cost basis are as the custodian reports them through Plaid; the chart's
 * earlier days are rebuilt from transactions and closing prices. Built on
 * app/ui (docs/DESIGN.md); the arithmetic is in app/investments-model.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router";
import { canWrite, isAdmin } from "../auth";
import { loadPlaid } from "../plaid-link";
import {
  Banner,
  Button,
  Card,
  Empty,
  InfoToggle,
  LinkButton,
  List,
  ListRow,
  Page,
  PageHeader,
  SearchField,
  Segmented,
  Select,
  Skeleton,
  Table,
  TextLink,
  confirm,
  format,
  toast,
  type Column,
} from "../ui";
import { CLASS_COLOUR, CLASS_LABEL, CLASS_ORDER, annualPace, classify, gains, monthKeys, monthsBetween, type AssetClass } from "../investments-model";
import { TAX_STATUS_LABEL, defaultTaxStatus, isRetirement, ownerOf, type OwnerKind, type TaxStatus } from "../treasury-model";
import { InstitutionMark } from "../treasury-ui";
import { accountName, getJson, typeLabel, useRecords } from "../treasury-data";

export function meta() {
  return [{ title: "Investments · BFO" }, { name: "description", content: "Holdings, allocation and income across every brokerage account." }];
}

type InvAccount = {
  item_id: string;
  institution_name: string;
  institution_logo: string | null;
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  balance_current: number | null;
  nickname: string | null;
  entity_id: string | null;
  entity_name: string | null;
  owner_kind?: OwnerKind | null;
  owner_names?: string[] | null;
  tax_status?: TaxStatus | null;
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
};

type InvError = { item_id: string; institution: string; code: string | null; reconnect: boolean; consent?: boolean; message: string };

type Income = {
  last90: number;
  ttm: number;
  from?: string | null;
  to?: string;
  byMonth: { month: string; dividends: number; interest: number; capitalGains?: number }[];
  bySecurity: { ticker: string | null; name: string; amount: number }[];
} | null;

type Activity = { date: string; account_id: string; type: string; subtype: string | null; name: string; ticker: string | null; security_name: string | null; quantity: number; amount: number };

type InvData = {
  asOf: string;
  accounts: InvAccount[];
  holdings: Holding[];
  errors: InvError[];
  history: { day: string; invested: number }[];
  historyRebuilt?: { from: string; until: string } | null;
  hiddenAccounts?: { count: number; value: number };
  income: Income;
  activity?: { recent?: Activity[] };
};

/**
 * Who holds an account, for this page. A retirement account still mapped to
 * an entity isn't shown as that entity's: an IRA is one person's, so it reads
 * "Owner to confirm" until a person is recorded (Account owners).
 */
function holderOf(a: InvAccount, nameOf: (id: string) => string | null) {
  if (isRetirement(a.subtype, a.official_name || a.name) && a.owner_kind !== "person") return { key: "confirm", label: "Owner to confirm", kind: "none" as const };
  return ownerOf(a, nameOf);
}

/** A fund's name without the fund family repeated before its own: "Vanguard Index Funds - Vanguard 500 Index…" → "Vanguard 500 Index…". */
function fundName(name: string): string {
  const parts = name.split(" - ");
  return parts.length > 1 && parts.slice(1).join(" - ").trim().split(/\s+/).length >= 2 ? parts.slice(1).join(" - ").trim() : name;
}

/** A share: "<0.1%" for a sliver, never "0.0%". */
const share = (pct: number) => (pct > 0 && pct < 0.05 ? "<0.1%" : format.percent(pct));

const accountValue = (a: InvAccount) => (a.holdings_count > 0 ? a.holdings_value : (a.balance_current ?? 0));

const RANGES = [
  { value: "30", label: "30D", days: 30 },
  { value: "90", label: "90D", days: 90 },
  { value: "365", label: "1Y", days: 365 },
  { value: "all", label: "All", days: Infinity },
] as const;
type RangeKey = (typeof RANGES)[number]["value"];
type Point = { day: string; value: number };

const dayMs = (d: string) => Date.parse(`${d.slice(0, 10)}T12:00:00Z`);

/** The value over time: one accent line on a solid surface, x by date, y labelled at its low and high. Arrow keys move along it. */
function TrendChart({ points, index, onIndex }: { points: Point[]; index: number; onIndex: (i: number | null) => void }) {
  const W = 1000;
  const H = 200;
  const geo = useMemo(() => {
    const vals = points.map((p) => p.value);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = hi - lo < 1 ? 1 : hi - lo;
    const t0 = dayMs(points[0].day);
    const t1 = dayMs(points[points.length - 1].day);
    const xy = points.map((p) => [t1 === t0 ? W / 2 : ((dayMs(p.day) - t0) / (t1 - t0)) * W, H - 8 - ((p.value - lo) / span) * (H - 16)] as const);
    const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    return { xy, line, area: `${line} L${W},${H} L0,${H} Z`, lo, hi };
  }, [points]);
  const at = geo.xy[index];
  const pick = (clientX: number, rect: DOMRect) => {
    const f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * W;
    let best = 0;
    for (let i = 1; i < geo.xy.length; i++) if (Math.abs(geo.xy[i][0] - f) < Math.abs(geo.xy[best][0] - f)) best = i;
    onIndex(best);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") onIndex(Math.max(0, index - 1));
    else if (e.key === "ArrowRight") onIndex(Math.min(points.length - 1, index + 1));
    else if (e.key === "Home") onIndex(0);
    else if (e.key === "End") onIndex(points.length - 1);
    else return;
    e.preventDefault();
  };
  return (
    <div className="flex gap-3">
      <div className="flex w-[56px] shrink-0 flex-col justify-between py-1 text-right text-caption text-ink-2 tabular-nums" aria-hidden>
        <span>{format.money(geo.hi, { precision: "compact" })}</span>
        <span>{format.money(geo.lo, { precision: "compact" })}</span>
      </div>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Portfolio value by day"
        aria-valuemin={0}
        aria-valuemax={points.length - 1}
        aria-valuenow={index}
        aria-valuetext={`${format.date(points[index].day, "medium")}: ${format.money(points[index].value, { precision: "dollars" })}`}
        onKeyDown={onKey}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => onIndex(null)}
        className="relative h-[140px] min-w-0 flex-1 cursor-crosshair touch-pan-y rounded-mark select-none"
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} className="stroke-line" vectorEffect="non-scaling-stroke" />
          <path d={geo.area} className="fill-accent-tint" />
          <path d={geo.line} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {at && <line x1={at[0]} x2={at[0]} y1={0} y2={H} className="stroke-line-strong" vectorEffect="non-scaling-stroke" />}
        </svg>
        {at && (
          <span className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" style={{ left: `${(at[0] / W) * 100}%`, top: `${(at[1] / H) * 100}%` }} />
        )}
      </div>
    </div>
  );
}

type Row = Holding & { klass: AssetClass; gain: number | null; weight: number; account: string; tax: TaxStatus | null };
type GroupBy = "account" | "owner" | "institution";

export default function Investments() {
  const records = useRecords();
  const writer = canWrite();
  const admin = isAdmin();
  const [params] = useSearchParams();
  const [data, setData] = useState<InvData | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("365");
  const [hover, setHover] = useState<number | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("account");
  const [q, setQ] = useState("");
  const [acct, setAcct] = useState<string>(params.get("account") ?? "all");
  const [cls, setCls] = useState<AssetClass | "all">("all");
  const [month, setMonth] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const holdingsRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const body = await getJson<Partial<InvData>>("/api/plaid/data?report=investments");
      setData({
        asOf: body.asOf ?? new Date().toISOString(),
        accounts: body.accounts ?? [],
        holdings: body.holdings ?? [],
        errors: body.errors ?? [],
        history: body.history ?? [],
        historyRebuilt: body.historyRebuilt ?? null,
        hiddenAccounts: body.hiddenAccounts,
        income: body.income ?? null,
        activity: body.activity,
      });
      setFailed(null);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Couldn’t load investments.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (params.get("account")) holdingsRef.current?.scrollIntoView({ block: "start" });
  }, [params, data]);

  const accounts = useMemo(() => data?.accounts ?? [], [data]);
  const byId = useMemo(() => new Map(accounts.map((a) => [a.account_id, a])), [accounts]);
  const taxOf = useCallback(
    (id: string): TaxStatus | null => {
      const a = byId.get(id);
      return a ? (a.tax_status ?? defaultTaxStatus(a.subtype, a.official_name || a.name, a.type)) : null;
    },
    [byId],
  );
  const total = accounts.reduce((s, a) => s + accountValue(a), 0);
  const rows: Row[] = useMemo(
    () =>
      (data?.holdings ?? []).map((h) => {
        const klass = classify(h);
        const a = byId.get(h.account_id);
        return {
          ...h,
          klass,
          gain: klass !== "cash" && h.cost_basis != null && h.cost_basis > 0 ? h.value - h.cost_basis : null,
          weight: total > 0 ? (h.value / total) * 100 : 0,
          account: a ? accountName(a) : "Account",
          tax: taxOf(h.account_id),
        };
      }),
    [data, byId, total, taxOf],
  );
  const g = gains(rows, taxOf);
  const cash = rows.filter((r) => r.klass === "cash").reduce((s, r) => s + r.value, 0);
  const pricedAt =
    rows
      .map((r) => r.price_as_of)
      .filter((d): d is string => !!d)
      .sort()[0] ?? null;
  const institutions = [...new Set(accounts.map((a) => a.institution_name))];

  // Allocation: every class in the list; under 1% folded into Other in the bar.
  const allocation = useMemo(() => {
    const sums = new Map<AssetClass, number>();
    for (const r of rows) sums.set(r.klass, (sums.get(r.klass) ?? 0) + r.value);
    for (const a of accounts) if (a.holdings_count === 0 && (a.balance_current ?? 0) > 0) sums.set("other", (sums.get("other") ?? 0) + (a.balance_current ?? 0));
    const sum = [...sums.values()].reduce((s, v) => s + v, 0);
    const list = CLASS_ORDER.filter((k) => (sums.get(k) ?? 0) > 0.5).map((k) => ({ key: k, value: sums.get(k) ?? 0, pct: sum > 0 ? ((sums.get(k) ?? 0) / sum) * 100 : 0 }));
    const bar = list.filter((c) => c.pct >= 1 || c.key === "other");
    const folded = list.filter((c) => c.pct < 1 && c.key !== "other").reduce((s, c) => s + c.pct, 0);
    const otherIdx = bar.findIndex((c) => c.key === "other");
    if (folded > 0) {
      if (otherIdx >= 0) bar[otherIdx] = { ...bar[otherIdx], pct: bar[otherIdx].pct + folded };
      else bar.push({ key: "other", value: 0, pct: folded });
    }
    return { list, bar };
  }, [rows, accounts]);

  // The value series: recorded days (and rebuilt ones before them), with today's live figure.
  const fullSeries = useMemo(() => {
    const hist = (data?.history ?? []).filter((h) => Number.isFinite(h.invested));
    const firstReal = hist.findIndex((h) => h.invested > 0);
    const pts: Point[] = (firstReal < 0 ? [] : hist.slice(firstReal)).map((h) => ({ day: h.day, value: h.invested }));
    const today = format.isoDate(new Date());
    if (total > 0) {
      if (pts.length && pts[pts.length - 1].day >= today) pts[pts.length - 1] = { day: pts[pts.length - 1].day, value: total };
      else if (pts.length) pts.push({ day: today, value: total });
    }
    return pts;
  }, [data, total]);
  const series = useMemo(() => {
    const days = RANGES.find((r) => r.value === range)!.days;
    if (!Number.isFinite(days) || !fullSeries.length) return fullSeries;
    const cutoff = dayMs(fullSeries[fullSeries.length - 1].day) - days * 86_400_000;
    return fullSeries.filter((p) => dayMs(p.day) >= cutoff);
  }, [fullSeries, range]);
  const idx = hover ?? series.length - 1;
  const point = series[idx];
  const first = series[0];
  const change = point && first ? point.value - first.value : 0;

  // Income, over the months the transactions cover.
  const income = data?.income ?? null;
  const covered = useMemo(() => {
    // Where the server doesn't say, the earliest transaction the chart's rebuild found is the same date.
    const from = income?.from ?? data?.historyRebuilt?.from ?? null;
    const to = income?.to ?? (data ? data.asOf.slice(0, 10) : null);
    return income && from && to ? { from, to, months: monthsBetween(from, to) } : null;
  }, [income, data]);
  const months = useMemo(() => {
    if (!income) return [];
    const by = new Map(income.byMonth.map((m) => [m.month, m]));
    const keys = covered ? monthKeys(covered.from, covered.to) : income.byMonth.map((m) => m.month);
    return keys.map((k) => {
      const m = by.get(k);
      const total = (m?.dividends ?? 0) + (m?.interest ?? 0) + (m?.capitalGains ?? 0);
      return { key: k, label: format.date(`${k}-15`, "short").replace(/\s\d+(,|$)/, "$1"), dividends: m?.dividends ?? 0, interest: m?.interest ?? 0, capitalGains: m?.capitalGains ?? 0, total };
    });
  }, [income, covered]);
  const incomeTotal = months.reduce((s, m) => s + m.total, 0);
  const pace = covered ? annualPace(incomeTotal, covered.months) : null;
  const monthMax = Math.max(1, ...months.map((m) => Math.max(0, m.total)));
  const shownMonth = months.find((m) => m.key === month) ?? months[months.length - 1];

  // Accounts, grouped.
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; label: string; sub: string; value: number; to?: string }>();
    for (const a of accounts) {
      const owner = holderOf(a, (id) => (records.loaded ? records.nameOf(id) : (a.entity_name ?? null)));
      const key = groupBy === "account" ? a.account_id : groupBy === "institution" ? a.institution_name : owner.key;
      const label = groupBy === "account" ? accountName(a) : groupBy === "institution" ? a.institution_name : owner.label;
      const tax = taxOf(a.account_id);
      const gr = m.get(key) ?? {
        key,
        label,
        sub: groupBy === "account" ? [a.institution_name, typeLabel(a), owner.kind === "none" ? null : owner.label, tax ? TAX_STATUS_LABEL[tax] : null].filter(Boolean).join(" · ") : "",
        value: 0,
        to: groupBy === "account" ? `/treasury/${a.account_id}` : undefined,
      };
      gr.value += accountValue(a);
      m.set(key, gr);
    }
    const list = [...m.values()].sort((x, y) => y.value - x.value);
    if (groupBy !== "account")
      for (const gr of list)
        gr.sub = format.count(
          accounts.filter((a) => (groupBy === "institution" ? a.institution_name : holderOf(a, (id) => (records.loaded ? records.nameOf(id) : (a.entity_name ?? null))).key) === gr.key).length,
          "account",
        );
    return list;
  }, [accounts, groupBy, records, taxOf]);
  const ownerKeys = new Set(accounts.map((a) => holderOf(a, (id) => (records.loaded ? records.nameOf(id) : (a.entity_name ?? null))).key));
  const groupOptions = [
    { value: "account" as const, label: "Account" },
    ...(ownerKeys.size > 1 ? [{ value: "owner" as const, label: "Owner" }] : []),
    ...(institutions.length > 1 ? [{ value: "institution" as const, label: "Institution" }] : []),
  ];

  const filtered = rows.filter(
    (r) => (acct === "all" || r.account_id === acct) && (cls === "all" || r.klass === cls) && (!q.trim() || `${r.ticker ?? ""} ${r.name} ${r.account}`.toLowerCase().includes(q.trim().toLowerCase())),
  );
  const activity = (data?.activity?.recent ?? []).slice(0, 25);

  async function rebuild() {
    const ok = await confirm({
      title: "Rebuild the chart’s earlier days?",
      message:
        "The days before BFO began recording are rebuilt from the accounts’ transactions and each day’s closing price from Yahoo Finance, replacing the earlier rebuild. Days BFO recorded don’t change.",
      details: ["Recorded with your name, the time and the method used."],
      confirmLabel: "Rebuild history",
    });
    if (!ok) return;
    setRebuilding(true);
    try {
      const out = await getJson<{ days: number; from: string | null }>("/api/plaid/history", { method: "POST" });
      toast({ message: out.days && out.from ? `Rebuilt from ${format.date(out.from, "medium")}` : "Nothing to rebuild" });
      await load();
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Couldn’t rebuild the history.");
    } finally {
      setRebuilding(false);
    }
  }

  async function connectHoldings(itemId: string) {
    try {
      const [{ link_token }] = await Promise.all([
        getJson<{ link_token: string }>("/api/plaid/create-link-token", { method: "POST", body: JSON.stringify({ kind: "bank", item_id: itemId, add_investments: true }) }),
        loadPlaid(),
      ]);
      window.Plaid?.create({ token: link_token, onSuccess: () => void load(), onExit: () => undefined }).open();
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Couldn’t open the bank’s window.");
    }
  }

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Holding",
      render: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="break-words text-ink">{r.ticker ? `${r.ticker} · ${fundName(r.name)}` : fundName(r.name)}</span>
          <span className="text-small text-ink-2">{CLASS_LABEL[r.klass]}</span>
        </span>
      ),
      sort: (a, b) => (a.ticker || a.name).localeCompare(b.ticker || b.name),
    },
    { key: "account", header: "Account", width: "190px", render: (r) => <span className="text-ink-2">{r.account}</span>, sort: (a, b) => a.account.localeCompare(b.account) },
    {
      key: "qty",
      header: "Quantity",
      align: "right",
      width: "110px",
      render: (r) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(r.quantity),
      sort: (a, b) => a.quantity - b.quantity,
    },
    { key: "value", header: "Value", align: "right", width: "130px", render: (r) => format.money(r.value), sort: (a, b) => a.value - b.value },
    {
      key: "basis",
      header: "Cost basis",
      align: "right",
      width: "130px",
      render: (r) => (r.klass === "cash" ? <span className="text-ink-3">—</span> : r.cost_basis ? format.money(r.cost_basis) : <span className="text-ink-3">Not reported</span>),
      sort: (a, b) => (a.cost_basis ?? -1) - (b.cost_basis ?? -1),
    },
    {
      key: "gain",
      header: "Unrealized",
      align: "right",
      width: "130px",
      render: (r) =>
        r.gain == null ? (
          <span className="text-ink-3">—</span>
        ) : (
          <span className={r.tax === "taxable" && r.gain !== 0 ? (r.gain > 0 ? "text-positive" : "text-negative") : "text-ink"}>{format.money(r.gain, { sign: "always" })}</span>
        ),
      sort: (a, b) => (a.gain ?? -Infinity) - (b.gain ?? -Infinity),
    },
    { key: "weight", header: "Share", align: "right", width: "80px", render: (r) => share(r.weight), sort: (a, b) => a.weight - b.weight },
  ];

  const loading = !data && !failed;
  const empty = !!data && accounts.length === 0;
  const errors = data?.errors ?? [];
  const recordedFrom = data?.historyRebuilt?.until ?? null;

  return (
    <Page
      header={
        <PageHeader
          title="Investments"
          context={
            data && accounts.length
              ? `${format.count(accounts.length, "account")}${institutions.length ? ` at ${format.list(institutions)}` : ""} · ${format.count(rows.length, "position")}${pricedAt ? ` · priced at the ${format.date(pricedAt, "short")} close` : ""} · fetched ${format.dateTime(data.asOf, { zone: true })}`
              : "Brokerage positions, through Plaid"
          }
          menu={[{ label: "Open Treasury", onSelect: () => window.location.assign("/treasury") }, ...(writer ? [{ label: "Rebuild the chart’s earlier days…", onSelect: () => void rebuild() }] : [])]}
        />
      }
    >
      {failed && (
        <Banner
          tone="negative"
          action={
            <Button variant="quiet" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          }
          onDismiss={() => setFailed(null)}
        >
          {failed}
        </Banner>
      )}
      {errors.length > 0 && (
        <Banner
          tone="warning"
          action={
            errors.some((e) => e.consent) && admin ? (
              <Button variant="quiet" size="sm" onClick={() => void connectHoldings(errors.find((e) => e.consent)!.item_id)}>
                Connect holdings
              </Button>
            ) : (
              <TextLink to="/treasury">Open Treasury</TextLink>
            )
          }
        >
          {errors.map((e) => `${e.institution} ${e.consent ? "is connected without access to its holdings" : e.reconnect ? "needs to be signed in to again" : "didn’t answer just now"}`).join(". ")}.
          Its positions aren’t in these figures.
        </Banner>
      )}
      {data?.hiddenAccounts && data.hiddenAccounts.count > 0 && (
        <p className="-mt-4 text-small text-ink-2">
          Leaves out {format.count(data.hiddenAccounts.count, "account")} hidden in Treasury, holding {format.money(data.hiddenAccounts.value, { precision: "dollars" })}.{" "}
          <TextLink inline to="/treasury">
            Show them in Treasury
          </TextLink>
        </p>
      )}

      {loading && (
        <div className="flex flex-col gap-6">
          <Skeleton kind="card" />
          <Skeleton kind="table" rows={8} />
        </div>
      )}
      {empty && (
        <Empty
          title="No investment accounts yet"
          action={
            admin ? (
              <LinkButton to="/treasury" variant="primary">
                Connect in Treasury
              </LinkButton>
            ) : undefined
          }
        >
          Brokerage accounts connected in Treasury appear here with their positions, allocation and income.
        </Empty>
      )}

      {data && accounts.length > 0 && (
        <>
          <Card>
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-small font-medium text-ink-2">{hover != null && point ? format.date(point.day, "medium") : "Portfolio value"}</p>
                  <p className="mt-1 text-display text-ink tabular-nums">{format.money(point?.value ?? total, { precision: "dollars" })}</p>
                  {first && point && series.length > 1 && (
                    <p className="mt-1 text-small text-ink-2">
                      {change === 0 ? "No change" : `${change > 0 ? "↑" : "↓"} ${format.money(Math.abs(change), { precision: "dollars" })} · ${format.percent(Math.abs((change / first.value) * 100))}`}{" "}
                      since {format.date(first.day, "short")}, including money moved in or out
                    </p>
                  )}
                </div>
                {fullSeries.length > 1 && (
                  <Segmented
                    label="Period"
                    value={range}
                    onChange={(v) => {
                      setRange(v);
                      setHover(null);
                    }}
                    options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
                  />
                )}
              </div>
              {series.length > 1 ? (
                <TrendChart points={series} index={Math.min(idx, series.length - 1)} onIndex={setHover} />
              ) : (
                <p className="text-small text-ink-2">The chart fills in as BFO records each day’s value.</p>
              )}
              <div className="flex items-start gap-2 text-small text-ink-2">
                <InfoToggle label="How this chart is built">
                  {recordedFrom
                    ? `Before ${format.date(recordedFrom, "short")}, each day is rebuilt from the accounts’ transactions and that day’s closing price from Yahoo Finance; from then on it is the value BFO recorded that day. `
                    : "Each day is the value BFO recorded that day. "}
                  Days with no reading are skipped. A deposit, withdrawal or an account hidden in Treasury moves the line too.
                </InfoToggle>
                <span className="pt-[6px]">How this chart is built</span>
                {writer && (
                  <Button variant="quiet" size="sm" busy={rebuilding} busyLabel="Rebuilding…" onClick={() => void rebuild()} className="ml-auto">
                    Rebuild…
                  </Button>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-4 sm:grid-cols-4">
                {g.taxable.positions > 0 && (
                  <Stat
                    label="Unrealized gain, taxable"
                    value={format.money(g.taxable.gain, { precision: "dollars", sign: "always" })}
                    sub={`on ${format.money(g.taxable.basis, { precision: "dollars" })} cost basis`}
                  />
                )}
                {g.deferred.positions > 0 && (
                  <Stat label="Unrealized, tax-deferred and exempt" value={format.money(g.deferred.gain, { precision: "dollars", sign: "always" })} sub="No tax until withdrawn" />
                )}
                {cash > 0 && <Stat label="Cash and money market" value={format.money(cash, { precision: "dollars" })} sub={`${format.percent(total ? (cash / total) * 100 : 0)} of the portfolio`} />}
                {income && covered && (
                  <Stat label={`Income since ${format.date(covered.from, "short")}`} value={format.money(incomeTotal, { precision: "dollars" })} sub={`${covered.months} months covered`} />
                )}
              </dl>
              <p className="text-small text-ink-2">
                Cost basis as each custodian reports it; the method and lots aren’t available here.
                {g.noBasis.positions > 0 &&
                  ` Basis isn’t reported for ${format.count(g.noBasis.positions, "position")} (${format.money(g.noBasis.value, { precision: "dollars" })}), so they’re left out of the gain.`}
              </p>
            </div>
          </Card>

          <div className="grid items-start gap-6 lg:grid-cols-2">
            <Card title="Allocation">
              <div className="flex h-2 overflow-hidden rounded-full bg-sunken" role="img" aria-label={allocation.list.map((c) => `${CLASS_LABEL[c.key]} ${format.percent(c.pct)}`).join(", ")}>
                {allocation.bar.map((c) => (
                  <span key={c.key} className={`${CLASS_COLOUR[c.key]} h-full`} style={{ width: `${c.pct}%` }} />
                ))}
              </div>
              <ul className="mt-4 flex flex-col">
                {allocation.list.map((c) => (
                  <li key={c.key}>
                    <button
                      type="button"
                      onClick={() => {
                        setCls(c.key);
                        holdingsRef.current?.scrollIntoView({ block: "start" });
                      }}
                      className="flex min-h-10 w-full items-center gap-3 rounded-control px-2 text-left hover:bg-hover touch:min-h-[44px]"
                    >
                      <span className={`${CLASS_COLOUR[c.key]} size-2 shrink-0 rounded-full`} aria-hidden />
                      <span className="min-w-0 flex-1 text-body text-ink">{CLASS_LABEL[c.key]}</span>
                      <span className="text-body text-ink tabular-nums">{format.money(c.value, { precision: "dollars" })}</span>
                      <span className="w-[56px] text-right text-small text-ink-2 tabular-nums">{share(c.pct)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>

            <Card title="Accounts" flush action={groupOptions.length > 1 ? <Segmented label="Group by" value={groupBy} onChange={setGroupBy} options={groupOptions} /> : undefined}>
              <List label="Accounts">
                {groups.map((gr) => {
                  const a = groupBy === "account" ? byId.get(gr.key) : undefined;
                  return (
                    <ListRow
                      key={gr.key}
                      to={gr.to}
                      leading={a ? <InstitutionMark name={a.institution_name} logo={a.institution_logo} /> : undefined}
                      title={gr.label}
                      secondary={gr.sub}
                      meta={total ? share((gr.value / total) * 100) : undefined}
                      trailing={format.money(gr.value, { precision: "dollars" })}
                    />
                  );
                })}
              </List>
            </Card>
          </div>

          <div ref={holdingsRef} className="scroll-mt-4">
            <Card title="Holdings" count={filtered.length} flush>
              <div className="flex flex-wrap items-center gap-3 px-5 py-3 touch:px-4">
                <div className="min-w-[200px] flex-1">
                  <SearchField value={q} onChange={setQ} placeholder="Search holdings" label="Search holdings" />
                </div>
                {accounts.length > 1 && (
                  <div className="w-full sm:w-[220px]">
                    <Select
                      label="Account"
                      size="sm"
                      value={acct}
                      onChange={setAcct}
                      options={[{ value: "all", label: "Every account" }, ...accounts.map((a) => ({ value: a.account_id, label: accountName(a) }))]}
                    />
                  </div>
                )}
                <div className="w-full sm:w-[200px]">
                  <Select<AssetClass | "all">
                    label="Asset type"
                    size="sm"
                    value={cls}
                    onChange={setCls}
                    options={[{ value: "all", label: "Every type" }, ...allocation.list.map((c) => ({ value: c.key as AssetClass | "all", label: CLASS_LABEL[c.key] }))]}
                  />
                </div>
              </div>
              <Table
                caption="Holdings"
                columns={columns}
                rows={[...filtered].sort((a, b) => b.value - a.value)}
                rowKey={(r) => `${r.account_id}:${r.security_id}`}
                phoneRow={(r) => ({
                  title: r.ticker ? `${r.ticker} · ${fundName(r.name)}` : fundName(r.name),
                  secondary: [
                    r.account,
                    `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(r.quantity)} units`,
                    r.gain != null ? `${format.money(r.gain, { precision: "dollars", sign: "always" })} unrealized` : null,
                  ]
                    .filter(Boolean)
                    .join(" · "),
                  trailing: format.money(r.value),
                })}
                empty={
                  <Empty
                    size="section"
                    action={
                      <Button
                        variant="quiet"
                        size="sm"
                        onClick={() => {
                          setQ("");
                          setAcct("all");
                          setCls("all");
                        }}
                      >
                        Clear filters
                      </Button>
                    }
                  >
                    No holdings match these filters.
                  </Empty>
                }
              />
            </Card>
          </div>

          <div className="grid items-start gap-6 lg:grid-cols-2">
            <Card
              title="Dividends and interest"
              info="Dividends, interest and capital-gain distributions, counted once whether paid out or reinvested. Withdrawals and contributions aren’t income and are left out."
            >
              {!income ? (
                <p className="text-body text-ink-2">The custodians’ transactions aren’t available yet, so income can’t be shown.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  <div>
                    <p className="text-title text-ink tabular-nums">{format.money(incomeTotal, { precision: "dollars" })}</p>
                    <p className="text-small text-ink-2">
                      {covered ? `Since ${format.date(covered.from, "medium")}, ${covered.months} months: as far back as the custodians’ transactions go.` : "Over the months shown."}
                      {pace != null && ` At this pace, about ${format.money(pace, { precision: "dollars" })} a year.`}
                    </p>
                  </div>
                  {months.length > 0 && (
                    <div className="flex h-[96px] items-end gap-1" role="group" aria-label="Income by month">
                      {months.map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => setMonth(m.key)}
                          onFocus={() => setMonth(m.key)}
                          aria-pressed={shownMonth?.key === m.key}
                          aria-label={`${m.label}: ${format.money(m.total)}`}
                          className="flex h-full min-w-0 flex-1 flex-col justify-end rounded-mark"
                        >
                          <span
                            className={`block w-full rounded-t-[2px] ${shownMonth?.key === m.key ? "bg-ink" : "bg-ink-3"}`}
                            style={{ height: `${Math.max(2, (Math.max(0, m.total) / monthMax) * 100)}%` }}
                          />
                        </button>
                      ))}
                    </div>
                  )}
                  {shownMonth && (
                    <p className="text-small text-ink-2 tabular-nums">
                      {shownMonth.label}: dividends {format.money(shownMonth.dividends)} · interest {format.money(shownMonth.interest)}
                      {shownMonth.capitalGains ? ` · capital gains ${format.money(shownMonth.capitalGains)}` : ""}. Choose a month for its detail.
                    </p>
                  )}
                  {income.bySecurity.length > 0 && (
                    <ul className="flex flex-col border-t border-line pt-2">
                      {income.bySecurity.slice(0, 5).map((s) => (
                        <li key={`${s.ticker}-${s.name}`} className="flex min-h-8 items-center justify-between gap-3 text-body">
                          <span className="min-w-0 truncate text-ink">{s.ticker ? `${s.ticker} · ${fundName(s.name)}` : fundName(s.name)}</span>
                          <span className="shrink-0 text-ink tabular-nums">{format.money(s.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Card>

            <Card title="Activity, last 90 days" flush>
              {activity.length === 0 ? (
                <p className="px-5 py-4 text-body text-ink-2 touch:px-4">No trades, dividends or transfers in the last 90 days.</p>
              ) : (
                <List label="Recent activity">
                  {activity.map((t, i) => (
                    <ListRow
                      key={`${t.date}-${i}`}
                      title={t.security_name || t.name}
                      secondary={[
                        format.date(t.date, "short"),
                        tidyType(t.type, t.subtype),
                        byId.get(t.account_id) ? accountName(byId.get(t.account_id)!) : null,
                        t.quantity ? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(Math.abs(t.quantity))} units` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      trailing={<span className={t.amount < 0 ? "text-positive" : "text-ink"}>{format.money(-t.amount, { sign: "always" })}</span>}
                    />
                  ))}
                </List>
              )}
              <p className="border-t border-line px-5 py-3 text-small text-ink-2 touch:px-4">Realized gains and losses aren’t computed here: see each custodian’s Form 1099-B.</p>
            </Card>
          </div>

          <p className="max-w-[68ch] text-small text-ink-2">
            Positions, prices and cost basis as reported by {format.list(institutions)} through Plaid, fetched {format.dateTime(data.asOf, { zone: true })}.
            {recordedFrom ? ` The chart before ${format.date(recordedFrom, "short")} is estimated from transactions and Yahoo Finance closing prices.` : ""} Not an account statement or a tax document.
          </p>
        </>
      )}
    </Page>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-small font-medium text-ink-2">{label}</dt>
      <dd className="mt-1 text-title text-ink tabular-nums">{value}</dd>
      {sub && <dd className="text-small text-ink-2">{sub}</dd>}
    </div>
  );
}

/** "cash · qualified dividend" → "Qualified dividend". */
function tidyType(type: string, subtype: string | null): string {
  const s = (subtype || type || "").replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Activity";
}
