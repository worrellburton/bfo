/**
 * Compliance: the registered agent and the state's record (through Palm), the
 * mail Palm receives for the entity, what's due, and where the records
 * disagree with each other or the rules.
 */

import { useState, type ReactNode } from "react";
import { priceSuffix, stateRecordCents } from "../../lib/palm-pricing";
import { isAdmin } from "../auth";
import { formingNow } from "../entity-addresses";
import { BOI_NOTE, stateCode, stateName, type Obligation, type PaperworkIssue } from "../entity-paperwork";
import { DOC_LABEL, docKindOf, formatAddress, openPalmDocument, RA_STATUS, stateFindings, type Finding, type PalmDocument, type RegistryRecord } from "../palm";
import { PalmQuestions } from "./palm-questions";
import { useEntity } from "./context";
import { fmtDate, fmtStamp } from "./model";
import { Button, buttonClass, Dot, Empty, ErrorLine, Icon, IconButton, InfoText, InfoToggle, Row, Rows, Section, TextButton, toneText, useTone, type Tone } from "./ui";

export function ComplianceTab() {
  const { view } = useEntity();

  if (view.isTrust) {
    const nothing = !view.deadlines.length && !view.issues.length && !view.docOwners.length;
    return (
      <div className="space-y-4">
        {nothing ? (
          <Section flush>
            <Empty>Nothing due and nothing to fix.</Empty>
          </Section>
        ) : (
          <>
            <Deadlines />
            <Checks />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <PalmQuestions title="Palm needs" />
        <RegisteredAgent />
        <Mail />
      </div>
      <div className="min-w-0 space-y-4">
        <Deadlines />
        <Checks />
      </div>
    </div>
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────

const RA_TONE: Record<"good" | "wait" | "bad" | "muted", Tone> = { good: "good", wait: "warn", bad: "bad", muted: "muted" };
const FINDING_TONE: Record<Finding["tone"], Tone> = { bad: "bad", warn: "warn", info: "muted" };
const SEVERITY_TONE: Record<PaperworkIssue["severity"], Tone> = { high: "bad", medium: "warn", low: "muted", info: "good" };

/** A status dot in front of text that may wrap (Dot itself stays on one line). */
function Mark({ tone }: { tone: Tone }) {
  const { dark } = useTone();
  const bg = { good: "bg-emerald-400", warn: "bg-amber-400", bad: "bg-red-400", muted: dark ? "bg-gray-600" : "bg-gray-300", accent: "bg-[#818cf8]" }[tone];
  return <span className={`mt-[0.45em] h-1.5 w-1.5 shrink-0 rounded-full ${bg}`} aria-hidden="true" />;
}

/** One flagged line — a finding, a check — with its explanation behind (i). */
function FlagRow({ tone, children, info }: { tone: Tone; children: ReactNode; info?: ReactNode }) {
  const t = useTone();
  const [open, setOpen] = useState(false);
  return (
    <div className="px-5 py-3">
      <div className={`flex items-start gap-2 text-[13px] leading-snug ${t.text}`}>
        <Mark tone={tone} />
        <span className="min-w-0">
          {children}
          {info && (
            <span className="ml-1.5 inline-flex align-[-2px]">
              <InfoToggle open={open} onToggle={() => setOpen((o) => !o)} label="Details" />
            </span>
          )}
        </span>
      </div>
      {info && (
        <InfoText open={open} className="pl-3.5">
          {info}
        </InfoText>
      )}
    </div>
  );
}

/** A small muted heading inside a section, with an action on the right. */
function SubHead({ children, actions, info, className = "" }: { children: ReactNode; actions?: ReactNode; info?: ReactNode; className?: string }) {
  const t = useTone();
  const [open, setOpen] = useState(false);
  return (
    <div className={`px-5 pb-1 pt-4 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className={`flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] ${t.muted}`}>
          {children}
          {info && <InfoToggle open={open} onToggle={() => setOpen((o) => !o)} />}
        </div>
        {actions}
      </div>
      {info && <InfoText open={open}>{info}</InfoText>}
    </div>
  );
}

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  const { accent } = useTone();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`relative inline-flex items-center gap-1 font-medium hover:underline max-sm:after:absolute max-sm:after:-inset-y-3 max-sm:after:inset-x-0 max-sm:after:content-[''] ${accent}`}
    >
      {children}
      <Icon name="external" className="h-3 w-3" />
    </a>
  );
}

// ── Registered agent (Palm) ──────────────────────────────────────────────

const stateNameOf = (s?: string) => stateName(stateCode(s)) || "The state";

function RegisteredAgent() {
  const { page, asset } = useEntity();
  const t = useTone();
  const status = page.palmStatus;
  const svc = page.palmRa;
  const mode = page.palmMode;

  // Until Palm answers, go by what was last seen, and don't offer the move.
  const known = svc !== undefined;
  const cached = mode ? asset.palm?.[mode]?.ra : undefined;
  const raStatus = known ? svc?.status ?? null : cached?.status ?? null;
  const palmIsAgent = raStatus === "active";
  const inFlight = raStatus === "pending" || raStatus === "termination_requested";
  // Formed through Palm with its agent service: Palm is appointed with the formation itself.
  const forming = formingNow(asset);
  const canMove = known && isAdmin() && !palmIsAgent && !inFlight && !forming;
  const st = raStatus ? RA_STATUS[raStatus] : null;
  const agentShown = palmIsAgent ? svc?.name ?? cached?.name ?? asset.registeredAgent : asset.registeredAgent;
  const agentAddress = palmIsAgent ? formatAddress(svc?.address) : null;
  const configured = !!status?.configured;
  const busy = !!page.palmBusy;

  const title = (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      Registered agent
      {configured && mode === "test" && <Dot tone="warn">Test mode</Dot>}
    </span>
  );

  const actions = configured ? (
    <>
      {page.palmBusinessId && (
        <IconButton
          icon="refresh"
          label={page.palmBusy === "refresh" ? "Refreshing…" : "Refresh"}
          disabled={busy}
          onClick={() => void page.refreshPalm(page.palmBusinessId!)}
          className={page.palmBusy === "refresh" ? "[&>svg]:animate-spin" : ""}
        />
      )}
      {canMove && (
        <Button kind="primary" disabled={busy} onClick={() => void page.moveAgentToPalm()}>
          {page.palmBusy === "move" ? "Requesting…" : svc?.status === "failed" ? "Try again" : "Make Palm the agent"}
        </Button>
      )}
      {known && !isAdmin() && !palmIsAgent && !inFlight && <span className={`text-[12px] ${t.muted}`}>Owner or admin can change it</span>}
    </>
  ) : undefined;

  let body: ReactNode;
  if (!status) body = <Empty>Checking the Palm connection…</Empty>;
  else if (status.error)
    body = (
      <Empty
        action={
          <Button onClick={() => void page.loadPalmStatus()} icon="refresh">
            Try again
          </Button>
        }
      >
        Couldn't reach Palm just now.
      </Empty>
    );
  else if (!status.configured) body = <NotConnected />;
  else if (forming)
    body = (
      <Rows>
        <Row label="Agent">
          {forming.palmAgent ? "Palm" : asset.registeredAgent || <span className={t.faint}>The agent named in the formation</span>}
          <span className={`mt-0.5 block text-[12px] ${t.muted}`}>
            Appointed with the formation. {stateNameOf(asset.state)} has no record of the entity until it approves the formation; the state record is read after that.
          </span>
        </Row>
      </Rows>
    );
  else {
    const reason = svc?.status === "failed" ? svc.rejection_reason ?? page.palmInbox.find((e) => e.rejection_reason)?.rejection_reason : null;
    const statusInfo =
      svc?.status === "pending"
        ? "Palm is filing the change with the state. It can take a few business days; this updates when the state accepts it."
        : svc?.status === "failed"
          ? "Palm Console shows the reason under this business; sort that out before trying again."
          : undefined;

    body = (
      <>
        <Rows>
          <Row label="Agent">
            {palmIsAgent ? (
              <span>
                Palm
                <span className={t.muted}>
                  {" "}
                  · listed as {agentShown || "Palm's agent"}
                  {agentAddress ? ` · ${agentAddress}` : ""}
                </span>
              </span>
            ) : agentShown || asset.registeredAgentSource ? (
              <span>
                {agentShown || <span className={t.faint}>—</span>}
                {asset.registeredAgentSource && <span className={`mt-0.5 block text-[12px] ${t.muted}`}>{asset.registeredAgentSource}</span>}
              </span>
            ) : (
              <span>
                <span className={toneText("bad", t.dark)}>None on record</span>
                <span className={`mt-0.5 block text-[12px] ${t.muted}`}>Every entity must keep one in its state. Make Palm the agent, or add yours under Edit.</span>
              </span>
            )}
          </Row>
          {(st || (page.palmBusinessId && svc === null)) && (
            <Row label="Status" info={statusInfo}>
              {st ? (
                <span className="inline-flex flex-col gap-1">
                  <Dot tone={RA_TONE[st.tone]}>
                    {st.label}
                    {svc?.status === "active" && svc.started_at ? ` · since ${fmtDate(svc.started_at.slice(0, 10))}` : ""}
                  </Dot>
                  {svc?.status === "failed" && (
                    <span className={`text-[12px] leading-snug ${toneText("bad", t.dark)}`}>
                      {reason ? `The state didn't accept it: ${reason}.` : "Palm couldn't complete the change."}
                    </span>
                  )}
                </span>
              ) : (
                <Dot tone="muted">Palm isn't the agent</Dot>
              )}
            </Row>
          )}
        </Rows>
        <StateRecord palmIsAgent={palmIsAgent} startedAt={svc?.started_at ?? null} />
        <ErrorLine>{page.palmError}</ErrorLine>
      </>
    );
  }

  return (
    <Section id="registered-agent" title={title} actions={actions} className="scroll-mt-[calc(3.5rem+env(safe-area-inset-top)+80px)] lg:scroll-mt-20">
      {body}
    </Section>
  );
}

