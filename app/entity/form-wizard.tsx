import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getUser, isAdmin } from "../auth";
import { confirmDialog } from "../confirm-dialog";
import {
  DEFAULT_PURPOSE,
  DEFAULT_PURPOSE_CORP,
  draftProblems,
  EIN_ACTIVITIES,
  EMPTY_ADDRESS,
  emptyDraft,
  emptyOwner,
  officeAddress,
  ownerName,
  ownerPercent,
  ownersTotal,
  parseAddress,
  sameAddress,
  US_STATES,
  type FormationAddress,
  type FormationDraft,
  type FormationOwner,
  type FormationState,
} from "../formation";
import { palmCall, PalmUnavailable, type PalmMode } from "../palm";
import { pushId } from "../store";
import { Button, Dot, ErrorLine, Field, Icon, IconButton, Input, Select, Switch, Textarea, TextButton, useTone } from "./ui";

/**
 * Forming a new entity through Palm, step by step: the name (checked against
 * the state as it's typed), addresses and contact, the people, Palm's
 * services (registered agent, EIN), whatever else the state asks, then a
 * review with the fee and Palm's own validation. Nothing is filed until the
 * last step's confirmation — which spells out the state, the cost and, in
 * live mode, that it can't be undone.
 */

type ExtraField = { key: string; label: string; description: string | null; type: "string" | "number" | "boolean" | "enum"; options: string[]; required: boolean };
type Requirements = { supported: boolean; expeditedTiers: string[]; extra: ExtraField[] };
type NameCheck = { eligible: boolean; compliant: boolean; available: boolean; violations: { severity: string; message: string }[]; alternatives: string[] };
type Fee = { total: number | null; currency: string; items: { kind: string; name: string; amount: number }[]; expeditedTiers: { tier: string; amount: number }[]; note?: string };
type Validation = { ok: boolean; errors: { field: string | null; message: string }[]; skipped?: boolean };

const STEPS = ["Name", "Addresses", "People", "Services", "State", "Review"] as const;

const TIER_LABEL: Record<string, string> = { expedited: "Expedited", "24_hour": "24 hours", same_day: "Same day", "3_hour": "3 hours", "2_hour": "2 hours", "1_hour": "1 hour" };

