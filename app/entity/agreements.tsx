/**
 * Agreements tab (LLCs): the entity's operating contracts — MSAs with each
 * counterparty. A compact table on wide screens, stacked rows below lg, and one
 * inline editor shared by "New contract" and row edits. All state and
 * actions come from useEntity().
 */

import { useState, type ReactNode } from "react";
import { confirmDialog } from "../confirm-dialog";
import { useEntity } from "./context";
import { LEDGER_LOUISE_SUBS, MSA_SERVICES, fmtDate, type OperatingContract } from "./model";
import { Button, Dot, Empty, Field, Icon, IconButton, Info, Input, Rows, Section, Select, Switch, toneText, useTone, type Tone } from "./ui";
import type { EntityPage } from "./use-entity";

type Status = OperatingContract["status"];
type ContractForm = EntityPage["contractForm"];

const STATUSES: { value: Status; label: string; tone: Tone }[] = [
  { value: "draft", label: "Draft", tone: "muted" },
  { value: "active", label: "Active", tone: "good" },
  { value: "terminated", label: "Terminated", tone: "bad" },
];
const FREQUENCIES = ["Monthly", "Quarterly", "Annually", "One-time"];
const AUTO = "Annual, auto-renewing";
const FIXED = "Annual, fixed term";

/**
 * Table columns from lg up: counterparty, fee, frequency, effective, term,
 * status, actions. Fee and Effective keep a px floor so "$12,500.00" and
 * "Dec 28, 2026" never run into the next column; below lg rows stack.
 */
const COLS = "lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(88px,0.7fr)_minmax(0,0.7fr)_minmax(100px,0.8fr)_minmax(0,1.1fr)_120px_92px] lg:items-center lg:gap-x-4";
/** Row actions: always shown on touch screens; with a mouse, on hover or keyboard focus. */
// Row actions stay visible (quiet icons) so they're always discoverable.
const REVEAL = "";
/** Gives a wrapped <Switch> a 44px tap area on phones. */
const HIT = "inline-flex max-sm:[&>button]:after:absolute max-sm:[&>button]:after:-inset-[13px] max-sm:[&>button]:after:content-['']";

