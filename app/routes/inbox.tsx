import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { getUser, isAdmin } from "../auth";
import { Banner, Button, Disclosure, FilterChip, Page, confirm, cx, usePhone, useDocumentTitle } from "../ui";
import { PullToRefresh } from "../mail-pull";
import { usePushState } from "../push";
import { emptyTrash, getFaces, markRead, moveMail, notifyMailChanged, purgeMail, restoreMail, sendMail, syncMail, trashMail, useMailCount, type MailCount, type MailFaces, type MailFilter, type MailFolder } from "../mail-client";
import { FacesContext } from "../mail/avatar";
import { FOLDERS, NARROW_LABELS, VIEW_KEY, folderLabel, narrowOf, savedView, type Narrow, type NarrowKey, type View } from "../mail/constants";
import { eachRow, listRows } from "../mail/list-state";
import { FolderTabs, MailSearch, type FolderTab } from "../mail/controls";
import { blankDraft, forwardDraft, replyDraft, type Draft } from "../mail/drafts";
import { Compose, type QueuedSend } from "../mail/composer";
import { Reader } from "../mail/reader";
import { useMailList } from "../mail/use-mail-list";
import { useOpenMessage } from "../mail/use-open-message";
import { useMailNavigation } from "../mail/use-mail-navigation";
import { notify, trashLine, useMailActions } from "../mail/use-mail-actions";
import { useMailShortcuts } from "../mail/shortcuts";
import { BulkBar, NarrowSelect, ViewSwitch, type BulkAction } from "../mail/toolbar";
import { FolderMenu } from "../mail/folder-menu";
import { ListBody, MailFooter, PushInvite } from "../mail/list-body";
import { MailHeader, checkedLine } from "../mail/header";
import { OfficeMailNotice } from "../mail/notice";
import { holdSend } from "../mail/outbox";
import { Glyph } from "../mail/glyphs";

export function meta() {
  return [{ title: "Mail · BFO" }];
}

