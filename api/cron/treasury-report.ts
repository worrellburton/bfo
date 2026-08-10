import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, formatPhone, sb, sendEmail, sendSms, type AppUser } from "../../lib/auth.js";

/**
 * Fires once a day (see vercel.json) and sends the Treasury report to whoever
 * is due — the cron is daily, the per-user schedule decides who that is.
 */

type Prefs = {
  treasuryReport?: {
    frequency?: "off" | "daily" | "weekly" | "monthly";
    channel?: "email" | "sms";
    dayOfWeek?: number;
    dayOfMonth?: number;
  };
};

type DailyTotal = { day: string; cash: number; invested: number; credit: number };

type Account = {
  institution_name: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  balance_current: number | null;
  currency: string | null;
  change: number | null;
};

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

const money = (n: number | null | undefined, currency = "USD") =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);

const signed = (n: number, currency = "USD") =>
  `${n >= 0 ? "+" : "−"}${new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Math.abs(n))}`;

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

function investedOf(accounts: Account[]): number {
  return accounts
    .filter((a) => a.type === "investment")
    .reduce((sum, a) => sum + (a.balance_current ?? 0), 0);
}

/**
 * Email-safe trend graph: a table of fixed-height cells, no SVG, no JS.
 * Each column is one recorded day of cash + investments.
 */
