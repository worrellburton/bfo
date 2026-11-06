/**
 * The contract page's signature card. Before a request exists: who signs
 * for each side, with their title and their own email, then one button that
 * builds the agreement with those names printed, confirms what's going out,
 * uploads it, places the fields on its signature block, and sends it.
 * After: how far it has got, with the same actions Signatures has.
 *
 * The Manager's signer comes from the entity's record (its managers,
 * officers or acting trustees), never from whoever is signed in, and the
 * signing link never goes to the sender's own address for someone else:
 * the link is what proves who signed.
 */

import { useState } from "react";
import { Banner, Button, Card, CardSection, Field, Input, Select, Status, TextLink, confirm, format, toast } from "../ui";
import { contractFields, type SigGeometry } from "../entity/msa-document";
import { isOpen, PARTY_LABEL, signApi, STATUS_LABEL, type SignatureRequest } from "./api";
import { usePoll } from "./use-poll";

export type { SigGeometry } from "../entity/msa-document";

/** Someone the record says may sign for the entity, with the email on their BFO account when one matches. */
export type RecordSigner = { name: string; title: string; email: string | null; source?: string };
export type SignerPair = { manager: { name: string; title: string }; client: { name: string; title: string } };

const emailLike = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

const REQUEST_TONE: Record<SignatureRequest["status"], "neutral" | "info" | "positive" | "warning" | "negative"> = {
  draft: "neutral",
  sent: "info",
  partial: "info",
  completed: "positive",
  declined: "negative",
  voided: "neutral",
};

