/**
 * Treasury: every bank and brokerage account, grouped by who owns it, with
 * one headline (what the accounts hold, net of what is owed), the exceptions
 * that need someone, and the bank connections. Built on app/ui
 * (docs/DESIGN.md); the rules are in app/treasury-model.ts.
 *
 * Disconnecting a bank or choosing which accounts it shares never deletes
 * Books history: the accounts move to "Not syncing" with their last balance
 * (api/plaid/disconnect.ts, api/plaid/prune-accounts.ts).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { loadPlaid } from "../plaid-link";
import { canWrite, isAdmin } from "../auth";
import { Banner, Button, Card, Empty, Icon, List, ListRow, Page, PageHeader, Skeleton, Status, TextLink, confirm, format, toast, type MenuItem } from "../ui";
import { headline } from "../../lib/plaid-history";
import { isDebt, isDormant, ownerOf } from "../treasury-model";
import { InstitutionMark } from "../treasury-ui";
import { accountName, conflictOf, getJson, loadTreasury, typeLabel, useRecords, type Account, type Connection, type StoppedAccount, type TreasuryData } from "../treasury-data";

export function meta() {
  return [{ title: "Treasury · BFO" }];
}

const STALE_MS = 24 * 3_600_000;

/** A per-device convenience (show hidden accounts); never anything that must be kept. */
function useStoredFlag(key: string): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  return [
    v,
    (next: boolean) => {
      setV(next);
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        /* the toggle still works for this visit */
      }
    },
  ];
}

const signedBalance = (a: { type: string | null; balance_current: number | null }) => (isDebt(a) ? -1 : 1) * (a.balance_current ?? 0);

type Group = { key: string; label: string; kind: string; accounts: Account[]; total: number };

