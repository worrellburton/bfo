/**
 * Overview: what the entity needs now (Compliance, To do), what AI read and
 * is waiting to be accepted, the record's facts (or the form that edits
 * them), its addresses, its money in Books, and what its documents say it
 * is (About, labelled as an AI summary).
 *
 * Desktop: the record on the left, To do, Money, Mail and people on the
 * right (main and rail, §5.4). Phone: the urgent cards first.
 */

import { useEffect, useState, type ReactNode } from "react";
import { entityType, TAX_CLASSES } from "../entity-completeness";
import { agentTerm, stateCode, stateName } from "../entity-paperwork";
import { entityAddresses, foreignAskWhy, foreignStates, formingNow, type Check } from "../entity-addresses";
import { DOC_LABEL, docKindOf, fromBundle, openPalmDocument, palmCall, sameAddressText, type PalmDocument } from "../palm";
import { STABLE_ADDRESS } from "../paper-mail";
import { f8822bData, stateAddressStep } from "../paperwork-generate";
import { authFetch, getUser, isAdmin, isPartner } from "../auth";
import { openStoredFile } from "../stored-file";
import { FILING_LABEL, FILING_STATUSES, US_STATES } from "../formation";
import {
  AiNote,

  Banner,
  Button,
  Card,
  CardSection,
  Checkbox,
  ChoiceTiles,
  DateInput,
  Dialog,
  Disclosure,
  Field,
  IconButton,
  InfoToggle,
  Input,
  List,
  ListRow,
  Money,
  Row,
  Rows,
  Segmented,
  Select,
  Status,
  TextLink,
  Textarea,
  cx,
  format,
  useMedia,
  type Tone,
} from "../ui";
import { PalmQuestions } from "./palm-questions";
import { ClosingCard } from "./closing";
import { addressChangeRemaining, Standing } from "./standing";
import { WITH_FORMATION } from "./derive";
import { useEntity, usePalmSeed } from "./context";
import { UsersCard } from "./people";
import { BY_HAND, einLooksRight, fmtDate, FIELD_LABEL, type Asset, type FileKind, type Member } from "./model";

export function OverviewTab() {
  const { page, view } = useEntity();
  const wide = useMedia("(width >= 64rem)");
  const editing = page.editing;
  const record = editing ? (
    <EditForm key="edit" />
  ) : (
    <>
      <Details key="details" />
      <Addresses key="addresses" />
    </>
  );
  if (wide)
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          <ClosingCard />
          <Standing />
          <Formation />
          <Proposals />
          {!view.isTrust && !editing && <AddressChange />}
          {record}
          {view.isTrust && !editing && <AddressChange />}
          <About />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <ToDo />
          <MoneyCard />
          <Mail />
          <UsersCard />
        </div>
      </div>
    );
  // Phones and tablets: what needs the person first, then the record.
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ClosingCard />
      <Standing />
      {!editing && <ToDo />}
      <Formation />
      <Proposals />
      {!editing && <AddressChange />}
      {record}
      <About />
      <MoneyCard />
      <Mail />
      {!page.editing && <UsersCard />}
    </div>
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────

/** A check under a value: the dot carries the tone, the sentence stays in ink (§2.4). */
function Line({ tone, children }: { tone: Check["tone"] | "neutral"; children: ReactNode }) {
  const dot = tone === "bad" ? "bg-negative" : tone === "warn" ? "bg-warning" : tone === "good" ? "bg-positive" : "bg-ink-3";
  return (
    <span className="mt-1 flex items-start gap-2 text-small text-pretty text-ink">
      <span aria-hidden="true" className={cx("mt-[5px] size-2 shrink-0 rounded-full", dot)} />
      <span className="min-w-0">
        {tone === "bad" || tone === "warn" ? <span className="sr-only">{tone === "bad" ? "Problem: " : "Check: "}</span> : null}
        {children}
      </span>
    </span>
  );
}

/** A quiet text action in a row ("Add", "View", "Upload"): small, accent, 44px on touch. */
function RowAction({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <Button variant="quiet" size="sm" onClick={onClick} disabled={disabled} className="text-accent enabled:hover:text-accent-hover">
      {children}
    </Button>
  );
}

/** Open the edit form on one field, focused (an empty value's Add, a To do item). */
function useEditField() {
  const { page } = useEntity();
  return (key: string) => {
    if (!page.editing) page.startEditing();
    window.setTimeout(() => {
      const el = document.getElementById(`edit-${key}`) ?? document.getElementById("entity-edit");
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (el instanceof HTMLInputElement || el instanceof HTMLButtonElement || el instanceof HTMLTextAreaElement) el.focus({ preventScroll: true });
    }, 80);
  };
}

function AddValue({ field, label = "Add" }: { field: string; label?: string }) {
  const editField = useEditField();
  const { asset } = useEntity();
  if (asset.archived || isPartner()) return <span className="text-ink-3">Not on record</span>;
  return <RowAction onClick={() => editField(field)}>{label}</RowAction>;
}

const val = (s?: string | null) => (s?.trim() ? s : undefined);
const date = (iso?: string | null) => (iso ? fmtDate(iso) : "");

/** Dates inside AI text ("08/11/2023", "September 12, 2023") in one form: "Aug 11, 2023". */
export function tidyDates(text: string): string {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return text
    .replace(/\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(\d{4})\b/g, (_, m, d, y) => `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`)
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (all, y, m, d) => (Number(m) >= 1 && Number(m) <= 12 ? `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}` : all))
    .replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})\b/g, (_, mo: string, d, y) => `${mo.slice(0, 3)} ${Number(d)}, ${y}`);
}

// ── Facts read by AI, waiting for a person ───────────────────────────────

/**
 * What AI read from the documents that isn't on the record yet: each with
 * where it came from, Accept (it goes on the record, and Activity names who
 * accepted it) or Dismiss. Nothing read goes on the record by itself (§11.6).
 */
function Proposals() {
  const { page, asset } = useEntity();
  const [busy, setBusy] = useState<string | null>(null);
  const list = Object.entries(asset.proposed ?? {}).filter(([, p]) => p) as [string, NonNullable<NonNullable<Asset["proposed"]>[string]>][];
  if (!list.length || isPartner()) return null;
  const canAct = !asset.archived && ["owner", "admin", "member"].includes(getUser()?.role ?? "");
  const show = (field: string, v: string | Member[]) =>
    Array.isArray(v) ? v.map((m) => `${m.name}${m.percent != null ? ` ${format.percent(m.percent, { decimals: 2, trim: true })}` : ""}${m.role ? ` (${m.role})` : ""}`).join("; ") : /date/i.test(field) ? date(v) : v;
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card title="Read from the documents" count={list.length} countTone="attention" info="AI read these from the documents on file. They aren't on the record until someone checks them against the document and accepts them.">
      <Rows>
        {list.map(([field, p]) => (
          <Row
            key={field}
            label={(FIELD_LABEL[field] ?? (field === "members" ? "owners" : field)).replace(/^./, (m) => m.toUpperCase())}
            hint={<AiNote kind="read" source={p.docName ? `“${p.docName}”` : undefined} />}
            action={
              canAct ? (
                <span className="flex items-center gap-1">
                  <Button size="sm" busy={busy === field} busyLabel="Accepting…" onClick={() => void run(field, () => page.acceptProposal(field))}>
                    Accept
                  </Button>
                  <Button size="sm" variant="quiet" disabled={!!busy} onClick={() => void run(field, () => page.dismissProposal(field))}>
                    Dismiss
                  </Button>
                </span>
              ) : undefined
            }
          >
            <span className="break-words">{show(field, p.value)}</span>
          </Row>
        ))}
      </Rows>
    </Card>
  );
}

