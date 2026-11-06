/**
 * Account owners: who holds each bank and brokerage account. An entity (its
 * Books and statements use the account), one person, or joint owners
 * (outside every entity's Books). Accounts with no owner, and accounts whose
 * owner contradicts the custodian's registration (an IRA mapped to a trust),
 * come first. Every change is confirmed with what it moves and recorded
 * (api/plaid/account-prefs.ts). Built on app/ui (docs/DESIGN.md).
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { canWrite } from "../auth";
import { Banner, Button, Card, Empty, Page, PageHeader, Segmented, Skeleton, Status, format, toast } from "../ui";
import { isDebt } from "../treasury-model";
import { InstitutionMark, OwnerDialog } from "../treasury-ui";
import { accountName, confirmOwnerChange, conflictOf, loadTreasury, ownerText, saveOwner, stoppedAsAccount, typeLabel, useRecords, type Account, type OwnerChoice } from "../treasury-data";

export function meta() {
  return [{ title: "Account owners · Treasury · BFO" }];
}

type Filter = "all" | "none" | "review";
type Item = Account & { stopped?: boolean; logo?: string | null };

export default function TreasuryMappings() {
  const records = useRecords();
  const writer = canWrite();
  const [params, setParams] = useSearchParams();
  const filter = (["none", "review"].includes(params.get("show") ?? "") ? params.get("show") : "all") as Filter;

  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);

  async function load() {
    try {
      const data = await loadTreasury();
      setItems([...data.accounts, ...data.disconnected.map((s) => ({ ...stoppedAsAccount(s), stopped: true }))]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t load the accounts.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const nameOf = (a: Account) => (id: string) => (records.loaded ? records.nameOf(id) : (a.entity_name ?? null));
  const ownerOfItem = (a: Account) => ownerText(a, nameOf(a));
  const noOwner = (a: Account) => !ownerOfItem(a);
  const review = (a: Account) => !!conflictOf(a, records.isTrust);

  const all = items ?? [];
  const counts = { none: all.filter(noOwner).length, review: all.filter(review).length, hidden: all.filter((a) => a.hidden).length };
  const shown = all.filter((a) => (filter === "none" ? noOwner(a) : filter === "review" ? review(a) : true));

  const banks = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const a of shown) map.set(a.institution_name || "Other", [...(map.get(a.institution_name || "Other") ?? []), a]);
    const rank = (a: Account) => (noOwner(a) ? 0 : review(a) ? 1 : 2);
    for (const list of map.values()) list.sort((x, y) => rank(x) - rank(y) || accountName(x).localeCompare(accountName(y)));
    return [...map.entries()].sort((x, y) => x[0].localeCompare(y[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, filter, records]);

  async function onSave(choice: OwnerChoice): Promise<string | null> {
    if (!editing) return null;
    const toPerson = choice.owner_kind === "person" || choice.owner_kind === "joint";
    const toText = toPerson ? (choice.owner_names ?? []).filter(Boolean).join(" & ") : (choice.entity_name ?? null);
    if (!(await confirmOwnerChange(editing, ownerOfItem(editing), toText || null, toPerson))) return "Not changed.";
    const err = await saveOwner(editing.account_id, choice);
    if (err) return err;
    toast({ message: `Owner saved for ${accountName(editing)}` });
    await load();
    return null;
  }

  const context = items
    ? [format.count(all.length, "account"), counts.none ? `${counts.none} with no owner` : "every account has an owner", counts.hidden ? `${counts.hidden} hidden in Treasury` : null]
        .filter(Boolean)
        .join(" · ")
    : "Who holds each account";

  return (
    <Page width="workspace" header={<PageHeader title="Account owners" back={{ to: "/treasury", label: "Treasury" }} context={context} />}>
      <p className="-mt-4 max-w-[68ch] text-small text-ink-2">
        Books and each entity’s statements use these. An IRA or other retirement account belongs to one person; a trust can be named as its beneficiary. Accounts held by a person or jointly sit
        outside every entity’s Books.
      </p>

      {error && (
        <Banner
          tone="negative"
          action={
            <Button variant="quiet" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          }
        >
          {error}
        </Banner>
      )}

      {items && all.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="Show"
            value={filter}
            onChange={(v) => setParams(v === "all" ? {} : { show: v }, { replace: true })}
            options={[
              { value: "all", label: "All" },
              { value: "none", label: counts.none ? `No owner · ${counts.none}` : "No owner" },
              { value: "review", label: counts.review ? `To review · ${counts.review}` : "To review" },
            ]}
          />
          {!writer && <span className="text-small text-ink-2">Viewers can see owners but not change them.</span>}
        </div>
      )}

      {!items && !error && <Skeleton kind="rows" rows={8} />}

      {items && all.length === 0 && <Empty title="No accounts yet">Connect a bank on Treasury, and its accounts appear here to be given an owner.</Empty>}

      {items && all.length > 0 && shown.length === 0 && (
        <Empty title={filter === "none" ? "Every account has an owner" : "Nothing to review"} action={<Button onClick={() => setParams({}, { replace: true })}>Show all accounts</Button>}>
          {filter === "none" ? "Each account is held by an entity, a person or joint owners." : "No account’s owner contradicts how the custodian registers it."}
        </Empty>
      )}

      {banks.map(([bank, list]) => (
        <Card key={bank} title={bank} count={list.length} flush>
          <ul>
            {list.map((a, i) => {
              const owner = ownerOfItem(a);
              const conflict = conflictOf(a, records.isTrust);
              const meta = [
                typeLabel(a),
                a.balance_current != null ? `${format.money((isDebt(a) ? -1 : 1) * a.balance_current)}${a.stopped ? " last balance" : ""}` : null,
                a.last_activity ? `last moved ${format.date(a.last_activity, "short")}` : null,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={a.account_id} className={`flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:gap-4 touch:px-4 ${i ? "border-t border-line" : ""}`}>
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <InstitutionMark name={a.institution_name} logo={a.institution_logo} />
                    <div className="min-w-0 flex-1">
                      <p className="text-body break-words text-ink">{accountName(a)}</p>
                      <p className="text-small text-ink-2">{meta}</p>
                      {(a.hidden || a.stopped) && (
                        <p className="text-small text-ink-2">
                          {a.stopped ? "Not syncing; its Books history is kept." : "Hidden in Treasury: left out of its totals, Books reports and the emailed report."}
                          {a.hidden && !owner ? " Confirm it isn’t an entity’s account." : ""}
                        </p>
                      )}
                      {conflict && <p className="mt-1 text-small text-ink">{conflict}</p>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-between gap-3 pl-11 sm:justify-end sm:pl-0">
                    <span className="min-w-0 text-right text-body">
                      {owner ? (
                        <span className="inline-flex flex-wrap items-center justify-end gap-x-2">
                          <span className="text-ink">{owner}</span>
                          {conflict && <Status tone="warning">Check owner</Status>}
                          {a.owner_kind === "person" || a.owner_kind === "joint" ? <span className="text-small text-ink-2">outside Books</span> : null}
                        </span>
                      ) : (
                        <Status tone="warning">No owner</Status>
                      )}
                    </span>
                    {writer && (
                      <Button size="sm" onClick={() => setEditing(a)} aria-label={`Change owner of ${accountName(a)}`}>
                        {owner ? "Change…" : "Choose…"}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}

      <OwnerDialog open={!!editing} onClose={() => setEditing(null)} account={editing} entities={records.entities} people={records.people} onSave={onSave} />
    </Page>
  );
}
