/**
 * Overview: the record's facts (or the form that edits them), what the entity
 * is according to its documents, and what the record still needs.
 */

import { useEffect, useState, type ReactNode } from "react";
import { priceSuffix, stateRecordCents } from "../../lib/palm-pricing";
import { Link } from "react-router";
import { entityType, TAX_CLASSES } from "../entity-completeness";
import { agentTerm, stateCode, stateName } from "../entity-paperwork";
import { entityAddresses, foreignStates, formingNow, type Check } from "../entity-addresses";
import { DOC_LABEL, docKindOf, openPalmDocument, palmCall, sameAddressText, type PalmDocument } from "../palm";
import { STABLE_ADDRESS } from "../paper-mail";
import { f8822bData, stateAddressStep } from "../paperwork-generate";
import { isAdmin, isPartner } from "../auth";
import { StoredFileLink } from "../stored-file";
import { FILING_LABEL, FILING_STATUSES, US_STATES } from "../formation";
import { PalmQuestions } from "./palm-questions";
import { ClosingCard } from "./closing";
import { WITH_FORMATION } from "./derive";
import { useEntity } from "./context";
import { BY_HAND, einLooksRight, fmtDate, fmtStamp, type Asset, type FileKind } from "./model";
import { Button, Disclosure, Dot, Empty, ErrorLine, Field, Icon, IconButton, Input, Row, Rows, Section, Select, Textarea, TextButton, toneText, useTone } from "./ui";

export function OverviewTab() {
  const { page } = useEntity();
  // Desktop: Details and About on the left, Mail and To do on the right. Phones: Details, Mail, To do, About.
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[auto_1fr]">
      <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
        <ClosingCard />
        <AddressChange />
        <Formation />
        {page.editing ? <EditForm /> : <><Addresses /><Details /></>}
      </div>
      <div className="min-w-0 space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <Mail />
        <ToDo />
      </div>
      <div className="min-w-0 lg:col-start-1 lg:row-start-2">
        <About />
      </div>
    </div>
  );
}

// ── Address change ───────────────────────────────────────────────────────

/**
 * After the address changes in BFO, what's left to tell: the state (checked
 * against its own record through Palm), the IRS (Form 8822-B, filled in
 * here), the W-9, and the banks. Each step is marked done with its date;
 * the card goes once they all are.
 */
