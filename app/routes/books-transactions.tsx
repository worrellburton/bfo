import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { authFetch, canWrite, isAdmin } from "../auth";
import { normalizeCsv, parseCsv, type CsvRow } from "../books-csv";
import { postBatchEdit, visibleSelection } from "../books-batch";
import { BatchBar, Menu, TxnTable, TxnTableSkeleton, changedToast, entityLabel, entityTag, txnCount, type Option, type Txn } from "../books-shared";
import { Banner, Button, Card, Checkbox, Dialog, Empty, Input, Money, Page, PageHeader, SearchField, Toolbar, confirm, format, toast, useDocumentTitle, type MenuItem } from "../ui";

export function meta() {
  return [{ title: "Transactions · BFO" }];
}

type Entity = { id: string; name: string };
/** Totals for the whole filtered set: the strip above the ledger. */
type Summary = { count: number; expenses: number; income: number; first: string | null; last: string | null };
type BankAccount = { account_id: string; name: string; official_name: string | null; nickname: string | null; mask: string | null; institution_name: string; type?: string; subtype?: string | null; entity_name?: string | null };

const PAGE = 100;
const PERIOD_KEY = "bfo-books-period";

const pad = (n: number) => String(n).padStart(2, "0");

/** The period choices: named presets, then the years, then all time (DESIGN.md §10.6). */
function periodOptions(now = new Date()): Option[] {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const lastMonth = m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
  const q = Math.floor((m - 1) / 3) + 1;
  return [
    { value: `${y}-${pad(m)}`, label: "This month", hint: format.date(`${y}-${pad(m)}-01`, "long").replace(/ 1,/, ""), group: "Recent" },
    { value: lastMonth, label: "Last month", hint: format.date(`${lastMonth}-01`, "long").replace(/ 1,/, ""), group: "Recent" },
    { value: `${y}-Q${q}`, label: "This quarter", hint: `Q${q} ${y}`, group: "Recent" },
    { value: String(y), label: `${y} to date`, short: `${y} to date`, group: "Years" },
    { value: String(y - 1), label: String(y - 1), group: "Years" },
    { value: String(y - 2), label: String(y - 2), group: "Years" },
    { value: "all", label: "All time", group: "Years" },
  ];
}

function readPeriod(): string {
  try {
    const v = localStorage.getItem(PERIOD_KEY);
    if (v && periodOptions().some((o) => o.value === v)) return v;
  } catch {
    // private mode: the default
  }
  return String(new Date().getFullYear());
}

const TYPES: Option[] = [
  { value: "all", label: "All types" },
  { value: "revenue", label: "Income" },
  { value: "expenses", label: "Expenses" },
  { value: "transfers", label: "Transfers" },
  { value: "intercompany", label: "Intercompany" },
  { value: "uncategorized", label: "Uncategorized" },
];
type TxnType = "all" | "revenue" | "expenses" | "transfers" | "intercompany" | "uncategorized";

/**
 * The ledger: every bank transaction, filtered by entity, period, type and
 * search, with this period's totals above it. Rows are refiled in place;
 * anything that reaches more than one row says what it will touch first and
 * can be undone after.
 */
