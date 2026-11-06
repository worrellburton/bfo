/**
 * Treasury's shared components: one institution mark, and the owner picker
 * (an entity, one person, or joint owners, with tax status and an optional
 * beneficiary). Built on app/ui (docs/DESIGN.md); the data and rules are in
 * app/treasury-data.ts and app/treasury-model.ts.
 */
import { useEffect, useId, useState } from "react";
import { Button, ChoiceTiles, Dialog, Field, Input, Select, type Option } from "./ui";
import { TAX_STATUS_LABEL, TENANCY_LABEL, defaultTaxStatus, isRetirement, registration, type OwnerKind, type TaxStatus, type Tenancy } from "./treasury-model";
import { accountName, type Account, type Entity, type OwnerChoice } from "./treasury-data";

/** The institution's logo on a white tile, else its initial on a neutral tile: the same in both themes, everywhere. */
export function InstitutionMark({ name, logo, size = 32 }: { name: string; logo: string | null | undefined; size?: 24 | 32 }) {
  const box = size === 24 ? "size-[24px] rounded-mark" : "size-[32px] rounded-control";
  return logo ? (
    <img src={`data:image/png;base64,${logo}`} alt="" className={`${box} shrink-0 border border-line bg-paper object-contain p-[2px]`} />
  ) : (
    <span aria-hidden className={`${box} flex shrink-0 items-center justify-center bg-sunken text-caption font-medium text-ink-2`}>
      {(name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * The owner picker: an entity, one person, or joint owners, with tax status
 * and an optional beneficiary entity. A retirement account offers people
 * only (an IRA is one person's; a trust can be its beneficiary).
 */
export function OwnerDialog({
  open,
  onClose,
  account,
  entities,
  people,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  account: Account | null;
  entities: Entity[];
  people: string[];
  onSave: (choice: OwnerChoice) => Promise<string | null>;
}) {
  const retirement = !!account && isRetirement(account.subtype, account.official_name || account.name);
  const [kind, setKind] = useState<OwnerKind>("entity");
  const [entityId, setEntityId] = useState<string | null>(null);
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [tenancy, setTenancy] = useState<Tenancy | null>("jtwros");
  const [tax, setTax] = useState<TaxStatus | null>(null);
  const [beneficiary, setBeneficiary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !account) return;
    const k: OwnerKind = account.owner_kind === "person" || account.owner_kind === "joint" ? account.owner_kind : retirement ? "person" : "entity";
    setKind(k);
    setEntityId(account.entity_id ?? null);
    setFirst(account.owner_names?.[0] ?? "");
    setSecond(account.owner_names?.[1] ?? "");
    setTenancy(account.tenancy ?? "jtwros");
    setTax(account.tax_status ?? defaultTaxStatus(account.subtype, account.official_name || account.name, account.type));
    setBeneficiary(account.beneficiary_entity_id ?? (retirement && account.entity_id ? account.entity_id : null));
    setError(null);
  }, [open, account, retirement]);

  if (!account) return null;
  const reg = registration(account.official_name || account.name, account.subtype);
  const entityOptions: Option<string>[] = entities.map((e) => ({ value: e.id, label: e.name, hint: e.type ?? undefined }));
  const personOptions = (v: string): Option<string>[] => [...new Set([...(v ? [v] : []), ...people])].map((p) => ({ value: p, label: p }));

  async function save() {
    setError(null);
    const choice: OwnerChoice =
      kind === "entity"
        ? { owner_kind: entityId ? "entity" : null, entity_id: entityId ?? "", entity_name: entities.find((e) => e.id === entityId)?.name ?? "", tax_status: tax }
        : {
            owner_kind: kind,
            owner_names: kind === "joint" ? [first.trim(), second.trim()] : [first.trim()],
            tenancy: kind === "joint" ? tenancy : null,
            tax_status: tax,
            beneficiary_entity_id: beneficiary ?? "",
            beneficiary_name: entities.find((e) => e.id === beneficiary)?.name ?? "",
          };
    if (kind !== "entity" && !first.trim()) return setError(kind === "joint" ? "Name both joint owners." : "Name the person who owns the account.");
    if (kind === "joint" && !second.trim()) return setError("Name both joint owners.");
    setBusy(true);
    const err = await onSave(choice);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Owner: ${accountName(account)}`}
      description={reg ? `The custodian registers it as ${reg.label}.` : "Who holds title to this account."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} busyLabel="Saving…" onClick={() => void save()}>
            Save owner
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ChoiceTiles
          label="Owned by"
          stacked
          value={kind}
          onChange={setKind}
          options={[
            {
              value: "entity",
              title: "An entity",
              description: retirement ? "Not for a retirement account: it belongs to one person." : "Counts in that entity’s Books and statements.",
              disabled: retirement,
            },
            { value: "person", title: "One person", description: "Outside every entity’s Books." },
            { value: "joint", title: "Joint owners", description: retirement ? "Not for a retirement account." : "Held by two or more people, outside every entity’s Books.", disabled: retirement },
          ]}
        />
        {kind === "entity" && (
          <Field label="Entity">
            <Select label="Entity" value={entityId} onChange={setEntityId} options={entityOptions} placeholder="Choose an entity" />
          </Field>
        )}
        {kind !== "entity" && (
          <>
            <Field label={kind === "joint" ? "First owner" : "Owner"} hint={people.length ? "A name from the records, or type one." : undefined}>
              <PersonInput value={first} onChange={setFirst} options={personOptions(first)} />
            </Field>
            {kind === "joint" && (
              <>
                <Field label="Second owner">
                  <PersonInput value={second} onChange={setSecond} options={personOptions(second)} />
                </Field>
                <Field label="How they hold it">
                  <Select label="How they hold it" value={tenancy} onChange={setTenancy} options={(Object.keys(TENANCY_LABEL) as Tenancy[]).map((t) => ({ value: t, label: TENANCY_LABEL[t] }))} />
                </Field>
              </>
            )}
            <Field label="Beneficiary" optional hint="An entity named as beneficiary, such as a trust named on an IRA. It doesn’t make the entity the owner.">
              <Select label="Beneficiary" value={beneficiary} onChange={setBeneficiary} options={[{ value: "", label: "None" }, ...entityOptions]} placeholder="None" />
            </Field>
          </>
        )}
        <Field label="Tax status" hint={retirement ? "Retirement accounts are tax-deferred, or tax-exempt for a Roth." : undefined}>
          <Select label="Tax status" value={tax} onChange={setTax} options={(Object.keys(TAX_STATUS_LABEL) as TaxStatus[]).map((t) => ({ value: t, label: TAX_STATUS_LABEL[t] }))} />
        </Field>
        {error && (
          <p role="alert" className="text-small text-negative">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** A name: chosen from the people in the records, or typed. */
function PersonInput({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Option<string>[] }) {
  const id = useId();
  return (
    <>
      <Input value={value} onChange={(e) => onChange(e.target.value)} list={id} autoComplete="off" placeholder="Full name" maxLength={80} />
      <datalist id={id}>
        {options.map((o) => (
          <option key={o.value} value={o.value} />
        ))}
      </datalist>
    </>
  );
}
