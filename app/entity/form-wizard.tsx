import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getUser, isAdmin } from "../auth";
import { entityType as recordType } from "../entity-paperwork";
import {
  activityQuestions,
  addressLine,
  articlesStatement,
  asksMarried,
  ATTESTATION_VERSION,
  CORPORATION_SUBTYPES,
  DEFAULT_PURPOSE,
  DEFAULT_PURPOSE_CORP,
  draftProblems,
  EIN_ACTIVITIES,
  EIN_REASONS,
  einMemberCount,
  effectiveDateProblem,
  electionDeadline,
  EMPTY_ADDRESS,
  EMPTY_NAME,
  emptyDraft,
  emptyEin,
  emptyOfficer,
  emptyOfficial,
  emptyOwner,
  emptyParty,
  emptyStockClass,
  expectedCosts,
  feeFoots,
  feeLabel,
  filersKey,
  fiscalYearFollowsOwners,
  hasName,
  hostState,
  isPersonFiling,
  looksLikeMailbox,
  MAX_DELAY_DAYS,
  num,
  OFFICER_ROLES,
  officeAddress,
  organizationalCostNote,
  ownerFilingName,
  ownerName,
  ownerPercent,
  ownersTotal,
  parentOwnerId,
  parseAddress,
  personName,
  responsibleIsSomeoneElse,
  sameAddress,
  signerProblems,
  ss4Statement,
  stateName,
  stateQuestionCopy,
  taxOutcome,
  todayIso,
  US_STATES,
  type ActivityQuestion,
  type DraftProblem,
  type FieldRule,
  type FilingAttestation,
  type FormationAddress,
  type FormationDraft,
  type FormationEin,
  type FormationOfficer,
  type FormationOfficial,
  type FormationOwner,
  type FormationParty,
  type FormationState,
  type PersonName,
  type StateRules,
  type StepKey,
} from "../formation";
import { isSsnIssue, redactDraft, validationDraft } from "../../lib/palm-formation";
import { PALM_PRICES } from "../../lib/palm-pricing";
import { palmCall, PalmUnavailable, type PalmMode } from "../palm";
import { pushId } from "../store";
import {
  Banner,
  Button,
  Card,
  CardSection,
  Checkbox,
  ChoiceTiles,
  confirm,
  cx,
  DateInput,
  Disclosure,
  Field,
  format,
  Icon,
  IconButton,
  Input,
  Menu,
  MoneyInput,
  Row,
  Rows,
  Segmented,
  Select,
  Sheet,
  Status,
  Textarea,
  toast,
  useMedia,
  usePhone,
  type Option,
} from "../ui";

/**
 * Forming a new entity through Palm. Every field Palm's formation request
 * takes is here, LLC or corporation: the name (checked with the state on
 * request), the business and its addresses, who owns it and how much (an
 * LLC's managers; a corporation's stock, directors and officers), who signs
 * the articles, the registered agent, how it's taxed, and the EIN
 * application with every follow-up the IRS asks. What a state requires on
 * top comes from Palm's requirement schema and is asked where it belongs.
 *
 * It's a full-screen sheet (docs/DESIGN.md §8.19): the steps down the left
 * from 1024px, the public filing taking shape on the right from 1280px.
 * The draft is kept in this browser for the person filing as they go, with
 * every SSN removed, so closing it loses nothing but the SSNs. Nothing is
 * filed until the review step's statements are made and its commit confirm
 * is answered; an SSN leaves the browser only with that filing.
 */

type ExtraField = { key: string; label: string; description: string | null; type: "string" | "number" | "boolean" | "enum"; options: string[]; required: boolean };
type Requirements = { supported: boolean; expeditedTiers: string[]; extra: ExtraField[]; rules: StateRules };
type NameCheck = { eligible: boolean; compliant: boolean; available: boolean; violations: { severity: string; message: string }[]; alternatives: string[] };
type Fee = { total: number | null; currency: string; items: { kind: string; name: string; amount: number }[]; expeditedTiers: { tier: string; amount: number }[]; note?: string };
type Issue = { field: string | null; message: string };
type Validation = { ok: boolean; errors: Issue[]; warnings?: Issue[]; skipped?: boolean };
type Entities = { id: string; name: string; address?: string; type?: string }[];
type Me = { id: string; name: string; email: string; phone: string } | null;

