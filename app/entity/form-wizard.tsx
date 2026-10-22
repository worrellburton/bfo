import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getUser, isAdmin } from "../auth";
import { confirmDialog } from "../confirm-dialog";
import {
  activityQuestions,
  addressLine,
  asksMarried,
  CORPORATION_SUBTYPES,
  DEFAULT_PURPOSE,
  DEFAULT_PURPOSE_CORP,
  draftProblems,
  EIN_ACTIVITIES,
  EIN_REASONS,
  einMemberCount,
  EMPTY_ADDRESS,
  EMPTY_NAME,
  emptyDraft,
  emptyEin,
  emptyOfficer,
  emptyOfficial,
  emptyOwner,
  emptyParty,
  emptyStockClass,
  filersKey,
  hasName,
  num,
  OFFICER_ROLES,
  officeAddress,
  ownerName,
  ownerPercent,
  ownersTotal,
  parseAddress,
  personName,
  sameAddress,
  stateName,
  US_STATES,
  type ActivityQuestion,
  type DraftProblem,
  type FieldRule,
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
import { dollars, PALM_PRICES } from "../../lib/palm-pricing";
import { palmCall, PalmUnavailable, type PalmMode } from "../palm";
import { pushId } from "../store";
import { Button, Icon, IconButton, Input, Select, Textarea, useTone } from "./ui";

/**
 * Forming a new entity through Palm. Every field Palm's formation request
 * takes is here, LLC or corporation: the name (checked with the state as it's
 * typed), the business and its addresses, who owns it and how much (an LLC's
 * managers; a corporation's stock, directors and officers), who signs the
 * articles, the registered agent, and the EIN application with every
 * follow-up the IRS asks. What a state requires on top (a county, an
 * organizer's email, its own fields) comes from Palm's requirement schema and
 * is asked where it belongs.
 *
 * On a wide screen the steps run down the left and the filing takes shape on
 * the right as it's filled in. Nothing is filed until the last step's
 * confirmation, which spells out the state, the cost and, in live mode, that
 * it can't be undone.
 */

type ExtraField = { key: string; label: string; description: string | null; type: "string" | "number" | "boolean" | "enum"; options: string[]; required: boolean };
type Requirements = { supported: boolean; expeditedTiers: string[]; extra: ExtraField[]; rules: StateRules };
type NameCheck = { eligible: boolean; compliant: boolean; available: boolean; violations: { severity: string; message: string }[]; alternatives: string[] };
type Fee = { total: number | null; currency: string; items: { kind: string; name: string; amount: number }[]; expeditedTiers: { tier: string; amount: number }[]; note?: string };
type Issue = { field: string | null; message: string };
type Validation = { ok: boolean; errors: Issue[]; warnings?: Issue[]; skipped?: boolean };
type Entities = { id: string; name: string; address?: string }[];

const TIER_LABEL: Record<string, string> = { expedited: "Expedited", "24_hour": "24 hours", same_day: "Same day", "3_hour": "3 hours", "2_hour": "2 hours", "1_hour": "1 hour" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** The owners' colors, in order: the donut and their cards share them. */
const SLICE = ["#818cf8", "#34d399", "#fbbf24", "#f472b6", "#38bdf8", "#a78bfa", "#fb923c", "#4ade80"];

const money = (n: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
const pretty = (v: string) => v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

type StepMeta = { key: StepKey; label: string; title: (llc: boolean) => string; lede: (llc: boolean) => string; glyph: GlyphName };

const STEPS: StepMeta[] = [
  { key: "entity", label: "Entity", glyph: "building", title: () => "What are we forming?", lede: () => "The kind of entity, where it's formed, and its name, checked with the state as you type." },
  { key: "business", label: "Business", glyph: "pin", title: () => "Where it does business", lede: () => "Its office, how to reach it, and what it's for. Palm's contact never appears on the filing." },
  { key: "ownership", label: "Ownership", glyph: "pie", title: (llc) => (llc ? "Who owns it, and who runs it" : "Shares, shareholders and the board"), lede: (llc) => (llc ? "The members and their shares. Palm drafts the operating agreement from this list." : "The stock the articles authorize, who holds it, and the first directors and officers.") },
  { key: "filers", label: "Signers", glyph: "pen", title: (llc) => (llc ? "Who signs the articles" : "Who incorporates it"), lede: (llc) => `The ${llc ? "organizer" : "incorporator"} executes the articles. Their address defaults to the principal office.` },
  { key: "agent", label: "Agent", glyph: "shield", title: () => "Registered agent", lede: () => "Who accepts legal papers for it in the state. Palm can serve, and forwards what arrives into BFO." },
  { key: "ein", label: "EIN", glyph: "receipt", title: () => "Federal tax ID", lede: () => "Palm files Form SS-4 with the IRS once the state has formed it, answering exactly what the IRS's own form asks." },
  { key: "state", label: "State", glyph: "flag", title: () => "What the state asks", lede: () => "Questions only this state's filing has." },
  { key: "review", label: "Review", glyph: "check", title: () => "Review and file", lede: () => "Everything Palm will send, what it costs, and Palm's own check of the filing." },
];

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
  const t = useTone();
  const me = getUser();
  const [office] = useState(() => officeAddress(entities.map((e) => e.address)));
  const [draft, setDraft] = useState<FormationDraft>(() => {
    const d = emptyDraft();
    if (office) d.principal = { ...office };
    d.contact = { name: me?.name ?? "", email: me?.email ?? "", phone: me?.phone ?? "" };
    d.email = me?.email ?? "";
    const [first = "", ...rest] = (me?.name ?? "").trim().split(/\s+/);
    d.organizers = [emptyParty("Organizer", { first, last: rest.join(" ") })];
    // Most new entities are owned by one already here: start with that row to fill in.
    if (entities.length) d.owners = [emptyOwner("entity", "100")];
    return d;
  });
  const [stepAt, setStepAt] = useState(0);
  const [reached, setReached] = useState(0);
  const [mode, setMode] = useState<PalmMode | null | "off">(null);
  const [requirements, setRequirements] = useState<Requirements | null>(null);
  const [nameCheck, setNameCheck] = useState<NameCheck | null | "checking">(null);
  const nameChecks = useRef(new Map<string, NameCheck>());
  const [fee, setFee] = useState<Fee | null>(null);
  const [validation, setValidation] = useState<Validation | null | "checking">(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  /** One key per attempt at this filing, so a retry after a dropped connection never files twice. */
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [assetId] = useState(() => pushId());
  const scroller = useRef<HTMLDivElement>(null);

  const set = (patch: Partial<FormationDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const llc = draft.entityType === "llc";
  const state = stateName(draft.jurisdiction);
  const region = draft.jurisdiction.slice(3);
  const rules = requirements?.rules ?? {};
  const extras = requirements?.extra ?? [];
  const problems = useMemo(() => draftProblems(draft, rules, extras), [draft, rules, extras]);
  const canFile = isAdmin(me);

  const steps = STEPS.filter((s) => s.key !== "state" || extras.length > 0);
  const step = Math.min(stepAt, steps.length - 1);
  const here = steps[step];
  const last = step === steps.length - 1;
  const problemsAt = (k: StepKey) => problems.filter((p) => p.step === k);
  const stepProblems = problemsAt(here.key);

  // Palm's mode decides what the confirmation says.
  useEffect(() => {
    palmCall<{ configured: boolean; mode: PalmMode | null }>("status")
      .then((s) => setMode(s.configured ? s.mode : "off"))
      .catch(() => setMode("off"));
  }, []);

  // Esc closes; the page behind stays put.
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
      .then((r) => live && setRequirements({ ...r, rules: r.rules ?? {} }))
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
    // Palm bills each check: a name already checked isn't asked again.
    const key = `${draft.jurisdiction}|${draft.entityType}|${name.toLowerCase()}`;
    const known = nameChecks.current.get(key);
    if (known) {
      setNameCheck(known);
      return;
    }
    let live = true;
    setNameCheck("checking");
    const timer = window.setTimeout(() => {
      palmCall<NameCheck>("form-name", { jurisdiction: draft.jurisdiction, entityType: draft.entityType, name })
        .then((r) => {
          nameChecks.current.set(key, r);
          if (live) setNameCheck(r);
        })
        .catch(() => live && setNameCheck(null));
    }, 900);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [draft.legalName, draft.jurisdiction, draft.entityType]);

  // The price, as soon as there's a state: it rides along on the right.
  const extraKey = JSON.stringify(draft.extra);
  useEffect(() => {
    if (!/^US-[A-Z]{2}$/.test(draft.jurisdiction)) {
      setFee(null);
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      palmCall<Fee>("form-fee", { jurisdiction: draft.jurisdiction, entityType: draft.entityType, expeditedTier: draft.expeditedTier, extra: draft.extra })
        .then((f) => live && setFee(f))
        .catch(() => live && setFee({ total: null, currency: "USD", items: [], expeditedTiers: [], note: "Couldn't price the filing." }));
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.jurisdiction, draft.entityType, draft.expeditedTier, extraKey]);

  // The review step asks Palm to check the filing, filing nothing.
  const reviewing = here.key === "review";
  useEffect(() => {
    if (!reviewing || problems.length) return;
    let live = true;
    setValidation("checking");
    const timer = window.setTimeout(() => {
      palmCall<Validation>("form-validate", { draft })
        .then((v) => live && setValidation(v))
        .catch((err) => live && setValidation({ ok: false, errors: [{ field: null, message: (err as Error).message }] }));
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [reviewing, draft, problems.length]);

  function go(i: number) {
    const next = Math.max(0, Math.min(i, steps.length - 1));
    setStepAt(next);
    setReached((r) => Math.max(r, next));
    scroller.current?.scrollTo({ top: 0 });
  }

  async function close() {
    if (submitting) return;
    const dirty = draft.legalName.trim() || draft.jurisdiction;
    if (dirty && !(await confirmDialog({ title: "Leave without filing?", message: "What you've entered here is lost.", confirmLabel: "Leave", tone: "danger" }))) return;
    onClose();
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
      expeditedTier: "",
      extra: {},
    });
  }

  async function submit() {
    if (submitting || mode === null || mode === "off") return;
    const live = mode === "live";
    const cost = fee?.total != null ? money(fee.total, fee.currency) : "the state's fee";
    const ok = await confirmDialog({
      title: `File ${draft.legalName.trim()} with ${state}?`,
      message: live
        ? `Palm will file the ${llc ? "articles of organization" : "articles of incorporation"} with the ${state} Secretary of State and bill your Palm account about ${cost}. Once it's with the state this can't be undone.`
        : "Palm is in test mode: nothing is filed with the state and nothing is billed. The entity is created here as a test.",
      details: [
        `${llc ? "LLC" : "Corporation"} in ${state}${draft.expeditedTier ? `, ${TIER_LABEL[draft.expeditedTier] ?? pretty(draft.expeditedTier)} processing` : ""}.`,
        draft.owners.length ? `Owned by ${draft.owners.map((o) => `${ownerName(o)} (${ownerPercent(o)}%)`).join(", ")}.` : "No owners listed.",
        draft.agent.provider === "palm" ? "Palm serves as registered agent." : `${agentName(draft)} serves as registered agent.`,
        draft.ein ? "Palm applies for the EIN once the state has formed it." : "No EIN application.",
      ],
      tone: live ? "danger" : "default",
      confirmLabel: live ? "Yes, file with the state" : "Submit test filing",
      requireText: live ? draft.legalName.trim() : undefined,
    });
    if (!ok) return;
    setSubmitting(true);
    setError("");
    try {
      await palmCall<{ assetId: string; formation: FormationState }>("form-submit", { draft, assetId, stateName: state, mode, idempotencyKey });
      onCreated(assetId);
    } catch (err) {
      const e = err as Error & { code?: string };
      setError(e.message || "Palm couldn't file this.");
      setSubmitting(false);
    }
  }

  const ctx: Ctx = { draft, set, llc, region, state, rules, entities, office, me: me ? { name: me.name ?? "", email: me.email ?? "", phone: me.phone ?? "" } : null, mode };

  const body = (() => {
    switch (here.key) {
      case "entity":
        return <EntityStep ctx={ctx} requirements={requirements} nameCheck={nameCheck} fee={fee} onType={chooseType} />;
      case "business":
        return <BusinessStep ctx={ctx} />;
      case "ownership":
        return <OwnershipStep ctx={ctx} />;
      case "filers":
        return <FilersStep ctx={ctx} />;
      case "agent":
        return <AgentStep ctx={ctx} />;
      case "ein":
        return <EinStep ctx={ctx} />;
      case "state":
        return <StateStep ctx={ctx} extras={extras} />;
      case "review":
        return <ReviewStep ctx={ctx} steps={steps} problems={problems} fee={fee} validation={validation} mode={mode} canFile={canFile} onEdit={(k) => go(steps.findIndex((s) => s.key === k))} />;
    }
  })();

  const canSubmit =
    canFile && mode !== null && mode !== "off" && !problems.length && !!requirements?.supported && validation !== "checking" && validation !== null && (validation.ok || !!validation.skipped) && !submitting;
  const blocked = (here.key === "entity" && requirements !== null && !requirements.supported) || stepProblems.length > 0;
  const progress = Math.round(((step + (blocked ? 0 : 1)) / steps.length) * 100);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center sm:items-center sm:p-5">
      <div className="palette-backdrop absolute inset-0 bg-black/60 backdrop-blur-[3px] max-sm:hidden" onClick={() => void close()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wiz-title"
        className={`palette-panel glass-panel wiz relative flex w-full overflow-hidden border shadow-2xl sm:h-[min(920px,calc(100dvh-2.5rem))] sm:max-w-[1280px] sm:rounded-[22px] ${t.dark ? "text-white" : "text-gray-900"}`}
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        {/* ── The steps ──────────────────────────────────────────────── */}
        <aside className={`relative hidden w-[248px] shrink-0 flex-col border-r lg:flex ${t.line} wiz-rail`}>
          <div className="px-6 pb-5 pt-6">
            <p className={`text-[10.5px] font-semibold uppercase tracking-[0.18em] ${t.muted}`}>Palm formation</p>
            <h2 id="wiz-title" className="mt-1.5 font-brand text-[24px] leading-[1.1] tracking-[-0.01em]">
              Form a new entity
            </h2>
            <ModeBadge mode={mode} />
          </div>
          <ol className="relative flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
            {steps.map((s, i) => {
              const on = i === step;
              const open = i <= reached;
              const issues = problemsAt(s.key).length;
              const done = i < step && !issues;
              return (
                <li key={s.key} className="relative">
                  {i < steps.length - 1 && <span aria-hidden className={`absolute left-[27px] top-[38px] h-[calc(100%-22px)] w-px ${i < step ? "wiz-line-done" : t.dark ? "bg-white/[0.07]" : "bg-gray-200"}`} />}
                  <button
                    type="button"
                    onClick={() => open && go(i)}
                    disabled={!open}
                    aria-current={on ? "step" : undefined}
                    className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors disabled:cursor-default ${on ? (t.dark ? "bg-white/[0.06]" : "bg-gray-900/[0.04]") : open ? `cursor-pointer ${t.hover}` : ""}`}
                  >
                    <span
                      className={`relative z-[1] inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border text-[12px] transition-all ${
                        on
                          ? "wiz-dot-on border-transparent text-white"
                          : done
                            ? t.dark ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-emerald-200 bg-emerald-50 text-emerald-600"
                            : open && issues
                              ? t.dark ? "border-amber-400/30 bg-amber-400/10 text-amber-300" : "border-amber-200 bg-amber-50 text-amber-600"
                              : t.dark ? "border-white/[0.08] bg-[#0d0d10] text-gray-500" : "border-gray-200 bg-white text-gray-400"
                      }`}
                    >
                      {done ? <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.4} /> : <Glyph name={s.glyph} className="h-[15px] w-[15px]" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[13px] font-medium ${on ? t.text : open ? t.soft : t.faint}`}>{s.label}</span>
                      <span className={`block truncate text-[11.5px] ${open && issues && i !== step ? (t.dark ? "text-amber-300/80" : "text-amber-700") : t.faint}`}>
                        {open && issues && i < reached && i !== step ? `${issues} to finish` : stepSummary(s.key, ctx, requirements, fee)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className={`border-t px-6 py-4 ${t.line}`}>
            <div className="flex items-baseline justify-between">
              <span className={`text-[11.5px] ${t.muted}`}>Estimated cost</span>
              <span className={`font-brand text-[18px] tabular-nums ${t.text}`}>{fee?.total != null ? money(fee.total, fee.currency) : "—"}</span>
            </div>
            <div className={`mt-2 h-1 overflow-hidden rounded-full ${t.dark ? "bg-white/[0.06]" : "bg-gray-100"}`}>
              <div className="wiz-progress h-full rounded-full" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </aside>

        {/* ── The step ───────────────────────────────────────────────── */}
        <section className="relative flex min-w-0 flex-1 flex-col">
          {/* Phones and tablets: a progress bar in place of the rail. */}
          <header className={`flex shrink-0 items-center gap-3 border-b px-4 py-3 lg:hidden ${t.line}`}>
            <div className="min-w-0 flex-1">
              <p className={`text-[11px] font-medium uppercase tracking-[0.14em] ${t.muted}`}>
                Step {step + 1} of {steps.length} · {here.label}
              </p>
              <div className={`mt-1.5 h-1 overflow-hidden rounded-full ${t.dark ? "bg-white/[0.06]" : "bg-gray-100"}`}>
                <div className="wiz-progress h-full rounded-full" style={{ width: `${progress}%` }} />
              </div>
            </div>
            <IconButton icon="x" label="Close" onClick={() => void close()} />
          </header>
          <div className="absolute right-4 top-4 z-10 max-lg:hidden">
            <IconButton icon="x" label="Close" onClick={() => void close()} />
          </div>

          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
            <div key={here.key} className="wiz-step mx-auto w-full max-w-[720px] px-5 pb-10 pt-6 sm:px-8 sm:pt-10">
              <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] max-lg:hidden ${t.accent}`}>
                Step {step + 1} of {steps.length}
              </p>
              <h3 className="mt-2 font-brand text-[28px] leading-[1.12] tracking-[-0.015em] sm:text-[34px]">{here.title(llc)}</h3>
              <p className={`mt-2 max-w-[560px] text-[13.5px] leading-relaxed ${t.soft}`}>{here.lede(llc)}</p>
              <div className="mt-7 space-y-5">{body}</div>
            </div>
          </div>

          {(error || (stepProblems.length > 0 && !last && step < reached + 1)) && (
            <div className={`shrink-0 border-t px-5 py-2.5 text-[12.5px] sm:px-8 ${t.line} ${error ? (t.dark ? "text-red-300" : "text-red-600") : t.dark ? "text-amber-300" : "text-amber-700"}`}>
              {error || (
                <>
                  {stepProblems[0].text}
                  {stepProblems.length > 1 && <span className={t.muted}> · {stepProblems.length - 1} more</span>}
                </>
              )}
            </div>
          )}

          <footer className={`flex shrink-0 items-center gap-2 border-t px-4 py-3 sm:px-8 ${t.line}`} style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
            <Button kind="ghost" onClick={() => void close()} disabled={submitting} className="max-sm:hidden">
              Cancel
            </Button>
            <span className="flex-1" />
            {step > 0 && (
              <Button kind="secondary" size="md" onClick={() => go(step - 1)} disabled={submitting}>
                Back
              </Button>
            )}
            {!last ? (
              <button type="button" onClick={() => go(step + 1)} disabled={blocked} className="wiz-cta">
                Continue
                <Icon name="chevronRight" className="h-3.5 w-3.5" strokeWidth={2.2} />
              </button>
            ) : (
              <button type="button" onClick={() => void submit()} disabled={!canSubmit} title={!canFile ? "Only an owner or admin can file" : undefined} className="wiz-cta">
                {submitting ? "Filing…" : mode === "live" ? `File with ${state}` : "Submit test filing"}
              </button>
            )}
          </footer>
        </section>

        {/* ── The filing, as it takes shape ──────────────────────────── */}
        <aside className={`hidden w-[340px] shrink-0 overflow-y-auto border-l p-6 xl:block ${t.line} wiz-preview-bg`}>
          <Preview ctx={ctx} fee={fee} />
        </aside>
      </div>
    </div>,
    document.body
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
  me: { name: string; email: string; phone: string } | null;
  /** Palm's mode: a live name check is billed. */
  mode: PalmMode | null | "off";
};

const agentName = (d: FormationDraft) => (d.agent.provider === "palm" ? "Palm" : d.agent.kind === "person" ? personName(d.agent.name) : d.agent.entityName.trim());

function stepSummary(k: StepKey, { draft: d, llc, state }: Ctx, req: Requirements | null, fee: Fee | null): string {
  switch (k) {
    case "entity":
      return [llc ? "LLC" : "Corporation", state].filter(Boolean).join(" · ") || "Type, state, name";
    case "business":
      return d.principal.city ? `${d.principal.city}, ${d.principal.region}` : "Office and contact";
    case "ownership":
      return d.owners.length ? `${d.owners.length} owner${d.owners.length === 1 ? "" : "s"} · ${ownersTotal(d.owners)}%` : llc ? "Members, managers" : "Stock, board";
    case "filers":
      return d.organizers.map((o) => (o.kind === "person" ? personName(o.name) : o.entityName)).filter(Boolean).join(", ") || (llc ? "Organizers" : "Incorporators");
    case "agent":
      return agentName(d) || "Registered agent";
    case "ein":
      return d.ein ? "Applying" : "Not now";
    case "state":
      return `${req?.extra.length ?? 0} question${req?.extra.length === 1 ? "" : "s"}`;
    case "review":
      return fee?.total != null ? money(fee.total, fee.currency) : "Cost and check";
  }
}

// ── Steps ────────────────────────────────────────────────────────────────

function EntityStep({ ctx, requirements, nameCheck, fee, onType }: { ctx: Ctx; requirements: Requirements | null; nameCheck: NameCheck | null | "checking"; fee: Fee | null; onType: (t: FormationDraft["entityType"]) => void }) {
  const t = useTone();
  const { draft: d, set, llc, state } = ctx;
  const officeState = ctx.office?.region;
  const quick = Array.from(new Set([officeState, "DE", "NV", "WY"].filter(Boolean) as string[])).slice(0, 4);
  const tiers = fee?.expeditedTiers.length ? fee.expeditedTiers : (requirements?.expeditedTiers ?? []).map((tier) => ({ tier, amount: 0 }));
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ChoiceCard on={llc} onPick={() => onType("llc")} glyph="layers" title="LLC" text="Members own it; profits pass through by default. Run by its members or by managers." />
        <ChoiceCard on={!llc} onPick={() => onType("corporation")} glyph="columns" title="Corporation" text="Shares, a board of directors and officers. Taxed as a C corporation unless it elects S." badge="Preview at Palm" />
      </div>

      <Card title="State of formation">
        <div className="space-y-3">
          <Select
            value={d.jurisdiction}
            onChange={(e) => set({ jurisdiction: e.target.value, principal: { ...d.principal, region: d.principal.region || e.target.value.slice(3) }, extra: {}, expeditedTier: "" })}
            className="!h-11 !text-[14px]"
            aria-label="State of formation"
          >
            <option value="">Choose a state</option>
            {US_STATES.map(([abbr, name]) => (
              <option key={abbr} value={`US-${abbr}`}>
                {name}
              </option>
            ))}
          </Select>
          <div className="flex flex-wrap gap-1.5">
            {quick.map((abbr) => (
              <Chip key={abbr} on={d.jurisdiction === `US-${abbr}`} onPick={() => set({ jurisdiction: `US-${abbr}`, principal: { ...d.principal, region: d.principal.region || abbr }, extra: {}, expeditedTier: "" })}>
                {stateName(`US-${abbr}`)}
                {abbr === officeState && <span className={`ml-1 ${t.faint}`}>· our office</span>}
              </Chip>
            ))}
          </div>
          {requirements && !requirements.supported && (
            <Note tone="warn">Palm can't form {llc ? "an LLC" : "a corporation"} in {state} yet.</Note>
          )}
        </div>
      </Card>

      <Card title="Legal name" hint={state ? `As it will appear on the ${state} record, with its ending (${llc ? "LLC, L.L.C." : "Inc., Corp."}).` : undefined}>
        <Input
          value={d.legalName}
          onChange={(e) => set({ legalName: e.target.value })}
          placeholder={llc ? "Example Holdings, LLC" : "Example, Inc."}
          className="!h-12 font-brand !text-[19px]"
          autoFocus
          aria-label="Legal name"
        />
        <div className="mt-2 text-[12px]">
          <NameStatus check={nameCheck} onPick={(n) => set({ legalName: n })} hasState={!!state} price={ctx.mode === "live" ? dollars(PALM_PRICES.name_eligibility.cents) : null} />
        </div>
      </Card>

      <Card title="Timing">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <F label="Effective date" hint="Blank: as soon as the state accepts it.">
            <Input type="date" value={d.effectiveDate} onChange={(e) => set({ effectiveDate: e.target.value })} />
          </F>
          <div>
            <span className={`mb-1.5 block text-[12px] ${t.muted}`}>Processing speed</span>
            {!state ? (
              <p className={`text-[12.5px] ${t.faint}`}>Choose a state first.</p>
            ) : tiers.length ? (
              <div className="flex flex-wrap gap-1.5">
                <Chip on={!d.expeditedTier} onPick={() => set({ expeditedTier: "" })}>
                  Standard
                </Chip>
                {tiers.map((tr) => (
                  <Chip key={tr.tier} on={d.expeditedTier === tr.tier} onPick={() => set({ expeditedTier: tr.tier })}>
                    {TIER_LABEL[tr.tier] ?? pretty(tr.tier)}
                    {tr.amount ? <span className={`ml-1 tabular-nums ${t.muted}`}>+{money(tr.amount, fee?.currency)}</span> : null}
                  </Chip>
                ))}
              </div>
            ) : (
              <p className={`text-[12.5px] ${t.faint}`}>{requirements ? `${state} has no expedited option.` : "Asking Palm…"}</p>
            )}
          </div>
        </div>
      </Card>
    </>
  );
}

function BusinessStep({ ctx }: { ctx: Ctx }) {
  const t = useTone();
  const { draft: d, set, llc, rules, office } = ctx;
  const generic = llc ? DEFAULT_PURPOSE : DEFAULT_PURPOSE_CORP;
  return (
    <>
      <Card
        title="Principal office"
        action={
          office ? (
            <LinkButton onClick={() => set({ principal: { ...office, county: d.principal.county } })} disabled={sameAddress(d.principal, office)}>
              {sameAddress(d.principal, office) ? "Our office address" : "Use our office address"}
            </LinkButton>
          ) : null
        }
      >
        <AddressFields value={d.principal} onChange={(principal) => set({ principal })} countyRule={rules["principal_address.county"]} />
        {office && sameAddress(d.principal, office) && <p className={`mt-2.5 text-[12px] ${t.muted}`}>The address the family's other entities use.</p>}
        <div className={`mt-4 border-t pt-4 ${t.line}`}>
          <ToggleRow on={!!d.mailing} onToggle={() => set({ mailing: d.mailing ? null : { ...EMPTY_ADDRESS } })} title="Mail goes somewhere else" text="A separate mailing address for the filing." />
          {d.mailing && (
            <div className="mt-3">
              <AddressFields value={d.mailing} onChange={(mailing) => set({ mailing })} countyRule={rules["mailing_address.county"]} />
            </div>
          )}
        </div>
      </Card>

      <Card title="Reaching the business">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <F label="Business email" required>
            <Input type="email" value={d.email} onChange={(e) => set({ email: e.target.value })} />
          </F>
          <F label="Business phone" required={!!rules.phone?.required}>
            <Input type="tel" value={d.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="Optional" />
          </F>
          <F label="Website" required={!!rules.website?.required} className="sm:col-span-2">
            <Input value={d.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://" />
          </F>
        </div>
      </Card>

      <Card
        title="Purpose"
        hint="Most states accept the general clause. Some print exactly what you write here on the articles."
        action={d.purpose !== generic ? <LinkButton onClick={() => set({ purpose: generic })}>Use the general clause</LinkButton> : null}
      >
        <Textarea rows={3} value={d.purpose} onChange={(e) => set({ purpose: e.target.value })} aria-label="Purpose" className="!text-[13.5px] leading-relaxed" />
      </Card>

      <Card title="Contact for Palm" hint="Who Palm reaches if the state needs anything. Never on the filing.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <F label="Name" required>
            <Input value={d.contact.name} onChange={(e) => set({ contact: { ...d.contact, name: e.target.value } })} />
          </F>
          <F label="Email" required>
            <Input type="email" value={d.contact.email} onChange={(e) => set({ contact: { ...d.contact, email: e.target.value } })} />
          </F>
          <F label="Phone">
            <Input type="tel" value={d.contact.phone} onChange={(e) => set({ contact: { ...d.contact, phone: e.target.value } })} placeholder="Optional" />
          </F>
        </div>
      </Card>
    </>
  );
}

function OwnershipStep({ ctx }: { ctx: Ctx }) {
  const t = useTone();
  const { draft: d, set, llc, rules } = ctx;
  const setOwner = (i: number, next: FormationOwner) => set({ owners: d.owners.map((x, j) => (j === i ? next : x)) });
  const addOwner = (kind: FormationOwner["kind"]) => {
    const left = Math.max(0, Math.round((100 - ownersTotal(d.owners)) * 100) / 100);
    set({ owners: [...d.owners, { ...emptyOwner(kind, left ? String(left) : ""), title: llc ? "Member" : "Shareholder" }] });
  };
  const total = ownersTotal(d.owners);
  const left = Math.round((100 - total) * 100) / 100;
  return (
    <>
      <Card
        title={llc ? "Members" : "Shareholders"}
        hint={llc ? "They go to Palm as the LLC's members. Palm has no field for the percentages: they're kept here and in the operating agreement." : "Kept here; the shares are issued after the state forms it."}
        action={
          <div className="flex items-center gap-3">
            <LinkButton onClick={() => addOwner("entity")}>+ Entity</LinkButton>
            <LinkButton onClick={() => addOwner("person")}>+ Person</LinkButton>
          </div>
        }
      >
        {d.owners.length === 0 ? (
          <Empty>No owners listed. It sits at the top of the structure.</Empty>
        ) : (
          <div className="space-y-4">
            <div className={`flex items-center gap-5 rounded-2xl border p-4 ${t.line} ${t.dark ? "bg-white/[0.015]" : "bg-gray-50/60"}`}>
              <Donut slices={d.owners.map((o) => ownerPercent(o) || 0)} size={92} label={`${total}%`} sub={total === 100 ? "assigned" : left > 0 ? `${left}% left` : `${-left}% over`} ok={total === 100} />
              <ul className="min-w-0 flex-1 space-y-1.5">
                {d.owners.map((o, i) => (
                  <li key={i} className="flex items-center gap-2 text-[12.5px]">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SLICE[i % SLICE.length] }} />
                    <span className={`min-w-0 flex-1 truncate ${ownerName(o) ? t.text : t.faint}`}>{ownerName(o) || "Unnamed"}</span>
                    <span className={`tabular-nums ${t.soft}`}>{Number.isNaN(ownerPercent(o)) ? "—" : `${ownerPercent(o)}%`}</span>
                  </li>
                ))}
              </ul>
            </div>
            {d.owners.map((o, i) => (
              <OwnerCard key={i} index={i} ctx={ctx} owner={o} onChange={(next) => setOwner(i, next)} onRemove={() => set({ owners: d.owners.filter((_, j) => j !== i) })} />
            ))}
          </div>
        )}
      </Card>

      {llc ? (
        <Card title="Management">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ChoiceCard small on={d.managed === "members"} onPick={() => set({ managed: "members" })} glyph="people" title="Member-managed" text="The owners run it. Most family holding companies." />
            <ChoiceCard small on={d.managed === "managers"} onPick={() => set({ managed: "managers", managers: d.managers.length ? d.managers : [emptyOfficial("Manager")] })} glyph="person" title="Manager-managed" text="Named managers run it; owners may not." />
          </div>
          {d.managed === "managers" && (
            <div className="mt-4 space-y-3">
              {d.managers.map((m, i) => (
                <PersonCard
                  key={i}
                  label={`Manager ${i + 1}`}
                  onRemove={d.managers.length > 1 ? () => set({ managers: d.managers.filter((_, j) => j !== i) }) : undefined}
                >
                  <OfficialFields ctx={ctx} value={m} path="initial_governing_persons" onChange={(next) => set({ managers: d.managers.map((x, j) => (j === i ? next : x)) })} />
                </PersonCard>
              ))}
              <AddRow onClick={() => set({ managers: [...d.managers, emptyOfficial("Manager")] })}>Add a manager</AddRow>
            </div>
          )}
        </Card>
      ) : (
        <>
          <StockCard ctx={ctx} />
          <Card title="Initial directors" hint="The first board. Optional in most states." required={!!rules.initial_directors?.required}>
            <div className="space-y-3">
              {d.directors.length === 0 && <Empty>No directors listed.</Empty>}
              {d.directors.map((p, i) => (
                <PersonCard key={i} label={`Director ${i + 1}`} onRemove={() => set({ directors: d.directors.filter((_, j) => j !== i) })}>
                  <OfficialFields ctx={ctx} value={p} path="initial_directors" titleLabel="Board role" titlePlaceholder="Chair (optional)" onChange={(next) => set({ directors: d.directors.map((x, j) => (j === i ? next : x)) })} />
                </PersonCard>
              ))}
              <AddRow onClick={() => set({ directors: [...d.directors, emptyOfficial()] })}>Add a director</AddRow>
            </div>
          </Card>
          <Card title="Initial officers" hint="President, secretary, treasurer… Optional in most states; some require them." required={!!rules.initial_officers?.required}>
            <div className="space-y-3">
              {d.officers.length === 0 && <Empty>No officers listed.</Empty>}
              {d.officers.map((p, i) => (
                <PersonCard key={i} label={OFFICER_ROLES.find(([r]) => r === p.role)?.[1] ?? "Officer"} onRemove={() => set({ officers: d.officers.filter((_, j) => j !== i) })}>
                  <OfficerFields ctx={ctx} value={p} onChange={(next) => set({ officers: d.officers.map((x, j) => (j === i ? next : x)) })} />
                </PersonCard>
              ))}
              <AddRow onClick={() => set({ officers: [...d.officers, emptyOfficer(d.officers.some((o) => o.role === "president") ? "secretary" : "president")] })}>Add an officer</AddRow>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

function StockCard({ ctx }: { ctx: Ctx }) {
  const t = useTone();
  const { draft: d, set } = ctx;
  const s = d.stock;
  const setS = (patch: Partial<typeof s>) => set({ stock: { ...s, ...patch } });
  const classTotal = s.classes.reduce((n, c) => n + (num(c.authorized) || 0), 0);
  return (
    <Card title="Authorized stock" hint="What the articles let the corporation issue.">
      <Segmented
        value={s.multiClass ? "multi" : "single"}
        onChange={(v) => setS({ multiClass: v === "multi", classes: v === "multi" && !s.classes.length ? [emptyStockClass("Common")] : s.classes })}
        options={[
          ["single", "One class"],
          ["multi", "Several classes"],
        ]}
      />
      {!s.multiClass ? (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <F label="Authorized shares" required>
            <Input inputMode="numeric" value={s.total} onChange={(e) => setS({ total: e.target.value })} className="tabular-nums" />
          </F>
          <F label="Par value per share" required={s.hasPar}>
            <div className="flex items-center gap-2">
              <Input inputMode="decimal" value={s.hasPar ? s.par : ""} disabled={!s.hasPar} onChange={(e) => setS({ par: e.target.value })} placeholder={s.hasPar ? "0.0001" : "No par"} className="tabular-nums" />
            </div>
          </F>
          <F label="Total consideration" hint="What all the shares will bring in, in dollars.">
            <Input inputMode="decimal" value={s.consideration} onChange={(e) => setS({ consideration: e.target.value })} placeholder="Optional" className="tabular-nums" />
          </F>
          <div className="sm:col-span-3">
            <ToggleRow on={!s.hasPar} onToggle={() => setS({ hasPar: !s.hasPar })} title="No par value" text="Shares without a stated minimum price. Some states tax them differently." />
          </div>
          <F label="Rights and restrictions" className="sm:col-span-3" hint="Voting, dividends, preferences. Optional.">
            <Textarea rows={2} value={s.rights} onChange={(e) => setS({ rights: e.target.value })} placeholder="Common stock with one vote per share." />
          </F>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {s.classes.map((c, i) => (
            <PersonCard key={i} label={c.name.trim() || `Class ${i + 1}`} onRemove={s.classes.length > 1 ? () => setS({ classes: s.classes.filter((_, j) => j !== i) }) : undefined}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <F label="Class name" required className="col-span-2">
                  <Input value={c.name} onChange={(e) => setS({ classes: s.classes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder="Preferred Series A" />
                </F>
                <F label="Authorized" required>
                  <Input inputMode="numeric" value={c.authorized} onChange={(e) => setS({ classes: s.classes.map((x, j) => (j === i ? { ...x, authorized: e.target.value } : x)) })} className="tabular-nums" />
                </F>
                <F label="Issued">
                  <Input inputMode="numeric" value={c.issued} onChange={(e) => setS({ classes: s.classes.map((x, j) => (j === i ? { ...x, issued: e.target.value } : x)) })} className="tabular-nums" />
                </F>
                <F label="Par value">
                  <Input inputMode="decimal" value={c.par} onChange={(e) => setS({ classes: s.classes.map((x, j) => (j === i ? { ...x, par: e.target.value } : x)) })} placeholder="No par" className="tabular-nums" />
                </F>
                <F label="Consideration" className="col-span-2 sm:col-span-1">
                  <Input inputMode="decimal" value={c.consideration} onChange={(e) => setS({ classes: s.classes.map((x, j) => (j === i ? { ...x, consideration: e.target.value } : x)) })} className="tabular-nums" />
                </F>
                <F label="Rights and restrictions" className="col-span-2 sm:col-span-4">
                  <Input value={c.rights} onChange={(e) => setS({ classes: s.classes.map((x, j) => (j === i ? { ...x, rights: e.target.value } : x)) })} placeholder="One vote per share" />
                </F>
              </div>
            </PersonCard>
          ))}
          <AddRow onClick={() => setS({ classes: [...s.classes, emptyStockClass()] })}>Add a class</AddRow>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className={`rounded-xl border px-4 py-3 ${t.line}`}>
              <span className={`block text-[11.5px] ${t.muted}`}>Total authorized</span>
              <span className={`font-brand text-[20px] tabular-nums ${t.text}`}>{classTotal.toLocaleString()}</span>
            </div>
            <F label="Total consideration">
              <Input inputMode="decimal" value={s.consideration} onChange={(e) => setS({ consideration: e.target.value })} placeholder="Optional" className="tabular-nums" />
            </F>
          </div>
        </div>
      )}
    </Card>
  );
}

function FilersStep({ ctx }: { ctx: Ctx }) {
  const { draft: d, set, llc, me } = ctx;
  const word = llc ? "Organizer" : "Incorporator";
  const setParty = (i: number, next: FormationParty) => set({ organizers: d.organizers.map((x, j) => (j === i ? next : x)) });
  const [meFirst = "", ...meRest] = (me?.name ?? "").trim().split(/\s+/);
  return (
    <Card title={`${word}s`} hint="At least one. A person, or a company signing through someone.">
      <div className="space-y-3">
        {d.organizers.map((o, i) => (
          <PersonCard
            key={i}
            label={d.organizers.length > 1 ? `${word} ${i + 1}` : word}
            onRemove={d.organizers.length > 1 ? () => set({ organizers: d.organizers.filter((_, j) => j !== i) }) : undefined}
            action={
              me && o.kind === "person" && !hasName(o.name) ? (
                <LinkButton onClick={() => setParty(i, { ...o, name: { ...o.name, first: meFirst, last: meRest.join(" ") }, email: o.email || me.email })}>Me</LinkButton>
              ) : null
            }
          >
            <PartyFields ctx={ctx} value={o} onChange={(next) => setParty(i, next)} />
          </PersonCard>
        ))}
        <AddRow onClick={() => set({ organizers: [...d.organizers, emptyParty(word)] })}>Add another {word.toLowerCase()}</AddRow>
      </div>
    </Card>
  );
}

function AgentStep({ ctx }: { ctx: Ctx }) {
  const t = useTone();
  const { draft: d, set, region, state, rules } = ctx;
  const a = d.agent;
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ChoiceCard on={a.provider === "palm"} onPick={() => set({ agent: { provider: "palm" } })} glyph="shield" title="Palm" text={`Palm serves in ${state || "the state"} and forwards service of process and state mail into BFO.`} badge="Recommended" />
        <ChoiceCard
          on={a.provider === "own"}
          onPick={() =>
            set({
              agent: a.provider === "own" ? a : { provider: "own", kind: "organization", name: { ...EMPTY_NAME }, entityName: "", address: { ...EMPTY_ADDRESS, region }, mailing: null, email: "", phone: "" },
            })
          }
          glyph="person"
          title="Someone else"
          text="An agent you already have in this state."
        />
      </div>
      {a.provider === "own" && (
        <Card title="Your registered agent">
          <Segmented
            value={a.kind}
            onChange={(kind) => set({ agent: { ...a, kind: kind as "person" | "organization" } })}
            options={[
              ["organization", "A company"],
              ["person", "A person"],
            ]}
          />
          <div className="mt-4">
            {a.kind === "person" ? (
              <NameFields value={a.name} onChange={(name) => set({ agent: { ...a, name } })} />
            ) : (
              <F label="Company name" required>
                <Input value={a.entityName} onChange={(e) => set({ agent: { ...a, entityName: e.target.value } })} placeholder="Registered Agents Inc." />
              </F>
            )}
          </div>
          <p className={`mb-2 mt-5 text-[12px] font-medium ${t.soft}`}>Registered office, in {state || "the state"}</p>
          <AddressFields value={{ ...a.address, region }} lockRegion={region} onChange={(address) => set({ agent: { ...a, address } })} countyRule={rules["registered_agent.address.county"]} />
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <F label="Email" required={!!rules["registered_agent.email"]?.required}>
              <Input type="email" value={a.email} onChange={(e) => set({ agent: { ...a, email: e.target.value } })} placeholder="Optional" />
            </F>
            <F label="Phone" required={!!rules["registered_agent.phone"]?.required}>
              <Input type="tel" value={a.phone} onChange={(e) => set({ agent: { ...a, phone: e.target.value } })} placeholder="Optional" />
            </F>
          </div>
          <div className={`mt-4 border-t pt-4 ${t.line}`}>
            <ToggleRow on={!!a.mailing} onToggle={() => set({ agent: { ...a, mailing: a.mailing ? null : { ...EMPTY_ADDRESS } } })} title="Separate mailing address" text="If the agent receives mail somewhere other than the registered office." />
            {a.mailing && (
              <div className="mt-3">
                <AddressFields value={a.mailing} onChange={(mailing) => set({ agent: { ...a, mailing } })} />
              </div>
            )}
          </div>
        </Card>
      )}
    </>
  );
}

function EinStep({ ctx }: { ctx: Ctx }) {
  const t = useTone();
  const { draft: d, set, llc } = ctx;
  const e = d.ein;
  const setE = (patch: Partial<FormationEin>) => e && set({ ein: { ...e, ...patch } });
  const people = useMemo(() => {
    const out: { label: string; name: PersonName }[] = [];
    const add = (name: PersonName) => {
      if (hasName(name) && !out.some((p) => personName(p.name) === personName(name))) out.push({ label: personName(name), name });
    };
    d.owners.forEach((o) => o.kind === "person" && add(o.name));
    d.managers.forEach((m) => add(m.name));
    d.officers.forEach((m) => add(m.name));
    d.organizers.forEach((o) => o.kind === "person" && add(o.name));
    return out;
  }, [d.owners, d.managers, d.officers, d.organizers]);

  if (!e) {
    return (
      <button type="button" onClick={() => set({ ein: { ...emptyEin(), activityDetail: "" } })} className={`wiz-choice group w-full rounded-2xl border p-6 text-left ${t.line}`}>
        <span className="flex items-start gap-4">
          <span className="wiz-glyph inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
            <Glyph name="receipt" className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block text-[15px] font-semibold ${t.text}`}>Apply for an EIN through Palm</span>
            <span className={`mt-1 block text-[13px] leading-relaxed ${t.soft}`}>
              The IRS number it needs for a bank account and tax returns. Palm files Form SS-4 after formation, and the number lands on the record when it's issued.
            </span>
            <span className={`mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium ${t.accent}`}>
              Start the application <Icon name="chevronRight" className="h-3 w-3" strokeWidth={2.2} />
            </span>
          </span>
        </span>
      </button>
    );
  }

  const qs = activityQuestions(e.activity);
  const employees = (num(e.employees.agricultural || "0") || 0) + (num(e.employees.other || "0") || 0);
  return (
    <>
      <ToggleRow on onToggle={() => set({ ein: null })} title="Apply for an EIN through Palm" text="Turn off to skip it for now; it can be done later." boxed />

      <Card title="Responsible party" hint="A person who controls the entity. Their SSN or ITIN goes straight to Palm and is never kept in BFO.">
        {people.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {people.map((p) => (
              <Chip key={p.label} on={personName(p.name) === [e.responsible.first, e.responsible.middle, e.responsible.last].filter((x) => x.trim()).join(" ")} onPick={() => setE({ responsible: { ...e.responsible, first: p.name.first, middle: p.name.middle, last: p.name.last } })}>
                {p.label}
              </Chip>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_88px_1fr_1fr]">
          <F label="First name" required>
            <Input value={e.responsible.first} onChange={(x) => setE({ responsible: { ...e.responsible, first: x.target.value } })} autoComplete="off" />
          </F>
          <F label="Middle">
            <Input value={e.responsible.middle} onChange={(x) => setE({ responsible: { ...e.responsible, middle: x.target.value } })} autoComplete="off" />
          </F>
          <F label="Last name" required>
            <Input value={e.responsible.last} onChange={(x) => setE({ responsible: { ...e.responsible, last: x.target.value } })} autoComplete="off" />
          </F>
          <F label="SSN or ITIN" required>
            <Input type="password" inputMode="numeric" value={e.responsible.ssn} onChange={(x) => setE({ responsible: { ...e.responsible, ssn: x.target.value } })} placeholder="•••-••-••••" autoComplete="off" />
          </F>
        </div>
      </Card>

      <Card title="What it does" hint="The IRS's categories. Each asks its own follow-up.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {EIN_ACTIVITIES.map((a) => (
            <button
              key={a.value}
              type="button"
              aria-pressed={e.activity.category === a.value}
              onClick={() => e.activity.category !== a.value && setE({ activity: { category: a.value } })}
              className={`wiz-choice rounded-xl border px-3 py-2.5 text-left ${e.activity.category === a.value ? "is-on" : t.line}`}
            >
              <span className={`block text-[12.5px] font-medium ${t.text}`}>{a.label}</span>
              <span className={`block truncate text-[11px] ${t.muted}`}>{a.hint}</span>
            </button>
          ))}
        </div>
        {qs.length > 0 && (
          <div className={`mt-4 space-y-4 rounded-xl border p-4 ${t.line} ${t.dark ? "bg-white/[0.015]" : "bg-gray-50/60"}`}>
            {qs.map((q) => (
              <ActivityField key={q.key} q={q} value={e.activity[q.key] ?? ""} onChange={(v) => setE({ activity: { ...e.activity, [q.key]: v } })} />
            ))}
          </div>
        )}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[1fr_220px]">
          <F label="What it sells, makes or does" required hint="SS-4 line 17, in a few words.">
            <Input value={e.activityDetail} onChange={(x) => setE({ activityDetail: x.target.value })} maxLength={200} placeholder="Holds and manages family investments" />
          </F>
          <F label="Trade name (DBA)" hint="If it goes by another name.">
            <Input value={e.tradeName} onChange={(x) => setE({ tradeName: x.target.value })} placeholder="Optional" />
          </F>
        </div>
      </Card>

      <Card title="Why, and the books">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <F label="Reason for applying" required>
            <Select value={e.reason} onChange={(x) => setE({ reason: x.target.value })}>
              {EIN_REASONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </F>
          <F label="Fiscal year ends" required>
            <Select value={e.fiscalYearEndMonth} onChange={(x) => setE({ fiscalYearEndMonth: Number(x.target.value) })}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </Select>
          </F>
          {e.reason === "other" && (
            <F label="The reason" required className="sm:col-span-2">
              <Input value={e.reasonDetail} onChange={(x) => setE({ reasonDetail: x.target.value })} placeholder="Compliance with state reporting requirements" />
            </F>
          )}
        </div>
      </Card>

      <Card title="Employees" hint="Expected in the next 12 months.">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <F label="Non-agricultural">
            <Input inputMode="numeric" value={e.employees.other} onChange={(x) => setE({ employees: { ...e.employees, other: x.target.value } })} className="tabular-nums" />
          </F>
          <F label="Agricultural">
            <Input inputMode="numeric" value={e.employees.agricultural} onChange={(x) => setE({ employees: { ...e.employees, agricultural: x.target.value } })} className="tabular-nums" />
          </F>
          {employees > 0 && (
            <F label="First wages paid" required className="col-span-2 sm:col-span-1">
              <Input type="date" value={e.wageDate} onChange={(x) => setE({ wageDate: x.target.value })} />
            </F>
          )}
        </div>
        {employees > 0 && (
          <div className="mt-4">
            <ToggleRow on={e.form944} onToggle={() => setE({ form944: !e.form944 })} title="File Form 944 annually" text="Instead of Form 941 each quarter. For small payrolls (about $1,000 or less in employment tax a year)." />
          </div>
        )}
      </Card>

      <Card title={llc ? "Members, for the IRS" : "Kind of corporation"}>
        {llc ? (
          <div className="space-y-4">
            <F label="Number of members" hint={`Blank: ${Math.max(1, d.owners.length)}, from the owners listed.`}>
              <Input inputMode="numeric" value={e.memberCount} onChange={(x) => setE({ memberCount: x.target.value })} placeholder={String(Math.max(1, d.owners.length))} className="max-w-[140px] tabular-nums" />
            </F>
            {asksMarried(d) ? (
              <div className={`space-y-4 rounded-xl border p-4 ${t.line}`}>
                <div>
                  <p className={`text-[13px] font-medium ${t.text}`}>Are the two members married to each other?</p>
                  <p className={`mt-0.5 text-[12px] ${t.muted}`}>{stateName(`US-${d.principal.region}`)} is a community-property state, so the IRS asks.</p>
                  <div className="mt-2.5">
                    <YesNo value={e.marriedCouple} onChange={(v) => setE({ marriedCouple: v, llcClassification: v === "yes" ? e.llcClassification : "" })} />
                  </div>
                </div>
                {e.marriedCouple === "yes" && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <ChoiceCard small on={e.llcClassification === "single_member"} onPick={() => setE({ llcClassification: "single_member" })} title="One owner, for tax" text="A disregarded entity: it goes on the couple's return." />
                    <ChoiceCard small on={e.llcClassification === "multi_member"} onPick={() => setE({ llcClassification: "multi_member" })} title="A partnership" text="Files its own partnership return (Form 1065)." />
                  </div>
                )}
              </div>
            ) : (
              einMemberCount(d) === 2 && <p className={`text-[12px] ${t.muted}`}>Outside a community-property state, so the IRS doesn't ask whether the members are married.</p>
            )}
          </div>
        ) : (
          <F label="Corporation type" hint="Blank files it as a plain C corporation.">
            <Select value={e.corporationSubtype} onChange={(x) => setE({ corporationSubtype: x.target.value })}>
              <option value="">C corporation (default)</option>
              {CORPORATION_SUBTYPES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </F>
        )}
      </Card>

      <Card title="The IRS's other questions">
        <div className="space-y-3.5">
          <ToggleRow on={e.hasPreviousEin} onToggle={() => setE({ hasPreviousEin: !e.hasPreviousEin })} title="It has had an EIN before" />
          {e.hasPreviousEin && (
            <F label="Previous EIN" required className="max-w-[220px]">
              <Input value={e.previousEin} onChange={(x) => setE({ previousEin: x.target.value })} placeholder="12-3456789" className="tabular-nums" />
            </F>
          )}
          <ToggleRow on={e.ownsHighwayVehicle} onToggle={() => setE({ ownsHighwayVehicle: !e.ownsHighwayVehicle })} title="Owns a highway vehicle of 55,000 lb or more" />
          <ToggleRow on={e.involvesGambling} onToggle={() => setE({ involvesGambling: !e.involvesGambling })} title="Involves gambling or wagering" />
          <ToggleRow on={e.filesForm720} onToggle={() => setE({ filesForm720: !e.filesForm720 })} title="Files Form 720 (federal excise tax)" />
          <ToggleRow on={e.involvesAtf} onToggle={() => setE({ involvesAtf: !e.involvesAtf })} title="Sells or makes alcohol, tobacco or firearms" />
        </div>
      </Card>

      <Card title="Where the IRS reaches it">
        <F label="Phone for the IRS" className="max-w-[260px]">
          <Input type="tel" value={e.phone} onChange={(x) => setE({ phone: x.target.value })} placeholder={d.phone || "Optional"} />
        </F>
        <div className={`mt-4 border-t pt-4 ${t.line}`}>
          <ToggleRow on={!!e.mailing} onToggle={() => setE({ mailing: e.mailing ? null : { ...EMPTY_ADDRESS } })} title="IRS mail goes somewhere else" text={`Otherwise to ${d.mailing ? "the mailing address" : "the principal office"}.`} />
          {e.mailing && (
            <div className="mt-3">
              <AddressFields value={e.mailing} onChange={(mailing) => setE({ mailing })} />
            </div>
          )}
        </div>
      </Card>
    </>
  );
}

function StateStep({ ctx, extras }: { ctx: Ctx; extras: ExtraField[] }) {
  const { draft: d, set, state } = ctx;
  return (
    <Card title={`${state} only`}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {extras.map((f) => (
          <F key={f.key} label={f.label} hint={f.description ?? undefined} required={f.required} className={f.type === "string" && !f.options.length ? "sm:col-span-2" : ""}>
            {f.type === "boolean" ? (
              <YesNo value={d.extra[f.key] === true ? "yes" : d.extra[f.key] === false ? "no" : ""} onChange={(v) => set({ extra: { ...d.extra, [f.key]: v === "yes" } })} />
            ) : f.type === "enum" ? (
              <Select value={String(d.extra[f.key] ?? "")} onChange={(e) => set({ extra: { ...d.extra, [f.key]: e.target.value } })}>
                <option value="">Choose</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {pretty(o)}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                type={f.type === "number" ? "number" : "text"}
                value={String(d.extra[f.key] ?? "")}
                onChange={(e) => set({ extra: { ...d.extra, [f.key]: f.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value } })}
              />
            )}
          </F>
        ))}
      </div>
    </Card>
  );
}

function ReviewStep({
  ctx,
  steps,
  problems,
  fee,
  validation,
  mode,
  canFile,
  onEdit,
}: {
  ctx: Ctx;
  steps: StepMeta[];
  problems: DraftProblem[];
  fee: Fee | null;
  validation: Validation | null | "checking";
  mode: PalmMode | null | "off";
  canFile: boolean;
  onEdit: (k: StepKey) => void;
}) {
  const t = useTone();
  const { draft: d, set, llc, state } = ctx;
  const filerWord = llc ? "Organizer" : "Incorporator";
  const row = (label: string, value: ReactNode) => (
    <div className="grid grid-cols-[132px_1fr] gap-3 py-1.5 text-[13px]">
      <dt className={t.muted}>{label}</dt>
      <dd className={`min-w-0 whitespace-pre-line break-words ${t.text}`}>{value || "—"}</dd>
    </div>
  );
  const section = (key: StepKey, title: string, rows: ReactNode) =>
    steps.some((s) => s.key === key) ? (
      <section className={`rounded-2xl border px-5 py-4 ${t.line}`}>
        <header className="mb-1 flex items-center justify-between">
          <h4 className={`text-[12px] font-semibold uppercase tracking-[0.12em] ${t.muted}`}>{title}</h4>
          <LinkButton onClick={() => onEdit(key)}>Edit</LinkButton>
        </header>
        <dl>{rows}</dl>
      </section>
    ) : null;
  const e = d.ein;
  const activity = e ? EIN_ACTIVITIES.find((a) => a.value === e.activity.category) : null;
  return (
    <>
      {problems.length > 0 && (
        <div className={`rounded-2xl border px-5 py-4 ${t.dark ? "border-amber-400/25 bg-amber-400/[0.06]" : "border-amber-200 bg-amber-50"}`}>
          <p className={`text-[13px] font-semibold ${t.dark ? "text-amber-200" : "text-amber-800"}`}>Still to finish</p>
          <ul className="mt-2 space-y-1">
            {problems.map((p, i) => (
              <li key={i} className={`flex items-center gap-2 text-[12.5px] ${t.dark ? "text-amber-300" : "text-amber-800"}`}>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                <span className="min-w-0 flex-1">{p.text}</span>
                <LinkButton onClick={() => onEdit(p.step)}>Fix</LinkButton>
              </li>
            ))}
          </ul>
        </div>
      )}

      {section(
        "entity",
        "Entity",
        <>
          {row("Name", <span className="font-brand text-[16px]">{d.legalName.trim()}</span>)}
          {row("Type", llc ? "Limited liability company" : `Corporation${e?.corporationSubtype ? ` (${CORPORATION_SUBTYPES.find(([v]) => v === e.corporationSubtype)?.[1]})` : ""}`)}
          {row("State", state)}
          {row("Effective", d.effectiveDate || "When the state accepts it")}
          {row("Processing", d.expeditedTier ? (TIER_LABEL[d.expeditedTier] ?? pretty(d.expeditedTier)) : "Standard")}
        </>
      )}
      {section(
        "business",
        "Business",
        <>
          {row("Principal office", `${addressLine(d.principal)}${d.principal.county ? ` (${d.principal.county} County)` : ""}`)}
          {row("Mailing", d.mailing ? addressLine(d.mailing) : "Same as the office")}
          {row("Email", d.email)}
          {d.phone && row("Phone", d.phone)}
          {d.website && row("Website", d.website)}
          {row("Purpose", d.purpose)}
          {row("Palm contact", [d.contact.name, d.contact.email, d.contact.phone].filter(Boolean).join(" · "))}
        </>
      )}
      {section(
        "ownership",
        "Ownership",
        <>
          {row(llc ? "Members" : "Shareholders", d.owners.length ? d.owners.map((o) => `${ownerName(o)} · ${ownerPercent(o)}%`).join("\n") : "None listed")}
          {llc && row("Managed by", d.managed === "managers" ? `Managers: ${d.managers.map((m) => personName(m.name)).join(", ")}` : "Its members")}
          {!llc &&
            row(
              "Stock",
              d.stock.multiClass
                ? d.stock.classes.map((c) => `${c.name}: ${num(c.authorized).toLocaleString()} authorized${c.par ? ` at $${c.par}` : ", no par"}`).join("\n")
                : `${num(d.stock.total).toLocaleString()} shares, ${d.stock.hasPar ? `$${d.stock.par} par` : "no par value"}`
            )}
          {!llc && d.directors.length > 0 && row("Directors", d.directors.map((p) => personName(p.name)).join(", "))}
          {!llc && d.officers.length > 0 && row("Officers", d.officers.map((p) => `${personName(p.name)} (${p.role === "other" ? p.title : OFFICER_ROLES.find(([r]) => r === p.role)?.[1]})`).join("\n"))}
        </>
      )}
      {section("filers", `${filerWord}s`, row(d.organizers.length === 1 ? filerWord : `${filerWord}s`, d.organizers.map((o) => `${o.kind === "person" ? personName(o.name) : o.entityName}${o.title ? `, ${o.title}` : ""}`).join("\n")))}
      {section("agent", "Registered agent", row("Agent", d.agent.provider === "palm" ? "Palm" : `${agentName(d)}\n${addressLine(d.agent.address)}`))}
      {section(
        "ein",
        "EIN",
        e ? (
          <>
            {row("Responsible party", [e.responsible.first, e.responsible.middle, e.responsible.last].filter((x) => x.trim()).join(" "))}
            {row("Activity", `${activity?.label ?? ""}${e.activityDetail ? ` · ${e.activityDetail}` : ""}`)}
            {row("Reason", EIN_REASONS.find(([v]) => v === e.reason)?.[1] ?? "")}
            {row("Fiscal year", `Ends in ${MONTHS[e.fiscalYearEndMonth - 1]}`)}
            {llc && row("Members", String(einMemberCount(d)))}
          </>
        ) : (
          row("Application", "Not now")
        )
      )}
      {section(
        "state",
        `${state} questions`,
        <>{Object.entries(d.extra).filter(([, v]) => v !== "" && v !== undefined).map(([k, v]) => <div key={k}>{row(pretty(k), String(v === true ? "Yes" : v === false ? "No" : v))}</div>)}</>
      )}

      <Card title="Cost">
        {!fee ? (
          <p className={`text-[12.5px] ${t.muted}`}>Pricing with Palm…</p>
        ) : fee.total == null ? (
          <p className={`text-[12.5px] ${t.muted}`}>{fee.note ?? "Palm couldn't price this filing yet; the state's fee is billed at cost."}</p>
        ) : (
          <div>
            {fee.items.map((i, idx) => (
              <div key={idx} className={`flex items-center justify-between py-1.5 text-[13px] ${t.soft}`}>
                <span>{pretty(i.name)}</span>
                <span className="tabular-nums">{money(i.amount, fee.currency)}</span>
              </div>
            ))}
            <div className={`mt-1 flex items-baseline justify-between border-t pt-3 ${t.line}`}>
              <span className={`text-[13px] font-medium ${t.text}`}>Estimated total</span>
              <span className={`font-brand text-[24px] tabular-nums ${t.text}`}>{money(fee.total, fee.currency)}</span>
            </div>
          </div>
        )}
        <p className={`mt-2 text-[11.5px] ${t.faint}`}>State fees are estimates until the filing completes; the receipt on the completed filing is final.</p>
      </Card>

      <Card title="Palm's check" hint="Palm runs the state's own rules over the filing, without filing anything.">
        {problems.length ? (
          <p className={`text-[12.5px] ${t.muted}`}>Runs once everything above is finished.</p>
        ) : validation === "checking" || validation === null ? (
          <p className={`wiz-pulse text-[12.5px] ${t.muted}`}>Asking Palm to check the filing…</p>
        ) : (
          <div className="space-y-2">
            {validation.ok ? (
              <p className={`flex items-center gap-2 text-[13px] ${t.dark ? "text-emerald-300" : "text-emerald-700"}`}>
                <Icon name="check" className="h-4 w-4" strokeWidth={2.2} />
                {validation.skipped ? "Palm will check it on submission." : `Meets ${state}'s rules.`}
              </p>
            ) : (
              validation.errors.map((x, i) => (
                <p key={i} className={`text-[12.5px] ${t.dark ? "text-red-300" : "text-red-700"}`}>
                  {x.field ? <span className="font-medium">{x.field.replace(/^\/|\//g, " ").trim()}: </span> : null}
                  {x.message}
                </p>
              ))
            )}
            {(validation.warnings ?? []).map((x, i) => (
              <p key={`w${i}`} className={`text-[12px] ${t.dark ? "text-amber-300/90" : "text-amber-700"}`}>
                {x.field ? <span className="font-medium">{x.field}: </span> : null}
                {x.message}
              </p>
            ))}
          </div>
        )}
      </Card>

      <Card title="Note to Palm" hint="Read by Palm's team before they file: a name reservation, timing, anything unusual. Not on the filing.">
        <Textarea rows={2} value={d.note} maxLength={2000} onChange={(x) => set({ note: x.target.value })} placeholder="Optional" />
      </Card>

      <div
        className={`rounded-2xl border px-5 py-4 text-[12.5px] ${mode === "live" ? (t.dark ? "border-amber-400/30 bg-amber-400/[0.06] text-amber-200" : "border-amber-300 bg-amber-50 text-amber-800") : `${t.line} ${t.muted}`}`}
      >
        {mode === null
          ? "Checking Palm…"
          : mode === "off"
            ? "Palm isn't connected, so nothing can be filed from here."
            : mode === "live"
              ? "Palm is live: filing sends this to the state and bills the Palm account. You'll be asked to confirm."
              : "Palm is in test mode: submitting creates the entity here as a test; nothing reaches the state."}
        {!canFile && <span className="mt-1 block">Only an owner or admin can submit the filing.</span>}
      </div>
    </>
  );
}

// ── People ───────────────────────────────────────────────────────────────

function OwnerCard({ ctx, index, owner: o, onChange, onRemove }: { ctx: Ctx; index: number; owner: FormationOwner; onChange: (next: FormationOwner) => void; onRemove: () => void }) {
  const t = useTone();
  const { entities, llc, rules, draft } = ctx;
  const [typed, setTyped] = useState(() => o.kind === "entity" && !o.entityId && !!o.entityName);
  const path = "initial_governing_persons";
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
    onChange({ ...o, entityId: id, entityName: e?.name ?? "", address: own && !sameAddress(own, draft.principal) ? own : null });
  };
  const must = (k: string) => llc && !!rules[`${path}.${k}`]?.required;
  return (
    <PersonCard
      label={ownerName(o) || `Owner ${index + 1}`}
      dot={SLICE[index % SLICE.length]}
      onRemove={onRemove}
      action={
        <div className="relative w-[96px]">
          <Input value={o.percent} onChange={(e) => onChange({ ...o, percent: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" className="!h-8 pr-6 text-right font-medium tabular-nums" aria-label="Percent owned" />
          <span className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] ${t.muted}`}>%</span>
        </div>
      }
    >
      <Segmented
        value={o.kind}
        onChange={(kind) => onChange({ ...o, kind: kind as FormationOwner["kind"] })}
        options={[
          ["entity", "An entity"],
          ["person", "A person"],
        ]}
        small
      />
      <div className="mt-3">
        {o.kind === "entity" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <F label="Entity" required>
              <Select value={typed ? "__other" : o.entityId} onChange={(e) => pick(e.target.value)}>
                <option value="">Choose…</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
                <option value="__other">Another company…</option>
              </Select>
            </F>
            {typed && (
              <F label="Legal name" required>
                <Input value={o.entityName} onChange={(e) => onChange({ ...o, entityName: e.target.value })} placeholder="Example Holdings, LLC" autoComplete="off" />
              </F>
            )}
          </div>
        ) : (
          <NameFields value={o.name} onChange={(name) => onChange({ ...o, name })} />
        )}
      </div>
      <More
        open={must("email") || must("phone") || must("title") || !!(o.email || o.phone || o.ssn || o.address)}
        label={llc ? "Title, address, contact" : "Address"}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {llc && (
            <F label="Title" required={must("title")}>
              <TitleInput rule={rules[`${path}.title`]} value={o.title} onChange={(title) => onChange({ ...o, title })} placeholder="Member" />
            </F>
          )}
          {llc && (
            <F label="Email" required={must("email")}>
              <Input type="email" value={o.email} onChange={(e) => onChange({ ...o, email: e.target.value })} placeholder="Optional" />
            </F>
          )}
          {llc && (
            <F label="Phone" required={must("phone")}>
              <Input type="tel" value={o.phone} onChange={(e) => onChange({ ...o, phone: e.target.value })} placeholder="Optional" />
            </F>
          )}
          {llc && o.kind === "person" && (
            <F label="SSN" hint="Only if the state's portal asks. Sent to Palm's vault, never kept here.">
              <Input type="password" inputMode="numeric" value={o.ssn} onChange={(e) => onChange({ ...o, ssn: e.target.value })} placeholder="Optional" autoComplete="off" />
            </F>
          )}
        </div>
        <AddressToggle value={o.address} onChange={(address) => onChange({ ...o, address })} countyRule={rules[`${path}.address.county`]} />
      </More>
    </PersonCard>
  );
}

function PartyFields({ ctx, value: o, onChange }: { ctx: Ctx; value: FormationParty; onChange: (next: FormationParty) => void }) {
  const { rules, draft } = ctx;
  const path = filersKey(draft.entityType);
  const must = (k: string) => !!rules[`${path}.${k}`]?.required;
  const typeRule = rules[`${path}.entity_type`];
  return (
    <>
      <Segmented
        value={o.kind}
        onChange={(kind) => onChange({ ...o, kind: kind as FormationParty["kind"] })}
        options={[
          ["person", "A person"],
          ["entity", "A company"],
        ]}
        small
      />
      <div className="mt-3">
        {o.kind === "person" ? (
          <NameFields value={o.name} onChange={(name) => onChange({ ...o, name })} />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <F label="Company name" required>
              <Input value={o.entityName} onChange={(e) => onChange({ ...o, entityName: e.target.value })} placeholder="Example Holdings, LLC" />
            </F>
            <F label="Kind of entity" required={must("entity_type")}>
              {typeRule?.options.length ? (
                <Select value={o.entityType} onChange={(e) => onChange({ ...o, entityType: e.target.value })}>
                  <option value="">Choose</option>
                  {typeRule.options.map((v) => (
                    <option key={v} value={v}>
                      {pretty(v)}
                    </option>
                  ))}
                </Select>
              ) : (
                <Select value={o.entityType} onChange={(e) => onChange({ ...o, entityType: e.target.value })}>
                  <option value="">Not stated</option>
                  {["limited_liability_company", "corporation", "limited_partnership", "general_partnership", "trust", "other"].map((v) => (
                    <option key={v} value={v}>
                      {pretty(v)}
                    </option>
                  ))}
                </Select>
              )}
            </F>
          </div>
        )}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <F label="Title" required={must("title")}>
          <TitleInput rule={rules[`${path}.title`]} value={o.title} onChange={(title) => onChange({ ...o, title })} placeholder="Authorized person" />
        </F>
        <F label="Email" required={must("email")}>
          <Input type="email" value={o.email} onChange={(e) => onChange({ ...o, email: e.target.value })} placeholder="Optional" />
        </F>
        <F label="Phone" required={must("phone")}>
          <Input type="tel" value={o.phone} onChange={(e) => onChange({ ...o, phone: e.target.value })} placeholder="Optional" />
        </F>
      </div>
      <AddressToggle value={o.address} onChange={(address) => onChange({ ...o, address })} countyRule={rules[`${path}.address.county`]} />
    </>
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
    <>
      <NameFields value={p.name} onChange={(name) => onChange({ ...p, name })} />
      <More open={must("email") || must("phone") || must("ssn") || must("title") || !!(p.email || p.phone || p.ssn || p.address)} label={`${titleLabel}, address, contact`}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <F label={titleLabel} required={must("title")}>
            <TitleInput rule={rules[`${path}.title`]} value={p.title} onChange={(title) => onChange({ ...p, title })} placeholder={titlePlaceholder} />
          </F>
          <F label="Email" required={must("email")}>
            <Input type="email" value={p.email} onChange={(e) => onChange({ ...p, email: e.target.value })} placeholder="Optional" />
          </F>
          <F label="Phone" required={must("phone")}>
            <Input type="tel" value={p.phone} onChange={(e) => onChange({ ...p, phone: e.target.value })} placeholder="Optional" />
          </F>
          <F label="SSN" required={must("ssn")} hint="Only if the state's portal asks. Sent to Palm's vault, never kept here.">
            <Input type="password" inputMode="numeric" value={p.ssn} onChange={(e) => onChange({ ...p, ssn: e.target.value })} placeholder="Optional" autoComplete="off" />
          </F>
        </div>
        <AddressToggle value={p.address} onChange={(address) => onChange({ ...p, address })} countyRule={rules[`${path}.address.county`]} />
      </More>
    </>
  );
}

function OfficerFields({ ctx, value: p, onChange }: { ctx: Ctx; value: FormationOfficer; onChange: (next: FormationOfficer) => void }) {
  return (
    <>
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <F label="Office" required>
          <Select value={p.role} onChange={(e) => onChange({ ...p, role: e.target.value, title: e.target.value === "other" ? "" : (OFFICER_ROLES.find(([r]) => r === e.target.value)?.[1] ?? "") })}>
            {OFFICER_ROLES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </F>
        {p.role === "other" && (
          <F label="Name of the office" required>
            <Input value={p.title} onChange={(e) => onChange({ ...p, title: e.target.value })} placeholder="Chief investment officer" />
          </F>
        )}
      </div>
      <OfficialFields ctx={ctx} value={p} path="initial_officers" titleLabel="Display title" titlePlaceholder={OFFICER_ROLES.find(([r]) => r === p.role)?.[1]} onChange={(next) => onChange({ ...p, ...next })} />
    </>
  );
}

function NameFields({ value: n, onChange }: { value: PersonName; onChange: (next: PersonName) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_76px_1fr_76px]">
      <F label="First name" required>
        <Input value={n.first} onChange={(e) => onChange({ ...n, first: e.target.value })} autoComplete="off" />
      </F>
      <F label="Middle">
        <Input value={n.middle} onChange={(e) => onChange({ ...n, middle: e.target.value })} autoComplete="off" />
      </F>
      <F label="Last name" required>
        <Input value={n.last} onChange={(e) => onChange({ ...n, last: e.target.value })} autoComplete="off" />
      </F>
      <F label="Suffix">
        <Input value={n.suffix} onChange={(e) => onChange({ ...n, suffix: e.target.value })} placeholder="Jr." autoComplete="off" />
      </F>
    </div>
  );
}

/** A title: free text, or the state's list when it has one. */
function TitleInput({ rule, value, onChange, placeholder }: { rule: FieldRule | undefined; value: string; onChange: (v: string) => void; placeholder?: string }) {
  if (rule?.options.length) {
    return (
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose</option>
        {rule.options.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </Select>
    );
  }
  return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

function AddressToggle({ value, onChange, countyRule }: { value: FormationAddress | null; onChange: (next: FormationAddress | null) => void; countyRule?: FieldRule }) {
  return (
    <div className="mt-3">
      <ToggleRow on={!!value} onToggle={() => onChange(value ? null : { ...EMPTY_ADDRESS })} title="A different address" text="Otherwise the principal office." />
      {value && (
        <div className="mt-3">
          <AddressFields value={value} onChange={onChange} countyRule={countyRule} />
        </div>
      )}
    </div>
  );
}

function AddressFields({ value: a, onChange, lockRegion, countyRule }: { value: FormationAddress; onChange: (next: FormationAddress) => void; lockRegion?: string; countyRule?: FieldRule }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
      <F label="Street" required className="col-span-2 sm:col-span-4">
        <Input value={a.street1} onChange={(e) => onChange({ ...a, street1: e.target.value })} autoComplete="address-line1" />
      </F>
      <F label="Suite / unit" className="col-span-2 sm:col-span-2">
        <Input value={a.street2} onChange={(e) => onChange({ ...a, street2: e.target.value })} autoComplete="address-line2" />
      </F>
      <F label="City" required className="col-span-2">
        <Input value={a.city} onChange={(e) => onChange({ ...a, city: e.target.value })} autoComplete="address-level2" />
      </F>
      <F label="County" required={!!countyRule?.required} className="col-span-2">
        <Input value={a.county ?? ""} onChange={(e) => onChange({ ...a, county: e.target.value })} placeholder={countyRule?.required ? "" : "Optional"} />
      </F>
      <F label="State" required>
        <Select value={lockRegion ?? a.region} disabled={!!lockRegion} onChange={(e) => onChange({ ...a, region: e.target.value })}>
          <option value="">—</option>
          {US_STATES.map(([abbr]) => (
            <option key={abbr} value={abbr}>
              {abbr}
            </option>
          ))}
        </Select>
      </F>
      <F label="ZIP" required>
        <Input value={a.postal} inputMode="numeric" onChange={(e) => onChange({ ...a, postal: e.target.value })} autoComplete="postal-code" className="tabular-nums" />
      </F>
    </div>
  );
}

function ActivityField({ q, value, onChange }: { q: ActivityQuestion; value: string; onChange: (v: string) => void }) {
  const t = useTone();
  if (q.kind === "yesno") {
    return (
      <div>
        <p className={`mb-2 text-[13px] ${t.text}`}>{q.label}</p>
        <YesNo value={value as "" | "yes" | "no"} onChange={onChange} />
      </div>
    );
  }
  if (q.kind === "choice") {
    return (
      <div>
        <p className={`mb-2 text-[12px] ${t.muted}`}>{q.label}</p>
        <div className="flex flex-wrap gap-1.5">
          {q.options!.map(([v, l]) => (
            <Chip key={v} on={value === v} onPick={() => onChange(v)}>
              {l}
            </Chip>
          ))}
        </div>
      </div>
    );
  }
  return (
    <F label={q.label} required>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={q.placeholder} />
    </F>
  );
}

// ── The filing, as it takes shape ────────────────────────────────────────

function Preview({ ctx, fee }: { ctx: Ctx; fee: Fee | null }) {
  const t = useTone();
  const { draft: d, llc, state } = ctx;
  const blank = <span className={`inline-block h-[0.7em] w-24 rounded-sm align-middle ${t.dark ? "bg-white/[0.07]" : "bg-gray-200"}`} />;
  const line = (label: string, value: ReactNode) => (
    <div className="py-2">
      <p className={`text-[9.5px] font-semibold uppercase tracking-[0.16em] ${t.faint}`}>{label}</p>
      <div className={`mt-0.5 text-[12.5px] leading-snug ${t.soft}`}>{value}</div>
    </div>
  );
  const filers = d.organizers.map((o) => (o.kind === "person" ? personName(o.name) : o.entityName.trim())).filter(Boolean);
  return (
    <div className="sticky top-0">
      <p className={`mb-3 text-[10.5px] font-semibold uppercase tracking-[0.18em] ${t.muted}`}>The filing</p>
      <div className="wiz-paper relative overflow-hidden rounded-2xl border p-5">
        <div className="flex items-start justify-between gap-3">
          <p className={`text-[9.5px] font-semibold uppercase leading-relaxed tracking-[0.2em] ${t.muted}`}>
            {llc ? "Articles of organization" : "Articles of incorporation"}
            <br />
            <span className={t.faint}>{state ? `State of ${state}` : "State —"}</span>
          </p>
          <span className="wiz-seal inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-brand text-[13px]">{ctx.region || "—"}</span>
        </div>
        <h4 className={`mt-4 min-h-[2.4em] font-brand text-[22px] leading-[1.15] ${d.legalName.trim() ? t.text : t.faint}`}>{d.legalName.trim() || "Your entity's name"}</h4>
        <div className={`mt-3 h-px ${t.dark ? "bg-gradient-to-r from-amber-200/30 via-white/10 to-transparent" : "bg-gradient-to-r from-amber-400/40 via-gray-200 to-transparent"}`} />
        <div className="mt-1 divide-y divide-transparent">
          {line("Principal office", d.principal.street1 ? addressLine(d.principal) : blank)}
          {line("Registered agent", d.agent.provider === "palm" ? "Palm" : agentName(d) || blank)}
          {line(llc ? (d.organizers.length > 1 ? "Organizers" : "Organizer") : d.organizers.length > 1 ? "Incorporators" : "Incorporator", filers.length ? filers.join(", ") : blank)}
          {!llc && line("Authorized stock", d.stock.multiClass ? `${d.stock.classes.length} class${d.stock.classes.length === 1 ? "" : "es"}` : num(d.stock.total) > 0 ? `${num(d.stock.total).toLocaleString()} shares` : blank)}
          {d.effectiveDate && line("Effective", d.effectiveDate)}
        </div>
        {d.owners.length > 0 && (
          <div className={`mt-3 border-t pt-4 ${t.line}`}>
            <p className={`text-[9.5px] font-semibold uppercase tracking-[0.16em] ${t.faint}`}>{llc ? "Members" : "Shareholders"}</p>
            <div className="mt-3 flex items-center gap-4">
              <Donut slices={d.owners.map((o) => ownerPercent(o) || 0)} size={64} thin />
              <ul className="min-w-0 flex-1 space-y-1">
                {d.owners.map((o, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-[11.5px]">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SLICE[i % SLICE.length] }} />
                    <span className={`min-w-0 flex-1 truncate ${t.soft}`}>{ownerName(o) || "—"}</span>
                    <span className={`tabular-nums ${t.muted}`}>{Number.isNaN(ownerPercent(o)) ? "" : `${ownerPercent(o)}%`}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 space-y-2">
        <PreviewChip on={!!d.ein} label="EIN application" value={d.ein ? (EIN_ACTIVITIES.find((a) => a.value === d.ein!.activity.category)?.label ?? "Applying") : "Not now"} />
        <PreviewChip on={d.agent.provider === "palm"} label="Palm as agent" value={d.agent.provider === "palm" ? "Included" : "Your own"} />
        <PreviewChip on={!!d.expeditedTier} label="Processing" value={d.expeditedTier ? (TIER_LABEL[d.expeditedTier] ?? pretty(d.expeditedTier)) : "Standard"} />
      </div>

      <div className={`mt-4 rounded-2xl border p-4 ${t.line}`}>
        <div className="flex items-baseline justify-between">
          <span className={`text-[12px] ${t.muted}`}>Estimated cost</span>
          <span className={`font-brand text-[22px] tabular-nums ${t.text}`}>{fee?.total != null ? money(fee.total, fee.currency) : "—"}</span>
        </div>
        {fee?.items.length ? (
          <div className="mt-2 space-y-1">
            {fee.items.map((i, idx) => (
              <div key={idx} className={`flex justify-between text-[11.5px] ${t.muted}`}>
                <span className="truncate">{pretty(i.name)}</span>
                <span className="tabular-nums">{money(i.amount, fee.currency)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className={`mt-1 text-[11.5px] ${t.faint}`}>{state ? "Pricing with Palm…" : "Priced once there's a state."}</p>
        )}
      </div>
    </div>
  );
}

function PreviewChip({ on, label, value }: { on: boolean; label: string; value: string }) {
  const t = useTone();
  return (
    <div className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-[12px] ${t.line}`}>
      <span className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-400" : t.dark ? "bg-white/20" : "bg-gray-300"}`} />
        <span className={t.soft}>{label}</span>
      </span>
      <span className={t.muted}>{value}</span>
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────

function Card({ title, hint, action, required, children }: { title: string; hint?: ReactNode; action?: ReactNode; required?: boolean; children: ReactNode }) {
  const t = useTone();
  return (
    <section className={`wiz-card rounded-2xl border p-5 sm:p-6 ${t.line}`}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className={`flex items-center gap-2 text-[14px] font-semibold ${t.text}`}>
            {title}
            {required && <Req />}
          </h4>
          {hint && <p className={`mt-1 text-[12.5px] leading-relaxed ${t.muted}`}>{hint}</p>}
        </div>
        {action && <div className="shrink-0 pt-0.5">{action}</div>}
      </header>
      {children}
    </section>
  );
}

function F({ label, hint, required, className = "", children }: { label: string; hint?: ReactNode; required?: boolean; className?: string; children: ReactNode }) {
  const t = useTone();
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className={`mb-1.5 flex items-center gap-1 text-[12px] ${t.muted}`}>
        {label}
        {required && <span className={t.dark ? "text-[#a5b4fc]" : "text-[#4f46e5]"} aria-label="required">*</span>}
      </span>
      {children}
      {hint && <span className={`mt-1 block text-[11.5px] leading-snug ${t.faint}`}>{hint}</span>}
    </label>
  );
}

function Req() {
  const t = useTone();
  return <span className={`rounded-full px-1.5 py-px text-[10px] font-medium ${t.dark ? "bg-[#818cf8]/15 text-[#c7d2fe]" : "bg-indigo-50 text-indigo-700"}`}>Required here</span>;
}

function ChoiceCard({ on, onPick, title, text, glyph, badge, small = false }: { on: boolean; onPick: () => void; title: string; text: string; glyph?: GlyphName; badge?: string; small?: boolean }) {
  const t = useTone();
  return (
    <button type="button" aria-pressed={on} onClick={onPick} className={`wiz-choice relative rounded-2xl border text-left ${small ? "p-4" : "p-5"} ${on ? "is-on" : t.line}`}>
      <span className="flex items-start gap-3.5">
        {glyph && (
          <span className={`wiz-glyph inline-flex shrink-0 items-center justify-center rounded-xl ${small ? "h-9 w-9" : "h-11 w-11"}`}>
            <Glyph name={glyph} className={small ? "h-4 w-4" : "h-5 w-5"} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className={`flex items-center gap-2 font-semibold ${small ? "text-[13.5px]" : "text-[16px]"} ${t.text}`}>
            {title}
            {badge && <span className={`rounded-full px-1.5 py-px text-[10px] font-medium ${t.dark ? "bg-white/[0.08] text-gray-300" : "bg-gray-100 text-gray-600"}`}>{badge}</span>}
          </span>
          <span className={`mt-1 block leading-relaxed ${small ? "text-[12px]" : "text-[12.5px]"} ${t.muted}`}>{text}</span>
        </span>
        <span className={`wiz-radio mt-0.5 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border ${on ? "is-on" : t.dark ? "border-white/20" : "border-gray-300"}`}>
          {on && <span className="h-2 w-2 rounded-full bg-white" />}
        </span>
      </span>
    </button>
  );
}

function PersonCard({ label, dot, onRemove, action, children }: { label: string; dot?: string; onRemove?: () => void; action?: ReactNode; children: ReactNode }) {
  const t = useTone();
  return (
    <div className={`rounded-xl border p-4 ${t.line} ${t.dark ? "bg-white/[0.015]" : "bg-white"}`}>
      <div className="mb-3 flex items-center gap-2.5">
        {dot && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dot }} />}
        <span className={`min-w-0 flex-1 truncate text-[13px] font-medium ${t.text}`}>{label}</span>
        {action}
        {onRemove && <IconButton icon="x" label={`Remove ${label}`} onClick={onRemove} />}
      </div>
      {children}
    </div>
  );
}

function More({ open: initial, label, children }: { open: boolean; label: string; children: ReactNode }) {
  const t = useTone();
  const [open, setOpen] = useState(initial);
  useEffect(() => {
    if (initial) setOpen(true);
  }, [initial]);
  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`inline-flex cursor-pointer items-center gap-1 text-[12px] font-medium ${t.accent}`}>
        <Icon name="chevronDown" className={`h-3 w-3 transition-transform ${open ? "" : "-rotate-90"}`} strokeWidth={2.2} />
        {label}
      </button>
      {open && <div className="wiz-reveal mt-3">{children}</div>}
    </div>
  );
}

function ToggleRow({ on, onToggle, title, text, boxed = false }: { on: boolean; onToggle: () => void; title: string; text?: string; boxed?: boolean }) {
  const t = useTone();
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle} className={`flex w-full cursor-pointer items-center gap-3 text-left ${boxed ? `rounded-2xl border px-5 py-4 ${t.line}` : ""}`}>
      <span className="min-w-0 flex-1">
        <span className={`block text-[13px] ${boxed ? "font-semibold" : ""} ${t.text}`}>{title}</span>
        {text && <span className={`mt-0.5 block text-[12px] ${t.muted}`}>{text}</span>}
      </span>
      <span className={`relative inline-flex h-[20px] w-[36px] shrink-0 items-center rounded-full transition-colors ${on ? "wiz-switch-on" : t.dark ? "bg-white/15" : "bg-gray-300"}`}>
        <span className={`inline-block h-[16px] w-[16px] rounded-full bg-white shadow transition-transform ${on ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
      </span>
    </button>
  );
}

function Segmented({ value, onChange, options, small = false }: { value: string; onChange: (v: string) => void; options: [string, string][]; small?: boolean }) {
  const t = useTone();
  return (
    <div role="radiogroup" className={`inline-flex rounded-xl p-1 ${t.dark ? "bg-white/[0.05]" : "bg-gray-100"}`}>
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`cursor-pointer rounded-lg font-medium transition-all ${small ? "h-7 px-3 text-[12px]" : "h-8 px-4 text-[12.5px]"} ${
            value === v ? (t.dark ? "bg-white/[0.12] text-white shadow-sm" : "bg-white text-gray-900 shadow-sm") : t.muted
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function YesNo({ value, onChange }: { value: "" | "yes" | "no" | string; onChange: (v: "yes" | "no") => void }) {
  return (
    <Segmented
      value={value}
      onChange={(v) => onChange(v as "yes" | "no")}
      options={[
        ["yes", "Yes"],
        ["no", "No"],
      ]}
      small
    />
  );
}

function Chip({ on, onPick, children }: { on: boolean; onPick: () => void; children: ReactNode }) {
  const t = useTone();
  return (
    <button type="button" aria-pressed={on} onClick={onPick} className={`wiz-chip inline-flex h-8 cursor-pointer items-center rounded-full border px-3 text-[12px] font-medium ${on ? "is-on" : `${t.line} ${t.soft}`}`}>
      {children}
    </button>
  );
}

function LinkButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  const t = useTone();
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`cursor-pointer whitespace-nowrap text-[12.5px] font-medium hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-60 ${t.accent}`}>
      {children}
    </button>
  );
}

function AddRow({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  const t = useTone();
  return (
    <button type="button" onClick={onClick} className={`flex h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed text-[12.5px] font-medium transition-colors ${t.dark ? "border-white/[0.1] text-gray-400 hover:border-white/25 hover:text-white" : "border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-900"}`}>
      <Icon name="plus" className="h-3.5 w-3.5" strokeWidth={2} />
      {children}
    </button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  const t = useTone();
  return <p className={`rounded-xl border border-dashed px-4 py-5 text-center text-[12.5px] ${t.line} ${t.faint}`}>{children}</p>;
}

function Note({ tone, children }: { tone: "warn"; children: ReactNode }) {
  const t = useTone();
  return <p className={`rounded-xl border px-3.5 py-2.5 text-[12.5px] ${tone === "warn" ? (t.dark ? "border-amber-400/25 bg-amber-400/[0.06] text-amber-200" : "border-amber-200 bg-amber-50 text-amber-800") : ""}`}>{children}</p>;
}

function ModeBadge({ mode }: { mode: PalmMode | null | "off" }) {
  const t = useTone();
  if (mode === null) return null;
  const [label, cls] =
    mode === "live"
      ? ["Live: files with the state", t.dark ? "bg-emerald-400/10 text-emerald-300" : "bg-emerald-50 text-emerald-700"]
      : mode === "test"
        ? ["Test mode", t.dark ? "bg-sky-400/10 text-sky-300" : "bg-sky-50 text-sky-700"]
        : ["Palm not connected", t.dark ? "bg-red-400/10 text-red-300" : "bg-red-50 text-red-700"];
  return <span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ${cls}`}>{label}</span>;
}

function NameStatus({ check, onPick, hasState, price }: { check: NameCheck | null | "checking"; onPick: (name: string) => void; hasState: boolean; price: string | null }) {
  const t = useTone();
  const cost = price ? ` Palm bills ${price} a check.` : "";
  if (check === null) return <span className={t.faint}>{hasState ? `Checked with the state when you stop typing.${cost}` : "Choose a state and the name is checked with it as you type."}</span>;
  if (check === "checking") return <span className={`wiz-pulse ${t.muted}`}>Checking with the state…</span>;
  const blocking = check.violations.filter((v) => v.severity === "error");
  const notes = check.violations.filter((v) => v.severity !== "error");
  const good = t.dark ? "text-emerald-300" : "text-emerald-700";
  const bad = t.dark ? "text-red-300" : "text-red-700";
  return (
    <span className="block space-y-1">
      <span className={`flex items-center gap-1.5 font-medium ${check.eligible ? good : bad}`}>
        {check.eligible ? <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.4} /> : <Icon name="x" className="h-3.5 w-3.5" strokeWidth={2.4} />}
        {check.eligible ? "Available" : !check.available ? "Taken: another business has this exact name" : "Not allowed as written"}
      </span>
      {blocking.map((v, i) => (
        <span key={i} className={`block ${bad}`}>
          {v.message}
        </span>
      ))}
      {notes.map((v, i) => (
        <span key={i} className={`block ${t.dark ? "text-amber-300" : "text-amber-700"}`}>
          {v.message}
        </span>
      ))}
      {!check.eligible && check.alternatives.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className={t.muted}>Try</span>
          {check.alternatives.map((a) => (
            <Chip key={a} on={false} onPick={() => onPick(a)}>
              {a}
            </Chip>
          ))}
        </span>
      )}
    </span>
  );
}

/** Shares as a ring; slices in the owners' colors. */
function Donut({ slices, size, label, sub, ok, thin = false }: { slices: number[]; size: number; label?: string; sub?: string; ok?: boolean; thin?: boolean }) {
  const t = useTone();
  const stroke = thin ? 7 : 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = Math.max(100, slices.reduce((n, s) => n + s, 0));
  let at = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className={t.dark ? "stroke-white/[0.07]" : "stroke-gray-200"} />
        {slices.map((s, i) => {
          const len = (Math.max(0, s) / total) * c;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={SLICE[i % SLICE.length]}
              strokeWidth={stroke}
              strokeDasharray={`${Math.max(0, len - (slices.length > 1 ? 2 : 0))} ${c}`}
              strokeDashoffset={-at}
              strokeLinecap="butt"
              style={{ transition: "stroke-dasharray 400ms cubic-bezier(.16,1,.3,1), stroke-dashoffset 400ms cubic-bezier(.16,1,.3,1)" } as CSSProperties}
            />
          );
          at += len;
          return el;
        })}
      </svg>
      {label && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-brand text-[18px] leading-none tabular-nums ${ok ? t.text : t.dark ? "text-amber-300" : "text-amber-700"}`}>{label}</span>
          {sub && <span className={`mt-1 text-[10px] ${t.muted}`}>{sub}</span>}
        </div>
      )}
    </div>
  );
}

type GlyphName = "building" | "pin" | "pie" | "pen" | "shield" | "receipt" | "flag" | "check" | "layers" | "columns" | "people" | "person";

const GLYPHS: Record<GlyphName, string> = {
  building: "M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21",
  pin: "M15 10.5a3 3 0 11-6 0 3 3 0 016 0z M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z",
  pie: "M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z",
  pen: "M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z M19.5 7.125L16.875 4.5 M3 21h18",
  shield: "M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z",
  receipt: "M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0c1.1.128 1.907 1.077 1.907 2.185z M9.75 9h.008v.008H9.75V9z M14.25 13.5h.008v.008h-.008V13.5z",
  flag: "M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5",
  check: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  layers: "M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L21.75 12l-4.179 2.25m0 0l4.179 2.25L12 21.75 2.25 16.5l4.179-2.25m11.142 0l-5.571 3-5.571-3",
  columns: "M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z",
  people: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z",
  person: "M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z",
};

function Glyph({ name, className = "h-4 w-4" }: { name: GlyphName; className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d={GLYPHS[name]} />
    </svg>
  );
}

