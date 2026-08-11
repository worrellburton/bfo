import { useEffect, useMemo, useState } from "react";
import { authFetch } from "../auth";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Books · Vendors" }];
}

type Vendor = {
  vendor: string;
  count: number;
  spent: number;
  received: number;
  last_date: string;
  entities: string[];
};

type Entity = { id: string; name: string };

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function BooksVendors() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entity, setEntity] = useState("all");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/books/data?report=meta");
        if (res.ok) setEntities((await res.json()).entities ?? []);
      } catch {
        // filter just stays short
      }
    })();
  }, []);

  useEffect(() => {
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const params = new URLSearchParams({ report: "vendors" });
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
  }, [entity]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return vendors;
    return vendors.filter((v) => v.vendor.toLowerCase().includes(needle));
  }, [vendors, q]);

  const subtle = "text-gray-500";
  const card = isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white";
  const field = `px-3 py-2 rounded-lg text-sm border ${
    isDark ? "bg-white/[0.04] border-white/10 text-white" : "bg-white border-gray-200 text-gray-900"
  }`;

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className={`text-2xl font-bold ${isDark ? "" : "text-gray-900"}`}>Vendors</h1>
        <p className={`text-sm mt-1 ${subtle}`}>
          Built automatically from merchant activity over the last 24 months — transfers excluded.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search vendors…"
          className={`${field} min-w-[200px]`}
        />
        <select value={entity} onChange={(e) => setEntity(e.target.value)} className={`${field} cursor-pointer`}>
          <option value="all">All entities</option>
          {entities.map((en) => (
            <option key={en.id} value={en.id}>{en.name}</option>
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
        <table className="w-full text-sm min-w-[680px]">
          <thead>
            <tr className={`text-left text-xs uppercase tracking-wider ${subtle} border-b ${isDark ? "border-white/10" : "border-gray-200"}`}>
              <th className="px-4 py-3 font-medium">Vendor</th>
              <th className="px-4 py-3 font-medium">Entities</th>
              <th className="px-4 py-3 font-medium text-right">Transactions</th>
              <th className="px-4 py-3 font-medium text-right">Spent</th>
              <th className="px-4 py-3 font-medium text-right">Received</th>
              <th className="px-4 py-3 font-medium text-right">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className={`px-4 py-8 text-center ${subtle}`}>Loading…</td></tr>
            ) : shown.length === 0 ? (
              <tr>
                <td colSpan={6} className={`px-4 py-8 text-center ${subtle}`}>
                  No vendors yet — sync transactions on the Transactions page first.
                </td>
              </tr>
            ) : (
              shown.map((v) => (
                <tr
                  key={v.vendor}
                  className={`border-b last:border-b-0 ${isDark ? "border-white/5 hover:bg-white/[0.02]" : "border-gray-100 hover:bg-gray-50"}`}
                >
                  <td className="px-4 py-2.5 font-medium">{v.vendor}</td>
                  <td className={`px-4 py-2.5 text-xs ${subtle}`}>{v.entities.join(", ") || "—"}</td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${subtle}`}>{v.count}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">{v.spent ? money(v.spent) : "—"}</td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${v.received ? "text-emerald-500" : subtle}`}>
                    {v.received ? money(v.received) : "—"}
                  </td>
                  <td className={`px-4 py-2.5 text-right whitespace-nowrap tabular-nums ${subtle}`}>{v.last_date}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
