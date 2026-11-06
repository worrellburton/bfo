/**
 * The Entities page's dialogs: add an existing entity, change an owner on
 * record, edit an entity's initials, Palm's monitor-and-verify plan, and
 * what a Palm run found. Each is a system Dialog (a bottom sheet on phones);
 * billed steps confirm with their price (§11.3) before anything runs.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { authFetch } from "../auth";
import { entityType, paperworkChecks, TAX_CLASSES, type EntityType } from "../entity-paperwork";
import { US_STATES } from "../formation";
import { Banner, Button, ChoiceTiles, confirm, DateInput, Dialog, Field, Input, Segmented, Select, Skeleton, Status, format, toast, type Tone } from "../ui";
import { defaultClass, formatEin, ownersOf, paperOf, sameName, taxLabel, taxLine, TYPE_LABEL, type EntityRec } from "./assets-model";

/** Write one entity's record through the shared tree; the server's refusal reads as a sentence. */
async function writeAsset(id: string, patch: Record<string, unknown>) {
  const { db, ref, update } = await import("../store");
  await update(ref(db, `assets/${id}`), patch);
}

const today = () => format.isoDate(new Date());

// ── Add an existing entity ───────────────────────────────────────────────

const TYPES: { value: EntityType; label: string }[] = [
  { value: "LLC", label: "LLC" },
  { value: "C-Corp", label: "Corporation" },
  { value: "LP", label: "LP" },
  { value: "Trust", label: "Trust" },
];

