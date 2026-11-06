/**
 * The KPI strip at the top of each Books report and of the cell drill-down:
 * a bordered strip of cells, a label in small ink-2 over the value in
 * heading, colour only for a signed result. The formats, shapes and
 * adapters the reports share are in app/books-report-model.ts.
 */

import type { ReactNode } from "react";
import { cx } from "./ui";

const COLS: Record<number, string> = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" };

/**
 * The figures at the top of a report: a bordered strip of cells, a label in
 * small ink-2 over the value in heading. Colour only for a signed result.
 */
export function KpiStrip({ label, items }: { label: string; items: Array<{ label: string; value: ReactNode; hint?: ReactNode; tone?: "none" | "direction"; amount?: number }> }) {
  return (
    <dl aria-label={label} className={cx("ds grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line", COLS[Math.min(4, items.length)])}>
      {items.map((i) => (
        <div key={i.label} className="flex min-w-0 flex-col bg-raised px-5 py-4 touch:px-4">
          <dt className="text-small text-ink-2">{i.label}</dt>
          <dd className={cx("mt-1 text-heading tabular-nums", i.tone === "direction" && i.amount !== undefined && (i.amount > 0 ? "text-positive" : i.amount < 0 ? "text-negative" : ""))}>
            {i.value}
          </dd>
          {i.hint && <dd className="mt-1 text-caption text-ink-2">{i.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}
