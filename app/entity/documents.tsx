/**
 * Documents tab: the documents the rule book asks for (Required documents,
 * with the check of the record against them as one line under the header),
 * paper mail, and every file and link on the entity (Library), with what was
 * removed kept in Removed until an owner or admin deletes it for good.
 *
 * Each row opens its file; everything else it can do is in its "…" menu.
 * Dates are the document's own (filed, dated), with when it was added and
 * by whom beside them. All state and actions come from useEntity().
 */

import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { canDraftAgreement } from "../paperwork-generate";
import { getUser, isAdmin, isPartner } from "../auth";
import { openStoredFile, SIGNED_LINK_MINUTES, storagePathOf, type StoredFileRef } from "../stored-file";
import { PaperMailList, usePaperMail } from "../paper-mail";
import { RETENTION_DAYS } from "../../lib/entity-archive";
import type { DocRule } from "../entity-paperwork";
import {
  AiNote,
  Badge,
  Banner,
  Button,
  Card,
  Dialog,
  Disclosure,
  Field,
  IconButton,
  Input,
  List,
  ListRow,
  Menu,
  Status,
  TextLink,
  cx,
  format,
  type MenuItem,
} from "../ui";
import { useEntity } from "./context";
import { VERIFY_LABEL, docKind, documentDate, filingTitle, fmtDate, normEntityName, normValue, withoutEntityName, type AssetDoc, type FileKind, type RemovedDoc, type UploadedFile, type VerifyField } from "./model";

// Row uploads take a PDF or a scan, up to 25 MB (checked in handleUploadFile).
const ACCEPT = "application/pdf,image/png,image/jpeg";
const ACCEPTED = ACCEPT.split(",");
const TYPES_LABEL = "PDF, PNG or JPEG";

export function DocumentsTab() {
  // A file dropped anywhere else on the tab must not make the browser open it (and leave the app).
  const swallow = (e: DragEvent<HTMLDivElement>) => {
    if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
  };
  return (
    <div onDragOver={swallow} onDrop={swallow} className="flex min-w-0 flex-col gap-4">
      <RequiredDocuments />
      <PaperMailSection />
      <Library />
      <RenameDialog />
    </div>
  );
}

const date = (iso?: string | null) => (iso ? fmtDate(iso) : "");
const stamp = (ms?: number | null) => (ms ? format.date(new Date(ms), "medium") : "");
const isPdf = (f: { fileName?: string; name?: string; contentType?: string }) => f.contentType === "application/pdf" || /\.pdf$/i.test(f.fileName ?? f.name ?? "");
const staff = () => !isPartner() && ["owner", "admin", "member"].includes(getUser()?.role ?? "");

// ── Required documents ───────────────────────────────────────────────────

