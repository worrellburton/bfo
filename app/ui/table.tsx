/**
 * Table (docs/DESIGN.md §8.10): desktop and tablet only; on phones every
 * row renders as a ListRow (`phoneRow` says how it reads) that opens its
 * detail.
 *
 * Head 32px, caption 500 ink-2, sentence case, a line-strong rule below,
 * sticky on `raised`. Rows --row-1 in body; cells 12px apart, the first and
 * last columns take the card's 20px. Text and dates left; numbers right,
 * tabular, one precision per column. A sortable head is a button with a
 * caret on the sorted column only. Hover only when the row opens. Group
 * bands on `sunken`. A subtotal row is 600 with a line-strong rule above; a
 * statement's grand total has an ink rule above and a double rule below. No
 * zebra stripes, no shadows. Zero is "—" in ink-3; no data is blank.
 */

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { cx } from "./cx";
import { Icon } from "./icon";
import { List, ListRow, type ListRowProps } from "./list";
import { usePhone } from "./media";
import { Skeleton } from "./states";

export type Column<R> = {
  key: string;
  /** Sentence case. */
  header: string;
  /** right for numbers. */
  align?: "left" | "right";
  /** A CSS width ("160px", "20%"); the first text column is usually fluid. */
  width?: string;
  render: (row: R) => ReactNode;
  /** Makes the head a sort button. */
  sort?: (a: R, b: R) => number;
};

export type TableProps<R> = {
  /** Names the table for screen readers. */
  caption: string;
  columns: Column<R>[];
  rows: R[];
  rowKey: (r: R) => string;
  onRowClick?: (r: R) => void;
  /** A 40px checkbox column. */
  selection?: { selected: Set<string>; onChange: (s: Set<string>) => void };
  /** Group band label for a row; rows must already be ordered by group. */
  groups?: (r: R) => string;
  /** The band's figure (a group's total), right-aligned. */
  groupTotal?: (rows: R[]) => ReactNode;
  /** One cell per column for a subtotal row (or the grand total with `grandTotal`). */
  totals?: ReactNode[];
  /** Style `totals` as a statement's final total (ink rule above, double rule below). */
  grandTotal?: boolean;
  /** How a row reads on a phone. */
  phoneRow: (r: R) => ListRowProps;
  /** Shown when there are no rows (an Empty). */
  empty?: ReactNode;
  loading?: boolean;
  /** Wide tables (months across): scroll sideways on desktop with the first column held. */
  stickyFirst?: boolean;
};

