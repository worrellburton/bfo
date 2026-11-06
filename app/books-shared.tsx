/**
 * Books' shared parts, on the design system (docs/DESIGN.md): the ledger
 * (TxnTable, as a table on desktop and a list on phones), the row detail
 * with its history and receipts, the categorize dialog, the batch editor,
 * the Books picker (Menu), and the name, money and date helpers every Books
 * page uses. The reports pages use these too, so the exports stay stable.
 *
 * Every change that reaches more than one row says what it will touch
 * first (a preview from /api/books/ledger) and offers Undo after.
 */

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { authFetch } from "./auth";
import {
  Banner,
  Button,
  Checkbox,
  ChoiceTiles,
  ConfirmView,
  Dialog,
  Disclosure,
  Icon,
  IconButton,
  Input,
  ListboxPanel,
  Sheet,
  Skeleton,
  Spinner,
  Tooltip,
  confirm,
  cx,
  format,
  toast,
  useListbox,
  usePhone,
  type ConfirmOptions,
} from "./ui";
import { useMedia as uiUseMedia } from "./ui/media";

export {
  BTN_BASE,
  MICRO,
  PATHS,
  TAG_PILL,
  TAP,
  amberTone,
  cardSurface,
  entityTagClass,
  ghostBtn,
  hairline,
  incomeTone,
  outlineBtn,
  popoverSurface,
  primaryBtn,
  ruleBorder,
  textInput,
  tiers,
} from "./books-legacy";
export { Icon } from "./books-legacy";

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
  /** A person's note beside the bank's description (never written over it). */
  memo?: string | null;
  import_id?: string | null;
};

/** Which density TxnTable renders. Kept for callers; the table chooses by width now. */
export type TxnView = "list" | "cards";

// ── Numbers and dates (through app/ui/format, DESIGN.md §10) ──────────────

/** Cents with a true minus: "$1,250.00", "−$84.00". */
export function money(n: number, currency = "USD"): string {
  return format.money(n, { currency });
}

/** A Plaid-signed amount as the ledger reads it: money in "+$3,015.70", money out "−$125.00". */
export function ledgerMoney(amount: number, currency?: string | null): string {
  return format.money(-amount, { sign: "always", currency: currency ?? "USD" });
}

/** "Nov 6" this year, "Nov 6, 2025" otherwise. No ordinals. */
export function shortDate(iso: string): string {
  return format.date(iso, "short");
}

/** "Sep 9, 2026", or "Sep 9" this year with omitCurrentYear. */
export function midDate(iso: string, opts?: { omitCurrentYear?: boolean }): string {
  return format.date(iso, opts?.omitCurrentYear ? "short" : "medium");
}

/** "Jul 30 – Sep 9, 2026". */
export function dateRange(first: string, last: string): string {
  return format.dateRange(first, last);
}

/** True while the viewport matches `query`. */
export function useMedia(query: string): boolean {
  return uiUseMedia(query);
}

// ── Names: bank memos made readable (DESIGN.md §8.9) ──────────────────────

const KEEP_CAPS = new Set(["LLC", "INC", "LTD", "LP", "LLP", "PLC", "ACH", "ATM", "IRS", "DBA", "POS", "EFT", "USA", "ID", "PPD", "CCD", "WEB", "TEL"]);
const SMALL_WORDS = new Set(["to", "from", "of", "on", "and", "the", "for", "at", "in", "by", "via", "a", "an", "or", "with"]);

/** A memo or vendor string as it should read on screen: shouting title-cased, processor prefixes and the trailing "Merchant name: …" dropped. */
export function displayName(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = raw
    .replace(/;?\s*Merchant name:\s*[^;]*$/i, "")
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
      if (shouting && i > 0 && bare === bare.toUpperCase() && SMALL_WORDS.has(bare.toLowerCase())) return tok.toLowerCase();
      if (bare.length < 2 || bare !== bare.toUpperCase()) return tok;
      if (bare.length <= 4 && KEEP_CAPS.has(bare)) return tok;
      if (!shouting && bare.length <= 3) return tok;
      const lower = tok.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(bare.toLowerCase())) return lower;
      return lower.replace(/(^|[,;:/-])([^a-z]*)([a-z])/g, (_, p: string, q: string, c: string) => p + q + c.toUpperCase());
    })
    .join("");
}

const LEAD_WORDS = new Set(["ref", "ref#", "id", "no", "no.", "number", "card", "trn", "srf", "rfb", "fed", "on", "#", ":", "-"]);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const core = (tok: string) => tok.replace(/^[^A-Za-z0-9#]+|[^A-Za-z0-9.+]+$/g, "");
const isIdToken = (tok: string) => {
  const c = core(tok);
  if (!c) return false;
  if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(c)) return true;
  if (/^[A-Z]{1,3}-[A-Z0-9]{5,}$/.test(c)) return true;
  if (/^#[A-Z0-9]{4,}$/i.test(c)) return true;
  if (/^[A-Z]{2,4}#$/i.test(tok)) return true;
  if (tok.length >= 5 && /^\W*\d+\W*$/.test(tok)) return true;
  if (/^x{3,}\d+$/i.test(c)) return true;
  const digits = c.replace(/\D/g, "").length;
  return c.length >= 5 && digits >= 2;
};
const isJunkToken = (tok: string) => {
  const c = core(tok).replace(/[^A-Za-z]/g, "");
  return c.length < 2 || KEEP_CAPS.has(c.toUpperCase()) || SMALL_WORDS.has(c.toLowerCase());
};

/** A memo stripped of what only the bank cares about: references, masks, dates, run-on repeats. */
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
  while (out.length > 1 && (/^[^A-Za-z0-9]+$/.test(out[out.length - 1]) || leadish(out[out.length - 1]) || SMALL_WORDS.has(core(out[out.length - 1]).toLowerCase()))) out.pop();
  return out
    .join(" ")
    .replace(/\s+([,;:])/g, "$1")
    .trim();
}

/** Mercury IO card payments read as the direction of the payment. */
function cardPaymentMemo(name: string | null): string | null {
  const m = /^io (auto)?pay(?:ment)?;\s*merchant name:\s*(.+)$/i.exec((name ?? "").trim());
  if (!m) return null;
  const kind = m[1] ? "Autopay" : "Payment";
  const other = m[2].trim();
  if (/\bcredit\b/i.test(other)) return `${kind} to IO card`;
  return `${kind} from ${other.replace(/^mercury\s*[-–]?\s*/i, "")}`;
}

/** A vendor-less memo as a row's title. */
export function memoText(name: string | null): string {
  return cardPaymentMemo(name) ?? (tidyMemo(displayName(name)) || displayName(name));
}

/** The muted line beside a vendor, or null when it would only repeat the vendor or the entity. */
export function descriptorFor(name: string | null, vendor: string | null, entity?: string | null): string | null {
  const card = cardPaymentMemo(name);
  if (card) return card;
  let d = tidyMemo(displayName(name));
  if (!d) return null;
  if (vendor) {
    const v = displayName(vendor);
    if (norm(d) === norm(v) || norm(v).startsWith(norm(d))) return null;
    const vt = v.split(/\s+/).map(norm).filter(Boolean);
    const dt = d.split(/\s+/);
    let k = 0;
    while (k < vt.length && k < dt.length && norm(dt[k]) && vt[k].startsWith(norm(dt[k]))) k++;
    if (k === vt.length || (k >= 1 && dt.slice(k).every(isJunkToken))) d = dt.slice(k).join(" ");
    else if (k === 0 && dt.length > 0 && vt.length > 0 && vt[0] === norm(dt[0])) d = dt.slice(1).join(" ");
    d = d.replace(/^[^A-Za-z0-9]+/, "").trim();
  }
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
    if (dt.length - end >= 2)
      d = dt
        .slice(0, end)
        .join(" ")
        .replace(/[,;:]+$/, "");
  }
  const dt = d.split(/\s+/).filter(Boolean);
  if (d.replace(/[^A-Za-z]/g, "").length < 3 || dt.every(isJunkToken)) return null;
  return d.charAt(0).toUpperCase() + d.slice(1);
}

// ── Entities: a short code, neutral (identity takes no colour, §2.4) ──────

const TAG_STOP = new Set(["llc", "trust", "the", "of", "and", "co", "inc", "lp", "ltd", "corp", "company", "on", "at", "pllc"]);
const normTagKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Initials set on the Entities page, cached so tags render right on first paint.
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
    // a cache only
  }
}

