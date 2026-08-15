import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { authFetch } from "../auth";
import { useTheme } from "../theme";
import { type Txn, TxnTable, Menu, BatchBar, shortDate, accountIcon, accountGroup, typeIcon } from "../books-shared";

export function meta() {
  return [{ title: "BFO - Books · Vendor" }];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function moneyRounded(n: number): string {
  if (Math.round(n) === 0) return "—";
  const v = Math.abs(Math.round(n)).toLocaleString("en-US");
  return n < 0 ? `($${v})` : `$${v}`;
}

/**
 * One vendor, in full: rename it, set the account its spend defaults to,
 * see the yearly/monthly shape, and work the complete editable ledger.
 */
export default function BooksVendorDetail() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const name = params.get("name") ?? "";

  const [txns, setTxns] = useState<Txn[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loans, setLoans] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);

  async function load() {
    if (!name) return;
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ report: "transactions", q: name, limit: "500" });
      const res = await authFetch(`/api/books/data?${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Couldn't load this vendor.");
      // Exact vendor identity only — the search is a substring match.
      setTxns(((data.transactions ?? []) as Txn[]).filter((t) => (t.merchant_name || t.name) === name));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load this vendor.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/books/data?report=meta");
        if (res.ok) {
          const data = await res.json();
          setCategories(data.categories ?? []);
          setLoans(data.loans ?? []);
        }
      } catch {
        // pickers just stay short
      }
    })();
  }, []);

  useEffect(() => {
    if (editingName) nameInput.current?.focus();
  }, [editingName]);

  /** Rename / default-account changes ride one endpoint: rule + backfill. */
  async function saveSettings(patch: { vendor_name?: string; book_category?: string; type_override?: string }) {
    setSaving(true);
    setError("");
    try {
      const res = await authFetch("/api/books/data", {
        method: "POST",
        body: JSON.stringify({ action: "vendor_settings", match: name, ...patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Couldn't save that.");
      if (patch.vendor_name && patch.vendor_name !== name) {
        navigate(`/books/vendors/detail?name=${encodeURIComponent(patch.vendor_name)}`, { replace: true });
      } else {
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setSaving(false);
    }
  }

  const stats = useMemo(() => {
    let paid = 0;
    let received = 0;
    for (const t of txns) {
      if (t.amount > 0) paid += t.amount;
      else received += -t.amount;
    }
    const dates = txns.map((t) => t.date).sort();
    return { paid, received, count: txns.length, first: dates[0] ?? null };
  }, [txns]);

  // Year × month net movement (outflows positive), newest year first.
  const matrix = useMemo(() => {
    const byYear = new Map<string, number[]>();
    for (const t of txns) {
      const y = t.date.slice(0, 4);
      const m = Number(t.date.slice(5, 7)) - 1;
      const row = byYear.get(y) ?? (Array(12).fill(0) as number[]);
      row[m] += t.amount;
      byYear.set(y, row);
    }
    return [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [txns]);

  // Newest-first rows for the table; the balance accumulates oldest-first.
  const { ordered, balances } = useMemo(() => {
    const asc = [...txns].sort(
      (a, b) => a.date.localeCompare(b.date) || a.transaction_id.localeCompare(b.transaction_id)
    );
    let bal = 0;
    const map: Record<string, number> = {};
    for (const t of asc) {
      bal += t.amount;
      map[t.transaction_id] = bal;
    }
    return { ordered: [...asc].reverse(), balances: map };
  }, [txns]);

  // The type most of this vendor's rows carry — the "default".
  const defaultType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of txns) {
      const eff = t.type_override ?? (t.intercompany ? "intercompany" : t.txn_type === "transfer" ? "transfer" : "normal");
      counts.set(eff, (counts.get(eff) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "normal";
  }, [txns]);

  // The account most of this vendor's rows sit in — the "default".
  const defaultAccount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of txns) {
      if (t.book_category) counts.set(t.book_category, (counts.get(t.book_category) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }, [txns]);

  const subtle = "text-gray-500";
  const faint = isDark ? "text-gray-700" : "text-gray-300";
  const card = isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white";
  const border = isDark ? "border-white/10" : "border-gray-200";
  const rowBorder = isDark ? "border-white/5" : "border-gray-100";
  const head = `text-[11px] uppercase tracking-[0.12em] ${subtle}`;
  const num = "px-3 py-2 text-right whitespace-nowrap tabular-nums";

  return (
    <div className="w-full">
      <Link to="/books/vendors" className={`text-sm ${subtle} hover:underline`}>← Vendors</Link>

      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3 mt-2 mb-7">
        <div className="min-w-0 max-w-3xl">
          {editingName ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setEditingName(false);
                if (nameDraft.trim() && nameDraft.trim() !== name) void saveSettings({ vendor_name: nameDraft.trim() });
              }}
            >
              <input
                ref={nameInput}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => {
                  setEditingName(false);
                  if (nameDraft.trim() && nameDraft.trim() !== name) void saveSettings({ vendor_name: nameDraft.trim() });
                }}
                maxLength={80}
                className={`w-full bg-transparent border-b text-2xl font-bold tracking-tight focus:outline-none ${
                  isDark ? "border-white/25 focus:border-white/60 text-white" : "border-gray-300 focus:border-gray-500 text-gray-900"
                }`}
              />
            </form>
          ) : (
            <button
              onClick={() => {
                setNameDraft(name);
                setEditingName(true);
              }}
              title="Rename this vendor"
              className="group flex items-center gap-2.5 text-left cursor-pointer max-w-full"
            >
              <h1 className={`text-2xl font-bold tracking-tight truncate ${isDark ? "" : "text-gray-900"}`}>
                {name || "Vendor"}
              </h1>
              <svg
                className={`w-4 h-4 shrink-0 transition-colors ${isDark ? "text-gray-600 group-hover:text-gray-300" : "text-gray-300 group-hover:text-gray-600"}`}
                fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
            </button>
          )}
          {/* The account and type new arrivals from this vendor default into. */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-2">
            <span className="inline-flex items-center gap-2">
              <span className={`text-[11px] uppercase tracking-wider ${subtle}`}>Default account</span>
              <Menu
                value={defaultAccount}
                isDark={isDark}
                disabled={saving || loading}
                onChange={(v) => void saveSettings({ book_category: v })}
                options={categories.map((c) => ({
                  value: c,
                  label: c,
                  short: c.replace(/^\d{4}\s+/, ""),
                  icon: accountIcon(c),
                  group: accountGroup(c),
                }))}
              />
            </span>
            <span className="inline-flex items-center gap-2">
              <span className={`text-[11px] uppercase tracking-wider ${subtle}`}>Default type</span>
              <Menu
                value={defaultType}
                isDark={isDark}
                disabled={saving || loading}
                onChange={(v) => void saveSettings({ type_override: v })}
                options={[
                  { value: "normal", label: "Income / Expense", icon: typeIcon("normal", false) },
                  { value: "transfer", label: "Transfer", icon: typeIcon("transfer", false) },
                  { value: "intercompany", label: "Roll-up", icon: typeIcon("intercompany", false) },
                ]}
              />
            </span>
          </div>
        </div>

        {!loading && txns.length > 0 && (
          <div className="flex flex-wrap gap-x-10 gap-y-3">
            {(
              [
                ["Paid", moneyRounded(stats.paid), ""],
                ["Received", stats.received ? `+${moneyRounded(stats.received)}` : "—", stats.received ? "text-emerald-500" : ""],
                ["Transactions", String(stats.count), ""],
                ["Since", stats.first ? `${shortDate(stats.first)} ${stats.first.slice(0, 4)}` : "—", ""],
              ] as const
            ).map(([label, value, tone]) => (
              <div key={label}>
                <p className={`text-[11px] uppercase tracking-wider mb-0.5 ${subtle}`}>{label}</p>
                <p className={`text-lg font-semibold tabular-nums tracking-tight ${tone}`}>{value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-700"}`}>
          {error}
        </div>
      )}

      {loading ? (
        <div className={`rounded-2xl border p-4 space-y-2.5 rise-in ${card}`}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="shimmer h-4" style={{ width: `${95 - (i % 3) * 10}%` }} />
          ))}
        </div>
      ) : txns.length === 0 ? (
        <p className={`text-sm ${subtle}`}>No transactions found for this vendor.</p>
      ) : (
        <>
          {/* Monthly shape, one row per year. */}
          <div className={`rounded-2xl border overflow-x-auto mb-6 rise-in ${card}`}>
            <table className="text-sm min-w-[900px] w-full">
              <thead>
                <tr className={`${head} border-b ${border}`}>
                  <th className="px-3 py-2.5 text-left font-medium">Year</th>
                  {MONTHS.map((m) => (
                    <th key={m} className="px-3 py-2.5 text-right font-medium">{m}</th>
                  ))}
                  <th className={`px-3 py-2.5 text-right font-medium border-l ${rowBorder}`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map(([year, monthly]) => (
                  <tr key={year} className={`border-t ${rowBorder}`}>
                    <td className={`px-3 py-2 font-medium ${subtle}`}>{year}</td>
                    {monthly.map((v, i) => (
                      <td key={i} className={`${num} ${v === 0 ? faint : ""}`}>{moneyRounded(v)}</td>
                    ))}
                    <td className={`${num} font-semibold border-l ${rowBorder}`}>
                      {moneyRounded(monthly.reduce((s, v) => s + v, 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* The complete ledger — editable, with the full-detail drawer. */}
          <div className={`rounded-2xl border overflow-x-auto rise-in ${card}`}>
            <TxnTable
              rows={ordered}
              categories={categories}
              loans={loans}
              isDark={isDark}
              balances={balances}
              selection={{
                selected,
                toggle: (id) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    next.has(id) ? next.delete(id) : next.add(id);
                    return next;
                  }),
                setAll: (ids) => setSelected(new Set(ids)),
                selectMany: (ids, on) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    for (const id of ids) on ? next.add(id) : next.delete(id);
                    return next;
                  }),
              }}
              onRowChange={(t) =>
                setTxns((prev) => prev.map((x) => (x.transaction_id === t.transaction_id ? { ...t, entity_id: x.entity_id, entity_name: x.entity_name } : x)))
              }
              onError={setError}
              onReload={() => void load()}
            />
          </div>
        </>
      )}
      <BatchBar
        count={selected.size}
        isDark={isDark}
        busy={saving}
        onApply={(patch) => {
          setSaving(true);
          void authFetch("/api/books/data", {
            method: "POST",
            body: JSON.stringify({ action: "batch_update", transaction_ids: [...selected], ...patch }),
          })
            .then(async (res) => {
              if (!res.ok) throw new Error("Couldn't apply that batch edit.");
              setSelected(new Set());
              await load();
            })
            .catch((err) => setError(err instanceof Error ? err.message : "Couldn't apply that batch edit."))
            .finally(() => setSaving(false));
        }}
        onClear={() => setSelected(new Set())}
      />
    </div>
  );
}
