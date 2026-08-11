import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, formatPhone, sb, sendEmail, type AppUser } from "../../lib/auth.js";

/**
 * The Treasury report email. GET = the daily Vercel cron (sends to whoever's
 * schedule says today); POST = a signed-in user asking for an immediate
 * sample sent to them alone.
 */

type Prefs = {
  treasuryReport?: {
    frequency?: "off" | "daily" | "weekly" | "monthly";
    dayOfWeek?: number;
    dayOfMonth?: number;
    /** Extra inboxes this user's scheduled report also goes to. */
    recipients?: string[];
  };
};

type DailyTotal = { day: string; cash: number; invested: number; credit: number };

type Account = {
  item_id: string;
  account_id: string;
  institution_name: string;
  institution_color: string | null;
  name: string;
  official_name: string | null;
  nickname: string | null;
  mask: string | null;
  type: string;
  balance_current: number | null;
  balance_available: number | null;
  balance_limit: number | null;
  currency: string | null;
  change: number | null;
  hidden?: boolean;
};

type Connection = { institution_name: string; status: string };

type Txn = {
  date: string;
  name: string;
  category: string | null;
  amount: number;
  pending: boolean;
  currency: string | null;
};

// The account whose recent activity rides at the bottom of the report,
// picked by its mask. Override with REPORT_ACTIVITY_MASK.
const ACTIVITY_MASK = process.env.REPORT_ACTIVITY_MASK?.trim() || "1886";
const ACTIVITY_COUNT = 5;

const APP_URL = "https://www.burtonfamilyoffice.com";

/** Cents only under $1,000 — big balances read faster without them. */
const money = (n: number | null | undefined, currency = "USD") =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2,
        minimumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2,
      }).format(n);

const signed = (n: number, currency = "USD") =>
  `${n >= 0 ? "+" : "−"}${new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Math.abs(n))}`;

/** Plaid's brand hex → "r, g, b", with an indigo fallback. */
function tint(hex: string | null): string {
  const fallback = "99, 102, 241";
  if (!hex) return fallback;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** The date of the most recent delivered report, for the "since" line. */
async function lastDeliveryDate(): Promise<string | null> {
  try {
    const rows = await sb<Array<{ sent_at: string }>>(
      "report_deliveries?report=eq.treasury&select=sent_at&order=sent_at.desc&limit=1"
    );
    if (!rows?.[0]) return null;
    return new Date(rows[0].sent_at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "America/New_York",
    });
  } catch {
    return null;
  }
}

async function loadHistory(): Promise<DailyTotal[]> {
  try {
    const rows = await sb<DailyTotal[]>(
      "treasury_daily?select=day,cash,invested,credit&order=day.desc&limit=365"
    );
    return (rows ?? []).reverse();
  } catch {
    return [];
  }
}

/** Does today match this user's chosen schedule, in US Eastern terms? */
function isDue(prefs: Prefs, now: Date): boolean {
  const report = prefs.treasuryReport;
  const frequency = report?.frequency ?? "off";
  if (frequency === "off") return false;
  if (frequency === "daily") return true;
  const eastern = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  if (frequency === "weekly") return eastern.getDay() === (report?.dayOfWeek ?? 1);
  return eastern.getDate() === (report?.dayOfMonth ?? 1);
}

// ── Shared shaping ────────────────────────────────────────────────────

function sumBy(list: Account[], type: string): number {
  return list.filter((a) => a.type === type).reduce((s, a) => s + (a.balance_current ?? 0), 0);
}

function moveBy(list: Account[], type: string): number {
  return list.filter((a) => a.type === type).reduce((s, a) => s + (a.change ?? 0), 0);
}

/** Preferred display name, without repeating a mask the name already carries. */
function accountLabel(a: Account): string {
  const base = a.nickname || a.official_name || a.name || "Account";
  if (!a.mask) return base;
  return base.includes(a.mask) ? base : `${base} ····${a.mask}`;
}

function byBalanceDesc(a: Account, b: Account): number {
  return (b.balance_current ?? 0) - (a.balance_current ?? 0);
}

type Shaped = {
  cashAccounts: Account[];
  investAccounts: Account[];
  creditAccounts: Account[];
  zeroCounts: { cash: number; invest: number };
  cash: number;
  invested: number;
  credit: number;
  cashMove: number;
  investMove: number;
  totalValue: number;
};

function shape(accounts: Account[]): Shaped {
  const nonzero = (a: Account) => Math.abs(a.balance_current ?? 0) >= 0.005;
  // Credit cards stay out of the report entirely (they remain in the CSV).
  const cashAll = accounts.filter((a) => a.type === "depository");
  const investAll = accounts.filter((a) => a.type === "investment");
  const creditAccounts = accounts.filter((a) => a.type === "credit").sort(byBalanceDesc);

  const cash = sumBy(accounts, "depository");
  const invested = sumBy(accounts, "investment");
  const credit = sumBy(accounts, "credit");

  return {
    cashAccounts: cashAll.filter(nonzero).sort(byBalanceDesc),
    investAccounts: investAll.filter(nonzero).sort(byBalanceDesc),
    creditAccounts,
    zeroCounts: {
      cash: cashAll.length - cashAll.filter(nonzero).length,
      invest: investAll.length - investAll.filter(nonzero).length,
    },
    cash,
    invested,
    credit,
    cashMove: moveBy(accounts, "depository"),
    investMove: moveBy(accounts, "investment"),
    totalValue: cash + invested,
  };
}

