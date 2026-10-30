/**
 * Documents tab: the filings the rule book asks for (Filings), every file and
 * link on the entity (Library), and the check of the record against its
 * documents (Document check). All state and actions come from useEntity().
 */

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { canDraftAgreement } from "../paperwork-generate";
import { isPartner } from "../auth";
import { SIGNED_LINK_MINUTES, StoredFileLink, storagePathOf, type StoredFileRef } from "../stored-file";
import { PaperMailList, usePaperMail } from "../paper-mail";
import type { DocRule } from "../entity-paperwork";
import { useEntity } from "./context";
import {
  VERIFY_LABEL,
  docKind,
  filingTitle,
  fmtDate,
  fmtStamp,
  normEntityName,
  normValue,
  timeAgo,
  type AssetDoc,
  type FileKind,
  type VerifyField,
} from "./model";
import {
  Button,
  Disclosure,
  Dot,
  Empty,
  ErrorLine,
  Icon,
  IconButton,
  InfoText,
  InfoToggle,
  Input,
  Row,
  Rows,
  Section,
  TextButton,
  toneText,
  useTone,
  type IconName,
  type Tone,
} from "./ui";

// Slot uploads take a PDF or a scan, up to 25 MB (checked in handleUploadFile).
const ACCEPT = "application/pdf,image/png,image/jpeg";
const ACCEPTED = ACCEPT.split(",");
const TYPES_LABEL = ACCEPTED.map((m) => m.split("/")[1].toUpperCase()).join(", ");
const GROUPS = ["Trust", "Formation", "IRS", "Governance", "Elections", "State"] as const;
const STUCK = "Upload is stuck.";
/** Row actions: always shown on touch screens; with a mouse, on hover or keyboard focus. */
// Row actions stay visible (quiet icons) so they're always discoverable.
const REVEAL = "";

export function DocumentsTab() {
  // A file dropped anywhere else on the tab must not make the browser open it (and leave the app).
  const swallow = (e: DragEvent<HTMLDivElement>) => {
    if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
  };
  return (
    <div onDragOver={swallow} onDrop={swallow} className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <Filings />
        <PaperMailSection />
        <Library />
      </div>
      {!isPartner() && (
        <div className="min-w-0 space-y-4">
          <DocumentCheck />
        </div>
      )}
    </div>
  );
}

// ── Filings ──────────────────────────────────────────────────────────────

function Filings() {
  const { page, view, asset } = useEntity();
  const t = useTone();
  const ruleOf = new Map(view.rules.map((r) => [r.key, r] as const));
  // Slots the rule book scores (plus any slot holding a file it no longer asks for), by category.
  const main = view.kinds.filter((k) => ruleOf.get(k)?.level !== "recommended");
  const extra = view.kinds.filter((k) => ruleOf.get(k)?.level === "recommended");
  const groups = GROUPS.map((cat) => ({ cat, keys: main.filter((k) => (ruleOf.get(k)?.category ?? "Formation") === cat) })).filter((g) => g.keys.length);
  const total = view.scoredKinds.length;
  const reading = page.sorting > 0 || (!!page.scan && !page.scan.finished);
  const canScan = !isPartner() && page.docs.length > 0 && view.filedCount < total;

  return (
    <Section
      title="Filings"
      info="Documents you upload are read and filed here automatically."
      actions={
        <>
          <span className={`text-[12px] tabular-nums ${view.filedCount === total ? toneText("good", t.dark) : t.muted}`}>
            {view.filedCount}/{total} on file
          </span>
          {canScan && (
            <TextButton className="ml-2" onClick={() => void page.scanLibrary()} disabled={reading}>
              {reading ? "Reading documents…" : "Scan library"}
            </TextButton>
          )}
        </>
      }
    >
      {groups.map((g, i) => (
        <div key={g.cat} className={i ? `border-t ${t.line}` : ""}>
          <p className={`px-5 pb-0.5 pt-3 text-[11px] font-medium ${t.muted}`}>{g.cat}</p>
          <Rows>
            {g.keys.map((k) => (
              <FilingRow key={k} kind={k} rule={ruleOf.get(k)} />
            ))}
          </Rows>
        </div>
      ))}
      {extra.length > 0 && (
        <div className={groups.length ? `border-t ${t.line}` : ""}>
          <Disclosure label={`Good to keep · ${extra.filter((k) => asset[k]).length}/${extra.length} on file`}>
            <Rows className={`border-t ${t.line}`}>
              {extra.map((k) => (
                <FilingRow key={k} kind={k} rule={ruleOf.get(k)} />
              ))}
            </Rows>
          </Disclosure>
        </div>
      )}
      {view.kinds.length === 0 && <Empty>No filings apply.</Empty>}
    </Section>
  );
}

