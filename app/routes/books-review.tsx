import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { authFetch, canWrite } from "../auth";
import { accountShort, displayName, entityLabel, ledgerMoney, memoText, txnCount } from "../books-shared";
import { Banner, Button, Card, Dialog, Disclosure, Empty, Input, LinkButton, List, ListRow, Page, PageHeader, Skeleton, Status, Table, format, toast, useDocumentTitle, usePhone, type Column } from "../ui";

export function meta() {
  return [{ title: "Review · BFO" }];
}

type Row = {
  transaction_id: string;
  date: string;
  name: string | null;
  merchant_name: string | null;
  amount: number;
  book_category: string | null;
  plaid_category_detailed?: string | null;
  entity_name: string | null;
  account_name?: string;
  item_id: string;
};
type Group = { group_key?: string; count: number; cross_source: boolean; amount: number; date: string; account_name?: string; entity_name?: string | null; rows: Row[] };
type Account = {
  account_id: string;
  name: string;
  institution: string | null;
  entity_name: string | null;
  mapped?: boolean;
  investment?: boolean;
  card?: boolean;
  opening?: { opening_balance: number; as_of: string; set_by_name: string | null } | null;
  activity?: number;
  ledger?: number;
  ledger_net: number;
  bank_balance: number | null;
  bank_seen_at?: string | null;
  ledger_through?: string | null;
  has_ledger: boolean;
  difference?: number | null;
  status?: "tied" | "off" | "needs_opening" | "no_rows" | "not_in_books";
};
type Review = {
  counts: { uncategorized: number; low_confidence: number; duplicate_groups: number; checks?: number; mismatched?: number; pending?: number };
  uncategorized?: Row[];
  low_confidence: Row[];
  checks?: Row[];
  mismatched?: Row[];
  duplicates: Group[];
  outliers: Row[];
  reconciliation?: { accounts: Account[]; openings_available?: boolean };
};

const who = (t: Row) => displayName(t.merchant_name) || memoText(t.name) || "—";
const SHOW = 8;

/**
 * The review desk: what the books want a person to decide, in the order to
 * decide it. Rows with no account or a doubtful one, possible duplicates,
 * the bank tie-out per account, and the largest items. Each section ends in
 * the action that settles it.
 */
export default function BooksReview() {
  useDocumentTitle("Review");
  const writable = canWrite();
  const [review, setReview] = useState<Review | null>(null);
  const [recon, setRecon] = useState<Account[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState<Account | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const r = await authFetch("/api/books/data?report=review");
      if (!r.ok) throw new Error();
      const data = (await r.json()) as Review;
      setReview(data);
      if (data.reconciliation) setRecon(data.reconciliation.accounts);
      else {
        // An older server: the plain ledger-vs-bank list.
        const c = await authFetch("/api/books/data?report=reconciliation");
        if (c.ok) setRecon(((await c.json()).accounts ?? []) as Account[]);
      }
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function dismiss(g: Group) {
    if (!g.group_key) return;
    const res = await authFetch("/api/books/ledger", { method: "POST", body: JSON.stringify({ action: "review_duplicate", group_key: g.group_key }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ message: data?.message || "Couldn’t save that. Try again." });
      return;
    }
    toast({ message: "Marked as two separate payments" });
    setReview((r) => (r ? { ...r, duplicates: r.duplicates.filter((x) => x.group_key !== g.group_key), counts: { ...r.counts, duplicate_groups: r.counts.duplicate_groups - 1 } } : r));
  }

  const c = review?.counts;
  const needsDecision = c ? (c.uncategorized ?? 0) + (c.checks ?? 0) + (c.mismatched ?? 0) : 0;
  const context = review ? `${format.count(needsDecision + (c?.low_confidence ?? 0), "item", "items")} to decide · ${format.count(c?.duplicate_groups ?? 0, "possible duplicate", "possible duplicates")}` : undefined;

  return (
    <Page width="workspace" header={<PageHeader title="Review" context={context} />}>
      {failed && (
        <Banner tone="negative" action={<Button variant="quiet" size="sm" onClick={() => void load()}>Try again</Button>}>
          Couldn’t load the review.
        </Banner>
      )}
      {!review && !failed ? (
        <>
          <Skeleton kind="card" />
          <Skeleton kind="card" />
        </>
      ) : review ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <CountLink to="/books/transactions?type=uncategorized" label="Not categorized" n={c?.uncategorized ?? 0} />
            <CountLink to="#doubtful" label="In a catch-all account" n={c?.low_confidence ?? 0} />
            <CountLink to="#duplicates" label="Possible duplicates" n={c?.duplicate_groups ?? 0} />
          </div>

          <DecideSection review={review} writable={writable} />

          <Card id="duplicates" title="Possible duplicates" count={review.duplicates.length} countTone={review.duplicates.length ? "attention" : "neutral"} flush>
            <p className="px-5 pb-3 text-small text-ink-2 touch:px-4">The same account, day and amount. Two rows from two feeds (the bank feed and an import) are probably the same payment counted twice; both still count in the reports until one is removed.</p>
            {review.duplicates.length === 0 ? (
              <div className="border-t border-line px-5 py-4 touch:px-4">
                <Empty size="section">Nothing looks doubled.</Empty>
              </div>
            ) : (
              <DuplicateList groups={review.duplicates} writable={writable} onDismiss={dismiss} />
            )}
          </Card>

          <Reconciliation accounts={recon} available={review.reconciliation?.openings_available !== false && !!review.reconciliation} writable={writable} onSetOpening={setOpening} />

          <Card title="Largest items" flush info="The biggest transactions on the profit and loss, for a sense check: a wrong account here moves the totals most.">
            <Rows rows={review.outliers} />
          </Card>
        </>
      ) : null}
      <OpeningDialog
        account={opening}
        onClose={() => setOpening(null)}
        onSaved={() => {
          setOpening(null);
          void load();
        }}
      />
    </Page>
  );
}

