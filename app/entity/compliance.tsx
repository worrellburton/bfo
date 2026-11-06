/**
 * An entity's Compliance tab: where it stands with the state (the state's own
 * word, dated, and the filing behind it), what it must file and whether each
 * period is recorded as filed, where its records disagree, its registered
 * agent and the state's record (through Palm), Palm's monitoring and the IRS
 * check, and the mail Palm receives for it.
 *
 * Built on the design system (docs/DESIGN.md); the entity page around it is
 * app/entity/*. Periods recorded as filed are kept on the entity
 * (asset.filedPeriods, keyed as app/entity-paperwork.ts names them).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PALM_PRICES, stateRecordCents } from "../../lib/palm-pricing";
import { getUser, isAdmin } from "../auth";
import { shareHolders, standingOf, STALE_DAYS, titleCase, type EntityInput } from "../compliance-map";
import { formingNow } from "../entity-addresses";
import { agentTerm, BOI_NOTE, entityType, filingAgency, hostState, stateCode, stateName, taxClassOf, type FiledRecord, type Obligation, type Period, type PaperworkIssue } from "../entity-paperwork";
import {
  activeConfirmation,
  DOC_LABEL,
  docKindOf,
  effectiveRecord,
  formatAddress,
  fromBundle,
  openPalmDocument,
  palmCall,
  recordLapsed,
  stateFindings,
  type PalmDocument,
  type RegistryRecord,
} from "../palm";
import {
  AiNote,
  Badge,
  Banner,
  Button,
  buttonClasses,
  Card,
  CardSection,
  confirm,
  DateInput,
  Dialog,
  Disclosure,
  Empty,
  Field,
  format,
  IconButton,
  Input,
  Row,
  Rows,
  Segmented,
  Select,
  Status,
  toast,
  useMedia,
  type MenuItem,
  type Tone,
} from "../ui";
import { PalmQuestions } from "./palm-questions";
import { useEntity, usePalmSeed } from "./context";

type FiledPeriods = Record<string, FiledRecord | null>;

const money = (cents: number) => format.money(cents / 100);
const day = (iso: string) => format.date(iso.slice(0, 10), "medium");
const stamp = (ms: number) => format.date(new Date(ms), "medium");
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const todayIso = () => format.isoDate(new Date());

/** Whole days from today to a YYYY-MM-DD date, both in local time. */
function daysFromToday(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
  const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  return Math.round((due.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
}

/** "in 298 days", "today", "67 days late". */
function relDays(iso: string): string {
  const d = daysFromToday(iso);
  return d === 0 ? "today" : d === 1 ? "tomorrow" : d < 0 ? `${days(-d)} late` : `in ${days(d)}`;
}

const DOT: Record<Tone, string> = { neutral: "bg-ink-3", positive: "bg-positive", warning: "bg-warning", negative: "bg-negative", info: "bg-info" };

/** A status dot before words that wrap (Status itself keeps to one line): the dot carries the colour, the words stay ink. */
function Flag({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="flex items-start gap-[6px]">
      <span aria-hidden="true" className={`mt-[7px] size-2 shrink-0 rounded-full ${DOT[tone]}`} />
      <span className="min-w-0">{children}</span>
    </span>
  );
}

/** An external link styled as a button (filing happens on the state's own site). */
function ExternalButton({ href, children, variant = "secondary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" | "quiet" }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant, size: "sm" })}>
      {children}
      <span className="sr-only">, opens in a new tab</span>
    </a>
  );
}

// ── The tab ───────────────────────────────────────────────────────────────

export function ComplianceTab() {
  const { view } = useEntity();
  const wide = useMedia("(min-width: 1024px)");

  if (view.isTrust)
    return (
      <div className="ds grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <StandingCard />
          <Deadlines />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Checks />
        </div>
      </div>
    );

  const standing = <StandingCard key="standing" />;
  const questions = <PalmQuestions key="questions" title="Palm needs" />;
  const deadlines = <Deadlines key="deadlines" />;
  const record = <StateRecordCard key="record" />;
  const agent = <AgentCard key="agent" />;
  const checks = <Checks key="checks" />;
  const monitoring = <Monitoring key="monitoring" />;
  const mail = <Mail key="mail" />;

  // Urgent first on a phone; on desktop the state's side is the main column, the checks the rail.
  if (!wide) return <div className="ds flex flex-col gap-4">{[standing, questions, deadlines, checks, agent, record, monitoring, mail]}</div>;
  return (
    <div className="ds grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4">
      <div className="flex min-w-0 flex-col gap-4">{[standing, questions, deadlines, agent, record]}</div>
      <div className="flex min-w-0 flex-col gap-4">{[checks, monitoring, mail]}</div>
    </div>
  );
}

// ── Standing: the state's word, and what's behind ────────────────────────

