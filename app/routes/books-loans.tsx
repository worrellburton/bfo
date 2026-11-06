import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch, canWrite } from "../auth";
import { Menu, TxnTable, changedToast, displayName, entityLabel, ledgerMoney, memoText, txnCount, type Txn } from "../books-shared";
import { Banner, Button, Card, ChoiceTiles, Dialog, Empty, IconButton, Input, List, ListRow, Page, PageHeader, Row, Rows, SearchField, Skeleton, Switch, Table, confirm, format, toast, useDocumentTitle, type Column } from "../ui";

export function meta() {
  return [{ title: "Loans · BFO" }];
}

type Loan = {
  id: string | null;
  name: string;
  show_on_report: boolean;
  starting_balance: number;
  advanced: number;
  repaid: number;
  outstanding: number;
  first_date: string | null;
  last_date: string | null;
  transactions: Txn[];
  direction?: string | null;
  holder_entity_name?: string | null;
  counterparty?: string | null;
  rate?: number | null;
  start_date?: string | null;
  maturity_date?: string | null;
  starting_balance_as_of?: string | null;
  hidden_reason?: string | null;
  notes?: string | null;
  unattached?: Txn[];
};
type Entity = { id: string; name: string };
type LoanRule = { id: string; match: string; loan_id: string | null };

const money = (n: number) => format.money(n);
const keyOf = (l: Loan) => l.id ?? l.name;

/**
 * Loans the family has made (and owes): each with who holds it, its terms,
 * what was lent and repaid, and what's outstanding. Rows filed to Loans but
 * not attached to a loan are listed, so a balance never sits still while
 * repayments come in.
 */
