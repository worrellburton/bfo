/**
 * Investments history before BFO started recording it (treasury_daily began
 * in August 2026). Plaid has no past balances for a brokerage, but it does
 * give up to 24 months of investment transactions. Starting from today's
 * holdings and walking back through those transactions gives each day's
 * share counts; each day's closing prices turn them into a value.
 *
 * Two readings of a brokerage's transactions, because institutions differ:
 *   "units"       only share movements count. Right when the settlement fund's
 *                 own buys and sells are reported (each trade shows both legs).
 *   "cash-flows"  every trade, deposit and withdrawal also moves the account's
 *                 cash (its settlement fund or cash position) by its amount.
 *                 Right when the sweep isn't reported.
 * api/plaid/history.ts builds both and keeps the one that matches the values
 * BFO actually recorded on the days it has.
 *
 * Pure: no I/O here except fetchCloses (Yahoo's public chart data, no key).
 * Env: none.
 */

export type HSecurity = { security_id: string; ticker: string | null; name: string | null; cash: boolean; price: number | null };
export type HPosition = { account_id: string; security_id: string; quantity: number };
/** Plaid's sign conventions: quantity is positive for units in; amount is positive for cash out of the account. */
export type HTx = { date: string; account_id: string; security_id: string | null; quantity: number; amount: number; type: string; subtype: string | null };
export type Mode = "units" | "cash-flows";
export type HPoint = { day: string; value: number };
export type Closes = Map<string, Array<[day: string, close: number]>>;

export const PLAID_HISTORY_DAYS = 730;

const MONEY_MARKET = ["VMFXX", "VMRXX", "VUSXX", "VMSXX", "VCTXX", "VYFXX", "SPAXX", "FDRXX", "SWVXX", "SNVXX"];
export function isCashLike(ticker: string | null, name: string | null, type?: string | null, cashEquivalent?: boolean): boolean {
  const t = (ticker ?? "").toUpperCase();
  return (
    !!cashEquivalent ||
    type === "cash" ||
    t.startsWith("CUR:") ||
    MONEY_MARKET.includes(t) ||
    /money market|cash reserves|federal money|treasury money|settlement fund/i.test(name ?? "")
  );
}

/** Every calendar day from `start` to `end`, inclusive (YYYY-MM-DD). */
export function dayList(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** The close on `day`, or the last one before it (weekends and holidays carry the prior close). Null before the first. */
export function closeOn(series: Array<[string, number]> | undefined, day: string): number | null {
  if (!series?.length || series[0][0] > day) return null;
  let lo = 0;
  let hi = series.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (series[mid][0] <= day) lo = mid;
    else hi = mid - 1;
  }
  return series[lo][1];
}

/** Each account's cash: its cash position, else its largest cash-like holding (the settlement fund). */
export function cashBuckets(positions: HPosition[], securities: Map<string, HSecurity>): Map<string, string> {
  const out = new Map<string, string>();
  const best = new Map<string, number>();
  for (const p of positions) {
    const s = securities.get(p.security_id);
    if (!s?.cash) continue;
    const score = (s.ticker ?? "").toUpperCase().startsWith("CUR:") ? Infinity : p.quantity;
    if (score > (best.get(p.account_id) ?? -Infinity)) {
      best.set(p.account_id, score);
      out.set(p.account_id, p.security_id);
    }
  }
  return out;
}

/**
 * The value of the accounts on every day in `days` (ascending, ending today),
 * walking back from today's positions through the transactions.
 */
