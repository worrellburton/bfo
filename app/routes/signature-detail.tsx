import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { isAdmin } from "../auth";
import { InviteDialog } from "../entity/people";
import {
  blankTab,
  capacity,
  deviceWords,
  entityNamesFor,
  FIELD_LABEL,
  isGameMode,
  isOpen,
  looksLikeEntity,
  MODE_LABEL,
  MODES,
  newField,
  OFFICE_ZONE,
  shortSha,
  signApi,
  stamp,
  when,
  whenShort,
  type FieldType,
  type Party,
  type PartyKey,
  type RelatedRequest,
  type SignatureRequest,
  type SignEvent,
  type SignField,
  type SignMode,
} from "../sign/api";
import { ArchiveDialog, confirmDeleteDraft, confirmSendCopy, Fact, PartyStatusText, requestDetail, StatusChip, VoidDialog } from "../sign/parts";
import { PdfPages, useFitWidth } from "../sign/pdf-pages";
import { usePoll } from "../sign/use-poll";
import {
  Banner,
  Button,
  Card,
  CardSection,
  Checkbox,
  ChoiceTiles,
  Dialog,
  Disclosure,
  ErrorPage,
  Field,
  Icon,
  Input,
  Menu,
  Page,
  PageHeader,
  Textarea,
  TextLink,
  confirm,
  cx,
  format,
  toast,
  usePhone,
  useDocumentTitle,
  type MenuItem,
} from "../ui";

export function meta() {
  return [{ title: "Signature request · Signatures · BFO" }];
}

/** Each signer party's identity colour (§2.4: chart-1, then chart-2), never a status hue. */
const PARTY_COLOUR: Record<PartyKey, string> = { a: "var(--color-chart-1)", b: "var(--color-chart-2)" };
const PARTY_NUMBER: Record<PartyKey, string> = { a: "1", b: "2" };

/** Why a draft can't go out yet, said where it's fixed; null when it can. Mirrors the server's sendBlocker. */
function partyProblem(p: Party, fields: SignField[]): string | null {
  if (!p.name.trim()) return p.entity ? `Name the person who signs for ${p.entity}.` : "Needs a name.";
  if (!p.entity && looksLikeEntity(p.name)) return `${p.name} is a company. Name the person who signs for it, and their title.`;
  if (p.entity && !p.title?.trim()) return `Add their title at ${p.entity}.`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim())) return "Needs an email address.";
  if (!fields.some((f) => f.party === p.key && f.type === "signature")) return "Place a signature field on the document.";
  return null;
}

/**
 * One signature request: the document with its fields drawn over it (drag to
 * move, corner to resize, while it's still a draft), the parties, the record
 * (fingerprints, where the signed copy is filed, other versions) and the
 * history. A sent request is never deleted: it is voided while open, and
 * archived once closed (owners and admins). Times are Arizona time, as on
 * the certificate.
 */
