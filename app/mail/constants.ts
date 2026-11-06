import type { MailFilter, MailFolder } from "../mail-client";

/**
 * Mail's folders, as one name each everywhere (the tabs, the phone's folder
 * sheet, the empty states). "Inbox" is the conversation view (received and
 * sent together, by latest activity); "Received" is every message that came
 * in, one row each.
 */
export const FOLDERS: { key: MailFolder; label: string }[] = [
  { key: "active", label: "Inbox" },
  { key: "inbox", label: "Received" },
  { key: "sent", label: "Sent" },
  { key: "archive", label: "Archive" },
  { key: "trash", label: "Trash" },
  { key: "other", label: "Other addresses" },
];

export const folderLabel = (f: MailFolder) => FOLDERS.find((x) => x.key === f)?.label ?? "Mail";

/** What each folder holds when it's empty, and who can see it (§8.13). */
export const EMPTY: Record<MailFolder, { title: string; body: string }> = {
  active: { title: "No conversations yet", body: "Mail you receive and send shows here, one row per conversation. Only you can see your mailbox." },
  inbox: { title: "Nothing received yet", body: "Every message sent to your address shows here, newest first." },
  sent: { title: "Nothing sent yet", body: "Messages you send show here." },
  archive: { title: "Nothing archived", body: "Archived mail is kept here, out of your inbox. A reply to it brings the conversation back." },
  trash: { title: "Trash is empty", body: "Deleted mail stays here for 30 days, then it's removed for good with its attachments." },
  other: { title: "No mail to other addresses", body: "Mail sent to an address no one has lands here. Owners and admins can see it." },
};

/** Table: one row per message, every field in its own column. Columns: the list beside the open message. */
export type View = "table" | "columns";
export const VIEW_KEY = "bfo-mail-view";

export function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "columns" ? "columns" : "table";
  } catch {
    return "table";
  }
}

/** The list's narrowing: any mix of unread, starred and with attachments. */
export type Narrow = { unread: boolean; starred: boolean; attachments: boolean };
export type NarrowKey = keyof Narrow;

export const NARROW_LABELS: Record<NarrowKey, string> = { unread: "Unread", starred: "Starred", attachments: "With attachments" };

/** The server's filter word for unread and starred. */
export function filterFor(n: Pick<Narrow, "unread" | "starred">): MailFilter {
  return n.unread && n.starred ? "unread-starred" : n.unread ? "unread" : n.starred ? "starred" : "all";
}

export function narrowOf(filter: MailFilter, attachments: boolean): Narrow {
  return { unread: filter === "unread" || filter === "unread-starred", starred: filter === "starred" || filter === "unread-starred", attachments };
}

/** "unread and starred mail" for a filtered-to-nothing line. */
export function narrowWords(n: Narrow): string {
  const parts = [n.unread && "unread", n.starred && "starred"].filter(Boolean) as string[];
  const base = parts.length ? `${parts.join(" and ")} mail` : "mail";
  return n.attachments ? `${base} with attachments` : base;
}

/** Turning the keys off: a per-device setting (WCAG 2.1.4), honoured by useMailShortcuts. */
export const SHORTCUTS_KEY = "bfo-shortcuts";
export function shortcutsOn(): boolean {
  try {
    return localStorage.getItem(SHORTCUTS_KEY) !== "off";
  } catch {
    return true;
  }
}
