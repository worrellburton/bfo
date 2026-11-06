/**
 * The People tab's dialogs: adding, editing and removing an owner, and
 * adding or removing one of a trust's people. Each records a change as what
 * it is (a dated transfer, an issuance, a redemption, a resignation, a
 * correction of BFO's record) with its document, says what else changes,
 * and saves through the caller. The rules are in people-model.ts.
 */

import { useMemo, useState } from "react";
import { Banner, ChoiceTiles, Checkbox, DateInput, Dialog, Field, Input, Select, Button, format, type Option } from "../ui";
import type { AssetDoc } from "./model";
import {
  CLASS_WORDS,
  TRUST_WORDS,
  applyOwnerChange,
  classificationNote,
  holdsShare,
  managerRoles,
  ownerRoles,
  pct,
  sameName,
  shareTotal,
  type BeneficiaryClass,
  type ChangeHow,
  type HistoryEntry,
  type OwnerRow,
  type TrustPerson,
  type TrustRole,
} from "./people-model";

const today = () => format.isoDate(new Date());

/** The documents filed under the entity, newest first, as choices. */
function docOptions(docs: AssetDoc[]): Option<string>[] {
  return [...docs].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).map((d) => ({ value: d.id, label: d.name, hint: d.createdAt ? format.date(new Date(d.createdAt), "short") : undefined }));
}

export type OwnerSave = { owners: OwnerRow[]; entry: HistoryEntry | null; doc: { id: string; name: string } | null; revokeAccess?: boolean };

// ── Add or edit an owner ─────────────────────────────────────────────────

