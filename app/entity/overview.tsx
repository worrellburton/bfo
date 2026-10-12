/**
 * Overview: the record's facts (or the form that edits them), what the entity
 * is according to its documents, and what the record still needs.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { entityType, TAX_CLASSES } from "../entity-completeness";
import { DOC_LABEL, docKindOf, openPalmDocument, palmCall, type PalmDocument } from "../palm";
import { useEntity } from "./context";
import { BY_HAND, fmtDate, fmtStamp, type Asset, type FileKind } from "./model";
import { Button, Disclosure, Dot, Empty, ErrorLine, Field, Icon, IconButton, Input, Row, Rows, Section, Select, Textarea, TextButton, toneText, useTone } from "./ui";

export function OverviewTab() {
  const { page } = useEntity();
  // Desktop: Details and About on the left, Mail and To do on the right. Phones: Details, Mail, To do, About.
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[auto_1fr]">
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">{page.editing ? <EditForm /> : <Details />}</div>
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
        <Row label="EIN">
          {asset.ein ? (
            <span className="inline-flex items-center gap-1">
              <span className="font-mono tabular-nums tracking-[0.02em]">{asset.ein}</span>
              <IconButton
                icon={page.copiedEin ? "check" : "copy"}
                label={page.copiedEin ? "Copied" : "Copy EIN"}
                onClick={page.handleCopyEin}
                className="-my-1.5 max-sm:-my-3"
              />
            </span>
          ) : undefined}
        </Row>

        {view.isTrust ? (
          <>
            <Row label="Trustees">{val(asset.trustees)}</Row>
            <Row label="Grantors">{val(asset.grantors)}</Row>
            <Row label="Beneficiaries">{val(asset.beneficiaries)}</Row>
            <Row label="Trust date">{formed ? <span className="tabular-nums">{formed}</span> : undefined}</Row>
            <Row label="Governing law">{val(asset.state)}</Row>
            <Row label="Tax classification">{val(asset.llcType)}</Row>
            <Row label="Trust agreement">{filedFact(asset, "trustAgreement", asset.formationDate)}</Row>
            <Row label="Mailing address">{val(asset.address)}</Row>
          </>
        ) : (
          <>
            <AgentRow />
            <Row label="Principal address">{val(asset.address)}</Row>
            <Row label="Formation date">{formed ? <span className="tabular-nums">{formed}</span> : undefined}</Row>
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
              ) : undefined}
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

/** A filing's date, and whether the document itself is on file. Nothing when neither is known. */
function filedFact(asset: Asset, kind: FileKind, date?: string): ReactNode {
  const file = asset[kind];
  const when = fmtDate(date);
  if (!file && !when) return undefined;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {when ? <span className="tabular-nums">{when}</span> : <span className="text-gray-500">Date not on record</span>}
      {file ? (
        <a href={file.url} target="_blank" rel="noopener noreferrer" className={`${linkClass} font-normal`}>
          <Dot tone="good">On file</Dot>
        </a>
      ) : (
        <Dot tone="warn">No document</Dot>
      )}
    </span>
  );
}

/** Registered agent: Palm when Palm serves (live), and a prompt to confirm the agent once Palm has stopped. */
function AgentRow() {
  const { asset, tabPath } = useEntity();
  const t = useTone();
  const ra = asset.palm?.live?.ra;
  const source = asset.registeredAgentSource ?? "";
  // "Palm, active since …" — not "Palm stopped serving …", which also starts with "Palm".
  const palmActive = ra?.status === "active" || /^Palm, active/.test(source);
  const palmStopped = !palmActive && source.startsWith("Palm stopped");
  const listedAs = ra?.name || asset.registeredAgent;

  return (
    <Row label="Registered agent" info={val(source)} actions={<TextLink to={tabPath("compliance")}>Manage</TextLink>}>
      {palmActive ? (
        <span>
          Palm
          {listedAs && <span className={t.muted}> · listed as {listedAs}</span>}
        </span>
      ) : palmStopped ? (
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          {val(asset.registeredAgent) ?? <span className={t.faint}>—</span>}
          <Dot tone="warn">Confirm</Dot>
        </span>
      ) : (
        val(asset.registeredAgent)
      )}
    </Row>
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
  if (!asset.llcType && !c) return <Row label={label} />;

  const src = asset.llcTypeSource;
  const home = view.homeReturn;
  const homeLine = home ? `Reported on ${home.form === "return" ? `${home.name}'s return` : `${home.name}'s ${home.form}`}.` : null;
  let status: ReactNode = null;
  let hint: string | null = null;
  let action: ReactNode = null;
  if (!c) {
    if (src && src !== BY_HAND) {
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
        status = <Dot tone="warn">Unconfirmed</Dot>;
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
  const info =
    homeLine || hint ? (
      <>
        {homeLine && <p>{homeLine}</p>}
        {hint && <p className="break-words">{hint}</p>}
      </>
    ) : undefined;

  return (
    <>
      <Row label={label} info={info} actions={action ?? undefined}>
        {asset.llcType ? (
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            {asset.llcType}
            {status}
          </span>
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
  const text = (k: "name" | "state" | "ein" | "registeredAgent" | "address" | "trustees" | "grantors" | "beneficiaries" | "fileNumber" | "stateLink") => ({
    value: form[k] || "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value),
  });
  const date = (k: "formationDate" | "operatingAgreementDate" | "articlesOfOrgDate") => ({
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
          <div className={`grid grid-cols-4 gap-1 rounded-lg border p-1 ${t.dark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-gray-50"}`}>
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
        <Field label="EIN">
          <Input {...text("ein")} className="font-mono tabular-nums" />
        </Field>
        {!trust && (
          <Field label="Registered agent">
            <Input {...text("registeredAgent")} />
          </Field>
        )}
        <Field label={trust ? "Mailing address" : "Principal address"}>
          <Input {...text("address")} />
        </Field>
        <Field label={trust ? "Trust date" : "Formation date"}>
          <Input {...date("formationDate")} />
        </Field>
        <Field label="Entity classification">
          <Select value={form.llcType || ""} onChange={(e) => set("llcType", e.target.value)}>
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

  const info = p
    ? `Read ${fmtStamp(p.checkedAt)} from ${p.sources.length ? p.sources.join(", ") : "the documents on file"}.`
    : "Reads the operating agreement (or bylaws / trust agreement) and fills in what the entity is for, what it owns, who runs and owns it, and how it's taxed.";

  return (
    <Section
      title="About"
      info={info}
      actions={
        <TextButton onClick={() => void page.buildProfile()} disabled={page.profiling}>
          <Icon name="sparkle" className="h-3 w-3" />
          {page.profiling ? "Reading…" : p ? "Re-read" : "Read documents"}
        </TextButton>
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
      ) : (
        <Empty
          action={
            <Button icon="upload" onClick={() => goToTab("documents")}>
              Add documents
            </Button>
          }
        >
          Nothing read yet.
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
  const { page, view, goToTab } = useEntity();
  const t = useTone();
  const { missing, checklist, score } = view;
  const done = checklist.filter((i) => i.done);

  function open(item: (typeof missing)[number]) {
    if (item.filing) goToTab("documents", `filing-${item.key}`, "center");
    else if (!page.editing) page.startEditing();
    else document.getElementById("entity-edit")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <Section title="To do" count={missing.length} actions={<span className={`text-[12px] tabular-nums ${t.muted}`}>{score}/100</span>}>
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
              <span className={`shrink-0 text-[11.5px] tabular-nums ${t.muted}`}>+{item.weight}</span>
              <Icon name="chevronRight" className={`h-3 w-3 ${t.faint}`} />
            </button>
          ))
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
