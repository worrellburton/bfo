import type { ReactNode } from "react";
import { cx } from "../ui";
import type { MailSummary } from "../mail-client";
import { Glyph } from "./glyphs";
import { cleanSnippet, fullAddress, fullStamp, listDate } from "./helpers";
import { SelectBox, StarButton } from "./controls";
import { UnverifiedTag, whoOf } from "./list-row";

/**
 * The desktop table (§8.10): who, subject, the first words, files and date in
 * columns, one 40px row per message. Head 32px in caption ink-2, sticky on
 * the card. Unread is a dot in its own gutter and a semibold sender and
 * subject. The pick box shows on hover and focus, and on every row while
 * anything is picked; then the bulk bar (`bulkBar`) takes the head's place,
 * at the head's height, so nothing moves.
 */
export function MailTable({
  rows,
  sent,
  mixed = false,
  mine,
  onOpen,
  onStar,
  picked,
  onPick,
  onPickAll,
  bulkBar,
  trash = false,
}: {
  rows: MailSummary[];
  sent: boolean;
  /** Inbox (conversations): in and out together, so each row says which. */
  mixed?: boolean;
  mine: string[];
  onOpen: (id: string) => void;
  onStar: (m: MailSummary, on: boolean) => void;
  picked: Set<string>;
  onPick: (id: string, shift: boolean) => void;
  onPickAll: () => void;
  /** Shown in the head's place while anything is picked. */
  bulkBar?: ReactNode;
  /** Trash: the date column says when each goes for good. */
  trash?: boolean;
}) {
  const all = rows.length > 0 && rows.every((m) => picked.has(m.id));
  const some = !all && rows.some((m) => picked.has(m.id));
  const picking = picked.size > 0;
  const th = "sticky top-0 z-sticky h-8 border-b border-line-strong bg-raised text-left text-caption font-medium whitespace-nowrap text-ink-2";
  return (
    <table className="w-full table-fixed border-separate border-spacing-0 text-body text-ink">
      <caption className="sr-only">Messages</caption>
      <colgroup>
        <col className="w-[72px]" />
        <col className="w-[24%] xl:w-[220px]" />
        <col className="w-[32%]" />
        <col />
        <col className="w-[36px]" />
        <col className="w-[104px]" />
        <col className="w-[48px]" />
      </colgroup>
      <thead>
        {picking && bulkBar ? (
          <tr>
            <th colSpan={7} className={cx(th, "rounded-t-card p-0")}>
              {bulkBar}
            </th>
          </tr>
        ) : (
          <tr>
            <th scope="col" className={cx(th, "rounded-tl-card pl-5")}>
              <span className="ml-3 inline-flex">
                <SelectBox on={all} mixed={some} onToggle={onPickAll} label={all ? "Unselect all" : "Select all"} className="-my-1" />
              </span>
            </th>
            <th scope="col" className={cx(th, "px-3")}>
              {mixed ? "From or to" : sent ? "To" : "From"}
            </th>
            <th scope="col" className={cx(th, "px-3")}>
              Subject
            </th>
            <th scope="col" className={cx(th, "px-3")}>
              Preview
            </th>
            <th scope="col" className={th}>
              <span className="sr-only">Attachments</span>
            </th>
            <th scope="col" className={cx(th, "px-3 text-right")}>
              {trash ? "Deleted for good" : "Date"}
            </th>
            <th scope="col" className={cx(th, "rounded-tr-card pr-5")}>
              <span className="sr-only">Star</span>
            </th>
          </tr>
        )}
      </thead>
      <tbody>
        {rows.map((m, i) => {
          const unread = !m.read;
          const out = sent || (mixed && m.direction === "out");
          const who = mixed && out ? `To ${whoOf(m, true, mine)}` : whoOf(m, out, mine);
          const on = picked.has(m.id);
          const last = i === rows.length - 1;
          const cell = cx("h-(--row-1) py-2 align-middle", !last && "border-b border-line");
          const preview = cleanSnippet(m.snippet);
          return (
            <tr
              aria-selected={on}
              key={m.id}
              data-mail-row={m.id}
              tabIndex={0}
              onClick={(e) => (picking ? onPick(m.id, e.shiftKey) : onOpen(m.id))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(m.id);
                }
              }}
              className={cx("group/row cursor-pointer", on ? "bg-selected" : "hover:bg-hover")}
            >
              <td className={cx(cell, "pl-5", last && "rounded-bl-card")}>
                <span className="flex items-center gap-1">
                  <span className="flex w-2 shrink-0 justify-center">
                    {unread && <span aria-hidden="true" className="size-2 rounded-full bg-accent" />}
                    {unread && <span className="sr-only">Unread. </span>}
                  </span>
                  <span className={cx(picking || on ? "visible" : "invisible group-hover/row:visible group-focus-within/row:visible")}>
                    <SelectBox on={on} onToggle={(shift) => onPick(m.id, shift)} label={on ? "Unselect" : "Select"} className="-my-1" />
                  </span>
                </span>
              </td>
              <td className={cx(cell, "px-3")} title={out ? m.to.map(fullAddress).join(", ") : fullAddress(m.from)}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className={cx("min-w-0 truncate", unread ? "font-semibold" : "font-normal")}>{who}</span>
                  {!out && m.unverified && <UnverifiedTag />}
                </span>
              </td>
              <td className={cx(cell, "truncate px-3", unread ? "font-semibold" : "font-normal")}>
                {m.subject || "(no subject)"}
                {m.held && <span className="sr-only">, kept for records</span>}
              </td>
              <td className={cx(cell, "truncate px-3 text-ink-2")}>{preview}</td>
              <td className={cx(cell, "text-ink-3")}>
                {m.attachmentCount > 0 && (
                  <span title={`${m.attachmentCount} ${m.attachmentCount === 1 ? "attachment" : "attachments"}`} className="inline-flex">
                    <Glyph name="clip" size={16} />
                    <span className="sr-only">
                      {m.attachmentCount} {m.attachmentCount === 1 ? "attachment" : "attachments"}
                    </span>
                  </span>
                )}
              </td>
              <td className={cx(cell, "px-3 text-right whitespace-nowrap text-small text-ink-2 tabular-nums")}>
                {trash && m.purgeAt ? (
                  <time dateTime={m.purgeAt} title={`Deleted ${fullStamp(m.deletedAt ?? m.purgeAt)}; removed for good ${fullStamp(m.purgeAt)}`}>
                    {m.held ? "Kept" : listDate(m.purgeAt)}
                  </time>
                ) : (
                  <time dateTime={m.occurredAt} title={fullStamp(m.occurredAt)}>
                    {listDate(m.occurredAt)}
                  </time>
                )}
              </td>
              <td className={cx(cell, "pr-3", last && "rounded-br-card")}>
                <StarButton on={m.starred} onToggle={(next) => onStar(m, next)} reveal className="-my-1" />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
