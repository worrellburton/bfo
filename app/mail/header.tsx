import type { Dispatch, SetStateAction } from "react";
import { Button, PageHeader, format, usePhone } from "../ui";
import { isAdmin, type User } from "../auth";
import type { MailCount, MailFaces } from "../mail-client";
import { MailboxPicker } from "./mailbox-picker";

/** "Checked for new mail at 10:02 AM" (today) or "… on Nov 5, 10:02 AM" (§10.7: when it's from, in the header). */
export function checkedLine(at: string | null | undefined, now = new Date()): string | null {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return d.toDateString() === now.toDateString() ? `Checked for new mail at ${format.time(d)}` : `Checked for new mail ${format.dateTime(d)}`;
}

/**
 * The top of Mail (§5.5): the title, then one context line saying whose mail
 * this is (the mailbox menu) and when it was last checked for new mail; New
 * message at the right on desktop (phones have the compose button in the
 * corner).
 */
export function MailHeader({
  me,
  address,
  noAddress,
  aliases,
  box,
  chooseBox,
  count,
  setFaces,
  onCompose,
  onHold,
}: {
  me: User | null;
  address: string;
  noAddress: boolean;
  aliases: string[];
  box: string;
  chooseBox: (next: string) => void;
  count: MailCount | null;
  setFaces: Dispatch<SetStateAction<MailFaces>>;
  onCompose: () => void;
  onHold: (hold: MailCount["hold"]) => void;
}) {
  const phone = usePhone();
  const checked = count?.sync?.failed ? null : checkedLine(count?.sync?.at);
  const context = noAddress ? (
    "You don't have an address yet"
  ) : address ? (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2">
      <MailboxPicker
        address={address}
        aliases={aliases}
        box={box}
        onChoose={chooseBox}
        canAdd={!!me && isAdmin(me)}
        hold={count?.hold ?? null}
        canHold={!!count?.canHold}
        onHold={onHold}
        onFaces={setFaces}
      />
      {checked && (
        <>
          <span aria-hidden="true" className="text-ink-3">
            ·
          </span>
          <span>{checked}</span>
        </>
      )}
    </span>
  ) : undefined;
  return (
    <PageHeader
      title="Mail"
      context={context}
      primary={
        phone ? undefined : (
          <Button variant="primary" disabled={noAddress} disabledReason="Ask an owner or admin for an address" onClick={onCompose}>
            New message
          </Button>
        )
      }
    />
  );
}
