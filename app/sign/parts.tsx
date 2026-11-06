// Pieces the Signatures pages share (Tools › Signatures, a request's page,
// and the MSA panel in app/sign/contract-signature.tsx): the status of a
// request and of a party, the small button the MSA panel still uses, and the
// dialogs that void, archive and delete. All on the design system's tokens.
import { useState, type ReactNode } from "react";
import { Button, Checkbox, Dialog, Field, Status, Textarea, confirm, format, type ButtonProps, type Tone } from "../ui";
import { PARTY_LABEL, STATUS_LABEL, capacity, isOpen, when, type PartyStatus, type RequestStatus, type SignatureRequest } from "./api";

const TONE: Record<RequestStatus, Tone> = { draft: "neutral", sent: "warning", partial: "warning", completed: "positive", declined: "negative", voided: "neutral" };
const PARTY_TONE: Record<PartyStatus, Tone> = { pending: "neutral", sent: "warning", viewed: "warning", signed: "positive", declined: "negative" };

/** The theme flag callers written before the tokens still pass; ignored, the tokens follow the theme. */
type LegacyTheme = Partial<Record<"isDark", boolean>>;

/** A request's status: a dot and a word (§8.7). */
export function StatusChip({ status }: { status: RequestStatus } & LegacyTheme) {
  return <Status tone={TONE[status]}>{STATUS_LABEL[status]}</Status>;
}

/** A party's status as a dot only, beside their name (the word goes next to it). */
export function PartyDot({ status }: { status: PartyStatus }) {
  const colour = { neutral: "bg-ink-3", warning: "bg-warning", positive: "bg-positive", negative: "bg-negative", info: "bg-info" }[PARTY_TONE[status]];
  return <span aria-hidden className={`inline-block size-2 shrink-0 rounded-full ${colour}`} />;
}

/** A party's status as words, with its dot. */
export function PartyStatusText({ status }: { status: PartyStatus }) {
  return <Status tone={PARTY_TONE[status]}>{PARTY_LABEL[status]}</Status>;
}

/** The old small button, now the system's `sm` Button: primary, a quiet danger, or secondary. */
export function Small({ primary, danger, className, ...props }: Omit<ButtonProps, "variant" | "size"> & LegacyTheme & { primary?: boolean; danger?: boolean }) {
  const { isDark: _ignored, ...rest } = props as typeof props & LegacyTheme;
  return (
    <Button {...rest} size="sm" variant={primary ? "primary" : danger ? "quiet" : "secondary"} className={[danger ? "text-negative" : "", "aria-pressed:bg-selected", className ?? ""].join(" ")} />
  );
}

/** "Partly signed · sent Nov 2, 2026", what tells one request from another with the same title. */
export function requestDetail(r: SignatureRequest): string {
  const bits: string[] = [STATUS_LABEL[r.status]];
  if (r.sent_at) bits.push(`sent ${when(r.sent_at)}`);
  else bits.push(`created ${when(r.created_at)}`);
  if (r.completed_at) bits.push(`completed ${when(r.completed_at)}`);
  return bits.join(" · ");
}

/** The parties who have signed, by name. */
const signers = (r: SignatureRequest) => r.parties.filter((p) => p.status === "signed");

/**
 * Void: the links stop working. A reason is required and kept; the parties
 * can be told (on by default once anyone has signed or opened it); a
 * signature already given is said to be cancelled.
 */