const TIER_LABEL: Record<string, string> = { expedited: "Expedited", "24_hour": "24 hours", same_day: "Same day", "3_hour": "3 hours", "2_hour": "2 hours", "1_hour": "1 hour" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pretty = (v: string) => v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const money = (n: number, currency = "USD") => format.money(n, { currency });
const isJurisdiction = (j: string) => /^US-[A-Z]{2}$/.test(j);

type StepMeta = { key: StepKey; label: (llc: boolean) => string; title: (c: { llc: boolean; state: string }) => string; lede: (c: { llc: boolean; state: string }) => string };

const STEPS: StepMeta[] = [
  { key: "entity", label: () => "Entity", title: () => "What are we forming?", lede: () => "The kind of entity, the state that forms it, and its name." },
  { key: "business", label: () => "Business", title: () => "Where it does business", lede: () => "Its principal office, how the state reaches it, and what it's for." },
  {
    key: "ownership",
    label: () => "Ownership",
    title: ({ llc }) => (llc ? "Who owns it, and who runs it" : "Shares, shareholders and the board"),
    lede: ({ llc }) =>
      llc
        ? "The members and their shares. BFO drafts an operating agreement from this list for your counsel to review."
        : "The stock the articles authorize, who holds it, and the first directors and officers.",
  },
  {
    key: "filers",
    label: (llc) => (llc ? "Organizer" : "Incorporator"),
    title: ({ llc }) => (llc ? "Organizer" : "Incorporator"),
    lede: () => "The person who signs the articles. Their name and address appear on the public record.",
  },
  { key: "agent", label: () => "Agent", title: () => "Registered agent", lede: ({ state }) => `Who accepts legal papers for it in ${state || "the state"}.` },
  { key: "ein", label: () => "Tax", title: () => "Tax and EIN", lede: () => "How the IRS will treat it, and whether Palm applies for its federal tax number." },
  { key: "state", label: () => "State", title: ({ state }) => `What ${state || "the state"} asks`, lede: () => "" },
  { key: "review", label: () => "Review", title: () => "Review and file", lede: () => "What the state will publish, what goes only to Palm, what stays in BFO, and what it costs." },
];

// ── The saved draft ──────────────────────────────────────────────────────

/** Kept in this browser, per person, as they go; never an SSN (redactDraft). */
type Saved = {
  v: 1;
  savedAt: number;
  draft: FormationDraft;
  step: StepKey;
  reached: number;
  checks: [string, NameCheck][];
  billed: number;
  idempotencyKey: string;
  assetId: string;
};

const storeKey = (userId: string) => `bfo-formation-draft:${userId}`;

function readSaved(userId: string | undefined): Saved | null {
  if (!userId) return null;
  try {
    const s = JSON.parse(window.localStorage.getItem(storeKey(userId)) ?? "null") as Saved | null;
    return s && s.v === 1 && s.draft ? s : null;
  } catch {
    return null;
  }
}

function writeSaved(userId: string | undefined, s: Saved): boolean {
  if (!userId) return false;
  try {
    window.localStorage.setItem(storeKey(userId), JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

function clearSaved(userId: string | undefined) {
  if (!userId) return;
  try {
    window.localStorage.removeItem(storeKey(userId));
  } catch {
    /* nothing to clear */
  }
}

/** A saved draft from an older version, filled out with today's fields. */
function upgrade(d: FormationDraft): FormationDraft {
  const base = emptyDraft();
  return {
    ...base,
    ...d,
    payer: { ...base.payer, ...(d.payer ?? {}) },
    owners: (d.owners ?? []).map((o) => ({ ...emptyOwner(o.kind), ...o })),
    organizers: (d.organizers ?? []).map((o) => ({ ...emptyParty(o.title), ...o })),
    agent: d.agent?.provider === "own" ? { ...d.agent, consent: !!d.agent.consent } : { provider: "palm" },
    ein: d.ein ? { ...emptyEin(), ...d.ein } : null,
  };
}

/** A fresh draft: the person filing as the contact and the organizer, the office as the principal office, and one owner row to fill. */
function freshDraft(me: Me, office: FormationAddress | null, entities: Entities): FormationDraft {
  const d = emptyDraft();
  if (office) d.principal = { ...office };
  d.contact = { name: me?.name ?? "", email: me?.email ?? "", phone: me?.phone ?? "" };
  const [first = "", ...rest] = (me?.name ?? "").trim().split(/\s+/);
  d.organizers = [emptyParty("Organizer", { first, last: rest.join(" ") })];
  if (entities.length) d.owners = [emptyOwner("entity", "100")];
  return d;
}

// ── The wizard ───────────────────────────────────────────────────────────

export function FormEntityWizard({
  open,
  onClose,
  entities,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** Existing entities: owners to pick from, and (from their addresses) the family's office. */
  entities: Entities;
  onCreated: (assetId: string) => void;
}) {
  if (!open) return null;
  return <Wizard onClose={onClose} entities={entities} onCreated={onCreated} />;
}

function Wizard({ onClose, entities, onCreated }: { onClose: () => void; entities: Entities; onCreated: (assetId: string) => void }) {
  const user = getUser();
  const me: Me = user ? { id: user.id, name: user.name ?? "", email: user.email ?? "", phone: user.phone ?? "" } : null;
  const phone = usePhone();
  const wide = useMedia("(width >= 80rem)");
  const [office] = useState(() => officeAddress(entities.map((e) => e.address)));
  const [saved] = useState(() => readSaved(me?.id));
  const [restored, setRestored] = useState(!!saved);
  const [draft, setDraft] = useState<FormationDraft>(() => (saved ? upgrade(saved.draft) : freshDraft(me, office, entities)));
  const [stepAt, setStepAt] = useState(() =>
    Math.max(
      0,
      STEPS.findIndex((s) => s.key === saved?.step),
    ),
  );
  const [reached, setReached] = useState(saved?.reached ?? 0);
  const [mode, setMode] = useState<PalmMode | null | "off">(null);
  const [requirements, setRequirements] = useState<Requirements | null>(null);
  const [nameCheck, setNameCheck] = useState<NameCheck | null | "checking">(null);
  const nameChecks = useRef(new Map<string, NameCheck>(saved?.checks ?? []));
  const [billed, setBilled] = useState(saved?.billed ?? 0);
  const [fee, setFee] = useState<Fee | null>(null);
  const [validation, setValidation] = useState<Validation | null | "checking">(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [attest, setAttest] = useState({ articles: false, ss4: false });
  /** One key per attempt at this filing, kept with the draft, so a retry after a dropped connection never files twice. */
  const [idempotencyKey] = useState(() => saved?.idempotencyKey ?? crypto.randomUUID());
  const [assetId] = useState(() => saved?.assetId ?? pushId());
  const [storable, setStorable] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const set = (patch: Partial<FormationDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const llc = draft.entityType === "llc";
  const state = stateName(draft.jurisdiction);
  const region = draft.jurisdiction.slice(3);
  const rules = useMemo(() => requirements?.rules ?? {}, [requirements]);
  const extras = useMemo(() => requirements?.extra ?? [], [requirements]);
  const problems = useMemo(() => draftProblems(draft, rules, extras), [draft, rules, extras]);
  const signers = useMemo(() => signerProblems(draft, me), [draft, me?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const canFile = isAdmin(user);

  const steps = STEPS.filter((s) => s.key !== "state" || extras.length > 0);
  const step = Math.min(stepAt, steps.length - 1);
  const here = steps[step];
  const last = step === steps.length - 1;
  const problemsAt = (k: StepKey) => [...problems, ...signers].filter((p) => p.step === k);
  const stepProblems = problems.filter((p) => p.step === here.key);
  const started = !!(draft.legalName.trim() || draft.jurisdiction);

  // Palm's mode decides what the confirm says, and whether name checks are billed.
  useEffect(() => {
    palmCall<{ configured: boolean; mode: PalmMode | null }>("status")
      .then((s) => setMode(s.configured ? s.mode : "off"))
      .catch(() => setMode("off"));
  }, []);

  // What the state asks for, whenever the state or type changes.
  useEffect(() => {
    if (!isJurisdiction(draft.jurisdiction)) {
      setRequirements(null);
      return;
    }
    let live = true;
    setRequirements(null);
    palmCall<Requirements>("form-requirements", { jurisdiction: draft.jurisdiction, entityType: draft.entityType })
      .then((r) => live && setRequirements({ ...r, rules: r.rules ?? {} }))
      .catch((err) => live && setError(err instanceof PalmUnavailable ? "Forming entities isn't set up yet. Ask the office's admin." : (err as Error).message));
    return () => {
      live = false;
    };
  }, [draft.jurisdiction, draft.entityType]);

  // Once the state's schema is in: whether its filing asks for the members, and the known elections' starting answers.
  useEffect(() => {
    if (!requirements) return;
    setDraft((d) => {
      const membersRequired = !!requirements.rules.initial_governing_persons?.required;
      const presets = Object.fromEntries(
        requirements.extra.map((f) => [f.key, stateQuestionCopy(f, stateName(d.jurisdiction)).preset] as const).filter(([k, v]) => v !== undefined && d.extra[k] === undefined),
      );
      if (d.membersRequired === membersRequired && !Object.keys(presets).length) return d;
      return { ...d, membersRequired, extra: { ...d.extra, ...presets } };
    });
  }, [requirements]);

  // A known name's result comes back at once; anything else waits for "Check with the state" (each check is billed).
  useEffect(() => {
    const key = `${draft.jurisdiction}|${draft.entityType}|${draft.legalName.trim().toLowerCase()}`;
    setNameCheck(nameChecks.current.get(key) ?? null);
  }, [draft.legalName, draft.jurisdiction, draft.entityType]);

  // The price, as soon as there's a state.
  const extraKey = JSON.stringify(draft.extra);
  useEffect(() => {
    if (!isJurisdiction(draft.jurisdiction)) {
      setFee(null);
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      palmCall<Fee>("form-fee", { jurisdiction: draft.jurisdiction, entityType: draft.entityType, expeditedTier: draft.expeditedTier, extra: draft.extra })
        .then((f) => live && setFee(f))
        .catch(() => live && setFee({ total: null, currency: "USD", items: [], expeditedTiers: [], note: "Couldn't price the filing. Try again in a moment." }));
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.jurisdiction, draft.entityType, draft.expeditedTier, extraKey]);

  // The review step asks Palm to check the filing, filing nothing. No SSN goes with it: Palm's notes about them are set aside.
  const reviewing = here.key === "review";
  useEffect(() => {
    if (!reviewing || problems.length) return;
    let live = true;
    setValidation("checking");
    const timer = window.setTimeout(() => {
      palmCall<Validation>("form-validate", { draft: validationDraft(draft) })
        .then((v) => {
          if (!live) return;
          const errors = v.errors.filter((x) => !isSsnIssue(x));
          setValidation({ ...v, ok: v.ok || errors.length === 0, errors, warnings: (v.warnings ?? []).filter((x) => !isSsnIssue(x)) });
        })
        .catch((err) => live && setValidation({ ok: false, errors: [{ field: null, message: (err as Error).message }] }));
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [reviewing, draft, problems.length]);

  // Kept as it's typed, without SSNs.
  useEffect(() => {
    if (!started || submitting) return;
    const t = window.setTimeout(() => {
      const ok = writeSaved(me?.id, snapshot());
      setStorable(ok);
    }, 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, here.key, reached, billed, started, submitting]);

  // A new step: back to its top, and focus on its title so it's announced.
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    scroller.current?.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [step]);

  function go(i: number) {
    const next = Math.max(0, Math.min(i, steps.length - 1));
    setStepAt(next);
    setReached((r) => Math.max(r, next));
  }

  const snapshot = (): Saved => ({ v: 1, savedAt: Date.now(), draft: redactDraft(draft), step: here.key, reached, checks: [...nameChecks.current], billed, idempotencyKey, assetId });

  function leave() {
    if (submitting) return;
    // The last keystrokes may still be waiting on the debounce: keep them now.
    if (started && storable && !writeSaved(me?.id, snapshot())) setStorable(false);
    if (started && storable) {
      const ssn = JSON.stringify(draft) !== JSON.stringify(redactDraft(draft));
      toast({ message: ssn ? "Saved as a draft. SSNs aren't kept: enter them again when you come back." : "Saved as a draft" });
    }
    onClose();
  }

  function startOver() {
    const before = { draft, step, reached };
    clearSaved(me?.id);
    setDraft(freshDraft(me, office, entities));
    setStepAt(0);
    setReached(0);
    setRestored(false);
    toast({
      message: "Started over",
      action: {
        label: "Undo",
        run: () => {
          setDraft(before.draft);
          setStepAt(before.step);
          setReached(before.reached);
        },
      },
    });
  }

  async function checkName() {
    const name = draft.legalName.trim();
    if (!isJurisdiction(draft.jurisdiction) || name.length < 3) return;
    const key = `${draft.jurisdiction}|${draft.entityType}|${name.toLowerCase()}`;
    setNameCheck("checking");
    try {
      const r = await palmCall<NameCheck>("form-name", { jurisdiction: draft.jurisdiction, entityType: draft.entityType, name });
      nameChecks.current.set(key, r);
      if (mode === "live") setBilled((n) => n + 1);
      setNameCheck(r);
    } catch (err) {
      setNameCheck(null);
      setError(err instanceof PalmUnavailable ? "Forming entities isn't set up yet. Ask the office's admin." : `Couldn't check the name: ${(err as Error).message}`);
    }
  }

  function chooseType(entityType: FormationDraft["entityType"]) {
    if (entityType === draft.entityType) return;
    const fromTitle = entityType === "llc" ? "Incorporator" : "Organizer";
    const toTitle = entityType === "llc" ? "Organizer" : "Incorporator";
    set({
      entityType,
      purpose: draft.purpose === DEFAULT_PURPOSE || draft.purpose === DEFAULT_PURPOSE_CORP ? (entityType === "llc" ? DEFAULT_PURPOSE : DEFAULT_PURPOSE_CORP) : draft.purpose,
      organizers: draft.organizers.map((o) => (o.title === fromTitle ? { ...o, title: toTitle } : o)),
      owners: draft.owners.map((o) => ({ ...o, title: o.title === "Member" || o.title === "Shareholder" ? (entityType === "llc" ? "Member" : "Shareholder") : o.title })),
      taxElection: "default",
      expeditedTier: "",
      extra: {},
    });
  }

  const payer = useMemo(() => {
    if (draft.payer.entityId) return draft.payer;
    const id = parentOwnerId(draft.owners);
    return { ...draft.payer, entityId: id, name: entities.find((e) => e.id === id)?.name ?? "" };
  }, [draft.payer, draft.owners, entities]);

  async function submit() {
    if (submitting || mode === null || mode === "off") return;
    const live = mode === "live";
    const name = draft.legalName.trim();
    const doc = llc ? "articles of organization" : "articles of incorporation";
    const role = llc ? "organizer" : "incorporator";
    const tax = taxOutcome(draft);
    const due = electionDeadline(draft);
    const lines = fee?.total != null ? fee.items.map((i) => ({ label: feeLabel(i, fee.items).replace(/ of the state fee\)$/, ")"), cents: Math.round(i.amount * 100), estimate: true })) : [];
    const result = await confirm({
      title: `File ${name} with ${state}?`,
      message: live
        ? `Palm files the ${doc} with the ${state} Secretary of State, signed in your name as ${role}. Its name, offices, agent and ${role} become public record.`
        : "Test mode: nothing is filed with the state and nothing is billed. The entity is created here as a test.",
      details: [
        `${llc ? "LLC" : "Corporation"} in ${state}, ${draft.expeditedTier ? `${TIER_LABEL[draft.expeditedTier] ?? pretty(draft.expeditedTier)} processing` : "standard processing"}, effective ${draft.effectiveDate ? format.date(draft.effectiveDate, "medium") : "when the state accepts it"}.`,
        draft.owners.length ? `Owned by ${format.list(draft.owners.map((o) => `${ownerName(o)} (${format.percent(ownerPercent(o), { decimals: 2, trim: true })})`))}.` : "No owners listed.",
        `Taxed as ${taxWords(tax.value)}${due ? `; Form ${due.form} is due by ${format.date(due.dueBy, "medium")}` : ""}.`,
        `${draft.agent.provider === "palm" ? "Palm's provider is the registered agent" : `${agentName(draft)} is the registered agent`}${draft.ein ? ", and Palm applies for the EIN once the state has formed it" : ""}.`,
        payer.name ? `Paid by ${payer.name}, booked as ${payer.treatment === "advance" ? "an advance the new entity repays" : "its contribution"}.` : "No payer chosen for the formation cost.",
      ],
      ...(lines.length ? { receipt: { lines, mode: live ? ("live" as const) : ("test" as const) } } : {}),
      tone: "commit",
      irreversible: live,
      typeToConfirm: live ? name : undefined,
      confirmLabel: live ? (fee?.total != null ? `File for ${money(fee.total, fee.currency)}` : `File with ${state}`) : "Submit test filing",
      version: ATTESTATION_VERSION,
    });
    if (!result) return;
    const attestation: FilingAttestation = {
      version: ATTESTATION_VERSION,
      articles: articlesStatement(draft, me?.name ?? ""),
      ss4: draft.ein ? ss4Statement(draft) : null,
      responsibleConsent: responsibleIsSomeoneElse(draft, me) ? !!draft.ein?.responsibleConsent : null,
      agentConsent: draft.agent.provider === "own" ? draft.agent.consent : null,
      typed: live ? name : null,
      at: Date.now(),
    };
    setSubmitting(true);
    setError("");
    try {
      await palmCall<{ assetId: string; formation: FormationState }>("form-submit", { draft: { ...draft, payer }, assetId, stateName: state, mode, idempotencyKey, attestation });
      clearSaved(me?.id);
      onCreated(assetId);
    } catch (err) {
      setError((err as Error).message || "Palm couldn't file this. Nothing was filed; try again.");
      setSubmitting(false);
    }
  }

  const ctx: Ctx = { draft, set, llc, region, state, rules, entities, office, me, mode, requirements, fee, billed, payer };

  const body = (() => {
    switch (here.key) {
      case "entity":
        return <EntityStep ctx={ctx} nameCheck={nameCheck} onCheck={() => void checkName()} onType={chooseType} />;
      case "business":
        return <BusinessStep ctx={ctx} />;
      case "ownership":
        return <OwnershipStep ctx={ctx} />;
      case "filers":
        return <FilersStep ctx={ctx} />;
      case "agent":
        return <AgentStep ctx={ctx} />;
      case "ein":
        return <TaxStep ctx={ctx} />;
      case "state":
        return <StateStep ctx={ctx} extras={extras} />;
      case "review":
        return (
          <ReviewStep
            ctx={ctx}
            steps={steps}
            problems={[...problems, ...signers]}
            validation={validation}
            canFile={canFile}
            attest={attest}
            onAttest={setAttest}
            onEdit={(k) => go(steps.findIndex((s) => s.key === k))}
          />
        );
    }
  })();

  const attested = attest.articles && (!draft.ein || attest.ss4);
  const checked = validation !== "checking" && validation !== null && (validation.ok || !!validation.skipped);
  const canSubmit = canFile && mode !== null && mode !== "off" && !problems.length && !signers.length && !!requirements?.supported && checked && attested && !submitting;
  const fileReason = !canFile
    ? "Only an owner or admin can file"
    : mode === "off"
      ? "Forming entities isn't set up yet"
      : problems.length || signers.length
        ? `${format.count(problems.length + signers.length, "thing", "things")} to finish first`
        : !checked
          ? validation === "checking" || validation === null
            ? "Waiting for Palm's check"
            : "Palm's check found problems"
          : !attested
            ? "Make the statements under Sign and file"
            : undefined;
  const unsupported = here.key === "entity" && requirements !== null && !requirements.supported;
  const blocked = unsupported || stepProblems.length > 0;
  const blockReason = unsupported ? `Palm can't form ${llc ? "an LLC" : "a corporation"} in ${state} yet` : stepProblems[0]?.text;
  const stepTitle = here.title({ llc, state });
  const lede = here.lede({ llc, state });
  const label = (s: StepMeta) => s.label(llc);

  const back =
    step > 0 ? (
      <Button onClick={() => go(step - 1)} disabled={submitting}>
        Back
      </Button>
    ) : null;
  const forward = !last ? (
    <Button variant="primary" onClick={() => go(step + 1)} disabled={blocked} disabledReason={blockReason}>
      Continue
    </Button>
  ) : (
    <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit} disabledReason={fileReason} busy={submitting} busyLabel="Filing…">
      {mode === "live" ? `File with ${state}…` : "Submit test filing…"}
    </Button>
  );
  const reason = (!last ? (blocked ? blockReason : undefined) : fileReason)?.replace(/\.$/, "");
  const reasonMore = !last && !unsupported && stepProblems.length > 1 ? stepProblems.length - 1 : 0;

  return (
    <Sheet
      open
      side="full"
      title="Form a new entity"
      onClose={leave}
      dirty={started && !storable}
      footer={
        phone ? (
          <>
            {back}
            {forward}
            {reason && (
              <p className="text-center text-small text-ink-2">
                {reason}
                {reasonMore ? ` · ${reasonMore} more` : ""}
              </p>
            )}
          </>
        ) : undefined
      }
    >
      <div className="-m-4 flex h-[calc(100%+32px)] min-h-0 bg-page">
        <Rail steps={steps} step={step} reached={reached} label={label} problemsAt={problemsAt} ctx={ctx} onGo={go} />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-overlay px-4 py-2 text-small text-ink-2 sm:px-8 lg:hidden">
            <span>
              Step {step + 1} of {steps.length} · {label(here)}
            </span>
            {fee?.total != null && <span className="tabular-nums">About {money(fee.total, fee.currency)}</span>}
          </div>

          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[720px] px-4 pt-6 pb-12 sm:px-8 sm:pt-8">
              <h3 ref={heading} tabIndex={-1} className="text-heading text-balance text-ink outline-none">
                {stepTitle}
              </h3>
              {lede && <p className="mt-1 max-w-[68ch] text-body text-pretty text-ink-2">{lede}</p>}
              <div className="mt-6 flex flex-col gap-4">
                {restored && step === 0 && (
                  <Banner
                    tone="info"
                    title="Picked up where you left off."
                    onDismiss={() => setRestored(false)}
                    action={
                      <Button variant="quiet" size="sm" onClick={startOver}>
                        Start over
                      </Button>
                    }
                  >
                    {saved ? `Saved ${format.dateTime(new Date(saved.savedAt))}. ` : ""}SSNs aren't kept, so enter them again.
                  </Banner>
                )}
                {(here.key === "entity" || here.key === "review") && mode === "off" && <Banner tone="negative">Forming entities isn't set up yet. Ask the office's admin.</Banner>}
                {error && (
                  <Banner tone="negative" onDismiss={() => setError("")}>
                    {error}
                  </Banner>
                )}
                {body}
              </div>
            </div>
          </div>

          {!phone && (
            <footer className="flex shrink-0 items-center gap-3 border-t border-line bg-overlay px-8 py-4">
              <p className="min-w-0 flex-1 text-small text-ink-2" aria-live="polite">
                {reason}
                {reasonMore ? ` · ${reasonMore} more` : ""}
              </p>
              {back}
              {forward}
            </footer>
          )}
        </div>

        {wide && here.key !== "review" && (
          <aside aria-label="The filing so far" className="w-[360px] shrink-0 overflow-y-auto border-l border-line p-6">
            <Preview ctx={ctx} current={here.key} />
          </aside>
        )}
      </div>
    </Sheet>
  );
}

// ── Shared context ───────────────────────────────────────────────────────

type Ctx = {
  draft: FormationDraft;
  set: (patch: Partial<FormationDraft>) => void;
  llc: boolean;
  /** The state of formation's code ("NV"). */
  region: string;
  state: string;
  rules: StateRules;
  entities: Entities;
  office: FormationAddress | null;
  me: Me;
  /** Palm's mode: a live name check is billed. */
  mode: PalmMode | null | "off";
  requirements: Requirements | null;
  fee: Fee | null;
  /** Live name checks billed for this draft. */
  billed: number;
  /** Who pays the formation cost: the one chosen, else the largest owner in BFO. */
  payer: FormationDraft["payer"];
};

const agentName = (d: FormationDraft) => (d.agent.provider === "palm" ? "Palm's registered-agent provider" : d.agent.kind === "person" ? personName(d.agent.name) : d.agent.entityName.trim());

const taxWords = (t: string) =>
  ({ "Disregarded Entity": "a disregarded entity", Partnership: "a partnership", "S Corporation": "an S corporation", "C Corporation": "a C corporation" })[t] ?? t.toLowerCase();

const isTrust = (e: { name: string; type?: string }) => e.type === "Trust" || recordType({ name: e.name, type: e.type }) === "Trust";

/** The entities in BFO as Select options. */
const entityOptions = (entities: Entities): Option<string>[] => entities.map((e) => ({ value: e.id, label: e.name }));

function stepSummary(k: StepKey, { draft: d, llc, state, fee }: Ctx, extras: number): string {
  switch (k) {
    case "entity":
      return [llc ? "LLC" : "Corporation", state].filter(Boolean).join(" · ");
    case "business":
      return d.principal.city ? `${d.principal.city}, ${d.principal.region}` : "Office and contact";
    case "ownership":
      return d.owners.length ? `${format.count(d.owners.length, "owner")} · ${format.percent(ownersTotal(d.owners), { decimals: 2, trim: true })}` : llc ? "Members, managers" : "Stock, board";
    case "filers":
      return (
        d.organizers
          .map((o) => (o.kind === "person" ? personName(o.name) : o.entityName))
          .filter(Boolean)
          .join(", ") || "Who signs"
      );
    case "agent":
      return d.agent.provider === "palm" ? "Palm" : agentName(d) || "Registered agent";
    case "ein":
      return `${{ "Disregarded Entity": "Disregarded", Partnership: "Partnership", "S Corporation": "S corporation", "C Corporation": "C corporation" }[taxOutcome(d).value]}${d.ein ? " · EIN" : ""}`;
    case "state":
      return format.count(extras, "question");
    case "review":
      return fee?.total != null ? "Cost, check, sign" : "Check and sign";
  }
}

// ── The frame's pieces ───────────────────────────────────────────────────

function ModeLine({ mode, state }: { mode: PalmMode | null | "off"; state: string }) {
  if (mode === null) return null;
  if (mode === "off") return <Status tone="negative">Not set up</Status>;
  return (
    <div className="flex flex-col gap-1">
      <Status tone={mode === "live" ? "warning" : "info"}>{mode === "live" ? "Files for real" : "Test mode"}</Status>
      <p className="text-small text-ink-2">
        {mode === "live" ? `${state || "The state"} receives the filing, and Palm bills the office's account.` : "Nothing reaches the state, and nothing is billed."}
      </p>
    </div>
  );
}

function Rail({
  steps,
  step,
  reached,
  label,
  problemsAt,
  ctx,
  onGo,
}: {
  steps: StepMeta[];
  step: number;
  reached: number;
  label: (s: StepMeta) => string;
  problemsAt: (k: StepKey) => DraftProblem[];
  ctx: Ctx;
  onGo: (i: number) => void;
}) {
  const extras = ctx.requirements?.extra.length ?? 0;
  return (
    <nav aria-label="Steps" className="hidden w-[248px] shrink-0 flex-col border-r border-line lg:flex">
      <div className="px-5 pt-6 pb-4">
        <ModeLine mode={ctx.mode} state={ctx.state} />
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {steps.map((s, i) => {
          const on = i === step;
          const open = i <= reached;
          const issues = problemsAt(s.key).length;
          const done = i < step && !issues;
          const flagged = open && issues > 0 && i !== step && i < reached;
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => open && onGo(i)}
                disabled={!open}
                aria-current={on ? "step" : undefined}
                className={cx("flex w-full items-center gap-3 rounded-control px-2 py-2 text-left", on ? "bg-selected" : open ? "cursor-pointer hover:bg-hover" : "cursor-default")}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    "inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-caption font-medium tabular-nums",
                    on ? "border-accent text-accent" : flagged ? "border-warning text-warning" : done ? "border-line text-ink-2" : "border-line text-ink-3",
                  )}
                >
                  {flagged ? <Icon name="warning" size={12} /> : done ? <Icon name="check" size={12} /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cx("block text-body", on ? "font-medium text-ink" : open ? "text-ink" : "text-ink-2")}>{label(s)}</span>
                  <span className={cx("block truncate text-small", flagged ? "text-warning" : "text-ink-2")}>
                    {flagged ? `${format.count(issues, "thing")} to finish` : stepSummary(s.key, ctx, extras)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {ctx.fee?.total != null && (
        <div className="flex items-baseline justify-between border-t border-line px-5 py-4 xl:hidden">
          <span className="text-small text-ink-2">Estimated cost</span>
          <span className="text-body font-medium text-ink tabular-nums">{money(ctx.fee.total, ctx.fee.currency)}</span>
        </div>
      )}
    </nav>
  );
}

/** One line of small ink-2 text inside a card: a footnote, a disclosure next to what it concerns (§11.5). */
function Note({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("max-w-[68ch] text-small text-pretty text-ink-2", className)}>{children}</p>;
}

/** Blocks inside a card, a hairline between each (never a card in a card). */
function Stack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col divide-y divide-line [&>*]:py-4 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">{children}</div>;
}

/** A yes/no that shows "unanswered" as unanswered (§8.6). */
function YesNo({ label, value, onChange, yes = "Yes", no = "No" }: { label: string; value: "" | "yes" | "no"; onChange: (v: "yes" | "no") => void; yes?: string; no?: string }) {
  return (
    <ChoiceTiles<"yes" | "no">
      label={label}
      value={value || null}
      onChange={onChange}
      options={[
        { value: "yes", title: yes },
        { value: "no", title: no },
      ]}
    />
  );
}

// ── Steps ────────────────────────────────────────────────────────────────

function EntityStep({ ctx, nameCheck, onCheck, onType }: { ctx: Ctx; nameCheck: NameCheck | null | "checking"; onCheck: () => void; onType: (t: FormationDraft["entityType"]) => void }) {
  const { draft: d, set, llc, state, requirements, fee, mode } = ctx;
  const [dated, setDated] = useState(!!d.effectiveDate);
  const officeState = ctx.office?.region ?? "";
  const usual = Array.from(new Set([officeState, "DE", "NV", "WY"].filter(Boolean)));
  const stateOptions: Option<string>[] = [
    ...usual.map((abbr) => ({ value: `US-${abbr}`, label: stateName(`US-${abbr}`), group: "Usual choices", hint: abbr === officeState ? "The office" : undefined })),
    ...US_STATES.filter(([abbr]) => !usual.includes(abbr)).map(([abbr, name]) => ({ value: `US-${abbr}`, label: name, group: "Every state" })),
  ];
  const tiers = fee?.expeditedTiers.length ? fee.expeditedTiers : (requirements?.expeditedTiers ?? []).map((tier) => ({ tier, amount: 0 }));
  const dateProblem = effectiveDateProblem(d.effectiveDate, todayIso());
  const canCheck = !!state && d.legalName.trim().length >= 3;
  return (
    <>
      <ChoiceTiles<FormationDraft["entityType"]>
        label="What kind of entity"
        value={d.entityType}
        onChange={onType}
        options={[
          { value: "llc", title: "LLC", description: "Owned by members. For tax, by default: on its owner's return with one member, a partnership with two or more." },
          {
            value: "corporation",
            title: "Corporation",
            description: "Shares, a board and officers. Taxed as a C corporation unless it elects S. Palm's corporation filings are new; not every state takes them yet.",
          },
        ]}
      />

      <Card title="Where it's formed">
        <div className="flex flex-col gap-4">
          <Field label="State of formation" hint={officeState ? `The office is in ${stateName(`US-${officeState}`)}.` : undefined}>
            <Select
              value={d.jurisdiction || null}
              onChange={(j) => set({ jurisdiction: j, principal: { ...d.principal, region: d.principal.region || j.slice(3) }, extra: {}, expeditedTier: "" })}
              options={stateOptions}
              label="State of formation"
              placeholder="Choose a state"
            />
          </Field>
          {requirements && !requirements.supported && (
            <Banner tone="warning">
              Palm can't form {llc ? "an LLC" : "a corporation"} in {state} yet. Choose another state.
            </Banner>
          )}
          <ForeignNote ctx={ctx} />
        </div>
      </Card>

      <Card title="Name">
        <div className="flex flex-col gap-3">
          <Field
            label="Legal name"
            hint={state ? `As it will appear on ${state}'s record, ending in ${llc ? "LLC or L.L.C." : "Inc. or Corp."}` : "Choose a state first; the name is checked with it."}
          >
            <Input value={d.legalName} onChange={(e) => set({ legalName: e.target.value })} placeholder={llc ? "Example Holdings, LLC" : "Example, Inc."} autoComplete="off" spellCheck={false} />
          </Field>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button size="sm" onClick={onCheck} disabled={!canCheck || nameCheck === "checking"} busy={nameCheck === "checking"} busyLabel="Checking…">
              {state ? `Check with ${state}` : "Check the name"}
            </Button>
            <span className="text-small text-ink-2">
              {mode === "live" ? `Palm bills ${format.money(PALM_PRICES.name_eligibility.cents / 100)} a check.` : mode === "test" ? "Free in test mode." : ""}
              {ctx.billed > 0 ? ` ${format.count(ctx.billed, "check")} billed so far.` : ""}
            </span>
          </div>
          {nameCheck && nameCheck !== "checking" && <NameResult check={nameCheck} state={state} onPick={(n) => set({ legalName: n })} />}
        </div>
      </Card>

      <Card title="Timing">
        <div className="flex flex-col gap-4">
          <ChoiceTiles<"accepted" | "dated">
            label="When it takes effect"
            value={dated ? "dated" : "accepted"}
            onChange={(v) => {
              setDated(v === "dated");
              if (v === "accepted") set({ effectiveDate: "" });
            }}
            options={[
              { value: "accepted", title: "When the state accepts it" },
              { value: "dated", title: "On a later date", description: `Up to ${MAX_DELAY_DAYS} days ahead.` },
            ]}
          />
          {dated && (
            <Field label="Effective date" error={dateProblem ?? undefined}>
              <DateInput value={d.effectiveDate || null} onChange={(iso) => set({ effectiveDate: iso ?? "" })} />
            </Field>
          )}
          <Note>The day it takes effect starts its first tax year, and the clock for an S election (2 months and 15 days) or Form 8832 (75 days).</Note>
          {state &&
            (tiers.length ? (
              <Field label="Processing">
                <Select
                  value={d.expeditedTier || "standard"}
                  onChange={(v) => set({ expeditedTier: v === "standard" ? "" : v })}
                  label="Processing"
                  options={[
                    { value: "standard", label: "Standard" },
                    ...tiers.map((t) => ({ value: t.tier, label: TIER_LABEL[t.tier] ?? pretty(t.tier), hint: t.amount ? `+${money(t.amount, fee?.currency)}` : undefined })),
                  ]}
                />
              </Field>
            ) : (
              <Note>{requirements ? `${state} has no expedited option; it's processed at the standard speed.` : "Asking Palm about processing speeds…"}</Note>
            ))}
        </div>
      </Card>
    </>
  );
}

/** Formed in one state and run from another: the second registration, its cost, and both states' yearly filings. */
function ForeignNote({ ctx, ask = false }: { ctx: Ctx; ask?: boolean }) {
  const { draft: d, set, llc, state } = ctx;
  const host = hostState(d);
  if (!host) return null;
  const hostName = stateName(`US-${host}`);
  const costs = expectedCosts(d);
  const once = costs.find((c) => c.per === "once")?.dollars;
  const homeYear = costs.find((c) => c.per === "year" && c.label.startsWith(state))?.dollars;
  const kind = llc ? "LLC" : "corporation";
  return (
    <>
      <Banner tone="info" title={`Run from ${hostName}, it will likely need to register there too.`}>
        If it does business in {hostName}, it registers there as a foreign {kind} with a {hostName} registered agent{once != null ? `: about ${format.money(once)} once` : ""}.{" "}
        {state ? `${state}'s yearly filing${homeYear ? `, about ${format.money(homeYear)},` : ""} applies either way. ` : ""}Forming in {hostName} instead avoids the second registration.
      </Banner>
      {ask && (
        <ChoiceTiles<"yes" | "no" | "unsure">
          label={`Will it do business in ${hostName}?`}
          value={d.hostBusiness || null}
          onChange={(v) => set({ hostBusiness: v })}
          stacked
          options={[
            { value: "yes", title: "Yes", description: `It registers in ${hostName} after formation.` },
            { value: "no", title: "No, it only owns investments or property there", description: "Ask counsel if you're unsure where that line falls." },
            { value: "unsure", title: "Not sure yet" },
          ]}
        />
      )}
    </>
  );
}

function NameResult({ check, state, onPick }: { check: NameCheck; state: string; onPick: (name: string) => void }) {
  const blocking = check.violations.filter((v) => v.severity === "error");
  const notes = check.violations.filter((v) => v.severity !== "error");
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <p className="flex items-start gap-2 text-body text-ink">
        <span className={cx("mt-[2px]", check.eligible ? "text-positive" : "text-negative")}>
          <Icon name={check.eligible ? "check" : "error"} size={16} />
        </span>
        <span>
          {check.eligible
            ? `Eligible on ${state}'s record today. ${state} confirms it when it accepts the filing.`
            : !check.available
              ? "Taken: another business has this exact name."
              : "Not allowed as written."}
        </span>
      </p>
      {[...blocking, ...notes].map((v, i) => (
        <Note key={i}>{v.message}</Note>
      ))}
      {!check.eligible && check.alternatives.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-small text-ink-2">Try</span>
          {check.alternatives.map((a) => (
            <Button key={a} size="sm" variant="quiet" onClick={() => onPick(a)}>
              {a}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function BusinessStep({ ctx }: { ctx: Ctx }) {
  const { draft: d, set, llc, rules, office, state } = ctx;
  const generic = llc ? DEFAULT_PURPOSE : DEFAULT_PURPOSE_CORP;
  const useOffice = !!office && sameAddress(d.principal, office);
  return (
    <>
      <Card title="Principal office">
        <div className="flex flex-col gap-4">
          <Note>Where the business is run. It appears on the public filing.</Note>
          {office && (
            <Checkbox
              checked={useOffice}
              onChange={(on) => set({ principal: on ? { ...office, county: d.principal.county } : { ...EMPTY_ADDRESS, region: ctx.region } })}
              label="Use the office's address"
              hint={addressLine(office)}
            />
          )}
          {!useOffice && <AddressFields value={d.principal} onChange={(principal) => set({ principal })} countyRule={rules["principal_address.county"]} />}
          {looksLikeMailbox(d.principal) && (
            <Banner tone="warning">
              This looks like a mail-receiving address (a PMB or mailbox suite). Some states won't take one as a principal office, and it puts every entity at one public address. Use where the
              business is run, or ask Palm whether {state || "the state"} accepts it.
            </Banner>
          )}
          <ForeignNote ctx={ctx} ask />
          <Checkbox checked={!!d.mailing} onChange={(on) => set({ mailing: on ? { ...EMPTY_ADDRESS } : null })} label="Mail goes to a different address" hint="Also on the public filing." />
          {d.mailing && <AddressFields value={d.mailing} onChange={(mailing) => set({ mailing })} countyRule={rules["mailing_address.county"]} />}
        </div>
      </Card>

      <Card title="How the state reaches it">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
          <Field
            label="Business email"
            className="sm:col-span-12"
            hint="The state sends its notices here: annual reports, problems with the filing. A shared office address works best. It's kept in the state's file, not printed on the articles."
          >
            <Input type="email" value={d.email} onChange={(e) => set({ email: e.target.value })} placeholder="name@example.com" autoComplete="off" />
          </Field>
          <Field label="Business phone" optional={!rules.phone?.required} className="sm:col-span-6">
            <Input type="tel" value={d.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="(555) 010-0142" />
          </Field>
          <Field label="Website" optional={!rules.website?.required} className="sm:col-span-6" hint="We add https:// for you.">
            <Input value={d.website} onChange={(e) => set({ website: e.target.value })} placeholder="example.com" autoComplete="off" spellCheck={false} />
          </Field>
        </div>
      </Card>

      <Card
        title="Purpose"
        action={
          d.purpose !== generic ? (
            <Button variant="quiet" size="sm" onClick={() => set({ purpose: generic })}>
              Use the general clause
            </Button>
          ) : null
        }
      >
        <div className="flex flex-col gap-2">
          <Textarea value={d.purpose} onChange={(e) => set({ purpose: e.target.value })} aria-label="Purpose" />
          <Note>Most states accept the general clause. Some print exactly what you write here on the articles.</Note>
        </div>
      </Card>

      <Card title="Contact for Palm">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
          <Field label="Name" className="sm:col-span-4">
            <Input value={d.contact.name} onChange={(e) => set({ contact: { ...d.contact, name: e.target.value } })} autoComplete="off" />
          </Field>
          <Field label="Email" className="sm:col-span-5">
            <Input type="email" value={d.contact.email} onChange={(e) => set({ contact: { ...d.contact, email: e.target.value } })} autoComplete="off" />
          </Field>
          <Field label="Phone" optional className="sm:col-span-3">
            <Input type="tel" value={d.contact.phone} onChange={(e) => set({ contact: { ...d.contact, phone: e.target.value } })} />
          </Field>
          <Note className="sm:col-span-12">Who Palm reaches if the state needs anything. Sent to Palm only; never on the filing.</Note>
        </div>
      </Card>
    </>
  );
}

function OwnershipStep({ ctx }: { ctx: Ctx }) {
  const { draft: d, set, llc, rules, state } = ctx;
  // Stable keys, so a row keeps its own state when one above it is removed.
  const keys = useRef<string[]>([]);
  while (keys.current.length < d.owners.length) keys.current.push(crypto.randomUUID());
  keys.current.length = d.owners.length;
  const setOwner = (i: number, next: FormationOwner) => set({ owners: d.owners.map((x, j) => (j === i ? next : x)) });
  const remove = (i: number) => {
    keys.current.splice(i, 1);
    set({ owners: d.owners.filter((_, j) => j !== i) });
  };
  const add = () => {
    const left = Math.max(0, Math.round((100 - ownersTotal(d.owners)) * 100) / 100);
    set({ owners: [...d.owners, { ...emptyOwner("entity", left ? String(left) : ""), title: llc ? "Member" : "Shareholder" }] });
  };
  const total = ownersTotal(d.owners);
  const left = Math.round((100 - total) * 100) / 100;
  const tax = taxOutcome(d);
  const home = d.owners.length === 1 ? ownerName(d.owners[0]) : "";
  const filed = llc && d.membersRequired !== false;
  return (
    <>
      <Card title={llc ? "Members" : "Shareholders"}>
        <div className="flex flex-col gap-4">
          {d.owners.length === 0 ? (
            <Note>No owners yet. Without one, it sits at the top of the structure.</Note>
          ) : (
            <Stack>
              {d.owners.map((o, i) => (
                <OwnerBlock key={keys.current[i]} ctx={ctx} index={i} owner={o} onChange={(next) => setOwner(i, next)} onRemove={() => remove(i)} />
              ))}
            </Stack>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="quiet" size="sm" icon="plus" className="-ml-3" onClick={add}>
              Add {d.owners.length ? "another" : "a"} {llc ? "member" : "shareholder"}
            </Button>
            {d.owners.length > 1 &&
              (total === 100 ? (
                <Status tone="neutral">100% assigned</Status>
              ) : (
                <Status tone="warning">
                  {left > 0
                    ? `${format.percent(total, { decimals: 2, trim: true })} assigned · ${format.percent(left, { decimals: 2, trim: true })} left`
                    : `${format.percent(-left, { decimals: 2, trim: true })} over`}
                </Status>
              ))}
          </div>
          <div className="flex flex-col gap-1 border-t border-line pt-4">
            {llc ? (
              <Note>
                Shares cover capital, profits and votes alike; the operating agreement can split them.{" "}
                {filed
                  ? `${state || "The state"}'s filing asks for the members, so their names, addresses and contacts go to Palm and into the state's file.`
                  : `${state || "The state"}'s filing doesn't ask for members, so they stay in BFO, off the filing.`}
              </Note>
            ) : (
              <Note>Kept in BFO; the shares are issued after the state forms it.</Note>
            )}
            {d.owners.length > 0 && (
              <Note>
                For tax: {taxWords(tax.value)}
                {tax.value === "Disregarded Entity" && home ? `, on ${home}'s return` : tax.value === "Partnership" ? ", filing Form 1065 with a K-1 for each member" : ""}
                {tax.elected ? ", by election" : ", the default"}. The Tax step can change it.
              </Note>
            )}
          </div>
        </div>
      </Card>

      {llc ? (
        <Card title="Management">
          <div className="flex flex-col gap-4">
            <ChoiceTiles<FormationDraft["managed"]>
              label="Who runs it"
              value={d.managed}
              onChange={(v) => set(v === "managers" ? { managed: v, managers: d.managers.length ? d.managers : [emptyOfficial("Manager")] } : { managed: v })}
              options={[
                { value: "members", title: "Member-managed", description: "Every member can act for it and sign on its behalf." },
                { value: "managers", title: "Manager-managed", description: "Only the managers named can act for it and sign; members vote on what the agreement reserves to them." },
              ]}
            />
            {d.managed === "managers" && (
              <>
                <Stack>
                  {d.managers.map((m, i) => (
                    <CardSection
                      key={i}
                      title={personName(m.name) || `Manager ${i + 1}`}
                      action={
                        d.managers.length > 1 ? (
                          <IconButton icon="trash" label={`Remove ${personName(m.name) || `manager ${i + 1}`}`} onClick={() => set({ managers: d.managers.filter((_, j) => j !== i) })} />
                        ) : undefined
                      }
                    >
                      <OfficialFields ctx={ctx} value={m} path="initial_governing_persons" onChange={(next) => set({ managers: d.managers.map((x, j) => (j === i ? next : x)) })} />
                    </CardSection>
                  ))}
                </Stack>
                <div>
                  <Button variant="quiet" size="sm" icon="plus" className="-ml-3" onClick={() => set({ managers: [...d.managers, emptyOfficial("Manager")] })}>
                    Add a manager
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>
      ) : (
        <>
          <StockCard ctx={ctx} />
          <PeopleCard
            title="Initial directors"
            note={`The first board. ${rules.initial_directors?.required ? `${state} asks for them.` : "Optional in most states."}`}
            list={d.directors}
            word="director"
            onChange={(directors) => set({ directors })}
            make={() => emptyOfficial()}
            render={(p, onChange) => <OfficialFields ctx={ctx} value={p} path="initial_directors" titleLabel="Board role" titlePlaceholder="Chair" onChange={onChange} />}
          />
          <PeopleCard
            title="Initial officers"
            note={`President, secretary, treasurer. ${rules.initial_officers?.required ? `${state} asks for them.` : "Optional in most states; some require them."}`}
            list={d.officers}
            word="officer"
            onChange={(officers) => set({ officers })}
            make={() => emptyOfficer(d.officers.some((o) => o.role === "president") ? "secretary" : "president")}
            render={(p, onChange) => <OfficerFields ctx={ctx} value={p} onChange={onChange} />}
          />
        </>
      )}
    </>
  );
}

function PeopleCard<T extends FormationOfficial>({
  title,
  note,
  list,
  word,
  onChange,
  make,
  render,
}: {
  title: string;
  note: string;
  list: T[];
  word: string;
  onChange: (next: T[]) => void;
  make: () => T;
  render: (p: T, onChange: (next: T) => void) => ReactNode;
}) {
  return (
    <Card title={title}>
      <div className="flex flex-col gap-4">
        <Note>{note}</Note>
        {list.length > 0 && (
          <Stack>
            {list.map((p, i) => (
              <CardSection
                key={i}
                title={personName(p.name) || `${word.charAt(0).toUpperCase()}${word.slice(1)} ${i + 1}`}
                action={<IconButton icon="trash" label={`Remove ${personName(p.name) || `${word} ${i + 1}`}`} onClick={() => onChange(list.filter((_, j) => j !== i))} />}
              >
                {render(p, (next) => onChange(list.map((x, j) => (j === i ? next : x))))}
              </CardSection>
            ))}
          </Stack>
        )}
        <div>
          <Button variant="quiet" size="sm" icon="plus" className="-ml-3" onClick={() => onChange([...list, make()])}>
            Add {list.length ? "another" : "a"} {word}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function StockCard({ ctx }: { ctx: Ctx }) {
  const { draft: d, set } = ctx;
  const s = d.stock;
  const setS = (patch: Partial<typeof s>) => set({ stock: { ...s, ...patch } });
  const classTotal = s.classes.reduce((n, c) => n + (num(c.authorized) || 0), 0);
  const setClass = (i: number, patch: Partial<(typeof s.classes)[number]>) => setS({ classes: s.classes.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const dollarsOf = (v: string) => (Number.isNaN(num(v)) ? null : num(v));
  return (
    <Card title="Authorized stock">
      <div className="flex flex-col gap-4">
        <Note>What the articles let the corporation issue.</Note>
        <Segmented
          label="Classes of stock"
          value={s.multiClass ? "multi" : "single"}
          onChange={(v) => setS({ multiClass: v === "multi", classes: v === "multi" && !s.classes.length ? [emptyStockClass("Common")] : s.classes })}
          options={[
            { value: "single", label: "One class" },
            { value: "multi", label: "Several classes" },
          ]}
        />
        {!s.multiClass ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
            <Field label="Authorized shares" className="sm:col-span-4">
              <Input inputMode="numeric" value={s.total} onChange={(e) => setS({ total: e.target.value })} className="tabular-nums" />
            </Field>
            <Field label="Par value per share" className="sm:col-span-4">
              <Input
                prefix="$"
                inputMode="decimal"
                value={s.hasPar ? s.par : ""}
                disabled={!s.hasPar}
                onChange={(e) => setS({ par: e.target.value })}
                placeholder={s.hasPar ? "0.0001" : "No par"}
                className="tabular-nums"
              />
            </Field>
            <Field label="Total consideration" optional className="sm:col-span-4" hint="What all the shares bring in.">
              <MoneyInput value={dollarsOf(s.consideration)} onChange={(v) => setS({ consideration: v === null ? "" : String(v) })} />
            </Field>
            <Checkbox
              className="sm:col-span-12"
              checked={!s.hasPar}
              onChange={(v) => setS({ hasPar: !v })}
              label="No par value"
              hint="Shares without a stated minimum price. Some states tax them differently."
            />
            <Field label="Rights and restrictions" optional className="sm:col-span-12" hint="Voting, dividends, preferences.">
              <Textarea value={s.rights} onChange={(e) => setS({ rights: e.target.value })} placeholder="Common stock with one vote per share." />
            </Field>
          </div>
        ) : (
          <>
            <Stack>
              {s.classes.map((c, i) => (
                <CardSection
                  key={i}
                  title={c.name.trim() || `Class ${i + 1}`}
                  action={
                    s.classes.length > 1 ? (
                      <IconButton icon="trash" label={`Remove ${c.name.trim() || `class ${i + 1}`}`} onClick={() => setS({ classes: s.classes.filter((_, j) => j !== i) })} />
                    ) : undefined
                  }
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
                    <Field label="Class name" className="sm:col-span-6">
                      <Input value={c.name} onChange={(e) => setClass(i, { name: e.target.value })} placeholder="Preferred Series A" />
                    </Field>
                    <Field label="Authorized" className="sm:col-span-3">
                      <Input inputMode="numeric" value={c.authorized} onChange={(e) => setClass(i, { authorized: e.target.value })} className="tabular-nums" />
                    </Field>
                    <Field label="Issued" optional className="sm:col-span-3">
                      <Input inputMode="numeric" value={c.issued} onChange={(e) => setClass(i, { issued: e.target.value })} className="tabular-nums" />
                    </Field>
                    <Field label="Par value" optional className="sm:col-span-6">
                      <Input prefix="$" inputMode="decimal" value={c.par} onChange={(e) => setClass(i, { par: e.target.value })} placeholder="No par" className="tabular-nums" />
                    </Field>
                    <Field label="Consideration" optional className="sm:col-span-6">
                      <MoneyInput value={dollarsOf(c.consideration)} onChange={(v) => setClass(i, { consideration: v === null ? "" : String(v) })} />
                    </Field>
                    <Field label="Rights and restrictions" optional className="sm:col-span-12">
                      <Input value={c.rights} onChange={(e) => setClass(i, { rights: e.target.value })} placeholder="One vote per share" />
                    </Field>
                  </div>
                </CardSection>
              ))}
            </Stack>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button variant="quiet" size="sm" icon="plus" className="-ml-3" onClick={() => setS({ classes: [...s.classes, emptyStockClass()] })}>
                Add a class
              </Button>
              <span className="text-small text-ink-2 tabular-nums">{classTotal.toLocaleString("en-US")} shares authorized in all</span>
            </div>
            <Field label="Total consideration" optional>
              <MoneyInput value={dollarsOf(s.consideration)} onChange={(v) => setS({ consideration: v === null ? "" : String(v) })} />
            </Field>
          </>
        )}
      </div>
    </Card>
  );
}

function FilersStep({ ctx }: { ctx: Ctx }) {
  const { draft: d, set, llc, me } = ctx;
  const word = llc ? "Organizer" : "Incorporator";
  const setParty = (i: number, next: FormationParty) => set({ organizers: d.organizers.map((x, j) => (j === i ? next : x)) });
  const mine = (me?.name ?? "").trim().split(/\s+/);
  const myName: PersonName = { ...EMPTY_NAME, first: mine[0] ?? "", last: mine.length > 1 ? mine[mine.length - 1] : "", middle: mine.slice(1, -1).join(" ") };
  return (
    <Card title={d.organizers.length > 1 ? `${word}s` : word}>
      <div className="flex flex-col gap-4">
        <Stack>
          {d.organizers.map((o, i) => {
            const signer = o.kind === "person" ? (hasName(o.name) ? personName(o.name) : "") : o.signerName.trim();
            const notMe = !!signer && !isPersonFiling(o.kind === "person" ? o.name : { first: signer.split(/\s+/)[0] ?? "", last: signer.split(/\s+/).at(-1) ?? "" }, me);
            const body = (
              <div className="flex flex-col gap-4">
                {notMe && (
                  <Banner
                    tone="warning"
                    action={
                      me?.name ? (
                        <Button
                          variant="quiet"
                          size="sm"
                          onClick={() => setParty(i, o.kind === "person" ? { ...o, name: myName, email: o.email || (me?.email ?? "") } : { ...o, signerName: me?.name ?? "" })}
                        >
                          Name me instead
                        </Button>
                      ) : undefined
                    }
                  >
                    {signer} would sign the articles, but hasn&rsquo;t agreed to. Name yourself, or have {signer} file it from their own sign-in.
                  </Banner>
                )}
                <PartyFields
                  ctx={ctx}
                  value={o}
                  onChange={(next) => setParty(i, next)}
                  onMe={me?.name && o.kind === "person" && !isPersonFiling(o.name, me) ? () => setParty(i, { ...o, name: myName, email: o.email || (me?.email ?? "") }) : undefined}
                />
              </div>
            );
            return d.organizers.length > 1 ? (
              <CardSection
                key={i}
                title={signer || `${word} ${i + 1}`}
                action={<IconButton icon="trash" label={`Remove ${signer || `${word.toLowerCase()} ${i + 1}`}`} onClick={() => set({ organizers: d.organizers.filter((_, j) => j !== i) })} />}
              >
                {body}
              </CardSection>
            ) : (
              <div key={i}>{body}</div>
            );
          })}
        </Stack>
        <div>
          <Button variant="quiet" size="sm" icon="plus" className="-ml-3" onClick={() => set({ organizers: [...d.organizers, emptyParty(word)] })}>
            Add another {word.toLowerCase()}
          </Button>
        </div>
        <div className="flex flex-col gap-1 border-t border-line pt-4">
          <Note>The {word.toLowerCase()}&rsquo;s name and address appear on the public record. To keep family names off it, the person filing for the office can sign.</Note>
          <Note>You sign the articles in the {word.toLowerCase()}&rsquo;s name on the review step; Palm files them.</Note>
        </div>
      </div>
    </Card>
  );
}

function AgentStep({ ctx }: { ctx: Ctx }) {
  const { draft: d, set, region, state, rules } = ctx;
  const a = d.agent;
  const where = state || "the state";
  return (
    <>
      <ChoiceTiles<"palm" | "own">
        label="Who serves as registered agent"
        value={a.provider}
        onChange={(v) =>
          set({
            agent:
              v === "palm"
                ? { provider: "palm" }
                : a.provider === "own"
                  ? a
                  : { provider: "own", kind: "organization", name: { ...EMPTY_NAME }, entityName: "", address: { ...EMPTY_ADDRESS, region }, mailing: null, email: "", phone: "", consent: false },
          })
        }
        options={[
          { value: "palm", title: "Palm", description: `Palm's registered-agent provider in ${where} accepts legal papers and state mail, and Palm forwards them into BFO.` },
          { value: "own", title: "Someone else", description: `An agent you already have in ${where}.` },
        ]}
      />
      {a.provider === "palm" ? (
        <Card title="Palm as registered agent">
          <Rows>
            <Row label="Agent of record">{`Palm's provider in ${where}. The filing names it, and BFO records its legal name and address once Palm reports them.`}</Row>
            <Row label="Cost">A yearly fee, billed to the Palm account under Palm&rsquo;s agent terms. It renews each year until the entity is dissolved or moves its agent.</Row>
            <Row label="Served papers">Emailed to BFO&rsquo;s owners and admins as soon as Palm receives them. Served papers have deadlines to answer.</Row>
          </Rows>
        </Card>
      ) : (
        <Card title="Your registered agent">
          <div className="flex flex-col gap-4">
            <Segmented
              label="The agent is"
              value={a.kind}
              onChange={(kind) => set({ agent: { ...a, kind } })}
              options={[
                { value: "organization", label: "A company" },
                { value: "person", label: "A person" },
              ]}
            />
            {a.kind === "person" ? (
              <NameFields value={a.name} onChange={(name) => set({ agent: { ...a, name } })} />
            ) : (
              <Field label="Company name">
                <Input value={a.entityName} onChange={(e) => set({ agent: { ...a, entityName: e.target.value } })} placeholder="Example Agents, Inc." />
              </Field>
            )}
            <CardSection title={`Registered office in ${where}`}>
              <AddressFields value={{ ...a.address, region }} lockRegion={region} onChange={(address) => set({ agent: { ...a, address } })} countyRule={rules["registered_agent.address.county"]} />
            </CardSection>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
              <Field label="Email" optional={!rules["registered_agent.email"]?.required} className="sm:col-span-6">
                <Input type="email" value={a.email} onChange={(e) => set({ agent: { ...a, email: e.target.value } })} />
              </Field>
              <Field label="Phone" optional={!rules["registered_agent.phone"]?.required} className="sm:col-span-6">
                <Input type="tel" value={a.phone} onChange={(e) => set({ agent: { ...a, phone: e.target.value } })} />
              </Field>
            </div>
            <Checkbox
              checked={!!a.mailing}
              onChange={(on) => set({ agent: { ...a, mailing: on ? { ...EMPTY_ADDRESS } : null } })}
              label="The agent gets mail somewhere else"
              hint="A mailing address other than the registered office."
            />
            {a.mailing && <AddressFields value={a.mailing} onChange={(mailing) => set({ agent: { ...a, mailing } })} />}
            <div className="border-t border-line pt-4">
              <Checkbox
                checked={a.consent}
                onChange={(consent) => set({ agent: { ...a, consent } })}
                label={`This agent has agreed to serve, and will sign ${state ? `${state}'s` : "the state's"} consent to appointment.`}
                hint="Most states require the agent's written consent. Keep the signed consent with the entity's documents."
              />
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

function TaxStep({ ctx }: { ctx: Ctx }) {
  const { draft: d, set, llc, me } = ctx;
  const e = d.ein;
  const setE = (patch: Partial<FormationEin>) => e && set({ ein: { ...e, ...patch } });
  const tax = taxOutcome(d);
  const due = electionDeadline(d);
  const dueText = (form: "2553" | "8832") => {
    const x = electionDeadline({ ...d, taxElection: form === "8832" ? "c_corp" : "s_corp" });
    return x ? `File Form ${form} by ${format.date(x.dueBy, "medium")}${x.estimated ? " (counted from today)" : ""}.` : "";
  };
  const members = einMemberCount(d);
  const owner = d.owners.length === 1 ? ownerName(d.owners[0]) : "";
  const defaultTitle = llc ? (members === 1 || (asksMarried(d) && e?.llcClassification === "single_member") ? "The default: disregarded" : "The default: a partnership") : "C corporation";
  const defaultText = llc
    ? members === 1
      ? `Its income and expenses go on ${owner ? `${owner}'s` : "its owner's"} return.`
      : "It files Form 1065 and gives each member a K-1."
    : "It files Form 1120 and pays its own tax.";
  const married = asksMarried(d);
  // An S corporation's owners must be people, estates or certain trusts; a company member generally can't be one.
  const companyOwner = d.owners.some((o) => o.kind === "entity" && o.entityKind !== "trust");
  const sNote = companyOwner
    ? `A company ${llc ? "member" : "shareholder"} generally can't hold an S corporation unless it's disregarded into an eligible owner; check with your CPA.`
    : `Every ${llc ? "member" : "shareholder"} must consent; only people, estates and certain trusts can hold it.`;
  return (
    <>
      <Card title="How it's taxed">
        <div className="flex flex-col gap-4">
          <ChoiceTiles<FormationDraft["taxElection"]>
            label="For federal tax"
            value={d.taxElection}
            onChange={(v) => set({ taxElection: v })}
            stacked
            options={
              llc
                ? [
                    { value: "default", title: defaultTitle, description: defaultText },
                    { value: "s_corp", title: "Elect an S corporation", description: `${dueText("2553")} ${sNote}` },
                    { value: "c_corp", title: "Elect a C corporation", description: dueText("8832") },
                  ]
                : [
                    { value: "default", title: "C corporation", description: defaultText },
                    { value: "s_corp", title: "S corporation", description: `${dueText("2553")} ${sNote}` },
                  ]
            }
          />
          {married && d.taxElection === "default" && e && (
            <>
              <YesNo
                label="Do the two members, as spouses, hold it as community property under their home state's law?"
                value={e.marriedCouple}
                onChange={(v) => setE({ marriedCouple: v, llcClassification: v === "yes" ? e.llcClassification : "" })}
              />
              <Note>Only spouses in a community-property state can choose how it&rsquo;s treated (Rev. Proc. 2002-69). The IRS asks on the EIN application.</Note>
              {e.marriedCouple === "yes" && (
                <ChoiceTiles<"single_member" | "multi_member">
                  label="Treat it as"
                  value={e.llcClassification || null}
                  onChange={(v) => setE({ llcClassification: v })}
                  options={[
                    { value: "single_member", title: "One owner (disregarded)", description: "It goes on the couple's return." },
                    { value: "multi_member", title: "A partnership", description: "It files Form 1065." },
                  ]}
                />
              )}
            </>
          )}
          {due && (
            <Note>
              Taxed as {taxWords(tax.value)} only once Form {due.form} is filed: due by {format.date(due.dueBy, "medium")}, {due.form === "2553" ? "2 months and 15 days" : "75 days"} after it takes
              effect
              {due.estimated ? " (counted from today; the state's date may be later)" : ""}.
            </Note>
          )}
        </div>
      </Card>

      <Card title="EIN">
        <div className="flex flex-col gap-4">
          <Note>The IRS number banks ask for, and that it needs for payroll, 1099s and any return of its own.</Note>
          <ChoiceTiles<"apply" | "later">
            label="Apply for it through Palm?"
            value={e ? "apply" : "later"}
            onChange={(v) => set({ ein: v === "apply" ? (e ?? { ...emptyEin(), fiscalYearEndMonth: 12 }) : null })}
            options={[
              { value: "apply", title: "Apply through Palm", description: "Palm files Form SS-4 after the state forms it, and the number lands on the record." },
              { value: "later", title: "Not now, do it later", description: "Nothing goes to the IRS with this filing." },
            ]}
          />
        </div>
      </Card>

      {e && <EinQuestions ctx={ctx} e={e} setE={setE} me={me} />}
    </>
  );
}

function EinQuestions({ ctx, e, setE, me }: { ctx: Ctx; e: FormationEin; setE: (patch: Partial<FormationEin>) => void; me: Me }) {
  const { draft: d, llc } = ctx;
  const [showSsn, setShowSsn] = useState(false);
  const people = useMemo(() => {
    const out: { label: string; name: PersonName }[] = [];
    const add = (name: PersonName) => {
      if (hasName(name) && !out.some((p) => personName(p.name) === personName(name))) out.push({ label: personName(name), name });
    };
    d.organizers.forEach((o) => o.kind === "person" && add(o.name));
    d.owners.forEach((o) => o.kind === "person" && add(o.name));
    d.managers.forEach((m) => add(m.name));
    d.officers.forEach((m) => add(m.name));
    return out;
  }, [d.owners, d.managers, d.officers, d.organizers]);
  const chosen = people.find((p) => p.name.first === e.responsible.first && p.name.last === e.responsible.last && p.name.middle === e.responsible.middle);
  const qs = activityQuestions(e.activity);
  const employees = (num(e.employees.agricultural || "0") || 0) + (num(e.employees.other || "0") || 0);
  const followsOwners = fiscalYearFollowsOwners(d);
  const someoneElse = responsibleIsSomeoneElse(d, me);
  const responsibleName = [e.responsible.first, e.responsible.last].filter((x) => x.trim()).join(" ");
  const months: Option<string>[] = MONTHS.map((m, i) => ({ value: String(i + 1), label: m }));
  return (
    <>
      <Card title="Responsible party">
        <div className="flex flex-col gap-4">
          <Note>A person who controls the entity. The IRS writes to them about the number.</Note>
          {people.length > 0 && (
            <Field label="From this filing" optional>
              <Select
                value={chosen ? chosen.label : null}
                onChange={(v) => {
                  const p = people.find((x) => x.label === v);
                  if (p) setE({ responsible: { ...e.responsible, first: p.name.first, middle: p.name.middle, last: p.name.last }, responsibleConsent: false });
                }}
                options={people.map((p) => ({ value: p.label, label: p.label }))}
                label="From this filing"
                placeholder="Choose someone named here"
              />
            </Field>
          )}
          <div className="grid grid-cols-2 items-end gap-4 sm:grid-cols-12">
            <Field label="First name" className="col-span-2 sm:col-span-4">
              <Input value={e.responsible.first} onChange={(x) => setE({ responsible: { ...e.responsible, first: x.target.value }, responsibleConsent: false })} autoComplete="off" />
            </Field>
            <Field label="Middle name" optional className="sm:col-span-3">
              <Input value={e.responsible.middle} onChange={(x) => setE({ responsible: { ...e.responsible, middle: x.target.value } })} autoComplete="off" />
            </Field>
            <Field label="Last name" className="sm:col-span-5">
              <Input value={e.responsible.last} onChange={(x) => setE({ responsible: { ...e.responsible, last: x.target.value }, responsibleConsent: false })} autoComplete="off" />
            </Field>
            <Field label="SSN or ITIN" className="col-span-2 sm:col-span-6">
              <Input
                type={showSsn ? "text" : "password"}
                inputMode="numeric"
                value={e.responsible.ssn}
                onChange={(x) => setE({ responsible: { ...e.responsible, ssn: x.target.value } })}
                placeholder="123-45-6789"
                autoComplete="off"
                spellCheck={false}
                suffix={<IconButton icon={showSsn ? "eyeOff" : "eye"} label={showSsn ? "Hide the number" : "Show the number"} noTooltip className="-mr-2" onClick={() => setShowSsn((v) => !v)} />}
              />
            </Field>
          </div>
          <Note>
            The SSN or ITIN goes to Palm through BFO&rsquo;s server only when you file, and BFO never stores it. Palm&rsquo;s check before filing runs without it, and it isn&rsquo;t kept if you leave.
          </Note>
          {someoneElse && (
            <Checkbox
              checked={e.responsibleConsent}
              onChange={(responsibleConsent) => setE({ responsibleConsent })}
              label={`${responsibleName} agreed to be the responsible party, and gave me their SSN or ITIN for this application.`}
              hint="They aren't the person filing, so they must agree first."
            />
          )}
        </div>
      </Card>

      <Card title="What it does">
        <div className="flex flex-col gap-4">
          <Field label="Principal activity" hint="The IRS's categories. Each asks its own follow-up.">
            <Select
              value={e.activity.category || null}
              onChange={(v) => v !== e.activity.category && setE({ activity: { category: v } })}
              options={EIN_ACTIVITIES.map((a) => ({ value: a.value, label: a.label, hint: a.hint }))}
              label="Principal activity"
            />
          </Field>
          {qs.map((q) => (
            <ActivityField key={q.key} q={q} value={e.activity[q.key] ?? ""} onChange={(v) => setE({ activity: { ...e.activity, [q.key]: v } })} />
          ))}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
            <Field label="What it sells, makes or does" hint="SS-4 line 17, in a few words." className="sm:col-span-8">
              <Input value={e.activityDetail} onChange={(x) => setE({ activityDetail: x.target.value })} maxLength={200} placeholder="Holds and manages family investments" />
            </Field>
            <Field label="Trade name" optional hint="If it goes by another name." className="sm:col-span-4">
              <Input value={e.tradeName} onChange={(x) => setE({ tradeName: x.target.value })} />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Reason and tax year">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
          <Field label="Reason for applying" className="sm:col-span-6">
            <Select value={e.reason} onChange={(v) => setE({ reason: v })} options={EIN_REASONS.map(([v, l]) => ({ value: v, label: l }))} label="Reason for applying" />
          </Field>
          {followsOwners ? (
            <div className="flex flex-col gap-2 sm:col-span-6">
              <span className="text-small font-medium text-ink">Tax year ends</span>
              <span className="text-body text-ink">{MONTHS[e.fiscalYearEndMonth - 1]}</span>
            </div>
          ) : (
            <Field label="Tax year ends" className="sm:col-span-6">
              <Select value={String(e.fiscalYearEndMonth)} onChange={(v) => setE({ fiscalYearEndMonth: Number(v) })} options={months} label="Tax year ends" />
            </Field>
          )}
          {e.reason === "other" && (
            <Field label="The reason" className="sm:col-span-12">
              <Input value={e.reasonDetail} onChange={(x) => setE({ reasonDetail: x.target.value })} placeholder="Compliance with state reporting requirements" />
            </Field>
          )}
          {followsOwners && (
            <div className="sm:col-span-12">
              <Note>As {taxWords(taxOutcome(d).value)} it generally uses its owners&rsquo; tax year, which for people and grantor trusts is the calendar year (§706(b), §1378).</Note>
              <Disclosure label="Use another month" defaultOpen={e.fiscalYearEndMonth !== 12}>
                <div className="flex flex-col gap-2 pt-2">
                  <Note>Only with a §444 election or the IRS&rsquo;s approval, or when its owners use that year themselves. Ask your CPA first.</Note>
                  <Field label="Tax year ends">
                    <Select value={String(e.fiscalYearEndMonth)} onChange={(v) => setE({ fiscalYearEndMonth: Number(v) })} options={months} label="Tax year ends" />
                  </Field>
                </div>
              </Disclosure>
            </div>
          )}
        </div>
      </Card>

      <Card title="Employees">
        <div className="flex flex-col gap-4">
          <Note>Expected in the next 12 months.</Note>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-12">
            <Field label="Non-agricultural" className="sm:col-span-4">
              <Input inputMode="numeric" value={e.employees.other} onChange={(x) => setE({ employees: { ...e.employees, other: x.target.value } })} className="tabular-nums" />
            </Field>
            <Field label="Agricultural" className="sm:col-span-4">
              <Input inputMode="numeric" value={e.employees.agricultural} onChange={(x) => setE({ employees: { ...e.employees, agricultural: x.target.value } })} className="tabular-nums" />
            </Field>
            {employees > 0 && (
              <Field label="First wages paid" className="col-span-2 sm:col-span-4">
                <DateInput value={e.wageDate || null} onChange={(iso) => setE({ wageDate: iso ?? "" })} />
              </Field>
            )}
          </div>
          {employees > 0 && (
            <Checkbox
              checked={e.form944}
              onChange={(form944) => setE({ form944 })}
              label="File Form 944 once a year"
              hint="Instead of Form 941 each quarter. For small payrolls: about $1,000 or less in employment tax a year."
            />
          )}
        </div>
      </Card>

      <Card title={llc ? "Members, for the IRS" : "Kind of corporation"}>
        {llc ? (
          <Field label="Number of members" optional hint={`Left blank: ${Math.max(1, d.owners.length)}, from the owners listed.`}>
            <Input
              inputMode="numeric"
              value={e.memberCount}
              onChange={(x) => setE({ memberCount: x.target.value })}
              placeholder={String(Math.max(1, d.owners.length))}
              className="max-w-[160px] tabular-nums"
            />
          </Field>
        ) : (
          <Field label="A special kind" optional hint="C or S comes from How it's taxed, above.">
            <Select
              value={e.corporationSubtype && e.corporationSubtype !== "corporation" && e.corporationSubtype !== "s_corporation" ? e.corporationSubtype : "none"}
              onChange={(v) => setE({ corporationSubtype: v === "none" ? "" : v })}
              options={[{ value: "none", label: "None of these" }, ...CORPORATION_SUBTYPES.filter(([v]) => v !== "corporation" && v !== "s_corporation").map(([v, l]) => ({ value: v, label: l }))]}
              label="A special kind"
            />
          </Field>
        )}
      </Card>

      <Card title="The IRS's other questions">
        <div className="flex flex-col gap-3">
          <Checkbox checked={e.hasPreviousEin} onChange={(v) => setE({ hasPreviousEin: v })} label="It has had an EIN before" />
          {e.hasPreviousEin && (
            <Field label="Previous EIN" className="max-w-[240px]">
              <Input value={e.previousEin} onChange={(x) => setE({ previousEin: x.target.value })} placeholder="12-3456789" className="tabular-nums" />
            </Field>
          )}
          <Checkbox checked={e.ownsHighwayVehicle} onChange={(v) => setE({ ownsHighwayVehicle: v })} label="It owns a highway vehicle of 55,000 lb or more" />
          <Checkbox checked={e.involvesGambling} onChange={(v) => setE({ involvesGambling: v })} label="It involves gambling or wagering" />
          <Checkbox checked={e.filesForm720} onChange={(v) => setE({ filesForm720: v })} label="It files Form 720 (federal excise tax)" />
          <Checkbox checked={e.involvesAtf} onChange={(v) => setE({ involvesAtf: v })} label="It sells or makes alcohol, tobacco or firearms" />
        </div>
      </Card>

      <Card title="Where the IRS reaches it">
        <div className="flex flex-col gap-4">
          <Field label="Phone for the IRS" optional className="max-w-[280px]" hint={d.phone ? `Left blank: ${format.phone(d.phone)}.` : undefined}>
            <Input type="tel" value={e.phone} onChange={(x) => setE({ phone: x.target.value })} />
          </Field>
          <Checkbox
            checked={!!e.mailing}
            onChange={(on) => setE({ mailing: on ? { ...EMPTY_ADDRESS } : null })}
            label="IRS mail goes to a different address"
            hint={`Otherwise to ${d.mailing ? "the mailing address" : "the principal office"}.`}
          />
          {e.mailing && <AddressFields value={e.mailing} onChange={(mailing) => setE({ mailing })} />}
        </div>
      </Card>
    </>
  );
}

function StateStep({ ctx, extras }: { ctx: Ctx; extras: ExtraField[] }) {
  const { draft: d, set, state } = ctx;
  const put = (key: string, v: unknown) => set({ extra: { ...d.extra, [key]: v } });
  return (
    <Card>
      <div className="flex flex-col gap-6">
        {extras.map((f) => {
          const copy = stateQuestionCopy(f, state);
          const v = d.extra[f.key];
          if (f.type === "boolean") {
            return (
              <div key={f.key} className="flex flex-col gap-2">
                <YesNo label={`${copy.label}${f.required ? "" : " (optional)"}`} value={v === true ? "yes" : v === false ? "no" : ""} onChange={(x) => put(f.key, x === "yes")} />
                <Note>{copy.hint}</Note>
              </div>
            );
          }
          if (f.type === "enum") {
            return (
              <Field key={f.key} label={copy.label} optional={!f.required} hint={copy.hint}>
                <Select value={typeof v === "string" && v ? v : null} onChange={(x) => put(f.key, x)} options={f.options.map((o) => ({ value: o, label: pretty(o) }))} label={copy.label} />
              </Field>
            );
          }
          if (copy.long) {
            return (
              <Field key={f.key} label={copy.label} optional={!f.required} hint={copy.hint}>
                <Textarea value={String(v ?? "")} onChange={(e) => put(f.key, e.target.value)} rows={4} />
              </Field>
            );
          }
          return (
            <Field key={f.key} label={copy.label} optional={!f.required} hint={copy.hint}>
              <Input
                inputMode={f.type === "number" ? "decimal" : undefined}
                value={String(v ?? "")}
                onChange={(e) => put(f.key, f.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
              />
            </Field>
          );
        })}
      </div>
    </Card>
  );
}

// ── Review ───────────────────────────────────────────────────────────────

function ReviewStep({
  ctx,
  steps,
  problems,
  validation,
  canFile,
  attest,
  onAttest,
  onEdit,
}: {
  ctx: Ctx;
  steps: StepMeta[];
  problems: DraftProblem[];
  validation: Validation | null | "checking";
  canFile: boolean;
  attest: { articles: boolean; ss4: boolean };
  onAttest: (a: { articles: boolean; ss4: boolean }) => void;
  onEdit: (k: StepKey) => void;
}) {
  const { draft: d, set, llc, state, fee, mode, me, entities, payer } = ctx;
  const has = (k: StepKey) => steps.some((s) => s.key === k);
  const role = llc ? "organizer" : "incorporator";
  const filer = (o: FormationParty) => (o.kind === "person" ? personName(o.name) : `${o.entityName.trim()}, by ${o.signerName.trim()}${o.signerCapacity.trim() ? `, ${o.signerCapacity.trim()}` : ""}`);
  const e = d.ein;
  const activity = e ? EIN_ACTIVITIES.find((a) => a.value === e.activity.category) : null;
  const tax = taxOutcome(d);
  const due = electionDeadline(d);
  const edit = (items: [string, StepKey][]) => (
    <Menu
      label="Edit"
      align="end"
      trigger={
        <Button variant="quiet" size="sm" icon="edit">
          Edit
        </Button>
      }
      items={items.filter(([, k]) => has(k)).map(([l, k]) => ({ label: l, onSelect: () => onEdit(k) }))}
    />
  );
  const phoneText = (p: string) => (p.trim() ? format.phone(p) : "");
  const extras = ctx.requirements?.extra ?? [];
  const publicAnswers = extras.filter((f) => d.extra[f.key] !== undefined && d.extra[f.key] !== "");
  const errors = validation && validation !== "checking" ? validation.errors : [];
  const warnings = validation && validation !== "checking" ? (validation.warnings ?? []) : [];
  const signerName = me?.name ?? "";
  return (
    <>
      <Card title="Before you file">
        <Rows>
          <Row label="Estimated cost">{fee?.total != null ? `About ${money(fee.total, fee.currency)}` : fee ? "Not priced yet" : "Pricing with Palm…"}</Row>
          <Row label="Palm's check" hint={errors.length ? undefined : "Palm runs the state's own rules over the filing, without filing anything."}>
            {problems.length ? (
              <Status tone="neutral">Runs once everything is finished</Status>
            ) : validation === "checking" || validation === null ? (
              <Status tone="neutral">Checking…</Status>
            ) : validation.ok ? (
              <Status tone="positive" shape>
                {validation.skipped ? "Palm checks it when it's filed" : `Meets ${state}'s rules`}
              </Status>
            ) : (
              <Status tone="negative" shape>
                {format.count(errors.length, "problem")}
              </Status>
            )}
          </Row>
          <Row label="Mode">
            {mode === "live" ? (
              <div className="flex flex-col gap-1">
                <Status tone="warning">Files for real</Status>
                <span className="text-small text-ink-2">{state} receives it, and Palm bills the office&rsquo;s account. You confirm before anything is sent.</span>
              </div>
            ) : mode === "test" ? (
              <div className="flex flex-col gap-1">
                <Status tone="info">Test mode</Status>
                <span className="text-small text-ink-2">Nothing reaches the state and nothing is billed. The entity is created here as a test.</span>
              </div>
            ) : mode === "off" ? (
              <Status tone="negative">Not set up</Status>
            ) : (
              <Status tone="neutral">Checking…</Status>
            )}
          </Row>
          <Row label="Who files">{canFile ? `You${signerName ? `, ${signerName},` : ""} as ${role}` : "Only an owner or admin can file"}</Row>
        </Rows>
        {(problems.length > 0 || errors.length > 0 || warnings.length > 0) && (
          <CardSection title={problems.length ? "Still to finish" : "What Palm found"}>
            <ul className="flex flex-col divide-y divide-line">
              {problems.map((p, i) => (
                <li key={`p${i}`} className="flex items-center gap-3 py-2">
                  <span className="text-warning">
                    <Icon name="warning" size={16} />
                  </span>
                  <span className="min-w-0 flex-1 text-body text-ink">{p.text}</span>
                  <Button variant="quiet" size="sm" onClick={() => onEdit(p.step)} aria-label={`Fix: ${p.text}`}>
                    Fix
                  </Button>
                </li>
              ))}
              {!problems.length &&
                errors.map((x, i) => (
                  <li key={`e${i}`} className="flex items-start gap-3 py-2 text-body text-ink">
                    <span className="mt-[2px] text-negative">
                      <Icon name="error" size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      {x.field ? <span className="font-medium">{pretty(x.field.replace(/^\/|\//g, " ").trim())}: </span> : null}
                      {x.message}
                    </span>
                  </li>
                ))}
              {!problems.length &&
                warnings.map((x, i) => (
                  <li key={`w${i}`} className="flex items-start gap-3 py-2 text-body text-ink">
                    <span className="mt-[2px] text-warning">
                      <Icon name="warning" size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      {x.field ? <span className="font-medium">{pretty(x.field.replace(/^\/|\//g, " ").trim())}: </span> : null}
                      {x.message}
                    </span>
                  </li>
                ))}
            </ul>
          </CardSection>
        )}
      </Card>

      <Card
        title="On the public filing"
        action={edit([
          ["Name and state", "entity"],
          ["Addresses and purpose", "business"],
          [llc ? "Organizer" : "Incorporator", "filers"],
          ["Registered agent", "agent"],
          ...(has("state") ? ([[`${state}'s questions`, "state"]] as [string, StepKey][]) : []),
        ])}
      >
        <Note className="mb-2">The state publishes the articles. This is what they carry.</Note>
        <Rows>
          <Row label="Name">{d.legalName.trim()}</Row>
          <Row label="Kind">{llc ? `Limited liability company, ${d.managed === "managers" ? "manager-managed" : "member-managed"}` : "Corporation"}</Row>
          <Row label="State">{state}</Row>
          <Row label="Takes effect">{d.effectiveDate ? format.date(d.effectiveDate, "medium") : "When the state accepts it"}</Row>
          <Row label="Principal office">{`${addressLine(d.principal)}${d.principal.county ? ` (${d.principal.county} County)` : ""}`}</Row>
          <Row label="Mailing address">{d.mailing ? addressLine(d.mailing) : "Same as the principal office"}</Row>
          <Row label="Registered agent" hint={d.agent.provider === "palm" ? "Its legal name and address are filled in by Palm." : undefined}>
            {d.agent.provider === "palm" ? `Palm's provider in ${state}` : `${agentName(d)}, ${addressLine(d.agent.address)}`}
          </Row>
          <Row label={d.organizers.length > 1 ? `${llc ? "Organizers" : "Incorporators"}` : llc ? "Organizer" : "Incorporator"}>
            <div className="flex flex-col gap-1">
              {d.organizers.map((o, i) => (
                <span key={i}>
                  {filer(o)}
                  <span className="block text-small text-ink-2">{o.address ? addressLine(o.address) : `${addressLine(d.principal)} (the principal office)`}</span>
                </span>
              ))}
            </div>
          </Row>
          <Row label="Purpose">{d.purpose}</Row>
          {!llc && (
            <Row label="Authorized stock">
              {d.stock.multiClass
                ? d.stock.classes.map((c) => `${c.name}: ${num(c.authorized).toLocaleString("en-US")} shares${c.par ? ` at $${c.par} par` : ", no par"}`).join("; ")
                : `${num(d.stock.total).toLocaleString("en-US")} shares, ${d.stock.hasPar ? `$${d.stock.par} par` : "no par value"}`}
            </Row>
          )}
          {publicAnswers.map((f) => {
            const copy = stateQuestionCopy(f, state);
            const v = d.extra[f.key];
            return (
              <Row key={f.key} label={copy.label}>
                {v === true ? "Yes" : v === false ? "No" : f.type === "enum" ? pretty(String(v)) : String(v)}
              </Row>
            );
          })}
        </Rows>
      </Card>

      <Card
        title="Sent with the filing, not printed"
        action={edit([
          ["Business contact", "business"],
          ["Members and managers", "ownership"],
          [llc ? "Organizer" : "Incorporator", "filers"],
          ["EIN application", "ein"],
        ])}
      >
        <Note className="mb-2">The state keeps these in its file; it doesn&rsquo;t print them on the articles.</Note>
        <Rows>
          <Row label="Business email">{d.email}</Row>
          {d.phone && <Row label="Business phone">{phoneText(d.phone)}</Row>}
          {d.website && <Row label="Website">{d.website}</Row>}
          {d.organizers.some((o) => o.email || o.phone) && (
            <Row label={`${llc ? "Organizer" : "Incorporator"} contact`}>
              {d.organizers
                .map((o) => [o.email, phoneText(o.phone)].filter(Boolean).join(" · "))
                .filter(Boolean)
                .join("; ")}
            </Row>
          )}
          {llc && d.membersRequired !== false && d.owners.length > 0 && (
            <Row label="Members">
              <div className="flex flex-col gap-1">
                {d.owners.map((o, i) => (
                  <span key={i}>
                    {ownerFilingName(o)}
                    {o.title && o.title !== "Member" ? `, ${o.title}` : ""}
                    <span className="block text-small text-ink-2">{[o.address ? addressLine(o.address) : "The principal office", o.email, phoneText(o.phone)].filter(Boolean).join(" · ")}</span>
                  </span>
                ))}
              </div>
            </Row>
          )}
          {llc && d.managed === "managers" && <Row label="Managers">{format.list(d.managers.map((m) => personName(m.name)).filter(Boolean))}</Row>}
          {!llc && d.directors.length > 0 && <Row label="Directors">{format.list(d.directors.map((p) => personName(p.name)))}</Row>}
          {!llc && d.officers.length > 0 && (
            <Row label="Officers">{format.list(d.officers.map((p) => `${personName(p.name)}, ${p.role === "other" ? p.title : OFFICER_ROLES.find(([r]) => r === p.role)?.[1]}`))}</Row>
          )}
          {e ? (
            <Row label="EIN application" hint="Sent on to the IRS by Palm once the state has formed it.">
              <div className="flex flex-col gap-1">
                <span>Responsible party: {[e.responsible.first, e.responsible.middle, e.responsible.last].filter((x) => x.trim()).join(" ")}</span>
                <span className="text-small text-ink-2">
                  {[
                    e.responsible.ssn.trim() ? "SSN or ITIN entered; sent only when you file" : "SSN or ITIN not entered",
                    `${activity?.label ?? ""}${e.activityDetail ? `: ${e.activityDetail}` : ""}`,
                    EIN_REASONS.find(([v]) => v === e.reason)?.[1],
                    `Tax year ends in ${MONTHS[e.fiscalYearEndMonth - 1]}`,
                    llc ? format.count(einMemberCount(d), "member") : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            </Row>
          ) : (
            <Row label="EIN application">Not now</Row>
          )}
        </Rows>
      </Card>

      <Card title="To Palm only" action={edit([["Contact for Palm", "business"]])}>
        <div className="flex flex-col gap-4">
          <Rows>
            <Row label="Contact">{[d.contact.name, d.contact.email, phoneText(d.contact.phone)].filter(Boolean).join(" · ")}</Row>
          </Rows>
          <Field label="Note to Palm" optional hint="Read by Palm's team before they file: a name reservation, timing, anything unusual. Never on the filing.">
            <Textarea value={d.note} maxLength={1500} onChange={(x) => set({ note: x.target.value })} />
          </Field>
        </div>
      </Card>

      <Card
        title="Kept in BFO"
        action={edit([
          ["Shares and contributions", "ownership"],
          ["How it's taxed", "ein"],
        ])}
      >
        <Rows>
          <Row label={llc ? "Shares" : "Shareholders"}>
            {d.owners.length ? (
              <div className="flex flex-col gap-1">
                {d.owners.map((o, i) => (
                  <span key={i} className="flex justify-between gap-3">
                    <span className="min-w-0">{ownerName(o)}</span>
                    <span className="shrink-0 tabular-nums">{format.percent(ownerPercent(o), { decimals: 2, trim: true })}</span>
                  </span>
                ))}
              </div>
            ) : (
              "None listed"
            )}
          </Row>
          {d.owners.some((o) => o.contribution.trim()) && (
            <Row label="Contributions">
              <div className="flex flex-col gap-1">
                {d.owners
                  .filter((o) => o.contribution.trim())
                  .map((o, i) => (
                    <span key={i} className="flex justify-between gap-3">
                      <span className="min-w-0">
                        {ownerName(o)}
                        <span className="block text-small text-ink-2">
                          {[o.contributionKind === "property" ? `Property: ${o.contributionNote}` : "Cash", o.contributionDate ? format.date(o.contributionDate, "medium") : ""]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">{money(num(o.contribution) || 0)}</span>
                    </span>
                  ))}
              </div>
            </Row>
          )}
          <Row label="Taxed as" hint={due ? `Form ${due.form} due by ${format.date(due.dueBy, "medium")}${due.estimated ? ", counted from today" : ""}.` : undefined}>
            {`${tax.value}${tax.elected ? " (by election)" : " (the default)"}`}
          </Row>
        </Rows>
      </Card>

      <CostCard ctx={ctx} entities={entities} payer={payer} />

      <Card title="Sign and file">
        <div className="flex flex-col gap-4">
          <Note>
            Palm signs the {llc ? "articles of organization" : "articles of incorporation"} electronically in your name as {role}. Make these statements to file.
          </Note>
          <Checkbox checked={attest.articles} onChange={(v) => onAttest({ ...attest, articles: v })} label={articlesStatement(d, signerName)} />
          {e && <Checkbox checked={attest.ss4} onChange={(v) => onAttest({ ...attest, ss4: v })} label={ss4Statement(d)} />}
        </div>
      </Card>
    </>
  );
}

function CostCard({ ctx, entities, payer }: { ctx: Ctx; entities: Entities; payer: FormationDraft["payer"] }) {
  const { draft: d, set, fee, billed, mode } = ctx;
  const tax = taxOutcome(d);
  const also = expectedCosts(d);
  const spent = billed * (PALM_PRICES.name_eligibility.cents / 100);
  return (
    <Card title="Cost">
      <div className="flex flex-col gap-4">
        <FeeLines fee={fee} />
        {mode === "live" && billed > 0 && (
          <div className="flex justify-between gap-3 text-body text-ink-2">
            <span>Already billed: {format.count(billed, "name check")}</span>
            <span className="tabular-nums">{money(spent)}</span>
          </div>
        )}
        {also.length > 0 && (
          <CardSection title="Also expected, estimated">
            <ul className="flex flex-col gap-1">
              {also.map((c, i) => (
                <li key={i} className="flex justify-between gap-3 text-body text-ink">
                  <span className="min-w-0">{c.label}</span>
                  <span className="shrink-0 text-ink-2 tabular-nums">
                    {c.dollars === null ? (c.per === "year" ? "Yearly" : "Varies") : `${format.money(c.dollars)}${c.per === "year" ? " a year" : " once"}`}
                  </span>
                </li>
              ))}
            </ul>
          </CardSection>
        )}
        <CardSection title="Who pays, and how it's booked">
          <div className="flex flex-col gap-4">
            <Field label="Paid by" hint="Palm bills the office's account; this says which entity bears the cost.">
              <Select
                value={payer.entityId || null}
                onChange={(id) => set({ payer: { ...payer, entityId: id, name: entities.find((x) => x.id === id)?.name ?? "" } })}
                options={entityOptions(entities)}
                label="Paid by"
                placeholder="Choose an entity"
              />
            </Field>
            <ChoiceTiles<FormationDraft["payer"]["treatment"]>
              label="Booked on the new entity as"
              value={payer.treatment}
              onChange={(treatment) => set({ payer: { ...payer, treatment } })}
              options={[
                { value: "contribution", title: "A capital contribution", description: "The payer's investment in it." },
                { value: "advance", title: "An advance to repay", description: "Due to the payer, due from the new entity." },
              ]}
            />
            <Note>{organizationalCostNote(tax.value)}</Note>
          </div>
        </CardSection>
      </div>
    </Card>
  );
}

/** Palm's price: plainly named lines in cents, a hairline, the estimated total (§11.3). */
function FeeLines({ fee, compact = false }: { fee: Fee | null; compact?: boolean }) {
  if (!fee) return <Note>Pricing with Palm…</Note>;
  if (fee.total == null) return <Note>{fee.note ?? "Palm couldn't price this filing yet; the state's fee is billed at cost."}</Note>;
  const foots = feeFoots(fee.total, fee.items);
  return (
    <div className="flex flex-col tabular-nums">
      {fee.items.map((i, k) => (
        <div key={k} className={cx("flex justify-between gap-3 py-1 text-ink", compact ? "text-small" : "text-body")}>
          <span className="min-w-0 text-ink-2">{feeLabel(i, fee.items)}</span>
          <span className="shrink-0">{money(i.amount, fee.currency)}</span>
        </div>
      ))}
      <div className={cx("mt-1 flex justify-between gap-3 border-t border-line-strong pt-2 font-semibold text-ink", compact ? "text-small" : "text-body")}>
        <span>Estimated total</span>
        <span>{money(fee.total, fee.currency)}</span>
      </div>
      {!foots && fee.items.length > 0 && (
        <Note className="mt-1">
          Palm&rsquo;s lines add up to{" "}
          {money(
            fee.items.reduce((n, i) => n + i.amount, 0),
            fee.currency,
          )}
          , not the total it quoted. The receipt on the completed filing is final.
        </Note>
      )}
      {foots && <p className={cx("mt-1 text-ink-2", compact ? "text-caption" : "text-small")}>An estimate until the filing completes; its receipt is final.</p>}
    </div>
  );
}

// ── People ───────────────────────────────────────────────────────────────

function OwnerBlock({ ctx, index, owner: o, onChange, onRemove }: { ctx: Ctx; index: number; owner: FormationOwner; onChange: (next: FormationOwner) => void; onRemove: () => void }) {
  const { entities, llc, rules, draft } = ctx;
  const [other, setOther] = useState<"" | "__company" | "__trust">(() =>
    o.kind === "entity" && !o.entityId && (o.entityName || o.entityKind === "trust") ? (o.entityKind === "trust" ? "__trust" : "__company") : "",
  );
  const path = "initial_governing_persons";
  const must = (k: string) => llc && !!rules[`${path}.${k}`]?.required;
  const shown = (k: string) => llc && (must(k) || !!rules[`${path}.${k}`]);
  const value = o.kind === "person" ? "__person" : o.entityId || other || null;
  const pick = (v: string) => {
    if (v === "__person") {
      setOther("");
      onChange({ ...o, kind: "person", entityId: "", entityName: "", entityKind: "company" });
      return;
    }
    if (v === "__company" || v === "__trust") {
      setOther(v);
      onChange({ ...o, kind: "entity", entityId: "", entityName: "", entityKind: v === "__trust" ? "trust" : "company" });
      return;
    }
    setOther("");
    const e = entities.find((x) => x.id === v);
    // Its address on record when it has its own; otherwise the principal office.
    const own = parseAddress(e?.address);
    onChange({ ...o, kind: "entity", entityId: v, entityName: e?.name ?? "", entityKind: e && isTrust(e) ? "trust" : "company", address: own && !sameAddress(own, draft.principal) ? own : null });
  };
  const trust = o.kind === "entity" && o.entityKind === "trust";
  const name = ownerName(o);
  const word = llc ? "Member" : "Shareholder";
  const options: Option<string>[] = [
    ...entityOptions(entities).map((x) => ({ ...x, group: "In BFO" })),
    { value: "__company", label: "Another company…", group: "Not in BFO" },
    { value: "__trust", label: "A trust…", group: "Not in BFO" },
    { value: "__person", label: "A person…", group: "Not in BFO" },
  ];
  const contribution = num(o.contribution);
  const detailsOpen = !!(o.contribution || o.email || o.phone || o.ssn || o.address) || must("email") || must("phone") || must("title") || must("ssn");
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[1fr_auto] items-end gap-3 sm:grid-cols-[1fr_112px_auto]">
        <Field label={`${word}${draft.owners.length > 1 ? ` ${index + 1}` : ""}`} className="col-span-2 sm:col-span-1">
          <Select value={value} onChange={pick} options={options} label={word} placeholder="Choose who" />
        </Field>
        <Field label="Share">
          <Input value={o.percent} onChange={(e) => onChange({ ...o, percent: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" suffix="%" className="text-right tabular-nums" />
        </Field>
        <IconButton icon="trash" label={`Remove ${name || `${word.toLowerCase()} ${index + 1}`}`} onClick={onRemove} />
      </div>

      {o.kind === "person" && <NameFields value={o.name} onChange={(n) => onChange({ ...o, name: n })} />}
      {o.kind === "entity" && !o.entityId && other === "__company" && (
        <Field label="Company's legal name">
          <Input value={o.entityName} onChange={(e) => onChange({ ...o, entityName: e.target.value })} placeholder="Example Holdings, LLC" autoComplete="off" />
        </Field>
      )}
      {trust && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
          {!o.entityId && (
            <Field label="Trust's name" className="sm:col-span-12">
              <Input value={o.entityName} onChange={(e) => onChange({ ...o, entityName: e.target.value })} placeholder="Example Family Trust" autoComplete="off" />
            </Field>
          )}
          <Field label="Trustee" hint="A trust holds its share through its trustee." className="sm:col-span-7">
            <Input value={o.trustee} onChange={(e) => onChange({ ...o, trustee: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="Dated" optional className="sm:col-span-5">
            <DateInput value={o.trustDate || null} onChange={(iso) => onChange({ ...o, trustDate: iso ?? "" })} />
          </Field>
          {ownerFilingName(o) && <Note className="sm:col-span-12">Named as &ldquo;{ownerFilingName(o)}&rdquo;.</Note>}
        </div>
      )}
      {o.kind === "entity" && !trust && (o.entityId || other === "__company") && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
          <Field label="Signs for it" optional className="sm:col-span-7" hint="Who signs the operating agreement and consents for this member.">
            <Input value={o.signer} onChange={(e) => onChange({ ...o, signer: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="Capacity" optional className="sm:col-span-5">
            <Input value={o.signerTitle} onChange={(e) => onChange({ ...o, signerTitle: e.target.value })} placeholder="Manager" />
          </Field>
        </div>
      )}

      <Disclosure label="Contribution, address and contact" defaultOpen={detailsOpen}>
        <div className="flex flex-col gap-4 pt-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
            <Field label="Initial contribution" optional className="sm:col-span-4" hint="Its opening capital.">
              <MoneyInput value={Number.isNaN(contribution) ? null : contribution} onChange={(v) => onChange({ ...o, contribution: v === null ? "" : String(v) })} />
            </Field>
            <div className="flex flex-col gap-[6px] sm:col-span-4">
              <span className="text-small font-medium text-ink">In</span>
              <Segmented
                label="Contributed in"
                full
                value={o.contributionKind}
                onChange={(contributionKind) => onChange({ ...o, contributionKind })}
                options={[
                  { value: "cash", label: "Cash" },
                  { value: "property", label: "Property" },
                ]}
              />
            </div>
            <Field label="On" optional className="sm:col-span-4">
              <DateInput value={o.contributionDate || null} onChange={(iso) => onChange({ ...o, contributionDate: iso ?? "" })} />
            </Field>
            {o.contributionKind === "property" && (
              <Field label="What property" className="sm:col-span-12">
                <Input value={o.contributionNote} onChange={(e) => onChange({ ...o, contributionNote: e.target.value })} placeholder="100 shares of Example Co." />
              </Field>
            )}
          </div>
          <Note>Contributions set the opening balance sheet and each owner&rsquo;s starting capital account; they stay in BFO.</Note>
          {llc && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
              {shown("title") && (
                <Field label="Title" optional={!must("title")} className="sm:col-span-4">
                  <TitleInput rule={rules[`${path}.title`]} value={o.title} onChange={(title) => onChange({ ...o, title })} placeholder="Member" />
                </Field>
              )}
              <Field label="Email" optional={!must("email")} className={shown("title") ? "sm:col-span-4" : "sm:col-span-6"}>
                <Input type="email" value={o.email} onChange={(e) => onChange({ ...o, email: e.target.value })} />
              </Field>
              <Field label="Phone" optional={!must("phone")} className={shown("title") ? "sm:col-span-4" : "sm:col-span-6"}>
                <Input type="tel" value={o.phone} onChange={(e) => onChange({ ...o, phone: e.target.value })} />
              </Field>
              {o.kind === "person" && must("ssn") && (
                <Field label="SSN" className="sm:col-span-6" hint="The state's portal asks for it. Sent with the filing, never kept in BFO.">
                  <Input type="password" inputMode="numeric" value={o.ssn} onChange={(e) => onChange({ ...o, ssn: e.target.value })} autoComplete="off" />
                </Field>
              )}
            </div>
          )}
          <AddressToggle value={o.address} onChange={(address) => onChange({ ...o, address })} countyRule={rules[`${path}.address.county`]} />
        </div>
      </Disclosure>
    </div>
  );
}

function PartyFields({ ctx, value: o, onChange, onMe }: { ctx: Ctx; value: FormationParty; onChange: (next: FormationParty) => void; onMe?: () => void }) {
  const { rules, draft } = ctx;
  const path = filersKey(draft.entityType);
  const must = (k: string) => !!rules[`${path}.${k}`]?.required;
  const typeRule = rules[`${path}.entity_type`];
  const kinds = typeRule?.options.length ? typeRule.options : ["limited_liability_company", "corporation", "limited_partnership", "general_partnership", "trust", "other"];
  const showTitle = must("title") || !!rules[`${path}.title`];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Who signs"
          value={o.kind}
          onChange={(kind) => onChange({ ...o, kind })}
          options={[
            { value: "person", label: "A person" },
            { value: "entity", label: "A company" },
          ]}
        />
        {onMe && (
          <Button variant="quiet" size="sm" onClick={onMe}>
            Use my name
          </Button>
        )}
      </div>
      {o.kind === "person" ? (
        <NameFields value={o.name} onChange={(name) => onChange({ ...o, name })} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
          <Field label="Company name" className="sm:col-span-8">
            <Input value={o.entityName} onChange={(e) => onChange({ ...o, entityName: e.target.value })} placeholder="Example Holdings, LLC" />
          </Field>
          <Field label="Kind of entity" optional={!must("entity_type")} className="sm:col-span-4">
            <Select value={o.entityType || null} onChange={(v) => onChange({ ...o, entityType: v })} options={kinds.map((v) => ({ value: v, label: pretty(v) }))} label="Kind of entity" />
          </Field>
          <Field label="Signed by" className="sm:col-span-8" hint="The person who signs for the company.">
            <Input value={o.signerName} onChange={(e) => onChange({ ...o, signerName: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="Capacity" className="sm:col-span-4">
            <Input value={o.signerCapacity} onChange={(e) => onChange({ ...o, signerCapacity: e.target.value })} placeholder="Manager" />
          </Field>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
        {showTitle && (
          <Field label="Title" optional={!must("title")} className="sm:col-span-4">
            <TitleInput rule={rules[`${path}.title`]} value={o.title} onChange={(title) => onChange({ ...o, title })} placeholder="Organizer" />
          </Field>
        )}
        <Field label="Email" optional={!must("email")} className={showTitle ? "sm:col-span-4" : "sm:col-span-6"}>
          <Input type="email" value={o.email} onChange={(e) => onChange({ ...o, email: e.target.value })} />
        </Field>
        <Field label="Phone" optional={!must("phone")} className={showTitle ? "sm:col-span-4" : "sm:col-span-6"}>
          <Input type="tel" value={o.phone} onChange={(e) => onChange({ ...o, phone: e.target.value })} />
        </Field>
      </div>
      <AddressToggle
        value={o.address}
        onChange={(address) => onChange({ ...o, address })}
        countyRule={rules[`${path}.address.county`]}
        hint="Otherwise the principal office, which then appears as this address on the public filing."
      />
    </div>
  );
}

/** A manager or director: name, and the details some states ask for. */
function OfficialFields({
  ctx,
  value: p,
  path,
  onChange,
  titleLabel = "Title",
  titlePlaceholder = "Manager",
}: {
  ctx: Ctx;
  value: FormationOfficial;
  path: string;
  onChange: (next: FormationOfficial) => void;
  titleLabel?: string;
  titlePlaceholder?: string;
}) {
  const { rules } = ctx;
  const must = (k: string) => !!rules[`${path}.${k}`]?.required;
  return (
    <div className="flex flex-col gap-4">
      <NameFields value={p.name} onChange={(name) => onChange({ ...p, name })} />
      <Disclosure label={`${titleLabel}, address and contact`} defaultOpen={must("email") || must("phone") || must("ssn") || must("title") || !!(p.email || p.phone || p.ssn || p.address)}>
        <div className="flex flex-col gap-4 pt-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
            <Field label={titleLabel} optional={!must("title")} className="sm:col-span-4">
              <TitleInput rule={rules[`${path}.title`]} value={p.title} onChange={(title) => onChange({ ...p, title })} placeholder={titlePlaceholder} />
            </Field>
            <Field label="Email" optional={!must("email")} className="sm:col-span-4">
              <Input type="email" value={p.email} onChange={(e) => onChange({ ...p, email: e.target.value })} />
            </Field>
            <Field label="Phone" optional={!must("phone")} className="sm:col-span-4">
              <Input type="tel" value={p.phone} onChange={(e) => onChange({ ...p, phone: e.target.value })} />
            </Field>
            {must("ssn") && (
              <Field label="SSN" className="sm:col-span-6" hint="The state's portal asks for it. Sent with the filing, never kept in BFO.">
                <Input type="password" inputMode="numeric" value={p.ssn} onChange={(e) => onChange({ ...p, ssn: e.target.value })} autoComplete="off" />
              </Field>
            )}
          </div>
          <AddressToggle value={p.address} onChange={(address) => onChange({ ...p, address })} countyRule={rules[`${path}.address.county`]} />
        </div>
      </Disclosure>
    </div>
  );
}

function OfficerFields({ ctx, value: p, onChange }: { ctx: Ctx; value: FormationOfficer; onChange: (next: FormationOfficer) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
        <Field label="Office" className="sm:col-span-6">
          <Select
            value={p.role}
            onChange={(role) => onChange({ ...p, role, title: role === "other" ? "" : (OFFICER_ROLES.find(([r]) => r === role)?.[1] ?? "") })}
            options={OFFICER_ROLES.map(([v, l]) => ({ value: v, label: l }))}
            label="Office"
          />
        </Field>
        {p.role === "other" && (
          <Field label="Name of the office" className="sm:col-span-6">
            <Input value={p.title} onChange={(e) => onChange({ ...p, title: e.target.value })} placeholder="Chief investment officer" />
          </Field>
        )}
      </div>
      <OfficialFields
        ctx={ctx}
        value={p}
        path="initial_officers"
        titleLabel="Display title"
        titlePlaceholder={OFFICER_ROLES.find(([r]) => r === p.role)?.[1]}
        onChange={(next) => onChange({ ...p, ...next })}
      />
    </div>
  );
}

/** First, middle, last and suffix on a 12-column grid (address and contact rows share its edges). */
function NameFields({ value: n, onChange }: { value: PersonName; onChange: (next: PersonName) => void }) {
  return (
    <div className="grid grid-cols-2 items-end gap-4 sm:grid-cols-12">
      <Field label="First name" className="sm:col-span-4">
        <Input value={n.first} onChange={(e) => onChange({ ...n, first: e.target.value })} autoComplete="off" />
      </Field>
      <Field label="Middle name" optional className="sm:col-span-2">
        <Input value={n.middle} onChange={(e) => onChange({ ...n, middle: e.target.value })} autoComplete="off" />
      </Field>
      <Field label="Last name" className="sm:col-span-4">
        <Input value={n.last} onChange={(e) => onChange({ ...n, last: e.target.value })} autoComplete="off" />
      </Field>
      <Field label="Suffix" optional className="sm:col-span-2">
        <Input value={n.suffix} onChange={(e) => onChange({ ...n, suffix: e.target.value })} placeholder="Jr." autoComplete="off" />
      </Field>
    </div>
  );
}

/** A title: free text, or the state's list when it has one. */
function TitleInput({ rule, value, onChange, placeholder, id, ...aria }: { rule: FieldRule | undefined; value: string; onChange: (v: string) => void; placeholder?: string; id?: string }) {
  if (rule?.options.length) {
    return <Select id={id} {...aria} value={value || null} onChange={onChange} options={rule.options.map((v) => ({ value: v, label: v }))} label="Title" />;
  }
  return <Input id={id} {...aria} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

function AddressToggle({
  value,
  onChange,
  countyRule,
  hint = "Otherwise the principal office.",
}: {
  value: FormationAddress | null;
  onChange: (next: FormationAddress | null) => void;
  countyRule?: FieldRule;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Checkbox checked={!!value} onChange={(on) => onChange(on ? { ...EMPTY_ADDRESS } : null)} label="A different address" hint={hint} />
      {value && <AddressFields value={value} onChange={onChange} countyRule={countyRule} />}
    </div>
  );
}

const STATE_OPTIONS: Option<string>[] = US_STATES.map(([abbr, name]) => ({ value: abbr, label: name, short: abbr }));

/** An address on the 12-column grid: street and suite, then city, state and ZIP (sharing the 4 and 8 edges), and the county where the state asks. */
function AddressFields({ value: a, onChange, lockRegion, countyRule }: { value: FormationAddress; onChange: (next: FormationAddress) => void; lockRegion?: string; countyRule?: FieldRule }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-12">
      <Field label="Street" className="col-span-2 sm:col-span-8">
        <Input value={a.street1} onChange={(e) => onChange({ ...a, street1: e.target.value })} autoComplete="address-line1" />
      </Field>
      <Field label="Suite or unit" optional className="col-span-2 sm:col-span-4">
        <Input value={a.street2} onChange={(e) => onChange({ ...a, street2: e.target.value })} autoComplete="address-line2" />
      </Field>
      <Field label="City" className="col-span-2 sm:col-span-4">
        <Input value={a.city} onChange={(e) => onChange({ ...a, city: e.target.value })} autoComplete="address-level2" />
      </Field>
      <Field label="State" className="sm:col-span-4">
        <Select value={(lockRegion ?? a.region) || null} disabled={!!lockRegion} onChange={(region) => onChange({ ...a, region })} options={STATE_OPTIONS} label="State" placeholder="Choose" />
      </Field>
      <Field label="ZIP code" className="sm:col-span-4">
        <Input value={a.postal} inputMode="numeric" onChange={(e) => onChange({ ...a, postal: e.target.value })} autoComplete="postal-code" className="tabular-nums" />
      </Field>
      {countyRule && (
        <Field label="County" optional={!countyRule.required} className="col-span-2 sm:col-span-4">
          <Input value={a.county ?? ""} onChange={(e) => onChange({ ...a, county: e.target.value })} />
        </Field>
      )}
    </div>
  );
}

function ActivityField({ q, value, onChange }: { q: ActivityQuestion; value: string; onChange: (v: string) => void }) {
  if (q.kind === "yesno") return <YesNo label={q.label} value={value as "" | "yes" | "no"} onChange={onChange} />;
  if (q.kind === "choice") {
    return (
      <Field label={q.label}>
        <Select value={value || null} onChange={onChange} options={(q.options ?? []).map(([v, l]) => ({ value: v, label: l }))} label={q.label} />
      </Field>
    );
  }
  return (
    <Field label={q.label}>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={q.placeholder} />
    </Field>
  );
}

// ── The filing, as it takes shape ────────────────────────────────────────

/** Which preview rows each step edits: the current ones carry an accent bar. */
const EDITS: Record<string, StepKey> = { name: "entity", effective: "entity", office: "business", mailing: "business", agent: "agent", organizer: "filers", stock: "ownership", members: "ownership" };

/** A preview line: the label over the value, for the narrow column. */
function PreviewRow({ label, on, children }: { label: string; on?: boolean; children: ReactNode }) {
  return (
    <div className={cx("relative flex flex-col gap-[2px] py-2", on && "before:absolute before:inset-y-2 before:-left-5 before:w-[2px] before:bg-accent touch:before:-left-4")}>
      <span className="text-small text-ink-2">{label}</span>
      <span className="text-body break-words text-ink">{children}</span>
    </div>
  );
}

function Preview({ ctx, current }: { ctx: Ctx; current: StepKey }) {
  const { draft: d, llc, state, fee } = ctx;
  const filers = d.organizers.map((o) => (o.kind === "person" ? personName(o.name) : o.entityName.trim())).filter(Boolean);
  const on = (k: keyof typeof EDITS) => EDITS[k] === current;
  const later = <span className="text-ink-3">Not yet</span>;
  const costs = expectedCosts(d).filter((c) => c.dollars !== null && c.dollars > 0);
  return (
    <div className="flex flex-col gap-4">
      <Card title="On the public filing">
        <div className="flex flex-col divide-y divide-line">
          <PreviewRow label="Document">
            {llc ? "Articles of organization" : "Articles of incorporation"}
            {state ? `, ${state}` : ""}
          </PreviewRow>
          <PreviewRow label="Name" on={on("name")}>
            {d.legalName.trim() ? <span className="font-medium">{d.legalName.trim()}</span> : later}
          </PreviewRow>
          <PreviewRow label="Principal office" on={on("office")}>
            {d.principal.street1 ? addressLine(d.principal) : later}
          </PreviewRow>
          {d.mailing && (
            <PreviewRow label="Mailing address" on={on("mailing")}>
              {d.mailing.street1 ? addressLine(d.mailing) : later}
            </PreviewRow>
          )}
          <PreviewRow label="Registered agent" on={on("agent")}>
            {d.agent.provider === "palm" ? `Palm's provider${state ? ` in ${state}` : ""}` : agentName(d) || later}
          </PreviewRow>
          <PreviewRow label={llc ? "Organizer" : "Incorporator"} on={on("organizer")}>
            {filers.length ? format.list(filers) : later}
          </PreviewRow>
          {!llc && (
            <PreviewRow label="Authorized stock" on={on("stock")}>
              {d.stock.multiClass ? format.count(d.stock.classes.length, "class", "classes") : num(d.stock.total) > 0 ? `${num(d.stock.total).toLocaleString("en-US")} shares` : later}
            </PreviewRow>
          )}
          {d.effectiveDate && (
            <PreviewRow label="Takes effect" on={on("effective")}>
              {format.date(d.effectiveDate, "medium")}
            </PreviewRow>
          )}
        </div>
      </Card>

      <Card title="Kept in BFO">
        <div className={cx("relative flex flex-col gap-1", on("members") && "before:absolute before:inset-y-0 before:-left-5 before:w-[2px] before:bg-accent touch:before:-left-4")}>
          {d.owners.length === 0 || d.owners.every((o) => !ownerName(o)) ? (
            <Note>{current === "entity" || current === "business" ? "Members are added in step 3." : "No owners listed."}</Note>
          ) : (
            d.owners.map((o, i) => (
              <div key={i} className="flex justify-between gap-3 text-small text-ink">
                <span className="min-w-0 break-words">{ownerName(o) || "Not chosen yet"}</span>
                <span className="shrink-0 tabular-nums text-ink-2">{Number.isNaN(ownerPercent(o)) ? "" : format.percent(ownerPercent(o), { decimals: 2, trim: true })}</span>
              </div>
            ))
          )}
          <Note className="mt-1">Shares, contributions and the tax classification stay off the filing.</Note>
        </div>
      </Card>

      <Card title="Estimated cost">
        {state ? <FeeLines fee={fee} compact /> : <Note>Priced once there&rsquo;s a state.</Note>}
        {costs.length > 0 && (
          <div className="mt-3 flex flex-col gap-1 border-t border-line pt-3">
            <span className="text-small font-medium text-ink">Also expected</span>
            {costs.map((c, i) => (
              <div key={i} className="flex justify-between gap-3 text-small text-ink-2">
                <span className="min-w-0">{c.label.replace(/,.*$/, "")}</span>
                <span className="shrink-0 tabular-nums">
                  {format.money(c.dollars!)}
                  {c.per === "year" ? " a year" : " once"}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
