/**
 * Anticipated monthly cash coming in — the income streams the books show
 * arriving on a rhythm (rent, Social Security, payroll reimbursements,
 * interest), each normalised to a per-month figure. Pure functions over
 * ledger rows; the Treasury report loads the rows and calls these.
 *
 * Only real income counts: posted, on visible accounts, effective type
 * "normal" (no transfers, roll-ups or loan legs), booked outside the 9000s.
 */

export type InflowRow = {
  date: string;
  /** Plaid sign convention: inflows are negative. */
  amount: number | string;
  merchant_name: string | null;
  name: string | null;
  book_category: string | null;
  entity_name: string | null;
  type_override: string | null;
  txn_type: string;
  intercompany: boolean;
  loan_id: string | null;
};

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

export type InflowStream = {
  source: string;
  entity: string | null;
  account: string | null;
  cadence: Cadence;
  /** Per-month equivalent — what the headline sums. */
  monthly: number;
  /** The typical single payment (or monthly total, for monthly streams). */
  typical: number;
  lastDate: string;
  nextExpected: string | null;
  /** The expected date has passed by a few days with nothing arriving. */
  overdue: boolean;
  count: number;
  /**
   * detected: read off the ledger's rhythm. planned: a person entered it
   * (books_expected_inflows). estimated: computed from a balance or yield.
   */
  basis?: "detected" | "planned" | "estimated";
  /** Short provenance shown under the name, e.g. "from 3 months of dividends". */
  note?: string | null;
};

/** A planned inflow from books_expected_inflows. */
export type PlannedInflow = {
  name: string;
  amount: number;
  cadence: "monthly" | "one_time";
  expectedDay?: number | null;
  entity?: string | null;
  note?: string | null;
};

export type InflowOptions = {
  /** Detected sources to leave out (case-insensitive substring match). */
  exclude?: string[];
  planned?: PlannedInflow[];
  /** Streams the caller computed itself (e.g. money-market earnings). */
  computed?: InflowStream[];
};

export type OneTimeInflow = { name: string; amount: number; expectedDate: string | null; entity: string | null; note: string | null };

export type Anticipated = {
  /** Sum of every active stream's monthly equivalent. */
  monthly: number;
  streams: InflowStream[];
  /** Planned one-off receipts — listed, never folded into the monthly figure. */
  oneTime: OneTimeInflow[];
  /** Average of all qualifying inflows over the trailing 91 days, per month. */
  trailing3moAvg: number;
  /** Inflows that arrived but sit outside any stream — irregular income. */
  irregular3moAvg: number;
};

const DAY = 86400000;
const MONTH_DAYS = 365.25 / 12;

const CADENCE_DAYS: Record<Cadence, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 91,
  yearly: 365,
};

/** Median gap between distinct payment dates → cadence, or null if irregular. */
export function cadenceFromGap(gap: number): Cadence | null {
  if (gap >= 5 && gap <= 9) return "weekly";
  if (gap >= 12 && gap <= 16) return "biweekly";
  if (gap >= 25 && gap <= 36) return "monthly";
  if (gap >= 80 && gap <= 100) return "quarterly";
  if (gap >= 340 && gap <= 390) return "yearly";
  return null;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

function isIncome(t: InflowRow): boolean {
  if (Number(t.amount) >= 0) return false;
  if (t.loan_id) return false;
  const eff =
    t.type_override === "normal" || t.type_override === "transfer" || t.type_override === "intercompany"
      ? t.type_override
      : t.intercompany
        ? "intercompany"
        : t.txn_type === "transfer"
          ? "transfer"
          : "normal";
  if (eff !== "normal") return false;
  if (t.book_category && /^9/.test(t.book_category.trim())) return false;
  return true;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Next occurrence of a day-of-month on or after today, as ISO. */
function nextMonthlyDate(todayIso: string, dom: number | null | undefined): string | null {
  if (!dom || dom < 1 || dom > 31) return null;
  const [y, m, d] = todayIso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + (d > dom ? 1 : 0), 1));
  const lastDom = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(dom, lastDom));
  return isoDay(target);
}