export function VoidDialog({ request: r, open, onClose, onVoid }: { request: SignatureRequest; open: boolean; onClose: () => void; onVoid: (reason: string, notify: boolean) => Promise<void> }) {
  const engaged = r.parties.some((p) => p.status === "signed" || p.status === "viewed");
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(engaged);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signed = signers(r);
  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title="Void this request?"
      size="sm"
      dirty={!!reason.trim()}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            Keep request
          </Button>
          <Button
            variant="danger"
            disabled={!reason.trim()}
            disabledReason={!reason.trim() ? "Add a reason to continue" : undefined}
            busy={busy}
            busyLabel="Voiding…"
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onVoid(reason.trim(), notify);
              } catch (err) {
                setError(err instanceof Error ? err.message : "That didn’t work. Try again.");
                setBusy(false);
              }
            }}
          >
            Void request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-pretty">
        <div>
          <p className="text-body font-medium break-words text-ink">{r.title}</p>
          <p className="text-small text-ink-2">{requestDetail(r)}</p>
        </div>
        <p className="text-body text-ink-2">
          Its signing links stop working.{" "}
          {signed.length
            ? `${format.list(signed.map((p) => p.name))} ${signed.length === 1 ? "has" : "have"} already signed; voiding cancels ${signed.length === 1 ? "that signature" : "those signatures"} too. `
            : ""}
          This can’t be undone.
        </p>
        <Field label="Reason" hint="Kept with the request and shown in its history.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </Field>
        <Checkbox checked={notify} onChange={setNotify} label="Email the parties that it was withdrawn" hint="Without it, nobody is emailed; their links just stop working." />
        {error && <p className="text-small text-negative">{error}</p>}
      </div>
    </Dialog>
  );
}

/**
 * Archive (owners and admins): the request leaves the list and is kept whole,
 * with who, when and why. A reason is required. It can be restored.
 */
export function ArchiveDialog({ request: r, open, onClose, onArchive }: { request: SignatureRequest; open: boolean; onClose: () => void; onArchive: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title="Archive this request?"
      size="sm"
      dirty={!!reason.trim()}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!reason.trim()}
            disabledReason={!reason.trim() ? "Add a reason to continue" : undefined}
            busy={busy}
            busyLabel="Archiving…"
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onArchive(reason.trim());
              } catch (err) {
                setError(err instanceof Error ? err.message : "That didn’t work. Try again.");
                setBusy(false);
              }
            }}
          >
            Archive request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-pretty">
        <div>
          <p className="text-body font-medium break-words text-ink">{r.title}</p>
          <p className="text-small text-ink-2">{requestDetail(r)}</p>
        </div>
        <p className="text-body text-ink-2">
          It leaves the list and is kept whole: the document{r.signed_path ? ", the signed copy and its certificate" : ""}, and the history.{" "}
          {r.signed_path ? "Its signers can still open their copy. " : ""}You can restore it.
        </p>
        <Field label="Reason" hint="Kept with the request.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </Field>
        {error && <p className="text-small text-negative">{error}</p>}
      </div>
    </Dialog>
  );
}

/** Delete a draft that never went out (the only kind the server deletes). */
export async function confirmDeleteDraft(r: SignatureRequest): Promise<boolean> {
  const ok = await confirm({
    title: "Delete this draft?",
    object: { name: r.title, detail: `Draft · created ${when(r.created_at)} · never sent` },
    message: "The draft and the document uploaded for it are removed.",
    irreversible: true,
    confirmLabel: "Delete draft",
    tone: "danger",
  });
  return ok !== false;
}

/** Email the signed copy: sent outside the office, so it says to whom. */
export async function confirmSendCopy(r: SignatureRequest): Promise<boolean> {
  const ok = await confirm({
    title: r.copy_sent_at ? "Email the signed copy again?" : "Email the signed copy?",
    object: { name: r.title, detail: requestDetail(r) },
    details: r.parties.map((p) => `${capacity(p)} · ${p.email}`),
    message: r.copy_sent_at ? `It went out on ${when(r.copy_sent_at)}. Each party gets a fresh link; the old ones stop working.` : "Each party gets a link to the signed copy and its certificate.",
    confirmLabel: "Email signed copy",
    tone: "commit",
  });
  return ok !== false;
}

/** A label and a value in the rail's small print. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-[2px]">
      <dt className="text-caption text-ink-2">{label}</dt>
      <dd className="text-small break-words text-ink">{children}</dd>
    </div>
  );
}

/** Still out for signature. */
export { isOpen };