// ── Address change ───────────────────────────────────────────────────────

type StepKey = "state" | "irs" | "banks";

/**
 * After the address changes, who still has the old one: the state (checked
 * against its own record through Palm), the IRS (Form 8822-B, filled in
 * here), the W-9, and the banks. Each step's box is checked with the day it
 * was sent and a tracking or confirmation number; the card goes once they
 * all are.
 */
function AddressChange() {
  const { page, asset } = useEntity();
  const [busy, setBusy] = useState<string | null>(null);
  const [marking, setMarking] = useState<StepKey | null>(null);
  const remaining = addressChangeRemaining(asset);
  if (!asset.previousAddress || isPartner() || !remaining) return null;
  const done = asset.addressUpdates ?? {};
  const refs = asset.addressUpdateRefs ?? {};
  const step = stateAddressStep(asset.state, asset.type);
  const rec = asset.stateRecord;
  const stateMatches = !!rec?.address && sameAddressText(rec.address, asset.address);
  const irs = f8822bData(asset);
  const w9Old = !!asset.w9 && (!asset.addressChangedAt || (asset.w9.uploadedAt ?? 0) < Date.parse(asset.addressChangedAt));
  const canAct = !asset.archived && ["owner", "admin", "member"].includes(getUser()?.role ?? "");
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  const proof = (k: StepKey) => {
    const on = done[k];
    if (!on) return null;
    const r = refs[k];
    return `Sent ${date(on)}${r?.ref ? ` · ${r.ref}` : ""}${r?.by ? ` · ${r.by}` : ""}`;
  };
  const box = (k: StepKey, label: string) => (
    <Checkbox
      checked={!!done[k]}
      disabled={!canAct}
      label={<span className="sr-only">{done[k] ? `Mark ${label} not done` : `Mark ${label} done`}</span>}
      onChange={(v) => (v ? setMarking(k) : void page.markAddressStep(k, false))}
    />
  );

  return (
    <Card
      title={`New address: ${remaining} ${remaining === 1 ? "place" : "places"} to tell`}
      info={`Moved from ${asset.previousAddress}${asset.addressChangedAt ? ` on ${date(asset.addressChangedAt)}` : ""}. Check each one off with the day it was sent and the tracking or confirmation number.`}
      flush
    >
      <List label="Who still has the old address">
        {step.needed && !stateMatches && (
          <li className="ds flex items-start gap-3 py-3 pr-4 pl-4 touch:pl-3">
            {box("state", step.agency)}
            <div className="min-w-0 flex-1">
              <p className="text-body text-ink">{step.agency}</p>
              <p className="text-small text-ink-2">
                {proof("state") ?? (rec?.address ? `Its record still has ${rec.address}.` : step.how)}
              </p>
            </div>
            {!done.state && step.url && <TextLink to={step.url} className="text-small">{step.linkLabel ?? "Open the state’s site"}</TextLink>}
          </li>
        )}
        {!!irs.ein && (
          <li className="ds flex items-start gap-3 border-t border-line py-3 pr-4 pl-4 touch:pl-3">
            {box("irs", "the IRS")}
            <div className="min-w-0 flex-1">
              <p className="text-body text-ink">IRS · Form 8822-B</p>
              <p className="text-small text-ink-2">{proof("irs") ?? `Sign it and mail it to ${irs.mailTo}. The IRS takes 4–6 weeks.`}</p>
            </div>
            {!done.irs && canAct && (
              <Button size="sm" busy={busy === "8822"} busyLabel="Filling in…" onClick={() => void run("8822", page.generate8822B)}>
                Fill in 8822-B
              </Button>
            )}
          </li>
        )}
        {w9Old && (
          <li className="ds flex items-start gap-3 border-t border-line py-3 pr-4 pl-11 touch:pl-12">
            <div className="min-w-0 flex-1">
              <p className="text-body text-ink">Form W-9</p>
              <p className="text-small text-ink-2">The W-9 on file has the old address. A new one goes on the row; the old one stays in the Library.</p>
            </div>
            {canAct && (
              <Button size="sm" busy={busy === "w9"} busyLabel="Filling in…" onClick={() => void run("w9", () => page.generateW9(true))}>
                Fill in a new W-9
              </Button>
            )}
          </li>
        )}
        <li className="ds flex items-start gap-3 border-t border-line py-3 pr-4 pl-4 touch:pl-3">
          {box("banks", "banks, Palm and insurers")}
          <div className="min-w-0 flex-1">
            <p className="text-body text-ink">Banks, Palm, insurers</p>
            <p className="text-small text-ink-2">{proof("banks") ?? "Anyone who mails it statements or notices."}</p>
          </div>
        </li>
      </List>
      <MarkSentDialog step={marking} onClose={() => setMarking(null)} />
    </Card>
  );
}