function RequiredDocuments() {
  const { page, view, asset } = useEntity();
  const ruleOf = new Map(view.rules.map((r) => [r.key, r] as const));
  const main = view.kinds.filter((k) => ruleOf.get(k)?.level !== "recommended");
  const extra = view.kinds.filter((k) => ruleOf.get(k)?.level === "recommended");
  // Missing first (required, then expected), then what's on file: no groups.
  const rank = (k: FileKind) => (asset[k] ? 3 : ruleOf.get(k)?.level === "required" ? 0 : ruleOf.get(k)?.level === "expected" ? 1 : 2);
  const sorted = [...main].sort((a, b) => rank(a) - rank(b));
  const missing = main.filter((k) => !asset[k]).length;
  const reading = page.sorting > 0 || (!!page.scan && !page.scan.finished);
  const canScan = staff() && !asset.archived && page.docs.length > 0 && view.filedCount < view.scoredKinds.length;

  return (
    <Card
      title="Required documents"
      count={missing || undefined}
      countTone="attention"
      action={
        canScan ? (
          <Button variant="quiet" size="sm" icon="sparkle" busy={reading} busyLabel="Reading…" onClick={() => void page.scanLibrary()}>
            Scan library
          </Button>
        ) : undefined
      }
      flush
    >
      {staff() && (
        <p className="max-w-[68ch] px-5 py-3 text-small text-pretty text-ink-2 touch:px-4">
          Files you add are read by Anthropic’s Claude to put them on the right row and to suggest facts. Nothing it reads goes on the record until someone accepts it on Overview.
        </p>
      )}
      {staff() && <DocumentCheck />}
      <div className="border-t border-line">
        {sorted.map((k) => (
          <FilingRow key={k} kind={k} rule={ruleOf.get(k)} />
        ))}
      </div>
      {view.kinds.length === 0 && <p className="px-5 py-4 text-body text-ink-2 touch:px-4">No documents are required for it.</p>}
      {extra.length > 0 && (
        <div className="border-t border-line px-5 py-2 touch:px-4">
          <Disclosure label={`Good to keep, ${extra.filter((k) => asset[k]).length} of ${extra.length} on file`}>
            <div className="-mx-5 border-t border-line touch:-mx-4">
              {extra.map((k) => (
                <FilingRow key={k} kind={k} rule={ruleOf.get(k)} />
              ))}
            </div>
          </Disclosure>
        </div>
      )}
    </Card>
  );
}

