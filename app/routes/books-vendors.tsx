import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { authFetch } from "../auth";
import { useTheme } from "../theme";
import { TxnTable, type Txn } from "../books-shared";

export function meta() {
  return [{ title: "BFO - Books · Vendors" }];
}

type Vendor = {
  vendor: string;
  count: number;
  monthly: number[];
  spent: number;
  received: number;
  last_date: string;
  entities: string[];
};

type Entity = { id: string; name: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function money(n: number): string {
  if (Math.round(n) === 0) return "—";
  return "$" + Math.round(n).toLocaleString("en-US");
}

/** Every vendor and their monthly spend — the family's outflows by counterparty. */
export default function BooksVendors() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [searchParams, setSearchParams] = useSearchParams();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loans, setLoans] = useState<Array<{ id: string; name: string }>>([]);
  const [entity, setEntity] = useState("all");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Per-vendor drill-down: which row is open, and its lazily-loaded transactions.
  const [openVendor, setOpenVendor] = useState<string | null>(null);
  const [vendorTxns, setVendorTxns] = useState<Record<string, Txn[]>>({});
  const [txnLoading, setTxnLoading] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/books/data?report=meta");
        if (res.ok) {
          const data = await res.json();
          setEntities(data.entities ?? []);
          setCategories(data.categories ?? []);
          setLoans(data.loans ?? []);
        }
      } catch {
        // filter just stays short
      }
    })();
  }, []);

  useEffect(() => {
    setLoading(true);
    setError("");
    // Filters changed — cached drill-downs no longer apply.
    setOpenVendor(null);
    setVendorTxns({});
    void (async () => {
      try {
        const params = new URLSearchParams({ report: "vendors", year });
        if (entity !== "all") params.set("entity", entity);
        const res = await authFetch(`/api/books/data?${params}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.message || "Couldn't load vendors.");
        setVendors(data.vendors ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load vendors.");
      } finally {
        setLoading(false);
      }
    })();
  }, [entity, year]);

  async function toggleVendor(name: string) {
    if (openVendor === name) {
      setOpenVendor(null);
      return;
    }
    setOpenVendor(name);
    if (vendorTxns[name]) return; // already loaded
    setTxnLoading(name);
    try {
      const params = new URLSearchParams({ report: "transactions", q: name, year, limit: "500" });
      if (entity !== "all") params.set("entity", entity);
      const res = await authFetch(`/api/books/data?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Couldn't load transactions.");
      // The vendor key is merchant_name || name; keep only exact matches so a
      // substring search doesn't fold in a different vendor.
      const list = (data.transactions ?? []).filter((t: Txn) => (t.merchant_name || t.name) === name);
      setVendorTxns((prev) => ({ ...prev, [name]: list }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load transactions.");
    } finally {
      setTxnLoading(null);
    }
  }

  const patchTxn = (name: string) => (t: Txn) =>
    setVendorTxns((prev) => ({
      ...prev,
      [name]: (prev[name] ?? []).map((x) => (x.transaction_id === t.transaction_id ? t : x)),
    }));

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return vendors;
    return vendors.filter((v) => v.vendor.toLowerCase().includes(needle));
  }, [vendors, q]);

  const totals = useMemo(() => {
    const monthly = Array(12).fill(0) as number[];
    let spent = 0;
    for (const v of shown) {
      spent += v.spent;
      v.monthly.forEach((m, i) => (monthly[i] += m));
    }
    return { monthly, spent };
  }, [shown]);

  const subtle = "text-gray-500";
  const card = isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white";
  const border = isDark ? "border-white/10" : "border-gray-200";
  const rowBorder = isDark ? "border-white/5" : "border-gray-100";
  const stickyBg = isDark ? "bg-[#0b0b0b]" : "bg-white";
  const drawerBg = isDark ? "bg-white/[0.015]" : "bg-gray-50/70";
  const field = `px-3 py-2 rounded-lg text-sm border ${
    isDark ? "bg-white/[0.04] border-white/10 text-white" : "bg-white border-gray-200 text-gray-900"
  }`;
  const num = "px-2.5 py-2 text-right whitespace-nowrap tabular-nums";

  const years = [0, 1].map((d) => String(new Date().getFullYear() - d));

  return (
    <div className="w-full">
      <div className="mb-6">
        <h1 className={`text-2xl font-bold ${isDark ? "" : "text-gray-900"}`}>Vendors</h1>
        <p className={`text-sm mt-1 ${subtle}`}>
          Who the family pays, month by month — built automatically from transactions; transfers
          and intercompany movements excluded.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSearchParams(e.target.value ? { q: e.target.value } : {}, { replace: true });
          }}
          placeholder="Search vendors…"
          className={`${field} min-w-[200px]`}
        />
        <select value={entity} onChange={(e) => setEntity(e.target.value)} className={`${field} cursor-pointer`}>
          <option value="all">All entities</option>
          {entities.map((en) => (
            <option key={en.id} value={en.id}>{en.name}</option>
          ))}
        </select>
        <select value={year} onChange={(e) => setYear(e.target.value)} className={`${field} cursor-pointer`}>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        {!loading && <span className={`text-xs ml-auto ${subtle}`}>{shown.length} vendors</span>}
      </div>

      {error && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-700"}`}>
          {error}
        </div>
      )}

      <div className={`rounded-xl border overflow-x-auto ${card}`}>
        <table className="text-sm min-w-[1050px] w-full">
          <thead>
            <tr className={`text-xs uppercase tracking-wider ${subtle} border-b ${border}`}>
              <th className={`px-3 py-3 text-left font-medium sticky left-0 ${stickyBg}`}>Vendor</th>
              {MONTHS.map((m) => (
                <th key={m} className="px-2.5 py-3 text-right font-medium">{m}</th>
              ))}
              <th className="px-2.5 py-3 text-right font-medium">Total</th>
              <th className="px-2.5 py-3 text-right font-medium">In</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={15} className={`px-4 py-8 text-center ${subtle}`}>Loading…</td></tr>
            ) : shown.length === 0 ? (
              <tr>
                <td colSpan={15} className={`px-4 py-8 text-center ${subtle}`}>
                  No vendors match — sync transactions on the Transactions page first.
                </td>
              </tr>
            ) : (
              <>
                {shown.map((v) => {
                  const isOpen = openVendor === v.vendor;
                  const txns = vendorTxns[v.vendor];
                  return (
                    <Fragment key={v.vendor}>
                      <tr className={`border-t ${rowBorder} ${isDark ? "hover:bg-white/[0.02]" : "hover:bg-gray-50"}`}>
                        <td
                          className={`px-3 py-2 sticky left-0 max-w-[260px] ${stickyBg}`}
                          title={v.entities.length ? `${v.count} transactions · ${v.entities.join(", ")}` : `${v.count} transactions`}
                        >
                          <button
                            onClick={() => void toggleVendor(v.vendor)}
                            aria-expanded={isOpen}
                            className="flex items-center gap-1.5 text-left cursor-pointer max-w-full group"
                          >
                            <svg
                              className={`w-3.5 h-3.5 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""} ${subtle}`}
                              fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                            </svg>
                            <span className="font-medium truncate group-hover:underline">{v.vendor}</span>
                          </button>
                        </td>
                        {v.monthly.map((m, i) => (
                          <td key={i} className={`${num} ${m === 0 ? subtle : ""}`}>{money(m)}</td>
                        ))}
                        <td className={`${num} font-semibold`}>{money(v.spent)}</td>
                        <td className={`${num} ${v.received ? "text-emerald-500" : subtle}`}>
                          {v.received ? `+${money(v.received)}` : "—"}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={15} className={`px-3 pb-4 pt-1 ${drawerBg}`}>
                            {txnLoading === v.vendor && !txns ? (
                              <p className={`text-sm py-3 ${subtle}`}>Loading transactions…</p>
                            ) : txns && txns.length > 0 ? (
                              <div className={`rounded-lg border overflow-x-auto ${border}`}>
                                <TxnTable
                                  rows={txns}
                                  categories={categories}
                                  loans={loans}
                                  isDark={isDark}
                                  onRowChange={patchTxn(v.vendor)}
                                  onError={setError}
                                />
                              </div>
                            ) : (
                              <p className={`text-sm py-3 ${subtle}`}>No transactions found for this vendor.</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                <tr className={`border-t font-semibold ${border}`}>
                  <td className={`px-3 py-2 sticky left-0 ${stickyBg}`}>Total</td>
                  {totals.monthly.map((m, i) => (
                    <td key={i} className={num}>{money(m)}</td>
                  ))}
                  <td className={num}>{money(totals.spent)}</td>
                  <td className={num} />
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
