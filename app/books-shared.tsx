import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
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

type Option = { value: string; label: string; hint?: string };

/**
 * A fully custom dropdown — a rounded pill trigger and a themed popover list
 * with a checkmark on the current choice. Rendered through a portal with fixed
 * positioning so it escapes the table's horizontal scroll box (a native
 * <select>'s option list can't be styled, and an absolutely-positioned menu
 * would be clipped by the overflow container).
 */
function Menu({
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
        <tr className={`text-left text-xs uppercase tracking-wider ${subtle} border-b ${isDark ? "border-white/10" : "border-gray-200"}`}>
          <th className="w-8" />
          <th className="px-2 py-3 font-medium">Date</th>
          <th className="px-2 py-3 font-medium">Entity</th>
          <th className="px-2 py-3 font-medium">Type</th>
          <th className="px-2 py-3 font-medium">Description</th>
          <th className="px-2 py-3 font-medium">Vendor</th>
          <th className="px-2 py-3 font-medium">Account</th>
          <th className="px-2 py-3 font-medium text-right">Amount</th>
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
                <td className={`px-2 py-2.5 whitespace-nowrap ${t.entity_name ? "" : "text-amber-500"}`}>
                  {t.entity_name || "Unmapped"}
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
                        { value: "normal", label: inflow ? "Income" : "Expense" },
                        { value: "transfer", label: "Transfer" },
                        { value: "intercompany", label: "Roll-up" },
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
                  {t.pending && (
                    <span className={`ml-2 text-[10px] uppercase tracking-wider ${subtle}`}>pending</span>
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
                          ? [{ value: "", label: pretty(t.plaid_category), hint: "auto" }]
                          : []),
                        ...cats.map((c) => ({ value: c, label: c })),
                      ]}
                    />
                  )}
                </td>
                <td className={`px-2 py-2.5 text-right whitespace-nowrap tabular-nums font-medium ${inflow ? "text-emerald-500" : ""}`}>
                  {inflow ? `+${money(-t.amount, t.currency ?? "USD")}` : money(t.amount, t.currency ?? "USD")}
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