function AddressChange() {
  const { page, asset } = useEntity();
  const t = useTone();
  const [busy, setBusy] = useState<string | null>(null);
  if (!asset.previousAddress || isPartner()) return null;
  const done = asset.addressUpdates ?? {};
  const step = stateAddressStep(asset.state, asset.type);
  const rec = asset.stateRecord;
  // The state's own record says which address it has, once read after the change.
  const stateMatches = !!rec?.address && sameAddressText(rec.address, asset.address);
  const stateDone = !step.needed || !!done.state || stateMatches;
  const irs = f8822bData(asset);
  const irsNeeded = !!irs.ein;
  const irsDone = !irsNeeded || !!done.irs;
  const w9Old = !!asset.w9 && (!asset.addressChangedAt || (asset.w9.uploadedAt ?? 0) < Date.parse(asset.addressChangedAt));
  const banksDone = !!done.banks;
  const remaining = [!stateDone, !irsDone, w9Old, !banksDone].filter(Boolean).length;
  if (!remaining) return null;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  const doneMark = (date: string) => <Dot tone="good">Done {fmtDate(date)}</Dot>;
  const markBtn = (key: "state" | "irs" | "banks", on: boolean) => (
    <TextButton onClick={() => void run(key, () => page.markAddressStep(key, !on))} disabled={busy === key}>
      {on ? "Undo" : "Mark done"}
    </TextButton>
  );

  return (
    <Section
      title="Address change"
      count={remaining}
      alert
      info={`BFO's record moved from ${asset.previousAddress} to ${asset.address}${asset.addressChangedAt ? ` on ${fmtDate(asset.addressChangedAt)}` : ""}. These still have the old one.`}
    >
      <Rows>
        <Row
          label={step.agency}
          info={step.how}
          actions={
            step.needed && !stateMatches ? (
              <div className="flex items-center gap-3">
                {step.url && <TextLink href={step.url}>{step.linkLabel ?? "Open"}</TextLink>}
                <TextButton onClick={() => void page.checkStateRecord()} disabled={!!page.palmBusy}>
                  {page.palmBusy === "record" ? "Checking…" : `Check state record${priceSuffix(page.palmMode, stateRecordCents(!!asset.fileNumber))}`}
                </TextButton>
                {markBtn("state", !!done.state)}
              </div>
            ) : undefined
          }
        >
          {!step.needed ? (
            <Dot tone="good">Nothing to file</Dot>
          ) : stateMatches ? (
            <Dot tone="good">The state has the new address</Dot>
          ) : done.state ? (
            doneMark(done.state)
          ) : rec?.address ? (
            <span>
              <Dot tone="warn">The state still has the old address</Dot>
              <span className={`mt-0.5 block text-[12px] ${t.muted}`}>{rec.address}</span>
            </span>
          ) : (
            <Dot tone="warn">To file</Dot>
          )}
        </Row>
        <Row
          label="IRS · Form 8822-B"
          info={irsNeeded ? `Sign it, then mail it to ${irs.mailTo}. The IRS takes 4–6 weeks to process it.` : irs.notes[0]}
          actions={
            irsNeeded ? (
              <div className="flex items-center gap-3">
                {!done.irs && (
                  <TextButton onClick={() => void run("8822", page.generate8822B)} disabled={busy === "8822"}>
                    {busy === "8822" ? "Filling in…" : "Fill in 8822-B"}
                  </TextButton>
                )}
                {markBtn("irs", !!done.irs)}
              </div>
            ) : undefined
          }
        >
          {!irsNeeded ? <Dot tone="muted">No EIN of its own</Dot> : done.irs ? doneMark(done.irs) : <Dot tone="warn">To mail</Dot>}
        </Row>
        {w9Old && (
          <Row
            label="W-9"
            info="The W-9 on file has the old address. A new one goes on file; the old one stays in Documents."
            actions={
              <TextButton onClick={() => void run("w9", () => page.generateW9(true))} disabled={busy === "w9"}>
                {busy === "w9" ? "Filling in…" : "Fill in a new W-9"}
              </TextButton>
            }
          >
            <Dot tone="warn">Old address</Dot>
          </Row>
        )}
        <Row label="Banks, Palm, insurers" info="Anyone who mails it statements or notices: update the address in each." actions={markBtn("banks", banksDone)}>
          {banksDone ? doneMark(done.banks!) : <Dot tone="warn">To update</Dot>}
        </Row>
      </Rows>
    </Section>
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────

const linkClass = "relative inline-flex cursor-pointer items-center gap-1 whitespace-nowrap text-[12px] font-medium hover:underline max-sm:after:absolute max-sm:after:-inset-y-3 max-sm:after:inset-x-0 max-sm:after:content-['']";

/** TextButton's look, for navigation: an in-app route (`to`) or a new tab (`href`). */
function TextLink({ children, ...where }: { children: ReactNode } & ({ to: string } | { href: string })) {
  const { accent } = useTone();
  if ("href" in where)
    return (
      <a href={where.href} target="_blank" rel="noopener noreferrer" className={`${linkClass} ${accent}`}>
        {children}
      </a>
    );
  return (
    <Link to={where.to} className={`${linkClass} ${accent}`}>
      {children}
    </Link>
  );
}

/** A value, or nothing (the Row then shows a dash). */
const val = (s?: string | null) => (s?.trim() ? s : undefined);

// ── Formation (an entity BFO formed through Palm) ────────────────────────

/** The filing's progress with the state, while it's under way and once it's done. */
function Formation() {
  const { page } = useEntity();
  const t = useTone();
  const f = page.formation;
  if (!f) return null;
  const done = f.status === "completed";
  const canceled = f.status === "canceled";
  const steps = FILING_STATUSES.map((s) => ({ key: s, label: FILING_LABEL[s], reached: !canceled && FILING_STATUSES.indexOf(s) <= FILING_STATUSES.indexOf(f.status as (typeof FILING_STATUSES)[number]) }));
  const stateName = US_STATES.find(([abbr]) => `US-${abbr}` === f.jurisdiction)?.[1] ?? f.jurisdiction;
  // Once formed, the filing's story is one line; Palm's questions (on the EIN, say) still show.
  if (done)
    return (
      <Section title="Formation" actions={<Dot tone="good">Formed</Dot>}>
        <Rows>
          <Row label="Formed">
            {f.formationDate ? fmtDate(f.formationDate) : "Yes"} with {stateName} through Palm
            {f.registrationNumber && <span className={t.muted}> · file number {f.registrationNumber}</span>}
          </Row>
        </Rows>
        <PalmQuestions openCases={f.openCases} />
      </Section>
    );
  return (
    <Section
      title="Formation"
      info={`Filed with ${stateName} through Palm${page.palmMode === "test" ? " (test mode: nothing reached the state)" : ""}.`}
      actions={
        <Dot tone={done ? "good" : canceled ? "bad" : f.openCases ? "warn" : "accent"}>
          {canceled ? "Canceled" : done ? "Formed" : f.openCases ? `${f.openCases} question${f.openCases === 1 ? "" : "s"} from Palm` : "In progress"}
        </Dot>
      }
    >
      {!canceled && (
        <ol className="flex flex-wrap gap-x-4 gap-y-2 px-4 py-3">
          {steps.map((s, i) => (
            <li key={s.key} className={`flex items-center gap-1.5 text-[12px] ${s.reached ? t.text : t.faint}`}>
              <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${s.reached ? (t.dark ? "bg-emerald-400/20 text-emerald-300" : "bg-emerald-100 text-emerald-700") : t.dark ? "bg-white/[0.06]" : "bg-gray-100"}`}>
                {s.reached && (done || s.key !== f.status) ? <Icon name="check" className="h-2.5 w-2.5" strokeWidth={2.5} /> : i + 1}
              </span>
              {s.label}
            </li>
          ))}
        </ol>
      )}
      <Rows>
        <Row label="Status" info={f.statusReason ?? undefined}>
          {FILING_LABEL[f.status]}
          {f.statusReason ? <span className={`ml-2 ${t.muted}`}>{f.statusReason}</span> : null}
        </Row>
        <Row label="Submitted">{fmtDate(new Date(f.submittedAt).toISOString().slice(0, 10))}</Row>
        {f.formationDate && <Row label="Formed">{fmtDate(f.formationDate)}</Row>}
        {f.registrationNumber && <Row label="File number">{f.registrationNumber}</Row>}
        {f.fee && <Row label="State fee">{new Intl.NumberFormat("en-US", { style: "currency", currency: f.fee.currency }).format(f.fee.total)}</Row>}
        {f.expeditedTier && <Row label="Processing">{f.expeditedTier.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</Row>}
        <Row label="Registered agent">{f.registeredAgent ? `Palm, ${f.registeredAgent.status.replace(/_/g, " ")}` : "Your own agent"}</Row>
        <Row label="EIN">{f.ein ? (f.ein.number ? f.ein.number : `Palm is applying (${f.ein.status.replace(/_/g, " ")})`) : "Not requested"}</Row>
      </Rows>
      {!canceled && <PalmQuestions openCases={f.openCases} />}
      {page.formationError && <ErrorLine>{page.formationError}</ErrorLine>}
    </Section>
  );
}

// ── Details ──────────────────────────────────────────────────────────────

function Details() {
  const { page, view, asset } = useEntity();
  const t = useTone();
  const corp = view.etype === "C-Corp";
  const formed = fmtDate(asset.formationDate);

  return (
    <Section title="Details">
      {/* Free text (addresses, notes with links, file names) wraps instead of running off the card. */}
      <Rows className="[overflow-wrap:anywhere]">

        {view.isTrust ? (
          <>
            {/* Trustees, grantors and beneficiaries live on the People tab. */}
            <Row label="Trust date">{formed ? <span className="tabular-nums">{formed}</span> : <AddValue field="formationDate" />}</Row>
            <Row label="Governing law">{val(asset.state) ?? <AddValue field="state" />}</Row>
            <Row label="Tax classification">{val(asset.llcType) ?? <AddValue field="llcType" />}</Row>
            <Row label="Trust agreement">{filedFact(asset, "trustAgreement", asset.formationDate)}</Row>
            <Row label="Mailing address">{val(asset.address) ?? <AddValue field="address" />}</Row>
          </>
        ) : (
          <>
            <TaxClassRows />
            <Row label={corp ? "Bylaws" : "Operating agreement"}>{filedFact(asset, "operatingAgreement", asset.operatingAgreementDate)}</Row>
            <Row label={corp ? "Certificate" : "Articles of org"}>{filedFact(asset, "articles", asset.articlesOfOrgDate)}</Row>
            <Row label={asset.fileNumber ? "State file number" : "State link"}>
              {asset.fileNumber || asset.stateLink ? (
                <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                  {asset.fileNumber && <span className="font-mono tabular-nums tracking-[0.02em]">{asset.fileNumber}</span>}
                  {asset.stateLink && (
                    <TextLink href={asset.stateLink}>
                      View filing
                      <Icon name="external" className="h-3 w-3" />
                    </TextLink>
                  )}
                </span>
              ) : (
                <AddValue field="fileNumber" />
              )}
            </Row>
          </>
        )}

        {val(asset.notes) && (
          <Row label="Notes">
            <span className={`whitespace-pre-wrap ${t.soft}`}>{asset.notes}</span>
          </Row>
        )}
      </Rows>
    </Section>
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
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.focus({ preventScroll: true });
    }, 60);
  };
}

/** An empty value, as the one thing to do about it. */
function AddValue({ field, label = "Add" }: { field: string; label?: string }) {
  const editField = useEditField();
  return (
    <TextButton onClick={() => editField(field)}>
      <Icon name="plus" className="h-3 w-3" />
      {label}
    </TextButton>
  );
}

/** A filing's date, and whether the document itself is on file; Upload when it isn't. */
function filedFact(asset: Asset, kind: FileKind, date?: string): ReactNode {
  const file = asset[kind];
  const when = fmtDate(date);
  if (!file && !when) return <UploadSlot kind={kind} />;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {file ? (
        <StoredFileLink file={file} className={`${linkClass} font-normal`}>
          <Dot tone="good">On file</Dot>
        </StoredFileLink>
      ) : (
        <Dot tone="warn">No document</Dot>
      )}
      {when ? <span className="tabular-nums">{when}</span> : <span className="text-gray-500">no date</span>}
    </span>
  );
}

function UploadSlot({ kind }: { kind: FileKind }) {
  const { goToTab } = useEntity();
  return (
    <TextButton onClick={() => goToTab("documents", `filing-${kind}`, "center")}>
      <Icon name="upload" className="h-3 w-3" />
      Upload
    </TextButton>
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
  const t = useTone();
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (view.isTrust) return null;
  const a = entityAddresses(asset);
  const forming = formingNow(asset);
  const alerts = a.gaps.filter((g) => g.tone === "bad" || g.tone === "warn").length;
  const source = asset.registeredAgentSource ?? "";
  const palmStopped = source.startsWith("Palm stopped");

  async function check(code: string) {
    setErrors((e) => ({ ...e, [code]: "" }));
    const why = await page.checkForeignRecord(code);
    if (why) setErrors((e) => ({ ...e, [code]: why }));
  }

  const checks = (list: Check[]) =>
    list.length > 0 && (
      <span className="mt-1.5 flex flex-col gap-1">
        {list.map((c) => (
          <Dot key={c.text} tone={c.tone === "info" ? "muted" : c.tone} className="!items-start !whitespace-normal [&>span:first-child]:mt-[6px] [&>span:first-child]:shrink-0">
            <span className="text-[12px] leading-snug">{c.text}</span>
          </Dot>
        ))}
      </span>
    );

  return (
    <Section
      id="addresses"
      title="Addresses"
      count={alerts || undefined}
      alert={alerts > 0}
      info={
        <>
          The <b>principal office</b> is where the business is: the address the state lists publicly. The <b>mailing address</b> is where its mail goes, when that's somewhere else. The{" "}
          <b>registered agent</b> accepts lawsuits and official notices for it: one in every state it's registered in, at a street address in that state (never a PO box or mailbox),
          open during business hours. A company formed in one state and run from another needs an agent in both.
        </>
      }
      actions={
        <TextButton onClick={page.startEditing}>
          <Icon name="edit" className="h-3 w-3" /> Edit
        </TextButton>
      }
    >
      <Rows className="[overflow-wrap:anywhere]">
        {!a.principal.value && !a.mailing.value ? (
          // No address at all: one line, one thing to do.
          <Row label="Address" actions={<AddValue field="address" />}>
            <span className={t.faint}>None on record. The principal office is the address the state lists; mail goes there unless you add a separate mailing address.</span>
          </Row>
        ) : (
          <>
        <Row label="Principal office">
          {a.principal.value ?? <AddValue field="address" />}
          {checks(a.principal.checks)}
        </Row>
        <Row label="Mailing address">
          {a.mailing.value ? (
            <>
              {a.mailing.same ? <span className={t.soft}>Same as the principal office</span> : a.mailing.value}
              {sameAddressText(a.mailing.value, STABLE_ADDRESS) && (
                <span className={`mt-0.5 block text-[12px] ${t.muted}`}>
                  The Stable mailbox: each piece is scanned into <Link to="/mailbox" className={t.accent}>Mailbox</Link>
                </span>
              )}
            </>
          ) : (
            <span className={t.faint}>None on record: mail goes to the principal office once there is one.</span>
          )}
          {checks(a.mailing.checks)}
        </Row>
          </>
        )}
        {a.agents.map((g) => (
          <Row
            key={g.state}
            label={
              <span>
                {g.term}
                <span className={`block text-[11.5px] ${t.faint}`}>{g.home ? `${g.stateLabel} · formed here` : `${g.stateLabel} · foreign`}</span>
              </span>
            }
            info={g.home && source ? source : !g.home && g.record ? `${g.stateLabel}'s record read through Palm, ${fmtStamp(g.record.checkedAt)}.` : undefined}
            actions={
              g.home ? (
                forming && g.palm ? undefined : <TextLink to={tabPath("compliance")}>{g.palm ? "Manage" : "Move to Palm"}</TextLink>
              ) : g.ask ? undefined : page.palmStatus?.configured ? (
                <TextButton onClick={() => void check(g.state)} disabled={page.foreignBusy === g.state}>
                  {page.foreignBusy === g.state ? "Checking…" : `${g.record ? `Re-check ${g.state}` : `Check ${g.state} record`}${priceSuffix(page.palmMode, stateRecordCents(!!g.fileNumber))}`}
                </TextButton>
              ) : undefined
            }
          >
            {g.name ? (
              <span className="flex flex-wrap items-center gap-x-2">
                <span className="font-medium">{g.palm ? "Palm" : g.name}</span>
                {g.palm && g.name && !/^palm/i.test(g.name) && <span className={t.muted}>listed as {g.name}</span>}
                {g.home && palmStopped && <Dot tone="warn">Confirm</Dot>}
              </span>
            ) : (
              <span className={t.faint}>None on record</span>
            )}
            {g.address && <span className={`mt-0.5 block text-[12.5px] ${t.soft}`}>{g.address}</span>}
            {g.fileNumber && <span className={`mt-0.5 block text-[12px] ${t.muted}`}>File number <span className="font-mono tabular-nums">{g.fileNumber}</span></span>}
            {checks(g.checks)}
            {g.ask && (
              <span className="mt-2 flex flex-wrap gap-2">
                <Button onClick={() => void page.patchAsset({ [`foreign/${g.state}/confirmed`]: true, [`foreign/${g.state}/notNeeded`]: null })}>
                  It does business in {g.stateLabel}
                </Button>
                <Button onClick={() => void page.patchAsset({ [`foreign/${g.state}/notNeeded`]: true, [`foreign/${g.state}/confirmed`]: null })}>
                  Only its mail goes there
                </Button>
              </span>
            )}
            {errors[g.state] && <span className={`mt-1 block text-[12px] ${toneText("bad", t.dark)}`}>{errors[g.state]}</span>}
          </Row>
        ))}
        {a.notNeeded.length > 0 && (
          <Row label="Not registered in">
            <span className={t.soft}>
              {a.notNeeded.map((c) => stateName(c)).join(", ")}: its address is there, but it doesn't do business there.
            </span>{" "}
            <TextButton onClick={() => void page.patchAsset(Object.fromEntries(a.notNeeded.map((c) => [`foreign/${c}/notNeeded`, null])))}>Undo</TextButton>
          </Row>
        )}
      </Rows>
    </Section>
  );
}

// ── Mail (what Palm receives as registered agent) ────────────────────────

const MAIL_SHOWN = 3;
type InboxEvent = { id: string; document_id: string | null };

/**
 * Mail Palm received for the entity, readable here. Shown while Palm is the
 * agent in the current Palm mode (or once mail exists). Unread mail is marked
 * New until it's opened; the full list is on Compliance.
 */
function Mail() {
  const { page, view, asset, goToTab } = useEntity();
  const t = useTone();
  const mode = page.palmMode;
  const docs = page.palmDocs;
  // The agent status in the mode the mail comes from: Palm's answer once in, the saved one until then.
  const status = page.palmRa !== undefined ? page.palmRa?.status : mode ? asset.palm?.[mode]?.ra?.status : undefined;
  const shown = !view.isTrust && !!page.palmStatus?.configured && !!mode && (status === "active" || !!docs?.length);
  const assetId = page.id;
  const count = docs?.length ?? 0;
  const [unread, setUnread] = useState<InboxEvent[]>([]);
  const [error, setError] = useState("");

  // Unread mail only; nothing is marked read just by looking at Overview.
  useEffect(() => {
    if (!shown || !mode || !assetId) return;
    let live = true;
    palmCall<{ events: InboxEvent[] }>("inbox", { assetId, mode, unread: true })
      .then((r) => live && setUnread(r.events.filter((e) => e.document_id)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [shown, mode, assetId, count]);

  if (!shown) return null;

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
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't open that document."));
  };
  // New first, then Palm's order (legal papers, notices, newest).
  const list = docs ? [...docs].sort((a, b) => Number(isNew(b)) - Number(isNew(a))).slice(0, MAIL_SHOWN) : [];

  return (
    <Section
      title="Mail"
      count={count}
      info="State mail and legal papers served on the entity, received by Palm as its registered agent."
      actions={
        mode === "test" || count > MAIL_SHOWN ? (
          <>
            {mode === "test" && <Dot tone="warn">Test mode</Dot>}
            {count > MAIL_SHOWN && <TextButton onClick={() => goToTab("compliance", "palm-mail")}>All mail</TextButton>}
          </>
        ) : undefined
      }
    >
      {docs === null ? (
        page.palmError && page.palmBusinessId ? (
          <Empty
            action={
              <TextButton disabled={!!page.palmBusy} onClick={() => void page.refreshPalm(page.palmBusinessId!)}>
                Try again
              </TextButton>
            }
          >
            Couldn't load mail.
          </Empty>
        ) : (
          <Empty>Checking for mail…</Empty>
        )
      ) : docs.length === 0 ? (
        <Empty>No mail yet.</Empty>
      ) : (
        <Rows>
          {list.map((d) => {
            const kind = docKindOf(d);
            const legal = kind === "service_of_process";
            const meta = [d.filename, d.created_at ? fmtDate(d.created_at.slice(0, 10)) : null].filter(Boolean).join(" · ");
            return (
              <div key={d.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] leading-snug">
                    <span className={legal ? `font-medium ${toneText("bad", t.dark)}` : t.text}>{DOC_LABEL[kind] ?? (kind || "Document").replace(/_/g, " ")}</span>
                    {isNew(d) && <Dot tone="accent">New</Dot>}
                  </div>
                  {meta && <div className={`mt-0.5 truncate text-[12px] tabular-nums ${t.muted}`}>{meta}</div>}
                </div>
                <IconButton icon="external" label="Open" onClick={() => open(d)} />
              </div>
            );
          })}
        </Rows>
      )}
      <ErrorLine>{error}</ErrorLine>
    </Section>
  );
}

/** Tax class with where it came from, and a document that disagrees. */
function TaxClassRows() {
  const { page, view, asset, tabPath, goToTab } = useEntity();
  const label = view.etype === "C-Corp" ? "Classification" : "Tax classification";
  const c = asset.llcTypeConflict;
  if (!asset.llcType && !c)
    return (
      <Row label={label}>
        <AddValue field="llcType" />
      </Row>
    );

  const src = asset.llcTypeSource;
  const home = view.homeReturn;
  const homeLine = home ? `Reported on ${home.form === "return" ? `${home.name}'s return` : `${home.name}'s ${home.form}`}.` : null;
  let status: ReactNode = null;
  let hint: string | null = null;
  let action: ReactNode = null;
  if (!c) {
    if (formingNow(asset) && (!src || src === BY_HAND)) {
      // Being formed: the IRS's EIN letter, which Palm brings, is what confirms it.
      status = <Dot tone="muted">Set at formation</Dot>;
      hint = "The EIN letter confirms it once Palm has it.";
    } else if (src && src !== BY_HAND) {
      status = <Dot tone="good">From document</Dot>;
      hint = src;
    } else if (src === BY_HAND) {
      status = <Dot tone="muted">By hand</Dot>;
      hint = "Not yet matched to a document.";
    } else if (asset.einLetter || asset.w9) {
      if (page.sorting > 0) {
        status = <Dot tone="muted">Checking…</Dot>;
        hint = "Checking it against the EIN letter and W-9.";
      } else if (page.aiDown) {
        status = <Dot tone="muted">Reading paused</Dot>;
        hint = "Not confirmed yet — document reading is paused.";
      } else {
        status = <Dot tone="warn">Unconfirmed</Dot>;
        hint = "Not confirmed by the EIN letter or W-9 on file. Check them, or run Verify.";
        action = <TextLink to={tabPath("documents")}>Check documents</TextLink>;
      }
    } else {
      status = <Dot tone="warn">Unconfirmed</Dot>;
      hint = "Not confirmed by a document. Upload the EIN letter or W-9.";
      action = <TextButton onClick={() => goToTab("documents", "filing-einLetter", "center")}>Upload EIN letter or W-9</TextButton>;
    }
  }
  // Whose return it lands on is a fact, so it shows; only the hint waits behind (i).
  const info = hint ? <p className="break-words">{hint}</p> : undefined;

  return (
    <>
      <Row label={label} info={info} actions={action ?? undefined}>
        {asset.llcType ? (
          <>
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              {asset.llcType}
              {status}
            </span>
            {homeLine && <span className="mt-0.5 block text-[12px] text-gray-500">{homeLine.replace(/\.$/, "")}</span>}
          </>
        ) : undefined}
      </Row>
      {c && (
        <Row label={<Dot tone="warn">Conflict</Dot>} info={c.evidence ? `${c.evidence}.` : undefined}>
          <div className="[overflow-wrap:anywhere]">
            <span className="font-medium">{c.docName}</span> says <span className="font-medium">{c.value}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button onClick={() => void page.acceptDocumentTaxClass()}>Use {c.value}</Button>
            <Button kind="ghost" onClick={() => void page.dismissTaxClassConflict()}>
              Keep {asset.llcType || "blank"}
            </Button>
          </div>
        </Row>
      )}
    </>
  );
}

// ── Edit form ────────────────────────────────────────────────────────────

const ENTITY_TYPES = ["LLC", "C-Corp", "LP", "Trust"] as const;

function EditForm() {
  const { page } = useEntity();
  const t = useTone();
  const { form } = page;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const ft = entityType(form);
  const trust = ft === "Trust";
  const classes: readonly string[] = TAX_CLASSES[ft];
  const named = !!form.name?.trim();
  const set = <K extends keyof Asset>(k: K, v: Asset[K]) => {
    setError(""); // an old save error doesn't apply to new edits
    page.setForm((f) => ({ ...f, [k]: v }));
  };
  const text = (k: "name" | "state" | "ein" | "registeredAgent" | "registeredAgentAddress" | "address" | "mailingAddress" | "trustees" | "grantors" | "beneficiaries" | "fileNumber" | "stateLink") => ({
    id: `edit-${k}`,
    value: form[k] || "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value),
  });
  const date = (k: "formationDate" | "operatingAgreementDate" | "articlesOfOrgDate") => ({
    id: `edit-${k}`,
    type: "date",
    value: form[k] || "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value),
  });

  async function save() {
    setSaving(true);
    setError("");
    try {
      await page.handleSave();
    } catch (err) {
      console.error("save failed", err);
      setError("Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section id="entity-edit" title="Edit details" className="scroll-mt-[calc(3.5rem+env(safe-area-inset-top)+80px)] lg:scroll-mt-20">
      <div className="grid grid-cols-1 gap-x-4 gap-y-4 p-5 md:grid-cols-2">
        <Field label="Entity name" wide>
          <Input {...text("name")} />
        </Field>

        {/* Not a <label>: a label would pass clicks on its text to the first type button. */}
        <div role="group" aria-label="Entity type">
          <span className={`mb-1.5 block text-[12px] ${t.muted}`}>Entity type</span>
          <div className={`grid grid-cols-4 gap-1 rounded-lg border p-1 ${t.dark ? "border-white/10 bg-white/[0.02] glass-card" : "border-gray-200 bg-gray-50"}`}>
            {ENTITY_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => set("type", type)}
                aria-pressed={form.type === type}
                className={`h-[22px] cursor-pointer rounded-md text-[12px] font-medium transition-colors max-sm:h-[40px] ${
                  form.type === type
                    ? t.dark ? "bg-white text-gray-950" : "bg-gray-900 text-white"
                    : t.dark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900"
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <Field label="Status">
          <Select value={form.status || "Active"} onChange={(e) => set("status", e.target.value)}>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="Dissolved">Dissolved</option>
            <option value="Pending">Pending</option>
          </Select>
        </Field>
        <Field label={trust ? "Governing law (state)" : "State of formation"}>
          <Input {...text("state")} />
        </Field>
        <Field label="EIN" hint={einLooksRight(form.ein) ? undefined : <span className={toneText("warn", t.dark)}>An EIN is nine digits, like 93-1234567.</span>}>
          <Input {...text("ein")} className="font-mono tabular-nums" placeholder="93-1234567" />
        </Field>
        <Field label={trust ? "Mailing address" : "Principal office"} hint={trust ? undefined : "Where the business is: the address the state lists."}>
          <Input {...text("address")} />
        </Field>
        {!trust && (
          <Field label="Mailing address" hint="Leave blank when mail goes to the principal office.">
            <Input {...text("mailingAddress")} placeholder={form.address || "Same as the principal office"} />
          </Field>
        )}
        {!trust && (
          <>
            <Field label={`${agentTerm(stateCode(form.state))}${form.state ? ` (${form.state})` : ""}`}>
              <Input {...text("registeredAgent")} />
            </Field>
            <Field label="Agent's street address" hint={`In ${form.state || "the state of formation"}; not a PO box or mailbox.`}>
              <Input {...text("registeredAgentAddress")} />
            </Field>
            {foreignStates(form).map((code) => {
              const f = form.foreign?.[code] ?? {};
              const setF = (k: "agent" | "agentAddress" | "fileNumber", v: string) => set("foreign", { ...(form.foreign ?? {}), [code]: { ...f, [k]: v } });
              return (
                <div key={code} className={`grid grid-cols-1 gap-x-4 gap-y-4 rounded-xl border p-4 md:col-span-2 md:grid-cols-2 ${t.line}`}>
                  <p className={`text-[12px] font-medium md:col-span-2 ${t.soft}`}>
                    {stateName(code)}: registered as a foreign {trust ? "entity" : ft === "C-Corp" ? "corporation" : "LLC"}
                  </p>
                  <Field label={agentTerm(code)}>
                    <Input value={f.agent ?? ""} onChange={(e) => setF("agent", e.target.value)} />
                  </Field>
                  <Field label="Agent's street address" hint={`In ${stateName(code)}; not a PO box or mailbox.`}>
                    <Input value={f.agentAddress ?? ""} onChange={(e) => setF("agentAddress", e.target.value)} />
                  </Field>
                  <Field label={`${stateName(code)} file number`}>
                    <Input value={f.fileNumber ?? ""} onChange={(e) => setF("fileNumber", e.target.value)} className="font-mono" />
                  </Field>
                </div>
              );
            })}
            <Field label="Registered in another state too?" hint="Doing business elsewhere (an office, staff, operating property) means registering there, with an agent there.">
              <Select
                value=""
                onChange={(e) => e.target.value && set("foreign", { ...(form.foreign ?? {}), [e.target.value]: {} })}
              >
                <option value="">Add a state…</option>
                {US_STATES.filter(([code]) => code !== stateCode(form.state) && !foreignStates(form).includes(code)).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
        <Field label={trust ? "Trust date" : "Formation date"}>
          <Input {...date("formationDate")} />
        </Field>
        <Field label="Entity classification">
          <Select id="edit-llcType" value={form.llcType || ""} onChange={(e) => set("llcType", e.target.value)}>
            <option value="">Select…</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {form.llcType && !classes.includes(form.llcType) && <option value={form.llcType}>{form.llcType}</option>}
          </Select>
        </Field>

        {trust ? (
          <>
            <Field label="Trustees">
              <Input {...text("trustees")} placeholder="e.g. Robert Burton, Claire Burton" />
            </Field>
            <Field label="Grantors">
              <Input {...text("grantors")} />
            </Field>
            <Field label="Beneficiaries" wide>
              <Input {...text("beneficiaries")} />
            </Field>
          </>
        ) : (
          <>
            <Field label="State file number">
              <Input {...text("fileNumber")} className="font-mono" />
            </Field>
            <Field label="State filing link">
              <Input {...text("stateLink")} type="url" />
            </Field>
            <Field label="Operating agreement">
              <Input {...date("operatingAgreementDate")} />
            </Field>
            <Field label="Articles of organization">
              <Input {...date("articlesOfOrgDate")} />
            </Field>
          </>
        )}

        <Field label="Notes" wide>
          <Textarea value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} rows={3} className="resize-none" />
        </Field>
      </div>
      <ErrorLine>{error}</ErrorLine>
      <div className={`flex items-center justify-end gap-2 border-t px-5 py-3 ${t.line}`}>
        <Button kind="ghost" onClick={() => page.setEditing(false)}>
          Cancel
        </Button>
        {/* Not disabled while saving: offline, the write only settles once the connection is back, and Save stays clickable as before. */}
        <Button kind="primary" icon="check" onClick={() => void save()} disabled={!named} title={named ? undefined : "The entity needs a name"}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </Section>
  );
}

// ── About (the profile read from the governing documents) ────────────────

function About() {
  const { page, asset, goToTab } = useEntity();
  const t = useTone();
  const p = asset.profile;
  // Nothing on file means nothing to read: To do already asks for the documents.
  if (!p && !page.docs.length && !page.profiling) return null;

  const info = p
    ? `Read ${fmtStamp(p.checkedAt)} from ${p.sources.length ? p.sources.join(", ") : "the documents on file"}.`
    : "Reads the operating agreement (or bylaws / trust agreement) and fills in what the entity is for, what it owns, who runs and owns it, and how it's taxed.";

  return (
    <Section
      title="About"
      info={info}
      actions={
        // One way forward: with nothing on file there is nothing to read, so the body offers adding documents instead.
        p || page.docs.length ? (
          <TextButton onClick={() => void page.buildProfile()} disabled={page.profiling}>
            <Icon name="sparkle" className="h-3 w-3" />
            {page.profiling ? "Reading…" : p ? "Re-read" : "Read documents"}
          </TextButton>
        ) : undefined
      }
    >
      {p ? (
        <>
          <Rows>
            {p.whatItIs && <p className={`px-5 py-4 text-[13px] leading-relaxed ${t.text}`}>{p.whatItIs}</p>}
            {p.members.length > 0 && (
              <Row label="Owners">
                <ul className="space-y-1">
                  {p.members.map((m, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 break-words">{m.name}</span>
                      <span className={`shrink-0 tabular-nums ${t.muted}`}>{m.percent != null ? `${m.percent}%` : "—"}</span>
                    </li>
                  ))}
                </ul>
              </Row>
            )}
            {p.management && (
              <Row label="Managed by">
                {p.managers.length ? p.managers.join(", ") : "—"}
                <span className={t.muted}> · {p.management}</span>
              </Row>
            )}
            {p.taxTreatment && (
              <Row label="Taxed as" info={val(p.taxEvidence)}>
                {p.taxTreatment}
              </Row>
            )}
            {p.governingLaw && <Row label="Governing law">{p.governingLaw}</Row>}
            {p.properties.length > 0 && (
              <Row label="Property">
                <ul className="space-y-1">
                  {p.properties.map((pr, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 break-words">
                        {pr.description}
                        {pr.state ? `, ${pr.state}` : ""}
                      </span>
                      {pr.status && (
                        <Dot tone={/sold/i.test(pr.status) ? "muted" : "good"} className="shrink-0">
                          {pr.status}
                        </Dot>
                      )}
                    </li>
                  ))}
                </ul>
              </Row>
            )}
            {p.keyTerms.length > 0 && (
              <Disclosure label="Key terms" count={p.keyTerms.length}>
                <List items={p.keyTerms} />
              </Disclosure>
            )}
            {p.issues.length > 0 && (
              <Disclosure label={<Dot tone="warn">Issues</Dot>} count={p.issues.length}>
                <List items={p.issues} />
              </Disclosure>
            )}
          </Rows>
          {page.profileError && (
            <div className={`border-t ${t.line}`}>
              <ErrorLine>{page.profileError}</ErrorLine>
            </div>
          )}
        </>
      ) : page.profiling ? (
        <Empty>Reading documents…</Empty>
      ) : page.profileError ? (
        <ErrorLine>{page.profileError}</ErrorLine>
      ) : page.aiDown ? (
        <Empty>Document reading is paused.</Empty>
      ) : page.docs.length ? (
        <Empty>Not read yet: Read documents fills this in from what's on file.</Empty>
      ) : (
        <Empty
          action={
            <Button icon="upload" onClick={() => goToTab("documents")}>
              Add documents
            </Button>
          }
        >
          No documents yet. Add the operating agreement and BFO reads what the entity is from it.
        </Empty>
      )}
    </Section>
  );
}

function List({ items }: { items: string[] }) {
  const t = useTone();
  return (
    <ul className={`list-disc space-y-1 pb-3 pl-9 pr-5 text-[12.5px] leading-snug ${t.soft}`}>
      {items.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  );
}

// ── To do (completeness) ─────────────────────────────────────────────────


function ToDo() {
  const { page, view, asset, goToTab } = useEntity();
  const t = useTone();
  const { checklist } = view;
  const forming = !!formingNow(asset);
  const coming = forming ? view.missing.filter((i) => WITH_FORMATION.has(i.key)) : [];
  const missing = forming ? view.missing.filter((i) => !WITH_FORMATION.has(i.key)) : view.missing;
  const editField = useEditField();
  const done = checklist.filter((i) => i.done);

  // Each item opens exactly where it's fixed: its filing row, the Addresses card, or its field in the edit form.
  function open(item: (typeof missing)[number]) {
    if (item.filing) return goToTab("documents", `filing-${item.key}`, "center");
    if (["trustees", "grantors", "beneficiaries"].includes(item.key)) return goToTab("people");
    if (item.key.startsWith("foreign:")) return document.getElementById("addresses")?.scrollIntoView({ behavior: "smooth", block: "start" });
    editField(item.key);
  }

  return (
    <Section title="To do" count={missing.length}>
      <Rows>
        {missing.length === 0 ? (
          <div className="px-5 py-3">
            <Dot tone="good">Record complete</Dot>
          </div>
        ) : (
          missing.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => open(item)}
              className={`group flex w-full cursor-pointer items-center gap-3 px-5 py-2.5 text-left text-[13px] transition-colors max-sm:min-h-[44px] ${t.text} ${t.hover}`}
            >
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <Icon name="chevronRight" className={`h-3 w-3 ${t.faint}`} />
            </button>
          ))
        )}
        {coming.length > 0 && (
          <Disclosure label="Comes with the formation" count={coming.length}>
            <ul className="pb-2">
              {coming.map((item) => (
                <li key={item.key} className={`flex items-center gap-2.5 px-5 py-1.5 text-[12.5px] ${t.muted}`}>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#818cf8]" aria-hidden />
                  <span className="min-w-0 truncate">{item.label}</span>
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
        {done.length > 0 && (
          <Disclosure label="Done" count={done.length}>
            <ul className="pb-2">
              {done.map((item) => (
                <li key={item.key} className={`flex items-center gap-2.5 px-5 py-1.5 text-[12.5px] ${t.muted}`}>
                  <Icon name="check" className={`h-3 w-3 ${t.dark ? "text-emerald-400" : "text-emerald-600"}`} strokeWidth={2.25} />
                  <span className="min-w-0 truncate">{item.label}</span>
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
      </Rows>
    </Section>
  );
}
