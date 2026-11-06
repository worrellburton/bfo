import { Fragment, type Dispatch, type SetStateAction } from "react";
import { Banner, Button, Empty, Skeleton, TextLink, usePhone } from "../ui";
import { enablePush, type PushState } from "../push";
import type { MailFolder, MailSummary } from "../mail-client";
import { EMPTY, narrowWords, type Narrow, type View } from "./constants";
import { dayGroup } from "./helpers";
import type { ListState } from "./list-state";
import { MailListRow } from "./list-row";
import { MailTable } from "./table";

/** The iPhone app's invitation to turn on notifications for new mail (app/push.ts): what they show, said before they're on. */
export function PushInvite({ setPushDismissed, setPushAsk }: { setPushDismissed: Dispatch<SetStateAction<boolean>>; setPushAsk: (s: PushState) => void }) {
  return (
    <Banner
      tone="info"
      title="Know when mail arrives."
      className="mx-4 mt-3 mb-1"
      action={
        <Button variant="quiet" size="sm" onClick={async () => setPushAsk(await enablePush())}>
          Turn on
        </Button>
      }
      onDismiss={() => {
        try {
          localStorage.setItem("bfo-push-ask", "no");
        } catch {
          // for this visit
        }
        setPushDismissed(true);
      }}
    >
      A notification on this phone shows who it's from and the subject.
    </Banner>
  );
}

/** At the foot of the list: where the full account of how mail is kept and who sees it lives (§11.7). */
export function MailFooter() {
  return (
    <p className="ds px-1 pt-4 text-small text-ink-2">
      <TextLink to="/legal/privacy#mail">How mail is handled</TextLink>
    </p>
  );
}

/**
 * The list: a skeleton while it's read (after 300ms), a failed read as a
 * Banner with Try again, an empty or filtered-to-nothing state, or the rows
 * (the table on desktop; rows grouped by day on phones; a plain column
 * beside the reader), then Load more.
 */
export function ListBody({
  rows,
  listError,
  q,
  view,
  folder,
  narrow,
  noAddress,
  sent,
  mixed,
  mine,
  list,
  openId,
  picked,
  select,
  prefetch,
  star,
  pick,
  pickAll,
  archiveRow,
  loadingMore,
  loadMore,
  retry,
  clearSearch,
  clearNarrow,
  bulkBar,
}: {
  rows: MailSummary[] | null;
  listError: string | null;
  /** Read the list again after it failed. */
  retry: () => void;
  q: string;
  view: View;
  folder: MailFolder;
  narrow: Narrow;
  noAddress: boolean;
  sent: boolean;
  mixed: boolean;
  mine: string[];
  list: ListState | null;
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
  clearSearch: () => void;
  clearNarrow: () => void;
  /** The desktop table's bulk bar, in its head's place while anything is picked. */
  bulkBar?: React.ReactNode;
}) {
  const phone = usePhone();
  const table = view === "table" && !phone;
  const narrowed = narrow.unread || narrow.starred || narrow.attachments;

  if (!rows) {
    if (listError)
      return (
        <div className="p-4">
          <Banner
            tone="negative"
            action={
              <Button variant="quiet" size="sm" onClick={retry}>
                Try again
              </Button>
            }
          >
            {listError}
          </Banner>
        </div>
      );
    return table ? <Skeleton kind="table" rows={10} columns={["72px", "24%", "32%", "30%", "104px"]} /> : <Skeleton kind="rows" rows={8} />;
  }

  if (rows.length === 0) {
    return (
      <div className="p-5 touch:p-4">
        {q ? (
          <Empty
            action={
              <Button variant="quiet" size="sm" onClick={clearSearch}>
                Clear search
              </Button>
            }
          >
            Nothing in your mail matches “{q}”. Trash isn't searched.
          </Empty>
        ) : narrowed ? (
          <Empty
            action={
              <Button variant="quiet" size="sm" onClick={clearNarrow}>
                Clear filters
              </Button>
            }
          >
            No {narrowWords(narrow)} here.
          </Empty>
        ) : noAddress && (folder === "inbox" || folder === "active") ? (
          <Empty size="page" title="No address yet">
            An owner or admin gives each person their address on the office's domain. Ask one of them, and your mail will arrive here.
          </Empty>
        ) : (
          <Empty size="page" title={EMPTY[folder].title}>
            {EMPTY[folder].body}
          </Empty>
        )}
      </div>
    );
  }

  const rowsOf = (grouped: boolean) => {
    const pinnedIds = new Set((list?.pinned ?? []).map((p) => p.id));
    const groupOf = (x: MailSummary) => (pinnedIds.has(x.id) ? "Starred" : dayGroup(x.occurredAt));
    return (
      <ul className="ds">
        {rows.map((m, i) => {
          const group = groupOf(m);
          const first = grouped && (i === 0 || groupOf(rows[i - 1]) !== group);
          return (
            <Fragment key={m.id}>
              {first && (
                <li aria-hidden="true" className="flex h-8 items-end px-4 pb-1 text-caption font-medium text-ink-2">
                  {group}
                </li>
              )}
              <li className={i > 0 && !first ? "border-t border-line" : ""}>
                <MailListRow
                  m={m}
                  sent={sent || (mixed && m.direction === "out")}
                  mine={mine}
                  selected={m.id === openId}
                  grouped={grouped && group !== "Starred"}
                  onOpen={() => select(m.id)}
                  onPrefetch={() => prefetch(m.id)}
                  onStar={(on) => void star(m, on)}
                  picked={picked.has(m.id)}
                  picking={picked.size > 0}
                  onPick={(shift) => pick(m.id, shift)}
                  onArchive={m.folder === "archive" || folder === "trash" ? undefined : () => void archiveRow(m)}
                />
              </li>
            </Fragment>
          );
        })}
      </ul>
    );
  };

  return (
    <>
      {table ? (
        <MailTable
          rows={rows}
          sent={sent}
          mixed={mixed}
          mine={mine}
          onOpen={select}
          onStar={(m, on) => void star(m, on)}
          picked={picked}
          onPick={pick}
          onPickAll={pickAll}
          bulkBar={bulkBar}
          trash={folder === "trash"}
        />
      ) : (
        rowsOf(phone && !q)
      )}
      {listError && (
        <div className="p-4">
          <Banner tone="negative">{listError}</Banner>
        </div>
      )}
      {list?.hasMore && (
        <div className="border-t border-line p-2">
          <Button variant="quiet" full busy={loadingMore} busyLabel="Loading…" onClick={() => void loadMore()}>
            Load more
          </Button>
        </div>
      )}
    </>
  );
}