/** One required document: the file on record (its own date, who added it), or its need and how to add it. Empty rows take a dropped file. */
function FilingRow({ kind, rule }: { kind: FileKind; rule?: DocRule }) {
  const { page, asset } = useEntity();
  const picker = useRef<HTMLInputElement>(null);
  const file = asset[kind];
  const slot = page.uploadState[kind];
  const { view } = useEntity();
  // A disregarded LLC's W-9 is in its owner's name and TIN, with its own name on line 2.
  const title = kind === "w9" && view.homeLine ? `${filingTitle(kind, asset)}, in its owner’s name` : filingTitle(kind, asset);
  const canAct = staff() && !asset.archived;
  const doc = file?.docId ? page.docs.find((d) => d.id === file.docId) : undefined;
  const generate = !canAct
    ? null
    : kind === "w9"
      ? { label: "Fill in", again: "Fill in again", run: page.generateW9 }
      : kind === "operatingAgreement" && canDraftAgreement(asset)
        ? { label: "Draft", again: "Draft again", run: page.generateOperatingAgreement }
        : null;
  const own = documentDate(kind, asset);
  const addedBy = file?.uploadedBy ?? doc?.addedBy ?? null;
  // The viewer is titled by what the document is ("Articles of Organization"), with where it came from under it.
  const open = (f: UploadedFile) => {
    const titled: UploadedFile = { ...f, fileName: `${title}${/\.pdf$/i.test(f.fileName) ? ".pdf" : ""}` };
    void openStoredFile(titled, { subtitle: provenance(asset.name, own, f.uploadedAt, addedBy, doc?.draft) });
  };

  const dragOn = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!slot.uploading && !slot.dragOver) page.setSlot(kind, { dragOver: true });
  };
  const drop = file || !canAct ? {} : {
    onDragOver: dragOn,
    onDragEnter: dragOn,
    onDragLeave: (e: DragEvent<HTMLDivElement>) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      page.setSlot(kind, { dragOver: false });
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      page.setSlot(kind, { dragOver: false });
      const f = e.dataTransfer.files?.[0];
      if (!f || slot.uploading) return;
      if (!ACCEPTED.includes(f.type)) return page.setSlot(kind, { error: `Choose a ${TYPES_LABEL} file.` });
      void page.handleUploadFile(kind, f);
    },
  };

  const need = rule?.level === "recommended" ? { tone: "neutral" as const, word: "Good to keep" } : rule?.level === "expected" ? { tone: "warning" as const, word: "Expected" } : { tone: "negative" as const, word: "Missing" };
  const menu: MenuItem[] | undefined =
    file && canAct
      ? [
          { label: "Open in a new tab", onSelect: () => void openStoredFile(file, { newTab: true }) },
          ...(isPdf(file) && storagePathOf(file) ? [{ label: "Send for signature…", onSelect: () => void page.handleSendForSignature({ ...file, docId: file.docId }, (file.fileName || title).replace(/\.pdf$/i, "")) }] : []),
          ...(generate ? [{ label: `${generate.again}…`, hint: "The one on file stays in the Library", onSelect: () => void generate.run(true) }] : []),
          { label: "Replace…", hint: "The one on file stays in the Library", onSelect: () => picker.current?.click() },
          { divider: true as const },
          { label: "Take it off this row…", onSelect: () => void page.handleDeleteFile(kind) },
        ]
      : undefined;

  const secondary = file ? (
    <>
      {file.fileName}
      {own ? ` · ${own.label} ${date(own.date)}` : ""}
      {` · added ${stamp(file.uploadedAt)}${addedBy ? ` by ${addedBy}` : ""}`}
    </>
  ) : slot.uploading ? (
    `Uploading… ${Math.round(slot.progress)}%`
  ) : slot.dragOver ? (
    "Drop to upload"
  ) : (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <Status tone={need.tone}>{need.word}</Status>
      {rule?.why && <span className="truncate">{rule.why.split(". ")[0]}.</span>}
    </span>
  );

  return (
    <div id={`filing-${kind}`} {...drop} className={cx("scroll-mt-[96px] border-t border-line first:border-t-0", slot.dragOver && "bg-accent-tint")}>
      <input
        ref={picker}
        type="file"
        accept={ACCEPT}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        disabled={slot.uploading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void page.handleUploadFile(kind, f);
          e.target.value = "";
        }}
      />
      <List label={title}>
        <ListRow
          label={title}
          title={
            <span className="inline-flex flex-wrap items-center gap-2">
              {title}
              {doc?.draft && <Badge>Draft, unsigned</Badge>}
            </span>
          }
          secondary={secondary}
          onClick={file ? () => open(file) : undefined}
          menu={menu}
          action={
            !file && canAct ? (
              <span className="flex items-center gap-2">
                {generate && (
                  <Button size="sm" disabled={slot.uploading} onClick={() => void generate.run()}>
                    {generate.label}
                  </Button>
                )}
                <Button size="sm" icon="upload" disabled={slot.uploading} onClick={() => picker.current?.click()}>
                  Upload
                </Button>
              </span>
            ) : undefined
          }
        />
      </List>
      {(slot.error || (!file && rule?.howTo)) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pb-3 pl-9 touch:px-4">
          {slot.error && <p className="text-small text-negative">{slot.error}</p>}
          {!file && rule?.howTo && (
            <TextLink to={rule.howTo.url} className="text-small">
              {rule.howTo.label}
            </TextLink>
          )}
        </div>
      )}
    </div>
  );
}

/** "Northwind Holdings, LLC · Filed Aug 11, 2023 · added Oct 6, 2026 by Alex": the viewer's subtitle. */
function provenance(entity: string, own: { label: string; date: string } | null, added?: number | null, by?: string | null, draft?: boolean): string {
  return [entity, own ? `${own.label} ${date(own.date)}` : null, added ? `added ${stamp(added)}${by ? ` by ${by}` : ""}` : null, draft ? "Draft BFO made, unsigned" : null].filter(Boolean).join(" · ");
}

// ── Document check ───────────────────────────────────────────────────────

