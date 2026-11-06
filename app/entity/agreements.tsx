/**
 * The Contracts tab (an LLC's management services agreements): who each is
 * with, which way the money goes, the fee as money, the term, and where it
 * stands, which follows what happened to it (drafted, sent for signature,
 * signed, terminated), never a picker.
 *
 * - The fee is an amount with its frequency ("$8,000.00 a month"); the
 *   footer totals what's contracted, monthly and for a year.
 * - A contract with one of the family's own entities is marked "Related
 *   party" and links to it.
 * - Terms can be edited only before the agreement goes out; a signed one
 *   changes by amendment. A draft can be deleted; anything that went out or
 *   was signed is archived instead, and terminating one asks for the notice
 *   and end dates.
 * - Each change also goes into the contract's history (who, when, before
 *   and after).
 *
 * The rules are in contract-terms.ts; the document is msa-document.ts.
 */

import { useEffect, useMemo, useState } from "react";
import { getUser, isAdmin, isPartner } from "../auth";
import type { SignatureRequest } from "../sign/api";
import { listRequests } from "./contract-requests";
import {
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  DateInput,
  Dialog,
  Disclosure,
  Empty,
  Field,
  IconButton,
  Input,
  List,
  ListRow,
  Menu,
  MoneyInput,
  MultiSelect,
  Segmented,
  Select,
  Sheet,
  Status,
  Table,
  confirm,
  format,
  toast,
  usePhone,
  type Column,
  type MenuItem,
} from "../ui";
import { useEntity } from "./context";
import {
  ADVISORY_SERVICES,
  COUNTERPARTY_FORMS,
  FREQUENCIES,
  STAGE,
  TERMS,
  TERM_MONTHLY,
  addDays,
  annualized,
  countsAsContracted,
  deletable,
  familyEntityNamed,
  feeAmount,
  feeShort,
  frequencyOf,
  looksProfessional,
  pastDueUnsigned,
  renewal,
  signedDate,
  stageOf,
  termsEditable,
  todayLocal,
  type Stage,
} from "./contract-terms";
import { MSA_SERVICES, type AssetDoc, type OperatingContract } from "./model";

/** A contract as stored, with the fields this area adds. */
export type Contract = OperatingContract & {
  amount?: number | null;
  counterpartyType?: "affiliate" | "third-party" | null;
  counterpartyForm?: string | null;
  counterpartyState?: string | null;
  referralTerms?: string | null;
  masthead?: "trade" | "legal" | null;
  signedOn?: string | null;
  signedCopy?: { id: string; name: string } | null;
  noticeGivenOn?: string | null;
  terminatedOn?: string | null;
  archivedAt?: number | null;
};

/** The entity's trade name, when one is on record (and filed). */
export type TradeName = { name: string; filedOn?: string | null; state?: string | null };

type Row = { c: Contract; stage: Stage; request: SignatureRequest | null; related: { id: string; name: string } | null };

async function store() {
  return import("../store");
}

/** The contract's own history: what changed, when and by whom. */
async function logContract(assetId: string, contractId: string, entry: Record<string, unknown>) {
  const { db, push, ref } = await store();
  await push(ref(db, `assets/${assetId}/contractHistory`), { contractId, ...entry, at: Date.now(), by: getUser()?.name ?? null });
}