export function ContractSignature({
  request,
  open,
  onClose,
  onChange,
  title,
  assetId,
  contractId,
  managerEntity,
  client,
  signers,
  me,
  build,
  brand,
  blockers,
  note,
  onSent,
}: {
  request: SignatureRequest | null;
  open: boolean;
  onClose: () => void;
  onChange: (r: SignatureRequest | null) => void;
  title: string;
  assetId: string;
  contractId: string;
  /** The Manager's legal name. */
  managerEntity: string;
  client: { name: string };
  /** Who may sign for the Manager, from the record. */
  signers: RecordSigner[];
  /** The person sending: their name and email. */
  me: { name: string | null; email: string | null };
  /** The agreement as it will go out, with these signers' names and titles printed. */
  build: (s: SignerPair) => Promise<{ blob: Blob; pages: number; geometry: SigGeometry }>;
  /** Send under this name, never BFO's (an agreement headed with the entity's legal name). */
  brand?: string | null;
  /** What has to be fixed before it can go out. */
  blockers: string[];
  /** A line about what signing now means (fees already accrued). */
  note?: string | null;
  onSent: (r: SignatureRequest) => void;
}) {
  const first = signers[0] ?? null;
  const [pick, setPick] = useState<string | null>(first?.name ?? null);
  const chosen = signers.find((s) => s.name === pick) ?? null;
  const [aTitle, setATitle] = useState(first?.title ?? "");
  const [aEmail, setAEmail] = useState(first?.email ?? "");
  const [b, setB] = useState({ name: "", title: "", email: "" });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  // Progress arrives as the other side signs.
  usePoll(
    async () => {
      if (request) onChange((await signApi.get(request.id, "unchanged")).request);
    },
    10000,
    isOpen(request?.status),
  );

  const ownAddressForSomeoneElse = !!chosen && same(aEmail, me.email) && !same(chosen.name, me.name);
  const errs = {
    aName: tried && !chosen ? "Choose who signs for the Manager." : undefined,
    aTitle: tried && !aTitle.trim() ? "Add their title." : undefined,
    aEmail:
      tried && !emailLike(aEmail)
        ? `Add ${chosen?.name ?? "their"}’s email.`
        : ownAddressForSomeoneElse
          ? `That’s your own address. Use ${chosen?.name}’s: the link they sign with is what shows who signed.`
          : undefined,
    bName: tried && !b.name.trim() ? "Add the full name of the person signing for the client." : undefined,
    bTitle: tried && !b.title.trim() ? "Add their title: it shows their authority to sign." : undefined,
    bEmail: tried && !emailLike(b.email) ? "Add their email." : same(b.email, aEmail) && b.email ? "Each signer needs their own email." : undefined,
  };

  async function send() {
    setTried(true);
    setError("");
    if (blockers.length || !chosen || Object.values(errs).some(Boolean) || !aTitle.trim() || !emailLike(aEmail) || !b.name.trim() || !b.title.trim() || !emailLike(b.email)) return;
    const pair: SignerPair = { manager: { name: chosen.name, title: aTitle.trim() }, client: { name: b.name.trim(), title: b.title.trim() } };
    setBusy("build");
    let doc: Awaited<ReturnType<typeof build>>;
    try {
      doc = await build(pair);
    } catch {
      setBusy("");
      setError("The agreement couldn’t be drawn. Reload the page and try again.");
      return;
    }
    setBusy("");
    const ok = await confirm({
      title: "Send the agreement for signature?",
      object: { name: title, detail: `${doc.pages} ${doc.pages === 1 ? "page" : "pages"}` },
      details: [`For ${managerEntity}: ${pair.manager.name}, ${pair.manager.title} · ${aEmail.trim()}`, `For ${client.name}: ${pair.client.name}, ${pair.client.title} · ${b.email.trim()}`],
      message: "Each signer gets an email with a private link. Their signature and the date go on the last page; the signed copy goes to both.",
      confirmLabel: "Send for signature",
      tone: "commit",
    });
    if (!ok) return;
    setBusy("send");
    try {
      const created = await signApi.act("create", {
        title,
        assetId,
        contractId,
        brand: brand || undefined,
        parties: [
          { role: "Manager", name: pair.manager.name, email: aEmail.trim() },
          { role: "Client", name: pair.client.name, email: b.email.trim() },
        ],
      });
      await signApi.attach(created.id, doc.blob);
      await signApi.act("update", { id: created.id, fields: contractFields(doc.geometry) });
      const sent = await signApi.act("send", { id: created.id });
      onChange(sent);
      onSent(sent);
      toast({ message: `Sent to ${pair.manager.name} and ${pair.client.name}` });
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn’t send it. Check your connection and try again.");
    } finally {
      setBusy("");
    }
  }

  async function act(action: "remind" | "send-copy" | "download") {
    if (!request) return;
    const tab = action === "download" ? window.open("", "_blank") : null;
    if (tab) tab.opener = null;
    setBusy(action);
    setError("");
    try {
      if (action === "download") {
        const url = await signApi.download(request.id);
        if (tab) tab.location.href = url;
        else window.open(url, "_blank", "noopener");
        return;
      }
      const next = await signApi.act(action, { id: request.id });
      onChange(next);
      toast({ message: action === "remind" ? "Reminder sent" : `Signed copy sent to ${next.parties.map((p) => p.email).join(" and ")}` });
    } catch (err) {
      tab?.close();
      setError(err instanceof Error && err.message ? err.message : "That didn’t work. Try again.");
    } finally {
      setBusy("");
    }
  }

  if (!request) {
    if (!open) return null;
    return (
      <Card title="Send for signature">
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <p className="text-small text-ink-2">Each signer gets an email with a private link. Their names and titles are printed on the agreement.</p>
          {blockers.length > 0 && <Banner tone="warning">Before it can go out, the record needs {blockers.join(", ")}.</Banner>}
          {note && <Banner tone="info">{note}</Banner>}
          <CardSection title={`For ${managerEntity}`}>
            <div className="flex flex-col gap-4">
              {signers.length === 0 ? (
                <Banner tone="warning">No one on record can sign for {managerEntity}. Add its managers on the Owners tab first.</Banner>
              ) : (
                <Field label="Signer" error={errs.aName} hint={chosen?.source ? `${/^The /.test(chosen.source) ? `From ${chosen.source.charAt(0).toLowerCase()}${chosen.source.slice(1)}` : `From ${chosen.source}`}.` : undefined}>
                  <Select
                    label="Signer"
                    value={pick}
                    onChange={(v) => {
                      setPick(v);
                      const s = signers.find((x) => x.name === v);
                      setATitle(s?.title ?? "");
                      setAEmail(s?.email ?? "");
                    }}
                    options={signers.map((s) => ({ value: s.name, label: s.name, hint: s.title }))}
                  />
                </Field>
              )}
              <Field label="Title" error={errs.aTitle}>
                <Input value={aTitle} onChange={(e) => setATitle(e.target.value)} />
              </Field>
              <Field label="Email" error={errs.aEmail} hint={chosen && !chosen.email ? `No BFO account matches ${chosen.name} exactly; type their own address.` : undefined}>
                <Input type="email" value={aEmail} onChange={(e) => setAEmail(e.target.value)} placeholder="name@example.com" autoComplete="off" />
              </Field>
            </div>
          </CardSection>
          <CardSection title={`For ${client.name}`}>
            <div className="flex flex-col gap-4">
              <Field label="Signer" error={errs.bName}>
                <Input value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} placeholder="Full name of the person signing" autoComplete="off" />
              </Field>
              <Field label="Title" error={errs.bTitle}>
                <Input value={b.title} onChange={(e) => setB({ ...b, title: e.target.value })} placeholder="Managing partner" autoComplete="off" />
              </Field>
              <Field label="Email" error={errs.bEmail}>
                <Input type="email" value={b.email} onChange={(e) => setB({ ...b, email: e.target.value })} placeholder="name@example.com" autoComplete="off" />
              </Field>
            </div>
          </CardSection>
          {error && <Banner tone="negative">{error}</Banner>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={onClose} disabled={!!busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              busy={!!busy}
              busyLabel={busy === "build" ? "Preparing…" : "Sending…"}
              disabled={blockers.length > 0 || signers.length === 0}
              disabledReason={blockers.length ? "The record is missing something (above)" : signers.length === 0 ? "No signer on record" : undefined}
            >
              Review and send
            </Button>
          </div>
        </form>
      </Card>
    );
  }

  return (
    <Card
      title="Signatures"
      action={<TextLink to={`/tools/signatures/${request.id}`}>Open in Signatures</TextLink>}
      footer={
        request.status === "sent" || request.status === "partial" ? (
          <Button size="sm" busy={busy === "remind"} busyLabel="Sending…" onClick={() => void act("remind")}>
            Remind
          </Button>
        ) : request.status === "completed" ? (
          <>
            <Button size="sm" busy={busy === "send-copy"} busyLabel="Sending…" onClick={() => void act("send-copy")}>
              Send the copy again
            </Button>
            <Button size="sm" variant="primary" busy={busy === "download"} busyLabel="Opening…" onClick={() => void act("download")}>
              Download signed copy
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <Status tone={REQUEST_TONE[request.status]}>{STATUS_LABEL[request.status]}</Status>
        <ul className="flex flex-col gap-2">
          {request.parties.map((p) => (
            <li key={p.key} className="flex flex-col">
              <span className="text-body text-ink">
                {p.name} <span className="text-ink-2">· {p.role}</span>
              </span>
              <span className="text-small text-ink-2">
                {PARTY_LABEL[p.status]}
                {p.signedAt ? ` ${format.dateTime(p.signedAt)}` : p.viewedAt ? ` ${format.dateTime(p.viewedAt)}` : ""} · {p.email}
              </span>
            </li>
          ))}
        </ul>
        {error && <Banner tone="negative">{error}</Banner>}
      </div>
    </Card>
  );
}
