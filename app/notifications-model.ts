/**
 * The Notifications page's plain-language pieces, kept apart from the page
 * so they can be tested: the sentence that says when the Treasury report goes
 * out (built from the choice and the cron's real hour), the scheduled jobs'
 * names and statuses in words, and repeated alerts grouped.
 */

import { count, date, relative } from "./ui/format";

/** The Treasury report's cron: 12:00 UTC every day (vercel.json). */
const CRON_UTC_HOUR = 12;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type ReportPrefs = { frequency?: string; dayOfWeek?: number; dayOfMonth?: number };

/** "7 AM": the hour the cron runs, in Eastern time, on the given day (it moves with daylight saving). */
export function easternHour(on: Date): string {
  const at = new Date(Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate(), CRON_UTC_HOUR));
  return at.toLocaleTimeString("en-US", { hour: "numeric", timeZone: "America/New_York" });
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

/**
 * "Goes out every Monday at about 7 AM Eastern to you and 2 others.",
 * from the frequency, the day and the number of people on the list.
 * Null when the report is off.
 */
export function scheduleLine(p: ReportPrefs, others: number, now = new Date()): string | null {
  const when =
    p.frequency === "daily"
      ? "every day"
      : p.frequency === "weekly"
        ? `every ${DAYS[p.dayOfWeek ?? 1] ?? "Monday"}`
        : p.frequency === "monthly"
          ? `on the ${ordinal(p.dayOfMonth ?? 1)} of each month`
          : null;
  if (!when) return null;
  const to = others ? `you and ${count(others, "other", "others")}` : "you";
  return `Goes out ${when} at about ${easternHour(now)} Eastern to ${to}.`;
}

/** The office's scheduled jobs in plain words, and how often each should run (hours), to tell a late one. */
export const JOBS: Record<string, { title: string; everyHours: number }> = {
  "treasury-report": { title: "Balances and the Treasury report", everyHours: 24 },
  "books-sync": { title: "Books sync", everyHours: 24 },
  stable: { title: "Paper mail", everyHours: 1 },
  "state-records": { title: "State records", everyHours: 24 },
  "investment-history": { title: "Investment history", everyHours: 24 * 7 },
  "game-assets": { title: "Signing game pictures", everyHours: 1 },
  "mail-purge": { title: "Mail clean-up", everyHours: 24 },
};

export const jobTitle = (name: string) => JOBS[name]?.title ?? name.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());

export type CronLast = { name: string; started_at: string | null; finished_at: string | null; ok: boolean | null; note: string | null };

/** Whether a note is machine output (JSON, ISO stamps) that belongs behind "Technical details". */
export const isMachineText = (s: string) => /^\s*[[{]/.test(s) || /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) || /"\w+":/.test(s);

/** A job's last run in words, with a tone: failed (negative), late or never run (warning), or fine (neutral). */
export function jobStatus(c: CronLast, now = new Date()): { tone: "neutral" | "warning" | "negative"; text: string; note: string | null } {
  const every = JOBS[c.name]?.everyHours ?? 24;
  const firstLine = (c.note ?? "").split("\n")[0].trim();
  const skipped = /^skipped/i.test(firstLine);
  const plainNote = firstLine && !isMachineText(firstLine) ? firstLine.replace(/^skipped:\s*/i, "").replace(/^./, (ch) => ch.toUpperCase()) : null;
  if (!c.started_at) return { tone: "warning", text: "Hasn’t run yet", note: null };
  const at = Date.parse(c.started_at);
  const when = now.getTime() - at < 24 * 3600_000 ? relative(c.started_at, now).toLowerCase() : date(c.started_at);
  if (c.ok === false) return { tone: "negative", text: `Failed ${when}`, note: plainNote };
  if (!c.finished_at) return { tone: now.getTime() - at > 3600_000 ? "warning" : "neutral", text: `Running since ${when}`, note: null };
  const late = now.getTime() - at > every * 3600_000 * 1.1 + 2 * 3600_000;
  if (skipped) return { tone: late ? "warning" : "neutral", text: `Skipped ${when}`, note: plainNote };
  return { tone: late ? "warning" : "neutral", text: late ? `Last ran ${when}` : `Ran ${when}`, note: plainNote };
}

export type OpsAlert = { id: string; kind: string; title: string; detail: string | null; created_at: string; acknowledged_at: string | null };

/** Open alerts, the same kind and title grouped: one row, how many times, the latest first. */
export function groupAlerts(alerts: OpsAlert[]): { key: string; title: string; kind: string; detail: string | null; ids: string[]; times: number; latest: string }[] {
  const groups = new Map<string, { key: string; title: string; kind: string; detail: string | null; ids: string[]; times: number; latest: string }>();
  for (const a of alerts) {
    if (a.acknowledged_at) continue;
    const key = `${a.kind}\u0000${a.title}`;
    const g = groups.get(key);
    if (g) {
      g.ids.push(a.id);
      g.times += 1;
      if (a.created_at > g.latest) {
        g.latest = a.created_at;
        g.detail = a.detail;
      }
    } else groups.set(key, { key, title: a.title, kind: a.kind, detail: a.detail, ids: [a.id], times: 1, latest: a.created_at });
  }
  return [...groups.values()].sort((x, y) => y.latest.localeCompare(x.latest));
}

/** An alert's title in plain words: "game-assets cron didn't finish cleanly" → "Signing game pictures didn't finish cleanly". */
export function alertTitle(a: { kind: string; title: string }): string {
  let t = a.title;
  for (const [name, job] of Object.entries(JOBS)) t = t.replace(new RegExp(`\\b${name}\\s+cron\\b`, "i"), job.title).replace(new RegExp(`^cron:${name}\\b`, "i"), job.title);
  return t.replace(/^./, (c) => c.toUpperCase());
}
