/**
 * Every figure, date and mask on screen goes through here (docs/DESIGN.md
 * §10, §14.5). Pure functions, no React, tested in tests/format.test.ts. No
 * page builds its own Intl.NumberFormat.
 *
 * Conventions this file owns:
 * - The minus is a true minus (U+2212), never a hyphen.
 * - Zero and nothing differ: null or undefined formats as "" (a blank cell);
 *   zero formats as "—" only where the context asks for the dash.
 * - A calendar date ("2026-11-06") is a day, not an instant: it never shifts
 *   with the viewer's time zone. Timestamps show in the viewer's zone.
 */

export type Sign = "auto" | "always" | "accounting" | "none";

const MINUS = "−";
const DASH = "—";
const EN = "–";
const BULLET = "•";

const numberFormats = new Map<string, Intl.NumberFormat>();
function nf(min: number, max: number): Intl.NumberFormat {
  const key = `${min}/${max}`;
  let f = numberFormats.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max });
    numberFormats.set(key, f);
  }
  return f;
}

/** Rounds half away from zero at `digits` decimals, without binary drift (1.005 → 1.01). */
function round(n: number, digits: number): number {
  const f = 10 ** digits;
  const r = Math.round(Math.abs(n) * f + 1e-9) / f;
  return n < 0 ? -r : r;
}

function signed(body: string, negative: boolean, positive: boolean, sign: Sign): string {
  if (sign === "none") return body;
  if (negative) return sign === "accounting" ? `(${body})` : `${MINUS}${body}`;
  if (positive && sign === "always") return `+${body}`;
  return body;
}

/** "$240K", "$1.2M", "$950": a compact amount for chips and chart axes only (§10.2). */
function compactBody(abs: number): string {
  if (abs < 1000) return nf(0, 0).format(Math.round(abs));
  const steps: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of steps) {
    if (abs >= size * 0.9995) {
      const v = abs / size;
      // One decimal under 10 ($1.2M), whole above ($240K); never "1.0".
      const shown = v < 10 ? round(v, 1) : Math.round(v);
      return `${nf(0, 1).format(shown)}${suffix}`;
    }
  }
  return nf(0, 0).format(Math.round(abs));
}

/**
 * Money, by context (§10.2):
 *   money(-84)                                  → "−$84.00"   (ledger, balances)
 *   money(1250, { sign: "always" })             → "+$1,250.00" (money in, in a mixed list)
 *   money(-2140, { precision: "dollars", sign: "accounting", zero: "dash" }) → "($2,140)" (statements)
 *   money(240000, { precision: "compact" })     → "$240K"
 *   money(null)                                 → ""          (no data)
 *   money(1250, { currency: "EUR" })            → "EUR 1,250.00"
 * Zero is decided after rounding, so 0.004 is zero.
 */
export function money(n: number | null | undefined, o: { precision?: "cents" | "dollars" | "compact"; sign?: Sign; zero?: "dash" | "value"; currency?: string } = {}): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  const precision = o.precision ?? "cents";
  const sign = o.sign ?? "auto";
  const digits = precision === "cents" ? 2 : 0;
  const r = precision === "compact" ? n : round(n, digits);
  const isZero = precision === "compact" ? Math.abs(n) < 0.5 : r === 0;
  if (isZero && o.zero === "dash") return DASH;
  const abs = isZero ? 0 : Math.abs(r);
  const digitsText = precision === "compact" ? compactBody(abs) : nf(digits, digits).format(abs);
  const code = (o.currency ?? "USD").toUpperCase();
  const body = code === "USD" ? `$${digitsText}` : `${code} ${digitsText}`;
  return signed(body, !isZero && r < 0, !isZero && r > 0, sign);
}

/**
 * A percentage; `n` is already in percent (12.5 means 12.5%). The % follows
 * the number with no space (§10.3).
 *   percent(8.64)                         → "8.6%"   (changes, margins: one decimal)
 *   percent(4.25, { decimals: 2 })        → "4.25%"  (rates)
 *   percent(33.3333, { decimals: 2, trim: true }) → "33.33%"; percent(50, { decimals: 2, trim: true }) → "50%" (ownership)
 *   percent(76, { decimals: 0 })          → "76%"    (scores)
 *   percent(-12.5, { sign: "accounting" }) → "(12.5%)" (inside a statement)
 */
export function percent(n: number | null | undefined, o: { decimals?: 0 | 1 | 2; trim?: boolean; sign?: Sign } = {}): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  const decimals = o.decimals ?? 1;
  const r = round(n, decimals);
  const body = `${nf(o.trim ? 0 : decimals, decimals).format(Math.abs(r))}%`;
  return signed(body, r < 0, r > 0, o.sign ?? "auto");
}

