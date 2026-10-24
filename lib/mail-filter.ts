/** Narrows a folder: everything, only unread, only starred, or only mail that is both. Shared by the page and the server. */
export type MailFilter = "all" | "unread" | "starred" | "unread-starred";

/** The filter for a pair of flags, and back. */
export function filterOf(unread: boolean, starred: boolean): MailFilter {
  return unread && starred ? "unread-starred" : unread ? "unread" : starred ? "starred" : "all";
}
export function filterFlags(filter: MailFilter): { unread: boolean; starred: boolean } {
  return { unread: filter === "unread" || filter === "unread-starred", starred: filter === "starred" || filter === "unread-starred" };
}