/** The record checked against its documents, as one line under the header; the findings open below it. */
function DocumentCheck() {
  const { page, asset } = useEntity();
  const v = asset.verification;
  const verifying = page.verifying;
  const current = page.recordValues(asset);
  const findings = (v?.fields ?? []).map((f) => {
    const now = current[f.field] ?? "";
    return { ...f, now, resolved: !!f.found && normValue(now) === normValue(f.found) };
  });
  const actionable = findings.filter((f) => !f.resolved && (f.status === "mismatch" || f.status === "missing_on_record") && f.found);
  const matched = findings.filter((f) => f.status === "match" || f.resolved);
  const changedSince = v?.recordAtCheck ? (Object.keys(v.recordAtCheck) as VerifyField[]).some((k) => normValue(v.recordAtCheck![k]) !== normValue(current[k])) : false;
  const recordedOwner = asset.ownerId ? (page.assetNames[asset.ownerId] ?? null) : null;
  const docOwners = v?.owners ?? [];
  const soleOwner = docOwners.length === 1 ? docOwners[0] : null;
  const soleOwnerId = soleOwner ? Object.entries(page.assetNames).find(([aid, n]) => aid !== page.id && normEntityName(n) === normEntityName(soleOwner.name))?.[0] : undefined;
  const ownerOk = !!recordedOwner && docOwners.some((o) => normEntityName(o.name) === normEntityName(recordedOwner));
  const ownerMismatch = docOwners.length > 0 && !ownerOk;
  const issues = v?.issues ?? [];
  const toReview = actionable.length + (ownerMismatch ? 1 : 0) + issues.filter((i) => i.severity !== "low").length;
  const read = v?.documentsRead?.length ?? 0;
  const canAct = !asset.archived;

  return (
    <div className="border-t border-line px-5 py-3 touch:px-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-ink-2">
          {verifying ? (
            <span>Reading the documents and comparing them with the record…</span>
          ) : !v ? (
            <span>Not yet checked against the record.</span>
          ) : toReview === 0 ? (
            <Status tone="neutral">The record matches its documents</Status>
          ) : (
            <Status tone="warning">{toReview} to review against the documents</Status>
          )}
          {v && !verifying && (
            <span className="tabular-nums">
              · {format.count(read, "document")} read, {format.relative(new Date(v.checkedAt))}
              {changedSince ? " · the record changed since" : ""}
            </span>
          )}
        </p>
        {canAct && (
          <Button variant="quiet" size="sm" icon="sparkle" busy={verifying} busyLabel="Checking…" onClick={() => void page.runVerification()} className="text-accent">
            {v ? "Check again" : "Check against the record"}
          </Button>
        )}
      </div>
      {page.verifyError && <p className="mt-1 text-small text-negative">{page.verifyError}</p>}
      {v && !verifying && (toReview > 0 || matched.length > 0 || v.summary) && (
        <Disclosure label={toReview ? "What to review" : "What was checked"} count={toReview || matched.length} className="mt-1">
          <div className="flex flex-col gap-3 pt-2 pb-1">
            <AiNote kind="read" source={read === 1 ? "1 document" : `${read} documents`} />
            {v.summary && <p className="max-w-[68ch] text-small text-pretty text-ink-2">{v.summary}</p>}
            {(ownerMismatch || docOwners.length > 0) && (
              <Finding
                label="Owner"
                tone={ownerOk ? "neutral" : "warning"}
                record={recordedOwner ?? "No owner on record"}
                doc={docOwners.map((o) => `${o.name}${o.percent != null ? ` ${format.percent(o.percent, { decimals: 2, trim: true })}` : ""}`).join(", ")}
                action={ownerMismatch && soleOwnerId && canAct ? <Button size="sm" onClick={() => void page.applyOwner(soleOwnerId)}>Set owner to {page.assetNames[soleOwnerId]}</Button> : undefined}
              />
            )}
            {actionable.map((f) => (
              <Finding
                key={f.field}
                label={VERIFY_LABEL[f.field]}
                tone="warning"
                record={f.status === "mismatch" ? show(f.field, f.now) : null}
                doc={show(f.field, f.found ?? "")}
                note={[f.source, f.note].filter(Boolean).join(" · ") || undefined}
                action={canAct ? <Button size="sm" onClick={() => void page.applyFinding(f.field, f.found!)}>Use the document’s value</Button> : undefined}
              />
            ))}
            {issues.map((issue, n) => (
              <p key={n} className="flex items-start gap-2 text-small text-pretty text-ink">
                <span aria-hidden="true" className={cx("mt-[5px] size-2 shrink-0 rounded-full", issue.severity === "high" ? "bg-negative" : issue.severity === "medium" ? "bg-warning" : "bg-ink-3")} />
                <span>
                  <span className="sr-only">{issue.severity} importance: </span>
                  {issue.message}
                </span>
              </p>
            ))}
            {matched.length > 0 && <p className="text-small text-ink-2">Matched: {matched.map((f) => VERIFY_LABEL[f.field]).join(", ")}.</p>}
          </div>
        </Disclosure>
      )}
    </div>
  );
}