const plurals = new Intl.PluralRules("en-US");

/**
 * A count with its noun (§10.4): count(1, "entity", "entities") → "1 entity";
 * count(1204, "row") → "1,204 rows". Zero reads "No entities" in prose;
 * pass { zero: "numeral" } for "0 entities".
 */
export function count(n: number, one: string, other?: string, o: { zero?: "no" | "numeral" } = {}): string {
  const many = other ?? `${one}s`;
  const noun = plurals.select(n) === "one" ? one : many;
  if (n === 0 && (o.zero ?? "no") === "no") return `No ${many}`;
  return `${nf(0, 0).format(n)} ${noun}`;
}

/** Names joined for prose: list(["Alex", "Sam", "Jo"]) → "Alex, Sam, and Jo" (Intl.ListFormat). */
export function list(items: string[], type: "conjunction" | "disjunction" = "conjunction"): string {
  return new Intl.ListFormat("en-US", { style: "long", type }).format(items);
}

// ── Dates ────────────────────────────────────────────────────────────────

type DateInput = Date | string;
type Zoned = { date: Date; timeZone?: string };

const CALENDAR = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar date is pinned to UTC so it reads the same day everywhere; an instant uses the viewer's zone. */
function zoned(d: DateInput, timeZone?: string): Zoned {
  if (typeof d === "string") {
    const m = CALENDAR.exec(d.trim());
    if (m) return { date: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])), timeZone: "UTC" };
    return { date: new Date(d), timeZone };
  }
  return { date: d, timeZone };
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
function df(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(opts);
  let f = dateFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", opts);
    dateFormats.set(key, f);
  }
  return f;
}

/** ICU puts a narrow no-break space before AM/PM; one plain space reads the same in every browser. */
const tidy = (s: string) => s.replace(/[\u202f\u00a0]/g, " ");

function yearOf(z: Zoned): number {
  return Number(df({ year: "numeric", timeZone: z.timeZone }).format(z.date));
}

/**
 * A date (§10.5): "short" is "Nov 6" this year and "Nov 6, 2025" otherwise
 * (lists, rows); "medium" is always "Nov 6, 2026" (fields, headers); "long"
 * is "November 6, 2026" (documents, signed instruments). `now` and
 * `timeZone` are for tests.
 */
export function date(d: DateInput, style: "short" | "medium" | "long" = "short", o: { now?: Date; timeZone?: string } = {}): string {
  const z = zoned(d, o.timeZone);
  if (Number.isNaN(z.date.getTime())) return "";
  if (style === "long") return df({ month: "long", day: "numeric", year: "numeric", timeZone: z.timeZone }).format(z.date);
  if (style === "short") {
    const thisYear = Number(df({ year: "numeric", timeZone: o.timeZone }).format(o.now ?? new Date()));
    if (yearOf(z) === thisYear) return df({ month: "short", day: "numeric", timeZone: z.timeZone }).format(z.date);
  }
  return df({ month: "short", day: "numeric", year: "numeric", timeZone: z.timeZone }).format(z.date);
}

/** "Nov 6, 2026, 3:14 PM"; with { zone: true } the audit form, "Nov 6, 2026, 3:14 PM EST" (§10.5). */
export function dateTime(d: DateInput, o: { zone?: boolean; timeZone?: string } = {}): string {
  const z = zoned(d, o.timeZone);
  if (Number.isNaN(z.date.getTime())) return "";
  return tidy(df({ month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: z.timeZone, ...(o.zone ? { timeZoneName: "short" } : {}) }).format(z.date));
}

/** "3:14 PM" (rows grouped by day show the time alone, §8.9). */
export function time(d: DateInput, o: { timeZone?: string } = {}): string {
  const z = zoned(d, o.timeZone);
  if (Number.isNaN(z.date.getTime())) return "";
  return tidy(df({ hour: "numeric", minute: "2-digit", timeZone: z.timeZone }).format(z.date));
}

/**
 * A range with an en dash (§10.5): "Nov 1–5, 2026" within a month; "Jan 1 –
 * Nov 5, 2026" within a year (spaced, because the ends contain spaces);
 * "Dec 15, 2025 – Jan 10, 2026" across years; one date when both ends match.
 */
