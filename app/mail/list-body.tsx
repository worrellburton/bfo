import { Fragment, type Dispatch, type SetStateAction } from "react";
import { Button, ErrorLine, Icon, useTone } from "../entity/ui";
import { ListLoader, SearchLoader } from "../mail-loaders";
import { enablePush, type PushState } from "../push";
import type { MailFilter, MailFolder, MailSummary } from "../mail-client";
import type { View } from "./constants";
import { dayGroup } from "./helpers";
import type { ListState } from "./list-state";
import { ListRow } from "./list-row";
import { MailTable } from "./table";

/** The iPhone app's invitation to turn on notifications for new mail (app/push.ts). */
export function PushInvite({ setPushDismissed, setPushAsk }: { setPushDismissed: Dispatch<SetStateAction<boolean>>; setPushAsk: (s: PushState) => void }) {
  const t = useTone();
  return (
      <div className={`row-in mx-4 mb-2 mt-1 rounded-2xl border p-3.5 md:hidden ${t.dark ? "border-white/[0.08] bg-white/[0.05]" : "border-gray-200 bg-white/80"}`}>
        <div className="flex items-center gap-3">
          <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${t.dark ? "bg-(--mail-accent-deep)/25 text-(--mail-accent-pale)" : "bg-(--mail-accent-deep)/10 text-(--mail-accent-ink)"}`}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block text-[14px] font-semibold ${t.text}`}>Know when mail arrives</span>
            <span className={`block text-[12.5px] ${t.muted}`}>A notification on this phone for new mail.</span>
          </span>
        </div>
        <div className="mt-2.5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem("bfo-push-ask", "no");
              } catch {
                // for this visit
              }
              setPushDismissed(true);
            }}
            className={`h-[40px] shrink-0 cursor-pointer rounded-full px-3 text-[13px] font-medium ${t.muted}`}
          >
            Not now
          </button>
          <button type="button" onClick={async () => setPushAsk(await enablePush())} className="fab-glass h-[40px] shrink-0 cursor-pointer rounded-full px-5 text-[13px] font-semibold">
            Turn on
          </button>
        </div>
      </div>
  );
}

/** The list: its loader or error, its empty state, or the rows (the table, or day-grouped rows on phones; a plain list in columns), then Load more. */
export function ListBody({ rows, listError, loaderLeaving, q, view, folder, filter, noAddress, address, emptyText, sent, mixed, list, rowsFresh, returnedId, openId, picked, select, prefetch, star, pick, pickAll, archiveRow, loadingMore, loadMore, retry }: {
  rows: MailSummary[] | null;
  listError: string | null;
  /** Read the list again after it failed. */
  retry: () => void;
  loaderLeaving: boolean;
  q: string;
  view: View;
  folder: MailFolder;
  filter: MailFilter;
  noAddress: boolean;
  address: string;
  emptyText: () => string;
  sent: boolean;
  mixed: boolean;
  list: ListState | null;
  rowsFresh: boolean;
  returnedId: string | null;
  openId: string | null;
  picked: Set<string>;
  select: (id: string) => void;
  prefetch: (id: string) => void;
  star: (m: MailSummary, starred: boolean, fromList?: boolean) => Promise<void>;
  pick: (id: string, shift: boolean) => void;
  pickAll: () => void;
  archiveRow: (m: MailSummary) => Promise<void>;
  loadingMore: boolean;
  loadMore: () => Promise<void>;
}) {
  const t = useTone();
  return !rows ? (
    listError ? (
      <div className="flex flex-wrap items-center gap-x-1 pr-3">
        <ErrorLine>{listError}</ErrorLine>
        <Button kind="ghost" onClick={retry}>
          Try again
        </Button>
      </div>
    ) : (
      <div className={loaderLeaving ? "loader-out" : ""}>{q ? <SearchLoader term={q} /> : <ListLoader table={view === "table"} label={folder === "sent" ? "Fetching sent mail" : folder === "archive" ? "Fetching the archive" : "Fetching mail"} />}</div>
    )
  ) : rows.length === 0 ? (
    <div className="px-5 py-10 text-center">
      <div className={`row-in mx-auto max-w-[320px] rounded-3xl border px-6 py-8 mail-glass-top ${t.dark ? "border-white/[0.08] bg-white/[0.03]" : "border-gray-200 bg-white/70"}`}>
        <span
          aria-hidden="true"
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full text-white"
          style={{ background: `linear-gradient(135deg, hsl(var(--mail-hue) var(--mail-sat) 60%), hsl(calc(var(--mail-hue) + 28) var(--mail-sat) 62%))`, boxShadow: `0 0 36px hsl(var(--mail-hue) var(--mail-sat) 60% / 0.45)` }}
        >
          <Icon name="mail" className="h-6 w-6" strokeWidth={1.6} />
        </span>
        <p className={`text-[14px] font-medium ${t.text}`}>{emptyText()}</p>
        {(folder === "inbox" || folder === "active") && filter === "all" && !q && address && <p className={`mt-1 text-[12.5px] ${t.muted}`}>{address}</p>}
        {(folder === "inbox" || folder === "active") && filter === "all" && !q && <p className={`mt-3 text-[12px] ${t.faint}`}>Enjoy the quiet.</p>}
      </div>
    </div>
  ) : (
    <>
      {view === "table" ? (
        <>
          <MailTable rows={rows} sent={sent} mixed={mixed} me={address} onOpen={select} onStar={star} picked={picked} onPick={pick} onPickAll={pickAll} className="max-md:hidden" />
          <ul className="md:hidden">
            {rows.map((m, i) => {
              const pinnedIds = new Set((list?.pinned ?? []).map((p) => p.id));
              const groupOf = (x: MailSummary) => (pinnedIds.has(x.id) ? "Starred" : dayGroup(x.occurredAt));
              const group = groupOf(m);
              const first = i === 0 || groupOf(rows[i - 1]) !== group;
              return (
                <Fragment key={m.id}>
                  {first && !q && (
                    <li aria-hidden="true" className={`${rowsFresh ? "row-in" : ""} px-5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.14em] first:pt-1 ${t.faint}`} style={{ animationDelay: `${Math.min(i, 12) * 28}ms` }}>
                      {group}
                    </li>
                  )}
                  <li className={`${rowsFresh ? "row-in" : ""} ${m.id === returnedId ? "row-return" : ""}`} style={{ animationDelay: `${Math.min(i, 12) * 28}ms` }}>
                    <ListRow m={m} sent={sent || (mixed && m.direction === "out")} me={address} selected={false} onOpen={() => select(m.id)} onPrefetch={() => prefetch(m.id)} onStar={(on) => star(m, on)} picked={picked.has(m.id)} picking={picked.size > 0} onPick={(shift) => pick(m.id, shift)} onArchive={m.folder === "archive" ? undefined : () => void archiveRow(m)} />
                  </li>
                </Fragment>
              );
            })}
          </ul>
        </>
      ) : (
        <ul className={`divide-y ${t.divide}`}>
          {rows.map((m) => (
            <li key={m.id}>
              <ListRow m={m} sent={sent || (mixed && m.direction === "out")} me={address} selected={m.id === openId} onOpen={() => select(m.id)} onPrefetch={() => prefetch(m.id)} onStar={(on) => star(m, on)} picked={picked.has(m.id)} picking={picked.size > 0} onPick={(shift) => pick(m.id, shift)} />
            </li>
          ))}
        </ul>
      )}
      {listError && <ErrorLine>{listError}</ErrorLine>}
      {list?.hasMore && (
        <div className={`border-t p-2 ${t.line}`}>
          <Button kind="ghost" className="w-full" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </>
  );
}
