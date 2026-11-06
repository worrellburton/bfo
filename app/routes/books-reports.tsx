/**
 * Books › Reports: revenue and expenses (cash basis), the connected
 * balances, and the statements (cash flow, trial balance, 1099 worksheet),
 * for any set of entities and year. The view, entities and year live in the
 * URL, so a drill-down's back link, a refresh or a shared link restores the
 * same report. Exports carry the same scope line as the screen.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { authFetch } from "../auth";
import { csvText } from "../books-csv";
import { BalanceView } from "../books-report-balance";
import { KpiStrip } from "../books-report-kit";
import { BASIS_LEGEND, cleanName, periodText, readPnl, readSheet, readStatements, readWorksheet, scopeText, type Pnl, type Sheet, type Statements, type Worksheet } from "../books-report-model";
import { PnlView } from "../books-report-pnl";
import { StatementsView } from "../books-report-statements";
import { Banner, Button, Menu, MultiSelect, Page, PageHeader, Segmented, Select, Skeleton, format, usePhone, useDocumentTitle, type MenuItem } from "../ui";

export function meta() {
  return [{ title: "Reports · Books · BFO" }];
}

type View = "pnl" | "balance" | "statements";
type Entity = { id: string; name: string };

const VIEWS: Array<{ value: View; label: string; short: string }> = [
  { value: "pnl", label: "Revenue & expenses", short: "Revenue" },
  { value: "balance", label: "Balances", short: "Balances" },
  { value: "statements", label: "Statements", short: "Statements" },
];

const thisYear = () => String(new Date().getFullYear());

/** Hand the browser a CSV: the scope lines first, then the header and rows. */
function downloadCsv(name: string, scope: string[], header: string[], rows: Array<Array<string | number | null>>) {
  const line = (cells: Array<string | number | null>) => cells.map((c) => (typeof c === "number" ? `"${c.toFixed(2)}"` : csvText(c ?? ""))).join(",");
  const csv = [...scope.map((s) => line([s])), "", line(header), ...rows.map(line)].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function getJson(path: string, fallback: string): Promise<unknown> {
  const res = await authFetch(path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { message?: string })?.message || fallback);
  return data;
}