export function dateRange(a: DateInput, b: DateInput, o: { timeZone?: string } = {}): string {
  const za = zoned(a, o.timeZone);
  const zb = zoned(b, o.timeZone);
  if (Number.isNaN(za.date.getTime()) || Number.isNaN(zb.date.getTime())) return "";
  const parts = (z: Zoned) => {
    const p = df({ month: "short", day: "numeric", year: "numeric", timeZone: z.timeZone }).formatToParts(z.date);
    const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
    return { month: get("month"), day: get("day"), year: get("year") };
  };
  const pa = parts(za);
  const pb = parts(zb);
  if (pa.year !== pb.year) return `${pa.month} ${pa.day}, ${pa.year} ${EN} ${pb.month} ${pb.day}, ${pb.year}`;
  if (pa.month !== pb.month) return `${pa.month} ${pa.day} ${EN} ${pb.month} ${pb.day}, ${pb.year}`;
  if (pa.day !== pb.day) return `${pa.month} ${pa.day}${EN}${pb.day}, ${pb.year}`;
  return `${pa.month} ${pa.day}, ${pa.year}`;
}

/** "As of Nov 6, 2026, 7:00 AM" (time: sources that update during the day) or "As of Nov 6, 2026" (§10.7). */
export function asOf(d: DateInput, o: { time?: boolean; timeZone?: string } = {}): string {
  return `As of ${o.time ? dateTime(d, { timeZone: o.timeZone }) : date(d, "medium", { timeZone: o.timeZone })}`;
}

/**
 * "Just now", "12 min ago", "3 hours ago" for anything under 24 hours old;
 * otherwise the short date (§10.5). The exact time belongs on hover.
 */
export function relative(d: DateInput, now: Date = new Date(), o: { timeZone?: string } = {}): string {
  const z = zoned(d, o.timeZone);
  const ms = now.getTime() - z.date.getTime();
  if (Number.isNaN(ms)) return "";
  if (ms < 0 || ms >= 24 * 3600_000) return date(d, "short", { now, timeZone: o.timeZone });
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return `${h} ${h === 1 ? "hour" : "hours"} ago`;
}

/** "about 3 minutes", "about 2 hours" (§10.5 durations in plain words). */
export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return s <= 1 ? "a second" : `${s} seconds`;
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? "about a minute" : `about ${m} minutes`;
  const h = Math.round(m / 60);
  if (h < 48) return h === 1 ? "about an hour" : `about ${h} hours`;
  const days = Math.round(h / 24);
  return `about ${days} days`;
}

/** A calendar date as "YYYY-MM-DD" in the viewer's zone (for a date field's value). */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * A typed date in a common form, as "YYYY-MM-DD", or null: "Nov 6, 2026",
 * "November 6 2026", "6 Nov 2026", "11/6/2026", "11/6/26", "2026-11-06".
 * Impossible dates (Feb 30) are null.
 */
export function parseDate(s: string): string | null {
  const t = s
    .trim()
    .toLowerCase()
    .replace(/(\d)(st|nd|rd|th)\b/g, "$1")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ");
  if (!t) return null;
  let y: number | undefined;
  let m: number | undefined;
  let d: number | undefined;
  let r: RegExpExecArray | null;
  if ((r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) [y, m, d] = [+r[1], +r[2], +r[3]];
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t))) [m, d, y] = [+r[1], +r[2], +r[3]];
  else if ((r = /^([a-z]+)\.? (\d{1,2}) (\d{4})$/.exec(t))) [m, d, y] = [monthOf(r[1]), +r[2], +r[3]];
  else if ((r = /^(\d{1,2}) ([a-z]+)\.? (\d{4})$/.exec(t))) [d, m, y] = [+r[1], monthOf(r[2]), +r[3]];
  if (!y || !m || !d) return null;
  if (y < 100) y += y < 70 ? 2000 : 1900;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function monthOf(word: string): number | undefined {
  const i = MONTHS.indexOf(word.slice(0, 3));
  return i >= 0 && (word.length === 3 || "january february march april may june july august september october november december".split(" ")[i].startsWith(word)) ? i + 1 : undefined;
}

