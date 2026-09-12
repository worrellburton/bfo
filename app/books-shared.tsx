import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { authFetch } from "./auth";

/** Full-detail Books transaction, as the API returns it. */
export type Txn = {
  transaction_id: string;
  account_id: string;
  item_id: string;
  date: string;
  name: string | null;
  merchant_name: string | null;
  amount: number;
  pending: boolean;
  currency: string | null;
  plaid_category: string | null;
  plaid_category_detailed: string | null;
  payment_channel: string | null;
  txn_type: string;
  intercompany: boolean;
  intercompany_class: string | null;
  counterparty_account_id: string | null;
  type_override: string | null;
  book_category: string | null;
  loan_id: string | null;
  entity_id: string | null;
  entity_name: string | null;
  updated_at?: string;
};

export function money(n: number, currency = "USD"): string {
  return n.toLocaleString("en-US", { style: "currency", currency });
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-09-07" → "September 7, 2026". Parsed off the ISO string (no timezone). */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${LONG_MONTHS[m - 1]} ${d}, ${y}`;
}

/** "2026-08-08" → "Aug 8th". Parsed straight off the ISO string (no timezone). */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return iso;
  const v = d % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][d % 10] ?? "th";
  return `${SHORT_MONTHS[m - 1]} ${d}${suffix}`;
}