export function anticipateInflows(rows: InflowRow[], today = new Date(), opts: InflowOptions = {}): Anticipated {
  const todayIso = isoDay(today);
  const todayMs = Date.parse(todayIso);
  const income = rows.filter(isIncome).sort((a, b) => a.date.localeCompare(b.date));
  const excluded = (opts.exclude ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean);

  // Group by source identity — the vendor, else the raw descriptor.
  const bySource = new Map<string, InflowRow[]>();
  for (const t of income) {
    const key = (t.merchant_name || t.name || "").trim();
    if (!key) continue;
    if (excluded.some((x) => key.toLowerCase().includes(x))) continue;
    (bySource.get(key) ?? bySource.set(key, []).get(key)!).push(t);
  }

  const streams: InflowStream[] = [];
  const inStream = new Set<InflowRow>();

  for (const [source, txns] of bySource) {
    // Several deposits on one day (e.g. multiple Social Security beneficiaries)
    // are one payment event; the cadence lives between distinct dates.
    const byDate = new Map<string, number>();
    for (const t of txns) byDate.set(t.date, (byDate.get(t.date) ?? 0) + -Number(t.amount));
    const dates = [...byDate.keys()].sort();
    if (dates.length < 2) continue;

    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) gaps.push(Math.round((Date.parse(dates[i]) - Date.parse(dates[i - 1])) / DAY));
    const g = median(gaps);
    const regularity = gaps.filter((x) => Math.abs(x - g) <= Math.max(3, g * 0.25)).length / gaps.length;
    const gapCadence = cadenceFromGap(g);
    const lastDate = dates[dates.length - 1];
    const events = dates.slice(-6).map((d) => byDate.get(d)!);

    let cadence: Cadence | null = null;
    let typical = 0;
    if ((gapCadence === "weekly" || gapCadence === "biweekly") && dates.length >= 3 && regularity >= 0.6) {
      // Short cycles are best read from the gap pattern.
      cadence = gapCadence;
      typical = median(events);
    } else {
      // Monthly is read from calendar coverage instead — rent that lands on
      // the 7th one month and the 12th the next, or Social Security paid in
      // several deposits a month, is still a monthly stream.
      const totals = new Map<string, number>();
      for (const [d, amt] of byDate) totals.set(d.slice(0, 7), (totals.get(d.slice(0, 7)) ?? 0) + amt);
      const months = [...totals.keys()].sort();
      const [fy, fm] = months[0].split("-").map(Number);
      const [ly, lm] = months[months.length - 1].split("-").map(Number);
      const span = (ly - fy) * 12 + (lm - fm) + 1;
      if (months.length >= 3 && months.length / span >= 0.7) {
        cadence = "monthly";
        typical = median(months.slice(-6).map((m) => totals.get(m)!));
      } else if ((gapCadence === "quarterly" || gapCadence === "yearly") && dates.length >= 3 && regularity >= 0.6) {
        // Three hits minimum even for yearly — two payments a year apart is
        // a coincidence as often as a stream.
        cadence = gapCadence;
        typical = median(events);
      }
    }
    if (!cadence) continue;

    // Still alive? The last payment must sit within ~1.6 cadences of today.
    const staleAfter = CADENCE_DAYS[cadence] * 1.6 + 5;
    if ((todayMs - Date.parse(lastDate)) / DAY > staleAfter) continue;

    const monthly =
      cadence === "weekly" ? typical * (52 / 12)
      : cadence === "biweekly" ? typical * (26 / 12)
      : cadence === "monthly" ? typical
      : cadence === "quarterly" ? typical / 3
      : typical / 12;

    // Next expected: monthly streams keep their day of month; others step
    // forward one cadence from the last payment. A date that has slipped
    // past by more than three days is flagged overdue rather than skipped —
    // a missing rent cheque is exactly what the reader wants to see.
    let nextExpected: string | null = null;
    let overdue = false;
    const todayDom = Number(todayIso.slice(8, 10));
    if (cadence === "monthly") {
      const dom = Math.round(median(dates.slice(-6).map((d) => Number(d.slice(8, 10)))));
      const [y, m] = todayIso.split("-").map(Number);
      const paidThisMonth = lastDate.slice(0, 7) === todayIso.slice(0, 7);
      const target = new Date(Date.UTC(y, m - 1 + (paidThisMonth ? 1 : 0), 1));
      const lastDom = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
      target.setUTCDate(Math.min(dom, lastDom));
      nextExpected = isoDay(target);
      overdue = !paidThisMonth && todayDom > dom + 3;
    } else {
      const due = Date.parse(lastDate) + CADENCE_DAYS[cadence] * DAY;
      nextExpected = isoDay(new Date(due));
      overdue = todayMs > due + 3 * DAY;
    }

    const last = txns[txns.length - 1];
    streams.push({
      source,
      entity: last.entity_name,
      account: last.book_category,
      cadence,
      monthly: Math.round(monthly),
      typical: Math.round(typical),
      lastDate,
      nextExpected,
      overdue,
      count: dates.length,
      basis: "detected",
    });
    for (const t of txns) inStream.add(t);
  }

  // Planned inflows ride alongside the detected ones; one-offs are listed
  // separately so a single expected receipt never inflates "per month".
  const oneTime: OneTimeInflow[] = [];
  for (const p of opts.planned ?? []) {
    if (!(p.amount > 0)) continue;
    if (p.cadence === "one_time") {
      oneTime.push({
        name: p.name,
        amount: Math.round(p.amount),
        expectedDate: nextMonthlyDate(todayIso, p.expectedDay),
        entity: p.entity ?? null,
        note: p.note ?? null,
      });
      continue;
    }
    streams.push({
      source: p.name,
      entity: p.entity ?? null,
      account: null,
      cadence: "monthly",
      monthly: Math.round(p.amount),
      typical: Math.round(p.amount),
      lastDate: todayIso,
      nextExpected: nextMonthlyDate(todayIso, p.expectedDay),
      overdue: false,
      count: 0,
      basis: "planned",
      note: p.note ?? null,
    });
  }
  for (const c of opts.computed ?? []) if (c.monthly > 0) streams.push({ ...c, basis: c.basis ?? "estimated" });

  streams.sort((a, b) => b.monthly - a.monthly);

  const since = todayMs - 91 * DAY;
  let trailing = 0;
  let irregular = 0;
  for (const t of income) {
    if (Date.parse(t.date) < since) continue;
    const a = -Number(t.amount);
    trailing += a;
    if (!inStream.has(t)) irregular += a;
  }

  return {
    monthly: Math.round(streams.reduce((s, x) => s + x.monthly, 0)),
    streams,
    oneTime,
    trailing3moAvg: Math.round(trailing / 3),
    irregular3moAvg: Math.round(irregular / 3),
  };
}