function NotConnected() {
  const t = useTone();
  return (
    <Rows>
      <Row
        info={
          <>
            <p>Connect Palm to read this entity's record straight from the state and to have Palm act as its registered agent, with state mail and any legal papers delivered here.</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4">
              <li>
                In Palm Console, open <b>API Keys</b> and generate a key. Start with a test key (<code>sk_test_…</code>): nothing is filed or billed.
              </li>
              <li>
                In Vercel, add it to the <b>bfo</b> project as <code>PALM_API_KEY</code> (mark it Sensitive), then redeploy.
              </li>
            </ol>
          </>
        }
        actions={
          <a href="https://platform.getpalm.com" target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", t.dark)}>
            Open Palm Console
            <Icon name="external" className="h-3 w-3" />
          </a>
        }
      >
        <span className="mr-1.5">Palm isn't connected.</span>
      </Row>
    </Rows>
  );
}

/** What the state's record says, read through Palm — and, when the search was ambiguous, which entry is this one. */
function StateRecord({ palmIsAgent, startedAt }: { palmIsAgent: boolean; startedAt: string | null }) {
  const { page, asset } = useEntity();
  const t = useTone();
  const rec = asset.stateRecord;
  const findings = rec ? stateFindings(rec, asset) : [];
  const choices = page.registryChoices ?? [];
  const stale = !!rec && palmIsAgent && !!startedAt && rec.checkedAt < Date.parse(startedAt);
  const standing = rec?.standing ? (["registration", "tax", "agent"] as const).filter((k) => rec.standing?.[k]) : [];
  const hasRows = !!rec && (!!rec.status || standing.length > 0 || !!rec.registrationNumber || !!rec.agent || !!rec.address || !!rec.managers?.length || !!rec.formationDate || findings.length > 0);

  return (
    <div className={`border-t ${t.line}`}>
      <SubHead
        className={!hasRows && !choices.length ? "pb-4" : ""}
        info={
          rec ? (
            <>
              Read from the state through Palm, {fmtStamp(rec.checkedAt)}.
              {stale ? " That was before Palm became the agent — re-check to see the change on the state's side." : ""}
            </>
          ) : undefined
        }
        actions={
          <TextButton onClick={() => void page.checkStateRecord()} disabled={!!page.palmBusy}>
            {page.palmBusy === "record" ? "Checking…" : `${rec ? "Re-check state record" : "Check state record"}${priceSuffix(page.palmMode, stateRecordCents(!!asset.fileNumber))}`}
          </TextButton>
        }
      >
        <span className={`font-medium ${t.soft}`}>State record</span>
        <span className="tabular-nums">· {rec ? `read ${fmtStamp(rec.checkedAt)}` : "not checked"}</span>
        {rec?.mode === "test" && <Dot tone="muted">sandbox data</Dot>}
      </SubHead>

      {choices.length > 0 && (
        <>
          <SubHead className="pt-2">Which of these is {asset.name}?</SubHead>
          <Rows>
            {choices.slice(0, 6).map((r, i) => (
              <RegistryChoice key={`${r.registration_number ?? r.palm_id}-${i}`} r={r} />
            ))}
          </Rows>
          {hasRows && <div className={`mt-1 border-t ${t.line}`} />}
        </>
      )}

      {rec && hasRows && (
        <Rows>
          {rec.status && (
            <Row label="Status">
              <Dot tone={rec.status === "active" ? "good" : "bad"} className="capitalize">
                {rec.status}
              </Dot>
            </Row>
          )}
          {standing.length > 0 && (
            <Row label="Standing">
              <span className="inline-flex flex-wrap gap-x-3 gap-y-1">
                {standing.map((k) => (
                  <Dot key={k} tone={rec.standing?.[k] === "compliant" ? "good" : "bad"}>
                    {k === "registration" ? "Filings" : k === "tax" ? "Tax" : "Agent"} {rec.standing?.[k] === "compliant" ? "current" : "behind"}
                  </Dot>
                ))}
              </span>
            </Row>
          )}
          {rec.registrationNumber && (
            <Row label="File number">
              <span className="font-mono tabular-nums tracking-[0.02em]">{rec.registrationNumber}</span>
            </Row>
          )}
          {rec.agent && (
            <Row label="Agent on file">
              {rec.agent}
              {rec.agentAddress && <span className={`mt-0.5 block text-[12px] ${t.muted}`}>{rec.agentAddress}</span>}
            </Row>
          )}
          {rec.address && <Row label="Address on file">{rec.address}</Row>}
          {rec.managers && rec.managers.length > 0 && <Row label="People on file">{rec.managers.join(", ")}</Row>}
          {rec.formationDate && (
            <Row label="Formed">
              <span className="tabular-nums">{fmtDate(rec.formationDate.slice(0, 10))}</span>
            </Row>
          )}
          {findings.map((f, i) => {
            // "Not in good standing: a required state filing or fee is outstanding." — the why goes behind (i).
            const split = f.text.startsWith("Not in good standing: ");
            return (
              <FlagRow key={i} tone={FINDING_TONE[f.tone]} info={split ? "A required state filing or fee is outstanding." : undefined}>
                {split ? "Not in good standing." : f.text}
              </FlagRow>
            );
          })}
        </Rows>
      )}
    </div>
  );
}