function StandingCard() {
  const { page, asset, view } = useEntity();
  const isTrust = view.isTrust;
  const mode = page.palmMode;
  const standing = standingOf(asset as unknown as EntityInput, mode ?? null, new Date(), view.deadlines);
  const where = standing.state ?? "the state";
  const rec = asset.stateRecord;
  const confirmed = rec ? activeConfirmation(rec, asset.stateConfirmed) : null;
  const canConfirm = !!rec && rec.mode === "live" && recordLapsed(rec) && !confirmed && isAdmin(getUser());
  const configured = !!page.palmStatus?.configured;
  const [mark, setMark] = useState<{ o: Obligation; p: Period } | null>(null);

  if (isTrust) {
    const tax = taxClassOf({ ...asset, type: "Trust" });
    return (
      <Card title="Standing">
        <div className="flex flex-col gap-2">
          <Status tone="neutral">Nothing filed with a state</Status>
          <p className="max-w-[68ch] text-body text-ink-2">
            A trust has no state registration or annual report.{" "}
            {tax.value
              ? tax.isDefault
                ? `Its name says it's revocable, so it's read as a ${tax.value.toLowerCase()} until its tax class is recorded.`
                : `It's taxed as a ${tax.value.toLowerCase()}.`
              : "Its tax classification isn't on record, so what it files can't be said yet."}
          </p>
        </div>
      </Card>
    );
  }

  const annual = view.deadlines.find((o) => o.key === "state-annual");
  const stale = !!standing.asOf && Date.now() - standing.asOf > 7 * 86_400_000;
  const check = configured ? () => void readStateRecord(page, asset) : undefined;
  const menu: MenuItem[] = [
    ...(check ? [{ label: rec ? "Read the state's record again…" : "Read the state's record…", icon: "sync" as const, onSelect: check }] : []),
    ...(canConfirm ? [{ label: "The state's own site shows it current…", onSelect: () => void page.confirmStateActive() }] : []),
    ...(confirmed ? [{ label: "Undo the confirmation from the state's site", onSelect: () => void page.undoStateConfirmation() }] : []),
  ];
  const tone: Tone = standing.tone === "good" ? "positive" : standing.tone === "bad" ? "negative" : "neutral";
  const m = standing.missed;
  const missedPeriod = m && annual?.last?.status === "overdue" ? annual.last : null;

  return (
    <Card title="Standing" id="standing" menu={menu.length ? menu : undefined}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Status tone={tone}>
            {standing.word}
            {standing.state && standing.tone !== "unknown" ? ` in ${standing.state}` : ""}
          </Status>
          {rec?.mode === "test" && <Badge>Sandbox data</Badge>}
        </div>

        {standing.tone === "bad" && m && (
          <div className="flex max-w-[68ch] flex-col gap-1 text-body text-ink">
            <p>
              The {m.period} {m.title} was due {day(m.due)} and isn't recorded as filed: {days(m.daysLate)} late.
            </p>
            <p className="text-ink-2">
              {m.lateFee ? `Late fees: ${m.lateFee}. ` : ""}
              {m.consequence}
            </p>
          </div>
        )}
        {standing.tone === "bad" && !m && (
          <p className="max-w-[68ch] text-body text-ink">
            {rec?.status && rec.status !== "active"
              ? `${where} lists it as ${rec.status}. If it should still exist, it can be reinstated with the ${filingAgency(asset.state, entityType(asset))}: the overdue filings and fees, then a reinstatement application.`
              : `A required filing or fee is outstanding with the ${filingAgency(asset.state, entityType(asset))}. Its record through Palm doesn't say which; the state's own business search does.`}
          </p>
        )}
        {standing.tone === "unknown" && !rec && (
          <p className="max-w-[68ch] text-body text-ink-2">
            {configured
              ? `${where === "the state" ? "The state's" : `${where}'s`} record hasn't been read yet. Reading it through Palm shows its status, standing, agent and the people on file. Nothing is filed.`
              : "Palm isn't connected, so the state's record can't be read from here."}
          </p>
        )}

        {standing.asOf && (
          <p className={stale ? "text-small text-warning" : "text-small text-ink-2"}>
            {confirmed
              ? `Seen on ${where === "the state" ? "the state's" : `${where}'s`} own site${confirmed.by ? ` by ${confirmed.by}` : ""}, ${stamp(confirmed.at)}${confirmed.note ? `: ${confirmed.note}` : ""}. Palm's copy still says ${rec?.status && rec.status !== "active" ? rec.status : "not in good standing"}.`
              : `${where === "the state" ? "The state's" : `${where}'s`} record, read through Palm ${stamp(standing.asOf)}${stale ? ". Read it again: standing can change between filings." : "."}`}
          </p>
        )}

        {(missedPeriod || (!rec && check)) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {missedPeriod && annual?.url && (
              <ExternalButton href={annual.url} variant="primary">
                File with the {annual.agency}
              </ExternalButton>
            )}
            {missedPeriod && annual && (
              <Button size="sm" onClick={() => setMark({ o: annual, p: missedPeriod })}>
                Record it as filed…
              </Button>
            )}
            {!rec && check && (
              <Button size="sm" variant="primary" icon="sync" busy={page.palmBusy === "record"} busyLabel="Reading…" disabled={!!page.palmBusy} onClick={check}>
                Read the state's record
              </Button>
            )}
          </div>
        )}
      </div>
      {mark && <MarkFiled o={mark.o} p={mark.p} onClose={() => setMark(null)} />}
    </Card>
  );
}

/** Read the home state's record through Palm, after saying what it costs. */
async function readStateRecord(page: ReturnType<typeof useEntity>["page"], asset: ReturnType<typeof useEntity>["asset"], choice?: RegistryRecord) {
  const live = page.palmMode === "live";
  const cents = choice ? PALM_PRICES.detail.cents : stateRecordCents(!!asset.fileNumber);
  const where = stateName(stateCode(asset.state)) || "the state";
  const ok = await confirm({
    title: choice ? "Read this entry's record?" : `Read ${where === "the state" ? "the state's" : `${where}'s`} record?`,
    message: `Palm reads its status, standing, agent and the people on file from ${where}. Nothing is filed, and nothing on the record here is overwritten.`,
    ...(live
      ? { receipt: { lines: [{ label: asset.fileNumber || choice ? "The record, by its file number" : "A name search, then the record", cents }] }, details: ["Billed to the Palm account."] }
      : { details: ["Palm is in test mode: the record comes from its sandbox, and nothing is billed."] }),
    confirmLabel: live ? `Read it for ${money(cents)}` : "Read it",
    tone: live ? "commit" : "default",
  });
  if (!ok) return;
  const why = await page.checkStateRecord(choice);
  if (why) toast({ message: why });
}

