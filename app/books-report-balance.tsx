/**
 * The connected balances on Books › Reports: what the connected accounts
 * held, plus the loans the family is owed, as of the latest reading or a
 * past day. It says plainly what it leaves out (real estate, interests in
 * entities, any liability that isn't connected) and names the liabilities
 * the ledger shows payments to. Figures from lib/books/balance-sheet.ts.
 */

import { Fragment } from "react";
import { cx, format, Banner, Icon, TextLink } from "./ui";
import { KpiStrip } from "./books-report-kit";
import { kpiMoney, statementMoney, type Sheet, type SheetRow, type SheetSection } from "./books-report-model";

export function BalanceView({ sheet }: { sheet: Sheet }) {
  const latest = sheet.as_of;
  const mortgage = sheet.unlinked_liabilities.filter((u) => u.kind === "mortgage");
  const cards = sheet.unlinked_liabilities.filter((u) => u.kind === "card");
  const sections = sheet.sections.filter((s) => s.rows.length > 0 || s.key === "cash" || s.key === "liabilities");

  return (
    <div className="flex flex-col gap-6">
      <KpiStrip
        label="Connected balances"
        items={[
          { label: "Net connected balances", value: kpiMoney(sheet.net_worth), tone: "direction", amount: sheet.net_worth },
          { label: "Assets", value: kpiMoney(sheet.total_assets) },
          { label: "Liabilities", value: kpiMoney(sheet.total_liabilities) },
        ]}
      />

      <p className="max-w-[68ch] text-small text-ink-2">
        Connected accounts only, at their latest reading. Excludes real estate, interests in entities and any liability that isn&rsquo;t connected, so this is not a full balance sheet or a statement
        of net worth.
        {sheet.entities_count > 1 && ` Combined across ${format.count(sheet.entities_count, "separate entity", "separate entities")}, each its own legal person.`}
      </p>

      {(mortgage.length > 0 || cards.length > 0) && (
        <Banner tone="warning" title="Liabilities the books pay that aren't here.">
          {[
            ...mortgage.map((m) => `${m.payee}: mortgage payments, ${kpiMoney(m.paid)} in the last 120 days, last on ${format.date(m.last_date, "medium")}`),
            ...cards.map((c) => `${c.payee}: card payments, ${kpiMoney(c.paid)} in the last 120 days`),
          ].join("; ")}
          . Connect these accounts in Treasury so their balances are counted.
        </Banner>
      )}
      {sheet.unattached_loan_rows > 0 && (
        <Banner tone="warning" action={<TextLink to="/books/loans">Open Loans</TextLink>}>
          {format.count(sheet.unattached_loan_rows, "transaction")} filed to Loans in the last 120 days {sheet.unattached_loan_rows === 1 ? "isn't" : "aren't"} attached to a loan, so the loan balances
          may be off.
        </Banner>
      )}
      {sheet.unassigned_loans > 0 && (
        <Banner tone="info">
          {format.count(sheet.unassigned_loans, "loan")} with no holder recorded {sheet.unassigned_loans === 1 ? "is" : "are"} on the all-entities sheet only. Record the holder in Loans to show it
          here.
        </Banner>
      )}

      <section aria-labelledby="bs-title" className="flex flex-col gap-3">
        <h2 id="bs-title" className="text-section text-ink">
          Connected balances
        </h2>
        <div className="ds overflow-hidden rounded-card border border-line bg-raised">
          <table className="w-full border-separate border-spacing-0 text-body text-ink">
            <caption className="sr-only">Connected balances</caption>
            <thead>
              <tr>
                <th scope="col" className="h-8 border-b border-line-strong pr-3 pl-5 text-left text-caption font-medium text-ink-2 touch:pl-4">
                  Account
                </th>
                <th scope="col" className="h-8 w-[140px] border-b border-line-strong pr-5 pl-3 text-right text-caption font-medium text-ink-2 touch:pr-4">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody>
              {sections
                .filter((s) => s.side === "asset")
                .map((s) => (
                  <SectionRows key={s.key} s={s} latest={latest} />
                ))}
              <TotalRow label="Total assets" value={sheet.total_assets} />
              {sections
                .filter((s) => s.side === "liability")
                .map((s) => (
                  <SectionRows key={s.key} s={s} latest={latest} negate subtotal={false} />
                ))}
              <TotalRow label="Total liabilities" value={-sheet.total_liabilities} />
              <TotalRow label="Net connected balances" value={sheet.net_worth} grand />
            </tbody>
          </table>
        </div>
        {sheet.earliest_as_of && sheet.earliest_as_of !== latest && <p className="text-caption text-ink-2">Oldest reading in this view: {format.dateTime(sheet.earliest_as_of)}.</p>}
      </section>

      {sheet.individual && (
        <section aria-labelledby="bs-individual" className="flex flex-col gap-3">
          <div>
            <h2 id="bs-individual" className="text-section text-ink">
              {sheet.individual.title}
            </h2>
            <p className="mt-1 text-small text-ink-2">{sheet.individual.note}</p>
          </div>
          <div className="ds overflow-hidden rounded-card border border-line bg-raised">
            <table className="w-full border-separate border-spacing-0 text-body text-ink">
              <caption className="sr-only">{sheet.individual.title}</caption>
              <tbody>
                {sheet.individual.rows.map((r, i) => (
                  <AccountRow key={`${r.account_id ?? r.name}-${i}`} r={r} latest={latest} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function SectionRows({ s, latest, negate = false, subtotal = true }: { s: SheetSection; latest: string | null; negate?: boolean; subtotal?: boolean }) {
  return (
    <Fragment>
      <tr>
        <th scope="rowgroup" colSpan={2} className="h-8 border-b border-line bg-sunken pr-5 pl-5 text-left text-small font-semibold text-ink touch:pl-4">
          {s.title}
          {s.note && <span className="ml-2 font-normal text-ink-2">{s.note}</span>}
        </th>
      </tr>
      {s.rows.length === 0 ? (
        <tr>
          <td colSpan={2} className="h-(--row-1) border-b border-line pl-5 text-ink-2 touch:pl-4">
            {s.side === "liability" ? "None connected" : "None"}
          </td>
        </tr>
      ) : (
        s.rows.map((r, i) => <AccountRow key={`${r.account_id ?? r.name}-${i}`} r={r} latest={latest} negate={negate} />)
      )}
      {s.rounding !== 0 && (
        <tr>
          <td className="h-(--row-1) border-b border-line pl-5 text-ink-2 touch:pl-4">Rounding</td>
          <td className="border-b border-line pr-5 text-right text-ink-2 tabular-nums touch:pr-4">{statementMoney(negate ? -s.rounding : s.rounding)}</td>
        </tr>
      )}
      {subtotal && (
        <tr className="font-semibold">
          <td className="h-(--row-1) border-t border-b border-t-line-strong border-b-line pl-5 touch:pl-4">Total {s.title.split(",")[0].toLowerCase()}</td>
          <td className="border-t border-b border-t-line-strong border-b-line pr-5 text-right tabular-nums touch:pr-4">{statementMoney(negate ? -s.total : s.total)}</td>
        </tr>
      )}
    </Fragment>
  );
}

function AccountRow({ r, latest, negate = false }: { r: SheetRow; latest: string | null; negate?: boolean }) {
  const title = r.mask ? `${r.name} ${format.maskAccount(r.mask)}` : r.name;
  const own = r.as_of && latest && r.as_of.slice(0, 16) !== latest.slice(0, 16) ? format.dateTime(r.as_of) : null;
  const secondary = [r.owner ? `Owned by ${r.owner}` : r.entity, r.institution && !r.name.startsWith(r.institution) ? r.institution : null, r.type, own ? `as of ${own}` : null]
    .filter(Boolean)
    .join(" · ");
  const warn = r.notes.filter((n) => n !== "Balance unavailable");
  return (
    <tr>
      <td className="border-b border-line py-2 pr-3 pl-5 align-top touch:pl-4">
        <div className="text-body text-ink">{title}</div>
        {secondary && <div className="text-small text-ink-2">{secondary}</div>}
        {warn.map((n) => (
          <div key={n} className="mt-1 flex items-start gap-1 text-small text-ink">
            <span className="mt-[2px] text-warning">
              <Icon name="warning" size={16} />
            </span>
            {n}
          </div>
        ))}
      </td>
      <td className={cx("border-b border-line py-2 pr-5 pl-3 text-right align-top tabular-nums whitespace-nowrap touch:pr-4", r.balance === null && "text-ink-3")}>
        {r.balance === null ? "Balance unavailable" : statementMoney(negate ? -(r.shown ?? 0) : r.shown)}
      </td>
    </tr>
  );
}

function TotalRow({ label, value, grand = false }: { label: string; value: number; grand?: boolean }) {
  const rule = grand ? "border-t border-t-ink border-b-[3px] border-b-ink border-double" : "border-t border-t-line-strong border-b border-b-line";
  return (
    <tr className="font-semibold">
      <td className={cx("h-(--row-1) pl-5 touch:pl-4", rule)}>{label}</td>
      <td className={cx("pr-5 text-right tabular-nums touch:pr-4", rule)}>{statementMoney(value)}</td>
    </tr>
  );
}
