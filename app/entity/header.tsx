/**
 * The top of an entity's page (docs/DESIGN.md §5.5, §8.11): the page header
 * (back to Entities, the name, one context line that says what it is, how
 * it's taxed, who owns it and any standing problem the state reports), the
 * actions, and the section tabs.
 *
 * Actions: on desktop, "…" (Dissolve, Archive), then Sync with Palm and
 * Edit as secondary buttons. On a phone, everything sits in "…". While
 * editing, the header holds only Cancel and Save changes (desktop) or a
 * sticky bar at the bottom (phone), and nothing else can be started.
 *
 * Prices never sit on a button: the sync's confirm states its cost.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router";
import { formingNow } from "../entity-addresses";
import { stateCode, stateName } from "../entity-paperwork";
import { effectiveRecord, recordLapsed } from "../palm";
import { Button, Card, ChoiceTiles, DateInput, Dialog, Field, IconButton, Input, PageHeader, Status, Tabs, Textarea, format, usePhone, type MenuItem } from "../ui";
import { getUser, isAdmin, isPartner } from "../auth";
import { useEntity } from "./context";
import type { KeyChangeNote } from "./use-entity";

const FORM_WORD: Record<string, string> = { LLC: "LLC", "C-Corp": "corporation", LP: "limited partnership", Trust: "trust" };

const TAXED: Record<string, string> = {
  "Disregarded Entity": "taxed as a disregarded entity",
  Partnership: "taxed as a partnership",
  "S Corporation": "taxed as an S corporation",
  "C Corporation": "taxed as a C corporation",
  "Grantor trust": "a grantor trust",
  "Non-grantor trust": "a non-grantor trust",
};

/** "taxed as a partnership", "a grantor trust": the tax class in the context line, only when one is recorded. */
function taxedAs(llcType: string | undefined): string | null {
  const v = (llcType ?? "").trim();
  return v ? (TAXED[v] ?? `taxed as ${v.toLowerCase()}`) : null;
}

/** The one status the header shows: an exception only (archived, dissolved, closing, behind with the state, forming). */
function useHeaderStatus() {
  const { asset } = useEntity();
  if (asset.archived) return <Status tone="neutral">Archived {format.date(new Date(asset.archived.at), "medium")}</Status>;
  if (asset.status === "Dissolved") return <Status tone="neutral">Dissolved</Status>;
  if (asset.closing && !asset.closing.closedAt) return <Status tone="warning">Being dissolved</Status>;
  const rec = asset.stateRecord ? effectiveRecord(asset.stateRecord, asset.stateConfirmed) : null;
  if (rec && recordLapsed(rec)) {
    const where = stateName(stateCode(asset.state) ?? "") || "The state";
    return (
      <Status tone="negative">
        Not in good standing in {where}, read {format.date(new Date(asset.stateRecord!.checkedAt), "medium")}
      </Status>
    );
  }
  if (formingNow(asset)) return <Status tone="info">Being formed</Status>;
  return null;
}

