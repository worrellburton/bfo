/**
 * Select and MultiSelect (docs/DESIGN.md §8.4). There is no native <select>.
 * The trigger looks like an Input: the value in ink, "Choose…" in ink-3 when
 * empty, a chevron 12px from the right. It opens a listbox: on desktop an
 * anchored panel as wide as the trigger (200px at least) with a search field
 * when there are more than ten options; on touch a sheet titled with the
 * field's label, 48px rows. The chosen option carries an accent check.
 *
 * Keyboard: Enter, Space or ↓ opens; ↑ ↓ Home End move; type-ahead jumps;
 * Enter chooses; Escape closes and returns focus to the trigger.
 */

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "./button";
import { cx } from "./cx";
import { FIELD_SKIN } from "./field";
import { list as joinList } from "./format";
import { Icon } from "./icon";
import { BottomSheetFrame } from "./overlay";
import { useListbox, type ListboxShell } from "./select-shell";
import { typeAhead } from "./overlay-rules";
import { overlayRoot } from "./portal";
import { createPortal } from "react-dom";

export type Option<T extends string> = {
  value: T;
  label: string;
  /** A trailing hint in caption ink-3 (a code, a count). */
  hint?: string;
  disabled?: boolean;
  /** Shown as the hint when disabled. */
  disabledReason?: string;
  /** A heading the option sits under (states by region, accounts by type). */
  group?: string;
  /** A leading mark, only where marks differ meaningfully from option to option. */
  icon?: ReactNode;
  /** A shorter text for the closed trigger ("6100" for "6100 Professional fees"). */
  short?: string;
};

type ListProps<T extends string> = {
  options: Option<T>[];
  isChosen: (v: T) => boolean;
  onPick: (o: Option<T>) => void;
  sheet: boolean;
  multi: boolean;
  label: string;
  footnote?: ReactNode;
  id: string;
};

