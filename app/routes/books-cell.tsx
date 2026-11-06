/**
 * The transactions behind one figure on Books › Reports: an account for a
 * month, a year or an entity; a section total; the bottom line. It states
 * its scope, period and basis, ties its net to the figure it was opened
 * from, shows the months when it covers the year, flags rows that look like
 * the same payment twice, and opens read-only when the period is closed.
 * The rows are the ledger's own table (app/books-shared.tsx), editable in
 * place for people who can write.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { authFetch, canWrite } from "../auth";
import { postBatchEdit, visibleSelection } from "../books-batch";
import { KpiStrip } from "../books-report-kit";
import { kpiMoney, periodText, splitAccount, statementMoney } from "../books-report-model";
import { BatchBar, TxnTable, TxnTableSkeleton, type Txn } from "../books-shared";
import { Banner, Button, Empty, Page, PageHeader, TextLink, cx, format, useDocumentTitle } from "../ui";

export function meta() {
  return [{ title: "Transactions behind a figure · Reports · BFO" }];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const SECTION_TITLES: Record<string, string> = {
  revenue: "Revenue",
  operating: "Operating expenses",
  other: "Other income (expense)",
  personal: "Personal (grantor)",
  operating_income: "Operating income",
  net: "Excess of receipts over disbursements",
  uncategorized: "Uncategorized, needs review",
  transfers: "Outside the statement",
  intercompany: "Between family entities, not matched",
  eliminated: "Between family entities, matched",
  "flow:own": "Transfers between your own accounts",
  "flow:conflict": "Income or expense accounts typed as transfers",
  "flow:intercompany": "Between family entities, not matched",
  "flow:loans": "Loans",
  "flow:capital": "Capital improvements",
  "flow:distributions": "Distributions and draws",
};

type CellReply = {
  transactions: Txn[];
  count: number;
  period?: { from: string; to: string | null };
  entities?: string[];
  net?: number;
  shown?: number | null;
  duplicates?: string[][];
  locked?: number;
  closed_through?: string | null;
  accounts?: Record<string, string>;
};

/** The sign a section reads in: operating expenses money out, the rest money in. */
const signed = (t: Pick<Txn, "amount">, section: string) => (section === "operating" ? t.amount : -t.amount);