function CountLink({ to, label, n }: { to: string; label: string; n: number }) {
  const body = (
    <>
      <span className="text-small text-ink-2">{label}</span>
      <span className="mt-1 flex items-center justify-between text-heading tabular-nums text-ink">
        {n.toLocaleString("en-US")}
        <span className="text-ink-3">
          <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 3.5L10.5 8 6 12.5" />
          </svg>
        </span>
      </span>
    </>
  );
  const cls = "ds flex flex-col rounded-card border border-line bg-raised p-4 hover:bg-hover";
  return to.startsWith("#") ? (
    <a href={to} className={cls}>
      {body}
    </a>
  ) : (
    <Link to={to} className={cls}>
      {body}
    </Link>
  );
}

/** Rows that need a person's decision: no account, a bare check, a bank category that contradicts the account, a catch-all account. */
function DecideSection({ review, writable }: { review: Review; writable: boolean }) {
  const groups: Array<{ id?: string; title: string; hint: string; rows: Row[]; total: number }> = [
    { title: "Not categorized", hint: "No account yet, so they’re off the profit and loss.", rows: review.uncategorized ?? [], total: review.counts.uncategorized },
    { title: "Checks with no payee", hint: "A check could be a gift, a distribution or a payment that needs a 1099. Add the payee and the account.", rows: review.checks ?? [], total: review.counts.checks ?? 0 },
    { title: "Bank says tax, books say otherwise", hint: "The bank calls these tax payments but they’re filed elsewhere. An owner’s tax paid by an entity is usually a distribution.", rows: review.mismatched ?? [], total: review.counts.mismatched ?? 0 },
    { id: "doubtful", title: "In a catch-all account", hint: "Filed to Other Operating Expenses or Other Income. A more specific account makes the statements clearer.", rows: review.low_confidence, total: review.counts.low_confidence },
  ].filter((g) => g.total > 0 || g.id);
  return (
    <Card title="To decide" flush action={writable ? <LinkButton to="/books/transactions?type=uncategorized" size="sm" variant="primary">Categorize</LinkButton> : undefined}>
      {groups.every((g) => g.total === 0) ? (
        <div className="px-5 pb-5 touch:px-4">
          <Empty size="section">Everything has an account.</Empty>
        </div>
      ) : (
        groups.map((g) =>
          g.total === 0 ? null : (
            <section key={g.title} id={g.id} className="scroll-mt-[72px] border-t border-line">
              <div className="px-5 pt-3 touch:px-4">
                <h3 className="text-small font-semibold text-ink">
                  {g.title} <span className="font-normal text-ink-2 tabular-nums">· {g.total.toLocaleString("en-US")}</span>
                </h3>
                <p className="text-small text-ink-2">{g.hint}</p>
              </div>
              <Rows rows={g.rows} limit={5} />
            </section>
          ),
        )
      )}
    </Card>
  );
}