function RegistryChoice({ r }: { r: RegistryRecord }) {
  const { page } = useEntity();
  const t = useTone();
  const meta = [r.registration_jurisdiction, r.registration_number, r.status, r.formation_date ? `formed ${r.formation_date.slice(0, 10)}` : null].filter(Boolean).join(" · ");
  return (
    <Row
      actions={
        <Button onClick={() => void page.checkStateRecord(r)} disabled={!!page.palmBusy}>
          This one
        </Button>
      }
    >
      {r.name}
      {meta && <span className={`mt-0.5 block text-[12px] tabular-nums ${t.muted}`}>{meta}</span>}
    </Row>
  );
}

// ── Mail (Palm documents) ────────────────────────────────────────────────

/** State mail and legal papers Palm received as the registered agent, most urgent first. */
function Mail() {
  const { page } = useEntity();
  const [openError, setOpenError] = useState("");
  const docs = page.palmDocs;
  // Only where mail can arrive: Palm connected and this entity added to Palm.
  if (!page.palmStatus?.configured || (!page.palmBusinessId && !docs?.length)) return null;

  return (
    <Section
      id="palm-mail"
      className="scroll-mt-[calc(3.5rem+env(safe-area-inset-top)+80px)] lg:scroll-mt-20"
      title="Mail"
      count={docs?.length}
      info="State mail and any legal papers served on the entity, received by Palm as its registered agent. New mail is marked New on your first visit."
    >
      {docs === null ? (
        page.palmRa === undefined || page.palmBusy === "refresh" ? (
          <Empty>Checking for mail…</Empty>
        ) : (
          <Empty
            action={
              <Button icon="refresh" disabled={!!page.palmBusy} onClick={() => void page.refreshPalm(page.palmBusinessId!)}>
                Refresh
              </Button>
            }
          >
            Mail hasn't loaded.
          </Empty>
        )
      ) : docs.length === 0 ? (
        <Empty>No mail yet.</Empty>
      ) : (
        <Rows>
          {docs.map((d) => (
            <MailRow key={d.id} d={d} onError={setOpenError} />
          ))}
        </Rows>
      )}
      <ErrorLine>{openError}</ErrorLine>
    </Section>
  );
}