/** Asks for the day it was sent and the tracking or confirmation number, then checks the step off. */
function MarkSentDialog({ step, onClose }: { step: StepKey | null; onClose: () => void }) {
  const { page } = useEntity();
  const [on, setOn] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (step) {
      setOn(new Date().toISOString().slice(0, 10));
      setRef("");
    }
  }, [step]);
  const who = step === "state" ? "the state" : step === "irs" ? "the IRS" : "the banks and others";
  return (
    <Dialog
      open={!!step}
      onClose={onClose}
      title={`Reported to ${who}`}
      description="The day it went out, and proof it was sent: kept with the step."
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            busyLabel="Saving…"
            disabled={!on}
            onClick={async () => {
              if (!step || !on) return;
              setBusy(true);
              try {
                await page.markAddressStep(step, true, { on, ref });
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            Mark as sent
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Sent on">
          <DateInput value={on} onChange={setOn} />
        </Field>
        <Field label={step === "irs" ? "Certified mail tracking number" : "Tracking or confirmation number"} optional hint="From the post office receipt, or the confirmation the site gave.">
          <Input value={ref} onChange={(e) => setRef(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

// ── Formation (an entity BFO formed through Palm) ────────────────────────

function Formation() {
  const { page } = useEntity();
  const f = page.formation;
  if (!f) return null;
  const done = f.status === "completed";
  const canceled = f.status === "canceled";
  const where = US_STATES.find(([abbr]) => `US-${abbr}` === f.jurisdiction)?.[1] ?? f.jurisdiction;
  const at = FILING_STATUSES.indexOf(f.status as (typeof FILING_STATUSES)[number]);
  if (done)
    return (
      <Card title="Formation">
        <Rows>
          <Row label="Formed">
            {f.formationDate ? date(f.formationDate) : "Yes"} with {where} through Palm
          </Row>
          {f.registrationNumber && (
            <Row label="File number">
              <span className="font-mono">{f.registrationNumber}</span>
            </Row>
          )}
        </Rows>
        <PalmQuestions openCases={f.openCases} />
      </Card>
    );
  const tone: Tone = canceled ? "negative" : f.openCases ? "warning" : "info";
  return (
    <Card title="Formation" info={`Filed with ${where} through Palm${page.palmMode === "test" ? " in test mode: nothing reached the state" : ""}.`}>
      <div className="mb-3">
        <Status tone={tone}>{canceled ? "Canceled" : f.openCases ? `${f.openCases} ${f.openCases === 1 ? "question" : "questions"} from Palm` : "In progress"}</Status>
      </div>
      {!canceled && (
        <ol className="mb-3 flex flex-wrap gap-x-4 gap-y-2">
          {FILING_STATUSES.map((s, i) => (
            <li key={s} className={cx("flex items-center gap-2 text-small", i <= at ? "text-ink" : "text-ink-3")}>
              <Status tone={i < at ? "positive" : i === at ? "info" : "neutral"} shape>
                {FILING_LABEL[s]}
              </Status>
            </li>
          ))}
        </ol>
      )}
      <Rows>
        <Row label="Status" hint={f.statusReason ?? undefined}>
          {FILING_LABEL[f.status]}
        </Row>
        <Row label="Submitted">{format.date(new Date(f.submittedAt), "medium")}</Row>
        {f.registrationNumber && (
          <Row label="File number">
            <span className="font-mono">{f.registrationNumber}</span>
          </Row>
        )}
        {f.fee && <Row label="State fee">{format.money(f.fee.total, { currency: f.fee.currency })}</Row>}
        <Row label="Registered agent">{f.registeredAgent ? `Palm, ${f.registeredAgent.status.replace(/_/g, " ")}` : "Your own agent"}</Row>
        <Row label="EIN">{f.ein ? (f.ein.number ? <span className="font-mono">{f.ein.number}</span> : `Palm is applying: ${f.ein.status.replace(/_/g, " ")}`) : "Not requested"}</Row>
      </Rows>
      {!canceled && <PalmQuestions openCases={f.openCases} />}
      {page.formationError && <p className="mt-2 text-small text-negative">{page.formationError}</p>}
    </Card>
  );
}

// ── Details ──────────────────────────────────────────────────────────────

/** The EIN masked (§10.8): staff can show it for 30 seconds, or copy it. */
function Ein({ ein }: { ein: string }) {
  const { page } = useEntity();
  const [shown, setShown] = useState(false);
  const staff = !isPartner() && ["owner", "admin", "member"].includes(getUser()?.role ?? "");
  useEffect(() => {
    if (!shown) return;
    const t = window.setTimeout(() => setShown(false), 30_000);
    return () => window.clearTimeout(t);
  }, [shown]);
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cx("tabular-nums", shown && "font-mono")}>{shown ? ein : format.maskEin(ein)}</span>
      {staff && (
        <>
          <IconButton icon={shown ? "eyeOff" : "eye"} label={shown ? "Hide the EIN" : "Show the EIN"} onClick={() => setShown((v) => !v)} />
          <IconButton
            icon={page.copied === "ein" ? "check" : "copy"}
            label={page.copied === "ein" ? "Copied" : "Copy the EIN"}
            onClick={() => void page.copyValue("ein", ein)}
          />
        </>
      )}
    </span>
  );
}

function Details() {
  const { view, asset } = useEntity();
  const corp = view.etype === "C-Corp";
  const trust = view.isTrust;
  return (
    <Card title="Details">
      <Rows className="[overflow-wrap:anywhere]">
        {asset.ein?.trim() ? (
          <Row label="EIN">
            <Ein ein={asset.ein} />
          </Row>
        ) : (
          !trust && (
            <Row label="EIN" action={<AddValue field="ein" />}>
              {undefined}
            </Row>
          )
        )}
        <Row label={trust ? "Trust date" : corp ? "Incorporated" : "Formed"} action={asset.formationDate ? undefined : <AddValue field="formationDate" />}>
          {asset.formationDate ? <span className="tabular-nums">{date(asset.formationDate)}</span> : undefined}
        </Row>
        {trust ? (
          <>
            <Row label="Governing law" action={val(asset.state) ? undefined : <AddValue field="state" />}>
              {val(asset.state)}
            </Row>
            <TaxClassRows />
            <FiledRow kind="trustAgreement" label="Trust agreement" />
            <Row label="Mailing address" action={val(asset.address) ? undefined : <AddValue field="address" />}>
              {val(asset.address)}
            </Row>
          </>
        ) : (
          <>
            <TaxClassRows />
            {(asset.taxYearEnd || asset.accountingMethod) && (
              <Row label="Tax year">
                {asset.taxYearEnd && asset.taxYearEnd !== "12" ? `Ends ${MONTHS[Number(asset.taxYearEnd) - 1] ?? asset.taxYearEnd}` : "Calendar year"}
                {asset.accountingMethod ? ` · ${asset.accountingMethod} basis` : ""}
              </Row>
            )}
            <FiledRow kind="operatingAgreement" label={corp ? "Bylaws" : view.etype === "LP" ? "Partnership agreement" : "Operating agreement"} />
            <FiledRow kind="articles" label={corp ? "Certificate of incorporation" : "Articles"} />
            <Row
              label="State file number"
              action={
                asset.stateLink ? (
                  <TextLink to={asset.stateLink} className="text-small">
                    State’s record
                  </TextLink>
                ) : asset.fileNumber ? undefined : (
                  <AddValue field="fileNumber" />
                )
              }
            >
              {asset.fileNumber ? <span className="font-mono">{asset.fileNumber}</span> : undefined}
            </Row>
          </>
        )}
        {val(asset.notes) && (
          <Row label="Notes">
            <span className="text-pretty whitespace-pre-wrap">{asset.notes}</span>
          </Row>
        )}
      </Rows>
    </Card>
  );
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A paper on file: its own date, and whether the document is on record; View opens it, Upload goes to its row. */
function FiledRow({ kind, label }: { kind: FileKind; label: string }) {
  const { asset, goToTab } = useEntity();
  const file = asset[kind];
  const when = kind === "operatingAgreement" ? asset.operatingAgreementDate : kind === "articles" ? asset.articlesOfOrgDate : asset.formationDate;
  const canAct = !isPartner() && !asset.archived;
  return (
    <Row
      label={label}
      action={
        file ? (
          <RowAction onClick={() => void openStoredFile(file, { subtitle: `${asset.name}${when ? ` · ${kind === "articles" ? "filed" : "dated"} ${date(when)}` : ""}` })}>View</RowAction>
        ) : canAct ? (
          <RowAction onClick={() => goToTab("documents", `filing-${kind}`, "center")}>Upload</RowAction>
        ) : undefined
      }
    >
      <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
        {file ? <Status tone="neutral">On file</Status> : <Status tone="warning">No document</Status>}
        {when ? <span className="tabular-nums">{kind === "articles" ? "Filed" : "Dated"} {date(when)}</span> : <span className="text-ink-3">No date on record</span>}
      </span>
    </Row>
  );
}

/** Tax class with where it came from, whose return it lands on, and a document that disagrees. */
function TaxClassRows() {
  const { page, view, asset, goToTab } = useEntity();
  const editField = useEditField();
  const c = asset.llcTypeConflict;
  const src = asset.llcTypeSource;
  const home = view.homeLine;
  let note: ReactNode = null;
  let action: ReactNode = null;
  if (!asset.llcType) {
    action = <AddValue field="llcType" />;
  } else if (!c) {
    if (formingNow(asset) && (!src || src === BY_HAND)) note = "Set at formation; the EIN letter confirms it once Palm has it.";
    else if (src && src !== BY_HAND)
      note = (
        <span className="inline-flex flex-wrap items-center gap-1">
          Matches the documents
          <InfoToggle label="What the documents say">{src}</InfoToggle>
        </span>
      );
    else if (src === BY_HAND) note = "Entered by hand; not yet matched to a document.";
    else if (page.sorting > 0) note = "Checking it against the EIN letter and W-9…";
    else if (page.aiDown) note = "Not confirmed yet: document reading is paused.";
    else {
      note = <Line tone="warn">Not confirmed by a document. The EIN letter or a W-9 confirms it.</Line>;
      action = !isPartner() ? <RowAction onClick={() => goToTab("documents", "filing-einLetter", "center")}>Upload</RowAction> : null;
    }
  }
  return (
    <>
      <Row label="Tax classification" action={action ?? undefined}>
        {asset.llcType ? (
          <>
            <span>{asset.llcType}</span>
            {note && <span className="block text-small text-ink-2">{note}</span>}
            {home && (
              <span className="mt-1 block text-small text-pretty text-ink-2">
                {home.text}
                {home.needsClass && !isPartner() && (
                  <>
                    {" "}
                    <TextLink to={`/assets/${home.needsClass.id}`} inline>
                      Set it
                    </TextLink>
                  </>
                )}
              </span>
            )}
          </>
        ) : undefined}
      </Row>
      {c && (
        <Row label="Documents say" hint={c.evidence ? `${c.evidence}.` : undefined}>
          <Line tone="warn">
            <span className="font-medium">“{c.docName}”</span> says {c.value}; the record says {asset.llcType || "nothing"}.
          </Line>
          {!isPartner() && !asset.archived && (
            <span className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void page.acceptDocumentTaxClass()}>
                Use {c.value}
              </Button>
              <Button size="sm" variant="quiet" onClick={() => void page.dismissTaxClassConflict()}>
                Keep {asset.llcType || "blank"}
              </Button>
              <Button size="sm" variant="quiet" onClick={() => editField("llcType")}>
                Edit
              </Button>
            </span>
          )}
        </Row>
      )}
    </>
  );
}

// ── Addresses ────────────────────────────────────────────────────────────

/**
 * The entity's addresses, each for what it is: the principal office (what the
 * state lists), where mail goes, and the registered agent in every state it's
 * registered in. Each line says whether it holds up, and whether it matches
 * the state's own record once that's been read through Palm.
 */
function Addresses() {
  const { page, view, asset, tabPath } = useEntity();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deciding, setDeciding] = useState<string | null>(null);
  if (view.isTrust) return null;
  const a = entityAddresses(asset);
  const forming = formingNow(asset);
  const source = asset.registeredAgentSource ?? "";
  const palmStopped = source.startsWith("Palm stopped");
  const canAct = !isPartner() && !asset.archived;

  async function check(code: string) {
    setErrors((e) => ({ ...e, [code]: "" }));
    const why = await page.checkForeignRecord(code);
    if (why) setErrors((e) => ({ ...e, [code]: why }));
  }
  const checks = (list: Check[]) =>
    list.map((c) => (
      <Line key={c.text} tone={c.tone === "info" ? "neutral" : c.tone}>
        {c.text}
      </Line>
    ));

  return (
    <Card
      id="addresses"
      title="Addresses"
      info="The principal office is where the business is: the address the state lists. The mailing address is where its mail goes, when that's somewhere else. The registered agent accepts lawsuits and official notices for it: one in every state it's registered in, at a street address in that state (never a PO box or mailbox), open during business hours."
      action={canAct ? <Button variant="quiet" size="sm" onClick={() => page.startEditing()}>Edit</Button> : undefined}
    >
      <Rows className="[overflow-wrap:anywhere]">
        <Row label="Principal office" action={a.principal.value || !canAct ? undefined : <AddValue field="address" />}>
          {a.principal.value ?? undefined}
          {a.principal.value && checks(a.principal.checks)}
        </Row>
        <Row label="Mailing address">
          {a.mailing.value ? (
            <>
              {a.mailing.same ? <span className="text-ink-2">Same as the principal office</span> : a.mailing.value}
              {sameAddressText(a.mailing.value, STABLE_ADDRESS) && (
                <span className="block text-small text-ink-2">
                  The Stable mailbox: each piece is scanned into{" "}
                  <TextLink to="/mailbox" inline>
                    Paper mail
                  </TextLink>
                  .
                </span>
              )}
              {checks(a.mailing.checks)}
            </>
          ) : (
            <span className="text-ink-3">Not on record</span>
          )}
        </Row>
        {a.agents.map((g) => {
          const name = g.palm && g.name && !/^palm/i.test(g.name) ? `${g.name}, through Palm` : g.palm ? "Palm" : g.name;
          return (
            <Row
              key={g.state}
              label={
                <span>
                  {g.term}
                  <span className="block text-small text-ink-3">{g.home ? `${g.stateLabel}, where it was formed` : g.stateLabel}</span>
                </span>
              }
              hint={g.home && source && !palmStopped && !g.palm ? source : !g.home && g.record ? `${g.stateLabel}’s record read through Palm, ${format.date(new Date(g.record.checkedAt), "medium")}.` : undefined}
              action={
                !canAct || g.ask ? undefined : g.home ? (
                  forming && g.palm ? undefined : (
                    <TextLink to={tabPath("compliance")} className="text-small">
                      {g.palm ? "Manage" : "Move to Palm"}
                    </TextLink>
                  )
                ) : page.palmStatus?.configured ? (
                  <RowAction onClick={() => void check(g.state)} disabled={page.foreignBusy === g.state}>
                    {page.foreignBusy === g.state ? "Checking…" : g.record ? `Check ${g.state} again` : `Check ${g.state}’s record`}
                  </RowAction>
                ) : undefined
              }
            >
              {g.ask ? (
                <>
                  <span className="flex flex-wrap items-center gap-2">
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warning" />
                    <span className="font-medium">Does it do business in {g.stateLabel}?</span>
                  </span>
                  <span className="mt-1 block max-w-[68ch] text-small text-ink-2">{foreignAskWhy(g.stateLabel, view.etype === "C-Corp" ? "corporation" : "LLC", g.term)}</span>
                  {canAct && (
                    <span className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => setDeciding(g.state)}>
                        Answer
                      </Button>
                    </span>
                  )}
                </>
              ) : (
                <>
                  {name ? (
                    <span className="flex flex-wrap items-center gap-x-2">
                      <span>{name}</span>
                      {g.home && palmStopped && <Status tone="warning">Confirm</Status>}
                    </span>
                  ) : (
                    <span className="text-ink-3">Not on record</span>
                  )}
                  {g.address && <span className="block text-small text-ink-2">{g.address}</span>}
                  {g.fileNumber && (
                    <span className="block text-small text-ink-2">
                      File number <span className="font-mono">{g.fileNumber}</span>
                    </span>
                  )}
                  {checks(g.checks)}
                </>
              )}
              {errors[g.state] && <span className="mt-1 block text-small text-negative">{errors[g.state]}</span>}
            </Row>
          );
        })}
        {a.notNeeded.length > 0 && (
          <Row
            label="Not registered in"
            action={
              canAct && isAdmin() ? (
                <RowAction onClick={() => void page.patchAsset(Object.fromEntries(a.notNeeded.flatMap((c) => [[`foreign/${c}/notNeeded`, null], [`foreign/${c}/decisionReason`, null]])))}>Reopen</RowAction>
              ) : undefined
            }
          >
            <span className="text-ink-2">{a.notNeeded.map((c) => stateName(c)).join(", ")}: its address is there, but it doesn’t do business there.</span>
            {a.notNeeded.map((c) => asset.foreign?.[c]?.decisionReason && <span key={c} className="block text-small text-ink-2">Why: {asset.foreign[c].decisionReason}</span>)}
          </Row>
        )}
      </Rows>
      <ForeignDecisionDialog code={deciding} onClose={() => setDeciding(null)} />
    </Card>
  );
}

/**
 * Whether it does business in a state its address is in: what each answer
 * means, a reason, and owners and admins only. The answer and the reason go
 * in Activity.
 */
function ForeignDecisionDialog({ code, onClose }: { code: string | null; onClose: () => void }) {
  const { page, view, asset } = useEntity();
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (code) {
      setAnswer(null);
      setReason("");
    }
  }, [code]);
  const where = code ? stateName(code) : "";
  const what = view.etype === "C-Corp" ? "corporation" : "LLC";
  const admin = isAdmin();
  const officeThere = !!code && stateCode(asset.address?.match(/,\s*([A-Za-z]{2})\s+\d{5}/)?.[1] ?? "") === code;
  const ready = admin && !!answer && reason.trim().length > 2;
  return (
    <Dialog
      open={!!code}
      onClose={onClose}
      title={`Does it do business in ${where}?`}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!ready}
            disabledReason={!admin ? "An owner or admin answers this" : ready ? undefined : "Choose an answer and say why"}
            busy={busy}
            busyLabel="Saving…"
            onClick={async () => {
              if (!code || !answer) return;
              setBusy(true);
              try {
                await page.decideForeign(code, answer === "yes", reason);
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            Record the answer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ChoiceTiles
          label="The answer"
          hideLabel
          stacked
          value={answer}
          onChange={setAnswer}
          options={[
            {
              value: "yes",
              title: "Yes, it does business there",
              description: `It registers in ${where} as a foreign ${what}, with an agent there. The registration and the agent go on its To do.`,
            },
            {
              value: "no",
              title: "No, only its mail goes there",
              description: `No ${where} registration. If ${where} later finds it was doing business there unregistered, it can face penalties and back fees, and can’t sue in ${where}’s courts until it registers.`,
            },
          ]}
        />
        {answer === "no" && officeThere && (
          <Banner tone="warning">
            Its principal office is in {where}. An office there usually means it does business there; answer no only if the office is just a mailing address.
          </Banner>
        )}
        <Field label="Why" hint="Kept with the answer, in Activity.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </Field>
        {!admin && <p className="text-small text-ink-2">An owner or admin records this answer.</p>}
      </div>
    </Dialog>
  );
}

// ── Mail (what Palm receives as registered agent) ────────────────────────

const MAIL_SHOWN = 3;
type InboxEvent = { id: string; document_id: string | null };

/**
 * Mail Palm received for the entity, readable here, once there is some.
 * Unread mail is marked New until it's opened; the full list is on
 * Compliance.
 */
function Mail() {
  const { page, view, asset, goToTab } = useEntity();
  const mode = page.palmMode;
  const docs = page.palmDocs;
  const status = page.palmRa !== undefined ? page.palmRa?.status : mode ? asset.palm?.[mode]?.ra?.status : undefined;
  const shown = !view.isTrust && !!page.palmStatus?.configured && !!mode && (status === "active" || !!docs?.length) && !!docs?.length;
  const assetId = page.id;
  const count = docs?.length ?? 0;
  const [unread, setUnread] = useState<InboxEvent[]>([]);
  const [error, setError] = useState("");
  const seed = usePalmSeed<{ events: InboxEvent[] }>("inboxUnread");

  // Unread mail only; nothing is marked read just by looking at Overview.
  useEffect(() => {
    if (!shown || !mode || !assetId) return;
    let live = true;
    const part = seed(`${assetId}:${mode}`);
    (part ? fromBundle(part) : palmCall<{ events: InboxEvent[] }>("inbox", { assetId, mode, unread: true })).then((r) => live && setUnread(r.events.filter((e) => e.document_id))).catch(() => {});
    return () => {
      live = false;
    };
  }, [shown, mode, assetId, count]);

  if (!shown || !docs) return null;
  const isNew = (d: PalmDocument) => unread.some((e) => e.document_id === d.id);
  const open = (d: PalmDocument) => {
    setError("");
    void openPalmDocument(d)
      .then(() => {
        const ids = unread.filter((e) => e.document_id === d.id).map((e) => e.id);
        if (!ids.length) return;
        setUnread((u) => u.filter((e) => e.document_id !== d.id));
        void palmCall("inbox-read", { ids, mode }).catch(() => {});
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn’t open that document."));
  };
  const list = [...docs].sort((a, b) => Number(isNew(b)) - Number(isNew(a))).slice(0, MAIL_SHOWN);
  const fresh = unread.length;
  return (
    <Card
      title="Mail"
      count={fresh || undefined}
      countTone="attention"
      info="State mail and legal papers served on the entity, received by Palm as its registered agent."
      flush
      footer={count > MAIL_SHOWN ? <TextLink to={`${page.tabPath("compliance")}#palm-mail`} onClick={(e) => (e.preventDefault(), goToTab("compliance", "palm-mail"))}>All {count}</TextLink> : undefined}
    >
      {mode === "test" && <p className="px-5 pt-3 text-small text-ink-2 touch:px-4">Test mode: Palm’s sandbox, not real mail.</p>}
      <List label="Mail">
        {list.map((d) => {
          const kind = docKindOf(d);
          const legal = kind === "service_of_process";
          return (
            <ListRow
              key={d.id}
              unread={isNew(d)}
              title={
                <span className="inline-flex items-center gap-2">
                  {legal && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-negative" />}
                  {DOC_LABEL[kind] ?? (kind || "Document").replace(/_/g, " ")}
                </span>
              }
              secondary={[d.filename, d.created_at ? format.date(d.created_at.slice(0, 10), "medium") : null].filter(Boolean).join(" · ")}
              onClick={() => open(d)}
            />
          );
        })}
      </List>
      {error && <p className="px-5 py-2 text-small text-negative">{error}</p>}
    </Card>
  );
}

// ── Money (what Books knows about it) ────────────────────────────────────

type BooksSummary = { count: number; income: number; expenses: number; first: string | null; last: string | null };

/**
 * The entity in Books: this year's income and expenses, cash basis, from the
 * bank and card accounts mapped to it, with where to see the rest. Read from
 * Books' mirror; nothing is called at the bank.
 */
function MoneyCard() {
  const { page, asset } = useEntity();
  const [sum, setSum] = useState<BooksSummary | null | "error">(null);
  const year = new Date().getFullYear();
  const id = page.id;
  useEffect(() => {
    if (!id || isPartner()) return;
    let live = true;
    authFetch(`/api/books/data?${new URLSearchParams({ report: "transactions", entity: id, year: String(year), limit: "1" })}`)
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as { summary?: BooksSummary | null };
        if (live) setSum(r.ok ? (j.summary ?? { count: 0, income: 0, expenses: 0, first: null, last: null }) : "error");
      })
      .catch(() => live && setSum("error"));
    return () => {
      live = false;
    };
  }, [id, year]);
  if (isPartner() || entityType(asset) === "Trust" || sum === null) return null;
  const books = `/books/transactions?entity=${encodeURIComponent(id ?? "")}`;
  if (sum === "error")
    return (
      <Card title="Money">
        <p className="text-body text-ink-2">Books didn’t answer. Open Books to see its accounts.</p>
      </Card>
    );
  if (!sum.count)
    return (
      <Card title="Money" footer={<TextLink to="/treasury/mappings">Map accounts</TextLink>}>
        <p className="text-body text-pretty text-ink-2">No bank or card account is mapped to it in Books, so it has no transactions here this year.</p>
      </Card>
    );
  const net = sum.income - Math.abs(sum.expenses);
  return (
    <Card title="Money" footer={<TextLink to={books}>Open in Books</TextLink>}>
      <p className="mb-2 text-small text-ink-2">
        {format.dateRange(`${year}-01-01`, sum.last ?? new Date())} · Cash basis · the accounts mapped to it
      </p>
      <Rows>
        <Row label="Income">
          <Money value={sum.income} />
        </Row>
        <Row label="Expenses">
          <Money value={Math.abs(sum.expenses)} />
        </Row>
        <Row label="Net">
          <Money value={net} />
        </Row>
      </Rows>
      <p className="mt-2 text-small text-ink-2">{format.count(sum.count, "transaction")}; transfers and loans left out, as in the P&amp;L.</p>
    </Card>
  );
}

// ── Edit form ────────────────────────────────────────────────────────────

const ENTITY_TYPES = ["LLC", "C-Corp", "LP", "Trust"] as const;
const STATUSES = ["Active", "Inactive", "Pending"];

function EditForm() {
  const { page, asset } = useEntity();
  const { form } = page;
  const ft = entityType(form);
  const trust = ft === "Trust";
  const classes: readonly string[] = TAX_CLASSES[ft];
  const admin = isAdmin();
  // A legal name, form, tax class or EIN already on record is an owner's or admin's to change (the server refuses others).
  const locked = (k: "name" | "type" | "llcType" | "ein") => !admin && !!String(page.editBaseRef.current[k] ?? "").trim();
  const lockHint = "An owner or admin changes this.";
  const set = <K extends keyof Asset>(k: K, v: Asset[K]) => page.setForm((f) => ({ ...f, [k]: v }));
  const text = (k: "name" | "state" | "ein" | "registeredAgent" | "registeredAgentAddress" | "address" | "mailingAddress" | "trustees" | "grantors" | "beneficiaries" | "fileNumber" | "stateLink") => ({
    id: `edit-${k}`,
    value: form[k] || "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value),
  });
  const dateField = (k: "formationDate" | "operatingAgreementDate" | "articlesOfOrgDate") => <DateInput id={`edit-${k}`} value={form[k] || null} onChange={(v) => set(k, v ?? "")} />;
  const home = stateCode(form.state);
  const decided = foreignStates(form, { decided: true });
  const undecided = foreignStates(form).filter((c) => !decided.includes(c));
  const rec = asset.stateRecord;

  function onKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      void page.cancelEditing();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.target instanceof HTMLTextAreaElement) {
      e.preventDefault();
      void page.saveEdits();
    }
  }

  return (
    <Card id="entity-edit" title={`Edit ${asset.name}`} className="scroll-mt-[96px]">
      <form
        noValidate
        onKeyDown={onKeyDown}
        onSubmit={(e) => {
          e.preventDefault();
          void page.saveEdits();
        }}
      >
        {page.saveError && (
          <Banner tone="negative" className="mb-4">
            {page.saveError}
          </Banner>
        )}
        <CardSection title="Identity">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Legal name" hint={locked("name") ? lockHint : undefined} className="md:col-span-2">
              <Input {...text("name")} disabled={locked("name")} />
            </Field>
            <div className="md:col-span-2">
              <p className="mb-[6px] text-small font-medium text-ink">Legal form</p>
              {locked("type") ? (
                <p className="text-body text-ink">
                  {form.type} <span className="text-small text-ink-2">· {lockHint}</span>
                </p>
              ) : (
                <Segmented label="Legal form" value={(form.type ?? "LLC") as (typeof ENTITY_TYPES)[number]} onChange={(v) => set("type", v)} options={ENTITY_TYPES.map((t) => ({ value: t, label: t === "C-Corp" ? "Corporation" : t }))} />
              )}
            </div>
            <Field label={trust ? "Governing law (state)" : "State of formation"}>
              <Input {...text("state")} />
            </Field>
            <Field label="Status" hint={rec?.status ? `The state’s record says ${rec.status}, read ${format.date(new Date(rec.checkedAt), "medium")}.` : "Dissolving it is under ⋯ › Dissolve."}>
              <Select
                id="edit-status"
                label="Status"
                placeholder="Not set"
                value={form.status || null}
                onChange={(v) => set("status", v)}
                options={[...STATUSES, ...[asset.status].filter((s): s is string => !!s && !STATUSES.includes(s))].map((s) => ({ value: s, label: s, disabled: s === "Dissolved" && asset.status !== "Dissolved" }))}
              />
            </Field>
            <Field label="EIN" error={einLooksRight(form.ein) ? undefined : "An EIN is nine digits, written 12-3456789."} hint={locked("ein") ? lockHint : undefined}>
              <Input {...text("ein")} className="font-mono" placeholder="12-3456789" disabled={locked("ein")} />
            </Field>
            <Field label="Tax classification" hint={locked("llcType") ? lockHint : "A change asks for its effective date and the election."}>
              <Select
                id="edit-llcType"
                label="Tax classification"
                placeholder="Choose…"
                disabled={locked("llcType")}
                value={form.llcType || null}
                onChange={(v) => set("llcType", v)}
                options={[...classes, ...(form.llcType && !classes.includes(form.llcType) ? [form.llcType] : [])].map((c) => ({ value: c, label: c }))}
              />
            </Field>
            <Field label={trust ? "Trust date" : "Formation date"}>{dateField("formationDate")}</Field>
            {!trust && (
              <Field label="State file number">
                <Input {...text("fileNumber")} className="font-mono" />
              </Field>
            )}
            <Field label="Tax year ends" optional>
              <Select
                id="edit-taxYearEnd"
                label="Tax year ends"
                placeholder="December (calendar year)"
                value={form.taxYearEnd || null}
                onChange={(v) => set("taxYearEnd", v)}
                options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
              />
            </Field>
            <Field label="Accounting method" optional>
              <Select
                id="edit-accountingMethod"
                label="Accounting method"
                placeholder="Choose…"
                value={form.accountingMethod || null}
                onChange={(v) => set("accountingMethod", v as Asset["accountingMethod"])}
                options={[
                  { value: "Cash", label: "Cash" },
                  { value: "Accrual", label: "Accrual" },
                ]}
              />
            </Field>
          </div>
        </CardSection>

        <CardSection title="Addresses">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label={trust ? "Mailing address" : "Principal office"} hint={trust ? undefined : "Where the business is: the address the state lists."}>
              <Input {...text("address")} />
            </Field>
            {!trust && (
              <Field label="Mailing address" optional hint="A new address starts the address-change steps when you save.">
                <Input {...text("mailingAddress")} placeholder="Same as the principal office" />
              </Field>
            )}
          </div>
        </CardSection>

        {!trust && (
          <CardSection title="Agents">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label={`${agentTerm(home)}${form.state ? ` in ${stateName(home) || form.state}` : ""}`}>
                <Input {...text("registeredAgent")} />
              </Field>
              <Field label="Agent’s street address" hint={`In ${stateName(home) || form.state || "the state of formation"}; not a PO box or mailbox.`}>
                <Input {...text("registeredAgentAddress")} />
              </Field>
            </div>
            {decided.map((code) => {
              const f = form.foreign?.[code] ?? {};
              const setF = (k: "agent" | "agentAddress" | "fileNumber", v: string) => set("foreign", { ...(form.foreign ?? {}), [code]: { ...f, [k]: v } });
              return (
                <div key={code} className="mt-4 border-t border-line pt-4">
                  <p className="mb-3 text-small font-medium text-ink">
                    {stateName(code)}: registered as a foreign {ft === "C-Corp" ? "corporation" : "LLC"}
                  </p>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Field label={agentTerm(code)}>
                      <Input value={f.agent ?? ""} onChange={(e) => setF("agent", e.target.value)} />
                    </Field>
                    <Field label="Agent’s street address" hint={`In ${stateName(code)}; not a PO box or mailbox.`}>
                      <Input value={f.agentAddress ?? ""} onChange={(e) => setF("agentAddress", e.target.value)} />
                    </Field>
                    <Field label={`${stateName(code)} file number`}>
                      <Input value={f.fileNumber ?? ""} onChange={(e) => setF("fileNumber", e.target.value)} className="font-mono" />
                    </Field>
                  </div>
                </div>
              );
            })}
            {undecided.map((code) => (
              <p key={code} className="mt-4 border-t border-line pt-4 text-small text-ink-2">
                {stateName(code)}: not registered. Whether it does business there is answered on the Addresses card.
              </p>
            ))}
            <div className="mt-4 border-t border-line pt-4 md:w-1/2">
              <Field label="Registered in another state too?" optional hint="Doing business elsewhere (an office, staff, operating property) means registering there, with an agent there.">
                <Select
                  label="Add a state"
                  placeholder="Add a state…"
                  value={null}
                  onChange={(code) => set("foreign", { ...(form.foreign ?? {}), [code]: { ...(form.foreign?.[code] ?? {}), confirmed: true } })}
                  options={US_STATES.filter(([code]) => code !== home && !foreignStates(form).includes(code)).map(([code, name]) => ({ value: code, label: name }))}
                />
              </Field>
            </div>
          </CardSection>
        )}

        {trust ? (
          <CardSection title="People">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Trustees" hint="Names, separated by commas.">
                <Input {...text("trustees")} />
              </Field>
              <Field label="Grantors">
                <Input {...text("grantors")} />
              </Field>
              <Field label="Beneficiaries" className="md:col-span-2">
                <Input {...text("beneficiaries")} />
              </Field>
            </div>
          </CardSection>
        ) : (
          <CardSection title="Paperwork dates">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Operating agreement signed">{dateField("operatingAgreementDate")}</Field>
              <Field label="Articles filed">{dateField("articlesOfOrgDate")}</Field>
              <Field label="Link to the state’s record" optional className="md:col-span-2">
                <Input {...text("stateLink")} type="url" placeholder="https://" />
              </Field>
            </div>
          </CardSection>
        )}

        <CardSection title="Notes">
          <Field label="Notes" optional hint="Staff only.">
            <Textarea id="edit-notes" value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} rows={3} />
          </Field>
        </CardSection>
        {/* Enter in a one-line field saves; the buttons are in the header (desktop) or the bar at the bottom (phone). */}
        <button type="submit" className="sr-only" tabIndex={-1}>
          Save changes
        </button>
      </form>
    </Card>
  );
}

