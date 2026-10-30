import { Fragment, type Dispatch, type SetStateAction } from "react";
import { Button, Icon, IconButton, TextButton, useTone } from "../entity/ui";
import type { MailCount, MailFilter, MailFolder, MailSummary } from "../mail-client";
import { Glyph, Star } from "./glyphs";
import { FILTERS } from "./constants";
import type { ListState } from "./list-state";
import { Segmented, SelectBox } from "./controls";
import { FolderMenu } from "./folder-menu";

/** Above the list: the folder chips (the phone's folder menu), a search's result count, and the filter. */
export function Toolbar({ q, rows, list, folders, folder, filter, count, search, choosePlace, chooseFolder, chooseFilter }: {
  q: string;
  rows: MailSummary[] | null;
  list: ListState | null;
  folders: { key: MailFolder; label: string }[];
  folder: MailFolder;
  filter: MailFilter;
  count: MailCount | null;
  search: (term: string) => void;
  choosePlace: (folder: MailFolder, filter: MailFilter) => void;
  chooseFolder: (next: MailFolder) => void;
  chooseFilter: (next: MailFilter) => void;
}) {
  const t = useTone();
  return (
    /* A container, so the narrow list of a tablet's split view can drop the filters (the folder chips scroll). */
    <div className={`@container flex shrink-0 items-center gap-2 border-b px-1.5 py-1.5 max-md:border-0 max-md:px-0 max-md:pb-2 max-md:pt-0 ${t.line}`}>
      {q ? (
        <div className={`flex min-w-0 flex-1 items-center gap-2 px-2 text-[12.5px] max-md:px-1 max-md:text-[13.5px] ${t.muted}`}>
          <span className="truncate">
            {rows ? `${rows.length}${list?.hasMore ? "+" : ""} result${rows.length === 1 ? "" : "s"}` : "Searching"} in all mail
          </span>
          <TextButton onClick={() => search("")} className={`shrink-0 ${t.accent}`}>
            Clear
          </TextButton>
        </div>
      ) : (
      <>
      <div className="mx-1 flex min-w-0 flex-1 md:hidden">
        <FolderMenu folders={folders} folder={folder} filter={filter} count={count ? { unread: count.unread, otherUnread: count.otherUnread } : null} onPick={choosePlace} />
      </div>
      <nav aria-label="Folders" className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-md:hidden">
        {folders.map((x) => {
          const on = x.key === folder;
          const n = x.key === "inbox" || x.key === "active" ? count?.unread : x.key === "other" ? count?.otherUnread : 0;
          // Active isn't a folder like the rest (it's In and Out together, as conversations): its own colour and mark, and a rule after it.
          const live = x.key === "active";
          const tone = live
            ? on
              ? t.dark ? "bg-(--mail-accent-deep)/25 text-(--mail-accent-pale) ring-1 ring-inset ring-(--mail-accent)/50" : "bg-(--mail-accent-deep) text-white"
              : t.dark ? "text-(--mail-accent) ring-1 ring-inset ring-(--mail-accent)/25 hover:bg-(--mail-accent-deep)/10 hover:text-(--mail-accent-pale)" : "text-(--mail-accent-ink) ring-1 ring-inset ring-(--mail-accent-deep)/30 hover:bg-(--mail-accent-deep)/10"
            : on
              ? t.dark ? "bg-white/[0.09] text-white" : "bg-gray-900 text-white"
              : t.dark ? "text-gray-400 hover:text-gray-200" : "text-gray-500 hover:text-gray-900";
          const badge = live
            ? on
              ? t.dark ? "bg-(--mail-accent)/30 text-white" : "bg-white/20 text-white"
              : t.dark ? "bg-(--mail-accent-deep)/20 text-(--mail-accent-pale)" : "bg-(--mail-accent-deep)/15 text-(--mail-accent-ink)"
            : on
              ? "bg-white/15 text-white"
              : t.dark ? "bg-white/[0.07] text-gray-300" : "bg-gray-100 text-gray-600";
          return (
            <Fragment key={x.key}>
              <button
                type="button"
                aria-current={on ? "page" : undefined}
                onClick={() => chooseFolder(x.key)}
                title={live ? "In (inbox) and Out (sent) together, a row per conversation, latest activity first" : undefined}
                className={`inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[12.5px] font-medium transition-colors max-md:h-[38px] md:pointer-coarse:h-[38px] max-md:rounded-[10px] max-md:px-3.5 max-md:text-[13.5px] ${live ? "font-semibold" : ""} ${tone}`}
              >
                {live && <Glyph name="chats" className="h-3.5 w-3.5" />}
                {x.label}
                {!!n && <span className={`min-w-[18px] rounded-full px-1.5 text-center text-[10.5px] tabular-nums leading-[18px] ${badge}`}>{n}</span>}
              </button>
              {live && <span aria-hidden="true" className={`mx-1.5 my-1 w-px shrink-0 self-stretch max-md:hidden ${t.dark ? "bg-white/10" : "bg-gray-200"}`} />}
            </Fragment>
          );
        })}
      </nav>
      </>
      )}
      <Segmented
        label="Show"
        value={filter}
        onChange={chooseFilter}
        className="max-md:hidden @max-[440px]:hidden"
        options={FILTERS.map((x) => ({ key: x.key, label: x.label, icon: x.key === "starred" ? <Star on className="h-3 w-3" /> : undefined }))}
      />
      {/* Where the filter has no room (the split view's narrow list), one that's on still shows, and its × clears it. */}
      {filter !== "all" && (
        <button
          type="button"
          onClick={() => chooseFilter("all")}
          aria-label={`Showing ${FILTERS.find((x) => x.key === filter)?.label ?? filter} only. Show all`}
          title="Show all"
          className={`hidden h-7 shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-lg pl-2.5 pr-1.5 text-[12px] font-medium md:pointer-coarse:h-[38px] md:@max-[440px]:inline-flex ${t.dark ? "bg-white/[0.09] text-white hover:bg-white/[0.14]" : "bg-gray-900 text-white hover:bg-gray-700"}`}
        >
          {FILTERS.find((x) => x.key === filter)?.label ?? filter}
          <Icon name="x" className="h-3 w-3" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

/**
 * While messages are picked, in the table header's place: how many, select all, and what can be done to them at once.
 * Phones (`floating`, portalled): a bar at the bottom where the compose button was, so picking moves no row from under the finger.
 */
export function BulkBar({ rows, pickedRows, bulkBusy, folder, pickAll, bulk, setPicked, floating = false }: {
  floating?: boolean;
  rows: MailSummary[];
  pickedRows: MailSummary[];
  bulkBusy: boolean;
  folder: MailFolder;
  pickAll: () => void;
  bulk: (action: "read" | "unread" | "archive" | "inbox" | "delete", only?: string[]) => Promise<void>;
  setPicked: Dispatch<SetStateAction<Set<string>>>;
}) {
  const t = useTone();
  const clear = <IconButton icon="x" label="Clear selection (Esc)" onClick={() => setPicked(new Set())} />;
  return (
    <div
      role="toolbar"
      aria-label="Selected messages"
      className={`pick-bar-in flex flex-wrap items-center gap-1 backdrop-blur-xl ${
        floating
          ? `fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 rounded-2xl border px-2 py-1.5 shadow-2xl md:hidden ${t.dark ? "border-white/10 bg-[#14152a]/95" : "border-gray-200 bg-white/95"}`
          : `sticky top-0 z-[2] border-b px-3 py-1.5 max-md:hidden ${t.line} ${t.dark ? "bg-[#14152a]/95" : "bg-(--mail-accent-deep)/10/95"}`
      }`}
    >
      <SelectBox
        on={pickedRows.length === rows.length}
        mixed={pickedRows.length < rows.length}
        onToggle={() => pickAll()}
        label={pickedRows.length === rows.length ? "Unselect all" : "Select all"}
      />
      <span className={`mr-2 text-[12.5px] font-medium tabular-nums ${t.text}`}>{pickedRows.length} selected</span>
      {/* Phones: the round box selects all; no room for the words too. */}
      {pickedRows.length < rows.length && !floating && (
        <button type="button" onClick={() => pickAll()} className={`mr-1 cursor-pointer text-[12px] hover:underline ${t.accent}`}>
          Select all {rows.length}
        </button>
      )}
      <span className="flex-1" />
      {/* Phones: how many and × on one line, the actions spread across the next. */}
      {floating && clear}
      <div className={floating ? "flex w-full justify-around" : "contents"}>
      {pickedRows.some((m) => !m.read) && (
        <Button kind="ghost" disabled={bulkBusy} onClick={() => void bulk("read")}>
          Mark read
        </Button>
      )}
      {pickedRows.some((m) => m.read) && (
        <Button kind="ghost" disabled={bulkBusy} onClick={() => void bulk("unread")}>
          Mark unread
        </Button>
      )}
      {(folder === "active" || (folder === "inbox" && pickedRows.some((m) => m.direction === "in"))) && (
        <Button kind="ghost" disabled={bulkBusy} onClick={() => void bulk("archive")}>
          Archive
        </Button>
      )}
      {folder === "archive" && (
        <Button kind="ghost" disabled={bulkBusy} onClick={() => void bulk("inbox")}>
          Move to inbox
        </Button>
      )}
      <Button kind="ghost" disabled={bulkBusy} onClick={() => void bulk("delete")}>
        Delete
      </Button>
      </div>
      {!floating && clear}
    </div>
  );
}
