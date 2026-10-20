import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { authFetch, isAdmin, isPartner } from "../auth";
import { confirmDialog } from "../confirm-dialog";
import { useEntity } from "./context";
import type { Member } from "./model";
import { Button, Empty, Icon, IconButton, Input, Section, Select, TextButton, useTone } from "./ui";

/**
 * People tab: who owns the entity and in what share (and who manages it),
 * and which of them can sign in to BFO. "Invite to BFO" gives a person an
 * account that sees only the entities they're on: they sign in with their
 * phone and find this one's documents, operating agreement included.
 */

type Person = {
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

const COLORS = ["#818cf8", "#34d399", "#fbbf24", "#f472b6", "#38bdf8", "#a78bfa", "#fb923c", "#4ade80"];
const isCompany = (name: string) => /\b(llc|l\.l\.c\.|inc\.?|corp\.?|corporation|company|trust|lp|l\.p\.|ltd\.?|partners)\b/i.test(name);
const initials = (name: string) =>
  name
    .replace(/,.*$/, "")
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

export function PeopleTab() {
  const { page, asset } = useEntity();
  const t = useTone();
  const admin = isAdmin() && !isPartner();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [inviting, setInviting] = useState<{ memberName: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState("");

  // The owners on record: the member list (from documents or the formation), else the owning entity at 100%.
  const listed: Member[] = asset.members?.length
    ? asset.members
    : asset.ownerId && page.assetNames[asset.ownerId]
      ? [{ name: page.assetNames[asset.ownerId], percent: 100, role: "Member" }]
      : [];
  const fromOwner = !asset.members?.length && listed.length > 0;
  const owners = listed.filter((m) => !/manager|director|officer/i.test(m.role ?? "") || m.percent != null);
  const managers = listed.filter((m) => /manager|director|officer/i.test(m.role ?? "") && m.percent == null);
  const total = Math.round(owners.reduce((n, m) => n + (m.percent ?? 0), 0) * 100) / 100;

  const load = useCallback(async () => {
    if (!admin) return;
    const r = await authFetch(`/api/members?assetId=${encodeURIComponent(page.id ?? "")}`);
    const j = await r.json().catch(() => ({}));
    if (r.ok) setPeople(j.people ?? []);
  }, [admin, page.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const accessOf = (name: string) => people?.find((p) => (p.memberName ?? p.name ?? "").toLowerCase() === name.toLowerCase()) ?? null;
  const others = (people ?? []).filter((p) => !listed.some((m) => m.name.toLowerCase() === (p.memberName ?? p.name ?? "").toLowerCase()));

  async function saveMembers(next: Member[]) {
    setError("");
    try {
      await page.patchAsset({ members: next, membersSource: "Entered by hand" });
    } catch (err) {
      setError((err as Error).message || "Couldn't save.");
    }
  }

  async function revoke(p: Person) {
    const ok = await confirmDialog({
      title: `Remove ${p.name ?? "their"} access?`,
      message: `They won't see ${asset.name} in BFO anymore.${p.role === "partner" ? " If it's the only entity they had, they're signed out." : ""}`,
      confirmLabel: "Remove access",
      tone: "danger",
    });
    if (!ok) return;
    const r = await authFetch("/api/members", { method: "POST", body: JSON.stringify({ action: "revoke", assetId: page.id, userId: p.userId }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setPeople(j.people ?? []);
    else setError(j.message || "Couldn't remove access.");
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <Section
          title={asset.type === "C-Corp" ? "Shareholders" : asset.type === "Trust" ? "Beneficial owners" : "Owners"}
          count={owners.length || undefined}
          info={fromOwner ? "From the owner on record. Add the members to record their shares." : "Who owns it, and in what share. From the operating agreement, the formation, or entered here."}
          actions={admin ? <TextButton onClick={() => setAdding(true)}>+ Add</TextButton> : undefined}
        >
          {owners.length > 0 && (
            <div className="px-5 pb-1 pt-4">
              <div className={`flex h-2.5 overflow-hidden rounded-full ${t.dark ? "bg-white/[0.06]" : "bg-gray-100"}`}>
                {owners.map((m, i) => (
                  <span key={i} style={{ width: `${Math.max(0, m.percent ?? 0)}%`, background: COLORS[i % COLORS.length] }} className="h-full first:rounded-l-full last:rounded-r-full" />
                ))}
              </div>
              {total !== 100 && owners.some((m) => m.percent != null) && (
                <p className={`mt-2 text-[12px] ${t.dark ? "text-amber-300" : "text-amber-700"}`}>Shares add up to {total}%, not 100%.</p>
              )}
            </div>
          )}
          {owners.length === 0 && !adding ? (
            <Empty action={admin ? <Button icon="plus" onClick={() => setAdding(true)}>Add owner</Button> : undefined}>No owners on record yet.</Empty>
          ) : (
            <div className={`divide-y ${t.divide}`}>
              {owners.map((m, i) =>
                editing === i && admin ? (
                  <MemberForm
                    key={i}
                    initial={m}
                    onCancel={() => setEditing(null)}
                    onSave={async (next) => {
                      await saveMembers(listed.map((x) => (x === m ? next : x)));
                      setEditing(null);
                    }}
                  />
                ) : (
                  <PersonRow
                    key={i}
                    color={COLORS[i % COLORS.length]}
                    name={m.name}
                    detail={m.role && !/^member$/i.test(m.role) ? m.role : asset.type === "C-Corp" ? "Shareholder" : "Member"}
                    share={m.percent}
                    access={admin ? accessOf(m.name) : null}
                    admin={admin}
                    onInvite={() => setInviting({ memberName: m.name })}
                    onRevoke={(p) => void revoke(p)}
                    onEdit={() => setEditing(i)}
                    onRemove={async () => {
                      if (await confirmDialog({ title: `Remove ${m.name}?`, message: "From this entity's owner list. Their BFO access, if any, stays until you remove it.", confirmLabel: "Remove", tone: "danger" }))
                        await saveMembers(listed.filter((x) => x !== m));
                    }}
                  />
                )
              )}
              {adding && (
                <MemberForm
                  initial={{ name: "", percent: owners.length ? Math.max(0, 100 - total) : 100, role: "Member" }}
                  onCancel={() => setAdding(false)}
                  onSave={async (next) => {
                    await saveMembers([...listed, next]);
                    setAdding(false);
                  }}
                />
              )}
            </div>
          )}
        </Section>

        {(managers.length > 0 || admin) && (
          <Section title={asset.type === "C-Corp" ? "Directors and officers" : "Managers"} count={managers.length || undefined} info="People who run it without an ownership share.">
            {managers.length === 0 ? (
              <Empty>None listed. {asset.type === "C-Corp" ? "" : "It's run by its owners."}</Empty>
            ) : (
              <div className={`divide-y ${t.divide}`}>
                {managers.map((m, i) => (
                  <PersonRow
                    key={i}
                    color={t.dark ? "#4b5563" : "#9ca3af"}
                    name={m.name}
                    detail={m.role ?? "Manager"}
                    share={null}
                    access={admin ? accessOf(m.name) : null}
                    admin={admin}
                    onInvite={() => setInviting({ memberName: m.name })}
                    onRevoke={(p) => void revoke(p)}
                  />
                ))}
              </div>
            )}
          </Section>
        )}

        {admin && others.length > 0 && (
          <Section title="Also has access" count={others.length} info="People given this entity in BFO who aren't on its owner list.">
            <div className={`divide-y ${t.divide}`}>
              {others.map((p) => (
                <PersonRow key={p.userId} color={t.dark ? "#4b5563" : "#9ca3af"} name={p.name ?? p.phone} detail={p.memberName && p.memberName !== p.name ? `For ${p.memberName}` : "Invited"} share={null} access={p} admin onRevoke={(x) => void revoke(x)} />
              ))}
            </div>
          </Section>
        )}
        {error && <p className={`text-[12.5px] ${t.dark ? "text-red-300" : "text-red-600"}`}>{error}</p>}
      </div>

      <aside className="min-w-0 space-y-4">
        <div className={`rounded-2xl border p-5 ${t.surface}`}>
          <p className={`text-[13px] font-semibold ${t.text}`}>{admin ? "Invite owners to BFO" : "Your access"}</p>
          <p className={`mt-1.5 text-[12.5px] leading-relaxed ${t.muted}`}>
            {admin
              ? "An invitation gives them their own sign-in. They sign in with their phone number and see only the entities they're on: the documents, the operating agreement and who owns it. Nothing else in BFO."
              : `You can see ${asset.name}'s documents and owners. To change anything, contact Burton Family Office.`}
          </p>
          {admin && people && (
            <p className={`mt-3 text-[12px] ${t.soft}`}>
              {people.length ? `${people.length} ${people.length === 1 ? "person has" : "people have"} access.` : "No one outside the office has access yet."}
            </p>
          )}
        </div>
      </aside>

      {inviting &&
        createPortal(
          <InviteDialog
            entity={asset.name}
            memberName={inviting.memberName}
            assetId={page.id ?? ""}
            onClose={() => setInviting(null)}
            onDone={(list) => {
              setPeople(list);
            }}
          />,
          document.body
        )}
    </div>
  );
}

function PersonRow({
  color,
  name,
  detail,
  share,
  access,
  admin,
  onInvite,
  onRevoke,
  onEdit,
  onRemove,
}: {
  color: string;
  name: string;
  detail: string;
  share: number | null;
  access: Person | null;
  admin: boolean;
  onInvite?: () => void;
  onRevoke: (p: Person) => void;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  const t = useTone();
  const company = isCompany(name);
  const signedIn = !!access?.lastLoginAt && new Date(access.lastLoginAt) >= new Date(access.invitedAt);
  return (
    <div className="group flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
      <span
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[12.5px] font-semibold text-white"
        style={{ background: `linear-gradient(135deg, ${color}, ${color}aa)` }}
        aria-hidden
      >
        {company ? <Icon name="doc" className="h-4 w-4" /> : initials(name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-[13.5px] font-medium ${t.text}`}>{name}</p>
        <p className={`mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] ${t.muted}`}>
          <span>{detail}</span>
          {access && (
            <span className={`inline-flex items-center gap-1 ${signedIn ? (t.dark ? "text-emerald-300" : "text-emerald-700") : t.dark ? "text-amber-300" : "text-amber-700"}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {signedIn ? `Signed in ${day(access.lastLoginAt)}` : `Invited ${day(access.invitedAt)}`}
              {access.name && access.name !== name ? ` · ${access.name}` : ""}
            </span>
          )}
        </p>
      </div>
      {share != null && <span className={`font-brand text-[20px] tabular-nums ${t.text}`}>{Math.round(share * 100) / 100}%</span>}
      {admin && (
        <div className="flex shrink-0 items-center gap-1">
          {onInvite && (!access ? (
            <Button icon="mail" onClick={onInvite}>
              Invite to BFO
            </Button>
          ) : (
            <TextButton onClick={onInvite} className="mr-1">
              Resend
            </TextButton>
          ))}
          {access && <IconButton icon="x" label="Remove access" onClick={() => onRevoke(access)} />}
          {onEdit && <IconButton icon="edit" label="Edit" onClick={onEdit} />}
          {onRemove && <IconButton icon="trash" tone="danger" label="Remove from owners" onClick={onRemove} />}
        </div>
      )}
    </div>
  );
}

function MemberForm({ initial, onSave, onCancel }: { initial: Member; onSave: (m: Member) => Promise<void>; onCancel: () => void }) {
  const t = useTone();
  const [name, setName] = useState(initial.name);
  const [percent, setPercent] = useState(initial.percent == null ? "" : String(initial.percent));
  const [role, setRole] = useState(initial.role ?? "Member");
  const [busy, setBusy] = useState(false);
  const manager = /manager|director|officer/i.test(role);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const pct = Number.parseFloat(percent);
    await onSave({ name: name.trim(), percent: Number.isFinite(pct) ? pct : manager ? null : 0, role });
    setBusy(false);
  }
  return (
    <form onSubmit={(e) => void submit(e)} className={`grid grid-cols-2 items-end gap-2 px-5 py-3.5 sm:grid-cols-[1fr_140px_96px_auto] ${t.dark ? "bg-white/[0.015]" : "bg-gray-50/60"}`}>
      <label className="col-span-2 block sm:col-span-1">
        <span className={`mb-1 block text-[11.5px] ${t.muted}`}>Name</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Person or company" autoFocus />
      </label>
      <label className="block">
        <span className={`mb-1 block text-[11.5px] ${t.muted}`}>Role</span>
        <Select value={role} onChange={(e) => setRole(e.target.value)}>
          {["Member", "Managing Member", "Manager", "Shareholder", "Partner"].map((r) => (
            <option key={r}>{r}</option>
          ))}
        </Select>
      </label>
      <label className="block">
        <span className={`mb-1 block text-[11.5px] ${t.muted}`}>Share</span>
        <div className="relative">
          <Input value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" className="pr-6 text-right tabular-nums" placeholder={manager ? "—" : "0"} />
          <span className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] ${t.muted}`}>%</span>
        </div>
      </label>
      <div className="col-span-2 flex items-center justify-end gap-1.5 sm:col-span-1">
        <Button kind="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button kind="primary" type="submit" disabled={busy || !name.trim()}>
          Save
        </Button>
      </div>
    </form>
  );
}

function InviteDialog({ entity, memberName, assetId, onClose, onDone }: { entity: string; memberName: string; assetId: string; onClose: () => void; onDone: (people: Person[]) => void }) {
  const t = useTone();
  const company = isCompany(memberName);
  const [name, setName] = useState(company ? "" : memberName);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<{ sms: boolean; email: boolean } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await authFetch("/api/members", { method: "POST", body: JSON.stringify({ action: "invite", assetId, memberName, name, phone, email }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Couldn't send the invitation.");
      onDone(j.people ?? []);
      setSent(j.sent ?? { sms: false, email: false });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
      <div className="palette-backdrop absolute inset-0 bg-black/60 backdrop-blur-[3px]" onClick={() => !busy && onClose()} />
      <div role="dialog" aria-modal="true" aria-labelledby="invite-title" className={`palette-panel glass-panel relative w-full max-w-[460px] overflow-hidden border shadow-2xl max-sm:rounded-t-[22px] sm:rounded-[22px] ${t.dark ? "text-white" : "text-gray-900"}`}>
        {sent ? (
          <div className="p-7 text-center">
            <span className={`mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full ${t.dark ? "bg-emerald-400/15 text-emerald-300" : "bg-emerald-50 text-emerald-600"}`}>
              <Icon name="check" className="h-6 w-6" strokeWidth={2.2} />
            </span>
            <h2 className="mt-4 font-brand text-[24px]">{sent.sms || sent.email ? "Invitation sent" : "Access given"}</h2>
            <p className={`mt-2 text-[13px] leading-relaxed ${t.soft}`}>
              {sent.sms && sent.email
                ? `${name} got a text and an email.`
                : sent.sms
                  ? `${name} got a text.`
                  : sent.email
                    ? `${name} got an email. The text didn't go through.`
                    : `The text didn't go through. Tell ${name} to sign in at burtonfamilyoffice.com with ${phone}.`}{" "}
              They sign in with their phone number and see {entity}.
            </p>
            <Button kind="primary" size="md" onClick={onClose} className="mt-6">
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)}>
            <div className="px-6 pb-2 pt-6">
              <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${t.muted}`}>Invite to BFO</p>
              <h2 id="invite-title" className="mt-1.5 font-brand text-[24px] leading-tight">
                {company ? `Someone from ${memberName}` : memberName}
              </h2>
              <p className={`mt-2 text-[12.5px] leading-relaxed ${t.muted}`}>
                {company ? `${memberName} is a company: invite the person who represents it. ` : ""}They'll get a text, sign in with their phone and see only {entity}: its documents, operating agreement and owners.
              </p>
            </div>
            <div className="space-y-3 px-6 py-4">
              <label className="block">
                <span className={`mb-1.5 block text-[12px] ${t.muted}`}>Full name</span>
                <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!name} required />
              </label>
              <label className="block">
                <span className={`mb-1.5 block text-[12px] ${t.muted}`}>Mobile number</span>
                <Input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(602) 555-0100" autoFocus={!!name} required />
                <span className={`mt-1 block text-[11.5px] ${t.faint}`}>They sign in with this number.</span>
              </label>
              <label className="block">
                <span className={`mb-1.5 block text-[12px] ${t.muted}`}>Email</span>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional: we'll email the invitation too" />
              </label>
              {error && <p className={`text-[12.5px] ${t.dark ? "text-red-300" : "text-red-600"}`}>{error}</p>}
            </div>
            <div className={`flex items-center justify-end gap-2 border-t px-6 py-4 ${t.line}`}>
              <Button kind="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button kind="primary" size="md" type="submit" disabled={busy || !name.trim() || !phone.trim()}>
                {busy ? "Sending…" : "Send invitation"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
