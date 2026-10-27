import type { MailFilter, MailFolder } from "../mail-client";

export const FOLDERS: { key: MailFolder; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "inbox", label: "In" },
  { key: "sent", label: "Out" },
  { key: "archive", label: "Archive" },
  { key: "other", label: "Other" },
];

export const EMPTY: Record<MailFolder, string> = {
  active: "No conversations yet.",
  inbox: "No mail yet.",
  sent: "Nothing sent yet.",
  archive: "Nothing archived.",
  other: "Nothing here.",
};

/** Table: one row per message, every field in its own column. Columns: the list beside the open message. */
export type View = "table" | "columns";
export const VIEW_KEY = "bfo-mail-view";

/**
 * How long each loader stays once shown, so its scene plays to the end rather
 * than being cut off by a quick answer: the list's constellation assembling,
 * a search's sweep, the envelope opening (its one-shot animation is 1.5 s).
 * A cached message skips the envelope altogether.
 */
export const LIST_LOADER_MS = 1300;
export const SEARCH_LOADER_MS = 1000;
/** The envelope: the message is revealed as the letter comes toward you (its animation is 1.5 s; the reveal starts at 1.25 s). */
export const ENVELOPE_MS = 1250;
/** The loader's fade before the rows take its place. */
export const LOADER_OUT_MS = 240;
export const holdFor = (shownAt: number, min: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, min - (performance.now() - shownAt))));
export const MAIL_THEME_KEY = "bfo-mail-theme";

export function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "columns" ? "columns" : "table";
  } catch {
    return "table";
  }
}

export const FILTERS: { key: MailFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "starred", label: "Starred" },
  { key: "unread-starred", label: "Unread ★" },
];

export const NOTHING: Record<MailFilter, string> = { all: "", unread: "Nothing unread.", starred: "Nothing starred.", "unread-starred": "Nothing both unread and starred." };

