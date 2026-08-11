import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../auth";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Books · Transactions" }];
}

type Txn = {
  transaction_id: string;
  date: string;
  name: string | null;
  merchant_name: string | null;
  amount: number;
  pending: boolean;
  plaid_category: string | null;
  txn_type: string;
  intercompany: boolean;
  intercompany_class: string | null;
  entity_id: string | null;
  entity_name: string | null;
};

type Entity = { id: string; name: string };

const PAGE = 100;

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function pretty(cat: string | null): string {
  if (!cat) return "—";
  const s = cat.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function BooksTransactions() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [rows, setRows] = useState<Txn[]>([]);
  const [total, setTotal] = useState(0);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  const [q, setQ] = useState("");
  const [entity, setEntity] = useState("all");
  const [type, setType] = useState<"all" | "transfers" | "intercompany">("all");
  const [year, setYear] = useState("all");

  const query = useCallback(
    (offset: number) => {
      const params = new URLSearchParams({ report: "transactions", limit: String(PAGE), offset: String(offset) });
      if (entity !== "all") params.set("entity", entity);
      if (type !== "all") params.set("type", type);
      if (year !== "all") params.set("year", year);
      if (q.trim()) params.set("q", q.trim());
      return `/api/books/data?${params}`;
    },
    [entity, type, year, q]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch(query(0));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Couldn't load transactions.");
      setRows(data.transactions ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load transactions.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/books/data?report=meta");
        if (!res.ok) return;
        const data = await res.json();
        setEntities(data.entities ?? []);
        setLastSynced(data.last_synced_at ?? null);
      } catch {
        // meta is decoration
      }
    })();
  }, []);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await authFetch(query(rows.length));
      const data = await res.json().catch(() => ({}));
      if (res.ok) setRows((prev) => [...prev, ...(data.transactions ?? [])]);
    } finally {
      setLoadingMore(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    setError("");
    try {
      const res = await authFetch("/api/cron/books-sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Sync failed.");
      setLastSynced(new Date().toISOString());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  const subtle = "text-gray-500";
  const card = isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white";
  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
      active
        ? isDark
          ? "bg-white/15 text-white"
          : "bg-gray-900 text-white"
        : isDark
          ? "bg-white/[0.04] text-gray-400 hover:text-white"
          : "bg-gray-100 text-gray-600 hover:text-gray-900"
    }`;
  const field = `px-3 py-2 rounded-lg text-sm border cursor-pointer ${
    isDark ? "bg-white/[0.04] border-white/10 text-white" : "bg-white border-gray-200 text-gray-900"
  }`;

  const years = [0, 1, 2].map((d) => String(new Date().getFullYear() - d));

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className={`text-2xl font-bold ${isDark ? "" : "text-gray-900"}`}>Transactions</h1>
          <p className={`text-sm mt-1 ${subtle}`}>
            Every bank transaction across the family, synced nightly from Plaid.
            {lastSynced && ` Last synced ${new Date(lastSynced).toLocaleString()}.`}
          </p>
        </div>
        <button
          onClick={() => void syncNow()}
          disabled={syncing}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 ${
            isDark ? "bg-white/10 hover:bg-white/15 text-white" : "bg-gray-900 hover:bg-gray-800 text-white"
          }`}
        >
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search descriptions…"
          className={`${field} cursor-text min-w-[200px]`}
        />
        <select value={entity} onChange={(e) => setEntity(e.target.value)} className={field}>
          <option value="all">All entities</option>
          <option value="unmapped">Unmapped</option>
          {entities.map((en) => (
            <option key={en.id} value={en.id}>{en.name}</option>
          ))}
        </select>
        <select value={year} onChange={(e) => setYear(e.target.value)} className={field}>
          <option value="all">All time</option>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <div className="flex gap-1.5">
          <button className={chip(type === "all")} onClick={() => setType("all")}>All</button>
          <button className={chip(type === "transfers")} onClick={() => setType("transfers")}>Transfers</button>
          <button className={chip(type === "intercompany")} onClick={() => setType("intercompany")}>Intercompany</button>
        </div>
        {!loading && (
          <span className={`text-xs ml-auto ${subtle}`}>
            {rows.length} of {total.toLocaleString()}
          </span>
        )}
      </div>

      {error && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-700"}`}>
          {error}
        </div>
      )}

      <div className={`rounded-xl border overflow-x-auto ${card}`}>
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className={`text-left text-xs uppercase tracking-wider ${subtle} border-b ${isDark ? "border-white/10" : "border-gray-200"}`}>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3 font-medium">Entity</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className={`px-4 py-8 text-center ${subtle}`}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className={`px-4 py-8 text-center ${subtle}`}>
                  No transactions yet — hit “Sync now” to pull history from Plaid.
                </td>
              </tr>
            ) : (
              rows.map((t) => {
                const inflow = t.amount < 0;
                return (
                  <tr
                    key={t.transaction_id}
                    className={`border-b last:border-b-0 ${isDark ? "border-white/5 hover:bg-white/[0.02]" : "border-gray-100 hover:bg-gray-50"}`}
                  >
                    <td className={`px-4 py-2.5 whitespace-nowrap tabular-nums ${subtle}`}>{t.date}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{t.merchant_name || t.name || "—"}</span>
                      {t.pending && (
                        <span className={`ml-2 text-[10px] uppercase tracking-wider ${subtle}`}>pending</span>
                      )}
                      {t.intercompany ? (
                        <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${isDark ? "bg-violet-500/15 text-violet-300" : "bg-violet-50 text-violet-700"}`}>
                          {t.intercompany_class || "transfer"}
                        </span>
                      ) : t.txn_type === "transfer" ? (
                        <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${isDark ? "bg-sky-500/15 text-sky-300" : "bg-sky-50 text-sky-700"}`}>
                          transfer
                        </span>
                      ) : null}
                    </td>
                    <td className={`px-4 py-2.5 whitespace-nowrap ${t.entity_name ? "" : "text-amber-500"}`}>
                      {t.entity_name || "Unmapped"}
                    </td>
                    <td className={`px-4 py-2.5 whitespace-nowrap ${subtle}`}>{pretty(t.plaid_category)}</td>
                    <td className={`px-4 py-2.5 text-right whitespace-nowrap tabular-nums font-medium ${inflow ? "text-emerald-500" : ""}`}>
                      {inflow ? `+${money(-t.amount)}` : money(t.amount)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!loading && rows.length < total && (
        <button
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className={`mt-4 px-4 py-2 rounded-lg text-sm transition-colors cursor-pointer disabled:opacity-50 ${
            isDark ? "bg-white/[0.06] hover:bg-white/10 text-gray-300" : "bg-gray-100 hover:bg-gray-200 text-gray-700"
          }`}
        >
          {loadingMore ? "Loading…" : `Load ${Math.min(PAGE, total - rows.length)} more`}
        </button>
      )}
    </div>
  );
}