// ── About (the profile read from the governing documents) ────────────────

function About() {
  const { page, asset, goToTab } = useEntity();
  const p = asset.profile;
  if (!p && !page.docs.length && !page.profiling) return null;
  const canRead = !isPartner() && !asset.archived && ["owner", "admin", "member"].includes(getUser()?.role ?? "");
  const from = p?.sources.length ? format.count(p.sources.length, "document") : "the documents on file";
  // The documents' word on who runs it, against the state's record.
  const stateManagers = (asset.stateRecord?.people?.filter((x) => /manager|managing/i.test(x.role)).map((x) => x.name) ?? asset.stateRecord?.managers ?? []).filter(Boolean);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const differs = !!p && p.managers.length > 0 && stateManagers.length > 0 && !sameNames(p.managers, stateManagers);
  const recordClass = asset.llcType?.trim();
  const taxDiffers = !!p?.taxTreatment && !!recordClass && norm(p.taxTreatment) !== norm(recordClass) && !norm(p.taxTreatment).includes(norm(recordClass));
  const where = stateName(stateCode(asset.state) ?? "") || "the state";

  return (
    <Card
      title="About"
      action={
        canRead && (p || page.docs.length) ? (
          <Button variant="quiet" size="sm" icon="sparkle" busy={page.profiling} busyLabel="Reading…" onClick={() => void page.buildProfile()}>
            {p ? "Read again" : "Read documents"}
          </Button>
        ) : undefined
      }
    >
      {p ? (
        <div className="flex flex-col gap-3">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-ink-2">
            <AiNote kind="summary" />
            <span>
              from {from}, {format.date(new Date(p.checkedAt), "medium")}. Check it against the signed documents; it isn’t legal advice.
            </span>
          </p>
          {p.whatItIs && <p className="max-w-[68ch] text-body text-pretty text-ink">{tidyDates(p.whatItIs)}</p>}
          <Rows>
            {p.members.length > 0 && (
              <Row label="Owners, per the documents">
                <ul className="flex flex-col gap-1">
                  {p.members.map((m, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 break-words">{m.name}</span>
                      <span className="shrink-0 text-ink-2 tabular-nums">{m.percent != null ? format.percent(m.percent, { decimals: 2, trim: true }) : ""}</span>
                    </li>
                  ))}
                </ul>
              </Row>
            )}
            {(p.management || p.managers.length > 0) && (
              <Row label="Run by" hint={p.management ? `The documents say ${p.management}.` : undefined}>
                {p.managers.length ? p.managers.join(", ") : <span className="text-ink-3">No one named</span>}
                {differs && (
                  <Line tone="warn">
                    {where}’s record names {stateManagers.map((n) => `“${titleCase(n)}”`).join(", ")} instead. Check which is right before anyone signs for it.
                  </Line>
                )}
              </Row>
            )}
            {taxDiffers && (
              <Row label="Taxed as, per the documents" hint={p.taxEvidence ? tidyDates(p.taxEvidence) : undefined}>
                {p.taxTreatment}
                <Line tone="warn">The record says {recordClass}.</Line>
              </Row>
            )}
            {p.governingLaw && <Row label="Governing law">{p.governingLaw}</Row>}
            {p.properties.length > 0 && (
              <Row label="Property">
                <ul className="flex flex-col gap-1">
                  {p.properties.map((pr, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 break-words">
                        {pr.description}
                        {pr.state ? `, ${pr.state}` : ""}
                      </span>
                      {pr.status && <span className="shrink-0 text-small text-ink-2">{tidyDates(pr.status)}</span>}
                    </li>
                  ))}
                </ul>
              </Row>
            )}
          </Rows>
          {p.keyTerms.length > 0 && (
            <Disclosure label="Key terms" count={p.keyTerms.length}>
              <TextList items={p.keyTerms} />
            </Disclosure>
          )}
          {p.issues.length > 0 && (
            <Disclosure label="Notes from the documents" count={p.issues.length}>
              <TextList items={p.issues} />
            </Disclosure>
          )}
          {p.sources.length > 0 && (
            <Disclosure label="Documents read" count={p.sources.length}>
              <TextList items={p.sources} />
            </Disclosure>
          )}
          {page.profileError && <p className="text-small text-negative">{page.profileError}</p>}
        </div>
      ) : page.profiling ? (
        <p className="text-body text-ink-2">Reading the documents…</p>
      ) : page.profileError ? (
        <p className="text-body text-negative">{page.profileError}</p>
      ) : page.aiDown ? (
        <p className="text-body text-ink-2">Document reading is paused.</p>
      ) : page.docs.length ? (
        <p className="max-w-[68ch] text-body text-pretty text-ink-2">
          Not read yet. Read documents sends the governing documents to Anthropic’s Claude, which writes a short summary here: what it is, who owns and runs it. You check it; nothing it reads goes on the record by itself.
        </p>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="text-body text-ink-2">No documents yet. Add the operating agreement, and BFO can summarize what the entity is from it.</p>
          {canRead && (
            <Button icon="upload" onClick={() => goToTab("documents")}>
              Add documents
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

/** A name as a person writes it: "AMANDA DOE" → "Amanda Doe" (names already in mixed case are left alone). */
function titleCase(name: string): string {
  return name === name.toUpperCase() ? name.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()) : name;
}

/** Two lists name the same people: each name's words appear in a name on the other list (middle initials and asides aside). */
export function sameNames(a: string[], b: string[]): boolean {
  const words = (n: string) => n.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 1);
  const covers = (x: string, y: string) => {
    const wy = new Set(words(y));
    const wx = words(x);
    return wx.length > 0 && wx.every((w) => wy.has(w));
  };
  const match = (x: string, list: string[]) => list.some((y) => covers(x, y) || covers(y, x));
  return a.length === b.length && a.every((x) => match(x, b)) && b.every((y) => match(y, a));
}

function TextList({ items }: { items: string[] }) {
  return (
    <ul className="mt-1 flex max-w-[68ch] list-disc flex-col gap-1 pl-5 text-body text-ink-2">
      {items.map((s, i) => (
        <li key={i}>{tidyDates(s)}</li>
      ))}
    </ul>
  );
}

// ── To do (completeness) ─────────────────────────────────────────────────

function ToDo() {
  const { view, asset, goToTab } = useEntity();
  const forming = !!formingNow(asset);
  const coming = forming ? view.missing.filter((i) => WITH_FORMATION.has(i.key)) : [];
  const missing = forming ? view.missing.filter((i) => !WITH_FORMATION.has(i.key)) : view.missing;
  const editField = useEditField();
  const done = view.checklist.filter((i) => i.done);
  const toAddresses = () => document.getElementById("addresses")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const canAct = !isPartner() && !asset.archived;

  // Each item opens exactly where it's fixed: its document row, the Addresses card, or its field in the edit form.
  function open(item: (typeof missing)[number]) {
    if (item.filing) return goToTab("documents", `filing-${item.key}`, "center");
    if (["trustees", "grantors", "beneficiaries"].includes(item.key)) return goToTab("people");
    if (item.key.startsWith("foreign:") || item.key.startsWith("decide:")) return toAddresses();
    editField(item.key);
  }

  return (
    <Card id="todo" title="To do" count={missing.length} countTone="attention" flush className="scroll-mt-[96px]">
      {missing.length === 0 ? (
        <p className="px-5 py-3 text-body text-ink-2 touch:px-4">Nothing left: the record is complete.</p>
      ) : (
        <List label="To do">
          {missing.map((item) => (
            <ListRow key={item.key} title={item.label} onClick={canAct ? () => open(item) : undefined} />
          ))}
        </List>
      )}
      {(coming.length > 0 || done.length > 0) && (
        <div className="flex flex-col gap-1 border-t border-line px-5 py-2 touch:px-4">
          {coming.length > 0 && (
            <Disclosure label="Comes with the formation" count={coming.length}>
              <ul className="pb-2 text-small text-ink-2">
                {coming.map((i) => (
                  <li key={i.key} className="py-1">
                    {i.label}
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
          {done.length > 0 && (
            <Disclosure label="Done" count={done.length}>
              <ul className="pb-2 text-small text-ink-2">
                {done.map((i) => (
                  <li key={i.key} className="py-1">
                    {i.label}
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
        </div>
      )}
    </Card>
  );
}


