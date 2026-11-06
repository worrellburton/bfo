import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { authFetch, getUser, homePath, isAdmin, type Role, type User } from "../auth";
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  ChoiceTiles,
  Dialog,
  Empty,
  Field,
  Input,
  Page,
  PageHeader,
  Row,
  Rows,
  SearchField,
  Segmented,
  Sheet,
  Status,
  Table,
  confirm,
  format,
  toast,
  useDocumentTitle,
  type Column,
} from "../ui";
import { isFullName, mailboxAllowed, mailboxByDefault, needsTypedConfirm, peopleCsv, personLabel, ROLE_ORDER, ROLES, roleLabel, type ExportRow } from "../../lib/people";

export function meta() {
  return [{ title: "People · BFO" }];
}

/**
 * People: who can sign in to BFO and what each person can do. A list (a
 * table on desktop, rows on phones); choosing someone opens their sheet with
 * everything on record, their role, their access history and the actions.
 * Every change confirms with what it means, a principal's or admin's needs
 * their name typed, and api/auth/users.ts records each one in the audit
 * trail. Remove keeps the person, off the list and without access, so the
 * history of who had access stays whole.
 */

type Person = User & {
  verifiedAt?: string | null;
  addedBy?: string | null;
  approvedBy?: string | null;
  revokedAt?: string | null;
  removedAt?: string | null;
  removedBy?: string | null;
  termsAcceptedAt?: string | null;
};
type Review = { at: string; by: string | null } | null;
type Entry = { at: string; actor_name: string | null; action: string; summary: string };
type Tab = "all" | "waiting" | "removed";

const ROLE_CHOICES = (canSetOwner: boolean, current?: Role) =>
  ROLE_ORDER.filter((r) => r !== "owner" || canSetOwner || current === "owner").map((r) => ({ value: r, title: ROLES[r].label, description: ROLES[r].reach }));

/** What isn't ordinary about a person's access; null when they're simply active. */
function statusOf(p: Person): { tone: "warning" | "neutral"; label: string } | null {
  if (p.removedAt) return { tone: "neutral", label: "Removed" };
  if (p.status === "incoming") return { tone: "warning", label: "Waiting" };
  if (p.status === "denied") return { tone: "neutral", label: "Access off" };
  if (!p.phone) return { tone: "warning", label: "Can’t sign in: no phone" };
  return null;
}

const day = (iso: string | null | undefined) => (iso ? format.date(iso, "medium") : "");
const when = (iso: string | null | undefined) => (iso ? format.dateTime(iso) : undefined);

async function call<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await authFetch(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(res.status >= 500 ? "That didn’t go through. Try again in a moment." : (data?.message ?? "That didn’t work. Try again.")) as Error & { code?: string };
    err.code = data?.error;
    throw err;
  }
  return data as T;
}