export default function BooksTransactions() {
  useDocumentTitle("Transactions");
  const writable = canWrite();
  const admin = isAdmin();
  const [searchParams] = useSearchParams();

  const [rows, setRows] = useState<Txn[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loans, setLoans] = useState<Array<{ id: string; name: string }>>([]);
  const [vendorNames, setVendorNames] = useState<string[]>([]);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  const [q, setQ] = useState(() => searchParams.get("q")?.trim() ?? "");
  const [qDraft, setQDraft] = useState(q);
  const [entity, setEntity] = useState("all");
  const [type, setType] = useState<TxnType>(() => {
    const t = searchParams.get("type");
    return TYPES.some((o) => o.value === t) ? (t as TxnType) : "all";
  });
  const [period, setPeriodState] = useState(readPeriod);
  const setPeriod = (v: string) => {
    setPeriodState(v);
    try {
      localStorage.setItem(PERIOD_KEY, v);
    } catch {
      // the choice just isn't remembered
    }
  };
  const [uncat, setUncat] = useState<number | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "date", dir: "desc" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [sunrise, setSunrise] = useState<{ on: boolean; next: string | null; last: string | null } | null>(null);

  // Search commits 300ms after typing pauses.
  useEffect(() => {
    if (qDraft === q) return;
    const t = setTimeout(() => setQ(qDraft.trim()), 300);
    return () => clearTimeout(t);
  }, [qDraft, q]);

  const tagMatch = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? (entities.find((e) => entityTag(e.name).toLowerCase() === t) ?? null) : null;
  }, [q, entities]);

  const query = useCallback(
    (offset: number) => {
      const params = new URLSearchParams({ report: "transactions", limit: String(PAGE), offset: String(offset) });
      const effEntity = tagMatch ? tagMatch.id : entity;
      if (effEntity !== "all") params.set("entity", effEntity);
      if (type !== "all") params.set("type", type);
      if (period !== "all") params.set("year", period);
      if (!tagMatch && q) params.set("q", q);
      if (!(sort.key === "date" && sort.dir === "desc")) params.set("sort", `${sort.key}.${sort.dir}`);
      return `/api/books/data?${params}`;
    },
    [entity, type, period, q, sort, tagMatch],
  );

  const reqRef = useRef(0);
  const load = useCallback(async () => {
    const seq = ++reqRef.current;
    setLoading(true);
    setError("");
    try {
      const res = await authFetch(query(0));
      const data = await res.json().catch(() => ({}));
      if (seq !== reqRef.current) return;
      if (!res.ok) throw new Error(data?.message || "Couldn’t load transactions.");
      setRows(data.transactions ?? []);
      setTotal(data.total ?? 0);
      setSummary(data.summary ?? null);
    } catch (err) {
      if (seq !== reqRef.current) return;
      setError(err instanceof Error ? err.message : "Couldn’t load transactions.");
    } finally {
      if (seq === reqRef.current) setLoading(false);
    }
  }, [query]);
  useEffect(() => {
    void load();
  }, [load]);
  // A new filter starts a new selection: a batch only touches rows on screen.
  useEffect(() => setSelected(new Set()), [query]);

  const refreshUncat = useCallback(async () => {
    try {
      const params = new URLSearchParams({ report: "transactions", type: "uncategorized", limit: "1", summary: "0" });
      if (entity !== "all") params.set("entity", entity);
      if (period !== "all") params.set("year", period);
      const res = await authFetch(`/api/books/data?${params}`);
      if (res.ok) setUncat((await res.json()).total ?? 0);
    } catch {
      // a nudge, not critical
    }
  }, [entity, period]);
  useEffect(() => {
    void refreshUncat();
  }, [refreshUncat]);

  useEffect(() => {
    void (async () => {
      try {
        const [metaRes, settingsRes, bankRes] = await Promise.all([authFetch("/api/books/data?report=meta"), authFetch("/api/books/data?report=settings"), authFetch("/api/plaid/data?report=treasury")]);
        if (metaRes.ok) {
          const data = await metaRes.json();
          setEntities(data.entities ?? []);
          setCategories(data.categories ?? []);
          setLoans(data.loans ?? []);
          setVendorNames(data.vendors ?? []);
          setLastSynced(data.last_synced_at ?? null);
        }
        if (settingsRes.ok) {
          const d = await settingsRes.json();
          setSunrise({ on: !!d.sync_at_sunrise, next: d.next_sunrise_utc ?? null, last: d.last_auto_sync_date ?? null });
        }
        if (bankRes.ok) {
          const d = (await bankRes.json()) as { accounts?: BankAccount[] };
          setAccounts((d.accounts ?? []).filter((a) => a.type !== "investment"));
        }
      } catch {
        // the pickers stay short
      }
    })();
  }, []);

  async function loadMore() {
    const seq = reqRef.current;
    setLoadingMore(true);
    try {
      const res = await authFetch(query(rows.length));
      const data = await res.json().catch(() => ({}));
      if (seq !== reqRef.current) return;
      if (!res.ok) throw new Error();
      setRows((prev) => [...prev, ...(data.transactions ?? [])]);
    } catch {
      setError("Couldn’t load more transactions. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function syncNow() {
    if (syncing) return;
    setSyncing(true);
    setError("");
    try {
      const res = await authFetch("/api/cron/books-sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "The sync didn’t finish. Try again.");
      setLastSynced(new Date().toISOString());
      const failed = (data.items ?? []).filter((i: { error?: string }) => i.error).length;
      await load();
      void refreshUncat();
      toast({ message: failed ? `Synced, but ${failed} bank connection${failed === 1 ? "" : "s"} didn’t answer` : "Synced with the banks" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The sync didn’t finish. Try again.");
    } finally {
      setSyncing(false);
    }
  }

  async function toggleSunrise() {
    if (!sunrise) return;
    const next = !sunrise.on;
    setSunrise({ ...sunrise, on: next });
    const res = await authFetch("/api/books/data", { method: "POST", body: JSON.stringify({ action: "set_sunrise_sync", enabled: next }) }).catch(() => null);
    if (!res?.ok) {
      setSunrise({ ...sunrise, on: !next });
      setError("Couldn’t change the morning sync. Try again.");
    } else toast({ message: next ? "The banks will sync each morning" : "The morning sync is off" });
  }

  async function loadOlderMercury() {
    const ok = await confirm({
      title: "Load older Mercury transactions?",
      message: "Reads up to 24 months of history from Mercury for each Mercury account that’s still connected, and adds only what’s older than the bank feed already has. It takes a minute or two. Rows dated in a closed period aren’t changed.",
      confirmLabel: "Load older transactions",
    });
    if (!ok) return;
    setSyncing(true);
    setError("");
    try {
      const res = await authFetch("/api/mercury/backfill", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Couldn’t load older Mercury transactions.");
      await load();
      toast({ message: `Added ${txnCount(Number(data.backfilled ?? 0))} from Mercury` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t load older Mercury transactions.");
    } finally {
      setSyncing(false);
    }
  }

  // ── Words for the header and the strip ─────────────────────────────────
  const periods = periodOptions();
  const periodLabel = period === "all" ? "All time" : (periods.find((o) => o.value === period)?.label ?? period);
  const entityName = tagMatch ? entityLabel(tagMatch.name) : entity === "all" ? "All entities" : entity === "unmapped" ? "No entity" : entityLabel(entities.find((e) => e.id === entity)?.name);
  const spanText = summary?.first && summary?.last ? format.dateRange(summary.first, summary.last) : null;
  const context = [entityName, period === "all" ? (spanText ? `All time, ${spanText}` : "All time") : periodLabel, "Cash basis", lastSynced ? `Bank feed updated ${format.dateTime(lastSynced)}` : null].filter(Boolean).join(" · ");
  const net = summary ? summary.income - summary.expenses : 0;

  const filtered = !!q || entity !== "all" || type !== "all";
  const clearFilters = () => {
    setQ("");
    setQDraft("");
    setEntity("all");
    setType("all");
  };

  const menu: MenuItem[] = writable
    ? [
        { label: "Import a bank CSV…", onSelect: () => setImportOpen(true) },
        { label: "Load older Mercury transactions…", onSelect: () => void loadOlderMercury() },
        ...(sunrise ? [{ label: "Sync each morning", hint: sunrise.on && sunrise.next ? `next ${format.time(sunrise.next)}` : undefined, checked: sunrise.on, onSelect: () => void toggleSunrise() }] : []),
        ...(admin ? [{ divider: true as const }, { label: "Close the books…", onSelect: () => setCloseOpen(true) }] : []),
      ]
    : [];

  const selectedRows = rows.filter((r) => selected.has(r.transaction_id));
  const batchSummary = selectedRows.length
    ? {
        net: selectedRows.reduce((s, r) => s - r.amount, 0),
        first: selectedRows.map((r) => r.date).sort()[0],
        last: selectedRows.map((r) => r.date).sort()[selectedRows.length - 1],
        entities: [...new Set(selectedRows.map((r) => r.entity_name).filter((e): e is string => !!e))],
      }
    : undefined;
  const accountNames = useMemo(() => Object.fromEntries(accounts.map((a) => [a.account_id, format.accountLabel({ nickname: a.nickname, name: a.official_name || a.name, mask: a.mask })])), [accounts]);

  const activeFilters = [
    ...(entity !== "all" ? [{ label: entityName, onRemove: () => setEntity("all") }] : []),
    ...(type !== "all" ? [{ label: TYPES.find((o) => o.value === type)?.label ?? type, onRemove: () => setType("all") }] : []),
  ];

  return (
    <Page
      width="full"
      header={
        <PageHeader
          title="Transactions"
          context={context}
          menu={menu.length ? menu : undefined}
          primary={
            writable ? (
              <Button variant="primary" icon="sync" busy={syncing} busyLabel="Syncing…" onClick={() => void syncNow()}>
                Sync now
              </Button>
            ) : undefined
          }
        />
      }
    >
      {error && (
        <Banner tone="negative" onDismiss={() => setError("")} action={<Button variant="quiet" size="sm" onClick={() => void load()}>Try again</Button>}>
          {error}
        </Banner>
      )}

      <div className="flex flex-col gap-3">
        <Card>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
            {(
              [
                ["Income", summary ? <Money value={summary.income} precision="dollars" /> : null],
                ["Expenses", summary ? <Money value={summary.expenses} precision="dollars" /> : null],
                [period === "all" ? "Cumulative net" : "Net", summary ? <Money value={net} precision="dollars" tone="direction" /> : null],
                ["Transactions", summary ? summary.count.toLocaleString("en-US") : null],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-small text-ink-2">{label}</dt>
                <dd className="mt-1 truncate text-heading tabular-nums">{value ?? <span className="ds-skeleton inline-block h-[22px] w-24 rounded-mark bg-sunken align-middle" aria-hidden />}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-small text-ink-2">Income and expenses leave out transfers, intercompany moves and loans. Pending rows are included until they post.</p>
        </Card>
        {!!uncat && type !== "uncategorized" && (
          <div>
            <Button size="sm" variant="secondary" onClick={() => setType("uncategorized")}>
              {format.count(uncat, "uncategorized transaction", "uncategorized transactions")}
            </Button>
          </div>
        )}
      </div>

      <Card flush>
        <div className="px-5 py-3 touch:px-4">
          <Toolbar
            search={<SearchField value={qDraft} onChange={setQDraft} placeholder="Search payees and descriptions" label="Search payees and descriptions" />}
            filters={
              <>
                <Menu
                  value={tagMatch ? tagMatch.id : entity}
                  label="Entity"
                  onChange={setEntity}
                  options={[{ value: "all", label: "All entities" }, ...entities.map((en) => ({ value: en.id, label: entityLabel(en.name), hint: entityTag(en.name) })), { value: "unmapped", label: "No entity", hint: "accounts not mapped yet" }]}
                />
                <Menu value={period} label="Period" onChange={setPeriod} options={periods} />
                <Menu value={type} label="Type" onChange={(v) => setType(v as TxnType)} options={TYPES.map((o) => (o.value === "uncategorized" && uncat ? { ...o, hint: String(uncat) } : o))} />
              </>
            }
            activeFilters={activeFilters}
            onClearFilters={activeFilters.length ? clearFilters : undefined}
          />
        </div>
        <div className="border-t border-line" aria-busy={loading || undefined}>
          {loading && !rows.length ? (
            <TxnTableSkeleton />
          ) : rows.length === 0 ? (
            <div className="px-5 py-6">
              {filtered ? (
                <Empty size="section" action={<Button variant="quiet" size="sm" onClick={clearFilters}>Clear filters</Button>}>
                  No transactions match{q ? ` “${q}”` : ""} in {periodLabel.toLowerCase()}.
                </Empty>
              ) : (
                <Empty title="No transactions yet" action={writable ? <Button variant="primary" onClick={() => void syncNow()}>Sync now</Button> : undefined}>
                  Bank transactions appear here after the first sync. Anyone with access to Books can see them.
                </Empty>
              )}
            </div>
          ) : (
            <TxnTable
              rows={rows}
              categories={categories}
              loans={loans}
              accounts={accountNames}
              sort={sort}
              onSort={(key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }))}
              readOnly={!writable}
              selection={
                writable
                  ? {
                      selected,
                      toggle: (id) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          return next;
                        }),
                      setAll: (ids) => setSelected(new Set(ids)),
                      selectMany: (ids, on) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          for (const id of ids) {
                            if (on) next.add(id);
                            else next.delete(id);
                          }
                          return next;
                        }),
                    }
                  : undefined
              }
              onRowChange={(t) => {
                const was = rows.find((r) => r.transaction_id === t.transaction_id);
                if (was && !was.book_category !== !t.book_category) void refreshUncat();
                setRows((prev) => prev.map((r) => (r.transaction_id === t.transaction_id ? t : r)));
              }}
              onError={setError}
              onReload={() => {
                void load();
                void refreshUncat();
              }}
            />
          )}
        </div>
        {rows.length > 0 && rows.length < total && (
          <div className="flex items-center justify-center gap-3 border-t border-line px-5 py-3">
            <span role="status" className="text-small text-ink-2 tabular-nums">
              Showing {rows.length.toLocaleString("en-US")} of {total.toLocaleString("en-US")}
            </span>
            <Button size="sm" busy={loadingMore} busyLabel="Loading…" onClick={() => void loadMore()}>
              Show {Math.min(PAGE, total - rows.length)} more
            </Button>
          </div>
        )}
      </Card>
      {/* Room for the floating bar and the Ask button over the amount column. */}
      <div aria-hidden className={selected.size ? "h-[96px]" : "h-[48px]"} />

      <BatchBar
        count={visibleSelection(selected, rows).length}
        busy={batchBusy}
        vendorSuggestions={vendorNames}
        categories={categories}
        summary={batchSummary}
        onApply={async (patch) => {
          setBatchBusy(true);
          try {
            const ids = visibleSelection(selected, rows);
            const r = await postBatchEdit(authFetch, ids, patch);
            if (r.ok) {
              setSelected(new Set());
              changedToast(`Changed ${txnCount(ids.length)}`, r.undo, () => void load());
            } else setError(r.message);
            if (r.ok || r.done) {
              await load();
              void refreshUncat();
            }
            return r.ok;
          } finally {
            setBatchBusy(false);
          }
        }}
        onClear={() => setSelected(new Set())}
      />

      <ImportCsvDialog
        open={importOpen}
        accounts={accounts}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          void load();
          void refreshUncat();
        }}
      />
      {admin && <ClosePeriodDialog open={closeOpen} entities={entities} onClose={() => setCloseOpen(false)} />}
    </Page>
  );
}

// ── Import a bank CSV ──────────────────────────────────────────────────────

type Plan = { rows_in_file: number; to_add: number; already_here: number; near_matches: number; money_in: number; money_out: number; first: string; last: string; locked: number; closed_through: string | null };

async function sha256(text: string): Promise<string | null> {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/**
 * Add older history a bank connection can't reach: choose the account (none
 * is chosen for you), choose the file, read what it would add, then import.
 * The server's dry run states the rows to add, those already here, money in
 * and out and the span; rows in a closed period stop it. Imported rows are
 * marked as imported, kept with the file's name and fingerprint, and can be
 * taken back out.
 */
function ImportCsvDialog({ open, accounts, onClose, onImported }: { open: boolean; accounts: BankAccount[]; onClose: () => void; onImported: () => void }) {
  const [account, setAccount] = useState("");
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [file, setFile] = useState<{ name: string; sha: string | null } | null>(null);
  const [chargesPositive, setChargesPositive] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState<"plan" | "import" | null>(null);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ imported: number; importId: string | null } | null>(null);
  // Whether the server reads a file before importing it (the dry run arrived
  // with the ledger endpoint); an older server would import on a dry run.
  const [canPlan, setCanPlan] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    void authFetch("/api/books/ledger?report=periods")
      .then((r) => setCanPlan(r.status !== 404))
      .catch(() => setCanPlan(false));
    setAccount("");
    setRows([]);
    setFile(null);
    setPlan(null);
    setErr("");
    setDone(null);
    setChargesPositive(false);
  }, [open]);

  const chosen = accounts.find((a) => a.account_id === account);
  useEffect(() => {
    // Card exports usually sign charges positive.
    if (chosen) setChargesPositive(/credit/i.test(chosen.subtype ?? "") || /credit|card/i.test(chosen.name));
  }, [chosen]);

  async function readPlan(next: { rows?: CsvRow[]; flip?: boolean; account?: string } = {}) {
    const acct = next.account ?? account;
    const list = next.rows ?? rows;
    if (!acct || !list.length || !canPlan) return;
    setBusy("plan");
    setErr("");
    try {
      const res = await authFetch("/api/books/import-csv", {
        method: "POST",
        body: JSON.stringify({ account_id: acct, rows: list, file_name: file?.name, file_sha256: file?.sha, charges_positive: next.flip ?? chargesPositive, dry_run: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Couldn’t read that file.");
      setPlan(data as Plan);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn’t read that file.");
    } finally {
      setBusy(null);
    }
  }

  async function onFile(f: File) {
    const text = await f.text();
    const parsed = normalizeCsv(parseCsv(text));
    setFile({ name: f.name, sha: await sha256(text) });
    setRows(parsed);
    setPlan(null);
    setDone(null);
    if (!parsed.length) setErr("Couldn’t find date, amount and description columns in that file.");
    else {
      setErr("");
      void readPlan({ rows: parsed });
    }
  }

  async function runImport() {
    setBusy("import");
    setErr("");
    try {
      const res = await authFetch("/api/books/import-csv", {
        method: "POST",
        body: JSON.stringify({ account_id: account, rows, file_name: file?.name, file_sha256: file?.sha, charges_positive: chargesPositive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "The import didn’t finish. Try again.");
      setDone({ imported: Number(data.imported ?? 0), importId: data.import_id ?? null });
      onImported();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The import didn’t finish. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function undoImport() {
    if (!done?.importId) return;
    const res = await authFetch("/api/books/import-csv", { method: "POST", body: JSON.stringify({ undo_import_id: done.importId }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(data?.message || "Couldn’t undo that import.");
      return;
    }
    toast({ message: `Removed ${txnCount(Number(data.removed ?? 0))} imported` });
    onImported();
    onClose();
  }

  const accountOptions: Option[] = accounts.map((a) => ({
    value: a.account_id,
    label: format.accountLabel({ nickname: a.nickname, name: a.official_name || a.name, mask: a.mask }),
    hint: a.entity_name ? entityLabel(a.entity_name) : a.institution_name,
  }));
  const canImport = !!account && rows.length > 0 && (canPlan ? !!plan && plan.to_add > 0 && !plan.locked : true);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Import a bank CSV"
      description="Add older history the bank connection can’t reach. Download a CSV from the bank’s website, choose the account it belongs to, and import it. Anything already here is skipped."
      dirty={rows.length > 0 && !done}
      footer={
        done ? (
          <>
            {done.importId && <Button onClick={() => void undoImport()}>Undo this import</Button>}
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" busy={busy === "import"} busyLabel="Importing…" disabled={!canImport} disabledReason={!account ? "Choose an account" : !rows.length ? "Choose a file" : undefined} onClick={() => void runImport()}>
              {plan ? `Import ${txnCount(plan.to_add)}` : "Import"}
            </Button>
          </>
        )
      }
    >
      {/* Names the dialog for the tour's capture of it. */}
      <div aria-labelledby="import-title" className="flex flex-col gap-4">
        <span id="import-title" hidden>
          Import a bank CSV
        </span>
        {done ? (
          <Banner tone="positive">
            Imported {txnCount(done.imported)}. They’re marked as imported in the ledger{done.importId ? ", kept with the file’s name and fingerprint" : ""}.
          </Banner>
        ) : (
          <>
            <label className="flex flex-col gap-[6px]">
              <span className="text-small font-medium text-ink">Account</span>
              <Menu
                value={account}
                label="Account"
                placeholder={accounts.length ? "Choose an account" : "No bank accounts connected"}
                disabled={!accounts.length}
                size="md"
                className="w-full"
                onChange={(v) => {
                  setAccount(v);
                  void readPlan({ account: v });
                }}
                options={accountOptions}
              />
            </label>
            <div className="flex flex-col gap-[6px]">
              <span className="text-small font-medium text-ink">File</span>
              <div
                className="flex flex-col items-start gap-2 rounded-card border border-dashed border-edge p-4"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) void onFile(f);
                }}
              >
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
                <Button size="sm" icon="upload" onClick={() => fileRef.current?.click()}>
                  Choose a CSV file
                </Button>
                <span className="text-small text-ink-2">{file ? `${file.name} · ${txnCount(rows.length)}` : "Or drag one here."}</span>
              </div>
            </div>
            {rows.length > 0 && (
              <Checkbox
                checked={chargesPositive}
                onChange={(v) => {
                  setChargesPositive(v);
                  void readPlan({ flip: v });
                }}
                label="Charges are positive numbers in this file"
                hint="Most card exports; bank exports usually show deposits as positive."
              />
            )}
            {plan && (
              <div className="rounded-card bg-sunken px-4 py-3 text-body tabular-nums">
                {(
                  [
                    ["To add", txnCount(plan.to_add)],
                    ["Already here", txnCount(plan.already_here + plan.near_matches)],
                    ["Money in", format.money(plan.money_in)],
                    ["Money out", format.money(plan.money_out)],
                    ["Dates", format.dateRange(plan.first, plan.last)],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 py-[2px]">
                    <span className="text-ink-2">{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>
            )}
            {plan && plan.locked > 0 && <Banner tone="warning">{`${txnCount(plan.locked)} in this file ${plan.locked === 1 ? "is" : "are"} dated in a closed period (closed through ${format.date(plan.closed_through ?? plan.first, "medium")}). Remove them from the file, or ask an admin to reopen the period.`}</Banner>}
            {busy === "plan" && <p className="text-small text-ink-2">Reading the file…</p>}
            <p className="text-small text-ink-2">Imported rows are your copy of the bank’s statement, not confirmed by the bank. They’re marked as imported and kept with the file’s name.</p>
          </>
        )}
        {err && <Banner tone="negative">{err}</Banner>}
      </div>
    </Dialog>
  );
}

// ── Close the books ────────────────────────────────────────────────────────

/**
 * An admin closes an entity's books (or everyone's) through a date: after
 * that, nothing dated on or before it can be refiled, imported or have its
 * receipts removed until an admin reopens the period with a reason.
 */
function ClosePeriodDialog({ open, entities, onClose }: { open: boolean; entities: Entity[]; onClose: () => void }) {
  const lastYearEnd = `${new Date().getFullYear() - 1}-12-31`;
  const [entity, setEntity] = useState("all");
  const [through, setThrough] = useState(lastYearEnd);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [periods, setPeriods] = useState<Array<{ id: number; entity_name: string | null; closed_through: string; closed_by_name: string | null; closed_at: string; reopened_at: string | null }> | null>(null);
  const [available, setAvailable] = useState(true);

  const loadPeriods = useCallback(async () => {
    const res = await authFetch("/api/books/ledger?report=periods").catch(() => null);
    if (!res?.ok) {
      setAvailable(false);
      setPeriods([]);
      return;
    }
    const d = await res.json();
    setAvailable(d.available !== false);
    setPeriods(d.periods ?? []);
  }, []);
  useEffect(() => {
    if (open) void loadPeriods();
  }, [open, loadPeriods]);

  const yearEnds: Option[] = [0, 1, 2, 3].map((d) => {
    const y = new Date().getFullYear() - 1 - d;
    return { value: `${y}-12-31`, label: `December 31, ${y}` };
  });
  const name = entity === "all" ? null : (entities.find((e) => e.id === entity)?.name ?? null);

  async function close() {
    setBusy(true);
    setErr("");
    try {
      const res = await authFetch("/api/books/ledger", {
        method: "POST",
        body: JSON.stringify({ action: "close_period", entity_id: entity === "all" ? null : entity, entity_name: name, closed_through: through, reason: reason.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Couldn’t close that period.");
      toast({ message: `Closed ${name ? entityLabel(name) : "every entity"}’s books through ${format.date(through, "medium")}` });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn’t close that period.");
    } finally {
      setBusy(false);
    }
  }

  async function reopen(id: number) {
    if (reason.trim().length < 5) {
      setErr("Write why the period is being reopened in the Reason field, then choose Reopen.");
      return;
    }
    const ok = await confirm({
      title: "Reopen this period?",
      message: "Its transactions can be changed again until it’s closed again. The reopening is recorded with your name.",
      confirmLabel: "Reopen period",
      tone: "commit",
    });
    if (!ok) return;
    const res = await authFetch("/api/books/ledger", { method: "POST", body: JSON.stringify({ action: "reopen_period", id, reason: reason.trim() }) });
    if (!res.ok) setErr("Couldn’t reopen that period.");
    await loadPeriods();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Close the books"
      description="After a period is closed, nothing dated in it can be refiled, imported or have its receipts removed until an admin reopens it."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} busyLabel="Closing…" disabled={!available} disabledReason={available ? undefined : "Needs a database update"} onClick={() => void close()}>
            Close through {format.date(through, "medium")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!available && <Banner tone="info">Closing a period needs a database update that hasn’t been applied yet.</Banner>}
        <label className="flex flex-col gap-[6px]">
          <span className="text-small font-medium text-ink">Entity</span>
          <Menu value={entity} label="Entity" size="md" className="w-full" onChange={setEntity} options={[{ value: "all", label: "Every entity" }, ...entities.map((e) => ({ value: e.id, label: entityLabel(e.name) }))]} />
        </label>
        <label className="flex flex-col gap-[6px]">
          <span className="text-small font-medium text-ink">Closed through</span>
          <Menu value={through} label="Closed through" size="md" className="w-full" onChange={setThrough} options={yearEnds} />
        </label>
        <label className="flex flex-col gap-[6px]">
          <span className="text-small font-medium text-ink">Reason</span>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: 2025 returns filed" />
          <span className="text-small text-ink-2">Kept with the close. Reopening a period needs a reason too.</span>
        </label>
        {periods && periods.length > 0 && (
          <div>
            <h3 className="mb-1 text-small font-semibold text-ink">Closed so far</h3>
            <ul className="flex flex-col">
              {periods.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 border-b border-line py-2 text-body">
                  <span className="min-w-0">
                    {p.entity_name ? entityLabel(p.entity_name) : "Every entity"} through {format.date(p.closed_through, "medium")}
                    <span className="block text-small text-ink-2">
                      {p.reopened_at ? "Reopened" : `Closed ${format.date(p.closed_at, "medium")}${p.closed_by_name ? ` by ${p.closed_by_name}` : ""}`}
                    </span>
                  </span>
                  {!p.reopened_at && (
                    <Button size="sm" variant="quiet" onClick={() => void reopen(p.id)}>
                      Reopen…
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {err && <Banner tone="negative">{err}</Banner>}
      </div>
    </Dialog>
  );
}
