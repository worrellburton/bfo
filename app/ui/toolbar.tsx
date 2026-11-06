/**
 * Toolbar (docs/DESIGN.md §8.12): above a list or table, a SearchField
 * (flexible width), the filter Selects, then the view switch (a Segmented)
 * at the right. On phones: the SearchField and one "Filter" button with a
 * Count of active filters, which opens a sheet holding the filters; active
 * filters show below as FilterChips with "Clear all".
 */

import { useState, type ReactNode } from "react";
import { Button } from "./button";
import { cx } from "./cx";
import { usePhone } from "./media";
import { Sheet } from "./overlay";
import { Count, FilterChip } from "./status";

export function Toolbar({
  search,
  filters,
  view,
  activeFilters = [],
  onClearFilters,
  className,
}: {
  /** A SearchField. */
  search?: ReactNode;
  /** The filter Selects (size "sm"). On phones they move into a sheet. */
  filters?: ReactNode;
  /** A Segmented view switch. */
  view?: ReactNode;
  /** The filters in force, as chips under the bar. */
  activeFilters?: { label: string; onRemove: () => void }[];
  onClearFilters?: () => void;
  className?: string;
}) {
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  const chips = activeFilters.length > 0 && (
    <div className="flex flex-wrap items-center gap-2">
      {activeFilters.map((f) => (
        <FilterChip key={f.label} onRemove={f.onRemove}>
          {f.label}
        </FilterChip>
      ))}
      {onClearFilters && (
        <Button variant="quiet" size="sm" onClick={onClearFilters}>
          Clear all
        </Button>
      )}
    </div>
  );
  if (phone) {
    return (
      <div className={cx("ds flex flex-col gap-3", className)}>
        <div className="flex items-center gap-2">
          {search && <div className="min-w-0 flex-1">{search}</div>}
          {filters && (
            <Button icon="filter" onClick={() => setOpen(true)} aria-label={activeFilters.length ? `Filter, ${activeFilters.length} on` : "Filter"}>
              Filter
              <Count n={activeFilters.length} />
            </Button>
          )}
        </div>
        {view}
        {chips}
        {filters && (
          <Sheet
            open={open}
            onClose={() => setOpen(false)}
            title="Filter"
            footer={
              <>
                {onClearFilters && activeFilters.length > 0 && <Button onClick={onClearFilters}>Clear all</Button>}
                <Button variant="primary" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-4">{filters}</div>
          </Sheet>
        )}
      </div>
    );
  }
  return (
    <div className={cx("ds flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {search && <div className="min-w-[200px] flex-1">{search}</div>}
        {filters && <div className="flex flex-wrap items-center gap-2 [&>*]:w-auto [&>*]:max-w-[280px] [&>*]:min-w-[160px]">{filters}</div>}
        {view && <div className="ml-auto">{view}</div>}
      </div>
      {chips}
    </div>
  );
}
