import type { Dispatch, SetStateAction } from "react";
import { Button, IconButton, MultiSelect, Segmented, cx } from "../ui";
import type { MailFolder, MailSummary } from "../mail-client";
import { Glyph, type GlyphName } from "./glyphs";
import { NARROW_LABELS, type Narrow, type NarrowKey, type View } from "./constants";
import { SelectBox } from "./controls";

export type BulkAction = "read" | "unread" | "archive" | "inbox" | "delete" | "restore" | "purge";

/** The list's narrowing (§8.12): one Select of independent choices, "All mail" when none is on. Applies at once. */
export function NarrowSelect({ narrow, onChange, className }: { narrow: Narrow; onChange: (n: Narrow) => void; className?: string }) {
  const keys = (Object.keys(NARROW_LABELS) as NarrowKey[]).filter((k) => narrow[k]);
  return (
    <div className={cx("w-[200px] shrink-0", className)}>
      <MultiSelect
        label="Show"
        placeholder="All mail"
        size="sm"
        value={keys}
        onChange={(next) => onChange({ unread: next.includes("unread"), starred: next.includes("starred"), attachments: next.includes("attachments") })}
        options={(Object.keys(NARROW_LABELS) as NarrowKey[]).map((k) => ({ value: k, label: NARROW_LABELS[k] }))}
      />
    </div>
  );
}

/** Table or columns, at the toolbar's right (desktop). */
export function ViewSwitch({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <Segmented
      label="View"
      value={view}
      onChange={onChange}
      options={[
        { value: "table", label: "Table", icon: <Glyph name="rows" />, iconOnly: true },
        { value: "columns", label: "Columns", icon: <Glyph name="columns" />, iconOnly: true },
      ]}
    />
  );
}

/** What can be done to the picked messages, given where they are. */
export function bulkActions(folder: MailFolder, picked: MailSummary[]): { key: BulkAction; label: string; short: string; glyph: GlyphName; danger?: boolean }[] {
  if (folder === "trash") {
    return [
      { key: "restore", label: "Restore", short: "Restore", glyph: "restore" },
      { key: "purge", label: "Delete forever", short: "Delete", glyph: "trash", danger: true },
    ];
  }
  const out: ReturnType<typeof bulkActions> = [];
  if (picked.some((m) => !m.read)) out.push({ key: "read", label: "Mark read", short: "Read", glyph: "unread" });
  else out.push({ key: "unread", label: "Mark unread", short: "Unread", glyph: "unread" });
  if (folder === "active" || ((folder === "inbox" || folder === "other") && picked.some((m) => m.direction === "in"))) out.push({ key: "archive", label: "Archive", short: "Archive", glyph: "archive" });
  if (folder === "archive") out.push({ key: "inbox", label: "Move to inbox", short: "Inbox", glyph: "unarchive" });
  out.push({ key: "delete", label: "Delete", short: "Delete", glyph: "trash", danger: true });
  return out;
}

/**
 * While messages are picked (§14 bulk-action bar). Desktop (`floating` off):
 * in the table head's place, at its 32px height, on the card's surface: the
 * box, how many, "Select all 50 shown", the actions, and ×. Phones
 * (`floating`): a bottom toolbar of 48px cells where the compose button was,
 * rising from the edge, so picking moves no row from under the finger.
 */
export function BulkBar({
  rows,
  pickedRows,
  hasMore,
  bulkBusy,
  folder,
  pickAll,
  bulk,
  setPicked,
  floating = false,
}: {
  floating?: boolean;
  rows: MailSummary[];
  pickedRows: MailSummary[];
  /** More mail than is loaded: "Select all" says it covers the rows shown. */
  hasMore: boolean;
  bulkBusy: boolean;
  folder: MailFolder;
  pickAll: () => void;
  bulk: (action: BulkAction) => Promise<void>;
  setPicked: Dispatch<SetStateAction<Set<string>>>;
}) {
  const actions = bulkActions(folder, pickedRows);
  const allPicked = pickedRows.length === rows.length;
  const selectAll = !allPicked && (
    <Button variant="quiet" size="sm" onClick={() => pickAll()}>
      {hasMore ? `Select all ${rows.length} shown` : `Select all ${rows.length}`}
    </Button>
  );
  const clear = <IconButton icon="x" label="Clear selection (Esc)" onClick={() => setPicked(new Set())} />;
  if (floating) {
    return (
      <div
        role="toolbar"
        aria-label="Selected messages"
        data-floating
        className="ds ds-sheet-in fixed inset-x-0 bottom-0 z-fab border-t border-line-strong bg-overlay px-4 pt-2 pb-[calc(8px+env(safe-area-inset-bottom))] shadow-(--elevation-2) md:hidden"
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-section text-ink tabular-nums">{pickedRows.length} selected</span>
          {selectAll}
          {clear}
        </div>
        <div className="mt-1 grid" style={{ gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))` }}>
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              disabled={bulkBusy}
              onClick={() => void bulk(a.key)}
              className={cx(
                "flex min-h-[52px] cursor-pointer flex-col items-center justify-center gap-1 rounded-control text-caption font-medium hover:bg-hover active:bg-selected disabled:cursor-not-allowed disabled:text-ink-disabled",
                a.danger ? "text-negative" : "text-ink",
              )}
            >
              <Glyph name={a.glyph} size={20} />
              {a.short}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div role="toolbar" aria-label="Selected messages" className="ds ds-reveal flex h-8 items-center gap-1 pr-3 pl-5 font-normal">
      <span className="ml-3">
        <SelectBox on={allPicked} mixed={!allPicked} onToggle={() => pickAll()} label={allPicked ? "Unselect all" : "Select all"} className="-my-1" />
      </span>
      <span className="mr-1 ml-1 text-small font-medium text-ink tabular-nums">{pickedRows.length} selected</span>
      {selectAll}
      <span className="flex-1" />
      {actions.map((a) => (
        <Button key={a.key} variant="quiet" size="sm" disabled={bulkBusy} onClick={() => void bulk(a.key)} className={cx(a.danger && "ml-2 text-negative enabled:hover:text-negative")}>
          {a.label}
        </Button>
      ))}
      <span className="ml-1">{clear}</span>
    </div>
  );
}