function MailRow({ d, onError }: { d: PalmDocument; onError: (msg: string) => void }) {
  const { page } = useEntity();
  const t = useTone();
  const kind = docKindOf(d);
  const legal = kind === "service_of_process";
  const isNew = page.palmInbox.some((e) => !e.read_at && e.document_id === d.id);
  const meta = [d.filename, d.created_at ? fmtDate(d.created_at.slice(0, 10)) : null].filter(Boolean).join(" · ");
  const open = () => {
    onError("");
    void openPalmDocument(d).catch((e) => onError(e instanceof Error ? e.message : "Couldn't open that document."));
  };
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] leading-snug">
          <span className={legal ? `font-medium ${toneText("bad", t.dark)}` : t.text}>{DOC_LABEL[kind] ?? (kind || "Document").replace(/_/g, " ")}</span>
          {isNew && <Dot tone="accent">New</Dot>}
        </div>
        {meta && <div className={`mt-0.5 truncate text-[12px] tabular-nums ${t.muted}`}>{meta}</div>}
      </div>
      <IconButton icon="external" label="Open" onClick={open} />
    </div>
  );
}

// ── Deadlines ────────────────────────────────────────────────────────────

function Deadlines() {
  const { view } = useEntity();
  if (!view.deadlines.length) return null;
  return (
    <Section
      title="Deadlines"
      info={`${view.isTrust ? "Beneficial-ownership (BOI) reporting doesn't apply to trusts." : BOI_NOTE} Dates assume a calendar tax year.`}
    >
      <Rows>
        {view.deadlines.map((d) => (
          <DeadlineRow key={d.key} d={d} />
        ))}
      </Rows>
    </Section>
  );
}

