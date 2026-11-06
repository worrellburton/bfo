/**
 * The statements on Books › Reports: where the year's cash went by activity,
 * the trial balance of the period's activity, and the 1099 worksheet. One
 * table pattern for all three: the title outside the card, column heads in
 * caption ink-2, a totals row. Figures from lib/books/statements.ts and
 * lib/books/tax1099.ts.
 */

import { Fragment, type ReactNode } from "react";
import { cx, format, Banner, Disclosure, Icon } from "./ui";
import { KpiStrip } from "./books-report-kit";
import { kpiMoney, scheduleMoney, statementMoney, type Statements, type Worksheet } from "./books-report-model";

type Drill = (section: string, label: string | null) => void;

export function StatementsView({ statements, worksheet, drill }: { statements: Statements; worksheet: Worksheet | null; drill: Drill }) {
  const cf = statements.cash_flow;
  const own = cf.blocks.find((b) => b.key === "own");
  const unc = cf.blocks.find((b) => b.key === "uncategorized");
  const operating = cf.blocks.find((b) => b.key === "operating");
  const tb = statements.trial_balance;
  const balanced = Math.round(tb.totals.debit * 100) === Math.round(tb.totals.credit * 100);

  return (
    <div className="flex flex-col gap-8">
      <KpiStrip
        label="Cash flow"
        items={[
          { label: "Net change in connected accounts", value: kpiMoney(cf.net_change), tone: "direction", amount: cf.net_change },
          { label: "From operations", value: kpiMoney(operating?.total ?? 0), hint: cf.ties_to_pnl ? "Ties to revenue and expenses" : undefined },
          { label: "Uncategorized, needs review", value: kpiMoney(unc?.total ?? 0) },
        ]}
      />

      <Section id="cf" title="Cash flow by activity" note="Money in, with money out in parentheses. Whole dollars.">
        <table className="w-full border-separate border-spacing-0 text-body text-ink">
          <caption className="sr-only">Cash flow by activity</caption>
          <tbody>
            {cf.blocks.map((b) => (
              <Fragment key={b.key}>
                <tr>
                  <th scope="rowgroup" colSpan={2} className={BAND}>
                    {b.title}
                  </th>
                </tr>
                {b.note && (
                  <tr>
                    <td colSpan={2} className="border-b border-line py-2 pr-5 pl-8 text-small text-ink-2 touch:pl-6">
                      {b.note}
                    </td>
                  </tr>
                )}
                {b.lines.length === 0 ? (
                  <tr>
                    <td colSpan={2} className={cx(CELL, "pl-8 text-ink-2 touch:pl-6")}>
                      None
                    </td>
                  </tr>
                ) : (
                  b.lines.map((l) => (
                    <tr key={l.label}>
                      <td className={cx(CELL, "pl-8 touch:pl-6", l.label === "Rounding" && "text-ink-2")}>{l.label}</td>
                      <td className={cx(AMT, l.label === "Rounding" && "text-ink-2")}>
                        <Amount text={statementMoney(l.amount)} label={`${l.label}: view transactions`} onOpen={l.drill ? () => drill(l.drill!, null) : null} />
                      </td>
                    </tr>
                  ))
                )}
                <tr className="font-semibold">
                  <td className={cx(CELL, "border-t border-t-line-strong")}>{BLOCK_TOTAL[b.key] ?? `Total ${b.title.toLowerCase()}`}</td>
                  <td className={cx(AMT, "border-t border-t-line-strong")}>{statementMoney(b.total)}</td>
                </tr>
              </Fragment>
            ))}
            <tr className="font-semibold">
              <td className={cx(CELL, GRAND)}>Net change in connected accounts</td>
              <td className={cx(AMT, GRAND)}>{statementMoney(cf.net_change)}</td>
            </tr>
          </tbody>
        </table>
        <div className="flex flex-col gap-2 border-t border-line px-5 py-4 text-small text-ink-2 touch:px-4">
          {own && Math.round(own.exact) !== 0 && (
            <p className="flex items-start gap-2 text-ink">
              <span className="mt-[2px] text-warning">
                <Icon name="warning" size={16} />
              </span>
              Transfers between your own accounts come to {statementMoney(own.total)}, not zero: some have no matching side in Books, usually a card or account that isn&rsquo;t connected.
            </p>
          )}
          {cf.ties_to_pnl && cf.pnl_net !== null && <p>Operating activities equal the excess of receipts over disbursements, {format.money(cf.pnl_net)}.</p>}
          <p>Not yet tied to bank statements: Bank vs books in Review ties each account&rsquo;s ledger to its balance.</p>
        </div>
      </Section>

      <Section
        id="tb"
        title="Trial balance, period activity"
        note="Double entry: each bank and card account shows its net movement for the period, not its balance. Before eliminations between entities. To the cent."
      >
        <table className="w-full border-separate border-spacing-0 text-body text-ink">
          <caption className="sr-only">Trial balance, period activity</caption>
          <thead>
            <tr>
              <th scope="col" className={cx(HEAD, "text-left")}>
                Account
              </th>
              <th scope="col" className={cx(HEAD, "w-[132px] text-right")}>
                Debit
              </th>
              <th scope="col" className={cx(HEAD, "w-[132px] pr-5 text-right touch:pr-4")}>
                Credit
              </th>
            </tr>
          </thead>
          <tbody>
            {groupRows(tb.rows, (g, rows) => (
              <Fragment key={g}>
                <tr>
                  <th scope="rowgroup" colSpan={3} className={BAND}>
                    {g}
                  </th>
                </tr>
                {rows.map((r) => {
                  const { code, name } = splitCode(r.account);
                  return (
                    <tr key={`${g}|${r.account}|${r.detail ?? ""}`}>
                      <td className={cx(CELL, "pl-8 touch:pl-6")}>
                        <span className="flex items-baseline gap-2">
                          {code && <span className="w-9 shrink-0 text-caption text-ink-2 tabular-nums">{code}</span>}
                          <span className="min-w-0">
                            {name}
                            {r.detail && <span className="block text-small text-ink-2">{r.detail}</span>}
                          </span>
                        </span>
                      </td>
                      <td className={cx(AMT, "pr-3", !r.debit && "text-ink-3")}>{scheduleMoney(r.debit)}</td>
                      <td className={cx(AMT, !r.credit && "text-ink-3")}>{scheduleMoney(r.credit)}</td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
            <tr className="font-semibold">
              <td className={cx(CELL, GRAND)}>Totals</td>
              <td className={cx(AMT, GRAND, "pr-3")}>{scheduleMoney(tb.totals.debit)}</td>
              <td className={cx(AMT, GRAND)}>{scheduleMoney(tb.totals.credit)}</td>
            </tr>
          </tbody>
        </table>
        <div className="h-3" aria-hidden="true" />
        {!balanced && (
          <div className="border-t border-line px-5 py-3 touch:px-4">
            <p className="flex items-start gap-2 text-small text-ink">
              <span className="mt-[2px] text-warning">
                <Icon name="warning" size={16} />
              </span>
              Debits and credits differ by {scheduleMoney(Math.abs(tb.totals.debit - tb.totals.credit))}. Tell the office: every transaction should post both sides.
            </p>
          </div>
        )}
        {tb.derived && <p className="border-t border-line px-5 py-3 text-small text-ink-2 touch:px-4">The bank and card side is shown as one net movement until each account is listed.</p>}
      </Section>

      {worksheet && <Worksheet1099 w={worksheet} />}
    </div>
  );
}

function Worksheet1099({ w }: { w: Worksheet }) {
  return (
    <Section
      id="1099"
      title={`Payees that may need a 1099 for ${w.year}`}
      note={`Candidates only: paid ${format.money(w.threshold, { precision: "dollars" })} or more in ${w.year} by one entity, to contract services, professional fees or rent. Card payments, payment platforms, marketplaces, governments and wages are left out. W-9 and taxpayer ID status isn't recorded in BFO yet. Confirm with your CPA before filing.`}
    >
      {w.threshold_note && (
        <div className="px-5 pt-4 touch:px-4">
          <Banner tone="warning">{w.threshold_note}</Banner>
        </div>
      )}
      {w.candidates.length === 0 ? (
        <p className="px-5 py-4 text-body text-ink-2 touch:px-4">No payee reached {format.money(w.threshold, { precision: "dollars" })} this year.</p>
      ) : (
        <ul className="ds-list">
          {w.candidates.map((c) => (
            <PayeeRow
              key={`${c.entity ?? ""}|${c.payee}|${c.form}`}
              title={c.payee}
              secondary={[c.entity, `Form 1099-${c.form}`, format.count(c.count, "payment"), c.via_transfers ? `${format.money(c.via_transfers)} of it filed as transfers` : null]
                .filter(Boolean)
                .join(" · ")}
              notes={c.notes}
              amount={c.paid}
            />
          ))}
        </ul>
      )}
      {w.below_threshold > 0 && <p className="border-t border-line px-5 py-3 text-small text-ink-2 touch:px-4">{format.count(w.below_threshold, "other payee")} paid less than the threshold.</p>}

      {w.wages.length > 0 && (
        <div className="border-t border-line">
          <h3 className="px-5 pt-4 text-small font-semibold text-ink touch:px-4">Wages paid outside payroll</h3>
          <p className="px-5 pt-1 pb-2 text-small text-ink-2 touch:px-4">
            Paid to Salaries &amp; Wages directly rather than through a payroll service. Wages go on a W-2 with withholding, never a 1099. Check each person&rsquo;s classification and withholding with
            your CPA.
          </p>
          <ul className="ds-list">
            {w.wages.map((p) => (
              <PayeeRow
                key={`${p.entity ?? ""}|${p.payee}`}
                title={p.payee}
                secondary={[p.entity, format.count(p.count, "payment"), p.via_transfers ? `${format.money(p.via_transfers)} of it filed as transfers` : null].filter(Boolean).join(" · ")}
                amount={p.paid}
              />
            ))}
          </ul>
        </div>
      )}

      {w.excluded.length > 0 && (
        <div className="border-t border-line px-5 py-3 touch:px-4">
          <Disclosure label="Left out" count={w.excluded.length}>
            <ul className="mt-2 flex flex-col">
              {w.excluded.map((e) => (
                <li key={`${e.entity ?? ""}|${e.payee}|${e.reason}`} className="flex items-start justify-between gap-4 border-t border-line py-2 first:border-t-0">
                  <span className="min-w-0">
                    <span className="block text-body text-ink">{e.payee}</span>
                    <span className="block text-small text-ink-2">{[e.entity, e.reason].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="shrink-0 text-body tabular-nums">{scheduleMoney(e.paid)}</span>
                </li>
              ))}
            </ul>
          </Disclosure>
        </div>
      )}
      {w.partial && <p className="border-t border-line px-5 py-3 text-small text-ink-2 touch:px-4">This list will also total payments filed as transfers once the new report is live.</p>}
    </Section>
  );
}

function PayeeRow({ title, secondary, notes = [], amount }: { title: string; secondary: string; notes?: string[]; amount: number }) {
  return (
    <li className="ds flex items-start justify-between gap-4 px-5 py-2 touch:px-4">
      <span className="min-w-0">
        <span className="block text-body text-ink">{title}</span>
        <span className="block text-small text-ink-2">{secondary}</span>
        {notes.map((n) => (
          <span key={n} className="block text-small text-ink-2">
            {n}
          </span>
        ))}
      </span>
      <span className="shrink-0 pt-px text-body font-medium tabular-nums">{scheduleMoney(amount)}</span>
    </li>
  );
}

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
      <div>
        <h2 id={`${id}-title`} className="text-section text-ink">
          {title}
        </h2>
        {note && <p className="mt-1 max-w-[68ch] text-small text-ink-2">{note}</p>}
      </div>
      <div className="ds overflow-hidden rounded-card border border-line bg-raised">{children}</div>
    </section>
  );
}

function Amount({ text, label, onOpen }: { text: string; label: string; onOpen: (() => void) | null }) {
  if (text === "—") return <span className="text-ink-3">—</span>;
  if (!onOpen) return <>{text}</>;
  return (
    <button type="button" aria-label={label} onClick={onOpen} className="cursor-pointer tabular-nums hover:underline hover:decoration-1 hover:underline-offset-[3px]">
      {text}
    </button>
  );
}

function splitCode(account: string): { code: string | null; name: string } {
  const m = /^(\d{4})\s+(.+)$/.exec(account);
  return m ? { code: m[1], name: m[2] } : { code: null, name: account };
}

function groupRows<T extends { group: string }>(rows: T[], render: (group: string, rows: T[]) => ReactNode): ReactNode[] {
  const order: string[] = [];
  const by = new Map<string, T[]>();
  for (const r of rows) {
    if (!by.has(r.group)) {
      by.set(r.group, []);
      order.push(r.group);
    }
    by.get(r.group)!.push(r);
  }
  return order.map((g) => render(g, by.get(g)!));
}

const BLOCK_TOTAL: Record<string, string> = {
  operating: "Net from operating activities",
  uncategorized: "Total uncategorized",
  investing: "Net from investing activities",
  financing: "Net from financing activities",
  own: "Net transfers",
  other: "Net transfers, loans and distributions",
};

const BAND = "h-8 border-b border-line bg-sunken pr-5 pl-5 text-left text-small font-semibold text-ink touch:pl-4";
const HEAD = "h-8 border-b border-line-strong pl-5 pr-3 text-caption font-medium text-ink-2 touch:pl-4";
const CELL = "h-(--row-1) border-b border-line py-2 pr-3 pl-5 align-top touch:pl-4";
const AMT = "border-b border-line py-2 pr-5 pl-3 text-right align-top tabular-nums whitespace-nowrap touch:pr-4";
const GRAND = "border-t border-t-ink border-b-[3px] border-b-ink border-double";