export function AgreementsTab() {
  const { page, asset } = useEntity();
  const t = useTone();
  const [generating, setGenerating] = useState(false);
  const contracts = page.contracts;
  const showEmpty = contracts.length === 0 && !page.addingContract;
  const canGenerate = asset.name.toLowerCase().includes("ledger louise") && contracts.length < LEDGER_LOUISE_SUBS.length;

  async function generate() {
    setGenerating(true);
    try {
      await page.generateMSATemplates();
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Section
      title="Contracts"
      count={contracts.length}
      info="Draft an MSA with a counterparty to track its fee, term and status."
      actions={
        <>
          {canGenerate && (
            <>
              <Button kind="ghost" icon="plus" disabled={generating} title="Generate draft MSAs for the Ledger Louise subsidiaries" onClick={() => void generate()} className="max-sm:hidden">
                MSA templates
              </Button>
              {/* Phones: icon only, so the header never crowds the title. */}
              <IconButton icon="doc" label="Generate MSA templates" disabled={generating} onClick={() => void generate()} className="sm:hidden" />
            </>
          )}
          {!showEmpty && (
            <Button kind={page.addingContract ? "ghost" : "primary"} icon={page.addingContract ? undefined : "plus"} onClick={() => page.setAddingContract((v) => !v)}>
              {page.addingContract ? "Cancel" : "New contract"}
            </Button>
          )}
        </>
      }
    >
      {showEmpty ? (
        <Empty
          action={
            <Button icon="plus" onClick={() => page.setAddingContract(true)}>
              New contract
            </Button>
          }
        >
          No operating contracts yet.
        </Empty>
      ) : (
        <>
          {contracts.length > 0 && (
            <div aria-hidden="true" className={`hidden border-b px-5 py-2 text-[12px] ${t.line} ${t.muted} ${COLS}`}>
              <span>Counterparty</span>
              <span>Fee</span>
              <span>Frequency</span>
              <span>Effective</span>
              <span>Term</span>
              <span>Status</span>
              <span className="text-right">Actions</span>
            </div>
          )}
          <Rows>
            {contracts.map((c) =>
              page.editingContractId === c.id ? (
                <ContractEditor
                  key={c.id}
                  f={page.editContractForm}
                  setF={page.setEditContractForm}
                  onSave={page.saveEditContract}
                  onCancel={() => page.setEditingContractId(null)}
                />
              ) : (
                <ContractRow key={c.id} c={c} />
              ),
            )}
            {page.addingContract && (
              <ContractEditor isNew f={page.contractForm} setF={page.setContractForm} onSave={page.addContract} onCancel={() => page.setAddingContract(false)} />
            )}
          </Rows>
        </>
      )}
    </Section>
  );
}

// ── A contract ───────────────────────────────────────────────────────────

function ContractRow({ c }: { c: OperatingContract }) {
  const { page } = useEntity();
  const t = useTone();

  async function remove() {
    if (await confirmDialog({ title: `Delete the MSA with ${c.counterparty}?`, tone: "danger" })) void page.deleteContract(c.id);
  }

  return (
    <div className={`group px-5 py-3 ${COLS}`}>
      <div className="flex items-start gap-2 lg:contents">
        <p className={`min-w-0 flex-1 break-words pt-1 text-[13px] font-medium leading-snug lg:pt-0 ${t.text}`}>{c.counterparty}</p>
        <div className={`-my-1 flex shrink-0 items-center lg:order-last lg:justify-end ${REVEAL}`}>
          <IconButton icon="edit" label="Edit" aria-label={`Edit the MSA with ${c.counterparty}`} onClick={() => page.startEditContract(c)} />
          <IconButton icon="doc" label="View PDF" aria-label={`View the MSA with ${c.counterparty} as a PDF`} onClick={() => void page.navigate(`/assets/${page.id}/contract/${c.id}`)} />
          <IconButton icon="trash" tone="danger" label="Delete" aria-label={`Delete the MSA with ${c.counterparty}`} onClick={() => void remove()} />
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 lg:contents">
        <Cell label="Fee" className="tabular-nums">
          {c.fee}
        </Cell>
        <Cell label="Frequency">{c.frequency}</Cell>
        <Cell label="Effective" className="whitespace-nowrap tabular-nums">
          {fmtDate(c.effectiveDate)}
        </Cell>
        <Cell label="Term">{c.term}</Cell>
        <Cell label="Status" className="col-span-2 sm:col-span-4 lg:col-span-1">
          <StatusSelect c={c} />
        </Cell>
      </dl>
    </div>
  );
}

/** A table cell; below lg it shows its column name above the value. */
function Cell({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  const t = useTone();
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className={`text-[12px] lg:sr-only ${t.muted}`}>{label}</dt>
      <dd className={`break-words text-[13px] leading-snug ${t.soft}`}>{children || <span className={t.faint}>—</span>}</dd>
    </div>
  );
}

/** The row's status, changed in place: a dot, the word, a quiet select. */
function StatusSelect({ c }: { c: OperatingContract }) {
  const { page } = useEntity();
  const t = useTone();
  const tone = STATUSES.find((s) => s.value === c.status)?.tone ?? "muted";
  return (
    <span className={`relative -ml-2 inline-flex items-center ${toneText(tone, t.dark)}`}>
      <Dot tone={tone} className="pointer-events-none absolute left-2" />
      <select
        value={c.status}
        onChange={(e) => void page.updateContractStatus(c.id, e.target.value as Status)}
        aria-label={`Status of the MSA with ${c.counterparty}`}
        className={`h-7 cursor-pointer appearance-none rounded-md bg-transparent pl-5 pr-6 text-[12px] outline-none transition-colors focus-visible:ring-1 max-sm:h-[40px] max-sm:text-[16px] ${t.hover} ${
          t.dark ? "focus-visible:ring-white/20 [&_option]:bg-[#111118] [&_option]:text-gray-200" : "focus-visible:ring-gray-300 [&_option]:bg-white [&_option]:text-gray-900"
        }`}
      >
        {STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" className="pointer-events-none absolute right-1.5 h-3 w-3 opacity-70" strokeWidth={2.25} />
    </span>
  );
}

// ── Editor (new contract and row edit) ───────────────────────────────────

function ContractEditor({
  f,
  setF,
  onSave,
  onCancel,
  isNew = false,
}: {
  f: ContractForm;
  setF: (next: ContractForm) => void;
  onSave: () => Promise<void>;
  onCancel: () => void;
  isNew?: boolean;
}) {
  const t = useTone();
  const [saving, setSaving] = useState(false);
  const isAuto = f.term.toLowerCase().includes("auto-renew");
  const robert = f.letterhead === "robert";

  async function save() {
    setSaving(true);
    try {
      await onSave();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`px-5 py-4 ${t.dark ? "bg-[#818cf8]/[0.04]" : "bg-indigo-50/40"}`}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Counterparty" wide>
          <Input
            value={f.counterparty}
            onChange={(e) => setF({ ...f, counterparty: e.target.value })}
            placeholder={isNew ? "e.g. Acme Holdings, LLC" : undefined}
            autoFocus
          />
        </Field>
        <Field label="Fee">
          <Input value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} placeholder={isNew ? "$500" : undefined} className="tabular-nums" />
        </Field>
        <Field label="Frequency">
          <Select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>
            {FREQUENCIES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Effective">
          <Input type="date" value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} />
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Status })}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <span className={`mb-1.5 block text-[12px] ${t.muted}`}>Term</span>
          <Toggle
            on={isAuto}
            onToggle={() => setF({ ...f, term: isAuto ? FIXED : AUTO })}
            label="Auto-renewing term"
            info={isAuto ? "Renews yearly unless either party cancels 30 days prior." : "Ends after one year; renewal requires both parties."}
          >
            {isAuto ? AUTO : FIXED}
          </Toggle>
        </div>
      </div>

      <div className="mt-4">
        <ServicesPicker selected={f.services} onChange={(next) => setF({ ...f, services: next })} />
      </div>

      <div className="mt-4 space-y-1">
        <Toggle
          on={f.referralCredit}
          onToggle={() => setF({ ...f, referralCredit: !f.referralCredit })}
          label="Referral credit"
          info="Credit referral fees against this client's retainer instead of paying cash. Adds a clause to the contract PDF."
        >
          Referral credit
        </Toggle>
        <Toggle
          on={robert}
          onToggle={() => setF({ ...f, letterhead: robert ? "bfo" : "robert" })}
          label="Letterhead: Robert Burton"
          info="Switches the contract masthead between BFO and Robert Burton."
        >
          Letterhead: {robert ? "Robert Burton" : "BFO"}
        </Toggle>
      </div>

      <div className="mt-4 flex items-center gap-2 sm:justify-end">
        <Button kind="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button kind="primary" disabled={!f.counterparty.trim() || saving} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  );
}

