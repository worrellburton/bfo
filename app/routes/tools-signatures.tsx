import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { isAdmin } from "../auth";
import { blankTab, isOpen, PARTY_LABEL, signApi, supersededBy, whenShort, type SignatureRequest } from "../sign/api";
import { ArchiveDialog, confirmDeleteDraft, confirmSendCopy, StatusChip, VoidDialog } from "../sign/parts";
import { usePoll } from "../sign/use-poll";
import {
  Banner,
  Button,
  Card,
  Empty,
  Icon,
  Menu,
  IconButton,
  Page,
  PageHeader,
  SearchField,
  Segmented,
  Select,
  Table,
  Toolbar,
  confirm,
  format,
  toast,
  useDocumentTitle,
  type Column,
  type MenuItem,
} from "../ui";

// The shared parts, kept where app/sign/contract-signature.tsx imports them from.
export { PartyDot, Small, StatusChip } from "../sign/parts";

export function meta() {
  return [{ title: "Signatures · BFO" }];
}

type Filter = "all" | "waiting" | "signed" | "draft" | "closed";
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "waiting", label: "Waiting" },
  { value: "signed", label: "Signed" },
  { value: "draft", label: "Drafts" },
  { value: "closed", label: "Closed" },
];
const inFilter = (r: SignatureRequest, f: Filter) =>
  f === "all" || (f === "waiting" ? isOpen(r.status) : f === "signed" ? r.status === "completed" : f === "draft" ? r.status === "draft" : r.status === "declined" || r.status === "voided");

/** Titles that suggest a document e-signature law doesn't cover, or that must be witnessed or notarized. */
const NEEDS_INK = /\b(will|codicil|testament|testamentary|power of attorney|poa|deed|affidavit|notari[sz]ed|acknowledg(e)?ment)\b/i;

/** The newest activity on a request: drafts sort by when they were last touched. */
const lastTouched = (r: SignatureRequest) => r.events.at(-1)?.at ?? r.created_at;

/**
 * Tools › Signatures: every document sent out for signature, as a register:
 * by entity, who has signed, and the signed copies. A sent or signed request
 * is never deleted here: it is archived (owners and admins), kept whole. A
 * PDF chosen from the header, or dropped anywhere on the page on a computer,
 * starts a new request; its page places the fields and sends it.
 */
