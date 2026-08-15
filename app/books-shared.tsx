import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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

/** "2026-08-08" → "Aug 8th". Parsed straight off the ISO string (no timezone). */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return iso;
  const v = d % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][d % 10] ?? "th";
  return `${SHORT_MONTHS[m - 1]} ${d}${suffix}`;
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

/** A stable 3-letter code for an entity, e.g. "Ledger Louise, LLC" → "LDL". */
export function entityTag(name?: string | null): string {
  if (!name) return "—";
  const key = name.toLowerCase().replace(/\(.*?\)/g, "").replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
  if (ENTITY_TAGS[key]) return ENTITY_TAGS[key];
  const words = key.split(" ").filter((w) => w && !TAG_STOP.has(w));
  const base = words.length ? words : key.split(" ");
  let code = base.map((w) => w[0]).join("").toUpperCase();
  if (code.length < 3) code = ((base[0] || key).toUpperCase().replace(/[^A-Z]/g, "") + code).slice(0, 3);
  return code.slice(0, 3) || "—";
}

const TAG_STYLES: Array<{ dark: string; light: string }> = [
  { dark: "bg-emerald-500/15 text-emerald-300", light: "bg-emerald-100 text-emerald-800" },
  { dark: "bg-sky-500/15 text-sky-300", light: "bg-sky-100 text-sky-800" },
  { dark: "bg-violet-500/15 text-violet-300", light: "bg-violet-100 text-violet-800" },
  { dark: "bg-amber-500/15 text-amber-300", light: "bg-amber-100 text-amber-800" },
  { dark: "bg-rose-500/15 text-rose-300", light: "bg-rose-100 text-rose-800" },
  { dark: "bg-teal-500/15 text-teal-300", light: "bg-teal-100 text-teal-800" },
  { dark: "bg-indigo-500/15 text-indigo-300", light: "bg-indigo-100 text-indigo-800" },
  { dark: "bg-orange-500/15 text-orange-300", light: "bg-orange-100 text-orange-800" },
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
        className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold tracking-wide cursor-default ${entityTagClass(name, isDark)}`}
      >
        {entityTag(name)}
      </span>
      {pos &&
        createPortal(
          <div
            style={{ position: "fixed", left: pos.left, top: pos.top, transform: "translateX(-50%)" }}
            className={`z-[80] pointer-events-none px-2 py-1 rounded-md text-xs whitespace-nowrap shadow-lg border ${
              isDark ? "bg-[#161616] text-gray-100 border-white/10" : "bg-gray-900 text-white border-black/10"
            }`}
          >
            {name}
          </div>,
          document.body
        )}
    </>
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
};

/** The type dropdown's leading icon. */
export function typeIcon(value: string, inflow: boolean): ReactNode {
  if (value === "transfer") return <Icon d={P.swap} />;
  if (value === "intercompany") return <Icon d={P.building} />;
  return <Icon d={inflow ? P.down : P.up} />;
}

/** The account dropdown's leading icon, by chart section (leading digit). */
export function accountIcon(label: string): ReactNode {
  const c = label.trim()[0];
  if (c === "4") return <Icon d={P.trend} />;
  if (c === "7") return <Icon d={P.scale} />;
  if (c === "9") return <Icon d={P.swap} />;
  return <Icon d={P.receipt} />;
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

type Option = { value: string; label: string; hint?: string; icon?: ReactNode };

/**
 * A fully custom dropdown — a rounded pill trigger and a themed popover list
 * with a checkmark on the current choice. Rendered through a portal with fixed
 * positioning so it escapes the table's horizontal scroll box (a native
 * <select>'s option list can't be styled, and an absolutely-positioned menu
 * would be clipped by the overflow container).
 */
export function Menu({
  value,
  options,
  isDark,
  disabled,
  onChange,
  tone = "neutral",
}: {
  value: string;
  options: Option[];
  isDark: boolean;
  disabled?: boolean;
  onChange: (v: string) => void;
  tone?: "neutral" | "amber";
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null);

  const current = options.find((o) => o.value === value) ?? options[0];
  const label = current?.label ?? "—";

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.max(r.width, 224);
      const menuH = Math.min(320, options.length * 38 + 12);
      const spaceBelow = window.innerHeight - r.bottom;
      const above = spaceBelow < menuH + 12 && r.top > spaceBelow;
      setBox({
        left: Math.min(r.left, window.innerWidth - width - 8),
        top: above ? Math.max(8, r.top - menuH - 6) : r.bottom + 6,
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
  }, [open, options.length]);

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

  const pill = `inline-flex items-center gap-1.5 pl-3 pr-2.5 py-1.5 rounded-full text-xs border cursor-pointer max-w-[190px] disabled:opacity-50 transition-colors ${
    tone === "amber"
      ? isDark
        ? "bg-amber-500/10 border-amber-500/25 text-amber-200 hover:bg-amber-500/20"
        : "bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100"
      : isDark
        ? "bg-white/[0.06] border-white/10 text-gray-200 hover:bg-white/[0.1]"
        : "bg-white border-gray-200 text-gray-800 hover:bg-gray-50"
  }`;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={pill}
      >
        {current?.icon && <span className="shrink-0 opacity-80">{current.icon}</span>}
        <span className="truncate">{label}</span>
        <svg
          className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""} ${isDark ? "text-gray-500" : "text-gray-400"}`}
          fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && box &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            style={{ position: "fixed", left: box.left, top: box.top, width: box.width }}
            className={`z-[70] rounded-2xl border p-1.5 shadow-xl max-h-80 overflow-y-auto ${
              isDark ? "bg-[#161616] border-white/10" : "bg-white border-gray-200"
            }`}
          >
            {options.map((o) => {
              const sel = o.value === value;
              return (
                <button
                  key={o.value || "—"}
                  role="option"
                  aria-selected={sel}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs text-left cursor-pointer transition-colors ${
                    sel
                      ? "bg-emerald-500 text-white font-medium"
                      : isDark
                        ? "text-gray-200 hover:bg-white/10"
                        : "text-gray-800 hover:bg-gray-100"
                  }`}
                >
                  <span className="w-3.5 shrink-0 flex items-center justify-center">
                    {sel && (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                  </span>
                  {o.icon && <span className="shrink-0 opacity-80">{o.icon}</span>}
                  <span className="truncate flex-1">{o.label}</span>
                  {o.hint && <span className={`text-[10px] ${sel ? "text-white/70" : "text-gray-500"}`}>{o.hint}</span>}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}

/**
 * The editable transaction spreadsheet: type and category change in place,
 * the chevron opens every field we hold on the transaction, and the vendor
 * name walks to the Vendors page.
 */
export function TxnTable({
  rows,
  categories,
  loans = [],
  isDark,
  onRowChange,
  onError,
  onReload,
}: {
  rows: Txn[];
  categories: string[];
  loans?: Array<{ id: string; name: string }>;
  isDark: boolean;
  onRowChange: (t: Txn) => void;
  onError: (message: string) => void;
  onReload?: () => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const subtle = "text-gray-500";
  const border = isDark ? "border-white/5" : "border-gray-100";

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
   * ones via a stored rule. Declining changes just the one row.
   */
  async function changeCategory(t: Txn, category: string) {
    const match = (t.merchant_name || t.name || "").trim();
    const teach =
      !!match &&
      confirm(
        `Categorize ALL "${match}" transactions as "${category}" — and automatically categorize new ones the same way?

` +
          "Cancel applies it to just this transaction."
      );
    if (!teach) {
      await update(t, { book_category: category });
      return;
    }
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

  const detail = (t: Txn): Array<[string, string]> => [
    ["Description", t.name ?? "—"],
    ["Merchant", t.merchant_name ?? "—"],
    ["Amount", `${money(Math.abs(t.amount), t.currency ?? "USD")} ${t.amount < 0 ? "in" : "out"}`],
    ["Date", t.date],
    ["Status", t.pending ? "Pending" : "Posted"],
    ["Entity", t.entity_name ?? "Unmapped"],
    ["Category (Books)", t.book_category ?? "—"],
    ["Category (Plaid)", pretty(t.plaid_category)],
    ["Category detail (Plaid)", t.plaid_category_detailed ? pretty(t.plaid_category_detailed) : "—"],
    ["Payment channel", t.payment_channel ?? "—"],
    ["Detected type", t.intercompany ? "intercompany" : t.txn_type],
    ["Your override", t.type_override ?? "—"],
    ["Intercompany class", t.intercompany_class ?? "—"],
    ["Counterparty account", t.counterparty_account_id ?? "—"],
    ["Account ID", t.account_id],
    ["Connection ID", t.item_id],
    ["Transaction ID", t.transaction_id],
    ["Last synced", t.updated_at ? new Date(t.updated_at).toLocaleString() : "—"],
  ];

  return (
    <table className="w-full text-sm min-w-[1020px]">
      <thead>
        <tr className={`text-left text-[11px] uppercase tracking-[0.12em] ${subtle} border-b ${isDark ? "border-white/10" : "border-gray-200"}`}>
          <th className="w-8" />
          <th className="px-2 py-2.5 font-medium">Date</th>
          <th className="px-2 py-2.5 font-medium">Entity</th>
          <th className="px-2 py-2.5 font-medium">Type</th>
          <th className="px-2 py-2.5 font-medium">Description</th>
          <th className="px-2 py-2.5 font-medium">Vendor</th>
          <th className="px-2 py-2.5 font-medium">Account</th>
          <th className="px-2 py-2.5 font-medium text-right">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => {
          const inflow = t.amount < 0;
          const eff = effType(t);
          const vendor = t.merchant_name || t.name;
          const isOpen = open.has(t.transaction_id);
          const cats = t.book_category && !categories.includes(t.book_category)
            ? [t.book_category, ...categories]
            : categories;
          return (
            <Fragment key={t.transaction_id}>
              <tr className={`border-b last:border-b-0 ${border} ${isDark ? "hover:bg-white/[0.02]" : "hover:bg-gray-50"}`}>
                <td className="pl-2">
                  <button
                    onClick={() => toggle(t.transaction_id)}
                    aria-expanded={isOpen}
                    aria-label="Full detail"
                    className={`p-1 rounded cursor-pointer ${subtle} hover:${isDark ? "text-white" : "text-black"}`}
                  >
                    <svg
                      className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`}
                      fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                </td>
                <td className={`px-2 py-2.5 whitespace-nowrap ${subtle}`} title={t.date}>{shortDate(t.date)}</td>
                <td className="px-2 py-2.5 whitespace-nowrap">
                  {t.entity_name ? (
                    <EntityTag name={t.entity_name} isDark={isDark} />
                  ) : (
                    <span className="text-amber-500 text-xs">Unmapped</span>
                  )}
                </td>
                <td className="px-2 py-2.5">
                  {/* On a loan, the movement posts to the loan account — type
                      and account give way to the balance sheet. */}
                  {t.loan_id ? (
                    <span className={`inline-block px-2 py-1 rounded-md text-xs font-medium ${
                      isDark ? "bg-white/[0.06] text-gray-300" : "bg-gray-100 text-gray-700"
                    }`}>
                      {inflow ? "Loan payback" : "Loan advance"}
                    </span>
                  ) : (
                    <Menu
                      value={eff}
                      isDark={isDark}
                      disabled={busy === t.transaction_id}
                      onChange={(v) => void update(t, { type_override: v })}
                      options={[
                        { value: "normal", label: inflow ? "Income" : "Expense", icon: typeIcon("normal", inflow) },
                        { value: "transfer", label: "Transfer", icon: typeIcon("transfer", inflow) },
                        { value: "intercompany", label: "Roll-up", icon: typeIcon("intercompany", inflow) },
                      ]}
                    />
                  )}
                </td>
                <td className={`px-2 py-2.5 max-w-[280px] ${subtle}`} title={t.name ?? undefined}>
                  <span className="truncate block max-w-full">{t.name || "—"}</span>
                </td>
                <td className="px-2 py-2.5 max-w-[200px]">
                  {vendor ? (
                    <button
                      onClick={() => navigate(`/books/vendors?q=${encodeURIComponent(vendor)}`)}
                      title={`See ${vendor} on the Vendors page`}
                      className="font-medium truncate block max-w-full text-left cursor-pointer hover:underline"
                    >
                      {vendor}
                    </button>
                  ) : (
                    <span className="font-medium">—</span>
                  )}
                </td>
                <td className="px-2 py-2.5">
                  {t.loan_id ? (
                    <span className={`inline-block px-2 py-1 rounded-md text-xs ${
                      isDark ? "bg-amber-500/10 text-amber-300" : "bg-amber-50 text-amber-800"
                    }`}>
                      {loans.find((l) => l.id === t.loan_id)?.name ?? "Loan"}
                    </span>
                  ) : (
                    <Menu
                      value={t.book_category ?? ""}
                      isDark={isDark}
                      disabled={busy === t.transaction_id}
                      onChange={(v) => void changeCategory(t, v)}
                      options={[
                        ...(!t.book_category
                          ? [{ value: "", label: pretty(t.plaid_category), hint: "auto", icon: accountIcon("") }]
                          : []),
                        ...cats.map((c) => ({ value: c, label: c, icon: accountIcon(c) })),
                      ]}
                    />
                  )}
                </td>
                <td className="px-2 py-2.5 text-right whitespace-nowrap">
                  <div className={`tabular-nums font-medium ${inflow ? "text-emerald-500" : ""}`}>
                    {inflow ? `+${money(-t.amount, t.currency ?? "USD")}` : money(t.amount, t.currency ?? "USD")}
                  </div>
                  {t.pending && (
                    <div className={`text-[10px] uppercase tracking-wider ${subtle}`}>pending</div>
                  )}
                </td>
              </tr>
              {isOpen && (
                <tr className={`border-b ${border}`}>
                  <td />
                  <td colSpan={7} className="px-2 pb-3 pt-1">
                    <div className={`rounded-lg border p-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3 ${
                      isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-gray-50"
                    }`}>
                      {detail(t).map(([k, v]) => (
                        <div key={k} className="min-w-0">
                          <span className={`text-[10px] uppercase tracking-wider block ${subtle}`}>{k}</span>
                          <span className="text-xs break-all">{v}</span>
                        </div>
                      ))}
                      {loans.length > 0 && (
                        <div className="min-w-0">
                          <span className={`text-[10px] uppercase tracking-wider block mb-1 ${subtle}`}>Loan</span>
                          <Menu
                            value={t.loan_id ?? ""}
                            isDark={isDark}
                            disabled={busy === t.transaction_id}
                            onChange={(v) => void update(t, { loan_id: v || null })}
                            options={[
                              { value: "", label: "Not a loan" },
                              ...loans.map((l) => ({ value: l.id, label: l.name })),
                            ]}
                          />
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