function renderGraph(history: DailyTotal[]): string {
  if (history.length < 2) return "";
  const totals = history.map((d) => Number(d.cash) + Number(d.invested));
  const max = Math.max(...totals);
  if (max <= 0) return "";
  const H = 56;
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
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;">
    <tr>${cols}</tr>
    <tr>
      <td colspan="${history.length}" style="padding-top:6px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-size:10px;color:rgba(255,255,255,0.35);">${first}</td>
          <td align="right" style="font-size:10px;color:rgba(255,255,255,0.35);">${last}</td>
        </tr></table>
      </td>
    </tr>
  </table>`;
}

function renderText(accounts: Account[], total: number, movement: number): string {
  const line = (a: Account) => {
    const where = `${a.institution_name} ${a.official_name || a.name}${a.mask ? ` ····${a.mask}` : ""}`;
    const delta = a.change ? ` (${signed(a.change, a.currency ?? "USD")})` : "";
    return `  ${where}: ${money(a.balance_current, a.currency ?? "USD")}${delta}`;
  };
  const cash = accounts.filter((a) => a.type === "depository" || a.type === "credit");
  const inv = accounts.filter((a) => a.type === "investment");
  const other = accounts.filter((a) => !cash.includes(a) && !inv.includes(a));
  const invested = investedOf(accounts);

  const out = [
    `BFO Treasury — Cash ${money(total)}${invested > 0 ? ` · Investments ${money(invested)}` : ""}`,
    movement === 0 ? "No movement since the last report." : `${signed(movement)} since the last report.`,
    "",
  ];
  if (cash.length) out.push("CASH", ...cash.map(line), "");
  if (inv.length) out.push("INVESTMENTS", ...inv.map(line), "");
  if (other.length) out.push("OTHER", ...other.map(line));
  return out.join("\n").trimEnd();
}

function renderHtml(
  accounts: Account[],
  total: number,
  movement: number,
  history: DailyTotal[] = []
): string {
  const invested = investedOf(accounts);

  const statCard = (label: string, value: string, sub = "") => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:rgba(255,255,255,0.045);border:1px solid rgba(255,255,255,0.10);border-radius:14px;">
      <tr><td style="padding:14px 16px;">
        <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(255,255,255,0.4);">${label}</div>
        <div style="margin-top:5px;font-size:22px;font-weight:600;color:#fff;white-space:nowrap;">${value}</div>
        ${sub ? `<div style="margin-top:3px;font-size:11px;color:rgba(255,255,255,0.45);">${sub}</div>` : ""}
      </td></tr>
    </table>`;

  const row = (a: Account) => {
    const delta = a.change
      ? `<span style="color:${a.change > 0 ? "#34d399" : "#fb7185"};">${signed(a.change, a.currency ?? "USD")}</span>`
      : `<span style="color:rgba(255,255,255,0.3);">—</span>`;
    return `<tr>
      <td style="padding:9px 0;border-top:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.8);font-size:13px;">
        ${a.institution_name}<br/>
        <span style="color:rgba(255,255,255,0.4);font-size:12px;">${a.official_name || a.name}${a.mask ? ` ····${a.mask}` : ""}</span>
      </td>
      <td align="right" style="padding:9px 0;border-top:1px solid rgba(255,255,255,0.08);color:#fff;font-size:14px;font-weight:600;">
        ${money(a.balance_current, a.currency ?? "USD")}<br/>
        <span style="font-size:12px;font-weight:400;">${delta}</span>
      </td>
    </tr>`;
  };

  const section = (title: string, list: Account[], subtotal: string) =>
    list.length === 0
      ? ""
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px;">
          <tr>
            <td style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(255,255,255,0.4);padding-bottom:8px;">${title}</td>
            <td align="right" style="font-size:11px;color:rgba(255,255,255,0.55);padding-bottom:8px;">${subtotal}</td>
          </tr>
          ${list.map(row).join("")}
        </table>`;

  const cashAccounts = accounts.filter((a) => a.type === "depository" || a.type === "credit");
  const invAccounts = accounts.filter((a) => a.type === "investment");
  const otherAccounts = accounts.filter((a) => !cashAccounts.includes(a) && !invAccounts.includes(a));

  return `<!doctype html><html><body style="margin:0;background:#000;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:520px;background:#0b0b0b;border:1px solid rgba(255,255,255,0.12);border-radius:20px;" cellpadding="0" cellspacing="0">
      <tr><td style="padding:32px;">
        <div style="font-size:26px;font-weight:700;color:#fff;letter-spacing:-0.02em;">BFO</div>
        <div style="margin-top:4px;font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:rgba(255,255,255,0.4);">Treasury report</div>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr>
          <td width="49%" valign="top">${statCard(
            "Cash",
            money(total),
            movement === 0 ? "No movement" : `${signed(movement)} since last report`
          )}</td>
          <td width="2%"></td>
          <td width="49%" valign="top">${statCard("Investments", money(invested))}</td>
        </tr></table>

        ${renderGraph(history)}
        ${section("Cash", cashAccounts, money(total))}
        ${section("Investments", invAccounts, money(invested))}
        ${section("Other", otherAccounts, "")}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;

  // POST = a signed-in user asking for a sample, sent immediately to them
  // alone. GET stays the scheduled cron (Vercel sends Bearer $CRON_SECRET).
  if (req.method === "POST") {
    try {
      const me = await currentUser(req);
      if (!me) return res.status(401).json({ error: "unauthorized" });
      if (!me.email) return res.status(400).json({ error: "no_email", message: "Your account has no email on file." });

      const origin = `https://${req.headers.host}`;
      const treasuryRes = await fetch(`${origin}/api/plaid/data?report=treasury`, {
        // Reuse the caller's session for the internal pull — no cron secret needed.
        headers: { Authorization: req.headers.authorization ?? "" },
      });
      if (!treasuryRes.ok) throw new Error(`treasury fetch failed (${treasuryRes.status})`);
      const raw = (await treasuryRes.json()) as { accounts: Account[] };
    const accounts = raw.accounts.filter((a: any) => !a.hidden);
      const shown = accounts.filter((a: any) => !a.hidden);

      const total = shown
        .filter((a) => a.type === "depository")
        .reduce((sum, a) => sum + (a.balance_current ?? 0), 0);
      const movement = shown.reduce((sum, a) => sum + (a.change ?? 0), 0);

      const history = await loadHistory();
      await sendEmail(
        me.email,
        `BFO Treasury (sample) — ${money(total)}`,
        renderText(shown, total, movement),
        renderHtml(shown, total, movement, history)
      );
      return res.status(200).json({ sent: true, to: me.email });
    } catch (err) {
      console.error("sample treasury report failed:", err);
      return res
        .status(500)
        .json({ error: "send_failed", message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const now = new Date();
    const users = await sb<Array<AppUser & { notification_prefs: Prefs }>>(
      "app_users?status=eq.approved&select=id,name,email,phone,role,status,notification_prefs"
    );

    const due = users.filter((u) => isDue(u.notification_prefs ?? {}, now));
    if (due.length === 0) return res.status(200).json({ sent: 0, considered: users.length });

    // One Plaid pull serves everyone — the report is the family office's, not
    // per-user, so there's no reason to hit Plaid once per recipient.
    const origin = `https://${req.headers.host}`;
    const treasuryRes = await fetch(`${origin}/api/plaid/data?report=treasury`, {
      headers: { "x-internal-cron": secret ?? "" },
    });
    if (!treasuryRes.ok) {
      throw new Error(`treasury fetch failed (${treasuryRes.status})`);
    }
    const raw = (await treasuryRes.json()) as { accounts: Account[] };
    const accounts = raw.accounts.filter((a: any) => !a.hidden);

    const total = accounts
      .filter((a) => a.type === "depository")
      .reduce((sum, a) => sum + (a.balance_current ?? 0), 0);
    const movement = accounts.reduce((sum, a) => sum + (a.change ?? 0), 0);
    const history = await loadHistory();

    const results: Array<{ user: string; ok: boolean; error?: string }> = [];
    for (const user of due) {
      const channel = user.notification_prefs?.treasuryReport?.channel ?? "email";
      try {
        if (channel === "sms" && user.phone) {
          await sendSms(user.phone, renderText(accounts, total, movement));
        } else if (user.email) {
          await sendEmail(
            user.email,
            `BFO Treasury — ${money(total)}`,
            renderText(accounts, total, movement),
            renderHtml(accounts, total, movement, history)
          );
        } else {
          throw new Error(`no ${channel} address on file`);
        }
        await sb("report_deliveries", {
          method: "POST",
          prefer: "resolution=merge-duplicates",
          body: [{ user_id: user.id, report: "treasury", sent_at: now.toISOString() }],
        });
        results.push({ user: user.email ?? formatPhone(user.phone), ok: true });
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
