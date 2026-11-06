/**
 * The People tab: who owns the entity and in what share, who manages it (or
 * a trust's trustees, successors, grantors and beneficiaries), and who can
 * sign in to BFO to see it. Every change is recorded as what it is, with its
 * date and document (people-dialogs.tsx, people-model.ts), and the tab never
 * states a conclusion the record doesn't support ("no managers on record",
 * not "it's run by its owners").
 *
 * Also exported: InviteDialog (here and on a signature request) and
 * UsersCard (Overview).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { authFetch, getUser, isAdmin, isPartner } from "../auth";
import { Avatar, Banner, Button, Card, Checkbox, ChoiceTiles, Dialog, Disclosure, Empty, Field, Input, List, ListRow, Select, TextLink, confirm, format, toast, type MenuItem } from "../ui";
import { useEntity } from "./context";
import type { Asset } from "./model";
import { OwnerDialog, RemoveOwnerDialog, TrustAddDialog, TrustRemoveDialog, type OwnerSave, type TrustSave } from "./people-dialogs";
import {
  CLASS_WORDS,
  TRUST_WORDS,
  classificationNote,
  fromWords,
  probablySamePerson,
  historyWords,
  holdsShare,
  isCompanyName,
  linkedEntity,
  managersOnRecord,
  nextOwnerId,
  pct,
  sameName,
  shareTotal,
  trustPatch,
  trustPeopleOf,
  type HistoryEntry,
  type OwnerRow,
  type TrustPerson,
  type TrustRole,
} from "./people-model";

export type Person = {
  userId: string;
  memberName: string | null;
  name: string | null;
  phone: string;
  email: string | null;
  role: string;
  status: string;
  invitedAt: string;
  lastLoginAt: string | null;
};

/** The record's fields this tab adds (stored on the entity, read here). */
type PeopleRecord = Asset & {
  members?: OwnerRow[];
  trustPeople?: TrustPerson[];
  successorTrustees?: string;
  ownershipHistory?: Record<string, HistoryEntry & { doc?: { id: string; name: string } | null; recordedAt?: number; recordedBy?: string | null }>;
};

/** Names and their details wrap in full rather than cutting off (a trust's legal name is long). */
const WRAP = "[&_.line-clamp-2]:line-clamp-none [&_.truncate]:whitespace-normal";

const BAR = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"];
const barColour = (i: number) => BAR[i] ?? "bg-chart-other";

/** "Signed in Nov 2", or "Invited Nov 2, not signed in yet". */
function accessWords(p: Person): string {
  const signedIn = !!p.lastLoginAt && new Date(p.lastLoginAt) >= new Date(p.invitedAt);
  return signedIn ? `Signed in ${format.date(p.lastLoginAt!, "short")}` : `Invited ${format.date(p.invitedAt, "short")}, not signed in yet`;
}

/** What an invitee sees, the same words the text and email use (api/members.ts whatTheySee). */
const whatTheySee = (trust: boolean) => (trust ? "its trust agreement, its documents and the trust’s people" : "its documents, and its owners’ names, shares and addresses");

/** The store's own write, for history entries that are appended, never rewritten. */
async function append(path: string, value: Record<string, unknown>) {
  const { db, push, ref } = await import("../store");
  await push(ref(db, path), value);
}