export default function BooksReports() {
  const navigate = useNavigate();
  const phone = usePhone();
  const [params, setParams] = useSearchParams();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<string[]>(() => {
    const e = params.get("entity");
    return e && e !== "all" ? e.split(",").filter(Boolean) : [];
  });
  const [year, setYear] = useState(() => (/^\d{4}$/.test(params.get("year") ?? "") ? params.get("year")! : thisYear()));
  const [view, setView] = useState<View>(() => {
    const v = params.get("view");
    return v === "balance" || v === "statements" ? v : "pnl";
  });
  const [asOf, setAsOf] = useState<string>(() => (/^\d{4}-\d{2}-\d{2}$/.test(params.get("as_of") ?? "") ? params.get("as_of")! : "latest"));
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [statements, setStatements] = useState<Statements | null>(null);
  const [worksheet, setWorksheet] = useState<Worksheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [exporting, setExporting] = useState(false);

  useDocumentTitle("Reports", "Books");

  const entityParam = selected.length ? selected.join(",") : "all";
  const scope = scopeText(selected, entities);
  const entityCount = selected.length || entities.length;

  // Mirror the report into the URL (replace: no history spam).
  useEffect(() => {
    const next = new URLSearchParams();
    if (entityParam !== "all") next.set("entity", entityParam);
    if (year !== thisYear()) next.set("year", year);
    if (view !== "pnl") next.set("view", view);
    if (view === "balance" && asOf !== "latest") next.set("as_of", asOf);
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityParam, year, view, asOf]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/books/data?report=meta");
        if (res.ok) setEntities(((await res.json()).entities ?? []).map((e: Entity) => ({ id: e.id, name: cleanName(e.name) || e.name })));
      } catch {
        // the picker stays short; the report still loads
      }
    })();
  }, []);

  useEffect(() => {
    // A newer choice supersedes this one: a slow earlier answer must not overwrite it.
    let cancelled = false;
    setLoading(true);
    setError("");
    const e = encodeURIComponent(entityParam);
    void (async () => {
      try {
        if (view === "pnl") {
          const data = readPnl(await getJson(`/api/books/data?report=pnl&entity=${e}&year=${year}`, "Couldn't build revenue and expenses."));
          if (!cancelled) setPnl(data);
        } else if (view === "balance") {
          const data = readSheet(await getJson(`/api/books/data?report=balance-sheet&entity=${e}${asOf !== "latest" ? `&as_of=${asOf}` : ""}`, "Couldn't load the connected balances."));
          if (!cancelled) setSheet(data);
        } else {
          const [s, t] = await Promise.all([
            getJson(`/api/books/data?report=statements&entity=${e}&year=${year}`, "Couldn't build the statements."),
            getJson(`/api/books/data?report=tax1099&entity=${e}&year=${year}`, "").catch(() => null),
          ]);
          if (!cancelled) {
            setStatements(readStatements(s));
            setWorksheet(readWorksheet(t));
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't build that report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityParam, year, view, asOf, attempt]);

  /** Into the transactions behind one figure. */
  function drill(section: string, label: string | null, column: { month?: number | null; col?: string | null } = {}) {
    const q = new URLSearchParams({ entity: entityParam, year, section });
    if (label != null) q.set("label", label);
    if (column.month) q.set("month", String(column.month));
    if (column.col) q.set("col", column.col);
    if (view !== "pnl") q.set("view", view);
    navigate(`/books/reports/cell?${q}`);
  }

  // ── Exports: the same scope line as the screen at the top of each file ──

  const scopeLines = (what: string, period: string) => [
    `${what}`,
    `${scope} · ${period} · Cash basis · unaudited, prepared from bank feeds for internal use`,
    `Exported ${format.dateTime(new Date())}`,
  ];

  async function exportLedger() {
    setExporting(true);
    setError("");
    try {
      const e = encodeURIComponent(entityParam);
      const res = await authFetch(`/api/books/data?report=ledger&year=${year}&entity=${e}`);
      type LedgerRow = {
        date: string;
        transaction_id: string;
        entity: string | null;
        bank_account: string | null;
        mask: string | null;
        description: string | null;
        vendor: string | null;
        account: string;
        statement_line: string;
        type: string;
        status: string;
        bank_category: string | null;
        amount: number;
        receipts: number;
      };
      let rows: LedgerRow[];
      let period = year;
      if (res.ok) {
        const data = (await res.json()) as { rows: LedgerRow[]; period?: { from: string; to: string | null } };
        rows = data.rows;
        period = periodText(year, data.period ?? null);
      } else {
        // An older server: page through the transactions, posted rows only.
        rows = [];
        for (let offset = 0; ; offset += 500) {
          const r = await authFetch(`/api/books/data?report=transactions&year=${year}&entity=${e}&limit=500&offset=${offset}&summary=0`);
          if (!r.ok) throw new Error("Couldn't export the general ledger.");
          const page = ((await r.json()).transactions ?? []) as Array<Record<string, unknown>>;
          for (const t of page) {
            if (t.pending) continue;
            rows.push({
              date: String(t.date),
              transaction_id: String(t.transaction_id),
              entity: cleanName(t.entity_name as string) || null,
              bank_account: null,
              mask: null,
              description: (t.name as string) ?? null,
              vendor: (t.merchant_name as string) ?? null,
              account: (t.book_category as string) ?? "Uncategorized",
              statement_line: "",
              type: String(t.type_override ?? t.txn_type ?? ""),
              status: "posted",
              bank_category: (t.plaid_category as string) ?? null,
              amount: Number(t.amount),
              receipts: 0,
            });
          }
          if (page.length < 500) break;
        }
      }
      downloadCsv(
        `bfo-general-ledger-${year}.csv`,
        [...scopeLines(`General ledger, ${year}`, period), "Amount: money out positive, money in negative, as the bank reports it. Posted transactions only."],
        ["Date", "Transaction ID", "Entity", "Bank account", "Last four", "Description", "Vendor", "Account", "Statement line", "Type", "Status", "Bank category", "Amount", "Receipts"],
        rows.map((t) => [
          t.date,
          t.transaction_id,
          t.entity,
          t.bank_account,
          t.mask,
          t.description,
          t.vendor,
          t.account,
          t.statement_line,
          t.type,
          t.status,
          t.bank_category,
          t.amount,
          String(t.receipts),
        ]),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't export the general ledger.");
    } finally {
      setExporting(false);
    }
  }

  async function exportTrialBalance() {
    setExporting(true);
    try {
      const s = statements ?? readStatements(await getJson(`/api/books/data?report=statements&entity=${encodeURIComponent(entityParam)}&year=${year}`, "Couldn't build the trial balance."));
      downloadCsv(
        `bfo-trial-balance-${year}.csv`,
        [
          ...scopeLines(`Trial balance, period activity, ${year}`, periodText(year, s.period)),
          "Each bank and card account shows its net movement for the period, not its balance. Before eliminations.",
        ],
        ["Group", "Account", "Detail", "Debit", "Credit"],
        [...s.trial_balance.rows.map((r) => [r.group, r.account, r.detail, r.debit, r.credit]), ["", "Totals", "", s.trial_balance.totals.debit, s.trial_balance.totals.credit]],
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't export the trial balance.");
    } finally {
      setExporting(false);
    }
  }

  async function exportPnl() {
    setExporting(true);
    try {
      const p = pnl ?? readPnl(await getJson(`/api/books/data?report=pnl&entity=${encodeURIComponent(entityParam)}&year=${year}`, "Couldn't build revenue and expenses."));
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const rows: Array<Array<string | number | null>> = [];
      const fig = (section: string, label: string, f: { monthly: number[]; total: number }) => rows.push([section, label, ...f.monthly, f.total]);
      for (const b of p.sections) {
        for (const l of b.lines) fig(b.title, l.label, l.figures);
        if (b.rounding) fig(b.title, "Rounding", b.rounding);
        fig(b.title, `Total ${b.title.toLowerCase()}`, b.total);
        if (b.key === "operating") fig("", "Operating income", p.operating_income);
      }
      fig("", "Excess of receipts over disbursements", p.net);
      for (const l of p.uncategorized.lines) fig("Uncategorized, needs review (outside the totals)", l.label, l.figures);
      for (const b of p.flows) for (const l of b.lines) fig(`Outside the statement: ${b.title}`, l.label, l.figures);
      downloadCsv(
        `bfo-revenue-and-expenses-${year}.csv`,
        [
          ...scopeLines(`Revenue and expenses, cash basis, ${year}`, periodText(year, p.period)),
          "Whole dollars. Revenue, other income and personal items read money in as positive; operating expenses read money out as positive.",
        ],
        ["Section", "Account", ...months, "Total"],
        rows.map((r) => r.map((c) => (typeof c === "number" ? Math.round(c) : c))).map((r) => r.map((c) => (typeof c === "number" ? String(c) : c))),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't export revenue and expenses.");
    } finally {
      setExporting(false);
    }
  }

  const exportItems: MenuItem[] = [
    { label: "General ledger (CSV)", hint: "Every posted transaction", onSelect: () => void exportLedger(), disabled: exporting, disabledReason: "Exporting…" },
    { label: "Revenue and expenses (CSV)", onSelect: () => void exportPnl(), disabled: exporting, disabledReason: "Exporting…" },
    { label: "Trial balance (CSV)", onSelect: () => void exportTrialBalance(), disabled: exporting, disabledReason: "Exporting…" },
  ];

  // ── The pickers ──

  const years = useMemo(() => {
    const now = Number(thisYear());
    return [...new Set([year, ...[0, 1, 2].map((d) => String(now - d))])].sort().reverse();
  }, [year]);

  const asOfOptions = useMemo(() => {
    const opts = [{ value: "latest", label: "Latest reading" }];
    const from = sheet?.history_from;
    if (from) {
      const now = new Date();
      for (let i = 1; i <= 24; i++) {
        const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0));
        const iso = end.toISOString().slice(0, 10);
        if (iso < from) break;
        opts.push({ value: iso, label: `End of ${format.date(iso, "medium")}` });
      }
    }
    if (asOf !== "latest" && !opts.some((o) => o.value === asOf)) opts.push({ value: asOf, label: format.date(asOf, "medium") });
    return opts;
  }, [sheet?.history_from, asOf]);

  const context =
    view === "balance"
      ? `${scope} · ${sheet?.as_of && !loading ? (sheet.requested_as_of ? `Balances at the end of ${format.date(sheet.requested_as_of, "medium")}` : format.asOf(sheet.as_of, { time: true })) : "Latest reading"}`
      : `${scope} · ${periodText(year, view === "pnl" ? (pnl?.period ?? null) : (statements?.period ?? null))} · Cash basis`;

  const legend = view === "balance" ? "Unaudited · prepared from connected accounts for internal use; not a GAAP financial statement." : BASIS_LEGEND;

  return (
    <Page
      width={view === "pnl" ? "full" : "reading"}
      header={
        <PageHeader
          title="Reports"
          context={context}
          secondary={
            <Menu
              label="Export"
              align="end"
              items={exportItems}
              trigger={
                <Button icon="download" size="sm">
                  {exporting ? "Exporting…" : "Export"}
                </Button>
              }
            />
          }
        />
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented label="Report" value={view} onChange={setView} full={phone} options={VIEWS.map((v) => ({ value: v.value, label: phone ? v.short : v.label }))} />
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
            <div className="min-w-0 sm:w-[240px]">
              <MultiSelect
                label="Entities"
                placeholder="All entities"
                size="sm"
                value={selected}
                onChange={(v) => setSelected(v.length === entities.length ? [] : v)}
                options={entities.map((e) => ({ value: e.id, label: e.name }))}
                footnote="Choose none for all entities."
              />
            </div>
            <div className="min-w-0 sm:w-[180px]">
              {view === "balance" ? (
                <Select
                  label="As of"
                  size="sm"
                  value={asOf}
                  onChange={setAsOf}
                  options={asOfOptions}
                  footnote={sheet?.history_from ? `Daily balances are kept from ${format.date(sheet.history_from, "medium")}.` : "Past month-ends appear once daily balances are kept."}
                />
              ) : (
                <Select label="Year" size="sm" value={year} onChange={setYear} options={years.map((y) => ({ value: y, label: y }))} />
              )}
            </div>
          </div>
        </div>
        <p className="text-small text-ink-2">{legend}</p>
      </div>

      {error && (
        <Banner
          tone="negative"
          action={
            <Button variant="quiet" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          }
          onDismiss={() => setError("")}
        >
          {error}
        </Banner>
      )}

      {loading ? (
        <div className="flex flex-col gap-6" aria-busy="true">
          <KpiStrip label="Loading" items={[0, 1, 2].map((i) => ({ label: ["Receipts", "Disbursements", "Net"][i], value: <Skeleton kind="line" /> }))} />
          <div className="overflow-hidden rounded-card border border-line bg-raised">
            <Skeleton kind="table" rows={10} columns={view === "pnl" && !phone ? ["24%", ...Array<string>(6).fill("12%")] : ["70%", "30%"]} />
          </div>
        </div>
      ) : view === "pnl" ? (
        pnl && <PnlView pnl={pnl} entityCount={entityCount} scope={scope} drill={drill} />
      ) : view === "balance" ? (
        sheet && <BalanceView sheet={sheet} />
      ) : (
        statements && <StatementsView statements={statements} worksheet={worksheet} drill={(section, label) => drill(section, label)} />
      )}
    </Page>
  );
}