/** "2026-09-09" → "Sep 9, 2026". Parsed off the ISO string (no timezone). */
export function midDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${SHORT_MONTHS[m - 1]} ${d}, ${y}`;
}

/**
 * A compact span between two ISO dates: "Jul 30 – Sep 9, 2026",
 * "Sep 1 – 9, 2026", or "Dec 30, 2025 – Sep 9, 2026" across years.
 */
export function dateRange(first: string, last: string): string {
  const a = first.split("-").map(Number);
  const b = last.split("-").map(Number);
  if (a.length < 3 || b.length < 3 || a.some((n) => !n) || b.some((n) => !n)) return `${first} – ${last}`;
  const [y1, m1, d1] = a;
  const [y2, m2, d2] = b;
  if (y1 === y2 && m1 === m2 && d1 === d2) return midDate(first);
  if (y1 !== y2) return `${midDate(first)} – ${midDate(last)}`;
  if (m1 === m2) return `${SHORT_MONTHS[m1 - 1]} ${d1} – ${d2}, ${y1}`;
  return `${SHORT_MONTHS[m1 - 1]} ${d1} – ${SHORT_MONTHS[m2 - 1]} ${d2}, ${y1}`;
}

// ── Books design tokens ──────────────────────────────────────────────────
// One type/colour system shared by the Transactions page and every embed of
// TxnTable, so the page and its components read as a single surface.

/** Which density TxnTable renders: the ledger table or the card grid. */
export type TxnView = "list" | "cards";

/** Text tiers: t1 primary/numbers, t2 readable meta, t3 glyphs only. */
export function tiers(isDark: boolean): { t1: string; t2: string; t3: string } {
  // One neutral ramp per theme. Light uses gray-500/400 with an explicit
  // `/100` so the class name escapes the html.light rescue layer (which
  // re-colours bare `.text-gray-400/500` for legacy components).
  return isDark
    ? { t1: "text-gray-100", t2: "text-gray-400", t3: "text-gray-500" }
    : { t1: "text-gray-900", t2: "text-gray-500/100", t3: "text-gray-400/100" };
}

/** The only uppercase, tracked style on the page (callers add a tier colour). */
export const MICRO = "text-xs font-semibold uppercase tracking-[0.08em]";

export function incomeTone(isDark: boolean): string {
  return isDark ? "text-emerald-400" : "text-emerald-700";
}

export function amberTone(isDark: boolean): string {
  return isDark ? "text-amber-400" : "text-amber-700";
}

/** Floating surfaces: popovers, kebab menus, tooltips, dialogs. */
export function popoverSurface(isDark: boolean): string {
  return isDark
    ? "bg-[#161616] border-white/10 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)]"
    : "bg-white border-gray-200 shadow-xl shadow-gray-900/10";
}

/** Primary button colours (callers add layout, height and padding). */
export function primaryBtn(isDark: boolean): string {
  return isDark
    ? "bg-white text-black hover:bg-gray-200 active:bg-gray-300"
    : "bg-gray-900 text-white hover:bg-gray-800 active:bg-gray-700";
}

/** Outline button colours, border included. */
export function outlineBtn(isDark: boolean): string {
  return isDark
    ? "border border-white/10 text-gray-200 hover:bg-white/[0.06] hover:border-white/15"
    : "border border-gray-200 text-gray-800 hover:bg-gray-50 hover:border-gray-300";
}

/** Page-level card colours (callers add `rounded-2xl border`). */
export function cardSurface(isDark: boolean): string {
  return isDark ? "border-white/[0.08] bg-white/[0.03]" : "border-gray-200 bg-white";
}

/** The quietest divider between rows and cells. */
export function hairline(isDark: boolean): string {
  return isDark ? "border-white/[0.06]" : "border-gray-200/70";
}

// Bank memos arrive SHOUTING. Typeset them: title-case every all-caps token
// (a whole-string ratio gate left half the memos shouting), leave tokens
// carrying digits or symbols (account masks, refs, dates) untouched, keep a
// few real acronyms, and drop the trailing "; Merchant name: …" the bank
// appends. In a mixed-case memo a short all-caps token is an acronym (TEP,
// ACH, WT) and stays; in an all-caps memo everything is cased.
const KEEP_CAPS = new Set(["LLC", "INC", "LTD", "LP", "LLP", "PLC", "ACH", "ATM", "IRS", "DBA", "POS", "EFT", "USA", "ID", "PPD", "CCD", "WEB", "TEL"]);
const SMALL_WORDS = new Set(["to", "from", "of", "on", "and", "the", "for", "at", "in", "by", "via", "a", "an", "or", "with"]);

/** A memo or vendor string as it should read on screen (display only). */
export function displayName(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = raw
    .replace(/;?\s*Merchant name:\s*[^;]*$/i, "")
    // "PST*PLAID", "INTUIT *QBooks", "ANTHROPIC* CLAUDE": the processor
    // prefix / glue star is never part of the name.
    .replace(/\bPST\*/gi, "")
    .replace(/\*/g, " ")
    .replace(/\/ORG=/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2) return s;
  const shouting = letters.replace(/[^A-Z]/g, "").length / letters.length > 0.7;
  return s
    .split(/(\s+)/)
    .map((tok, i) => {
      if (!tok.trim() || /[\d#@]/.test(tok)) return tok;
      const bare = tok.replace(/[^A-Za-z]/g, "");
      if (bare.length < 2 || bare !== bare.toUpperCase()) return tok;
      if (bare.length <= 4 && KEEP_CAPS.has(bare)) return tok;
      if (!shouting && bare.length <= 3) return tok;
      const lower = tok.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(bare.toLowerCase())) return lower;
      // Capitalise the first letter and any letter after glue punctuation
      // ("BURTON,ROBERT" → "Burton,Robert").
      return lower.replace(/(^|[,;:/-])([^a-z]*)([a-z])/g, (_, p: string, q: string, c: string) => p + q + c.toUpperCase());
    })
    .join("");
}

// Words that only introduce a reference number ("Ref #…", "ID 5737L",
// "Card 1238"); they go with the number when it is dropped.
const LEAD_WORDS = new Set(["ref", "ref#", "id", "no", "no.", "number", "card", "trn", "srf", "rfb", "fed", "on", "#", ":", "-"]);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const core = (tok: string) => tok.replace(/^[^A-Za-z0-9#]+|[^A-Za-z0-9.+]+$/g, "");
const isIdToken = (tok: string) => {
  const c = core(tok);
  if (!c) return false;
  if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(c)) return true;
  if (/^[A-Z]{1,3}-[A-Z0-9]{5,}$/.test(c)) return true;
  if (/^#[A-Z0-9]{4,}$/i.test(c)) return true;
  if (/^[A-Z]{2,4}#$/i.test(tok)) return true; // "SRF#", "RFB#"
  if (tok.length >= 5 && /^\W*\d+\W*$/.test(tok)) return true; // "...11"
  const digits = c.replace(/\D/g, "").length;
  return c.length >= 5 && digits >= 2;
};
const isJunkToken = (tok: string) => {
  const c = core(tok).replace(/[^A-Za-z]/g, "");
  return c.length < 2 || KEEP_CAPS.has(c.toUpperCase()) || SMALL_WORDS.has(c.toLowerCase());
};

/**
 * A memo stripped of what only the bank cares about: reference numbers,
 * account masks, dates, run-on duplicated words. The raw string stays in the
 * detail panel; this is the ledger line.
 */
function tidyMemo(text: string): string {
  const toks = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  const leadish = (tok: string) => LEAD_WORDS.has((core(tok) || tok).toLowerCase());
  for (const tok of toks) {
    if (isIdToken(tok)) {
      while (out.length && leadish(out[out.length - 1])) out.pop();
      continue;
    }
    out.push(tok);
  }
  // "Children Interna Children I …": a truncated repeat of the opening words.
  if (out.length > 2) {
    const first = norm(out[0]);
    for (let j = 1; j < out.length; j++) {
      if (norm(out[j]) !== first) continue;
      let k = 0;
      while (j + k < out.length && k < j && norm(out[k]).startsWith(norm(out[j + k]))) k++;
      if (k >= 1 && (j + k === out.length || k >= 2)) out.splice(j, k);
      break;
    }
  }
  // Nothing dangles: a memo never ends on "Ref", "of" or a bare colon.
  while (
    out.length > 1 &&
    (/^[^A-Za-z0-9]+$/.test(out[out.length - 1]) || leadish(out[out.length - 1]) || SMALL_WORDS.has(core(out[out.length - 1]).toLowerCase()))
  ) out.pop();
  return out.join(" ").replace(/\s+([,;:])/g, "$1").trim();
}

/** A vendor-less memo as the ledger's primary line. */
function memoText(name: string | null): string {
  return tidyMemo(displayName(name)) || displayName(name);
}

/**
 * The muted line beside a vendor — null when it would only repeat the vendor
 * (or the entity). Strips the vendor's own name from the front of the memo
 * and the reference numbers the bank appends.
 */
function descriptorFor(name: string | null, vendor: string | null, entity?: string | null): string | null {
  let d = tidyMemo(displayName(name));
  if (!d) return null;
  if (vendor) {
    const v = displayName(vendor);
    if (norm(d) === norm(v) || norm(v).startsWith(norm(d))) return null;
    // Drop the vendor from the front when every vendor word is matched
    // (bank truncations count: "Truist Mortg" ~ "Truist Mortgage").
    const vt = v.split(/\s+/).map(norm).filter(Boolean);
    const dt = d.split(/\s+/);
    let k = 0;
    while (k < vt.length && k < dt.length && norm(dt[k]) && vt[k].startsWith(norm(dt[k]))) k++;
    if (k === vt.length || (k >= 1 && dt.slice(k).every(isJunkToken))) d = dt.slice(k).join(" ");
    else if (k === 0 && dt.length > 0 && vt.length > 0 && vt[0] === norm(dt[0])) d = dt.slice(1).join(" ");
    d = d.replace(/^[^A-Za-z0-9]+/, "").trim();
  }
  // "Burton C", "Burton Family Revocabl": the account holder's name, which
  // the entity tag already says.
  if (entity) {
    const ew = entity.split(/\s+/).map(norm).filter(Boolean);
    const dt = d.split(/\s+/).filter(Boolean);
    const inEntity = (tok: string) => {
      const n = norm(tok);
      return n.length < 2 || ew.some((w) => n.length >= 3 && w.startsWith(n)) || ew.includes(n);
    };
    let end = dt.length;
    while (end > 0 && inEntity(dt[end - 1])) end--;
    if (end === 0) return null;
    if (dt.length - end >= 2) d = dt.slice(0, end).join(" ").replace(/[,;:]+$/, "");
  }
  const dt = d.split(/\s+/).filter(Boolean);
  if (d.replace(/[^A-Za-z]/g, "").length < 3 || dt.every(isJunkToken)) return null;
  return d.charAt(0).toUpperCase() + d.slice(1);
}

/** Text-input skin shared by every field: search, batch, receipt URL, popover search. */
function textInput(isDark: boolean): string {
  return isDark
    ? "bg-white/[0.04] border-white/10 text-gray-100 placeholder:text-gray-500 hover:border-white/15 focus:outline-none focus:border-white/25 focus:bg-white/[0.06]"
    : "bg-white border-gray-200 text-gray-900 placeholder:text-gray-400/100 hover:border-gray-300 focus:outline-none focus:border-gray-400";
}

const BTN_BASE = "inline-flex items-center justify-center rounded-full font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default";

/** True while the viewport matches `query` (tracks resizes). */
function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => (typeof window !== "undefined" ? window.matchMedia(query).matches : true));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setOn(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return on;
}

// ── Entity tags: a stable 3-letter code + colour per entity ──────────────
// Keys are the normalized form (lowercased, punctuation stripped) so they
// match what entityTag() computes below.
const ENTITY_TAGS: Record<string, string> = {
  "breezewood": "BRZ",
  "burton family revocable trust": "BFT",
  "fdj hesperia llc": "FDJ",
  "ledger burton llc": "LDB",
  "ledger louise llc": "LDL",
  "palomino ranch on the bend llc": "PAL",
  "persons lodge llc": "PSL",
  "sundown investments llc": "SUN",
  "swisshelm mountain ventures llc": "SMV",
};
const TAG_STOP = new Set(["llc", "trust", "the", "of", "and", "co", "inc", "lp", "ltd", "corp", "company", "on", "at"]);

const normTagKey = (name: string) =>
  name.toLowerCase().replace(/\(.*?\)/g, "").replace(/[.,]/g, "").replace(/\s+/g, " ").trim();

// User-set initials (edited on the Entities page, stored on the Firebase
// asset). Cached in localStorage so tags render right on first paint;
// hydrateEntityTags refreshes the cache from Firebase once per session.
let CUSTOM_TAGS: Record<string, string> = {};
try {
  CUSTOM_TAGS = JSON.parse(globalThis.localStorage?.getItem("bfo-entity-tags") ?? "{}");
} catch {
  CUSTOM_TAGS = {};
}

export function setEntityTagLocal(name: string, initials: string | null) {
  const key = normTagKey(name);
  if (initials) CUSTOM_TAGS[key] = initials.toUpperCase().slice(0, 4);
  else delete CUSTOM_TAGS[key];
  try {
    localStorage.setItem("bfo-entity-tags", JSON.stringify(CUSTOM_TAGS));
  } catch {
    // cache only
  }
}

export async function hydrateEntityTags(): Promise<void> {
  try {
    const { db, authReady } = await import("./firebase");
    await authReady;
    const { ref, get } = await import("firebase/database");
    const snap = await get(ref(db, "assets"));
    const data = snap.val() || {};
    const map: Record<string, string> = {};
    for (const a of Object.values<any>(data)) {
      if (a?.name && a?.initials) map[normTagKey(a.name)] = String(a.initials).toUpperCase().slice(0, 4);
    }
    CUSTOM_TAGS = map;
    localStorage.setItem("bfo-entity-tags", JSON.stringify(map));
  } catch {
    // tags fall back to derived codes
  }
}

/** A stable 3-letter code for an entity, e.g. "Ledger Louise, LLC" → "LDL". */
export function entityTag(name?: string | null): string {
  if (!name) return "—";
  const key = normTagKey(name);
  if (CUSTOM_TAGS[key]) return CUSTOM_TAGS[key];
  if (ENTITY_TAGS[key]) return ENTITY_TAGS[key];
  const words = key.split(" ").filter((w) => w && !TAG_STOP.has(w));
  const base = words.length ? words : key.split(" ");
  let code = base.map((w) => w[0]).join("").toUpperCase();
  if (code.length < 3) code = ((base[0] || key).toUpperCase().replace(/[^A-Z]/g, "") + code).slice(0, 3);
  return code.slice(0, 3) || "—";
}

const TAG_STYLES: Array<{ dark: string; light: string }> = [
  { dark: "bg-emerald-500/10 text-emerald-300", light: "bg-emerald-50 text-emerald-700" },
  { dark: "bg-sky-500/10 text-sky-300", light: "bg-sky-50 text-sky-700" },
  { dark: "bg-violet-500/10 text-violet-300", light: "bg-violet-50 text-violet-700" },
  { dark: "bg-amber-500/10 text-amber-300", light: "bg-amber-50 text-amber-700" },
  { dark: "bg-rose-500/10 text-rose-300", light: "bg-rose-50 text-rose-700" },
  { dark: "bg-teal-500/10 text-teal-300", light: "bg-teal-50 text-teal-700" },
  { dark: "bg-indigo-500/10 text-indigo-300", light: "bg-indigo-50 text-indigo-700" },
  { dark: "bg-orange-500/10 text-orange-300", light: "bg-orange-50 text-orange-700" },
];

/** A deterministic colour class for an entity's tag, keyed off its name. */
export function entityTagClass(name: string | null | undefined, isDark: boolean): string {
  if (!name) return isDark ? "bg-white/[0.06] text-gray-400" : "bg-gray-100 text-gray-500";
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const s = TAG_STYLES[h % TAG_STYLES.length];
  return isDark ? s.dark : s.light;
}

/**
 * The entity tag pill with an instant, un-clipped tooltip: the full entity
 * name appears the moment you hover (no native `title` delay), rendered
 * through a portal so the table's overflow box never crops it.
 */
export function EntityTag({ name, isDark }: { name: string; isDark: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left + r.width / 2, top: r.bottom + 6 });
  };
  return (
    <>
      <span
        ref={ref}
        onMouseEnter={show}
        onMouseLeave={() => setPos(null)}
        className={`inline-flex items-center shrink-0 h-5 px-1.5 rounded-md text-xs font-semibold tracking-[0.04em] leading-none cursor-default ${entityTagClass(name, isDark)}`}
      >
        {entityTag(name)}
      </span>
      {pos &&
        createPortal(
          <div
            style={{ position: "fixed", left: pos.left, top: pos.top, transform: "translateX(-50%)" }}
            className={`z-[80] pointer-events-none px-2 py-1 rounded-lg text-xs whitespace-nowrap border pop-in ${popoverSurface(isDark)} ${tiers(isDark).t1}`}
          >
            {name}
          </div>,
          document.body
        )}
    </>
  );
}

const AVATAR_TONES: Array<{ dark: string; light: string }> = [
  { dark: "bg-emerald-500/15 text-emerald-300", light: "bg-emerald-100 text-emerald-700" },
  { dark: "bg-sky-500/15 text-sky-300", light: "bg-sky-100 text-sky-700" },
  { dark: "bg-violet-500/15 text-violet-300", light: "bg-violet-100 text-violet-700" },
  { dark: "bg-amber-500/15 text-amber-300", light: "bg-amber-100 text-amber-700" },
  { dark: "bg-rose-500/15 text-rose-300", light: "bg-rose-100 text-rose-700" },
  { dark: "bg-teal-500/15 text-teal-300", light: "bg-teal-100 text-teal-700" },
  { dark: "bg-indigo-500/15 text-indigo-300", light: "bg-indigo-100 text-indigo-700" },
  { dark: "bg-orange-500/15 text-orange-300", light: "bg-orange-100 text-orange-700" },
];

/**
 * A small tinted initial disc for a vendor — same hue every time. With
 * `icon` (a vendor-less row: transfer, roll-up, ATM) the disc goes neutral
 * and shows the glyph instead, so consecutive memos don't get random hues.
 */
export function VendorAvatar({
  name,
  isDark = false,
  size = "sm",
  icon,
}: {
  name: string;
  isDark?: boolean;
  size?: "sm" | "lg";
  icon?: ReactNode;
}) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const tone = AVATAR_TONES[h % AVATAR_TONES.length];
  const skin = icon
    ? isDark ? "bg-white/[0.06] text-gray-400" : "bg-gray-100 text-gray-500/100"
    : isDark ? tone.dark : tone.light;
  return (
    <span
      aria-hidden
      className={`rounded-full shrink-0 flex items-center justify-center font-semibold ${size === "lg" ? "w-8 h-8 text-xs" : "w-6 h-6 text-xs"} ${skin} ${
        icon ? (size === "lg" ? "[&>svg]:w-3.5 [&>svg]:h-3.5" : "[&>svg]:w-3 [&>svg]:h-3") : ""
      }`}
    >
      {icon ?? (name.trim()[0]?.toUpperCase() ?? "?")}
    </span>
  );
}

/** A tiny stroked icon from a single path. */
export function Icon({ d, className }: { d: string; className?: string }) {
  return (
    <svg className={className ?? "w-3.5 h-3.5 shrink-0"} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

const P = {
  down: "M12 4.5v15m0 0l6.75-6.75M12 19.5l-6.75-6.75",
  up: "M12 19.5v-15m0 0l6.75 6.75M12 4.5L5.25 11.25",
  swap: "M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m3-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5",
  building: "M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h6M9 10.5h6M9 14.25h6M10.5 21v-3.75h3V21",
  trend: "M2.25 6 9 12.75l4.286-4.286a11.948 11.948 0 0 1 4.306 6.43l.776 2.898m0 0 3.182-5.511m-3.182 5.51-5.511-3.181",
  receipt: "M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0c1.1.128 1.907 1.077 1.907 2.185z",
  scale: "M12 3v17.25m-7.5-3.75h15M4.5 6.75l3 7.5 3-7.5m3 0l3 7.5 3-7.5",
  chevron: "M19.5 8.25l-7.5 7.5-7.5-7.5",
  chevronUp: "M4.5 15.75l7.5-7.5 7.5 7.5",
  check: "M4.5 12.75l6 6 9-13.5",
  close: "M6 18L18 6M6 6l12 12",
};

/** The type dropdown's leading icon. */
export function typeIcon(value: string, inflow: boolean): ReactNode {
  if (value === "transfer") return <Icon d={P.swap} />;
  if (value === "intercompany") return <Icon d={P.building} />;
  return <Icon d={inflow ? P.down : P.up} />;
}

function accountIconPath(label: string): string {
  const c = label.trim()[0];
  if (c === "4") return P.trend;
  if (c === "7") return P.scale;
  if (c === "9") return P.swap;
  return P.receipt;
}

/** The account dropdown's leading icon, by chart section (leading digit). */
export function accountIcon(label: string): ReactNode {
  return <Icon d={accountIconPath(label)} />;
}

/**
 * The account pill's leading disc, tinted by chart section: revenue green,
 * operating orange, other violet, flow neutral. Unset stays neutral.
 */
export function AccountDisc({ label, isDark }: { label: string; isDark: boolean }) {
  const c = label.trim()[0];
  const tone = isDark
    ? c === "4" ? "bg-emerald-500/15 text-emerald-300"
      : c === "6" ? "bg-orange-500/15 text-orange-300"
      : c === "7" ? "bg-violet-500/15 text-violet-300"
      : "bg-white/10 text-gray-300"
    : c === "4" ? "bg-emerald-100 text-emerald-700"
      : c === "6" ? "bg-orange-100 text-orange-700"
      : c === "7" ? "bg-violet-100 text-violet-700"
      : "bg-gray-200 text-gray-600";
  return (
    <span aria-hidden className={`w-4 h-4 rounded-full shrink-0 inline-flex items-center justify-center ${tone}`}>
      <Icon d={accountIconPath(label)} className="w-2.5 h-2.5" />
    </span>
  );
}

/**
 * The small dot before an amount — rendered only when it adds information:
 * pending amber, roll-up violet, transfer/loan gray. Posted income and
 * expense get an invisible spacer so every numeral ends on the same edge.
 */
export function typeDot(eff: string, inflow: boolean, pending = false): string {
  if (pending) return "bg-amber-400";
  if (eff === "intercompany") return "bg-violet-400";
  // Half-strength so the dot never outweighs the muted numeral beside it.
  if (eff === "transfer" || eff === "loan") return "bg-gray-500/60";
  return "bg-transparent";
}

export function pretty(cat: string | null): string {
  if (!cat) return "Uncategorized";
  const s = cat.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function effType(t: Txn): "normal" | "transfer" | "intercompany" | "loan" {
  if (t.loan_id) return "loan";
  if (t.type_override === "normal" || t.type_override === "transfer" || t.type_override === "intercompany") {
    return t.type_override;
  }
  if (t.intercompany) return "intercompany";
  return t.txn_type === "transfer" ? "transfer" : "normal";
}

export function catLabel(t: Txn): string {
  return t.book_category || pretty(t.plaid_category);
}

async function saveTxn(patch: {
  transaction_id: string;
  type_override?: string;
  book_category?: string;
  loan_id?: string | null;
}) {
  const res = await authFetch("/api/books/data", { method: "POST", body: JSON.stringify(patch) });
  if (!res.ok) throw new Error("Couldn't save that change.");
  return (await res.json()).transaction as Txn;
}

type Option = { value: string; label: string; hint?: string; icon?: ReactNode; group?: string; short?: string };

/** Statement group for a chart account label, for grouped pickers. */
export function accountGroup(label: string): string {
  const c = label.trim()[0];
  if (c === "4") return "Revenue";
  if (c === "6") return "Operating expenses";
  if (c === "7") return "Other income / (expense)";
  if (c === "9") return "Transfers & flow";
  return "Other";
}

/**
 * A fully custom dropdown — a rounded pill trigger and a themed popover list
 * with a checkmark on the current choice. Rendered through a portal with fixed
 * positioning so it escapes any scroll box (a native <select>'s option list
 * can't be styled, and an absolutely-positioned menu would be clipped).
 */
export function Menu({
  value,
  options,
  isDark,
  disabled,
  onChange,
  tone = "neutral",
  size = "sm",
  quiet = false,
  placeholder,
  leading,
  label,
  chevron = "always",
  touch = false,
}: {
  value: string;
  options: Option[];
  isDark: boolean;
  disabled?: boolean;
  onChange: (v: string) => void;
  /** soft: a filled, low-contrast pill (the category chip in the ledger). */
  tone?: "neutral" | "amber" | "soft";
  /** Rendered before the label on the trigger only — e.g. a tinted icon disc. */
  leading?: ReactNode;
  /** md matches page-level filter fields; sm fits inside table rows. */
  size?: "sm" | "md";
  /** Borderless until hover — for controls repeated on every row. */
  quiet?: boolean;
  /** Trigger label when no option is selected (an action-style picker). */
  placeholder?: string;
  /** Title of the phone bottom sheet ("Account", "Type"). */
  label?: string;
  /** hover: the chevron only appears while the enclosing `.group` row is hovered. */
  chevron?: "always" | "hover";
  /** sm pills that must be thumb-sized below lg (card faces, phone editors). */
  touch?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // On phones the menu opens as a bottom sheet instead of an anchored popover.
  const [sheet, setSheet] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Anchored to the trigger's top-left; `bottom` instead of `top` when the
  // panel flips above so its lower edge hugs the trigger whatever its height.
  const [box, setBox] = useState<{ left: number; top?: number; bottom?: number; width: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState("");
  const [hi, setHi] = useState(-1);
  const { t2, t3 } = tiers(isDark);

  const current = options.find((o) => o.value === value);
  const text =
    current?.short ?? current?.label ?? placeholder ?? options[0]?.short ?? options[0]?.label ?? "—";

  const searchable = options.length > 10;
  // Grouped lists (the chart of accounts) open as one compact scrolling column
  // with sticky group heads — never a viewport-wide panel.
  const grouped = options.some((o) => o.group);
  const needle = filter.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  const groupCount = useMemo(() => new Set(options.map((o) => o.group ?? "Other")).size, [options]);

  useEffect(() => {
    if (!open) {
      setFilter("");
      setHi(-1);
    }
  }, [open]);

  // Keep the keyboard highlight (or, on open, the current choice) in view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(hi >= 0 ? `[data-i="${hi}"]` : "[aria-selected='true']");
    el?.scrollIntoView({ block: "nearest" });
  }, [open, hi]);

  function choose(o: Option) {
    onChange(o.value);
    setOpen(false);
  }

  function onListKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = shown[hi] ?? shown[0];
      if (target) choose(target);
    }
  }

  useLayoutEffect(() => {
    if (!open || sheet) return;
    function place() {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      // Grouped lists are a fixed w-72 column; short lists match the trigger
      // (224px floor). Either way the panel never exceeds the viewport − 16px.
      const width = Math.min(window.innerWidth - 16, grouped ? 18 * rem : Math.max(r.width, 224));
      // Estimated height (rows h-8, group heads ≈ 2.2rem, search 3.5rem, p-1)
      // capped at 60vh — only used to decide whether to flip above.
      const menuH = Math.min(
        window.innerHeight * 0.6,
        options.length * 2 * rem + (grouped ? groupCount * 2.2 * rem : 0) + (options.length > 10 ? 3.5 * rem : 0) + 8
      );
      const spaceBelow = window.innerHeight - r.bottom;
      const above = spaceBelow < menuH + 12 && r.top > spaceBelow;
      setBox({
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        ...(above ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
        width,
      });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, sheet, options.length, grouped, groupCount]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Three control heights: md toolbar (40 → 36), sm in-row (28), sm+touch
  // (40 below lg, 28 at lg). Height never comes from padding.
  const height = size === "md" ? "h-[40px] sm:h-9" : touch ? "h-[40px] lg:h-7" : "h-7";
  const type = size === "md" ? "text-sm font-medium" : touch ? "text-sm lg:text-xs" : "text-xs";
  const padL = leading
    ? size === "md" ? "pl-2" : touch ? "pl-2 lg:pl-1.5" : "pl-1.5"
    : size === "md" ? "pl-4" : quiet ? "pl-2" : "pl-3";
  const padR = size === "md" ? "pr-3" : quiet ? "pr-1.5" : "pr-2.5";
  const width = size === "md" ? "max-w-[240px]" : quiet ? "" : touch ? "max-w-full" : "max-w-[190px]";
  const shift = quiet && size !== "md" ? "-ml-2" : "";
  const skin = quiet
    ? isDark
      ? `border-transparent ${t2} hover:bg-white/[0.06] hover:text-gray-100 aria-expanded:bg-white/[0.1] aria-expanded:text-gray-100`
      : `border-transparent ${t2} hover:bg-gray-100 hover:text-gray-900 aria-expanded:bg-gray-200 aria-expanded:text-gray-900`
    : tone === "amber"
      ? isDark
        ? "bg-amber-500/10 border-amber-500/25 text-amber-200 hover:bg-amber-500/20 aria-expanded:bg-amber-500/25"
        : "bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100 aria-expanded:bg-amber-100"
      : tone === "soft"
        ? isDark
          ? "border-transparent font-medium bg-white/[0.06] text-gray-200 hover:bg-white/[0.09] aria-expanded:bg-white/[0.12]"
          : "border-transparent font-medium bg-gray-100 text-gray-800 hover:bg-gray-200/70 aria-expanded:bg-gray-200"
        : isDark
          ? "bg-white/[0.04] border-white/10 text-gray-200 hover:bg-white/[0.08] hover:border-white/15 aria-expanded:bg-white/[0.1] aria-expanded:border-white/20"
          : "bg-white border-gray-200 text-gray-800 hover:bg-gray-50 hover:border-gray-300 aria-expanded:bg-gray-100 aria-expanded:border-gray-300";
  const pill = `group/menu inline-flex items-center gap-1.5 rounded-full border cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-default ${height} ${type} ${padL} ${padR} ${width} ${shift} ${skin}`;
  // Hover-reveal only applies where there is a hover (lg+); touch layouts
  // always show the glyph.
  const glyph =
    chevron === "hover" && !open
      ? "opacity-50 lg:opacity-0 lg:group-hover:opacity-50 lg:group-hover/menu:opacity-50 lg:group-focus-visible/menu:opacity-50"
      : "opacity-50";

  const optionBase = `w-full flex items-center rounded-lg text-left cursor-pointer transition-colors ${
    sheet ? "min-h-[44px] px-3 gap-3 text-sm" : "h-8 px-2 gap-2 text-xs"
  }`;
  // Group heads stick to the top of the scrolling list in both the popover
  // and the sheet, on the surface colour so rows slide underneath.
  const groupHead = `${MICRO} ${t2} px-2 pt-2 pb-1 sticky top-0 z-10 ${isDark ? "bg-[#161616]" : "bg-white"}`;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          setSheet(typeof window !== "undefined" && window.innerWidth < 640);
          setOpen((v) => !v);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={pill}
        title={typeof text === "string" && text.length > 18 ? text : undefined}
      >
        {leading}
        <span className="truncate">{text}</span>
        <svg
          className={`w-3 h-3 shrink-0 text-current transition-[opacity,transform] ${open ? "rotate-180" : ""} ${glyph}`}
          fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d={P.chevron} />
        </svg>
      </button>
      {open && (sheet || box) &&
        createPortal(
          <>
          {sheet && (
            <div className="fixed inset-0 z-[69] bg-black/50 backdrop-blur-[2px] fade-in" onClick={() => setOpen(false)} aria-hidden />
          )}
          <div
            ref={panelRef}
            role="listbox"
            style={
              sheet
                ? { position: "fixed", left: 0, right: 0, bottom: 0, paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }
                : { position: "fixed", left: box!.left, top: box!.top, bottom: box!.bottom, width: box!.width }
            }
            onKeyDown={onListKey}
            className={`z-[70] border overflow-hidden flex flex-col tabular-nums ${sheet ? "rounded-t-xl sheet-in max-h-[72vh]" : "rounded-xl pop-in max-h-[60vh]"} ${popoverSurface(isDark)}`}
          >
            {sheet && (
              <div className={`mx-auto mt-2 h-1 w-10 rounded-full shrink-0 ${isDark ? "bg-white/20" : "bg-gray-300"}`} aria-hidden />
            )}
            {sheet && label && <p className={`px-4 pt-2 pb-1 ${MICRO} ${t2}`}>{label}</p>}
            {searchable && (
              <div className={`shrink-0 border-b ${sheet ? "px-2 pt-1 pb-2" : "p-2"} ${hairline(isDark)}`}>
                <input
                  autoFocus={!sheet}
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setHi(0);
                  }}
                  placeholder="Search…"
                  className={`w-full rounded-full border ${sheet ? "h-[40px] px-3.5 text-[16px] placeholder:text-sm" : "h-8 px-3 text-xs"} ${textInput(isDark)}`}
                />
              </div>
            )}
            <div ref={listRef} className={`flex-1 min-h-0 overflow-y-auto ${sheet ? "p-2 pb-2" : "p-1"}`}>
              {shown.length === 0 && (
                <p className={`px-2 py-2 text-xs ${t3}`}>No matches.</p>
              )}
              {shown.map((o, i) => {
                const sel = o.value === value;
                const newGroup = o.group && (i === 0 || shown[i - 1].group !== o.group);
                return (
                  <Fragment key={`w-${o.value || "—"}`}>
                    {newGroup && <p className={groupHead}>{o.group}</p>}
                    <button
                      role="option"
                      aria-selected={sel}
                      data-i={i}
                      onClick={() => choose(o)}
                      onMouseEnter={() => setHi(i)}
                      className={`${optionBase} ${
                        i === hi
                          ? isDark ? "bg-white/[0.08] text-gray-100" : "bg-gray-100 text-gray-900"
                          : isDark ? "text-gray-200" : "text-gray-800"
                      } ${sel ? "font-medium" : ""}`}
                      title={o.short && o.short !== o.label ? o.label : undefined}
                    >
                      {o.icon && <span className={`shrink-0 ${t2}`}>{o.icon}</span>}
                      <span className="truncate flex-1">{o.short ?? o.label}</span>
                      {o.hint && <span className={`shrink-0 text-xs ${t3}`}>{o.hint}</span>}
                      {sel && (
                        <svg className="ml-auto w-3.5 h-3.5 shrink-0 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" d={P.check} />
                        </svg>
                      )}
                    </button>
                  </Fragment>
                );
              })}
            </div>
          </div>
          </>,
          document.body
        )}
    </>
  );
}

/** Selection wiring TxnTable renders a checkbox column from. */
export type Selection = {
  selected: Set<string>;
  toggle: (id: string) => void;
  setAll: (ids: string[]) => void;
  /** Set a contiguous range on/off — the shift-click path. */
  selectMany?: (ids: string[], on: boolean) => void;
};

/**
 * The floating batch editor: appears while rows are selected, applies a
 * vendor and/or description to all of them at once.
 */
export function BatchBar({
  count,
  isDark,
  busy,
  onApply,
  onClear,
  vendorSuggestions = [],
  categories = [],
}: {
  count: number;
  isDark: boolean;
  busy?: boolean;
  onApply: (patch: { merchant_name?: string; name?: string; book_category?: string; type_override?: string }) => void;
  onClear: () => void;
  /** Existing vendor names — the vendor field autocompletes against these. */
  vendorSuggestions?: string[];
  /** Chart of accounts — enables the batch Account picker. */
  categories?: string[];
}) {
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [account, setAccount] = useState("");
  const [batchType, setBatchType] = useState("");
  const [vendorFocus, setVendorFocus] = useState(false);
  const [highlight, setHighlight] = useState(0);
  // Vendors whose name contains what's typed — capped so the list stays usable.
  const matches = useMemo(() => {
    const q = vendor.trim().toLowerCase();
    if (!q) return [] as string[];
    return vendorSuggestions
      .filter((v) => v.toLowerCase().includes(q) && v.toLowerCase() !== q)
      .slice(0, 8);
  }, [vendor, vendorSuggestions]);
  const showMenu = vendorFocus && matches.length > 0;
  useEffect(() => setHighlight(0), [vendor]);
  // Escape drops the selection — but only while the bar is up.
  useEffect(() => {
    if (count === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClear();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [count, onClear]);
  if (count === 0) return null;
  const { t2 } = tiers(isDark);
  const field = `h-[40px] sm:h-9 px-3.5 rounded-full text-[16px] sm:text-sm placeholder:text-sm border ${textInput(isDark)}`;
  const glass = isDark
    ? "bg-[#161616]/90 border-white/10 backdrop-blur-xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)]"
    : "bg-white/95 border-gray-200 backdrop-blur-xl shadow-xl shadow-gray-900/10";
  // Display comes from the caller (`inline-flex sm:hidden` / `hidden sm:inline-flex`).
  const clearBtn = `w-[40px] h-[40px] sm:w-9 sm:h-9 rounded-full items-center justify-center cursor-pointer transition-colors ${t2} ${
    isDark ? "hover:bg-white/[0.06] hover:text-white" : "hover:bg-gray-100 hover:text-gray-900"
  }`;
  const canApply = !!(vendor.trim() || description.trim() || account || batchType);
  const clear = (extra: string) => (
    <button onClick={onClear} aria-label="Clear selection" title="Clear selection (Esc)" className={`${clearBtn} ${extra}`}>
      <Icon d={P.close} className="w-4 h-4" />
    </button>
  );
  return createPortal(
    <div
      role="toolbar"
      aria-label="Batch edit"
      className={`fixed z-[60] left-2 right-2 bottom-[calc(7.25rem+env(safe-area-inset-bottom))] sm:left-1/2 sm:right-auto sm:-translate-x-1/2 lg:bottom-6 rounded-xl border pop-in tabular-nums grid grid-cols-2 gap-2 p-3 sm:flex sm:flex-wrap sm:items-center sm:gap-2 sm:px-3 sm:py-2 sm:max-w-[calc(100vw-2rem)] ${glass}`}
    >
      <div className="col-span-2 flex items-center justify-between sm:contents">
        <span
          className={`inline-flex items-center h-7 px-2.5 rounded-full text-xs font-medium tabular-nums ${
            isDark ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-100 text-emerald-800"
          }`}
        >
          {count} selected
        </span>
        {clear("inline-flex sm:hidden")}
      </div>
      <div className={`hidden sm:block w-px h-6 ${isDark ? "bg-white/10" : "bg-gray-200"}`} aria-hidden />
      <div className="relative col-span-2 sm:col-auto">
        {showMenu && (
          <div className={`absolute bottom-full mb-1.5 left-0 w-56 max-h-60 overflow-y-auto rounded-xl border p-1 pop-in ${popoverSurface(isDark)}`}>
            {matches.map((v, i) => (
              <button
                key={v}
                // Keep focus on the input so blur doesn't close before the click lands.
                onMouseDown={(e) => {
                  e.preventDefault();
                  setVendor(v);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full text-left h-8 px-2.5 rounded-lg text-xs truncate cursor-pointer transition-colors ${
                  i === highlight
                    ? isDark ? "bg-white/[0.08] text-gray-100" : "bg-gray-100 text-gray-900"
                    : isDark ? "text-gray-200" : "text-gray-800"
                }`}
                title={v}
              >
                {v}
              </button>
            ))}
          </div>
        )}
        <input
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
          onFocus={() => setVendorFocus(true)}
          onBlur={() => setVendorFocus(false)}
          onKeyDown={(e) => {
            if (!showMenu) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, matches.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
            else if (e.key === "Enter" || e.key === "Tab") {
              if (matches[highlight]) { e.preventDefault(); setVendor(matches[highlight]); }
            }
          }}
          placeholder="Vendor…"
          aria-label="Vendor"
          className={`${field} w-full sm:w-40`}
        />
      </div>
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description…"
        aria-label="Description"
        className={`${field} col-span-2 sm:col-auto w-full sm:w-56`}
      />
      <div className="min-w-0 [&>button]:w-full sm:[&>button]:w-auto">
        <Menu
          value={batchType}
          isDark={isDark}
          size="md"
          label="Type"
          placeholder="Type…"
          onChange={setBatchType}
          options={[
            { value: "normal", label: "Income / Expense", icon: typeIcon("normal", false) },
            { value: "transfer", label: "Transfer", icon: typeIcon("transfer", false) },
            { value: "intercompany", label: "Roll-up", icon: typeIcon("intercompany", false) },
          ]}
        />
      </div>
      {categories.length > 0 && (
        <div className="min-w-0 [&>button]:w-full sm:[&>button]:w-auto">
          <Menu
            value={account}
            isDark={isDark}
            size="md"
            label="Account"
            placeholder="Account…"
            onChange={setAccount}
            options={categories.map((c) => ({
              value: c,
              label: c,
              short: c.replace(/^\d{4}\s+/, ""),
              icon: accountIcon(c),
              group: accountGroup(c),
            }))}
          />
        </div>
      )}
      <button
        disabled={busy || !canApply}
        onClick={() => {
          const patch: { merchant_name?: string; name?: string; book_category?: string; type_override?: string } = {};
          if (vendor.trim()) patch.merchant_name = vendor.trim();
          if (description.trim()) patch.name = description.trim();
          if (account) patch.book_category = account;
          if (batchType) patch.type_override = batchType;
          onApply(patch);
          setVendor("");
          setDescription("");
          setAccount("");
          setBatchType("");
        }}
        className={`${BTN_BASE} col-span-2 sm:col-auto h-[40px] sm:h-9 px-4 text-sm ${primaryBtn(isDark)}`}
      >
        {busy ? "Applying…" : "Apply"}
      </button>
      {clear("hidden sm:inline-flex")}
    </div>,
    document.body
  );
}