/** The newest live (or completed) signature request for each of this entity's contracts. */
function useRequests(assetId: string): Map<string, SignatureRequest> {
  const [map, setMap] = useState<Map<string, SignatureRequest>>(new Map());
  useEffect(() => {
    if (!assetId || isPartner()) return;
    let alive = true;
    listRequests()
      .then((all) => {
        if (!alive) return;
        const m = new Map<string, SignatureRequest>();
        for (const r of all) {
          if (r.asset_id !== assetId || !r.contract_id || r.status === "voided" || r.status === "declined") continue;
          const have = m.get(r.contract_id);
          if (!have || (r.created_at ?? "") > (have.created_at ?? "")) m.set(r.contract_id, r);
        }
        setMap(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [assetId]);
  return map;
}

export function AgreementsTab() {
  const { page, asset } = useEntity();
  const admin = isAdmin() && !isPartner();
  const phone = usePhone();
  const requests = useRequests(page.id ?? "");
  const [sheet, setSheet] = useState<{ contract: Contract | null } | null>(null);
  const [dialog, setDialog] = useState<{ kind: "signed" | "terminate"; c: Contract } | { kind: "trade" } | null>(null);
  const [error, setError] = useState("");
  const trade = (asset as { tradeName?: TradeName | null }).tradeName ?? null;

  const entities = useMemo(
    () =>
      Object.entries(page.allAssets ?? {})
        .filter(([id, a]) => id !== page.id && a?.name)
        .map(([id, a]) => ({ id, name: String(a.name), ownerId: (a as { ownerId?: string }).ownerId ?? null })),
    [page.allAssets, page.id],
  );

  const rows: Row[] = (page.contracts as Contract[]).map((c) => {
    const request = requests.get(c.id) ?? null;
    return { c, stage: stageOf(c, request), request, related: familyEntityNamed(c.counterparty, entities) };
  });
  const live = rows.filter((r) => r.stage !== "archived");
  const archived = rows.filter((r) => r.stage === "archived");
  const counted = live.filter((r) => countsAsContracted(r.stage));
  const yearly = counted.reduce((s, r) => s + (annualized(r.c) ?? 0), 0);
  const unsignedLive = live.filter((r) => pastDueUnsigned(r.c, r.stage));
  const subsidiaries = entities.filter((e) => e.ownerId === page.id && !rows.some((r) => familyEntityNamed(r.c.counterparty, [e])));

  const open = (c: Contract) => void page.navigate(`/assets/${page.id}/contract/${c.id}`);

  async function draftSubsidiaries() {
    const names = subsidiaries.map((s) => s.name);
    const ok = await confirm({
      title: `Draft ${format.count(names.length, "MSA")} for the subsidiaries?`,
      object: { names },
      message: `Each starts as a draft dated today, month to month, with no fee or services yet. Nothing is sent.`,
      confirmLabel: `Draft ${format.count(names.length, "MSA")}`,
    });
    if (!ok) return;
    try {
      const { db, push, ref } = await store();
      for (const s of subsidiaries) {
        const key = await push(ref(db, `assets/${page.id}/contracts`), {
          counterparty: s.name,
          role: "manager",
          services: [],
          fee: "",
          amount: null,
          frequency: "Monthly",
          effectiveDate: todayLocal(),
          term: TERM_MONTHLY,
          status: "draft",
          counterpartyType: "affiliate",
          masthead: trade ? "trade" : "legal",
          createdAt: Date.now(),
        });
        await logContract(page.id ?? "", key.key ?? "", { kind: "create", counterparty: s.name });
      }
      toast({ message: `Drafted ${format.count(names.length, "MSA")}` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t draft them.");
    }
  }

  async function archive(c: Contract, undo = false) {
    const { db, ref, update } = await store();
    await update(ref(db, `assets/${page.id}/contracts/${c.id}`), { archivedAt: undo ? null : Date.now() });
    await logContract(page.id ?? "", c.id, { kind: undo ? "unarchive" : "archive", counterparty: c.counterparty });
    if (!undo) toast({ message: `Archived the MSA with ${c.counterparty}`, action: { label: "Undo", run: () => void archive(c, true) } });
  }

  async function removeDraft(r: Row) {
    const c = r.c;
    const ok = await confirm({
      title: `Delete the MSA draft with ${c.counterparty}?`,
      object: {
        name: c.counterparty,
        detail: [STAGE[r.stage].label, feeShort(c) || "No fee yet", c.effectiveDate ? `effective ${format.date(c.effectiveDate, "medium")}` : null].filter(Boolean).join(" · "),
      },
      message: "The draft and its terms are removed; they stay in the contract history.",
      confirmLabel: "Delete draft",
      tone: "danger",
      irreversible: true,
    });
    if (!ok) return;
    try {
      const { db, ref, remove } = await store();
      await logContract(page.id ?? "", c.id, { kind: "delete", terms: snapshot(c) });
      await remove(ref(db, `assets/${page.id}/contracts/${c.id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t delete it.");
    }
  }

  const menuFor = (r: Row): MenuItem[] => {
    const items: MenuItem[] = [{ label: "Open", icon: "doc", onSelect: () => open(r.c) }];
    if (!admin) return items;
    items.push({
      label: "Edit terms…",
      icon: "edit",
      onSelect: () => setSheet({ contract: r.c }),
      disabled: !termsEditable(r.stage),
      disabledReason: r.stage === "out" ? "Out for signature: void the request to change it" : "Signed: changes need an amendment",
    });
    if (r.stage === "draft" || r.stage === "unsigned-active") items.push({ label: "Record as signed…", onSelect: () => setDialog({ kind: "signed", c: r.c }) });
    if (r.stage === "signed" || r.stage === "unsigned-active") items.push({ label: "Terminate…", onSelect: () => setDialog({ kind: "terminate", c: r.c }) });
    items.push({ divider: true });
    if (deletable(r.stage)) items.push({ label: "Delete draft…", icon: "trash", danger: true, onSelect: () => void removeDraft(r) });
    else items.push({ label: "Archive", onSelect: () => void archive(r.c) });
    return items;
  };

  const statusOf = (r: Row) => {
    const signed = signedDate(r.c, r.request);
    const ren = r.stage === "signed" ? renewal(r.c) : null;
    const late = pastDueUnsigned(r.c, r.stage);
    return {
      word: <Status tone={late ? "warning" : STAGE[r.stage].tone}>{STAGE[r.stage].label}</Status>,
      line:
        r.stage === "signed" && signed
          ? `Signed ${format.date(signed, "short")}${ren ? ` · notice by ${format.date(ren.noticeBy, "short")} to stop it renewing` : ""}`
          : r.stage === "terminated" && r.c.terminatedOn
            ? `Ended ${format.date(r.c.terminatedOn, "short")}`
            : late && r.stage === "draft"
              ? "Effective date passed; not signed"
              : null,
    };
  };

  const columns: Column<Row>[] = [
    {
      key: "who",
      header: "Counterparty",
      render: (r) => (
        <div className="flex min-w-0 flex-col gap-1 py-1">
          <span className="break-words text-ink">{r.c.counterparty}</span>
          {r.related && (
            <span>
              <Badge>Related party</Badge>
            </span>
          )}
        </div>
      ),
      sort: (a, b) => a.c.counterparty.localeCompare(b.c.counterparty),
    },
    { key: "dir", header: "Direction", width: "96px", render: (r) => <span className="text-ink-2">{r.c.role === "managed" ? "We pay" : "We bill"}</span> },
    {
      key: "fee",
      header: "Fee",
      align: "right",
      width: "176px",
      render: (r) => {
        const n = feeAmount(r.c);
        const f = frequencyOf(r.c.frequency);
        return n === null ? (
          <span className="text-ink-3">No fee yet</span>
        ) : (
          <span className="whitespace-nowrap tabular-nums">
            {format.money(n)}
            <span className="text-ink-2"> {f === "One-time" ? "once" : f ? `/ ${f === "Monthly" ? "month" : f === "Quarterly" ? "quarter" : "year"}` : ""}</span>
          </span>
        );
      },
      sort: (a, b) => (annualized(a.c) ?? 0) - (annualized(b.c) ?? 0),
    },
    {
      key: "eff",
      header: "Effective",
      width: "120px",
      render: (r) => (r.c.effectiveDate ? <span className="tabular-nums">{format.date(r.c.effectiveDate, "medium")}</span> : null),
      sort: (a, b) => (a.c.effectiveDate ?? "").localeCompare(b.c.effectiveDate ?? ""),
    },
    { key: "term", header: "Term", render: (r) => <span className="text-ink-2">{r.c.term}</span> },
    {
      key: "status",
      header: "Status",
      width: "200px",
      render: (r) => {
        const s = statusOf(r);
        return (
          <div className="flex flex-col gap-1 py-1">
            {s.word}
            {s.line && <span className="text-small text-ink-2">{s.line}</span>}
          </div>
        );
      },
    },
    {
      key: "more",
      header: "",
      width: "48px",
      align: "right",
      render: (r) => (
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="inline-flex">
          <Menu label={`MSA with ${r.c.counterparty}`} align="end" items={menuFor(r)} trigger={<IconButton icon="more" label={`More actions for the MSA with ${r.c.counterparty}`} />} />
        </span>
      ),
    },
  ];

  const cardMenu: MenuItem[] = admin
    ? [
        ...(subsidiaries.length ? [{ label: `Draft MSAs for the subsidiaries (${subsidiaries.length})…`, onSelect: () => void draftSubsidiaries() }] : []),
        { label: trade ? "Trade name…" : "Add a trade name…", onSelect: () => setDialog({ kind: "trade" }) },
      ]
    : [];

  return (
    <div className="ds flex flex-col gap-4">
      {unsignedLive.length > 0 && (
        <Banner tone="warning">
          {unsignedLive.length === 1
            ? `The MSA with ${unsignedLive[0].c.counterparty} took effect ${format.date(unsignedLive[0].c.effectiveDate!, "medium")} but isn’t signed. If services have started, fees may be running on an unsigned agreement: send it for signature, or record the signed copy.`
            : `${unsignedLive.length} MSAs have passed their effective dates without a signature. If services have started, fees may be running on unsigned agreements.`}
        </Banner>
      )}
      <Card
        title="Contracts"
        count={live.length || undefined}
        info="Management services agreements this entity has with each counterparty: the fee, the term, and where each stands."
        action={
          admin && live.length > 0 ? (
            phone ? (
              <IconButton icon="plus" label="New contract" onClick={() => setSheet({ contract: null })} />
            ) : (
              <Button variant="quiet" size="sm" icon="plus" onClick={() => setSheet({ contract: null })}>
                New contract
              </Button>
            )
          ) : undefined
        }
        menu={cardMenu.length ? cardMenu : undefined}
        flush={live.length > 0}
        footer={
          counted.length > 0 ? (
            <p className="mr-auto text-small text-ink-2 tabular-nums">
              Contracted: <span className="text-ink">{format.money(Math.round((yearly / 12) * 100) / 100)}</span> a month · <span className="text-ink">{format.money(yearly)}</span> a year. Drafts
              aren’t counted.
            </p>
          ) : undefined
        }
      >
        {live.length === 0 ? (
          <Empty
            size="page"
            title="No contracts yet"
            action={
              admin ? (
                <Button variant="primary" icon="plus" onClick={() => setSheet({ contract: null })}>
                  New contract
                </Button>
              ) : undefined
            }
          >
            Draft a management services agreement with a counterparty to track its fee, term and signing. Only staff see contracts.
          </Empty>
        ) : (
          <Table
            caption="Contracts"
            columns={columns}
            rows={live}
            rowKey={(r) => r.c.id}
            onRowClick={(r) => open(r.c)}
            phoneRow={(r) => {
              const s = statusOf(r);
              return {
                title: r.c.counterparty,
                label: r.c.counterparty,
                secondary: [STAGE[r.stage].label, s.line, r.related ? "Related party" : null].filter(Boolean).join(" · "),
                trailing: feeShort(r.c) ? feeShort(r.c).replace(/ a /, " / ") : undefined,
                onClick: () => open(r.c),
                menu: menuFor(r),
                className: "[&_.truncate]:whitespace-normal",
              };
            }}
          />
        )}
        {archived.length > 0 && (
          <div className="border-t border-line px-5 py-3 touch:px-4">
            <Disclosure label="Archived" count={archived.length}>
              <List label="Archived contracts">
                {archived.map((r) => (
                  <ListRow
                    key={r.c.id}
                    title={r.c.counterparty}
                    label={r.c.counterparty}
                    secondary={[r.c.terminatedOn ? `Ended ${format.date(r.c.terminatedOn, "medium")}` : null, feeShort(r.c)].filter(Boolean).join(" · ")}
                    onClick={() => open(r.c)}
                    menu={admin ? [{ label: "Restore", onSelect: () => void archive(r.c, true) }] : undefined}
                  />
                ))}
              </List>
            </Disclosure>
          </div>
        )}
      </Card>
      {error && <Banner tone="negative">{error}</Banner>}

      {sheet && <ContractSheet contract={sheet.contract} phone={phone} trade={trade} entities={entities} onClose={() => setSheet(null)} />}
      {dialog?.kind === "signed" && <SignedDialog c={dialog.c} docs={page.docs} onClose={() => setDialog(null)} />}
      {dialog?.kind === "terminate" && <TerminateDialog c={dialog.c} onClose={() => setDialog(null)} />}
      {dialog?.kind === "trade" && <TradeNameDialog current={trade} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** The terms worth keeping when a contract changes or goes. */
function snapshot(c: Contract) {
  return {
    counterparty: c.counterparty,
    amount: feeAmount(c),
    frequency: c.frequency,
    effectiveDate: c.effectiveDate,
    term: c.term,
    services: c.services ?? [],
    referralCredit: !!c.referralCredit,
    status: c.status,
    signedOn: c.signedOn ?? null,
  };
}

// ── New contract, or editing a draft's terms ─────────────────────────────

type Form = {
  counterparty: string;
  counterpartyType: "affiliate" | "third-party";
  counterpartyForm: string | null;
  counterpartyState: string;
  amount: number | null;
  frequency: string;
  effectiveDate: string | null;
  term: string;
  services: string[];
  referralCredit: boolean;
  referralTerms: string;
  masthead: "trade" | "legal";
};

function ContractSheet({
  contract,
  phone,
  trade,
  entities,
  onClose,
}: {
  contract: Contract | null;
  phone: boolean;
  trade: TradeName | null;
  entities: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { page, asset } = useEntity();
  const initial: Form = useMemo(
    () => ({
      counterparty: contract?.counterparty ?? "",
      counterpartyType: contract?.counterpartyType ?? (contract && familyEntityNamed(contract.counterparty, entities) ? "affiliate" : "third-party"),
      counterpartyForm: contract?.counterpartyForm ?? null,
      counterpartyState: contract?.counterpartyState ?? "",
      amount: contract ? feeAmount(contract) : null,
      frequency: frequencyOf(contract?.frequency) ?? "Monthly",
      effectiveDate: contract?.effectiveDate || todayLocal(),
      term: contract?.term || TERM_MONTHLY,
      services: contract?.services?.length ? [...contract.services] : [],
      referralCredit: !!contract?.referralCredit,
      referralTerms: contract?.referralTerms ?? "",
      masthead: contract?.masthead ?? (contract?.entityNameOnly ? "legal" : trade ? "trade" : "legal"),
    }),
    // The form starts from the contract as opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [f, setF] = useState<Form>(initial);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const related = familyEntityNamed(f.counterparty, entities);
  const professional = f.referralCredit && looksProfessional(f.counterparty);
  const advisory = f.counterpartyType === "third-party" && f.services.some((s) => ADVISORY_SERVICES.has(s));
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const law = asset.state || "";
  const termHint = TERMS.find((t) => t.value === f.term)?.hint;

  const errs = {
    counterparty: tried && !f.counterparty.trim() ? "Add the counterparty’s legal name." : undefined,
    amount: tried && (f.amount === null || !(f.amount > 0)) ? "Add the fee." : undefined,
    effective: tried && !f.effectiveDate ? "Add the effective date." : undefined,
    services: tried && !f.services.length ? "Choose at least one service." : undefined,
    referral: tried && f.referralCredit && !f.referralTerms.trim() ? "Say how the referral fee is worked out." : undefined,
  };
  const valid = !Object.values(errs).some(Boolean) && f.counterparty.trim() && f.amount && f.amount > 0 && f.effectiveDate && f.services.length && (!f.referralCredit || f.referralTerms.trim());

  const values = () => ({
    counterparty: f.counterparty.trim(),
    counterpartyType: f.counterpartyType,
    counterpartyForm: f.counterpartyForm ?? null,
    counterpartyState: f.counterpartyState.trim() || null,
    amount: f.amount,
    // Kept in step for older readers (the MSAs page).
    fee: f.amount === null ? "" : format.money(f.amount),
    frequency: f.frequency,
    effectiveDate: f.effectiveDate,
    term: f.term,
    services: f.services,
    referralCredit: f.referralCredit,
    referralTerms: f.referralCredit ? f.referralTerms.trim() : null,
    masthead: f.masthead,
    entityNameOnly: f.masthead === "legal",
    letterhead: "bfo",
  });

  function preview() {
    try {
      sessionStorage.setItem("bfo.contract.preview", JSON.stringify({ ...values(), role: "manager", status: "draft" }));
    } catch {
      return;
    }
    const win = window.open(`/assets/${page.id}/contract/preview`, "_blank");
    if (win) win.opener = null;
  }

  async function save() {
    setTried(true);
    setError("");
    if (!valid) return;
    setBusy(true);
    try {
      const { db, push, ref, update } = await store();
      const v = values();
      if (contract) {
        await update(ref(db, `assets/${page.id}/contracts/${contract.id}`), v);
        const before = snapshot(contract);
        const after = snapshot({ ...contract, ...v } as Contract);
        const fields = (Object.keys(after) as (keyof typeof after)[])
          .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
          .map((k) => ({ field: k, from: before[k] ?? null, to: after[k] ?? null }));
        await logContract(page.id ?? "", contract.id, { kind: "edit", counterparty: v.counterparty, fields });
        toast({ message: "Saved the terms" });
      } else {
        const key = await push(ref(db, `assets/${page.id}/contracts`), { ...v, role: "manager", status: "draft", createdAt: Date.now() });
        await logContract(page.id ?? "", key.key ?? "", { kind: "create", counterparty: v.counterparty, terms: snapshot({ ...v, status: "draft" } as unknown as Contract) });
        toast({ message: `Drafted the MSA with ${v.counterparty}` });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn’t save the contract. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const title = contract ? `Edit terms: ${contract.counterparty}` : "New contract";
  const saveButton = (
    <Button variant="primary" busy={busy} busyLabel="Saving…" onClick={() => void save()}>
      {contract ? "Save terms" : "Save draft"}
    </Button>
  );

  return (
    <Sheet
      open
      onClose={onClose}
      side={phone ? "full" : "right"}
      size="lg"
      title={title}
      dirty={dirty && !busy}
      action={phone ? saveButton : undefined}
      footer={
        phone ? undefined : (
          <>
            <Button onClick={preview} disabled={!f.counterparty.trim()} disabledReason="Add a counterparty to preview" className="mr-auto">
              Preview
            </Button>
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            {saveButton}
          </>
        )
      }
    >
      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex flex-col gap-4">
          <Field label="Counterparty" error={errs.counterparty} hint={related ? `${related.name} is one of the family’s entities: a related-party contract.` : "Their full legal name."}>
            <Input
              value={f.counterparty}
              onChange={(e) => {
                const v = e.target.value;
                setF((x) => ({ ...x, counterparty: v, counterpartyType: familyEntityNamed(v, entities) ? "affiliate" : x.counterpartyType }));
              }}
              placeholder="Northwind Holdings, LLC"
              autoComplete="off"
            />
          </Field>
          <Field label="Relationship">
            <Segmented
              label="Relationship"
              value={f.counterpartyType}
              onChange={(v) => set("counterpartyType", v)}
              options={[
                { value: "affiliate", label: "Family entity" },
                { value: "third-party", label: "Third party" },
              ]}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Their legal form" optional>
              <Select
                label="Their legal form"
                value={f.counterpartyForm}
                onChange={(v) => set("counterpartyForm", v)}
                placeholder="Choose"
                options={COUNTERPARTY_FORMS.map((x) => ({ value: x, label: x.charAt(0).toUpperCase() + x.slice(1) }))}
              />
            </Field>
            <Field label="Formed in" optional hint="The state, as in “Arizona”.">
              <Input value={f.counterpartyState} onChange={(e) => set("counterpartyState", e.target.value)} autoComplete="off" />
            </Field>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Fee" error={errs.amount}>
            <MoneyInput value={f.amount} onChange={(v) => set("amount", v)} />
          </Field>
          <Field label="Billed">
            <Select label="Billed" value={f.frequency} onChange={(v) => set("frequency", v)} options={FREQUENCIES.map((x) => ({ value: x, label: x === "One-time" ? "Once" : x }))} />
          </Field>
          <Field
            label="Effective"
            error={errs.effective}
            hint={f.effectiveDate && f.effectiveDate < todayLocal() ? "Before today: the agreement will say it’s effective as of this date, signed later." : undefined}
          >
            <DateInput value={f.effectiveDate} onChange={(v) => set("effectiveDate", v)} />
          </Field>
          <Field label="Term" hint={termHint}>
            <Select label="Term" value={f.term} onChange={(v) => set("term", v)} options={TERMS.map((t) => ({ value: t.value, label: t.value }))} />
          </Field>
        </div>

        <Field
          label="Services"
          error={errs.services}
          hint={
            advisory
              ? "Advisory, tax and financial services for an outside client: have counsel review them first (the family-office exclusion and professional licensing)."
              : "In the order the agreement lists them."
          }
        >
          <MultiSelect label="Services" value={f.services} onChange={(v) => set("services", v)} placeholder="Choose services" options={MSA_SERVICES.map((s) => ({ value: s, label: s }))} />
        </Field>

        <div className="flex flex-col gap-2">
          <Checkbox
            checked={f.referralCredit}
            onChange={(v) => set("referralCredit", v)}
            label="Referral credit"
            hint="Adds §2.4: a referral fee Manager owes Client is credited against the management fee instead of paid in cash. Both are still invoiced and booked in full."
          />
          {f.referralCredit && (
            <Field label="How the referral fee is worked out" error={errs.referral}>
              <Input value={f.referralTerms} onChange={(e) => set("referralTerms", e.target.value)} placeholder="10% of the referred client’s fees for its first year" />
            </Field>
          )}
          {professional && (
            <Banner tone="warning">
              {f.counterparty.trim()} reads like a law or other professional firm. Referral payments to professionals are regulated; have counsel approve this clause before it goes out.
            </Banner>
          )}
        </div>

        <Field label="Masthead" hint={trade ? undefined : "The agreement is headed with the entity’s legal name. Add a trade name from the Contracts card’s “…” menu to head it with that instead."}>
          {trade ? (
            <Segmented
              label="Masthead"
              value={f.masthead}
              onChange={(v) => set("masthead", v)}
              options={[
                { value: "trade", label: trade.name },
                { value: "legal", label: asset.name },
              ]}
            />
          ) : (
            <p className="text-body text-ink">{asset.name}</p>
          )}
        </Field>

        <p className="text-small text-ink-2">
          {law
            ? `Governed by ${law} law, with disputes in ${law}’s courts: the entity’s home state.`
            : "The entity has no home state on record; add one before this agreement goes out (it sets the governing law)."}
          {related ? " A related-party fee needs arm’s-length support; fees between entities taxed to the same owner don’t change income tax." : ""}
        </p>
        {error && <Banner tone="negative">{error}</Banner>}
        {phone && (
          <Button onClick={preview} disabled={!f.counterparty.trim()} disabledReason="Add a counterparty to preview">
            Preview the agreement
          </Button>
        )}
      </form>
    </Sheet>
  );
}

// ── Status changes, each a recorded event ────────────────────────────────

function SignedDialog({ c, docs, onClose }: { c: Contract; docs: AssetDoc[]; onClose: () => void }) {
  const { page } = useEntity();
  const [on, setOn] = useState<string | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = !!on && !!docId;
  async function save() {
    const doc = docs.find((d) => d.id === docId);
    if (!on || !doc) return;
    setBusy(true);
    setError("");
    try {
      const { db, ref, update } = await store();
      await update(ref(db, `assets/${page.id}/contracts/${c.id}`), { signedOn: on, signedCopy: { id: doc.id, name: doc.name }, status: "active" });
      await logContract(page.id ?? "", c.id, { kind: "signed", counterparty: c.counterparty, signedOn: on, doc: { id: doc.id, name: doc.name } });
      toast({ message: `Recorded the signed MSA with ${c.counterparty}` });
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
      title={`Record the signed MSA with ${c.counterparty}`}
      description="For an agreement signed on paper or elsewhere. It becomes active once the executed copy is in Documents."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            busyLabel="Saving…"
            disabled={!ready}
            disabledReason={!docs.length ? "File the signed copy in Documents first" : !ready ? "Add the date and the signed copy" : undefined}
            onClick={() => void save()}
          >
            Record as signed
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Signed by both parties on" hint="The later of the two signatures.">
          <DateInput value={on} onChange={setOn} />
        </Field>
        <Field label="The executed copy" hint={docs.length ? "Filed in Documents." : "Nothing is filed yet: upload the signed copy in Documents first."}>
          <Select
            label="The executed copy"
            value={docId}
            onChange={setDocId}
            disabled={!docs.length}
            placeholder="Choose a document"
            options={[...docs].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).map((d) => ({ value: d.id, label: d.name }))}
          />
        </Field>
        {error && <Banner tone="negative">{error}</Banner>}
      </div>
    </Dialog>
  );
}

function TerminateDialog({ c, onClose }: { c: Contract; onClose: () => void }) {
  const { page } = useEntity();
  const [notice, setNotice] = useState<string | null>(todayLocal());
  const [ends, setEnds] = useState<string | null>(addDays(todayLocal(), 30));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const early = !!notice && !!ends && ends < addDays(notice, 30);
  async function save() {
    if (!notice || !ends) return;
    const ok = await confirm({
      title: `Terminate the MSA with ${c.counterparty}?`,
      object: { name: c.counterparty, detail: `Notice ${format.date(notice, "medium")} · ends ${format.date(ends, "medium")}` },
      message: "This records the termination in BFO. The agreement ends by written notice under Article III; send the notice to the client’s notice address and file a copy in Documents.",
      confirmLabel: "Record termination",
      tone: "commit",
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      const { db, ref, update } = await store();
      await update(ref(db, `assets/${page.id}/contracts/${c.id}`), { status: "terminated", noticeGivenOn: notice, terminatedOn: ends });
      await logContract(page.id ?? "", c.id, { kind: "terminate", counterparty: c.counterparty, noticeGivenOn: notice, terminatedOn: ends });
      toast({ message: `Recorded the termination of the MSA with ${c.counterparty}` });
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
      title={`Terminate the MSA with ${c.counterparty}`}
      description="Either party may end it on thirty days’ written notice (Article III). The fee runs to the end date."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} busyLabel="Saving…" disabled={!notice || !ends} onClick={() => void save()}>
            Continue
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Notice given on">
          <DateInput
            value={notice}
            onChange={(v) => {
              setNotice(v);
              if (v) setEnds(addDays(v, 30));
            }}
          />
        </Field>
        <Field label="Ends on" hint={early ? "Less than 30 days after the notice: only by agreement, or for an uncured breach." : undefined}>
          <DateInput value={ends} onChange={setEnds} />
        </Field>
        {error && <Banner tone="negative">{error}</Banner>}
      </div>
    </Dialog>
  );
}

/** The entity's trade name ("doing business as"), which agreements print only when it's on record. */
function TradeNameDialog({ current, onClose }: { current: TradeName | null; onClose: () => void }) {
  const { page, asset } = useEntity();
  const [name, setName] = useState(current?.name ?? "");
  const [filedOn, setFiledOn] = useState<string | null>(current?.filedOn ?? null);
  const [state, setState] = useState(current?.state ?? asset.state ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(clear = false) {
    setBusy(true);
    setError("");
    try {
      await page.patchAsset({ tradeName: clear ? null : { name: name.trim(), filedOn: filedOn ?? null, state: state.trim() || null } });
      toast({ message: clear ? "Removed the trade name" : "Saved the trade name" });
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
      title="Trade name"
      description={`The name ${asset.name} does business under, as filed with the state (a fictitious or assumed name certificate). Agreements say “doing business as” only when it’s recorded here.`}
      footer={
        <>
          {current && (
            <Button variant="quiet" className="mr-auto" disabled={busy} onClick={() => void save(true)}>
              Remove
            </Button>
          )}
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} busyLabel="Saving…" disabled={!name.trim()} disabledReason="Add the name" onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Trade name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Filed on" optional>
            <DateInput value={filedOn} onChange={setFiledOn} />
          </Field>
          <Field label="Filed in" optional>
            <Input value={state} onChange={(e) => setState(e.target.value)} />
          </Field>
        </div>
        {!filedOn && name.trim() && <p className="text-small text-ink-2">Without a filing date on record, the contract page reminds you to confirm the filing before an agreement goes out.</p>}
        {error && <Banner tone="negative">{error}</Banner>}
      </div>
    </Dialog>
  );
}
