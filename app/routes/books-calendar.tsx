import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { authFetch } from "../auth";
import { displayName, entityLabel, ledgerMoney } from "../books-shared";
import { Banner, Button, Card, Checkbox, Dialog, Disclosure, Icon, IconButton, List, ListRow, Page, PageHeader, Skeleton, cx, format, useDocumentTitle, usePhone } from "../ui";

export function meta() {
  return [{ title: "Calendar · BFO" }];
}

type Stream = {
  vendor: string;
  cadence: string;
  cadence_days: number;
  /** Plaid-signed (money out positive): the typical payment. Older servers send only avg_amount. */
  typical_amount?: number;
  avg_amount: number;
  last_amount?: number;
  count: number;
  last_date: string;
  day_of_month: number;
  account: string | null;
  entity_name: string | null;
  next_expected: string;
  stale?: boolean;
  own_money?: boolean;
  recent_dates?: string[];
};

type Item = { kind: "stream"; s: Stream; amount: number; matched: boolean | null } | { kind: "tax"; title: string; detail: string };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY = 86_400_000;
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The federal filing and payment dates the books feed, for a given month (the compliance calendar has each entity's own). */
function taxDates(month: number): Array<{ day: number; title: string; detail: string }> {
  const all: Array<[number, number, string, string]> = [
    [0, 15, "Estimated tax, 4th quarter", "Federal estimated income tax for individuals and trusts"],
    [0, 31, "1099s, W-2s and Form 941", "Forms 1099-NEC and W-2/W-3 to recipients and the IRS; Form 941 for the 4th quarter"],
    [3, 15, "Returns and 1st-quarter estimate", "Individual and trust returns, Form 709 gift tax, 1st-quarter estimated tax"],
    [3, 30, "Form 941, 1st quarter", "Payroll tax return, if anyone is on payroll"],
    [5, 15, "Estimated tax, 2nd quarter", "Federal estimated income tax"],
    [6, 31, "Form 941, 2nd quarter", "Payroll tax return, if anyone is on payroll"],
    [8, 15, "Estimated tax, 3rd quarter", "Federal estimated income tax; extended partnership and S corporation returns"],
    [9, 15, "Extended returns", "Individual returns on extension"],
    [9, 31, "Form 941, 3rd quarter", "Payroll tax return, if anyone is on payroll"],
  ];
  return all.filter(([m]) => m === month).map(([, day, title, detail]) => ({ day, title, detail }));
}

/** Which days of a month a stream lands on. */
function daysIn(s: Stream, year: number, month: number): number[] {
  const last = Date.parse(`${s.last_date}T00:00:00Z`);
  const monthDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const out: number[] = [];
  if (s.cadence_days <= 20) {
    const step = s.cadence_days * DAY;
    const start = Date.UTC(year, month, 1);
    const end = Date.UTC(year, month, monthDays, 23, 59);
    let t = last;
    while (t > start) t -= step;
    for (; t <= end; t += step) if (t >= start) out.push(new Date(t).getUTCDate());
  } else {
    const per = Math.max(1, Math.round(s.cadence_days / 30));
    const anchor = new Date(last).getUTCFullYear() * 12 + new Date(last).getUTCMonth();
    const idx = year * 12 + month;
    if ((idx - anchor) % per === 0 && idx >= anchor - per * 24) out.push(Math.min(s.day_of_month || 1, monthDays));
  }
  return [...new Set(out)];
}

/**
 * Regular payments, projected onto the month from past payments (not
 * scheduled or approved), with the federal tax dates beside them. Days that
 * have passed say whether each payment came. Transfers between the family's
 * own accounts are left out unless asked for.
 */
export default function BooksCalendar() {
  useDocumentTitle("Calendar");
  const phone = usePhone();
  const [streams, setStreams] = useState<Stream[] | null>(null);
  const [error, setError] = useState("");
  const now = new Date();
  const todayIso = iso(now.getFullYear(), now.getMonth(), now.getDate());
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [own, setOwn] = useState(false);
  const [day, setDay] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/books/data?report=recurring");
        if (!res.ok) throw new Error();
        setStreams((await res.json()).streams ?? []);
      } catch {
        setError("Couldn’t load the regular payments.");
        setStreams([]);
      }
    })();
  }, []);

  const amountOf = (s: Stream) => s.typical_amount ?? s.avg_amount;
  const { byDay, moneyIn, moneyOut, count } = useMemo(() => {
    const map = new Map<number, Item[]>();
    let inn = 0;
    let out = 0;
    let n = 0;
    for (const s of streams ?? []) {
      if (s.own_money && !own) continue;
      for (const d of daysIn(s, cursor.year, cursor.month)) {
        const date = iso(cursor.year, cursor.month, d);
        const past = date < todayIso;
        const matched = past && s.recent_dates ? s.recent_dates.some((r) => Math.abs(Date.parse(`${r}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) <= 3 * DAY) : null;
        // A stopped stream isn't expected any more; days already past still show what happened.
        if (s.stale && !past) continue;
        const amount = amountOf(s);
        (map.get(d) ?? map.set(d, []).get(d)!).push({ kind: "stream", s, amount, matched });
        if (amount < 0) inn += -amount;
        else out += amount;
        n++;
      }
    }
    for (const t of taxDates(cursor.month)) (map.get(t.day) ?? map.set(t.day, []).get(t.day)!).unshift({ kind: "tax", title: t.title, detail: t.detail });
    return { byDay: map, moneyIn: inn, moneyOut: out, count: n };
  }, [streams, cursor, own, todayIso]);

  const firstDow = new Date(Date.UTC(cursor.year, cursor.month, 1)).getUTCDay();
  const monthDays = new Date(Date.UTC(cursor.year, cursor.month + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: monthDays }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const shift = (d: number) => {
    const m = cursor.month + d;
    setCursor({ year: cursor.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 });
  };
  const isThisMonth = cursor.year === now.getFullYear() && cursor.month === now.getMonth();
  const monthName = `${MONTHS[cursor.month]} ${cursor.year}`;
  const regular = (streams ?? []).filter((s) => !s.stale && (own || !s.own_money)).length;

  return (
    <Page width="full" header={<PageHeader title="Calendar" context={`${format.count(regular, "regular payment", "regular payments")} · projected from past payments, not scheduled or approved`} />}>
      {error && <Banner tone="negative">{error}</Banner>}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="min-w-0 flex-1 text-section text-ink" aria-live="polite">
            {monthName}
          </h2>
          {!isThisMonth && (
            <Button size="sm" onClick={() => setCursor({ year: now.getFullYear(), month: now.getMonth() })}>
              Today
            </Button>
          )}
          <IconButton icon="chevronLeft" label="Previous month" variant="secondary" onClick={() => shift(-1)} />
          <IconButton icon="chevronRight" label="Next month" variant="secondary" onClick={() => shift(1)} />
        </div>
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-body tabular-nums">
          <div>
            <dt className="text-small text-ink-2">Expected in</dt>
            <dd>{format.money(moneyIn, { precision: "dollars" })}</dd>
          </div>
          <div>
            <dt className="text-small text-ink-2">Expected out</dt>
            <dd>{format.money(moneyOut, { precision: "dollars" })}</dd>
          </div>
          <div>
            <dt className="text-small text-ink-2">Net</dt>
            <dd>{format.money(moneyIn - moneyOut, { precision: "dollars" })}</dd>
          </div>
          <div>
            <dt className="text-small text-ink-2">Payments</dt>
            <dd>{count}</dd>
          </div>
        </dl>
        <div className="mt-3">
          <Checkbox checked={own} onChange={setOwn} label="Include transfers between the family’s own accounts" />
        </div>
      </Card>

      {!streams ? (
        <Skeleton kind="card" rows={6} />
      ) : (
        <Card flush>
          <div role="grid" aria-label={monthName} className="grid grid-cols-7">
            {DOW.map((d) => (
              <div key={d} role="columnheader" className="border-b border-line-strong px-2 py-2 text-center text-caption font-medium text-ink-2">
                {phone ? d[0] : d}
              </div>
            ))}
            {cells.map((d, i) => {
              const items = d ? (byDay.get(d) ?? []) : [];
              const date = d ? iso(cursor.year, cursor.month, d) : "";
              const today = date === todayIso;
              const past = !!d && date < todayIso;
              const label = d ? `${format.date(date, "long")}${items.length ? `, ${items.length} item${items.length === 1 ? "" : "s"}` : ""}` : "";
              const max = phone ? 0 : 3;
              return (
                <div key={i} role="gridcell" className={cx("min-h-[56px] border-r border-b border-line sm:min-h-[104px] [&:nth-child(7n)]:border-r-0", !d && "bg-sunken")}>
                  {d && (
                    <button
                      type="button"
                      aria-label={label}
                      onClick={() => setDay(d)}
                      className={cx("flex h-full w-full cursor-pointer flex-col items-stretch gap-1 p-1 text-left hover:bg-hover sm:p-2", past && "bg-sunken")}
                    >
                      <span
                        className={cx(
                          "inline-flex size-6 items-center justify-center self-start rounded-full text-caption tabular-nums",
                          today ? "bg-accent font-medium text-on-accent" : "text-ink-2",
                        )}
                      >
                        {d}
                      </span>
                      {phone ? (
                        items.length > 0 && <span className="text-caption text-ink-2 tabular-nums">{items.length}</span>
                      ) : (
                        <>
                          {items.slice(0, max).map((it, j) => (
                            <span key={j} className="flex min-w-0 items-baseline justify-between gap-2 rounded-mark bg-sunken px-2 py-[2px] text-caption text-ink">
                              <span className="min-w-0 truncate">
                                {it.kind === "tax" ? it.title : displayName(it.s.vendor)}
                                {it.kind === "stream" && it.matched === true ? <span className="sr-only"> (came)</span> : null}
                              </span>
                              {it.kind === "stream" && (
                                <span className={cx("shrink-0 tabular-nums", it.amount < 0 ? "text-positive" : "text-ink-2")}>
                                  {it.matched === true && <Icon name="check" size={12} className="mr-1 inline align-[-2px]" />}
                                  {format.money(-it.amount, { precision: "dollars", sign: "always" })}
                                </span>
                              )}
                            </span>
                          ))}
                          {items.length > max && <span className="text-caption text-ink-2">{items.length - max} more</span>}
                        </>
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="border-t border-line px-5 py-3 text-small text-ink-2 touch:px-4">
            Money in shows with a plus. A check means the payment came on a day that has passed. Choose a day to see everything on it.
          </p>
        </Card>
      )}

      {phone && streams && <Agenda byDay={byDay} cursor={cursor} todayIso={todayIso} onDay={setDay} />}

      <DayDialog date={day ? iso(cursor.year, cursor.month, day) : null} items={day ? (byDay.get(day) ?? []) : []} todayIso={todayIso} onClose={() => setDay(null)} />
    </Page>
  );
}

function Agenda({ byDay, cursor, todayIso, onDay }: { byDay: Map<number, Item[]>; cursor: { year: number; month: number }; todayIso: string; onDay: (d: number) => void }) {
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const past = days.filter((d) => iso(cursor.year, cursor.month, d) < todayIso);
  const coming = days.filter((d) => iso(cursor.year, cursor.month, d) >= todayIso);
  const row = (d: number) => (
    <ListRow
      key={d}
      title={format.date(iso(cursor.year, cursor.month, d), "long").replace(/, \d{4}$/, "")}
      secondary={(byDay.get(d) ?? []).map((it) => (it.kind === "tax" ? it.title : displayName(it.s.vendor))).join(", ")}
      onClick={() => onDay(d)}
    />
  );
  return (
    <Card title="This month, day by day" flush>
      {coming.length ? <List label="Coming up">{coming.map(row)}</List> : <p className="px-4 pb-4 text-body text-ink-2">Nothing more expected this month.</p>}
      {past.length > 0 && (
        <div className="border-t border-line px-4 py-2">
          <Disclosure label={`Earlier in ${MONTHS[cursor.month]}`} count={past.length}>
            <List label="Earlier">{past.map(row)}</List>
          </Disclosure>
        </div>
      )}
    </Card>
  );
}

function DayDialog({ date, items, todayIso, onClose }: { date: string | null; items: Item[]; todayIso: string; onClose: () => void }) {
  const past = !!date && date < todayIso;
  return (
    <Dialog
      open={!!date}
      onClose={onClose}
      title={date ? format.date(date, "long") : ""}
      description={past ? "This day has passed: each payment says whether it came." : "Projected from past payments. Nothing here is scheduled or approved."}
      size="md"
    >
      {items.length === 0 ? (
        <p className="text-body text-ink-2">Nothing expected.</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((it, i) =>
            it.kind === "tax" ? (
              <li key={i} className="border-b border-line py-3 last:border-b-0">
                <p className="text-body font-medium text-ink">{it.title}</p>
                <p className="text-small text-ink-2">{it.detail}. Each entity’s own dates are on the compliance calendar.</p>
              </li>
            ) : (
              <li key={i} className="flex items-start justify-between gap-4 border-b border-line py-3 last:border-b-0">
                <div className="min-w-0">
                  <Link to={`/books/vendors/detail?name=${encodeURIComponent(it.s.vendor)}`} className="text-body text-ink hover:underline">
                    {displayName(it.s.vendor)}
                  </Link>
                  <p className="text-small text-ink-2">
                    {[
                      it.s.cadence.charAt(0).toUpperCase() + it.s.cadence.slice(1),
                      it.s.entity_name ? entityLabel(it.s.entity_name) : null,
                      `last paid ${format.date(it.s.last_date, "short")}`,
                      it.s.own_money ? "between own accounts" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {past && <p className={cx("text-small", it.matched ? "text-ink-2" : "text-warning")}>{it.matched ? "Came" : "Hasn’t come"}</p>}
                  {it.s.stale && <p className="text-small text-ink-2">Hasn’t been paid for more than one and a half cycles; it may have stopped.</p>}
                </div>
                <span className={cx("shrink-0 text-body font-medium tabular-nums", it.amount < 0 ? "text-positive" : "text-ink")}>About {ledgerMoney(it.amount)}</span>
              </li>
            ),
          )}
        </ul>
      )}
    </Dialog>
  );
}
