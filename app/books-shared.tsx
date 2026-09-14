import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

/** Currency with a true minus (U+2212): a hyphen reads as a dash in numerals. */
export function money(n: number, currency = "USD"): string {
  return n.toLocaleString("en-US", { style: "currency", currency }).replace(/^-/, "−");
}

/**
 * A Plaid-signed row amount: negative is money in ("+$3,015.70"), positive
 * is money out ("$125.00"). The only place the ledger's sign rule lives.
 */
export function signedMoney(amount: number, currency?: string | null): string {
  const c = currency ?? "USD";
  return amount < 0 ? `+${money(-amount, c)}` : money(amount, c);
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type DateOpts = { omitCurrentYear?: boolean };
const showYear = (y: number, opts?: DateOpts) => !(opts?.omitCurrentYear && y === new Date().getFullYear());

/** "2026-09-07" → "September 7, 2026" ("September 7" with omitCurrentYear this year). No timezone. */
export function longDate(iso: string, opts?: DateOpts): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${LONG_MONTHS[m - 1]} ${d}${showYear(y, opts) ? `, ${y}` : ""}`;
}

/** "2026-08-08" → "Aug 8th". Parsed straight off the ISO string (no timezone). */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return iso;
  const v = d % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][d % 10] ?? "th";
  return `${SHORT_MONTHS[m - 1]} ${d}${suffix}`;
}

/** "2026-09-09" → "Sep 9, 2026" ("Sep 9" with omitCurrentYear this year). No timezone. */
export function midDate(iso: string, opts?: DateOpts): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${SHORT_MONTHS[m - 1]} ${d}${showYear(y, opts) ? `, ${y}` : ""}`;
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
//
// Root is 11.9px, so the rem classes measure: h-7 ≈ 20.8 · h-8 ≈ 23.8 ·
// h-9 ≈ 26.8 · text-xs 8.9 · text-sm 10.4 · px-4 11.9. Thead 31.2, row ≈ 39.6.
//
// z ladder (literal classes, low → high):
//   kebab z-40 < import dialog z-50 < batch bar z-[60] < sheet backdrop z-[69]
//   < popover / sheet z-[70] < toast z-[75] < tooltip / confirm z-[80]

/** Which density TxnTable renders: the ledger table or the card grid. */
export type TxnView = "list" | "cards";

/** Text tiers: t1 primary/numbers, t2 readable meta, t3 glyphs only. */
export function tiers(isDark: boolean): { t1: string; t2: string; t3: string } {
  // One neutral ramp per theme. Light writes gray-500 with an explicit `/100`
  // and `/80` so the class name escapes the html.light rescue layer (which
  // re-colours bare `.text-gray-400/500/600` for legacy components). Rule:
  // any light gray-400/500/600 TEXT outside tiers() must carry `/100` too,
  // or the rescue layer paints it gray-700/800 (the neutral avatar initial
  // came out heavier than the vendor name beside it). Explained only here.
  return isDark
    ? { t1: "text-gray-100", t2: "text-gray-400", t3: "text-gray-500" }
    : { t1: "text-gray-900", t2: "text-gray-500/100", t3: "text-gray-500/80" };
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

/**
 * Primary button colours (callers add layout, height and padding). Disabled
 * is a quiet neutral fill, not a dimmed primary — a 40% black/white pill still
 * out-weighs the live outline beside it.
 */
export function primaryBtn(isDark: boolean): string {
  return isDark
    ? "bg-white text-black hover:bg-gray-200 active:bg-gray-300 disabled:bg-white/20 disabled:text-white/50"
    : "bg-gray-900 text-white hover:bg-gray-800 active:bg-gray-700 disabled:bg-gray-200 disabled:text-gray-500";
}

/** Outline button colours, border included. */
export function outlineBtn(isDark: boolean): string {
  return isDark
    ? "border border-white/10 text-gray-200 hover:bg-white/[0.06] hover:border-white/15 disabled:opacity-40"
    : "border border-gray-200 text-gray-800 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-40";
}

/** Ghost (text-only) button colours — the quietest action beside a field. */
export function ghostBtn(isDark: boolean): string {
  return isDark
    ? "text-gray-400 hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
    : "text-gray-500/100 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40";
}

/** Page-level card colours (callers add `rounded-2xl border`). */
export function cardSurface(isDark: boolean): string {
  return isDark ? "border-white/[0.08] bg-white/[0.03]" : "border-gray-200 bg-white";
}

/** The quietest divider between rows and cells. */
export function hairline(isDark: boolean): string {
  return isDark ? "border-white/[0.06]" : "border-gray-200/70";
}

/** The structural rule: toolbar bottom, thead, section dividers. */
export function ruleBorder(isDark: boolean): string {
  return isDark ? "border-white/[0.08]" : "border-gray-200";
}

/** The highlighted item in a popover list (keyboard or hover). */
export function itemHighlight(isDark: boolean): string {
  return isDark ? "bg-white/[0.08] text-gray-100" : "bg-gray-100 text-gray-900";
}

/** Text-input skin shared by every field: search, batch, receipt URL, popover search. */
export function textInput(isDark: boolean): string {
  return isDark
    ? "bg-white/[0.04] border-white/10 text-gray-100 placeholder:text-gray-500 hover:border-white/15 focus:border-white/25 focus:bg-white/[0.06]"
    : "bg-white border-gray-200 text-gray-900 placeholder:text-gray-500/100 hover:border-gray-300 focus:border-gray-400";
}

// Disabled looks live in the colour skins (primaryBtn / outlineBtn / ghostBtn),
// so a disabled primary can be a neutral fill while a disabled outline dims.
export const BTN_BASE = "inline-flex items-center justify-center rounded-full font-medium transition-colors cursor-pointer disabled:cursor-default";

/**
 * Tap-target tokens: the visible box stays the design's size; a pseudo-element
 * grows the hit area to ≥ 40px below lg and collapses to the box at lg+.
 */
export const TAP = {
  /** w-7/h-7 hit areas → 48. */
  box: "relative after:content-[''] after:absolute after:-inset-[10px] lg:after:inset-0",
  /** h-8 pill → 40.8. */
  pill: "relative after:content-[''] after:absolute after:inset-x-0 after:-inset-y-[8.5px] lg:after:inset-0",
  /** One 14.9px text line → 40.9. */
  line: "relative after:content-[''] after:absolute after:inset-x-0 after:-inset-y-[13px] lg:after:inset-0",
  /** Two text lines → 43. */
  line2: "relative after:content-[''] after:absolute after:inset-x-0 after:-inset-y-[6px] lg:after:inset-0",
  /** h-6 sort button → 41.8. */
  head: "relative after:content-[''] after:absolute after:inset-x-0 after:-inset-y-[12px] lg:after:inset-0",
  /** 35px segment in a 40px container → 41 (phones); the 20.8px segment in an h-9 container → 40.8 (tablets). */
  seg: "relative after:content-[''] after:absolute after:inset-x-0 after:-inset-y-1 sm:after:-inset-y-[10px] lg:after:inset-0",
  /** md controls (h-9 from sm) → 40.8 on tablets; already 40px below sm. */
  md: "relative after:content-[''] after:absolute after:inset-0 sm:after:-inset-[7px] lg:after:inset-0",
  /** The w-6 ledger avatar as a checkbox → 41.9. */
  avatar: "relative after:content-[''] after:absolute after:-inset-[12px] lg:after:inset-0",
};

/** The entity tag pill's box (the tint comes from entityTagClass). */
const TAG_BOX = "inline-flex items-center shrink-0 rounded-md text-xs font-semibold tracking-[0.04em] leading-none";
export const TAG_PILL = `${TAG_BOX} h-5 px-1.5`;
/** On a card face the tag sits beside an h-8 pill; h-6 keeps them one family (h-5 at lg). */
const TAG_PILL_TOUCH = `${TAG_BOX} h-6 px-2 lg:h-5 lg:px-1.5`;

/** True while the viewport matches `query` (tracks resizes). */
export function useMedia(query: string): boolean {
  // The app renders client-only (`ssr: false`), so matchMedia is always here.
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setOn(mq.matches);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return on;
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
      // A one-letter small word in a shouting memo ("ECM A LEGALZOOM CO.")
      // is lower-cased before the short-token guard would keep it.
      if (shouting && i > 0 && bare === bare.toUpperCase() && SMALL_WORDS.has(bare.toLowerCase())) return tok.toLowerCase();
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

// Light uses the -100 tints (the same ramp AVATAR_TONES uses): a -50 tint on a
// white row is ΔL ≈ 0.02, so the chip box vanished and the tag read as bare
// coloured text while the dark theme showed a pill.
const TAG_STYLES: Array<{ dark: string; light: string }> = [
  { dark: "bg-emerald-500/10 text-emerald-300", light: "bg-emerald-100 text-emerald-700" },
  { dark: "bg-sky-500/10 text-sky-300", light: "bg-sky-100 text-sky-700" },
  { dark: "bg-violet-500/10 text-violet-300", light: "bg-violet-100 text-violet-700" },
  { dark: "bg-amber-500/10 text-amber-300", light: "bg-amber-100 text-amber-700" },
  { dark: "bg-rose-500/10 text-rose-300", light: "bg-rose-100 text-rose-700" },
  { dark: "bg-teal-500/10 text-teal-300", light: "bg-teal-100 text-teal-700" },
  { dark: "bg-indigo-500/10 text-indigo-300", light: "bg-indigo-100 text-indigo-700" },
  { dark: "bg-orange-500/10 text-orange-300", light: "bg-orange-100 text-orange-700" },
];

/** A stable slot in an n-entry palette for a name (the hash fallback). */
function hueIndex(name: string, n: number): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % n;
}

// Entities get their hue by sorted position once the list is known (hashing
// eight names into eight hues collided four of them). Cached so the first
// paint already agrees with the last session; the hash stays the fallback
// for embeds that never load the entity list.
let ENTITY_ORDER: string[] = [];
try {
  const stored = JSON.parse(globalThis.localStorage?.getItem("bfo-entity-order") ?? "[]");
  if (Array.isArray(stored)) ENTITY_ORDER = stored.filter((s): s is string => typeof s === "string");
} catch {
  ENTITY_ORDER = [];
}

/** Fix the entity → hue assignment from the full entity list (sorted, normalised). */
export function setEntityHueOrder(names: string[]): void {
  ENTITY_ORDER = names.map(normTagKey).sort();
  try {
    localStorage.setItem("bfo-entity-order", JSON.stringify(ENTITY_ORDER));
  } catch {
    // cache only
  }
}

/** A deterministic colour class for an entity's tag: by position when the list is known, else by hash. */
export function entityTagClass(name: string | null | undefined, isDark: boolean): string {
  if (!name) return isDark ? "bg-white/[0.06] text-gray-400" : "bg-gray-100 text-gray-500/100";
  const at = ENTITY_ORDER.indexOf(normTagKey(name));
  const s = TAG_STYLES[at >= 0 ? at % TAG_STYLES.length : hueIndex(name, TAG_STYLES.length)];
  return isDark ? s.dark : s.light;
}

// Tooltips warm up: the first hover waits 300ms (a pointer crossing the
// column shouldn't flash names), then every tag is instant for 400ms after
// the last one closes, so scanning a column reads as one gesture.
let tipWarmUntil = 0;

/**
 * The entity tag pill with an un-clipped tooltip: the full entity name
 * appears on hover, rendered through a portal so the table's overflow box
 * never crops it. `tooltip={false}` renders the bare pill (menu options).
 */
export function EntityTag({
  name,
  isDark,
  tooltip = true,
  size = "sm",
  srName = true,
}: {
  name: string;
  isDark: boolean;
  tooltip?: boolean;
  /** touch: h-6 below lg — a peer of the h-8 category pill on card faces. */
  size?: "sm" | "touch";
  /** false where the full name is already read out beside the pill (menu options). */
  srName?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  const shown = useRef(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    shown.current = true;
    setPos({ left: r.left + r.width / 2, top: r.bottom + 0.5 * rem });
  };
  const enter = () => {
    if (Date.now() < tipWarmUntil) show();
    else timer.current = window.setTimeout(show, 300);
  };
  const leave = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (shown.current) tipWarmUntil = Date.now() + 400;
    shown.current = false;
    setPos(null);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const pill = `${size === "touch" ? TAG_PILL_TOUCH : TAG_PILL} cursor-default ${entityTagClass(name, isDark)}`;
  const sr = srName && <span className="sr-only">{name}</span>;
  if (!tooltip) {
    return (
      <span className={pill}>
        {entityTag(name)}
        {sr}
      </span>
    );
  }
  return (
    <>
      <span ref={ref} onMouseEnter={enter} onMouseLeave={leave} className={pill}>
        {entityTag(name)}
        {sr}
      </span>
      {pos &&
        createPortal(
          <div
            style={{ position: "fixed", left: pos.left, top: pos.top, transform: "translateX(-50%)" }}
            className={`z-[80] pointer-events-none px-2 py-1 rounded-lg text-xs whitespace-nowrap border pop-in ${popoverSurface(isDark)} ${tiers(isDark).t1}`}
            aria-hidden
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
 * A small initial disc for a vendor. `tone="hash"` tints it by name (vendor
 * pages); `tone="neutral"` keeps it gray so the ledger spends colour only on
 * meaning. With `icon` (a vendor-less row: transfer, roll-up, ATM) the disc
 * shows the glyph instead.
 */
export function VendorAvatar({
  name,
  isDark = false,
  size = "sm",
  icon,
  tone = "hash",
}: {
  name: string;
  isDark?: boolean;
  size?: "sm" | "lg";
  icon?: ReactNode;
  tone?: "hash" | "neutral";
}) {
  const hue = AVATAR_TONES[hueIndex(name, AVATAR_TONES.length)];
  const skin = icon
    ? isDark ? "bg-white/[0.06] text-gray-400" : "bg-gray-100 text-gray-500/100"
    : tone === "neutral"
      ? isDark ? "bg-white/[0.06] text-gray-300" : "bg-gray-100 text-gray-600/100"
      : isDark ? hue.dark : hue.light;
  return (
    <span
      aria-hidden
      className={`rounded-full shrink-0 flex items-center justify-center font-semibold ${size === "lg" ? "w-8 h-8 text-sm" : "w-6 h-6 text-xs"} ${skin} ${
        icon ? (size === "lg" ? "[&>svg]:w-3.5 [&>svg]:h-3.5" : "[&>svg]:w-3 [&>svg]:h-3") : ""
      }`}
    >
      {icon ?? (name.trim()[0]?.toUpperCase() ?? "?")}
    </span>
  );
}

/** A tiny stroked icon from a single path. */
export function Icon({ d, className, strokeWidth = 1.8 }: { d: string; className?: string; strokeWidth?: number }) {
  return (
    <svg className={className ?? "w-3.5 h-3.5 shrink-0"} fill="none" stroke="currentColor" strokeWidth={strokeWidth} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

/** Every stroked glyph the Books pages draw, in one table. */
export const PATHS = {
  down: "M12 4.5v15m0 0l6.75-6.75M12 19.5l-6.75-6.75",
  up: "M12 19.5v-15m0 0l6.75 6.75M12 4.5L5.25 11.25",
  swap: "M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m3-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5",
  building: "M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h6M9 10.5h6M9 14.25h6M10.5 21v-3.75h3V21",
  trend: "M2.25 6 9 12.75l4.286-4.286a11.948 11.948 0 0 1 4.306 6.43l.776 2.898m0 0 3.182-5.511m-3.182 5.51-5.511-3.181",
  receipt: "M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0c1.1.128 1.907 1.077 1.907 2.185z",
  scale: "M12 3v17.25m-7.5-3.75h15M4.5 6.75l3 7.5 3-7.5m3 0l3 7.5 3-7.5",
  chevron: "M19.5 8.25l-7.5 7.5-7.5-7.5",
  chevronUp: "M4.5 15.75l7.5-7.5 7.5 7.5",
  chevronRight: "M8.25 4.5l7.5 7.5-7.5 7.5",
  check: "M4.5 12.75l6 6 9-13.5",
  close: "M6 18L18 6M6 6l12 12",
  search: "M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z",
  sun: "M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z",
  list: "M4 6h16M4 12h16M4 18h16",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  inbox: "M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3",
  sync: "M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99",
};
const P = PATHS;

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
      : "bg-gray-200 text-gray-600/100";
  return (
    <span aria-hidden className={`w-4 h-4 rounded-full shrink-0 inline-flex items-center justify-center ${tone}`}>
      <Icon d={accountIconPath(label)} className="w-2.5 h-2.5" />
    </span>
  );
}

/**
 * The small dot before an amount — rendered only when it adds information:
 * pending amber, roll-up violet, transfer/loan gray. Posted income and
 * expense return `bg-transparent`, which callers use to skip the dot.
 */
export function typeDot(eff: string, inflow: boolean, pending = false, isDark = true): string {
  if (pending) return isDark ? "bg-amber-400" : "bg-amber-600";
  if (eff === "intercompany") return isDark ? "bg-violet-400" : "bg-violet-600";
  if (eff === "transfer" || eff === "loan") return isDark ? "bg-gray-500" : "bg-gray-400";
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

/** A chart-of-accounts entry as a Menu option (short label, icon, group). */
function accountOption(c: string): Option {
  return { value: c, label: c, short: c.replace(/^\d{4}\s+/, ""), icon: accountIcon(c), group: accountGroup(c) };
}

// ── Focus management ─────────────────────────────────────────────────────
const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}
// Traps stack (a Menu sheet over the batch sheet); only the top one steers Tab.
const TRAPS: HTMLElement[] = [];

/**
 * Keeps keyboard focus inside `ref` while `active`: remembers the opener,
 * moves focus in (the `[data-autofocus]` element, else the first tabbable,
 * or the container itself with `initial: "container"`), wraps Tab both
 * ways, locks body scroll, and on deactivate restores scroll and focus.
 */
export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  opts?: { initial?: "first" | "container" }
): void {
  const initial = opts?.initial ?? "first";
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    TRAPS.push(root);
    if (root.tabIndex < 0 && !root.hasAttribute("tabindex")) root.tabIndex = -1;
    const target = initial === "container" ? root : root.querySelector<HTMLElement>("[data-autofocus]") ?? tabbables(root)[0] ?? root;
    target.focus({ preventScroll: true });
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Tab" || TRAPS[TRAPS.length - 1] !== root) return;
      const list = tabbables(root!);
      const cur = document.activeElement;
      if (list.length === 0) {
        e.preventDefault();
        root!.focus({ preventScroll: true });
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      if (!root!.contains(cur)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && cur === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && cur === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const at = TRAPS.lastIndexOf(root);
      if (at >= 0) TRAPS.splice(at, 1);
      document.body.style.overflow = prevOverflow;
      if (opener && typeof opener.focus === "function" && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [ref, active, initial]);
}

/**
 * A fully custom dropdown — a rounded pill trigger and a themed popover list
 * with a checkmark on the current choice. Rendered through a portal with fixed
 * positioning so it escapes any scroll box (a native <select>'s option list
 * can't be styled, and an absolutely-positioned menu would be clipped).
 * Keyboard: arrows open and move, Enter chooses, Escape closes; focus returns
 * to the trigger. Below 640px it opens as a bottom sheet.
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
  /** Title of the phone bottom sheet ("Account", "Type"); also names the control. */
  label?: string;
  /** hover: the chevron only appears while the enclosing `.group` row is hovered. */
  chevron?: "always" | "hover";
  /** sm pills that must be thumb-sized below lg (card faces, phone editors). */
  touch?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  // On phones the menu opens as a bottom sheet instead of an anchored popover.
  const [sheet, setSheet] = useState(false);
  const smUp = useMedia("(min-width: 640px)");
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Anchored to the trigger's top-left; `bottom` instead of `top` when the
  // panel flips above so its lower edge hugs the trigger whatever its height.
  const [box, setBox] = useState<{ left: number; top?: number; bottom?: number; width: number; above: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [filter, setFilter] = useState("");
  const [hi, setHi] = useState(-1);
  const listId = useId();
  const titleId = `${listId}-title`;
  const { t1, t2, t3 } = tiers(isDark);

  const currentIndex = options.findIndex((o) => o.value === value);
  const current = currentIndex >= 0 ? options[currentIndex] : undefined;
  const text =
    current?.short ?? current?.label ?? placeholder ?? options[0]?.short ?? options[0]?.label ?? "—";

  const searchable = options.length > 10;
  // Grouped lists (the chart of accounts) open as one compact scrolling column
  // with sticky group heads — never a viewport-wide panel.
  const grouped = options.some((o) => o.group);
  // Short lists (Type, Period, Loan) take a 12rem floor so a three-item panel
  // isn't 4× its trigger with the ✓ 150px from the label; long labels (the
  // entity list) and searchable lists keep the 224px floor.
  const longLabels = useMemo(() => options.some((o) => (o.short ?? o.label).length > 18), [options]);
  // When only some options carry an icon (the entity list: "All entities" and
  // "Unmapped" have none) every row gets a fixed slot so the labels share an x.
  const iconSlot = useMemo(() => options.some((o) => o.icon) && options.some((o) => !o.icon), [options]);
  const needle = filter.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  const groupCount = useMemo(() => new Set(options.map((o) => o.group ?? "Other")).size, [options]);

  useEffect(() => {
    if (!open) {
      setFilter("");
      setHi(-1);
      setBox(null);
    }
  }, [open]);
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  // Keep the keyboard highlight (or, on open, the current choice) in view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(hi >= 0 ? `[data-i="${hi}"]` : "[aria-selected='true']");
    el?.scrollIntoView({ block: "nearest" });
  }, [open, hi]);

  useFocusTrap(panelRef, open && sheet, { initial: "container" });

  function finishClose() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setClosing(false);
    setOpen(false);
  }
  // The exit animation plays before unmount; listeners come off at once and
  // clicks are ignored meanwhile. Focus goes back to the trigger for every
  // close the keyboard could have caused — not for a click elsewhere.
  function requestClose(refocus: boolean) {
    if (!open || closing) return;
    setClosing(true);
    if (refocus) btnRef.current?.focus({ preventScroll: true });
    closeTimer.current = window.setTimeout(finishClose, 200);
  }
  function openMenu(seed = -1) {
    if (closing || disabled) return;
    setSheet(!smUp);
    setHi(seed);
    setOpen(true);
  }
  function choose(o: Option) {
    if (closing) return;
    onChange(o.value);
    requestClose(true);
  }

  // Shared by the trigger (focus never left it) and the panel (search input).
  function navKey(e: React.KeyboardEvent): boolean {
    if (e.key === "ArrowDown") setHi((h) => Math.min(h + 1, shown.length - 1));
    else if (e.key === "ArrowUp") setHi((h) => Math.max(h - 1, 0));
    else if (e.key === "Home") setHi(0);
    else if (e.key === "End") setHi(shown.length - 1);
    else if (e.key === "Enter") {
      const target = shown[hi] ?? (needle ? shown[0] : undefined);
      if (target) choose(target);
      else requestClose(true);
    } else if (e.key === "Escape") requestClose(true);
    else return false;
    e.preventDefault();
    return true;
  }
  function onTriggerKey(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        openMenu(currentIndex);
      }
      return;
    }
    navKey(e);
  }

  useLayoutEffect(() => {
    if (!open || sheet || closing) return;
    function place() {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      // Grouped lists are a fixed w-72 column; other lists match the trigger
      // above a floor (12rem for short lists, 224px for long labels or a
      // search field). Either way the panel never exceeds the viewport − 16px.
      const floor = grouped ? 18 * rem : searchable || longLabels ? 224 : 12 * rem;
      const width = Math.min(window.innerWidth - 16, Math.max(r.width, floor));
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
        ...(above ? { bottom: window.innerHeight - r.top + 0.5 * rem } : { top: r.bottom + 0.5 * rem }),
        width,
        above,
      });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, sheet, closing, options.length, grouped, groupCount, searchable, longLabels]);

  useEffect(() => {
    if (!open || closing) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      requestClose(false);
    }
    // preventDefault marks the Escape as consumed: the batch bar (which also
    // listens on document) leaves the selection alone when a layer above it
    // has already taken the key.
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        requestClose(true);
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closing]);

  // Three control heights: md toolbar (h-[40px] sm:h-9), sm in-row (h-7),
  // sm+touch (h-8 below lg with a 40px hit box, h-7 at lg). Height never
  // comes from padding.
  const height = size === "md" ? "h-[40px] sm:h-9" : touch ? "h-8 lg:h-7" : "h-7";
  // The quiet skin is prose that happens to be editable (the Type word beside
  // the Date word), so it follows the prose rule (text-sm); chips are text-xs.
  const type = size === "md" ? "text-sm font-medium" : quiet ? "text-sm" : touch ? "text-sm lg:text-xs" : "text-xs";
  const padL = leading
    ? size === "md" ? "pl-2" : touch ? "pl-2 lg:pl-1.5" : "pl-1.5"
    : size === "md" ? "pl-4" : quiet ? "pl-2" : "pl-3";
  const padR = size === "md" ? "pr-3" : quiet ? "pr-1.5" : "pr-2.5";
  const width = size === "md" ? "max-w-[240px]" : quiet ? "" : touch ? "max-w-full" : "max-w-[190px]";
  const shift = quiet && size !== "md" ? "-ml-2" : "";
  // The quiet pill has no resting colour of its own: it inherits the cell's
  // (the Type column rests at t3 for the default word and t2 for the
  // exceptions, and the row's hover lifts it — see the Type cell). Hover,
  // focus and open on the pill itself go to t1.
  const skin = quiet
    ? isDark
      ? "hover:bg-white/[0.06] hover:text-gray-100 focus-visible:text-gray-100 aria-expanded:bg-white/[0.1] aria-expanded:text-gray-100"
      : "hover:bg-gray-100 hover:text-gray-900 focus-visible:text-gray-900 aria-expanded:bg-gray-200 aria-expanded:text-gray-900"
    : tone === "amber"
      ? isDark
        ? "bg-amber-500/10 border-amber-500/25 text-amber-200 hover:bg-amber-500/20 aria-expanded:bg-amber-500/25"
        : "bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100 aria-expanded:bg-amber-100"
      : tone === "soft"
        ? isDark
          ? "border-transparent font-medium bg-white/[0.06] text-gray-200 hover:bg-white/[0.09] aria-expanded:bg-white/[0.12]"
          : "border-transparent font-medium bg-gray-100 text-gray-800 hover:bg-gray-200 aria-expanded:bg-gray-300/70"
        : isDark
          ? "bg-white/[0.04] border-white/10 text-gray-200 hover:bg-white/[0.08] hover:border-white/15 aria-expanded:bg-white/[0.1] aria-expanded:border-white/20"
          : "bg-white border-gray-200 text-gray-800 hover:bg-gray-50 hover:border-gray-300 aria-expanded:bg-gray-100 aria-expanded:border-gray-300";
  // Quiet pills carry no border at all — a transparent 1px still shifted the
  // label a pixel right of the column head.
  const pill = `group/menu inline-flex items-center gap-1.5 rounded-full ${quiet ? "border-0" : "border"} cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default ${height} ${type} ${padL} ${padR} ${width} ${shift} ${skin}${
    touch ? ` ${TAP.pill}` : size === "md" ? ` ${TAP.md}` : ""
  }`;
  // Hover-reveal only applies where there is a hover (lg+); touch layouts
  // always show the glyph.
  const glyph =
    chevron === "hover" && !open
      ? "opacity-50 lg:opacity-0 lg:group-hover:opacity-50 lg:group-hover/menu:opacity-50 lg:group-focus-visible/menu:opacity-50"
      : "opacity-50";

  const optionBase = `w-full flex items-center rounded-lg text-left cursor-pointer transition-colors ${
    sheet ? "min-h-[44px] px-3 gap-3 text-base" : "h-8 px-2 gap-2 text-xs"
  }`;
  // Group heads stick to the top of the scrolling list in both the popover
  // and the sheet, on the surface colour so rows slide underneath.
  const groupHead = `${MICRO} ${t2} px-2 pt-2 pb-1 sticky top-0 z-10 ${
    sheet ? (isDark ? "bg-[#161616]/95" : "bg-white/95") : isDark ? "bg-[#161616]" : "bg-white"
  }`;
  const enter = sheet ? "sheet-in" : box?.above ? "pop-in-up origin-bottom" : "pop-in origin-top";
  const exit = sheet ? "sheet-out" : box?.above ? "pop-out-up" : "pop-out";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (closing) return;
          if (open) requestClose(false);
          else openMenu();
        }}
        onKeyDown={onTriggerKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label ? `${label}: ${text}` : undefined}
        className={pill}
        title={typeof text === "string" && text.length > 18 ? text : undefined}
      >
        {leading}
        <span className="truncate">{text}</span>
        <Icon
          d={P.chevron}
          strokeWidth={2}
          className={`w-3 h-3 shrink-0 transition-[opacity,rotate] motion-reduce:transition-none ${open ? "rotate-180" : ""} ${glyph}`}
        />
      </button>
      {open && (sheet || box) &&
        createPortal(
          <>
          {sheet && (
            <div
              className={`fixed inset-0 z-[69] bg-black/50 backdrop-blur-[2px] ${closing ? "fade-out" : "fade-in"}`}
              onClick={() => requestClose(true)}
              aria-hidden
            />
          )}
          <div
            ref={panelRef}
            id={listId}
            role="listbox"
            tabIndex={sheet ? -1 : undefined}
            aria-labelledby={sheet && label ? titleId : undefined}
            aria-activedescendant={hi >= 0 ? `${listId}-o${hi}` : undefined}
            style={
              sheet
                ? { position: "fixed", left: 0, right: 0, bottom: 0 }
                : { position: "fixed", left: box!.left, top: box!.top, bottom: box!.bottom, width: box!.width }
            }
            onKeyDown={navKey}
            onAnimationEnd={(e) => {
              if (closing && e.target === e.currentTarget) finishClose();
            }}
            className={`z-[70] border overflow-hidden flex flex-col tabular-nums ${
              sheet ? "rounded-t-2xl max-h-[72vh] pb-[max(env(safe-area-inset-bottom),12px)]" : "rounded-xl max-h-[60vh]"
            } ${closing ? `${exit} pointer-events-none` : enter} ${popoverSurface(isDark)}`}
          >
            {sheet && (
              <div className={`mx-auto mt-2 h-1 w-10 rounded-full shrink-0 ${isDark ? "bg-white/20" : "bg-gray-300"}`} aria-hidden />
            )}
            {sheet && label && <p id={titleId} className={`px-4 pt-2 pb-1 text-base font-semibold ${t1}`}>{label}</p>}
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
                  aria-label={`Filter ${label ?? "options"}`}
                  // The popover field is focused for you on open, so the global
                  // ring would fire on every click; the border step marks it.
                  // (`!`: app.css's unlayered input ring outranks plain utilities.)
                  className={`w-full rounded-full border ${sheet ? "h-[40px] px-3.5 text-[16px] placeholder:text-base" : "h-8 px-3 text-xs focus-visible:outline-0!"} ${textInput(isDark)}`}
                />
              </div>
            )}
            <div ref={listRef} className={`flex-1 min-h-0 overflow-y-auto ${sheet ? "p-2 pb-2" : "p-1"}`}>
              {shown.length === 0 && (
                <p className={`px-2 py-2 text-xs ${t2}`}>No matches.</p>
              )}
              {shown.map((o, i) => {
                const sel = o.value === value;
                const newGroup = o.group && (i === 0 || shown[i - 1].group !== o.group);
                return (
                  <Fragment key={`w-${o.value || "—"}`}>
                    {newGroup && <p className={groupHead}>{o.group}</p>}
                    <button
                      type="button"
                      id={`${listId}-o${i}`}
                      role="option"
                      aria-selected={sel}
                      data-i={i}
                      onClick={() => choose(o)}
                      onMouseEnter={() => setHi(i)}
                      className={`${optionBase} ${
                        i === hi ? itemHighlight(isDark) : isDark ? "text-gray-200" : "text-gray-800"
                      } ${sel ? "font-medium" : ""}`}
                      title={o.short && o.short !== o.label ? o.label : undefined}
                    >
                      {iconSlot ? (
                        <span className={`inline-flex items-center shrink-0 w-[2.75rem] ${t2}`}>{o.icon}</span>
                      ) : (
                        o.icon && <span className={`shrink-0 ${t2}`}>{o.icon}</span>
                      )}
                      <span className="truncate flex-1">{o.short ?? o.label}</span>
                      {o.hint && <span className={`shrink-0 text-xs ${t3}`}>{o.hint}</span>}
                      {sel && <Icon d={P.check} strokeWidth={2.5} className="ml-auto w-3.5 h-3.5 shrink-0 text-emerald-500" />}
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

type BatchPatch = { merchant_name?: string; name?: string; book_category?: string; type_override?: string };

/**
 * The floating batch editor: appears while rows are selected, applies a
 * vendor, description, type and/or account to all of them at once. One row
 * on sm+; on phones a compact bar whose "Edit…" opens a bottom sheet.
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
  onApply: (patch: BatchPatch) => void;
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
  // Escape dismisses the suggestions without leaving the field; typing again
  // brings them back.
  const [suggestOff, setSuggestOff] = useState(false);
  const [highlight, setHighlight] = useState(0);
  // The bar stays mounted through its exit animation; the last count is
  // what the chip shows while it leaves.
  const [leaving, setLeaving] = useState(false);
  const lastCount = useRef(count);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetClosing, setSheetClosing] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetTitleId = useId();
  if (count > 0) lastCount.current = count;
  useEffect(() => {
    if (count > 0) {
      setLeaving(false);
      return;
    }
    setSheetOpen(false);
    setSheetClosing(false);
    setLeaving(true);
    const t = window.setTimeout(() => setLeaving(false), 120);
    return () => clearTimeout(t);
  }, [count]);
  // Vendors whose name contains what's typed — capped so the list stays usable.
  const matches = useMemo(() => {
    const q = vendor.trim().toLowerCase();
    if (!q) return [] as string[];
    return vendorSuggestions
      .filter((v) => v.toLowerCase().includes(q) && v.toLowerCase() !== q)
      .slice(0, 8);
  }, [vendor, vendorSuggestions]);
  const showMenu = vendorFocus && !suggestOff && matches.length > 0;
  function closeSheet() {
    if (!sheetOpen || sheetClosing) return;
    setSheetClosing(true);
  }
  function finishSheet() {
    setSheetOpen(false);
    setSheetClosing(false);
  }
  useEffect(() => {
    if (!sheetClosing) return;
    const t = window.setTimeout(finishSheet, 200);
    return () => clearTimeout(t);
  }, [sheetClosing]);
  useFocusTrap(sheetRef, sheetOpen, { initial: "container" });
  // Escape closes the sheet first, then drops the selection — but only while
  // the bar is up and nothing floats above it. One Escape owner per layer:
  // a picker, a dialog or the kebab menu takes the key (they mark it with
  // preventDefault, and are also checked in the DOM in case this listener
  // runs first). The listener registers once per selection (refs, not
  // closures), so a layer's own re-render can't unhook it mid-dispatch.
  const onClearRef = useRef(onClear);
  onClearRef.current = onClear;
  const sheetState = useRef({ open: sheetOpen, closing: sheetClosing });
  sheetState.current = { open: sheetOpen, closing: sheetClosing };
  useEffect(() => {
    if (count === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[role='listbox']")) return;
      if (sheetState.current.open) {
        if (!sheetState.current.closing) setSheetClosing(true);
        return;
      }
      if (document.querySelector("[role='dialog'], [role='alertdialog'], [role='menu']")) return;
      onClearRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [count]);
  if (count === 0 && !leaving) return null;
  const shownCount = count > 0 ? count : lastCount.current;
  const { t1, t2 } = tiers(isDark);
  const field = `h-[40px] sm:h-9 px-3.5 rounded-full text-[16px] sm:text-sm placeholder:text-sm border ${textInput(isDark)}`;
  const glass = isDark
    ? "bg-[#161616]/90 border-white/10 backdrop-blur-xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)]"
    : "bg-white/95 border-gray-200 backdrop-blur-xl shadow-xl shadow-gray-900/10";
  const clearBtn = `w-[40px] h-[40px] sm:w-9 sm:h-9 rounded-full inline-flex items-center justify-center cursor-pointer transition-colors ${TAP.md} ${t2} ${
    isDark ? "hover:bg-white/[0.06] hover:text-white" : "hover:bg-gray-100 hover:text-gray-900"
  }`;
  const canApply = !!(vendor.trim() || description.trim() || account || batchType);
  const chip = (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center h-7 px-2.5 rounded-full text-xs font-medium whitespace-nowrap ${
        isDark ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-100 text-emerald-800"
      }`}
    >
      {shownCount} selected
    </span>
  );
  function apply() {
    const patch: BatchPatch = {};
    if (vendor.trim()) patch.merchant_name = vendor.trim();
    if (description.trim()) patch.name = description.trim();
    if (account) patch.book_category = account;
    if (batchType) patch.type_override = batchType;
    onApply(patch);
    setVendor("");
    setDescription("");
    setAccount("");
    setBatchType("");
    closeSheet();
  }
  const typeOptions: Option[] = [
    { value: "normal", label: "Income / Expense", icon: typeIcon("normal", false) },
    { value: "transfer", label: "Transfer", icon: typeIcon("transfer", false) },
    { value: "intercompany", label: "Roll-up", icon: typeIcon("intercompany", false) },
  ];
  // The four fields, laid out inline (sm+) or stacked in the phone sheet.
  const fields = (stacked: boolean) => {
    const w = stacked ? "w-full" : "";
    const menuWrap = stacked ? "min-w-0 [&>button]:w-full [&>button]:max-w-none" : "min-w-0";
    return (
      <>
        <div className={`relative ${w}`}>
          {showMenu && (
            <div className={`absolute bottom-full mb-2 left-0 w-56 max-h-60 overflow-y-auto rounded-xl border p-1 pop-in-up z-10 ${popoverSurface(isDark)}`}>
              {matches.map((v, i) => (
                <button
                  key={v}
                  type="button"
                  // Keep focus on the input so blur doesn't close before the click lands.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setVendor(v);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`w-full text-left h-8 px-2.5 rounded-lg text-xs truncate cursor-pointer transition-colors ${
                    i === highlight ? itemHighlight(isDark) : isDark ? "text-gray-200" : "text-gray-800"
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
            onChange={(e) => {
              setVendor(e.target.value);
              setHighlight(0);
              setSuggestOff(false);
            }}
            onFocus={() => setVendorFocus(true)}
            onBlur={() => setVendorFocus(false)}
            onKeyDown={(e) => {
              if (!showMenu) return;
              // The popover owns Escape while it shows: preventDefault keeps
              // the bar's document listener from clearing the selection.
              if (e.key === "Escape") { e.preventDefault(); setSuggestOff(true); return; }
              if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, matches.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
              else if (e.key === "Enter" || e.key === "Tab") {
                if (matches[highlight]) { e.preventDefault(); setVendor(matches[highlight]); }
              }
            }}
            placeholder="Vendor…"
            aria-label="Vendor"
            className={`${field} ${stacked ? "w-full" : "w-40"}`}
          />
        </div>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description…"
          aria-label="Description"
          className={`${field} ${stacked ? "w-full" : "w-56"}`}
        />
        <div className={menuWrap}>
          <Menu value={batchType} isDark={isDark} size="md" label="Type" placeholder="Type…" onChange={setBatchType} options={typeOptions} />
        </div>
        {categories.length > 0 && (
          <div className={menuWrap}>
            <Menu value={account} isDark={isDark} size="md" label="Account" placeholder="Account…" onChange={setAccount} options={categories.map(accountOption)} />
          </div>
        )}
      </>
    );
  };
  const applyBtn = (extra: string) => (
    <button
      type="button"
      disabled={!canApply}
      aria-busy={busy || undefined}
      onClick={apply}
      className={`${BTN_BASE} h-[40px] sm:h-9 px-4 text-sm aria-busy:pointer-events-none ${TAP.md} ${primaryBtn(isDark)} ${extra}`}
    >
      {busy ? "Applying…" : "Apply"}
    </button>
  );
  // The bar lives in the content column (it inherits --inset and centres on
  // it); the sheet goes to body so it stacks above the phone dock.
  const host = document.querySelector<HTMLElement>("main.sidebar-content") ?? document.body;
  return (
    <>
      {createPortal(
      <div
        role="toolbar"
        aria-label="Batch edit"
        className={`fixed z-[60] left-2 right-2 bottom-[calc(7.25rem+env(safe-area-inset-bottom))] sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-max sm:max-w-[calc(100vw-2rem)] lg:left-[calc(50%+var(--inset)/2)] lg:bottom-6 rounded-xl border tabular-nums grid grid-cols-[auto_1fr_40px] items-center gap-2 p-3 sm:flex sm:flex-wrap sm:items-center sm:gap-2 sm:px-3 sm:py-2 ${
          count > 0 ? "pop-in-up" : "pop-out-up pointer-events-none"
        } ${glass}`}
      >
        {chip}
        <button
          type="button"
          onClick={() => {
            setSheetClosing(false);
            setSheetOpen(true);
          }}
          className={`${BTN_BASE} sm:hidden h-[40px] px-4 text-sm ${primaryBtn(isDark)}`}
        >
          Edit…
        </button>
        <div className={`hidden sm:block w-px h-6 ${isDark ? "bg-white/10" : "bg-gray-200"}`} aria-hidden />
        <div className="hidden sm:contents">
          {fields(false)}
          {applyBtn("")}
        </div>
        <button type="button" onClick={onClear} aria-label="Clear selection" title="Clear selection (Esc)" className={clearBtn}>
          <Icon d={P.close} className="w-4 h-4" />
        </button>
      </div>,
      host
      )}
      {sheetOpen && createPortal(
        <>
          <div
            className={`fixed inset-0 z-[69] bg-black/50 backdrop-blur-[2px] ${sheetClosing ? "fade-out" : "fade-in"}`}
            onClick={closeSheet}
            aria-hidden
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={sheetTitleId}
            tabIndex={-1}
            onAnimationEnd={(e) => {
              if (sheetClosing && e.target === e.currentTarget) finishSheet();
            }}
            className={`fixed inset-x-0 bottom-0 z-[70] rounded-t-2xl border flex flex-col max-h-[72vh] pb-[max(env(safe-area-inset-bottom),12px)] tabular-nums ${
              sheetClosing ? "sheet-out pointer-events-none" : "sheet-in"
            } ${popoverSurface(isDark)}`}
          >
            <div className={`mx-auto mt-2 h-1 w-10 rounded-full shrink-0 ${isDark ? "bg-white/20" : "bg-gray-300"}`} aria-hidden />
            <p id={sheetTitleId} className={`px-4 pt-2 pb-3 text-base font-semibold ${t1}`}>
              Edit {shownCount} {shownCount === 1 ? "transaction" : "transactions"}
            </p>
            <div className="px-4 space-y-2 overflow-y-auto min-h-0">
              {fields(true)}
              <div className="pt-2 space-y-2">
                {applyBtn("w-full")}
                <button type="button" onClick={closeSheet} className={`${BTN_BASE} w-full h-[40px] px-4 text-sm ${ghostBtn(isDark)}`}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

type HistoryLog = Array<{ id: number; field: string; old_value: string | null; new_value: string | null; source: string; changed_at: string }>;
type HistoryReceipts = Array<{ id: number; url: string | null; label: string | null; source?: string }>;
type HistoryEntry = { log: HistoryLog; receipts: HistoryReceipts };

/**
 * Audit trail + receipts for one transaction — loads on demand when the row's
 * detail drawer opens (instantly from `cache` on a re-open). Every
 * categorization/vendor/type change shows as old → new; receipts are
 * URL-referenced documents you can attach or remove.
 */
export function TxnHistoryPanel({
  transactionId,
  isDark,
  cache,
}: {
  transactionId: string;
  isDark: boolean;
  /** Shared across rows by the table so a re-opened panel never re-fetches. */
  cache?: Map<string, HistoryEntry>;
}) {
  const seed = cache?.get(transactionId);
  const [log, setLog] = useState<HistoryLog>(seed?.log ?? []);
  const [receipts, setReceipts] = useState<HistoryReceipts>(seed?.receipts ?? []);
  const [loading, setLoading] = useState(!seed);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const { t1, t2 } = tiers(isDark);

  // `alive` guards a response that lands after the panel moved to another id.
  async function load(id: string, alive: () => boolean = () => true) {
    try {
      const res = await authFetch(`/api/books/data?report=history&transaction_id=${encodeURIComponent(id)}`);
      if (res.ok) {
        const d = await res.json();
        const entry: HistoryEntry = { log: d.log ?? [], receipts: d.receipts ?? [] };
        cache?.set(id, entry);
        if (alive()) {
          setLog(entry.log);
          setReceipts(entry.receipts);
        }
      }
    } finally {
      if (alive()) setLoading(false);
    }
  }
  useEffect(() => {
    let alive = true;
    const hit = cache?.get(transactionId);
    if (hit) {
      setLog(hit.log);
      setReceipts(hit.receipts);
      setLoading(false);
    } else {
      setLoading(true);
      void load(transactionId, () => alive);
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId]);

  async function addReceipt() {
    if (!/^https?:\/\/.{3,}/i.test(url.trim())) return;
    setBusy(true);
    try {
      const res = await authFetch("/api/books/data", {
        method: "POST",
        body: JSON.stringify({ action: "add_receipt", transaction_id: transactionId, url: url.trim() }),
      });
      if (res.ok) { setUrl(""); await load(transactionId); }
    } finally { setBusy(false); }
  }
  async function removeReceipt(id: number) {
    await authFetch("/api/books/data", { method: "POST", body: JSON.stringify({ action: "delete_receipt", id }) });
    await load(transactionId);
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
      if (res.ok) await load(transactionId);
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
  // The touch-sm token, like the editors row above: one height per surface.
  const smallBtn = `${BTN_BASE} shrink-0 h-8 lg:h-7 px-3 text-sm lg:text-xs ${TAP.pill}`;

  return (
    <div className={`mt-5 pt-4 border-t grid gap-x-8 gap-y-4 sm:grid-cols-2 ${ruleBorder(isDark)}`}>
      <div className="min-w-0">
        <span className={`${MICRO} ${t2} block mb-2`}>Receipts & documents</span>
        {receipts.length > 0 ? (
          <ul className="space-y-1 mb-2">
            {receipts.map((r) => (
              <li key={r.id} className="flex items-center gap-2 min-h-[40px] lg:min-h-0 text-xs">
                <a
                  href={r.url ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className={`min-w-0 flex-1 flex items-center min-h-[40px] lg:min-h-0 hover:underline ${isDark ? "text-sky-300" : "text-sky-700"}`}
                >
                  <span className="block truncate">{r.label || r.url}</span>
                </a>
                {r.source && r.source !== "manual" && r.source !== "upload" && (
                  <span className={`shrink-0 text-xs ${t2}`}>{r.source}</span>
                )}
                <button
                  type="button"
                  onClick={() => void removeReceipt(r.id)}
                  aria-label="Remove receipt"
                  className={`w-7 h-7 -mr-1.5 rounded-md inline-flex items-center justify-center shrink-0 cursor-pointer transition-colors ${TAP.box} ${t2} hover:text-red-500`}
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
            // 16px type on phones (the iOS zoom floor) needs the 40px box and
            // is itself the tap target; the buttons beside it are the
            // touch-sm pill (visible h-8, 40px hit) like the editors above.
            className={`flex-1 min-w-0 h-[40px] lg:h-7 px-3 rounded-full text-[16px] lg:text-sm placeholder:text-sm border ${textInput(isDark)}`}
          />
          {/* Field-adjacent actions are ghosts; Add only exists once there is
              a URL to add. Sync now is the only primary fill on the page. */}
          {url.trim() && (
            <button
              type="button"
              onClick={() => void addReceipt()}
              disabled={busy}
              className={`${smallBtn} ${ghostBtn(isDark)}`}
            >
              Add
            </button>
          )}
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f); }} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            title="Upload a file"
            className={`${smallBtn} ${ghostBtn(isDark)}`}
          >
            {busy ? "…" : "Upload"}
          </button>
        </div>
        {uploadErr && <p className="text-xs text-red-500 mt-1.5">{uploadErr}</p>}
      </div>
      <div className="min-w-0">
        <span className={`${MICRO} ${t2} block mb-2`}>History</span>
        {loading ? (
          <p className={`text-sm lg:text-xs ${t2}`}>Loading…</p>
        ) : log.length === 0 ? (
          <p className={`text-sm lg:text-xs ${t2}`}>No manual changes recorded.</p>
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
 * backdrop, Escape, and Cancel all dismiss without acting. Focus lands on the
 * primary and is trapped; Enter acts on whichever button is focused.
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
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const msgId = `${titleId}-m`;
  useFocusTrap(ref, true);
  // Registered once (the callback lives in a ref): an inline `onClose` used
  // to re-hook this listener on every parent render, so a sibling's Escape
  // handler could unhook it mid-dispatch. preventDefault tells lower layers
  // (the batch bar) the key is taken.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const { t1, t2 } = tiers(isDark);
  const btn = `${BTN_BASE} h-[40px] sm:h-9 px-4 text-sm`;
  const primary = tone === "danger" ? "bg-red-600 text-white hover:bg-red-500 active:bg-red-700" : primaryBtn(isDark);
  const ghost = ghostBtn(isDark);

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? msgId : undefined}
        className={`w-full max-w-lg rounded-2xl border p-5 pop-in tabular-nums ${popoverSurface(isDark)}`}
      >
        <h3 id={titleId} className={`text-lg font-semibold tracking-tight ${t1}`}>{title}</h3>
        {message && (
          <div id={msgId} className={`mt-2 text-sm leading-relaxed ${t2}`}>{message}</div>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={`${btn} ${ghost}`}>
            {cancelLabel}
          </button>
          {altLabel && onAlt && (
            <button type="button" onClick={onAlt} className={`${btn} ${outlineBtn(isDark)}`}>
              {altLabel}
            </button>
          )}
          <button type="button" data-autofocus onClick={onConfirm} className={`${btn} ${primary}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * A transient notice for errors that happen off-screen (a row save, a batch
 * apply). Portaled to body, top-centre, gone after 5s or on dismiss.
 */
export function Toast({ message, isDark, onClose }: { message: string; isDark: boolean; onClose: () => void }) {
  const [out, setOut] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    setOut(false);
    if (!message) return;
    const t = window.setTimeout(() => setOut(true), 5000);
    return () => clearTimeout(t);
  }, [message]);
  useEffect(() => {
    if (!out) return;
    const t = window.setTimeout(() => close.current(), 200);
    return () => clearTimeout(t);
  }, [out]);
  if (!message) return null;
  const { t1, t2 } = tiers(isDark);
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      onAnimationEnd={(e) => {
        if (out && e.target === e.currentTarget) close.current();
      }}
      className={`fixed z-[75] top-4 left-1/2 -translate-x-1/2 max-w-[calc(100vw-2rem)] inline-flex items-center gap-2.5 h-9 pl-3.5 pr-1.5 rounded-xl border text-sm tabular-nums ${
        out ? "fade-out pointer-events-none" : "pop-in"
      } ${popoverSurface(isDark)} ${t1}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" aria-hidden />
      <span className="truncate">{message}</span>
      <button
        type="button"
        onClick={() => setOut(true)}
        aria-label="Dismiss"
        className={`w-7 h-7 rounded-md inline-flex items-center justify-center shrink-0 cursor-pointer transition-colors ${TAP.box} ${t2} ${
          isDark ? "hover:bg-white/[0.06] hover:text-white" : "hover:bg-gray-100 hover:text-gray-900"
        }`}
      >
        <Icon d={P.close} className="w-3 h-3" strokeWidth={2} />
      </button>
    </div>,
    document.body
  );
}

// ── TxnTable ─────────────────────────────────────────────────────────────

/**
 * Column widths shared by the live table and its skeleton. Merchant is the
 * only fluid column; the fixed cluster grows a step at xl so a 1440 row reads
 * as one line rather than a left cluster and a right cluster.
 */
const COLS = {
  select: "w-9 pl-3 py-2.5 align-middle",
  // md–lg the pill is the touch size (text-sm): "Other Operating Expenses"
  // measures 182.9 there, so the column is 17rem (190.4 usable); at lg the
  // text-xs pill (161.5) fits the 15rem column.
  category: "w-68 lg:w-60 xl:w-80 hidden md:table-cell",
  entity: "w-14 lg:w-16 xl:w-28",
  type: "w-28 xl:w-40 hidden lg:table-cell",
  date: "w-28 xl:w-36 hidden lg:table-cell",
  amount: "w-36 lg:w-40 xl:w-48",
  balance: "w-32",
  chevron: "w-8 lg:w-9",
};

/**
 * Visible columns: Merchant, Entity, Amount, chevron always; Category from
 * md; Type and Date from lg; the checkbox column only at lg (below it the
 * avatar is the checkbox). Spanning cells must match this count — in a
 * fixed-layout table a larger colSpan conjures phantom columns.
 */
function visibleCols(mdUp: boolean, lgUp: boolean, selection: boolean, balances: boolean): number {
  return 4 + (mdUp ? 1 : 0) + (lgUp ? 2 : 0) + (balances ? 1 : 0) + (selection && lgUp ? 1 : 0);
}

/**
 * The head's bottom rule is painted by the cells themselves (an inset
 * shadow), not by a collapsed border: a collapsed border belongs to the
 * table, so it stayed behind the moment the sticky head left its slot.
 * The dark fill is the card composite (white/3% over the black shell,
 * measured (8,8,8)) so the stuck head matches the rows it covers.
 */
function headSkin(isDark: boolean): string {
  return isDark
    ? "bg-[#080808] [&>th]:shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.08)]"
    : "bg-white [&>th]:shadow-[inset_0_-1px_0_0_#e5e7eb]";
}

/** Everything both renderers derive from a row, computed once per row. */
function rowModel(t: Txn, isDark: boolean) {
  const { t1, t2 } = tiers(isDark);
  const inflow = t.amount < 0;
  const eff = effType(t);
  // Transfers and other own-money movements have no counterparty — the
  // descriptor stands in as the (muted) primary line.
  const vendor = t.merchant_name || (eff === "normal" ? t.name : null);
  const vendorText = displayName(vendor);
  const memo = vendor ? descriptorFor(t.name, vendor, t.entity_name) : memoText(t.name);
  const dim = eff === "transfer" || eff === "intercompany";
  const amtTone = dim ? t2 : inflow ? incomeTone(isDark) : t1;
  const primary = (vendor ? vendorText : memo) || "—";
  return { inflow, eff, vendor, vendorText, memo, dim, amtTone, primary };
}

type DetailPair = { k: string; v: string; mono?: boolean };
type DetailGroup = { title: string; pairs: DetailPair[] };

/** The loaded layout with the ink removed: same table anatomy, shimmer bars for text. */
export function TxnTableSkeleton({ isDark, view, selection }: { isDark: boolean; view: TxnView; selection?: boolean }) {
  const { t2 } = tiers(isDark);
  const bar = (cls: string) => <div className={`shimmer ${cls}`} aria-hidden />;
  const mdUp = useMedia("(min-width: 768px)");
  const lgUp = useMedia("(min-width: 1024px)");
  const cols = visibleCols(mdUp, lgUp, !!selection, false);
  if (view === "cards") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2 sm:gap-3 p-4" aria-busy="true" aria-label="Loading transactions">
        {/* Bands exist only while the grid is one column (phones). */}
        <div className="col-span-full pl-[calc(0.75rem+1px)] pt-2 first:pt-0 -mb-1 sm:hidden">{bar("h-2.5 w-28")}</div>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`rounded-xl border p-3 flex flex-col gap-2.5 ${cardSurface(isDark)}`}>
            <div className="flex items-center gap-3">
              {bar("w-8 h-8 rounded-full!")}
              <div className="flex-1 min-w-0">
                {bar("h-3.5 w-2/3")}
                {bar("mt-1.5 h-2.5 w-1/3")}
              </div>
              {bar("h-3.5 w-16")}
            </div>
            <div className="flex items-center gap-2">
              {bar("h-8 lg:h-7 w-40 rounded-full!")}
              {bar("h-5 w-8 rounded-md!")}
            </div>
          </div>
        ))}
      </div>
    );
  }
  const th = (label: string, cls = "", right = false) => (
    <th scope="col" className={`px-2 py-2.5 font-medium ${right ? "text-right" : ""} ${cls}`}>{label}</th>
  );
  const td = "px-2 py-3";
  return (
    <table className="w-full table-fixed text-sm tabular-nums" aria-busy="true" aria-label="Loading transactions">
      <thead>
        <tr className={`text-left text-xs font-medium ${t2} ${headSkin(isDark)}`}>
          {selection && lgUp && (
            <th scope="col" className={`${COLS.select} font-medium`}>
              <span className="sr-only">Select</span>
            </th>
          )}
          {th("Merchant")}
          {th("Category", COLS.category)}
          {th("Entity", COLS.entity)}
          {th("Type", COLS.type)}
          {th("Date", COLS.date)}
          {th("Amount", COLS.amount, true)}
          <th scope="col" className={`${COLS.chevron} font-medium`}>
            <span className="sr-only">Details</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {/* Bands exist only below lg (the Date column carries the date at lg+). */}
        {!lgUp && (
          <tr>
            <td colSpan={cols} className={`${selection ? "pl-11" : "pl-2"} pr-4 pt-3.5 pb-0.5`}>{bar("h-2.5 w-28 rounded!")}</td>
          </tr>
        )}
        {Array.from({ length: 8 }, (_, i) => (
          <tr key={i} className={i === 0 && lgUp ? "" : `border-t ${hairline(isDark)}`}>
            {selection && lgUp && <td className={`${td} pl-3`}>{bar("w-[16px] h-[16px] rounded-[4px]! invisible")}</td>}
            <td className={td}>
              <div className="flex items-center gap-3">
                {bar("w-6 h-6 rounded-full!")}
                {bar("h-3 w-40")}
                {bar("hidden md:block h-3 w-56 opacity-60")}
              </div>
            </td>
            <td className={`${td} hidden md:table-cell`}>{bar("h-7 w-40 rounded-full!")}</td>
            <td className={td}>{bar("h-5 w-8 rounded-md!")}</td>
            <td className={`${td} hidden lg:table-cell`}>{bar("h-3 w-14")}</td>
            <td className={`${td} hidden lg:table-cell`}>{bar("h-3 w-12")}</td>
            <td className={`${td} text-right`}>{bar("ml-auto h-3 w-20")}</td>
            <td />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The editable transaction ledger: type and category change in place, the
 * chevron opens every field we hold on the transaction, and the vendor name
 * walks to the Vendors page. Renders as a table (list) or a card grid
 * (cards); with no `view` it splits by breakpoint like it always has.
 * Saves paint optimistically; `onRowChange` still fires once with the
 * server's row.
 */
export function TxnTable({
  rows: propRows,
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
  const uid = useId();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingCat, setPendingCat] = useState<{ t: Txn; category: string; match: string } | null>(null);
  // Optimistic paint: a patch per row id, merged over the prop row until the
  // parent's row catches up (or the save fails).
  const [optimistic, setOptimistic] = useState<Map<string, Partial<Txn>>>(() => new Map());
  // Rows waiting on a parent reload (categorize-all) rather than onRowChange.
  const reloadIds = useRef(new Set<string>());
  const historyCache = useRef(new Map<string, HistoryEntry>());
  // Anchor row for shift-click range selection.
  const lastPicked = useRef<number | null>(null);

  const rows = useMemo(
    () => (optimistic.size === 0 ? propRows : propRows.map((r) => {
      const o = optimistic.get(r.transaction_id);
      return o ? { ...r, ...o } : r;
    })),
    [propRows, optimistic]
  );
  // Drop overrides the parent has caught up with (or that a reload settled).
  useEffect(() => {
    setOptimistic((prev) => {
      if (prev.size === 0) return prev;
      let next: Map<string, Partial<Txn>> | null = null;
      for (const [id, patch] of prev) {
        const row = propRows.find((r) => r.transaction_id === id);
        const settled =
          reloadIds.current.has(id) || (!!row && Object.entries(patch).every(([k, v]) => (row as Record<string, unknown>)[k] === v));
        if (settled) {
          (next ??= new Map(prev)).delete(id);
          reloadIds.current.delete(id);
        }
      }
      return next ?? prev;
    });
  }, [propRows]);

  const { t1, t2, t3 } = tiers(isDark);
  const hair = hairline(isDark);
  const rule = ruleBorder(isDark);
  const hover = isDark ? "hover:bg-white/[0.04]" : "hover:bg-gray-50";
  const selectedSkin = isDark
    ? "bg-emerald-500/[0.07] shadow-[inset_2px_0_0_0_#10b981]"
    : "bg-emerald-50 shadow-[inset_2px_0_0_0_#10b981]";
  // The open row holds the hover tint, so it reads as "the one you touched".
  const expandedBg = isDark ? "bg-white/[0.04]" : "bg-gray-50";
  // Type column resting tier (the quiet pill inherits it): t3 for the default
  // word, lifted to t2 while the row is hovered; exceptions rest at t2.
  const typeTone = (eff: string) =>
    eff === "normal"
      ? isDark ? "text-gray-500 group-hover:text-gray-400" : "text-gray-500/80 group-hover:text-gray-500/100"
      : t2;
  // One hit-area token for every 28px gutter control (checkbox, chevron):
  // rounded-md with the quiet fill; the open chevron holds a step more.
  const hitFill = isDark ? "hover:bg-white/[0.06]" : "hover:bg-gray-100";
  const glyphFill = isDark ? `${hitFill} hover:text-white` : `${hitFill} hover:text-gray-900`;
  const glyphOn = isDark ? "bg-white/[0.08] text-gray-100" : "bg-gray-100 text-gray-900";
  // Date bands only make sense while the rows arrive in date order.
  const grouped = !sort || sort.key === "date";
  const smUp = useMedia("(min-width: 640px)");
  const mdUp = useMedia("(min-width: 768px)");
  const lgUp = useMedia("(min-width: 1024px)");
  const cols = visibleCols(mdUp, lgUp, !!selection, !!balances);
  // Cards band by day only while the grid is a single column (phones): from
  // two columns up a band per day leaves half-empty grid rows, so the date
  // moves onto each card's second line and the grid stays dense.
  const cardBands = grouped && !smUp;
  // The table says each date once: below lg (no Date column) the day is a
  // band above its rows; at lg+ the Date column names the day on its first
  // row only and the day change is a perceptible rule (a step above the
  // hairline) on that row's top edge — the blank date cells beneath are the
  // grouping. Group *or* column, never both.
  const tableBands = grouped && !lgUp;
  const dayRules = grouped && lgUp;
  const dayRule = isDark ? "border-white/[0.14]" : "border-gray-300";
  // Below lg the checkbox column is gone (the avatar is the checkbox) and a
  // tap anywhere on the row opens the detail; the chevron stays as the
  // explicit, labelled affordance.
  const avatarSelect = !!selection && !lgUp;

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
    const thCls = `px-2 py-2.5 font-medium ${align === "right" ? "text-right" : ""} ${className}`;
    if (!sortable) return <th key={label} scope="col" className={thCls}>{label}</th>;
    // An arrow, not a chevron: ⌄ belongs to the pickers alone.
    const caret = (
      <Icon
        d={active && sort?.dir === "asc" ? P.up : P.down}
        strokeWidth={2}
        className={`w-3 h-3 shrink-0 transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover/th:opacity-60"}`}
      />
    );
    return (
      <th
        key={label}
        scope="col"
        aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"}
        className={`group/th ${thCls}`}
      >
        <button
          type="button"
          onClick={() => onSort!(sortKey!)}
          // The visible button is 18px tall; below lg the TAP.head
          // pseudo-element grows the tap target to 40px without changing the
          // header's height.
          className={`inline-flex items-center gap-1 h-6 -my-0.5 px-1.5 -mx-1.5 rounded-md cursor-pointer transition-colors ${TAP.head} ${
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

  // `scrollTo` for a card: a column-3 card that re-flows onto its own row
  // when it opens would otherwise vanish below the fold.
  function toggle(id: string, scrollTo = false) {
    const opening = !open.has(id);
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    if (opening && scrollTo) {
      requestAnimationFrame(() => {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        document.querySelector(`[data-txn-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
      });
    }
  }

  async function update(t: Txn, patch: { type_override?: string; book_category?: string; loan_id?: string | null }) {
    const id = t.transaction_id;
    // Paint first; the server's row replaces it through onRowChange.
    setOptimistic((m) => new Map(m).set(id, patch as Partial<Txn>));
    setBusy(id);
    try {
      const saved = await saveTxn({ transaction_id: id, ...patch });
      historyCache.current.delete(id);
      // Keep the live entity overlay — the PATCH returns the stored stamp.
      onRowChange({ ...saved, entity_id: t.entity_id, entity_name: t.entity_name });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't save that change.");
    } finally {
      setBusy(null);
      setOptimistic((m) => {
        if (!m.has(id)) return m;
        const n = new Map(m);
        n.delete(id);
        return n;
      });
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
  const baseCatOptions = useMemo(() => categories.map(accountOption), [categories]);

  async function applyCategoryAll(t: Txn, category: string, match: string) {
    const id = t.transaction_id;
    setOptimistic((m) => new Map(m).set(id, { book_category: category }));
    setBusy(id);
    try {
      const res = await authFetch("/api/books/data", {
        method: "POST",
        body: JSON.stringify({ action: "categorize_vendor", match, book_category: category }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Couldn't apply that everywhere.");
      historyCache.current.clear();
      if (onReload) {
        // The override stays until the reloaded rows arrive.
        reloadIds.current.add(id);
        onReload();
      } else {
        onRowChange({ ...t, book_category: category });
      }
    } catch (err) {
      setOptimistic((m) => {
        const n = new Map(m);
        n.delete(id);
        return n;
      });
      onError(err instanceof Error ? err.message : "Couldn't apply that everywhere.");
    } finally {
      setBusy(null);
    }
  }

  // Pairs whose value would be "—" are left out (Counterparty excepted: an
  // absent counterparty is itself a fact). Enums read in the segment
  // vocabulary, never as API tokens.
  const detail = (t: Txn): DetailGroup[] => {
    const inflow = t.amount < 0;
    const eff = effType(t);
    const detected = t.intercompany ? "Roll-up" : t.txn_type === "transfer" ? "Transfer" : inflow ? "Income" : "Expense";
    const effective = eff === "loan" ? "Loan" : eff === "transfer" ? "Transfer" : eff === "intercompany" ? "Roll-up" : inflow ? "Income" : "Expense";
    const details: DetailPair[] = [];
    if (t.name && (!t.merchant_name || norm(t.merchant_name) !== norm(t.name))) details.push({ k: "Description", v: t.name });
    if (t.merchant_name) details.push({ k: "Merchant", v: t.merchant_name });
    details.push({ k: "Date", v: longDate(t.date) });
    details.push({ k: "Status", v: t.pending ? "Pending" : "Posted" });
    details.push({ k: "Entity", v: t.entity_name ?? "Unmapped" });
    if (t.currency && t.currency !== "USD") details.push({ k: "Amount", v: signedMoney(t.amount, t.currency) });
    const categorization: DetailPair[] = [
      { k: "Account", v: t.book_category ?? "Uncategorized" },
      { k: "Plaid", v: pretty(t.plaid_category) },
    ];
    if (t.plaid_category_detailed) categorization.push({ k: "Plaid detail", v: pretty(t.plaid_category_detailed) });
    if (t.payment_channel) categorization.push({ k: "Payment channel", v: pretty(t.payment_channel) });
    categorization.push({ k: "Type", v: t.type_override && detected !== effective ? `${effective} · detected ${detected}` : effective });
    if (t.intercompany_class) categorization.push({ k: "Roll-up class", v: pretty(t.intercompany_class) });
    const identifiers: DetailPair[] = [
      { k: "Counterparty", v: t.counterparty_account_id ?? "—", mono: true },
      { k: "Account ID", v: t.account_id, mono: true },
      { k: "Connection ID", v: t.item_id, mono: true },
      { k: "Transaction ID", v: t.transaction_id, mono: true },
    ];
    if (t.updated_at) {
      identifiers.push({
        k: "Last synced",
        v: new Date(t.updated_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
      });
    }
    return [
      { title: "Details", pairs: details },
      { title: "Categorization", pairs: categorization },
      { title: "Identifiers", pairs: identifiers },
    ];
  };

  // The checkbox glyph. Mixed (some rows) shares the checked fill with a dash
  // so it reads at full contrast in both themes.
  const box = (on: boolean, mixed = false) => (
    <span
      className={`w-[16px] h-[16px] rounded-[4px] border-[1.5px] shrink-0 inline-flex items-center justify-center transition-colors ${
        on || mixed ? "bg-emerald-500 border-emerald-500" : isDark ? "border-white/35" : "border-gray-500/80"
      }`}
    >
      {on ? (
        <Icon d={P.check} strokeWidth={3} className="w-[11px] h-[11px] text-white" />
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
    t.book_category && !categories.includes(t.book_category) ? [accountOption(t.book_category), ...baseCatOptions] : baseCatOptions;

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
    const { inflow, eff, vendor } = rowModel(t, isDark);
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-4">
        {/* Every in-row editor is the soft pill; the bordered skin belongs to
            toolbar and batch controls only. */}
        {opts.type && <Menu {...typeProps(t, eff, inflow)} isDark={isDark} tone="soft" size="sm" touch label="Type" />}
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
            />
          </div>
        )}
        {opts.loan && loans.length > 0 && <Menu {...loanProps(t)} isDark={isDark} tone="soft" size="sm" touch label="Loan" />}
        {opts.vendorLink && vendor && (
          <button
            type="button"
            onClick={() => navigate(`/books/vendors/detail?name=${encodeURIComponent(vendor)}`)}
            // The soft skin, like the pickers beside it: in-row editors and
            // actions share one surface; the bordered skin is the toolbar's.
            className={`${BTN_BASE} h-8 lg:h-7 px-3 text-sm lg:text-xs ${TAP.pill} ${
              isDark ? "bg-white/[0.06] text-gray-200 hover:bg-white/[0.09]" : "bg-gray-100 text-gray-800 hover:bg-gray-200"
            }`}
          >
            Open vendor →
          </button>
        )}
      </div>
    );
  };

  // The full-detail grid: three titled groups — two columns from sm (the
  // Identifiers group spans both with a four-track dl), three at lg.
  // `loanInline` adds the loan picker to Categorization for the table at lg+
  // (below lg it lives in the editors row instead). Inline key/value rows
  // (key 7rem, value fills) so a group reads as a short ledger; values wrap
  // rather than truncate — this is where the full string lives.
  const renderDetail = (t: Txn, loanInline = false) => (
    <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
      {detail(t).map((g) => {
        const ids = g.title === "Identifiers";
        return (
          <div key={g.title} className={`min-w-0 ${ids ? "sm:col-span-2 lg:col-span-1" : ""}`}>
            <p className={`${MICRO} ${t2} mb-2`}>{g.title}</p>
            <dl className={`grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 items-baseline ${ids ? "sm:grid-cols-[7rem_1fr_7rem_1fr] lg:grid-cols-[7rem_1fr]" : ""}`}>
              {g.pairs.map((p) => (
                <Fragment key={p.k}>
                  <dt className={`text-xs truncate ${t2}`}>{p.k}</dt>
                  {p.mono ? (
                    <dd className={`min-w-0 font-mono text-xs break-all ${t2}`}>{p.v}</dd>
                  ) : (
                    <dd className={`min-w-0 text-sm break-words ${t1}`}>{p.v}</dd>
                  )}
                </Fragment>
              ))}
              {loanInline && g.title === "Categorization" && loans.length > 0 && (
                <>
                  <dt className={`hidden lg:block text-xs self-center ${t2}`}>Loan</dt>
                  <dd className="hidden lg:block min-w-0">
                    <Menu {...loanProps(t)} isDark={isDark} tone="soft" size="sm" label="Loan" />
                  </dd>
                </>
              )}
            </dl>
          </div>
        );
      })}
    </div>
  );

  const expandBtn = (isOpen: boolean, extra: string) =>
    `w-7 h-7 rounded-md inline-flex items-center justify-center cursor-pointer transition-colors ${
      isOpen ? glyphOn : `${t3} ${glyphFill}`
    } ${extra}`;
  // The table's chevron is the page's ⌄; below lg a card's is a › disclosure
  // so it stops being the same glyph as the category picker beside it.
  const expandGlyph = (isOpen: boolean, disclosure = false) => (
    <Icon
      d={disclosure ? P.chevronRight : P.chevron}
      strokeWidth={2}
      className={`w-3 h-3 shrink-0 transition-transform motion-reduce:transition-none ${isOpen ? (disclosure ? "rotate-90" : "rotate-180") : ""}`}
    />
  );
  // Both gutters stay quiet until they matter: revealed on hover, focus, when
  // the row is checked or once any selection exists. Touch layouts always show them.
  const anySelected = (selection?.selected.size ?? 0) > 0;
  const boxReveal = (checked: boolean) =>
    checked || anySelected ? "" : "lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100 transition-opacity";
  const headReveal = anySelected ? "" : "lg:opacity-0 lg:group-hover/head:opacity-100 lg:focus-visible:opacity-100 transition-opacity";
  const chevronReveal = (isOpen: boolean) =>
    isOpen ? "" : "lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100 transition-opacity";
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
  const selectAll = () => selection?.setAll(allSelected ? [] : rows.map((r) => r.transaction_id));
  // The select-all bar appears once a selection exists — until then the
  // grid (or the touch table, which has no checkbox column) is a ledger, not
  // a form. `extra` hides it where the thead carries select-all.
  const selectAllBar = (extra = "") =>
    selection && rows.length > 0 && anySelected ? (
      <div className={`flex items-center justify-between h-[40px] lg:h-9 px-4 border-b ${hair} ${extra}`}>
        <button
          type="button"
          role="checkbox"
          aria-checked={allSelected ? true : someSelected ? "mixed" : false}
          onClick={selectAll}
          className={`h-7 px-1.5 rounded-md inline-flex items-center gap-2 text-xs cursor-pointer transition-colors ${t2} ${hitFill} ${TAP.box}`}
        >
          {box(allSelected, someSelected)}
          {allSelected ? "Deselect all" : "Select all"}
        </button>
        <span role="status" aria-live="polite" className={`text-xs ${t2}`}>{selection.selected.size} selected</span>
      </div>
    ) : null;
  // A tap on the row itself (not on a control inside it) toggles the detail
  // below lg. Portaled children bubble through React, so the DOM check keeps
  // a sheet's backdrop tap from reaching here.
  const rowTap = (e: React.MouseEvent<HTMLTableRowElement>, id: string) => {
    const target = e.target as HTMLElement;
    if (!e.currentTarget.contains(target)) return;
    if (target.closest("button, a, input, select, textarea, [role='listbox']")) return;
    toggle(id);
  };

  return (
   <>
    {/* ── Cards: one card per transaction, grouped by day on phones. One
        column on phones, two on tablets, three on wide screens, four from
        2xl. Nothing scrolls sideways; tapping a card expands the same
        editors, detail grid and history the table's drawer has. ─────────── */}
    {view !== "list" && (
    <div className={`${view === "cards" ? "" : "lg:hidden"} tabular-nums`}>
      {selectAllBar()}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2 sm:gap-3 p-4 fade-in">
        {rows.map((t, ri) => {
          const { inflow, eff, vendor, memo, dim, amtTone, primary } = rowModel(t, isDark);
          const isOpen = open.has(t.transaction_id);
          const isBusy = busy === t.transaction_id;
          const panelId = `${uid}-c${ri}`;
          const newDay = cardBands && (ri === 0 || rows[ri - 1].date !== t.date);
          const checked = selection?.selected.has(t.transaction_id) ?? false;
          const descriptor = vendor ? memo : null;
          // Line 2 only when it says something the card doesn't already:
          // the date (ungrouped), a real memo, or pending.
          const meta = [!cardBands ? midDate(t.date, { omitCurrentYear: true }) : null, descriptor].filter(Boolean).join(" · ");
          const hasMeta = !!meta || t.pending;
          const dot = typeDot(eff, inflow, t.pending, isDark);
          const surface = checked
            ? isDark ? "border-emerald-500/50 bg-emerald-500/[0.07]" : "border-emerald-500 bg-emerald-50"
            : isDark ? "border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.05]" : "border-gray-200 bg-white hover:bg-gray-50";
          const avatar = (
            <VendorAvatar
              name={vendor || t.name || "?"}
              isDark={isDark}
              size="lg"
              tone="neutral"
              icon={vendor ? undefined : typeIcon(eff === "intercompany" ? "intercompany" : "transfer", inflow)}
            />
          );
          return (
            <Fragment key={`m-${t.transaction_id}`}>
              {newDay && (
                <div className={`col-span-full pl-[calc(0.75rem+1px)] pt-2 first:pt-0 -mb-1 text-xs font-medium ${t1}`}>
                  {longDate(t.date, { omitCurrentYear: true })}
                </div>
              )}
              <div
                data-txn-card
                data-txn-id={t.transaction_id}
                aria-busy={isBusy || undefined}
                className={`group relative flex flex-col gap-2.5 rounded-xl border p-3 transition-colors duration-100 ${surface} ${isOpen ? "col-span-full" : ""}`}
              >
                <div className="flex items-center gap-3">
                  {selection ? (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                      onClick={(e) => pickRow(e, t, ri)}
                      aria-label={`Select ${primary}`}
                      title={checked ? "Deselect" : "Select"}
                      className={`w-8 h-8 rounded-full shrink-0 cursor-pointer ${TAP.box}`}
                    >
                      {avatar}
                      <span
                        aria-hidden
                        className={`absolute -right-0.5 -bottom-0.5 w-4 h-4 lg:w-3.5 lg:h-3.5 rounded-full ring-2 flex items-center justify-center transition-[opacity,background-color] ${badgeRing} ${pickBadge(checked)}`}
                      >
                        <Icon d={P.check} strokeWidth={3} className="w-3 h-3 lg:w-2.5 lg:h-2.5" />
                      </span>
                    </button>
                  ) : (
                    avatar
                  )}
                  <button
                    type="button"
                    onClick={() => toggle(t.transaction_id, true)}
                    aria-expanded={isOpen}
                    aria-controls={isOpen ? panelId : undefined}
                    // Two text lines are ~31px, one line ~15px; the TAP token
                    // grows the tap area to ≥40px on touch layouts either way.
                    // The header keeps the same layout open or closed, so
                    // nothing moves when a card expands.
                    className={`flex-1 min-w-0 text-left cursor-pointer ${hasMeta ? TAP.line2 : TAP.line}`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span
                        className={`text-base lg:text-sm leading-5 ${
                          vendor ? "font-medium truncate" : "font-normal line-clamp-2 lg:line-clamp-1 break-words"
                        } ${dim ? t2 : t1}`}
                        title={primary}
                      >
                        {primary}
                      </span>
                      <span className="shrink-0 inline-flex items-center gap-1.5">
                        {dot !== "bg-transparent" && <span aria-hidden className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />}
                        <span className={`text-base lg:text-sm font-semibold tabular-nums leading-5 whitespace-nowrap ${amtTone}`}>
                          {signedMoney(t.amount, t.currency)}
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
                    />
                  </div>
                  {t.entity_name ? (
                    <EntityTag name={t.entity_name} isDark={isDark} size="touch" />
                  ) : (
                    <span className={`shrink-0 text-xs ${amberTone(isDark)}`}>Unmapped</span>
                  )}
                  {/* The whole card body already expands (and is the keyboard
                      stop); the chevron is the quiet secondary affordance.
                      -mr-2 puts the 12px glyph's right edge on the amount's:
                      (w-7 − w-3) / 2 = 5.95px of button padding. */}
                  <button
                    type="button"
                    onClick={() => toggle(t.transaction_id, true)}
                    tabIndex={-1}
                    aria-hidden="true"
                    className={expandBtn(isOpen, `-mr-2 ml-auto shrink-0 ${TAP.box}`)}
                  >
                    {expandGlyph(isOpen, !lgUp)}
                  </button>
                </div>
                {isOpen && (
                  <div id={panelId} className={`mt-0.5 pt-3 border-t fade-in ${rule}`}>
                    {renderEditors(t, { type: true, loan: true, vendorLink: true })}
                    <div className="mt-4">{renderDetail(t)}</div>
                    <TxnHistoryPanel transactionId={t.transaction_id} isDark={isDark} cache={historyCache.current} />
                  </div>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
    )}

    {/* ── List: the ledger table. Rows group under a date band; the merchant
        leads with the descriptor muted beside it; the account is a soft pill
        with a section-tinted disc; transfers drop to the muted tier; the
        amount carries a type dot only where the Type column is hidden.
        Details expand from the trailing chevron. ────────────────────────── */}
    {view !== "cards" && (
    <div className={view === "list" ? "" : "hidden lg:block"}>
    {selectAllBar("lg:hidden")}
    <table aria-label="Transactions" className={`w-full table-fixed text-sm tabular-nums ${view === "list" ? "table" : "hidden lg:table"}`}>
      {/* Opaque (rows scrolling underneath never ghost through); the fill and
          bottom rule live on the cells — see headSkin. */}
      <thead className="sticky top-0 z-10">
        <tr className={`group/head text-left text-xs font-medium ${t2} ${headSkin(isDark)}`}>
          {selection && lgUp && (
            <th scope="col" className={`${COLS.select} font-medium`}>
              <span className="sr-only">Select</span>
              <button
                type="button"
                role="checkbox"
                aria-checked={allSelected ? true : someSelected ? "mixed" : false}
                onClick={selectAll}
                aria-label={allSelected ? "Deselect all" : "Select all"}
                // -my-1 keeps the h-7 button from setting the header's height.
                className={`${hitArea} ${TAP.box} -my-1 align-middle ${headReveal}`}
              >
                {box(allSelected, someSelected)}
              </button>
            </th>
          )}
          {/* Merchant is the only fluid column; every other width is fixed so
              the category pill, tag and numerals sit on the same x at every
              viewport. */}
          {th("Merchant", "vendor")}
          {th("Category", "account", "left", COLS.category)}
          {th("Entity", "entity", "left", COLS.entity)}
          {th("Type", undefined, "left", COLS.type)}
          {th("Date", "date", "left", COLS.date)}
          {th("Amount", "amount", "right", COLS.amount)}
          {balances && th("Balance", undefined, "right", COLS.balance)}
          <th scope="col" className={`${COLS.chevron} font-medium`}>
            <span className="sr-only">Details</span>
          </th>
        </tr>
      </thead>
      <tbody className="fade-in">
        {rows.map((t, ri) => {
          const { inflow, eff, vendor, vendorText, memo, dim, amtTone } = rowModel(t, isDark);
          const isOpen = open.has(t.transaction_id);
          const isBusy = busy === t.transaction_id;
          const panelId = `${uid}-r${ri}`;
          const newDay = grouped && (ri === 0 || rows[ri - 1].date !== t.date);
          const checked = selection?.selected.has(t.transaction_id) ?? false;
          const dot = typeDot(eff, inflow, t.pending, isDark);
          const rowName = vendorText || memo || t.date;
          // Rows draw their TOP border (border-collapse lets the first of two
          // touching borders win, so a day-change rule on a row's top edge
          // would lose to the hairline on the row above's bottom edge). The
          // first row under the head draws none — the head's own rule is there.
          const topRule = dayRules && newDay && ri > 0 ? dayRule : hair;
          const topBorder = ri === 0 && !tableBands ? "" : `border-t ${topRule}`;
          const avatar = (
            <VendorAvatar
              name={vendor || t.name || "?"}
              isDark={isDark}
              size="sm"
              tone="neutral"
              icon={vendor ? undefined : typeIcon(eff === "intercompany" ? "intercompany" : "transfer", inflow)}
            />
          );
          return (
            <Fragment key={t.transaction_id}>
              {tableBands && newDay && (
                <tr>
                  {/* Bands are section titles: they share the avatar's left
                      edge (checkbox column w-9 + cell px-2 = 2.75rem) and sit
                      closer to the group beneath than the one above. */}
                  <th
                    scope="rowgroup"
                    colSpan={cols}
                    className={`${selection ? "pl-11" : "pl-2"} pr-4 ${ri === 0 ? "pt-3.5" : "pt-6"} pb-0.5 text-xs font-medium text-left tabular-nums ${t1}`}
                  >
                    {longDate(t.date, { omitCurrentYear: true })}
                  </th>
                </tr>
              )}
              <tr
                aria-busy={isBusy || undefined}
                onClick={lgUp ? undefined : (e) => rowTap(e, t.transaction_id)}
                // A checked row keeps its tint under the pointer: the hover
                // fill only exists on unchecked rows (a `hover:` utility
                // outranks a bare one in both themes, so the two must never
                // sit on the same row).
                className={`group transition-[color,background-color,box-shadow] duration-100 max-lg:cursor-pointer ${topBorder} ${checked ? selectedSkin : hover} ${
                  isOpen ? expandedBg : ""
                }`}
              >
                {selection && lgUp && (
                  <td className="pl-3 align-middle">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                      onClick={(e) => pickRow(e, t, ri)}
                      aria-label={`Select ${rowName}`}
                      className={`${hitArea} ${TAP.box} align-middle ${boxReveal(checked)}`}
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
                    {avatarSelect ? (
                      // Below lg the avatar is the checkbox, as on a card
                      // face: no resting box in every row, and the merchant
                      // keeps the width.
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                        onClick={(e) => pickRow(e, t, ri)}
                        aria-label={`Select ${rowName}`}
                        title={checked ? "Deselect" : "Select"}
                        className={`w-6 h-6 rounded-full shrink-0 cursor-pointer ${TAP.avatar}`}
                      >
                        {avatar}
                        <span
                          aria-hidden
                          className={`absolute -right-1 -bottom-1 w-3.5 h-3.5 rounded-full ring-2 flex items-center justify-center transition-[opacity,background-color] ${badgeRing} ${pickBadge(checked)}`}
                        >
                          <Icon d={P.check} strokeWidth={3} className="w-2.5 h-2.5" />
                        </span>
                      </button>
                    ) : (
                      avatar
                    )}
                    {/* flex-1 gives this box a definite width, so the vendor's
                        percentage cap is half the column, not half itself. */}
                    <div className="flex-1 min-w-0 flex items-baseline gap-2 leading-5">
                      {vendor && lgUp ? (
                        <button
                          type="button"
                          onClick={() => navigate(`/books/vendors/detail?name=${encodeURIComponent(vendor)}`)}
                          title={`Open ${vendorText}`}
                          className={`text-sm font-medium min-w-0 md:shrink-0 max-w-[240px] xl:max-w-[50%] text-left cursor-pointer hover:underline ${dim ? t2 : t1}`}
                        >
                          <span className="block truncate">{vendorText}</span>
                        </button>
                      ) : vendor ? (
                        // Below lg the row is the tap target and it expands;
                        // the name is plain text so a tap on it does the same
                        // thing as a tap beside it. "Open vendor →" in the
                        // expanded editors is the way to leave.
                        <span className={`text-sm font-medium truncate min-w-0 md:shrink-0 max-w-[240px] ${dim ? t2 : t1}`} title={vendorText}>
                          {vendorText}
                        </span>
                      ) : (
                        <span className={`text-sm font-normal truncate min-w-0 ${t2}`} title={t.name ?? undefined}>
                          {memo || "—"}
                        </span>
                      )}
                      {/* No Date column below lg: when the rows aren't in
                          date order (no bands either) the date rides here. */}
                      {!grouped && (
                        <span className={`lg:hidden text-sm shrink-0 ${t2}`}>{midDate(t.date, { omitCurrentYear: true })}</span>
                      )}
                      {t.pending && <span className={`text-xs font-medium shrink-0 ${amberTone(isDark)}`}>Pending</span>}
                      {vendor && memo && (
                        <span className={`hidden md:block text-sm truncate min-w-0 max-w-[36ch] xl:max-w-none shrink-[4] ${t2}`} title={t.name ?? memo}>
                          {memo}
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className={`${cell} hidden md:table-cell`}>
                  {/* `touch`: the list is a real tablet mode, so below lg the
                      pill is h-8 with the 40px hit box like every other
                      in-row control; at lg it is the h-7 pill it always was. */}
                  <div className="min-w-0 [&>button]:max-w-full">
                    <Menu
                      {...categoryProps(t)}
                      isDark={isDark}
                      tone="soft"
                      size="sm"
                      touch
                      chevron="hover"
                      label="Account"
                      leading={<AccountDisc label={t.book_category ?? ""} isDark={isDark} />}
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
                {/* The default word (Income / Expense) rests a tier below the
                    exceptions so the column recedes and only Transfer /
                    Roll-up / Loan read; hovering the row lifts it to t2 with
                    the chevron. (A readable word at t3 is a deliberate
                    deviation from the tier rule: it repeats on every row and
                    the detail panel states the type in full.) */}
                <td className={`${cell} hidden lg:table-cell transition-colors duration-100 ${typeTone(eff)}`}>
                  <Menu {...typeProps(t, eff, inflow)} isDark={isDark} quiet size="sm" chevron="hover" label="Type" />
                </td>
                {/* Said once per day while the rows are in date order. */}
                <td className={`${cell} hidden lg:table-cell text-sm whitespace-nowrap ${t2}`} title={t.date}>
                  {newDay || !grouped ? midDate(t.date, { omitCurrentYear: true }) : ""}
                </td>
                <td className={`${cell} text-right whitespace-nowrap`}>
                  <span className="inline-flex items-center gap-1.5">
                    {/* The Type column carries the word at lg+; the dot only
                        speaks where that column is hidden. */}
                    {dot !== "bg-transparent" && <span aria-hidden className={`w-1.5 h-1.5 rounded-full shrink-0 lg:hidden ${dot}`} />}
                    <span className={`text-sm font-semibold tabular-nums ${amtTone}`}>{signedMoney(t.amount, t.currency)}</span>
                  </span>
                </td>
                {balances && (
                  <td className={`${cell} text-right whitespace-nowrap text-sm font-medium tabular-nums ${t1}`}>
                    {money(balances[t.transaction_id] ?? 0, t.currency ?? "USD")}
                  </td>
                )}
                {/* Hidden at rest on lg+ like the checkbox, so the two gutters
                    mirror each other; always visible on touch layouts. */}
                <td className="pr-2 text-right align-middle">
                  <button
                    type="button"
                    onClick={() => toggle(t.transaction_id)}
                    aria-expanded={isOpen}
                    aria-controls={isOpen ? panelId : undefined}
                    aria-label={`Details for ${rowName}`}
                    className={expandBtn(isOpen, `${TAP.box} ${chevronReveal(isOpen)}`)}
                  >
                    {expandGlyph(isOpen)}
                  </button>
                </td>
              </tr>
              {isOpen && (
                <tr id={panelId} className={`border-t ${hair} ${expandedBg}`}>
                  {/* The panel obeys the row's two gutters: with selection it
                      spans avatar → numerals (pl-11 / pr-11), without (embeds)
                      the cell inset on both sides. Title x = avatar x. */}
                  <td colSpan={cols} className={`${selection ? "pl-11 pr-11" : "pl-2 pr-2"} py-4`}>
                    <div className="fade-in">
                      {/* Below lg the Type/Category columns are hidden, so the
                          editors reappear here. */}
                      <div className="lg:hidden mb-4">
                        {renderEditors(t, { type: true, category: true, categoryClass: "md:hidden", loan: true, vendorLink: true })}
                      </div>
                      {renderDetail(t, true)}
                      <TxnHistoryPanel transactionId={t.transaction_id} isDark={isDark} cache={historyCache.current} />
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
    </div>
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