// ── Deadlines, by period ─────────────────────────────────────────────────

const PERIOD_TONE: Record<Period["status"], Tone> = { filed: "neutral", extended: "neutral", current: "neutral", overdue: "negative", unrecorded: "warning", upcoming: "neutral" };

function periodWord(p: Period, where: string): string {
  switch (p.status) {
    case "filed":
      return p.source === "documents" ? "On file in Documents" : `Filed ${day(p.record!.on)}`;
    case "extended":
      return `Extended to ${day(p.extendedTo!)}`;
    case "current":
      return `Current, per ${where}'s record`;
    case "overdue":
      return `Overdue: ${days(p.daysLate ?? 0)} late`;
    case "unrecorded":
      return p.extendedTo ? `Not recorded as filed: extension ran out ${day(p.extendedTo)}` : "Not recorded as filed";
    default:
      return `Due ${day(p.due)}`;
  }
}

function Deadlines() {
  const { view, asset } = useEntity();
  const [mark, setMark] = useState<{ o: Obligation; p: Period } | null>(null);
  const all = view.deadlines;
  if (!all.length) return null;
  const dated = all.filter((o) => !o.conditional);
  const conditional = all.filter((o) => o.conditional);
  const yearEnd = (asset as { taxYearEnd?: unknown }).taxYearEnd;
  const end = Number(yearEnd);
  const fiscal = Number.isInteger(end) && end >= 1 && end <= 11;
  const where = stateName(stateCode(asset.state)) || "the state";
  const overdue = dated.filter((o) => o.overdue).length;

  return (
    <Card
      title="Deadlines"
      count={overdue || undefined}
      countTone="attention"
      info={`What it files with the state and the IRS, the latest period that came due and the next. A period counts as filed once it's recorded here, or once the state's record, read after it came due, shows its filings current. ${view.isTrust ? "Beneficial-ownership (BOI) reporting doesn't apply to trusts." : BOI_NOTE}`}
      flush
    >
      <Rows className="px-5 touch:px-4">
        {dated.map((o) => (
          <DeadlineRow key={o.key} o={o} where={where} onMark={(p) => setMark({ o, p })} />
        ))}
      </Rows>
      {conditional.length > 0 && (
        <div className="border-t border-line px-5 py-2 touch:px-4">
          <Disclosure label="If they apply" count={conditional.length}>
            <Rows>
              {conditional.map((o) => (
                <div key={o.key} className="flex flex-col gap-1 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span className="text-body text-ink">{o.title}</span>
                    {o.when && <span className="text-small text-ink-2 tabular-nums">{day(o.when)}</span>}
                  </div>
                  <p className="max-w-[68ch] text-small text-ink-2">
                    Only {o.conditional}. {o.rule}.{o.note ? ` ${o.note}` : ""}
                  </p>
                </div>
              ))}
            </Rows>
          </Disclosure>
        </div>
      )}
      <p className="border-t border-line px-5 py-3 text-small text-ink-2 touch:px-4">
        Tax year: {fiscal ? `ends ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November"][end - 1]}` : "calendar"}
        {yearEnd ? "" : " (assumed: none on record)"}.
      </p>
      {mark && <MarkFiled o={mark.o} p={mark.p} onClose={() => setMark(null)} />}
    </Card>
  );
}

function DeadlineRow({ o, where, onMark }: { o: Obligation; where: string; onMark: (p: Period) => void }) {
  const { asset } = useEntity();
  const canRecord = isAdmin(getUser()) || ["member"].includes(getUser()?.role ?? "");
  const last = o.last;
  const next = o.next;
  const recordable = !!(last || next) && !o.key.startsWith("palm_");
  const history = recordedFor(asset, o.key);
  const needs = last && (last.status === "overdue" || last.status === "unrecorded");

  // An undated line (no separate return, the dormancy check-in): one sentence, no dates.
  if (!o.due && !last && !next)
    return (
      <div className="flex flex-col gap-1 py-3">
        <span className="text-body text-ink">{o.title}</span>
        <p className="max-w-[68ch] text-small text-ink-2">
          {o.note ?? o.rule}
          {o.url && (
            <>
              {" "}
              <a href={o.url} target="_blank" rel="noopener noreferrer" className="text-accent underline decoration-1 underline-offset-[3px] hover:text-accent-hover">
                {o.urlLabel ?? "File online"}
              </a>
            </>
          )}
        </p>
      </div>
    );

  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-body text-pretty text-ink">{o.title}</p>
          <p className="text-small text-ink-2">{o.agency}</p>
        </div>
        {needs && recordable && canRecord && (
          <Button size="sm" onClick={() => onMark(last!)}>
            Record as filed…
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-1 tabular-nums">
        {last && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <Status tone={PERIOD_TONE[last.status]}>
              {last.label}: {periodWord(last, where)}
            </Status>
            <span className="text-small text-ink-2">was due {day(last.due)}</span>
          </div>
        )}
        {!last && o.due && !next && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <span className="text-small text-ink">{o.overdue ? "Overdue" : "Due"}</span>
            <span className={daysFromToday(o.due) < 0 ? "text-small text-negative" : "text-small text-ink-2"}>
              {day(o.due)} · {relDays(o.due)}
            </span>
          </div>
        )}
        {next && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-small text-ink">
              Next: {next.label}
              {next.status === "extended" ? `, extended to ${day(next.extendedTo!)}` : ""}
            </span>
            <span className={daysFromToday(next.extendedTo ?? next.due) <= 30 ? "text-small text-warning" : "text-small text-ink-2"}>
              {day(next.extendedTo ?? next.due)} · {relDays(next.extendedTo ?? next.due)}
            </span>
          </div>
        )}
      </div>
      <Disclosure label="Details">
        <div className="flex max-w-[68ch] flex-col gap-1 pb-1 text-small text-ink-2">
          <p>{o.rule}.</p>
          {o.fee && <p>Fee: {o.fee}.</p>}
          {o.lateFee && <p>Late: {o.lateFee}.</p>}
          {o.consequence && <p>{o.consequence}</p>}
          {o.note && <p>{o.note}</p>}
          {last?.status === "current" && last.sourceAt && (
            <p>
              Counted as current because {where}'s record, read {stamp(last.sourceAt)}, shows its filings current. Record it when you have the confirmation.
            </p>
          )}
          {o.url && (
            <p>
              <a href={o.url} target="_blank" rel="noopener noreferrer" className="text-accent underline decoration-1 underline-offset-[3px] hover:text-accent-hover">
                {o.urlLabel ?? "File online"}
              </a>
            </p>
          )}
          {history.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              <p className="font-medium text-ink">Recorded</p>
              {history.map(([key, r]) => (
                <HistoryLine key={key} periodKey={key} label={key.slice(o.key.length + 1)} r={r} />
              ))}
            </div>
          )}
          {recordable && canRecord && !needs && (
            <p className="mt-1">
              <button
                type="button"
                className="cursor-pointer text-accent underline decoration-1 underline-offset-[3px] hover:text-accent-hover"
                onClick={() => onMark(last && last.status !== "filed" ? last : next!)}
              >
                Record {last && last.status !== "filed" ? last.label : next?.label} as filed
              </button>
            </p>
          )}
        </div>
      </Disclosure>
    </div>
  );
}

