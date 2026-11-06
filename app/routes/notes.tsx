/**
 * Notes: the office's shared notes, for context that doesn't belong to one
 * entity (or does: a note can name an entity and a tax year). Each note
 * carries its author and time, stamped by the server (api/tree.ts). Notes
 * are kept: deleting moves one to Deleted, where it can be restored, and
 * only its author or an owner or admin may delete it. Who can read them is
 * said under the title: the office team, never partners.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { canWrite, getUser, isAdmin } from "../auth";
import { Banner, Button, Card, Checkbox, Empty, Field, Input, Page, PageHeader, Segmented, Select, Sheet, Skeleton, Textarea, Toolbar, format, toast, useDocumentTitle, usePhone, type MenuItem } from "../ui";

export function meta() {
  return [{ title: "Notes · BFO" }];
}

type Person = { id?: string | null; name?: string | null } | null;

interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  createdBy?: Person;
  entityId?: string | null;
  taxYear?: number | null;
  privileged?: boolean;
  deletedAt?: number | null;
  deletedBy?: Person;
}

const ALL = "all";

export default function Notes() {
  useDocumentTitle("Notes");
  const phone = usePhone();
  // Viewers read notes; the server refuses their writes (api/tree.ts), so they aren't offered any.
  const writer = canWrite();
  const me = getUser();
  const admin = isAdmin();

  const [notes, setNotes] = useState<Note[] | null>(null);
  const [entities, setEntities] = useState<{ id: string; name: string }[]>([]);
  const [loadError, setLoadError] = useState("");
  const [composing, setComposing] = useState(false);
  const [shelf, setShelf] = useState<"notes" | "deleted">("notes");
  const [entityF, setEntityF] = useState<string>(ALL);

  useEffect(() => {
    const offs: (() => void)[] = [];
    let alive = true;
    void (async () => {
      const { db, ref, onValue } = await import("../store");
      if (!alive) return;
      offs.push(
        onValue(
          ref(db, "notes"),
          (snap) => {
            const data = (snap.val() ?? {}) as Record<string, Omit<Note, "id">>;
            setNotes(
              Object.entries(data)
                .filter(([, v]) => v && typeof v === "object")
                .map(([id, v]) => ({ ...v, id, title: v.title ?? "", body: v.body ?? "", createdAt: v.createdAt ?? 0 }))
                .sort((a, b) => b.createdAt - a.createdAt),
            );
            setLoadError("");
          },
          () => setLoadError("Couldn't load the notes. Check your connection and try again."),
        ),
      );
      offs.push(
        onValue(ref(db, "assets"), (snap) => {
          const data = (snap.val() ?? {}) as Record<string, { name?: string }>;
          setEntities(
            Object.entries(data)
              .filter(([, v]) => v?.name)
              .map(([id, v]) => ({ id, name: v.name! }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          );
        }),
      );
    })();
    return () => {
      alive = false;
      for (const off of offs) off();
    };
  }, []);

  const nameOf = useMemo(() => new Map(entities.map((e) => [e.id, e.name])), [entities]);
  const kept = (notes ?? []).filter((n) => !n.deletedAt);
  const deleted = (notes ?? []).filter((n) => !!n.deletedAt);
  const shown = (shelf === "deleted" ? deleted : kept).filter((n) => entityF === ALL || n.entityId === entityF);
  const linked = [...new Set((notes ?? []).map((n) => n.entityId).filter((v): v is string => !!v && nameOf.has(v)))];
  const mayChange = (n: Note) => writer && (admin || (!!me && n.createdBy?.id === me.id));

  async function setDeleted(n: Note, on: boolean) {
    const { db, ref, update } = await import("../store");
    try {
      await update(ref(db, `notes/${n.id}`), { deletedAt: on ? Date.now() : null });
      toast({
        message: on ? `Deleted the note “${n.title}”` : `Restored the note “${n.title}”`,
        action: on ? { label: "Undo", run: () => void setDeleted(n, false) } : undefined,
      });
    } catch (err) {
      setLoadError((err as Error).message || "Couldn't change the note. Try again.");
    }
  }

  const byline = (n: Note) =>
    [n.createdBy?.name ?? "Author not recorded", n.createdAt ? format.dateTime(new Date(n.createdAt), { zone: true }) : ""].filter(Boolean).join(" · ");

  const composer = <Composer entities={entities} onClose={() => setComposing(false)} phone={phone} />;

  return (
    <Page
      width="reading"
      header={
        <PageHeader
          title="Notes"
          context="Shared with the office team: owners, admins, staff and read-only viewers. Partners can't see notes."
          create={writer ? { label: "New note", onClick: () => setComposing(true) } : undefined}
        />
      }
    >
      {loadError && <Banner tone="negative">{loadError}</Banner>}
      {composing && !phone && composer}
      {phone && (
        <Sheet open={composing} onClose={() => setComposing(false)} side="full" title="New note">
          {composer}
        </Sheet>
      )}
      {(deleted.length > 0 || linked.length > 0) && (
        <Toolbar
          filters={
            linked.length > 0 ? (
              <Select
                size="sm"
                label="Entity"
                value={entityF}
                onChange={setEntityF}
                options={[{ value: ALL, label: "All entities" }, ...linked.map((id) => ({ value: id, label: nameOf.get(id)! }))]}
              />
            ) : undefined
          }
          view={
            deleted.length > 0 ? (
              <Segmented
                label="Notes"
                value={shelf}
                onChange={setShelf}
                options={[
                  { value: "notes", label: "Notes" },
                  { value: "deleted", label: `Deleted · ${deleted.length}` },
                ]}
              />
            ) : undefined
          }
        />
      )}
      {notes === null ? (
        <Skeleton kind="card" rows={3} />
      ) : shown.length === 0 ? (
        shelf === "deleted" ? (
          <Empty size="section">No deleted notes{entityF !== ALL ? " for this entity" : ""}.</Empty>
        ) : (
          <Empty
            title="No notes yet"
            size="page"
            action={
              writer && !composing ? (
                <Button variant="primary" icon="plus" onClick={() => setComposing(true)}>
                  New note
                </Button>
              ) : undefined
            }
          >
            Notes are for context the office needs to keep: decisions, instructions, who said what. Each one shows who wrote it and when. Only the office team can see them.
          </Empty>
        )
      ) : (
        <div className="flex flex-col gap-4">
          {shown.map((n) => {
            const menu: MenuItem[] = mayChange(n) ? [n.deletedAt ? { label: "Restore", onSelect: () => void setDeleted(n, false) } : { label: "Delete", danger: true, onSelect: () => void setDeleted(n, true) }] : [];
            return (
              <Card key={n.id} title={n.title || "Untitled note"} menu={menu.length ? menu : undefined}>
                <div className="flex flex-col gap-3">
                  {n.privileged && <Banner tone="info">Privileged and confidential: attorney-client communication.</Banner>}
                  {n.body && <p className="text-reading break-words whitespace-pre-wrap text-ink">{n.body}</p>}
                  <p className="text-small text-ink-2">
                    {byline(n)}
                    {n.entityId && nameOf.has(n.entityId) && (
                      <>
                        {" · "}
                        <Link to={`/assets/${n.entityId}`} className="text-accent underline underline-offset-[3px] hover:text-accent-hover">
                          {nameOf.get(n.entityId)}
                        </Link>
                      </>
                    )}
                    {n.taxYear ? ` · Tax year ${n.taxYear}` : ""}
                  </p>
                  {n.deletedAt && (
                    <p className="text-small text-ink-2">
                      Deleted {format.dateTime(new Date(n.deletedAt), { zone: true })}
                      {n.deletedBy?.name ? ` by ${n.deletedBy.name}` : ""}.
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}

/** The new-note form: inline on desktop, a full sheet on a phone. */
function Composer({ entities, onClose, phone }: { entities: { id: string; name: string }[]; onClose: () => void; phone: boolean }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [entityId, setEntityId] = useState<string>("");
  const [taxYear, setTaxYear] = useState<string>("");
  const [privileged, setPrivileged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = !!title.trim() && !!body.trim();
  const year = new Date().getFullYear();

  async function save() {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const { db, ref, push } = await import("../store");
      // The server stamps the author and the time; createdAt here only orders the note until it does.
      await push(ref(db, "notes"), {
        title: title.trim(),
        body: body.trim(),
        createdAt: Date.now(),
        ...(entityId ? { entityId } : {}),
        ...(taxYear ? { taxYear: Number(taxYear) } : {}),
        ...(privileged ? { privileged: true } : {}),
      });
      toast({ message: "Added the note" });
      onClose();
    } catch (err) {
      setError((err as Error).message || "Couldn't add the note. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const fields = (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </Field>
      <Field label="Note">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="What happened, what was decided, who asked…" />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Entity" optional>
          <Select label="Entity" value={entityId || null} placeholder="None" onChange={setEntityId} options={[{ value: "", label: "None" }, ...entities.map((e) => ({ value: e.id, label: e.name }))]} />
        </Field>
        <Field label="Tax year" optional>
          <Select
            label="Tax year"
            value={taxYear || null}
            placeholder="None"
            onChange={setTaxYear}
            options={[{ value: "", label: "None" }, ...Array.from({ length: 6 }, (_, i) => String(year - i + 1)).map((y) => ({ value: y, label: y }))]}
          />
        </Field>
      </div>
      <Checkbox checked={privileged} onChange={setPrivileged} label="Privileged and confidential: attorney-client communication" hint="Marks the note so everyone reading it knows; it's still shared with the office team." />
      {error && <Banner tone="negative">{error}</Banner>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={busy} busyLabel="Adding…" disabled={!ready} disabledReason={ready ? undefined : "Add a title and a note to continue"}>
          Add note
        </Button>
      </div>
      {!ready && <p className="-mt-2 text-small text-ink-2 sm:text-right">Add a title and a note to continue.</p>}
    </form>
  );
  return phone ? fields : <Card title="New note">{fields}</Card>;
}