export default function SignatureDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const phone = usePhone();
  const admin = isAdmin();
  const [req, setReq] = useState<SignatureRequest | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [placing, setPlacing] = useState<{ party: PartyKey; type: FieldType } | null>(null);
  const [frameRef, width] = useFitWidth(880);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docRef = useRef<HTMLElement | null>(null);
  // A party being invited to BFO as a user of the request's entity (app/entity/people.tsx).
  const [inviting, setInviting] = useState<Party | null>(null);
  const [entityName, setEntityName] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Partial<Record<PartyKey, string>>>({});
  const [people, setPeople] = useState<Record<string, string>>({});
  const [related, setRelated] = useState<RelatedRequest[]>([]);
  /** The server's word on whether this draft may go out as the game: only TallulahMD LLC's (lib/game-entity). */
  const [gameOk, setGameOk] = useState(false);
  const [gameEntity, setGameEntity] = useState(false);
  const [resending, setResending] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [archiving, setArchiving] = useState(false);
  useDocumentTitle(req?.title ?? "Signature request", "Signatures");

  const shownKey = useRef<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await signApi.get(id, shownKey.current);
      setReq(r.request);
      setGameOk(!!r.gameAllowed);
      setGameEntity(!!r.gameEntity);
      // A server that doesn't name the entity yet: read the name from the tree.
      setEntityName(r.entityName !== undefined ? r.entityName : r.request.asset_id ? ((await entityNamesFor([r.request.asset_id]))[r.request.asset_id] ?? null) : null);
      setAccounts(r.accounts ?? {});
      setPeople(r.people ?? {});
      setRelated(r.related ?? []);
      // Only a new version replaces the pages on screen (each signature stamps a new one).
      if (r.pdfUrl) {
        setPdfUrl(r.pdfUrl);
        shownKey.current = r.pdfKey;
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn’t open this request.");
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  // While it's out for signature, signatures show up here as they land.
  usePoll(load, 8000, isOpen(req?.status));

  // Escape stops placing a field.
  useEffect(() => {
    if (!placing) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setPlacing(null);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [placing]);

  const editable = req?.status === "draft";
  const parties = useMemo<Party[]>(() => {
    const got = req?.parties ?? [];
    return (["a", "b"] as PartyKey[]).map((key, i) => got.find((p) => p.key === key) ?? { key, role: i === 0 ? "Party A" : "Party B", name: "", email: "", status: "pending" });
  }, [req]);
  const fields = req?.fields ?? [];
  const nameOf = (k?: PartyKey) => {
    const p = parties.find((x) => x.key === k);
    return p ? p.name || p.entity || p.role : "";
  };
  const blocker = editable ? (!req?.original_path ? "Add the document first." : (parties.map((p) => partyProblem(p, fields)).find(Boolean) ?? null)) : null;

  /** Saves fields and parties a moment after the last change. */
  function queueSave(next: SignatureRequest) {
    setReq(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      signApi
        .act("update", { id: next.id, title: next.title, fields: next.fields, parties: next.parties, mode: next.mode ?? "normal" })
        .catch((err) => setError(err instanceof Error ? err.message : "Couldn’t save the change."));
    }, 500);
  }
  async function flush() {
    if (!saveTimer.current || !req) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    await signApi.act("update", { id: req.id, title: req.title, fields: req.fields, parties: req.parties, mode: req.mode ?? "normal" });
  }

  function setParty(key: PartyKey, patch: Partial<Party>) {
    if (!req) return;
    queueSave({ ...req, parties: parties.map((p) => (p.key === key ? { ...p, ...patch } : p)) });
  }
  function setFields(next: SignField[]) {
    if (!req) return;
    queueSave({ ...req, fields: next });
  }
  function addField(party: PartyKey, type: FieldType, page: number, at?: { x: number; y: number }) {
    if (!req) return;
    const f = newField(party, type, page, at);
    setFields([...req.fields, f]);
    setSelected(f.id);
  }
  function startPlacing(party: PartyKey, type: FieldType) {
    setPlacing({ party, type });
    // On a phone the document is above the parties: bring it into view.
    if (phone) docRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function run(action: "send" | "remind" | "send-copy" | "delete" | "download" | "file" | "unarchive", extra: Record<string, unknown> = {}) {
    if (!req) return;
    // The tab opens inside the click, before the save and the link are awaited.
    const tab = action === "download" ? blankTab() : null;
    setError("");
    try {
      await flush();
      if (tab) {
        tab.go(await signApi.download(req.id));
        return;
      }
      if (action === "delete") {
        if (!(await confirmDeleteDraft(req))) return;
        setBusy(action);
        await signApi.remove(req.id);
        toast({ message: "Deleted the draft" });
        navigate("/tools/signatures");
        return;
      }
      if (action === "send") {
        const ok = await confirm({
          title: "Send for signature?",
          object: { name: req.title, detail: `${format.count(req.pages.length, "page")}${req.original_sha256 ? ` · document ID ${shortSha(req.original_sha256)}` : ""}` },
          details: [
            ...parties.map((p) => `${capacity(p)} · ${p.email}`),
            isGameMode(req.mode) ? `${MODE_LABEL[req.mode ?? "normal"]} first on a computer; a phone signs straight away` : "Normal e-signature",
          ],
          message: "Each party gets a private link by email. It works for 60 days; a reminder sends a fresh one. Once sent, the document, the parties and the fields can’t change.",
          confirmLabel: "Send for signature",
          tone: "commit",
        });
        if (ok === false) return;
      }
      if (action === "send-copy" && !(await confirmSendCopy(req))) return;
      setBusy(action);
      const next = await signApi.act(action, { id: req.id, ...extra });
      setReq(next);
      toast({
        message:
          action === "send"
            ? `Sent to ${format.list(next.parties.map((p) => p.name || p.role))}`
            : action === "remind"
              ? `Reminded ${format.list(next.parties.filter((p) => p.status !== "signed" && p.status !== "declined" && (!extra.party || p.key === extra.party)).map((p) => p.name || p.role))}${extra.plain ? " as a normal request" : ""}`
              : action === "send-copy"
                ? `Emailed the signed copy to ${format.list(next.parties.map((p) => p.name || p.role))}`
                : action === "file"
                  ? `Filed the signed copy with ${entityName ?? "the entity"}`
                  : "Restored to the list",
      });
    } catch (err) {
      tab?.close();
      setError(err instanceof Error ? err.message : "That didn’t work. Try again.");
    } finally {
      setBusy("");
    }
  }

  if (loadError && !req) return <ErrorPage kind="not-found" detail={loadError} home="/tools/signatures" />;

  const r = req;
  const open = isOpen(r?.status);
  const completed = r?.status === "completed";
  const supersededBy =
    r && open ? related.filter((v) => v.status === "completed" && v.created_at > r.created_at).sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))[0] : undefined;

  const menu: MenuItem[] = !r
    ? []
    : [
        ...(r.original_path ? [{ label: completed ? "Download signed copy" : "Download", onSelect: () => run("download") }] : []),
        ...(completed && r.copy_sent_at ? [{ label: "Email signed copy again", onSelect: () => run("send-copy") }] : []),
        ...(completed && r.asset_id && !r.filed_path ? [{ label: `File with ${entityName ?? "the entity"}`, onSelect: () => run("file") }] : []),
        ...(open && isGameMode(r.mode) ? [{ label: "Remind as a normal request", hint: "Nothing about the game in the email", onSelect: () => run("remind", { plain: true }) }] : []),
        ...(r.status !== "draft" && r.original_path && !r.archived_at
          ? [{ label: completed ? "Send a new version for signature…" : "Send again as a new request…", onSelect: () => setResending(true) }]
          : []),
        ...(open ? [{ divider: true } as const, { label: "Void…", danger: true, onSelect: () => setVoiding(true) }] : []),
        ...(!r.archived_at && (completed || r.status === "declined" || r.status === "voided")
          ? [{ divider: true } as const, { label: "Archive…", onSelect: () => setArchiving(true), disabled: !admin, disabledReason: "Owners and admins" }]
          : []),
        ...(r.archived_at ? [{ label: "Restore to the list", onSelect: () => run("unarchive"), disabled: !admin, disabledReason: "Owners and admins" }] : []),
        ...(r.status === "draft" && !r.sent_at ? [{ divider: true } as const, { label: "Delete draft…", danger: true, onSelect: () => run("delete") }] : []),
      ];

  const primary = !r ? null : editable ? (
    <Button variant="primary" disabled={!!blocker || !!busy} disabledReason={blocker ?? undefined} busy={busy === "send"} busyLabel="Sending…" onClick={() => run("send")}>
      Send for signature
    </Button>
  ) : open ? (
    <Button variant="primary" busy={busy === "remind"} busyLabel="Reminding…" onClick={() => run("remind")}>
      Remind
    </Button>
  ) : completed ? (
    <Button variant="primary" icon="download" onClick={() => run("download")}>
      Download signed copy
    </Button>
  ) : null;
  const secondary =
    r && completed && !r.copy_sent_at ? (
      <Button busy={busy === "send-copy"} busyLabel="Sending…" onClick={() => run("send-copy")}>
        Email signed copy
      </Button>
    ) : undefined;

  const context = r ? (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <StatusChip status={r.status} />
      {isGameMode(r.mode) && <span>{MODE_LABEL[r.mode ?? "normal"]}</span>}
      {r.completed_at ? <span>Completed {when(r.completed_at)}</span> : r.sent_at ? <span>Sent {when(r.sent_at)}</span> : <span>Created {when(r.created_at)}</span>}
      {completed && <span>{r.copy_sent_at ? `Copy sent ${whenShort(r.copy_sent_at)}` : "Copy not sent yet"}</span>}
      {r.pages.length > 0 && <span>{format.count(r.pages.length, "page")}</span>}
      {entityName && r.asset_id && (
        <Link to={`/assets/${r.asset_id}/agreements`} className="text-accent hover:underline">
          {entityName}
        </Link>
      )}
    </span>
  ) : undefined;

  const placingParty = placing ? parties.find((p) => p.key === placing.party) : null;
  const placingBar = placing && placingParty && (
    <div
      data-floating
      className={cx(
        "ds z-sticky flex items-center gap-3 border-line bg-raised px-4 py-3",
        phone ? "fixed inset-x-0 bottom-0 border-t" : "sticky top-0 -mx-4 -mt-4 mb-4 rounded-t-card border-b sm:-mx-6 sm:-mt-6",
      )}
      style={phone ? { paddingBottom: "max(12px, env(safe-area-inset-bottom))" } : undefined}
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: PARTY_COLOUR[placingParty.key] }} />
      <p className="min-w-0 flex-1 text-body">
        Choose where {placingParty.name || placingParty.entity || placingParty.role}’s {FIELD_LABEL[placing.type].toLowerCase()} goes on the document.
      </p>
      <Button variant="quiet" size="sm" onClick={() => setPlacing(null)}>
        Cancel
      </Button>
    </div>
  );

  return (
    <Page
      width="workspace"
      header={
        <PageHeader
          title={r?.title ?? "Signature request"}
          back={{ to: "/tools/signatures", label: "Signatures" }}
          context={context}
          primary={primary ?? undefined}
          secondary={secondary}
          menu={menu.length ? menu : undefined}
        />
      }
    >
      {blocker && <p className="-mt-4 text-small text-ink-2">{blocker}</p>}
      {error && (
        <Banner tone="negative" onDismiss={() => setError("")}>
          {error}
        </Banner>
      )}
      {r?.archived_at && (
        <Banner tone="info" title="Archived.">
          {`${r.archived_by_name ?? "Someone"} archived it on ${when(r.archived_at)}${r.archived_reason ? `: ${r.archived_reason}` : ""}. It’s kept whole and out of the list.`}
        </Banner>
      )}
      {supersededBy && (
        <Banner
          tone="warning"
          title="A later version was signed."
          action={
            <Button variant="quiet" size="sm" onClick={() => setVoiding(true)}>
              Void this one
            </Button>
          }
        >
          {`Another request for this document was signed by everyone on ${when(supersededBy.completed_at)}, and this one is still open. Void it so a second copy can’t be signed.`}
        </Banner>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* The document */}
        <section
          ref={(el) => ((docRef.current = el), frameRef(el as HTMLDivElement | null))}
          aria-label="The document"
          className="order-2 min-w-0 scroll-mt-4 rounded-card bg-sunken p-4 sm:p-6 lg:order-1"
        >
          {!phone && placingBar}
          {width > 0 && (
            <PdfPages
              src={pdfUrl}
              pages={r?.pages}
              width={width - 4}
              overlay={(page, size) => (
                <div
                  className={cx("absolute inset-0", placing && "cursor-crosshair")}
                  onClick={(e) => {
                    if (!placing) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    addField(placing.party, placing.type, page, { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height });
                    setPlacing(null);
                  }}
                >
                  {fields
                    .filter((f) => f.page === page)
                    .map((f) => (
                      <FieldBox
                        key={f.id}
                        field={f}
                        size={size}
                        colour={PARTY_COLOUR[f.party]}
                        label={`${(nameOf(f.party).split(" ")[0] || PARTY_NUMBER[f.party]).slice(0, 18)} · ${FIELD_LABEL[f.type]}`}
                        editable={!!editable}
                        selected={selected === f.id}
                        onSelect={() => setSelected(f.id)}
                        onChange={(nf) => setFields(fields.map((x) => (x.id === nf.id ? nf : x)))}
                        onRemove={() => setFields(fields.filter((x) => x.id !== f.id))}
                      />
                    ))}
                </div>
              )}
            />
          )}
        </section>

        {/* Status and parties first on a phone; beside the document on a computer. */}
        <aside className="order-1 flex flex-col gap-4 lg:order-2">
          {r && editable && (
            <Card title="Request">
              <div className="flex flex-col gap-4">
                <Field label="Title" hint="As the parties see it in their email and on the certificate.">
                  <Input value={r.title} onChange={(e) => queueSave({ ...r, title: e.target.value })} />
                </Field>
                {(gameOk || isGameMode(r.mode)) && (
                  <ChoiceTiles<SignMode>
                    label="How they sign"
                    stacked
                    value={r.mode ?? "normal"}
                    onChange={(mode) => queueSave({ ...r, mode })}
                    options={MODES.map((m) => ({ value: m.mode, title: m.label, description: m.blurb }))}
                  />
                )}
                <p className="text-small text-ink-2">
                  {r.source === "contract" ? "From an MSA" : "Uploaded"} · created {when(r.created_at)}
                  {r.original_sha256 ? ` · document ID ${shortSha(r.original_sha256)}` : ""}
                </p>
              </div>
            </Card>
          )}

          {parties.map((p) => (
            <PartyCard
              key={p.key}
              party={p}
              request={r}
              editable={!!editable}
              fields={fields.filter((f) => f.party === p.key)}
              account={accounts[p.key]}
              entityName={entityName}
              busy={busy}
              onChange={(patch) => setParty(p.key, patch)}
              onPlace={(type) => startPlacing(p.key, type)}
              placing={placing?.party === p.key ? placing.type : null}
              onRemind={() => run("remind", { party: p.key })}
              onInvite={() => setInviting(p)}
            />
          ))}

          {r && !editable && <RecordCard request={r} entityName={entityName} related={related} filing={busy === "file"} onFile={() => run("file")} />}
          {r && r.events.length > 0 && <HistoryCard events={r.events} parties={parties} people={people} />}
        </aside>
      </div>

      {phone && placingBar}

      {r && resending && (
        <ResendDialog
          request={r}
          gameEntity={gameEntity}
          onClose={() => setResending(false)}
          onSend={async (body) => {
            const next = await signApi.act("resend", { id: r.id, ...body });
            setResending(false);
            toast({ message: `Sent the new request to ${format.list(next.parties.map((p) => p.name || p.role))}` });
            navigate(`/tools/signatures/${next.id}`);
          }}
        />
      )}
      {r && voiding && (
        <VoidDialog
          request={r}
          open
          onClose={() => setVoiding(false)}
          onVoid={async (reason, notify) => {
            setReq(await signApi.act("void", { id: r.id, reason, notify }));
            setVoiding(false);
            toast({ message: notify ? "Voided, and the parties were told" : "Voided. Its links stop working" });
          }}
        />
      )}
      {r && archiving && (
        <ArchiveDialog
          request={r}
          open
          onClose={() => setArchiving(false)}
          onArchive={async (reason) => {
            setReq(await signApi.act("archive", { id: r.id, reason }));
            setArchiving(false);
            toast({ message: `Archived ${r.title}`, action: { label: "Undo", run: () => void run("unarchive") } });
          }}
        />
      )}
      {inviting && r?.asset_id && (
        <InviteDialog
          entity={entityName ?? r.title}
          memberName={inviting.entity || inviting.name || inviting.role}
          assetId={r.asset_id}
          initial={{ name: inviting.name, email: inviting.email }}
          onClose={() => setInviting(null)}
          onDone={() => {
            setInviting(null);
            void load();
          }}
        />
      )}
    </Page>
  );
}