/** A short list of transactions; each opens its vendor, where the rows are refiled. */
function Rows({ rows, limit = SHOW }: { rows: Row[]; limit?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, limit);
  if (!rows.length) return null;
  return (
    <>
      <List label="Transactions">
        {shown.map((t) => (
          <ListRow
            key={t.transaction_id}
            to={t.merchant_name ? `/books/vendors/detail?name=${encodeURIComponent(t.merchant_name)}` : `/books/transactions?q=${encodeURIComponent(t.name ?? "")}`}
            title={who(t)}
            secondary={[format.date(t.date, "short"), t.book_category ? accountShort(t.book_category) : "Uncategorized", t.entity_name ? entityLabel(t.entity_name) : "No entity"].join(" · ")}
            trailing={ledgerMoney(t.amount)}
          />
        ))}
      </List>
      {rows.length > limit && (
        <div className="border-t border-line px-5 py-2 touch:px-4">
          <Button variant="quiet" size="sm" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${rows.length}`}
          </Button>
        </div>
      )}
    </>
  );
}

function DuplicateList({ groups, writable, onDismiss }: { groups: Group[]; writable: boolean; onDismiss: (g: Group) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? groups : groups.slice(0, SHOW);
  return (
    <>
      <ul className="ds">
        {shown.map((g, i) => (
          <li key={g.group_key ?? i} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-5 py-3 touch:px-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-body text-ink">
                {who(g.rows[0])} <span className="text-ink-2">· {txnCount(g.count).replace("transactions", "copies").replace("transaction", "copy")}</span>
              </p>
              <p className="text-small text-ink-2">
                {[format.date(g.date, "medium"), g.account_name, g.entity_name ? entityLabel(g.entity_name) : null].filter(Boolean).join(" · ")}
                {g.cross_source ? " · in two feeds, probably the same payment twice" : " · from one feed, may be two payments"}
              </p>
            </div>
            <span className="text-body font-medium tabular-nums">{ledgerMoney(g.amount)}</span>
            <div className="flex gap-2">
              <LinkButton to={`/books/transactions?q=${encodeURIComponent(g.rows[0].merchant_name || g.rows[0].name || "")}`} size="sm">
                Open
              </LinkButton>
              {writable && g.group_key && (
                <Button size="sm" variant="quiet" onClick={() => onDismiss(g)}>
                  Two separate payments
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {groups.length > SHOW && (
        <div className="border-t border-line px-5 py-2 touch:px-4">
          <Button variant="quiet" size="sm" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${groups.length}`}
          </Button>
        </div>
      )}
    </>
  );
}

const STATUS: Record<NonNullable<Account["status"]>, { tone: "neutral" | "positive" | "warning" | "negative" | "info"; word: string }> = {
  tied: { tone: "positive", word: "Ties to the bank" },
  off: { tone: "warning", word: "Doesn’t tie" },
  needs_opening: { tone: "warning", word: "Needs an opening balance" },
  no_rows: { tone: "warning", word: "No ledger rows" },
  not_in_books: { tone: "neutral", word: "Not in Books" },
};

/**
 * Bank vs books, per account, to the cent: opening balance + activity =
 * the books' balance, against the bank's balance and when it was seen. It
 * ties only with an opening balance; until one is set it says so.
 */
