import { useState } from "react";
import { Button, Checkbox, Count, Icon, Sheet, cx } from "../ui";
import type { MailFolder } from "../mail-client";
import { Glyph, type GlyphName } from "./glyphs";
import { NARROW_LABELS, type Narrow, type NarrowKey } from "./constants";

const FOLDER_GLYPH: Record<MailFolder, GlyphName> = { active: "chats", inbox: "inbox", sent: "send", archive: "archive", trash: "trash", other: "at" };

/**
 * Phones: one button beside the search names the folder (and how many
 * filters are on); it opens a sheet. Choosing a folder applies it and closes
 * the sheet; the filters apply as they're switched. Every folder is listed,
 * Other addresses included for those who may see it.
 */
export function FolderMenu({
  folders,
  folder,
  narrow,
  counts,
  onFolder,
  onNarrow,
}: {
  folders: { key: MailFolder; label: string }[];
  folder: MailFolder;
  narrow: Narrow;
  /** Unread, where it lives: Inbox's conversations, Other's messages. */
  counts: Partial<Record<MailFolder, number>>;
  onFolder: (f: MailFolder) => void;
  onNarrow: (n: Narrow) => void;
}) {
  const [open, setOpen] = useState(false);
  const cur = folders.find((x) => x.key === folder) ?? folders[0];
  const on = (Object.keys(NARROW_LABELS) as NarrowKey[]).filter((k) => narrow[k]);
  return (
    <>
      <Button
        aria-label={`${cur.label}${on.length ? `, ${on.map((k) => NARROW_LABELS[k].toLowerCase()).join(" and ")}` : ""}. Change folder or filters`}
        onClick={() => setOpen(true)}
        className="max-w-[45%] shrink-0 gap-1"
      >
        <span className="truncate">{cur.label}</span>
        {on.length > 0 && <Count n={on.length} />}
        <Icon name="chevronDown" className="text-ink-3" />
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Folder and filters">
        <ul aria-label="Folders">
          {folders.map((x) => {
            const chosen = x.key === folder;
            return (
              <li key={x.key}>
                <button
                  type="button"
                  aria-current={chosen ? "page" : undefined}
                  onClick={() => {
                    setOpen(false);
                    if (!chosen) onFolder(x.key);
                  }}
                  className={cx("flex min-h-[52px] w-full cursor-pointer items-center gap-3 rounded-control px-2 text-left text-body hover:bg-hover", chosen ? "font-medium text-ink" : "text-ink")}
                >
                  <span className="text-ink-2">
                    <Glyph name={FOLDER_GLYPH[x.key]} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{x.label}</span>
                  {counts[x.key] ? <Count n={counts[x.key]!} label={`${counts[x.key]} unread`} /> : null}
                  {chosen && <Icon name="check" className="text-accent" />}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 border-t border-line pt-4">
          <p className="mb-1 text-small font-medium text-ink-2">Show only</p>
          {(Object.keys(NARROW_LABELS) as NarrowKey[]).map((k) => (
            <Checkbox key={k} checked={narrow[k]} onChange={(v) => onNarrow({ ...narrow, [k]: v })} label={NARROW_LABELS[k]} />
          ))}
          {on.length > 0 && (
            <Button variant="quiet" className="mt-2" onClick={() => onNarrow({ unread: false, starred: false, attachments: false })}>
              Clear filters
            </Button>
          )}
        </div>
      </Sheet>
    </>
  );
}
