/**
 * Governance (a corporation): the board, the officers, the stock and its
 * shareholders, on one page of cards, no tabs inside the tab.
 *
 * - Directors and officers are recorded with when and how they came to
 *   office (an election, a written consent) and the document; one who
 *   leaves is kept, with the date and why. Deleting is only for an entry
 *   made in error.
 * - The shareholders are the one register on the Shareholders tab (the
 *   entity's owner list, with shares and class); here they're checked
 *   against the stock: issued against authorized, holdings against issued,
 *   and, for an S corporation, one class of stock and eligible holders.
 * - State filings and their dates live on the Compliance tab, worked out
 *   from the state's record; only the tax year's end is kept here, on the
 *   entity's record where the deadlines read it.
 * - Every change also goes into corp/history, dated and with who made it.
 */

import { useMemo, useState } from "react";
import { getUser, isAdmin, isPartner } from "../auth";
import {
  Banner,
  Button,
  Card,
  CardSection,
  ChoiceTiles,
  DateInput,
  Dialog,
  Disclosure,
  Empty,
  Field,
  Input,
  List,
  ListRow,
  Row,
  Rows,
  Select,
  TextLink,
  confirm,
  format,
  toast,
  type MenuItem,
  type Option,
} from "../ui";
import { useEntity } from "./context";
import type { AssetDoc } from "./model";
import { capTableChecks, holdsShare, pct, sameName, type OwnerRow } from "./people-model";

type Officer = {
  id: string;
  name: string;
  title: string;
  since: string;
  /** How they came to office. */
  electedBy?: string | null;
  doc?: { id: string; name: string } | null;
  /** When they left office, and why (kept rather than deleted). */
  until?: string | null;
  leftReason?: string | null;
};

type CorpRecord = {
  authorizedShares?: number;
  issuedShares?: number;
  parValue?: string;
  stockClasses?: string;
  lastBoardMeeting?: string;
  nextBoardMeeting?: string;
  shareholders?: Record<string, { name: string; shares: number; class: string; percentage: number }>;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const OFFICER_TITLES = ["President", "Chief Executive Officer", "Chief Financial Officer", "Treasurer", "Secretary", "Vice President"];
const DIRECTOR_BASIS = ["Named by the incorporator", "Elected at a shareholders’ meeting", "Written consent of the shareholders", "Appointed by the board to fill a vacancy"];
const OFFICER_BASIS = ["Appointed at a board meeting", "Written consent of the board", "As the bylaws provide"];

async function store() {
  return import("../store");
}

/** One dated line in the corporation's own history. */
async function logCorp(assetId: string, entry: Record<string, unknown>) {
  const { db, push, ref } = await store();
  await push(ref(db, `assets/${assetId}/corp/history`), { ...entry, at: Date.now(), by: getUser()?.name ?? null });
}

function docOptions(docs: AssetDoc[]): Option<string>[] {
  return [...docs].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).map((d) => ({ value: d.id, label: d.name }));
}

