import { useEffect, useMemo, useState } from "react";
import { canWrite } from "../auth";
import {
  Banner,
  Button,
  Card,
  Count,
  Empty,
  Field,
  FilterChip,
  format,
  IconButton,
  Page,
  PageHeader,
  Segmented,
  Select,
  Sheet,
  Skeleton,
  TextLink,
  toast,
  useDocumentTitle,
  usePhone,
  type Option,
} from "../ui";
import { PaperMailList } from "../paper-mail";
import { inFilter, KIND_LABEL, paperAction, SERIOUS, STABLE_ADDRESS, STABLE_ADDRESS_LINES, STABLE_DASHBOARD, usePaperMailPage, type ListFilter, type PaperMail } from "../paper-mail-model";

export function meta() {
  return [{ title: "Paper mail · BFO" }];
}

const changed = () => window.dispatchEvent(new Event("bfo-paper-mail-changed"));

const KIND_OPTIONS: Option<string>[] = Object.entries(KIND_LABEL)
  .filter(([k]) => k !== "other")
  .map(([value, label]) => ({ value, label }));

/**
 * Every piece of paper mail that arrives at the office's mailbox at Stable,
 * newest first. Each is filed under the entity on its envelope; a piece BFO
 * couldn't match waits under "No entity" for staff to choose, and staff
 * confirm an automatic match before the entity's partners see it.
 */
