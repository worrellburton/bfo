import { useContext, useState } from "react";
import { Button, Dialog, Field, Icon, Input, Menu, confirm, format, type MenuItem } from "../ui";
import { addAlias, holdAllMail, notifyMailChanged, removeAlias, type MailCount, type MailFaces } from "../mail-client";
import { FacesContext } from "./avatar";
import { usePhotoPicker } from "./my-photo";
import { notify } from "./use-mail-actions";

/**
 * The header's one control for whose mail is shown and for the addresses on
 * the account (§8.19 Menu: anchored on desktop, a sheet on touch). With one
 * address it reads as that address and offers Copy (and, for owners and
 * admins, Add); with several it chooses "All mailboxes" or one. Owners also
 * put all mail on hold for records here, or lift the hold.
 */
export function MailboxPicker({
  address,
  aliases,
  box,
  onChoose,
  canAdd,
  hold,
  canHold,
  onHold,
  onFaces,
}: {
  address: string;
  aliases: string[];
  box: string;
  onChoose: (next: string) => void;
  canAdd: boolean;
  hold: MailCount["hold"];
  canHold: boolean;
  onHold: (next: MailCount["hold"]) => void;
  /** My picture changed: everyone's pictures, as the server now has them. */
  onFaces: (faces: MailFaces) => void;
}) {
  const domain = address.slice(address.indexOf("@") + 1);
  // The server's answer to an add or remove shows at once; the shared count catches up after.
  const [shown, setShown] = useState<string[] | null>(null);
  const list = shown ?? aliases;
  const mine = [address, ...list];
  const current = mine.find((m) => m.toLowerCase() === box) ?? null;
  const label = mine.length === 1 ? address : (current ?? "All mailboxes");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [holding, setHolding] = useState(false);
  const hasPhoto = !!useContext(FacesContext)[address.toLowerCase()];
  const failed = (message: string) => void confirm({ title: "That didn't work", message, confirmLabel: "Close", acknowledge: true });
  const photo = usePhotoPicker((faces) => {
    onFaces(faces);
    notify("Your picture for mail is saved");
  }, failed);

  async function copy(a: string) {
    try {
      await navigator.clipboard.writeText(a);
      notify(`Copied ${a}`);
    } catch {
      // The clipboard refused; the address is on screen.
    }
  }

  async function liftHold() {
    const ok = await confirm({
      title: "Lift the hold on mail?",
      message: "Delete works again, and messages in Trash for more than 30 days are removed for good at the next clean-up. Lifting it is recorded.",
      confirmLabel: "Lift hold",
      tone: "commit",
    });
    if (!ok) return;
    try {
      const r = await holdAllMail(false);
      onHold(r.hold ?? null);
      notify("The hold on mail is lifted");
    } catch (e) {
      failed((e as Error).message);
    }
  }

  const items: MenuItem[] = [];
  if (mine.length > 1) {
    items.push({ group: "Show mail for" });
    items.push({ label: "All mailboxes", checked: !current, onSelect: () => onChoose("") });
    for (const m of mine) items.push({ label: m, checked: current?.toLowerCase() === m.toLowerCase(), onSelect: () => onChoose(m.toLowerCase()) });
    items.push({ divider: true });
  } else {
    items.push({ group: "Your address" });
  }
  items.push({ label: mine.length > 1 ? `Copy ${current ?? address}` : "Copy address", onSelect: () => void copy(current ?? address) });
  items.push({ label: hasPhoto ? "Change your picture…" : "Choose your picture…", hint: "Shown with your mail here", onSelect: photo.choose });
  if (hasPhoto) items.push({ label: "Use your initials instead", onSelect: photo.remove });
  if (canAdd) {
    items.push({ label: "Add an address…", onSelect: () => setAdding(true) });
    if (list.length) items.push({ label: "Remove an address…", onSelect: () => setRemoving(true) });
  }
  if (canHold) {
    items.push({ divider: true });
    items.push(hold ? { label: "Lift the hold on mail…", onSelect: () => void liftHold() } : { label: "Put all mail on hold…", onSelect: () => setHolding(true) });
  }

  return (
    <>
      {photo.input}
      <Menu
        label="Mailbox"
        items={items}
        trigger={
          <button
            type="button"
            aria-label={`Mailbox: ${label}`}
            className="-mx-1 inline-flex max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-control px-1 text-body text-ink-2 hover:text-ink touch:min-h-[44px]"
          >
            <span className="truncate">{label}</span>
            <Icon name="chevronDown" size={16} className="text-ink-3" />
          </button>
        }
      />
      <AddAddress
        open={adding}
        domain={domain}
        onClose={() => setAdding(false)}
        onAdded={(next) => {
          setShown(next);
          notifyMailChanged();
        }}
      />
      <RemoveAddress
        open={removing}
        extras={list}
        onClose={() => setRemoving(false)}
        onRemoved={(next, a) => {
          setShown(next);
          if (box === a.toLowerCase()) onChoose("");
          notifyMailChanged();
        }}
      />
      <HoldAll open={holding} onClose={() => setHolding(false)} onHeld={onHold} />
    </>
  );
}

