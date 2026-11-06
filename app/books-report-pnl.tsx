/**
 * The revenue-and-expenses statement (cash basis) on Books › Reports: the
 * year by month or by entity, every figure a way into the transactions
 * behind it. The figures foot and cross-foot as the server sends them
 * (lib/books/statements.ts); this file only lays them out.
 *
 * Desktop: a statement table, sections that fold, the account column held
 * while the months scroll. Phones: a list per section, each account showing
 * its year total; a row opens the year's transactions, with the months at
 * the top of that page.
 */

import { Fragment, useState, type ReactNode } from "react";
import { cx, format, Banner, Button, Icon, List, ListRow, Segmented, usePhone } from "./ui";
import { KpiStrip } from "./books-report-kit";
import { kpiMoney, statementMoney, type Block, type Figures, type Line, type Pnl } from "./books-report-model";

type Drill = (section: string, label: string | null, column: { month?: number | null; col?: string | null }) => void;

const SUBTOTAL: Record<string, string> = {
  revenue: "Total revenue",
  operating: "Total operating expenses",
  other: "Total other income (expense)",
  personal: "Total personal (grantor)",
  uncategorized: "Total uncategorized",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Where a block's total drills: its own key, or the older server's section the adapter recorded. */
const totalDrill = (b: Block & { drill?: string | null }) => (b.drill === undefined ? b.key : b.drill);

export function PnlView({ pnl, entityCount, scope, drill }: { pnl: Pnl; entityCount: number; scope: string; drill: Drill }) {
  const phone = usePhone();
  const byEntityAvailable = pnl.columns.entities.length > 1;
  const [mode, setMode] = useState<"months" | "entities">("months");
  const cols = mode === "entities" && byEntityAvailable ? "entities" : "months";
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const shownSections = pnl.sections.filter((b) => b.lines.length > 0 || b.key === "revenue" || b.key === "operating");
  const allKeys = [...shownSections.map((b) => b.key), ...(pnl.uncategorized.lines.length ? ["uncategorized"] : []), ...pnl.flows.map((b) => b.key)];
  const allCollapsed = allKeys.every((k) => collapsed.has(k));
  const toggle = (k: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  // Months after the newest posted day haven't happened: blank, not a dash.
  const now = new Date();
  const through = pnl.period?.to ? Number(pnl.period.to.slice(5, 7)) - 1 : pnl.year === now.getFullYear() ? now.getMonth() : pnl.year < now.getFullYear() ? 11 : -1;
  const current = pnl.year === now.getFullYear() ? now.getMonth() : -1;

  const single = entityCount === 1;
  const revenueTotal = pnl.sections.find((b) => b.key === "revenue")?.total.total ?? 0;
  const margin = single && revenueTotal ? (pnl.operating_income.total / revenueTotal) * 100 : null;

  const kpis = [
    { label: "Receipts", value: kpiMoney(pnl.receipts) },
    { label: "Disbursements", value: kpiMoney(pnl.disbursements) },
    { label: "Excess of receipts over disbursements", value: kpiMoney(pnl.net.exact), tone: "direction" as const, amount: pnl.net.exact },
    pnl.uncategorized.lines.length > 0
      ? {
          label: "Uncategorized, needs review",
          value: kpiMoney(pnl.uncategorized.total.exact),
          hint: pnl.uncategorized.count > 0 ? `${format.count(pnl.uncategorized.count, "row")}, outside the totals` : "Outside the totals",
        }
      : margin !== null
        ? { label: "Operating margin", value: format.percent(margin, { sign: "accounting" }) }
        : { label: "Transactions", value: format.count(pnl.transaction_count, "transaction") },
  ];

  const coverage = pnl.coverage;
  const startsLate = !!coverage?.ledger_start && !!pnl.period && coverage.ledger_start > pnl.period.from;
  const late = coverage?.late_accounts ?? [];

  return (
    <div className="flex flex-col gap-6">
      <KpiStrip label={`${scope}, ${pnl.year}`} items={kpis} />

      {(startsLate || late.length > 0) && (
        <Banner tone="warning" title="Part of the year isn't in Books.">
          {startsLate && pnl.period?.to && `Books begins ${format.date(coverage!.ledger_start!, "medium")}, so this covers ${format.dateRange(coverage!.ledger_start!, pnl.period.to)} only. `}
          {late.length > 0 &&
            `${format.list(late.slice(0, 3).map((a) => `${a.account} (from ${format.date(a.first, "medium")})`))}${late.length > 3 ? ` and ${late.length - 3} more` : ""} ${late.length === 1 ? "starts" : "start"} partway through the year.`}
        </Banner>
      )}

      <section aria-labelledby="pnl-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 id="pnl-title" className="text-section text-ink">
              Revenue and expenses, cash basis
            </h2>
            {entityCount > 1 && (
              <p className="mt-1 text-small text-ink-2">
                Combined, not consolidated: {format.count(entityCount, "separate entity", "separate entities")}, each its own legal person.
                {byEntityAvailable && !phone ? " Choose By entity to see each one." : ""}
              </p>
            )}
          </div>
          {!phone && (
            <div className="flex items-center gap-2">
              {byEntityAvailable && (
                <Segmented
                  label="Columns"
                  value={cols}
                  onChange={setMode}
                  options={[
                    { value: "months", label: "By month" },
                    { value: "entities", label: "By entity" },
                  ]}
                />
              )}
              <Button variant="quiet" size="sm" onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(allKeys))}>
                {allCollapsed ? "Expand all" : "Collapse all"}
              </Button>
            </div>
          )}
        </div>

        {pnl.transaction_count === 0 ? (
          <div className="rounded-card border border-line bg-raised px-5 py-5 text-body text-ink-2">Nothing is booked for {pnl.year} in this selection. Choose another year or more entities.</div>
        ) : phone ? (
          <PhoneStatement pnl={pnl} sections={shownSections} drill={drill} />
        ) : (
          <Matrix pnl={pnl} sections={shownSections} cols={cols} collapsed={collapsed} toggle={toggle} drill={drill} through={through} current={current} marginRow={margin !== null} />
        )}
      </section>

      {pnl.flows.length > 0 && (
        <section aria-labelledby="flow-title" className="flex flex-col gap-3">
          <div>
            <h2 id="flow-title" className="text-section text-ink">
              Outside the statement
            </h2>
            <p className="mt-1 text-small text-ink-2">Money moved between your own accounts, loans and distributions. Net in, with money out in parentheses.</p>
          </div>
          {phone ? (
            <PhoneFlows pnl={pnl} drill={drill} />
          ) : (
            <Matrix pnl={pnl} sections={pnl.flows} cols={cols} collapsed={collapsed} toggle={toggle} drill={drill} through={through} current={current} flows />
          )}
          {pnl.eliminated.count > 0 && (
            <p className="text-small text-ink-2">
              {pnl.eliminated.in || pnl.eliminated.out
                ? `Between family entities, matched on both sides and left out: ${format.list(
                    [
                      pnl.eliminated.in ? `${format.money(pnl.eliminated.in, { precision: "dollars" })} in` : "",
                      pnl.eliminated.out ? `${format.money(pnl.eliminated.out, { precision: "dollars" })} out` : "",
                    ].filter(Boolean),
                  )}, in ${format.count(pnl.eliminated.count, "transaction")}.`
                : `${format.count(pnl.eliminated.count, "transaction")} between family entities ${pnl.eliminated.count === 1 ? "is" : "are"} left out.`}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

// ── Desktop: the statement table ─────────────────────────────────────────

function Matrix({
  pnl,
  sections,
  cols,
  collapsed,
  toggle,
  drill,
  through,
  current,
  flows = false,
  marginRow = false,
}: {
  pnl: Pnl;
  sections: Block[];
  cols: "months" | "entities";
  collapsed: Set<string>;
  toggle: (k: string) => void;
  drill: Drill;
  through: number;
  current: number;
  flows?: boolean;
  marginRow?: boolean;
}) {
  const heads =
    cols === "months"
      ? MONTHS.map((m, i) => ({ key: String(i), label: m, month: i + 1, col: null as string | null }))
      : pnl.columns.entities.map((e) => ({ key: e.id, label: e.name, month: null as number | null, col: e.id }));
  const values = (f: Figures) => (cols === "months" ? f.monthly : f.by_entity);
  const span = heads.length + 2;
  const future = (i: number) => cols === "months" && i > through;

  const cell = (v: number, i: number, rowName: string, section: string | null, label: string | null, strong = false, rule = "") => {
    const h = heads[i];
    if (future(i) && v === 0) return <td key={h.key} className={cx(NUM, rule, i === current && cols === "months" && "bg-sunken")} />;
    const text = statementMoney(v);
    return (
      <td key={h.key} className={cx(NUM, rule, strong && "font-semibold", text === "—" && "text-ink-3", i === current && cols === "months" && "bg-sunken")}>
        {text === "—" || section === null ? (
          text
        ) : (
          <button
            type="button"
            className="cursor-pointer rounded-mark tabular-nums hover:underline hover:decoration-1 hover:underline-offset-[3px]"
            aria-label={`${rowName}, ${cols === "months" ? MONTH_NAMES[i] : h.label}: view transactions`}
            onClick={() => drill(section, label, { month: h.month, col: h.col })}
          >
            {text}
          </button>
        )}
      </td>
    );
  };

  const total = (v: number, rowName: string, section: string | null, label: string | null, strong = false, rule = "") => {
    const text = statementMoney(v);
    return (
      <td className={cx(NUM, TOTAL, rule, strong ? "font-semibold" : "font-medium", text === "—" && "text-ink-3")}>
        {text === "—" || section === null ? (
          text
        ) : (
          <button
            type="button"
            className="cursor-pointer rounded-mark tabular-nums hover:underline hover:decoration-1 hover:underline-offset-[3px]"
            aria-label={`${rowName}, full year: view transactions`}
            onClick={() => drill(section, label, {})}
          >
            {text}
          </button>
        )}
      </td>
    );
  };

  const lineRow = (b: Block, l: Line) => (
    <tr key={`${b.key}|${l.label}`} className="hover:bg-hover">
      <th scope="row" className={cx(LABEL, "pl-8 font-normal")}>
        <span className="flex items-baseline gap-2">
          {l.code && <span className="w-9 shrink-0 text-caption text-ink-2 tabular-nums">{l.code}</span>}
          <span className="min-w-0">{l.name}</span>
        </span>
      </th>
      {values(l.figures).map((v, i) => cell(v, i, l.label, l.drill, l.label))}
      {total(l.figures.total, l.label, l.drill, l.label)}
    </tr>
  );

  const roundingRow = (b: Block) =>
    b.rounding && (
      <tr key={`${b.key}|rounding`}>
        <th scope="row" className={cx(LABEL, "pl-8 font-normal text-ink-2")}>
          Rounding
        </th>
        {values(b.rounding).map((v, i) => (
          <td key={i} className={cx(NUM, "text-ink-2", i === current && cols === "months" && "bg-sunken")}>
            {future(i) && v === 0 ? "" : statementMoney(v)}
          </td>
        ))}
        <td className={cx(NUM, TOTAL, "text-ink-2")}>{statementMoney(b.rounding.total)}</td>
      </tr>
    );

  const subtotalRow = (key: string, name: string, f: Figures, section: string | null, kind: "sub" | "grand" = "sub") => {
    // A subtotal has a rule above; the statement's final total an ink rule above and a double rule below.
    const rule = kind === "grand" ? "border-t border-t-ink border-b-[3px] border-b-ink border-double" : "border-t border-t-line-strong";
    return (
      <tr key={key} className="font-semibold">
        <th scope="row" className={cx(LABEL, rule)}>
          {name}
        </th>
        {values(f).map((v, i) => cell(v, i, name, section, null, true, rule))}
        {total(f.total, name, section, null, true, rule)}
      </tr>
    );
  };

  const band = (b: Block, extra?: ReactNode) => {
    const open = !collapsed.has(b.key);
    return (
      <tr key={`${b.key}|band`}>
        <th scope="rowgroup" colSpan={span} className="h-8 border-b border-line bg-sunken p-0 text-left">
          <span className="sticky left-0 inline-flex items-center gap-2 pl-3">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => toggle(b.key)}
              className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-control px-2 text-small font-semibold text-ink hover:bg-hover"
            >
              <span className={cx("inline-flex transition-transform duration-(--dur-3)", open && "rotate-90")}>
                <Icon name="chevronRight" size={16} />
              </span>
              {b.title}
            </button>
            {extra}
          </span>
        </th>
      </tr>
    );
  };

  const noteRow = (key: string, text: ReactNode, tone: "ink-2" | "warning" = "ink-2") => (
    <tr key={key}>
      <td colSpan={span} className="p-0">
        <p className={cx("sticky left-0 flex max-w-[720px] items-start gap-2 py-2 pr-5 pl-8 text-small", tone === "warning" ? "text-ink" : "text-ink-2")}>
          {tone === "warning" && (
            <span className="mt-[2px] text-warning">
              <Icon name="warning" size={16} />
            </span>
          )}
          <span>{text}</span>
        </p>
      </td>
    </tr>
  );

  const unc = pnl.uncategorized;
  const revenue = sections.find((b) => b.key === "revenue");
  const marginValues = (f: Figures, r: Figures) => values(f).map((v, i) => (values(r)[i] ? (v / values(r)[i]) * 100 : null));

  return (
    <div className="ds overflow-x-auto rounded-card border border-line bg-raised">
      {/* The same column widths in both tables: the account column fixed (long names wrap), each figure column 88px or more. */}
      <table className="w-full border-separate border-spacing-0 text-body text-ink" style={{ minWidth: 260 + heads.length * 96 + 112 }}>
        <caption className="sr-only">{flows ? "Outside the statement, net in" : "Revenue and expenses, cash basis"}</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-sticky h-8 w-[260px] border-r border-b border-r-line border-b-line-strong bg-raised pr-3 pl-5 text-left text-caption font-medium text-ink-2">
              {flows ? "Net in / (out)" : "Account"}
            </th>
            {heads.map((h, i) => (
              <th
                key={h.key}
                scope="col"
                className={cx(
                  "h-8 min-w-[88px] border-b border-line-strong px-3 text-right text-caption font-medium whitespace-nowrap",
                  i === current && cols === "months" ? "bg-sunken text-ink" : "text-ink-2",
                  cols === "entities" && "max-w-[140px] truncate",
                )}
                title={cols === "entities" ? h.label : undefined}
              >
                {h.label}
              </th>
            ))}
            <th
              scope="col"
              className="sticky right-0 z-sticky h-8 min-w-[104px] border-b border-l border-b-line-strong border-l-line bg-raised pr-5 pl-3 text-right text-caption font-medium text-ink-2"
            >
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {sections.map((b) => {
            const open = !collapsed.has(b.key);
            const check = b.check && Math.round(b.check.unmatched) !== 0 ? b.check : null;
            return (
              <Fragment key={b.key}>
                {band(b)}
                {open && b.note && noteRow(`${b.key}|note`, b.note)}
                {open &&
                  check &&
                  noteRow(
                    `${b.key}|check`,
                    `Doesn't net to zero: ${statementMoney(check.unmatched)} in ${format.count(check.unmatched_count, "transfer")} with no matching transfer. Usually an account or card that isn't connected.`,
                    "warning",
                  )}
                {open && b.lines.map((l) => lineRow(b, l))}
                {open && b.lines.length === 0 && noteRow(`${b.key}|none`, "None")}
                {open && roundingRow(b)}
                {subtotalRow(`${b.key}|total`, flows ? `Net ${b.title.charAt(0).toLowerCase()}${b.title.slice(1)}` : (SUBTOTAL[b.key] ?? `Total ${b.title.toLowerCase()}`), b.total, totalDrill(b))}
                {!flows && b.key === "operating" && subtotalRow("operating-income", "Operating income", pnl.operating_income, "operating_income")}
              </Fragment>
            );
          })}
          {!flows && subtotalRow("net", "Excess of receipts over disbursements", pnl.net, "net", "grand")}
          {!flows && marginRow && revenue && (
            <tr>
              <th scope="row" className={cx(LABEL, "font-normal text-ink-2")}>
                Operating margin
              </th>
              {marginValues(pnl.operating_income, revenue.total).map((p, i) => (
                <td key={i} className={cx(NUM, "text-ink-2")}>
                  {p === null ? (future(i) ? "" : "—") : format.percent(p, { sign: "accounting" })}
                </td>
              ))}
              <td className={cx(NUM, "border-l border-l-line pr-5 text-ink-2")}>
                {revenue.total.total ? format.percent((pnl.operating_income.total / revenue.total.total) * 100, { sign: "accounting" }) : "—"}
              </td>
            </tr>
          )}
          {!flows && unc.lines.length > 0 && (
            <>
              <tr>
                <td colSpan={span} className="h-6 p-0" />
              </tr>
              {band(
                unc,
                <span className="inline-flex items-center gap-1 text-small text-ink-2">
                  <span className="text-warning">
                    <Icon name="warning" size={16} />
                  </span>
                  {format.count(unc.count, "row")}
                </span>,
              )}
              {!collapsed.has(unc.key) && noteRow("unc|note", unc.note ?? "Not in any total above.")}
              {!collapsed.has(unc.key) && unc.lines.map((l) => lineRow(unc, l))}
              {!collapsed.has(unc.key) && roundingRow(unc)}
              {subtotalRow("unc|total", "Total uncategorized", unc.total, totalDrill(unc))}
            </>
          )}
        </tbody>
      </table>
      <div className="h-3" aria-hidden="true" />
    </div>
  );
}

const NUM = "h-(--row-1) border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap";
/** The year's total stays in view while the months scroll. */
const TOTAL = "sticky right-0 z-sticky border-l border-l-line bg-raised pr-5";
const LABEL = "sticky left-0 z-sticky h-(--row-1) border-r border-b border-r-line border-b-line bg-raised py-2 pr-3 pl-5 text-left";

// ── Phones: a list per section ───────────────────────────────────────────

function PhoneRow({ title, secondary, amount, onOpen, strong = false }: { title: string; secondary?: string; amount: number; onOpen: (() => void) | null; strong?: boolean }) {
  const text = statementMoney(amount);
  return (
    <ListRow
      title={strong ? <span className="font-semibold">{title}</span> : title}
      secondary={secondary}
      trailing={
        <span className={cx(text === "—" && "text-ink-3", strong && "font-semibold")}>
          {text}
          {onOpen && <span className="sr-only">, full year: view transactions</span>}
        </span>
      }
      onClick={onOpen ?? undefined}
      label={title}
    />
  );
}

function PhoneBlock({ b, drill, totalLabel, extra }: { b: Block; drill: Drill; totalLabel: string; extra?: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-card border border-line bg-raised">
      <h3 className="flex items-center justify-between gap-3 border-b border-line bg-sunken px-4 py-2 text-small font-semibold text-ink">
        <span>{b.title}</span>
        {extra}
      </h3>
      {b.note && <p className="px-4 pt-3 text-small text-ink-2">{b.note}</p>}
      <List label={b.title}>
        {b.lines.map((l) => (
          <PhoneRow key={l.label} title={l.name} secondary={l.code ?? undefined} amount={l.figures.total} onOpen={l.drill && l.figures.total !== 0 ? () => drill(l.drill!, l.label, {}) : null} />
        ))}
        {b.rounding && b.rounding.total !== 0 && <PhoneRow title="Rounding" amount={b.rounding.total} onOpen={null} />}
        <PhoneRow title={totalLabel} amount={b.total.total} onOpen={totalDrill(b) && b.total.total !== 0 ? () => drill(totalDrill(b)!, null, {}) : null} strong />
      </List>
    </section>
  );
}

function PhoneStatement({ pnl, sections, drill }: { pnl: Pnl; sections: Block[]; drill: Drill }) {
  const unc = pnl.uncategorized;
  return (
    <div className="flex flex-col gap-4">
      {sections.map((b) => (
        <Fragment key={b.key}>
          <PhoneBlock b={b} drill={drill} totalLabel={SUBTOTAL[b.key] ?? `Total ${b.title.toLowerCase()}`} />
          {b.key === "operating" && (
            <div className="rounded-card border border-line bg-raised">
              <List label="Operating income">
                <PhoneRow title="Operating income" amount={pnl.operating_income.total} onOpen={() => drill("operating_income", null, {})} strong />
              </List>
            </div>
          )}
        </Fragment>
      ))}
      <div className="rounded-card border-2 border-ink bg-raised">
        <List label="Excess of receipts over disbursements">
          <PhoneRow title="Excess of receipts over disbursements" amount={pnl.net.total} onOpen={() => drill("net", null, {})} strong />
        </List>
      </div>
      {unc.lines.length > 0 && (
        <PhoneBlock
          b={unc}
          drill={drill}
          totalLabel="Total uncategorized"
          extra={
            <span className="inline-flex items-center gap-1 font-normal text-ink-2">
              <span className="text-warning">
                <Icon name="warning" size={16} />
              </span>
              {format.count(unc.count, "row")}
            </span>
          }
        />
      )}
    </div>
  );
}

function PhoneFlows({ pnl, drill }: { pnl: Pnl; drill: Drill }) {
  return (
    <div className="flex flex-col gap-4">
      {pnl.flows.map((b) => (
        <PhoneBlock key={b.key} b={b} drill={drill} totalLabel="Net" />
      ))}
    </div>
  );
}