/** The split view's height: from its top to the window's foot, less the page's bottom padding, so each pane scrolls on its own. */
function useFillHeight(on: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!on) return;
    const measure = () => {
      const top = ref.current?.getBoundingClientRect().top ?? 0;
      setHeight(Math.max(480, Math.round(window.innerHeight - top - 32 + window.scrollY)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [on]);
  return { ref, height };
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function Inbox() {
  const me = getUser();
  const count = useMailCount();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const phone = usePhone();
  useDocumentTitle("Mail");

  const canSeeOther = count ? count.canSeeOther : !!me && isAdmin(me);
  const hasTrash = count?.trash === true;
  const f = params.get("f");
  // Inbox (received and sent together, by conversation) unless the URL picks another place.
  const folder: MailFolder = f === "inbox" || f === "sent" || f === "archive" || (f === "trash" && hasTrash) || (f === "other" && canSeeOther) ? f : "active";
  const v = params.get("v");
  const filter: MailFilter = v === "unread" || v === "starred" || v === "unread-starred" ? v : "all";
  const attachments = params.get("att") === "1";
  const narrow = narrowOf(filter, attachments);
  /** Search text from the URL; while set, every folder but Trash is searched. */
  const q = (params.get("q") ?? "").trim();
  const openId = params.get("m");
  // Until the count answers, the session's copy will do. null from the server: no address yet.
  const address = (count ? count.address : me?.mailAddress) || "";
  const noAddress = !!count && !count.address;
  const aliases = useMemo(() => (address ? (count?.aliases ?? []) : []), [address, count?.aliases]);
  const mine = useMemo(() => (address ? [address, ...aliases] : []), [address, aliases]);
  /** One mailbox (an address of mine) from the URL, or every one. */
  const a = (params.get("a") ?? "").toLowerCase();
  const box = mine.some((m) => m.toLowerCase() === a) ? a : "";

  const [view, setView] = useState<View>("table");
  useEffect(() => setView(savedView()), []);
  function chooseView(next: View) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // A preference that doesn't stick is no loss.
    }
  }

  const [draft, setDraft] = useState<Draft | null>(null);
  /** Everyone's chosen pictures, by address; asked for once per visit. */
  const [faces, setFaces] = useState<MailFaces>({});
  useEffect(() => {
    let alive = true;
    getFaces()
      .then((r) => alive && setFaces(r.faces ?? {}))
      .catch(() => {}); // Initials will do.
    return () => {
      alive = false;
    };
  }, []);
  /** A hold just put on or lifted here, until the shared count catches up. */
  const [holdNow, setHoldNow] = useState<MailCount["hold"] | undefined>(undefined);
  useEffect(() => setHoldNow(undefined), [count?.hold?.since]);
  const hold = holdNow !== undefined ? holdNow : (count?.hold ?? null);

  /** Messages picked for a bulk action, and the last one clicked (shift-click picks the range from it). */
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const pickAnchor = useRef<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const { list, setList, listError, setListError, loadingMore, listRef, loadList, loadMore, reread, refreshActive, patchRow } = useMailList({ folder, filter, attachments, q, box, count });
  const { cache, open, setOpen, thread, setThread, freshId, setFreshId } = useOpenMessage({ openId, listRef, patchRow });
  const { prefetch, select, closeMessage, chooseFolder, chooseNarrow, search, chooseBox, openIdRef, navStateRef, queryRef, mountedRef } = useMailNavigation({
    folder,
    filter,
    attachments,
    q,
    box,
    openId,
    cache,
    listRef,
    setParams,
    navigate,
    location,
  });
  const { move, archiveRow, remove, restore, purge, hold: holdMessage, star, undoWith, undoTrash, markUnread, onSent } = useMailActions({
    folder,
    q,
    cache,
    listRef,
    setList,
    setListError,
    reread,
    refreshActive,
    patchRow,
    setOpen,
    thread,
    setThread,
    setFreshId,
    setDraft,
    closeMessage,
    setParams,
    openIdRef,
    navStateRef,
    queryRef,
    mountedRef,
  });

  const folders = FOLDERS.filter((x) => (x.key !== "other" || canSeeOther) && (x.key !== "trash" || hasTrash));
  const rows = list && list.folder === folder && list.filter === filter && list.attachments === attachments && list.q === q && list.to === box ? listRows(list) : null;

  // Another folder, filter, search or mailbox starts with nothing picked.
  useEffect(() => {
    setPicked(new Set());
    pickAnchor.current = null;
  }, [folder, filter, attachments, q, box]);

  // Esc lets go of the selection (when no message is open to close first).
  useEffect(() => {
    if (!picked.size) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !openIdRef.current && !draft && !e.defaultPrevented) setPicked(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked.size, draft, openIdRef]);

  // While picking on a phone, the selection bar is up: the Ask button steps aside and toasts sit above the bar.
  const pickingOnPhone = phone && picked.size > 0;
  const readingOnPhone = phone && !!openId;
  useEffect(() => {
    const root = document.documentElement;
    if (pickingOnPhone) root.dataset.selection = "mail";
    else if (root.dataset.selection === "mail") delete root.dataset.selection;
    const lift = pickingOnPhone ? "calc(128px + env(safe-area-inset-bottom))" : readingOnPhone ? "calc(88px + env(safe-area-inset-bottom))" : "";
    if (lift) root.style.setProperty("--toast-bottom", lift);
    else root.style.removeProperty("--toast-bottom");
    return () => {
      if (root.dataset.selection === "mail") delete root.dataset.selection;
      root.style.removeProperty("--toast-bottom");
    };
  }, [pickingOnPhone, readingOnPhone]);

  function pick(id: string, shift: boolean) {
    const ids = (rows ?? []).map((m) => m.id);
    setPicked((prev) => {
      const next = new Set(prev);
      const turnOn = !prev.has(id);
      const from = shift && pickAnchor.current ? ids.indexOf(pickAnchor.current) : -1;
      const to = ids.indexOf(id);
      if (from >= 0 && to >= 0) {
        // The whole range takes the clicked one's new state.
        for (const x of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) {
          if (turnOn) next.add(x);
          else next.delete(x);
        }
      } else if (turnOn) next.add(id);
      else next.delete(id);
      return next;
    });
    pickAnchor.current = id;
  }

  function pickAll() {
    const ids = (rows ?? []).map((m) => m.id);
    setPicked((prev) => (ids.length && ids.every((x) => prev.has(x)) ? new Set() : new Set(ids)));
    pickAnchor.current = null;
  }

  /** Remove rows from the list, and close the open message if it was one of them. */
  function drop(ids: string[]) {
    const gone = new Set(ids);
    setList((prev) => prev && eachRow(prev, (r) => r.filter((m) => !gone.has(m.id))));
    for (const id of ids) cache.current.delete(id);
    if (openIdRef.current && gone.has(openIdRef.current)) closeMessage();
    setPicked(new Set());
  }

  /** Read or unread, archive or back to the inbox, delete, restore, or delete forever: for every picked message at once. */
  async function bulk(action: BulkAction, only?: string[]) {
    // The picked rows, or (from a key) just the one in focus.
    const chosen = (rows ?? []).filter((m) => (only ? only.includes(m.id) : picked.has(m.id)));
    const ids = chosen.map((m) => m.id);
    if (!ids.length || bulkBusy) return;
    // In Inbox each row is a conversation: Archive and Delete take all of it.
    const whole = folder === "active" && !q;
    const n = (k: number, one = "message", many = "messages") => `${k} ${k === 1 ? one : many}`;
    if (action === "purge") {
      const ok = await confirm({
        title: ids.length === 1 ? "Delete this message forever?" : `Delete ${ids.length} messages forever?`,
        object: { names: chosen.map((m) => m.subject || "(no subject)") },
        message: `${ids.length === 1 ? "It and its attachments are" : "They and their attachments are"} removed from BFO. A record of who deleted ${ids.length === 1 ? "it" : "them"}, and when, is kept.`,
        irreversible: true,
        confirmLabel: ids.length === 1 ? "Delete forever" : `Delete ${ids.length} forever`,
        tone: "danger",
        ...(ids.length > 100 ? { typeToConfirm: String(ids.length) } : {}),
      });
      if (!ok) return;
    }
    setBulkBusy(true);
    try {
      if (action === "read" || action === "unread") {
        const read = action === "read";
        await markRead(ids, read);
        setList((prev) => prev && eachRow(prev, (r) => r.map((m) => (ids.includes(m.id) ? { ...m, read } : m))));
        for (const id of ids) cache.current.delete(id);
        notify(read ? `Marked ${n(ids.length)} as read` : `Marked ${n(ids.length)} as unread`, () => void undoWith(() => markRead(ids, !read)));
      } else if (action === "delete") {
        const r = await trashMail(ids, { conversation: whole });
        drop([...ids, ...r.trashed, ...r.archived]);
        refreshActive();
        notify(trashLine({ ...r }, whole && ids.length === 1), r.trashed.length || r.archived.length ? undoTrash(r) : undefined);
      } else if (action === "restore") {
        const r = await restoreMail(ids);
        drop(r.restored);
        notify(`Restored ${n(r.restored.length)} from Trash`, () => void undoWith(() => trashMail(r.restored)));
      } else if (action === "purge") {
        const r = await purgeMail(ids);
        drop(ids);
        notify(r.kept ? `Deleted ${n(r.purged)} forever. ${n(r.kept)} kept for records stayed.` : `Deleted ${n(r.purged)} forever`);
        if (r.kept) reread();
      } else {
        await moveMail(ids, action, { conversation: whole && action === "archive" });
        drop(ids);
        refreshActive();
        const back = action === "archive" ? "inbox" : "archive";
        notify(action === "archive" ? `Archived ${n(ids.length, whole ? "conversation" : "message", whole ? "conversations" : "messages")}` : `Moved ${n(ids.length)} to your inbox`, () =>
          void undoWith(() => moveMail(ids, back, { conversation: whole })),
        );
      }
      notifyMailChanged();
    } catch (e) {
      setListError((e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  }

  async function onEmptyTrash() {
    const shown = rows?.length ?? 0;
    const ok = await confirm({
      title: "Empty Trash?",
      message: `Everything in Trash${list?.hasMore ? "" : ` (${shown} ${shown === 1 ? "message" : "messages"})`} and their attachments are removed from BFO for good. Mail kept for records stays. A record of who emptied it, and when, is kept.`,
      irreversible: true,
      confirmLabel: "Empty Trash",
      tone: "danger",
      ...(list?.hasMore || shown > 100 ? { typeToConfirm: "Trash" } : {}),
    });
    if (!ok) return;
    try {
      const r = await emptyTrash();
      reread();
      notifyMailChanged();
      notify(r.kept ? `Deleted ${r.purged} forever. ${r.kept} kept for records stayed in Trash.` : `Deleted ${r.purged} ${r.purged === 1 ? "message" : "messages"} forever`);
    } catch (e) {
      setListError((e as Error).message);
    }
  }

  /** Send: held ten seconds with Undo, then sent; a failure reopens the message with what went wrong. */
  function queueSend(request: QueuedSend, restore: Draft) {
    const about = restore.replyToId ?? restore.forwardId;
    const sendId = restore.sendId ?? crypto.randomUUID();
    const reopen = (error?: string) => setDraft({ ...restore, sendId, restore: { ...(restore.restore ?? { html: "", files: [] }), ...(error ? { error } : {}) } });
    setDraft(null);
    const held = holdSend({
      send: async () => {
        try {
          const { message } = await sendMail({
            sendId,
            ...request,
            ...(restore.replyToId ? { replyToId: restore.replyToId } : {}),
            ...(restore.forwardId ? { forwardId: restore.forwardId } : {}),
          });
          if (mountedRef.current) onSent(message, about);
          notify("Sent");
        } catch (e) {
          if (mountedRef.current) reopen((e as Error).message);
          else notify("A message couldn't be sent. Open Mail to see it and try again.");
        }
      },
      onCancelled: () => reopen(),
    });
    notify("Sending…", () => held.undo());
  }

  const sent = folder === "sent";
  /** Inbox mixes both ways: each row says whether it came in or went out. */
  const mixed = folder === "active" && !q;
  const reading = !!openId && (phone || view === "table");
  const columns = !phone && view === "columns";
  const split = useFillHeight(columns);

  const canHoldMail = !!me && isAdmin(me);
  const canRelease = me?.role === "owner";
  const reader = (
    <Reader
      key={openId ?? undefined}
      message={open?.message ?? null}
      error={open?.error ?? null}
      mine={mine}
      backLabel={q ? "Results" : folderLabel(folder)}
      backAlways={!columns}
      onBack={closeMessage}
      onReply={(m, mode) => setDraft(replyDraft(m, mode, mine))}
      onForward={(m) => setDraft(forwardDraft(m))}
      onMove={move}
      onDelete={remove}
      onRestore={restore}
      onPurge={purge}
      onHold={(m, on) => {
        if (!on) return void holdMessage(m, false);
        void confirm({
          title: "Keep this message for records?",
          object: { name: m.subject || "(no subject)" },
          message: "It can't be deleted, from here or from Trash, until an owner stops keeping it. This is recorded.",
          confirmLabel: "Keep for records",
          tone: "commit",
        }).then((ok) => {
          if (ok) void holdMessage(m, true);
        });
      }}
      onStar={(m, on) => void star(m, on, false)}
      onUnread={markUnread}
      thread={thread && thread.id === open?.id ? thread.messages : []}
      wholeConversation={folder === "active" && !q}
      freshId={freshId}
      preview={openId ? ((rows ?? []).find((r) => r.id === openId) ?? null) : null}
      canHold={canHoldMail && hasTrash}
      canRelease={canRelease && hasTrash}
      noAddress={noAddress}
    />
  );

  const pickedRows = (rows ?? []).filter((m) => picked.has(m.id));
  useMailShortcuts({ draft, open, openId, folder, picked, pickedRows, noAddress, mine, box, listRef, select, closeMessage, move, bulk, remove, purge, setDraft, star, pick, markUnread });
  const bulkProps = { rows: rows ?? [], pickedRows, hasMore: !!list?.hasMore, bulkBusy, folder, pickAll, bulk, setPicked };
  const bulkBar = pickedRows.length > 0 && rows && <BulkBar {...bulkProps} />;
  // Phones: the same bar, floating at the bottom where the compose button was.
  const bulkFloat = phone && pickedRows.length > 0 && rows && createPortal(<BulkBar floating {...bulkProps} />, document.body);

  // The iPhone app: invite notifications for new mail once, until answered (app/push.ts).
  const [pushAsk, setPushAsk] = usePushState();
  const [pushDismissed, setPushDismissed] = useState(true);
  useEffect(() => {
    try {
      setPushDismissed(localStorage.getItem("bfo-push-ask") === "no");
    } catch {
      setPushDismissed(false);
    }
  }, []);
  const pushInvite = phone && pushAsk === "prompt" && !pushDismissed && rows && !q ? <PushInvite setPushDismissed={setPushDismissed} setPushAsk={setPushAsk} /> : null;

  // Mail that arrived since the list was read: offered, not shuffled in under a thumb.
  const seenUnread = useRef<number | null>(null);
  const [freshMail, setFreshMail] = useState(false);
  useEffect(() => {
    const n = count?.unread;
    if (n === undefined) return;
    if (seenUnread.current === null) seenUnread.current = n;
    else if (n > seenUnread.current && (folder === "active" || folder === "inbox") && !q) setFreshMail(true);
    seenUnread.current = n;
  }, [count?.unread, folder, q]);
  const firstId = list?.messages[0]?.id;
  useEffect(() => setFreshMail(false), [firstId, folder, box, q]);

  /** Pulled down on a phone: check for new mail, then read the list and the count again. */
  async function refreshFromPull(): Promise<{ fresh: number }> {
    const r = await syncMail().catch(() => ({ ingested: 0 }));
    const cur = listRef.current;
    if (cur) await loadList({ folder: cur.folder, filter: cur.filter, attachments: cur.attachments, q: cur.q, box: cur.to }, "reset");
    else await loadList({ folder, filter, attachments, q, box }, "replace");
    // What this pull brought in is already on screen: no "Show new mail" for it.
    seenUnread.current = Number.POSITIVE_INFINITY;
    notifyMailChanged();
    return { fresh: r.ingested ?? 0 };
  }
  const [checking, setChecking] = useState(false);
  async function checkAgain() {
    setChecking(true);
    try {
      await syncMail();
      notifyMailChanged();
    } catch {
      // The banner stays until a check works.
    } finally {
      setChecking(false);
    }
  }

  const tabs: FolderTab[] = folders.map((x) => ({
    key: x.key,
    label: x.label,
    to: `/inbox${x.key === "active" ? "" : `?f=${x.key}`}`,
    count: x.key === "active" ? (box && list?.to === box && list.unread !== undefined ? list.unread : (count?.activeUnread ?? count?.unread)) : x.key === "other" ? count?.otherUnread : undefined,
    title: x.key === "active" ? "Received and sent together, one row per conversation" : x.key === "other" ? "Mail to addresses no one has. Owners and admins can see it." : undefined,
  }));
  const counts: Partial<Record<MailFolder, number>> = Object.fromEntries(tabs.map((t) => [t.key, t.count ?? 0]));
  const activeChips = (Object.keys(NARROW_LABELS) as NarrowKey[]).filter((k) => narrow[k]);

  const banners = (
    <>
      {count?.sync?.failed && (
        <Banner
          tone="warning"
          title="New mail couldn't be checked."
          action={
            <Button variant="quiet" size="sm" busy={checking} busyLabel="Checking…" onClick={() => void checkAgain()}>
              Try again
            </Button>
          }
        >
          {checkedLine(count.sync.at)?.replace("Checked for new mail", "The last try was") ?? "Mail may be missing until it works."}
          {count.sync.error && (
            <Disclosure label="Technical details" className="mt-1">
              <p className="text-small break-words text-ink-2">{count.sync.error}</p>
            </Disclosure>
          )}
        </Banner>
      )}
      {hold && (
        <Banner tone="info" title={`Mail is on hold for records since ${new Date(hold.since).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`}>
          Nothing can be deleted until an owner lifts the hold: Delete archives received mail instead, and Trash doesn't empty.
          {hold.reason ? ` Reason: ${hold.reason}` : ""}
        </Banner>
      )}
      {folder === "trash" && !q && (
        <Banner
          tone="info"
          action={
            rows && rows.length > 0 && !hold ? (
              <Button variant="quiet" size="sm" className="text-negative enabled:hover:text-negative" onClick={() => void onEmptyTrash()}>
                Empty Trash
              </Button>
            ) : undefined
          }
        >
          Messages in Trash are deleted for good, with their attachments, 30 days after they were deleted.
        </Banner>
      )}
    </>
  );

  const listCard = (
    <div className="ds">
      {q && rows && (
        <div className="flex flex-wrap items-center gap-x-3 border-b border-line px-5 py-2 text-small text-ink-2 touch:px-4">
          <span>
            {rows.length}
            {list?.hasMore ? "+" : ""} {rows.length === 1 && !list?.hasMore ? "result" : "results"} for “{q}” in your mail
          </span>
          <Button variant="quiet" size="sm" onClick={() => search("")}>
            Clear search
          </Button>
        </div>
      )}
      {freshMail && !openId && (
        <div className="flex justify-center border-b border-line p-2">
          <Button
            size="sm"
            onClick={() => {
              setFreshMail(false);
              reread();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            Show new mail
          </Button>
        </div>
      )}
      {pushInvite}
      <PullToRefresh enabled={phone && !openId && !picked.size} onRefresh={refreshFromPull}>
        <ListBody
          rows={rows}
          listError={listError}
          q={q}
          view={columns ? "columns" : "table"}
          folder={folder}
          narrow={narrow}
          noAddress={noAddress}
          sent={sent}
          mixed={mixed}
          mine={mine}
          list={list}
          openId={openId}
          picked={picked}
          select={select}
          prefetch={prefetch}
          star={star}
          pick={pick}
          pickAll={pickAll}
          archiveRow={archiveRow}
          loadingMore={loadingMore}
          loadMore={loadMore}
          retry={() => void loadList({ folder, filter, attachments, q, box }, "replace")}
          clearSearch={() => search("")}
          clearNarrow={() => chooseNarrow({ unread: false, starred: false, attachments: false })}
          bulkBar={!phone ? bulkBar : undefined}
        />
      </PullToRefresh>
    </div>
  );

  // Columns: a bulk bar above the narrow list (the table has its own in its head).
  const columnsBulk = columns && bulkBar ? <div className="sticky top-0 z-sticky border-b border-line-strong bg-raised">{bulkBar}</div> : null;

  return (
    <FacesContext.Provider value={faces}>
      <Page
        width="workspace"
        header={
          reading && phone ? undefined : (
            <MailHeader
              me={me}
              address={address}
              noAddress={noAddress}
              aliases={aliases}
              box={box}
              chooseBox={chooseBox}
              count={count}
              setFaces={setFaces}
              onCompose={() => setDraft(blankDraft(box || undefined))}
              onHold={setHoldNow}
            />
          )
        }
      >
        <div className="flex min-w-0 flex-col gap-4">
          {!(reading && phone) && banners}

          {/* Where: the folders and the narrowing (desktop), or the search and one folder button (phones). */}
          {!reading &&
            (phone ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <MailSearch value={q} onSearch={search} className="flex-1" />
                  {!q && <FolderMenu folders={folders} folder={folder} narrow={narrow} counts={counts} onFolder={chooseFolder} onNarrow={chooseNarrow} />}
                </div>
                {activeChips.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {activeChips.map((k) => (
                      <FilterChip key={k} onRemove={() => chooseNarrow({ ...narrow, [k]: false } as Narrow)}>
                        {NARROW_LABELS[k]}
                      </FilterChip>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="border-b border-line">
                  <FolderTabs items={tabs} current={folder} onChoose={chooseFolder} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <MailSearch value={q} onSearch={search} className="max-w-[480px] min-w-[240px] flex-1" />
                  <span className="flex-1" />
                  <NarrowSelect narrow={narrow} onChange={chooseNarrow} />
                  <ViewSwitch view={view} onChange={chooseView} />
                </div>
              </div>
            ))}

          {columns ? (
            <div ref={split.ref} className="flex min-h-0 gap-4" style={split.height ? { height: split.height } : undefined}>
              <section aria-label="Messages" className={cx("min-w-0 overflow-y-auto rounded-card border border-line bg-raised", openId ? "w-[360px] shrink-0 xl:w-[400px]" : "flex-1")}>
                {columnsBulk}
                {listCard}
              </section>
              {openId && (
                <section aria-label="Message" className="min-w-0 flex-1 overflow-y-auto rounded-card border border-line bg-raised">
                  {reader}
                </section>
              )}
            </div>
          ) : reading ? (
            <section aria-label="Message" className={cx("min-w-0 bg-raised", phone ? "-mx-4" : "rounded-card border border-line")}>
              {reader}
            </section>
          ) : (
            <section aria-label="Messages" className={cx("min-w-0 rounded-card border border-line bg-raised", phone && "-mx-4 rounded-none border-x-0")}>
              {listCard}
            </section>
          )}

          {!reading && <MailFooter />}
        </div>
      </Page>

      {/* Phones: compose in the corner Mail claims from the Ask button (§9.5). */}
      {phone &&
        !openId &&
        !draft &&
        !noAddress &&
        !pickedRows.length &&
        createPortal(
          <button
            type="button"
            aria-label="New message"
            data-floating
            onClick={() => setDraft(blankDraft(box || undefined))}
            className="ds fixed right-4 z-fab flex size-14 cursor-pointer items-center justify-center rounded-full bg-ink text-ink-inverse shadow-(--elevation-2) hover:bg-primary-hover active:bg-primary-pressed"
            style={{ bottom: "calc(16px + env(safe-area-inset-bottom))" }}
          >
            <Glyph name="compose" size={20} />
          </button>,
          document.body,
        )}

      {bulkFloat}

      {draft && <Compose key={draft.sendId ?? draft.title} draft={draft} addresses={mine} onClose={() => setDraft(null)} onQueue={queueSend} />}

      <OfficeMailNotice show={!!me && me.role !== "owner" && !noAddress} />
    </FacesContext.Provider>
  );
}