export function OwnerDialog({
  open,
  onClose,
  list,
  index,
  entityType,
  llcType,
  issuedShares,
  docs,
  entities,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  /** Everyone on the owner list (owners and managers), as stored. */
  list: OwnerRow[];
  /** The row being edited; null to add. */
  index: number | null;
  entityType?: string;
  llcType?: string;
  /** A corporation's issued shares, to work out each holder's percentage. */
  issuedShares?: number | null;
  docs: AssetDoc[];
  /** The family's other entities, to link an owner that is one. */
  entities: { id: string; name: string }[];
  onSave: (s: OwnerSave) => Promise<void>;
}) {
  const editing = index !== null ? list[index] : null;
  const corp = entityType === "C-Corp";
  const roles = [...ownerRoles(entityType), ...managerRoles(entityType)];
  const [name, setName] = useState(editing?.name ?? "");
  const [entityId, setEntityId] = useState<string>(editing?.entityId ?? "");
  const [role, setRole] = useState(
    editing?.role && roles.some((r) => r.toLowerCase() === editing.role!.toLowerCase()) ? roles.find((r) => r.toLowerCase() === editing.role!.toLowerCase())! : (editing?.role ?? roles[0]),
  );
  const [percent, setPercent] = useState(editing?.percent == null ? "" : String(editing.percent));
  const [shares, setShares] = useState(editing?.shares != null ? String(editing.shares) : "");
  const [shareClass, setShareClass] = useState<string>(editing?.shareClass ?? "Common");
  const [address, setAddress] = useState(editing?.address ?? "");
  const [how, setHow] = useState<ChangeHow | null>(null);
  const [counterparty, setCounterparty] = useState<string | null>(null);
  const [effective, setEffective] = useState<string | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);
  const [tried, setTried] = useState(false);

  const managerOnly = /manager|director|officer/i.test(role) && !/managing member/i.test(role);
  const pctNum = percent.trim() === "" ? null : Number(percent);
  const sharesNum = shares.trim() === "" ? null : Number(shares);
  // A corporation's percentage follows its shares when the issued count is on record.
  const effectivePct = corp && issuedShares && sharesNum != null ? Math.round((sharesNum / issuedShares) * 10000) / 100 : pctNum;
  const draft: OwnerRow = {
    name: name.trim(),
    role,
    percent: effectivePct,
    address: address.trim() || null,
    ...(entityId ? { entityId } : {}),
    ...(corp ? { shares: sharesNum, shareClass } : {}),
  };
  const shareMoved = editing ? Math.round(((draft.percent ?? 0) - (editing.percent ?? 0)) * 100) / 100 : (draft.percent ?? 0);
  const asksHow = !managerOnly && (index === null || shareMoved !== 0);
  const changed = !editing || JSON.stringify({ ...editing, since: undefined }) !== JSON.stringify({ ...editing, ...draft, since: undefined });

  const others = list.map((m, i) => ({ m, i })).filter(({ m, i }) => i !== index && holdsShare(m));
  const howOptions: { value: ChangeHow; title: string; description: string }[] =
    index === null
      ? [
          { value: "transfer", title: "From another owner", description: "Bought or received part of someone’s share." },
          { value: "issuance", title: "New interest issued", description: "The company admitted them; the others are diluted pro rata." },
          { value: "correction", title: "Correcting BFO’s record", description: "They already held this; the record was missing it." },
        ]
      : shareMoved > 0
        ? [
            { value: "transfer", title: "From another owner", description: "Part of someone else’s share moved to them." },
            { value: "issuance", title: "New interest issued", description: "The others are diluted pro rata." },
            { value: "correction", title: "Correcting BFO’s record", description: "The record had it wrong." },
          ]
        : [
            { value: "transfer", title: "To another owner", description: "Part of their share moved to someone else." },
            { value: "redemption", title: "Redeemed by the company", description: "The others grow pro rata." },
            { value: "correction", title: "Correcting BFO’s record", description: "The record had it wrong." },
          ];

  const result = useMemo(() => {
    if (!asksHow) {
      const next = list.map((m, i) => (i === index ? { ...m, ...draft } : m));
      if (index === null) next.push(draft);
      return { ok: true as const, owners: next, entry: null, total: shareTotal(next.filter(holdsShare)) };
    }
    if (!how) return null;
    return applyOwnerChange(list, index === null ? { kind: "add", owner: draft, how, counterparty, effective } : { kind: "edit", index, owner: draft, how, counterparty, effective });
    // draft is rebuilt each render from the fields listed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asksHow, how, counterparty, effective, name, role, percent, shares, shareClass, address, entityId, list, index]);

  const total = result?.ok ? result.total : shareTotal([...list.filter((m, i) => i !== index && holdsShare(m)), ...(managerOnly ? [] : [draft])]);
  const ownersAfter = result?.ok ? result.owners.filter(holdsShare).length : list.filter(holdsShare).length + (index === null && !managerOnly ? 1 : 0);
  const classNote = classificationNote(entityType, llcType, ownersAfter);
  const linked = entities.find((e) => e.id === entityId);

  const nameError = tried && !name.trim() ? "Add their name." : error?.field === "name" ? error.text : undefined;
  const shareError = tried && !managerOnly && (draft.percent == null || !(draft.percent > 0)) && index === null ? "Add their share, above 0%." : error?.field === "share" ? error.text : undefined;

  async function save() {
    setTried(true);
    setError(null);
    if (!name.trim()) return;
    if (!managerOnly && index === null && (draft.percent == null || !(draft.percent > 0))) return;
    if (asksHow && !how) return setError({ text: "Say how the change happened.", field: "how" });
    if (!result) return;
    if (!result.ok) return setError({ text: result.error, field: result.field });
    const doc = docs.find((d) => d.id === docId);
    setBusy(true);
    try {
      await onSave({ owners: result.owners, entry: result.entry, doc: doc ? { id: doc.id, name: doc.name } : null });
      onClose();
    } catch (err) {
      setError({ text: err instanceof Error && err.message ? err.message : "Couldn’t save the owner. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  const label = entityType === "C-Corp" ? "shareholder" : entityType === "LP" ? "partner" : "owner";
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${label}: ${editing.name}` : `Add an ${label === "owner" ? "owner" : label}`}
      dirty={changed && !busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} busyLabel="Saving…" disabled={!changed} disabledReason={!changed ? "Nothing has changed yet" : undefined} onClick={() => void save()}>
            {editing ? "Save changes" : `Add ${label}`}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Name" error={nameError} hint={linked ? `Linked to ${linked.name}’s record.` : "A person’s full legal name, or a company’s or trust’s legal name."}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        {entities.length > 0 && (
          <Field label="One of the family’s entities?" optional hint="Links the row to its record, its address and the estate map.">
            <Select
              label="One of the family’s entities?"
              value={entityId || "none"}
              onChange={(v) => {
                setEntityId(v === "none" ? "" : v);
                const e = entities.find((x) => x.id === v);
                if (e && !name.trim()) setName(e.name);
              }}
              options={[{ value: "none", label: "No, someone else" }, ...entities.map((e) => ({ value: e.id, label: e.name }))]}
            />
          </Field>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Role">
            <Select label="Role" value={role} onChange={setRole} options={roles.map((r) => ({ value: r, label: r }))} />
          </Field>
          {corp ? (
            <Field label="Shares" hint={issuedShares ? `Of ${issuedShares.toLocaleString("en-US")} issued` : "Issued shares aren’t on record yet (Governance › Stock)."}>
              <Input inputMode="numeric" className="tabular-nums" value={shares} onChange={(e) => setShares(e.target.value.replace(/[^\d]/g, ""))} />
            </Field>
          ) : null}
          {(!corp || !issuedShares) && (
            <Field label={managerOnly ? "Share (if any)" : "Share"} optional={managerOnly} error={shareError} hint={!managerOnly ? `Total after this change: ${pct(total)}` : undefined}>
              <Input inputMode="decimal" suffix="%" className="tabular-nums" value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^\d.]/g, ""))} placeholder="—" />
            </Field>
          )}
          {corp && (
            <Field label="Class">
              <Select label="Class" value={shareClass} onChange={setShareClass} options={["Common", "Preferred"].map((c) => ({ value: c, label: c }))} />
            </Field>
          )}
        </div>
        {!managerOnly && (
          <Field label="Address" optional hint={linked ? `Leave blank to use ${linked.name}’s address on record.` : "For K-1s and notices."}>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city, state ZIP" />
          </Field>
        )}

        {asksHow && (
          <>
            <ChoiceTiles label="How did it happen?" value={how} onChange={(v) => (setHow(v), setError(null))} options={howOptions} stacked />
            {error?.field === "how" && <p className="text-small text-negative">{error.text}</p>}
            {how === "transfer" && (
              <Field label={shareMoved >= 0 ? "From whom" : "To whom"} error={error?.field === "counterparty" ? error.text : undefined}>
                <Select
                  label={shareMoved >= 0 ? "From whom" : "To whom"}
                  value={counterparty}
                  onChange={setCounterparty}
                  placeholder="Choose an owner"
                  options={others.map(({ m }) => ({ value: m.name, label: m.name, hint: pct(m.percent) }))}
                />
              </Field>
            )}
            {how && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="As of"
                  optional={how === "correction"}
                  error={error?.field === "effective" ? error.text : undefined}
                  hint={how !== "correction" ? "When the change took effect." : undefined}
                >
                  <DateInput value={effective} onChange={setEffective} />
                </Field>
                <Field label="Document" optional hint="The assignment, joinder or consent, filed in Documents.">
                  <Select
                    label="Document"
                    value={docId}
                    onChange={setDocId}
                    placeholder={docs.length ? "Choose a document" : "No documents filed yet"}
                    disabled={!docs.length}
                    options={docOptions(docs)}
                  />
                </Field>
              </div>
            )}
            {how && how !== "correction" && result?.ok && result.entry && (
              <div className="rounded-card bg-sunken px-4 py-3">
                <p className="text-small font-medium text-ink">Afterwards</p>
                <ul className="mt-1 flex flex-col gap-1 text-small text-ink-2 tabular-nums">
                  {result.entry.after.map((m) => {
                    const before = list.find((x) => sameName(x.name, m.name))?.percent;
                    return (
                      <li key={m.name} className="flex justify-between gap-4">
                        <span className="min-w-0 break-words">{m.name}</span>
                        <span className="shrink-0 text-ink">{before != null && before !== m.percent ? `${pct(before)} → ${pct(m.percent)}` : pct(m.percent)}</span>
                      </li>
                    );
                  })}
                  <li className="flex justify-between gap-4 border-t border-line pt-1 font-medium text-ink">
                    <span>Total</span>
                    <span>{pct(result.total)}</span>
                  </li>
                </ul>
              </div>
            )}
          </>
        )}
        {classNote && <Banner tone="warning">{classNote.message} You can update the classification on the Owners tab once this is saved.</Banner>}
        {error && !error.field && <Banner tone="negative">{error.text}</Banner>}
        <p className="text-small text-ink-2">
          This changes BFO’s record. A change of ownership itself takes a signed assignment, joinder or amendment, and any consent the operating agreement requires; file it in Documents.
        </p>
      </form>
    </Dialog>
  );
}

// ── Remove an owner ──────────────────────────────────────────────────────

export function RemoveOwnerDialog({
  open,
  onClose,
  list,
  index,
  entityType,
  llcType,
  docs,
  hasAccess,
  ownerChange,
  onRemove,
}: {
  open: boolean;
  onClose: () => void;
  list: OwnerRow[];
  index: number;
  entityType?: string;
  llcType?: string;
  docs: AssetDoc[];
  /** They can sign in and see this entity. */
  hasAccess: boolean;
  /** When the header's "owned by" would change: what it becomes. */
  ownerChange: (owners: OwnerRow[]) => string | null;
  onRemove: (s: OwnerSave) => Promise<void>;
}) {
  const m = list[index];
  const [how, setHow] = useState<ChangeHow | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [effective, setEffective] = useState<string | null>(today());
  const [docId, setDocId] = useState<string | null>(null);
  const [revoke, setRevoke] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!m) return null;
  const owner = holdsShare(m);
  const others = list.filter((x, i) => i !== index && holdsShare(x));
  const result = how ? applyOwnerChange(list, { kind: "remove", index, how, counterparty: to, effective: how === "correction" ? null : effective }) : null;
  const after = result?.ok ? result.owners.filter(holdsShare) : others;
  const total = shareTotal(after);
  const classNote = owner ? classificationNote(entityType, llcType, after.length) : null;
  const headerChange = result?.ok ? ownerChange(result.owners) : null;
  const noun = entityType === "C-Corp" ? "shareholders" : owner ? "owners" : "managers";

  async function remove() {
    setError("");
    if (!how) return setError("Say why they’re coming off the list.");
    if (!result) return;
    if (!result.ok) return setError(result.error);
    const doc = docs.find((d) => d.id === docId);
    setBusy(true);
    try {
      await onRemove({ owners: result.owners, entry: result.entry, doc: doc ? { id: doc.id, name: doc.name } : null, revokeAccess: hasAccess && revoke });
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn’t remove them. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title={`Remove ${m.name} from the ${noun}?`}
      description="This changes BFO’s record only. An interest changes hands by an assignment or a redemption under the operating agreement; file that document in Documents."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" busy={busy} busyLabel="Removing…" disabled={!how} disabledReason={!how ? "Say why first" : undefined} onClick={() => void remove()}>
            Remove {owner ? "owner" : "manager"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-body font-medium break-words text-ink">{m.name}</p>
          <p className="text-small text-ink-2">{[m.role, owner && m.percent != null ? pct(m.percent) : null].filter(Boolean).join(" · ")}</p>
        </div>
        <ChoiceTiles
          label="Why"
          value={how}
          onChange={setHow}
          stacked
          options={
            owner
              ? [
                  ...(others.length ? [{ value: "transfer" as const, title: "Transferred to another owner", description: "Their share moves to the owner you choose." }] : []),
                  { value: "redemption" as const, title: "Redeemed by the company", description: "The others grow pro rata." },
                  { value: "correction" as const, title: "Entered in error", description: "They were never an owner; nothing else changes." },
                ]
              : [
                  { value: "redemption" as const, title: "Resigned or was removed", description: "As the operating agreement provides." },
                  { value: "correction" as const, title: "Entered in error", description: "They were never a manager." },
                ]
          }
        />
        {how === "transfer" && (
          <Field label="To whom">
            <Select label="To whom" value={to} onChange={setTo} placeholder="Choose an owner" options={others.map((x) => ({ value: x.name, label: x.name, hint: pct(x.percent) }))} />
          </Field>
        )}
        {how && how !== "correction" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="As of">
              <DateInput value={effective} onChange={setEffective} />
            </Field>
            <Field label="Document" optional>
              <Select
                label="Document"
                value={docId}
                onChange={setDocId}
                placeholder={docs.length ? "Choose a document" : "No documents filed yet"}
                disabled={!docs.length}
                options={docOptions(docs)}
              />
            </Field>
          </div>
        )}
        {owner && how && (
          <p className="text-body text-ink-2">
            {how === "transfer" && to && result?.ok
              ? `${to}’s share becomes ${pct(result.owners.find((x) => sameName(x.name, to))?.percent)}; the shares add up to ${pct(total)}.`
              : how === "correction"
                ? `Afterwards the shares add up to ${pct(total)}.${total !== 100 && after.length ? " Correct the others to match the operating agreement." : ""}`
                : result?.ok
                  ? `The other owners grow pro rata; the shares add up to ${pct(total)}.`
                  : null}
          </p>
        )}
        {headerChange && <p className="text-body text-ink-2">{headerChange}</p>}
        {classNote && how && how !== "correction" && <Banner tone="warning">{classNote.message}</Banner>}
        {hasAccess && <Checkbox checked={revoke} onChange={setRevoke} label={`Also remove ${m.name}’s BFO access`} hint="They can sign in and see this entity’s documents today." />}
        {error && <Banner tone="negative">{error}</Banner>}
      </div>
    </Dialog>
  );
}

// ── A trust's people ─────────────────────────────────────────────────────

const BASES = ["Named in the trust agreement", "An amendment to the trust", "Appointed after a resignation or removal", "Other"];

export type TrustSave = { people: TrustPerson[]; history: Record<string, unknown>; revokeAccess?: boolean };

export function TrustAddDialog({
  open,
  onClose,
  role: initialRole,
  people,
  docs,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  role: TrustRole;
  people: TrustPerson[];
  docs: AssetDoc[];
  onSave: (s: TrustSave) => Promise<void>;
}) {
  const [role, setRole] = useState<TrustRole>(initialRole);
  const [name, setName] = useState("");
  const [cls, setCls] = useState<BeneficiaryClass | null>(null);
  const [since, setSince] = useState<string | null>(null);
  const [basis, setBasis] = useState<string | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tried, setTried] = useState(false);
  const trusteeish = role === "trustee" || role === "successor";
  const dup = name.trim() && people.some((p) => p.role === role && sameName(p.name, name));
  const elsewhere = name.trim() ? people.filter((p) => p.role !== role && sameName(p.name, name)) : [];
  const words = TRUST_WORDS[role];
  const nameError = tried && !name.trim() ? "Add their full name." : dup ? `${name.trim()} is already listed as ${words.one.toLowerCase()}.` : undefined;

  async function save() {
    setTried(true);
    setError("");
    if (!name.trim() || dup) return;
    const order = role === "successor" ? people.filter((p) => p.role === "successor").length + 1 : null;
    const doc = docs.find((d) => d.id === docId);
    const person: TrustPerson = {
      name: name.trim(),
      role,
      ...(order ? { order } : {}),
      ...(role === "beneficiary" && cls ? { class: cls } : {}),
      ...(since ? { since } : {}),
      ...(basis ? { basis } : {}),
      ...(doc ? { doc: { id: doc.id, name: doc.name } } : {}),
    };
    setBusy(true);
    try {
      await onSave({ people: [...people, person], history: { kind: "add", name: person.name, role, since: since ?? null, basis: basis ?? null, doc: person.doc ?? null } });
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn’t add them. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Add ${role === "trustee" ? "a trustee" : role === "successor" ? "a successor trustee" : role === "grantor" ? "a grantor" : "a beneficiary"}`}
      dirty={!!name.trim() && !busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} busyLabel="Adding…" onClick={() => void save()}>
            Add {words.one.toLowerCase()}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field
          label={`${words.one}’s full name`}
          error={nameError}
          hint={elsewhere.length ? `Also listed as ${elsewhere.map((p) => TRUST_WORDS[p.role].one.toLowerCase()).join(" and ")}: use the same spelling.` : undefined}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        {trusteeish && (
          <Field label="Serves as">
            <Select
              label="Serves as"
              value={role}
              onChange={(v) => setRole(v as TrustRole)}
              options={[
                { value: "trustee", label: "Acting trustee", hint: "Serving now" },
                { value: "successor", label: "Successor trustee", hint: "Serves when an acting trustee can’t" },
              ]}
            />
          </Field>
        )}
        {role === "beneficiary" && (
          <Field label="Kind of beneficiary" optional>
            <Select
              label="Kind of beneficiary"
              value={cls}
              onChange={(v) => setCls(v as BeneficiaryClass)}
              placeholder="Not on record"
              options={[
                { value: "current", label: "Current", hint: "Receives income or property now" },
                { value: "remainder", label: "Remainder", hint: "Receives what’s left later" },
                { value: "contingent", label: "Contingent", hint: "Only if others can’t" },
              ]}
            />
          </Field>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Since" optional>
            <DateInput value={since} onChange={setSince} />
          </Field>
          <Field label="How" optional>
            <Select label="How" value={basis} onChange={setBasis} placeholder="Choose" options={BASES.map((b) => ({ value: b, label: b }))} />
          </Field>
        </div>
        <Field label="Document" optional hint="The trust agreement, amendment or appointment, filed in Documents.">
          <Select label="Document" value={docId} onChange={setDocId} placeholder={docs.length ? "Choose a document" : "No documents filed yet"} disabled={!docs.length} options={docOptions(docs)} />
        </Field>
        <p className="text-small text-ink-2">This records an appointment already made; it doesn’t make one.</p>
        {error && <Banner tone="negative">{error}</Banner>}
      </form>
    </Dialog>
  );
}

type Reason = "resigned" | "removed" | "incapacity" | "died" | "amended" | "error";
const REASONS: Record<TrustRole, { value: Reason; title: string; description?: string }[]> = {
  trustee: [
    { value: "resigned", title: "Resigned", description: "In writing, as the trust agreement provides." },
    { value: "removed", title: "Removed under the trust agreement" },
    { value: "incapacity", title: "Incapacity" },
    { value: "died", title: "Died" },
    { value: "error", title: "Entered in error", description: "They were never a trustee." },
  ],
  successor: [
    { value: "amended", title: "No longer named", description: "An amendment changed the successors." },
    { value: "died", title: "Died" },
    { value: "error", title: "Entered in error" },
  ],
  grantor: [
    { value: "amended", title: "The trust was amended" },
    { value: "died", title: "Died" },
    { value: "error", title: "Entered in error", description: "They were never a grantor." },
  ],
  beneficiary: [
    { value: "amended", title: "The trust was amended" },
    { value: "died", title: "Died" },
    { value: "error", title: "Entered in error" },
  ],
};

export function TrustRemoveDialog({
  open,
  onClose,
  person,
  people,
  docs,
  hasAccess,
  grantorTrust,
  hasCertificate,
  onRemove,
}: {
  open: boolean;
  onClose: () => void;
  person: TrustPerson;
  people: TrustPerson[];
  docs: AssetDoc[];
  hasAccess: boolean;
  /** Taxed as a grantor (revocable) trust, or not recorded (treated as one). */
  grantorTrust: boolean;
  /** A certification of trust is filed. */
  hasCertificate: boolean;
  onRemove: (s: TrustSave) => Promise<void>;
}) {
  const [reason, setReason] = useState<Reason | null>(null);
  const [date, setDate] = useState<string | null>(today());
  const [docId, setDocId] = useState<string | null>(null);
  const [revoke, setRevoke] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const words = TRUST_WORDS[person.role];
  const otherRoles = people.filter((p) => p !== person && sameName(p.name, person.name)).map((p) => TRUST_WORDS[p.role].one.toLowerCase());
  const actingLeft = people.filter((p) => p !== person && p.role === "trustee").length;
  const lastTrustee = person.role === "trustee" && actingLeft === 0 && reason !== "error";
  const isGrantor = person.role === "grantor" || people.some((p) => p.role === "grantor" && sameName(p.name, person.name));
  const grantorGone = isGrantor && grantorTrust && (reason === "died" || reason === "incapacity");

  async function remove() {
    setError("");
    if (!reason) return setError("Say why they’re coming off the list.");
    if (lastTrustee) return;
    const doc = docs.find((d) => d.id === docId);
    setBusy(true);
    try {
      await onRemove({
        people: people.filter((p) => p !== person),
        history: { kind: "remove", name: person.name, role: person.role, reason, date: reason === "error" ? null : date, doc: doc ? { id: doc.id, name: doc.name } : null },
        revokeAccess: hasAccess && revoke,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn’t remove them. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Remove ${person.name} from the ${words.many}?`}
      description={
        person.role === "trustee" || person.role === "successor"
          ? "This changes BFO’s record only. A trustee leaves office as the trust agreement provides: in writing, by removal, or on incapacity or death."
          : "This changes BFO’s record only. The trust itself changes only as its agreement provides."
      }
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            busy={busy}
            busyLabel="Removing…"
            disabled={!reason || lastTrustee}
            disabledReason={!reason ? "Say why first" : lastTrustee ? "A trust needs a trustee" : undefined}
            onClick={() => void remove()}
          >
            Remove {words.one.toLowerCase()}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-body font-medium break-words text-ink">{person.name}</p>
          <p className="text-small text-ink-2">{otherRoles.length ? `Stays ${format.list(otherRoles)}` : words.one}</p>
        </div>
        <ChoiceTiles label="Why" value={reason} onChange={setReason} options={REASONS[person.role]} stacked />
        {reason && reason !== "error" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="As of">
              <DateInput value={date} onChange={setDate} />
            </Field>
            <Field label="Document" optional hint="The resignation, removal, certificate or amendment.">
              <Select
                label="Document"
                value={docId}
                onChange={setDocId}
                placeholder={docs.length ? "Choose a document" : "No documents filed yet"}
                disabled={!docs.length}
                options={docOptions(docs)}
              />
            </Field>
          </div>
        )}
        {lastTrustee && <Banner tone="warning">A trust can’t be left without a trustee. Mark the successor who now serves as acting trustee first, then remove {person.name}.</Banner>}
        {grantorGone && (
          <Banner tone="warning">
            When a grantor of a revocable trust dies or can no longer act, the trust (or that grantor’s share) may become irrevocable: it then needs its own EIN, files Form 1041, and may make a §645
            election, and the beneficiaries may be owed notice under the state’s trust code. Record the new tax classification once counsel confirms it.
          </Banner>
        )}
        {hasCertificate && (person.role === "trustee" || person.role === "successor") && reason && reason !== "error" && (
          <p className="text-body text-ink-2">The certification of trust on file names {person.name}. Record an updated one in Documents.</p>
        )}
        {hasAccess && <Checkbox checked={revoke} onChange={setRevoke} label={`Also remove ${person.name}’s BFO access`} hint="They can sign in and see the trust’s documents today." />}
        {error && <Banner tone="negative">{error}</Banner>}
      </div>
    </Dialog>
  );
}
