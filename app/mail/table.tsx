import { useTone } from "../entity/ui";
import { FileKindIcons } from "../file-icon";
import type { MailSummary } from "../mail-client";
import { fullAddress, fullDate, listDate } from "./helpers";
import { SelectBox, StarButton } from "./controls";
import { UnreadDot, whoOf } from "./list-row";

/** The spreadsheet: sender, subject, summary, attachment and time in columns, one line per message. */
export function MailTable({
  rows,
  sent,
  mixed = false,
  me,
  onOpen,
  onStar,
  picked,
  onPick,
  onPickAll,
  className = "",
}: {
  rows: MailSummary[];
  sent: boolean;
  /** Active: in and out together, so each row says which. */
  mixed?: boolean;
  me: string;
  onOpen: (id: string) => void;
  onStar: (m: MailSummary, on: boolean) => void;
  picked: Set<string>;
  onPick: (id: string, shift: boolean) => void;
  onPickAll: () => void;
  className?: string;
}) {
  const all = rows.length > 0 && rows.every((m) => picked.has(m.id));
  const some = !all && rows.some((m) => picked.has(m.id));
  const t = useTone();
  const th = `px-2 pb-2 pt-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] ${t.faint}`;
  return (
    <table className={`w-full table-fixed border-collapse text-[12.5px] ${className}`}>
      <colgroup>
        <col className="w-[76px]" />
        <col className="w-[22%] lg:w-[200px] xl:w-[220px]" />
        <col className="w-[30%]" />
        <col />
        <col className="w-[32px]" />
        <col className="w-[84px]" />
      </colgroup>
      {/* While anything is picked, the action bar above takes the header's place. */}
      <thead className={`sticky top-0 z-[1] ${picked.size ? "hidden" : ""} ${t.dark ? "bg-[#0b0b0f]/95" : "bg-white/95"} backdrop-blur-xl`}>
        <tr className={`border-b ${t.line}`}>
          <th scope="col" className={`${th} py-1 pl-[14px]`}>
            <SelectBox on={all} mixed={some} onToggle={onPickAll} label={all ? "Unselect all" : "Select all"} />
          </th>
          <th scope="col" className={th}>
            {mixed ? "From / To" : sent ? "To" : "From"}
          </th>
          <th scope="col" className={th}>
            Subject
          </th>
          <th scope="col" className={th}>
            Summary
          </th>
          <th scope="col" className={th}>
            <span className="sr-only">Attachments</span>
          </th>
          <th scope="col" className={`${th} pr-4 text-right`}>
            Time
          </th>
        </tr>
      </thead>
      <tbody className={`divide-y ${t.divide}`}>
        {rows.map((m) => {
          const unread = !m.read;
          const out = sent || (mixed && m.direction === "out");
          const who = mixed && out ? `To ${whoOf(m, true, me)}` : whoOf(m, out, me);
          const on = picked.has(m.id);
          return (
            <tr
              aria-selected={on}
              key={m.id}
              data-mail-row={m.id}
              tabIndex={0}
              onClick={() => onOpen(m.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(m.id);
                }
              }}
              className={`group cursor-pointer transition-colors duration-150 ${
                on
                  ? t.dark ? "bg-(--mail-accent-deep)/[0.13] hover:bg-(--mail-accent-deep)/[0.17]" : "bg-(--mail-accent-deep)/10 hover:bg-(--mail-accent-deep)/15"
                  : unread
                    ? t.dark ? "bg-(--mail-accent-deep)/[0.09] hover:bg-(--mail-accent-deep)/[0.14]" : "bg-(--mail-accent-deep)/[0.055] hover:bg-(--mail-accent-deep)/[0.09]"
                    : t.hover
              } focus-visible:outline-none ${t.dark ? "focus-visible:bg-white/[0.05]" : "focus-visible:bg-gray-50"}`}
            >
              {/* Unread: an accent bar down the row's left edge. */}
              <td className={`py-1.5 pl-2 pr-0 align-middle ${unread ? "shadow-[inset_3px_0_0_var(--mail-accent)]" : ""}`}>
                <div className="flex items-center gap-0.5">
                  <UnreadDot on={unread} />
                  <SelectBox on={on} onToggle={(shift) => onPick(m.id, shift)} label={on ? "Unselect" : "Select"} />
                  <StarButton on={m.starred} onToggle={(next) => onStar(m, next)} />
                </div>
              </td>
              <td className={`truncate px-2 py-2.5 align-middle ${unread ? `font-bold ${t.text}` : `font-normal ${t.soft}`}`} title={out ? m.to.map(fullAddress).join(", ") : fullAddress(m.from)}>
                {who}
              </td>
              <td className={`truncate px-2 py-2.5 align-middle ${unread ? `font-semibold ${t.text}` : `font-normal ${t.soft}`}`}>{m.subject || "(no subject)"}</td>
              <td className={`truncate px-2 py-2.5 align-middle ${unread ? t.soft : t.muted}`}>{m.snippet}</td>
              <td className={`px-1 py-2.5 align-middle ${t.muted}`}>
                {m.attachmentCount > 0 && <FileKindIcons kinds={m.attachmentKinds?.length ? m.attachmentKinds : ["file"]} count={m.attachmentCount} className="h-4 w-4" />}
              </td>
              <td className={`whitespace-nowrap py-2.5 pl-2 pr-4 text-right align-middle text-[11.5px] tabular-nums ${unread ? `font-semibold ${t.dark ? "text-(--mail-accent)" : "text-(--mail-accent-ink)"}` : t.muted}`}>
                <time dateTime={m.occurredAt} title={fullDate(m.occurredAt)}>
                  {listDate(m.occurredAt)}
                </time>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