/** Who may sign in and see this entity, loaded once per tab (staff only). */
function useAccess(assetId: string, admin: boolean) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const load = useCallback(async () => {
    if (!admin || !assetId) return;
    const r = await authFetch(`/api/members?assetId=${encodeURIComponent(assetId)}`);
    const j = await r.json().catch(() => ({}));
    setPeople(r.ok ? (j.people ?? []) : []);
  }, [admin, assetId]);
  useEffect(() => {
    void load();
  }, [load]);
  const revoke = useCallback(
    async (userId: string): Promise<void> => {
      const r = await authFetch("/api/members", { method: "POST", body: JSON.stringify({ action: "revoke", assetId, userId }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Couldn’t remove their access.");
      setPeople(j.people ?? []);
    },
    [assetId],
  );
  return { people, setPeople, revoke };
}

type Inviting = { memberName: string; beneficiary?: boolean } | null;

export function PeopleTab() {
  const { page, asset, view } = useEntity();
  const admin = isAdmin() && !isPartner();
  const assetId = page.id ?? "";
  const access = useAccess(assetId, admin);
  const [inviting, setInviting] = useState<Inviting>(null);

  const accessOf = (name: string) => access.people?.find((p) => sameName(p.memberName ?? p.name, name)) ?? null;

  async function askRevoke(p: Person) {
    const ok = await confirm({
      title: `Remove ${p.name ?? "their"} access?`,
      object: { name: p.name ?? p.phone, detail: accessWords(p) },
      message: `They won’t see ${asset.name} in BFO anymore.${p.role === "partner" ? " If it was the only entity they had, they’re signed out." : ""}`,
      confirmLabel: "Remove access",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await access.revoke(p.userId);
      toast({ message: `Removed ${p.name ?? "their"} access` });
    } catch (err) {
      await confirm({ title: "Couldn’t remove their access", message: err instanceof Error ? err.message : "Try again.", confirmLabel: "Close", acknowledge: true });
    }
  }

  const ctx: PeopleCtx = { admin, accessOf, onInvite: setInviting, onRevoke: askRevoke, revoke: access.revoke };

  return (
    <div className="ds grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">{view.isTrust ? <TrustPeople ctx={ctx} /> : <OwnersAndManagers ctx={ctx} />}</div>
      <aside className="flex min-w-0 flex-col gap-4">
        <AccessCard
          people={access.people}
          admin={admin}
          trust={view.isTrust}
          onInvite={() => setInviting({ memberName: "" })}
          onRevoke={askRevoke}
          onResend={(p) => setInviting({ memberName: p.memberName ?? p.name ?? "" })}
        />
      </aside>
      {inviting && (
        <InviteDialog
          entity={asset.name}
          memberName={inviting.memberName}
          assetId={assetId}
          kind={view.isTrust ? "trust" : "entity"}
          beneficiary={
            inviting.beneficiary
              ? {
                  grantors: trustPeopleOf(asset as PeopleRecord)
                    .people.filter((p) => p.role === "grantor")
                    .map((p) => p.name),
                  revocable: asset.llcType !== "Non-grantor trust",
                }
              : undefined
          }
          onClose={() => setInviting(null)}
          onDone={(list) => access.setPeople(list)}
        />
      )}
    </div>
  );
}

type PeopleCtx = {
  admin: boolean;
  accessOf: (name: string) => Person | null;
  onInvite: (i: Inviting) => void;
  onRevoke: (p: Person) => Promise<void>;
  revoke: (userId: string) => Promise<void>;
};

/** The menu items every person row shares: invite (or resend) and remove access. */
function accessItems(ctx: PeopleCtx, name: string, opts: { beneficiary?: boolean } = {}): MenuItem[] {
  const a = ctx.accessOf(name);
  const company = isCompanyName(name);
  const items: MenuItem[] = [];
  if (!a) items.push({ label: company ? "Invite someone from it to BFO…" : "Invite to BFO…", icon: "mail", onSelect: () => ctx.onInvite({ memberName: name, beneficiary: opts.beneficiary }) });
  else {
    items.push({ label: "Resend invitation…", icon: "mail", onSelect: () => ctx.onInvite({ memberName: name, beneficiary: opts.beneficiary }) });
    items.push({ label: "Remove access…", icon: "lock", onSelect: () => void ctx.onRevoke(a) });
  }
  return items;
}

// ── Owners and managers ──────────────────────────────────────────────────

type OwnerDialogState = { kind: "add" } | { kind: "edit"; index: number } | { kind: "remove"; index: number } | null;

function OwnersAndManagers({ ctx }: { ctx: PeopleCtx }) {
  const { page, asset, goToTab } = useEntity();
  const rec = asset as PeopleRecord;
  const [dialog, setDialog] = useState<OwnerDialogState>(null);
  const [saveError, setSaveError] = useState("");
  const corp = asset.type === "C-Corp";

  const entities = useMemo(
    () =>
      Object.entries(page.allAssets ?? {})
        .filter(([id, a]) => id !== page.id && a?.name)
        .map(([id, a]) => ({ id, name: String(a.name) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [page.allAssets, page.id],
  );

  // The owners on record: the member list, else the owning entity at 100%.
  const stored: OwnerRow[] = rec.members ?? [];
  const fromOwner = !stored.length && !!asset.ownerId && !!page.assetNames[asset.ownerId];
  const list: OwnerRow[] = stored.length ? stored : fromOwner ? [{ name: page.assetNames[asset.ownerId!], percent: 100, role: corp ? "Shareholder" : "Member", entityId: asset.ownerId }] : [];
  const owners = list.map((m, i) => ({ m, i })).filter(({ m }) => holdsShare(m));
  const total = shareTotal(owners.map(({ m }) => m));
  const managers = managersOnRecord(asset);
  const history = Object.entries(rec.ownershipHistory ?? {})
    .map(([key, e]) => ({ key, ...e }))
    .sort((a, b) => (b.effective ?? "").localeCompare(a.effective ?? "") || (b.recordedAt ?? 0) - (a.recordedAt ?? 0));
  const asOf = history.find((h) => h.effective)?.effective ?? null;
  const classNote = classificationNote(asset.type, asset.llcType, owners.length);
  const ownersWord = corp ? "Shareholders" : asset.type === "LP" ? "Partners" : "Owners";
  const issued = Number((page.corpData as { issuedShares?: number } | undefined)?.issuedShares) || null;

  const ownerLabel = (owners2: OwnerRow[]): string | null => {
    const next = nextOwnerId(owners2, entities, asset.ownerId);
    if (next === undefined || next === (asset.ownerId ?? null)) return null;
    const was = asset.ownerId ? page.assetNames[asset.ownerId] : null;
    const now = next ? entities.find((e) => e.id === next)?.name : null;
    return now ? `The header’s owner changes${was ? ` from ${was}` : ""} to ${now}.` : `${was ?? "The owner on record"} comes off the header: no family entity is left on the list.`;
  };

  /** Save the list, its history line, and the "owned by" entity when it follows from the list. */
  async function save(s: OwnerSave, revokeName?: string) {
    setSaveError("");
    const patch: Record<string, unknown> = { members: s.owners };
    const next = nextOwnerId(s.owners, entities, asset.ownerId);
    if (next !== undefined && next !== (asset.ownerId ?? null)) Object.assign(patch, { ownerId: next, ownerEffective: s.entry?.effective ?? format.isoDate(new Date()) });
    // The list's source stays what it was (an operating agreement, the formation); a hand edit is dated beside it.
    patch.membersEditedAt = format.isoDate(new Date());
    if (!rec.membersSource) patch.membersSource = "Entered by hand";
    await page.patchAsset(patch);
    if (s.entry) await append(`assets/${page.id}/ownershipHistory`, { ...s.entry, doc: s.doc, recordedAt: Date.now(), recordedBy: getUser()?.name ?? null });
    if (s.revokeAccess && revokeName) {
      const a = ctx.accessOf(revokeName);
      if (a) await ctx.revoke(a.userId);
    }
  }

  async function reclassify(to: string) {
    const ok = await confirm({
      title: `Record it as ${to === "Partnership" ? "a partnership" : "a disregarded entity"}?`,
      object: { name: asset.name, detail: `Now: ${asset.llcType}` },
      message: `This changes the tax classification on BFO’s record, which drives its deadlines and its W-9. Confirm it with your CPA, and check for any election (Form 8832 or 2553) on file first.`,
      confirmLabel: `Record as ${to === "Partnership" ? "a partnership" : "disregarded"}`,
      tone: "commit",
    });
    if (!ok) return;
    try {
      await page.patchAsset({ llcType: to, llcTypeSource: "Entered by hand" });
      toast({ message: "Tax classification updated" });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn’t update the classification.");
    }
  }

  async function addManagers(names: { name: string; address?: string | null }[]) {
    const next = [
      ...stored,
      ...names
        .filter((n) => !stored.some((m) => sameName(m.name, n.name)))
        .map((n) => ({ name: n.name, role: corp ? "Director" : "Manager", percent: null, ...(n.address ? { address: n.address } : {}) })),
    ];
    try {
      await save({ owners: next, entry: null, doc: null });
      toast({ message: `Added ${format.count(names.length, "manager")} to the owner list` });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn’t add them.");
    }
  }

  const taxLine = (() => {
    const t = asset.llcType;
    const sole = owners.length === 1 ? (linkedEntity(owners[0].m, entities, asset.ownerId)?.name ?? owners[0].m.name) : null;
    if (asset.type !== "LLC") return null;
    if (t === "Disregarded Entity") return sole ? `Disregarded: its income is reported on ${sole}’s return.` : "Disregarded: its income is reported on its owner’s return.";
    if (t === "Partnership") return "A partnership: Form 1065, with a K-1 to each owner by these shares.";
    if (t === "S Corporation") return "An S corporation: Form 1120-S, with K-1s by these shares.";
    if (t === "C Corporation") return "Taxed as a C corporation: Form 1120.";
    return null;
  })();

  const linkOf = (m: OwnerRow) => linkedEntity(m, entities, asset.ownerId);

  return (
    <>
      {classNote && ctx.admin && (
        <Banner
          tone="warning"
          action={
            <Button variant="quiet" size="sm" onClick={() => void reclassify(classNote.suggest)}>
              Update the classification…
            </Button>
          }
        >
          {classNote.message}
        </Banner>
      )}
      <Card
        title={ownersWord}
        count={owners.length || undefined}
        info={
          fromOwner
            ? "From the owning entity on record. Add the members, with their shares, to record them."
            : rec.membersSource
              ? `From ${rec.membersSource.charAt(0).toLowerCase()}${rec.membersSource.slice(1)}${(rec as { membersEditedAt?: string }).membersEditedAt ? `, edited by hand ${format.date((rec as { membersEditedAt?: string }).membersEditedAt!, "medium")}` : ""}.`
              : undefined
        }
        action={
          ctx.admin && owners.length > 0 ? (
            <Button variant="quiet" size="sm" icon="plus" onClick={() => setDialog({ kind: "add" })}>
              Add {corp ? "shareholder" : "owner"}
            </Button>
          ) : undefined
        }
        flush={owners.length > 0}
        footer={
          owners.length > 0 && (asOf || history.length) ? (
            <div className="flex w-full flex-col gap-2">
              <Disclosure label="Changes" count={history.length}>
                <ul className="mt-2 flex flex-col gap-2">
                  {history.map((h) => (
                    <li key={h.key} className="text-small text-ink-2">
                      <span className="text-ink">{h.effective ? format.date(h.effective, "medium") : "Undated"}</span> · {historyWords(h)}
                      {h.doc?.name ? ` · ${h.doc.name}` : ""}
                      {h.recordedBy ? ` · recorded by ${h.recordedBy}` : ""}
                    </li>
                  ))}
                </ul>
              </Disclosure>
            </div>
          ) : undefined
        }
      >
        {owners.length === 0 ? (
          <Empty
            size="page"
            title={`No ${ownersWord.toLowerCase()} on record`}
            action={
              ctx.admin ? (
                <Button variant="primary" icon="plus" onClick={() => setDialog({ kind: "add" })}>
                  Add {corp ? "shareholder" : "owner"}
                </Button>
              ) : undefined
            }
          >
            Who owns it, and in what share, from the operating agreement or the formation.
          </Empty>
        ) : (
          <>
            {owners.length > 1 && (
              <div className="px-5 pt-4 touch:px-4">
                <div className="flex h-2 overflow-hidden rounded-full bg-sunken" role="img" aria-label={owners.map(({ m }) => `${m.name} ${pct(m.percent)}`).join(", ")}>
                  {owners.map(({ m }, k) => (
                    <span key={k} className={barColour(k)} style={{ width: `${Math.max(0, m.percent ?? 0)}%` }} />
                  ))}
                </div>
                <p className="mt-2 text-small text-ink-2">
                  {total !== 100 ? <span className="text-warning">Shares add up to {pct(total)}, not 100%.</span> : "Shares add up to 100%."}
                  {asOf ? ` As of ${format.date(asOf, "medium")}.` : ""}
                </p>
              </div>
            )}
            <List label={ownersWord}>
              {owners.map(({ m, i }, k) => {
                const link = linkOf(m);
                const address = m.address ?? (link ? page.assetAddressByName?.(link.name) : null) ?? page.assetAddressByName?.(m.name) ?? null;
                const a = ctx.accessOf(m.name);
                const role = m.role && !/^member$/i.test(m.role) ? m.role : corp ? "Shareholder" : "Member";
                const detail = [role, corp && m.shares ? `${m.shares.toLocaleString("en-US")} ${m.shareClass ?? "common"} shares` : null, address ?? "No address on record", a ? accessWords(a) : null]
                  .filter(Boolean)
                  .join(" · ");
                const menu: MenuItem[] = ctx.admin
                  ? [
                      ...(fromOwner ? [] : [{ label: `Edit ${corp ? "shareholder" : "owner"}…`, icon: "edit" as const, onSelect: () => setDialog({ kind: "edit", index: i }) }]),
                      ...accessItems(ctx, m.name),
                      ...(fromOwner
                        ? []
                        : [
                            { divider: true as const },
                            { label: `Remove from ${ownersWord.toLowerCase()}…`, icon: "trash" as const, danger: true, onSelect: () => setDialog({ kind: "remove", index: i }) },
                          ]),
                    ]
                  : [];
                return (
                  <ListRow
                    key={`${m.name}-${i}`}
                    label={m.name}
                    title={m.name}
                    secondary={detail}
                    leading={<Avatar name={m.name} kind={isCompanyName(m.name) || link ? "organisation" : "person"} />}
                    trailing={
                      m.percent != null ? (
                        <span className="inline-flex items-center gap-2">
                          {owners.length > 1 && <span aria-hidden="true" className={`size-2 rounded-full ${barColour(k)}`} />}
                          {pct(m.percent)}
                        </span>
                      ) : undefined
                    }
                    to={link ? `/assets/${encodeURIComponent(link.id)}` : undefined}
                    menu={menu.length ? menu : undefined}
                    className={WRAP}
                  />
                );
              })}
            </List>
            {taxLine && <p className="border-t border-line px-5 py-3 text-small text-ink-2 touch:px-4">{taxLine}</p>}
          </>
        )}
      </Card>

      {corp ? (
        <Card title="Directors and officers">
          <Empty
            action={
              <TextLink to="#" onClick={(e) => (e.preventDefault(), goToTab("governance"))}>
                Open Governance
              </TextLink>
            }
          >
            Kept with the board’s records on the Governance tab.
          </Empty>
        </Card>
      ) : (
        <Card
          title="Managers"
          count={managers.list.length || undefined}
          info="Who runs it under the operating agreement. A manager need not own a share."
          action={
            ctx.admin && managers.onOwnerList ? (
              <Button variant="quiet" size="sm" icon="plus" onClick={() => setDialog({ kind: "add" })}>
                Add manager
              </Button>
            ) : undefined
          }
          flush={managers.list.length > 0}
        >
          {managers.list.length === 0 ? (
            <Empty
              action={
                ctx.admin ? (
                  <Button variant="quiet" size="sm" icon="plus" onClick={() => setDialog({ kind: "add" })}>
                    Add manager
                  </Button>
                ) : undefined
              }
            >
              {managers.managerManaged ? "No managers on record, though the documents say it’s manager-managed. Add them from the operating agreement." : "No managers on record."}
            </Empty>
          ) : (
            <>
              {!managers.onOwnerList && (
                <div className="px-5 pt-4 touch:px-4">
                  <Banner
                    tone="info"
                    action={
                      ctx.admin ? (
                        <Button variant="quiet" size="sm" onClick={() => void addManagers(managers.missing)}>
                          Add {managers.missing.length === 1 ? "them" : `all ${managers.missing.length}`}
                        </Button>
                      ) : undefined
                    }
                  >
                    {managers.source} names {format.count(managers.list.length, "manager")}. They aren’t on BFO’s owner list yet.
                  </Banner>
                </div>
              )}
              <List label="Managers">
                {managers.list.map((m) => {
                  const i = stored.findIndex((x) => sameName(x.name, m.name) && !holdsShare(x));
                  const a = ctx.accessOf(m.name);
                  const menu: MenuItem[] = ctx.admin
                    ? [
                        ...(i >= 0 ? [{ label: "Edit manager…", icon: "edit" as const, onSelect: () => setDialog({ kind: "edit", index: i }) }] : []),
                        ...accessItems(ctx, m.name),
                        ...(i >= 0
                          ? [{ divider: true as const }, { label: "Remove from managers…", icon: "trash" as const, danger: true, onSelect: () => setDialog({ kind: "remove", index: i }) }]
                          : []),
                      ]
                    : [];
                  return (
                    <ListRow
                      key={m.name}
                      label={m.name}
                      title={m.name}
                      secondary={[m.role, managers.onOwnerList ? null : fromWords(managers.source).replace(/^f/, "F"), a ? accessWords(a) : null].filter(Boolean).join(" · ")}
                      leading={<Avatar name={m.name} kind={isCompanyName(m.name) ? "organisation" : "person"} />}
                      menu={menu.length ? menu : undefined}
                      className={WRAP}
                    />
                  );
                })}
              </List>
            </>
          )}
        </Card>
      )}
      {saveError && <Banner tone="negative">{saveError}</Banner>}

      {dialog && dialog.kind !== "remove" && (
        <OwnerDialog
          open
          onClose={() => setDialog(null)}
          list={fromOwner ? [] : stored}
          index={dialog.kind === "edit" ? dialog.index : null}
          entityType={asset.type}
          llcType={asset.llcType}
          issuedShares={issued}
          docs={page.docs}
          entities={entities}
          onSave={(s) => save(s)}
        />
      )}
      {dialog?.kind === "remove" && stored[dialog.index] && (
        <RemoveOwnerDialog
          open
          onClose={() => setDialog(null)}
          list={stored}
          index={dialog.index}
          entityType={asset.type}
          llcType={asset.llcType}
          docs={page.docs}
          hasAccess={!!ctx.accessOf(stored[dialog.index].name)}
          ownerChange={ownerLabel}
          onRemove={(s) => save(s, stored[dialog.index].name)}
        />
      )}
    </>
  );
}

// ── A trust's people ─────────────────────────────────────────────────────

const TRUST_CARDS: { role: TrustRole; title: string; info: string; empty: string }[] = [
  {
    role: "trustee",
    title: "Trustees",
    info: "The acting trustees: they hold and manage the trust’s property and sign for it. Banks and title companies ask who they are.",
    empty: "No acting trustees on record. The trust agreement names them.",
  },
  { role: "successor", title: "Successor trustees", info: "Who serves next, in order, when an acting trustee resigns, can’t act or dies.", empty: "None on record. The trust agreement names them." },
  { role: "grantor", title: "Grantors", info: "Who created the trust and funded it. While a grantor of a revocable trust is living, the trust is taxed to them.", empty: "None on record." },
  {
    role: "beneficiary",
    title: "Beneficiaries",
    info: "Who the trust is for: current beneficiaries receive income or property now; remainder beneficiaries receive what’s left later.",
    empty: "None on record.",
  },
];

type TrustDialog = { kind: "add"; role: TrustRole } | { kind: "remove"; person: TrustPerson } | { kind: "class" } | null;

function TrustPeople({ ctx }: { ctx: PeopleCtx }) {
  const { page, asset } = useEntity();
  const rec = asset as PeopleRecord;
  const { people, structured } = trustPeopleOf(rec);
  const [dialog, setDialog] = useState<TrustDialog>(null);
  const [error, setError] = useState("");
  const grantors = people.filter((p) => p.role === "grantor").map((p) => p.name);
  const tax = asset.llcType;
  const grantorTrust = tax !== "Non-grantor trust";

  async function save(s: TrustSave) {
    setError("");
    await page.patchAsset(trustPatch(s.people));
    await append(`assets/${page.id}/trustHistory`, { ...s.history, recordedAt: Date.now(), recordedBy: getUser()?.name ?? null });
    if (s.revokeAccess && typeof s.history.name === "string") {
      const a = ctx.accessOf(s.history.name);
      if (a) await ctx.revoke(a.userId);
    }
  }

  async function change(next: TrustPerson[], history: Record<string, unknown>) {
    try {
      await save({ people: next, history });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save the change.");
    }
  }

  const unsorted = !structured && people.filter((p) => p.role === "trustee").length > 1;
  const names = [...new Set(people.map((p) => p.name))];
  const variants = names.flatMap((a, i) =>
    names
      .slice(i + 1)
      .filter((b) => probablySamePerson(a, b))
      .map((b) => `${a} and ${b}`),
  );

  return (
    <>
      <Card
        title="The trust"
        action={
          ctx.admin ? (
            <Button variant="quiet" size="sm" onClick={() => setDialog({ kind: "class" })}>
              {tax ? "Change…" : "Record it…"}
            </Button>
          ) : undefined
        }
      >
        {tax ? (
          <div className="flex flex-col gap-1">
            <p className="text-body text-ink">{tax === "Grantor trust" ? "A grantor trust, revocable while a grantor is living" : "A non-grantor trust"}</p>
            <p className="text-small text-ink-2">
              {tax === "Grantor trust"
                ? grantors.length
                  ? `Taxed to ${format.list(grantors)}, on ${grantors.length > 1 ? "their" : "the grantor’s"} Form 1040.`
                  : "Taxed to its grantors, on their Form 1040."
                : "Its own taxpayer: Form 1041 under its own EIN, with K-1s to beneficiaries who receive distributions."}
              {asset.llcTypeSource ? ` From ${asset.llcTypeSource.charAt(0).toLowerCase()}${asset.llcTypeSource.slice(1)}.` : ""}
            </p>
          </div>
        ) : (
          <Banner tone="warning">The trust’s tax classification isn’t on record. Until it is, BFO treats it as a grantor trust, taxed to the grantors. Record it from the trust agreement.</Banner>
        )}
      </Card>

      {TRUST_CARDS.map((c) => {
        const rows = people.filter((p) => p.role === c.role).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
        const groups: { label: string | null; rows: TrustPerson[] }[] =
          c.role === "beneficiary" && rows.some((r) => r.class)
            ? (["current", "remainder", "contingent", null] as const)
                .map((k) => ({ label: k ? CLASS_WORDS[k] : "Kind not recorded", rows: rows.filter((r) => (r.class ?? null) === k) }))
                .filter((g) => g.rows.length)
            : [{ label: null, rows }];
        return (
          <Card
            key={c.role}
            title={c.title}
            count={rows.length || undefined}
            info={c.info}
            flush={rows.length > 0}
            action={
              ctx.admin ? (
                <Button variant="quiet" size="sm" icon="plus" onClick={() => setDialog({ kind: "add", role: c.role })}>
                  Add {TRUST_WORDS[c.role].one.toLowerCase()}
                </Button>
              ) : undefined
            }
          >
            {rows.length === 0 ? (
              <Empty>{c.empty}</Empty>
            ) : (
              <>
                {c.role === "trustee" && unsorted && (
                  <div className="px-5 pt-4 touch:px-4">
                    <Banner tone="info">The record doesn’t say which trustees are acting and which are successors. Mark each from the trust agreement or its certification.</Banner>
                  </div>
                )}
                {groups.map((g) => (
                  <div key={g.label ?? "all"}>
                    {g.label && <p className="border-t border-line px-5 pt-3 pb-1 text-small font-medium text-ink-2 first:border-t-0 touch:px-4">{g.label}</p>}
                    <List label={g.label ? `${c.title}: ${g.label}` : c.title}>
                      {g.rows.map((p) => {
                        const a = ctx.accessOf(p.name);
                        const also = people.filter((x) => x !== p && sameName(x.name, p.name)).map((x) => TRUST_WORDS[x.role].one);
                        const idx = people.indexOf(p);
                        const set = (patch: Partial<TrustPerson>, history: Record<string, unknown>) =>
                          void change(
                            people.map((x, j) => (j === idx ? { ...x, ...patch } : x)),
                            history,
                          );
                        const menu: MenuItem[] = ctx.admin
                          ? [
                              ...(p.role === "trustee"
                                ? [
                                    {
                                      label: "Mark as successor trustee",
                                      onSelect: () =>
                                        set({ role: "successor", order: people.filter((x) => x.role === "successor").length + 1 }, { kind: "role", name: p.name, from: "trustee", to: "successor" }),
                                    },
                                  ]
                                : []),
                              ...(p.role === "successor"
                                ? [{ label: "Mark as acting trustee", onSelect: () => set({ role: "trustee", order: null }, { kind: "role", name: p.name, from: "successor", to: "trustee" }) }]
                                : []),
                              ...(p.role === "beneficiary"
                                ? (["current", "remainder", "contingent"] as const).map((k) => ({
                                    label: `${CLASS_WORDS[k]} beneficiary`,
                                    checked: p.class === k,
                                    onSelect: () => set({ class: k }, { kind: "class", name: p.name, to: k }),
                                  }))
                                : []),
                              { divider: true as const },
                              ...accessItems(ctx, p.name, { beneficiary: p.role === "beneficiary" }),
                              { divider: true as const },
                              { label: `Remove from ${TRUST_WORDS[p.role].many}…`, icon: "trash" as const, danger: true, onSelect: () => setDialog({ kind: "remove", person: p }) },
                            ]
                          : [];
                        return (
                          <ListRow
                            key={`${p.name}-${idx}`}
                            label={p.name}
                            title={p.name}
                            secondary={[
                              p.role === "successor" && p.order ? `${ordinal(p.order)} in line` : TRUST_WORDS[p.role].one,
                              also.length ? `Also ${format.list(also.map((x) => x.toLowerCase()))}` : null,
                              p.since ? `Since ${format.date(p.since, "medium")}` : null,
                              a ? accessWords(a) : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                            leading={<Avatar name={p.name} kind={isCompanyName(p.name) ? "organisation" : "person"} />}
                            menu={menu.length ? menu : undefined}
                            className={WRAP}
                          />
                        );
                      })}
                    </List>
                  </div>
                ))}
              </>
            )}
          </Card>
        );
      })}
      {variants.length > 0 && (
        <Banner tone="info">
          Some names may be one person written two ways: {format.list(variants)}. Use one spelling, the one in the trust agreement, so BFO counts and invites each person once.
        </Banner>
      )}
      {error && <Banner tone="negative">{error}</Banner>}

      {dialog?.kind === "add" && <TrustAddDialog open onClose={() => setDialog(null)} role={dialog.role} people={people} docs={page.docs} onSave={save} />}
      {dialog?.kind === "remove" && (
        <TrustRemoveDialog
          open
          onClose={() => setDialog(null)}
          person={dialog.person}
          people={people}
          docs={page.docs}
          hasAccess={!!ctx.accessOf(dialog.person.name)}
          grantorTrust={grantorTrust}
          hasCertificate={!!asset.trustCertificate}
          onRemove={save}
        />
      )}
      {dialog?.kind === "class" && <TrustClassDialog onClose={() => setDialog(null)} current={tax ?? null} />}
    </>
  );
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

/** Record a trust's tax classification, from its agreement. */
function TrustClassDialog({ onClose, current }: { onClose: () => void; current: string | null }) {
  const { page } = useEntity();
  const [value, setValue] = useState<string | null>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    if (!value) return;
    setBusy(true);
    setError("");
    try {
      await page.patchAsset({ llcType: value, llcTypeSource: "Entered by hand" });
      toast({ message: "Tax classification recorded" });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save it.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="The trust’s tax classification"
      description="From the trust agreement. It decides who reports the trust’s income and which deadlines apply."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} busyLabel="Saving…" disabled={!value || value === current} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ChoiceTiles
          label="Classification"
          hideLabel
          stacked
          value={value}
          onChange={setValue}
          options={[
            { value: "Grantor trust", title: "Grantor trust", description: "Revocable, or otherwise taxed to the grantors on their Form 1040." },
            { value: "Non-grantor trust", title: "Non-grantor trust", description: "Irrevocable and its own taxpayer: its own EIN and Form 1041." },
          ]}
        />
        {error && <Banner tone="negative">{error}</Banner>}
      </div>
    </Dialog>
  );
}

// ── Access ───────────────────────────────────────────────────────────────

function AccessCard({
  people,
  admin,
  trust,
  onInvite,
  onRevoke,
  onResend,
}: {
  people: Person[] | null;
  admin: boolean;
  trust: boolean;
  onInvite: () => void;
  onRevoke: (p: Person) => Promise<void>;
  onResend: (p: Person) => void;
}) {
  const { asset } = useEntity();
  if (!admin) {
    return (
      <Card title="Your access">
        <p className="text-body text-ink-2">
          You can see {asset.name}’s documents and {trust ? "its people" : "owners"}. To change anything, contact Burton Family Office.
        </p>
      </Card>
    );
  }
  return (
    <Card
      title="Access"
      count={people?.length || undefined}
      action={
        <Button variant="quiet" size="sm" icon="mail" onClick={onInvite}>
          Invite
        </Button>
      }
      flush={!!people?.length}
    >
      {!people?.length ? (
        <p className="text-body text-ink-2">
          {people === null ? "" : "No one outside the office has access. "}People you invite sign in with their phone and see only {asset.name}: {whatTheySee(trust)}.
        </p>
      ) : (
        <>
          <p className="px-5 pt-3 text-small text-ink-2 touch:px-4">
            They see only {asset.name}: {whatTheySee(trust)}.
          </p>
          <List label="People with access">
            {people.map((p) => (
              <ListRow
                key={p.userId}
                label={p.name ?? p.phone}
                title={p.name ?? p.phone}
                secondary={[p.memberName && !sameName(p.memberName, p.name) ? `For ${p.memberName}` : null, accessWords(p)].filter(Boolean).join(" · ")}
                leading={<Avatar name={p.name ?? "?"} size={24} />}
                menu={[
                  { label: "Resend invitation…", icon: "mail", onSelect: () => onResend(p) },
                  { divider: true },
                  { label: "Remove access…", icon: "lock", danger: true, onSelect: () => void onRevoke(p) },
                ]}
              />
            ))}
          </List>
        </>
      )}
    </Card>
  );
}

/** A US number as people read it, for reading back before sending; anything else as typed. */
function readBack(raw: string): string {
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : raw.trim();
}

/**
 * Invites one person to BFO as a partner of the entity: finds or creates
 * their account, gives them the entity, texts (and emails) them to sign in.
 * The button reads the number back; the inviter confirms the person agreed
 * to texts; a number that's someone else's account stops and says whose.
 * `initial` prefills what's already known (a signature request's party).
 */
export function InviteDialog({
  entity,
  memberName,
  assetId,
  initial,
  kind = "entity",
  beneficiary,
  onClose,
  onDone,
}: {
  entity: string;
  memberName: string;
  assetId: string;
  initial?: { name?: string; email?: string };
  kind?: "trust" | "entity";
  /** Inviting a trust beneficiary: the grantors, one of whom must approve while the trust is revocable. */
  beneficiary?: { grantors: string[]; revocable: boolean };
  onClose: () => void;
  onDone: (people: Person[]) => void;
}) {
  const company = !!memberName && isCompanyName(memberName);
  const [name, setName] = useState(initial?.name ?? (company ? "" : memberName));
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [consent, setConsent] = useState(false);
  const [approver, setApprover] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState("");
  const [belongs, setBelongs] = useState<{ id: string; name: string } | null>(null);
  const [failedText, setFailedText] = useState<{ name: string; phone: string } | null>(null);
  const needsApproval = !!beneficiary?.revocable;
  const digits = phone.replace(/\D/g, "");

  const nameErr = tried && !name.trim() ? "Add their full name." : undefined;
  const phoneErr = tried && digits.length < 10 ? "Add a mobile number: they sign in with it." : undefined;
  const consentErr = tried && !consent;
  const approverErr = tried && needsApproval && !approver ? "Choose the grantor who approved it." : undefined;

  async function submit(confirmUserId?: string) {
    setTried(true);
    setError("");
    if (!name.trim() || digits.length < 10 || !consent || (needsApproval && !approver)) return;
    setBusy(true);
    try {
      const r = await authFetch("/api/members", {
        method: "POST",
        body: JSON.stringify({ action: "invite", assetId, memberName, name, phone, email, consent, confirmUserId, grantorApproval: needsApproval ? approver : undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409 && j.error === "number_belongs" && j.account) {
        setBelongs(j.account);
        return;
      }
      if (!r.ok) throw new Error(j.message || "Couldn’t send the invitation. Check your connection and try again.");
      onDone(j.people ?? []);
      const sent = (j.sent ?? { sms: false, email: false }) as { sms: boolean; email: boolean };
      if (sent.sms) {
        toast({ message: `Invited ${name.trim()}: ${sent.email ? "a text and an email are" : "a text is"} on the way` });
        onClose();
      } else setFailedText({ name: name.trim(), phone: readBack(phone) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t send the invitation.");
    } finally {
      setBusy(false);
    }
  }

  const title = company ? `Invite someone from ${memberName}` : memberName ? `Invite ${memberName} to BFO` : "Invite someone to BFO";

  if (failedText) {
    return (
      <Dialog
        open
        onClose={onClose}
        title={title}
        footer={
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <Banner tone="warning">
          {failedText.name} has access, but the text didn’t go through{email ? " (the email may have)" : ""}. Tell them to sign in at burtonfamilyoffice.com with {failedText.phone}.
        </Banner>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={`They’ll sign in with their phone and see only ${entity}: ${whatTheySee(kind === "trust")}. Nothing else in BFO.`}
      dirty={!!(phone || (name && name !== memberName)) && !busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} busyLabel="Sending…" onClick={() => void submit(belongs?.id)}>
            {digits.length >= 10 ? `Send to ${readBack(phone)}` : "Send invitation"}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(belongs?.id);
        }}
      >
        {company && <p className="text-body text-ink-2">{memberName} is a company or trust: invite the person who acts for it.</p>}
        {beneficiary && (
          <Banner tone="warning">
            {beneficiary.revocable
              ? "While the grantors are living, a beneficiary of a revocable trust generally isn’t entitled to see the trust agreement. Inviting them shows them the trust agreement and every document filed under the trust."
              : "Inviting a beneficiary shows them the trust agreement and every document filed under the trust."}
          </Banner>
        )}
        <Field label="Full name" error={nameErr}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus={!name} />
        </Field>
        <Field label="Mobile number" error={phoneErr} hint="They sign in with this number.">
          <Input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setBelongs(null);
            }}
            placeholder="(555) 010-0142"
            autoComplete="off"
            autoFocus={!!name}
          />
        </Field>
        {belongs && (
          <Banner
            tone="warning"
            action={
              <Button variant="quiet" size="sm" busy={busy} onClick={() => void submit(belongs.id)}>
                It’s them: give {belongs.name} access
              </Button>
            }
          >
            This number belongs to {belongs.name}’s account. Check the number, or confirm it’s the same person.
          </Banner>
        )}
        <Field label="Email" optional hint="We’ll send the invitation here too.">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="off" />
        </Field>
        {needsApproval && beneficiary && (
          <Field label="Approved by" error={approverErr} hint="The grantor who agreed to share the trust’s documents with them. It’s recorded with the invitation.">
            <Select label="Approved by" value={approver} onChange={setApprover} placeholder="Choose a grantor" options={beneficiary.grantors.map((g) => ({ value: g, label: g }))} />
          </Field>
        )}
        <div>
          <Checkbox
            checked={consent}
            onChange={setConsent}
            label="They’ve agreed to get texts from BFO at this number."
            hint="Recorded with the invitation. Every text says how to stop them (reply STOP)."
          />
          {consentErr && <p className="mt-1 text-small text-negative">Confirm they’ve agreed before BFO texts them.</p>}
        </div>
        {error && <Banner tone="negative">{error}</Banner>}
      </form>
    </Dialog>
  );
}

/**
 * Overview's Users card: who can sign in and see this entity, and a way to
 * invite one more. The full picture (owners, shares, trust roles) is on Owners.
 */
export function UsersCard() {
  const { page, asset, view, goToTab } = useEntity();
  const admin = isAdmin() && !isPartner();
  const assetId = page.id ?? "";
  const access = useAccess(assetId, admin);
  const [inviting, setInviting] = useState(false);
  if (!admin || !assetId) return null;
  const list = access.people ?? [];
  return (
    <Card
      title="Access"
      count={list.length || undefined}
      action={
        <Button variant="quiet" size="sm" icon="mail" onClick={() => setInviting(true)}>
          Invite
        </Button>
      }
      flush={list.length > 0}
      footer={
        list.length > 0 ? (
          <TextLink to="#" onClick={(e) => (e.preventDefault(), goToTab("people"))}>
            Manage on {view.isTrust ? "People" : "Owners"}
          </TextLink>
        ) : undefined
      }
    >
      {access.people === null ? null : list.length === 0 ? (
        <p className="text-body text-ink-2">Nobody outside the office can see this entity yet. People you invite sign in with their phone and see only {asset.name}.</p>
      ) : (
        <List label="People with access">
          {list.map((p) => (
            <ListRow
              key={p.userId}
              label={p.name ?? p.phone}
              title={p.name || p.memberName || p.phone}
              secondary={accessWords(p)}
              leading={<Avatar name={p.name || p.memberName || "?"} size={24} />}
            />
          ))}
        </List>
      )}
      {inviting && (
        <InviteDialog
          entity={asset.name ?? "this entity"}
          memberName=""
          assetId={assetId}
          kind={view.isTrust ? "trust" : "entity"}
          onClose={() => setInviting(false)}
          onDone={(next) => access.setPeople(next)}
        />
      )}
    </Card>
  );
}
