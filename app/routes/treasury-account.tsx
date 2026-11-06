/**
 * One account in Treasury: its balance and when it was read, who owns it,
 * and its Books ledger (Plaid rows and CSV imports, as Books keeps them).
 * Renaming, changing the owner and hiding are confirmed and recorded on the
 * server (api/plaid/account-prefs.ts). A CSV import is previewed with its
 * totals before anything is added to Books (api/books/import-csv.ts).
 * Built on app/ui (docs/DESIGN.md).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { canWrite } from "../auth";
import {
  Banner,
  Button,
  Card,
  Checkbox,
  Dialog,
  Empty,
  Field,
  Input,
  LinkButton,
  Page,
  PageHeader,
  Row,
  Rows,
  SearchField,
  Skeleton,
  Status,
  Table,
  confirm,
  format,
  toast,
  useDocumentTitle,
  type Column,
  type MenuItem,
} from "../ui";
import { TAX_STATUS_LABEL, TENANCY_LABEL, defaultTaxStatus, isDebt, registration } from "../treasury-model";
import { OwnerDialog } from "../treasury-ui";
import {
  accountName,
  confirmOwnerChange,
  conflictOf,
  getJson,
  loadTreasury,
  officialName,
  ownerText,
  saveOwner,
  stoppedAsAccount,
  typeLabel,
  useRecords,
  type Account,
  type Connection,
  type OwnerChoice,
  type StoppedAccount,
} from "../treasury-data";

export function meta() {
  return [{ title: "Account · Treasury · BFO" }];
}

type Txn = { id?: string; date: string; name: string; description: string; category: string | null; amount: number; pending: boolean; currency: string | null; source?: string };
type Ledger = { rows: Txn[]; source: "books" | "bank"; total: number };

// ── CSV parsing (bank exports) ────────────────────────────────────────────
type CsvRow = { date: string; description: string; amount: number };

/** RFC-ish CSV split: honours quotes, doubled quotes, and CRLF. */
function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** "08/13/2026", "2026-08-13", "8/3/26" → "YYYY-MM-DD" (or "" if unusable). */
function normalizeDate(raw: string): string {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(s);
  if (m) {
    let yr = m[3];
    if (yr.length === 2) yr = Number(yr) > 70 ? `19${yr}` : `20${yr}`;
    return `${yr}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return "";
}

/** "$1,234.56", "(45.00)", "-45" → number (parentheses or a trailing minus mean negative). */
function parseAmount(raw: string): number {
  let s = raw.trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/-$/.test(s)) {
    neg = true;
    s = s.replace(/-$/, "");
  }
  const n = Number(s.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return NaN;
  return neg ? -Math.abs(n) : n;
}

/**
 * Rows from a bank CSV: headed exports by column name (including split
 * debit and credit columns), or the header-less layout [date, amount, *, *,
 * description]. Signed as the bank signs them: deposits positive. The
 * preview shows the totals so a wrong sign is caught before anything posts.
 */
function parseBankCsv(text: string): { rows: CsvRow[]; headerless: boolean } {
  const records = splitCsv(text);
  if (!records.length) return { rows: [], headerless: false };
  const header = records[0].map((c) => c.trim().toLowerCase());
  const hasHeader = header.some((c) => /date|amount|description|payee|debit|credit|withdraw|deposit|memo/.test(c));
  let iDate = -1;
  let iDesc = -1;
  let iAmt = -1;
  let iDebit = -1;
  let iCredit = -1;
  let body = records;
  if (hasHeader) {
    header.forEach((c, i) => {
      if (iDate < 0 && /date/.test(c)) iDate = i;
      if (iDesc < 0 && /desc|payee|name|memo/.test(c)) iDesc = i;
      if (iAmt < 0 && /^amount|amount$|\bamount\b/.test(c)) iAmt = i;
      if (iDebit < 0 && /debit|withdraw/.test(c)) iDebit = i;
      if (iCredit < 0 && /credit|deposit/.test(c)) iCredit = i;
    });
    body = records.slice(1);
  } else {
    iDate = 0;
    iAmt = 1;
    iDesc = 4;
  }
  if (iDate < 0) iDate = 0;
  const out: CsvRow[] = [];
  for (const cols of body) {
    const date = normalizeDate(cols[iDate] ?? "");
    if (!date) continue;
    const description = (iDesc >= 0 ? (cols[iDesc] ?? "") : "").trim() || (cols.find((c, i) => i !== iDate && i !== iAmt && c.trim()) ?? "").trim();
    let amount = NaN;
    if (iAmt >= 0 && (cols[iAmt] ?? "").trim() !== "") amount = parseAmount(cols[iAmt]);
    else if (iDebit >= 0 || iCredit >= 0) {
      const d = parseAmount(cols[iDebit] ?? "");
      const c = parseAmount(cols[iCredit] ?? "");
      amount = (Number.isFinite(c) ? Math.abs(c) : 0) - (Number.isFinite(d) ? Math.abs(d) : 0);
    }
    if (!Number.isFinite(amount) || amount === 0) continue;
    out.push({ date, description, amount });
  }
  return { rows: out, headerless: !hasHeader };
}

async function sha256(text: string): Promise<string | null> {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

type ImportPlan = {
  file: string;
  sha: string | null;
  rows: CsvRow[];
  headerless: boolean;
  chargesPositive: boolean;
  server: null | { to_add: number; already_here: number; near_matches: number; money_in: number; money_out: number; first: string; last: string; locked: number; closed_through: string | null };
};

const PAGE = 200;

export default function TreasuryAccount() {
  const { accountId = "" } = useParams();
  const navigate = useNavigate();
  const records = useRecords();
  const writer = canWrite();

  const [account, setAccount] = useState<Account | null>(null);
  const [stopped, setStopped] = useState<StoppedAccount | null>(null);
  const [conn, setConn] = useState<Connection | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [reload, setReload] = useState(0);

  const title = account ? accountName(account) : stopped ? accountName({ nickname: stopped.nickname, name: stopped.name, mask: stopped.mask }) : "Account";
  useDocumentTitle(title, "Treasury");

  useEffect(() => {
    let stale = false;
    setLoadError(null);
    void (async () => {
      try {
        const data = await loadTreasury();
        if (stale) return;
        const found = data.accounts.find((a) => a.account_id === accountId) ?? null;
        const gone = data.disconnected.find((a) => a.account_id === accountId) ?? null;
        if (!found && !gone) throw new Error("That account isn’t connected any more.");
        setAccount(found);
        setStopped(found ? null : gone);
        setConn(found ? (data.connections.find((c) => c.item_id === found.item_id) ?? null) : null);
        setAsOf(data.asOf);
      } catch (err) {
        if (!stale) setLoadError(err instanceof Error ? err.message : "Couldn’t load the account.");
      }
    })();
    return () => {
      stale = true;
    };
  }, [accountId, reload]);

  const investment = account?.type === "investment" || stopped?.type === "investment";
  useEffect(() => {
    if (!account && !stopped) return;
    let stale = false;
    setLedger(null);
    setLedgerError(null);
    setShown(PAGE);
    void (async () => {
      try {
        // The Books ledger: the kept record, Plaid rows and CSV imports alike.
        const out = await getJson<{ transactions: Txn[]; total: number }>(`/api/plaid/data?report=account-ledger&account_id=${encodeURIComponent(accountId)}`);
        if (!stale) setLedger({ rows: out.transactions, source: "books", total: out.total });
      } catch (err) {
        if (stale) return;
        // A server without the ledger read: the bank's last 180 days through Plaid.
        if (account && !investment) {
          try {
            const out = await getJson<{ transactions: Txn[]; total: number }>(`/api/plaid/data?report=bank-transactions&item_id=${account.item_id}&account_id=${account.account_id}`);
            if (!stale) setLedger({ rows: out.transactions, source: "bank", total: out.total });
          } catch (e2) {
            if (!stale) setLedgerError(e2 instanceof Error ? e2.message : "Couldn’t load transactions.");
          }
        } else if (!investment) setLedgerError(err instanceof Error ? err.message : "Couldn’t load transactions.");
        else setLedger({ rows: [], source: "books", total: 0 });
      }
    })();
    return () => {
      stale = true;
    };
    // The ids, not the objects: a rename shouldn't re-read the ledger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, !!account, !!stopped, investment, reload]);

  const filtered = useMemo(() => {
    const rows = ledger?.rows ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((t) => `${t.name} ${t.description} ${t.category ?? ""}`.toLowerCase().includes(q));
  }, [ledger, search]);

  if (loadError) {
    return (
      <Page header={<PageHeader title="Account" back={{ to: "/treasury", label: "Treasury" }} />}>
        <Banner
          tone="negative"
          action={
            <Button variant="quiet" size="sm" onClick={() => setReload((n) => n + 1)}>
              Try again
            </Button>
          }
        >
          {loadError}
        </Banner>
      </Page>
    );
  }
  if (!account && !stopped) {
    return (
      <Page header={<PageHeader title="Account" back={{ to: "/treasury", label: "Treasury" }} />}>
        <Skeleton kind="card" />
        <Skeleton kind="rows" rows={6} />
      </Page>
    );
  }

  // A stopped account reads from its kept row; a live one from the bank.
  const a: Account = account ?? stoppedAsAccount(stopped!);
  const debt = isDebt(a);
  const owner = ownerText(a, (id) => (records.loaded ? records.nameOf(id) : (a.entity_name ?? null)));
  const reg = registration(a.official_name || a.name, a.subtype);
  const conflict = conflictOf(a, records.isTrust);
  const bankName = officialName(a);
  const tax = a.tax_status ?? null;
  const taxGuess = defaultTaxStatus(a.subtype, a.official_name || a.name, a.type);
  const canImport = writer && !investment && !stopped;
  const offline = !!account && conn?.status !== "online";

  async function savePrefs(patch: Record<string, unknown>): Promise<boolean> {
    try {
      await getJson("/api/plaid/account-prefs", { method: "POST", body: JSON.stringify({ account_id: a.account_id, ...patch }) });
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save that.");
      return false;
    }
  }

  async function rename() {
    const next = nameDraft.trim();
    if (next === (a.nickname ?? "")) return setRenaming(false);
    if (await savePrefs({ nickname: next })) {
      setRenaming(false);
      if (account) setAccount({ ...account, nickname: next || null });
      else if (stopped) setStopped({ ...stopped, nickname: next || null });
      toast({ message: next ? `Renamed to ${next}` : "Back to the bank’s name" });
    }
  }

  async function hide() {
    let books: { count: number; from: string | null; to: string | null } | null = null;
    try {
      books = (await getJson<{ books: { count: number; from: string | null; to: string | null } }>(`/api/plaid/account-prefs?account_id=${encodeURIComponent(a.account_id)}`)).books;
    } catch {
      books = null;
    }
    const ok = await confirm({
      title: "Hide this account?",
      object: { name: accountName(a), detail: `${a.institution_name} · ${format.money((debt ? -1 : 1) * (a.balance_current ?? 0))}` },
      message: "It leaves Treasury’s totals, every Books report and the emailed Treasury report until you show it again. Nothing is deleted.",
      details:
        books && books.count > 0 && books.from && books.to
          ? [`${format.count(books.count, "Books transaction")}, ${format.dateRange(books.from, books.to)}, leave the reports while it’s hidden.`]
          : undefined,
      confirmLabel: "Hide account",
    });
    if (!ok) return;
    if (await savePrefs({ hidden: true })) {
      toast({
        message: `Hid ${accountName(a)}`,
        action: { label: "Undo", run: () => void getJson("/api/plaid/account-prefs", { method: "POST", body: JSON.stringify({ account_id: a.account_id, hidden: false }) }) },
      });
      navigate("/treasury");
    }
  }

  async function show() {
    if (await savePrefs({ hidden: false })) {
      if (account) setAccount({ ...account, hidden: false });
      toast({ message: `${accountName(a)} is back in the totals` });
    }
  }

  async function onOwnerSave(choice: OwnerChoice): Promise<string | null> {
    const toPerson = choice.owner_kind === "person" || choice.owner_kind === "joint";
    const toText = toPerson ? (choice.owner_names ?? []).filter(Boolean).join(" & ") : (choice.entity_name ?? null);
    if (!(await confirmOwnerChange(a, owner, toText || null, toPerson))) return "Not changed.";
    const err = await saveOwner(a.account_id, choice);
    if (err) return err;
    const next = {
      ...a,
      owner_kind: choice.owner_kind,
      owner_names: choice.owner_names ?? null,
      tenancy: choice.tenancy ?? null,
      entity_id: toPerson ? null : (choice.entity_id ?? null),
      entity_name: toPerson ? null : (choice.entity_name ?? null),
      tax_status: choice.tax_status ?? null,
      beneficiary_entity_id: choice.beneficiary_entity_id || null,
      beneficiary_name: choice.beneficiary_name || null,
    };
    if (account) setAccount(next);
    toast({ message: "Owner saved" });
    return null;
  }

  // ── CSV import, previewed ─────────────────────────────────────────────
  async function dryRun(p: ImportPlan): Promise<ImportPlan> {
    try {
      const out = await getJson<NonNullable<ImportPlan["server"]>>("/api/books/import-csv", {
        method: "POST",
        body: JSON.stringify({ account_id: a.account_id, rows: p.rows, file_name: p.file, file_sha256: p.sha, charges_positive: p.chargesPositive, dry_run: true }),
      });
      return { ...p, server: out };
    } catch {
      return { ...p, server: null };
    }
  }

  async function pickFile(file: File) {
    const text = await file.text();
    const parsed = parseBankCsv(text);
    if (fileInput.current) fileInput.current.value = "";
    if (!parsed.rows.length) return setError("That file has no dated rows with amounts. Export the account’s activity as CSV and try again.");
    setPlan(await dryRun({ file: file.name, sha: await sha256(text), rows: parsed.rows, headerless: parsed.headerless, chargesPositive: false, server: null }));
  }

  async function runImport() {
    if (!plan) return;
    setImporting(true);
    try {
      const out = await getJson<{ imported: number; skipped_existing: number; import_id?: string }>("/api/books/import-csv", {
        method: "POST",
        body: JSON.stringify({ account_id: a.account_id, rows: plan.rows, file_name: plan.file, file_sha256: plan.sha, charges_positive: plan.chargesPositive }),
      });
      setPlan(null);
      toast({
        message: `Added ${format.count(out.imported, "transaction")} to Books`,
        action: out.import_id
          ? { label: "Undo", run: () => void getJson("/api/books/import-csv", { method: "POST", body: JSON.stringify({ undo_import_id: out.import_id }) }).then(() => setReload((n) => n + 1)) }
          : undefined,
      });
      setReload((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The import didn’t finish. Nothing was added.");
    } finally {
      setImporting(false);
    }
  }

  // Client totals, in the bank's sign (deposits positive), before the server answers.
  const local = plan
    ? (() => {
        const sign = plan.chargesPositive ? -1 : 1;
        let moneyIn = 0;
        let moneyOut = 0;
        const dates = plan.rows.map((r) => r.date).sort();
        for (const r of plan.rows) {
          const v = sign * r.amount;
          if (v > 0) moneyIn += v;
          else moneyOut += -v;
        }
        return { moneyIn, moneyOut, first: dates[0], last: dates[dates.length - 1] };
      })()
    : null;

  const menu: MenuItem[] = writer
    ? [
        {
          label: "Rename…",
          onSelect: () => {
            setNameDraft(a.nickname ?? "");
            setRenaming(true);
          },
        },
        { label: "Change owner…", onSelect: () => setOwnerOpen(true) },
        ...(account ? [a.hidden ? { label: "Show in Treasury", onSelect: () => void show() } : { label: "Hide account…", onSelect: () => void hide() }] : []),
      ]
    : [];

  const columns: Column<Txn>[] = [
    { key: "date", header: "Date", width: "112px", render: (t) => <span className="text-ink-2 tabular-nums">{format.date(t.date, "short")}</span> },
    {
      key: "name",
      header: "Description",
      render: (t) => (
        <span className="break-words">
          {t.name}
          {t.pending && <span className="text-ink-3"> · Pending</span>}
          {t.source === "csv" && <span className="text-ink-3"> · Imported</span>}
        </span>
      ),
    },
    {
      key: "category",
      header: ledger?.source === "books" ? "Books category" : "Bank’s category",
      width: "200px",
      render: (t) => (t.category ? <span className="text-ink-2">{tidy(t.category)}</span> : <span className="text-ink-3">—</span>),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      width: "140px",
      render: (t) => <span className={t.amount < 0 ? "text-positive" : "text-ink"}>{format.money(-t.amount, { sign: "always" })}</span>,
    },
  ];

  const sourceLine =
    ledger?.source === "books"
      ? ledger.total
        ? `From Books: ${format.count(ledger.total, "transaction")}, ${format.dateRange(ledger.rows[ledger.rows.length - 1].date, ledger.rows[0].date)}. Bank rows and imported files alike.`
        : null
      : ledger?.source === "bank"
        ? `From ${a.institution_name} through Plaid, the last 180 days${ledger.total > ledger.rows.length ? `: the newest ${format.count(ledger.rows.length, "row")} of ${ledger.total}` : ""}. Books keeps the full history.`
        : null;

  return (
    <Page
      header={
        <PageHeader title={title} back={{ to: "/treasury", label: "Treasury" }} context={[a.institution_name, typeLabel(a), owner].filter(Boolean).join(" · ")} menu={menu.length ? menu : undefined} />
      }
    >
      {error && (
        <Banner tone="negative" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
      {stopped && (
        <Banner tone="info">
          {stopped.reason === "not_shared"
            ? `${a.institution_name} stopped sharing this account on ${format.date(stopped.disconnected_at, "medium")}.`
            : `${a.institution_name} was disconnected on ${format.date(stopped.disconnected_at, "medium")}.`}{" "}
          Its Books history is kept; it isn’t in Treasury’s totals.
        </Banner>
      )}
      {offline && <Banner tone="warning">{a.institution_name} isn’t answering, so this balance may be out of date. An owner or admin can reconnect it on Treasury.</Banner>}

      <Card>
        <p className="text-small font-medium text-ink-2">{stopped ? "Last balance" : debt ? "Owed" : investment ? "Market value" : "Current balance"}</p>
        <p className="mt-1 text-display text-ink tabular-nums">{format.money(a.balance_current, { currency: a.currency ?? "USD" })}</p>
        <p className="mt-1 text-small text-ink-2">
          {stopped
            ? stopped.last_balance_at
              ? `As read on ${format.dateTime(stopped.last_balance_at)}`
              : "No balance was read before it stopped syncing"
            : [
                asOf ? format.asOf(asOf, { time: true }) : null,
                a.balance_updated_at ? `the bank updated it ${format.dateTime(a.balance_updated_at)}` : null,
                a.change_basis === "prior_close" && a.change ? `${a.change > 0 ? "↑" : "↓"} ${format.money(Math.abs(a.change))} since the ${format.date(a.change_since!, "short")} close` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
        </p>
        {!investment && !stopped && a.balance_available != null && Math.abs(a.balance_available - (a.balance_current ?? 0)) >= 0.005 && (
          <p className="mt-1 text-small text-ink-2">
            {debt ? "Available credit" : "Available"} {format.money(a.balance_available)}
            {debt ? "" : ", after pending items"}
          </p>
        )}
        <Rows className="mt-4 border-t border-line">
          <Row
            label="Owner"
            hint={conflict ?? (a.owner_kind === "person" || a.owner_kind === "joint" ? "Outside every entity’s Books." : undefined)}
            action={
              writer ? (
                <Button variant="quiet" size="sm" onClick={() => setOwnerOpen(true)}>
                  Change…
                </Button>
              ) : undefined
            }
          >
            {owner ? (
              <span className="inline-flex items-center gap-2">
                {owner}
                {conflict && <Status tone="warning">Check owner</Status>}
              </span>
            ) : (
              <Status tone="warning">No owner yet</Status>
            )}
          </Row>
          {a.owner_kind === "joint" && a.tenancy && <Row label="Held as">{TENANCY_LABEL[a.tenancy]}</Row>}
          {a.beneficiary_name && <Row label="Beneficiary">{a.beneficiary_name}</Row>}
          <Row label="Tax status" hint={!tax && taxGuess ? `Likely ${TAX_STATUS_LABEL[taxGuess].toLowerCase()}, from its type. Confirm it under Change owner.` : undefined}>
            {tax ? TAX_STATUS_LABEL[tax] : null}
          </Row>
          {reg && <Row label="Registration">{`${reg.label}, as the custodian reports it`}</Row>}
          {bankName && <Row label="Bank’s name">{bankName}</Row>}
          {a.hidden && <Row label="In Treasury">Hidden: left out of the totals, Books reports and the emailed report.</Row>}
        </Rows>
      </Card>

      <Card
        title={investment ? "Activity" : "Transactions"}
        action={
          canImport ? (
            <Button variant="quiet" size="sm" icon="upload" onClick={() => fileInput.current?.click()}>
              Import CSV…
            </Button>
          ) : undefined
        }
        flush
      >
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pickFile(f);
          }}
        />
        {investment ? (
          <div className="px-5 py-4 touch:px-4">
            <Empty
              size="section"
              action={
                <LinkButton to={`/investments?account=${encodeURIComponent(a.account_id)}`} variant="secondary" size="sm">
                  See holdings in Investments
                </LinkButton>
              }
            >
              A brokerage account’s positions, dividends and trades are on Investments.
              {ledger && ledger.rows.length > 0 ? ` Books also holds ${format.count(ledger.rows.length, "cash transaction")} for it.` : ""}
            </Empty>
          </div>
        ) : ledgerError ? (
          <div className="p-4">
            <Banner
              tone="negative"
              action={
                <Button variant="quiet" size="sm" onClick={() => setReload((n) => n + 1)}>
                  Try again
                </Button>
              }
            >
              {ledgerError}
            </Banner>
          </div>
        ) : !ledger ? (
          <Skeleton kind="table" rows={8} columns={["112px", "1fr", "200px", "140px"]} />
        ) : ledger.rows.length === 0 ? (
          <div className="px-5 py-4 touch:px-4">
            <Empty
              size="section"
              action={
                canImport ? (
                  <Button size="sm" onClick={() => fileInput.current?.click()}>
                    Import CSV…
                  </Button>
                ) : undefined
              }
            >
              {ledger.source === "books" ? "Books has no transactions for this account yet. Older history can be added from the bank’s CSV export." : "No transactions in the last 180 days."}
            </Empty>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 px-5 py-3 touch:px-4">
              {sourceLine && <p className="min-w-[240px] flex-1 text-small text-ink-2">{sourceLine}</p>}
              {ledger.rows.length > 8 && (
                <div className="w-full sm:w-[260px]">
                  <SearchField value={search} onChange={setSearch} placeholder="Search transactions" label="Search transactions" />
                </div>
              )}
            </div>
            <Table
              caption={`${title} transactions`}
              columns={columns}
              rows={filtered.slice(0, shown)}
              rowKey={(t) => t.id ?? `${t.date}-${t.description}-${t.amount}`}
              phoneRow={(t) => ({
                title: t.name,
                secondary: [format.date(t.date, "short"), t.category ? tidy(t.category) : null, t.pending ? "Pending" : null, t.source === "csv" ? "Imported" : null].filter(Boolean).join(" · "),
                trailing: <span className={t.amount < 0 ? "text-positive" : "text-ink"}>{format.money(-t.amount, { sign: "always" })}</span>,
              })}
              empty={<p className="text-body text-ink-2">No transactions match “{search}”.</p>}
            />
            {filtered.length > shown && (
              <div className="flex justify-center border-t border-line p-3">
                <Button variant="quiet" size="sm" onClick={() => setShown((n) => n + PAGE)}>
                  Show {format.count(Math.min(PAGE, filtered.length - shown), "more transaction")}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      <Dialog
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename account"
        description="The name shown across BFO. The bank’s own name stays on the account page and in Books."
        size="sm"
        dirty={nameDraft.trim() !== (a.nickname ?? "")}
        footer={
          <>
            <Button onClick={() => setRenaming(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void rename()}>
              Save name
            </Button>
          </>
        }
      >
        <Field label="Name" hint={`Leave empty to use the bank’s name, ${accountName({ name: a.official_name || a.name, mask: a.mask })}.`}>
          <Input
            value={nameDraft}
            maxLength={60}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void rename();
            }}
          />
        </Field>
      </Dialog>

      <OwnerDialog open={ownerOpen} onClose={() => setOwnerOpen(false)} account={a} entities={records.entities} people={records.people} onSave={onOwnerSave} />

      <Dialog
        open={!!plan}
        onClose={() => setPlan(null)}
        title="Add this file to Books?"
        description={plan ? `${plan.file} · ${accountName(a)}` : undefined}
        size="md"
        footer={
          <>
            <Button onClick={() => setPlan(null)}>Cancel</Button>
            <Button variant="primary" busy={importing} busyLabel="Adding…" disabled={!!plan?.server && (plan.server.locked > 0 || plan.server.to_add === 0)} onClick={() => void runImport()}>
              {plan?.server ? `Add ${format.count(plan.server.to_add, "transaction")}` : `Add ${format.count(plan?.rows.length ?? 0, "row")}`}
            </Button>
          </>
        }
      >
        {plan && local && (
          <div className="flex flex-col gap-4">
            <Rows>
              <Row label="In the file">
                {format.count(plan.rows.length, "row")}, {format.dateRange(plan.server?.first ?? local.first, plan.server?.last ?? local.last)}
              </Row>
              {plan.server && <Row label="New to Books">{format.count(plan.server.to_add, "transaction")}</Row>}
              {plan.server && (plan.server.already_here > 0 || plan.server.near_matches > 0) && (
                <Row label="Already in Books">{format.count(plan.server.already_here + plan.server.near_matches, "row")}, skipped</Row>
              )}
              <Row label="Money in">{format.money(plan.server ? plan.server.money_in : local.moneyIn)}</Row>
              <Row label="Money out">{format.money(plan.server ? plan.server.money_out : local.moneyOut)}</Row>
            </Rows>
            <Checkbox
              checked={plan.chargesPositive}
              onChange={(v) => void dryRun({ ...plan, chargesPositive: v }).then(setPlan)}
              label="This file shows charges as positive amounts"
              hint={
                plan.headerless
                  ? "The file has no header row, so the columns were guessed. Check that money in and out look right."
                  : "Card exports often do. Check that money in and out look right before adding."
              }
            />
            {plan.server && plan.server.locked > 0 && (
              <Banner tone="warning">
                {format.count(plan.server.locked, "row")} fall on or before {format.date(plan.server.closed_through!, "medium")}, when this entity’s books were closed. Reopen the period in Books to
                import them.
              </Banner>
            )}
            <p className="text-small text-ink-2">Recorded with the file’s name and fingerprint, your name and the time. An import can be undone.</p>
          </div>
        )}
      </Dialog>
    </Page>
  );
}

/** "FOOD_AND_DRINK" or "food_and_drink" → "Food and drink"; a Books category stays as written. */
function tidy(cat: string): string {
  if (!/_/.test(cat) && cat !== cat.toUpperCase()) return cat;
  const s = cat.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
