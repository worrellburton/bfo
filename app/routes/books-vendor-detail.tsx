import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { authFetch } from "../auth";
import { useTheme } from "../theme";
import { type Txn, money, pretty, shortDate, EntityTag } from "../books-shared";

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
 * One vendor, in full: the yearly/monthly shape of the relationship at the
 * top, and the complete transaction ledger — every type, every year —
 * beneath it.
 */
export default function BooksVendorDetail() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [params] = useSearchParams();
  const name = params.get("name") ?? "";

  const [txns, setTxns] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!name) return;
    setLoading(true);
    setError("");
    void (async () => {
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
    })();
  }, [name]);

  const stats = useMemo(() => {
    let paid = 0;
    let received = 0;
    for (const t of txns) {
      if (t.amount > 0) paid += t.amount;
      else received += -t.amount;
    }
    const dates = txns.map((t) => t.date).sort();
    return { paid, received, count: txns.length, first: dates[0] ?? null, last: dates[dates.length - 1] ?? null };
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

      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 mt-2 mb-7">
        <h1 className={`text-2xl font-bold tracking-tight ${isDark ? "" : "text-gray-900"}`}>{name || "Vendor"}</h1>
        {!loading && txns.length > 0 && (
          <div className="flex flex-wrap gap-x-10 gap-y-3">
            {(
              [
                ["Paid", moneyRounded(stats.paid), ""],
                ["Received", stats.received ? `+${moneyRounded(stats.received)}` : "—", stats.received ? "text-emerald-500" : ""],
                ["Transactions", String(stats.count), ""],
                ["Since", stats.first ? shortDate(stats.first) + " " + stats.first.slice(0, 4) : "—", ""],
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

          {/* The complete ledger — every transaction, every type. */}
          <div className={`rounded-2xl border overflow-x-auto rise-in ${card}`}>
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className={`${head} border-b ${border}`}>
                  <th className="px-3 py-2.5 text-left font-medium">Date</th>
                  <th className="px-3 py-2.5 text-left font-medium">Description</th>
                  <th className="px-3 py-2.5 text-left font-medium">Account</th>
                  <th className="px-3 py-2.5 text-left font-medium">Entity</th>
                  <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-3 py-2.5 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let bal = 0;
                  const asc = [...txns].sort(
                    (a, b) => a.date.localeCompare(b.date) || a.transaction_id.localeCompare(b.transaction_id)
                  );
                  const rows = asc.map((t) => {
                    bal += t.amount;
                    return { t, bal };
                  });
                  // Newest on top; the balance still reads as the running total.
                  return rows.reverse().map(({ t, bal: running }) => {
                    const inflow = t.amount < 0;
                    return (
                      <tr key={t.transaction_id} className={`border-t ${rowBorder}`}>
                        <td className={`px-3 py-2 whitespace-nowrap ${subtle}`} title={t.date}>
                          {shortDate(t.date)} <span className={faint}>{t.date.slice(0, 4)}</span>
                        </td>
                        <td className="px-3 py-2 max-w-[340px]" title={t.name ?? undefined}>
                          <span className="truncate block max-w-full">{t.name || "—"}</span>
                        </td>
                        <td className={`px-3 py-2 whitespace-nowrap ${subtle}`}>
                          {t.book_category || pretty(t.plaid_category)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {t.entity_name ? <EntityTag name={t.entity_name} isDark={isDark} /> : <span className={faint}>—</span>}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${inflow ? "text-emerald-500" : ""}`}>
                          {inflow ? `+${money(-t.amount, t.currency ?? "USD")}` : money(t.amount, t.currency ?? "USD")}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium">
                          {money(running, t.currency ?? "USD")}
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