export default function Treasury() {
  const navigate = useNavigate();
  const records = useRecords();
  const admin = isAdmin();
  const writer = canWrite();

  const [data, setData] = useState<TreasuryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [showHidden, setShowHidden] = useStoredFlag("bfo-treasury-show-hidden");

  const load = useCallback(async () => {
    try {
      setData(await loadTreasury());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the accounts.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const accounts = useMemo(() => data?.accounts ?? [], [data]);
  const connections = data?.connections ?? [];
  const stopped = data?.disconnected ?? [];
  const statusOf = (itemId: string) => connections.find((c) => c.item_id === itemId)?.status ?? "offline";
  // Live entity names from the records; the stored copy only until they load.
  const ownerFor = (a: Account) => ownerOf(a, (id) => (records.loaded ? records.nameOf(id) : (a.entity_name ?? null)));

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const a of accounts.filter((x) => !x.hidden)) {
      const o = ownerOf(a, (id) => (records.loaded ? records.nameOf(id) : (a.entity_name ?? null)));
      const g = map.get(o.key) ?? { key: o.key, label: o.label, kind: o.kind, accounts: [], total: 0 };
      g.accounts.push(a);
      g.total += signedBalance(a);
      map.set(o.key, g);
    }
    const rank = (g: Group) => (g.kind === "entity" ? 0 : g.kind === "person" ? 1 : g.kind === "joint" ? 2 : 3);
    const list = [...map.values()];
    for (const g of list) g.accounts.sort((x, y) => signedBalance(y) - signedBalance(x));
    return list.sort((x, y) => rank(x) - rank(y) || y.total - x.total);
  }, [accounts, records]);

  const hiddenAccounts = accounts.filter((a) => a.hidden);
  const head = headline(accounts);
  const hasDebt = accounts.some((a) => !a.hidden && isDebt(a));
  const changes = accounts.filter((a) => !a.hidden && a.change_basis === "prior_close" && a.change != null);
  const movement = changes.reduce((s, a) => s + (isDebt(a) ? -1 : 1) * (a.change ?? 0), 0);
  const since =
    changes
      .map((a) => a.change_since)
      .filter((d): d is string => !!d)
      .sort()[0] ?? null;
  const broken = connections.filter((c) => c.status !== "online");
  const noOwner = accounts.filter((a) => ownerFor(a).kind === "none");
  const conflicts = accounts.filter((a) => conflictOf(a, records.isTrust));
  const dormant = accounts.filter((a) => !a.hidden && statusOf(a.item_id) === "online" && isDormant({ balance_current: a.balance_current, last_activity: a.last_activity ?? null }));
  const staleConns = connections.filter((c) => c.status === "online" && c.bank_updated_at && Date.now() - Date.parse(c.bank_updated_at) > STALE_MS);
  const entityCount = groups.filter((g) => g.kind === "entity").length;
  const peopleCount = groups.filter((g) => g.kind === "person" || g.kind === "joint").length;

  // ── Plaid Link ────────────────────────────────────────────────────────
  function openLink(token: string): Promise<{ done: boolean; publicToken?: string; metadata?: any }> {
    return new Promise((resolve) => {
      window
        .Plaid!.create({
          token,
          onSuccess: (publicToken, metadata) => resolve({ done: true, publicToken, metadata }),
          onExit: (err) => {
            if (err) toast({ message: err.display_message || "The bank's window closed before it finished." });
            resolve({ done: false });
          },
        })
        .open();
    });
  }

  async function connect() {
    setLinking(true);
    try {
      const [{ link_token }] = await Promise.all([getJson<{ link_token: string }>("/api/plaid/create-link-token", { method: "POST", body: JSON.stringify({ kind: "bank" }) }), loadPlaid()]);
      const r = await openLink(link_token);
      if (!r.done) return;
      await getJson("/api/plaid/exchange-token", {
        method: "POST",
        body: JSON.stringify({
          public_token: r.publicToken,
          kind: "bank",
          institution_name: r.metadata?.institution?.name ?? "Unknown",
          institution_id: r.metadata?.institution?.institution_id ?? null,
        }),
      });
      toast({ message: `Connected ${r.metadata?.institution?.name ?? "the bank"}` });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't connect the bank.");
    } finally {
      setLinking(false);
    }
  }

  /** Update mode on one connection: sign in again, or choose which accounts it shares. Resolves whether it finished. */
  async function updateLink(conn: Connection): Promise<boolean> {
    const [{ link_token }] = await Promise.all([
      getJson<{ link_token: string }>("/api/plaid/create-link-token", { method: "POST", body: JSON.stringify({ kind: "bank", item_id: conn.item_id }) }),
      loadPlaid(),
    ]);
    const r = await openLink(link_token);
    if (!r.done) return false;
    // Extended history only arrives after the cursor is cleared; re-pulled rows merge, nothing is deleted.
    await getJson("/api/plaid/reset-cursor", { method: "POST", body: JSON.stringify({ item_id: conn.item_id }) }).catch(() => undefined);
    return true;
  }

  /** After the bank's picker: accounts it stopped sharing keep their history and move to Not syncing. */
  async function reconcile() {
    const out = await getJson<{ stopped?: Array<{ name: string | null; mask: string | null }>; pruned?: boolean }>("/api/plaid/prune-accounts", { method: "POST", body: "{}" }).catch(() => null);
    const n = out?.pruned ? (out.stopped?.length ?? 0) : 0;
    toast({ message: n ? `${format.count(n, "account")} stopped syncing. Their Books history is kept.` : "Accounts updated" });
    await load();
  }

  async function chooseShared(list: Connection[]) {
    const names = list.map((c) => c.institution_name);
    const ok = await confirm({
      title: list.length === 1 ? `Choose which ${names[0]} accounts BFO sees?` : "Choose shared accounts at every bank?",
      message: `${list.length === 1 ? `${names[0]}'s` : "Each bank's"} own account picker opens${list.length > 1 ? ", one bank at a time" : ""}. Accounts you leave unticked stop syncing; their Books history, mappings and last balance are kept.`,
      confirmLabel: "Open account picker",
      tone: "commit",
    });
    if (!ok) return;
    setLinking(true);
    try {
      let any = false;
      for (const c of list) {
        if (!(await updateLink(c))) break;
        any = true;
      }
      if (any) await reconcile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open the bank's account picker.");
    } finally {
      setLinking(false);
    }
  }

  async function reconnect(conn: Connection) {
    setLinking(true);
    try {
      if (await updateLink(conn)) await reconcile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reconnect.");
    } finally {
      setLinking(false);
    }
  }

  async function disconnect(conn: Connection) {
    // What it affects, from the server when it can say (Books counts), else from this page.
    type Impact = {
      accounts: Array<{ mask: string | null; name: string | null; balance: number | null; entity_name: string | null; type?: string | null }>;
      books?: { count: number; from: string | null; to: string | null };
    };
    let impact: Impact | null = await getJson<Impact>(`/api/plaid/disconnect?item_id=${encodeURIComponent(conn.item_id)}`).catch(() => null);
    const mine = accounts.filter((a) => a.item_id === conn.item_id);
    if (!impact?.accounts?.length)
      impact = { accounts: mine.map((a) => ({ mask: a.mask, name: accountName(a), balance: signedBalance(a), entity_name: ownerFor(a).kind === "none" ? null : ownerFor(a).label, type: a.type })) };
    const total = mine.reduce((s, a) => s + signedBalance(a), 0);
    const owners = [
      ...new Set(
        mine
          .map((a) => ownerFor(a))
          .filter((o) => o.kind !== "none")
          .map((o) => o.label),
      ),
    ];
    const books = impact.books;
    const ok = await confirm({
      title: `Disconnect ${conn.institution_name}?`,
      object: { names: mine.length ? mine.map((a) => accountName(a)) : impact.accounts.map((a) => [a.name, a.mask ? format.maskAccount(a.mask) : ""].filter(Boolean).join(" ")) },
      message: `Its ${format.count(mine.length || impact.accounts.length, "account")} stop syncing and leave Treasury's totals. Their Books history, owners and last balances are kept.`,
      details: [
        mine.length ? `${format.money(total)} in balances today` : null,
        owners.length ? `Owned by ${format.list(owners)}` : null,
        books && books.count > 0 && books.from && books.to ? `${format.count(books.count, "Books transaction")} kept, ${format.dateRange(books.from, books.to)}` : "Every Books transaction is kept",
        "BFO's access through Plaid is revoked. Connecting again continues these accounts.",
      ].filter((x): x is string => !!x),
      typeToConfirm: conn.institution_name,
      confirmLabel: `Disconnect ${conn.institution_name}`,
      tone: "danger",
    });
    if (!ok) return;
    try {
      await getJson(`/api/plaid/disconnect?item_id=${encodeURIComponent(conn.item_id)}`, { method: "POST" });
      toast({ message: `Disconnected ${conn.institution_name}. Books history kept.` });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't disconnect.");
    }
  }

  async function hideDormant() {
    const n = dormant.length;
    const ok = await confirm({
      title: `Hide ${format.count(n, "dormant account")}?`,
      object: { names: dormant.map((a) => (accountName(a).toLowerCase().includes(a.institution_name.toLowerCase()) ? accountName(a) : `${accountName(a)} · ${a.institution_name}`)) },
      message:
        "They're empty and no money has moved in 90 days. Hidden accounts are left out of Treasury's totals, every Books report and the emailed Treasury report until you show them again. Nothing is deleted.",
      details: noOwner.some((a) => dormant.includes(a))
        ? [
            dormant.every((a) => noOwner.includes(a))
              ? "None of them has an owner yet, so no entity’s Books change."
              : `${format.count(dormant.filter((a) => noOwner.includes(a)).length, "of them has", "of them have")} no owner yet.`,
          ]
        : undefined,
      confirmLabel: `Hide ${format.count(n, "account")}`,
    });
    if (!ok) return;
    const ids = dormant.map((a) => a.account_id);
    let failed: string[] = [];
    try {
      const out = await getJson<{ saved: string[]; failed: string[] }>("/api/plaid/account-prefs", { method: "POST", body: JSON.stringify({ account_ids: ids, hidden: true }) });
      failed = out.failed ?? [];
    } catch {
      // A server without the batch form: one at a time, noting any that fail.
      for (const id of ids) {
        await getJson("/api/plaid/account-prefs", { method: "POST", body: JSON.stringify({ account_id: id, hidden: true }) }).catch(() => failed.push(id));
      }
    }
    if (failed.length) {
      const names = dormant.filter((a) => failed.includes(a.account_id)).map((a) => accountName(a));
      setError(`Couldn't hide ${format.list(names)}. Try again.`);
    } else {
      toast({ message: `Hid ${format.count(n, "account")}`, action: { label: "Undo", run: () => void undoHide(ids) } });
    }
    await load();
  }

  async function undoHide(ids: string[]) {
    await getJson("/api/plaid/account-prefs", { method: "POST", body: JSON.stringify({ account_ids: ids, hidden: false }) }).catch(async () => {
      for (const id of ids) await getJson("/api/plaid/account-prefs", { method: "POST", body: JSON.stringify({ account_id: id, hidden: false }) }).catch(() => undefined);
    });
    await load();
  }

  async function showAccount(a: Account) {
    try {
      await getJson("/api/plaid/account-prefs", { method: "POST", body: JSON.stringify({ account_id: a.account_id, hidden: false }) });
      toast({ message: `${accountName(a)} is back in the totals` });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't show that account.");
    }
  }

  // ── Rows ──────────────────────────────────────────────────────────────
  function accountRow(a: Account, opts: { hiddenRow?: boolean } = {}) {
    const offline = statusOf(a.item_id) !== "online";
    const conflict = conflictOf(a, records.isTrust);
    const exception: ReactNode = offline ? (
      <Status tone="warning">Not updating</Status>
    ) : isDormant({ balance_current: a.balance_current, last_activity: a.last_activity ?? null }) ? (
      <Status tone="neutral">Dormant</Status>
    ) : conflict ? (
      <Status tone="warning">Check owner</Status>
    ) : null;
    const change = a.change_basis === "prior_close" && a.change ? a.change : null;
    return (
      <ListRow
        key={a.account_id}
        to={`/treasury/${a.account_id}`}
        leading={<InstitutionMark name={a.institution_name} logo={a.institution_logo} />}
        title={accountName(a)}
        label={accountName(a)}
        secondary={
          <span className="flex w-full min-w-0 items-center gap-1">
            <span className="min-w-0 truncate">
              {a.institution_name} · {typeLabel(a)}
              {isDebt(a) ? " · owed" : ""}
            </span>
            {exception && <span className="shrink-0"> · {exception}</span>}
          </span>
        }
        meta={change ? `${change > 0 ? "↑" : "↓"} ${format.money(Math.abs(change))}` : undefined}
        trailing={format.money(signedBalance(a))}
        menu={opts.hiddenRow && writer ? [{ label: "Show in Treasury", onSelect: () => void showAccount(a) }] : undefined}
      />
    );
  }

  function band(label: string, count: number, total: number | null, note?: string) {
    return (
      <div className="flex min-h-8 items-center justify-between gap-3 bg-sunken px-4 py-1 text-small">
        <span className="min-w-0">
          <span className="font-semibold text-ink">{label}</span>
          <span className="text-ink-2"> · {note ?? format.count(count, "account")}</span>
        </span>
        {total !== null && <span className="shrink-0 font-semibold text-ink tabular-nums">{format.money(total)}</span>}
      </div>
    );
  }

  // ── Page ──────────────────────────────────────────────────────────────
  const menu: MenuItem[] = [
    { label: "Owners and mappings", onSelect: () => navigate("/treasury/mappings") },
    ...(hiddenAccounts.length
      ? [{ label: showHidden ? "Leave hidden accounts out of the list" : `Show ${format.count(hiddenAccounts.length, "hidden account")}`, onSelect: () => setShowHidden(!showHidden) }]
      : []),
    ...(admin && connections.length > 1 ? [{ label: "Choose shared accounts at every bank…", onSelect: () => void chooseShared(connections) }] : []),
  ];

  const context = data ? `${format.asOf(data.asOf, { time: true })} · ${format.count(accounts.length - hiddenAccounts.length, "account")}` : "Balances from each connected bank";

  const attention: Array<{ key: string; text: string; action: ReactNode }> = [];
  if (noOwner.length)
    attention.push({
      key: "owner",
      text: `${format.count(noOwner.length, "account has", "accounts have")} no owner yet${noOwner.some((a) => a.hidden) ? `, ${format.count(noOwner.filter((a) => a.hidden).length, "of them hidden", "of them hidden")}` : ""}`,
      action: <TextLink to="/treasury/mappings?show=none">Choose owners</TextLink>,
    });
  if (conflicts.length)
    attention.push({
      key: "conflict",
      text: `${format.count(conflicts.length, "account is", "accounts are")} titled to a person but mapped to an entity`,
      action: <TextLink to="/treasury/mappings?show=review">Review owners</TextLink>,
    });
  if (dormant.length && writer)
    attention.push({
      key: "dormant",
      text: `${format.count(dormant.length, "dormant account")}: empty, no money moved in 90 days`,
      action: (
        <Button variant="quiet" size="sm" onClick={() => void hideDormant()}>
          Hide them…
        </Button>
      ),
    });
  for (const c of staleConns)
    attention.push({
      key: `stale-${c.item_id}`,
      text: `${c.institution_name} last updated its balances ${format.date(c.bank_updated_at!, "short")}`,
      action: admin ? (
        <Button variant="quiet" size="sm" onClick={() => void reconnect(c)}>
          Reconnect
        </Button>
      ) : null,
    });

  return (
    <Page
      header={
        <PageHeader
          title="Treasury"
          context={context}
          menu={menu}
          primary={
            admin ? (
              <Button variant="primary" icon="plus" busy={linking} busyLabel="Connecting…" onClick={() => void connect()}>
                Connect bank
              </Button>
            ) : undefined
          }
        />
      }
    >
      {admin && (
        <p className="-mt-4 max-w-[68ch] text-small text-ink-2">
          BFO connects to banks through Plaid and keeps up to two years of transactions and each day’s balances, for Books and this page.{" "}
          <TextLink inline to="/legal/privacy#banks">
            How bank data is handled
          </TextLink>
        </p>
      )}

      {error && (
        <Banner
          tone="negative"
          action={
            <Button variant="quiet" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          }
          onDismiss={() => setError(null)}
        >
          {error}
        </Banner>
      )}

      {broken.length > 0 && (
        <Banner
          tone="warning"
          action={
            admin && broken.length === 1 ? (
              <Button variant="quiet" size="sm" onClick={() => void reconnect(broken[0])} disabled={linking}>
                Reconnect
              </Button>
            ) : undefined
          }
        >
          {format.list(broken.map((c) => c.institution_name))} {broken.length === 1 ? "needs" : "need"} to be signed in to again. {broken.length === 1 ? "Its" : "Their"} balances aren’t in these
          totals until then.
          {!admin && " An owner or admin can reconnect."}
        </Banner>
      )}

      {!data && !error && (
        <div className="flex flex-col gap-6">
          <Skeleton kind="card" />
          <Skeleton kind="rows" rows={6} />
        </div>
      )}

      {data && accounts.length === 0 && stopped.length === 0 && (
        <Empty
          title="No banks connected yet"
          action={
            admin ? (
              <Button variant="primary" onClick={() => void connect()} busy={linking}>
                Connect bank
              </Button>
            ) : undefined
          }
        >
          Connect a bank to see its balances here and keep its transactions in Books. {admin ? "" : "An owner or admin can connect one."}
        </Empty>
      )}

      {data && accounts.length > 0 && (
        <Card>
          <div className="flex flex-col gap-5">
            <div>
              <p className="text-small font-medium text-ink-2">Total balances</p>
              <p className="mt-1 text-display text-ink tabular-nums">{format.money(head.net, { precision: "dollars" })}</p>
              <p className="mt-1 text-small text-ink-2">
                Bank and brokerage balances{hasDebt ? ", less what is owed on cards and loans," : ""} across {format.count(entityCount, "entity", "entities")}
                {peopleCount ? ` and ${format.count(peopleCount, "personal owner")}` : ""}. Not a consolidated statement.
                {movement !== 0 && since && (
                  <>
                    {" "}
                    {movement > 0 ? "↑" : "↓"} {format.money(Math.abs(movement), { precision: "dollars" })} since the {format.date(since, "short")} close.
                  </>
                )}
              </p>
              {hiddenAccounts.length > 0 && (
                <p className="mt-1 text-small text-ink-2">
                  Leaves out {format.count(hiddenAccounts.length, "hidden account")}, holding {format.money(head.hidden.net, { precision: "dollars" })}.{" "}
                  <button type="button" className="text-accent underline decoration-1 underline-offset-[3px] hover:text-accent-hover" onClick={() => setShowHidden(!showHidden)}>
                    {showHidden ? "Leave them out of the list" : "Show them"}
                  </button>
                </p>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              {head.cash !== 0 && <Stat label="Bank deposits" value={format.money(head.cash, { precision: "dollars" })} />}
              {head.invested !== 0 && <Stat label="Brokerage, at market value" value={format.money(head.invested, { precision: "dollars" })} />}
              {head.other !== 0 && <Stat label="Other accounts" value={format.money(head.other, { precision: "dollars" })} />}
              {hasDebt && <Stat label="Owed on cards and loans" value={format.money(head.owed, { precision: "dollars" })} />}
            </dl>
            {attention.length > 0 && (
              <ul className="flex flex-col gap-1 border-t border-line pt-3" aria-label="Needs attention">
                {attention.map((x) => (
                  <li key={x.key} className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex min-w-[220px] flex-1 items-start gap-2 text-body text-ink">
                      <Icon name="warning" size={16} className="mt-[2px] shrink-0 text-warning" />
                      {x.text}
                    </span>
                    {x.action}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}

      {data && (accounts.length > 0 || stopped.length > 0 || connections.length > 0) && (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-6">
            {accounts.length > 0 && (
              <Card title="Accounts" flush>
                {groups.map((g) => (
                  <section key={g.key} aria-label={g.label}>
                    {band(
                      g.label,
                      g.accounts.length,
                      g.accounts.length > 1 ? g.total : null,
                      g.kind === "person" ? `personal · ${format.count(g.accounts.length, "account")}` : g.kind === "joint" ? `joint · ${format.count(g.accounts.length, "account")}` : undefined,
                    )}
                    <List label={g.label}>{g.accounts.map((a) => accountRow(a))}</List>
                  </section>
                ))}
                {showHidden && hiddenAccounts.length > 0 && (
                  <section aria-label="Hidden accounts">
                    {band(
                      "Hidden, not in the totals",
                      hiddenAccounts.length,
                      hiddenAccounts.reduce((s, a) => s + signedBalance(a), 0),
                    )}
                    <List label="Hidden accounts">{hiddenAccounts.map((a) => accountRow(a, { hiddenRow: true }))}</List>
                  </section>
                )}
              </Card>
            )}
            {stopped.length > 0 && <StoppedCard rows={stopped} />}
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            {connections.length > 0 && (
              <Card title="Bank connections" flush footer={!admin ? <span className="text-small text-ink-2">Only an owner or admin can connect, reconnect or disconnect a bank.</span> : undefined}>
                <List label="Bank connections">
                  {connections.map((c) => {
                    const mine = accounts.filter((a) => a.item_id === c.item_id);
                    const twin = connections.filter((x) => x.institution_name === c.institution_name).length > 1;
                    const added = c.created_at ? `added ${format.date(c.created_at, "short")}` : null;
                    return (
                      <ListRow
                        key={c.item_id}
                        leading={<InstitutionMark name={c.institution_name} logo={c.institution_logo} />}
                        title={c.institution_name}
                        label={c.institution_name}
                        secondary={
                          c.status !== "online" ? (
                            <Status tone="warning">{c.status === "reconnect" ? "Needs sign-in" : "Not answering"}</Status>
                          ) : (
                            [format.count(mine.length, "account"), twin ? "connected twice" : null, added].filter(Boolean).join(" · ")
                          )
                        }
                        action={
                          admin && c.status !== "online" ? (
                            <Button size="sm" onClick={() => void reconnect(c)} disabled={linking}>
                              Reconnect
                            </Button>
                          ) : undefined
                        }
                        menu={
                          admin
                            ? [
                                { label: "Choose shared accounts…", onSelect: () => void chooseShared([c]) },
                                { divider: true },
                                { label: "Disconnect…", danger: true, onSelect: () => void disconnect(c) },
                              ]
                            : undefined
                        }
                      />
                    );
                  })}
                </List>
              </Card>
            )}
          </div>
        </div>
      )}
    </Page>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-small font-medium text-ink-2">{label}</dt>
      <dd className="mt-1 text-title text-ink tabular-nums">{value}</dd>
    </div>
  );
}

/** Accounts that stopped syncing: their last balance and how far their kept Books history runs. Never in the totals. */
function StoppedCard({ rows }: { rows: StoppedAccount[] }) {
  return (
    <Card
      title="Not syncing"
      count={rows.length}
      info="These accounts stopped syncing: their bank was disconnected, or it no longer shares them. Their Books history is kept, and they aren’t in the totals above."
      flush
    >
      <List label="Accounts not syncing">
        {rows.map((a) => {
          const debt = isDebt({ type: a.type });
          const when = format.date(a.disconnected_at, "short");
          return (
            <ListRow
              key={a.account_id}
              to={`/treasury/${a.account_id}`}
              leading={<InstitutionMark name={a.institution_name ?? "?"} logo={null} />}
              title={accountName({ nickname: a.nickname, name: a.name, mask: a.mask })}
              secondary={[
                a.institution_name,
                a.reason === "not_shared" ? `no longer shared since ${when}` : `disconnected ${when}`,
                a.books_through ? `Books kept through ${format.date(a.books_through, "short")}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              meta={a.last_balance_at ? `as of ${format.date(a.last_balance_at, "short")}` : undefined}
              trailing={a.last_balance == null ? undefined : format.money((debt ? -1 : 1) * a.last_balance)}
            />
          );
        })}
      </List>
    </Card>
  );
}