const show = (field: VerifyField, value: string) => (field.endsWith("Date") ? fmtDate(value) || value : value);

function Finding({ label, tone, record, doc, note, action }: { label: string; tone: "neutral" | "warning"; record: string | null; doc: string; note?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <Status tone={tone}>{label}</Status>
      <div className="text-small break-words text-ink">
        {record !== null && (
          <p>
            <span className="text-ink-2">Record: </span>
            {record || "Not on record"}
          </p>
        )}
        <p>
          <span className="text-ink-2">Documents: </span>
          {doc}
        </p>
        {note && <p className="text-ink-2">{note}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// ── Paper mail ───────────────────────────────────────────────────────────

/** Paper mail Stable received for this entity: shown once there is some. */
function PaperMailSection() {
  const { page } = useEntity();
  const { mail } = usePaperMail(page.id ?? undefined);
  if (!mail?.length) return null;
  const unread = mail.filter((m) => !m.readAt).length;
  return (
    <Card title="Paper mail" count={unread || undefined} countTone="attention" info="Mail that arrived for this entity at the Stable address, with its envelope and scan." flush>
      <PaperMailList mail={mail.slice(0, 10)} empty="" />
    </Card>
  );
}

// ── Library ──────────────────────────────────────────────────────────────

function Library() {
  const { page, view, asset } = useEntity();
  const picker = useRef<HTMLInputElement>(null);
  const drop = page.docDrop;
  const docs = page.docs;
  const loose = docs.filter((d) => !view.docFiledAs.has(d.id));
  const used = docs.filter((d) => view.docFiledAs.has(d.id));
  const removed = Object.entries(asset.removedDocuments ?? {}).sort(([, a], [, b]) => b.removedAt - a.removedAt);
  const canAct = staff() && !asset.archived;
  const admin = isAdmin();
  const hasStatus = !!(drop.uploading || drop.dragOver || drop.error || page.aiDown || page.sorting > 0 || page.filingNotes.length);
  const [linkOpen, setLinkOpen] = useState(false);

  const dragOn = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!drop.dragOver) page.setDocDrop((s) => ({ ...s, dragOver: true }));
  };
  const menu: MenuItem[] = [
    ...(canAct ? [{ label: "Add a link…", onSelect: () => setLinkOpen(true) }] : []),
    ...(admin && !asset.archived
      ? [asset.legalHold ? { label: "Lift the legal hold", onSelect: () => void page.setLegalHold(false) } : { label: "Put on legal hold", hint: "Nothing can be deleted", onSelect: () => void page.setLegalHold(true) }]
      : []),
  ];

  return (
    <div
      {...(canAct
        ? {
            onDragOver: dragOn,
            onDragEnter: dragOn,
            onDragLeave: (e: DragEvent<HTMLDivElement>) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
              page.setDocDrop((s) => ({ ...s, dragOver: false }));
            },
            onDrop: (e: DragEvent<HTMLDivElement>) => {
              e.preventDefault();
              page.setDocDrop((s) => ({ ...s, dragOver: false }));
              void page.handleUploadDocs(Array.from(e.dataTransfer.files ?? []));
            },
          }
        : {})}
      className={cx("rounded-card", drop.dragOver && "outline-2 outline-offset-2 outline-accent outline-dashed")}
    >
      <input
        ref={picker}
        type="file"
        multiple
        className="hidden"
        tabIndex={-1}
        aria-label="Upload documents"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void page.handleUploadDocs(files);
        }}
      />
      <Card
        title="Library"
        info={canAct ? "Drop files anywhere on this card, or choose Upload: several at once, up to 25 MB each." : undefined}
        action={
          canAct ? (
            <Button size="sm" icon="upload" onClick={() => picker.current?.click()}>
              Upload
            </Button>
          ) : undefined
        }
        menu={menu.length ? menu : undefined}
        flush
      >
        {asset.legalHold && (
          <p className="px-5 pb-3 text-small text-ink-2 touch:px-4">
            On legal hold since {stamp(asset.legalHold.at)}
            {asset.legalHold.by ? ` (${asset.legalHold.by})` : ""}: nothing can be removed or deleted.
          </p>
        )}
        {hasStatus && <LibraryStatus />}
        {loose.length === 0 && used.length === 0 ? (
          <p className="border-t border-line px-5 py-4 text-body text-ink-2 touch:px-4">No documents yet. {canAct ? "Upload the formation papers and agreements, and they’re put on the right rows." : ""}</p>
        ) : (
          <List label="Library" className="border-t border-line">
            {loose.map((doc) => (
              <DocRow key={doc.id} doc={doc} />
            ))}
          </List>
        )}
        {(used.length > 0 || removed.length > 0) && (
          <div className="flex flex-col border-t border-line px-5 py-2 touch:px-4">
            {used.length > 0 && (
              <Disclosure label="Used as required documents" count={used.length}>
                <List label="Used as required documents" className="-mx-5 border-t border-line touch:-mx-4">
                  {used.map((doc) => (
                    <DocRow key={doc.id} doc={doc} />
                  ))}
                </List>
              </Disclosure>
            )}
            {removed.length > 0 && staff() && (
              <Disclosure label="Removed" count={removed.length}>
                <p className="max-w-[68ch] pb-2 text-small text-ink-2">Kept and restorable. An owner or admin can delete one for good {RETENTION_DAYS} days after it was removed, unless the entity is on legal hold.</p>
                <List label="Removed" className="-mx-5 border-t border-line touch:-mx-4">
                  {removed.map(([id, r]) => (
                    <RemovedRow key={id} id={id} doc={r} />
                  ))}
                </List>
              </Disclosure>
            )}
          </div>
        )}
      </Card>
      <AddLinkDialog open={linkOpen} onClose={() => setLinkOpen(false)} />
    </div>
  );
}