/** One more address on my account: "accounting" or the whole address. The server checks it's on the domain and free. */
function AddAddress({ open, domain, onClose, onAdded }: { open: boolean; domain: string; onClose: () => void; onAdded: (aliases: string[]) => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  async function add() {
    const local = value.trim();
    if (!local || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const { aliases } = await addAlias(local);
      onAdded(aliases);
      notify(`Added ${local.includes("@") ? local : `${local}@${domain}`}`);
      setValue("");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add an address"
      description="Mail to it arrives in your mailbox, and you can send from it. Adding it is recorded."
      size="sm"
      dirty={!!value.trim()}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} busyLabel="Adding…" disabled={!value.trim()} disabledReason="Type the address first" onClick={() => void add()}>
            Add address
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Field label="Address" error={error}>
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="accounting" suffix={`@${domain}`} autoCapitalize="none" autoComplete="off" spellCheck={false} />
        </Field>
      </form>
    </Dialog>
  );
}

/** The extra addresses, each with Remove; removing one says where its mail goes after. */
function RemoveAddress({ open, extras, onClose, onRemoved }: { open: boolean; extras: string[]; onClose: () => void; onRemoved: (aliases: string[], removed: string) => void }) {
  const [error, setError] = useState<string | undefined>();
  async function remove(a: string) {
    const ok = await confirm({
      title: `Remove ${a}?`,
      message: "New mail to it will go to Unclaimed, where owners and admins can see it. Mail already received stays in your mailbox. Removing it is recorded.",
      confirmLabel: "Remove address",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const { aliases } = await removeAlias(a);
      onRemoved(aliases, a);
      notify(`Removed ${a}`);
      if (!aliases.length) onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Remove an address" size="sm" footer={<Button onClick={onClose}>Done</Button>}>
      <ul className="flex flex-col">
        {extras.map((a) => (
          <li key={a} className="flex min-h-(--row-1) items-center gap-3 border-b border-line last:border-b-0">
            <span className="min-w-0 flex-1 truncate text-body text-ink">{a}</span>
            <Button variant="quiet" size="sm" className="text-negative enabled:hover:text-negative" onClick={() => void remove(a)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-small text-negative">{error}</p>}
    </Dialog>
  );
}

/** A records hold on all mail (owners): nothing is deleted while it's on. */
function HoldAll({ open, onClose, onHeld }: { open: boolean; onClose: () => void; onHeld: (hold: MailCount["hold"]) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  async function hold() {
    setBusy(true);
    setError(undefined);
    try {
      const r = await holdAllMail(true, reason.trim() || undefined);
      onHeld(r.hold ?? { since: new Date().toISOString(), reason: reason.trim() || null, all: true });
      notify(`All mail is on hold from ${format.date(new Date(), "medium")}`);
      setReason("");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Put all mail on hold?"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} busyLabel="Putting on hold…" onClick={() => void hold()}>
            Put mail on hold
          </Button>
        </>
      }
    >
      <ul className="mb-4 flex flex-col gap-1 text-body text-pretty text-ink-2">
        {[
          "Nothing in any mailbox can be deleted while it's on: Delete archives received mail instead.",
          "Trash stops emptying, so nothing in it is removed for good.",
          "Only an owner can lift it. Turning it on and off is recorded.",
        ].map((t) => (
          <li key={t} className="flex gap-2">
            <span aria-hidden="true" className="mt-[9px] size-1 shrink-0 rounded-full bg-ink-3" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
      <Field label="Reason" optional hint="Kept with the hold, for the record." error={error}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Audit of 2025 returns" maxLength={300} />
      </Field>
    </Dialog>
  );
}