export default function ToolsSignatures() {
  useDocumentTitle("Signatures");
  const navigate = useNavigate();
  const admin = isAdmin();
  const [rows, setRows] = useState<SignatureRequest[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [entity, setEntity] = useState<string>("any");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [voiding, setVoiding] = useState<SignatureRequest | null>(null);
  const [archiving, setArchiving] = useState<SignatureRequest | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const got = await signApi.list(archived);
      setRows(got.requests);
      setNames(got.entityNames);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t load the signature requests.");
      setRows((r) => r ?? []);
    }
  }, [archived]);
  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);
  // Statuses change as people sign; refresh while anything is still out.
  usePoll(
    load,
    15000,
    (rows ?? []).some((r) => isOpen(r.status)),
  );

  const entityName = (r: SignatureRequest) => (r.asset_id ? (names[r.asset_id] ?? "An entity") : null);

  const all = useMemo(() => rows ?? [], [rows]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, all.filter((r) => inFilter(r, f.value)).length])) as Record<Filter, number>, [all]);
  const entityOptions = useMemo(() => {
    const ids = [...new Set(all.map((r) => r.asset_id ?? ""))];
    return [
      { value: "any", label: "All entities" },
      ...ids
        .filter(Boolean)
        .map((id) => ({ value: id, label: names[id] ?? "An entity" }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      ...(ids.includes("") ? [{ value: "none", label: "No entity" }] : []),
    ];
  }, [all, names]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((r) => inFilter(r, filter))
      .filter((r) => entity === "any" || (entity === "none" ? !r.asset_id : r.asset_id === entity))
      .filter((r) => !q || r.title.toLowerCase().includes(q) || r.parties.some((p) => `${p.name} ${p.entity ?? ""}`.toLowerCase().includes(q)))
      .sort((a, b) => (a.status === "draft" && b.status === "draft" ? lastTouched(b).localeCompare(lastTouched(a)) : 0));
  }, [all, filter, entity, query]);

  async function startFrom(file: File) {
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      setError("Only PDFs can be sent for signature.");
      return;
    }
    const title =
      file.name
        .replace(/\.pdf$/i, "")
        .replace(/[_-]+/g, " ")
        .trim() || "Document";
    if (NEEDS_INK.test(title)) {
      const ok = await confirm({
        title: "Is e-signature right for this one?",
        object: { name: title },
        message: "Wills, codicils and testamentary trusts can’t be signed electronically, and powers of attorney, deeds and affidavits usually need a witness or a notary. Check before sending.",
        confirmLabel: "Set it up anyway",
        tone: "commit",
      });
      if (ok === false) return;
    }
    setBusy("new");
    setError("");
    try {
      const created = await signApi.act("create", { title, parties: [{ role: "Party A" }, { role: "Party B" }] });
      await signApi.attach(created.id, file);
      navigate(`/tools/signatures/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The upload didn’t finish. Try again.");
      setBusy(null);
    }
  }

  const replace = (next: SignatureRequest) => setRows((cur) => (cur ?? []).map((x) => (x.id === next.id ? next : x)));
  const drop = (id: string) => setRows((cur) => (cur ?? []).filter((x) => x.id !== id));

  async function act(r: SignatureRequest, action: "remind" | "send-copy" | "download" | "delete" | "unarchive") {
    // The tab opens inside the click, before anything is awaited.
    const tab = action === "download" ? blankTab() : null;
    setError("");
    try {
      if (tab) {
        tab.go(await signApi.download(r.id));
        return;
      }
      if (action === "delete") {
        if (!(await confirmDeleteDraft(r))) return;
        setBusy(r.id);
        await signApi.remove(r.id);
        drop(r.id);
        toast({ message: "Deleted the draft" });
        return;
      }
      if (action === "send-copy" && !(await confirmSendCopy(r))) return;
      setBusy(r.id);
      const next = await signApi.act(action, { id: r.id });
      if (action === "unarchive") {
        drop(r.id);
        toast({ message: `Restored ${r.title}` });
        return;
      }
      replace(next);
      toast({
        message:
          action === "remind"
            ? `Reminded ${format.list(next.parties.filter((p) => p.status !== "signed" && p.status !== "declined").map((p) => p.name || p.role))}`
            : `Emailed the signed copy to ${format.list(next.parties.map((p) => p.name || p.role))}`,
      });
    } catch (err) {
      tab?.close();
      setError(err instanceof Error ? err.message : "That didn’t work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  /** The one action a row's state calls for, in the fixed right-hand column. */
  const rowAction = (r: SignatureRequest) => {
    if (archived) return null;
    if (r.status === "draft")
      return (
        <Button size="sm" variant="quiet" onClick={() => navigate(`/tools/signatures/${r.id}`)}>
          Set up
        </Button>
      );
    if (isOpen(r.status))
      return (
        <Button size="sm" variant="quiet" busy={busy === r.id} busyLabel="Reminding…" onClick={() => act(r, "remind")}>
          Remind
        </Button>
      );
    if (r.status === "completed")
      return (
        <Button size="sm" variant="quiet" icon="download" onClick={() => act(r, "download")}>
          Download
        </Button>
      );
    return null;
  };

  const menu = (r: SignatureRequest): MenuItem[] => {
    const items: MenuItem[] = [{ label: "Open", onSelect: () => navigate(`/tools/signatures/${r.id}`) }];
    if (archived) {
      items.push({ label: "Restore to the list", onSelect: () => act(r, "unarchive"), disabled: !admin, disabledReason: "Owners and admins" });
      return items;
    }
    if (r.status === "completed") {
      items.push({ label: r.copy_sent_at ? "Email signed copy again" : "Email signed copy", onSelect: () => act(r, "send-copy") });
      items.push({ label: "Download signed copy", onSelect: () => act(r, "download") });
    } else if (r.original_path) items.push({ label: "Download", onSelect: () => act(r, "download") });
    if (isOpen(r.status)) items.push({ divider: true }, { label: "Void…", onSelect: () => setVoiding(r), danger: true });
    if (r.status === "completed" || r.status === "declined" || r.status === "voided")
      items.push({ divider: true }, { label: "Archive…", onSelect: () => setArchiving(r), disabled: !admin, disabledReason: "Owners and admins" });
    if (r.status === "draft" && !r.sent_at) items.push({ divider: true }, { label: "Delete draft…", onSelect: () => act(r, "delete"), danger: true });
    return items;
  };

  /** "Ledger Louise, LLC, by Alex Rivera, Manager · Signed" per party. */
  const partyList = (r: SignatureRequest) =>
    r.parties.length === 0 ? (
      <span className="text-ink-3">No parties yet</span>
    ) : (
      <ul className="flex flex-col gap-1">
        {r.parties.map((p) => (
          <li key={p.key} className="min-w-0">
            <span className="break-words">{p.entity ? p.entity : p.name || <span className="text-ink-3">{p.role}</span>}</span>
            <span className="text-small text-ink-2">
              {p.entity ? ` · by ${p.name || "someone not named yet"}${p.title ? `, ${p.title}` : ""}` : ""} · {PARTY_LABEL[p.status]}
            </span>
          </li>
        ))}
      </ul>
    );

  /** The line under a title: the entity by name, and for drafts when they were made. */
  const source = (r: SignatureRequest) => {
    const name = entityName(r);
    const later = supersededBy(r, all);
    return (
      <span className="block text-small text-ink-2">
        {name ? (
          <Link to={`/assets/${r.asset_id}/agreements`} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">
            {name}
          </Link>
        ) : (
          "No entity"
        )}
        {r.source === "contract" ? " · MSA" : ""}
        {r.status === "draft" ? ` · created ${whenShort(r.created_at)}` : ""}
        {later ? (
          <span className="mt-1 flex items-start gap-[6px] text-ink">
            <span className="mt-[1px] text-warning">
              <Icon name="warning" size={16} />
            </span>
            <span>A later version was signed {whenShort(later.completed_at)}. Void this one?</span>
          </span>
        ) : null}
      </span>
    );
  };

  const completedCell = (r: SignatureRequest) =>
    r.completed_at ? (
      <span className="flex flex-col">
        <span className="tabular-nums">{whenShort(r.completed_at)}</span>
        <span className="text-small text-ink-2">{r.copy_sent_at ? `Copy sent ${whenShort(r.copy_sent_at)}` : "Copy not sent"}</span>
      </span>
    ) : (
      <span className="text-ink-3">—</span>
    );

  /** A cell's controls: clicks and keys stay in the cell (the row opens the request). */
  const actionsCell = (r: SignatureRequest) => (
    <span className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {rowAction(r)}
      <Menu label={`More for ${r.title}`} align="end" items={menu(r)} trigger={<IconButton icon="more" label="More actions" />} />
    </span>
  );

  const columns: Column<SignatureRequest>[] = [
    {
      key: "doc",
      header: "Document",
      render: (r) => (
        <span className="flex flex-col">
          <Link to={`/tools/signatures/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-medium break-words text-ink hover:underline">
            {r.title}
          </Link>
          {source(r)}
        </span>
      ),
    },
    { key: "parties", header: "Parties", width: "28%", render: partyList },
    { key: "status", header: "Status", width: "120px", render: (r) => <StatusChip status={r.status} /> },
    { key: "sent", header: "Sent", width: "96px", render: (r) => (r.sent_at ? <span className="tabular-nums">{whenShort(r.sent_at)}</span> : <span className="text-ink-3">—</span>) },
    { key: "completed", header: "Completed", width: "140px", render: completedCell },
    { key: "actions", header: "", width: "152px", align: "right", render: actionsCell },
  ];

  const total = all.length;
  const summary = archived
    ? `${format.count(total, "archived request")}`
    : `${format.count(total, "request", undefined, { zero: "numeral" })}: ${counts.waiting} waiting, ${counts.signed} signed, ${counts.draft} ${counts.draft === 1 ? "draft" : "drafts"}, ${counts.closed} declined or voided`;

  return (
    <div
      className="contents"
      onDragOver={(e) => {
        if (archived || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.relatedTarget) setDragging(false);
      }}
      onDrop={(e) => {
        if (archived) return;
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void startFrom(f);
      }}
    >
      <Page
        width="workspace"
        header={
          <PageHeader
            title={archived ? "Archived signature requests" : "Signatures"}
            back={archived ? { to: "/tools/signatures", label: "Signatures" } : undefined}
            context={archived ? "Kept whole, out of the list. Times are Arizona time." : "Documents out for signature, who has signed, and the signed copies. Arizona time."}
            create={archived ? undefined : { label: busy === "new" ? "Uploading…" : "Send for signature", onClick: () => fileInput.current?.click() }}
            menu={[archived ? { label: "Back to the list", onSelect: () => setArchived(false) } : { label: "Archived requests", onSelect: () => setArchived(true) }]}
          />
        }
      >
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          aria-label="Choose a PDF to send for signature"
          tabIndex={-1}
          onChange={(e) => e.target.files?.[0] && startFrom(e.target.files[0])}
        />
        {!archived && <p className="-mt-4 text-small text-ink-2">E-signature isn’t for wills, codicils or testamentary trusts, or anything that must be witnessed or notarized.</p>}

        {error && (
          <Banner
            tone="negative"
            onDismiss={() => setError("")}
            action={
              <Button variant="quiet" size="sm" onClick={() => void load()}>
                Try again
              </Button>
            }
          >
            {error}
          </Banner>
        )}

        <section className="flex flex-col gap-4">
          <Toolbar
            search={<SearchField value={query} onChange={setQuery} label="Search signature requests" placeholder="Search by title or party" />}
            filters={<Select label="Entity" value={entity} onChange={setEntity} options={entityOptions} size="sm" />}
            view={!archived ? <Segmented label="Show" value={filter} onChange={setFilter} options={FILTERS} /> : undefined}
          />
          {rows !== null && <p className="text-small text-ink-2 tabular-nums">{summary}</p>}
          <Card flush>
            <Table
              caption="Signature requests"
              columns={columns}
              rows={shown}
              rowKey={(r) => r.id}
              loading={rows === null}
              onRowClick={(r) => navigate(`/tools/signatures/${r.id}`)}
              phoneRow={(r) => ({
                title: r.title,
                label: r.title,
                secondary: [
                  r.status === "completed" ? `Signed ${whenShort(r.completed_at)}` : r.sent_at ? `Sent ${whenShort(r.sent_at)}` : `Created ${whenShort(r.created_at)}`,
                  entityName(r) ?? "No entity",
                ].join(" · "),
                meta: <StatusChip status={r.status} />,
                to: `/tools/signatures/${r.id}`,
                menu: menu(r),
              })}
              empty={
                total === 0 ? (
                  archived ? (
                    <Empty size="section">Nothing is archived.</Empty>
                  ) : (
                    <Empty
                      title="Nothing sent for signature yet"
                      action={
                        <Button variant="primary" onClick={() => fileInput.current?.click()}>
                          Choose a PDF
                        </Button>
                      }
                    >
                      Choose a PDF to send it for signature, or open an entity’s agreement and send it from there. Only staff see this list.
                    </Empty>
                  )
                ) : (
                  <Empty size="section">
                    {query.trim()
                      ? `No requests match “${query.trim()}”.`
                      : filter === "waiting"
                        ? "Nothing is waiting on anyone."
                        : filter === "signed"
                          ? "Nothing signed yet."
                          : filter === "draft"
                            ? "No drafts."
                            : filter === "closed"
                              ? "Nothing declined or voided."
                              : "Nothing for this entity."}{" "}
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() => {
                        setQuery("");
                        setFilter("all");
                        setEntity("any");
                      }}
                    >
                      Clear filters
                    </Button>
                  </Empty>
                )
              }
            />
          </Card>
        </section>
      </Page>

      {dragging && (
        <div aria-hidden className="ds pointer-events-none fixed inset-0 z-modal flex items-center justify-center bg-scrim p-6">
          <div className="rounded-dialog border border-line-strong bg-overlay px-8 py-6 text-center shadow-(--elevation-2)">
            <p className="text-title">Drop the PDF to send it for signature</p>
            <p className="mt-1 text-body text-ink-2">You’ll place the fields and say who signs next.</p>
          </div>
        </div>
      )}

      {voiding && (
        <VoidDialog
          request={voiding}
          open
          onClose={() => setVoiding(null)}
          onVoid={async (reason, notify) => {
            const next = await signApi.act("void", { id: voiding.id, reason, notify });
            replace(next);
            setVoiding(null);
            toast({ message: notify ? "Voided, and the parties were told" : "Voided. Its links stop working" });
          }}
        />
      )}
      {archiving && (
        <ArchiveDialog
          request={archiving}
          open
          onClose={() => setArchiving(null)}
          onArchive={async (reason) => {
            const r = archiving;
            await signApi.act("archive", { id: r.id, reason });
            drop(r.id);
            setArchiving(null);
            toast({
              message: `Archived ${r.title}`,
              action: {
                label: "Undo",
                run: () => {
                  void signApi.act("unarchive", { id: r.id }).then(() => load());
                },
              },
            });
          }}
        />
      )}
    </div>
  );
}