export function EntityHeader() {
  const { page, view, asset } = useEntity();
  const phone = usePhone();
  const partner = isPartner();
  const admin = isAdmin();
  const owner = asset.ownerId ? page.assetNames[asset.ownerId] : undefined;
  const status = useHeaderStatus();
  const archived = !!asset.archived;
  const where = stateName(stateCode(asset.state) ?? "");
  const form = `${where ? `${where} ` : ""}${FORM_WORD[view.etype] ?? view.etype}`;
  const tax = taxedAs(asset.llcType);
  const canEdit = !partner && !archived && ["owner", "admin", "member"].includes(getUser()?.role ?? "");
  // Palm connected, an entity it serves (not a trust), and someone who can change the record.
  const canSync = canEdit && !!page.palmMode && !view.isTrust;
  const { cents } = page.palmSyncPlan();
  const syncing = !!page.palmSync?.running;

  const context = (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>
        {form[0].toUpperCase() + form.slice(1)}
        {tax && <> · {tax}</>}
        {owner && (
          <>
            {" · "}Owned by{" "}
            <Link to={`/assets/${asset.ownerId}`} className="text-ink-2 underline decoration-line-strong underline-offset-[3px] hover:text-ink hover:decoration-ink-3">
              {owner}
            </Link>
          </>
        )}
      </span>
      {status}
    </span>
  );

  const menu: MenuItem[] = [];
  if (!partner && !page.editing) {
    if (phone && canEdit) menu.push({ label: "Edit", onSelect: () => page.startEditing() });
    if (phone && canSync) menu.push({ label: syncing ? "Syncing with Palm…" : "Sync with Palm…", onSelect: () => void page.syncWithPalm(), disabled: syncing || !!page.palmBusy });
    if (admin && !archived && !asset.closing && asset.status !== "Dissolved") menu.push({ label: "Dissolve…", hint: "Step by step", onSelect: () => void page.startClosing().then(() => page.goToTab("overview")) });
    if (admin) {
      if (menu.length) menu.push({ divider: true });
      if (archived) menu.push({ label: "Restore from the archive", onSelect: () => void page.restoreEntity() });
      else {
        menu.push({ label: "Archive…", hint: "Keeps everything", onSelect: () => void page.archiveEntity() });
        if (page.footprint().empty) menu.push({ label: "Remove from BFO…", hint: "Nothing on record", danger: true, onSelect: () => void page.handleDeleteAsset() });
      }
    }
  }

  const editing = page.editing;
  const secondary = phone ? undefined : editing ? (
    <Button onClick={() => void page.cancelEditing()} aria-label="Cancel editing">
      Cancel
    </Button>
  ) : (
    <>
      {canSync && (
        <Button icon="sync" busy={syncing} busyLabel="Syncing…" disabled={!!page.palmBusy} onClick={() => void page.syncWithPalm()} data-billed={cents > 0 && page.palmMode === "live" ? "yes" : "no"}>
          Sync with Palm
        </Button>
      )}
      {canEdit && (
        <Button icon="edit" onClick={() => page.startEditing()}>
          Edit
        </Button>
      )}
    </>
  );
  const primary =
    editing && !phone ? (
      <Button variant="primary" busy={page.saving} busyLabel="Saving…" disabled={!page.form.name?.trim()} onClick={() => void page.saveEdits()}>
        Save changes
      </Button>
    ) : undefined;

  return (
    <>
      <PageHeader title={asset.name} back={{ to: "/assets", label: "Entities" }} context={context} menu={menu.length ? menu : undefined} secondary={secondary} primary={primary} />
      {editing && !phone && !page.form.name?.trim() && <p className="ds mt-2 text-small text-ink-2">Add a name to save.</p>}
      {editing && phone && <EditBar />}
      <KeyChangeDialog />
    </>
  );
}

/** What the sync found, a line per step; it fills in as the sync runs. */
export function PalmSyncResults() {
  const { page } = useEntity();
  const sync = page.palmSync;
  if (!sync) return null;
  const tone = { good: "positive", warn: "warning", bad: "negative", muted: "neutral" } as const;
  return (
    <Card
      title={sync.running ? `Syncing with Palm · ${sync.step}…` : `Synced with Palm${sync.mode === "test" ? " in test mode" : ""}`}
      action={!sync.running ? <IconButton icon="x" label="Close" onClick={() => page.setPalmSync(null)} /> : undefined}
    >
      <ul className="flex flex-col gap-2" aria-live="polite">
        {sync.lines.map((l, i) => (
          <li key={i} className="flex flex-col gap-[2px] sm:flex-row sm:gap-3">
            <span className="shrink-0 sm:w-[144px]">
              <Status tone={tone[l.tone]}>{l.label}</Status>
            </span>
            <span className="min-w-0 text-body text-pretty text-ink-2">{l.text}</span>
          </li>
        ))}
      </ul>
      {!sync.running && sync.cents > 0 && sync.mode === "live" && <p className="mt-3 text-small text-ink-2">State records read: up to {format.money(sync.cents / 100)}, billed to the office’s Palm account.</p>}
    </Card>
  );
}

/**
 * The phone's edit bar: Cancel and Save changes, sticky above the safe area,
 * 44px tall. The Ask button hides while it shows (html[data-selection]).
 */