/** One paperwork slot: the file on record, or its need level and an upload. Empty slots take a dropped file. */
function FilingRow({ kind, rule }: { kind: FileKind; rule?: DocRule }) {
  const { page, asset } = useEntity();
  const t = useTone();
  const picker = useRef<HTMLInputElement>(null);
  const file = asset[kind];
  const slot = page.uploadState[kind];
  const title = filingTitle(kind, asset);
  const pick = () => picker.current?.click();
  // Paperwork BFO can write itself, from the record.
  const generate =
    isPartner()
      ? null
      : kind === "w9"
      ? { label: "Fill in", title: "Fill in the IRS's W-9 from the record", run: page.generateW9 }
      : kind === "operatingAgreement" && canDraftAgreement(asset)
        ? { label: "Draft", title: "Draft the operating agreement from the members, state and tax class on record", run: page.generateOperatingAgreement }
        : null;

  const need: { tone: Tone; word: string; hint?: string } =
    isPartner()
      ? { tone: "muted", word: "Not on file" }
      : rule?.level === "recommended"
      ? { tone: "muted", word: "Optional" }
      : rule?.level === "expected"
        ? { tone: "warn", word: "Expected", hint: "Not a legal requirement, but banks, lenders and courts expect it" }
        : { tone: "bad", word: "Missing", hint: "Required" };

  const dragOn = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!slot.uploading && !slot.dragOver) page.setSlot(kind, { dragOver: true });
  };
  // A filled slot takes no drop, but still clears the highlight if it was filed mid-drag.
  const dropHandlers = {
        ...(file || isPartner() ? {} : { onDragOver: dragOn, onDragEnter: dragOn }),
        onDragLeave: (e: DragEvent<HTMLDivElement>) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          page.setSlot(kind, { dragOver: false });
        },
        onDrop: (e: DragEvent<HTMLDivElement>) => {
          e.preventDefault();
          e.stopPropagation();
          page.setSlot(kind, { dragOver: false });
          if (file || slot.uploading) return;
          const f = e.dataTransfer.files?.[0];
          if (!f) return;
          if (!ACCEPTED.includes(f.type)) {
            page.setSlot(kind, { error: `Only ${TYPES_LABEL} files accepted.` });
            return;
          }
          void page.handleUploadFile(kind, f);
        },
      };

  const value = file ? (
    <span className="flex min-w-0 items-center gap-2">
      <Dot tone="good" />
      <StoredFileLink file={file} title={file.fileName} className="min-w-0 truncate hover:underline">
        {file.fileName || "On file"}
      </StoredFileLink>
      {file.uploadedAt ? <span className={`shrink-0 text-[12px] tabular-nums ${t.muted}`}>{fmtStamp(file.uploadedAt)}</span> : null}
    </span>
  ) : slot.uploading ? (
    <span className={`text-[12px] tabular-nums ${t.muted}`}>Uploading… {Math.round(slot.progress)}%</span>
  ) : slot.dragOver ? (
    <span className={`text-[12px] font-medium ${t.accent}`}>Drop to upload</span>
  ) : (
    <span title={need.hint}>
      <Dot tone={need.tone}>{need.word}</Dot>
    </span>
  );

  // An invited owner looks; only staff change paperwork.
  const actions = isPartner() ? (
    file ? (
      <div className="-my-1 flex shrink-0 items-center">
        <IconLink file={file} icon="external" label="View" ariaLabel={`View ${title}`} />
      </div>
    ) : null
  ) : file ? (
    <div className={`-my-1 flex shrink-0 items-center ${slot.uploading ? "" : REVEAL}`}>
      <IconLink file={file} icon="external" label="View" ariaLabel={`View ${title}`} />
      {generate && (
        <IconButton icon="sparkle" label={`${generate.label} again`} aria-label={`${generate.label} ${title} again`} title={`${generate.title} (the file on record stays in Documents)`} disabled={slot.uploading} onClick={() => void generate.run(true)} />
      )}
      <IconButton icon="refresh" label="Replace" aria-label={`Replace ${title}`} disabled={slot.uploading} onClick={pick} />
      <IconButton
        icon="trash"
        tone="danger"
        label={file.docId ? "Unfile (keeps the document)" : "Remove"}
        aria-label={file.docId ? `Unfile ${title}` : `Remove ${title}`}
        disabled={slot.uploading}
        onClick={() => void page.handleDeleteFile(kind)}
      />
    </div>
  ) : (
    <div className="-my-1 flex shrink-0 items-center gap-1.5">
      {generate && (
        <Button icon="sparkle" aria-label={`${generate.label} ${title}`} title={generate.title} disabled={slot.uploading} onClick={() => void generate.run()}>
          {generate.label}
        </Button>
      )}
      <Button icon="upload" aria-label={`Upload ${title}`} title={`${TYPES_LABEL} · up to 25 MB`} disabled={slot.uploading} onClick={pick} kind={generate ? "ghost" : undefined}>
        Upload
      </Button>
    </div>
  );

  const info =
    rule || !file ? (
      <>
        {rule?.why && <span className="block">{rule.why}</span>}
        {rule?.howTo && (
          <a href={rule.howTo.url} target="_blank" rel="noopener noreferrer" className={`mt-1 inline-flex items-center gap-1 font-medium hover:underline ${t.accent}`}>
            {rule.howTo.label}
            <Icon name="external" className="h-3 w-3" />
          </a>
        )}
        {!file && generate && (
          <span className={`mt-1 block ${t.muted}`}>
            {kind === "w9" ? "BFO can fill in the IRS's form from the record, ready to sign." : "BFO can draft it from the members, shares, state and tax class on record. Have counsel read it before signing."}
          </span>
        )}
        {!file && !isPartner() && <span className={`mt-1 block ${t.muted}`}>Drop a file on this row or upload one. {TYPES_LABEL} · up to 25 MB.</span>}
      </>
    ) : undefined;

  return (
    <div {...dropHandlers} className={`group transition-colors ${slot.dragOver ? (t.dark ? "bg-[#818cf8]/[0.08]" : "bg-indigo-50") : ""}`}>
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
      <Row id={`filing-${kind}`} label={title} info={info} labelWidth="sm:w-[240px]">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">{value}</div>
          {actions}
        </div>
        {slot.uploading && <Bar value={slot.progress} className="mt-2" />}
        <InlineError error={slot.error} />
      </Row>
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
    <Section title="Paper mail" count={unread || undefined} alert={unread > 0} info="Mail that arrived for this entity at the Stable address, with its envelope and scan.">
      {/* The piece's page marks it read once it has loaded. */}
      <PaperMailList mail={mail.slice(0, 10)} empty="" />
    </Section>
  );
}