function Reconciliation({ accounts, available, writable, onSetOpening }: { accounts: Account[] | null; available: boolean; writable: boolean; onSetOpening: (a: Account) => void }) {
  const phone = usePhone();
  if (!accounts) return <Skeleton kind="card" />;
  const books = accounts.filter((a) => !a.investment && a.status !== "not_in_books");
  const outside = accounts.filter((a) => a.investment || a.status === "not_in_books");
  const status = (a: Account): ReactNode => {
    const s = a.status ?? (!a.has_ledger ? "no_rows" : "needs_opening");
    return s === "off" && a.difference !== null && a.difference !== undefined ? <Status tone="warning">Off by {format.money(Math.abs(a.difference))}</Status> : <Status tone={STATUS[s].tone}>{STATUS[s].word}</Status>;
  };
  const head = (a: Account) => (a.entity_name ? entityLabel(a.entity_name) : "No entity");
  const columns: Column<Account>[] = [
    {
      key: "account",
      header: "Account",
      render: (a) => (
        <span>
          {head(a)}
          <span className="block text-small text-ink-2">{[a.name, a.institution].filter(Boolean).join(" · ")}</span>
        </span>
      ),
    },
    { key: "opening", header: "Opening", align: "right", width: "130px", render: (a) => (a.opening ? format.money(a.opening.opening_balance, { sign: "accounting" }) : "") },
    { key: "books", header: "Books", align: "right", width: "140px", render: (a) => format.money(a.ledger ?? a.ledger_net, { sign: "accounting" }) },
    { key: "bank", header: "Bank", align: "right", width: "140px", render: (a) => (a.bank_balance === null ? "" : format.money(a.bank_balance, { sign: "accounting" })) },
    { key: "status", header: "Status", width: "190px", render: status },
    ...(writable && available
      ? [
          {
            key: "act",
            header: "",
            width: "120px",
            render: (a: Account) => (
              <Button size="sm" variant="quiet" onClick={() => onSetOpening(a)}>
                {a.opening ? "Change opening" : "Set opening"}
              </Button>
            ),
          },
        ]
      : []),
  ];
  const seen = books.map((a) => a.bank_seen_at).filter((d): d is string => !!d).sort()[0];
  return (
    <Card
      title="Bank vs books"
      flush
      info="Each account’s books balance is its opening balance plus every posted transaction after the opening date. It ties when that equals the bank’s balance to the cent. Card balances are shown as what’s owed, negative."
    >
      <p className="px-5 pb-3 text-small text-ink-2 touch:px-4">
        {available ? "Set each account’s opening balance from a statement to tie it." : "Without opening balances this compares activity with today’s balance, so it can’t tie yet."}
        {seen ? ` Bank balances as of ${format.dateTime(seen)} or later.` : ""}
      </p>
      {phone ? (
        <List label="Accounts">
          {books.map((a) => (
            <ListRow
              key={a.account_id}
              title={head(a)}
              secondary={`${a.name} · ${a.difference ? `off by ${format.money(Math.abs(a.difference))}` : a.status ? STATUS[a.status].word.toLowerCase() : !a.has_ledger ? "no ledger rows" : ""}`}
              trailing={a.bank_balance === null ? "" : format.money(a.bank_balance, { sign: "accounting" })}
              onClick={writable && available ? () => onSetOpening(a) : undefined}
            />
          ))}
        </List>
      ) : (
        <div className="border-t border-line">
          <Table caption="Bank vs books" columns={columns} rows={books} rowKey={(a) => a.account_id} phoneRow={(a) => ({ title: head(a) })} />
        </div>
      )}
      {outside.length > 0 && (
        <div className="border-t border-line px-5 py-3 touch:px-4">
          <Disclosure label="Not in Books by design" count={outside.length}>
            <ul className="mt-1 flex flex-col gap-1 text-body text-ink-2">
              {outside.map((a) => (
                <li key={a.account_id}>
                  {a.name}
                  {a.entity_name ? ` · mapped to ${entityLabel(a.entity_name)}` : ""}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-small text-ink-2">Investment and retirement accounts are tracked on Investments. An individual retirement account belongs to one person; check the mapping in Treasury if it shows a trust or company.</p>
          </Disclosure>
        </div>
      )}
    </Card>
  );
}

/** Set an account's opening balance from a statement: the figure and the date it was on. */
function OpeningDialog({ account, onClose, onSaved }: { account: Account | null; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState("");
  const [asOf, setAsOf] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!account) return;
    setAmount(account.opening ? String(account.opening.opening_balance) : "");
    setAsOf(account.opening?.as_of ?? "");
    setErr("");
  }, [account]);
  async function save() {
    const n = format.parseMoney(amount);
    const d = format.parseDate(asOf);
    if (n === null || !d) {
      setErr("Enter the balance and the statement date.");
      return;
    }
    setBusy(true);
    const res = await authFetch("/api/books/ledger", { method: "POST", body: JSON.stringify({ action: "set_opening", account_id: account?.account_id, opening_balance: n, as_of: d }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErr(data?.message || "Couldn’t save that balance.");
      return;
    }
    onSaved();
  }
  return (
    <Dialog
      open={!!account}
      onClose={onClose}
      title={account ? `Opening balance: ${account.name}` : "Opening balance"}
      description="The balance on a bank statement, and the statement’s date. Transactions after that date are added to it."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} busyLabel="Saving…" onClick={() => void save()}>
            Save opening balance
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-[6px]">
          <span className="text-small font-medium text-ink">Balance</span>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} prefix="$" placeholder="0.00" />
        </label>
        <label className="flex flex-col gap-[6px]">
          <span className="text-small font-medium text-ink">Statement date</span>
          <Input value={asOf} onChange={(e) => setAsOf(e.target.value)} placeholder="Dec 31, 2025" />
        </label>
        {err && <Banner tone="negative">{err}</Banner>}
      </div>
    </Dialog>
  );
}
