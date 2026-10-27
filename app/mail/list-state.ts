import type { MailFilter, MailFolder, MailSummary } from "../mail-client";

/** `pinned`: starred mail, shown above the rest whatever its date; `messages`: the rest, newest first, paged. */
export type ListState = { folder: MailFolder; filter: MailFilter; q: string; to: string; pinned: MailSummary[]; messages: MailSummary[]; hasMore: boolean };

/** Every row a list shows: starred first, then the rest. */
export const listRows = (l: ListState | null): MailSummary[] => (l ? [...l.pinned, ...l.messages] : []);

/** The same change to the starred rows and the rest. */
export const eachRow = (l: ListState, fn: (rows: MailSummary[]) => MailSummary[]): ListState => ({ ...l, pinned: fn(l.pinned), messages: fn(l.messages) });

/** True when `m` comes after `last` in the list's newest-first (time, id) order. */
/** Active's order: latest activity first, then the conversation's key (as the server sorts). */
export function threadSortsAfter(m: MailSummary, last: MailSummary): boolean {
  if (!m.threadAt || !last.threadAt) return sortsAfter(m, last);
  const a = Date.parse(m.threadAt), b = Date.parse(last.threadAt);
  if (a !== b) return a < b;
  return (m.threadKey ?? "") > (last.threadKey ?? "");
}

export function sortsAfter(m: MailSummary, last: MailSummary): boolean {
  const a = Date.parse(m.occurredAt), b = Date.parse(last.occurredAt);
  if (a !== b) return a < b;
  if (m.occurredAt !== last.occurredAt) return m.occurredAt < last.occurredAt;
  return m.id < last.id;
}