/**
 * Audit trail + receipts for one transaction — loads on demand when the row's
 * detail drawer opens. Every categorization/vendor/type change shows as
 * old → new; receipts are URL-referenced documents you can attach or remove.
 */
export function TxnHistoryPanel({ transactionId, isDark }: { transactionId: string; isDark: boolean }) {
  const [log, setLog] = useState<Array<{ id: number; field: string; old_value: string | null; new_value: string | null; source: string; changed_at: string }>>([]);
  const [receipts, setReceipts] = useState<Array<{ id: number; url: string | null; label: string | null; source?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const { t1, t2, t3 } = tiers(isDark);

  async function load() {
    try {
      const res = await authFetch(`/api/books/data?report=history&transaction_id=${encodeURIComponent(transactionId)}`);
      if (res.ok) {
        const d = await res.json();
        setLog(d.log ?? []);
        setReceipts(d.receipts ?? []);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [transactionId]);

  async function addReceipt() {
    if (!/^https?:\/\/.{3,}/i.test(url.trim())) return;
    setBusy(true);
    try {
      const res = await authFetch("/api/books/data", {
        method: "POST",
        body: JSON.stringify({ action: "add_receipt", transaction_id: transactionId, url: url.trim() }),
      });
      if (res.ok) { setUrl(""); await load(); }
    } finally { setBusy(false); }
  }
  async function removeReceipt(id: number) {
    await authFetch("/api/books/data", { method: "POST", body: JSON.stringify({ action: "delete_receipt", id }) });
    await load();
  }
  async function uploadFile(file: File) {
    setUploadErr("");
    if (file.size > 3 * 1024 * 1024) { setUploadErr("Files must be under 3 MB."); return; }
    setBusy(true);
    try {
      const data_base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const res = await authFetch("/api/books/upload-receipt", {
        method: "POST",
        body: JSON.stringify({ transaction_id: transactionId, filename: file.name, content_type: file.type, data_base64 }),
      });
      if (res.ok) await load();
      else setUploadErr("Upload failed.");
    } catch {
      setUploadErr("Upload failed.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const fieldLabel: Record<string, string> = {
    book_category: "Account", type_override: "Type", loan_id: "Loan", merchant_name: "Vendor", name: "Description",
  };
  const rule = isDark ? "border-white/[0.08]" : "border-gray-200";
  const smallBtn = "inline-flex items-center justify-center shrink-0 h-[40px] lg:h-7 px-3 rounded-full text-sm lg:text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default";

  return (
    <div className={`mt-5 border-t pt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 ${rule}`}>
      <div className="min-w-0">
        <span className={`${MICRO} ${t2} block mb-2`}>Receipts & documents</span>
        {receipts.length > 0 ? (
          <ul className="space-y-1 mb-2">
            {receipts.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-xs">
                <a href={r.url ?? undefined} target="_blank" rel="noreferrer" className={`truncate hover:underline flex-1 ${isDark ? "text-sky-300" : "text-sky-700"}`}>
                  {r.label || r.url}
                </a>
                {r.source && r.source !== "manual" && r.source !== "upload" && (
                  <span className={`shrink-0 text-xs ${t3}`}>{r.source}</span>
                )}
                <button
                  onClick={() => void removeReceipt(r.id)}
                  aria-label="Remove receipt"
                  className={`w-7 h-7 -mr-1.5 rounded-md inline-flex items-center justify-center shrink-0 cursor-pointer transition-colors ${t3} hover:text-red-500`}
                >
                  <Icon d={P.close} className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={`text-xs mb-2 ${t2}`}>None attached.</p>
        )}
        <div className="flex items-center gap-2 max-w-sm">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void addReceipt()}
            placeholder="Paste a URL…"
            aria-label="Receipt URL"
            className={`flex-1 min-w-0 h-[40px] lg:h-7 px-3 rounded-full text-[16px] lg:text-xs placeholder:text-sm lg:placeholder:text-xs border ${textInput(isDark)}`}
          />
          <button
            onClick={() => void addReceipt()}
            disabled={busy || !url.trim()}
            className={`${smallBtn} ${primaryBtn(isDark)}`}
          >
            Add
          </button>
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f); }} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            title="Upload a file"
            className={`${smallBtn} ${outlineBtn(isDark)}`}
          >
            {busy ? "…" : "Upload"}
          </button>
        </div>
        {uploadErr && <p className="text-xs text-red-500 mt-1.5">{uploadErr}</p>}
      </div>
      <div className="min-w-0">
        <span className={`${MICRO} ${t2} block mb-2`}>History</span>
        {loading ? (
          <p className={`text-xs ${t2}`}>Loading…</p>
        ) : log.length === 0 ? (
          <p className={`text-xs ${t2}`}>No manual changes recorded.</p>
        ) : (
          <ul className="space-y-1 text-sm lg:text-xs">
            {log.slice(0, 12).map((e) => (
              <li key={e.id} className={t1}>
                <span className={`tabular-nums ${t2}`}>{midDate(e.changed_at.slice(0, 10))} · </span>
                <span className="font-medium">{fieldLabel[e.field] ?? e.field}</span>
                <span className={t2}> {e.old_value ? `“${e.old_value}” → ` : "set "}</span>
                <span>{e.new_value ? `“${e.new_value}”` : "cleared"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * An in-app confirm — replaces the browser's native confirm() so the choice
 * looks like the rest of the app. `onConfirm` is the primary action; the
 * optional `onAlt`/`altLabel` adds a middle path (e.g. "just this one"); the
 * backdrop, Escape, and Cancel all dismiss without acting.
 */
export function ConfirmDialog({
  isDark,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  altLabel,
  tone = "default",
  onConfirm,
  onAlt,
  onClose,
}: {
  isDark: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  altLabel?: string;
  tone?: "default" | "danger";
  onConfirm: () => void;
  onAlt?: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter") onConfirm();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, onConfirm]);

  const { t1, t2 } = tiers(isDark);
  const btn = "inline-flex items-center justify-center h-[40px] sm:h-9 px-4 rounded-full text-sm font-medium cursor-pointer transition-colors";
  const primary = tone === "danger" ? "bg-red-600 text-white hover:bg-red-500 active:bg-red-700" : primaryBtn(isDark);
  const ghost = isDark ? "text-gray-300 hover:bg-white/[0.06]" : "text-gray-600 hover:bg-gray-100";

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className={`w-full max-w-lg rounded-2xl border p-5 pop-in ${popoverSurface(isDark)}`}
      >
        <h3 className={`text-lg font-semibold tracking-tight ${t1}`}>{title}</h3>
        {message && (
          <div className={`mt-2 text-sm leading-relaxed ${t2}`}>{message}</div>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button onClick={onClose} className={`${btn} ${ghost}`}>
            {cancelLabel}
          </button>
          {altLabel && onAlt && (
            <button onClick={onAlt} className={`${btn} ${outlineBtn(isDark)}`}>
              {altLabel}
            </button>
          )}
          <button autoFocus onClick={onConfirm} className={`${btn} ${primary}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

type DetailPair = { k: string; v: string; mono?: boolean };
type DetailGroup = { title: string; pairs: DetailPair[] };

/**
 * The editable transaction ledger: type and category change in place, the
 * chevron opens every field we hold on the transaction, and the vendor name
 * walks to the Vendors page. Renders as a table (list) or a card grid
 * (cards); with no `view` it splits by breakpoint like it always has.
 */
export function TxnTable({
  rows,
  categories,
  loans = [],
  isDark,
  onRowChange,
  onError,
  onReload,
  balances,
  selection,
  sort,
  onSort,
  view,
}: {
  rows: Txn[];
  categories: string[];
  loans?: Array<{ id: string; name: string }>;
  isDark: boolean;
  onRowChange: (t: Txn) => void;
  onError: (message: string) => void;
  onReload?: () => void;
  /** Optional running balance per transaction id — adds a Balance column. */
  balances?: Record<string, number>;
  /** Optional row selection — adds a checkbox column for batch editing. */
  selection?: Selection;
  /** Current server-side sort — enables clickable, sortable column headers. */
  sort?: { key: string; dir: "asc" | "desc" };
  /** Called with a column key when a sortable header is clicked. */
  onSort?: (key: string) => void;
  /** "list" = table only, "cards" = grid only; unset = table on lg+, cards below. */
  view?: TxnView;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingCat, setPendingCat] = useState<{ t: Txn; category: string; match: string } | null>(null);
  // Anchor row for shift-click range selection.
  const lastPicked = useRef<number | null>(null);

  const { t1, t2, t3 } = tiers(isDark);
  const hair = hairline(isDark);
  const rule = isDark ? "border-white/[0.08]" : "border-gray-200";
  const hover = isDark ? "hover:bg-white/[0.04]" : "hover:bg-gray-50";
  const selectedSkin = isDark
    ? "bg-emerald-500/[0.07] shadow-[inset_2px_0_0_0_#10b981]"
    : "bg-emerald-50 shadow-[inset_2px_0_0_0_#10b981]";
  const expandedBg = isDark ? "bg-white/[0.02]" : "bg-gray-50/70";
  const hitFill = isDark ? "hover:bg-white/[0.06]" : "hover:bg-gray-100";
  const glyphFill = isDark ? "hover:bg-white/10 hover:text-white" : "hover:bg-gray-100 hover:text-gray-900";
  const glyphOn = isDark ? "bg-white/10 text-white" : "bg-gray-100 text-gray-900";
  // Date bands only make sense while the rows arrive in date order.
  const grouped = !sort || sort.key === "date";
  // Category shows from md, Type and Date from lg. Spanning cells must match
  // the VISIBLE column count: in a fixed-layout table a larger colSpan
  // conjures phantom columns that swallow the merchant column's width.
  const mdUp = useMedia("(min-width: 768px)");
  const lgUp = useMedia("(min-width: 1024px)");
  const cols = 4 + (mdUp ? 1 : 0) + (lgUp ? 2 : 0) + (balances ? 1 : 0) + (selection ? 1 : 0);
  // Cards band by day only where the grid is one or two columns wide; at lg+
  // a band per day would break every row of the grid, so the date moves onto
  // each card's second line and the grid stays dense.
  const cardBands = grouped && !lgUp;

  // A column header: a sort button when the column is sortable and onSort is
  // wired, otherwise plain text (vendor page and other embeds stay static).
  // A plain function, not a component, so header cells never remount and a
  // just-clicked sort button keeps its focus ring. The caret leads on
  // right-aligned columns so the label stays flush with the numerals.
  const th = (label: string, sortKey?: string, align: "left" | "right" = "left", className = "") => {
    const sortable = !!onSort && !!sortKey;
    const active = sortable && sort?.key === sortKey;
    // font-medium on the cell itself: the UA's `th { font-weight: bold }`
    // beats anything inherited from the row.
    const cell = `px-2 py-2.5 font-medium ${align === "right" ? "text-right" : ""} ${className}`;
    if (!sortable) return <th key={label} scope="col" className={cell}>{label}</th>;
    const caret = (
      <svg
        className={`w-3 h-3 shrink-0 transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover/th:opacity-60"}`}
        fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden
      >
        <path strokeLinecap="round" strokeLinejoin="round" d={active && sort?.dir === "asc" ? P.chevronUp : P.chevron} />
      </svg>
    );
    return (
      <th
        key={label}
        scope="col"
        aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"}
        className={`group/th ${cell}`}
      >
        <button
          onClick={() => onSort!(sortKey!)}
          // The visible button is 18px tall; below lg a pseudo-element grows
          // the tap target to 40px without changing the header's height.
          className={`inline-flex items-center gap-1 h-6 -my-0.5 px-1.5 -mx-1.5 rounded-md cursor-pointer transition-colors relative after:content-[''] after:absolute after:inset-x-0 after:-inset-y-[12px] lg:after:inset-0 ${
            active ? t1 : isDark ? "hover:text-gray-100 hover:bg-white/[0.04]" : "hover:text-gray-900 hover:bg-gray-100"
          }`}
        >
          {align === "right" && caret}
          {label}
          {align !== "right" && caret}
        </button>
      </th>
    );
  };

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function update(t: Txn, patch: { type_override?: string; book_category?: string; loan_id?: string | null }) {
    setBusy(t.transaction_id);
    try {
      const saved = await saveTxn({ transaction_id: t.transaction_id, ...patch });
      // Keep the live entity overlay — the PATCH returns the stored stamp.
      onRowChange({ ...saved, entity_id: t.entity_id, entity_name: t.entity_name });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't save that change.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * A category change offers to teach the books: apply the same category to
   * every transaction carrying this description, and keep applying it to new
   * ones via a stored rule. The in-app dialog picks between all and one.
   */
  function changeCategory(t: Txn, category: string) {
    const match = (t.merchant_name || t.name || "").trim();
    if (!match) {
      void applyCategoryOne(t, category);
      return;
    }
    setPendingCat({ t, category, match });
  }

  async function applyCategoryOne(t: Txn, category: string) {
    await update(t, { book_category: category });
  }

  // Built once per categories change, not per row per render — the account
  // picker options were the biggest allocation churn in the table.
  const baseCatOptions = useMemo(
    () =>
      categories.map((c) => ({
        value: c,
        label: c,
        short: c.replace(/^\d{4}\s+/, ""),
        icon: accountIcon(c),
        group: accountGroup(c),
      })),
    [categories]
  );

  async function applyCategoryAll(t: Txn, category: string, match: string) {
    setBusy(t.transaction_id);
    try {
      const res = await authFetch("/api/books/data", {
        method: "POST",
        body: JSON.stringify({ action: "categorize_vendor", match, book_category: category }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Couldn't apply that everywhere.");
      if (onReload) onReload();
      else onRowChange({ ...t, book_category: category });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't apply that everywhere.");
    } finally {
      setBusy(null);
    }
  }

  const detail = (t: Txn): DetailGroup[] => [
    {
      title: "Details",
      pairs: [
        // One pair when the memo IS the merchant — no point saying it twice.
        ...(t.merchant_name && t.name && norm(t.merchant_name) === norm(t.name)
          ? [{ k: "Merchant", v: t.merchant_name }]
          : [
              { k: "Description", v: t.name ?? "—" },
              { k: "Merchant", v: t.merchant_name ?? "—" },
            ]),
        { k: "Amount", v: `${t.amount < 0 ? "+" : ""}${money(Math.abs(t.amount), t.currency ?? "USD")}` },
        { k: "Date", v: longDate(t.date) },
        { k: "Status", v: t.pending ? "Pending" : "Posted" },
        { k: "Entity", v: t.entity_name ?? "Unmapped" },
      ],
    },
    {
      title: "Categorization",
      pairs: [
        { k: "Books", v: t.book_category ?? "—" },
        { k: "Plaid", v: pretty(t.plaid_category) },
        { k: "Plaid detail", v: t.plaid_category_detailed ? pretty(t.plaid_category_detailed) : "—" },
        { k: "Payment channel", v: t.payment_channel ?? "—" },
        { k: "Detected type", v: t.intercompany ? "intercompany" : t.txn_type },
        { k: "Your override", v: t.type_override ?? "—" },
        { k: "Intercompany class", v: t.intercompany_class ?? "—" },
      ],
    },
    {
      title: "Identifiers",
      pairs: [
        { k: "Counterparty", v: t.counterparty_account_id ?? "—", mono: true },
        { k: "Account ID", v: t.account_id, mono: true },
        { k: "Connection ID", v: t.item_id, mono: true },
        { k: "Transaction ID", v: t.transaction_id, mono: true },
        {
          k: "Last synced",
          v: t.updated_at
            ? new Date(t.updated_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
            : "—",
        },
      ],
    },
  ];

  const box = (on: boolean, mixed = false) => (
    <span
      className={`w-[16px] h-[16px] rounded-[4px] border-[1.5px] shrink-0 inline-flex items-center justify-center transition-colors ${
        on
          ? "bg-emerald-500 border-emerald-500"
          : mixed
            ? "bg-emerald-500/40 border-emerald-500/40"
            : isDark ? "border-white/25" : "border-gray-400/60"
      }`}
    >
      {on ? (
        <svg className="w-[11px] h-[11px] text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d={P.check} />
        </svg>
      ) : mixed ? (
        <span className="w-[7px] h-[2px] rounded-full bg-white" aria-hidden />
      ) : null}
    </span>
  );
  const allSelected = !!selection && rows.length > 0 && rows.every((r) => selection.selected.has(r.transaction_id));
  const someSelected = !!selection && !allSelected && rows.some((r) => selection.selected.has(r.transaction_id));
  const hitArea = `w-7 h-7 rounded-md inline-flex items-center justify-center cursor-pointer select-none transition-colors ${hitFill}`;
  // Row cells: a hair taller on phones so the enlarged tap targets of
  // adjacent rows don't overlap; ≈39.6px at lg where an h-7 control sets it.
  const cell = "px-2 py-3.5 lg:py-3";
  // On phones the 28px hit area grows to ≥40px through a pseudo-element.
  const touchHit = "relative after:content-[''] after:absolute after:-inset-[10px] lg:after:inset-0";

  // Click (or shift-click for a range) on a row's checkbox — shared by both views.
  function pickRow(e: React.MouseEvent, t: Txn, ri: number) {
    if (!selection) return;
    if (e.shiftKey && selection.selectMany && lastPicked.current != null) {
      const [from, to] = lastPicked.current < ri ? [lastPicked.current, ri] : [ri, lastPicked.current];
      selection.selectMany(rows.slice(from, to + 1).map((r) => r.transaction_id), !selection.selected.has(t.transaction_id));
    } else {
      selection.toggle(t.transaction_id);
    }
    lastPicked.current = ri;
  }

  const catOptionsFor = (t: Txn) =>
    t.book_category && !categories.includes(t.book_category)
      ? [
          {
            value: t.book_category,
            label: t.book_category,
            short: t.book_category.replace(/^\d{4}\s+/, ""),
            icon: accountIcon(t.book_category),
            group: accountGroup(t.book_category),
          },
          ...baseCatOptions,
        ]
      : baseCatOptions;

  // The three in-row editors, identical in both views. Always a category
  // picker: a loan-linked row shows the loan as its placeholder; choosing an
  // account detaches the loan so the movement posts to the P&L instead.
  const categoryProps = (t: Txn) => {
    const catOptions = catOptionsFor(t);
    return {
      value: t.book_category ?? "",
      placeholder: t.loan_id ? loans.find((l) => l.id === t.loan_id)?.name ?? "Loan" : undefined,
      onChange: (v: string) => (t.loan_id ? void update(t, { book_category: v, loan_id: null }) : void changeCategory(t, v)),
      options:
        !t.book_category && !t.loan_id
          ? [{ value: "", label: pretty(t.plaid_category), hint: "auto", icon: accountIcon("") }, ...catOptions]
          : catOptions,
    };
  };
  // Fully editable — a loan link no longer locks the row; the loan
  // classification maps back to its underlying type.
  const typeProps = (t: Txn, eff: string, inflow: boolean) => ({
    value: eff === "loan" ? (t.type_override ?? "normal") : eff,
    onChange: (v: string) => void update(t, t.loan_id ? { type_override: v, loan_id: null } : { type_override: v }),
    options: [
      { value: "normal", label: inflow ? "Income" : "Expense", icon: typeIcon("normal", inflow) },
      { value: "transfer", label: "Transfer", icon: typeIcon("transfer", inflow) },
      { value: "intercompany", label: "Roll-up", icon: typeIcon("intercompany", inflow) },
    ],
  });
  const loanProps = (t: Txn) => ({
    value: t.loan_id ?? "",
    placeholder: "Loan…",
    onChange: (v: string) => void update(t, { loan_id: v || null }),
    options: [{ value: "", label: "Not a loan" }, ...loans.map((l) => ({ value: l.id, label: l.name }))],
  });

  const renderEditors = (
    t: Txn,
    opts: { type?: boolean; category?: boolean; categoryClass?: string; loan?: boolean; vendorLink?: boolean }
  ) => {
    const inflow = t.amount < 0;
    const eff = effType(t);
    const vendor = t.merchant_name || (eff === "normal" ? t.name : null);
    const isBusy = busy === t.transaction_id;
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
        {/* Every in-row editor is the soft pill; the bordered skin belongs to
            toolbar and batch controls only. */}
        {opts.type && <Menu {...typeProps(t, eff, inflow)} isDark={isDark} tone="soft" size="sm" touch label="Type" disabled={isBusy} />}
        {opts.category && (
          <div className={`min-w-0 max-w-full ${opts.categoryClass ?? ""}`}>
            <Menu
              {...categoryProps(t)}
              isDark={isDark}
              tone="soft"
              size="sm"
              touch
              label="Account"
              leading={<AccountDisc label={t.book_category ?? ""} isDark={isDark} />}
              disabled={isBusy}
            />
          </div>
        )}
        {opts.loan && loans.length > 0 && <Menu {...loanProps(t)} isDark={isDark} tone="soft" size="sm" touch label="Loan" disabled={isBusy} />}
        {opts.vendorLink && vendor && (
          <button
            onClick={() => navigate(`/books/vendors/detail?name=${encodeURIComponent(vendor)}`)}
            className={`inline-flex items-center h-[40px] lg:h-7 px-3 rounded-full text-sm lg:text-xs font-medium transition-colors cursor-pointer ${outlineBtn(isDark)}`}
          >
            Open vendor →
          </button>
        )}
      </div>
    );
  };

  // The full-detail grid: three titled groups. `loanInline` adds the loan
  // picker to Categorization for the table at lg+ (below lg it lives in the
  // editors row instead).
  // Inline key/value rows (key column 7rem, value fills) so a group reads as
  // a short ledger, not a stack of label-over-value pairs.
  const renderDetail = (t: Txn, loanInline = false) => (
    <div className="grid gap-x-8 gap-y-5 lg:grid-cols-3">
      {detail(t).map((g) => (
        <div key={g.title} className="min-w-0">
          <p className={`${MICRO} ${t2} mb-2`}>{g.title}</p>
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 items-baseline">
            {g.pairs.map((p) => (
              <Fragment key={p.k}>
                <dt className={`text-xs truncate ${t2}`}>{p.k}</dt>
                {p.mono ? (
                  <dd className={`min-w-0 font-mono text-xs break-all ${t2}`}>{p.v}</dd>
                ) : (
                  <dd className={`min-w-0 text-sm truncate ${t1}`} title={p.v}>{p.v}</dd>
                )}
              </Fragment>
            ))}
            {loanInline && g.title === "Categorization" && loans.length > 0 && (
              <>
                <dt className={`hidden lg:block text-xs self-center ${t2}`}>Loan</dt>
                <dd className="hidden lg:block min-w-0">
                  <Menu {...loanProps(t)} isDark={isDark} tone="soft" size="sm" label="Loan" disabled={busy === t.transaction_id} />
                </dd>
              </>
            )}
          </dl>
        </div>
      ))}
    </div>
  );

  const expandBtn = (isOpen: boolean, extra: string) =>
    `w-7 h-7 rounded-full inline-flex items-center justify-center cursor-pointer transition-colors ${
      isOpen ? glyphOn : `${t3} ${glyphFill}`
    } ${extra}`;
  // The same glyph every chevron on the page uses; the svg rotates, not the button.
  const expandGlyph = (isOpen: boolean) => (
    <svg
      className={`w-3 h-3 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
      fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={P.chevron} />
    </svg>
  );
  // Checkboxes stay quiet until they matter: revealed on hover, focus, when
  // the row is checked or once any selection exists. Touch layouts always show them.
  const anySelected = (selection?.selected.size ?? 0) > 0;
  const boxReveal = (checked: boolean) =>
    checked || anySelected ? "" : "lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100 transition-opacity";
  // Cards select through the avatar: a small check badge sits on its corner
  // when the card is hovered or selected (and, once anything is selected, a
  // neutral badge on the rest so the affordance is visible on touch too).
  // No box sits in the layout, so the avatar and the pill row share one edge.
  const pickBadge = (checked: boolean) =>
    checked
      ? "opacity-100 bg-emerald-500 text-white"
      : anySelected
        ? `opacity-100 ${isDark ? "bg-white/15 text-transparent lg:group-hover:bg-emerald-500 lg:group-hover:text-white" : "bg-gray-300 text-transparent lg:group-hover:bg-emerald-500 lg:group-hover:text-white"}`
        : "opacity-0 lg:group-hover:opacity-100 group-focus-visible:opacity-100 bg-emerald-500 text-white";
  const badgeRing = isDark ? "ring-[#0c0c0c]" : "ring-white";

  return (
   <>
    {/* ── Cards: one tinted card per transaction, grouped by day. One column on
        phones, two on tablets, three on wide screens. Nothing scrolls
        sideways; tapping a card expands the same editors, detail grid and
        history the table's drawer has. ─────────────────────────────────── */}
    {view !== "list" && (
    <div className={`${view === "cards" ? "" : "lg:hidden"} tabular-nums`}>
      {/* The select-all bar appears once a selection exists — until then the
          grid is a ledger, not a form. */}
      {selection && rows.length > 0 && anySelected && (
        <div className={`flex items-center justify-between h-9 px-3 sm:px-4 border-b ${hair}`}>
          <button
            onClick={() => selection.setAll(allSelected ? [] : rows.map((r) => r.transaction_id))}
            className={`-ml-1 h-7 px-1.5 rounded-md inline-flex items-center gap-2 text-xs cursor-pointer transition-colors ${t2} ${hitFill} ${touchHit}`}
          >
            {box(allSelected, someSelected)}
            {allSelected ? "Deselect all" : "Select all"}
          </button>
          <span className={`text-xs tabular-nums ${t2}`}>{selection.selected.size} selected</span>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-3 p-3 sm:p-4">
        {rows.map((t, ri) => {
          const inflow = t.amount < 0;
          const eff = effType(t);
          const vendor = t.merchant_name || (eff === "normal" ? t.name : null);
          const isOpen = open.has(t.transaction_id);
          const newDay = cardBands && (ri === 0 || rows[ri - 1].date !== t.date);
          const dim = eff === "transfer" || eff === "intercompany";
          const checked = selection?.selected.has(t.transaction_id) ?? false;
          const amtTone = dim ? t2 : inflow ? incomeTone(isDark) : t1;
          const primary = (vendor ? displayName(vendor) : memoText(t.name)) || "—";
          const descriptor = vendor ? descriptorFor(t.name, vendor, t.entity_name) : null;
          // Line 2 only when it says something the card doesn't already:
          // the date (ungrouped), a real memo, or pending.
          const meta = [!cardBands ? midDate(t.date) : null, descriptor].filter(Boolean).join(" · ");
          const hasMeta = !!meta || t.pending;
          const surface = checked
            ? isDark ? "border-emerald-500/40 bg-emerald-500/[0.07]" : "border-emerald-300 bg-emerald-50"
            : isDark ? "border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.05]" : "border-gray-200 bg-white hover:bg-gray-50";
          const avatar = (
            <VendorAvatar
              name={vendor || t.name || "?"}
              isDark={isDark}
              size="lg"
              icon={vendor ? undefined : typeIcon(eff === "intercompany" ? "intercompany" : "transfer", inflow)}
            />
          );
          return (
            <Fragment key={`m-${t.transaction_id}`}>
              {newDay && (
                <div className={`col-span-full px-1 pt-2 first:pt-0 -mb-1 text-xs font-medium ${t2}`}>
                  {longDate(t.date)}
                </div>
              )}
              <div
                data-txn-card
                className={`group relative flex flex-col gap-2.5 rounded-xl border p-3 transition-colors ${surface} ${isOpen ? "col-span-full" : ""}`}
              >
                <div className="flex items-center gap-3">
                  {selection ? (
                    <button
                      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                      onClick={(e) => pickRow(e, t, ri)}
                      aria-label="Select transaction"
                      aria-pressed={checked}
                      title={checked ? "Deselect" : "Select"}
                      className={`relative w-8 h-8 rounded-full shrink-0 cursor-pointer ${touchHit}`}
                    >
                      {avatar}
                      <span
                        aria-hidden
                        className={`absolute -right-0.5 -bottom-0.5 w-3.5 h-3.5 rounded-full ring-2 flex items-center justify-center transition-colors ${badgeRing} ${pickBadge(checked)}`}
                      >
                        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24" aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" d={P.check} />
                        </svg>
                      </span>
                    </button>
                  ) : (
                    avatar
                  )}
                  <button
                    onClick={() => toggle(t.transaction_id)}
                    aria-expanded={isOpen}
                    // Two text lines are ~31px, one line ~15px; a pseudo-element
                    // grows the tap area to ≥40px on touch layouts either way.
                    // The header keeps the same layout open or closed, so
                    // nothing moves when a card expands.
                    className={`flex-1 min-w-0 text-left cursor-pointer relative after:content-[''] after:absolute after:inset-x-0 lg:after:inset-0 ${
                      hasMeta ? "after:-inset-y-[6px]" : "after:-inset-y-[13px]"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span
                        className={`text-base lg:text-sm leading-5 ${
                          vendor ? "font-medium truncate" : "font-normal line-clamp-2 break-words"
                        } ${dim ? t2 : t1}`}
                        title={primary}
                      >
                        {primary}
                      </span>
                      <span className="shrink-0 inline-flex items-center gap-1.5">
                        <span aria-hidden className={`w-1.5 h-1.5 rounded-full shrink-0 ${typeDot(eff, inflow, t.pending)}`} />
                        <span className={`text-base lg:text-sm font-semibold tabular-nums leading-5 whitespace-nowrap ${amtTone}`}>
                          {inflow ? "+" : ""}{money(Math.abs(t.amount), t.currency ?? "USD")}
                        </span>
                      </span>
                    </div>
                    {hasMeta && (
                      <div className={`mt-0.5 flex items-center gap-2 min-w-0 text-sm lg:text-xs ${t2}`}>
                        {meta && <span className="truncate" title={meta}>{meta}</span>}
                        {t.pending && <span className={`shrink-0 font-medium ${amberTone(isDark)}`}>Pending</span>}
                      </div>
                    )}
                  </button>
                </div>
                {/* Pinned to the card's bottom edge so pill rows line up across
                    a grid row whatever the neighbours' line count. */}
                <div className="mt-auto flex items-center gap-2 min-w-0">
                  <div className="min-w-0">
                    <Menu
                      {...categoryProps(t)}
                      isDark={isDark}
                      tone="soft"
                      size="sm"
                      touch
                      chevron="always"
                      label="Account"
                      leading={<AccountDisc label={t.book_category ?? ""} isDark={isDark} />}
                      disabled={busy === t.transaction_id}
                    />
                  </div>
                  {t.entity_name ? (
                    <EntityTag name={t.entity_name} isDark={isDark} />
                  ) : (
                    <span className={`shrink-0 text-xs ${amberTone(isDark)}`}>Unmapped</span>
                  )}
                  {/* The whole card body already expands; the chevron is the
                      quiet, always-present secondary affordance. */}
                  <button
                    onClick={() => toggle(t.transaction_id)}
                    aria-expanded={isOpen}
                    aria-label="Full detail"
                    className={expandBtn(isOpen, `ml-auto shrink-0 ${touchHit}`)}
                  >
                    {expandGlyph(isOpen)}
                  </button>
                </div>
                {isOpen && (
                  <div className={`mt-0.5 pt-3 border-t ${rule}`}>
                    {renderEditors(t, { type: true, loan: true, vendorLink: true })}
                    <div className="mt-4">{renderDetail(t)}</div>
                    <TxnHistoryPanel transactionId={t.transaction_id} isDark={isDark} />
                  </div>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
    )}

    {/* ── List: the ledger table. Rows group under a text-only date band; the
        merchant leads with the descriptor muted beside it; the account is a
        soft pill with a section-tinted disc; transfers drop to the muted
        tier; the amount carries a type dot only when it says something.
        Details expand from the trailing chevron. ───────────────────────── */}
    {view !== "cards" && (
    <table className={`w-full table-fixed text-sm tabular-nums ${view === "list" ? "table" : "hidden lg:table"}`}>
      {/* Near-opaque so bands scrolling underneath never ghost through;
          #080808 is the card surface composited over the black shell. */}
      <thead className={`sticky top-0 z-10 backdrop-blur-md ${isDark ? "bg-[#080808]/95" : "bg-white/95"}`}>
        <tr className={`text-left text-xs font-medium border-b ${t2} ${rule}`}>
          {selection && (
            <th scope="col" className="w-9 pl-3 py-2.5 font-medium text-left align-middle">
              <button
                onClick={() => selection.setAll(allSelected ? [] : rows.map((r) => r.transaction_id))}
                aria-label={allSelected ? "Deselect all" : "Select all"}
                className={`${hitArea} ${touchHit} -my-1 align-middle`}
              >
                {box(allSelected, someSelected)}
              </button>
            </th>
          )}
          {/* Merchant and Category split the free width; from xl Merchant is
              capped so the category pill anchors mid-table instead of drifting
              behind a half-empty merchant column. */}
          {th("Merchant", "vendor", "left", "xl:w-[46%]")}
          {th("Category", "account", "left", "hidden md:table-cell")}
          {/* Below lg the trailing columns are as narrow as their content
              allows so the merchant column keeps the room on phones. */}
          {th("Entity", "entity", "left", "w-14 lg:w-16 xl:w-24")}
          {th("Type", undefined, "left", "w-28 xl:w-32 hidden lg:table-cell")}
          {th("Date", "date", "left", "w-32 xl:w-36 hidden lg:table-cell")}
          {th("Amount", "amount", "right", "w-28 lg:w-36")}
          {balances && <th scope="col" className="w-32 px-2 py-2.5 font-medium text-right">Balance</th>}
          <th scope="col" className="w-8 lg:w-9 font-medium" />
        </tr>
      </thead>
      <tbody>
        {rows.map((t, ri) => {
          const inflow = t.amount < 0;
          const eff = effType(t);
          // Transfers and other own-money movements have no counterparty —
          // the descriptor stands in as the (muted) primary line.
          const vendor = t.merchant_name || (eff === "normal" ? t.name : null);
          const isOpen = open.has(t.transaction_id);
          const newDay = grouped && (ri === 0 || rows[ri - 1].date !== t.date);
          const dim = eff === "transfer" || eff === "intercompany";
          const checked = selection?.selected.has(t.transaction_id) ?? false;
          const amtTone = dim ? t2 : inflow ? incomeTone(isDark) : t1;
          const vendorText = displayName(vendor);
          const memo = vendor ? descriptorFor(t.name, vendor, t.entity_name) : memoText(t.name);
          return (
            <Fragment key={t.transaction_id}>
              {newDay && (
                <tr>
                  {/* Bands share the avatar's left edge (checkbox column w-9
                      + cell px-2 = 2.75rem), not the card inset. */}
                  <td colSpan={cols} className={`${selection ? "pl-11" : "pl-4"} pr-4 pt-4 pb-1.5 text-xs font-medium tabular-nums ${t2}`}>
                    {longDate(t.date)}
                  </td>
                </tr>
              )}
              <tr
                className={`group border-b last:border-b-0 transition-colors ${hair} ${hover} ${checked ? selectedSkin : ""} ${
                  isOpen ? expandedBg : ""
                }`}
              >
                {selection && (
                  <td className="pl-3 align-middle">
                    <button
                      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                      onClick={(e) => pickRow(e, t, ri)}
                      aria-label="Select row"
                      aria-pressed={checked}
                      className={`${hitArea} ${touchHit} align-middle ${boxReveal(checked)}`}
                    >
                      {box(checked)}
                    </button>
                  </td>
                )}
                <td className={cell}>
                  {/* One line: vendor, then the descriptor muted beside it.
                      Both truncate; the vendor keeps a floor so a long
                      descriptor can't squeeze it out. A vendor-less row
                      (a transfer) shows its memo as a quiet description. */}
                  {/* No overflow-hidden here: it would clip the vendor
                      link's phone tap box; the children truncate themselves. */}
                  <div className="flex items-center gap-3 min-w-0">
                    <VendorAvatar
                      name={vendor || t.name || "?"}
                      isDark={isDark}
                      size="sm"
                      icon={vendor ? undefined : typeIcon(eff === "intercompany" ? "intercompany" : "transfer", inflow)}
                    />
                    <div className="min-w-0 flex items-baseline gap-2 leading-5">
                      {vendor ? (
                        <button
                          onClick={() => navigate(`/books/vendors/detail?name=${encodeURIComponent(vendor)}`)}
                          title={`Open ${vendorText}`}
                          // Below lg the 15px text gets a row-filling tap box
                          // (the inner span truncates, so the button itself
                          // never clips its pseudo-element).
                          className={`text-sm font-medium min-w-0 md:shrink-0 max-w-[240px] text-left cursor-pointer hover:underline relative after:content-[''] after:absolute after:inset-x-0 after:-inset-y-[13px] lg:after:inset-0 ${dim ? t2 : t1}`}
                        >
                          <span className="block truncate">{vendorText}</span>
                        </button>
                      ) : (
                        <span className={`text-sm font-normal truncate min-w-0 ${t2}`} title={t.name ?? undefined}>
                          {memo || "—"}
                        </span>
                      )}
                      {t.pending && <span className={`text-xs font-medium shrink-0 ${amberTone(isDark)}`}>Pending</span>}
                      {vendor && memo && (
                        <span className={`hidden md:block text-xs truncate min-w-0 max-w-[36ch] shrink-[4] ${t2}`} title={t.name ?? memo}>
                          {memo}
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className={`${cell} hidden md:table-cell`}>
                  <div className="min-w-0 [&>button]:max-w-full">
                    <Menu
                      {...categoryProps(t)}
                      isDark={isDark}
                      tone="soft"
                      size="sm"
                      chevron="hover"
                      label="Account"
                      leading={<AccountDisc label={t.book_category ?? ""} isDark={isDark} />}
                      disabled={busy === t.transaction_id}
                    />
                  </div>
                </td>
                <td className={`${cell} whitespace-nowrap`}>
                  {t.entity_name ? (
                    <EntityTag name={t.entity_name} isDark={isDark} />
                  ) : (
                    <span className={`text-xs ${amberTone(isDark)}`}>Unmapped</span>
                  )}
                </td>
                <td className={`${cell} hidden lg:table-cell`}>
                  <Menu
                    {...typeProps(t, eff, inflow)}
                    isDark={isDark}
                    quiet
                    size="sm"
                    chevron="hover"
                    label="Type"
                    disabled={busy === t.transaction_id}
                  />
                </td>
                <td className={`${cell} hidden lg:table-cell text-xs whitespace-nowrap ${t2}`} title={t.date}>
                  {midDate(t.date)}
                </td>
                <td className={`${cell} text-right whitespace-nowrap`}>
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className={`w-1.5 h-1.5 rounded-full shrink-0 ${typeDot(eff, inflow, t.pending)}`} />
                    <span className={`text-sm font-semibold tabular-nums ${amtTone}`}>
                      {inflow ? "+" : ""}{money(Math.abs(t.amount), t.currency ?? "USD")}
                    </span>
                  </span>
                </td>
                {balances && (
                  <td className={`${cell} text-right whitespace-nowrap text-sm font-medium tabular-nums ${t1}`}>
                    {money(balances[t.transaction_id] ?? 0, t.currency ?? "USD")}
                  </td>
                )}
                {/* Visible at rest in the quietest tier: the trailing gutter
                    then mirrors the checkbox gutter on the left. */}
                <td className="pr-2 text-right align-middle">
                  <button
                    onClick={() => toggle(t.transaction_id)}
                    aria-expanded={isOpen}
                    aria-label="Full detail"
                    className={expandBtn(isOpen, touchHit)}
                  >
                    {expandGlyph(isOpen)}
                  </button>
                </td>
              </tr>
              {isOpen && (
                <tr className={`border-b ${hair} ${expandedBg}`}>
                  <td colSpan={cols} className="px-4 pt-4 pb-5">
                    {/* Below lg the Type/Category columns are hidden, so the
                        editors reappear here. */}
                    <div className="lg:hidden mb-4">
                      {renderEditors(t, { type: true, category: true, categoryClass: "md:hidden", loan: true })}
                    </div>
                    {renderDetail(t, true)}
                    <TxnHistoryPanel transactionId={t.transaction_id} isDark={isDark} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
    )}
    {pendingCat && (
      <ConfirmDialog
        isDark={isDark}
        title={`Categorize all “${pendingCat.match}”?`}
        message={
          <>
            Apply <span className="font-medium">{pendingCat.category}</span> to every “{pendingCat.match}”
            transaction and keep categorizing new ones the same way — or just this one.
          </>
        }
        confirmLabel="Apply to all & remember"
        altLabel="Just this one"
        cancelLabel="Cancel"
        onConfirm={() => {
          const p = pendingCat;
          setPendingCat(null);
          void applyCategoryAll(p.t, p.category, p.match);
        }}
        onAlt={() => {
          const p = pendingCat;
          setPendingCat(null);
          void applyCategoryOne(p.t, p.category);
        }}
        onClose={() => setPendingCat(null)}
      />
    )}
   </>
  );
}