export async function hydrateEntityTags(): Promise<void> {
  try {
    const { db, authReady } = await import("./store");
    await authReady;
    const { ref, get } = await import("./store");
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

/** A stable short code for an entity: its set initials, else the first letters of its words. */
export function entityTag(name?: string | null): string {
  if (!name) return "—";
  const key = normTagKey(name);
  if (CUSTOM_TAGS[key]) return CUSTOM_TAGS[key];
  const words = key.split(" ").filter((w) => w && !TAG_STOP.has(w));
  const base = words.length ? words : key.split(" ");
  let code = base
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  if (code.length < 3) code = ((base[0] || key).toUpperCase().replace(/[^A-Z]/g, "") + code).slice(0, 3);
  return code.slice(0, 3) || "—";
}

/** An entity's legal name without the notes some names carry ("Name (100%)"). */
export function entityLabel(name: string | null | undefined): string {
  return (name ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** Kept for callers; tags are neutral now, so the order no longer matters. */
export function setEntityHueOrder(_names: string[]): void {}

/** The entity's short code as a neutral tag, with the full name on hover and for screen readers. */
export function EntityTag({ name, tooltip = true, srName = true }: { name: string; isDark?: boolean; tooltip?: boolean; size?: "sm" | "touch"; srName?: boolean }) {
  const tag = (
    <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-sunken px-2 text-caption font-medium text-ink-2 tabular-nums">
      {entityTag(name)}
      {srName && <span className="sr-only"> {entityLabel(name)}</span>}
    </span>
  );
  return tooltip ? <Tooltip label={entityLabel(name)}>{tag}</Tooltip> : tag;
}

// ── Accounts and types ─────────────────────────────────────────────────────

/** "6100 Professional Fees" → "Professional Fees": one account name everywhere, the code a quiet hint. */
export function accountShort(label: string | null | undefined): string {
  return (label ?? "").replace(/^\d{4}\s+/, "");
}

export function pretty(cat: string | null): string {
  if (!cat) return "Uncategorized";
  const s = cat.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Statement group for a chart account label, for grouped pickers. */
export function accountGroup(label: string): string {
  const c = label.trim()[0];
  if (c === "4") return "Income";
  if (c === "6") return "Operating expenses";
  if (c === "7") return "Other income and expense";
  if (c === "9") return "Transfers and balance sheet";
  return "Other";
}

/** Kept for callers: grouped account lists carry no per-row icons (the group says the section). */
export function accountIcon(_label: string): ReactNode {
  return null;
}

/** Kept for callers: type options carry no icons. */
export function typeIcon(_value: string, _inflow: boolean): ReactNode {
  return null;
}

/** A chart account as a picker option: the name, the code as a quiet hint, its statement group. */
export function accountOption(c: string): Option {
  const code = /^\d{4}/.exec(c)?.[0];
  return { value: c, label: accountShort(c) || c, hint: code, short: accountShort(c) || c, group: accountGroup(c) };
}

/** The word for a row's type: what the amount and its account already imply, said only when it isn't income or expense. */
export function typeWord(eff: string): string | null {
  if (eff === "transfer") return "Transfer";
  if (eff === "intercompany") return "Intercompany";
  if (eff === "loan") return "Loan";
  return null;
}

export function effType(t: Pick<Txn, "loan_id" | "type_override" | "intercompany" | "txn_type">): "normal" | "transfer" | "intercompany" | "loan" {
  if (t.loan_id) return "loan";
  if (t.type_override === "normal" || t.type_override === "transfer" || t.type_override === "intercompany") return t.type_override;
  if (t.intercompany) return "intercompany";
  return t.txn_type === "transfer" ? "transfer" : "normal";
}

/** The account's section against the sign: a word when money out is filed to income, or money in to an expense. */
export function signNote(category: string | null | undefined, moneyIn: boolean): string | null {
  const code = String(category ?? "").trim()[0];
  if (code === "4" && !moneyIn) return "Money out filed to an income account. Right for a refund of income; otherwise choose an expense.";
  if ((code === "6" || code === "7") && moneyIn) return "Money in filed to an expense account. Right for a refund; otherwise choose an income account.";
  return null;
}

export const TYPE_OPTIONS: Option[] = [
  { value: "normal", label: "Income or expense" },
  { value: "transfer", label: "Transfer between own accounts" },
  { value: "intercompany", label: "Intercompany" },
];

// ── Focus trap (kept for callers outside Books; Books uses app/ui overlays) ─

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const TRAPS: HTMLElement[] = [];

export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean, opts?: { initial?: "first" | "container" }): void {
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
    const list = () => [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    const target = initial === "container" ? root : (root.querySelector<HTMLElement>("[data-autofocus]") ?? list()[0] ?? root);
    target.focus({ preventScroll: true });
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Tab" || TRAPS[TRAPS.length - 1] !== root) return;
      const items = list();
      if (!items.length) {
        e.preventDefault();
        root!.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const cur = document.activeElement;
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

// ── The Books picker ───────────────────────────────────────────────────────

export type Option = { value: string; label: string; hint?: string; icon?: ReactNode; group?: string; short?: string; disabled?: boolean };

/**
 * A picker that names its value ("Entity: All entities") and opens the
 * system's list (app/ui ListboxPanel: anchored on desktop with search past
 * ten options, a sheet on touch). `tone`: "neutral" is a field-like trigger
 * for toolbars and forms; "soft" a quiet in-row trigger that shows a hover
 * fill; "amber" marks a value that needs a decision.
 */
export function Menu({
  value,
  options,
  disabled,
  onChange,
  tone = "neutral",
  size = "sm",
  quiet = false,
  placeholder,
  leading,
  label,
  chevron = "always",
  readOnly = false,
  className,
  footnote,
}: {
  value: string;
  options: Option[];
  /** Kept for callers; the picker follows the theme by itself. */
  isDark?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  onChange: (v: string) => void;
  tone?: "neutral" | "amber" | "soft";
  leading?: ReactNode;
  size?: "sm" | "md";
  quiet?: boolean;
  placeholder?: string;
  /** The list's title on touch, and the trigger's name ("Account"). */
  label?: string;
  chevron?: "always" | "hover";
  /** Kept for callers; sizes come from the tokens. */
  touch?: boolean;
  className?: string;
  footnote?: ReactNode;
}) {
  const shell = useListbox();
  const current = options.find((o) => o.value === value);
  const text = current?.short ?? current?.label ?? placeholder ?? "Choose…";
  const empty = !current;
  const inRow = tone !== "neutral" || quiet;
  return (
    <>
      <button
        ref={shell.triggerRef}
        type="button"
        disabled={disabled || readOnly}
        onClick={() => shell.setOpen(!shell.open)}
        onKeyDown={(e) => {
          if (!shell.open && !disabled && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            shell.setOpen(true);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={shell.open}
        aria-controls={shell.open ? shell.listId : undefined}
        aria-label={label ? `${label}: ${text}` : undefined}
        title={text.length > 24 ? text : undefined}
        className={cx(
          "group/menu inline-flex max-w-full min-w-0 items-center gap-2 text-left whitespace-nowrap",
          inRow ? "-mx-2 h-8 rounded-control px-2 text-body touch:h-11" : cx("rounded-control border bg-field px-3 text-small", size === "md" ? "h-(--control-md)" : "h-(--control-sm)"),
          readOnly ? "cursor-default" : disabled ? "cursor-not-allowed" : "cursor-pointer",
          !inRow && (disabled && !readOnly ? "border-line bg-selected text-ink-disabled" : "border-edge text-ink"),
          inRow && !readOnly && !disabled && "hover:bg-hover aria-expanded:bg-selected",
          inRow && (tone === "amber" || (empty && placeholder) ? "text-warning" : "text-ink"),
          !inRow && empty && "text-ink-3",
          className,
        )}
      >
        {leading}
        <span className="min-w-0 truncate">{text}</span>
        {!readOnly && (
          <Icon
            name="chevronDown"
            size={16}
            className={cx("shrink-0 text-ink-3", !inRow && "ml-auto", chevron === "hover" && !shell.open && "opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-hover/menu:opacity-100 [@media(hover:hover)]:group-focus-visible/menu:opacity-100")}
          />
        )}
      </button>
      <ListboxPanel
        shell={shell}
        label={label ?? "Options"}
        options={options.map((o) => ({ value: o.value, label: o.label, hint: o.hint, group: o.group, short: o.short, disabled: o.disabled }))}
        isChosen={(v) => v === value}
        footnote={footnote}
        onPick={(o) => {
          shell.setOpen(false);
          if (o.value !== value) onChange(o.value);
        }}
      />
    </>
  );
}

// ── Confirm, notes and Undo ────────────────────────────────────────────────

/**
 * An in-app confirm for Books' callers, drawn by the system's confirm. A
 * danger confirm starts on Cancel, so Enter never deletes.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  altLabel,
  tone = "default",
  onConfirm,
  onAlt,
  onClose,
  object,
  details,
  irreversible,
  focus,
}: {
  isDark?: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  altLabel?: string;
  tone?: "default" | "danger" | "commit";
  onConfirm: () => void;
  onAlt?: () => void;
  onClose: () => void;
  object?: ConfirmOptions["object"];
  details?: ReactNode[];
  irreversible?: boolean;
  focus?: "cancel" | "confirm";
}) {
  return (
    <ConfirmView
      open
      options={{
        title,
        message,
        confirmLabel,
        cancelLabel,
        tone,
        object,
        details,
        irreversible,
        focus: focus ?? (tone === "danger" || altLabel ? "cancel" : undefined),
        alternative: altLabel && onAlt ? { label: altLabel, value: "alt" } : undefined,
      }}
      onResult={(r) => {
        if (r === false) onClose();
        else if (typeof r === "object" && r.alternative) onAlt?.();
        else onConfirm();
      }}
    />
  );
}

/** Kept for callers outside Books: shows `message` as the system's toast, once. */
export function Toast({ message, onClose }: { message: string; isDark?: boolean; onClose: () => void }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!message) return;
    toast({ message });
    close.current();
  }, [message]);
  return null;
}

export type UndoList = Array<{ transaction_id: string; values: Record<string, unknown> }>;

/** Put back the values a bulk change replaced (POST /api/books/ledger restore_values). */
export async function undoChange(undo: UndoList): Promise<boolean> {
  if (!undo.length) return true;
  const res = await authFetch("/api/books/ledger", { method: "POST", body: JSON.stringify({ action: "restore_values", changes: undo }) });
  return res.ok;
}

/** "Refiled 48 transactions" with Undo, when the change can be taken back. */
export function changedToast(message: string, undo: UndoList | undefined, after: () => void) {
  toast({
    message,
    action:
      undo && undo.length
        ? {
            label: "Undo",
            run: () =>
              void undoChange(undo).then((ok) => {
                toast({ message: ok ? "Put back as it was" : "Couldn’t undo that. Change the rows back by hand." });
                after();
              }),
          }
        : undefined,
  });
}

/** A count with its noun: "1 transaction", "48 transactions". */
export const txnCount = (n: number) => format.count(n, "transaction", "transactions", { zero: "numeral" });

// ── Preview: what a rule text reaches, before anything changes ─────────────

export type Preview = {
  count: number;
  net: number;
  money_in: number;
  money_out: number;
  first: string | null;
  last: string | null;
  entities: string[];
  edited: number;
  locked: number;
  prior_years: number;
  sample: Array<{ transaction_id: string; date: string; amount: number; name?: string | null; merchant_name?: string | null; entity_name?: string | null }>;
};
export type PreviewReply = { preview: Preview; overlaps: Array<{ id: string; match: string; effect: string }>; rule: { id: string; match: string; effect: string; book_category: string | null } | null };

/** GET /api/books/ledger?report=preview. Null when it can't be read (the dialog then says so). */
export async function fetchPreview(match: string, kind: "vendor" | "contains"): Promise<PreviewReply | null> {
  try {
    const res = await authFetch(`/api/books/ledger?report=preview&match=${encodeURIComponent(match)}&match_kind=${kind}`);
    if (!res.ok) return null;
    return (await res.json()) as PreviewReply;
  } catch {
    return null;
  }
}

/** The facts a bulk-change dialog states: count, span, entities, money. */
export function previewFacts(p: Preview): string[] {
  const facts: string[] = [];
  if (p.first && p.last) facts.push(`${dateRange(p.first, p.last)}${p.prior_years ? ` (${txnCount(p.prior_years)} from earlier years)` : ""}`);
  if (p.entities.length) facts.push(p.entities.map(entityLabel).join(", "));
  if (p.money_out) facts.push(`${format.money(p.money_out)} out`);
  if (p.money_in) facts.push(`${format.money(p.money_in)} in`);
  return facts;
}

// ── The categorize dialog ──────────────────────────────────────────────────

type Scope = "one" | "all" | "future";

/**
 * Choosing a row's account asks how far it reaches: this transaction only
 * (the default, and where focus starts), every transaction from this payee
 * and new ones, or new ones only. The broad choice states its count, span,
 * entities and money first; rows in a closed period never change, and rows
 * changed by hand are left alone unless the person says otherwise.
 */
function CategorizeDialog({
  txn,
  category,
  loanName,
  onClose,
  onDone,
  onError,
}: {
  txn: Txn;
  category: string;
  loanName: string | null;
  onClose: () => void;
  onDone: (result: { scope: Scope; applied: number; undo?: UndoList; row?: Txn }) => void;
  onError: (message: string) => void;
}) {
  const vendor = (txn.merchant_name || "").trim();
  const match = vendor || (txn.name ?? "").trim();
  const kind: "vendor" | "contains" = vendor ? "vendor" : "contains";
  const shown = displayName(vendor || memoText(txn.name)) || "this payee";
  const [scope, setScope] = useState<Scope>("one");
  const [preview, setPreview] = useState<PreviewReply | null | "loading">("loading");
  const [skipEdited, setSkipEdited] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!match || loanName) {
      setPreview(null);
      return;
    }
    let alive = true;
    void fetchPreview(match, kind).then((p) => alive && setPreview(p));
    return () => {
      alive = false;
    };
  }, [match, kind, loanName]);
  const p = preview && preview !== "loading" ? preview.preview : null;
  const n = p ? p.count - (skipEdited ? p.edited : 0) : null;
  const short = accountShort(category);
  const warn = signNote(category, txn.amount < 0);

  async function run() {
    setBusy(true);
    setErr("");
    try {
      if (scope === "one") {
        const res = await authFetch("/api/books/data", { method: "POST", body: JSON.stringify({ transaction_id: txn.transaction_id, book_category: category, ...(txn.loan_id ? { loan_id: null } : {}) }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.message || "Couldn’t save that change.");
        onDone({ scope, applied: 1, undo: data.undo, row: data.transaction });
      } else {
        const res = await authFetch("/api/books/data", {
          method: "POST",
          body: JSON.stringify({ action: "categorize_vendor", match, match_kind: kind, book_category: category, skip_edited: skipEdited, apply: scope === "all" }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.message || "Couldn’t apply that.");
        onDone({ scope, applied: Number(data.applied ?? 0), undo: data.undo });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Couldn’t save that.";
      setErr(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  }

  const allTitle = n === null ? `Every “${shown}” transaction, and new ones` : `All ${txnCount(n)} from “${shown}”, and new ones`;
  const options: { value: Scope; title: string; description?: string }[] = [
    { value: "one", title: "Only this transaction", description: txn.loan_id && loanName ? `It comes off the loan ${loanName}.` : undefined },
    ...(match && !loanName
      ? [
          { value: "all" as const, title: allTitle, description: p ? previewFacts(p).join(" · ") : preview === "loading" ? "Counting…" : "The count isn’t available right now." },
          { value: "future" as const, title: `New “${shown}” transactions only`, description: "Nothing already in the books changes." },
        ]
      : []),
  ];
  const label = scope === "one" ? `File under ${short}` : scope === "future" ? "Save the rule" : n === null ? "File them all" : `File ${txnCount(n)}`;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`File under ${short}?`}
      description={`${displayName(vendor) || memoText(txn.name)} · ${ledgerMoney(txn.amount, txn.currency)} · ${midDate(txn.date)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} busyLabel="Saving…" disabled={scope === "all" && n === 0} onClick={() => void run()}>
            {label}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {warn && <Banner tone="warning">{warn}</Banner>}
        <div data-scope>
          <ChoiceTiles label="Which transactions" hideLabel stacked value={scope} onChange={setScope} options={options} />
        </div>
        {scope !== "one" && p && (
          <div className="flex flex-col gap-2 text-small text-ink-2">
            {scope === "all" && p.edited > 0 && <Checkbox checked={skipEdited} onChange={setSkipEdited} label={`Leave the ${txnCount(p.edited)} changed by hand as they are`} />}
            {scope === "all" && p.locked > 0 && <p>{txnCount(p.locked)} in a closed period stay as they are.</p>}
            {preview && preview !== "loading" && preview.overlaps.length > 0 && <p>Other rules also reach these: {preview.overlaps.map((o) => `“${o.match}” (${o.effect})`).join("; ")}. A payee rule like this one is tried first.</p>}
            {preview && preview !== "loading" && preview.rule && preview.rule.book_category && preview.rule.book_category !== category && <p>This replaces the rule that files them under {accountShort(preview.rule.book_category)}.</p>}
            <p>Each change is recorded in the transaction’s history, and you can undo it right after.</p>
          </div>
        )}
        {err && <Banner tone="negative">{err}</Banner>}
      </div>
    </Dialog>
  );
}

// ── The batch editor ───────────────────────────────────────────────────────


/** What a batch reaches, for its confirm: net, span, entities. */
export type BatchSummary = { net: number; first?: string | null; last?: string | null; entities?: string[] };

/**
 * The batch editor: appears while rows are selected and changes vendor, note,
 * type or account on all of them at once. Desktop: a floating bar with the
 * fields labelled by what they set. Phones: a compact bar whose "Edit…"
 * opens a sheet with labelled fields. More than one row asks first, with
 * the count, span and entities. Only filled fields change.
 */
export function BatchBar({
  count,
  busy,
  onApply,
  onClear,
  vendorSuggestions = [],
  categories = [],
  summary,
}: {
  count: number;
  isDark?: boolean;
  busy?: boolean;
  /** Resolves true once saved; the fields keep what was typed until then. */
  onApply: (patch: Record<string, string>) => Promise<boolean>;
  onClear: () => void;
  vendorSuggestions?: string[];
  categories?: string[];
  summary?: BatchSummary;
}) {
  const phone = usePhone();
  const [vendor, setVendor] = useState("");
  const [note, setNote] = useState("");
  const [account, setAccount] = useState("");
  const [batchType, setBatchType] = useState("");
  const [sheet, setSheet] = useState(false);
  const listId = useMemo(() => `vendors-${Math.random().toString(36).slice(2, 8)}`, []);
  useEffect(() => {
    if (count === 0) setSheet(false);
  }, [count]);
  useEffect(() => {
    if (count === 0) return;
    // Escape drops the selection, when nothing floats above the bar.
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("#overlays [role='dialog'], #overlays [role='alertdialog'], #overlays [role='listbox'], #overlays [role='menu']")) return;
      onClear();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [count, onClear]);
  if (count === 0) return null;

  const canApply = !!(vendor.trim() || note.trim() || account || batchType);
  const changes = [vendor.trim() && `vendor to ${vendor.trim()}`, note.trim() && "the note", account && `account to ${accountShort(account)}`, batchType && `type to ${TYPE_OPTIONS.find((o) => o.value === batchType)?.label.toLowerCase()}`].filter(Boolean) as string[];

  async function apply() {
    if (count > 1) {
      const facts = [
        summary?.first && summary?.last ? dateRange(summary.first, summary.last) : null,
        summary?.entities?.length ? summary.entities.map(entityLabel).join(", ") : null,
        summary ? `${ledgerMoney(-summary.net)} net` : null,
      ].filter((x): x is string => !!x);
      const ok = await confirm({
        title: `Change ${txnCount(count)}?`,
        message: `Sets the ${format.list(changes)} on each. Everything else stays as it is. Each change is recorded, and you can undo it right after.`,
        details: facts,
        confirmLabel: `Change ${txnCount(count)}`,
      });
      if (!ok) return;
    }
    const patch: Record<string, string> = {};
    if (vendor.trim()) patch.merchant_name = vendor.trim();
    if (note.trim()) patch.memo = note.trim();
    if (account) patch.book_category = account;
    if (batchType) patch.type_override = batchType;
    if (!(await onApply(patch))) return;
    setVendor("");
    setNote("");
    setAccount("");
    setBatchType("");
    setSheet(false);
  }

  const applyLabel = `Apply to ${count}`;
  const accountOptions = categories.map(accountOption);
  const datalist = (
    <datalist id={listId}>
      {vendorSuggestions.slice(0, 500).map((v) => (
        <option key={v} value={v} />
      ))}
    </datalist>
  );

  if (phone) {
    return (
      <>
        <div
          role="toolbar"
          aria-label="Batch edit"
          data-floating
          className="ds fixed right-4 bottom-[calc(16px+env(safe-area-inset-bottom))] left-4 z-fab flex items-center gap-2 rounded-card border border-line-strong bg-overlay p-2 pl-4 text-body text-ink shadow-(--elevation-2)"
        >
          <span role="status" aria-live="polite" className="min-w-0 flex-1 truncate tabular-nums">
            {txnCount(count)} selected
          </span>
          <Button variant="primary" onClick={() => setSheet(true)}>
            Edit…
          </Button>
          <IconButton icon="x" label="Clear selection" onClick={onClear} />
        </div>
        <Sheet
          open={sheet}
          onClose={() => setSheet(false)}
          title={`Edit ${txnCount(count)}`}
          description="Only the fields you fill in change."
          dirty={canApply}
          footer={
            <>
              <Button onClick={() => setSheet(false)}>Cancel</Button>
              <Button variant="primary" busy={busy} busyLabel="Applying…" disabled={!canApply} disabledReason={canApply ? undefined : "Fill in a field to change"} onClick={() => void apply()}>
                {applyLabel}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <BatchField label="Vendor">
              <Input value={vendor} onChange={(e) => setVendor(e.target.value)} list={listId} placeholder="Leave as it is" autoComplete="off" />
            </BatchField>
            {datalist}
            <BatchField label="Note">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Leave as it is" />
            </BatchField>
            <BatchField label="Type">
              <Menu value={batchType} label="Type" placeholder="Leave as it is" onChange={setBatchType} options={TYPE_OPTIONS} size="md" className="w-full" />
            </BatchField>
            {categories.length > 0 && (
              <BatchField label="Account">
                <Menu value={account} label="Account" placeholder="Leave as it is" onChange={setAccount} options={accountOptions} size="md" className="w-full" />
              </BatchField>
            )}
          </div>
        </Sheet>
      </>
    );
  }
  return (
    <div
      role="toolbar"
      aria-label="Batch edit"
      data-floating
      className="ds fixed bottom-6 left-[calc(50%+var(--content-inset,var(--inset,0px))/2)] z-fab flex max-w-[calc(100vw-var(--content-inset,var(--inset,0px))-64px)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-card border border-line-strong bg-overlay p-2 pl-4 text-body text-ink shadow-(--elevation-2)"
    >
      <span role="status" aria-live="polite" className="mr-2 whitespace-nowrap tabular-nums">
        {txnCount(count)} selected{summary ? <span className="text-ink-2"> · {ledgerMoney(-summary.net)}</span> : null}
      </span>
      <Input aria-label="Set vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} list={listId} placeholder="Set vendor" autoComplete="off" className="w-[160px]" />
      {datalist}
      <Input aria-label="Add a note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" className="w-[180px]" />
      <Menu value={batchType} label="Set type" placeholder="Set type" onChange={setBatchType} options={TYPE_OPTIONS} size="md" />
      {categories.length > 0 && <Menu value={account} label="Set account" placeholder="Set account" onChange={setAccount} options={accountOptions} size="md" className="max-w-[220px]" />}
      <Button variant="primary" busy={busy} busyLabel="Applying…" disabled={!canApply} onClick={() => void apply()}>
        {applyLabel}
      </Button>
      <IconButton icon="x" label="Clear selection" onClick={onClear} />
    </div>
  );
}

function BatchField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-[6px]">
      <span className="text-small font-medium text-ink">{label}</span>
      {children}
    </label>
  );
}

// ── History and receipts ───────────────────────────────────────────────────

type HistoryEntry = { id: number; field: string; old_value: string | null; new_value: string | null; source: string | null; changed_at: string; actor_name?: string | null };
type Receipt = { id: number; url: string | null; label: string | null; source?: string; uploaded_at?: string; uploaded_by_name?: string | null; removed_at?: string | null; removed_by_name?: string | null };
type History = { log: HistoryEntry[]; receipts: Receipt[]; removed: Receipt[] };

const FIELD_LABEL: Record<string, string> = {
  book_category: "Account",
  type_override: "Type",
  loan_id: "Loan",
  merchant_name: "Vendor",
  name: "Description",
  memo: "Note",
  receipt: "Receipt",
  txn_type: "Bank type",
  intercompany: "Intercompany",
};

/** How a change was made, in words: "by hand", "by the rule", "in a batch". */
function sourceWord(source: string | null): string {
  if (!source || source === "edit") return "by hand";
  if (source === "batch") return "in a batch edit";
  if (source.startsWith("rule:")) return "by a taught rule";
  if (source === "vendor") return "by the vendor’s default";
  if (source === "undo") return "undone";
  if (source === "loan") return "on the loan";
  if (source === "sync") return "by the bank sync";
  if (source === "receipt") return "";
  if (source.startsWith("pending:")) return "carried from the pending transaction";
  return source;
}

function valueWord(field: string, v: string | null, loans: Array<{ id: string; name: string }>): string {
  if (v === null || v === "") return "none";
  if (field === "book_category") return accountShort(v);
  if (field === "type_override") return TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v;
  if (field === "loan_id") return loans.find((l) => l.id === v)?.name ?? "a loan";
  return v;
}

function HistoryAndReceipts({ txn, cache, loans, readOnly, onError }: { txn: Txn; cache: Map<string, History>; loans: Array<{ id: string; name: string }>; readOnly: boolean; onError: (m: string) => void }) {
  const id = txn.transaction_id;
  const [h, setH] = useState<History | null>(cache.get(id) ?? null);
  const [all, setAll] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const res = await authFetch(`/api/books/data?report=history&transaction_id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error();
      const d = await res.json();
      const entry: History = { log: d.log ?? [], receipts: d.receipts ?? [], removed: d.removed_receipts ?? [] };
      cache.set(id, entry);
      setH(entry);
    } catch {
      setH((cur) => cur ?? { log: [], receipts: [], removed: [] });
    }
  }
  useEffect(() => {
    const hit = cache.get(id);
    if (hit) setH(hit);
    else void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function addLink() {
    if (!/^https?:\/\/.{3,}/i.test(url.trim())) {
      onError("Paste a full link, starting with https://.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/books/data", { method: "POST", body: JSON.stringify({ action: "add_receipt", transaction_id: id, url: url.trim() }) });
      if (!res.ok) throw new Error();
      setUrl("");
      cache.delete(id);
      await load();
    } catch {
      onError("Couldn’t attach that link. Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    if (file.size > 3 * 1024 * 1024) {
      onError("Files must be under 3 MB.");
      return;
    }
    setBusy(true);
    try {
      const data_base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const res = await authFetch("/api/books/upload-receipt", { method: "POST", body: JSON.stringify({ transaction_id: id, filename: file.name, content_type: file.type, data_base64 }) });
      if (!res.ok) throw new Error();
      cache.delete(id);
      await load();
    } catch {
      onError("The upload didn’t finish. Try again.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function remove(r: Receipt) {
    const ok = await confirm({
      title: "Remove this receipt?",
      object: { name: r.label || r.url || "Receipt", detail: r.uploaded_at ? `Added ${format.date(r.uploaded_at, "medium")}${r.uploaded_by_name ? ` by ${r.uploaded_by_name}` : ""}` : undefined },
      message: "It comes off this transaction but stays on file, with who removed it and when.",
      confirmLabel: "Remove receipt",
      tone: "danger",
    });
    if (!ok) return;
    const res = await authFetch("/api/books/data", { method: "POST", body: JSON.stringify({ action: "delete_receipt", id: r.id }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      onError(data?.message || "Couldn’t remove that receipt.");
      return;
    }
    cache.delete(id);
    await load();
  }

  const entries = h?.log ?? [];
  const shown = all ? entries : entries.slice(0, 6);
  return (
    <div className="grid gap-x-8 gap-y-6 lg:grid-cols-3">
      <section className="min-w-0" aria-label="Receipts and documents">
        <h4 className="mb-2 text-small font-semibold text-ink">Receipts and documents</h4>
        {!h ? (
          <Skeleton kind="line" />
        ) : h.receipts.length ? (
          <ul className="mb-3 flex flex-col">
            {h.receipts.map((r) => (
              <li key={r.id} className="flex min-h-[36px] items-center gap-2 border-b border-line py-1 touch:min-h-[44px]">
                <a href={r.url ?? undefined} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-body text-accent hover:underline">
                  {r.label || r.url}
                </a>
                {r.uploaded_by_name && <span className="hidden shrink-0 text-caption text-ink-3 sm:inline">{r.uploaded_by_name}</span>}
                {!readOnly && <IconButton icon="trash" label={`Remove ${r.label || "receipt"}`} onClick={() => void remove(r)} />}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 text-body text-ink-2">None attached.</p>
        )}
        {!readOnly && (
          <div className="flex flex-col gap-2">
            <input ref={fileRef} type="file" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" icon="upload" busy={busy} busyLabel="Attaching…" onClick={() => fileRef.current?.click()}>
                Attach a file
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Input aria-label="Or paste a link" placeholder="Or paste a link" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void addLink()} className="min-w-0 flex-1" />
              {url.trim() && (
                <Button size="sm" onClick={() => void addLink()} disabled={busy}>
                  Add
                </Button>
              )}
            </div>
            <p className="text-caption text-ink-3">A file is kept with the books; a link may not last.</p>
          </div>
        )}
        {h && h.removed.length > 0 && (
          <Disclosure label="Removed" count={h.removed.length} className="mt-2">
            <ul className="mt-1 flex flex-col gap-1 text-small text-ink-2">
              {h.removed.map((r) => (
                <li key={r.id}>
                  {r.label || r.url} · removed {r.removed_at ? format.date(r.removed_at, "medium") : ""}
                  {r.removed_by_name ? ` by ${r.removed_by_name}` : ""}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
      </section>
      <section className="min-w-0 lg:col-span-2" aria-label="History">
        <h4 className="mb-2 text-small font-semibold text-ink">History</h4>
        {!h ? (
          <Skeleton kind="line" />
        ) : entries.length === 0 ? (
          <p className="text-body text-ink-2">No changes recorded. The account came from the bank feed and the built-in chart.</p>
        ) : (
          <>
            <ul className="flex flex-col">
              {shown.map((e) => {
                const how = sourceWord(e.source);
                return (
                  <li key={e.id} className="border-b border-line py-2 text-body text-ink last:border-b-0">
                    <span className="font-medium">{FIELD_LABEL[e.field] ?? e.field}</span>{" "}
                    {e.field === "receipt" ? (e.new_value ? `added: ${e.new_value}` : `removed: ${e.old_value ?? ""}`) : `${valueWord(e.field, e.old_value, loans)} → ${valueWord(e.field, e.new_value, loans)}`}
                    <span className="block text-small text-ink-2 tabular-nums">
                      {format.dateTime(e.changed_at, { zone: true })}
                      {e.actor_name ? ` · ${e.actor_name}` : ""}
                      {how ? ` · ${how}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
            {entries.length > 6 && (
              <Button variant="quiet" size="sm" onClick={() => setAll(!all)} className="mt-1">
                {all ? "Show fewer" : `Show all ${entries.length}`}
              </Button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ── The row detail ─────────────────────────────────────────────────────────

/** Where a row came from, in words. */
function sourceOf(t: Txn): string {
  if (t.item_id === "csv_import") return "Imported from a bank CSV file";
  if (t.item_id === "mercury_api") return "Loaded from Mercury’s history";
  return "Bank feed";
}

function DetailRow({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-[2px] py-2 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="shrink-0 text-small text-ink-2 sm:w-[128px]">{k}</dt>
      <dd className="min-w-0 flex-1 text-body break-words text-ink">{children}</dd>
    </div>
  );
}

// ── TxnTable ───────────────────────────────────────────────────────────────

type Selection = {
  selected: Set<string>;
  toggle: (id: string) => void;
  setAll: (ids: string[]) => void;
  selectMany?: (ids: string[], on: boolean) => void;
};

/** The loaded layout's shape while the rows load. */
export function TxnTableSkeleton(_p: { isDark?: boolean; view?: TxnView; selection?: boolean }) {
  const phone = usePhone();
  return phone ? <Skeleton kind="rows" rows={8} /> : <Skeleton kind="table" rows={8} columns={["36%", "22%", "8%", "12%", "14%"]} />;
}

/**
 * The editable ledger. Desktop: a table (merchant with its descriptor, the
 * account as a quiet picker, entity, date on every row, amount), a row
 * opens its detail in place. Phones: a list of rows (payee, account ·
 * entity, amount) under sticky day or month headings; a row opens its
 * detail in a sheet, where the editors live. `context` "vendor" drops the
 * vendor name from each row (the page is the vendor); the entity column
 * hides when every row shares one entity.
 */
export function TxnTable({
  rows: propRows,
  categories,
  loans = [],
  onRowChange,
  onError,
  onReload,
  balances,
  balanceLabel = "Balance",
  selection,
  sort,
  onSort,
  readOnly = false,
  context = "ledger",
  accounts,
}: {
  rows: Txn[];
  categories: string[];
  loans?: Array<{ id: string; name: string }>;
  isDark?: boolean;
  onRowChange: (t: Txn) => void;
  onError: (message: string) => void;
  onReload?: () => void;
  balances?: Record<string, number>;
  /** The balance column's head ("Paid to date" on a vendor). */
  balanceLabel?: string;
  selection?: Selection;
  sort?: { key: string; dir: "asc" | "desc" };
  onSort?: (key: string) => void;
  view?: TxnView;
  readOnly?: boolean;
  context?: "ledger" | "vendor" | "loan";
  /** Account id → "Operating checking •• 4821", for the detail and the bank-account column. */
  accounts?: Record<string, string>;
}) {
  const phone = usePhone();
  const [open, setOpen] = useState<string | null>(null);
  const [pending, setPending] = useState<{ t: Txn; category: string } | null>(null);
  const [optimistic, setOptimistic] = useState<Map<string, Partial<Txn>>>(() => new Map());
  const cache = useRef(new Map<string, History>());
  const lastPicked = useRef<number | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const clearDraft = (id: string) =>
    setNoteDraft((d) => {
      const { [id]: _gone, ...rest } = d;
      return rest;
    });

  const rows = useMemo(() => (optimistic.size === 0 ? propRows : propRows.map((r) => (optimistic.has(r.transaction_id) ? { ...r, ...optimistic.get(r.transaction_id) } : r))), [propRows, optimistic]);
  useEffect(() => {
    // Drop overrides the parent has caught up with.
    setOptimistic((prev) => {
      if (!prev.size) return prev;
      const next = new Map(prev);
      for (const [id, patch] of prev) {
        const row = propRows.find((r) => r.transaction_id === id);
        if (row && Object.entries(patch).every(([k, v]) => (row as Record<string, unknown>)[k] === v)) next.delete(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [propRows]);

  const oneEntity = useMemo(() => {
    const set = new Set(rows.map((r) => r.entity_name ?? ""));
    return set.size === 1 ? [...set][0] || null : null;
  }, [rows]);
  const showEntity = !(context !== "ledger" && oneEntity !== null && rows.length > 0);
  const anySelected = (selection?.selected.size ?? 0) > 0;
  const catOptions = useMemo(() => categories.map(accountOption), [categories]);
  const catOptionsFor = (t: Txn) => (t.book_category && !categories.includes(t.book_category) ? [accountOption(t.book_category), ...catOptions] : catOptions);

  async function save(t: Txn, patch: { type_override?: string | null; book_category?: string; loan_id?: string | null; memo?: string | null }) {
    const id = t.transaction_id;
    setOptimistic((m) => new Map(m).set(id, patch as Partial<Txn>));
    try {
      const res = await authFetch("/api/books/data", { method: "POST", body: JSON.stringify({ transaction_id: id, ...patch }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Couldn’t save that change.");
      cache.current.delete(id);
      onRowChange({ ...data.transaction, entity_id: t.entity_id, entity_name: t.entity_name });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn’t save that change.");
    } finally {
      setOptimistic((m) => {
        if (!m.has(id)) return m;
        const n = new Map(m);
        n.delete(id);
        return n;
      });
    }
  }

  const pickAccount = (t: Txn, v: string) => setPending({ t, category: v });

  function pickRow(t: Txn, ri: number, shift: boolean) {
    if (!selection) return;
    if (shift && selection.selectMany && lastPicked.current != null) {
      const [from, to] = lastPicked.current < ri ? [lastPicked.current, ri] : [ri, lastPicked.current];
      selection.selectMany(
        rows.slice(from, to + 1).map((r) => r.transaction_id),
        !selection.selected.has(t.transaction_id),
      );
    } else selection.toggle(t.transaction_id);
    lastPicked.current = ri;
  }

  const model = (t: Txn) => {
    const eff = effType(t);
    const vendor = t.merchant_name || (eff === "normal" ? t.name : null);
    const vendorText = displayName(vendor);
    const memo = vendor ? descriptorFor(t.name, vendor, t.entity_name) : memoText(t.name);
    const title = context === "vendor" ? memo || vendorText || "—" : (vendor ? vendorText : memo) || "—";
    const secondary = context === "vendor" ? null : vendor ? memo : null;
    return { eff, vendor, vendorText, memo, title, secondary, inflow: t.amount < 0, word: typeWord(eff) };
  };

  const accountPicker = (t: Txn, extra?: string) => {
    const loanName = t.loan_id ? (loans.find((l) => l.id === t.loan_id)?.name ?? "a loan") : null;
    return (
      <Menu
        value={t.book_category ?? ""}
        placeholder={loanName ? `On ${loanName}` : "Uncategorized"}
        tone="soft"
        readOnly={readOnly}
        chevron="hover"
        label="Account"
        onChange={(v) => pickAccount(t, v)}
        options={catOptionsFor(t)}
        className={extra}
        footnote={t.loan_id ? "Choosing an account takes this off its loan." : undefined}
      />
    );
  };

  const editors = (t: Txn) => {
    const { eff } = model(t);
    const draft = noteDraft[t.transaction_id];
    return (
      <dl className="grid gap-x-6 sm:grid-cols-2">
        <DetailRow k="Account">{accountPicker(t)}</DetailRow>
        <DetailRow k="Type">
          <Menu
            value={eff === "loan" ? (t.type_override ?? "normal") : eff}
            tone="soft"
            readOnly={readOnly}
            label="Type"
            onChange={(v) => void save(t, t.loan_id ? { type_override: v, loan_id: null } : { type_override: v })}
            options={TYPE_OPTIONS}
          />
        </DetailRow>
        {loans.length > 0 && (
          <DetailRow k="Loan">
            <Menu value={t.loan_id ?? ""} tone="soft" readOnly={readOnly} label="Loan" placeholder="Not on a loan" onChange={(v) => void save(t, { loan_id: v || null })} options={[{ value: "", label: "Not on a loan" }, ...loans.map((l) => ({ value: l.id, label: l.name }))]} />
          </DetailRow>
        )}
        <DetailRow k="Note">
          {readOnly ? (
            t.memo || <span className="text-ink-3">None</span>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                aria-label="Note"
                value={draft ?? t.memo ?? ""}
                placeholder="Add a note for the books"
                onChange={(e) => setNoteDraft((d) => ({ ...d, [t.transaction_id]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && draft !== undefined) void save(t, { memo: draft.trim() || null }).then(() => clearDraft(t.transaction_id));
                }}
                className="min-w-0 flex-1"
              />
              {draft !== undefined && draft !== (t.memo ?? "") && (
                <Button size="sm" onClick={() => void save(t, { memo: draft.trim() || null }).then(() => clearDraft(t.transaction_id))}>
                  Save
                </Button>
              )}
            </div>
          )}
        </DetailRow>
      </dl>
    );
  };

  const detail = (t: Txn) => {
    const { vendor, inflow } = model(t);
    const warn = signNote(t.book_category, inflow);
    const tax = /TAX_PAYMENT/i.test(t.plaid_category_detailed ?? "") && t.book_category && !t.book_category.startsWith("6700") && !t.book_category.startsWith("9");
    return (
      <div className="flex flex-col gap-6">
        {(warn || tax) && <Banner tone="warning">{tax ? `The bank calls this a tax payment, but it’s filed under ${accountShort(t.book_category)}. A tax paid for an owner is usually a distribution, not an expense.` : warn}</Banner>}
        {editors(t)}
        <section aria-label="Details">
          <h4 className="mb-1 text-small font-semibold text-ink">Details</h4>
          <dl className="grid gap-x-6 sm:grid-cols-2">
            <DetailRow k="Date">{format.date(t.date, "long")}</DetailRow>
            <DetailRow k="Status">{t.pending ? "Pending" : "Posted"}</DetailRow>
            <DetailRow k="Amount">{ledgerMoney(t.amount, t.currency)}</DetailRow>
            <DetailRow k="Entity">{t.entity_name ? entityLabel(t.entity_name) : "No entity"}</DetailRow>
            {accounts?.[t.account_id] && <DetailRow k="Bank account">{accounts[t.account_id]}</DetailRow>}
            {vendor && (
              <DetailRow k="Vendor">
                <Link to={`/books/vendors/detail?name=${encodeURIComponent(vendor)}`} className="text-accent hover:underline">
                  {displayName(vendor)}
                </Link>
              </DetailRow>
            )}
            {t.name && <DetailRow k="Bank’s description">{t.name}</DetailRow>}
            {(t.plaid_category || t.plaid_category_detailed) && <DetailRow k="Bank’s category">{pretty(t.plaid_category_detailed || t.plaid_category)}</DetailRow>}
            {t.payment_channel && <DetailRow k="Paid by">{pretty(t.payment_channel)}</DetailRow>}
            <DetailRow k="Source">{sourceOf(t)}</DetailRow>
            {t.updated_at && <DetailRow k="Last updated">{format.dateTime(t.updated_at)}</DetailRow>}
          </dl>
          <Disclosure label="Technical details" className="mt-2">
            <dl className="mt-1 grid gap-x-6 sm:grid-cols-2">
              {(
                [
                  ["Transaction ID", t.transaction_id],
                  ["Account ID", t.account_id],
                  ["Connection ID", t.item_id],
                  ["Other side’s account ID", t.counterparty_account_id],
                ] as const
              ).map(([k, v]) =>
                v ? (
                  <DetailRow key={k} k={k}>
                    <span className="flex items-center gap-1">
                      <span className="min-w-0 font-mono text-small break-all text-ink-2">{v}</span>
                      <IconButton icon="copy" label={`Copy ${k}`} onClick={() => void navigator.clipboard?.writeText(v).then(() => toast({ message: `Copied the ${k.toLowerCase()}` }))} />
                    </span>
                  </DetailRow>
                ) : null,
              )}
            </dl>
          </Disclosure>
        </section>
        <HistoryAndReceipts txn={t} cache={cache.current} loans={loans} readOnly={readOnly} onError={onError} />
      </div>
    );
  };

  const dialog = pending && (
    <CategorizeDialog
      txn={pending.t}
      category={pending.category}
      loanName={pending.t.loan_id ? (loans.find((l) => l.id === pending.t.loan_id)?.name ?? "a loan") : null}
      onClose={() => setPending(null)}
      onError={() => {}}
      onDone={(r) => {
        const t = pending.t;
        setPending(null);
        cache.current.delete(t.transaction_id);
        if (r.scope === "one" && r.row) {
          onRowChange({ ...r.row, entity_id: t.entity_id, entity_name: t.entity_name });
          changedToast(`Filed under ${accountShort(pending.category)}`, r.undo, () => onReload?.());
        } else {
          cache.current.clear();
          onReload?.();
          changedToast(r.scope === "future" ? "Saved the rule for new transactions" : `Filed ${txnCount(r.applied)} under ${accountShort(pending.category)}`, r.undo, () => onReload?.());
        }
      }}
    />
  );

  // ── Phones: a list under sticky headings; a row opens a sheet. ──────────
  if (phone) {
    const bandOf = (t: Txn) => (context === "vendor" ? format.date(`${t.date.slice(0, 7)}-01`, "long").replace(/ 1,/, "") : midDate(t.date, { omitCurrentYear: true }));
    const grouped = !sort || sort.key === "date";
    const openRow = rows.find((r) => r.transaction_id === open) ?? null;
    return (
      <>
        <ul aria-label="Transactions" className="ds">
          {rows.map((t, ri) => {
            const m = model(t);
            const band = grouped && (ri === 0 || bandOf(rows[ri - 1]) !== bandOf(t)) ? bandOf(t) : null;
            const checked = selection?.selected.has(t.transaction_id) ?? false;
            const second = [context === "vendor" ? midDate(t.date, { omitCurrentYear: true }) : null, t.book_category ? accountShort(t.book_category) : t.loan_id ? "On a loan" : "Uncategorized", m.word, t.pending ? "Pending" : null].filter(Boolean).join(" · ");
            return (
              <Fragment key={t.transaction_id}>
                {band && <li className="sticky top-[calc(52px+env(safe-area-inset-top))] z-sticky border-b border-line bg-page px-4 pt-4 pb-1 text-small font-medium text-ink-2">{band}</li>}
                <li className={cx("flex items-stretch border-b border-line", checked && "bg-selected")}>
                  {selection ? (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      aria-label={`Select ${m.title}`}
                      onClick={(e) => pickRow(t, ri, e.shiftKey)}
                      className="flex w-[56px] shrink-0 cursor-pointer items-center justify-center"
                    >
                      <span className={cx("relative inline-flex size-8 items-center justify-center rounded-full text-small font-medium", checked ? "bg-accent text-on-accent" : "bg-sunken text-ink-2")}>
                        {checked ? <Icon name="check" size={16} /> : (m.title.trim()[0]?.toUpperCase() ?? "?")}
                      </span>
                    </button>
                  ) : (
                    <span aria-hidden className="flex w-[56px] shrink-0 items-center justify-center">
                      <span className="inline-flex size-8 items-center justify-center rounded-full bg-sunken text-small font-medium text-ink-2">{m.title.trim()[0]?.toUpperCase() ?? "?"}</span>
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Details for ${m.title}`}
                    aria-haspopup="dialog"
                    aria-expanded={open === t.transaction_id}
                    onClick={() => setOpen(t.transaction_id)}
                    className="flex min-h-(--row-2) min-w-0 flex-1 cursor-pointer items-center gap-3 py-2 pr-4 text-left active:bg-selected"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-ink">{m.title}</span>
                      <span className="flex min-w-0 items-center gap-2 text-small text-ink-2">
                        <span className="truncate">{second}</span>
                        {showEntity && t.entity_name && <span className="shrink-0">{entityTag(t.entity_name)}</span>}
                      </span>
                    </span>
                    <span className={cx("shrink-0 text-body font-medium tabular-nums", m.inflow && m.eff === "normal" ? "text-positive" : "text-ink")}>{ledgerMoney(t.amount, t.currency)}</span>
                  </button>
                </li>
              </Fragment>
            );
          })}
        </ul>
        <Sheet open={!!openRow} onClose={() => setOpen(null)} title={openRow ? model(openRow).title : ""} description={openRow ? `${ledgerMoney(openRow.amount, openRow.currency)} · ${midDate(openRow.date)}` : undefined}>
          {openRow && detail(openRow)}
        </Sheet>
        {dialog}
      </>
    );
  }

  // ── Desktop: the table; a row opens its detail in place. ───────────────
  const allSelected = !!selection && rows.length > 0 && rows.every((r) => selection.selected.has(r.transaction_id));
  const someSelected = !!selection && !allSelected && rows.some((r) => selection.selected.has(r.transaction_id));
  const cols = 4 + (showEntity ? 1 : 0) + (balances ? 1 : 0) + (selection ? 1 : 0);
  const th = (label: string, key?: string, right = false, width?: string) => {
    const active = !!onSort && !!key && sort?.key === key;
    return (
      <th
        scope="col"
        style={width ? { width } : undefined}
        aria-sort={onSort && key ? (active ? (sort?.dir === "asc" ? "ascending" : "descending") : "none") : undefined}
        className={cx("sticky top-0 z-sticky h-8 border-b border-line-strong bg-raised px-3 text-caption font-medium whitespace-nowrap text-ink-2", right ? "text-right" : "text-left")}
      >
        {onSort && key ? (
          <button type="button" onClick={() => onSort(key)} className={cx("inline-flex cursor-pointer items-center gap-1 hover:text-ink", right && "flex-row-reverse", active && "text-ink")}>
            {label}
            {active && <Icon name={sort?.dir === "asc" ? "chevronUp" : "chevronDown"} size={12} />}
          </button>
        ) : (
          label
        )}
      </th>
    );
  };
  return (
    <>
      <table aria-label="Transactions" className="ds w-full table-fixed border-separate border-spacing-0 text-body text-ink tabular-nums">
        <thead>
          <tr>
            {selection && (
              <th scope="col" style={{ width: 44 }} className="sticky top-0 z-sticky h-8 border-b border-line-strong bg-raised pl-5">
                <SelectBox checked={allSelected ? true : someSelected ? "mixed" : false} label={allSelected ? "Deselect all" : "Select all"} onChange={() => selection.setAll(allSelected ? [] : rows.map((r) => r.transaction_id))} />
              </th>
            )}
            {th(context === "vendor" ? "Description" : "Merchant", "vendor")}
            {th("Account", "account", false, "22%")}
            {showEntity && th("Entity", "entity", false, "88px")}
            {th("Date", "date", false, "120px")}
            {th("Amount", "amount", true, "140px")}
            {balances && th(balanceLabel, undefined, true, "140px")}
            <th scope="col" style={{ width: 48 }} className="sticky top-0 z-sticky h-8 border-b border-line-strong bg-raised pr-3">
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, ri) => {
            const m = model(t);
            const isOpen = open === t.transaction_id;
            const checked = selection?.selected.has(t.transaction_id) ?? false;
            return (
              <Fragment key={t.transaction_id}>
                <tr className={cx("group", checked ? "bg-selected" : isOpen ? "bg-hover" : "hover:bg-hover")}>
                  {selection && (
                    <td className="h-(--row-1) border-b border-line pl-5 align-middle">
                      <SelectBox checked={checked} label={`Select ${m.title}`} reveal={!checked && !anySelected} onChange={(_, shift) => pickRow(t, ri, shift)} />
                    </td>
                  )}
                  <td className={cx("h-(--row-1) border-b border-line py-2 pr-3", selection ? "pl-3" : "pl-5")}>
                    <span className="flex min-w-0 items-baseline gap-2">
                      {m.vendor && context !== "vendor" ? (
                        <Link to={`/books/vendors/detail?name=${encodeURIComponent(m.vendor)}`} className="max-w-[60%] shrink-0 truncate font-medium text-ink hover:underline" title={`Open ${m.vendorText}`}>
                          {m.title}
                        </Link>
                      ) : (
                        <span className="min-w-0 truncate text-ink" title={t.name ?? undefined}>
                          {m.title}
                        </span>
                      )}
                      {m.secondary && (
                        <span className="min-w-0 truncate text-small text-ink-2" title={t.name ?? undefined}>
                          {m.secondary}
                        </span>
                      )}
                      {t.memo && <span className="min-w-0 truncate text-small text-ink-2">· {t.memo}</span>}
                      {(m.word || t.pending) && <span className="shrink-0 text-small text-ink-2">{[m.word, t.pending ? "Pending" : null].filter(Boolean).join(" · ")}</span>}
                    </span>
                  </td>
                  <td className="h-(--row-1) border-b border-line px-3 py-1">{accountPicker(t, "max-w-full")}</td>
                  {showEntity && <td className="h-(--row-1) border-b border-line px-3">{t.entity_name ? <EntityTag name={t.entity_name} /> : <span className="text-small text-warning">No entity</span>}</td>}
                  <td className="h-(--row-1) border-b border-line px-3 text-small whitespace-nowrap text-ink-2">{midDate(t.date, { omitCurrentYear: true })}</td>
                  <td className={cx("h-(--row-1) border-b border-line px-3 text-right font-medium whitespace-nowrap", m.inflow && m.eff === "normal" ? "text-positive" : "text-ink")}>{ledgerMoney(t.amount, t.currency)}</td>
                  {balances && <td className="h-(--row-1) border-b border-line px-3 text-right whitespace-nowrap text-ink-2">{money(balances[t.transaction_id] ?? 0, t.currency ?? "USD")}</td>}
                  <td className="h-(--row-1) border-b border-line pr-3 text-right">
                    <IconButton icon={isOpen ? "chevronUp" : "chevronDown"} label={`Details for ${m.title}`} aria-expanded={isOpen} noTooltip onClick={() => setOpen(isOpen ? null : t.transaction_id)} />
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={cols} className="border-b border-line bg-raised px-5 py-6">
                      {detail(t)}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {dialog}
    </>
  );
}

function SelectBox({ checked, onChange, label, reveal = false }: { checked: boolean | "mixed"; onChange: (v: boolean, shift: boolean) => void; label: string; reveal?: boolean }) {
  const on = checked === true;
  const mixed = checked === "mixed";
  return (
    <label className={cx("inline-flex cursor-pointer items-center align-middle", reveal && "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100")}>
      <input
        type="checkbox"
        className="peer sr-only"
        role="checkbox"
        checked={on}
        aria-checked={mixed ? "mixed" : on}
        aria-label={label}
        onClick={(e) => {
          e.preventDefault();
          onChange(!on, e.shiftKey);
        }}
        onChange={() => {}}
      />
      <span
        aria-hidden="true"
        className={cx(
          "inline-flex size-[16px] items-center justify-center rounded-mark border-[1.5px] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-focus-visible:outline-solid",
          on || mixed ? "border-accent bg-accent text-on-accent" : "border-edge bg-field",
        )}
      >
        {on && <Icon name="check" size={12} />}
        {mixed && <Icon name="minus" size={12} />}
      </span>
    </label>
  );
}

/** A spinner beside a word, for an inline refresh. */
export function Busy({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-small text-ink-2">
      <Spinner />
      {children}
    </span>
  );
}
