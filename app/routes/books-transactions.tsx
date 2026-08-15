import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../auth";
import { useTheme } from "../theme";
import { TxnTable, Menu, entityTag, entityTagClass, type Txn } from "../books-shared";

export function meta() {
  return [{ title: "BFO - Books · Transactions" }];
}

type Entity = { id: string; name: string };
type BankAccount = { account_id: string; name: string; official_name: string | null; nickname: string | null; mask: string | null; institution_name: string };

const PAGE = 100;

/** Tiny CSV parser: quoted fields, commas, CRLF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

/** "8/7/2025" | "2025-08-07" → "2025-08-07" (null if unparseable). */
function toIsoDate(s: string): string | null {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yyyy}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/**
 * Normalize a parsed CSV into {date, description, amount} rows. Understands
 * Wells Fargo's headerless export (Date, Amount, *, blank, Description) and
 * any headered file with date/amount/description-ish columns.
 */
function normalizeCsv(rows: string[][]): Array<{ date: string; description: string; amount: number }> {
  if (!rows.length) return [];
  const first = rows[0].map((v) => v.trim().toLowerCase());
  const hasHeader = first.some((v) => /date|amount|description|memo|payee/.test(v)) && !toIsoDate(rows[0][0] ?? "");
  const body = hasHeader ? rows.slice(1) : rows;
  let di = 0, ai = 1, ti = 4; // Wells Fargo default layout
  if (hasHeader) {
    di = first.findIndex((v) => v.includes("date"));
    ai = first.findIndex((v) => v.includes("amount"));
    ti = first.findIndex((v) => /description|memo|payee|name/.test(v));
    if (di < 0 || ai < 0) return [];
    if (ti < 0) ti = first.length - 1;
  }
  return body.flatMap((r) => {
    const date = toIsoDate(r[di] ?? "");
    const amount = Number(String(r[ai] ?? "").replace(/[$,]/g, ""));
    const description = (r[ti] ?? "").trim();
    if (!date || !Number.isFinite(amount) || amount === 0) return [];
    return [{ date, description, amount }];
  });
}

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
  const [type, setType] = useState<"all" | "transfers" | "intercompany" | "uncategorized">("all");
  const [year, setYear] = useState("all");
  const [uncat, setUncat] = useState<number | null>(null);

  // CSV import + Mercury backfill
  const [importOpen, setImportOpen] = useState(false);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [importAccount, setImportAccount] = useState("");
  const [csvRows, setCsvRows] = useState<Array<{ date: string; description: string; amount: number }>>([]);
  const [csvName, setCsvName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState("");
  const [backfilling, setBackfilling] = useState(false);

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

  const refreshUncat = useCallback(async () => {
    try {
      const params = new URLSearchParams({ report: "transactions", type: "uncategorized", limit: "1" });
      if (entity !== "all") params.set("entity", entity);
      if (year !== "all") params.set("year", year);
      const res = await authFetch(`/api/books/data?${params}`);
      if (res.ok) setUncat((await res.json()).total ?? 0);
    } catch {
      // the count is a nudge, not critical
    }
  }, [entity, year]);

  useEffect(() => {
    void refreshUncat();
  }, [refreshUncat]);

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

  async function openImport() {
    setImportOpen(true);
    setImportResult("");
    if (bankAccounts.length) return;
    try {
      const res = await authFetch("/api/plaid/data?report=treasury");
      if (res.ok) {
        const data = await res.json();
        const banks = (data.accounts ?? []).filter((a: any) => a.type !== "investment");
        setBankAccounts(banks);
        if (banks[0]) setImportAccount(banks[0].account_id);
      }
    } catch {
      // account list stays empty; the modal says so
    }
  }

  function onCsvFile(file: File) {
    setCsvName(file.name);
    setImportResult("");
    void file.text().then((text) => {
      const rows = normalizeCsv(parseCsv(text));
      setCsvRows(rows);
      if (!rows.length) setImportResult("Couldn't find date/amount/description columns in that file.");
    });
  }

  async function runImport() {
    if (!importAccount || !csvRows.length) return;
    setImporting(true);
    setImportResult("");
    try {
      const res = await authFetch("/api/books/import-csv", {
        method: "POST",
        body: JSON.stringify({ account_id: importAccount, rows: csvRows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Import failed.");
      setImportResult(`Imported ${data.imported} transactions (${data.skipped_existing} already present).`);
      setCsvRows([]);
      setCsvName("");
      await load();
      void refreshUncat();
    } catch (err) {
      setImportResult(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function backfillMercury() {
    setBackfilling(true);
    setError("");
    try {
      const res = await authFetch("/api/mercury/backfill", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Mercury backfill failed.");
      setError("");
      setImportResult("");
      await load();
      alert(`Mercury backfill: ${data.backfilled} transactions added.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mercury backfill failed.");
    } finally {
      setBackfilling(false);
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
          <h1 className={`text-2xl font-bold tracking-tight ${isDark ? "" : "text-gray-900"}`}>Transactions</h1>
          {lastSynced && (
            <p className={`text-xs mt-1 ${subtle}`}>
              Synced {new Date(lastSynced).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void openImport()}
            className={`px-4 py-2 rounded-full text-sm transition-colors cursor-pointer border ${
              isDark
                ? "border-white/10 text-gray-300 hover:text-white hover:border-white/25"
                : "border-gray-200 text-gray-600 hover:text-black hover:border-gray-400"
            }`}
          >
            Import CSV
          </button>
          <button
            onClick={() => void backfillMercury()}
            disabled={backfilling}
            title="Pull full Mercury history from Mercury's API (needs MERCURY_API_TOKEN)"
            className={`px-4 py-2 rounded-full text-sm transition-colors cursor-pointer border disabled:opacity-50 ${
              isDark
                ? "border-white/10 text-gray-300 hover:text-white hover:border-white/25"
                : "border-gray-200 text-gray-600 hover:text-black hover:border-gray-400"
            }`}
          >
            {backfilling ? "Backfilling…" : "Mercury history"}
          </button>
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
      </div>

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setImportOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-md rounded-2xl border shadow-2xl p-5 ${
              isDark ? "bg-[#141414] border-white/10" : "bg-white border-gray-200"
            }`}
          >
            <h2 className="text-base font-semibold mb-1">Import bank CSV</h2>
            <p className={`text-xs mb-4 ${subtle}`}>
              For history Plaid can't reach (Wells Fargo beyond 90 days). Export the range from the
              bank's site, pick the account it belongs to, and import — duplicates are skipped.
            </p>

            <label className={`block text-[11px] uppercase tracking-wider mb-1 ${subtle}`}>Account</label>
            <select
              value={importAccount}
              onChange={(e) => setImportAccount(e.target.value)}
              className={`w-full mb-3 px-3 py-2 rounded-xl text-sm border cursor-pointer ${
                isDark ? "bg-white/[0.04] border-white/10 text-white" : "bg-white border-gray-200 text-gray-900"
              }`}
            >
              {bankAccounts.length === 0 && <option value="">Loading accounts…</option>}
              {bankAccounts.map((a) => (
                <option key={a.account_id} value={a.account_id}>
                  {(a.nickname || a.official_name || a.name) + (a.mask ? ` ····${a.mask}` : "")} — {a.institution_name}
                </option>
              ))}
            </select>

            <label className={`block text-[11px] uppercase tracking-wider mb-1 ${subtle}`}>CSV file</label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => e.target.files?.[0] && onCsvFile(e.target.files[0])}
              className={`w-full text-sm mb-3 ${subtle}`}
            />

            {csvRows.length > 0 && (
              <p className={`text-xs mb-3 ${subtle}`}>
                {csvName}: <span className="font-medium">{csvRows.length} rows</span>,{" "}
                {csvRows.reduce((min, r) => (r.date < min ? r.date : min), csvRows[0].date)} →{" "}
                {csvRows.reduce((max, r) => (r.date > max ? r.date : max), csvRows[0].date)}
              </p>
            )}
            {importResult && <p className={`text-xs mb-3 ${importResult.startsWith("Imported") ? "text-emerald-500" : "text-red-400"}`}>{importResult}</p>}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setImportOpen(false)}
                className={`px-4 py-2 rounded-full text-sm cursor-pointer ${isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-black"}`}
              >
                Close
              </button>
              <button
                onClick={() => void runImport()}
                disabled={importing || !csvRows.length || !importAccount}
                className={`px-4 py-2 rounded-full text-sm font-medium cursor-pointer disabled:opacity-50 ${
                  isDark ? "bg-white/10 hover:bg-white/15 text-white" : "bg-gray-900 hover:bg-gray-800 text-white"
                }`}
              >
                {importing ? "Importing…" : "Import"}
              </button>
            </div>
          </div>
        </div>
      )}

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
          <button
            className={`inline-flex items-center gap-1.5 ${chip(type === "uncategorized")}`}
            onClick={() => setType("uncategorized")}
          >
            Uncategorized
            {uncat != null && uncat > 0 && (
              <span
                className={`px-1.5 rounded-full text-[10px] font-semibold ${
                  type === "uncategorized"
                    ? "bg-white/20 text-white"
                    : isDark ? "bg-amber-500/20 text-amber-300" : "bg-amber-100 text-amber-700"
                }`}
              >
                {uncat}
              </span>
            )}
          </button>
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

      <div className={`rounded-2xl border overflow-x-auto shadow-sm rise-in ${card}`}>
        {loading ? (
          <div className="p-4 space-y-2.5">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="shimmer h-5" style={{ width: `${96 - (i % 4) * 7}%` }} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-14 text-center">
            <svg className={`w-8 h-8 mx-auto mb-3 ${subtle}`} fill="none" stroke="currentColor" strokeWidth={1.2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
            </svg>
            <p className={`text-sm ${subtle}`}>Nothing matches these filters.</p>
          </div>
        ) : (
          <TxnTable
            rows={rows}
            categories={categories}
            isDark={isDark}
            onRowChange={(t) =>
              setRows((prev) => prev.map((r) => (r.transaction_id === t.transaction_id ? t : r)))
            }
            onError={setError}
            onReload={() => {
              void load();
              void refreshUncat();
            }}
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