export function NewEntityDialog({
  open,
  onClose,
  entities,
  onFormWithPalm,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  entities: EntityRec[];
  /** Hand off to the Palm formation wizard: a brand-new entity, filed with the state. */
  onFormWithPalm: () => void;
  onCreated: (id: string, name: string) => void;
}) {
  // The state most entities are formed in is the likely one.
  const usual = useMemo(() => {
    const n = new Map<string, number>();
    for (const e of entities) {
      const s = US_STATES.find(([abbr, name]) => [abbr.toLowerCase(), name.toLowerCase()].includes((e.state ?? "").trim().toLowerCase()))?.[1];
      if (s) n.set(s, (n.get(s) ?? 0) + 1);
    }
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }, [entities]);
  const [type, setType] = useState<EntityType>("LLC");
  const [name, setName] = useState("");
  const [state, setState] = useState<string | null>(usual);
  const [formed, setFormed] = useState<string | null>(null);
  const [ein, setEin] = useState("");
  const [ownerId, setOwnerId] = useState<string>("");
  const [revocable, setRevocable] = useState<"revocable" | "irrevocable" | null>(null);
  const [taxClass, setTaxClass] = useState<string>("");
  const [touchedClass, setTouchedClass] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setType("LLC");
    setName("");
    setState(usual);
    setFormed(null);
    setEin("");
    setOwnerId("");
    setRevocable(null);
    setTaxClass("");
    setTouchedClass(false);
    setTried(false);
    setError("");
  }, [open, usual]);

  // The IRS default, until someone picks a class themselves.
  const suggested = defaultClass(type, type === "LLC" ? (ownerId ? "one" : null) : null, type === "Trust" ? (revocable ? revocable === "revocable" : null) : null);
  useEffect(() => {
    if (!touchedClass) setTaxClass(suggested);
  }, [suggested, touchedClass]);

  const twin = name.trim() ? entities.find((e) => sameName(e.name, name)) : undefined;
  const digits = ein.replace(/\D/g, "");
  const einError = !ein.trim()
    ? ""
    : format.looksLikeSsn(ein)
      ? "That looks like a Social Security number. An EIN is written 12-3456789."
      : digits.length !== 9
        ? "An EIN is 9 digits, written 12-3456789."
        : (() => {
            const other = entities.find((e) => (e.ein ?? "").replace(/\D/g, "") === digits);
            return other ? `This EIN is already ${other.name}'s.` : "";
          })();
  const nameError = tried && !name.trim() ? "Add a name" : "";
  const isTrust = type === "Trust";

  async function submit() {
    setTried(true);
    if (!name.trim() || einError || busy) return;
    setBusy(true);
    setError("");
    try {
      const { db, ref, push } = await import("../store");
      const rec: Record<string, unknown> = {
        name: name.trim(),
        type,
        state: state ?? "",
        ein: digits.length === 9 ? formatEin(digits) : "",
        createdAt: Date.now(),
        ...(formed ? { formationDate: formed } : {}),
        ...(ownerId && !isTrust ? { ownerId, ownerEffective: formed ?? today() } : {}),
        ...(taxClass ? { llcType: taxClass, llcTypeSource: "Entered by hand" } : {}),
      };
      const child = await push(ref(db, "assets"), rec);
      onCreated(child.key ?? "", name.trim());
    } catch (err) {
      setError((err as Error).message || "Couldn't add the entity. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const owners = entities.filter((e) => e.id).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add an existing entity"
      description="Record an entity that's already formed. Its documents, owners and filings go on its page."
      dirty={!!(name || ein)}
      footer={
        <>
          <Button variant="quiet" className="sm:mr-auto" onClick={onFormWithPalm}>
            Form a new one with Palm instead
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} busyLabel="Adding…" onClick={() => void submit()}>
            Add to records
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Segmented label="Legal form" value={type} onChange={setType} options={TYPES} full />
        <Field label="Legal name" error={nameError} hint={twin ? `${twin.name} is already on record.` : isTrust ? "As written in the trust agreement." : "As it appears on the state's record."}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        {isTrust && (
          <ChoiceTiles
            label="Revocable or irrevocable?"
            value={revocable}
            onChange={setRevocable}
            stacked
            options={[
              { value: "revocable", title: "Revocable", description: "A grantor trust while the grantors live; it reports under their SSN." },
              { value: "irrevocable", title: "Irrevocable", description: "Usually its own taxpayer, with an EIN, filing Form 1041." },
            ]}
          />
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={isTrust ? "Governing law" : "State of formation"} optional>
            <Select label={isTrust ? "Governing law" : "State of formation"} value={state} onChange={setState} options={US_STATES.map(([abbr, n]) => ({ value: n, label: n, hint: abbr }))} />
          </Field>
          <Field label={isTrust ? "Trust date" : "Formation date"} optional hint={isTrust ? undefined : "Annual-report due dates are set from it."}>
            <DateInput value={formed} onChange={setFormed} />
          </Field>
        </div>
        <Field label="EIN" optional error={einError || undefined} hint={isTrust && revocable === "revocable" ? "A revocable trust uses the grantor's SSN; leave this blank." : undefined}>
          <Input value={ein} onChange={(e) => setEin(formatEin(e.target.value))} inputMode="numeric" placeholder="12-3456789" autoComplete="off" className={ein ? "font-mono" : undefined} />
        </Field>
        {!isTrust && (
          <Field label="Owned by" optional hint="One of the family's entities. Record other owners and their shares on its Owners tab.">
            <Select
              label="Owned by"
              value={ownerId || null}
              placeholder="Not one of the family's entities"
              onChange={setOwnerId}
              options={[{ value: "", label: "Not one of the family's entities" }, ...owners.map((o) => ({ value: o.id, label: o.name }))]}
            />
          </Field>
        )}
        <Field
          label="Tax classification"
          optional
          hint={suggested ? `IRS default: ${taxLabel(suggested)}.` : isTrust ? "Choose revocable or irrevocable for the default." : "One owner: disregarded. Two or more: a partnership."}
        >
          <Select
            label="Tax classification"
            value={taxClass || null}
            onChange={(v) => {
              setTouchedClass(true);
              setTaxClass(v);
            }}
            options={TAX_CLASSES[type].map((c) => ({ value: c, label: taxLabel(c) }))}
          />
        </Field>
        {error && <Banner tone="negative">{error}</Banner>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// ── Change an owner ──────────────────────────────────────────────────────

/** Every entity this one owns, at any depth: none of them can own it. */
function beneath(id: string, all: EntityRec[]): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of all) if (e.ownerId === cur && !out.has(e.id) && e.id !== id) (out.add(e.id), stack.push(e.id));
  }
  return out;
}

export function OwnerDialog({
  entity,
  proposed,
  all,
  onClose,
}: {
  /** The entity whose owner is changing (null: closed). */
  entity: EntityRec | null;
  /** A new owner already chosen (a drag on the map); "" for none. */
  proposed?: string;
  all: EntityRec[];
  onClose: () => void;
}) {
  const byId = useMemo(() => new Map(all.map((e) => [e.id, e])), [all]);
  const [to, setTo] = useState<string>("");
  const [effective, setEffective] = useState<string | null>(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!entity) return;
    setTo(proposed ?? entity.ownerId ?? "");
    setEffective(today());
    setError("");
  }, [entity, proposed]);
  if (!entity) return <Dialog open={false} onClose={onClose} title="" />;

  const banned = beneath(entity.id, all);
  const options = [
    { value: "", label: "Not one of the family's entities" },
    ...all
      .filter((e) => e.id !== entity.id && !banned.has(e.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => ({ value: e.id, label: e.name, hint: TYPE_LABEL[entityType(e)] })),
  ];
  const from = entity.ownerId && byId.get(entity.ownerId) ? byId.get(entity.ownerId)!.name : "Not recorded";
  const next = { ...entity, ownerId: to || undefined };
  const nextAll = new Map(byId).set(entity.id, next);
  const before = new Set(paperworkChecks(paperOf(entity, byId)).map((c) => c.key));
  const fresh = paperworkChecks(paperOf(next, nextAll)).filter((c) => !before.has(c.key) && (c.severity === "high" || c.severity === "medium"));
  const ret = { was: taxLine(entity, byId).files, now: taxLine(next, nextAll).files };
  const others = ownersOf(entity, byId).filter((o) => o.entityId !== entity.ownerId);
  const changed = (entity.ownerId ?? "") !== to;

  async function save() {
    if (!entity || !changed || busy) return;
    setBusy(true);
    setError("");
    const prev = { ownerId: entity.ownerId ?? "", ownerEffective: entity.ownerEffective ?? null };
    try {
      await writeAsset(entity.id, { ownerId: to, ownerEffective: effective });
      const name = entity.name;
      const owner = to ? (byId.get(to)?.name ?? "another entity") : null;
      toast({
        message: owner ? `Recorded ${name} as owned by ${owner}` : `Recorded ${name} with no family owner`,
        action: { label: "Undo", run: () => void writeAsset(entity.id, prev).catch(() => toast({ message: "Couldn't undo. Change the owner back on the entity page." })) },
      });
      onClose();
    } catch (err) {
      setError((err as Error).message || "Couldn't save the owner. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Change owner: ${entity.name}`}
      description={`Now: ${from}${entity.ownerEffective ? `, effective ${format.date(entity.ownerEffective, "medium")}` : ""}.`}
      dirty={changed}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} busyLabel="Saving…" disabled={!changed} disabledReason={changed ? undefined : "Choose a different owner"} onClick={() => void save()}>
            Record new owner
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="New owner" hint={changed ? undefined : "Choose the entity that owns it now."}>
          <Select label="New owner" value={to} onChange={setTo} options={options} footnote={banned.size ? `Entities that ${entity.name} owns can't own it.` : undefined} />
        </Field>
        <Field label="Effective date" hint="The date the interest was assigned. It sets when the change counts for tax.">
          <DateInput value={effective} onChange={setEffective} />
        </Field>
        {changed && ret.was !== ret.now && (ret.was || ret.now) && (
          <p className="text-body text-ink-2">
            Its return: {ret.was ?? "not known"} → <span className="text-ink">{ret.now ?? "not known"}</span>.
          </p>
        )}
        {changed && fresh.length > 0 && (
          <Banner tone="warning" title="The records would disagree">
            <ul className="flex flex-col gap-1">
              {fresh.map((c) => (
                <li key={c.key}>{c.title}</li>
              ))}
            </ul>
          </Banner>
        )}
        {others.length > 0 && (
          <p className="text-small text-ink-2">Other owners on record stay as they are: {format.list(others.map((o) => o.name))}. Change shares on the entity&apos;s Owners tab.</p>
        )}
        <p className="text-small text-pretty text-ink-2">
          This changes BFO&apos;s record only. A transfer of ownership needs a signed assignment and any consents the operating agreement requires. Keep the signed assignment in the entity&apos;s
          Documents.
        </p>
        {error && <Banner tone="negative">{error}</Banner>}
      </div>
    </Dialog>
  );
}

// ── Initials ─────────────────────────────────────────────────────────────

export function InitialsDialog({
  entity,
  current,
  check,
  onClose,
  onSaved,
}: {
  entity: EntityRec | null;
  current: string;
  /** Why these initials can't be used (another entity has them), or null. */
  check: (raw: string) => string | null;
  onClose: () => void;
  onSaved: (initials: string) => void;
}) {
  const [draft, setDraft] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft(current);
    setError("");
  }, [entity, current]);
  const clash = check(draft);
  async function save() {
    if (!entity || clash || busy) return;
    setBusy(true);
    try {
      const initials = draft.trim().toUpperCase();
      await writeAsset(entity.id, { initials });
      onSaved(initials);
      onClose();
    } catch (err) {
      setError((err as Error).message || "Couldn't save the initials. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={!!entity}
      onClose={onClose}
      size="sm"
      title={entity ? `Initials: ${entity.name}` : "Initials"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} busyLabel="Saving…" onClick={() => void save()}>
            Save initials
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="flex flex-col gap-4"
      >
        <Field label="Initials" error={clash ?? error ?? undefined} hint="Up to 4 letters. Books shows them beside each transaction, so each entity needs its own.">
          <Input value={draft} onChange={(e) => setDraft(e.target.value.toUpperCase().slice(0, 4))} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// ── Palm: monitor and verify ─────────────────────────────────────────────

export type PalmMode = "test" | "live";
export type PalmChecksPlan = { mode: PalmMode; monitor: { count: number; cents: number; on: number; unidentified: number }; ein: { count: number; cents: number; settled: number } };

const MONITOR_CENTS = 199;
const EIN_CENTS = 99;

export function PalmChecksDialog({
  open,
  onClose,
  onRun,
}: {
  open: boolean;
  onClose: () => void;
  /** Start one of the two, once confirmed. */
  onRun: (action: "monitor-all" | "ein-all", plan: PalmChecksPlan) => void;
}) {
  const [plan, setPlan] = useState<PalmChecksPlan | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setPlan(null);
    setError("");
    void (async () => {
      try {
        const r = await authFetch("/api/palm-sync", { method: "POST", body: JSON.stringify({ action: "plan" }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.message || "Couldn't reach Palm.");
        if (live) setPlan(j);
      } catch (err) {
        if (live) setError((err as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [open, tick]);

  async function watch(p: PalmChecksPlan) {
    const live = p.mode === "live";
    const monthly = p.monitor.cents || p.monitor.count * MONITOR_CENTS;
    const ok = await confirm({
      title: `Start watching ${format.count(p.monitor.count, "registration")}?`,
      message: live
        ? `Palm bills each one monthly from today until it's turned off, about ${format.money((monthly * 12) / 100)} a year for all of them. Turn any off on its entity's Compliance tab.`
        : "Palm is in test mode: nothing is billed, and the alerts come from its sandbox.",
      receipt: { lines: [{ label: `${format.count(p.monitor.count, "registration")} × ${format.money(MONITOR_CENTS / 100)} a month`, cents: live ? monthly : 0 }], mode: live ? "live" : "test" },
      details: ["Billed to the office's Palm account; each entity's share is logged against it."],
      confirmLabel: live ? `Watch for ${format.money(monthly / 100)} a month` : "Start watching",
      tone: "commit",
    });
    if (ok) onRun("monitor-all", p);
  }
  async function check(p: PalmChecksPlan) {
    const live = p.mode === "live";
    const cents = p.ein.cents || p.ein.count * EIN_CENTS;
    const ok = await confirm({
      title: `Check ${format.count(p.ein.count, "EIN")} with the IRS?`,
      message: "Each EIN and its legal name are sent to Palm, which checks them with the IRS. An EIN already confirmed isn't checked again.",
      receipt: { lines: [{ label: `${format.count(p.ein.count, "EIN")} × ${format.money(EIN_CENTS / 100)}`, cents: live ? cents : 0 }], mode: live ? "live" : "test" },
      confirmLabel: live ? `Check for ${format.money(cents / 100)}` : "Check EINs",
      tone: "commit",
    });
    if (ok) onRun("ein-all", p);
  }

  const section = (title: string, text: React.ReactNode, action: React.ReactNode) => (
    <div className="flex flex-col gap-3 border-t border-line py-4 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:gap-6">
      <div className="min-w-0 flex-1">
        <h3 className="text-body font-semibold text-ink">{title}</h3>
        <div className="mt-1 text-body text-pretty text-ink-2">{text}</div>
      </div>
      <div className="flex shrink-0 sm:w-[160px] sm:justify-end">{action}</div>
    </div>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Monitor and verify with Palm"
      description={plan?.mode === "test" ? "Palm is in test mode: nothing is billed." : undefined}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {error ? (
        <Banner
          tone="negative"
          action={
            <Button variant="quiet" size="sm" onClick={() => setTick((n) => n + 1)}>
              Try again
            </Button>
          }
        >
          {error}
        </Banner>
      ) : !plan ? (
        <Skeleton kind="rows" rows={4} />
      ) : (
        <div className="flex flex-col">
          {section(
            "Watch every registration",
            <>
              <p>Palm tells you when a state&apos;s record changes, and when a filing comes due or goes overdue.</p>
              <p className="mt-2">
                {format.count(plan.monitor.count + plan.monitor.on + plan.monitor.unidentified, "registration")} on record: {plan.monitor.count} ready to watch
                {plan.monitor.on ? `, ${plan.monitor.on} already watched` : ""}
                {plan.monitor.unidentified ? `, and ${plan.monitor.unidentified} more that need a file number first (sync state records to read it)` : ""}.
              </p>
              {plan.mode === "live" && <p className="mt-2">{format.money(MONITOR_CENTS / 100)} a month each while on.</p>}
            </>,
            <Button disabled={!plan.monitor.count} disabledReason={plan.monitor.count ? undefined : "Nothing left to watch"} onClick={() => void watch(plan)}>
              Watch {plan.monitor.count}…
            </Button>,
          )}
          {section(
            "Check every EIN with the IRS",
            <>
              <p>Each EIN and its legal name are sent to Palm, which checks them with the IRS.</p>
              <p className="mt-2">
                {plan.ein.count ? `${format.count(plan.ein.count, "EIN")} to check` : "Nothing to check"}
                {plan.ein.settled ? `, ${plan.ein.settled} already confirmed` : ""}.{plan.mode === "live" ? ` ${format.money(EIN_CENTS / 100)} each, once.` : ""}
              </p>
            </>,
            <Button disabled={!plan.ein.count} disabledReason={plan.ein.count ? undefined : "Nothing to check"} onClick={() => void check(plan)}>
              Check {plan.ein.count}…
            </Button>,
          )}
        </div>
      )}
    </Dialog>
  );
}

// ── What a Palm run found ────────────────────────────────────────────────

export type PalmRunResult = { id: string; name: string; lines: { label: string; tone: "good" | "warn" | "bad" | "muted"; text: string }[] };

const TONE: Record<PalmRunResult["lines"][number]["tone"], Tone> = { good: "positive", warn: "warning", bad: "negative", muted: "neutral" };

export function PalmResultsDialog({ run, onClose }: { run: { title: string; results: PalmRunResult[]; error?: string; mode?: PalmMode } | null; onClose: () => void }) {
  return (
    <Dialog
      open={!!run}
      onClose={onClose}
      size="lg"
      title={run ? (run.error ? `${run.title}: didn't finish` : `${run.title}: ${format.count(run.results.length, "entity", "entities")}`) : ""}
      description={run?.mode === "test" ? "Test mode: nothing was billed, and the records came from Palm's sandbox." : undefined}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {run?.error && <Banner tone="negative">{run.error}</Banner>}
      <ul className="flex flex-col">
        {run?.results.map((e) => (
          <li key={e.id} className="border-t border-line py-3 first:border-t-0 first:pt-0">
            <Link to={`/assets/${e.id}`} className="text-body font-medium text-ink hover:underline">
              {e.name}
            </Link>
            <ul className="mt-1 flex flex-col gap-1">
              {e.lines.map((l, i) => (
                <li key={i} className="flex items-start gap-2 text-small text-ink-2">
                  <Status tone={TONE[l.tone]} className="shrink-0">
                    {l.label}
                  </Status>
                  <span className="min-w-0">{l.text}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
