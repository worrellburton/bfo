import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { MailFolder, MailMessage, MailSummary } from "../mail-client";
import { listRows, type ListState } from "./list-state";
import { blankDraft, forwardDraft, replyDraft, type Draft } from "./drafts";

/** What the keys act on: the list and message showing now, the selection, and the page's actions. */
type Deps = {
  draft: Draft | null;
  open: { id: string; message: MailMessage | null; error: string | null } | null;
  openId: string | null;
  folder: MailFolder;
  picked: Set<string>;
  pickedRows: MailSummary[];
  noAddress: boolean;
  mine: string[];
  box: string;
  toast: { text: string; undo?: () => void } | null;
  listRef: RefObject<ListState | null>;
  select: (id: string) => void;
  closeMessage: () => void;
  move: (m: MailMessage, to: "inbox" | "archive") => Promise<void>;
  bulk: (action: "read" | "unread" | "archive" | "inbox" | "delete", only?: string[]) => Promise<void>;
  remove: (m: MailMessage) => Promise<void>;
  setDraft: Dispatch<SetStateAction<Draft | null>>;
  star: (m: MailSummary, starred: boolean, fromList?: boolean) => Promise<void>;
  pick: (id: string, shift: boolean) => void;
  markUnread: (m: MailMessage) => Promise<void>;
};

export function useMailShortcuts({ draft, open, openId, folder, picked, pickedRows, noAddress, mine, box, toast, listRef, select, closeMessage, move, bulk, remove, setDraft, star, pick, markUnread }: Deps) {
  // ── Keys (Gmail's, listed on "?"): j/k next/previous, o open, e archive, # delete, r/a/f reply/all/forward,
  // s star, x select, U unread, c new, u back to the list, z undo. Never while typing or over a dialog.
  // Bound fresh each render, so every key acts on the list and message showing now.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (draft || document.querySelector('[aria-modal="true"]')) return;
      const all = listRows(listRef.current);
      const openRow = open?.message ?? null;
      const focusedId = (document.activeElement as HTMLElement | null)?.closest?.("[data-mail-row]")?.getAttribute("data-mail-row") ?? null;
      const focused = focusedId ? all.find((m) => m.id === focusedId) ?? null : null;
      const act = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      switch (e.key) {
        case "j":
        case "k": {
          const step = e.key === "j" ? 1 : -1;
          if (openId) {
            const next = all[all.findIndex((m) => m.id === openId) + step];
            if (next) act(() => select(next.id));
            return;
          }
          // In the list: move focus row by row (the visible list: table on desktop, rows on phones).
          const rowsShown = [...document.querySelectorAll<HTMLElement>("[data-mail-row]")].filter((r) => r.offsetParent !== null);
          const at = rowsShown.findIndex((r) => r.getAttribute("data-mail-row") === focusedId);
          const target = rowsShown[at < 0 ? 0 : Math.min(rowsShown.length - 1, Math.max(0, at + step))];
          if (target) act(() => {
            target.focus();
            target.scrollIntoView({ block: "nearest" });
          });
          return;
        }
        case "o":
          if (focused && !openId) act(() => select(focused.id));
          return;
        case "u":
          if (openId) act(() => closeMessage());
          return;
        case "e":
          if (openRow && (openRow.direction === "in" || folder === "active") && openRow.folder !== "archive") act(() => void move(openRow, "archive"));
          // Only where the bulk bar offers Archive: Active, and received mail in In.
          else if (!openId && picked.size && (folder === "active" || (folder === "inbox" && pickedRows.some((m) => m.direction === "in")))) act(() => void bulk("archive"));
          else if (!openId && !picked.size && focused && (folder === "active" || (folder === "inbox" && focused.direction === "in"))) act(() => void bulk("archive", [focused.id]));
          return;
        case "#":
          if (openRow) act(() => void remove(openRow));
          else if (picked.size) act(() => void bulk("delete"));
          else if (focused) act(() => void bulk("delete", [focused.id]));
          return;
        case "r":
        case "a":
        case "f":
          if (!openRow || noAddress) return;
          act(() => setDraft(e.key === "f" ? forwardDraft(openRow) : replyDraft(openRow, e.key === "a" ? "all" : "reply", mine)));
          return;
        case "s":
          if (openRow) act(() => void star(openRow, !openRow.starred, false));
          else if (focused) act(() => void star(focused, !focused.starred));
          return;
        case "x":
          if (focused) act(() => pick(focused.id, false));
          return;
        case "U":
          if (openRow && openRow.direction === "in") act(() => void markUnread(openRow));
          else if (!openId && picked.size) act(() => void bulk("unread"));
          return;
        case "c":
          if (!noAddress) act(() => setDraft(blankDraft(box || undefined)));
          return;
        case "z":
          if (toast?.undo) act(() => toast.undo?.());
          return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
}