/** A typed amount as a number, or null: "$1,250.00", "1250", "(84.00)", "−84". */
export function parseMoney(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const negative = /^\(.*\)$/.test(t) || /^[-−]/.test(t) || /^\$\s*[-−]/.test(t);
  const digits = t.replace(/[()$,\s−-]/g, "");
  if (!/^\d*\.?\d+$|^\d+\.$/.test(digits)) return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// ── Masks and identifiers (§10.8) ────────────────────────────────────────

const lastDigits = (s: string, n: number) => s.replace(/\D/g, "").slice(-n);

/** "•• 4821": an account's last four, appended to its name everywhere. */
export function maskAccount(last4: string): string {
  const d = lastDigits(last4, 4);
  return d ? `${BULLET}${BULLET} ${d}` : "";
}

/** "••-•••6789". The full EIN is shown only behind "Show", to the roles allowed. */
export function maskEin(ein: string): string {
  const d = lastDigits(ein, 4);
  return d ? `${BULLET}${BULLET}-${BULLET}${BULLET}${BULLET}${d}` : "";
}

/** A vendor's TIN: "•••-••-6789" (SSN-type) or "••-•••6789" (EIN-type). */
export function maskTin(tin: string, kind: "ssn" | "ein"): string {
  if (kind === "ein") return maskEin(tin);
  const d = lastDigits(tin, 4);
  return d ? `${BULLET}${BULLET}${BULLET}-${BULLET}${BULLET}-${d}` : "";
}

/** True for the NNN-NN-NNNN pattern, so an EIN field can refuse an SSN with a plain message. */
export function looksLikeSsn(s: string): boolean {
  return /^\s*\d{3}-\d{2}-\d{4}\s*$/.test(s);
}

/** "(555) 010-0142" for a North American number; any other number keeps its international form. */
export function phone(e164: string): string {
  const d = e164.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d.length === 10 && !e164.trim().startsWith("+") ? d : null;
  if (ten) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return e164.trim();
}

/** Words kept in capitals when a shouting account name is tidied. */
const ACRONYMS = new Set([
  "IRA",
  "LLC",
  "LP",
  "LLP",
  "PLLC",
  "ACH",
  "USA",
  "US",
  "CD",
  "HSA",
  "FSA",
  "SEP",
  "JTWROS",
  "TOD",
  "UTMA",
  "UGMA",
  "FBO",
  "DBA",
  "NA",
  "BFO",
  "EIN",
  "ATM",
  "SIMPLE",
  "USD",
  "II",
  "III",
  "IV",
]);

function tidyName(name: string): string {
  const spaced = name.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  // Only shouting text is recased; a name someone typed in mixed case is theirs.
  if (spaced !== spaced.toUpperCase() || !/[A-Z]/.test(spaced)) return spaced;
  return spaced
    .split(" ")
    .map((w) => {
      const bare = w.replace(/[^A-Z0-9]/g, "");
      if (ACRONYMS.has(bare)) return w;
      if (/^\d+\(K\)$/.test(w)) return w.toLowerCase();
      return w.charAt(0) + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/** "Operating checking •• 4821": the nickname, else the tidied name, then the mask (§10.8). */
export function accountLabel(a: { nickname?: string | null; name?: string | null; mask?: string | null }): string {
  const base = (a.nickname && a.nickname.trim()) || tidyName(a.name ?? "") || "Account";
  const m = a.mask ? maskAccount(a.mask) : "";
  return m ? `${base} ${m}` : base;
}

const ACCOUNT_TYPES: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  "money market": "Money market",
  cd: "CD",
  ira: "IRA",
  "traditional ira": "Traditional IRA",
  "rollover ira": "Rollover IRA",
  roth: "Roth IRA",
  "roth ira": "Roth IRA",
  "sep ira": "SEP IRA",
  "simple ira": "SIMPLE IRA",
  "401k": "401(k)",
  "401(k)": "401(k)",
  "roth 401k": "Roth 401(k)",
  "403b": "403(b)",
  "403(b)": "403(b)",
  "529": "529 plan",
  hsa: "HSA",
  brokerage: "Brokerage",
  "non-taxable brokerage account": "Brokerage",
  "credit card": "Credit card",
  credit: "Credit card",
  mortgage: "Mortgage",
  loan: "Loan",
  "line of credit": "Line of credit",
  "cash management": "Cash management",
  trust: "Trust",
};

/** An account type from its subtype, by label map (never CSS capitalize): "roth" → "Roth IRA". */
export function accountType(subtype: string): string {
  const key = subtype.replace(/_/g, " ").trim().toLowerCase();
  if (ACCOUNT_TYPES[key]) return ACCOUNT_TYPES[key];
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : "";
}

// ── Names ────────────────────────────────────────────────────────────────

const ORG_WORDS = /\b(llc|l\.l\.c\.|inc|corp|co|ltd|lp|llp|pllc|trust|the|of|and|&)\b\.?/gi;

/** One or two initials from a name, skipping "LLC", "Trust" and the like. */
export function initials(name: string): string {
  const words = name
    .replace(ORG_WORDS, " ")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "";
  const first = words[0][0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}