/** One party: who signs (and for whom), their email, their fields while a draft; their status, evidence and actions once sent. */
function PartyCard({
  party: p,
  request: r,
  editable,
  fields,
  account,
  entityName,
  busy,
  placing,
  onChange,
  onPlace,
  onRemind,
  onInvite,
}: {
  party: Party;
  request: SignatureRequest | null;
  editable: boolean;
  fields: SignField[];
  account?: string;
  entityName: string | null;
  busy: string;
  placing: FieldType | null;
  onChange: (patch: Partial<Party>) => void;
  onPlace: (type: FieldType) => void;
  onRemind: () => void;
  onInvite: () => void;
}) {
  const [company, setCompany] = useState(!!p.entity);
  const problem = editable ? partyProblem(p, r?.fields ?? []) : null;
  const title = (
    <span className="flex items-center gap-2">
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: PARTY_COLOUR[p.key] }} />
      <span>{p.key === "a" ? "First party" : "Second party"}</span>
    </span>
  );

  if (editable) {
    return (
      <Card title={title}>
        <div className="flex flex-col gap-4">
          <Field label="Role" hint="As it reads on the certificate: Member, Manager, Client.">
            <Input value={p.role} onChange={(e) => onChange({ role: e.target.value })} />
          </Field>
          <Checkbox
            checked={company}
            onChange={(v) => {
              setCompany(v);
              if (!v) onChange({ entity: undefined, title: undefined });
            }}
            label="Signs for a company or trust"
          />
          {company && (
            <Field label="Company or trust">
              <Input value={p.entity ?? ""} onChange={(e) => onChange({ entity: e.target.value })} placeholder="Northwind Holdings, LLC" />
            </Field>
          )}
          <Field label={company ? "Person who signs for it" : "Name"}>
            <Input value={p.name} onChange={(e) => onChange({ name: e.target.value })} autoComplete="off" />
          </Field>
          {company && (
            <Field label="Their title">
              <Input value={p.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} placeholder="Manager" />
            </Field>
          )}
          <Field label="Email" hint="Their own address: the link signs as them.">
            <Input type="email" value={p.email} onChange={(e) => onChange({ email: e.target.value })} autoComplete="off" />
          </Field>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-small font-medium">Fields</span>
              <Menu
                label={`Add a field for ${p.name || p.role}`}
                align="end"
                items={(["signature", "initials", "name", "date", "address"] as FieldType[]).map((type) => ({
                  label: FIELD_LABEL[type],
                  onSelect: () => onPlace(type),
                  checked: placing === type ? true : undefined,
                }))}
                trigger={
                  <Button size="sm" icon="plus" aria-pressed={!!placing}>
                    Add field
                  </Button>
                }
              />
            </div>
            <p className="text-small text-ink-2">
              {fields.length === 0
                ? "No fields yet. Add a signature, then choose where it goes on the document."
                : format.list(fields.map((f) => `${FIELD_LABEL[f.type].toLowerCase()} on page ${f.page}`))}
              {fields.some((f) => f.type === "date") ? ". The date is stamped in the signer’s own time zone." : ""}
            </p>
          </div>
          {problem && (
            <p className="flex items-start gap-[6px] text-small text-ink">
              <span className="mt-px text-warning">
                <Icon name="warning" size={16} />
              </span>
              <span>{problem}</span>
            </p>
          )}
        </div>
      </Card>
    );
  }

  const evidence = p.signedAt || p.declinedAt || p.viewedAt || p.consent;
  return (
    <Card title={title} action={<PartyStatusText status={p.status} />}>
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-body font-medium break-words">{p.entity ?? (p.name || p.role)}</p>
          {p.entity && (
            <p className="text-small text-ink-2">
              by {p.name || "someone not named"}
              {p.title ? `, ${p.title}` : ""}
            </p>
          )}
          <p className="text-small text-ink-2">{p.role}</p>
          <p className="text-small break-all text-ink-2">{p.email}</p>
        </div>
        {p.signedAt && <p className="text-small">Signed {stamp(p.signedAt)}</p>}
        {p.signedAs && p.signedAs !== p.name && <p className="text-small text-ink-2">Typed their name as “{p.signedAs}”</p>}
        {p.declinedAt && (
          <p className="text-small">
            Declined {stamp(p.declinedAt)}
            {p.declinedReason ? `: “${p.declinedReason}”` : ""}
          </p>
        )}
        {evidence && (
          <Disclosure label="Signature evidence">
            <dl className="mt-2 flex flex-col gap-2">
              {p.consent && (
                <Fact label="Agreed to electronic records and signatures">
                  {stamp(p.consent.at)}
                  {p.consent.ip ? ` from ${p.consent.ip}` : ""} · disclosure of {p.consent.version}
                </Fact>
              )}
              {p.signedAt && (
                <Fact label="Signed">
                  {stamp(p.signedAt)}
                  {p.ip ? ` from ${p.ip}` : ""}
                  {p.device ? ` · ${deviceWords(p.device)}` : ""}
                </Fact>
              )}
              {p.method && (
                <Fact label="Signature">
                  {p.method === "typed" ? "Typed" : "Drawn"}
                  {r && isGameMode(r.mode) ? (p.via === "game" ? `, after the ${MODE_LABEL[r.mode ?? "normal"]}` : ", the game skipped") : ""}
                </Fact>
              )}
              {p.timeZone && <Fact label="Date stamped in">{p.timeZone.replace(/_/g, " ")}</Fact>}
              {p.viewedAt && (
                <Fact label="First opened">
                  {stamp(p.viewedAt)}
                  {p.viewIp ? ` from ${p.viewIp}` : ""}
                  {p.viewDevice ? ` · ${deviceWords(p.viewDevice)}` : ""}
                </Fact>
              )}
              {p.declinedAt && (
                <Fact label="Declined">
                  {stamp(p.declinedAt)}
                  {p.declineIp ? ` from ${p.declineIp}` : ""}
                  {p.declineDevice ? ` · ${deviceWords(p.declineDevice)}` : ""}
                </Fact>
              )}
              {p.address && <Fact label="Address they gave">{p.address}</Fact>}
              {p.expiresAt && p.status !== "signed" && <Fact label="Link works until">{when(p.expiresAt)}</Fact>}
            </dl>
          </Disclosure>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {r && isOpen(r.status) && p.status !== "signed" && p.status !== "declined" && (
            <Button size="sm" disabled={!!busy} onClick={onRemind}>
              Remind {(p.name || p.role).split(" ")[0]}
            </Button>
          )}
          {r?.asset_id &&
            isAdmin() &&
            p.email &&
            (account ? (
              <p className="text-small text-ink-2">Has a BFO account ({account}).</p>
            ) : (
              <Button size="sm" variant="quiet" className="-ml-3" disabled={!!busy} onClick={onInvite}>
                Give access to {entityName ?? "the entity"}…
              </Button>
            ))}
        </div>
      </div>
    </Card>
  );
}

/** What the record holds: fingerprints, where the signed copy is filed, the request it replaced or was replaced by, other versions. */
function RecordCard({ request: r, entityName, related, onFile, filing }: { request: SignatureRequest; entityName: string | null; related: RelatedRequest[]; onFile: () => void; filing: boolean }) {
  return (
    <Card title="Record" staffOnly>
      <dl className="flex flex-col gap-3">
        <Fact label="How they sign">{MODE_LABEL[r.mode ?? "normal"]}</Fact>
        {r.original_sha256 && (
          <Fact label="Original SHA-256">
            <span className="tabular-nums" title={r.original_sha256}>
              {r.original_sha256}
            </span>
          </Fact>
        )}
        {r.signed_sha256 && (
          <Fact label="Signed copy SHA-256">
            <span className="tabular-nums" title={r.signed_sha256}>
              {r.signed_sha256}
            </span>
          </Fact>
        )}
        {r.status === "completed" && r.asset_id && (
          <Fact label="Filed">
            {r.filed_path ? (
              <TextLink to={`/assets/${r.asset_id}/documents`} inline>
                {`In ${entityName ?? "the entity"} › Documents`}
              </TextLink>
            ) : (
              <span className="flex flex-col items-start gap-2">
                <span>Not with {entityName ?? "the entity"}’s documents yet.</span>
                <Button size="sm" busy={filing} busyLabel="Filing…" onClick={onFile}>
                  File the signed copy
                </Button>
              </span>
            )}
          </Fact>
        )}
        {r.replaces && (
          <Fact label="Replaces">
            <TextLink to={`/tools/signatures/${r.replaces}`} inline>
              The earlier request
            </TextLink>
          </Fact>
        )}
        {r.replaced_by && (
          <Fact label="Replaced by">
            <TextLink to={`/tools/signatures/${r.replaced_by}`} inline>
              A newer request
            </TextLink>
          </Fact>
        )}
      </dl>
      {related.length > 0 && (
        <CardSection title="Other versions of this document">
          <ul className="flex flex-col gap-1 text-small">
            {related.map((v) => (
              <li key={v.id}>
                <TextLink to={`/tools/signatures/${v.id}`}>
                  {`${requestDetail({ ...r, ...v, sent_at: v.sent_at, completed_at: v.completed_at, created_at: v.created_at, status: v.status })}${v.archived ? " · archived" : ""}`}
                </TextLink>
              </li>
            ))}
          </ul>
        </CardSection>
      )}
      <p className="mt-3 text-caption text-ink-2">Times are Arizona time ({OFFICE_ZONE.replace("_", " ")}), as on the certificate.</p>
    </Card>
  );
}

const KIND: Record<string, string> = {
  created: "Created",
  attached: "Document added",
  sent: "Sent for signature",
  emailed: "Emailed the link",
  reminded: "Reminded",
  viewed: "Opened",
  consented: "Agreed to electronic records and signatures",
  signed: "Signed",
  declined: "Declined",
  completed: "Signed by everyone",
  copy_sent: "Signed copy emailed",
  filed: "Filed with the entity",
  resent: "Sent again as a new request",
  voided: "Voided",
  withdrawn_sent: "Told it was withdrawn",
  archived: "Archived",
  unarchived: "Restored from the archive",
};

/** The history, newest first: what happened, who did it, when (with the zone), and from where for a signer's steps. */
function HistoryCard({ events, parties, people }: { events: SignEvent[]; parties: Party[]; people: Record<string, string> }) {
  const shown = [...events].reverse();
  const first = shown.slice(0, 12);
  const rest = shown.slice(12);
  const item = (e: SignEvent, i: number) => {
    const party = e.party ? parties.find((p) => p.key === e.party) : null;
    const who = party ? party.name || party.entity || party.role : e.byName || (e.by ? people[e.by] : undefined);
    return (
      <li key={i} className="flex flex-col">
        <span className="text-small text-ink">
          {KIND[e.kind] ?? e.kind}
          {who ? ` · ${who}` : ""}
          {e.note ? ` · ${e.note}` : ""}
        </span>
        <span className="text-caption text-ink-2 tabular-nums">
          {stamp(e.at)}
          {e.ip ? ` · from ${e.ip}` : ""}
          {e.device ? ` · ${deviceWords(e.device)}` : ""}
        </span>
      </li>
    );
  };
  return (
    <Card title="History" count={events.length}>
      <ul className="flex flex-col gap-3">{first.map(item)}</ul>
      {rest.length > 0 && (
        <Disclosure label="Earlier" count={rest.length} className="mt-3">
          <ul className="mt-2 flex flex-col gap-3">{rest.map((e, i) => item(e, i + 12))}</ul>
        </Disclosure>
      )}
    </Card>
  );
}

/** A field on the page: dragged by its body, resized by its corner, in its party's colour. */
function FieldBox({
  field,
  size,
  colour,
  label,
  editable,
  selected,
  onSelect,
  onChange,
  onRemove,
}: {
  field: SignField;
  size: { w: number; h: number };
  colour: string;
  label: string;
  editable: boolean;
  selected: boolean;
  onSelect: () => void;
  onChange: (f: SignField) => void;
  onRemove: () => void;
}) {
  const drag = useRef<{ kind: "move" | "resize"; sx: number; sy: number; f: SignField } | null>(null);

  function start(kind: "move" | "resize") {
    return (e: React.PointerEvent) => {
      if (!editable) return;
      e.stopPropagation();
      e.preventDefault();
      onSelect();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = { kind, sx: e.clientX, sy: e.clientY, f: field };
    };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / size.w;
    const dy = (e.clientY - d.sy) / size.h;
    if (d.kind === "move") onChange({ ...d.f, x: Math.min(1 - d.f.w, Math.max(0, d.f.x + dx)), y: Math.min(1 - d.f.h, Math.max(0, d.f.y + dy)) });
    else onChange({ ...d.f, w: Math.min(1 - d.f.x, Math.max(0.03, d.f.w + dx)), h: Math.min(1 - d.f.y, Math.max(0.012, d.f.h + dy)) });
  }
  function end() {
    drag.current = null;
  }

  return (
    <div
      role={editable ? "button" : undefined}
      tabIndex={editable ? 0 : -1}
      aria-label={label}
      onPointerDown={start("move")}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (!editable) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onRemove();
        }
      }}
      className={cx("absolute rounded-mark select-none", editable && "cursor-move touch-none")}
      style={{
        left: `${field.x * 100}%`,
        top: `${field.y * 100}%`,
        width: `${field.w * 100}%`,
        height: `${field.h * 100}%`,
        background: `color-mix(in srgb, ${colour} 16%, transparent)`,
        border: `${selected ? 2 : 1}px ${selected ? "solid" : "dashed"} ${colour}`,
      }}
    >
      <span className="absolute bottom-full left-0 mb-[2px] rounded-mark px-1 text-caption font-medium whitespace-nowrap text-ink-inverse" style={{ background: colour }}>
        {label}
      </span>
      {editable && selected && (
        <>
          {/* On a touch screen the remove button and the resize corner take a finger-sized hit area around what's drawn. */}
          <button
            type="button"
            aria-label={`Remove ${label}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="absolute -top-[10px] -right-[10px] flex size-[20px] cursor-pointer items-center justify-center touch:-top-[22px] touch:-right-[22px] touch:size-[44px]"
          >
            <span aria-hidden className="flex size-[20px] items-center justify-center rounded-full bg-ink text-ink-inverse">
              <svg viewBox="0 0 16 16" className="size-[12px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </span>
          </button>
          <span
            aria-hidden
            onPointerDown={start("resize")}
            className="absolute -right-[10px] -bottom-[10px] grid size-[20px] cursor-nwse-resize place-items-center touch:-right-[22px] touch:-bottom-[22px] touch:size-[44px]"
          >
            <span className="size-3 rounded-mark bg-paper" style={{ border: `2px solid ${colour}` }} />
          </span>
        </>
      )}
    </div>
  );
}

/**
 * Sending a request again as a new one: how they sign (the request's own mode
 * first), whether the email mentions the game, Address boxes for the parties
 * who should give one, and, for a signed agreement, why.
 */
function ResendDialog({
  request: r,
  gameEntity,
  onClose,
  onSend,
}: {
  request: SignatureRequest;
  gameEntity: boolean;
  onClose: () => void;
  onSend: (body: { mode: SignMode; plain: boolean; address: PartyKey[]; reason?: string }) => Promise<void>;
}) {
  // The plain page first: the record of an agreement should come from it unless someone chooses otherwise.
  const [mode, setMode] = useState<SignMode>("normal");
  const [mention, setMention] = useState(true);
  const [address, setAddress] = useState<PartyKey[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = isOpen(r.status);
  const completed = r.status === "completed";
  const signed = r.parties.filter((p) => p.status === "signed");
  const modes = MODES.filter((m) => m.mode === "normal" || gameEntity);
  const ready = !completed || !!reason.trim();
  return (
    <Dialog
      open
      onClose={() => !busy && onClose()}
      title={completed ? "Send a new version for signature?" : "Send a new request?"}
      description={`The same document, to ${format.list(r.parties.map((p) => capacity(p)))}.`}
      dirty={!!reason.trim()}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!ready}
            disabledReason={!ready ? "Say why it’s going out again" : undefined}
            busy={busy}
            busyLabel="Sending…"
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onSend({ mode, plain: mode !== "normal" && !mention, address, ...(reason.trim() ? { reason: reason.trim() } : {}) });
              } catch (err) {
                setError(err instanceof Error ? err.message : "That didn’t work. Try again.");
                setBusy(false);
              }
            }}
          >
            Send new request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-pretty">
        <ul className="flex flex-col gap-1 text-body text-ink-2">
          {pending && <li>This request is voided: its links stop working.</li>}
          {pending && signed.length > 0 && <li>{`${format.list(signed.map((p) => p.name))}’s signature on this one is cancelled; they sign again.`}</li>}
          {completed && <li>{`The copy signed ${when(r.completed_at)} stays on file and in force, unless the new one is meant to replace it. Both records link to each other.`}</li>}
          <li>{`${format.count(r.pages.length, "page")}${r.original_sha256 ? ` · document ID ${shortSha(r.original_sha256)}` : ""}`}</li>
        </ul>
        {modes.length > 1 && (
          <ChoiceTiles<SignMode> label="How they sign" stacked value={mode} onChange={setMode} options={modes.map((m) => ({ value: m.mode, title: m.label, description: m.blurb }))} />
        )}
        {mode !== "normal" && <Checkbox checked={mention} onChange={setMention} label="Mention the game in the email" hint="Off: the email reads as a normal request; the link still opens it." />}
        <div className="flex flex-col gap-1">
          <span className="text-small font-medium">Address boxes</span>
          {r.parties.map((p) => (
            <Checkbox
              key={p.key}
              checked={address.includes(p.key)}
              onChange={(v) => setAddress((a) => (v ? [...a, p.key] : a.filter((k) => k !== p.key)))}
              label={`Ask ${p.name || p.role} for an address under their signature`}
            />
          ))}
        </div>
        {completed && (
          <Field label="Why it’s going out again" hint="Kept with both requests.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </Field>
        )}
        {error && <p className="text-small text-negative">{error}</p>}
      </div>
    </Dialog>
  );
}
