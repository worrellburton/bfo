import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { authFetch } from "../auth";
import { useTheme } from "../theme";
import { TxnTable, money, type Txn } from "../books-shared";

export function meta() {
  return [{ title: "BFO - Books · Detail" }];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const SECTION_TITLES: Record<string, string> = {
  income: "Income",
  expenses: "Expenses",
  net: "Net",
  transfers: "Transfers",
  intercompany: "Intercompany",
};

/** The transactions behind one P&L cell, editable in place. */
export default function BooksCell() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [params] = useSearchParams();

  const entity = params.get("entity") ?? "all";
  const year = params.get("year") ?? String(new Date().getFullYear());
  const section = params.get("section") ?? "expenses";
  const label = params.get("label");
  const month = params.get("month");

  const [rows, setRows] = useState<Txn[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ report: "cell", entity, year, section });
      if (label != null) qs.set("label", label);
      if (month != null) qs.set("month", month);
      const res = await authFetch(`/api/books/data?${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Couldn't load these transactions.");
      setRows(data.transactions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load these transactions.");
    } finally {
      setLoading(false);
    }
  }, [entity, year, section, label, month]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/books/data?report=meta");
        if (res.ok) setCategories((await res.json()).categories ?? []);
      } catch {
        // dropdown just stays short
      }
    })();
  }, []);

  const subtle = "text-gray-500";
  const card = isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white";

  const inTotal = rows.filter((t) => t.amount < 0).reduce((s, t) => s + -t.amount, 0);
  const outTotal = rows.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);

  const when = month ? `${MONTHS[Number(month) - 1]} ${year}` : year;
  const title = label ?? SECTION_TITLES[section] ?? section;

  return (
    <div className="w-full">
      <Link to="/books/reports" className={`text-sm ${subtle} hover:underline`}>← Profit &amp; loss</Link>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 mt-2 mb-6">
        <div>
          <h1 className={`text-2xl font-bold ${isDark ? "" : "text-gray-900"}`}>{title}</h1>
          <p className={`text-sm mt-1 ${subtle}`}>
            {SECTION_TITLES[section] ?? section} · {when} ·{" "}
            {rows.length} transaction{rows.length === 1 ? "" : "s"} · changes here move the P&amp;L immediately
          </p>
        </div>
        <div className="flex gap-6 text-sm">
          {inTotal > 0 && (
            <span>
              In <span className="font-semibold text-emerald-500 tabular-nums">+{money(inTotal)}</span>
            </span>
          )}
          {outTotal > 0 && (
            <span>
              Out <span className="font-semibold tabular-nums">{money(outTotal)}</span>
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-700"}`}>
          {error}
        </div>
      )}

      <div className={`rounded-xl border overflow-x-auto ${card}`}>
        {loading ? (
          <p className={`px-4 py-8 text-center text-sm ${subtle}`}>Loading…</p>
        ) : rows.length === 0 ? (
          <p className={`px-4 py-8 text-center text-sm ${subtle}`}>Nothing behind this cell.</p>
        ) : (
          <TxnTable
            rows={rows}
            categories={categories}
            isDark={isDark}
            onRowChange={() => void load()}
            onError={setError}
            onReload={() => void load()}
          />
        )}
      </div>
    </div>
  );
}