// ── Library ──────────────────────────────────────────────────────────────

function Library() {
  const { page } = useEntity();
  const t = useTone();
  const picker = useRef<HTMLInputElement>(null);
  const drop = page.docDrop;
  const docs = page.docs;
  const hasStatus = !!(drop.uploading || drop.dragOver || drop.error || page.aiDown || page.sorting > 0 || page.filingNotes.length);

  const dragOn = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!drop.dragOver) page.setDocDrop((s) => ({ ...s, dragOver: true }));
  };

  return (
    <div
      onDragOver={dragOn}
      onDragEnter={dragOn}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        page.setDocDrop((s) => ({ ...s, dragOver: false }));
      }}
      onDrop={(e) => {
        e.preventDefault();
        page.setDocDrop((s) => ({ ...s, dragOver: false }));
        void page.handleUploadDocs(Array.from(e.dataTransfer.files ?? []));
      }}
      className={`rounded-2xl transition-shadow ${drop.dragOver ? (t.dark ? "ring-2 ring-[#818cf8]/60" : "ring-2 ring-[#4f46e5]/40") : ""}`}
    >
      <input
        ref={picker}
        type="file"
        multiple
        className="hidden"
        tabIndex={-1}
        aria-label="Upload documents"
        onChange={(e) => {
          // Copy before resetting the input — the FileList is live.
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void page.handleUploadDocs(files);
        }}
      />
      <Section
        title="Library"
        count={docs.length}
        info="Drop files anywhere on this card, or use Upload — multiple allowed. PDF, images, Office docs · up to 25 MB each."
        actions={
          isPartner() ? undefined : <>
            <TextButton onClick={() => page.setShowLinkForm((v) => !v)} aria-expanded={page.showLinkForm} className="mr-2">
              {page.showLinkForm ? "Hide link" : "Add link"}
            </TextButton>
            <Button icon="upload" onClick={() => picker.current?.click()}>
              Upload
            </Button>
          </>
        }
      >
        <Rows>
          {hasStatus && (
            <div className="break-words py-1">
              {drop.uploading ? (
                <div className="px-5 py-2">
                  <div className="flex items-center justify-between gap-3 text-[12px]">
                    <span className={`min-w-0 truncate ${t.text}`}>
                      Uploading {drop.index} of {drop.total} · {drop.uploading}
                    </span>
                    <span className={`shrink-0 tabular-nums ${t.muted}`}>{Math.round(drop.progress)}%</span>
                  </div>
                  <Bar value={drop.progress} className="mt-2" />
                </div>
              ) : drop.dragOver ? (
                <p className={`px-5 py-2 text-[12px] font-medium ${t.accent}`}>Drop to upload</p>
              ) : null}
              <ErrorLine>{drop.error}</ErrorLine>
              {page.aiDown && (
                <Line tone="warn" detail="Uploads are saved and filed by name only until it's back — then use “Scan library” under Filings to read them.">
                  {page.aiDown}
                </Line>
              )}
              {page.sorting > 0 && (
                <p className={`flex items-center gap-2 px-5 py-2 text-[12px] ${t.muted}`}>
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full motion-safe:animate-pulse ${t.dark ? "bg-[#818cf8]" : "bg-[#4f46e5]"}`} aria-hidden="true" />
                  Reading {page.sorting} document{page.sorting === 1 ? "" : "s"} to file {page.sorting === 1 ? "it" : "them"}…
                </p>
              )}
              {page.filingNotes.length > 0 && <FilingNotes />}
            </div>
          )}
          {page.showLinkForm && (
            <form onSubmit={(e) => void page.handleAddDoc(e)} className="grid grid-cols-1 gap-2 px-5 py-3 sm:grid-cols-[1fr_1.4fr_auto]">
              <Input value={page.docName} onChange={(e) => page.setDocName(e.target.value)} placeholder="Document name" aria-label="Document name" required autoFocus />
              <Input value={page.docUrl} onChange={(e) => page.setDocUrl(e.target.value)} placeholder="https://…" aria-label="Link" type="url" required />
              <Button type="submit" kind="primary" size="md">
                Add
              </Button>
            </form>
          )}
          {docs.length === 0 ? (
            <Empty>No documents yet.</Empty>
          ) : (
            <Rows>
              {docs.map((doc) => (
                <DocRow key={doc.id} doc={doc} />
              ))}
            </Rows>
          )}
        </Rows>
      </Section>
    </div>
  );
}

/** Where the latest uploads or scan went: one line, or a collapsed list. */
function FilingNotes() {
  const { page } = useEntity();
  const t = useTone();
  const notes = page.filingNotes;
  const filed = notes.filter((n) => n.startsWith("Filed")).length;
  const lines = notes.map((note, i) => {
    const ok = note.startsWith("Filed");
    return (
      <p key={i} className="flex items-start gap-2 px-5 py-1.5 text-[12px] leading-snug">
        <Icon name={ok ? "check" : "doc"} className={`mt-px h-3 w-3 ${ok ? toneText("good", t.dark) : t.muted}`} />
        <span className={`min-w-0 break-words ${ok ? t.text : t.muted}`}>{note}</span>
      </p>
    );
  });
  return (
    <div className="flex items-start gap-1 pr-3">
      <div className="min-w-0 flex-1">
        {notes.length === 1 ? (
          <div className="py-1">{lines}</div>
        ) : (
          <Disclosure label={filed === notes.length ? "Filed" : "Filing notes"} count={notes.length} defaultOpen={notes.length <= 3}>
            <div className="pb-1">{lines}</div>
          </Disclosure>
        )}
      </div>
      {page.sorting === 0 && <IconButton icon="x" label="Dismiss" className="mt-1" onClick={() => page.setFilingNotes([])} />}
    </div>
  );
}

function DocRow({ doc }: { doc: AssetDoc }) {
  const { page, view, asset } = useEntity();
  const t = useTone();
  const kind = docKind(doc);
  const filedAs = view.docFiledAs.get(doc.id);
  const renaming = page.renamingDocId === doc.id;
  const copied = page.copiedDocId === doc.id;
  const meta = [kind === "LINK" || kind === "FILE" ? null : kind, doc.storagePath ? page.formatBytes(doc.size) : "External link", fmtStamp(doc.createdAt)]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="group flex items-center gap-3 px-5 py-3">
      <Icon name={doc.storagePath ? "doc" : "link"} className={`h-4 w-4 ${t.faint}`} />
      <div className="min-w-0 flex-1">
        <StoredFileLink file={doc} title={doc.name} className={`block truncate text-[13px] font-medium hover:underline ${t.text}`}>
          {doc.name}
        </StoredFileLink>
        <p className={`mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[12px] tabular-nums ${t.muted}`}>
          <span>{meta}</span>
          {filedAs && (
            <span className="inline-flex items-start gap-1">
              <Icon name="check" className="mt-px h-3 w-3" strokeWidth={2.25} />
              Filed as {filingTitle(filedAs, asset)}
            </span>
          )}
        </p>
      </div>
      {!isPartner() && <div className={`flex shrink-0 items-center ${renaming || copied ? "" : REVEAL}`}>
        <IconButton
          icon="sparkle"
          label={renaming ? "Renaming…" : "Rename"}
          title="Suggest a better name using Claude"
          disabled={renaming}
          className={renaming ? "motion-safe:animate-pulse" : ""}
          onClick={() => void page.handleRenameDoc(doc)}
        />
        <IconButton
          icon={copied ? "check" : "copy"}
          label={copied ? "Copied" : storagePathOf(doc) ? `Copy ${SIGNED_LINK_MINUTES}-minute link` : "Copy URL"}
          title={storagePathOf(doc) ? `Copies a private link to this file that stops working after ${SIGNED_LINK_MINUTES} minutes` : "Copies the link"}
          className={copied ? (t.dark ? "text-emerald-400!" : "text-emerald-700!") : ""}
          onClick={() => void page.handleCopyDocUrl(doc)}
        />
        <IconButton icon="trash" tone="danger" label="Delete" aria-label={`Delete ${doc.name}`} onClick={() => void page.handleDeleteDoc(doc.id)} />
      </div>}
    </div>
  );
}

// ── Document check ───────────────────────────────────────────────────────

function DocumentCheck() {
  const { page, asset } = useEntity();
  const t = useTone();
  const [open, setOpen] = useState(false);
  const v = asset.verification;
  const verifying = page.verifying;

  // A finding is resolved once the record says what the document says.
  const current = page.recordValues(asset);
  const findings = (v?.fields ?? []).map((f) => {
    const now = current[f.field] ?? "";
    return { ...f, now, resolved: !!f.found && normValue(now) === normValue(f.found) };
  });
  const actionable = findings.filter((f) => !f.resolved && (f.status === "mismatch" || f.status === "missing_on_record") && f.found);
  const matched = findings.filter((f) => f.status === "match" || f.resolved);
  const changedSince = v?.recordAtCheck
    ? (Object.keys(v.recordAtCheck) as VerifyField[]).some((k) => normValue(v.recordAtCheck![k]) !== normValue(current[k]))
    : false;

  const recordedOwner = asset.ownerId ? (page.assetNames[asset.ownerId] ?? null) : null;
  const docOwners = v?.owners ?? [];
  const soleOwner = docOwners.length === 1 ? docOwners[0] : null;
  const soleOwnerId = soleOwner
    ? Object.entries(page.assetNames).find(([aid, n]) => aid !== page.id && normEntityName(n) === normEntityName(soleOwner.name))?.[0]
    : undefined;
  const ownerOk = !!recordedOwner && docOwners.some((o) => normEntityName(o.name) === normEntityName(recordedOwner));
  const ownerMismatch = docOwners.length > 0 && !ownerOk;
  const issues = v?.issues ?? [];
  const toReview = actionable.length + (ownerMismatch ? 1 : 0) + issues.filter((i) => i.severity !== "low").length;

  const detail = verifying
    ? "Claude is reading the filings and comparing them with this record — ownership, EIN, dates, addresses. This can take a minute."
    : v?.summary || null;
  const read = v?.documentsRead?.length ?? 0;

  return (
    <Section
      title="Document check"
      info="Reads this entity's documents and checks the record against them: legal name, EIN, state, formation and agreement dates, address, registered agent, tax classification and who owns it."
      actions={
        <Button icon="sparkle" onClick={() => void page.runVerification()} disabled={verifying}>
          {verifying ? "Checking…" : v ? "Re-check" : "Verify"}
        </Button>
      }
    >
      <div className="px-5 py-3">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px]">
          {verifying ? (
            <span className={t.muted}>Reading documents…</span>
          ) : !v ? (
            <Dot tone="muted">Not verified yet</Dot>
          ) : toReview === 0 ? (
            <Dot tone="good">Record matches documents</Dot>
          ) : (
            <Dot tone="warn">{toReview} to review</Dot>
          )}
          {v && !verifying && (
            <span className={`tabular-nums ${t.muted}`}>
              {read} document{read === 1 ? "" : "s"} · {timeAgo(v.checkedAt)}
              {changedSince && <span className={toneText("warn", t.dark)}> · record changed since</span>}
            </span>
          )}
          {detail && <InfoToggle open={open} onToggle={() => setOpen((o) => !o)} label={verifying ? "What's happening?" : "Summary"} />}
        </div>
        {verifying && <Bar className="mt-2.5" />}
        {detail && <InfoText open={open}>{detail}</InfoText>}
      </div>
      <ErrorLine>{page.verifyError}</ErrorLine>

      {v && !verifying && (
        <Rows className={`border-t ${t.line}`}>
          <Row
            stacked
            label={
              <>
                Ownership
                <Dot tone={ownerOk ? "good" : ownerMismatch ? "warn" : "muted"}>{ownerOk ? "Matches" : ownerMismatch ? "Differs" : "Not stated"}</Dot>
              </>
            }
            actions={
              ownerMismatch && soleOwnerId ? (
                <div className="pt-2">
                  <Button
                    title={`Set owner to ${page.assetNames[soleOwnerId]}`}
                    aria-label={`Set owner to ${page.assetNames[soleOwnerId]}`}
                    onClick={() => void page.applyOwner(soleOwnerId)}
                  >
                    Set owner
                  </Button>
                </div>
              ) : undefined
            }
          >
            {docOwners.length > 0 ? (
              <Compare
                record={recordedOwner ?? "No owner set"}
                doc={docOwners.map((o) => `${o.name}${o.percent != null ? ` (${o.percent}%)` : ""}`).join(", ")}
              />
            ) : (
              <span className="break-words">{recordedOwner ?? "No owner set"}</span>
            )}
          </Row>

          {actionable.map((f) => (
            <Row
              key={f.field}
              stacked
              label={
                <>
                  {VERIFY_LABEL[f.field]}
                  <Dot tone={f.status === "mismatch" ? "warn" : "accent"}>{f.status === "mismatch" ? "Differs" : "Not on record"}</Dot>
                </>
              }
              info={f.source || f.note ? [f.source, f.note].filter(Boolean).join(" — ") : undefined}
              actions={
                <div className="pt-2">
                  <Button icon="check" onClick={() => void page.applyFinding(f.field, f.found!)}>
                    Use document value
                  </Button>
                </div>
              }
            >
              <Compare record={f.status === "mismatch" ? showValue(f.field, f.now) : null} doc={showValue(f.field, f.found ?? "")} />
            </Row>
          ))}

          {issues.map((issue, n) => (
            <Row key={`issue-${n}`}>
              <span className="flex items-start gap-2 break-words">
                <span
                  aria-hidden="true"
                  className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${issue.severity === "high" ? "bg-red-400" : issue.severity === "medium" ? "bg-amber-400" : t.dark ? "bg-gray-600" : "bg-gray-300"}`}
                />
                <span>
                  <span className="sr-only">{issue.severity} severity: </span>
                  {issue.message}
                </span>
              </span>
            </Row>
          ))}

          {matched.length > 0 && (
            <Disclosure label="Confirmed" count={matched.length}>
              <div className="pb-2">
                {matched.map((f) => (
                  <div key={f.field} className={`flex justify-between gap-3 px-5 py-1.5 text-[12px] ${t.muted}`}>
                    <span className="shrink-0">{VERIFY_LABEL[f.field]}</span>
                    <span className="min-w-0 truncate text-right" title={f.source ?? undefined}>
                      {f.source}
                    </span>
                  </div>
                ))}
              </div>
            </Disclosure>
          )}
        </Rows>
      )}
    </Section>
  );
}

