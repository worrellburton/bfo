import { Fragment, useState } from "react";
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

export function pretty(cat: string | null): string {
  if (!cat) return "Uncategorized";
  const s = cat.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function effType(t: Txn): "normal" | "transfer" | "intercompany" {
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
}: {
  rows: Txn[];
  categories: string[];
  loans?: Array<{ id: string; name: string }>;
  isDark: boolean;
  onRowChange: (t: Txn) => void;
  onError: (message: string) => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const subtle = "text-gray-500";
  const border = isDark ? "border-white/5" : "border-gray-100";
  const select = `px-2 py-1 rounded-md text-xs border cursor-pointer max-w-[160px] ${
    isDark ? "bg-white/[0.04] border-white/10 text-gray-200" : "bg-white border-gray-200 text-gray-800"
  }`;

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
    <table className="w-full text-sm min-w-[900px]">
      <thead>
        <tr className={`text-left text-xs uppercase tracking-wider ${subtle} border-b ${isDark ? "border-white/10" : "border-gray-200"}`}>
          <th className="w-8" />
          <th className="px-2 py-3 font-medium">Date</th>
          <th className="px-2 py-3 font-medium">Description</th>
          <th className="px-2 py-3 font-medium">Entity</th>
          <th className="px-2 py-3 font-medium">Category</th>
          <th className="px-2 py-3 font-medium">Type</th>
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
                <td className={`px-2 py-2.5 whitespace-nowrap tabular-nums ${subtle}`}>{t.date}</td>
                <td className="px-2 py-2.5 max-w-[320px]">
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
                    <span className={`text-[10px] uppercase tracking-wider ${subtle}`}>pending</span>
                  )}
                </td>
                <td className={`px-2 py-2.5 whitespace-nowrap ${t.entity_name ? "" : "text-amber-500"}`}>
                  {t.entity_name || "Unmapped"}
                </td>
                <td className="px-2 py-2.5">
                  <select
                    value={t.book_category ?? ""}
                    disabled={busy === t.transaction_id}
                    onChange={(e) => void update(t, { book_category: e.target.value })}
                    className={select}
                  >
                    {!t.book_category && <option value="">{pretty(t.plaid_category)} (auto)</option>}
                    {cats.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2.5">
                  <select
                    value={eff}
                    disabled={busy === t.transaction_id}
                    onChange={(e) => void update(t, { type_override: e.target.value })}
                    className={select}
                  >
                    <option value="normal">{inflow ? "Income" : "Expense"}</option>
                    <option value="transfer">Transfer</option>
                    <option value="intercompany">Roll-up</option>
                  </select>
                </td>
                <td className={`px-2 py-2.5 text-right whitespace-nowrap tabular-nums font-medium ${inflow ? "text-emerald-500" : ""}`}>
                  {inflow ? `+${money(-t.amount, t.currency ?? "USD")}` : money(t.amount, t.currency ?? "USD")}
                </td>
              </tr>
              {isOpen && (
                <tr className={`border-b ${border}`}>
                  <td />
                  <td colSpan={6} className="px-2 pb-3 pt-1">
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
                          <span className={`text-[10px] uppercase tracking-wider block ${subtle}`}>Loan</span>
                          <select
                            value={t.loan_id ?? ""}
                            disabled={busy === t.transaction_id}
                            onChange={(e) => void update(t, { loan_id: e.target.value || null })}
                            className={select}
                          >
                            <option value="">Not a loan</option>
                            {loans.map((l) => (
                              <option key={l.id} value={l.id}>{l.name}</option>
                            ))}
                          </select>
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