/** The periods recorded for one filing, newest first. */
function recordedFor(asset: ReturnType<typeof useEntity>["asset"], key: string): [string, FiledRecord][] {
  const all = ((asset as { filedPeriods?: FiledPeriods }).filedPeriods ?? {}) as FiledPeriods;
  return Object.entries(all)
    .filter((e): e is [string, FiledRecord] => !!e[1] && e[0].startsWith(`${key}-`) && /^\d{4}$/.test(e[0].slice(key.length + 1)))
    .sort((a, b) => b[0].localeCompare(a[0]));
}

function HistoryLine({ periodKey, label, r }: { periodKey: string; label: string; r: FiledRecord }) {
  const { page } = useEntity();
  const doc = r.docId ? page.docs.find((d) => d.id === r.docId) : null;
  const clear = async () => {
    const ok = await confirm({
      title: `Clear the record for ${label}?`,
      message: "It shows as not recorded again. Nothing is changed with the state or the IRS.",
      confirmLabel: "Clear record",
      tone: "danger",
    });
    if (!ok) return;
    await page.patchAsset({ [`filedPeriods/${periodKey}`]: null });
    toast({ message: `Cleared the record for ${label}` });
  };
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1">
        {label}: {r.kind === "extended" ? "extended" : "filed"} {day(r.on)}
        {r.confirmation ? ` · ${r.confirmation}` : ""}
        {doc ? ` · ${doc.name}` : ""}
        {r.by ? ` · recorded by ${r.by}` : ""}
      </span>
      {isAdmin(getUser()) && <IconButton icon="x" label={`Clear the record for ${label}`} onClick={() => void clear()} />}
    </div>
  );
}