/** Delta of today's total vs the recorded total closest to N days back. */
function deltaOver(history: DailyTotal[], days: number): { delta: number; pct: number } | null {
  if (history.length < 2) return null;
  const latest = history[history.length - 1];
  const latestTotal = Number(latest.cash) + Number(latest.invested);
  const target = new Date(`${latest.day}T00:00:00Z`).getTime() - days * 86_400_000;
  let best: DailyTotal | null = null;
  let bestGap = Infinity;
  for (const d of history.slice(0, -1)) {
    const gap = Math.abs(new Date(`${d.day}T00:00:00Z`).getTime() - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = d;
    }
  }
  if (!best || best.day === latest.day) return null;
  const base = Number(best.cash) + Number(best.invested);
  const delta = latestTotal - base;
  return { delta, pct: base > 0 ? (delta / base) * 100 : 0 };
}

/** Rule-based one-liner: what actually happened since last time. */
function narrative(s: Shaped): string {
  const c = s.cashMove;
  const i = s.investMove;
  const word = (n: number) => `${n > 0 ? "rose" : "fell"} ${money(Math.abs(n))}`;
  if (c === 0 && i === 0) return "Everything held steady since the last report.";
  if (c !== 0 && i === 0) return `Cash ${word(c)} while investments held steady.`;
  if (c === 0 && i !== 0) return `Investments ${word(i)} while cash held steady.`;
  if (Math.sign(c) === Math.sign(i)) return `Cash ${word(c)} and investments ${word(i)}.`;
  return `Cash ${word(c)}, but investments ${word(i)}.`;
}

