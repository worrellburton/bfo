import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../auth";
import { useTheme } from "../theme";
import { TxnTable, Menu, entityTag, entityTagClass, type Txn } from "../books-shared";

export function meta() {
  return [{ title: "BFO - Books · Transactions" }];
}

type Entity = { id: string; name: string };

const PAGE = 100;

export default function BooksTransactions() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [rows, setRows] = useState<Txn[]>([]);
  const [total, setTotal] = useState(0);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
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
        setCategories(data.categories ?? []);
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
  const searchField = `px-4 py-2 rounded-full text-sm border cursor-text min-w-[220px] ${
    isDark ? "bg-white/[0.04] border-white/10 text-white" : "bg-white border-gray-200 text-gray-900"
  }`;

  const years = [0, 1, 2].map((d) => String(new Date().getFullYear() - d));

  const entityTagIcon = (name: string) => (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide ${entityTagClass(name, isDark)}`}>
      {entityTag(name)}
    </span>
  );

  return (
    <div className="w-full">
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
          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 ${
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
          className={searchField}
        />
        <Menu
          value={entity}
          isDark={isDark}
          onChange={setEntity}
          options={[
            { value: "all", label: "All entities" },
            { value: "unmapped", label: "Unmapped" },
            ...entities.map((en) => ({ value: en.id, label: en.name, icon: entityTagIcon(en.name) })),
          ]}
        />
        <Menu
          value={year}
          isDark={isDark}
          onChange={setYear}
          options={[{ value: "all", label: "All time" }, ...years.map((y) => ({ value: y, label: y }))]}
        />
        <div className="flex gap-1.5">
          <button className={chip(type === "all")} onClick={() => setType("all")}>All</button>
          <button className={chip(type === "transfers")} onClick={() => setType("transfers")}>Transfers</button>
          <button className={chip(type === "intercompany")} onClick={() => setType("intercompany")}>Roll-up</button>
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
        {loading ? (
          <p className={`px-4 py-8 text-center text-sm ${subtle}`}>Loading…</p>
        ) : rows.length === 0 ? (
          <p className={`px-4 py-8 text-center text-sm ${subtle}`}>
            No transactions here — adjust the filters, or hit “Sync now” to pull from Plaid.
          </p>
        ) : (
          <TxnTable
            rows={rows}
            categories={categories}
            isDark={isDark}
            onRowChange={(t) =>
              setRows((prev) => prev.map((r) => (r.transaction_id === t.transaction_id ? t : r)))
            }
            onError={setError}
            onReload={() => void load()}
          />
        )}
      </div>

      {!loading && rows.length < total && (
        <button
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className={`mt-4 px-4 py-2 rounded-full text-sm transition-colors cursor-pointer disabled:opacity-50 ${
            isDark ? "bg-white/[0.06] hover:bg-white/10 text-gray-300" : "bg-gray-100 hover:bg-gray-200 text-gray-700"
          }`}
        >
          {loadingMore ? "Loading…" : `Load ${Math.min(PAGE, total - rows.length)} more`}
        </button>
      )}
    </div>
  );
}