export function GovernanceTab() {
  const { page, asset, tabPath } = useEntity();
  const admin = isAdmin() && !isPartner();
  const [dialog, setDialog] = useState<
    { kind: "add"; office: "director" | "officer" } | { kind: "leave"; office: "director" | "officer"; person: Officer } | { kind: "stock" } | { kind: "meetings" } | { kind: "year" } | null
  >(null);
  const [error, setError] = useState("");
  if (asset.type !== "C-Corp") return null;

  const corp = (page.corpData ?? {}) as CorpRecord;
  const directors = page.directors as Officer[];
  const officers = page.officers as Officer[];
  const sitting = (l: Officer[]) => l.filter((p) => !p.until);
  const former = (l: Officer[]) => l.filter((p) => p.until);
  const holders = ((asset.members ?? []) as OwnerRow[]).filter(holdsShare);
  const issued = corp.issuedShares || null;
  const holdersWithPct = holders.map((h) => ({ ...h, percent: issued && h.shares != null ? Math.round((h.shares / issued) * 10000) / 100 : h.percent }));
  const checks = capTableChecks({ authorized: corp.authorizedShares ?? null, issued, holders: holdersWithPct, taxClass: asset.llcType, classes: corp.stockClasses });
  const legacy = Object.values(corp.shareholders ?? {}).filter((s) => s?.name && !holders.some((h) => sameName(h.name, s.name)));
  const formed = asset.formationDate || null;
  const taxYearEnd = Number((asset as { taxYearEnd?: number | string }).taxYearEnd) || null;

  async function moveLegacy() {
    const next = [
      ...((asset.members ?? []) as OwnerRow[]),
      ...legacy.map((s) => ({ name: s.name, role: "Shareholder", percent: s.percentage || null, shares: s.shares || null, shareClass: s.class || "Common" })),
    ];
    try {
      await page.patchAsset({ members: next, membersEditedAt: format.isoDate(new Date()) });
      await logCorp(page.id ?? "", { kind: "register", summary: `Moved ${format.count(legacy.length, "shareholder")} from the old register to the shareholder list` });
      toast({ message: `Moved ${format.count(legacy.length, "shareholder")} to the shareholder list` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t move them.");
    }
  }

  const officeCard = (office: "director" | "officer") => {
    const all = office === "director" ? directors : officers;
    const now = sitting(all);
    const past = former(all);
    const noun = office === "director" ? "director" : "officer";
    const row = (p: Officer) => {
      const menu: MenuItem[] = admin
        ? [
            { label: "Record that they left office…", onSelect: () => setDialog({ kind: "leave", office, person: p }) },
            { divider: true },
            {
              label: "Delete: entered in error",
              icon: "trash",
              danger: true,
              onSelect: () =>
                void (async () => {
                  const ok = await confirm({
                    title: `Delete ${p.name} from the ${office === "director" ? "board" : "officers"}?`,
                    object: { name: p.name, detail: [p.title, p.since ? `Since ${format.date(p.since, "medium")}` : null].filter(Boolean).join(" · ") },
                    message: "Only for an entry made by mistake: they never held the office. Someone who served and left should be recorded as leaving, so the board’s history stays whole.",
                    confirmLabel: "Delete entry",
                    tone: "danger",
                    irreversible: true,
                  });
                  if (!ok) return;
                  try {
                    const { db, ref, remove } = await store();
                    await remove(ref(db, `assets/${page.id}/corp/${office === "director" ? "directors" : "officers"}/${p.id}`));
                    await logCorp(page.id ?? "", { kind: "delete", office, name: p.name, title: p.title, since: p.since || null, reason: "Entered in error" });
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Couldn’t delete it.");
                  }
                })(),
            },
          ]
        : [];
      return (
        <ListRow
          key={p.id}
          label={p.name}
          title={p.name}
          secondary={[
            p.title,
            p.until
              ? `${p.since ? `${format.date(p.since, "medium")} – ` : "Until "}${format.date(p.until, "medium")}${p.leftReason ? ` · ${p.leftReason}` : ""}`
              : p.since
                ? `Since ${format.date(p.since, "medium")}`
                : "Since: not on record",
            p.until ? null : p.electedBy,
            p.doc?.name,
          ]
            .filter(Boolean)
            .join(" · ")}
          menu={menu.length ? menu : undefined}
        />
      );
    };
    return (
      <Card
        title={office === "director" ? "Board of directors" : "Officers"}
        count={now.length || undefined}
        info={
          office === "director"
            ? "The board approves the officers and the corporation’s major decisions. A corporation needs at least one director."
            : "The officers run the corporation day to day, appointed by the board."
        }
        action={
          admin ? (
            <Button variant="quiet" size="sm" icon="plus" onClick={() => setDialog({ kind: "add", office })}>
              Add {noun}
            </Button>
          ) : undefined
        }
        flush={now.length > 0 || past.length > 0}
      >
        {now.length === 0 ? (
          <div className={past.length ? "px-5 pt-4 touch:px-4" : undefined}>
            {office === "director" ? (
              <Banner tone="warning">No directors on record. A corporation needs at least one; record the board from the incorporator’s action or the shareholders’ election.</Banner>
            ) : (
              <Empty>No officers on record. Most states expect at least a president and a secretary; the bylaws say which.</Empty>
            )}
          </div>
        ) : (
          <List label={office === "director" ? "Directors" : "Officers"}>{now.map(row)}</List>
        )}
        {past.length > 0 && (
          <div className="border-t border-line px-5 py-3 touch:px-4">
            <Disclosure label={office === "director" ? "Former directors" : "Former officers"} count={past.length}>
              <List label="Former">{past.map(row)}</List>
            </Disclosure>
          </div>
        )}
        {office === "director" && (
          <div className="border-t border-line px-5 py-4 touch:px-4">
            <CardSection
              title="Meetings"
              action={
                admin ? (
                  <Button variant="quiet" size="sm" onClick={() => setDialog({ kind: "meetings" })}>
                    Edit
                  </Button>
                ) : undefined
              }
            >
              <Rows>
                <Row label="Last board meeting">{corp.lastBoardMeeting ? format.date(corp.lastBoardMeeting, "medium") : undefined}</Row>
                <Row label="Next board meeting">{corp.nextBoardMeeting ? format.date(corp.nextBoardMeeting, "medium") : undefined}</Row>
              </Rows>
            </CardSection>
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className="ds flex flex-col gap-4">
      {!formed && (
        <Banner tone="info">
          No incorporation date on record. Record when and where it was incorporated (Overview) before recording its board: directors serve from incorporation at the earliest.
        </Banner>
      )}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {officeCard("director")}
        {officeCard("officer")}
      </div>

      <Card
        title="Stock"
        action={
          admin ? (
            <Button variant="quiet" size="sm" icon="edit" onClick={() => setDialog({ kind: "stock" })}>
              Edit
            </Button>
          ) : undefined
        }
      >
        <Rows>
          <Row label="Authorized shares">{corp.authorizedShares ? corp.authorizedShares.toLocaleString("en-US") : undefined}</Row>
          <Row label="Issued shares">{corp.issuedShares ? corp.issuedShares.toLocaleString("en-US") : undefined}</Row>
          <Row label="Par value">{corp.parValue || undefined}</Row>
          <Row label="Classes">{corp.stockClasses || undefined}</Row>
          <Row
            label="Tax year ends"
            action={
              admin ? (
                <Button variant="quiet" size="sm" onClick={() => setDialog({ kind: "year" })}>
                  Change
                </Button>
              ) : undefined
            }
            hint="The deadlines on Compliance follow it."
          >
            {taxYearEnd ? MONTHS[taxYearEnd - 1] : "December (a calendar year, unless you record otherwise)"}
          </Row>
        </Rows>
      </Card>

      <Card
        title="Shareholders"
        count={holders.length || undefined}
        info="The corporation’s one shareholder register: the Shareholders tab keeps it, with each holder’s shares and class."
        action={<TextLink to={tabPath("people")}>Edit on Shareholders</TextLink>}
        flush={holders.length > 0}
      >
        {legacy.length > 0 && (
          <div className="px-5 pt-4 touch:px-4">
            <Banner
              tone="info"
              action={
                admin ? (
                  <Button variant="quiet" size="sm" onClick={() => void moveLegacy()}>
                    Move them
                  </Button>
                ) : undefined
              }
            >
              {format.count(legacy.length, "shareholder")} {legacy.length === 1 ? "is" : "are"} recorded only in the old corporate register ({format.list(legacy.map((s) => s.name))}). Move{" "}
              {legacy.length === 1 ? "it" : "them"} to the shareholder list so there’s one register.
            </Banner>
          </div>
        )}
        {holders.length === 0 ? (
          legacy.length ? null : (
            <Empty>No shareholders on record.</Empty>
          )
        ) : (
          <List label="Shareholders">
            {holdersWithPct.map((h) => (
              <ListRow
                key={h.name}
                label={h.name}
                title={h.name}
                secondary={[h.shares != null ? `${h.shares.toLocaleString("en-US")} shares` : "Shares not on record", h.shareClass ?? "Common"].join(" · ")}
                trailing={h.percent != null ? pct(h.percent) : undefined}
              />
            ))}
          </List>
        )}
        {checks.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-line px-5 py-4 touch:px-4">
            {checks.map((c) => (
              <Banner key={c.text} tone={c.tone}>
                {c.text}
              </Banner>
            ))}
          </div>
        )}
      </Card>
      {error && <Banner tone="negative">{error}</Banner>}

      {dialog?.kind === "add" && <OfficeDialog office={dialog.office} formed={formed} docs={page.docs} onClose={() => setDialog(null)} />}
      {dialog?.kind === "leave" && <LeaveDialog office={dialog.office} person={dialog.person} docs={page.docs} onClose={() => setDialog(null)} />}
      {dialog?.kind === "stock" && <StockDialog corp={corp} onClose={() => setDialog(null)} />}
      {dialog?.kind === "meetings" && <MeetingsDialog corp={corp} onClose={() => setDialog(null)} />}
      {dialog?.kind === "year" && <YearDialog current={taxYearEnd} onClose={() => setDialog(null)} />}
    </div>
  );
}

// ── Dialogs ──────────────────────────────────────────────────────────────

function useSave(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (work: () => Promise<void>, done?: string) => {
    setBusy(true);
    setError("");
    try {
      await work();
      if (done) toast({ message: done });
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn’t save it. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function Footer({ busy, onClose, label, disabled, reason, onSave }: { busy: boolean; onClose: () => void; label: string; disabled?: boolean; reason?: string; onSave: () => void }) {
  return (
    <>
      <Button onClick={onClose} disabled={busy}>
        Cancel
      </Button>
      <Button variant="primary" busy={busy} busyLabel="Saving…" disabled={disabled} disabledReason={reason} onClick={onSave}>
        {label}
      </Button>
    </>
  );
}

function OfficeDialog({ office, formed, docs, onClose }: { office: "director" | "officer"; formed: string | null; docs: AssetDoc[]; onClose: () => void }) {
  const { page } = useEntity();
  const [name, setName] = useState("");
  const [title, setTitle] = useState<string | null>(office === "director" ? "Director" : null);
  const [otherTitle, setOtherTitle] = useState("");
  const [since, setSince] = useState<string | null>(null);
  const [basis, setBasis] = useState<string | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const { busy, error, run } = useSave(onClose);
  const finalTitle = title === "Other" ? otherTitle.trim() : (title ?? "");
  const early = !!since && !!formed && since < formed;
  const errs = {
    name: tried && !name.trim() ? "Add their full name." : undefined,
    title: tried && !finalTitle ? "Choose their title." : undefined,
    since: tried && !since ? "Add the date they took office." : early ? `That’s before it was incorporated (${format.date(formed!, "medium")}).` : undefined,
    basis: tried && !basis ? `Say how they ${office === "director" ? "were elected" : "were appointed"}.` : undefined,
  };
  const save = () => {
    setTried(true);
    if (!name.trim() || !finalTitle || !since || !basis || early) return;
    const doc = docs.find((d) => d.id === docId);
    const record = { name: name.trim(), title: finalTitle, since, electedBy: basis, ...(doc ? { doc: { id: doc.id, name: doc.name } } : {}) };
    void run(async () => {
      const { db, push, ref } = await store();
      await push(ref(db, `assets/${page.id}/corp/${office === "director" ? "directors" : "officers"}`), record);
      await logCorp(page.id ?? "", { kind: "add", office, ...record });
    }, `Added ${record.name}`);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={office === "director" ? "Add a director" : "Add an officer"}
      dirty={!!name.trim() && !busy}
      footer={<Footer busy={busy} onClose={onClose} label={office === "director" ? "Add director" : "Add officer"} onSave={save} />}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Full name" error={errs.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Title" error={errs.title}>
          <Select
            label="Title"
            value={title}
            onChange={setTitle}
            placeholder="Choose a title"
            options={(office === "director" ? ["Director", "Chair of the board"] : OFFICER_TITLES).concat("Other").map((t) => ({ value: t, label: t }))}
          />
        </Field>
        {title === "Other" && (
          <Field label="Their title">
            <Input value={otherTitle} onChange={(e) => setOtherTitle(e.target.value)} />
          </Field>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="In office since" error={errs.since}>
            <DateInput value={since} onChange={setSince} />
          </Field>
          <Field label={office === "director" ? "Elected by" : "Appointed by"} error={errs.basis}>
            <Select
              label={office === "director" ? "Elected by" : "Appointed by"}
              value={basis}
              onChange={setBasis}
              placeholder="Choose"
              options={(office === "director" ? DIRECTOR_BASIS : OFFICER_BASIS).map((b) => ({ value: b, label: b }))}
            />
          </Field>
        </div>
        <Field label="Document" optional hint="The minutes or written consent, filed in Documents.">
          <Select label="Document" value={docId} onChange={setDocId} placeholder={docs.length ? "Choose a document" : "No documents filed yet"} disabled={!docs.length} options={docOptions(docs)} />
        </Field>
        <p className="text-small text-ink-2">This records {office === "director" ? "a director already elected; it doesn’t elect them" : "an officer already appointed; it doesn’t appoint them"}.</p>
        {error && <Banner tone="negative">{error}</Banner>}
      </form>
    </Dialog>
  );
}

function LeaveDialog({ office, person, docs, onClose }: { office: "director" | "officer"; person: Officer; docs: AssetDoc[]; onClose: () => void }) {
  const { page } = useEntity();
  const [reason, setReason] = useState<string | null>(null);
  const [until, setUntil] = useState<string | null>(format.isoDate(new Date()));
  const [docId, setDocId] = useState<string | null>(null);
  const { busy, error, run } = useSave(onClose);
  const words = office === "director" ? "the board" : "office";
  const save = () => {
    if (!reason || !until) return;
    const doc = docs.find((d) => d.id === docId);
    void run(async () => {
      const { db, ref, update } = await store();
      await update(ref(db, `assets/${page.id}/corp/${office === "director" ? "directors" : "officers"}/${person.id}`), {
        until,
        leftReason: reason,
        ...(doc ? { leftDoc: { id: doc.id, name: doc.name } } : {}),
      });
      await logCorp(page.id ?? "", { kind: "leave", office, name: person.name, title: person.title, until, reason, doc: doc ? { id: doc.id, name: doc.name } : null });
    }, `Recorded that ${person.name} left ${words}`);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Record that ${person.name} left ${words}?`}
      description="This changes BFO’s record only. They stay listed as a former member, with the date. Their resignation, the resolution or the shareholders’ vote belongs in Documents."
      footer={<Footer busy={busy} onClose={onClose} label="Record it" disabled={!reason || !until} reason={!reason ? "Say why first" : !until ? "Add the date" : undefined} onSave={save} />}
    >
      <div className="flex flex-col gap-4">
        <ChoiceTiles
          label="Why"
          value={reason}
          onChange={setReason}
          stacked
          options={[
            { value: "Resigned", title: "Resigned" },
            { value: office === "director" ? "Removed by the shareholders" : "Removed by the board", title: office === "director" ? "Removed by the shareholders" : "Removed by the board" },
            { value: "Term ended", title: "Term ended" },
            { value: "Died", title: "Died" },
          ]}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="As of">
            <DateInput value={until} onChange={setUntil} />
          </Field>
          <Field label="Document" optional>
            <Select label="Document" value={docId} onChange={setDocId} placeholder={docs.length ? "Choose a document" : "No documents filed yet"} disabled={!docs.length} options={docOptions(docs)} />
          </Field>
        </div>
        {error && <Banner tone="negative">{error}</Banner>}
      </div>
    </Dialog>
  );
}

function StockDialog({ corp, onClose }: { corp: CorpRecord; onClose: () => void }) {
  const { page } = useEntity();
  const [authorized, setAuthorized] = useState(corp.authorizedShares ? String(corp.authorizedShares) : "");
  const [issued, setIssued] = useState(corp.issuedShares ? String(corp.issuedShares) : "");
  const [par, setPar] = useState(corp.parValue ?? "");
  const [classes, setClasses] = useState(corp.stockClasses ?? "");
  const { busy, error, run } = useSave(onClose);
  const a = authorized ? Number(authorized) : null;
  const i = issued ? Number(issued) : null;
  const over = a !== null && i !== null && i > a;
  const next = useMemo(() => ({ authorizedShares: a ?? 0, issuedShares: i ?? 0, parValue: par.trim(), stockClasses: classes.trim() }), [a, i, par, classes]);
  const before = { authorizedShares: corp.authorizedShares ?? 0, issuedShares: corp.issuedShares ?? 0, parValue: corp.parValue ?? "", stockClasses: corp.stockClasses ?? "" };
  const changed = JSON.stringify(next) !== JSON.stringify(before);
  const save = () => {
    if (over || !changed) return;
    void run(async () => {
      const { db, ref, update } = await store();
      await update(ref(db, `assets/${page.id}/corp`), next);
      const fields = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== before[k]).map((k) => ({ field: k, from: before[k] || null, to: next[k] || null }));
      await logCorp(page.id ?? "", { kind: "stock", fields });
    }, "Saved the stock");
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Stock"
      description="From the articles of incorporation and the stock ledger."
      dirty={changed && !busy}
      footer={
        <Footer
          busy={busy}
          onClose={onClose}
          label="Save"
          disabled={over || !changed}
          reason={over ? "Issued can’t exceed authorized" : !changed ? "Nothing has changed yet" : undefined}
          onSave={save}
        />
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Authorized shares" hint="In the articles.">
            <Input inputMode="numeric" className="tabular-nums" value={authorized} onChange={(e) => setAuthorized(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label="Issued shares" error={over ? "More than are authorized: an over-issuance." : undefined}>
            <Input inputMode="numeric" className="tabular-nums" value={issued} onChange={(e) => setIssued(e.target.value.replace(/\D/g, ""))} />
          </Field>
        </div>
        <Field label="Par value" optional>
          <Input prefix="$" inputMode="decimal" className="tabular-nums" value={par} onChange={(e) => setPar(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.0001" />
        </Field>
        <Field label="Classes" optional hint="As the articles name them: “Common”, or “Common; Series A Preferred”.">
          <Input value={classes} onChange={(e) => setClasses(e.target.value)} />
        </Field>
        {error && <Banner tone="negative">{error}</Banner>}
      </form>
    </Dialog>
  );
}

function MeetingsDialog({ corp, onClose }: { corp: CorpRecord; onClose: () => void }) {
  const { page } = useEntity();
  const [last, setLast] = useState<string | null>(corp.lastBoardMeeting || null);
  const [next, setNext] = useState<string | null>(corp.nextBoardMeeting || null);
  const { busy, error, run } = useSave(onClose);
  const save = () =>
    void run(async () => {
      const { db, ref, update } = await store();
      await update(ref(db, `assets/${page.id}/corp`), { lastBoardMeeting: last ?? "", nextBoardMeeting: next ?? "" });
      await logCorp(page.id ?? "", { kind: "meetings", last, next });
    });
  return (
    <Dialog open onClose={onClose} title="Board meetings" footer={<Footer busy={busy} onClose={onClose} label="Save" onSave={save} />}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Last meeting" optional>
          <DateInput value={last} onChange={setLast} />
        </Field>
        <Field label="Next meeting" optional>
          <DateInput value={next} onChange={setNext} />
        </Field>
        {error && <Banner tone="negative">{error}</Banner>}
      </div>
    </Dialog>
  );
}

function YearDialog({ current, onClose }: { current: number | null; onClose: () => void }) {
  const { page } = useEntity();
  const [month, setMonth] = useState<string | null>(current ? String(current) : "12");
  const { busy, error, run } = useSave(onClose);
  const save = () =>
    void run(async () => {
      await page.patchAsset({ taxYearEnd: Number(month) });
      await logCorp(page.id ?? "", { kind: "tax-year", from: current, to: Number(month) });
    }, "Saved the tax year");
  return (
    <Dialog
      open
      onClose={onClose}
      title="When its tax year ends"
      description="A calendar year ends in December. A different fiscal year needs the IRS’s approval or an election; it moves the corporation’s return and estimated-tax dates."
      footer={<Footer busy={busy} onClose={onClose} label="Save" disabled={!month || Number(month) === current} onSave={save} />}
    >
      <Field label="Last month of the tax year">
        <Select label="Last month of the tax year" value={month} onChange={setMonth} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
      </Field>
      {error && <Banner tone="negative">{error}</Banner>}
    </Dialog>
  );
}
