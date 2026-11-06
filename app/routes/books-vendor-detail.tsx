import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { authFetch, canWrite } from "../auth";
import { fetchAllTxns, postBatchEdit, visibleSelection } from "../books-batch";
import {
  BatchBar,
  Menu,
  TYPE_OPTIONS,
  TxnTable,
  TxnTableSkeleton,
  accountOption,
  accountShort,
  changedToast,
  displayName,
  effType,
  entityLabel,
  fetchPreview,
  previewFacts,
  txnCount,
  type PreviewReply,
  type Txn,
} from "../books-shared";
import { Banner, Button, Card, Checkbox, ChoiceTiles, Dialog, Empty, Input, List, ListRow, Page, PageHeader, Row, Rows, Table, format, useDocumentTitle, usePhone, type Column } from "../ui";

export function meta() {
  return [{ title: "Vendor · Vendors · BFO" }];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BUSINESS = /\b(llc|inc|ltd|corp|co|company|bank|services|group|trust|pllc|lp|insurance|county|agency|department|dept|revenue|irs|university|school|hospital|clinic|store|market)\b/i;

type Change = { field: "book_category" | "type_override" | "vendor_name"; value: string; label: string };

/**
 * One vendor in full: what the family paid them by year and month, how
 * their transactions are filed and how new ones will be, and the complete
 * ledger. Changing the vendor's default asks whether it reaches only new
 * transactions (the default) or the history too, and says how many first.
 */
export default function BooksVendorDetail() {
  const navigate = useNavigate();
  const phone = usePhone();
  const [params] = useSearchParams();
  const name = params.get("name") ?? "";
  const shown = displayName(name) || "Vendor";
  useDocumentTitle(shown, "Vendors");
  const writable = canWrite();

  const [txns, setTxns] = useState<Txn[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [loans, setLoans] = useState<Array<{ id: string; name: string }>>([]);
  const [vendors, setVendors] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rule, setRule] = useState<PreviewReply | null>(null);
  const [change, setChange] = useState<Change | null>(null);
  const [renaming, setRenaming] = useState<"rename" | "merge" | null>(null);

  const load = useCallback(async () => {
    if (!name) {
      setTxns([]);
      return;
    }
    setError("");
    try {
      const all = await fetchAllTxns<Txn>(authFetch, new URLSearchParams({ report: "transactions", q: name }), "Couldn’t load this vendor.");
      const key = name.trim().toLowerCase();
      const list = all.filter((t) => (t.merchant_name || t.name || "").trim().toLowerCase() === key);
      setTxns(list);
      setSelected((prev) => new Set(visibleSelection(prev, list)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t load this vendor.");
      setTxns([]);
    }
    setRule(await fetchPreview(name, "vendor"));
  }, [name]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void authFetch("/api/books/data?report=meta")
      .then(async (r) => {
        if (!r.ok) return;
        const data = await r.json();
        setCategories(data.categories ?? []);
        setLoans(data.loans ?? []);
        setVendors(data.vendors ?? []);
      })
      .catch(() => {});
  }, []);

  const list = txns ?? [];
  const posted = list.filter((t) => !t.pending);
  const stats = useMemo(() => {
    const year = String(new Date().getFullYear());
    let paidYear = 0;
    let movedYear = 0;
    let refunds = 0;
    for (const t of posted) {
      const eff = effType(t);
      if (t.amount < 0) refunds += -t.amount;
      else if (t.date.startsWith(year)) {
        if (eff === "normal") paidYear += t.amount;
        else movedYear += t.amount;
      }
    }
    const dates = list.map((t) => t.date).sort();
    return { paidYear, movedYear, refunds, first: dates[0] ?? null, year };
  }, [posted, list]);

  // Year × month: money out, posted rows.
  const matrix = useMemo(() => {
    const byYear = new Map<string, number[]>();
    for (const t of posted) {
      const y = t.date.slice(0, 4);
      const row = byYear.get(y) ?? (Array(12).fill(0) as number[]);
      row[Number(t.date.slice(5, 7)) - 1] += t.amount;
      byYear.set(y, row);
    }
    return [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([year, months]) => ({ year, months, total: months.reduce((s, v) => s + v, 0) }));
  }, [posted]);

  // Newest first; "paid to date" accumulates money out, oldest first.
  const { ordered, paidToDate } = useMemo(() => {
    const asc = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.transaction_id.localeCompare(b.transaction_id));
    let sum = 0;
    const map: Record<string, number> = {};
    for (const t of asc) {
      sum += t.amount;
      map[t.transaction_id] = sum;
    }
    return { ordered: asc.reverse(), paidToDate: map };
  }, [list]);

  const spread = useMemo(() => {
    const accounts = new Map<string, number>();
    const types = new Map<string, number>();
    for (const t of list) {
      accounts.set(t.book_category ?? "Uncategorized", (accounts.get(t.book_category ?? "Uncategorized") ?? 0) + 1);
      const eff = effType(t);
      types.set(eff, (types.get(eff) ?? 0) + 1);
    }
    return { accounts: [...accounts.entries()].sort((a, b) => b[1] - a[1]), types: [...types.entries()].sort((a, b) => b[1] - a[1]) };
  }, [list]);
  const entities = [...new Set(list.map((t) => t.entity_name).filter((e): e is string => !!e))];
  const mostAccount = spread.accounts[0];
  const ruleAccount = rule?.rule?.book_category ?? null;
  const person = !BUSINESS.test(name) && name.trim().split(/\s+/).length >= 2 && name.trim().split(/\s+/).length <= 4;
  const wages = list.some((t) => (t.book_category ?? "").startsWith("6000"));

  async function apply(c: Change, backfill: boolean, skipEdited: boolean) {
    setSaving(true);
    setError("");
    try {
      const res = await authFetch("/api/books/data", {
        method: "POST",
        body: JSON.stringify({ action: "vendor_settings", match: name, match_kind: "vendor", [c.field]: c.value, backfill, skip_edited: skipEdited }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Couldn’t save that.");
      setChange(null);
      setRenaming(null);
      const applied = Number(data.applied ?? 0);
      const msg = c.field === "vendor_name" ? `Renamed to ${c.value}${applied ? ` on ${txnCount(applied)}` : ""}` : backfill ? `Changed ${txnCount(applied)} and new ones` : "Saved for new transactions";
      if (c.field === "vendor_name" && c.value !== name) {
        changedToast(msg, data.undo, () => {
          // Undo also stops renaming new arrivals: the rule goes back to the old name.
          void authFetch("/api/books/data", { method: "POST", body: JSON.stringify({ action: "vendor_settings", match: name, match_kind: "vendor", vendor_name: name, backfill: false }) });
          navigate(`/books/vendors/detail?name=${encodeURIComponent(name)}`, { replace: true });
        });
        navigate(`/books/vendors/detail?name=${encodeURIComponent(c.value)}`, { replace: true });
      } else {
        changedToast(msg, data.undo, () => void load());
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save that.");
    } finally {
      setSaving(false);
    }
  }

  const context = txns
    ? [entities.length === 1 ? `Paid from ${entityLabel(entities[0])}` : entities.length ? `${entities.length} entities` : null, txnCount(list.length), stats.first ? `since ${format.date(stats.first, "medium")}` : null].filter(Boolean).join(" · ")
    : undefined;

  const columns: Column<{ year: string; months: number[]; total: number }>[] = [
    { key: "year", header: "Year", width: "72px", render: (r) => r.year },
    ...MONTHS.map((m, i) => ({ key: m, header: m, align: "right" as const, render: (r: { months: number[] }) => <span className={r.months[i] ? "" : "text-ink-3"}>{format.money(r.months[i], { precision: "dollars", sign: "accounting", zero: "dash" })}</span> })),
    { key: "total", header: "Total", align: "right", width: "112px", render: (r) => <span className="font-medium">{format.money(r.total, { precision: "dollars", sign: "accounting", zero: "dash" })}</span> },
  ];

  return (
    <Page
      width="full"
      header={
        <PageHeader
          title={shown}
          back={{ to: "/books/vendors", label: "Vendors" }}
          context={context}
          menu={
            writable && name
              ? [
                  { label: "Rename vendor…", onSelect: () => setRenaming("rename") },
                  { label: "Merge into another vendor…", onSelect: () => setRenaming("merge") },
                ]
              : undefined
          }
        />
      }
    >
      {error && <Banner tone="negative" onDismiss={() => setError("")}>{error}</Banner>}
      {txns && list.length === 0 && !error ? (
        <Empty title={name ? "No transactions for this vendor" : "No vendor chosen"}>{name ? "Nothing in the books is filed under this name." : "Choose a vendor from the Vendors list."}</Empty>
      ) : (
        <>
          {spread.accounts.length > 1 && (
            <Banner tone="warning" title="Filed more than one way.">
              {spread.accounts.map(([a, n]) => `${accountShort(a)} ${n}`).join(", ")}
              {spread.types.length > 1 ? `; ${spread.types.map(([t, n]) => `${TYPE_OPTIONS.find((o) => o.value === t)?.label ?? "on a loan"} ${n}`).join(", ")}` : ""}. Set the vendor’s account below and refile the history if they should match.
            </Banner>
          )}
          {person && wages && (
            <Banner tone="info" title="Paid outside payroll?">
              Payments to a person filed as wages need withholding and a W-2, or a W-9 and a 1099-NEC if they’re a contractor. Confirm which, and that the form is on file.
            </Banner>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card title="Paid">
              <dl className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-small text-ink-2">{stats.year} to date</dt>
                  <dd className="mt-1 text-heading tabular-nums">{format.money(stats.paidYear, { precision: "dollars" })}</dd>
                </div>
                <div>
                  <dt className="text-small text-ink-2">Moved as transfers in {stats.year}</dt>
                  <dd className="mt-1 text-heading tabular-nums">{format.money(stats.movedYear, { precision: "dollars" })}</dd>
                </div>
                {stats.refunds > 0 && (
                  <div>
                    <dt className="text-small text-ink-2">Refunds, all years</dt>
                    <dd className="mt-1 text-heading tabular-nums">{format.money(stats.refunds, { precision: "dollars" })}</dd>
                  </div>
                )}
              </dl>
              <p className="mt-3 text-small text-ink-2">Posted rows. Paid counts income and expense rows; the 1099 list uses the same rows.</p>
            </Card>
            <Card title="How new transactions are filed">
              <Rows>
                <Row label="Account" hint={ruleAccount ? `By the vendor’s rule${rule?.rule ? `, “${rule.rule.match}”` : ""}.` : mostAccount ? `No rule yet. ${mostAccount[1]} of ${list.length} are in ${accountShort(mostAccount[0])}.` : "No rule yet."}>
                  <Menu
                    value={ruleAccount ?? ""}
                    placeholder="No default"
                    tone="soft"
                    label="Default account"
                    readOnly={!writable}
                    disabled={saving}
                    onChange={(v) => setChange({ field: "book_category", value: v, label: accountShort(v) })}
                    options={categories.map(accountOption)}
                  />
                </Row>
                <Row label="Type" hint="Income or expense reaches the profit and loss; transfers and intercompany moves don’t.">
                  <Menu
                    value=""
                    placeholder={TYPE_OPTIONS.find((o) => o.value === spread.types[0]?.[0])?.label ?? "Income or expense"}
                    tone="soft"
                    label="Default type"
                    readOnly={!writable}
                    disabled={saving}
                    onChange={(v) => setChange({ field: "type_override", value: v, label: TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v })}
                    options={TYPE_OPTIONS}
                  />
                </Row>
              </Rows>
            </Card>
          </div>

          {matrix.length > 0 &&
            (phone ? (
              <Card title="By year" flush>
                <List label="By year">
                  {matrix.map((r) => (
                    <ListRow key={r.year} title={r.year} secondary={r.months.map((v, i) => (v ? `${MONTHS[i]} ${format.money(v, { precision: "compact" })}` : null)).filter(Boolean).slice(0, 4).join(" · ")} trailing={format.money(r.total, { precision: "dollars", sign: "accounting" })} />
                  ))}
                </List>
              </Card>
            ) : (
              <Card title="By month" flush>
                <Table caption="Paid by month" columns={columns} rows={matrix} rowKey={(r) => r.year} stickyFirst phoneRow={(r) => ({ title: r.year })} />
              </Card>
            ))}

          <Card title="Transactions" count={list.length || undefined} flush>
            {!txns ? (
              <TxnTableSkeleton />
            ) : (
              <TxnTable
                context="vendor"
                rows={ordered}
                categories={categories}
                loans={loans}
                balances={paidToDate}
                balanceLabel="Paid to date"
                readOnly={!writable}
                selection={
                  writable
                    ? {
                        selected,
                        toggle: (id) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(id)) next.delete(id);
                            else next.add(id);
                            return next;
                          }),
                        setAll: (ids) => setSelected(new Set(ids)),
                        selectMany: (ids, on) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            for (const id of ids) {
                              if (on) next.add(id);
                              else next.delete(id);
                            }
                            return next;
                          }),
                      }
                    : undefined
                }
                onRowChange={(t) => setTxns((prev) => (prev ?? []).map((x) => (x.transaction_id === t.transaction_id ? { ...t, entity_id: x.entity_id, entity_name: x.entity_name } : x)))}
                onError={setError}
                onReload={() => void load()}
              />
            )}
          </Card>
          <div aria-hidden className={selected.size ? "h-[96px]" : "h-[48px]"} />
        </>
      )}

      <BatchBar
        count={visibleSelection(selected, list).length}
        busy={saving}
        vendorSuggestions={vendors}
        categories={categories}
        onApply={async (patch) => {
          setSaving(true);
          try {
            const ids = visibleSelection(selected, list);
            const r = await postBatchEdit(authFetch, ids, patch);
            if (r.ok) {
              setSelected(new Set());
              changedToast(`Changed ${txnCount(ids.length)}`, r.undo, () => void load());
            } else setError(r.message);
            if (r.ok || r.done) await load();
            return r.ok;
          } finally {
            setSaving(false);
          }
        }}
        onClear={() => setSelected(new Set())}
      />

      {change && <DefaultDialog vendor={shown} name={name} change={change} busy={saving} onClose={() => setChange(null)} onApply={(backfill, skip) => void apply(change, backfill, skip)} />}
      {renaming && (
        <RenameDialog
          kind={renaming}
          vendor={shown}
          name={name}
          vendors={vendors.filter((v) => v !== name)}
          count={list.length}
          person={person}
          busy={saving}
          onClose={() => setRenaming(null)}
          onApply={(to, backfill) => void apply({ field: "vendor_name", value: to, label: to }, backfill, false)}
        />
      )}
    </Page>
  );
}

/**
 * A vendor's default account or type: from now on only (the default, and
 * where focus starts), or the history too, with what that reaches.
 */
function DefaultDialog({ vendor, name, change, busy, onClose, onApply }: { vendor: string; name: string; change: Change; busy: boolean; onClose: () => void; onApply: (backfill: boolean, skipEdited: boolean) => void }) {
  const [scope, setScope] = useState<"future" | "all">("future");
  const [p, setP] = useState<PreviewReply | null | "loading">("loading");
  const [skip, setSkip] = useState(true);
  useEffect(() => {
    void fetchPreview(name, "vendor").then(setP);
  }, [name]);
  const pv = p && p !== "loading" ? p.preview : null;
  const n = pv ? pv.count - (skip ? pv.edited : 0) : null;
  const what = change.field === "book_category" ? `file under ${change.label}` : `mark as ${change.label.toLowerCase()}`;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${vendor}: ${change.field === "book_category" ? `file under ${change.label}` : change.label}?`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} busyLabel="Saving…" onClick={() => onApply(scope === "all", skip)}>
            {scope === "future" ? "Save for new transactions" : n === null ? "Change them all" : `Change ${txnCount(n)}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div data-scope>
          <ChoiceTiles
            label="Which transactions"
            hideLabel
            stacked
            value={scope}
            onChange={setScope}
            options={[
              { value: "future", title: "New transactions only", description: `Saved as the vendor’s rule; the books so far don’t change.` },
              {
                value: "all",
                title: n === null ? `Also the ones already in the books` : `Also the ${txnCount(n)} already in the books`,
                description: pv ? previewFacts(pv).join(" · ") : p === "loading" ? "Counting…" : "The count isn’t available right now.",
              },
            ]}
          />
        </div>
        {scope === "all" && pv && (
          <div className="flex flex-col gap-2 text-small text-ink-2">
            {pv.edited > 0 && <Checkbox checked={skip} onChange={setSkip} label={`Leave the ${txnCount(pv.edited)} changed by hand as they are`} />}
            {pv.locked > 0 && <p>{txnCount(pv.locked)} in a closed period stay as they are.</p>}
            {pv.prior_years > 0 && <p>This reaches {txnCount(pv.prior_years)} from earlier years, which may already be on filed returns.</p>}
            <p>Each change is recorded and can be undone right after. New transactions from {vendor} will {what}.</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Rename a vendor, or merge it into another one, on an explicit Save: the
 * new name and what it reaches are stated first. Merging a person into a
 * business is called out, because the payee is what the 1099s and wage
 * records are built from.
 */
function RenameDialog({
  kind,
  vendor,
  name,
  vendors,
  count,
  person,
  busy,
  onClose,
  onApply,
}: {
  kind: "rename" | "merge";
  vendor: string;
  name: string;
  vendors: string[];
  count: number;
  person: boolean;
  busy: boolean;
  onClose: () => void;
  onApply: (to: string, backfill: boolean) => void;
}) {
  const [to, setTo] = useState(kind === "rename" ? name : "");
  const target = to.trim();
  const ready = !!target && target !== name;
  const toBusiness = BUSINESS.test(target);
  return (
    <Dialog
      open
      onClose={onClose}
      dirty={ready}
      title={kind === "rename" ? `Rename ${vendor}` : `Merge ${vendor} into another vendor`}
      description={`All ${txnCount(count)} under this name, in every year and entity, take the new name, and new ones follow. The bank’s own descriptions don’t change, and each row’s old name is kept in its history.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} busyLabel="Saving…" disabled={!ready} disabledReason={ready ? undefined : kind === "merge" ? "Choose a vendor" : "Type the new name"} onClick={() => onApply(target, true)}>
            {kind === "rename" ? `Rename ${txnCount(count)}` : `Merge ${txnCount(count)}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-[6px]">
          <span className="text-small font-medium text-ink">{kind === "rename" ? "New name" : "Merge into"}</span>
          {kind === "rename" ? (
            <Input value={to} onChange={(e) => setTo(e.target.value)} maxLength={80} autoFocus />
          ) : (
            <Menu value={to} label="Merge into" placeholder="Choose a vendor" size="md" className="w-full" onChange={setTo} options={vendors.map((v) => ({ value: v, label: displayName(v) || v }))} />
          )}
        </label>
        {kind === "merge" && person && toBusiness && <Banner tone="warning">This merges a person into a business. Their payments then count toward the business’s 1099, not theirs.</Banner>}
        <p className="text-small text-ink-2">You can undo it right after; later, rename it back.</p>
      </div>
    </Dialog>
  );
}