export default function BooksCell() {
  const [params] = useSearchParams();
  const entity = params.get("entity") ?? "all";
  const year = params.get("year") ?? String(new Date().getFullYear());
  const section = params.get("section") ?? "operating";
  const label = params.get("label");
  const month = params.get("month");
  const col = params.get("col");
  const view = params.get("view");
  const writable = canWrite();

  const [reply, setReply] = useState<CellReply | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [vendorNames, setVendorNames] = useState<string[]>([]);
  const [entityNames, setEntityNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ report: "cell", entity, year, section });
      if (label != null) qs.set("label", label);
      if (col) qs.set("col", col);
      // The whole year comes back once; a month narrows it here, so the month strip can show every month.
      const res = await authFetch(`/api/books/data?${qs}`);
      const data = (await res.json().catch(() => ({}))) as CellReply & { message?: string };
      if (!res.ok) throw new Error(data?.message || "Couldn't load these transactions.");
      setReply({ ...data, transactions: data.transactions ?? [] });
      setSelected((prev) => new Set(visibleSelection(prev, data.transactions ?? [])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load these transactions.");
    } finally {
      setLoading(false);
    }
  }, [entity, year, section, label, col]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/books/data?report=meta");
        if (!res.ok) return;
        const data = await res.json();
        setCategories(data.categories ?? []);
        setVendorNames(data.vendors ?? []);
        setEntityNames(Object.fromEntries(((data.entities ?? []) as Array<{ id: string; name: string }>).map((e) => [e.id, e.name.replace(/\s*\([^)]*\)\s*/g, " ").trim()])));
      } catch {
        // the pickers stay short
      }
    })();
  }, []);

  const all = useMemo(() => reply?.transactions ?? [], [reply]);
  const rows = useMemo(() => (month ? all.filter((t) => Number(t.date.slice(5, 7)) === Number(month)) : all), [all, month]);

  // The figure: in, out and net in the section's sign, to the cent.
  const inTotal = rows.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0);
  const outTotal = rows.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const net = Math.round(rows.reduce((s, t) => s + signed(t, section), 0) * 100) / 100;
  const byMonth = useMemo(() => {
    const m = Array<number>(12).fill(0);
    for (const t of all) m[Number(t.date.slice(5, 7)) - 1] += signed(t, section);
    return m.map((v) => Math.round(v * 100) / 100);
  }, [all, section]);

  const account = label ? splitAccount(label) : null;
  const title = account?.name ?? SECTION_TITLES[section] ?? "Transactions";
  const where = section.startsWith("flow:") || section === "transfers" || section === "intercompany" || section === "eliminated" ? "Outside the statement" : (SECTION_TITLES[section] ?? section);
  const scope = col
    ? (entityNames[col] ?? (col === "none" ? "No entity" : "One entity"))
    : entity === "all"
      ? "All entities"
      : entity.split(",").length === 1
        ? (entityNames[entity] ?? "One entity")
        : format.count(entity.split(",").length, "entity", "entities");
  const period = month ? `${MONTH_NAMES[Number(month) - 1]} ${year}` : periodText(year, reply?.period ?? null);
  const context = [account?.code, account ? where : null, scope, period, "Cash basis"].filter(Boolean).join(" · ");
  useDocumentTitle(title, "Reports");

  const back = new URLSearchParams();
  if (entity !== "all") back.set("entity", entity);
  if (year !== String(new Date().getFullYear())) back.set("year", year);
  if (view) back.set("view", view);
  const backTo = `/books/reports${back.toString() ? `?${back}` : ""}`;

  // Ties to the figure it was opened from: the statement's whole dollars against the rows to the cent.
  const shownServer = !month && reply?.shown !== undefined ? reply.shown : null;
  const ties = shownServer === null || shownServer === undefined ? null : Math.abs(Math.round(net) - shownServer) <= 1;

  const duplicates = (reply?.duplicates ?? []).filter((ids) => ids.some((id) => rows.some((t) => t.transaction_id === id)));
  const locked = reply?.locked ?? 0;
  const allLocked = rows.length > 0 && locked >= all.length;
  const readOnly = !writable || allLocked;

  const linkFor = (m: number | null) => {
    const q = new URLSearchParams(params);
    if (m) q.set("month", String(m));
    else q.delete("month");
    return `/books/reports/cell?${q}`;
  };

  return (
    <Page width="full" header={<PageHeader back={{ to: backTo, label: "Reports" }} title={title} context={context} />}>
      <KpiStrip
        label={title}
        items={[
          { label: "Money in", value: kpiMoney(inTotal) },
          { label: "Money out", value: kpiMoney(outTotal) },
          {
            label: section === "operating" ? "Net spent" : "Net",
            value: kpiMoney(net),
            tone: section === "operating" ? "none" : "direction",
            amount: net,
            hint: loading
              ? undefined
              : ties === null
                ? `${format.money(net)} exactly`
                : ties
                  ? `${format.money(net)} · ties to the statement's ${statementMoney(shownServer)}`
                  : `${format.money(net)} · the statement shows ${statementMoney(shownServer)}`,
          },
          { label: "Transactions", value: loading ? "" : format.count(rows.length, "transaction", "transactions", { zero: "numeral" }) },
        ]}
      />

      {!loading && ties === false && (
        <Banner tone="warning" title="This doesn't tie to the statement.">
          The rows come to {format.money(net)}; the statement shows {statementMoney(shownServer)}. Reload Reports: a row may have changed since it was built.
        </Banner>
      )}
      {duplicates.length > 0 && (
        <Banner tone="warning" action={<TextLink to="/books/review">Open Review</TextLink>}>
          {duplicates.length === 1 ? "Two rows look like the same payment" : `${format.count(duplicates.length, "group")} of rows look like the same payment`}:{" "}
          {format.list(
            duplicates.slice(0, 3).map((ids) => {
              const t = rows.find((r) => r.transaction_id === ids[0]) ?? all.find((r) => r.transaction_id === ids[0]);
              return t ? `${format.money(Math.abs(t.amount))} on ${format.date(t.date, "medium")}` : "";
            }),
          )}
          . Both count here until Review settles them.
        </Banner>
      )}
      {allLocked && reply?.closed_through && <Banner tone="info">Closed through {format.date(reply.closed_through, "medium")}: these rows can&rsquo;t be changed until the period is reopened.</Banner>}
      {error && (
        <Banner
          tone="negative"
          action={
            <Button variant="quiet" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          }
        >
          {error}
        </Banner>
      )}

      {!col && all.length > 0 && (
        <nav aria-label="Months" className="flex flex-wrap gap-2">
          <MonthLink to={linkFor(null)} current={!month} label="Year" amount={null} />
          {byMonth.map((v, i) =>
            v === 0 && !all.some((t) => Number(t.date.slice(5, 7)) === i + 1) ? null : <MonthLink key={i} to={linkFor(i + 1)} current={Number(month) === i + 1} label={MONTHS[i]} amount={v} />,
          )}
        </nav>
      )}

      <div className="overflow-hidden rounded-card border border-line bg-raised">
        {loading ? (
          <TxnTableSkeleton selection={!readOnly} />
        ) : rows.length === 0 ? (
          <div className="px-5 py-5">
            <Empty>{error ? "Nothing to show." : "No transactions behind this figure."}</Empty>
          </div>
        ) : (
          <TxnTable
            rows={rows}
            categories={categories}
            readOnly={readOnly}
            accounts={reply?.accounts}
            selection={
              readOnly
                ? undefined
                : {
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
            }
            onRowChange={() => void load()}
            onError={setError}
            onReload={() => void load()}
          />
        )}
      </div>

      {!readOnly && (
        <BatchBar
          count={visibleSelection(selected, rows).length}
          busy={batchBusy}
          vendorSuggestions={vendorNames}
          categories={categories}
          onApply={async (patch) => {
            setBatchBusy(true);
            try {
              const r = await postBatchEdit(authFetch, visibleSelection(selected, rows), patch);
              if (r.ok) setSelected(new Set());
              else setError(r.message);
              if (r.ok || r.done) await load();
              return r.ok;
            } finally {
              setBatchBusy(false);
            }
          }}
          onClear={() => setSelected(new Set())}
        />
      )}
    </Page>
  );
}

/** One month in the strip: its name over its figure; the chosen one is marked. */
function MonthLink({ to, current, label, amount }: { to: string; current: boolean; label: string; amount: number | null }) {
  return (
    <Link
      to={to}
      replace
      aria-current={current ? "page" : undefined}
      className={cx("flex min-h-[44px] min-w-[72px] flex-col justify-center rounded-control border px-3 py-1 hover:bg-hover", current ? "border-accent bg-accent-tint" : "border-line bg-raised")}
    >
      <span className="text-caption text-ink-2">{label}</span>
      {amount !== null && <span className="text-small font-medium text-ink tabular-nums">{statementMoney(Math.round(amount))}</span>}
    </Link>
  );
}