/** Uploads under way, where they were filed, and whether the reader is paused. */
function LibraryStatus() {
  const { page } = useEntity();
  const drop = page.docDrop;
  const notes = page.filingNotes;
  return (
    <div className="flex flex-col gap-2 border-t border-line px-5 py-3 touch:px-4" aria-live="polite">
      {drop.uploading && (
        <div>
          <div className="flex items-center justify-between gap-3 text-small">
            <span className="min-w-0 truncate text-ink">
              Uploading {drop.index} of {drop.total} · {drop.uploading}
            </span>
            <span className="shrink-0 text-ink-2 tabular-nums">{Math.round(drop.progress)}%</span>
          </div>
          <Progress value={drop.progress} />
        </div>
      )}
      {drop.dragOver && !drop.uploading && <p className="text-small font-medium text-accent">Drop to upload</p>}
      {drop.error && <p className="text-small text-negative">{drop.error}</p>}
      {page.aiDown && (
        <Banner tone="warning" title="Document reading is paused.">
          Uploads are saved and filed by name until it’s back; then Scan library reads them.
        </Banner>
      )}
      {page.sorting > 0 && <p className="text-small text-ink-2">Reading {format.count(page.sorting, "document")} to file {page.sorting === 1 ? "it" : "them"}…</p>}
      {notes.length > 0 && (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Disclosure label="Where the uploads went" count={notes.length} defaultOpen={notes.length <= 3}>
              <ul className="flex flex-col gap-1 pb-1 text-small text-ink">
                {notes.map((n, i) => (
                  <li key={i} className="break-words">
                    {n}
                  </li>
                ))}
              </ul>
            </Disclosure>
          </div>
          {page.sorting === 0 && <IconButton icon="x" label="Dismiss" onClick={() => page.setFilingNotes([])} />}
        </div>
      )}
    </div>
  );
}