function EditBar() {
  const { page } = useEntity();
  useEffect(() => {
    const html = document.documentElement;
    html.dataset.selection = "entity-edit";
    return () => {
      if (html.dataset.selection === "entity-edit") delete html.dataset.selection;
    };
  }, []);
  return (
    <div className="ds fixed inset-x-0 bottom-0 z-fab border-t border-line bg-raised px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
      {page.saveError && <p className="mb-2 text-small text-negative">{page.saveError}</p>}
      <div className="flex gap-2">
        <Button full onClick={() => void page.cancelEditing()} aria-label="Cancel editing">
          Cancel
        </Button>
        <Button full variant="primary" busy={page.saving} busyLabel="Saving…" disabled={!page.form.name?.trim()} onClick={() => void page.saveEdits()}>
          Save changes
        </Button>
      </div>
    </div>
  );
}

/**
 * Asked on Save when a key fact already on record changes (legal name, form,
 * tax class, EIN): is it a correction of the record, or a real change that
 * may need a filing? A real change takes its effective date; either way the
 * reason goes in Activity, and a tax class joins the class's history.
 */
function KeyChangeDialog() {
  const { page } = useEntity();
  const changes = page.keyChange;
  const [kind, setKind] = useState<"correction" | "change" | null>(null);
  const [effective, setEffective] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (changes) {
      setKind(null);
      setEffective(null);
      setReason("");
    }
  }, [changes]);
  const open = !!changes;
  const ready = !!kind && reason.trim().length > 2 && (kind === "correction" || !!effective);
  const filings = (changes ?? [])
    .map((c) => (c.key === "llcType" ? "Form 8832 or 2553 and the IRS's acceptance" : c.key === "type" ? "a conversion filed with the state" : c.key === "name" ? "articles of amendment" : null))
    .filter(Boolean);
  const save = () => {
    if (!changes || !kind) return;
    const note: KeyChangeNote = { fields: changes.map((c) => c.key), kind, reason: reason.trim(), effective: kind === "change" ? effective : null };
    void page.saveEdits(note);
  };
  return (
    <Dialog
      open={open}
      onClose={() => page.setKeyChange(null)}
      title="Is this a correction or a real change?"
      description="These facts have legal and tax weight, so the record keeps why they changed."
      size="md"
      footer={
        <>
          <Button onClick={() => page.setKeyChange(null)}>Keep editing</Button>
          <Button variant="primary" disabled={!ready} disabledReason={ready ? undefined : "Choose one and say why"} busy={page.saving} busyLabel="Saving…" onClick={save}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-1 text-body text-ink">
          {(changes ?? []).map((c) => (
            <li key={c.key} className="break-words">
              <span className="text-ink-2">{c.label[0].toUpperCase() + c.label.slice(1)}: </span>
              {c.from || "blank"} → {c.to || "blank"}
            </li>
          ))}
        </ul>
        <ChoiceTiles
          label="What happened?"
          value={kind}
          onChange={setKind}
          stacked
          options={[
            { value: "correction", title: "Correcting the record", description: "It was always this; what was on record was a mistake." },
            {
              value: "change",
              title: "A real change",
              description: `It changed on a date${filings.length ? `, and needs ${filings.join(" and ")}` : ""}. Add the filing to Documents once it's made.`,
            },
          ]}
        />
        {kind === "change" && (
          <Field label="Effective">
            <DateInput value={effective} onChange={setEffective} />
          </Field>
        )}
        <Field label="Why" hint="Shown in Activity with the change.">
          {kind === "change" ? (
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          ) : (
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="The articles say so" />
          )}
        </Field>
        {page.saveError && <p className="text-small text-negative">{page.saveError}</p>}
      </div>
    </Dialog>
  );
}

/** The sections of the record, as tabs; on a phone with five or more, a section button that opens the list. */
export function CategoryMenu() {
  const { view, tabPath } = useEntity();
  return <Tabs label="Entity sections" items={view.tabs.map((t) => ({ to: tabPath(t.key), label: t.label, count: t.alert ? t.count : undefined, end: t.key === "overview" }))} />;
}