function DeadlineRow({ d }: { d: Obligation }) {
  const t = useTone();
  const [open, setOpen] = useState(false);
  // Calendar days in local time, so "today" is today wherever you are.
  const days = d.due ? localDayDiff(d.due) : null;
  const soon = days != null && days <= 45;
  const warn = toneText("warn", t.dark);
  return (
    <div className="px-5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className={`min-w-0 text-[13px] leading-snug ${t.text}`}>
          {d.title}
          <span className="ml-1.5 inline-flex align-[-2px]">
            <InfoToggle open={open} onToggle={() => setOpen((o) => !o)} label="Details" />
          </span>
        </div>
        {d.due && (
          <div className="shrink-0 text-right tabular-nums leading-snug">
            <div className={`text-[13px] ${soon ? warn : t.text}`}>{fmtDate(d.due)}</div>
            <div className={`text-[12px] ${soon ? warn : t.muted}`}>{days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}</div>
          </div>
        )}
      </div>
      {(d.fee || d.url) && (
        <div className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] ${t.muted}`}>
          {d.fee && <span>{d.fee}</span>}
          {d.url && <ExtLink href={d.url}>{d.urlLabel ?? "File online"}</ExtLink>}
        </div>
      )}
      <InfoText open={open}>
        <span className="block">
          {d.agency} · {d.rule}
        </span>
        {d.note && <span className="mt-1 block">{d.note}</span>}
      </InfoText>
    </div>
  );
}

// ── Checks ───────────────────────────────────────────────────────────────

function Checks() {
  const { view, asset } = useEntity();
  const t = useTone();
  const { issues, docOwners } = view;
  if (!issues.length && !docOwners.length) return null;
  const open = issues.filter((i) => i.severity !== "info").length;
  return (
    <Section title="Checks" count={open || undefined} alert={open > 0}>
      {docOwners.length > 0 && (
        <>
          <SubHead>
            <span className="truncate">Owners per {asset.membersSource ?? "its documents"}</span>
          </SubHead>
          <Rows>
            {docOwners.map((m, i) => (
              <div key={i} className="flex items-baseline justify-between gap-3 px-5 py-2.5 text-[13px]">
                <span className={`min-w-0 truncate ${t.text}`}>{m.name}</span>
                <span className={`shrink-0 tabular-nums ${t.muted}`}>{m.percent != null ? `${m.percent}%` : m.role ?? ""}</span>
              </div>
            ))}
          </Rows>
        </>
      )}
      {issues.length > 0 && (
        <Rows className={docOwners.length ? `border-t ${t.line}` : ""}>
          {issues.map((i) => (
            <FlagRow key={i.key} tone={SEVERITY_TONE[i.severity]} info={i.detail || undefined}>
              {i.title}
            </FlagRow>
          ))}
        </Rows>
      )}
    </Section>
  );
}

/** Whole days from today to a YYYY-MM-DD date, both in local time. */
function localDayDiff(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return Math.round((Date.parse(iso) - Date.now()) / 86400000);
  const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}