export default function People() {
  useDocumentTitle("People");
  const navigate = useNavigate();
  const [people, setPeople] = useState<Person[]>([]);
  const [me, setMe] = useState<Person | null>(getUser());
  const [review, setReview] = useState<Review>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!isAdmin()) {
      navigate(homePath());
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await call<{ users: Person[]; me: Person; review?: Review }>("GET", "/api/auth/users");
      setPeople(data.users);
      setMe(data.me);
      setReview(data.review ?? null);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t load the list.");
    } finally {
      setLoading(false);
    }
  }

  const replace = (p: Person) => setPeople((prev) => (prev.some((x) => x.id === p.id) ? prev.map((x) => (x.id === p.id ? p : x)) : [...prev, p]));
  const nameOf = (id: string | null | undefined) => (id ? (people.find((p) => p.id === id)?.name ?? null) : null);

  const current = people.filter((p) => !p.removedAt);
  const waiting = current.filter((p) => p.status === "incoming");
  const removed = people.filter((p) => p.removedAt);
  const canSetOwner = me?.role === "owner";

  const rows = useMemo(() => {
    const base = tab === "waiting" ? waiting : tab === "removed" ? removed : current;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    const digits = q.replace(/\D/g, "");
    return base.filter(
      (u) =>
        u.name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.mailAddress?.includes(q) ||
        (digits && u.phone?.includes(digits)) ||
        u.phoneFormatted?.toLowerCase().includes(q) ||
        roleLabel(u.role).toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, tab, search]);

  function exportList() {
    const list: ExportRow[] = people.map((p) => ({
      name: p.name,
      role: p.role,
      status: statusOf(p)?.label ?? "Active",
      phone: p.phone,
      email: p.email,
      mailbox: p.mailAddress ?? null,
      grantedAt: p.approvedAt,
      grantedBy: nameOf(p.approvedBy),
      verifiedAt: p.verifiedAt ?? null,
      lastSignIn: p.lastLoginAt,
      lastActive: p.lastSeenAt ?? null,
      addedAt: p.createdAt,
    }));
    const blob = new Blob([peopleCsv(list)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bfo-people-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function markReviewed() {
    const ok = await confirm({
      title: "Mark the list as reviewed?",
      message: "Records that you checked who has access to BFO and what each person can do, today.",
      confirmLabel: "Mark as reviewed",
    });
    if (!ok) return;
    try {
      const r = await call<{ review: Review }>("POST", "/api/auth/users", { review: true });
      setReview(r.review);
      toast({ message: "Recorded your review of the list" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t record the review.");
    }
  }

  const anyStatus = rows.some((r) => statusOf(r));
  const columns: Column<Person>[] = [
    {
      key: "name",
      header: "Name",
      render: (p) => (
        <span className="flex items-center gap-3">
          <Avatar name={personLabel(p)} size={32} />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate font-medium text-ink">{p.name || <span className="text-ink-3">No name yet</span>}</span>
              {p.id === me?.id && <Badge>You</Badge>}
            </span>
            {p.mailAddress && <span className="block truncate text-small text-ink-2">{p.mailAddress}</span>}
          </span>
        </span>
      ),
      sort: (a, b) => personLabel(a).localeCompare(personLabel(b)),
    },
    { key: "phone", header: "Signs in with", width: "150px", render: (p) => <span className="tabular-nums">{p.phoneFormatted || p.phone || ""}</span> },
    { key: "role", header: "Role", width: "140px", render: (p) => roleLabel(p.role), sort: (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) },
    ...(anyStatus
      ? [
          {
            key: "status",
            header: "Status",
            width: "170px",
            render: (p: Person) => {
              const s = statusOf(p);
              return s ? <Status tone={s.tone}>{s.label}</Status> : null;
            },
          },
        ]
      : []),
    {
      key: "active",
      header: "Last active",
      width: "130px",
      render: (p) => <span title={when(p.lastSeenAt ?? p.lastLoginAt)}>{day(p.lastSeenAt ?? p.lastLoginAt)}</span>,
      sort: (a, b) => Date.parse(b.lastSeenAt ?? b.lastLoginAt ?? "0") - Date.parse(a.lastSeenAt ?? a.lastLoginAt ?? "0"),
    },
    {
      key: "granted",
      header: "Access granted",
      width: "140px",
      render: (p) => <span title={p.approvedBy ? `By ${nameOf(p.approvedBy) ?? "someone no longer listed"}` : undefined}>{day(p.approvedAt)}</span>,
    },
  ];

  const open = people.find((p) => p.id === openId) ?? null;
  const tabs: { value: Tab; label: string }[] = [
    { value: "all", label: "Everyone" },
    { value: "waiting", label: waiting.length ? `Waiting · ${waiting.length}` : "Waiting" },
    ...(removed.length ? [{ value: "removed" as const, label: "Removed" }] : []),
  ];

  return (
    <Page
      width="workspace"
      header={
        <PageHeader
          title="People"
          context={
            <span className="text-pretty">
              Who can sign in to BFO, and what each person can do.
              {review && (
                <span className="block text-small text-ink-2">
                  Last reviewed {format.date(review.at, "medium")}
                  {review.by ? ` by ${review.by}` : ""}.
                </span>
              )}
            </span>
          }
          create={{ label: "Add person", onClick: () => setAdding(true) }}
          menu={[
            { label: "Export the list", onSelect: exportList, hint: "CSV" },
            { label: "Mark the list as reviewed", onSelect: () => void markReviewed() },
          ]}
        />
      }
    >
      {error && (
        <Banner tone="negative" onDismiss={() => setError("")}>
          {error}
        </Banner>
      )}
      {tab !== "waiting" && waiting.length > 0 && (
        <Banner
          tone="warning"
          action={
            <Button size="sm" onClick={() => setTab("waiting")}>
              Review
            </Button>
          }
        >
          {waiting.length === 1 ? "1 person is" : `${waiting.length} people are`} waiting for approval.
        </Banner>
      )}

      <Card flush>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between md:px-5">
          <Segmented<Tab> label="Show" value={tab} onChange={setTab} options={tabs} />
          <SearchField label="Search people" placeholder="Search name, number, email or role" value={search} onChange={setSearch} className="sm:w-[280px]" />
        </div>
        <Table<Person>
          caption="People with access to BFO"
          columns={columns}
          rows={rows}
          rowKey={(p) => p.id}
          loading={loading}
          onRowClick={(p) => setOpenId(p.id)}
          phoneRow={(p) => {
            const s = statusOf(p);
            return {
              title: (
                <>
                  {p.name || personLabel(p)}
                  {p.id === me?.id && <span className="text-ink-2"> · you</span>}
                </>
              ),
              secondary: [roleLabel(p.role), s?.label ?? (p.lastSeenAt || p.lastLoginAt ? `active ${day(p.lastSeenAt ?? p.lastLoginAt)}` : null)].filter(Boolean).join(" · "),
              leading: <Avatar name={personLabel(p)} size={32} />,
              onClick: () => setOpenId(p.id),
            };
          }}
          empty={
            <Empty title={search ? undefined : tab === "waiting" ? "No one is waiting" : tab === "removed" ? "No one removed" : "No one yet"}>
              {search
                ? `No one matches “${search}”.`
                : tab === "waiting"
                  ? "When someone confirms their number at sign-in and isn’t on the list, they wait here for a principal or admin. Requests no one approves are deleted after 30 days."
                  : "People you remove are kept here, without access, so the history of who had access stays whole."}
            </Empty>
          }
        />
      </Card>

      <PersonSheet person={open} me={me} canSetOwner={canSetOwner} nameOf={nameOf} onClose={() => setOpenId(null)} onChange={replace} onError={setError} />
      <AddPerson
        open={adding}
        onClose={() => setAdding(false)}
        canSetOwner={canSetOwner}
        domain={(me?.mailAddress ?? people.find((p) => p.mailAddress)?.mailAddress)?.split("@")[1] ?? null}
        onAdded={(p) => {
          replace(p);
          setAdding(false);
          toast({ message: `Added ${personLabel(p)}`, action: { label: "Open", run: () => setOpenId(p.id) } });
        }}
      />
    </Page>
  );
}

// ── One person ──────────────────────────────────────────────────────────

function PersonSheet({
  person,
  me,
  canSetOwner,
  nameOf,
  onClose,
  onChange,
  onError,
}: {
  person: Person | null;
  me: Person | null;
  canSetOwner: boolean;
  nameOf: (id: string | null | undefined) => string | null;
  onClose: () => void;
  onChange: (p: Person) => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [mailbox, setMailbox] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ name?: string; address?: string }>({});
  const [history, setHistory] = useState<Entry[] | null>(null);
  const lastId = useRef<string | null>(null);

  useEffect(() => {
    if (!person || lastId.current === person.id) return;
    lastId.current = person.id;
    setName(person.name ?? "");
    setAddress(person.mailAddress ?? "");
    setRole(person.status === "incoming" ? "viewer" : person.role);
    setMailbox(mailboxByDefault(person.status === "incoming" ? "viewer" : person.role));
    setFieldError({});
    setHistory(null);
    call<{ entries: Entry[] }>("GET", `/api/auth/users?history=${person.id}`)
      .then((r) => setHistory(r.entries ?? []))
      .catch(() => setHistory([]));
  }, [person]);
  useEffect(() => {
    if (!person) lastId.current = null;
  }, [person]);

  if (!person) return <Sheet open={false} onClose={onClose} title="" side="right" />;

  const self = person.id === me?.id;
  const locked = person.role === "owner" && !canSetOwner;
  const label = personLabel(person);
  const waiting = person.status === "incoming" && !person.removedAt;
  const s = statusOf(person);

  async function patch(body: Record<string, unknown>, what: string, done?: string) {
    setBusy(what);
    try {
      const r = await call<{ user: Person }>("PATCH", "/api/auth/users", { id: person!.id, ...body });
      onChange(r.user);
      if (done) toast({ message: done });
      return r.user;
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === "invalid_name" || e.code === "name_required") setFieldError({ name: e.message });
      else if (e.code === "invalid_mail_address" || e.code === "address_taken") setFieldError({ address: e.message });
      else onError(e.message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function saveName() {
    const next = name.trim().replace(/\s+/g, " ");
    if (!isFullName(next)) return setFieldError({ name: "Enter their full name, first and last." });
    if (next === (person!.name ?? "")) return;
    await patch({ name: next }, "name", `Renamed to ${next}`);
  }

  async function saveAddress() {
    const next = address.trim().toLowerCase();
    if (next === (person!.mailAddress ?? "")) return;
    if (person!.mailAddress) {
      const ok = await confirm({
        title: `Change ${label}’s mailbox?`,
        object: { name: person!.mailAddress, detail: next ? `becomes ${next.includes("@") ? next : `${next}@…`}` : "is taken away" },
        message: "The old address is freed for someone else, and mail sent to it from now on goes to the shared mail. Mail already in their mailbox stays there.",
        confirmLabel: next ? "Change mailbox" : "Take away mailbox",
      });
      if (!ok) return;
    }
    await patch({ mailAddress: next || null }, "address", next ? "Mailbox changed" : "Mailbox taken away");
  }

  async function saveRole() {
    if (role === person!.role) return;
    const typed = needsTypedConfirm(person!.role, role);
    const ok = await confirm({
      title: `Make ${label} ${role === "admin" ? "an Admin" : `a ${ROLES[role].label}`}?`,
      object: { name: label, detail: `${roleLabel(person!.role)} now` },
      message: `${ROLES[role].label}: ${ROLES[role].reach}${role === "email" || person!.role === "email" ? " They’re signed out and sign in again to the new view." : ""}`,
      confirmLabel: `Make ${ROLES[role].label}`,
      typeToConfirm: typed ? person!.name || undefined : undefined,
    });
    if (!ok) return;
    await patch({ role }, "role", `${label} is now ${ROLES[role].label === "Admin" ? "an Admin" : `a ${ROLES[role].label}`}`);
  }

  async function approve() {
    const next = name.trim().replace(/\s+/g, " ");
    if (!isFullName(next)) return setFieldError({ name: "Enter their full name before approving." });
    const ok = await confirm({
      title: `Approve ${next} as ${ROLES[role].label === "Admin" ? "an Admin" : `a ${ROLES[role].label}`}?`,
      object: { name: next, detail: person!.phoneFormatted || person!.phone || "" },
      message: `They can sign in straight away. ${ROLES[role].label}: ${ROLES[role].reach}`,
      details: mailboxAllowed(role) && mailbox ? ["They get a mailbox on the family domain."] : undefined,
      confirmLabel: "Approve",
      typeToConfirm: needsTypedConfirm(role) ? next : undefined,
    });
    if (!ok) return;
    await patch({ status: "approved", role, name: next, mailbox: mailboxAllowed(role) && mailbox }, "approve", `Approved ${next}`);
  }

  async function turnDown() {
    const ok = await confirm({
      title: `Turn down ${label}?`,
      message: "They can’t sign in. The request stays on the list under Access off, and is kept with the record of who asked.",
      confirmLabel: "Turn down",
    });
    if (ok) await patch({ status: "denied" }, "deny", `Turned down ${label}`);
  }

  async function turnOff() {
    const ok = await confirm({
      title: `Turn off ${label}’s access?`,
      object: { name: label, detail: roleLabel(person!.role) },
      message: "They’re signed out everywhere and can’t sign in until access is turned back on. Nothing they did is changed.",
      details: person!.mailAddress ? [`Mail to ${person!.mailAddress} goes to the shared mail until then.`] : undefined,
      confirmLabel: "Turn off access",
      typeToConfirm: needsTypedConfirm(person!.role) ? person!.name || undefined : undefined,
    });
    if (!ok) return;
    const user = await patch({ status: "denied" }, "off");
    if (user) toast({ message: `Turned off ${label}’s access`, action: { label: "Undo", run: () => void patch({ status: "approved" }, "on", `Turned ${label}’s access back on`) } });
  }

  async function turnOn() {
    const ok = await confirm({
      title: `Turn ${label}’s access back on?`,
      object: { name: label, detail: roleLabel(person!.role) },
      message: `${ROLES[person!.role].label}: ${ROLES[person!.role].reach}`,
      confirmLabel: "Turn access on",
    });
    if (ok) await patch({ status: "approved" }, "on", `Turned ${label}’s access back on`);
  }

  async function remove() {
    const details = [
      "They’re signed out everywhere and can’t sign in.",
      "They leave the list; you’ll find them under Removed, and can turn their access back on there.",
      "Their records and the history of what they did stay, under their name.",
      ...(person!.mailAddress ? [`Mail to ${person!.mailAddress} goes to the shared mail. The address stays theirs, so no one else gets it.`] : []),
    ];
    const r = await confirm({
      title: `Remove ${label}?`,
      object: { name: label, detail: [roleLabel(person!.role), person!.phoneFormatted].filter(Boolean).join(" · ") },
      message: "Nothing is erased; they lose access and leave the list.",
      details,
      tone: "danger",
      confirmLabel: `Remove ${person!.name?.split(" ")[0] ?? "them"}`,
      typeToConfirm: needsTypedConfirm(person!.role) ? person!.name || undefined : undefined,
      alternative: person!.status === "approved" ? { label: "Turn off access instead", value: "off" } : undefined,
    });
    if (!r) return;
    if (typeof r === "object" && r.alternative === "off") {
      await patch({ status: "denied" }, "off", `Turned off ${label}’s access`);
      return;
    }
    setBusy("remove");
    try {
      const res = await call<{ user: Person }>("DELETE", `/api/auth/users?id=${person!.id}`);
      onChange(res.user);
      toast({ message: `Removed ${label}` });
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn’t remove them.");
    } finally {
      setBusy(null);
    }
  }

  const footer = self ? undefined : locked ? undefined : waiting ? (
    <>
      <Button onClick={() => void turnDown()} busy={busy === "deny"} busyLabel="Turning down…">
        Turn down
      </Button>
      <Button variant="primary" onClick={() => void approve()} busy={busy === "approve"} busyLabel="Approving…" disabled={!person.verifiedAt} disabledReason="This number never confirmed its code">
        Approve
      </Button>
    </>
  ) : (
    <>
      <Button onClick={() => void remove()} busy={busy === "remove"} busyLabel="Removing…" className={person.removedAt ? "hidden" : undefined}>
        Remove…
      </Button>
      {person.status === "approved" ? (
        <Button onClick={() => void turnOff()} busy={busy === "off"} busyLabel="Turning off…">
          Turn off access
        </Button>
      ) : (
        <Button variant="primary" onClick={() => void turnOn()} busy={busy === "on"} busyLabel="Turning on…">
          Turn access back on
        </Button>
      )}
    </>
  );

  return (
    <Sheet
      open
      onClose={onClose}
      side="right"
      title={person.name || label}
      description={[roleLabel(person.role), s?.label].filter(Boolean).join(" · ")}
      footer={footer}
      dirty={name.trim() !== (person.name ?? "") || address.trim().toLowerCase() !== (person.mailAddress ?? "")}
    >
      <div className="flex flex-col gap-6">
        {self && <Banner tone="info">This is you. You can’t change your own role or access.</Banner>}
        {locked && <Banner tone="info">Only a principal can change a principal.</Banner>}
        {waiting && (
          <Banner tone={person.verifiedAt ? "info" : "warning"}>
            {person.verifiedAt
              ? `Confirmed their number with a code on ${day(person.verifiedAt)}. Choose what they can do, and give their full name, to approve them.`
              : "This number never confirmed its code, so it can’t be approved. Turn it down, or add the person yourself."}
          </Banner>
        )}

        <Rows>
          <Row label="Signs in with">{person.phoneFormatted || person.phone}</Row>
          <Row label="Email" hint="For copies of documents; not for signing in.">
            {person.email}
          </Row>
          <Row label="Number confirmed">{day(person.verifiedAt)}</Row>
          <Row label="Access granted" hint={person.approvedBy ? `By ${nameOf(person.approvedBy) ?? "someone no longer listed"}` : undefined}>
            {day(person.approvedAt)}
          </Row>
          {person.revokedAt && <Row label="Access turned off">{day(person.revokedAt)}</Row>}
          {person.removedAt && (
            <Row label="Removed" hint={person.removedBy ? `By ${nameOf(person.removedBy) ?? "someone no longer listed"}` : undefined}>
              {day(person.removedAt)}
            </Row>
          )}
          <Row label="Last signed in">{day(person.lastLoginAt)}</Row>
          <Row label="Last active">{day(person.lastSeenAt)}</Row>
          {"termsAcceptedAt" in person && <Row label="Terms of use">{person.termsAcceptedAt ? `Agreed ${day(person.termsAcceptedAt)}` : "Not agreed yet"}</Row>}
          <Row label="Added" hint={person.addedBy ? `By ${nameOf(person.addedBy) ?? "someone no longer listed"}` : person.status === "incoming" ? "Asked to join at sign-in" : undefined}>
            {day(person.createdAt)}
          </Row>
        </Rows>

        {!self && !locked && (
          <>
            <div className="flex flex-col gap-2">
              <Field label="Full name" hint="As it appears on documents they send and in the record of changes." error={fieldError.name}>
                <Input
                  value={name}
                  autoComplete="off"
                  onChange={(e) => {
                    setName(e.target.value);
                    setFieldError({});
                  }}
                />
              </Field>
              {!waiting && name.trim() !== (person.name ?? "") && (
                <div>
                  <Button size="sm" onClick={() => void saveName()} busy={busy === "name"} busyLabel="Saving…">
                    Save name
                  </Button>
                </div>
              )}
            </div>

            {!waiting && mailboxAllowed(person.role) && (
              <div className="flex flex-col gap-2">
                <Field label="Mailbox" hint="Their address on the family domain. Changing it frees the old one." error={fieldError.address} optional>
                  <Input
                    value={address}
                    autoComplete="off"
                    onChange={(e) => {
                      setAddress(e.target.value);
                      setFieldError({});
                    }}
                  />
                </Field>
                {address.trim().toLowerCase() !== (person.mailAddress ?? "") && (
                  <div>
                    <Button size="sm" onClick={() => void saveAddress()} busy={busy === "address"} busyLabel="Saving…">
                      Save mailbox
                    </Button>
                  </div>
                )}
              </div>
            )}

            {!person.removedAt && (
              <div className="flex flex-col gap-3">
                <ChoiceTiles<Role> label="What they can do" value={role} onChange={setRole} options={ROLE_CHOICES(canSetOwner, person.role)} stacked />
                {waiting
                  ? mailboxAllowed(role) && <Checkbox checked={mailbox} onChange={setMailbox} label="Give them a mailbox on the family domain" hint="An address from their first name." />
                  : role !== person.role && (
                      <div>
                        <Button size="sm" variant="primary" onClick={() => void saveRole()} busy={busy === "role"} busyLabel="Saving…">
                          Save role
                        </Button>
                      </div>
                    )}
                {role === "partner" && <p className="text-small text-ink-2">Share entities with them from each entity’s People tab. Until then they see nothing.</p>}
              </div>
            )}
          </>
        )}

        <div>
          <h3 className="text-small font-medium text-ink-2">Access history</h3>
          {history === null ? (
            <p className="mt-2 text-small text-ink-3">Loading…</p>
          ) : history.length === 0 ? (
            <p className="mt-2 text-small text-ink-2">Nothing recorded yet. Changes from now on are kept here.</p>
          ) : (
            <ol className="mt-2 flex flex-col divide-y divide-line">
              {history.map((h, i) => (
                <li key={i} className="py-2">
                  <p className="text-body text-ink">{h.summary}</p>
                  <p className="text-small text-ink-2">
                    {format.dateTime(h.at)}
                    {h.actor_name ? ` · ${h.actor_name}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Sheet>
  );
}

// ── Adding someone ──────────────────────────────────────────────────────

function AddPerson({ open, onClose, canSetOwner, domain, onAdded }: { open: boolean; onClose: () => void; canSetOwner: boolean; domain: string | null; onAdded: (p: Person) => void }) {
  const blank = { name: "", phone: "", email: "", role: "viewer" as Role, mailbox: false };
  const [draft, setDraft] = useState(blank);
  const [errors, setErrors] = useState<{ name?: string; phone?: string; email?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(blank);
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (patch: Partial<typeof draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setErrors({});
  };
  const first =
    draft.name
      .trim()
      .split(/\s+/)[0]
      ?.toLowerCase()
      .replace(/[^a-z0-9-]/g, "") ?? "";
  const wantsMailbox = mailboxAllowed(draft.role) && draft.mailbox;

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const errs: typeof errors = {};
    if (!isFullName(draft.name)) errs.name = "Enter their full name, first and last.";
    if (draft.phone.replace(/\D/g, "").length < 10) errs.phone = "Enter their mobile number. It’s how they sign in.";
    if (Object.keys(errs).length) return setErrors(errs);
    setBusy(true);
    try {
      const r = await call<{ user: Person }>("POST", "/api/auth/users", { name: draft.name, phone: draft.phone, email: draft.email || undefined, role: draft.role, mailbox: wantsMailbox });
      onAdded(r.user);
    } catch (err) {
      const e2 = err as Error & { code?: string };
      if (e2.code === "invalid_name" || e2.code === "name_required") setErrors({ name: e2.message });
      else if (e2.code === "invalid_phone" || e2.code === "phone_required" || e2.code === "already_exists") setErrors({ phone: e2.message });
      else if (e2.code === "invalid_email") setErrors({ email: e2.message });
      else setErrors({ form: e2.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add person"
      description="They can sign in with their number straight away."
      initialFocus={nameRef}
      dirty={!!(draft.name || draft.phone || draft.email)}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} busy={busy} busyLabel="Adding…">
            Add person
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        {errors.form && <Banner tone="negative">{errors.form}</Banner>}
        <Field label="Full name" hint="As it should appear on documents and in the record of changes." error={errors.name}>
          <Input ref={nameRef} value={draft.name} autoComplete="off" onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Mobile number" hint="They sign in with a code texted to this number." error={errors.phone}>
          <Input value={draft.phone} type="tel" inputMode="tel" autoComplete="off" onChange={(e) => set({ phone: e.target.value })} />
        </Field>
        <Field label="Email" hint="For copies of documents; not for signing in." error={errors.email} optional>
          <Input value={draft.email} type="email" autoComplete="off" onChange={(e) => set({ email: e.target.value })} />
        </Field>
        <ChoiceTiles<Role> label="What they can do" value={draft.role} onChange={(role) => set({ role, mailbox: mailboxByDefault(role) })} options={ROLE_CHOICES(canSetOwner)} stacked />
        {mailboxAllowed(draft.role) ? (
          <Checkbox
            checked={draft.mailbox}
            onChange={(v) => set({ mailbox: v })}
            label="Give them a mailbox on the family domain"
            hint={domain && first ? `${first}@${domain}, or the nearest free address.` : "An address from their first name."}
          />
        ) : (
          <p className="text-small text-ink-2">Outside partners don’t get a mailbox. Share entities with them from each entity’s People tab; until then they see nothing.</p>
        )}
      </form>
    </Dialog>
  );
}
