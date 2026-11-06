/**
 * MSAs: every management services agreement on the family's entities, with
 * its contracted fee in the months it's billed for the chosen year. Fee
 * income (a family entity manages someone) and fee expense (a family entity
 * is managed) are subtotalled apart and never netted; an agreement between
 * two family entities is intercompany and kept out of both. The figures are
 * what the agreements say, not what was billed or received. The arithmetic
 * is in msas-model.ts.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Badge, Button, Card, Empty, List, ListRow, Page, PageHeader, Segmented, Select, Skeleton, Status, Toolbar, cx, format, useDocumentTitle, usePhone } from "../ui";
import { isContracted, inYear, msaCsv, msaFrom, schedule, span, sum, type Msa } from "./msas-model";

export function meta() {
  return [{ title: "MSAs · BFO" }];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const SIDES: { key: "income" | "expense" | "intercompany"; label: string; note?: string }[] = [
  { key: "income", label: "Fee income", note: "A family entity is the manager and is paid the fee." },
  { key: "expense", label: "Fee expense", note: "A family entity is managed and pays the fee." },
  { key: "intercompany", label: "Intercompany", note: "Between two family entities: not in either total." },
];
const sideOf = (m: Msa) => (m.intercompany ? "intercompany" : m.direction);

const cents = (n: number | null) => (n == null ? "" : format.money(n, { zero: "dash" }));
const per: Record<string, string> = { Monthly: "a month", Quarterly: "a quarter", Annually: "a year", "One-time": "one time" };

export default function MSAs() {
  useDocumentTitle("MSAs");
  const phone = usePhone();
  const now = new Date();
  const thisYear = now.getFullYear();
  const [year, setYear] = useState(thisYear);
  const [scope, setScope] = useState<"active" | "all">("active");
  const [all, setAll] = useState<Msa[] | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let alive = true;
    void (async () => {
      const { db, ref, onValue } = await import("../store");
      if (!alive) return;
      unsub = onValue(ref(db, "assets"), (snap) => {
        const data = (snap.val() ?? {}) as Record<string, { name?: string; contracts?: Record<string, Record<string, unknown>> }>;
        const family = Object.entries(data).map(([id, a]) => ({ id, name: a?.name ?? null }));
        const list: Msa[] = [];
        for (const [assetId, asset] of Object.entries(data)) {
          for (const [cid, c] of Object.entries(asset?.contracts ?? {})) {
            if (!c || (c as { archivedAt?: number }).archivedAt) continue;
            list.push(msaFrom(assetId, asset?.name ?? "Entity", cid, c as never, family));
          }
        }
        list.sort((a, b) => a.counterparty.localeCompare(b.counterparty));
        setAll(list);
      });
    })();
    return () => {
      alive = false;
      unsub?.();
    };
  }, []);

  const rows = useMemo(() => (all ?? []).filter((m) => (scope === "active" ? isContracted(m) : true) && inYear(m, year)), [all, scope, year]);
  const sched = useMemo(() => new Map(rows.map((m) => [m.id, schedule(m, year)])), [rows, year]);
  const sides = SIDES.map((s) => ({ ...s, rows: rows.filter((m) => sideOf(m) === s.key) })).filter((s) => s.rows.length);
  const monthTotals = (list: Msa[]) => MONTHS.map((_, i) => (list.some((m) => sched.get(m.id)![i] != null) ? sum(list.map((m) => sched.get(m.id)![i])) : null));
  const total = (list: Msa[]) => sum(list.map((m) => sum(sched.get(m.id)!)));
  const income = total(rows.filter((m) => sideOf(m) === "income"));
  const expense = total(rows.filter((m) => sideOf(m) === "expense"));
  const lastActual = year < thisYear ? 11 : year > thisYear ? -1 : now.getMonth();

  const years = useMemo(() => {
    const from = Math.min(thisYear - 3, ...(all ?? []).map((m) => (m.effective ? +m.effective.slice(0, 4) : thisYear)));
    return Array.from({ length: thisYear + 2 - from + 1 }, (_, i) => from + i).reverse();
  }, [all, thisYear]);

  function exportCsv() {
    const blob = new Blob([msaCsv(rows, year, MONTHS)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `BFO_MSAs_${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const count = rows.filter((m) => !m.intercompany).length;
  const context =
    all === null
      ? undefined
      : `${format.count(count, scope === "active" ? "active agreement" : "agreement")} in ${year}${income ? ` · ${format.money(income)} fee income` : ""}${expense ? ` · ${format.money(expense)} fee expense` : ""} · contracted, not what was billed`;

  const parties = (m: Msa) => (m.direction === "income" ? `${m.entity} manages; ${m.counterparty} pays` : `${m.counterparty} manages; ${m.entity} pays`);
  const terms = (m: Msa) =>
    [m.amount != null ? `${format.money(m.amount)}${m.frequency ? ` ${per[m.frequency]}` : ""}` : "Fee not recorded", m.effective ? `from ${format.date(m.effective, "medium")}` : "", m.ends ? `to ${format.date(m.ends, "medium")}` : m.term].filter(Boolean).join(" · ");
  const flag = (m: Msa) => (m.stage === "unsigned-active" ? <Status tone="warning">Active, not signed</Status> : m.stage === "terminated" ? <Status tone="neutral">Terminated</Status> : m.stage === "draft" ? <Status tone="neutral">Draft</Status> : null);

  const head = "sticky top-0 z-sticky h-8 border-b border-line-strong bg-raised px-3 text-right text-caption font-medium whitespace-nowrap";
  const table = (
    <Card flush>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-body text-ink">
          <caption className="sr-only">
            Contracted fees by month, {year}. Months after {MONTHS[Math.max(0, lastActual)]} are projected.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="sticky top-0 left-0 z-sticky h-8 w-[300px] min-w-[300px] border-r border-b border-r-line border-b-line-strong bg-raised pr-3 pl-5 text-left text-caption font-medium text-ink-2">
                Agreement
              </th>
              {MONTHS.map((mo, i) => (
                <th key={mo} scope="col" className={cx(head, i > lastActual ? "text-ink-3" : "text-ink-2")}>
                  {mo}
                </th>
              ))}
              <th scope="col" className={cx(head, "border-l border-l-line pr-5 text-ink-2")}>
                Total
              </th>
            </tr>
          </thead>
          {sides.map((s) => {
            const totals = monthTotals(s.rows);
            return (
              <tbody key={s.key}>
                <tr>
                  <th scope="colgroup" colSpan={14} className="h-8 border-b border-line bg-sunken px-5 text-left text-small font-semibold text-ink">
                    {s.label} <span className="font-normal text-ink-2">· {s.note}</span>
                  </th>
                </tr>
                {s.rows.map((m) => {
                  const cells = sched.get(m.id)!;
                  return (
                    <tr key={m.id}>
                      <td className="sticky left-0 border-r border-b border-r-line border-b-line bg-raised py-2 pr-3 pl-5 align-top">
                        <Link to={`/assets/${m.assetId}/agreements`} className="font-medium text-ink hover:underline">
                          {m.counterparty}
                        </Link>
                        <span className="block text-small text-ink-2">{parties(m)}</span>
                        <span className="block text-small text-ink-2">{terms(m)}</span>
                        {flag(m) && <span className="mt-1 block">{flag(m)}</span>}
                      </td>
                      {cells.map((c, i) => (
                        <td key={i} className={cx("border-b border-line px-3 py-2 text-right align-top whitespace-nowrap tabular-nums", c === 0 ? "text-ink-3" : i > lastActual ? "text-ink-2" : "text-ink")}>
                          {cents(c)}
                        </td>
                      ))}
                      <td className="border-b border-l border-line border-l-line px-3 py-2 pr-5 text-right align-top font-medium whitespace-nowrap tabular-nums">{cents(sum(cells))}</td>
                    </tr>
                  );
                })}
                {s.key !== "intercompany" && (
                  <tr className="font-semibold">
                    <td className="sticky left-0 border-t border-r border-b border-t-line-strong border-r-line border-b-line bg-raised py-2 pr-3 pl-5">Total {s.label.toLowerCase()}</td>
                    {totals.map((t, i) => (
                      <td key={i} className={cx("border-t border-b border-t-line-strong border-b-line px-3 py-2 text-right whitespace-nowrap tabular-nums", t === 0 && "text-ink-3")}>
                        {cents(t)}
                      </td>
                    ))}
                    <td className="border-t border-b border-l border-t-line-strong border-b-line border-l-line px-3 py-2 pr-5 text-right whitespace-nowrap tabular-nums">{cents(total(s.rows))}</td>
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
      </div>
    </Card>
  );

  // Phones: one row per agreement (its fee, months and year's total); the months are on the desktop table.
  const phoneList = (
    <div className="flex flex-col gap-4">
      {sides.map((s) => (
        <Card key={s.key} title={s.label} flush>
          <p className="px-4 pb-3 text-small text-ink-2">{s.note}</p>
          <List label={s.label}>
            {s.rows.map((m) => (
              <ListRow
                key={m.id}
                to={`/assets/${m.assetId}/agreements`}
                title={m.counterparty}
                secondary={`${m.amount != null ? `${format.money(m.amount)}${m.frequency ? ` ${per[m.frequency]}` : ""}` : "Fee not recorded"} · ${span(m, year, MONTHS)} · ${m.entity}`}
                trailing={cents(sum(sched.get(m.id)!))}
              />
            ))}
          </List>
          {s.key !== "intercompany" && (
            <div className="flex items-center justify-between border-t border-line-strong px-4 py-3 font-semibold tabular-nums">
              <span>Total {s.label.toLowerCase()}</span>
              <span>{cents(total(s.rows))}</span>
            </div>
          )}
        </Card>
      ))}
    </div>
  );

  return (
    <Page
      width={phone ? "workspace" : "full"}
      header={
        <PageHeader
          title="MSAs"
          context={context}
          secondary={
            <Button icon="download" onClick={exportCsv} disabled={!rows.length} disabledReason={rows.length ? undefined : "Nothing to export"}>
              Export
            </Button>
          }
        />
      }
    >
      <div className="flex flex-col gap-4">
        <Toolbar
          filters={<Select size="sm" label="Year" value={String(year)} onChange={(v) => setYear(Number(v))} options={years.map((y) => ({ value: String(y), label: String(y), hint: y > thisYear ? "Projected" : undefined }))} />}
          view={
            <Segmented
              label="Agreements"
              value={scope}
              onChange={setScope}
              options={[
                { value: "active", label: "Active" },
                { value: "all", label: "All" },
              ]}
            />
          }
        />
        <p className="text-small text-pretty text-ink-2">
          Fees sit in the months they&apos;re billed: monthly every month, quarterly every third month from the effective date, annually on the anniversary, one-time once. Each agreement stops at its termination or at the end of a fixed term. Nothing is prorated.
          {year >= thisYear && lastActual < 11 ? ` Months after ${MONTHS[Math.max(0, lastActual)]} ${year} are projected.` : ""}
        </p>
        {all === null ? (
          <Card flush>
            <Skeleton kind="table" rows={3} columns={["30%", "50%", "20%"]} />
          </Card>
        ) : !rows.length ? (
          <Empty title={all.length ? `No ${scope === "active" ? "active " : ""}agreements in ${year}` : "No agreements yet"} size="page">
            {all.length
              ? "None of the agreements on record is in effect for this year. Choose another year, or All to include drafts and terminated ones."
              : "Management services agreements are drafted on an entity's Contracts tab. Once one is signed or marked active, its fees show here by month. Only the office team sees this page."}
          </Empty>
        ) : phone ? (
          phoneList
        ) : (
          table
        )}
        {rows.some((m) => m.intercompany) && (
          <p className="flex items-center gap-2 text-small text-ink-2">
            <Badge>Intercompany</Badge>
            Fees between two family entities are left out of both totals; they eliminate on consolidation.
          </p>
        )}
      </div>
    </Page>
  );
}