export function rebuild(
  positions: HPosition[],
  txns: HTx[],
  securities: Map<string, HSecurity>,
  closes: Closes,
  days: string[],
  mode: Mode
): { points: HPoint[]; unpriced: string[] } {
  const key = (a: string, s: string) => `${a}|${s}`;
  const qty = new Map<string, number>();
  for (const p of positions) qty.set(key(p.account_id, p.security_id), (qty.get(key(p.account_id, p.security_id)) ?? 0) + p.quantity);
  const buckets = cashBuckets(positions, securities);

  const byDay = new Map<string, HTx[]>();
  for (const t of txns) {
    const list = byDay.get(t.date) ?? [];
    list.push(t);
    byDay.set(t.date, list);
  }

  const unpriced = new Set<string>();
  const valueNow = (day: string) => {
    let total = 0;
    for (const [k, q] of qty) {
      if (Math.abs(q) < 1e-9) continue;
      const sid = k.slice(k.indexOf("|") + 1);
      const s = securities.get(sid);
      let price: number | null;
      if (s?.cash) price = 1;
      else {
        price = s?.ticker ? closeOn(closes.get(s.ticker.toUpperCase()), day) : null;
        if (price == null) {
          // No closing price for this day: hold today's price rather than drop the position.
          price = s?.price ?? 0;
          unpriced.add(s?.ticker || s?.name || sid);
        }
      }
      total += Math.max(0, q) * price;
    }
    return total;
  };

  const out: HPoint[] = [];
  for (let i = days.length - 1; i >= 0; i--) {
    const day = days[i];
    out.push({ day, value: Math.round(valueNow(day) * 100) / 100 });
    // Undo this day's transactions: what's left is the position at the end of the day before.
    for (const t of byDay.get(day) ?? []) {
      if (t.security_id && t.quantity) {
        const k = key(t.account_id, t.security_id);
        qty.set(k, (qty.get(k) ?? 0) - t.quantity);
      }
      if (mode === "cash-flows") {
        const bucket = buckets.get(t.account_id);
        if (bucket && t.security_id !== bucket && t.amount) {
          // amount > 0 was cash out of the account, so before it there was more cash.
          const k = key(t.account_id, bucket);
          qty.set(k, (qty.get(k) ?? 0) + t.amount);
        }
      }
    }
  }
  out.reverse();
  return { points: out, unpriced: [...unpriced].sort() };
}

/** How far a rebuilt series sits from the values recorded on the same days (mean absolute %, null with no overlap). */
export function fitError(points: HPoint[], recorded: HPoint[]): number | null {
  const got = new Map(points.map((p) => [p.day, p.value]));
  const errs: number[] = [];
  for (const r of recorded) {
    const v = got.get(r.day);
    if (v == null || !(r.value > 0)) continue;
    errs.push(Math.abs(v - r.value) / r.value);
  }
  return errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null;
}

/** Keeps the reading that fits the recorded days better ("units" when nothing can tell them apart). */
export function pickMode(results: Record<Mode, HPoint[]>, recorded: HPoint[]): { mode: Mode; error: number | null } {
  const u = fitError(results.units, recorded);
  const c = fitError(results["cash-flows"], recorded);
  if (u == null || c == null) return { mode: "units", error: u ?? c };
  return c < u ? { mode: "cash-flows", error: c } : { mode: "units", error: u };
}

/** Daily closes from Yahoo's public chart data, as [day (New York), close] ascending. Throws when Yahoo answers badly. */
export async function fetchCloses(ticker: string, fromDay: string, fetchImpl: typeof fetch = fetch): Promise<Array<[string, number]>> {
  const p1 = Math.floor(Date.parse(`${fromDay}T00:00:00Z`) / 1000) - 7 * 86400;
  const p2 = Math.floor(Date.now() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${p1}&period2=${p2}&interval=1d&events=history`;
  const res = await fetchImpl(url, { headers: { "User-Agent": "Mozilla/5.0 (BFO; +https://www.burtonfamilyoffice.com)" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`yahoo ${ticker} ${res.status}`);
  const body = (await res.json()) as { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> } };
  return parseCloses(body);
}

export function parseCloses(body: { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> } }): Array<[string, number]> {
  const r = body.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const close = r?.indicators?.quote?.[0]?.close ?? [];
  const ny = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const out: Array<[string, number]> = [];
  ts.forEach((t, i) => {
    const c = close[i];
    if (c != null && Number.isFinite(c)) out.push([ny.format(new Date(t * 1000)), c]);
  });
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return out;
}