/** A switch with its words beside it and an optional (i). */
function Toggle({ on, onToggle, label, info, children }: { on: boolean; onToggle: () => void; label: string; info?: ReactNode; children: ReactNode }) {
  const t = useTone();
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-x-2.5 gap-y-1 max-sm:min-h-[44px]">
      <span className={HIT}>
        <Switch on={on} onToggle={onToggle} label={label} />
      </span>
      <span className={`text-[13px] ${t.text}`}>{children}</span>
      {info && <Info>{info}</Info>}
    </div>
  );
}

// ── Services included ────────────────────────────────────────────────────

/**
 * Which MSA services the contract includes, toggled on or off; the selected
 * ones drag into order — the order they appear in the contract PDF.
 */
function ServicesPicker({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  const t = useTone();
  const [open, setOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const unselected = MSA_SERVICES.filter((s) => !selected.includes(s));

  const endDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
  };
  const drop = (to: number) => {
    if (dragIndex === null || dragIndex === to) return endDrag();
    const next = [...selected];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(to, 0, moved);
    onChange(next);
    endDrag();
  };

  const row = "flex items-center gap-2 rounded-md px-2 py-1.5 max-sm:min-h-[44px]";
  return (
    <div>
      <span className={`mb-1.5 block text-[12px] ${t.muted}`}>Services included</span>
      <Button aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="tabular-nums">
          {selected.length} service{selected.length === 1 ? "" : "s"} selected
        </span>
        <Icon name="chevronDown" className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2.25} />
      </Button>
      {open && (
        <div className={`mt-2 w-full max-w-md rounded-lg border p-1 ${t.surface}`}>
          {selected.map((svc, i) => (
            <div
              key={svc}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragIndex !== null && overIndex !== i) setOverIndex(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(i);
              }}
              onDragEnd={endDrag}
              className={`${row} cursor-grab active:cursor-grabbing ${dragIndex === i ? "opacity-40" : ""} ${
                overIndex === i && dragIndex !== null && dragIndex !== i ? (t.dark ? "bg-white/10" : "bg-indigo-50") : t.hover
              }`}
            >
              <span className={`shrink-0 ${t.faint}`} title="Drag to reorder">
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="9" cy="6" r="1.4" />
                  <circle cx="15" cy="6" r="1.4" />
                  <circle cx="9" cy="12" r="1.4" />
                  <circle cx="15" cy="12" r="1.4" />
                  <circle cx="9" cy="18" r="1.4" />
                  <circle cx="15" cy="18" r="1.4" />
                </svg>
              </span>
              <span className={`flex-1 text-[12.5px] ${t.text}`}>{svc}</span>
              <span className={HIT} title="Remove from contract">
                <Switch on onToggle={() => onChange(selected.filter((s) => s !== svc))} label={`Remove from contract: ${svc}`} />
              </span>
            </div>
          ))}
          {unselected.length > 0 && (
            <div className={selected.length ? `mt-1 border-t pt-1 ${t.line}` : ""}>
              {unselected.map((svc) => (
                <div key={svc} className={`${row} ${t.hover}`}>
                  <span className={`flex-1 text-[12.5px] ${t.muted}`}>{svc}</span>
                  <span className={HIT} title="Add to contract">
                    <Switch on={false} onToggle={() => onChange([...selected, svc])} label={`Add to contract: ${svc}`} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