const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

const shortDay = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;

/** The email card. `money` is the report's own formatter so styles match. */
export function renderInflowsCard(a: Anticipated, money: (n: number) => string, appUrl: string): string {
  if (!a.streams.length && !a.oneTime.length) return "";
  // Pennies of interest still count toward the total, but don't earn a row.
  const shown = a.streams.filter((s) => s.monthly >= 25).slice(0, 10);
  const hiddenCount = a.streams.length - shown.length;
  const rows = shown
    .map((s, i) => {
      const when = !s.nextExpected
        ? null
        : s.overdue
          ? `<span style="color:#fbbf24;">expected ${shortDay(s.nextExpected)} · overdue</span>`
          : `next ${shortDay(s.nextExpected)}`;
      const label =
        s.basis === "planned" ? "Planned monthly" : s.basis === "estimated" ? "Estimated monthly" : CADENCE_LABEL[s.cadence];
      const meta = [label, s.basis === "planned" && !s.nextExpected ? null : when, s.note].filter(Boolean).join(" · ");
      const equiv = s.cadence === "monthly" ? "" : `<div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:1px;">${money(s.typical)} ${CADENCE_LABEL[s.cadence].toLowerCase()}</div>`;
      const entity = s.entity ? `<span style="margin-left:7px;font-size:10px;color:rgba(255,255,255,0.4);">${s.entity.replace(/\s*\(100%\)\s*$/, "")}</span>` : "";
      return `<tr>
        <td style="padding:9px 0 ${i === shown.length - 1 ? "2px" : "0"};${i ? "border-top:1px solid rgba(255,255,255,0.07);" : ""}font-size:13px;color:rgba(255,255,255,0.85);">
          ${s.source}${entity}
          <div style="margin-top:3px;font-size:11px;color:rgba(255,255,255,0.4);">${meta}</div>
        </td>
        <td align="right" valign="top" style="padding:9px 0;${i ? "border-top:1px solid rgba(255,255,255,0.07);" : ""}font-size:13px;font-weight:600;color:#34d399;white-space:nowrap;">
          +${money(s.monthly)}${equiv}
        </td>
      </tr>`;
    })
    .join("");
  const more = hiddenCount > 0 ? `<div style="margin-top:6px;font-size:11px;color:rgba(255,255,255,0.35);">+${hiddenCount} smaller stream${hiddenCount === 1 ? "" : "s"}</div>` : "";
  const once = a.oneTime.length
    ? `<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.07);font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.4);">Also expected once</div>
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${a.oneTime
         .map(
           (o) => `<tr>
             <td style="padding:6px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">${o.name}${o.entity ? `<span style="margin-left:7px;font-size:10px;color:rgba(255,255,255,0.4);">${o.entity}</span>` : ""}${
               o.expectedDate || o.note ? `<div style="margin-top:2px;font-size:11px;color:rgba(255,255,255,0.4);">${[o.expectedDate ? `expected ${shortDay(o.expectedDate)}` : null, o.note].filter(Boolean).join(" · ")}</div>` : ""
             }</td>
             <td align="right" valign="top" style="padding:6px 0 0;font-size:13px;font-weight:600;color:#34d399;white-space:nowrap;">+${money(o.amount)}</td>
           </tr>`
         )
         .join("")}</table>`
    : "";
  const actual =
    a.trailing3moAvg > 0
      ? `Last 3 months actually averaged <span style="color:rgba(255,255,255,0.7);">${money(a.trailing3moAvg)}</span> / mo${
          a.irregular3moAvg >= 50 ? `, of which <span style="color:rgba(255,255,255,0.7);">${money(a.irregular3moAvg)}</span> was one-off` : ""
        }.`
      : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="margin-top:18px;background:rgba(52,211,153,0.05);border:1px solid rgba(52,211,153,0.22);border-radius:14px;">
    <tr><td style="padding:14px 16px 10px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(255,255,255,0.45);">
            Anticipated cash in
          </td>
          <td align="right" style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.35);">per month</td>
        </tr>
      </table>
      <div style="margin-top:4px;font-size:22px;font-weight:600;color:#34d399;">+${money(a.monthly)}</div>
      <div style="margin-top:2px;font-size:11px;color:rgba(255,255,255,0.4);">${a.streams.length} stream${a.streams.length === 1 ? "" : "s"} expected to keep arriving</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">${rows}</table>
      ${more}
      ${once}
      ${actual ? `<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.07);font-size:11px;color:rgba(255,255,255,0.4);">${actual} <a href="${appUrl}/books/calendar" style="color:rgba(255,255,255,0.55);">Calendar →</a></div>` : ""}
    </td></tr>
  </table>`;
}

/** Plain-text twin of the card. */
export function renderInflowsText(a: Anticipated, money: (n: number) => string): string[] {
  if (!a.streams.length && !a.oneTime.length) return [];
  const out = ["", `ANTICIPATED CASH IN — ${money(a.monthly)} / month`];
  for (const s of a.streams.filter((x) => x.monthly >= 25).slice(0, 10)) {
    const when = !s.nextExpected ? "" : s.overdue ? `, expected ${s.nextExpected} — overdue` : `, next ${s.nextExpected}`;
    const label = s.basis === "planned" ? "planned" : s.basis === "estimated" ? "estimated" : CADENCE_LABEL[s.cadence].toLowerCase();
    out.push(`  ${s.source}: +${money(s.monthly)} / mo (${label}${when}${s.note ? `; ${s.note}` : ""})`);
  }
  for (const o of a.oneTime) out.push(`  Once: ${o.name} +${money(o.amount)}${o.expectedDate ? ` expected ${o.expectedDate}` : ""}`);
  if (a.trailing3moAvg > 0) out.push(`  Last 3 months actual: ${money(a.trailing3moAvg)} / mo avg`);
  return out;
}