export function Table<R>({ caption, columns, rows, rowKey, onRowClick, selection, groups, groupTotal, totals, grandTotal, phoneRow, empty, loading, stickyFirst }: TableProps<R>) {
  const phone = usePhone();
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    return [...rows].sort((a, b) => col.sort!(a, b) * sort!.dir);
  }, [rows, columns, sort]);

  if (phone) {
    if (loading) return <Skeleton kind="rows" rows={8} />;
    if (!rows.length) return <div className="ds px-4 py-4">{empty}</div>;
    return (
      <List label={caption}>
        {sorted.map((r) => {
          const p = phoneRow(r);
          return <ListRow key={rowKey(r)} {...p} onClick={p.onClick ?? (onRowClick && !p.to ? () => onRowClick(r) : undefined)} />;
        })}
      </List>
    );
  }

  const span = columns.length + (selection ? 1 : 0);
  const allKeys = rows.map(rowKey);
  const picked = selection ? allKeys.filter((k) => selection.selected.has(k)).length : 0;
  const pad = (i: number, n: number) => cx(i === 0 ? "pl-5" : "pl-3", i === n - 1 ? "pr-5" : "pr-3");
  const n = columns.length;

  const grouped: { label: string | null; rows: R[] }[] = [];
  for (const r of sorted) {
    const g = groups ? groups(r) : null;
    const last = grouped[grouped.length - 1];
    if (last && last.label === g) last.rows.push(r);
    else grouped.push({ label: g, rows: [r] });
  }

  return (
    <div className={cx("ds isolate w-full", stickyFirst && "overflow-x-auto")}>
      <table className="w-full border-separate border-spacing-0 text-body text-ink">
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          {selection && <col style={{ width: 40 }} />}
          {columns.map((c) => (
            <col key={c.key} style={c.width ? { width: c.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {selection && (
              <th scope="col" className="sticky top-0 z-sticky h-8 border-b border-line-strong bg-raised pl-5">
                <SelectBox checked={picked === 0 ? false : picked === allKeys.length ? true : "mixed"} label="Select all" onChange={(v) => selection.onChange(v ? new Set(allKeys) : new Set())} />
              </th>
            )}
            {columns.map((c, i) => {
              const sorted = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={sorted ? (sort!.dir === 1 ? "ascending" : "descending") : c.sort ? "none" : undefined}
                  className={cx(
                    "sticky top-0 z-sticky h-8 border-b border-line-strong bg-raised text-caption font-medium whitespace-nowrap text-ink-2",
                    c.align === "right" ? "text-right" : "text-left",
                    pad(i + (selection ? 1 : 0), n + (selection ? 1 : 0)),
                    stickyFirst && i === 0 && "ds-table-corner left-0 border-r border-r-line",
                  )}
                >
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: (s.dir * -1) as 1 | -1 } : { key: c.key, dir: 1 }))}
                      className={cx("inline-flex cursor-pointer items-center gap-1 hover:text-ink", c.align === "right" && "flex-row-reverse")}
                    >
                      {c.header}
                      {sorted && <Icon name={sort!.dir === 1 ? "chevronUp" : "chevronDown"} size={12} />}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={span} className="p-0">
                <Skeleton kind="table" rows={8} columns={columns.map((c) => c.width ?? `${Math.round(100 / n)}%`)} />
              </td>
            </tr>
          ) : !rows.length ? (
            <tr>
              <td colSpan={span} className="px-5 py-4">
                {empty}
              </td>
            </tr>
          ) : (
            grouped.map((g, gi) => (
              <Fragment key={g.label ?? `g${gi}`}>
                {g.label !== null && (
                  <tr>
                    <th scope="colgroup" colSpan={span} className="h-8 border-b border-line bg-sunken px-5 text-left text-small font-semibold text-ink">
                      <span className="flex items-center justify-between gap-3">
                        <span>
                          {g.label} <span className="font-normal text-ink-2 tabular-nums">· {g.rows.length}</span>
                        </span>
                        {groupTotal && <span className="tabular-nums">{groupTotal(g.rows)}</span>}
                      </span>
                    </th>
                  </tr>
                )}
                {g.rows.map((r) => {
                  const k = rowKey(r);
                  const on = selection?.selected.has(k);
                  return (
                    <tr
                      key={k}
                      tabIndex={onRowClick ? 0 : undefined}
                      onClick={onRowClick ? () => onRowClick(r) : undefined}
                      onKeyDown={onRowClick ? (e) => e.key === "Enter" && onRowClick(r) : undefined}
                      aria-selected={selection ? !!on : undefined}
                      className={cx(on ? "bg-selected" : onRowClick && "cursor-pointer hover:bg-hover")}
                    >
                      {selection && (
                        <td className="h-(--row-1) border-b border-line pl-5" onClick={(e) => e.stopPropagation()}>
                          <SelectBox
                            checked={!!on}
                            label="Select row"
                            onChange={(v) => {
                              const next = new Set(selection.selected);
                              if (v) next.add(k);
                              else next.delete(k);
                              selection.onChange(next);
                            }}
                          />
                        </td>
                      )}
                      {columns.map((c, i) => (
                        <td
                          key={c.key}
                          className={cx(
                            "h-(--row-1) border-b border-line py-2 align-middle",
                            c.align === "right" ? "text-right tabular-nums" : "text-left",
                            pad(i + (selection ? 1 : 0), n + (selection ? 1 : 0)),
                            i === 0 && "break-words",
                            stickyFirst && i === 0 && cx("sticky left-0 border-r border-r-line", on ? "bg-selected" : "bg-raised"),
                          )}
                        >
                          {i === 0 ? <span className="line-clamp-2">{c.render(r)}</span> : c.render(r)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </Fragment>
            ))
          )}
        </tbody>
        {totals && !loading && rows.length > 0 && (
          <tfoot>
            <tr className="font-semibold">
              {selection && <td className={cx(grandTotal ? "border-t border-t-ink border-b-[3px] border-b-ink border-double" : "border-t border-line-strong")} />}
              {totals.map((cell, i) => (
                <td
                  key={i}
                  className={cx(
                    "h-(--row-1) py-2",
                    columns[i]?.align === "right" ? "text-right tabular-nums" : "text-left",
                    pad(i + (selection ? 1 : 0), n + (selection ? 1 : 0)),
                    grandTotal ? "border-t border-b-[3px] border-double border-t-ink border-b-ink" : "border-t border-line-strong",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function SelectBox({ checked, onChange, label }: { checked: boolean | "mixed"; onChange: (v: boolean) => void; label: string }) {
  const on = checked === true;
  const mixed = checked === "mixed";
  return (
    <label className="inline-flex cursor-pointer items-center align-middle">
      <input type="checkbox" className="peer sr-only" checked={on} aria-checked={mixed ? "mixed" : on} aria-label={label} onChange={(e) => onChange(mixed ? true : e.target.checked)} />
      <span
        aria-hidden="true"
        className={cx(
          "inline-flex size-[16px] items-center justify-center rounded-mark border-[1.5px] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-focus-visible:outline-solid",
          on || mixed ? "border-accent bg-accent text-on-accent" : "border-edge bg-field",
        )}
      >
        <svg viewBox="0 0 16 16" className="size-[12px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          {on && <path d="M3.5 8.5l3 3 6-7" />}
          {mixed && <path d="M4 8h8" />}
        </svg>
      </span>
    </label>
  );
}