const money = (n: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

export function FormEntityWizard({
  open,
  onClose,
  entities,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** Existing entities, for "owned by" (and, from their addresses, the family's office). */
  entities: { id: string; name: string; address?: string }[];
  onCreated: (assetId: string) => void;
}) {
  if (!open) return null;
  return <Wizard onClose={onClose} entities={entities} onCreated={onCreated} />;
}

function Wizard({
  onClose,
  entities,
  onCreated,
}: {
  onClose: () => void;
  entities: { id: string; name: string; address?: string }[];
  onCreated: (assetId: string) => void;
}) {
  const t = useTone();
  const me = getUser();
  const panelRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  // The office the family's entities share starts as the new entity's principal office.
  const [office] = useState(() => officeAddress(entities.map((e) => e.address)));
  const [draft, setDraft] = useState<FormationDraft>(() => {
    const d = emptyDraft();
    if (office) d.principal = { ...office };
    d.contact = { name: me?.name ?? "", email: me?.email ?? "", phone: me?.phone ?? "" };
    d.email = me?.email ?? "";
    // Most new entities are owned by one already here: start with that row to fill in.
    if (entities.length) d.owners = [emptyOwner("entity", "100")];
    return d;
  });
  const [mode, setMode] = useState<PalmMode | null | "off">(null);
  const [requirements, setRequirements] = useState<Requirements | null>(null);
  const [nameCheck, setNameCheck] = useState<NameCheck | null | "checking">(null);
  const [fee, setFee] = useState<Fee | null>(null);
  const [validation, setValidation] = useState<Validation | null | "checking">(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  /** One key per attempt at this filing, so a retry after a dropped connection never files twice. */
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [assetId] = useState(() => pushId());

  const set = (patch: Partial<FormationDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const stateName = useMemo(() => US_STATES.find(([abbr]) => `US-${abbr}` === draft.jurisdiction)?.[1] ?? "", [draft.jurisdiction]);
  const typeLabel = draft.entityType === "llc" ? "LLC" : "corporation";
  const problems = useMemo(() => draftProblems(draft), [draft]);
  const canFile = isAdmin(me);

  // Palm's mode decides what the confirmation says.
  useEffect(() => {
    palmCall<{ configured: boolean; mode: PalmMode | null }>("status")
      .then((s) => setMode(s.configured ? s.mode : "off"))
      .catch(() => setMode("off"));
  }, []);

  // Esc closes; the body stays put behind.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // What the state asks for, whenever the state or type changes.
  useEffect(() => {
    if (!/^US-[A-Z]{2}$/.test(draft.jurisdiction)) {
      setRequirements(null);
      return;
    }
    let live = true;
    setRequirements(null);
    palmCall<Requirements>("form-requirements", { jurisdiction: draft.jurisdiction, entityType: draft.entityType })
      .then((r) => live && setRequirements(r))
      .catch((err) => live && setError(err instanceof PalmUnavailable ? "Palm isn't connected. Add PALM_API_KEY in Vercel." : (err as Error).message));
    return () => {
      live = false;
    };
  }, [draft.jurisdiction, draft.entityType]);

  // The name, checked with the state as it's typed.
  useEffect(() => {
    const name = draft.legalName.trim();
    if (!/^US-[A-Z]{2}$/.test(draft.jurisdiction) || name.length < 3) {
      setNameCheck(null);
      return;
    }
    let live = true;
    setNameCheck("checking");
    const timer = window.setTimeout(() => {
      palmCall<NameCheck>("form-name", { jurisdiction: draft.jurisdiction, entityType: draft.entityType, name })
        .then((r) => live && setNameCheck(r))
        .catch(() => live && setNameCheck(null));
    }, 600);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [draft.legalName, draft.jurisdiction, draft.entityType]);

  // The review step prices the filing and asks Palm to check it, filing nothing.
  const reviewing = step === STEPS.length - 1;
  useEffect(() => {
    if (!reviewing) return;
    let live = true;
    setFee(null);
    palmCall<Fee>("form-fee", { jurisdiction: draft.jurisdiction, entityType: draft.entityType, expeditedTier: draft.expeditedTier, extra: draft.extra })
      .then((f) => live && setFee(f))
      .catch(() => live && setFee({ total: null, currency: "USD", items: [], expeditedTiers: [], note: "Couldn't price the filing." }));
    return () => {
      live = false;
    };
  }, [reviewing, draft.jurisdiction, draft.entityType, draft.expeditedTier, draft.extra]);
  useEffect(() => {
    if (!reviewing || problems.length) return;
    let live = true;
    setValidation("checking");
    palmCall<Validation>("form-validate", { draft })
      .then((v) => live && setValidation(v))
      .catch((err) => live && setValidation({ ok: false, errors: [{ field: null, message: (err as Error).message }] }));
    return () => {
      live = false;
    };
    // Re-check when the review opens or the draft changes while on it.
  }, [reviewing, draft, problems.length]);

  const extra = requirements?.extra ?? [];
  const steps = STEPS.filter((s) => s !== "State" || extra.length > 0);
  const stepName = steps[Math.min(step, steps.length - 1)];
  const stepProblems = problems.filter((p) => STEPS.indexOf(steps[p.step] ?? "Name") >= 0 && steps[p.step] === stepName);

  async function close() {
    if (submitting) return;
    const dirty = draft.legalName.trim() || draft.principal.street1.trim();
    if (dirty && !(await confirmDialog({ title: "Leave without filing?", message: "What you've entered here is lost.", confirmLabel: "Leave", tone: "danger" }))) return;
    onClose();
  }

  async function submit() {
    if (submitting || mode === null || mode === "off") return;
    const live = mode === "live";
    const cost = fee?.total != null ? money(fee.total, fee.currency) : "the state's fee";
    const ok = await confirmDialog({
      title: `File ${draft.legalName.trim()} with ${stateName}?`,
      message: live
        ? `Palm will file the ${draft.entityType === "llc" ? "articles of organization" : "articles of incorporation"} with the ${stateName} Secretary of State and bill your Palm account about ${cost}. Once it's with the state this can't be undone.`
        : "Palm is in test mode: nothing is filed with the state and nothing is billed. The entity is created here as a test.",
      details: [
        `${typeLabel.toUpperCase() === "LLC" ? "LLC" : "Corporation"} in ${stateName}${draft.expeditedTier ? `, ${TIER_LABEL[draft.expeditedTier] ?? draft.expeditedTier} processing` : ""}.`,
        draft.agent.provider === "palm" ? "Palm serves as registered agent." : `${draft.agent.name} serves as registered agent.`,
        draft.ein ? "Palm applies for the EIN once the state has formed it." : "No EIN application.",
        draft.owners.length ? `Owned by ${draft.owners.map((o) => `${ownerName(o)} (${ownerPercent(o)}%)`).join(", ")}.` : "No owners listed.",
        `${draft.organizers.length} organizer${draft.organizers.length === 1 ? "" : "s"}${draft.governors.length ? `, ${draft.governors.length} ${draft.governors.length === 1 ? (draft.entityType === "llc" ? "manager" : "director or officer") : draft.entityType === "llc" ? "managers" : "directors and officers"}` : ""}.`,
      ],
      tone: live ? "danger" : "default",
      confirmLabel: live ? "Yes, file with the state" : "Submit test filing",
      requireText: live ? draft.legalName.trim() : undefined,
    });
    if (!ok) return;
    setSubmitting(true);
    setError("");
    try {
      await palmCall<{ assetId: string; formation: FormationState }>("form-submit", { draft, assetId, stateName, mode, idempotencyKey });
      onCreated(assetId);
    } catch (err) {
      const e = err as Error & { code?: string };
      setError(e.code === "mode_changed" ? `${e.message}` : e.message || "Palm couldn't file this.");
      setSubmitting(false);
    }
  }

  const setOwner = (i: number, next: FormationOwner) => set({ owners: draft.owners.map((x, j) => (j === i ? next : x)) });
  /** A new owner takes whatever share is left. */
  const addOwner = (kind: FormationOwner["kind"]) => {
    const left = Math.max(0, Math.round((100 - ownersTotal(draft.owners)) * 100) / 100);
    set({ owners: [...draft.owners, emptyOwner(kind, left ? String(left) : "")] });
  };

  const field = (label: string, node: ReactNode, hint?: ReactNode, wide = false) => (
    <Field label={label} hint={hint} wide={wide}>
      {node}
    </Field>
  );

  const addressFields = (a: FormationAddress, onChange: (next: FormationAddress) => void, lockRegion?: string) => (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
      <Field label="Street" className="md:col-span-4">
        <Input value={a.street1} onChange={(e) => onChange({ ...a, street1: e.target.value })} autoComplete="address-line1" />
      </Field>
      <Field label="Suite / unit" className="md:col-span-2">
        <Input value={a.street2} onChange={(e) => onChange({ ...a, street2: e.target.value })} autoComplete="address-line2" />
      </Field>
      <Field label="City" className="md:col-span-3">
        <Input value={a.city} onChange={(e) => onChange({ ...a, city: e.target.value })} autoComplete="address-level2" />
      </Field>
      <Field label="State" className="md:col-span-1">
        <Select value={lockRegion ?? a.region} disabled={!!lockRegion} onChange={(e) => onChange({ ...a, region: e.target.value })}>
          <option value="">—</option>
          {US_STATES.map(([abbr]) => (
            <option key={abbr} value={abbr}>
              {abbr}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="ZIP" className="md:col-span-2">
        <Input value={a.postal} inputMode="numeric" onChange={(e) => onChange({ ...a, postal: e.target.value })} autoComplete="postal-code" />
      </Field>
    </div>
  );

  const body = (() => {
    switch (stepName) {
      case "Name":
        return (
          <div className="space-y-5">
            <div>
              <span className={`mb-1.5 block text-[12px] ${t.muted}`}>What kind of entity</span>
              <div role="group" aria-label="Entity type" className={`inline-flex rounded-lg p-0.5 ${t.dark ? "bg-white/[0.05]" : "bg-gray-100"}`}>
                {(["llc", "corporation"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={draft.entityType === k}
                    onClick={() => set({ entityType: k, purpose: draft.purpose === DEFAULT_PURPOSE || draft.purpose === DEFAULT_PURPOSE_CORP ? (k === "llc" ? DEFAULT_PURPOSE : DEFAULT_PURPOSE_CORP) : draft.purpose })}
                    className={`h-8 cursor-pointer rounded-[7px] px-4 text-[13px] font-medium transition-colors max-sm:h-[40px] ${
                      draft.entityType === k ? (t.dark ? "bg-white/[0.1] text-white" : "bg-white text-gray-900 shadow-sm") : t.dark ? "text-gray-400 hover:text-gray-200" : "text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    {k === "llc" ? "LLC" : "Corporation"}
                  </button>
                ))}
              </div>
              {draft.entityType === "corporation" && <p className={`mt-1.5 text-[12px] ${t.muted}`}>Corporation filings are new at Palm and may ask for more than this form shows.</p>}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {field(
                "State of formation",
                <Select value={draft.jurisdiction} onChange={(e) => set({ jurisdiction: e.target.value, principal: { ...draft.principal, region: draft.principal.region || e.target.value.slice(3) } })}>
                  <option value="">Choose a state</option>
                  {US_STATES.map(([abbr, name]) => (
                    <option key={abbr} value={`US-${abbr}`}>
                      {name}
                    </option>
                  ))}
                </Select>,
                requirements && !requirements.supported ? <span className={t.dark ? "text-amber-300" : "text-amber-700"}>Palm can't form a {typeLabel} in {stateName} yet.</span> : undefined
              )}
              {field(
                "Legal name",
                <Input value={draft.legalName} onChange={(e) => set({ legalName: e.target.value })} placeholder={draft.entityType === "llc" ? "Example Holdings, LLC" : "Example, Inc."} autoFocus />,
                <NameStatus check={nameCheck} onPick={(n) => set({ legalName: n })} />
              )}
            </div>
          </div>
        );
      case "Addresses":
        return (
          <div className="space-y-5">
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className={`text-[13px] font-semibold ${t.text}`}>Principal office</h3>
                {office && (
                  <button
                    type="button"
                    onClick={() => set({ principal: { ...office } })}
                    disabled={sameAddress(draft.principal, office)}
                    className={`cursor-pointer text-[12px] font-medium disabled:cursor-default disabled:opacity-50 ${t.dark ? "text-indigo-300 hover:underline" : "text-indigo-600 hover:underline"}`}
                  >
                    {sameAddress(draft.principal, office) ? "Our office address" : "Use our office address"}
                  </button>
                )}
              </div>
              {addressFields(draft.principal, (principal) => set({ principal }))}
              {office && sameAddress(draft.principal, office) && (
                <p className={`mt-2 text-[12px] ${t.muted}`}>The address the family's other entities use. Change it for this one if it has its own office.</p>
              )}
            </div>
            <div>
              <label className="flex cursor-pointer items-center gap-2.5">
                <Switch on={draft.mailingSame} onToggle={() => set({ mailingSame: !draft.mailingSame })} label="Mailing address is the same" />
                <span className={`text-[13px] ${t.soft}`}>Mailing address is the same</span>
              </label>
              {!draft.mailingSame && <div className="mt-3">{addressFields(draft.mailing, (mailing) => set({ mailing }))}</div>}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {field("Business email", <Input type="email" value={draft.email} onChange={(e) => set({ email: e.target.value })} />, "Goes on the filing where the state asks for one.")}
              {field("Business phone", <Input type="tel" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="Optional" />)}
              {field("Website", <Input value={draft.website} onChange={(e) => set({ website: e.target.value })} placeholder="Optional" />)}
              {field("Effective date", <Input type="date" value={draft.effectiveDate} onChange={(e) => set({ effectiveDate: e.target.value })} />, "Leave blank to form as soon as the state accepts it.")}
            </div>
            {field("Purpose", <Textarea rows={3} value={draft.purpose} onChange={(e) => set({ purpose: e.target.value })} />, "Most states accept the general clause. Some print exactly what you write here on the articles.", true)}
            <div>
              <h3 className={`mb-1 text-[13px] font-semibold ${t.text}`}>Contact for Palm</h3>
              <p className={`mb-2 text-[12px] ${t.muted}`}>Who Palm reaches if the state needs anything. Not on the filing.</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {field("Name", <Input value={draft.contact.name} onChange={(e) => set({ contact: { ...draft.contact, name: e.target.value } })} />)}
                {field("Email", <Input type="email" value={draft.contact.email} onChange={(e) => set({ contact: { ...draft.contact, email: e.target.value } })} />)}
                {field("Phone", <Input type="tel" value={draft.contact.phone} onChange={(e) => set({ contact: { ...draft.contact, phone: e.target.value } })} placeholder="Optional" />)}
              </div>
            </div>
          </div>
        );
      case "People":
        return (
          <div className="space-y-6">
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className={`text-[13px] font-semibold ${t.text}`}>Owners</h3>
                <div className="flex items-center gap-3">
                  <TextButton onClick={() => addOwner("entity")}>Add an entity</TextButton>
                  <TextButton onClick={() => addOwner("person")}>Add a person</TextButton>
                </div>
              </div>
              <p className={`mb-3 text-[12px] ${t.muted}`}>
                {draft.entityType === "llc"
                  ? "Who owns it and how much. They go to Palm as the LLC's members, and Palm drafts the operating agreement from this list. The percentages are kept here."
                  : "Who owns it and how much. Kept here; the shares are issued after the state forms it."}
              </p>
              {draft.owners.length === 0 ? (
                <p className={`text-[12.5px] ${t.faint}`}>No owners listed. It sits at the top of the structure.</p>
              ) : (
                <div className="space-y-3">
                  {draft.owners.map((o, i) => (
                    <OwnerRow
                      key={i}
                      owner={o}
                      entities={entities}
                      llc={draft.entityType === "llc"}
                      principal={draft.principal}
                      onChange={(next) => setOwner(i, next)}
                      onRemove={() => set({ owners: draft.owners.filter((_, j) => j !== i) })}
                      address={
                        <>
                          <TextButton onClick={() => setOwner(i, { ...o, address: o.address ? null : { ...EMPTY_ADDRESS } })}>{o.address ? "Use the principal office" : "Different address"}</TextButton>
                          {o.address && <div className="mt-2">{addressFields(o.address, (address) => setOwner(i, { ...o, address }))}</div>}
                        </>
                      }
                    />
                  ))}
                  <OwnersTotal owners={draft.owners} />
                </div>
              )}
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className={`text-[13px] font-semibold ${t.text}`}>{draft.entityType === "llc" ? "Organizers" : "Incorporators"}</h3>
                <TextButton onClick={() => set({ organizers: [...draft.organizers, { first: "", last: "", address: null, title: draft.entityType === "llc" ? "Organizer" : "Incorporator" }] })}>Add another</TextButton>
              </div>
              <p className={`mb-3 text-[12px] ${t.muted}`}>The person signing the articles. Their address defaults to the principal office.</p>
              <div className="space-y-3">
                {draft.organizers.map((o, i) => (
                  <PersonRow
                    key={i}
                    first={o.first}
                    last={o.last}
                    onChange={(first, last) => set({ organizers: draft.organizers.map((x, j) => (j === i ? { ...x, first, last } : x)) })}
                    onRemove={draft.organizers.length > 1 ? () => set({ organizers: draft.organizers.filter((_, j) => j !== i) }) : undefined}
                    extra={
                      <TextButton onClick={() => set({ organizers: draft.organizers.map((x, j) => (j === i ? { ...x, address: x.address ? null : { ...EMPTY_ADDRESS, region: draft.jurisdiction.slice(3) } } : x)) })}>
                        {o.address ? "Use the principal office" : "Different address"}
                      </TextButton>
                    }
                    below={o.address ? addressFields(o.address, (address) => set({ organizers: draft.organizers.map((x, j) => (j === i ? { ...x, address } : x)) })) : null}
                  />
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className={`text-[13px] font-semibold ${t.text}`}>{draft.entityType === "llc" ? "Managers" : "Directors and officers"}</h3>
                <TextButton onClick={() => set({ governors: [...draft.governors, { first: "", last: "", role: "manager", title: "" }] })}>Add a person</TextButton>
              </div>
              <p className={`mb-3 text-[12px] ${t.muted}`}>
                {draft.entityType === "llc"
                  ? "Optional. Only for a manager-managed LLC: the people who run it without owning it. Leave empty and the owners run it."
                  : "Optional. Some states list them on the articles or the initial list."}
              </p>
              {draft.governors.length === 0 ? (
                <p className={`text-[12.5px] ${t.faint}`}>No one listed.</p>
              ) : (
                <div className="space-y-3">
                  {draft.governors.map((g, i) => (
                    <PersonRow
                      key={i}
                      first={g.first}
                      last={g.last}
                      onChange={(first, last) => set({ governors: draft.governors.map((x, j) => (j === i ? { ...x, first, last } : x)) })}
                      onRemove={() => set({ governors: draft.governors.filter((_, j) => j !== i) })}
                      extra={
                        draft.entityType === "llc" ? undefined : (
                          <Select value={g.role} onChange={(e) => set({ governors: draft.governors.map((x, j) => (j === i ? { ...x, role: e.target.value as "member" | "manager" } : x)) })} className="!w-auto">
                            <option value="manager">Director</option>
                            <option value="member">Officer</option>
                          </Select>
                        )
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      case "Services":
        return (
          <div className="space-y-6">
            <div>
              <h3 className={`mb-2 text-[13px] font-semibold ${t.text}`}>Registered agent</h3>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <Choice on={draft.agent.provider === "palm"} onPick={() => set({ agent: { provider: "palm" } })} title="Palm" text={`Palm serves as agent in ${stateName || "the state"} and forwards what it receives into BFO.`} />
                <Choice
                  on={draft.agent.provider === "own"}
                  onPick={() => set({ agent: draft.agent.provider === "own" ? draft.agent : { provider: "own", kind: "organization", name: "", address: { ...EMPTY_ADDRESS, region: draft.jurisdiction.slice(3) }, email: "", phone: "" } })}
                  title="Someone else"
                  text="Name an agent you already have in this state."
                />
              </div>
              {draft.agent.provider === "own" && (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {field(
                      "Agent is",
                      <Select value={draft.agent.kind} onChange={(e) => draft.agent.provider === "own" && set({ agent: { ...draft.agent, kind: e.target.value as "person" | "organization" } })}>
                        <option value="organization">A company</option>
                        <option value="person">A person</option>
                      </Select>
                    )}
                    <Field label="Name" className="md:col-span-2">
                      <Input value={draft.agent.name} onChange={(e) => draft.agent.provider === "own" && set({ agent: { ...draft.agent, name: e.target.value } })} />
                    </Field>
                  </div>
                  {addressFields(draft.agent.address, (address) => draft.agent.provider === "own" && set({ agent: { ...draft.agent, address } }), draft.jurisdiction.slice(3))}
                </div>
              )}
            </div>
            <div>
              <label className="flex cursor-pointer items-center gap-2.5">
                <Switch
                  on={!!draft.ein}
                  onToggle={() => set({ ein: draft.ein ? null : { first: "", last: "", ssn: "", fiscalYearEndMonth: 12, activity: "", activityDetail: "" } })}
                  label="Apply for an EIN through Palm"
                />
                <span className={`text-[13px] font-semibold ${t.text}`}>Apply for an EIN through Palm</span>
              </label>
              <p className={`mt-1 text-[12px] ${t.muted}`}>Palm files Form SS-4 with the IRS once the state has formed the entity. The number lands on the record when it's issued.</p>
              {draft.ein && (
                <div className="mt-3 space-y-3">
                  <p className={`text-[12px] ${t.muted}`}>The IRS needs a responsible party: a person who controls the entity. Their SSN goes straight to Palm and is never kept in BFO.</p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {field("First name", <Input value={draft.ein.first} onChange={(e) => draft.ein && set({ ein: { ...draft.ein, first: e.target.value } })} autoComplete="off" />)}
                    {field("Last name", <Input value={draft.ein.last} onChange={(e) => draft.ein && set({ ein: { ...draft.ein, last: e.target.value } })} autoComplete="off" />)}
                    {field("SSN", <Input type="password" inputMode="numeric" value={draft.ein.ssn} onChange={(e) => draft.ein && set({ ein: { ...draft.ein, ssn: e.target.value } })} placeholder="•••-••-••••" autoComplete="off" />)}
                    {field(
                      "Principal activity",
                      <Select value={draft.ein.activity} onChange={(e) => draft.ein && set({ ein: { ...draft.ein, activity: e.target.value } })}>
                        <option value="">Choose</option>
                        {EIN_ACTIVITIES.map((a) => (
                          <option key={a.value} value={a.value}>
                            {a.label}
                          </option>
                        ))}
                      </Select>
                    )}
                    <Field label="What it does" className="md:col-span-2">
                      <Input value={draft.ein.activityDetail} onChange={(e) => draft.ein && set({ ein: { ...draft.ein, activityDetail: e.target.value } })} placeholder="e.g. Holds and leases commercial real estate" />
                    </Field>
                    {field(
                      "Fiscal year ends",
                      <Select value={String(draft.ein.fiscalYearEndMonth)} onChange={(e) => draft.ein && set({ ein: { ...draft.ein, fiscalYearEndMonth: Number(e.target.value) } })}>
                        {Array.from({ length: 12 }, (_, i) => (
                          <option key={i + 1} value={i + 1}>
                            {new Date(2000, i, 1).toLocaleString("en-US", { month: "long" })}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      case "State":
        return (
          <div className="space-y-4">
            <p className={`text-[12.5px] ${t.muted}`}>{stateName} asks for these on top of the usual.</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {extra.map((f) => (
                <Field key={f.key} label={`${f.label}${f.required ? "" : " (optional)"}`} hint={f.description ?? undefined} wide={f.type === "string" && (f.description?.length ?? 0) > 80}>
                  {f.type === "boolean" ? (
                    <div className="flex h-8 items-center max-sm:h-[44px]">
                      <Switch on={!!draft.extra[f.key]} onToggle={() => set({ extra: { ...draft.extra, [f.key]: !draft.extra[f.key] } })} label={f.label} />
                    </div>
                  ) : f.type === "enum" ? (
                    <Select value={String(draft.extra[f.key] ?? "")} onChange={(e) => set({ extra: { ...draft.extra, [f.key]: e.target.value } })}>
                      <option value="">Choose</option>
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {o.replace(/_/g, " ")}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      type={f.type === "number" ? "number" : "text"}
                      value={String(draft.extra[f.key] ?? "")}
                      onChange={(e) => set({ extra: { ...draft.extra, [f.key]: f.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value } })}
                    />
                  )}
                </Field>
              ))}
            </div>
          </div>
        );
      case "Review":
        return (
          <div className="space-y-5">
            <dl className={`grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl border p-4 text-[13px] ${t.line} ${t.dark ? "bg-white/[0.02]" : "bg-gray-50"}`}>
              <Summary label="Entity" value={`${draft.legalName.trim()} · ${draft.entityType === "llc" ? "LLC" : "Corporation"} · ${stateName}`} />
              <Summary label="Office" value={`${draft.principal.street1}${draft.principal.street2 ? `, ${draft.principal.street2}` : ""}, ${draft.principal.city}, ${draft.principal.region} ${draft.principal.postal}`} />
              <Summary label={draft.entityType === "llc" ? "Organizers" : "Incorporators"} value={draft.organizers.map((o) => `${o.first} ${o.last}`.trim()).join(", ")} />
              <Summary label={draft.owners.length === 1 ? "Owner" : "Owners"} value={draft.owners.length ? draft.owners.map((o) => `${ownerName(o)} · ${ownerPercent(o)}%`).join("\n") : "None listed"} />
              {draft.governors.length > 0 && <Summary label={draft.entityType === "llc" ? "Managers" : "People"} value={draft.governors.map((g) => `${g.first} ${g.last}${draft.entityType === "llc" ? "" : ` (${g.role === "manager" ? "director" : "officer"})`}`).join(", ")} />}
              <Summary label="Registered agent" value={draft.agent.provider === "palm" ? "Palm" : draft.agent.name} />
              <Summary label="EIN" value={draft.ein ? `Palm applies after formation (${draft.ein.first} ${draft.ein.last} as responsible party)` : "Not now"} />
            </dl>

            <div>
              <h3 className={`mb-2 text-[13px] font-semibold ${t.text}`}>Cost</h3>
              {!fee ? (
                <p className={`text-[12.5px] ${t.muted}`}>Pricing with Palm…</p>
              ) : fee.total == null ? (
                <p className={`text-[12.5px] ${t.muted}`}>{fee.note ?? "Palm couldn't price this filing yet; the state's fee is billed at cost."}</p>
              ) : (
                <div className={`rounded-xl border ${t.line}`}>
                  {fee.items.map((i, idx) => (
                    <div key={idx} className={`flex items-center justify-between px-4 py-2 text-[12.5px] ${idx ? `border-t ${t.line}` : ""} ${t.soft}`}>
                      <span className="capitalize">{i.name.replace(/_/g, " ")}</span>
                      <span className="tabular-nums">{money(i.amount, fee.currency)}</span>
                    </div>
                  ))}
                  <div className={`flex items-center justify-between border-t px-4 py-2.5 text-[13px] font-semibold ${t.line} ${t.text}`}>
                    <span>Estimated total</span>
                    <span className="tabular-nums">{money(fee.total, fee.currency)}</span>
                  </div>
                </div>
              )}
              {(fee?.expeditedTiers.length || requirements?.expeditedTiers.length) ? (
                <div className="mt-3">
                  <span className={`mb-1.5 block text-[12px] ${t.muted}`}>Processing speed</span>
                  <div className="flex flex-wrap gap-1.5">
                    <Pill on={!draft.expeditedTier} onPick={() => set({ expeditedTier: "" })}>
                      Standard
                    </Pill>
                    {(fee?.expeditedTiers.length ? fee.expeditedTiers : (requirements?.expeditedTiers ?? []).map((tier) => ({ tier, amount: 0 }))).map((tr) => (
                      <Pill key={tr.tier} on={draft.expeditedTier === tr.tier} onPick={() => set({ expeditedTier: tr.tier })}>
                        {TIER_LABEL[tr.tier] ?? tr.tier.replace(/_/g, " ")}
                        {tr.amount ? <span className={`ml-1 tabular-nums ${t.muted}`}>+{money(tr.amount, fee?.currency)}</span> : null}
                      </Pill>
                    ))}
                  </div>
                </div>
              ) : null}
              <p className={`mt-2 text-[11.5px] ${t.faint}`}>State fees are estimates until the filing completes; the receipt on the completed filing is final. Palm's own fee is billed to the Palm account.</p>
            </div>

            <div>
              <h3 className={`mb-2 text-[13px] font-semibold ${t.text}`}>Palm's check</h3>
              {problems.length ? (
                <ul className="space-y-1">
                  {problems.map((p, i) => (
                    <li key={i} className={`flex items-start gap-2 text-[12.5px] ${t.dark ? "text-amber-300" : "text-amber-700"}`}>
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                      <span>
                        {p.text}{" "}
                        <TextButton onClick={() => setStep(steps.indexOf(STEPS[p.step]))}>Fix</TextButton>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : validation === "checking" || validation === null ? (
                <p className={`text-[12.5px] ${t.muted}`}>Asking Palm to check the filing…</p>
              ) : validation.ok ? (
                <Dot tone="good">{validation.skipped ? "Palm will check it on submission" : "Palm found no problems"}</Dot>
              ) : (
                <ul className="space-y-1">
                  {validation.errors.map((e, i) => (
                    <li key={i} className={`text-[12.5px] ${t.dark ? "text-red-300" : "text-red-700"}`}>
                      {e.field ? <span className="font-medium">{e.field.replace(/^\/|\//g, " ").trim()}: </span> : null}
                      {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className={`rounded-xl border px-4 py-3 text-[12.5px] ${mode === "live" ? (t.dark ? "border-amber-400/30 bg-amber-400/5 text-amber-200" : "border-amber-300 bg-amber-50 text-amber-800") : `${t.line} ${t.muted}`}`}>
              {mode === null
                ? "Checking Palm…"
                : mode === "off"
                  ? "Palm isn't connected, so nothing can be filed from here."
                  : mode === "live"
                    ? "Palm is live: submitting files with the state and bills the Palm account. You'll be asked to confirm."
                    : "Palm is in test mode: submitting creates the entity here as a test; nothing reaches the state."}
            </div>
            {!canFile && <p className={`text-[12.5px] ${t.muted}`}>Only an owner or admin can submit the filing.</p>}
          </div>
        );
    }
  })();

  const last = step === steps.length - 1;
  const atLastAllowed = (() => {
    // Each step must be clean before moving on past it.
    const here = steps[step];
    return !problems.some((p) => STEPS[p.step] === here);
  })();
  const canSubmit = canFile && mode !== null && mode !== "off" && !problems.length && !!requirements?.supported && validation !== "checking" && (validation === null || validation.ok || !!validation.skipped) && !submitting;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px] max-sm:hidden" onClick={() => void close()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="form-entity-title"
        className={`palette-panel glass-panel relative flex w-full flex-col overflow-hidden border shadow-2xl sm:max-h-[min(860px,calc(100dvh-3rem))] sm:max-w-[760px] sm:rounded-2xl ${t.dark ? "text-white" : "text-gray-900"}`}
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <header className={`flex shrink-0 items-center gap-3 border-b px-5 py-3 ${t.line}`}>
          <div className="min-w-0 flex-1">
            <h2 id="form-entity-title" className={`text-[15px] font-semibold ${t.text}`}>
              Form a new entity
            </h2>
            <p className={`text-[12px] ${t.muted}`}>Palm files it with the state.{mode === "test" ? " Test mode." : ""}</p>
          </div>
          <IconButton icon="x" label="Close" onClick={() => void close()} />
        </header>

        {/* Steps */}
        <ol className={`flex shrink-0 gap-1 overflow-x-auto border-b px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${t.line}`}>
          {steps.map((s, i) => {
            const done = i < step;
            const on = i === step;
            return (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => i < step && setStep(i)}
                  disabled={i > step}
                  aria-current={on ? "step" : undefined}
                  className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium transition-colors disabled:cursor-default ${
                    on ? (t.dark ? "bg-white/[0.1] text-white" : "bg-gray-900 text-white") : done ? `cursor-pointer ${t.soft} hover:underline` : t.faint
                  }`}
                >
                  <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${on ? "bg-white/20" : done ? (t.dark ? "bg-emerald-400/20 text-emerald-300" : "bg-emerald-100 text-emerald-700") : t.dark ? "bg-white/[0.06]" : "bg-gray-100"}`}>
                    {done ? <Icon name="check" className="h-2.5 w-2.5" strokeWidth={2.5} /> : i + 1}
                  </span>
                  {s}
                </button>
              </li>
            );
          })}
        </ol>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{body}</div>

        {(error || (stepProblems.length > 0 && !last)) && (
          <div className={`shrink-0 border-t ${t.line}`}>
            {error ? <ErrorLine>{error}</ErrorLine> : <p className={`px-5 py-2 text-[12px] ${t.dark ? "text-amber-300" : "text-amber-700"}`}>{stepProblems[0].text}</p>}
          </div>
        )}

        <footer className={`flex shrink-0 items-center gap-2 border-t px-4 py-3 ${t.line}`} style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <Button kind="ghost" onClick={() => void close()} disabled={submitting}>
            Cancel
          </Button>
          <span className="flex-1" />
          {step > 0 && (
            <Button kind="secondary" size="md" onClick={() => setStep((s) => s - 1)} disabled={submitting}>
              Back
            </Button>
          )}
          {!last ? (
            <Button kind="primary" size="md" onClick={() => setStep((s) => s + 1)} disabled={!atLastAllowed || (step === 0 && requirements !== null && !requirements.supported)}>
              Continue
            </Button>
          ) : (
            <Button kind="primary" size="md" onClick={() => void submit()} disabled={!canSubmit} title={!canFile ? "Only an owner or admin can file" : undefined}>
              {submitting ? "Filing…" : mode === "live" ? "File with the state…" : "Submit…"}
            </Button>
          )}
        </footer>
      </div>
    </div>,
    document.body
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────

function NameStatus({ check, onPick }: { check: NameCheck | null | "checking"; onPick: (name: string) => void }) {
  const t = useTone();
  if (check === null) return <span>Checked with the state as you type.</span>;
  if (check === "checking") return <span>Checking with the state…</span>;
  const blocking = check.violations.filter((v) => v.severity === "error");
  const notes = check.violations.filter((v) => v.severity !== "error");
  return (
    <span className="block space-y-1">
      {check.eligible ? (
        <Dot tone="good">Available</Dot>
      ) : !check.available ? (
        <Dot tone="bad">Taken: another business has this exact name</Dot>
      ) : (
        <Dot tone="bad">Not allowed as written</Dot>
      )}
      {blocking.map((v, i) => (
        <span key={i} className={`block ${t.dark ? "text-red-300" : "text-red-700"}`}>
          {v.message}
        </span>
      ))}
      {notes.map((v, i) => (
        <span key={i} className={`block ${t.dark ? "text-amber-300" : "text-amber-700"}`}>
          {v.message}
        </span>
      ))}
      {!check.eligible && check.alternatives.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span>Try:</span>
          {check.alternatives.map((a) => (
            <button key={a} type="button" onClick={() => onPick(a)} className={`cursor-pointer rounded-full border px-2 py-0.5 text-[11.5px] ${t.dark ? "border-white/[0.12] hover:bg-white/[0.06]" : "border-gray-300 hover:bg-gray-100"} ${t.soft}`}>
              {a}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

function OwnerRow({
  owner: o,
  entities,
  llc,
  principal,
  onChange,
  onRemove,
  address,
}: {
  owner: FormationOwner;
  entities: { id: string; name: string; address?: string }[];
  llc: boolean;
  principal: FormationAddress;
  onChange: (next: FormationOwner) => void;
  onRemove: () => void;
  address: ReactNode;
}) {
  const t = useTone();
  // An entity owner is one already here, or one typed in ("other").
  const [typed, setTyped] = useState(() => o.kind === "entity" && !o.entityId && !!o.entityName);
  const pick = (id: string) => {
    if (id === "__other") {
      setTyped(true);
      onChange({ ...o, entityId: "", entityName: "" });
      return;
    }
    setTyped(false);
    const e = entities.find((x) => x.id === id);
    // Its address on record when it has its own; otherwise the principal office.
    const own = parseAddress(e?.address);
    onChange({ ...o, entityId: id, entityName: e?.name ?? "", address: own && !sameAddress(own, principal) ? own : null });
  };
  return (
    <div className={`rounded-xl border p-3 ${t.line}`}>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Owner is" className="w-[118px] shrink-0">
          <Select value={o.kind} onChange={(e) => onChange({ ...o, kind: e.target.value as FormationOwner["kind"] })}>
            <option value="entity">An entity</option>
            <option value="person">A person</option>
          </Select>
        </Field>
        {o.kind === "entity" ? (
          <>
            <Field label="Entity" className="min-w-[180px] flex-1">
              <Select value={typed ? "__other" : o.entityId} onChange={(e) => pick(e.target.value)}>
                <option value="">Choose…</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
                <option value="__other">Another company…</option>
              </Select>
            </Field>
            {typed && (
              <Field label="Legal name" className="min-w-[180px] flex-1">
                <Input value={o.entityName} onChange={(e) => onChange({ ...o, entityName: e.target.value })} placeholder="Example Holdings, LLC" autoComplete="off" />
              </Field>
            )}
          </>
        ) : (
          <>
            <Field label="First name" className="min-w-[120px] flex-1">
              <Input value={o.first} onChange={(e) => onChange({ ...o, first: e.target.value })} autoComplete="off" />
            </Field>
            <Field label="Last name" className="min-w-[120px] flex-1">
              <Input value={o.last} onChange={(e) => onChange({ ...o, last: e.target.value })} autoComplete="off" />
            </Field>
          </>
        )}
        <Field label={llc ? "Ownership" : "Owns"} className="w-[96px] shrink-0">
          <div className="relative">
            <Input value={o.percent} onChange={(e) => onChange({ ...o, percent: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" className="pr-6 text-right tabular-nums" aria-label="Percent owned" />
            <span className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12.5px] ${t.muted}`}>%</span>
          </div>
        </Field>
        <div className="flex h-8 items-center max-sm:h-[44px]">
          <IconButton icon="x" label="Remove owner" onClick={onRemove} />
        </div>
      </div>
      <div className="mt-2">{address}</div>
    </div>
  );
}

/** The shares added up: fine at 100, flagged otherwise. */
function OwnersTotal({ owners }: { owners: FormationOwner[] }) {
  const t = useTone();
  const total = ownersTotal(owners);
  const ok = total === 100;
  return (
    <div className={`flex items-center justify-end gap-2 px-1 text-[12.5px] tabular-nums ${ok ? t.muted : t.dark ? "text-amber-300" : "text-amber-700"}`}>
      {ok ? <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2} /> : null}
      <span>
        Total {total}%{ok ? "" : `, ${total < 100 ? `${Math.round((100 - total) * 100) / 100}% left to assign` : `${Math.round((total - 100) * 100) / 100}% over`}`}
      </span>
    </div>
  );
}

function PersonRow({ first, last, onChange, onRemove, extra, below }: { first: string; last: string; onChange: (first: string, last: string) => void; onRemove?: () => void; extra?: ReactNode; below?: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="First name" className="min-w-[140px] flex-1">
          <Input value={first} onChange={(e) => onChange(e.target.value, last)} autoComplete="off" />
        </Field>
        <Field label="Last name" className="min-w-[140px] flex-1">
          <Input value={last} onChange={(e) => onChange(first, e.target.value)} autoComplete="off" />
        </Field>
        <div className="flex h-8 items-center gap-2 max-sm:h-[44px]">
          {extra}
          {onRemove && <IconButton icon="x" label="Remove" onClick={onRemove} />}
        </div>
      </div>
      {below}
    </div>
  );
}

function Choice({ on, onPick, title, text }: { on: boolean; onPick: () => void; title: string; text: string }) {
  const t = useTone();
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPick}
      className={`cursor-pointer rounded-xl border p-3.5 text-left transition-colors ${
        on ? (t.dark ? "border-[#818cf8]/60 bg-[#818cf8]/10" : "border-[#4f46e5]/50 bg-[#4f46e5]/5") : `${t.line} ${t.hover}`
      }`}
    >
      <span className={`block text-[13px] font-semibold ${t.text}`}>{title}</span>
      <span className={`mt-0.5 block text-[12px] ${t.muted}`}>{text}</span>
    </button>
  );
}

function Pill({ on, onPick, children }: { on: boolean; onPick: () => void; children: ReactNode }) {
  const t = useTone();
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPick}
      className={`inline-flex h-8 cursor-pointer items-center rounded-full border px-3 text-[12.5px] font-medium transition-colors max-sm:h-[40px] ${
        on ? (t.dark ? "border-white/20 bg-white/[0.1] text-white" : "border-gray-900 bg-gray-900 text-white") : `${t.line} ${t.soft} ${t.hover}`
      }`}
    >
      {children}
    </button>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  const t = useTone();
  return (
    <>
      <dt className={t.muted}>{label}</dt>
      <dd className={`min-w-0 break-words ${t.text}`}>{value || "—"}</dd>
    </>
  );
}