function Listbox<T extends string>({ options, isChosen, onPick, sheet, multi, label, footnote, id }: ListProps<T>) {
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const searchable = options.length > 10;
  const iconSlot = options.some((o) => o.icon);
  const needle = query.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  const nodes = () => [...(ref.current?.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])') ?? [])];
  const onKeyDown = (e: React.KeyboardEvent) => {
    const all = nodes();
    const i = all.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = i < 0 ? 0 : Math.min(i + 1, all.length - 1);
    else if (e.key === "ArrowUp") next = i <= 0 ? (i < 0 ? all.length - 1 : 0) : i - 1;
    else if (e.key === "Home" && i >= 0) next = 0;
    else if (e.key === "End" && i >= 0) next = all.length - 1;
    else if (e.key === "Enter" && i < 0 && (e.target as HTMLElement).tagName === "INPUT") {
      const first = shown.find((o) => !o.disabled);
      if (first) onPick(first);
      e.preventDefault();
      return;
    } else if (i >= 0 && e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key, at: now };
      next = typeAhead(
        all.map((n) => n.dataset.label ?? ""),
        typed.current.text,
        typed.current.text.length > 1 ? Math.max(0, i - 1) : i,
      );
    } else return;
    e.preventDefault();
    if (next >= 0) all[next]?.focus();
  };
  let lastGroup: string | undefined;
  return (
    <div ref={ref} onKeyDown={onKeyDown} className="flex min-h-0 flex-col">
      {searchable && (
        <div className={cx("shrink-0", sheet ? "pb-2" : "border-b border-line p-1 pb-2")} data-no-autofocus={sheet || undefined}>
          <div
            className={cx(
              "flex h-(--control-sm) items-center gap-2 px-2",
              FIELD_SKIN,
              "border-edge has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-accent has-[input:focus-visible]:outline-solid",
            )}
          >
            <Icon name="search" className="text-ink-3" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}`}
              aria-label={`Search ${label.toLowerCase()}`}
              aria-controls={id}
              autoComplete="off"
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent text-field text-ink outline-none! placeholder:text-ink-3"
            />
          </div>
        </div>
      )}
      <div id={id} role="listbox" aria-label={label} aria-multiselectable={multi || undefined} className={cx("min-h-0 flex-1 overflow-y-auto", !sheet && "p-1")}>
        {shown.length === 0 && <p className="px-2 py-2 text-small text-ink-2">Nothing matches “{query.trim()}”.</p>}
        {shown.map((o) => {
          const head = o.group && o.group !== lastGroup ? o.group : null;
          lastGroup = o.group;
          const on = isChosen(o.value);
          return (
            <div key={o.value}>
              {head && <div className="sticky top-0 flex h-[28px] items-center bg-overlay px-2 text-caption font-medium text-ink-2">{head}</div>}
              <button
                type="button"
                role="option"
                aria-selected={on}
                aria-disabled={o.disabled || undefined}
                tabIndex={-1}
                data-label={o.label}
                onClick={() => !o.disabled && onPick(o)}
                className={cx(
                  "flex w-full items-center gap-2 rounded-control px-2 text-left outline-offset-[-2px]!",
                  sheet ? "min-h-[48px] text-body" : "min-h-(--row-menu) text-small touch:text-body",
                  o.disabled ? "cursor-not-allowed text-ink-disabled" : "cursor-pointer text-ink hover:bg-hover focus:bg-hover",
                )}
              >
                {multi && (
                  <span
                    aria-hidden="true"
                    className={cx(
                      "inline-flex size-[16px] shrink-0 items-center justify-center rounded-mark border-[1.5px] touch:size-[20px]",
                      on ? "border-accent bg-accent text-on-accent" : "border-edge bg-field",
                    )}
                  >
                    {on && (
                      <svg viewBox="0 0 16 16" className="size-[12px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3.5 8.5l3 3 6-7" />
                      </svg>
                    )}
                  </span>
                )}
                {iconSlot && <span className="inline-flex min-w-[20px] shrink-0 items-center text-ink-2">{o.icon}</span>}
                <span className="min-w-0 flex-1 py-[6px] break-words">{o.label}</span>
                {(o.disabled ? (o.disabledReason ?? o.hint) : o.hint) && <span className="shrink-0 text-caption text-ink-3 tabular-nums">{o.disabled ? (o.disabledReason ?? o.hint) : o.hint}</span>}
                {!multi && on && <Icon name="check" className="text-accent" />}
              </button>
            </div>
          );
        })}
        {footnote && <p className="px-2 pt-2 pb-1 text-caption text-ink-3">{footnote}</p>}
      </div>
    </div>
  );
}

type TriggerProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
};

function Trigger({ shell, text, empty, label, p }: { shell: ListboxShell; text: string; empty: boolean; label: string; p: TriggerProps }) {
  const invalid = p.invalid || p["aria-invalid"];
  return (
    <button
      ref={shell.triggerRef}
      id={p.id}
      type="button"
      data-field
      disabled={p.disabled}
      aria-haspopup="listbox"
      aria-expanded={shell.open}
      aria-controls={shell.open ? shell.listId : undefined}
      aria-describedby={p["aria-describedby"]}
      aria-invalid={invalid || undefined}
      aria-label={p.id ? undefined : label}
      onClick={() => shell.setOpen(!shell.open)}
      onKeyDown={(e) => {
        if (!shell.open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
          e.preventDefault();
          shell.setOpen(true);
        }
      }}
      className={cx(
        "ds flex w-full min-w-0 items-center justify-between gap-2 pr-3 pl-3 text-left",
        p.size === "sm" ? "h-(--control-sm)" : "h-(--control-md)",
        FIELD_SKIN,
        p.disabled ? "cursor-not-allowed border-line bg-selected text-ink-disabled" : cx("cursor-pointer", invalid ? "border-negative" : "border-edge"),
        p.className,
      )}
    >
      <span className={cx("min-w-0 truncate", empty && !p.disabled && "text-ink-3")}>{text}</span>
      <Icon name="chevronDown" size={16} className="text-ink-3" />
    </button>
  );
}

function Panel({ shell, label, children, footer }: { shell: ListboxShell; label: string; children: ReactNode; footer?: ReactNode }) {
  if (!shell.mounted) return null;
  const { handle, leaving, pos } = shell;
  return createPortal(
    shell.touch ? (
      <BottomSheetFrame handle={handle} leaving={leaving} title={label} footer={footer}>
        {children}
      </BottomSheetFrame>
    ) : (
      <div
        ref={handle.panelRef}
        style={
          pos
            ? { left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: Math.min(pos.maxHeight, Math.round(window.innerHeight * 0.6)), minWidth: pos.minWidth, maxWidth: pos.maxWidth }
            : { left: -9999, top: 0 }
        }
        className={cx(
          "ds fixed flex flex-col overflow-hidden rounded-card border border-line-strong bg-overlay text-ink shadow-(--elevation-2)",
          leaving ? "pointer-events-none ds-menu-out" : pos?.above ? "ds-menu-in-up" : "ds-menu-in",
        )}
      >
        {children}
      </div>
    ),
    overlayRoot(),
  );
}

export type SelectProps<T extends string> = {
  value: T | null;
  onChange: (v: T) => void;
  options: Option<T>[];
  /** The field's name: the sheet's title on touch, the trigger's name when no Field labels it. */
  label: string;
  /** Shown in ink-3 when nothing is chosen. Default "Choose…". */
  placeholder?: string;
  invalid?: boolean;
  /** sm 32/44 (toolbars), md 36/44 (forms, default). */
  size?: "sm" | "md";
  disabled?: boolean;
  /** A note under the list, when some choices are left out on purpose. */
  footnote?: ReactNode;
  id?: string;
  className?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

export function Select<T extends string>({ value, onChange, options, label, placeholder = "Choose…", footnote, ...p }: SelectProps<T>) {
  const shell = useListbox();
  const chosen = options.find((o) => o.value === value);
  return (
    <>
      <Trigger shell={shell} text={chosen?.label ?? placeholder} empty={!chosen} label={label} p={p} />
      <Panel shell={shell} label={label}>
        <Listbox
          id={shell.listId}
          options={options}
          isChosen={(v) => v === value}
          sheet={shell.touch}
          multi={false}
          label={label}
          footnote={footnote}
          onPick={(o) => {
            shell.setOpen(false);
            if (o.value !== value) onChange(o.value);
          }}
        />
      </Panel>
    </>
  );
}

export type MultiSelectProps<T extends string> = Omit<SelectProps<T>, "value" | "onChange"> & {
  value: T[];
  onChange: (v: T[]) => void;
};

/** Several choices: rows with checkboxes; the trigger reads the names when they fit, else "3 selected". */
export function MultiSelect<T extends string>({ value, onChange, options, label, placeholder = "Choose…", footnote, ...p }: MultiSelectProps<T>) {
  const shell = useListbox();
  const set = useMemo(() => new Set(value), [value]);
  const names = options.filter((o) => set.has(o.value)).map((o) => o.label);
  const joined = names.length ? joinList(names) : "";
  const text = !names.length ? placeholder : joined.length <= 32 ? joined : `${names.length} selected`;
  return (
    <>
      <Trigger shell={shell} text={text} empty={!names.length} label={label} p={p} />
      <Panel
        shell={shell}
        label={label}
        footer={
          <Button variant="primary" onClick={() => shell.setOpen(false)}>
            Done
          </Button>
        }
      >
        <Listbox
          id={shell.listId}
          options={options}
          isChosen={(v) => set.has(v)}
          sheet={shell.touch}
          multi
          label={label}
          footnote={footnote}
          onPick={(o) => onChange(set.has(o.value) ? value.filter((v) => v !== o.value) : [...value, o.value])}
        />
      </Panel>
    </>
  );
}

/**
 * The open list on its own, for a control that keeps its own trigger (a
 * legacy pill that hasn't moved yet). Pair it with useListbox(): put
 * `shell.triggerRef` on the trigger and toggle `shell.setOpen`.
 */
export function ListboxPanel<T extends string>({
  shell,
  options,
  isChosen,
  onPick,
  label,
  multi = false,
  footnote,
}: {
  shell: ListboxShell;
  options: Option<T>[];
  isChosen: (v: T) => boolean;
  onPick: (o: Option<T>) => void;
  label: string;
  multi?: boolean;
  footnote?: ReactNode;
}) {
  return (
    <Panel
      shell={shell}
      label={label}
      footer={
        multi ? (
          <Button variant="primary" onClick={() => shell.setOpen(false)}>
            Done
          </Button>
        ) : undefined
      }
    >
      <Listbox id={shell.listId} options={options} isChosen={isChosen} sheet={shell.touch} multi={multi} label={label} footnote={footnote} onPick={onPick} />
    </Panel>
  );
}