export default function BooksLoans() {
  useDocumentTitle("Loans");
  const writable = canWrite();
  const [loans, setLoans] = useState<Loan[] | null>(null);
  const [rules, setRules] = useState<LoanRule[]>([]);
  const [registry, setRegistry] = useState<Array<{ id: string; name: string }>>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loose, setLoose] = useState<Txn[] | null>(null);
  const [error, setError] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<Loan | "new" | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const [loansRes, metaRes, looseRes] = await Promise.all([authFetch("/api/books/data?report=loans"), authFetch("/api/books/data?report=meta"), authFetch("/api/books/ledger?report=loan-activity").catch(() => null)]);
      const data = await loansRes.json().catch(() => ({}));
      if (!loansRes.ok) throw new Error(data?.message || "Couldn’t load the loans.");
      setLoans(data.loans ?? []);
      setRules(data.rules ?? []);
      if (metaRes.ok) {
        const m = await metaRes.json();
        setRegistry(m.loans ?? []);
        setCategories(m.categories ?? []);
        setEntities(m.entities ?? []);
      }
      if (looseRes?.ok) setLoose(((await looseRes.json()).rows ?? []) as Txn[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t load the loans.");
      setLoans([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function post(url: string, body: Record<string, unknown>) {
    const res = await authFetch(url, { method: "POST", body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || "That didn’t save.");
    return data;
  }

  const receivable = (loans ?? []).filter((l) => l.direction !== "payable");
  const payable = (loans ?? []).filter((l) => l.direction === "payable");
  const owedTo = receivable.reduce((s, l) => s + l.outstanding, 0);
  const owedBy = payable.reduce((s, l) => s + l.outstanding, 0);
  const attachedIds = new Set((loans ?? []).flatMap((l) => [...l.transactions, ...(l.unattached ?? [])].map((t) => t.transaction_id)));
  const orphans = (loose ?? []).filter((t) => !attachedIds.has(t.transaction_id));
  const open = (loans ?? []).find((l) => keyOf(l) === openKey) ?? null;

  const columns: Column<Loan>[] = [
    {
      key: "name",
      header: "Loan",
      render: (l) => (
        <span>
          {l.name}
          <span className="block text-small text-ink-2">{[l.holder_entity_name ? `Held by ${entityLabel(l.holder_entity_name)}` : "Holder not recorded", l.id ? null : "found from account categories", l.show_on_report ? null : "left off the Treasury report"].filter(Boolean).join(" · ")}</span>
        </span>
      ),
    },
    { key: "start", header: "Starting balance", align: "right", width: "150px", render: (l) => format.money(l.starting_balance, { zero: "dash" }) },
    { key: "lent", header: "Lent", align: "right", width: "130px", render: (l) => format.money(l.advanced, { zero: "dash" }) },
    { key: "repaid", header: "Repaid", align: "right", width: "130px", render: (l) => format.money(l.repaid, { zero: "dash" }) },
    { key: "out", header: "Outstanding", align: "right", width: "150px", sort: (a, b) => a.outstanding - b.outstanding, render: (l) => <span className="font-medium">{money(l.outstanding)}</span> },
  ];

  const context = loans ? [`Owed to the family ${format.money(owedTo)}`, payable.length ? `owed by the family ${format.money(owedBy)}` : null, format.count(loans.length, "loan", "loans")].filter(Boolean).join(" · ") : undefined;
  return (
    <Page width="workspace" header={<PageHeader title="Loans" context={context} create={writable ? { label: "Add loan", onClick: () => setEditing("new") } : undefined} />}>
      {error && <Banner tone="negative" onDismiss={() => setError("")}>{error}</Banner>}
      {orphans.length > 0 && (
        <Banner tone="warning" title={`${txnCount(orphans.length)} filed to Loans aren’t on a loan.`}>
          {format.money(orphans.reduce((s, t) => s - t.amount, 0), { sign: "always" })} net. A loan’s balance only moves for the transactions attached to it; open a loan to attach the ones that name its borrower, or attach any of them from its search.
        </Banner>
      )}
      {!loans ? (
        <Skeleton kind="card" />
      ) : loans.length === 0 ? (
        <Empty title="No loans yet" action={writable ? <Button variant="primary" onClick={() => setEditing("new")}>Add loan</Button> : undefined}>
          Loans the family makes or owes appear here with what was lent, repaid and is outstanding.
        </Empty>
      ) : (
        <Card flush>
          <Table
            caption="Loans"
            columns={columns}
            rows={loans}
            rowKey={keyOf}
            onRowClick={(l) => {
              setOpenKey(keyOf(l));
              requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
            }}
            totals={["Total owed to the family", "", "", "", money(owedTo)]}
            phoneRow={(l) => ({ title: l.name, secondary: l.holder_entity_name ? `Held by ${entityLabel(l.holder_entity_name)}` : "Holder not recorded", trailing: money(l.outstanding), onClick: () => setOpenKey(keyOf(l)) })}
          />
        </Card>
      )}

      <div ref={detailRef} className="scroll-mt-[72px]">
        {open && (
          <LoanDetail
            key={keyOf(open)}
            loan={open}
            rules={rules.filter((r) => r.loan_id === open.id)}
            registry={registry}
            categories={categories}
            writable={writable}
            onEdit={() => setEditing(open)}
            onChanged={() => void load()}
            onError={setError}
            post={post}
          />
        )}
      </div>

      {editing && (
        <LoanDialog
          loan={editing === "new" ? null : editing}
          entities={entities}
          onClose={() => setEditing(null)}
          onSaved={(name) => {
            setEditing(null);
            toast({ message: editing === "new" ? `Added the loan ${name}` : `Saved the loan ${name}` });
            void load();
          }}
          post={post}
        />
      )}
    </Page>
  );
}

function LoanDetail({
  loan,
  rules,
  registry,
  categories,
  writable,
  onEdit,
  onChanged,
  onError,
  post,
}: {
  loan: Loan;
  rules: LoanRule[];
  registry: Array<{ id: string; name: string }>;
  categories: string[];
  writable: boolean;
  onEdit: () => void;
  onChanged: () => void;
  onError: (m: string) => void;
  post: (url: string, body: Record<string, unknown>) => Promise<any>;
}) {
  const [ruleText, setRuleText] = useState("");
  const [hideOpen, setHideOpen] = useState(false);
  const unattached = loan.unattached ?? [];

  async function attach(ids: string[]) {
    if (!loan.id) return;
    const ok = await confirm({
      title: `Attach ${txnCount(ids.length)} to ${loan.name}?`,
      message: "They count toward this loan’s balance from now on. Each is recorded, and you can undo it right after.",
      confirmLabel: `Attach ${txnCount(ids.length)}`,
    });
    if (!ok) return;
    try {
      const data = await post("/api/books/ledger", { action: "attach_loan", loan_id: loan.id, transaction_ids: ids });
      changedToast(`Attached ${txnCount(Number(data.attached ?? ids.length))} to ${loan.name}`, data.undo, onChanged);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn’t attach those.");
    }
  }

  async function removeRule(r: LoanRule) {
    const ok = await confirm({
      title: "Delete this auto-attach rule?",
      object: { name: r.match },
      message: "New transactions stop attaching to this loan by themselves. The ones already attached stay.",
      confirmLabel: "Delete rule",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await post("/api/books/data", { action: "delete_rule", rule_id: r.id });
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn’t delete that rule.");
    }
  }

  async function addRule() {
    const text = ruleText.trim();
    if (text.length < 3 || !loan.id) return;
    try {
      const data = await post("/api/books/data", { action: "loan_rule", loan_id: loan.id, match: text });
      setRuleText("");
      changedToast(`Attached ${txnCount(Number(data.attached ?? 0))}, and new ones will follow`, data.undo, onChanged);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn’t save that rule.");
    }
  }

  async function setShown(on: boolean) {
    if (!loan.id) return;
    if (!on) {
      setHideOpen(true);
      return;
    }
    try {
      await post("/api/books/data", { action: "update_loan", loan_id: loan.id, show_on_report: true });
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn’t save that.");
    }
  }

  const related = !!loan.holder_entity_name;
  return (
    <Card title={loan.name} menu={writable && loan.id ? [{ label: "Edit loan…", onSelect: onEdit }] : undefined}>
      <div className="flex flex-col gap-6">
        <Rows>
          <Row label="Direction">{loan.direction === "payable" ? "Owed by the family" : loan.direction === "receivable" ? "Owed to the family" : "Owed to the family (not confirmed)"}</Row>
          <Row label="Held by">{loan.holder_entity_name ? entityLabel(loan.holder_entity_name) : undefined}</Row>
          <Row label="Other party">{loan.counterparty ?? undefined}</Row>
          <Row label="Starting balance" hint={loan.starting_balance_as_of ? `As of ${format.date(loan.starting_balance_as_of, "medium")}` : "The date it was counted from isn’t recorded."}>
            {money(loan.starting_balance)}
          </Row>
          <Row label="Interest rate" hint={related ? "A loan between family members or entities needs a rate at least at the applicable federal rate, or the IRS treats the difference as interest (IRC §7872)." : undefined}>
            {loan.rate !== null && loan.rate !== undefined ? format.percent(loan.rate, { decimals: 2 }) : undefined}
          </Row>
          <Row label="Term">{loan.start_date || loan.maturity_date ? [loan.start_date ? `From ${format.date(loan.start_date, "medium")}` : null, loan.maturity_date ? `due ${format.date(loan.maturity_date, "medium")}` : null].filter(Boolean).join(", ") : undefined}</Row>
          <Row label="Outstanding" hint="Starting balance, plus what was lent, less what was repaid. Interest isn’t split out yet: each repayment reduces the balance in full.">
            <span className="font-medium">{money(loan.outstanding)}</span>
          </Row>
        </Rows>

        {unattached.length > 0 && (
          <Banner tone="warning" title={`${txnCount(unattached.length)} name this borrower but aren’t on the loan.`} action={writable && loan.id ? <Button size="sm" variant="quiet" onClick={() => void attach(unattached.map((t) => t.transaction_id))}>Attach {unattached.length}</Button> : undefined}>
            {format.money(unattached.reduce((s, t) => s - t.amount, 0), { sign: "always" })} net, filed to Loans by an account rule.
          </Banner>
        )}

        {writable && loan.id && (
          <div className="flex flex-col gap-3">
            <Switch checked={loan.show_on_report} onChange={(v) => void setShown(v)} label="Show on the Treasury report" hint={loan.show_on_report ? undefined : `Left off${loan.hidden_reason ? `: ${loan.hidden_reason}` : ""}.`} />
            <div>
              <h3 className="mb-1 text-small font-semibold text-ink">Attach automatically</h3>
              <p className="mb-2 text-small text-ink-2">New transactions whose payee contains these words attach to this loan.</p>
              {rules.length > 0 && (
                <ul className="mb-2 flex flex-col">
                  {rules.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 border-b border-line py-1 text-body">
                      <span>{r.match}</span>
                      <IconButton icon="trash" label={`Delete the rule “${r.match}”`} onClick={() => void removeRule(r)} />
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center gap-2">
                <Input aria-label="Attach when the payee contains" placeholder="Words in the payee" value={ruleText} onChange={(e) => setRuleText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void addRule()} className="max-w-[280px]" />
                <Button size="sm" disabled={ruleText.trim().length < 3} disabledReason={ruleText.trim().length < 3 ? "At least 3 letters" : undefined} onClick={() => void addRule()}>
                  Add rule
                </Button>
              </div>
            </div>
            <Finder loan={loan} attach={(ids) => void attach(ids)} />
          </div>
        )}

        <div className="-mx-5 border-t border-line touch:-mx-4">
          {loan.transactions.length === 0 ? (
            <div className="px-5 pt-4 touch:px-4">
              <Empty size="section">No transactions attached yet. Search above, or attach one from any transaction’s Loan picker.</Empty>
            </div>
          ) : (
            <TxnTable context="loan" rows={loan.transactions} categories={categories} loans={registry} readOnly={!writable} onRowChange={onChanged} onError={onError} onReload={onChanged} />
          )}
        </div>
      </div>
      {hideOpen && <HideDialog loan={loan} post={post} onClose={() => setHideOpen(false)} onDone={onChanged} />}
    </Card>
  );
}

/** Search any synced transaction and attach it to this loan. */
function Finder({ loan, attach }: { loan: Loan; attach: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Txn[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!q.trim()) {
      setRows([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      setBusy(true);
      void authFetch(`/api/books/data?report=transactions&limit=25&summary=0&q=${encodeURIComponent(q.trim())}`)
        .then(async (r) => {
          const d = await r.json().catch(() => ({}));
          if (!cancelled && r.ok) setRows(((d.transactions ?? []) as Txn[]).filter((x) => x.loan_id !== loan.id));
        })
        .finally(() => !cancelled && setBusy(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, loan.id]);
  return (
    <div>
      <h3 className="mb-2 text-small font-semibold text-ink">Find transactions to attach</h3>
      <SearchField value={q} onChange={setQ} placeholder="Search payees and descriptions" label="Search transactions to attach" />
      {q.trim() && (
        <div className="mt-2 rounded-card border border-line">
          {busy && !rows.length ? (
            <p className="px-4 py-3 text-body text-ink-2">Searching…</p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-3 text-body text-ink-2">Nothing matches “{q.trim()}” that isn’t on this loan already.</p>
          ) : (
            <List label="Matching transactions">
              {rows.map((t) => (
                <ListRow
                  key={t.transaction_id}
                  title={displayName(t.merchant_name) || memoText(t.name)}
                  secondary={[format.date(t.date, "short"), t.entity_name ? entityLabel(t.entity_name) : "No entity", t.loan_id ? "on another loan" : null].filter(Boolean).join(" · ")}
                  meta={ledgerMoney(t.amount)}
                  action={
                    <Button size="sm" onClick={() => attach([t.transaction_id])}>
                      Attach
                    </Button>
                  }
                />
              ))}
            </List>
          )}
        </div>
      )}
    </div>
  );
}

/** Leaving a loan off the Treasury report needs a reason, which is kept and shown. */
function HideDialog({ loan, post, onClose, onDone }: { loan: Loan; post: (url: string, body: Record<string, unknown>) => Promise<any>; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Leave ${loan.name} off the Treasury report?`}
      description="The report then shows one fewer loan; the reason is kept with the loan and shown here."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={reason.trim().length < 3}
            disabledReason="Say why"
            onClick={() =>
              void post("/api/books/data", { action: "update_loan", loan_id: loan.id, show_on_report: false, hidden_reason: reason.trim() })
                .then(() => {
                  onClose();
                  onDone();
                })
                .catch((e) => setErr(e instanceof Error ? e.message : "Couldn’t save that."))
            }
          >
            Leave it off
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-[6px]">
        <span className="text-small font-medium text-ink">Reason</span>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: forgiven in 2025, pending write-off" />
      </label>
      {err && <Banner tone="negative" className="mt-3">{err}</Banner>}
    </Dialog>
  );
}

/** Add or edit a loan: who, which way, held by whom, the starting balance and its date, and the terms. */
function LoanDialog({ loan, entities, onClose, onSaved, post }: { loan: Loan | null; entities: Entity[]; onClose: () => void; onSaved: (name: string) => void; post: (url: string, body: Record<string, unknown>) => Promise<any> }) {
  const [name, setName] = useState(loan?.name ?? "");
  const [direction, setDirection] = useState<"receivable" | "payable">(loan?.direction === "payable" ? "payable" : "receivable");
  const [holder, setHolder] = useState(entities.find((e) => e.name === loan?.holder_entity_name)?.id ?? "");
  const [counterparty, setCounterparty] = useState(loan?.counterparty ?? "");
  const [balance, setBalance] = useState(loan ? String(loan.starting_balance) : "");
  const [asOf, setAsOf] = useState(loan?.starting_balance_as_of ?? "");
  const [rate, setRate] = useState(loan?.rate !== null && loan?.rate !== undefined ? String(loan.rate) : "");
  const [start, setStart] = useState(loan?.start_date ?? "");
  const [maturity, setMaturity] = useState(loan?.maturity_date ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const day = (s: string) => (s.trim() ? format.parseDate(s) : null);

  async function save() {
    const amount = balance.trim() ? format.parseMoney(balance) : 0;
    if (!name.trim()) return setErr("Give the loan a name.");
    if (amount === null) return setErr("Enter the starting balance as an amount.");
    for (const [label, v] of [
      ["the as-of date", asOf],
      ["the start date", start],
      ["the due date", maturity],
    ] as const)
      if (v.trim() && !day(v)) return setErr(`Enter ${label} like Dec 31, 2025.`);
    setBusy(true);
    setErr("");
    const ent = entities.find((e) => e.id === holder);
    const body = {
      name: name.trim(),
      starting_balance: amount,
      starting_balance_as_of: day(asOf),
      direction,
      holder_entity_id: ent?.id ?? null,
      holder_entity_name: ent?.name ?? null,
      counterparty: counterparty.trim() || null,
      rate: rate.trim() ? Number(rate) : null,
      start_date: day(start),
      maturity_date: day(maturity),
    };
    try {
      if (loan?.id) await post("/api/books/data", { action: "update_loan", loan_id: loan.id, ...body });
      else await post("/api/books/data", { action: "create_loan", ...body });
      onSaved(body.name);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn’t save that loan.");
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, input: React.ReactNode, hint?: string) => (
    <label className="flex flex-col gap-[6px]">
      <span className="text-small font-medium text-ink">{label}</span>
      {input}
      {hint && <span className="text-small text-ink-2">{hint}</span>}
    </label>
  );
  return (
    <Dialog
      open
      onClose={onClose}
      dirty
      title={loan ? `Edit loan: ${loan.name}` : "Add a loan"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} busyLabel="Saving…" onClick={() => void save()}>
            {loan?.id ? "Save loan" : "Add loan"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {field("Name", <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Who owes the money" maxLength={80} />)}
        <ChoiceTiles
          label="Which way"
          stacked
          value={direction}
          onChange={setDirection}
          options={[
            { value: "receivable", title: "Owed to the family", description: "The family lent the money." },
            { value: "payable", title: "Owed by the family", description: "The family borrowed it." },
          ]}
        />
        {field("Held by", <Menu value={holder} label="Held by" placeholder="Choose the entity" size="md" className="w-full" onChange={setHolder} options={entities.map((e) => ({ value: e.id, label: entityLabel(e.name) }))} />, "The entity whose books carry the loan.")}
        {field("Other party", <Input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="The borrower or lender’s legal name" />)}
        <div className="grid gap-4 sm:grid-cols-2">
          {field("Starting balance", <Input inputMode="decimal" prefix="$" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0.00" />)}
          {field("As of", <Input value={asOf} onChange={(e) => setAsOf(e.target.value)} placeholder="Dec 31, 2025" />)}
          {field("Interest rate", <Input inputMode="decimal" suffix="%" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="4.25" />)}
          {field("Start", <Input value={start} onChange={(e) => setStart(e.target.value)} placeholder="Jan 1, 2024" />)}
          {field("Due", <Input value={maturity} onChange={(e) => setMaturity(e.target.value)} placeholder="Dec 31, 2030" />)}
        </div>
        <p className="text-small text-ink-2">The starting balance covers anything lent before the bank history begins; what’s lent and repaid after moves it. Changes are recorded with your name.</p>
        {err && <Banner tone="negative">{err}</Banner>}
      </div>
    </Dialog>
  );
}