function showValue(field: VerifyField, value: string) {
  return field.endsWith("Date") ? fmtDate(value) || value : value;
}

/** Record vs document, one line each. `record` null = the record has nothing to compare. */
function Compare({ record, doc }: { record: string | null; doc: string }) {
  const t = useTone();
  return (
    <div className="space-y-0.5 break-words">
      {record !== null && (
        <p>
          <span className={`mr-1.5 text-[12px] ${t.muted}`}>Record</span>
          {record || "—"}
        </p>
      )}
      <p>
        <span className={`mr-1.5 text-[12px] ${t.muted}`}>Documents</span>
        {doc}
      </p>
    </div>
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────

/** A thin progress line; without a value it slides (indeterminate). */
function Bar({ value, className = "" }: { value?: number; className?: string }) {
  const { dark } = useTone();
  const fill = dark ? "bg-[#818cf8]" : "bg-[#4f46e5]";
  return (
    <div aria-hidden="true" className={`h-0.5 overflow-hidden rounded-full ${dark ? "bg-white/[0.06]" : "bg-gray-100"} ${className}`}>
      {value == null ? (
        <>
          <div className={`h-full w-1/3 rounded-full motion-safe:animate-[entity-bar_1.4s_ease-in-out_infinite] ${fill}`} />
          <style>{"@keyframes entity-bar{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}"}</style>
        </>
      ) : (
        <div className={`h-full rounded-full transition-[width] ${fill}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      )}
    </div>
  );
}

/** A slot error under its value. "Upload is stuck." keeps its storage how-to behind (i). */
function InlineError({ error }: { error: string | null }) {
  const { dark } = useTone();
  const [open, setOpen] = useState(false);
  if (!error) return null;
  const stuck = error.startsWith(STUCK) && error.length > STUCK.length;
  return (
    <div className={`mt-1.5 text-[12px] leading-snug ${dark ? "text-red-300" : "text-red-600"}`}>
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {stuck ? STUCK : error}
        {stuck && <InfoToggle open={open} onToggle={() => setOpen((o) => !o)} label="How to fix" />}
      </span>
      {stuck && <InfoText open={open}>{error.slice(STUCK.length).trim()}</InfoText>}
    </div>
  );
}

/** One status line with a dot, and an optional (i) for the explanation. */
function Line({ tone, detail, children }: { tone: Tone; detail?: ReactNode; children: ReactNode }) {
  const t = useTone();
  const [open, setOpen] = useState(false);
  const dot = { good: "bg-emerald-400", warn: "bg-amber-400", bad: "bg-red-400", muted: t.dark ? "bg-gray-600" : "bg-gray-300", accent: "bg-[#818cf8]" }[tone];
  return (
    <div className="px-5 py-2 text-[12px] leading-snug">
      <div className={`flex items-start gap-2 ${toneText(tone, t.dark)}`}>
        <span aria-hidden="true" className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="min-w-0">
          {children}
          {detail && (
            <span className="ml-1.5 inline-flex align-[-3px]">
              <InfoToggle open={open} onToggle={() => setOpen((o) => !o)} />
            </span>
          )}
        </span>
      </div>
      {detail && <InfoText open={open} className="pl-3.5">{detail}</InfoText>}
    </div>
  );
}

/** IconButton's look, as a link that opens in a new tab. */
/** An icon that opens a stored file (through a signed link for our own documents). */
function IconLink({ file, icon, label, ariaLabel }: { file: StoredFileRef; icon: IconName; label: string; ariaLabel?: string }) {
  const { dark } = useTone();
  return (
    <StoredFileLink
      file={file}
      ariaLabel={ariaLabel ?? label}
      title={label}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors max-sm:h-[40px] max-sm:w-[40px] ${
        dark ? "text-gray-500 hover:bg-white/[0.06] hover:text-white" : "text-gray-400 hover:bg-gray-100 hover:text-gray-900"
      }`}
    >
      <Icon name={icon} className="h-3.5 w-3.5" />
    </StoredFileLink>
  );
}