export default function PaperMailPage() {
  useDocumentTitle("Paper mail");
  const phone = usePhone();
  // Filing a piece and checking Stable are for those who can change records (api/stable.ts).
  const writer = canWrite();
  const [filter, setFilter] = useState<ListFilter>("all");
  const [entity, setEntity] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const kinds = useMemo(() => (kind ? [kind] : []), [kind]);
  const { mail, setMail, more, counts, checks, lastSync, setLastSync, configured, error, reload, loadMore, loadingMore } = usePaperMailPage(filter, entity, kinds);
  const [entities, setEntities] = useState<{ id: string; name: string }[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      const { db, ref, get, authReady } = await import("../store");
      await authReady;
      const all = ((await get(ref(db, "assets"))).val() ?? {}) as Record<string, { name?: string }>;
      setEntities(
        Object.entries(all)
          .map(([id, a]) => ({ id, name: a?.name ?? id }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    })().catch(() => {});
  }, []);
  const nameOf = (id: string | null) => (id ? (entities.find((e) => e.id === id)?.name ?? "the entity") : "No entity");

  // The server filters; an older one doesn't, so the page checks again. Under Unread, legal, government and tax mail comes first.
  const shown = useMemo(() => {
    const list = (mail ?? []).filter((m) => inFilter(m, filter, entity, kinds));
    if (filter !== "unread") return list;
    const serious = (m: PaperMail) => (m.kind && SERIOUS.has(m.kind) ? 0 : 1);
    return [...list].sort((a, b) => serious(a) - serious(b));
  }, [mail, filter, entity, kinds]);

  const local = mail ?? [];
  const n = {
    all: counts?.all ?? (filter === "all" && !entity && !kind ? local.length : null),
    unread: counts?.unread ?? (filter === "all" ? local.filter((m) => !m.readAt).length : null),
    unfiled: counts?.unfiled ?? (filter === "all" ? local.filter((m) => !m.assetId).length : null),
  };

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(STABLE_ADDRESS);
      toast({ message: "Copied the mailing address" });
    } catch {
      // The address is on screen to copy by hand.
    }
  }

  async function sync() {
    setSyncing(true);
    setSyncError("");
    try {
      const r = await paperAction({ action: "sync", days: 30 });
      if (r.lastSync) setLastSync(r.lastSync);
      await reload();
      changed();
      toast({ message: r.synced ? `Checked with Stable: ${format.count(r.synced, "piece")} from the last 30 days` : "Checked with Stable: nothing new" });
    } catch (err) {
      setSyncError((err as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function assign(m: PaperMail, assetId: string | null, undoable = true) {
    const before = { assetId: m.assetId, assigned: m.assigned, filedBy: m.filedBy ?? null, filedAt: m.filedAt ?? null };
    setMail((list) => list?.map((x) => (x.id === m.id ? { ...x, assetId, assigned: "hand", filedBy: "you", filedAt: new Date().toISOString() } : x)) ?? list);
    try {
      const r = await paperAction({ action: "assign", id: m.id, assetId });
      if (r.mail) setMail((list) => list?.map((x) => (x.id === m.id ? { ...x, ...r.mail } : x)) ?? list);
      changed();
      if (undoable)
        toast({
          message: assetId ? `Filed under ${nameOf(assetId)}` : "Moved to No entity",
          action: { label: "Undo", run: () => void assign({ ...m, assetId, assigned: "hand" }, before.assetId, false) },
        });
    } catch (err) {
      setMail((list) => list?.map((x) => (x.id === m.id ? { ...x, ...before } : x)) ?? list);
      setSyncError(`Couldn’t file it. ${(err as Error).message}`);
    }
  }

  async function confirmMatch(m: PaperMail) {
    setMail((list) => list?.map((x) => (x.id === m.id ? { ...x, assigned: "hand", filedBy: "you", filedAt: new Date().toISOString() } : x)) ?? list);
    try {
      const r = await paperAction({ action: "confirm", id: m.id });
      if (r.mail) setMail((list) => list?.map((x) => (x.id === m.id ? { ...x, ...r.mail } : x)) ?? list);
      toast({ message: `Confirmed. Partners on ${nameOf(m.assetId)} can see it now.` });
    } catch (err) {
      setMail((list) => list?.map((x) => (x.id === m.id ? { ...x, assigned: m.assigned, filedBy: m.filedBy, filedAt: m.filedAt } : x)) ?? list);
      setSyncError(`Couldn’t confirm it. ${(err as Error).message}`);
    }
  }

  function opened(m: PaperMail) {
    if (m.readAt) return;
    setMail((list) => list?.map((x) => (x.id === m.id ? { ...x, readAt: new Date().toISOString() } : x)) ?? list);
    void paperAction({ action: "read", id: m.id })
      .then(changed)
      .catch(() => {});
  }

  const segment = (label: string, count: number | null) => (count ? `${label} ${count > 99 ? "99+" : count}` : label);
  const entityOptions: Option<string>[] = [{ value: "", label: "All entities" }, ...entities.map((e) => ({ value: e.id, label: e.name }))];
  const kindOptions: Option<string>[] = [{ value: "", label: "Any kind" }, ...KIND_OPTIONS];
  const entitySelect = <Select label="Entity" size="sm" value={entity ?? ""} options={entityOptions} onChange={(v) => setEntity(v || null)} className={phone ? undefined : "w-[200px]"} />;
  const kindSelect = (
    <Select
      label="Kind"
      size="sm"
      value={kind ?? ""}
      options={kindOptions}
      onChange={(v) => setKind(v || null)}
      footnote="Kinds come from BFO’s reading, made the first time a piece is opened."
      className={phone ? undefined : "w-[160px]"}
    />
  );
  const active = [...(entity ? [{ label: nameOf(entity), clear: () => setEntity(null) }] : []), ...(kind ? [{ label: KIND_LABEL[kind] ?? kind, clear: () => setKind(null) }] : [])];

  const fresh = lastSync?.at ? `Checked with Stable ${format.relative(lastSync.at)}` : null;
  const failed = lastSync?.failedAt && (!lastSync.at || lastSync.failedAt > lastSync.at);
  const context = [n.all !== null ? format.count(n.all, "piece") : null, fresh].filter(Boolean).join(" · ") || "Mail to the office’s mailbox, filed under each entity";

  const emptyText = active.length
    ? "No mail matches these filters."
    : filter === "unread"
      ? "Nothing unread."
      : filter === "unfiled"
        ? "Every piece is filed under an entity."
        : filter === "checks"
          ? "No checks have come in the mail."
          : null;

  return (
    <Page
      width="workspace"
      header={
        <PageHeader
          title="Paper mail"
          context={context}
          secondary={
            writer && configured ? (
              <Button icon="sync" busy={syncing} busyLabel="Checking…" onClick={() => void sync()}>
                Check now
              </Button>
            ) : undefined
          }
        />
      }
    >
      {!configured && <Banner tone="info">Paper mail isn’t connected yet. The office can connect Stable in a few minutes.</Banner>}
      {configured && failed && (
        <Banner
          tone="warning"
          action={
            writer ? (
              <Button variant="quiet" size="sm" onClick={() => void sync()}>
                Check now
              </Button>
            ) : undefined
          }
        >
          The last check with Stable didn’t finish{lastSync?.failedAt ? ` (${format.dateTime(lastSync.failedAt)})` : ""}. New mail may be missing until it does; BFO tries again every hour.
        </Banner>
      )}
      {error && (
        <Banner
          tone="negative"
          action={
            <Button variant="quiet" size="sm" onClick={() => void reload()}>
              Try again
            </Button>
          }
        >
          {error}
        </Banner>
      )}
      {syncError && (
        <Banner tone="negative" onDismiss={() => setSyncError("")}>
          {syncError}
        </Banner>
      )}

      <Card
        title="Our mailing address"
        info="A mailbox at Stable, a mail receiving service: it isn’t an office, and it can’t serve as a registered agent’s address. Legal papers are served on each entity’s registered agent."
        action={writer ? <TextLink to={STABLE_DASHBOARD}>Open Stable</TextLink> : undefined}
      >
        <div className="flex items-start gap-2">
          <address className="text-heading font-medium not-italic tabular-nums">
            {STABLE_ADDRESS_LINES[0]}
            <br />
            {STABLE_ADDRESS_LINES[1]}
          </address>
          <IconButton icon="copy" label="Copy address" onClick={() => void copyAddress()} />
        </div>
        <p className="mt-2 max-w-[68ch] text-small text-ink-2">
          Stable receives each piece, photographs the envelope and scans what you ask it to. Every piece shows up below, filed under its entity, or under No entity until someone chooses.
        </p>
      </Card>

      <section aria-label="The mail" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="Show"
            value={filter}
            onChange={setFilter}
            full={phone}
            options={[
              { value: "all", label: "All" },
              { value: "unread", label: segment("Unread", n.unread) },
              { value: "unfiled", label: segment("No entity", n.unfiled) },
              { value: "checks", label: "Checks" },
            ]}
          />
          {!phone && (
            <div className="ml-auto flex items-center gap-2">
              {entitySelect}
              {kindSelect}
            </div>
          )}
          {phone && (
            <Button icon="filter" size="sm" onClick={() => setFiltersOpen(true)} aria-label={active.length ? `Filter, ${active.length} on` : "Filter"}>
              Filter
              {active.length > 0 && <Count n={active.length} />}
            </Button>
          )}
        </div>
        {phone && active.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {active.map((a) => (
              <FilterChip key={a.label} onRemove={a.clear}>
                {a.label}
              </FilterChip>
            ))}
          </div>
        )}
        {filter === "checks" && checks && checks.checks > 0 && (
          <p className="text-body text-ink-2">
            {format.count(checks.checks, "check")}
            {checks.since ? ` since ${format.date(checks.since, "medium")}` : ""} · <span className="font-medium text-ink tabular-nums">{format.money(checks.cents / 100)}</span>
            {checks.unknown > 0 ? ` · ${format.count(checks.unknown, "check")} without an amount from Stable` : ""}
          </p>
        )}

        <Card flush>
          {mail === null ? (
            <Skeleton kind="rows" rows={4} />
          ) : shown.length === 0 && !emptyText && !error ? (
            <div className="px-5 touch:px-4">
              <Empty size="page" title="No paper mail yet">
                Each piece shows up here when Stable receives it at the office’s mailbox.
              </Empty>
              <div className="h-6" />
            </div>
          ) : (
            <PaperMailList
              mail={shown}
              entities={writer ? entities : undefined}
              onAssign={writer ? (m, id) => void assign(m, id) : undefined}
              onConfirm={writer ? (m) => void confirmMatch(m) : undefined}
              onOpen={opened}
              empty={
                emptyText && (
                  <Empty
                    action={
                      active.length ? (
                        <Button
                          variant="quiet"
                          size="sm"
                          onClick={() => {
                            setEntity(null);
                            setKind(null);
                          }}
                        >
                          Clear filters
                        </Button>
                      ) : undefined
                    }
                  >
                    {emptyText}
                  </Empty>
                )
              }
            />
          )}
          {more && (
            <div className="border-t border-line px-5 py-3 touch:px-4">
              <Button variant="quiet" size="sm" busy={loadingMore} busyLabel="Loading…" onClick={() => void loadMore()}>
                Show older mail
              </Button>
            </div>
          )}
        </Card>
        <p className="text-caption text-ink-2">
          <TextLink to="/legal/privacy#paper-mail" inline>
            How paper mail is handled
          </TextLink>
        </p>
      </section>

      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filter"
        footer={
          <>
            <Button
              onClick={() => {
                setEntity(null);
                setKind(null);
              }}
            >
              Clear filters
            </Button>
            <Button variant="primary" onClick={() => setFiltersOpen(false)}>
              Show mail
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Entity">{entitySelect}</Field>
          <Field label="Kind">{kindSelect}</Field>
        </div>
      </Sheet>
    </Page>
  );
}