/** A thin progress line under an upload. */
function Progress({ value }: { value: number }) {
  return (
    <div aria-hidden="true" className="mt-2 h-[2px] overflow-hidden rounded-full bg-sunken">
      <div className="h-full rounded-full bg-accent transition-[width] duration-(--dur-2)" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function DocRow({ doc }: { doc: AssetDoc }) {
  const { page, view, asset } = useEntity();
  const kind = docKind(doc);
  const filedAs = view.docFiledAs.get(doc.id);
  const canAct = staff() && !asset.archived;
  const stored = !!storagePathOf(doc);
  const name = doc.name;
  const meta = [kind === "LINK" || kind === "FILE" ? null : kind, stored ? page.formatBytes(doc.size) : "Link", doc.createdAt ? `added ${stamp(doc.createdAt)}${doc.addedBy ? ` by ${doc.addedBy}` : ""}` : null].filter(Boolean).join(" · ");
  const open = () => void openStoredFile(stored ? { ...doc, name: withoutEntityName(name, asset.name) } : doc, { subtitle: [asset.name, filedAs ? filingTitle(filedAs, asset) : null, meta].filter(Boolean).join(" · ") });
  const menu: MenuItem[] | undefined = canAct
    ? [
        ...(stored ? [{ label: "Open in a new tab", onSelect: () => void openStoredFile(doc, { newTab: true }) }] : []),
        { label: "Rename…", onSelect: () => page.handleRenameDoc(doc) },
        ...(isPdf(doc) && stored ? [{ label: "Send for signature…", onSelect: () => void page.handleSendForSignature(doc, name.replace(/\.pdf$/i, "")) }] : []),
        { label: stored ? `Copy a ${SIGNED_LINK_MINUTES}-minute link` : "Copy the link", hint: stored ? "Recorded in Activity" : undefined, onSelect: () => void page.handleCopyDocUrl(doc) },
        { divider: true as const },
        { label: "Remove…", danger: true, onSelect: () => void page.handleDeleteDoc(doc.id) },
      ]
    : undefined;
  return (
    <ListRow
      label={name}
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="break-words">{name}</span>
          {filedAs && <Badge>{filingTitle(filedAs, asset)}</Badge>}
          {doc.draft && <Badge>Draft, unsigned</Badge>}
          {doc.replacedAt && <Badge>Earlier version</Badge>}
        </span>
      }
      secondary={meta}
      onClick={open}
      menu={menu}
    />
  );
}

/** A removed document: who removed it and when; Restore, and for an owner or admin after the hold, Delete for good. */
function RemovedRow({ id, doc }: { id: string; doc: RemovedDoc }) {
  const { page, asset } = useEntity();
  const [purging, setPurging] = useState(false);
  const days = Math.floor((Date.now() - doc.removedAt) / 86_400_000);
  const canPurge = isAdmin() && !asset.legalHold && days >= RETENTION_DAYS && !asset.archived;
  const canRestore = staff() && !asset.archived;
  return (
    <>
      <ListRow
        label={doc.name}
        title={<span className="text-ink-2">{doc.name}</span>}
        secondary={`Removed ${stamp(doc.removedAt)}${doc.removedBy ? ` by ${doc.removedBy}` : ""}${doc.filedAs ? ` · was the ${doc.filedAs}` : ""}`}
        onClick={doc.storagePath ? () => void openStoredFile(doc as StoredFileRef, { subtitle: `Removed ${stamp(doc.removedAt)}` }) : undefined}
        menu={
          canRestore
            ? [
                { label: "Restore", onSelect: () => void page.restoreDoc(id) },
                ...(isAdmin()
                  ? [
                      { divider: true as const },
                      canPurge
                        ? { label: "Delete for good…", danger: true, onSelect: () => setPurging(true) }
                        : { label: "Delete for good…", disabled: true, disabledReason: asset.legalHold ? "On legal hold" : `In ${RETENTION_DAYS - days} days`, onSelect: () => {} },
                    ]
                  : []),
              ]
            : undefined
        }
      />
      <PurgeDialog id={id} doc={doc} open={purging} onClose={() => setPurging(false)} />
    </>
  );
}

/** Deleting a removed document for good: the reason, and its name typed (§11.2). */
function PurgeDialog({ id, doc, open, onClose }: { id: string; doc: RemovedDoc; open: boolean; onClose: () => void }) {
  const { page } = useEntity();
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setReason("");
      setTyped("");
      setError("");
    }
  }, [open]);
  const matches = typed.trim().toLowerCase().replace(/[‘’“”]/g, "'") === doc.name.trim().toLowerCase().replace(/[‘’“”]/g, "'");
  const ready = matches && reason.trim().length > 2;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Delete this document for good?"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            disabled={!ready}
            disabledReason={ready ? undefined : "Give a reason and type the name"}
            busy={busy}
            busyLabel="Deleting…"
            onClick={async () => {
              setBusy(true);
              const why = await page.purgeDoc(id, reason);
              setBusy(false);
              if (why) setError(why);
              else onClose();
            }}
          >
            Delete for good
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-body font-medium break-words text-ink">{doc.name}</p>
          <p className="text-small text-ink-2">Removed {stamp(doc.removedAt)}</p>
        </div>
        <p className="text-body text-ink-2">The file is deleted from storage. The record of who deleted it, when and why is kept. This can’t be undone.</p>
        <Field label="Why">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label={`Type ${doc.name} to confirm`}>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </Field>
        {error && <p className="text-small text-negative">{error}</p>}
      </div>
    </Dialog>
  );
}

