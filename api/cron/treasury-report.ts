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
  };
};

type DailyTotal = { day: string; cash: number; invested: number; credit: number };

type Account = {
  institution_name: string;
  name: string;
  official_name: string | null;
  nickname: string | null;
  mask: string | null;
  type: string;
  balance_current: number | null;
  currency: string | null;
  change: number | null;
  hidden?: boolean;
};

const APP_URL = "https://www.burtonfamilyoffice.com";

const money = (n: number | null | undefined, currency = "USD") =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);

const signed = (n: number, currency = "USD") =>
  `${n >= 0 ? "+" : "−"}${new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Math.abs(n))}`;

async function loadHistory(): Promise<DailyTotal[]> {
  try {
    const rows = await sb<DailyTotal[]>(
      "treasury_daily?select=day,cash,invested,credit&order=day.desc&limit=30"
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
  totalValue: number;
};

function shape(accounts: Account[]): Shaped {
  const nonzero = (a: Account) => Math.abs(a.balance_current ?? 0) >= 0.005;
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
    totalValue: cash + invested - credit,
  };
}

function reportDate(now: Date): string {
  return now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function subjectLine(s: Shaped, movement: number, sample: boolean): string {
  const move = movement === 0 ? "" : ` · ${signed(movement)}`;
  return `${sample ? "[Sample] " : ""}BFO Treasury — ${money(s.totalValue)}${move}`;
}

// ── Plain-text body ───────────────────────────────────────────────────

function renderText(s: Shaped, movement: number, now: Date): string {
  const line = (a: Account) => {
    const delta = a.change ? ` (${signed(a.change, a.currency ?? "USD")})` : "";
    return `  ${a.institution_name} ${accountLabel(a)}: ${money(a.balance_current, a.currency ?? "USD")}${delta}`;
  };
  const out = [
    `BFO Treasury — ${reportDate(now)}`,
    `Total value ${money(s.totalValue)} · Cash ${money(s.cash)} · Investments ${money(s.invested)}${
      s.credit ? ` · Credit −${money(s.credit)}` : ""
    }`,
    movement === 0 ? "No movement since the last report." : `${signed(movement)} since the last report.`,
    "",
  ];
  if (s.cashAccounts.length) out.push("CASH", ...s.cashAccounts.map(line));
  if (s.zeroCounts.cash) out.push(`  (+ ${s.zeroCounts.cash} zero-balance account${s.zeroCounts.cash === 1 ? "" : "s"})`);
  if (s.investAccounts.length) out.push("", "INVESTMENTS", ...s.investAccounts.map(line));
  if (s.creditAccounts.length) out.push("", "CREDIT CARDS", ...s.creditAccounts.map(line));
  out.push("", `Open Treasury: ${APP_URL}/treasury`);
  return out.join("\n");
}

// ── HTML body ─────────────────────────────────────────────────────────

/** Email-safe trend graph: fixed-height table cells, no SVG, no script. */
function renderGraph(history: DailyTotal[]): string {
  if (history.length < 2) return "";
  const totals = history.map((d) => Number(d.cash) + Number(d.invested));
  const max = Math.max(...totals);
  if (max <= 0) return "";
  const H = 54;
  const cols = history
    .map((d, i) => {
      const h = Math.max(3, Math.round((totals[i] / max) * H));
      return `<td align="center" valign="bottom" style="padding:0 1px;">
        <div style="height:${H - h}px;font-size:0;line-height:0;">&nbsp;</div>
        <div style="height:${h}px;border-radius:2px 2px 0 0;background:linear-gradient(180deg,#34d399,#0d9488);font-size:0;line-height:0;">&nbsp;</div>
      </td>`;
    })
    .join("");
  const first = history[0].day.slice(5).replace("-", "/");
  const last = history[history.length - 1].day.slice(5).replace("-", "/");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
    <tr>${cols}</tr>
    <tr><td colspan="${history.length}" style="padding-top:6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:10px;color:rgba(255,255,255,0.35);">${first}</td>
        <td align="right" style="font-size:10px;color:rgba(255,255,255,0.35);">${last}</td>
      </tr></table>
    </td></tr>
  </table>`;
}

function renderHtml(s: Shaped, movement: number, history: DailyTotal[], now: Date): string {
  const statCard = (label: string, value: string) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:rgba(255,255,255,0.045);border:1px solid rgba(255,255,255,0.10);border-radius:14px;">
      <tr><td style="padding:12px 14px;">
        <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.4);">${label}</div>
        <div style="margin-top:4px;font-size:18px;font-weight:600;color:#fff;">${value}</div>
      </td></tr>
    </table>`;

  const row = (a: Account, liability = false) => {
    const delta = a.change
      ? `<div style="font-size:12px;margin-top:1px;color:${a.change > 0 ? "#34d399" : "#fb7185"};">${signed(a.change, a.currency ?? "USD")}</div>`
      : "";
    return `<tr>
      <td style="padding:9px 0;border-top:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.85);font-size:13px;">
        ${accountLabel(a)}<br/>
        <span style="color:rgba(255,255,255,0.4);font-size:11px;">${a.institution_name}</span>
      </td>
      <td align="right" valign="middle" style="padding:9px 0;border-top:1px solid rgba(255,255,255,0.08);color:${liability ? "#fda4af" : "#fff"};font-size:14px;font-weight:600;">
        ${liability ? "−" : ""}${money(a.balance_current, a.currency ?? "USD")}${delta}
      </td>
    </tr>`;
  };

  const zeroRow = (n: number) =>
    n === 0
      ? ""
      : `<tr><td colspan="2" style="padding:8px 0;border-top:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.35);font-size:12px;">
          + ${n} zero-balance account${n === 1 ? "" : "s"}
        </td></tr>`;

  const section = (
    title: string,
    list: Account[],
    subtotal: string,
    opts: { zeros?: number; liability?: boolean } = {}
  ) =>
    list.length === 0 && !opts.zeros
      ? ""
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
          <tr>
            <td style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(255,255,255,0.45);padding-bottom:7px;">${title}</td>
            <td align="right" style="font-size:11px;color:rgba(255,255,255,0.55);padding-bottom:7px;">${subtotal}</td>
          </tr>
          ${list.map((a) => row(a, opts.liability)).join("")}
          ${zeroRow(opts.zeros ?? 0)}
        </table>`;

  const preheader = `Total ${money(s.totalValue)} · Cash ${money(s.cash)} · Investments ${money(s.invested)}${
    movement === 0 ? "" : ` · ${signed(movement)} since last report`
  }`;

  return `<!doctype html><html><head>
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
</head><body style="margin:0;background:#000;padding:28px 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" bgcolor="#000000">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:520px;background:#0b0b0b;border:1px solid rgba(255,255,255,0.12);border-radius:20px;" cellpadding="0" cellspacing="0" bgcolor="#0b0b0b">
      <tr><td style="padding:28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td>
            <div style="font-size:24px;font-weight:700;color:#fff;letter-spacing:-0.02em;">BFO</div>
            <div style="margin-top:3px;font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:rgba(255,255,255,0.4);">Treasury report</div>
          </td>
          <td align="right" valign="top" style="font-size:11px;color:rgba(255,255,255,0.4);">${reportDate(now)}</td>
        </tr></table>

        <div style="margin-top:22px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.4);">Total value</div>
        <div style="margin-top:3px;font-size:30px;font-weight:600;color:#fff;">${money(s.totalValue)}</div>
        <div style="margin-top:3px;font-size:12px;color:${movement === 0 ? "rgba(255,255,255,0.45)" : movement > 0 ? "#34d399" : "#fb7185"};">
          ${movement === 0 ? "No movement since the last report" : `${signed(movement)} since the last report`}
        </div>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;"><tr>
          <td width="${s.credit ? "32%" : "49%"}" valign="top">${statCard("Cash", money(s.cash))}</td>
          <td width="2%"></td>
          <td width="${s.credit ? "32%" : "49%"}" valign="top">${statCard("Investments", money(s.invested))}</td>
          ${s.credit ? `<td width="2%"></td><td width="32%" valign="top">${statCard("Credit", `−${money(s.credit)}`)}</td>` : ""}
        </tr></table>

        ${renderGraph(history)}
        ${section("Cash", s.cashAccounts, money(s.cash), { zeros: s.zeroCounts.cash })}
        ${section("Investments", s.investAccounts, money(s.invested), { zeros: s.zeroCounts.invest })}
        ${section("Credit cards", s.creditAccounts, `−${money(s.credit)}`, { liability: true })}

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px;border-top:1px solid rgba(255,255,255,0.10);">
          <tr><td style="padding-top:16px;" align="center">
            <a href="${APP_URL}/treasury"
              style="display:inline-block;background:#ffffff;color:#000000;font-size:13px;font-weight:600;text-decoration:none;padding:10px 22px;border-radius:10px;">
              Open Treasury
            </a>
            <div style="margin-top:12px;font-size:11px;color:rgba(255,255,255,0.3);">
              Sent by BFO · <a href="${APP_URL}/notifications" style="color:rgba(255,255,255,0.45);text-decoration:underline;">manage report schedule</a>
            </div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

// ── Handler ───────────────────────────────────────────────────────────

async function fetchTreasury(origin: string, headers: Record<string, string>): Promise<Account[]> {
  const res = await fetch(`${origin}/api/plaid/data?report=treasury`, { headers });
  if (!res.ok) throw new Error(`treasury fetch failed (${res.status})`);
  const data = (await res.json()) as { accounts: Account[] };
  return data.accounts.filter((a) => !a.hidden);
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

      const accounts = await fetchTreasury(origin, {
        Authorization: req.headers.authorization ?? "",
      });
      const s = shape(accounts);
      const movement = accounts.reduce((sum, a) => sum + (a.change ?? 0), 0);
      const history = await loadHistory();

      await sendEmail(
        me.email,
        subjectLine(s, movement, true),
        renderText(s, movement, now),
        renderHtml(s, movement, history, now)
      );
      return res.status(200).json({ sent: true, to: me.email });
    } catch (err) {
      console.error("sample treasury report failed:", err);
      return res
        .status(500)
        .json({ error: "send_failed", message: err instanceof Error ? err.message : String(err) });
    }
  }

  // Scheduled cron path. Vercel sends Authorization: Bearer $CRON_SECRET.
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const users = await sb<Array<AppUser & { notification_prefs: Prefs }>>(
      "app_users?status=eq.approved&select=id,name,email,phone,role,status,notification_prefs"
    );
    const due = users.filter((u) => isDue(u.notification_prefs ?? {}, now));
    if (due.length === 0) return res.status(200).json({ sent: 0, considered: users.length });

    // One Plaid pull serves everyone — the report is the office's, not per-user.
    const accounts = await fetchTreasury(origin, { "x-internal-cron": secret ?? "" });
    const s = shape(accounts);
    const movement = accounts.reduce((sum, a) => sum + (a.change ?? 0), 0);
    const history = await loadHistory();

    const results: Array<{ user: string; ok: boolean; error?: string }> = [];
    for (const user of due) {
      try {
        if (!user.email) throw new Error("no email on file");
        await sendEmail(
          user.email,
          subjectLine(s, movement, false),
          renderText(s, movement, now),
          renderHtml(s, movement, history, now)
        );
        await sb("report_deliveries", {
          method: "POST",
          prefer: "resolution=merge-duplicates",
          body: [{ user_id: user.id, report: "treasury", sent_at: now.toISOString() }],
        });
        results.push({ user: user.email, ok: true });
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