/** Last recorded total of each month, most recent six. */
function monthlyCloses(history: DailyTotal[]): Array<{ label: string; total: number }> {
  const byMonth = new Map<string, DailyTotal>();
  for (const d of history) byMonth.set(d.day.slice(0, 7), d); // history is ascending
  const entries = [...byMonth.entries()].slice(-6);
  if (entries.length < 2) return [];
  return entries.map(([key, d]) => ({
    label: new Date(`${key}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "short" }),
    total: Number(d.cash) + Number(d.invested),
  }));
}

/** Percentage-point shift of the cash/invest split vs ~30 days ago. */
function allocationDrift(history: DailyTotal[]): number | null {
  if (history.length < 2) return null;
  const pct = (d: DailyTotal) => {
    const total = Number(d.cash) + Number(d.invested);
    return total > 0 ? (Number(d.invested) / total) * 100 : null;
  };
  const nowPct = pct(history[history.length - 1]);
  const target = new Date(`${history[history.length - 1].day}T00:00:00Z`).getTime() - 30 * 86_400_000;
  let best: DailyTotal | null = null;
  let bestGap = Infinity;
  for (const d of history.slice(0, -1)) {
    const gap = Math.abs(new Date(`${d.day}T00:00:00Z`).getTime() - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = d;
    }
  }
  const thenPct = best ? pct(best) : null;
  if (nowPct == null || thenPct == null) return null;
  const drift = nowPct - thenPct;
  return Math.abs(drift) >= 1 ? drift : null;
}

/** Saturday or Sunday in New York — investment prices are Friday's close. */
function isMarketClosed(now: Date): boolean {
  const day = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getDay();
  return day === 0 || day === 6;
}

/** When this user's next scheduled report lands, in words. */
function nextReportLabel(prefs: Prefs, now: Date): string | null {
  const r = prefs.treasuryReport;
  if (!r || (r.frequency ?? "off") === "off") return null;
  if (r.frequency === "daily") return "tomorrow morning";
  const eastern = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  if (r.frequency === "weekly") {
    const target = r.dayOfWeek ?? 1;
    const days = (target - eastern.getDay() + 7) % 7 || 7;
    const next = new Date(eastern.getTime() + days * 86_400_000);
    return next.toLocaleDateString("en-US", { weekday: "long" });
  }
  const target = r.dayOfMonth ?? 1;
  const next = new Date(eastern);
  if (eastern.getDate() >= target) next.setMonth(next.getMonth() + 1);
  next.setDate(target);
  return next.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

/**
 * If cash has been draining over the recorded month, how long the current
 * balance lasts at that pace. Only speaks up when the answer is sobering.
 */
function cashRunway(history: DailyTotal[], cash: number): string | null {
  const window = history.slice(-30);
  if (window.length < 7 || cash <= 0) return null;
  const days =
    (new Date(`${window[window.length - 1].day}T00:00:00Z`).getTime() -
      new Date(`${window[0].day}T00:00:00Z`).getTime()) /
    86_400_000;
  if (days < 6) return null;
  const drain = (Number(window[0].cash) - Number(window[window.length - 1].cash)) / days;
  if (drain <= 0) return null; // cash is flat or growing — say nothing
  const months = cash / (drain * 30.4);
  if (months > 24) return null;
  return `At this month's pace, cash covers about ${months < 1.5 ? `${Math.round(months * 30)} days` : `${Math.round(months)} months`}.`;
}

/** Tiny in-card sparkline from the last 14 recorded days of one series. */
function sparkline(history: DailyTotal[], pick: (d: DailyTotal) => number, color: string): string {
  const values = history.slice(-14).map(pick);
  if (values.length < 2) return "";
  const max = Math.max(...values);
  if (max <= 0) return "";
  const H = 16;
  const cells = values
    .map((v) => {
      const h = Math.max(2, Math.round((v / max) * H));
      return `<td valign="bottom" style="padding:0 1px;"><div style="height:${h}px;width:100%;min-width:4px;border-radius:1px;background:${color};opacity:0.75;font-size:0;line-height:0;">&nbsp;</div></td>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;" aria-hidden="true"><tr>${cells}</tr></table>`;
}

/** Record high across everything we've ever logged. */
function isAllTimeHigh(history: DailyTotal[]): boolean {
  if (history.length < 5) return false;
  const totals = history.map((d) => Number(d.cash) + Number(d.invested));
  const latest = totals[totals.length - 1];
  return latest >= Math.max(...totals) && latest > 0;
}

function reportDate(now: Date): string {
  return now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function reportTime(now: Date): string {
  return now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function subjectLine(s: Shaped, movement: number, sample: boolean, now: Date, withTime = false): string {
  // No dollar amounts in the subject — inbox lists and lock screens are
  // public in a way the opened email is not. Direction only.
  //
  // Manual sends carry the time: a second same-day email with an identical
  // subject lands in the same Gmail conversation, and Gmail then hides
  // everything that matches the earlier message behind a near-invisible
  // "trimmed content" ellipsis — which on this dark design reads as a huge
  // empty black block. A distinct subject keeps each send its own thread.
  const arrow = movement === 0 ? "" : movement > 0 ? " ▲" : " ▼";
  const day = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
  const time = withTime ? `, ${reportTime(now)} ET` : "";
  return `${sample ? "[Sample] " : ""}BFO Treasury — ${day}${time}${arrow}`;
}


// ── Plain-text body ───────────────────────────────────────────────────

function renderText(
  s: Shaped,
  movement: number,
  now: Date,
  activity: { account: Account; txns: Txn[] } | null = null
): string {
  const line = (a: Account) => {
    const delta = a.change ? ` (${signed(a.change, a.currency ?? "USD")})` : "";
    return `  [${a.institution_name}] ${accountLabel(a)}: ${money(a.balance_current, a.currency ?? "USD")}${delta}`;
  };
  const out = [
    `BFO Treasury — ${reportDate(now)}, ${reportTime(now)} ET`,
    `Total value ${money(s.totalValue)} · Cash ${money(s.cash)} · Investments ${money(s.invested)}`,
    movement === 0 ? "No movement since the last report." : `${signed(movement)} since the last report.`,
    "",
  ];
  if (s.cashAccounts.length) out.push("CASH", ...s.cashAccounts.map(line));
  if (s.zeroCounts.cash) out.push(`  (+ ${s.zeroCounts.cash} zero-balance account${s.zeroCounts.cash === 1 ? "" : "s"})`);
  if (s.investAccounts.length) out.push("", "INVESTMENTS", ...s.investAccounts.map(line));
  if (activity) {
    out.push("", `RECENT ACTIVITY — ${accountLabel(activity.account)}`);
    for (const t of activity.txns) {
      out.push(`  ${t.date}  ${t.name}: ${signed(-t.amount, t.currency ?? "USD")}${t.pending ? " (pending)" : ""}`);
    }
  }
  out.push("", `Open Treasury: ${APP_URL}/treasury`);
  return out.join("\n");
}

// ── HTML body ─────────────────────────────────────────────────────────

/** Email-safe trend graph: fixed-height table cells, no SVG, no script. */
function renderGraph(fullHistory: DailyTotal[]): string {
  const history = fullHistory.slice(-30);
  if (history.length < 2) {
    return `<div style="margin-top:20px;padding:12px 14px;border:1px dashed rgba(255,255,255,0.12);border-radius:12px;font-size:11px;color:rgba(255,255,255,0.35);">
      The 30-day trend appears here after a few days of balance history.
    </div>`;
  }
  const totals = history.map((d) => Number(d.cash) + Number(d.invested));
  const max = Math.max(...totals);
  const min = Math.min(...totals);
  if (max <= 0) return "";
  const windowChange = totals[totals.length - 1] - totals[0];
  const pct = totals[0] > 0 ? (windowChange / totals[0]) * 100 : 0;
  const H = 54;
  // Two-tone stacked bars: cash (sky) under investments (emerald), matching
  // the allocation legend, so composition over time is visible per day.
  const cols = history
    .map((d, i) => {
      const h = Math.max(3, Math.round((totals[i] / max) * H));
      const cashH = totals[i] > 0 ? Math.round((Number(d.cash) / totals[i]) * h) : 0;
      const investH = Math.max(h - cashH, 0);
      return `<td align="center" valign="bottom" style="padding:0 1px;">
        <div style="height:${H - h}px;font-size:0;line-height:0;">&nbsp;</div>
        <div style="height:${investH}px;border-radius:2px 2px 0 0;background:#34d399;font-size:0;line-height:0;">&nbsp;</div>
        <div style="height:${cashH}px;background:#38bdf8;font-size:0;line-height:0;">&nbsp;</div>
      </td>`;
    })
    .join("");
  const first = history[0].day.slice(5).replace("-", "/");
  const last = history[history.length - 1].day.slice(5).replace("-", "/");
  return `<table role="img" aria-label="Balance trend, ${money(totals[0])} to ${money(totals[totals.length - 1])}" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
    <tr>
      <td style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.4);padding-bottom:6px;">Trend</td>
      <td align="right" style="font-size:11px;padding-bottom:6px;color:${windowChange >= 0 ? "#34d399" : "#fb7185"};">
        ${signed(windowChange)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)
      </td>
    </tr>
    <tr><td colspan="2">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cols}</tr></table>
    </td></tr>
    <tr><td colspan="2" style="padding-top:6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:10px;color:rgba(255,255,255,0.35);">${first}</td>
        <td align="center" style="font-size:10px;color:rgba(255,255,255,0.3);">low ${money(min)} · high ${money(max)}</td>
        <td align="right" style="font-size:10px;color:rgba(255,255,255,0.35);">${last}</td>
      </tr></table>
    </td></tr>
  </table>`;
}

function renderActivity(activity: { account: Account; txns: Txn[] } | null): string {
  if (!activity) return "";
  const { account, txns } = activity;
  const inflow = txns.filter((t) => -t.amount > 0).reduce((s, t) => s + -t.amount, 0);
  const outflow = txns.filter((t) => -t.amount < 0).reduce((s, t) => s + t.amount, 0);
  const rows = txns
    .map((t, i) => {
      const date = new Date(`${t.date}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      // Plaid signs outflows positive; flip so money out reads negative.
      const amount = -t.amount;
      return `<tr>
        <td width="52" style="padding:8px 0;${i ? "border-top:1px solid rgba(255,255,255,0.07);" : ""}color:rgba(255,255,255,0.4);font-size:11px;white-space:nowrap;">${date}</td>
        <td style="padding:8px 8px 8px 10px;${i ? "border-top:1px solid rgba(255,255,255,0.07);" : ""}color:rgba(255,255,255,0.85);font-size:13px;">
          ${t.name}${t.pending ? ` <span style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.35);">pending</span>` : ""}
          ${t.category ? `<div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:1px;">${t.category.replace(/_/g, " ").toLowerCase()}</div>` : ""}
        </td>
        <td align="right" style="padding:8px 0;${i ? "border-top:1px solid rgba(255,255,255,0.07);" : ""}font-size:13px;font-weight:600;white-space:nowrap;color:${amount > 0 ? "#34d399" : "#fff"};">
          ${signed(amount, t.currency ?? "USD")}
        </td>
      </tr>`;
    })
    .join("");
  const rgb = tint(account.institution_color);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="margin-top:18px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:14px;">
    <tr><td style="padding:14px 16px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(255,255,255,0.45);padding-bottom:8px;">
            Recent activity
            <span style="letter-spacing:0;text-transform:none;color:rgba(255,255,255,0.3);"> · in <span style="color:#34d399;">${money(inflow)}</span> / out ${money(outflow)}</span>
          </td>
          <td align="right" style="padding-bottom:8px;">
            <span style="display:inline-block;padding:2px 9px;border-radius:999px;font-size:10px;font-weight:600;color:#fff;background:rgba(${rgb},0.28);border:1px solid rgba(${rgb},0.55);">
              ${accountLabel(account)}
            </span>
          </td>
        </tr>
        ${rows}
        <tr><td colspan="3" align="right" style="padding:8px 0 2px;">
          <a href="${APP_URL}/treasury/${account.account_id}" style="font-size:11px;color:rgba(255,255,255,0.45);text-decoration:underline;">See all transactions →</a>
        </td></tr>
      </table>
    </td></tr>
  </table>`;
}

/** One stacked bar: how the total splits between cash and investments. */
function allocationBar(s: Shaped): string {
  const base = s.cash + s.invested;
  if (base <= 0) return "";
  const cashPct = Math.round((s.cash / base) * 100);
  const investPct = 100 - cashPct;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
    <tr><td>
      <div style="height:8px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,0.06);font-size:0;line-height:0;">
        <!--[if !mso]><!--><div style="display:inline-block;height:8px;width:${Math.max(cashPct, 1)}%;background:#38bdf8;">&nbsp;</div><div style="display:inline-block;height:8px;width:${Math.max(investPct, 1)}%;background:#34d399;">&nbsp;</div><!--<![endif]-->
      </div>
    </td></tr>
    <tr><td style="padding-top:5px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:10px;color:rgba(255,255,255,0.45);">■ <span style="color:#38bdf8;">Cash ${cashPct}%</span></td>
        <td align="right" style="font-size:10px;color:rgba(255,255,255,0.45);"><span style="color:#34d399;">Investments ${investPct}%</span> ■</td>
      </tr></table>
    </td></tr>
  </table>`;
}

/** Call out the account that moved the most since the last report. */
function biggestMover(s: Shaped): string {
  const all = [...s.cashAccounts, ...s.investAccounts, ...s.creditAccounts];
  const top = all.reduce<Account | null>(
    (best, a) => (Math.abs(a.change ?? 0) > Math.abs(best?.change ?? 0) ? a : best),
    null
  );
  if (!top || !top.change) return "";
  const rgb = tint(top.institution_color);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
    <tr><td style="padding:9px 12px;background:rgba(${rgb},0.10);border:1px solid rgba(${rgb},0.3);border-radius:10px;font-size:12px;color:rgba(255,255,255,0.75);">
      Biggest mover: <strong style="color:#fff;">${accountLabel(top)}</strong>
      <span style="color:${top.change > 0 ? "#34d399" : "#fb7185"};font-weight:600;">${signed(top.change, top.currency ?? "USD")}</span>
    </td></tr>
  </table>`;
}

/** One chip per institution with its net total, in the bank's colours. */
function bankStrip(accounts: Account[]): string {
  const byBank = new Map<string, { color: string | null; total: number }>();
  for (const a of accounts) {
    const cur = byBank.get(a.institution_name) ?? { color: a.institution_color, total: 0 };
    const sign = a.type === "credit" ? -1 : 1;
    cur.total += sign * (a.balance_current ?? 0);
    byBank.set(a.institution_name, cur);
  }
  if (byBank.size < 2) return "";
  const chips = [...byBank.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([bank, v]) => {
      const rgb = tint(v.color);
      return `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 11px;border-radius:999px;font-size:11px;color:#fff;background:rgba(${rgb},0.22);border:1px solid rgba(${rgb},0.5);">
        ${bank} <strong>${money(v.total)}</strong>
      </span>`;
    })
    .join("");
  return `<div style="margin-top:14px;">${chips}</div>`;
}

function renderHtml(
  s: Shaped,
  movement: number,
  history: DailyTotal[],
  now: Date,
  connections: Connection[] = [],
  activity: { account: Account; txns: Txn[] } | null = null,
  extras: { lastReportDate?: string | null; footerNote?: string | null; preparedFor?: string | null } = {}
): string {
  const statCard = (label: string, value: string, move: number, spark = "") => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:rgba(255,255,255,0.045);border:1px solid rgba(255,255,255,0.10);border-radius:14px;">
      <tr><td style="padding:13px 15px;">
        <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.4);">${label}</div>
        <div style="margin-top:4px;font-size:20px;font-weight:600;color:#fff;">${value}</div>
        <div style="margin-top:3px;font-size:11px;min-height:13px;color:${
          move === 0 ? "rgba(255,255,255,0.3)" : move > 0 ? "#34d399" : "#fb7185"
        };">${move === 0 ? "no change" : signed(move)}</div>
        ${spark}
      </td></tr>
    </table>`;

  /** The bank chip, tinted with the institution's own brand colour. */
  const chip = (a: Account) => {
    const rgb = tint(a.institution_color);
    return `<span style="display:inline-block;padding:2px 9px;border-radius:999px;font-size:10px;font-weight:600;letter-spacing:0.02em;color:#fff;background:rgba(${rgb},0.28);border:1px solid rgba(${rgb},0.55);">${a.institution_name}</span>`;
  };

  const offlineBanks = new Set(connections.filter((c) => c.status !== "online").map((c) => c.institution_name));

  const row = (a: Account, sectionMax: number, liability = false) => {
    const rgb = tint(a.institution_color);
    const share = sectionMax > 0 ? Math.max(2, Math.round(((a.balance_current ?? 0) / sectionMax) * 100)) : 0;
    const stale = offlineBanks.has(a.institution_name)
      ? ` <span style="font-size:10px;color:#fbbf24;" title="Connection needs attention">⚠ stale</span>`
      : "";
    const bal = Math.abs(a.balance_current ?? 0);
    const swing =
      a.change && bal > 0 && Math.abs(a.change) >= 500 && Math.abs(a.change) / bal >= 0.1
        ? ` <span style="font-size:10px;color:${a.change > 0 ? "#34d399" : "#fb7185"};border:1px solid ${a.change > 0 ? "rgba(52,211,153,0.4)" : "rgba(251,113,133,0.4)"};border-radius:999px;padding:1px 6px;">big swing</span>`
        : "";
    const util =
      liability && a.balance_limit && a.balance_limit > 0
        ? `<div style="font-size:11px;margin-top:1px;color:rgba(255,255,255,0.35);">${Math.round(((a.balance_current ?? 0) / a.balance_limit) * 100)}% of ${money(a.balance_limit)} limit</div>`
        : "";
    const delta = a.change
      ? `<div style="font-size:12px;margin-top:1px;color:${a.change > 0 ? "#34d399" : "#fb7185"};">${signed(a.change, a.currency ?? "USD")}</div>`
      : "";
    const avail =
      a.type === "depository" &&
      a.balance_available != null &&
      a.balance_current != null &&
      Math.abs(a.balance_available - a.balance_current) >= 1
        ? `<div style="font-size:11px;margin-top:1px;color:rgba(255,255,255,0.35);">${money(a.balance_available, a.currency ?? "USD")} available</div>`
        : "";
    return `<tr>
      <td style="padding:10px 0 0;font-size:13px;font-weight:500;">
        <a href="${APP_URL}/treasury/${a.account_id}" style="color:rgba(255,255,255,0.88);text-decoration:none;">${accountLabel(a)}</a>${stale}${swing}
        <div style="margin-top:4px;">${chip(a)}</div>
      </td>
      <td align="right" valign="top" style="padding:10px 0 0;color:${liability ? "#fda4af" : "#fff"};font-size:14px;font-weight:600;">
        ${liability ? "−" : ""}${money(a.balance_current, a.currency ?? "USD")}${delta}${util}${avail}
      </td>
    </tr>
    <tr><td colspan="2" style="padding:8px 0 10px;border-bottom:1px solid rgba(255,255,255,0.07);">
      <div style="height:3px;border-radius:999px;background:rgba(255,255,255,0.06);font-size:0;line-height:0;">
        <div style="height:3px;width:${liability ? 0 : share}%;border-radius:999px;background:rgba(${rgb},0.65);font-size:0;line-height:0;">&nbsp;</div>
      </div>
    </td></tr>`;
  };

  const zeroRow = (n: number) =>
    n === 0
      ? ""
      : `<tr><td colspan="2" style="padding:9px 0;color:rgba(255,255,255,0.35);font-size:12px;">
          + ${n} zero-balance account${n === 1 ? "" : "s"}
        </td></tr>`;

  const s_totalForShare = s.cash + s.invested;
  const section = (
    title: string,
    list: Account[],
    subtotal: string,
    move: number,
    opts: { zeros?: number; liability?: boolean } = {}
  ) => {
    if (list.length === 0 && !opts.zeros) return "";
    const sectionMax = Math.max(...list.map((a) => Math.abs(a.balance_current ?? 0)), 0);
    const count = list.length + (opts.zeros ?? 0);
    const sectionSum = list.reduce((t, a) => t + Math.abs(a.balance_current ?? 0), 0);
    const share =
      opts.liability || s_totalForShare <= 0 ? null : Math.round((sectionSum / s_totalForShare) * 100);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="margin-top:18px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:14px;">
      <tr><td style="padding:14px 16px 6px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(255,255,255,0.45);">
              ${title} <span style="color:rgba(255,255,255,0.28);letter-spacing:0;">· ${count}${share != null ? ` · ${share}%` : ""}</span>
            </td>
            <td align="right" style="font-size:11px;color:rgba(255,255,255,0.6);">
              ${subtotal}${move !== 0 ? ` <span style="color:${move > 0 ? "#34d399" : "#fb7185"};">${signed(move)}</span>` : ""}
            </td>
          </tr>
          ${list.map((a) => row(a, sectionMax, opts.liability)).join("")}
          ${zeroRow(opts.zeros ?? 0)}
        </table>
      </td></tr>
    </table>`;
  };

  const offline = connections.filter((c) => c.status !== "online");
  const alertBanner =
    offline.length === 0
      ? ""
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
          style="margin-top:16px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);border-radius:12px;">
          <tr><td style="padding:10px 14px;font-size:12px;color:#fbbf24;">
            ⚠ ${offline.map((c) => c.institution_name).join(", ")} need${offline.length === 1 ? "s" : ""} reconnecting —
            balances shown may be stale. <a href="${APP_URL}/treasury" style="color:#fde68a;">Reconnect</a>
          </td></tr>
        </table>`;

  const empty =
    s.cashAccounts.length + s.investAccounts.length + s.creditAccounts.length === 0 && !s.zeroCounts.cash
      ? `<div style="margin-top:24px;padding:24px;text-align:center;border:1px dashed rgba(255,255,255,0.15);border-radius:14px;color:rgba(255,255,255,0.45);font-size:13px;">
          No accounts connected yet — <a href="${APP_URL}/treasury" style="color:#fff;">connect a bank</a> and the next report will have the numbers.
        </div>`
      : "";

  // The preview line sits right next to the subject in the inbox, so it stays
  // amount-free as well; the numbers wait until the email is opened.
  const preheader = "Your balances, movement and recent activity are inside.";

  return `<!doctype html><html lang="en"><head>
  <title>BFO Treasury report</title>
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
</head><body style="margin:0;background:#000;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" bgcolor="#000000">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:500px;background:#0b0b0b;border:1px solid rgba(255,255,255,0.12);border-radius:20px;" cellpadding="0" cellspacing="0" bgcolor="#0b0b0b">
      <tr><td style="padding:26px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td>
            <div style="font-size:24px;font-weight:700;color:#fff;letter-spacing:-0.02em;">BFO</div>
            <div style="margin-top:3px;font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:rgba(255,255,255,0.4);">Treasury report</div>
          </td>
          <td align="right" valign="top" style="font-size:11px;color:rgba(255,255,255,0.4);">
            ${reportDate(now)}<br/>
            <span style="color:rgba(255,255,255,0.3);">as of ${reportTime(now)} ET</span>
          </td>
        </tr></table>

        <div style="margin-top:22px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.4);">Total value</div>
        <div style="margin-top:3px;font-size:32px;font-weight:600;color:#fff;">
          ${money(s.totalValue)}${isAllTimeHigh(history) ? ` <span style="font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#fbbf24;background:rgba(245,158,11,0.14);border:1px solid rgba(245,158,11,0.4);border-radius:999px;padding:3px 8px;vertical-align:middle;">Record high</span>` : ""}
        </div>
        <div style="margin-top:5px;font-size:12px;color:rgba(255,255,255,0.6);">${narrative(s)}</div>
        ${(() => {
          const runway = cashRunway(history, s.cash);
          return runway ? `<div style="margin-top:3px;font-size:11px;color:#fbbf24;">${runway}</div>` : "";
        })()}
        <div style="margin-top:3px;font-size:12px;color:${movement === 0 ? "rgba(255,255,255,0.45)" : movement > 0 ? "#34d399" : "#fb7185"};">
          ${(() => {
            const since = extras.lastReportDate ? ` (${extras.lastReportDate})` : "";
            return movement === 0
              ? `No movement since the last report${since}`
              : `${movement > 0 ? "▲" : "▼"} ${signed(movement)} since the last report${since}`;
          })()}
        </div>
        ${(() => {
          const d7 = deltaOver(history, 7);
          const d30 = deltaOver(history, 30);
          if (d7 == null && d30 == null) return "";
          const chunk = (label: string, v: { delta: number; pct: number } | null) =>
            v == null
              ? ""
              : `${label} <span style="color:${v.delta >= 0 ? "#34d399" : "#fb7185"};">${signed(v.delta)} (${v.pct >= 0 ? "+" : ""}${v.pct.toFixed(1)}%)</span>`;
          return `<div style="margin-top:2px;font-size:11px;color:rgba(255,255,255,0.35);">${[chunk("7d", d7), chunk("30d", d30)].filter(Boolean).join(" · ")}</div>`;
        })()}

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;"><tr>
          <td width="49%" valign="top">${statCard("Cash", money(s.cash), s.cashMove, sparkline(history, (d) => Number(d.cash), "#38bdf8"))}</td>
          <td width="2%"></td>
          <td width="49%" valign="top">${statCard("Investments", money(s.invested), s.investMove, sparkline(history, (d) => Number(d.invested), "#34d399"))}</td>
        </tr></table>
        ${allocationBar(s)}
        ${(() => {
          const drift = allocationDrift(history);
          if (drift == null) return "";
          return `<div style="margin-top:5px;font-size:11px;color:rgba(255,255,255,0.4);">Allocation shifted ${Math.abs(drift).toFixed(1)}pts toward ${drift > 0 ? "investments" : "cash"} over the last month.</div>`;
        })()}
        ${bankStrip([...s.cashAccounts, ...s.investAccounts])}
        ${(() => {
          const closes = monthlyCloses(history);
          if (!closes.length) return "";
          const cells = closes
            .map(
              (c) => `<td align="center" style="padding:6px 4px;">
                <div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.08em;">${c.label}</div>
                <div style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.8);margin-top:2px;">${money(c.total)}</div>
              </td>`
            )
            .join("");
          return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;"><tr><td style="padding:6px 8px;">
            <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.4);padding:4px 4px 0;">Monthly closes</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>
          </td></tr></table>`;
        })()}
        ${biggestMover(s)}

        ${alertBanner}
        ${renderGraph(history)}
        ${empty}
        ${section("Cash", s.cashAccounts, money(s.cash), s.cashMove, { zeros: s.zeroCounts.cash })}
        ${section(
          isMarketClosed(now) ? "Investments · Friday's close" : "Investments",
          s.investAccounts,
          money(s.invested),
          s.investMove,
          { zeros: s.zeroCounts.invest }
        )}
        ${renderActivity(activity)}

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid rgba(255,255,255,0.10);">
          <tr><td style="padding-top:16px;" align="center">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${APP_URL}/treasury" arcsize="24%" fillcolor="#ffffff" strokecolor="#ffffff" style="height:38px;v-text-anchor:middle;width:160px;">
              <center style="color:#000000;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;">Open Treasury</center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!--><a href="${APP_URL}/treasury"
              style="display:inline-block;background:#ffffff;color:#000000;font-size:13px;font-weight:600;text-decoration:none;padding:10px 22px;border-radius:10px;">
              Open Treasury
            </a><!--<![endif]-->
            <div style="margin-top:12px;font-size:11px;color:rgba(255,255,255,0.3);">
              ${extras.preparedFor ? `Prepared for ${extras.preparedFor} · ` : ""}${extras.footerNote ? `${extras.footerNote} · ` : ""}Balances via Plaid · generated ${reportTime(now)} ET ·
              <a href="${APP_URL}/notifications" style="color:rgba(255,255,255,0.45);text-decoration:underline;">manage schedule</a>
            </div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
    // Gmail clips messages past ~102KB; collapsing template whitespace keeps
    // this report far under it as sections accumulate.
    .replace(/\n\s*/g, "");
}

/** One retry on a transient Bird 5xx; validation errors fail straight out. */
async function sendEmailWithRetry(...args: Parameters<typeof sendEmail>): Promise<void> {
  try {
    await sendEmail(...args);
  } catch (err) {
    const status = /bird email (5\d\d)/.exec(err instanceof Error ? err.message : "")?.[1];
    if (!status) throw err;
    await new Promise((r) => setTimeout(r, 1500));
    await sendEmail(...args);
  }
}

// ── Handler ───────────────────────────────────────────────────────────

async function fetchRecentTxns(
  origin: string,
  headers: Record<string, string>,
  account: Account | undefined
): Promise<{ account: Account; txns: Txn[] } | null> {
  if (!account) return null;
  try {
    const res = await fetch(
      `${origin}/api/plaid/data?report=bank-transactions&item_id=${account.item_id}&account_id=${account.account_id}`,
      { headers }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { transactions?: Txn[] };
    const txns = (data.transactions ?? [])
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, ACTIVITY_COUNT);
    return txns.length ? { account, txns } : null;
  } catch {
    return null;
  }
}

async function fetchTreasury(
  origin: string,
  headers: Record<string, string>
): Promise<{ accounts: Account[]; connections: Connection[] }> {
  const res = await fetch(`${origin}/api/plaid/data?report=treasury`, { headers });
  if (!res.ok) throw new Error(`treasury fetch failed (${res.status})`);
  const data = (await res.json()) as { accounts: Account[]; connections: Connection[] };
  return {
    accounts: data.accounts.filter((a) => !a.hidden),
    connections: data.connections ?? [],
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  const origin = `https://${req.headers.host}`;
  const now = new Date();

  if (req.method === "POST") {
    try {
      const me = await currentUser(req);
      if (!me) return res.status(401).json({ error: "unauthorized" });
      if (!me.email) return res.status(400).json({ error: "no_email", message: "Your account has no email on file." });

      // broadcast:true sends the real report to the whole Send-to list now;
      // otherwise it's a sample to the requester alone.
      const broadcast = req.body?.broadcast === true;

      const authHeaders = { Authorization: req.headers.authorization ?? "" };
      const { accounts, connections } = await fetchTreasury(origin, authHeaders);
      const s = shape(accounts);
      const movement = accounts.reduce((sum, a) => sum + (a.change ?? 0), 0);
      const [history, activity, lastReportDate] = await Promise.all([
        loadHistory(),
        fetchRecentTxns(origin, authHeaders, accounts.find((a) => a.mask === ACTIVITY_MASK)),
        lastDeliveryDate(),
      ]);

      let recipients = [me.email];
      if (broadcast) {
        const rows = await sb<Array<{ notification_prefs: Prefs }>>(
          `app_users?id=eq.${me.id}&select=notification_prefs&limit=1`
        );
        const extra = (rows?.[0]?.notification_prefs?.treasuryReport?.recipients ?? [])
          .map((e) => String(e).trim().toLowerCase())
          .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e));
        recipients = [...new Set([me.email, ...extra])];
      }

      // One message with every recipient visible on the To line, so any of
      // them can Reply All to the whole group.
      {
        await sendEmailWithRetry(
          recipients,
          subjectLine(s, movement, !broadcast, now, true),
          renderText(s, movement, now, activity),
          renderHtml(s, movement, history, now, connections, activity, {
            lastReportDate,
            footerNote: broadcast
              ? `Sent manually by ${me.name ?? me.email}`
              : "This was a sample — it doesn't affect your schedule",
            preparedFor: me.name ?? me.email,
          }),
          { "List-Unsubscribe": `<${APP_URL}/notifications>` },
          undefined,
          { replyTo: me.email }
        );
      }
      return res.status(200).json({ sent: true, to: recipients.join(", "), count: recipients.length });
    } catch (err) {
      console.error("sample treasury report failed:", err);
      return res
        .status(500)
        .json({ error: "send_failed", message: err instanceof Error ? err.message : String(err) });
    }
  }

  // Scheduled cron path. With CRON_SECRET configured Vercel sends
  // Authorization: Bearer $CRON_SECRET; without it we still require the
  // x-vercel-cron header, which Vercel stamps on real cron invocations and
  // strips from outside traffic — so this endpoint is never open to the
  // public internet.
  const authorized = secret
    ? req.headers.authorization === `Bearer ${secret}`
    : !!req.headers["x-vercel-cron"];
  if (!authorized) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const users = await sb<Array<AppUser & { notification_prefs: Prefs }>>(
      "app_users?status=eq.approved&select=id,name,email,phone,role,status,notification_prefs"
    );
    let due = users.filter((u) => isDue(u.notification_prefs ?? {}, now));
    if (due.length === 0) return res.status(200).json({ sent: 0, considered: users.length });

    // A retried cron must not email anyone twice: skip users whose delivery
    // is already recorded today.
    try {
      const today = now.toISOString().slice(0, 10);
      const delivered = await sb<Array<{ user_id: string; sent_at: string }>>(
        `report_deliveries?report=eq.treasury&sent_at=gte.${today}T00:00:00Z&select=user_id,sent_at`
      );
      const done = new Set((delivered ?? []).map((d) => d.user_id));
      due = due.filter((u) => !done.has(u.id));
      if (due.length === 0) return res.status(200).json({ sent: 0, alreadyDelivered: done.size });
    } catch {
      // If the guard can't be read, sending is the safer failure.
    }

    // One Plaid pull serves everyone — the report is the office's, not per-user.
    const cronHeaders = { "x-internal-cron": secret ?? "" };
    let pulled: { accounts: Account[]; connections: Connection[] };
    try {
      pulled = await fetchTreasury(origin, cronHeaders);
    } catch (err) {
      // Silence is the worst failure mode for a scheduled report — tell the
      // subscribers their numbers couldn't be refreshed today.
      const reason = err instanceof Error ? err.message : String(err);
      let notices = 0;
      for (const user of due) {
        if (!user.email) continue;
        try {
          await sendEmailWithRetry(
            user.email,
            `BFO Treasury — balances unavailable today`,
            `We couldn't refresh balances for today's report (${reason}). We'll try again on the next scheduled run.\n\nOpen Treasury: ${APP_URL}/treasury`,
            `<!doctype html><html lang="en"><body style="margin:0;background:#000;padding:28px 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="100%" style="max-width:500px;background:#0b0b0b;border:1px solid rgba(255,255,255,0.12);border-radius:20px;" cellpadding="0" cellspacing="0"><tr><td style="padding:26px 24px;"><div style="font-size:24px;font-weight:700;color:#fff;">BFO</div><div style="margin-top:3px;font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:rgba(255,255,255,0.4);">Treasury report</div><div style="margin-top:20px;padding:12px 14px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);border-radius:12px;font-size:13px;color:#fbbf24;">We couldn't refresh balances for today's report. We'll try again on the next scheduled run.</div><div style="margin-top:16px;text-align:center;"><a href="${APP_URL}/treasury" style="display:inline-block;background:#fff;color:#000;font-size:13px;font-weight:600;text-decoration:none;padding:10px 22px;border-radius:10px;">Open Treasury</a></div></td></tr></table></td></tr></table></body></html>`,
            undefined,
            undefined,
            { idempotencyKey: `treasury-failure/${user.id}/${now.toISOString().slice(0, 10)}` }
          );
          notices++;
        } catch (e) {
          console.error("failure notice failed:", e);
        }
      }
      return res.status(200).json({ sent: 0, failureNotices: notices, reason });
    }
    const { accounts, connections } = pulled;
    const s = shape(accounts);
    const movement = accounts.reduce((sum, a) => sum + (a.change ?? 0), 0);
    const [history, activity, lastReportDate] = await Promise.all([
      loadHistory(),
      fetchRecentTxns(origin, cronHeaders, accounts.find((a) => a.mask === ACTIVITY_MASK)),
      lastDeliveryDate(),
    ]);

    const results: Array<{ user: string; ok: boolean; error?: string }> = [];
    for (const user of due) {
      try {
        const extra = (user.notification_prefs?.treasuryReport?.recipients ?? [])
          .map((e) => String(e).trim().toLowerCase())
          .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e));
        const recipients = [...new Set([user.email, ...extra].filter(Boolean))] as string[];
        if (recipients.length === 0) throw new Error("no email on file");
        const nextLabel = nextReportLabel(user.notification_prefs ?? {}, now);
        // Everyone on one To line so the group can Reply All to each other.
        await sendEmailWithRetry(
          recipients,
          subjectLine(s, movement, false, now),
          renderText(s, movement, now, activity),
          renderHtml(s, movement, history, now, connections, activity, {
            lastReportDate,
            footerNote: nextLabel ? `Next report ${nextLabel}` : null,
            preparedFor: user.name ?? "the Burton Family Office",
          }),
          { "List-Unsubscribe": `<${APP_URL}/notifications>` },
          undefined,
          {
            idempotencyKey: `treasury-report/${user.id}/${now.toISOString().slice(0, 10)}`,
            replyTo: user.email ?? undefined,
          }
        );
        await sb("report_deliveries", {
          method: "POST",
          prefer: "resolution=merge-duplicates",
          body: [{ user_id: user.id, report: "treasury", sent_at: now.toISOString() }],
        });
        results.push({ user: user.email ?? user.id, ok: true });
      } catch (err) {
        console.error(`treasury report failed for ${user.id}:`, err);
        results.push({
          user: user.email ?? formatPhone(user.phone),
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return res.status(200).json({ sent: results.filter((r) => r.ok).length, results });
  } catch (err) {
    console.error("treasury report cron failed:", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