/** Add a link (a document kept elsewhere) to the library. */
function AddLinkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { page } = useEntity();
  const ready = !!page.docName.trim() && /^https?:\/\/\S+$/.test(page.docUrl.trim());
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a link"
      size="sm"
      dirty={!!(page.docName || page.docUrl)}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!ready}
            disabledReason={ready ? undefined : "Add a name and a web address"}
            onClick={async () => {
              await page.handleAddDoc({ preventDefault() {} } as React.FormEvent);
              onClose();
            }}
          >
            Add link
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name">
          <Input value={page.docName} onChange={(e) => page.setDocName(e.target.value)} />
        </Field>
        <Field label="Web address" hint="Where the document is kept, starting https://.">
          <Input value={page.docUrl} onChange={(e) => page.setDocUrl(e.target.value)} type="url" placeholder="https://" />
        </Field>
      </div>
    </Dialog>
  );
}

/** Rename a document: a labelled field, with a name AI can suggest on request. */
function RenameDialog() {
  const { page } = useEntity();
  const r = page.renaming;
  const [name, setName] = useState("");
  useEffect(() => {
    if (r) setName(r.doc.name);
  }, [r?.doc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (r?.suggestion) setName(r.suggestion);
  }, [r?.suggestion]);
  return (
    <Dialog
      open={!!r}
      onClose={() => page.setRenaming(null)}
      title="Rename this document"
      size="sm"
      dirty={!!r && name !== r.doc.name}
      footer={
        <>
          <Button onClick={() => page.setRenaming(null)}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => void page.saveDocName(name)}>
            Rename
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name" hint={r?.suggestion ? <AiNote kind="drafted" /> : undefined} error={r?.error || undefined}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div>
          <Button variant="quiet" size="sm" icon="sparkle" busy={!!r?.suggesting} busyLabel="Suggesting…" onClick={() => void page.suggestDocName()} className="text-accent">
            Suggest a name
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