/** Record a period as filed (or extended): the date, the confirmation, and the filed copy. */
function MarkFiled({ o, p, onClose }: { o: Obligation; p: Period; onClose: () => void }) {
  const { page } = useEntity();
  const canExtend = o.key === "fed" || o.key === "az-return";
  const [kind, setKind] = useState<"filed" | "extended">("filed");
  const [on, setOn] = useState<string | null>(todayIso());
  const [confirmation, setConfirmation] = useState("");
  const [docId, setDocId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const docs = page.docs;
  const what = `${p.label} ${o.title}`;

  const save = async () => {
    if (!on) return setError("Add the date it was filed.");
    if (on > todayIso()) return setError("The date can't be in the future.");
    setBusy(true);
    setError("");
    const rec: FiledRecord = { on, kind, confirmation: confirmation.trim() || null, docId, by: getUser()?.name ?? null, at: Date.now() };
    try {
      await page.patchAsset({ [`filedPeriods/${p.key}`]: rec });
      onClose();
      toast({
        message: kind === "extended" ? `Recorded the extension for the ${what}` : `Recorded the ${what} as filed`,
        action: { label: "Undo", run: () => void page.patchAsset({ [`filedPeriods/${p.key}`]: null }) },
      });
    } catch (e) {
      setError(e instanceof Error ? `Couldn't save it. ${e.message}` : "Couldn't save it. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Record the ${p.label} filing`}
      description={o.title}
      dirty={!!confirmation || !!docId}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} busyLabel="Saving…" onClick={() => void save()}>
            {kind === "extended" ? "Record extension" : "Record as filed"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {canExtend && (
          <Segmented
            label="What was filed"
            value={kind}
            onChange={setKind}
            options={[
              { value: "filed", label: "The return" },
              { value: "extended", label: "An extension" },
            ]}
          />
        )}
        <Field label={kind === "extended" ? "Extension filed on" : "Filed on"}>
          <DateInput value={on} onChange={setOn} />
        </Field>
        <Field label="Confirmation or acceptance number" optional>
          <Input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" />
        </Field>
        {docs.length > 0 && (
          <Field label="The filed copy, from Documents" optional>
            <Select
              label="The filed copy"
              value={docId}
              onChange={(v) => setDocId(v || null)}
              placeholder="None"
              options={[{ value: "", label: "None" }, ...docs.map((d) => ({ value: d.id, label: d.name }))]}
            />
          </Field>
        )}
        <p className="text-small text-ink-2">
          This records it here, with your name. Nothing is sent to {o.agency}.{kind === "extended" && p.due ? ` The due date moves to the extended date.` : ""}
        </p>
        {error && <p className="text-small text-negative">{error}</p>}
      </div>
    </Dialog>
  );
}

// ── Checks: where the records disagree ───────────────────────────────────

const SEVERITY_TONE: Record<PaperworkIssue["severity"], Tone> = { high: "negative", medium: "warning", low: "neutral", info: "neutral" };

function Checks() {
  const { view, asset, page } = useEntity();
  const open = view.issues.filter((i) => i.severity !== "info");
  const noted = view.issues.filter((i) => i.severity === "info");
  const holders = shareHolders(asset.members ?? asset.profile?.members ?? []);
  if (!view.issues.length && !holders.length) return null;
  const host = (code: string) => stateName(code);
  return (
    <Card title="Checks" count={open.length || undefined} countTone="attention" info="Where the record disagrees with itself, its documents or the rules. Each one says what settles it.">
      <div className="flex flex-col">
        {open.length === 0 && <p className="text-body text-ink-2">Nothing in the record disagrees.</p>}
        <Rows>
          {open.map((i) => {
            const foreign = i.key === "foreign" ? (hostState(asset) ?? "") : "";
            return (
              <div key={i.key} className="flex flex-col gap-1 py-3 first:pt-0">
                <Flag tone={SEVERITY_TONE[i.severity]}>
                  <span className="text-body text-ink">{i.title}</span>
                </Flag>
                <p className="pl-[14px] text-small text-pretty text-ink-2">{i.detail}</p>
                {i.key === "foreign" && foreign && (
                  <div className="flex flex-wrap gap-2 pt-1 pl-[14px]">
                    <Button size="sm" onClick={() => void page.patchAsset({ [`foreign/${foreign}/confirmed`]: true, [`foreign/${foreign}/notNeeded`]: null })}>
                      Yes, it does business there
                    </Button>
                    <Button size="sm" onClick={() => void page.patchAsset({ [`foreign/${foreign}/notNeeded`]: true, [`foreign/${foreign}/confirmed`]: null })}>
                      No, only its mail goes to {host(foreign)}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </Rows>
        {holders.length > 0 && (
          <CardSection title="Owners in its documents">
            <AiNote kind="read" source={asset.membersSource ?? "its documents"} />
            <Rows className="mt-1">
              {holders.map((m, i) => (
                <div key={i} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0 text-body break-words text-ink">{m.name}</span>
                  <span className="shrink-0 text-body text-ink-2 tabular-nums">{m.percent != null ? format.percent(m.percent, { decimals: 2, trim: true }) : (m.role ?? "")}</span>
                </div>
              ))}
            </Rows>
          </CardSection>
        )}
        {noted.length > 0 && (
          <div className="mt-2">
            <Disclosure label="Also noted" count={noted.length}>
              <div className="flex flex-col gap-2 pb-1">
                {noted.map((i) => (
                  <div key={i.key}>
                    <p className="text-small font-medium text-ink">{i.title}</p>
                    <p className="text-small text-ink-2">{i.detail}</p>
                  </div>
                ))}
              </div>
            </Disclosure>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── The registered agent ─────────────────────────────────────────────────

function AgentCard() {
  const { page, asset } = useEntity();
  const st = stateCode(asset.state);
  const term = agentTerm(st);
  const status = page.palmStatus;
  const svc = page.palmRa;
  const mode = page.palmMode;
  // Until Palm answers, go by what was last seen, and don't offer the move.
  const known = svc !== undefined;
  const cached = mode ? asset.palm?.[mode]?.ra : undefined;
  const raStatus = known ? (svc?.status ?? null) : (cached?.status ?? null);
  const palmIsAgent = raStatus === "active";
  const inFlight = raStatus === "pending" || raStatus === "termination_requested";
  const forming = formingNow(asset);
  const canMove = known && isAdmin() && !palmIsAgent && !inFlight && !forming;
  const configured = !!status?.configured;
  const busy = !!page.palmBusy;
  const listed = palmIsAgent ? (svc?.name ?? cached?.name ?? null) : null;
  const agentAddress = palmIsAgent ? (formatAddress(svc?.address) ?? cached?.address ?? null) : (asset.registeredAgentAddress ?? null);
  const startedAt = known ? (svc?.started_at ?? null) : (cached?.startedAt ?? null);
  const reason = raStatus === "failed" ? ((known ? svc?.rejection_reason : cached?.rejectionReason) ?? page.palmInbox.find((e) => e.rejection_reason)?.rejection_reason) : null;

  const action =
    configured && canMove ? (
      <Button size="sm" busy={page.palmBusy === "move"} busyLabel="Requesting…" disabled={busy} onClick={() => void page.moveAgentToPalm()}>
        {svc?.status === "failed" ? "Try again" : "Make Palm the agent"}
      </Button>
    ) : undefined;
  const menu: MenuItem[] | undefined =
    configured && page.palmBusinessId
      ? [{ label: page.palmBusy === "refresh" ? "Refreshing…" : "Refresh from Palm", icon: "sync", disabled: busy, onSelect: () => void page.refreshPalm(page.palmBusinessId!) }]
      : undefined;

  let body: ReactNode;
  if (!status) body = <p className="text-body text-ink-2">Checking the Palm connection…</p>;
  else if (status.error)
    body = (
      <Empty
        action={
          <Button size="sm" variant="quiet" onClick={() => void page.loadPalmStatus()}>
            Try again
          </Button>
        }
      >
        Couldn't reach Palm just now.
      </Empty>
    );
  else if (forming)
    body = (
      <Rows>
        <Row label="Agent" hint={`Appointed with the formation. ${stateName(st) || "The state"} has no record of the entity until it approves it.`}>
          {forming.palmAgent ? "Arranged through Palm" : asset.registeredAgent || "The agent named in the formation"}
        </Row>
      </Rows>
    );
  else
    body = (
      <Rows>
        <Row
          label="Agent"
          hint={
            palmIsAgent
              ? [`Arranged through Palm${startedAt ? ` since ${day(startedAt)}` : ""}`, agentAddress ? titleCase(agentAddress) : null].filter(Boolean).join(" · ")
              : asset.registeredAgent
                ? [agentAddress ? titleCase(agentAddress) : null, asset.registeredAgentSource ?? null].filter(Boolean).join(" · ") || undefined
                : `Every entity must keep one in its state. ${isAdmin() && configured ? "Palm can arrange one, or add yours under Edit." : "Add it under Edit."}`
          }
        >
          {palmIsAgent ? titleCase(listed ?? asset.registeredAgent ?? "Palm's agent") : asset.registeredAgent ? titleCase(asset.registeredAgent) : undefined}
        </Row>
        {raStatus && raStatus !== "active" && (
          <Row label="Change">
            <div className="flex flex-col gap-1">
              <Status tone={raStatus === "failed" ? "negative" : raStatus === "pending" || raStatus === "termination_requested" ? "warning" : "neutral"}>
                {raStatus === "pending"
                  ? "Filed with the state"
                  : raStatus === "failed"
                    ? "Didn't go through"
                    : raStatus === "termination_requested"
                      ? "Resigning"
                      : raStatus === "terminated"
                        ? "Ended"
                        : "Canceled"}
              </Status>
              {raStatus === "pending" && (
                <p className="text-small text-ink-2">Palm is filing the change. It can take a few business days; the current agent stays on file until the state accepts it.</p>
              )}
              {raStatus === "failed" && (
                <p className="text-small text-ink-2">{reason ? `The state didn't accept it: ${reason}.` : "Palm couldn't complete the change."} Palm Console shows the reason under this business.</p>
              )}
            </div>
          </Row>
        )}
      </Rows>
    );

  return (
    <Card
      id="registered-agent"
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          {term}
          {configured && mode === "test" && <Badge>Test mode</Badge>}
        </span>
      }
      info={`The person or company that accepts legal papers and state mail for the entity in ${stateName(st) || "its state"}. When Palm arranges it, state mail and any legal papers served on the entity arrive here.`}
      action={action}
      menu={menu}
    >
      {body}
      {configured && known && !isAdmin() && !palmIsAgent && !inFlight && <p className="mt-2 text-small text-ink-2">An owner or admin can change it.</p>}
      {status && !status.error && !configured && <p className="mt-2 text-small text-ink-2">Palm isn't connected, so the agent can't be changed from here. An admin connects it.</p>}
      {page.palmError && (
        <Banner tone="negative" className="mt-3">
          {page.palmError}
        </Banner>
      )}
    </Card>
  );
}

// ── The state's record ───────────────────────────────────────────────────

const ENTITY_WORD: Record<string, string> = {
  llc: "LLC",
  "limited liability company": "LLC",
  corporation: "Corporation",
  corp: "Corporation",
  lp: "Limited partnership",
  "limited partnership": "Limited partnership",
};

function StateRecordCard() {
  const { page, asset } = useEntity();
  const rec = asset.stateRecord;
  const st = stateCode(asset.state);
  const where = stateName(st) || "The state";
  const choices = page.registryChoices ?? [];
  const configured = !!page.palmStatus?.configured;
  if (!configured && !rec) return null;
  const shown = rec ? effectiveRecord(rec, asset.stateConfirmed) : undefined;
  const findings = rec ? stateFindings(rec, asset).filter((f) => f.tone === "warn") : [];
  const standing = rec?.standing ? (["registration", "tax", "agent"] as const).filter((k) => rec.standing?.[k]) : [];
  const people = rec?.people?.length ? rec.people : (rec?.managers ?? []).map((name) => ({ role: "", name, title: null, address: null }));
  const stale = !!rec && Date.now() - rec.checkedAt > STALE_DAYS * 86_400_000;
  const action = configured ? (
    <Button size="sm" variant="quiet" icon="sync" busy={page.palmBusy === "record"} busyLabel="Reading…" disabled={!!page.palmBusy} onClick={() => void readStateRecord(page, asset)}>
      {rec ? "Read again" : "Read it"}
    </Button>
  ) : undefined;

  return (
    <Card
      title={`${where}'s record`}
      info={`Read from ${where === "The state" ? "the state" : where} through Palm. Names and addresses are shown as the state lists them, with its capitals tidied for reading.`}
      action={action}
    >
      {choices.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          <p className="text-body text-ink">Which of these is {asset.name}?</p>
          <Rows>
            {choices.slice(0, 6).map((r, i) => (
              <div key={`${r.registration_number ?? r.palm_id}-${i}`} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-body break-words text-ink">{r.name}</p>
                  <p className="text-small text-ink-2 tabular-nums">
                    {[r.registration_jurisdiction?.replace(/^US-/, ""), r.registration_number, r.status, r.formation_date ? `formed ${day(r.formation_date)}` : null].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Button size="sm" disabled={!!page.palmBusy} onClick={() => void readStateRecord(page, asset, r)}>
                  This one
                </Button>
              </div>
            ))}
          </Rows>
        </div>
      )}
      {!rec ? (
        choices.length ? null : (
          <p className="text-body text-ink-2">Not read yet. Reading it shows its status, standing, agent and the people the state lists.</p>
        )
      ) : (
        <>
          <Rows>
            <Row label="Read">
              <span className={stale ? "text-warning" : undefined}>
                {stamp(rec.checkedAt)}
                {stale ? " · read it again" : ""}
              </span>
              {rec.mode === "test" && <Badge className="ml-2">Sandbox data</Badge>}
            </Row>
            {shown?.status && (
              <Row label="Status">
                <Status tone={shown.status === "active" ? "neutral" : "negative"}>{shown.status.charAt(0).toUpperCase() + shown.status.slice(1)}</Status>
              </Row>
            )}
            {standing.length > 0 && (
              <Row label="Standing">
                <span className="flex flex-col gap-1">
                  {standing.map((k) => {
                    const ok = shown?.standing?.[k] === "compliant";
                    return (
                      <Status key={k} tone={ok ? "neutral" : "negative"}>
                        {k === "registration" ? "Filings" : k === "tax" ? "State tax" : "Agent"} {ok ? "current" : "behind"}
                      </Status>
                    );
                  })}
                </span>
              </Row>
            )}
            {rec.registrationNumber && (
              <Row label="File number">
                <span className="font-mono">{rec.registrationNumber}</span>
              </Row>
            )}
            {rec.agent && (
              <Row label="Agent on file" hint={rec.agentAddress ? titleCase(rec.agentAddress) : undefined}>
                {titleCase(rec.agent)}
              </Row>
            )}
            {rec.address && <Row label="Address on file">{titleCase(rec.address)}</Row>}
            {people.length > 0 && (
              <Row label="People on file">
                <span className="flex flex-col gap-1">
                  {people.map((p, i) => {
                    const what = p.title || (p.role ? p.role.charAt(0).toUpperCase() + p.role.slice(1) : "");
                    return (
                      <span key={i}>
                        {titleCase(p.name)}
                        {what && <span className="text-ink-2"> · {titleCase(what)}</span>}
                      </span>
                    );
                  })}
                </span>
              </Row>
            )}
            {rec.entityType && <Row label="Type on file">{ENTITY_WORD[rec.entityType.trim().toLowerCase()] ?? titleCase(rec.entityType)}</Row>}
            {(rec.formationDate || rec.formationJurisdiction) && (
              <Row label="Formed">
                {rec.formationDate ? day(rec.formationDate) : ""}
                {rec.formationJurisdiction ? `${rec.formationDate ? " · " : ""}in ${stateName(rec.formationJurisdiction.replace(/^US-/, "")) || rec.formationJurisdiction}` : ""}
              </Row>
            )}
          </Rows>
          {findings.length > 0 && (
            <CardSection title="Differs from the record here">
              <div className="flex flex-col gap-2">
                {findings.map((f, i) => (
                  <Flag key={i} tone="warning">
                    <span className="text-small text-ink">{f.text}</span>
                  </Flag>
                ))}
              </div>
              <p className="mt-2 text-small text-ink-2">The state's record never overwrites ours: update the record under Edit, or change it with the state.</p>
            </CardSection>
          )}
        </>
      )}
    </Card>
  );
}

// ── Monitoring and the IRS check ─────────────────────────────────────────

type MonitorReg = { state: string; home: boolean; fileNumber: string | null; monitor: { started_at: string; status: string } | null };

/**
 * Palm Monitor, one registration at a time (a monthly charge each, so an
 * owner or admin turns it on), what it last saw change, and the EIN checked
 * with the IRS.
 */
function Monitoring() {
  const { page, asset } = useEntity();
  const mode = page.palmMode;
  const [regs, setRegs] = useState<MonitorReg[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState<typeof asset.einCheck>(undefined);
  const id = page.id;
  const seed = usePalmSeed<{ registrations: MonitorReg[] }>("monitors");
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  /** Palm's monitors for each registration: the page's opening read when it just came in (`seeded`), else Palm itself. */
  const load = useCallback(
    (seeded = false) => {
      if (!mode || !id) return;
      const part = seeded ? seed(`${id}:${mode}`) : null;
      (part ? fromBundle(part) : palmCall<{ registrations: MonitorReg[] }>("monitor-list", { assetId: id }))
        .then((r) => alive.current && setRegs(r.registrations))
        .catch((e) => alive.current && setError(e instanceof Error ? e.message : "Couldn't read monitoring."));
    },
    [mode, id, seed],
  );
  useEffect(() => load(true), [load]);

  if (!page.palmStatus?.configured || !mode) return null;
  const live = mode === "live";
  const monthly = PALM_PRICES.monitor.cents;

  const toggle = async (r: MonitorReg) => {
    const on = !r.monitor;
    const where = stateName(r.state) || r.state;
    const ok = await confirm(
      on
        ? {
            title: `Watch ${where}'s record?`,
            message: `Palm watches ${where}'s record for ${asset.name} and says when it changes: status, standing, agent, people, and filings coming due or overdue.`,
            ...(live
              ? { receipt: { lines: [{ label: "A month, until you turn it off", cents: monthly }] }, details: ["Billed to the Palm account, from today."] }
              : { details: ["Palm is in test mode: nothing is billed."] }),
            confirmLabel: live ? `Watch for ${money(monthly)} a month` : "Watch it",
            tone: live ? "commit" : "default",
          }
        : {
            title: `Stop watching ${where}'s record?`,
            message: "Palm stops watching and stops billing for it. Changes then show only when the record is read.",
            confirmLabel: "Stop watching",
            cancelLabel: "Keep watching",
          },
    );
    if (!ok) return;
    setBusy(r.state);
    setError("");
    try {
      await palmCall(on ? "monitor-on" : "monitor-off", { assetId: id, state: r.state, mode });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Palm didn't answer.");
    } finally {
      setBusy(null);
    }
  };

  const ein = (asset.ein ?? "").trim();
  // The answer just given shows at once; the record catches up on its next load.
  const check = fresh && (!asset.einCheck || asset.einCheck.at < fresh.at) ? fresh : asset.einCheck;
  const checkFits = !!check && check.mode === mode && check.ein.replace(/\D/g, "") === ein.replace(/\D/g, "");
  const canCheck = ["owner", "admin", "member"].includes(getUser()?.role ?? "");
  const runEinCheck = async () => {
    const cents = PALM_PRICES.verify_tin.cents;
    const ok = await confirm({
      title: "Check the EIN with the IRS?",
      message: "Palm asks the IRS whether this EIN belongs to this legal name (the state's spelling, when its record has been read). Nothing is filed.",
      ...(live ? { receipt: { lines: [{ label: "One check", cents }] }, details: ["Billed to the Palm account."] } : { details: ["Palm is in test mode: nothing is billed."] }),
      confirmLabel: live ? `Check for ${money(cents)}` : "Check it",
      tone: live ? "commit" : "default",
    });
    if (!ok) return;
    setBusy("ein");
    setError("");
    try {
      const r = await palmCall<{ check: NonNullable<typeof asset.einCheck> }>("ein-check", { assetId: id, mode });
      setFresh(r.check);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Palm didn't answer.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          Monitoring
          {mode === "test" && <Badge>Test mode</Badge>}
        </span>
      }
      info="Palm watches the state's record for a registration and says when it changes, and when a filing comes due or goes overdue. Those show under Deadlines and in Activity, and a live change emails the owners."
    >
      <Rows>
        {regs === null && !error && <p className="py-2 text-body text-ink-2">Checking…</p>}
        {regs?.length === 0 && <p className="py-2 text-body text-ink-2">No state registrations to watch yet.</p>}
        {regs?.map((r) => {
          const change = asset.palmMonitor?.[r.state]?.lastChange;
          const lines =
            change && change.mode === mode
              ? change.changes
                  .map((c) => c.summary || c.attribute)
                  .filter(Boolean)
                  .slice(0, 3)
              : [];
          return (
            <div key={r.state} className="flex items-start gap-3 py-3 first:pt-0">
              <div className="min-w-0 flex-1">
                <p className="text-body text-ink">
                  {stateName(r.state) || r.state}
                  {r.home ? "" : " (foreign)"}
                </p>
                <p className="text-small text-ink-2">{r.monitor ? `${r.monitor.status === "active" ? "Watching" : r.monitor.status} since ${day(r.monitor.started_at)}` : "Not watched"}</p>
                {lines.length > 0 && (
                  <p className="text-small text-ink-2">
                    Last change {stamp(change!.at)}: {lines.join("; ")}
                  </p>
                )}
              </div>
              {isAdmin() && (
                <Button size="sm" variant={r.monitor ? "quiet" : "secondary"} busy={busy === r.state} busyLabel="Working…" disabled={!!busy} onClick={() => void toggle(r)}>
                  {r.monitor ? "Stop" : "Watch"}
                </Button>
              )}
            </div>
          );
        })}
        {ein && (
          <div className="flex items-start gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-body text-ink">EIN with the IRS</p>
              {checkFits ? (
                <>
                  <Status tone={check!.matched === true ? "neutral" : check!.matched === false ? "negative" : "warning"}>
                    {check!.matched === true ? "Matches" : check!.matched === false ? "Doesn't match" : "The IRS didn't answer"}
                  </Status>
                  <p className="text-small text-ink-2">
                    As {check!.name}, {stamp(check!.at)}
                  </p>
                </>
              ) : (
                <p className="text-small text-ink-2">Not checked</p>
              )}
            </div>
            {canCheck && (
              <Button size="sm" busy={busy === "ein"} busyLabel="Checking…" disabled={!!busy} onClick={() => void runEinCheck()}>
                {checkFits ? "Check again" : "Check"}
              </Button>
            )}
          </div>
        )}
      </Rows>
      {error && (
        <Banner
          tone="negative"
          className="mt-3"
          action={
            <Button size="sm" variant="quiet" onClick={() => (setError(""), load())}>
              Try again
            </Button>
          }
        >
          {error}
        </Banner>
      )}
    </Card>
  );
}

// ── Mail Palm receives ───────────────────────────────────────────────────

/** State mail and legal papers Palm received as the registered agent, legal papers first. Hidden until there's some. */
function Mail() {
  const { page } = useEntity();
  const [openError, setOpenError] = useState("");
  const docs = page.palmDocs;
  if (!page.palmStatus?.configured || !docs?.length) return null;
  return (
    <Card
      id="palm-mail"
      title="Mail"
      count={docs.length}
      info="State mail and any legal papers served on the entity, received by Palm as its agent. Legal papers are pushed to the owners and admins and emailed the day Palm receives them; a deadline to answer runs from the day they were served."
      flush
    >
      <Rows className="px-5 touch:px-4">
        {docs.map((d) => (
          <MailRow key={d.id} d={d} onError={setOpenError} />
        ))}
      </Rows>
      {openError && (
        <Banner tone="negative" className="m-4">
          {openError}
        </Banner>
      )}
    </Card>
  );
}

function MailRow({ d, onError }: { d: PalmDocument; onError: (msg: string) => void }) {
  const { page } = useEntity();
  const kind = docKindOf(d);
  const legal = kind === "service_of_process";
  const isNew = page.palmInbox.some((e) => !e.read_at && e.document_id === d.id);
  const label = DOC_LABEL[kind] ?? (kind || "Document").replace(/_/g, " ");
  const open = () => {
    onError("");
    void openPalmDocument(d).catch((e) => onError(e instanceof Error ? e.message : "Couldn't open that document."));
  };
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {legal ? <Status tone="negative">{label}</Status> : <span className={isNew ? "text-body font-semibold text-ink" : "text-body text-ink"}>{label}</span>}
          {isNew && <Badge>New</Badge>}
        </div>
        <p className="truncate text-small text-ink-2">{[d.filename, d.created_at ? day(d.created_at) : null].filter(Boolean).join(" · ")}</p>
      </div>
      <IconButton icon="external" label={`Open ${label}`} onClick={open} />
    </div>
  );
}
