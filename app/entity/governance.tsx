/**
 * Governance (C-Corp only): the board, officers, shareholders, stock and
 * corporate compliance dates. All state and actions come from useEntity().
 */

import type { FormEvent, ReactNode } from "react";
import { confirmDialog } from "../confirm-dialog";
import { useEntity } from "./context";
import { fmtDate } from "./model";
import { Button, Dot, Empty, Field, IconButton, Input, Row, Rows, Section, Select, useTone } from "./ui";

/** Row actions: always shown on touch screens; with a mouse, on hover or keyboard focus. */
// Row actions stay visible (quiet icons) so they're always discoverable.
const REVEAL = "";

const SHARE_CLASSES = ["Common", "Preferred A", "Preferred B"] as const;
const FILING_STATUSES = ["Current", "Due Soon", "Overdue", "N/A"] as const;

export function GovernanceTab() {
  const { page, asset } = useEntity();
  const t = useTone();
  if (asset.type !== "C-Corp") return null;

  type CorpTab = typeof page.corpTab;
  const tabs: { key: CorpTab; label: string; name: string; n?: number }[] = [
    { key: "board", label: "Board", name: "Board of Directors", n: page.directors.length },
    { key: "officers", label: "Officers", name: "Officers", n: page.officers.length },
    { key: "shareholders", label: "Shareholders", name: "Shareholders", n: page.shareholders.length },
    { key: "stock", label: "Stock", name: "Stock" },
    { key: "compliance", label: "Compliance", name: "Compliance" },
  ];

  const add =
    page.corpTab === "board" && !page.addingDirector
      ? { label: "Add director", open: () => page.setAddingDirector(true) }
      : page.corpTab === "officers" && !page.addingOfficer
        ? { label: "Add officer", open: () => page.setAddingOfficer(true) }
        : page.corpTab === "shareholders" && !page.addingShareholder
          ? { label: "Add shareholder", open: () => page.setAddingShareholder(true) }
          : null;

  return (
    <div>
      <Section
        title="Corporate records"
        actions={
          add && (
            <Button icon="plus" onClick={add.open}>
              {add.label}
            </Button>
          )
        }
      >
        <div className={`overflow-x-auto border-b px-5 py-2.5 ${t.line}`}>
          <div role="group" aria-label="Corporate records" className={`inline-flex w-max gap-0.5 rounded-lg p-0.5 ${t.dark ? "bg-white/[0.04]" : "bg-gray-100"}`}>
            {tabs.map((s) => {
              const on = page.corpTab === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={on}
                  title={s.name}
                  onClick={() => page.setCorpTab(s.key)}
                  className={`inline-flex h-7 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[12px] font-medium transition-colors max-sm:h-[40px] ${
                    on
                      ? t.dark ? "bg-white/[0.1] text-white" : "bg-white text-gray-900 shadow-sm"
                      : t.dark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  {s.label}
                  {!!s.n && <span className={`tabular-nums ${t.faint}`}>{s.n}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {page.corpTab === "board" && <Board />}
        {page.corpTab === "officers" && <Officers />}
        {page.corpTab === "shareholders" && <Shareholders />}
        {page.corpTab === "stock" && <Stock />}
        {page.corpTab === "compliance" && <Compliance />}
      </Section>
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────

/** A list entry: name, a muted detail, and a remove action. */
function Person({ name, detail, onRemove }: { name: string; detail: string; onRemove: () => void }) {
  const t = useTone();
  return (
    <div className="group flex items-center gap-3 px-5 py-2.5">
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={`text-[13px] font-medium ${t.text}`}>{name}</span>
        {detail && <span className={`text-[12px] ${t.muted}`}>{detail}</span>}
      </div>
      <IconButton icon="trash" label={`Remove ${name}`} tone="danger" className={REVEAL} onClick={onRemove} />
    </div>
  );
}

const since = (title: string, date: string) => [title, date && `Since ${fmtDate(date)}`].filter(Boolean).join(" · ");

/** An inline add form: fields, then Add / Cancel. Enter submits. */
function AddForm({ children, canAdd, onAdd, onCancel }: { children: ReactNode; canAdd: boolean; onAdd: () => void; onCancel: () => void }) {
  const t = useTone();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onAdd();
  };
  return (
    <form noValidate onSubmit={submit} className={`border-t px-5 py-4 ${t.line}`}>
      {children}
      <div className="mt-3 flex gap-2">
        <Button kind="primary" type="submit" disabled={!canAdd}>
          Add
        </Button>
        <Button kind="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** label → input, saved as you type. */
function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  const t = useTone();
  return (
    <label className="flex flex-col gap-1.5 px-5 py-2.5 sm:flex-row sm:items-center sm:gap-4">
      <span className={`shrink-0 text-[12px] sm:w-44 ${t.muted}`}>{label}</span>
      <span className="block min-w-0 flex-1 sm:max-w-sm">{children}</span>
    </label>
  );
}

// ── Board ────────────────────────────────────────────────────────────────

function Board() {
  const { page } = useEntity();
  const f = page.dirForm;
  return (
    <>
      <Rows>
        {page.directors.map((d) => (
          <Person
            key={d.id}
            name={d.name}
            detail={since(d.title, d.since)}
            onRemove={async () => {
              if (await confirmDialog({ title: `Remove ${d.name} from the board?`, tone: "danger", confirmLabel: "Remove" })) void page.removeDirector(d.id);
            }}
          />
        ))}
      </Rows>
      {page.directors.length === 0 && <Empty>No directors added yet.</Empty>}
      {page.addingDirector && (
        <AddForm canAdd={!!f.name.trim()} onAdd={() => void page.addDirector()} onCancel={() => page.setAddingDirector(false)}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Name">
              <Input autoFocus value={f.name} onChange={(e) => page.setDirForm({ ...f, name: e.target.value })} />
            </Field>
            <Field label="Title">
              <Input value={f.title} onChange={(e) => page.setDirForm({ ...f, title: e.target.value })} />
            </Field>
            <Field label="Since">
              <Input type="date" value={f.since} onChange={(e) => page.setDirForm({ ...f, since: e.target.value })} />
            </Field>
          </div>
        </AddForm>
      )}
    </>
  );
}

// ── Officers ─────────────────────────────────────────────────────────────

function Officers() {
  const { page } = useEntity();
  const f = page.offForm;
  return (
    <>
      <Rows>
        {page.officers.map((o) => (
          <Person
            key={o.id}
            name={o.name}
            detail={since(o.title, o.since)}
            onRemove={async () => {
              if (await confirmDialog({ title: `Remove ${o.name} as ${o.title}?`, tone: "danger", confirmLabel: "Remove" })) void page.removeOfficer(o.id);
            }}
          />
        ))}
      </Rows>
      {page.officers.length === 0 && <Empty>No officers added yet.</Empty>}
      {page.addingOfficer && (
        <AddForm canAdd={!!f.name.trim() && !!f.title.trim()} onAdd={() => void page.addOfficer()} onCancel={() => page.setAddingOfficer(false)}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Name">
              <Input autoFocus value={f.name} onChange={(e) => page.setOffForm({ ...f, name: e.target.value })} />
            </Field>
            <Field label="Title">
              <Input value={f.title} onChange={(e) => page.setOffForm({ ...f, title: e.target.value })} />
            </Field>
            <Field label="Since">
              <Input type="date" value={f.since} onChange={(e) => page.setOffForm({ ...f, since: e.target.value })} />
            </Field>
          </div>
        </AddForm>
      )}
    </>
  );
}

// ── Shareholders ─────────────────────────────────────────────────────────

/** Name | Shares | Class | % | remove. Under `sm`, shares and class move under the name. */
const SH_COLS = "grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_4.5rem_1.75rem]";

function Shareholders() {
  const { page } = useEntity();
  const t = useTone();
  const f = page.shForm;
  return (
    <>
      {page.shareholders.length > 0 && (
        <div className={`hidden px-5 pb-1.5 pt-3 text-[11px] font-medium sm:grid ${SH_COLS} ${t.muted}`}>
          <span>Name</span>
          <span className="text-right">Shares</span>
          <span>Class</span>
          <span className="text-right">%</span>
          <span />
        </div>
      )}
      <Rows>
        {page.shareholders.map((s) => {
          const shares = Number(s.shares ?? 0).toLocaleString();
          return (
            <div key={s.id} className={`group grid px-5 py-2.5 text-[13px] ${SH_COLS}`}>
              <div className="min-w-0">
                <div className={`truncate font-medium ${t.text}`}>{s.name}</div>
                <div className={`text-[12px] tabular-nums sm:hidden ${t.muted}`}>
                  {shares} shares · {s.class}
                </div>
              </div>
              <span className={`hidden text-right tabular-nums sm:block ${t.soft}`}>{shares}</span>
              <span className={`hidden truncate sm:block ${t.soft}`}>{s.class}</span>
              <span className={`text-right tabular-nums ${t.soft}`}>{s.percentage}%</span>
              <IconButton
                icon="trash"
                label={`Remove ${s.name}`}
                tone="danger"
                className={REVEAL}
                onClick={async () => {
                  if (await confirmDialog({ title: `Remove ${s.name} from the shareholders?`, tone: "danger", confirmLabel: "Remove" })) void page.removeShareholder(s.id);
                }}
              />
            </div>
          );
        })}
      </Rows>
      {page.shareholders.length === 0 && <Empty>No shareholders added yet.</Empty>}
      {page.addingShareholder && (
        <AddForm canAdd={!!f.name.trim()} onAdd={() => void page.addShareholder()} onCancel={() => page.setAddingShareholder(false)}>
          {/* Phone: name, then Shares | %, then Class on its own row so "Preferred A/B" never clips. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_11rem_5rem]">
            <div className="col-span-2 sm:col-span-1">
              <Field label="Shareholder name">
                <Input autoFocus value={f.name} onChange={(e) => page.setShForm({ ...f, name: e.target.value })} />
              </Field>
            </div>
            <Field label="Shares">
              <Input type="number" inputMode="numeric" className="tabular-nums" value={f.shares} onChange={(e) => page.setShForm({ ...f, shares: e.target.value })} />
            </Field>
            <div className="order-last col-span-2 sm:order-none sm:col-span-1">
              <Field label="Class">
                <Select value={f.class} onChange={(e) => page.setShForm({ ...f, class: e.target.value })}>
                  {SHARE_CLASSES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="%">
              <Input type="number" inputMode="decimal" step="0.01" className="tabular-nums" value={f.percentage} onChange={(e) => page.setShForm({ ...f, percentage: e.target.value })} />
            </Field>
          </div>
        </AddForm>
      )}
    </>
  );
}

// ── Stock ────────────────────────────────────────────────────────────────

function Stock() {
  const { page } = useEntity();
  const c = page.corpData;
  const set = page.updateCorpField;
  return (
    <Rows>
      <FieldRow label="Authorized shares">
        <Input type="number" inputMode="numeric" className="tabular-nums" value={c.authorizedShares || ""} onChange={(e) => void set("authorizedShares", Number(e.target.value) || 0)} />
      </FieldRow>
      <FieldRow label="Issued shares">
        <Input type="number" inputMode="numeric" className="tabular-nums" value={c.issuedShares || ""} onChange={(e) => void set("issuedShares", Number(e.target.value) || 0)} />
      </FieldRow>
      <FieldRow label="Par value">
        <Input value={c.parValue || ""} onChange={(e) => void set("parValue", e.target.value)} />
      </FieldRow>
      <FieldRow label="Stock classes">
        <Input value={c.stockClasses || ""} onChange={(e) => void set("stockClasses", e.target.value)} />
      </FieldRow>
    </Rows>
  );
}

// ── Compliance ───────────────────────────────────────────────────────────

const DATE_FIELDS = [
  ["annualReportDue", "Annual report due"],
  ["nextBoardMeeting", "Next board meeting"],
  ["incorporationDate", "Incorporation date"],
  ["lastAnnualReport", "Last annual report"],
  ["lastBoardMeeting", "Last board meeting"],
] as const;

function Compliance() {
  const { page } = useEntity();
  const t = useTone();
  const c = page.corpData;
  const set = page.updateCorpField;
  const upcoming = [
    ["Annual report", c.annualReportDue],
    ["Board meeting", c.nextBoardMeeting],
  ] as const;

  return (
    <>
      <Rows>
        <FieldRow label="Fiscal year end">
          <Input value={c.fiscalYearEnd || ""} onChange={(e) => void set("fiscalYearEnd", e.target.value)} />
        </FieldRow>
        <FieldRow label="State filing status">
          <Select value={c.stateFilingStatus || ""} onChange={(e) => void set("stateFilingStatus", e.target.value)}>
            <option value="">Select...</option>
            {FILING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </FieldRow>
        {DATE_FIELDS.map(([key, label]) => (
          <FieldRow key={key} label={label}>
            <Input type="date" value={c[key] || ""} onChange={(e) => void set(key, e.target.value)} />
          </FieldRow>
        ))}
      </Rows>

      {(c.annualReportDue || c.nextBoardMeeting) && (
        <div className={`border-t ${t.line}`}>
          <p className={`px-5 pb-0.5 pt-3 text-[11px] font-medium ${t.muted}`}>Upcoming deadlines</p>
          <Rows>
            {upcoming.map(([label, date]) =>
              date ? (
                <Row key={label} label={label}>
                  <Dot tone={new Date(date) < new Date() ? "bad" : "good"}>
                    <span className="tabular-nums">{fmtDate(date)}</span>
                  </Dot>
                </Row>
              ) : null,
            )}
          </Rows>
        </div>
      )}
    </>
  );
}
