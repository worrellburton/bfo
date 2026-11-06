import { useEffect, useState } from "react";
import { Button, Dialog, TextLink } from "../ui";
import { ackNotice, getNotice } from "../mail-client";

const SNOOZE_KEY = "bfo-mail-notice-later";

/**
 * The one-time notice that a mailbox here is the office's (§11.4, the
 * acknowledgement sheet): what's kept, who can see what, who processes it,
 * how deleting works. Shown on opening Mail to everyone but an owner until
 * they choose Continue, which the server records with the notice's version
 * and the time. "Not now" asks again next visit.
 */
export function OfficeMailNotice({ show }: { show: boolean }) {
  const [version, setVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!show) return;
    try {
      if (sessionStorage.getItem(SNOOZE_KEY) === "1") return;
    } catch {
      // Asked this visit, then.
    }
    let alive = true;
    getNotice()
      .then((n) => {
        if (!alive || n.acknowledgedAt) return;
        try {
          if (localStorage.getItem(`bfo-mail-notice:${n.version}`) && !n.recordable) return;
        } catch {
          // Not remembered here: ask.
        }
        setVersion(n.version);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [show]);

  const later = () => {
    try {
      sessionStorage.setItem(SNOOZE_KEY, "1");
    } catch {
      // Then it may ask again on the next page load.
    }
    setVersion(null);
  };
  async function agree() {
    if (!version) return;
    setBusy(true);
    try {
      await ackNotice(version);
      try {
        localStorage.setItem(`bfo-mail-notice:${version}`, new Date().toISOString());
      } catch {
        // The server has it.
      }
      setVersion(null);
    } catch {
      later();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={!!version}
      onClose={later}
      title="About office mail"
      size="md"
      footer={
        <>
          <Button onClick={later}>Not now</Button>
          <Button variant="primary" busy={busy} busyLabel="Saving…" onClick={() => void agree()}>
            Continue
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-2 text-body text-pretty text-ink">
        {[
          "This mailbox belongs to the office. Mail you send and receive here is kept as part of the office's records, and the office may review it.",
          "Owners and admins see mail sent to addresses no one has (Other addresses). Your own mailbox isn't shown to anyone else in BFO.",
          "Mail is received and sent through Bird, the office's email provider. If you use Ask BFO or Tidy layout, the words involved go to Anthropic.",
          "Delete moves mail to Trash for 30 days, then removes it for good. Mail kept for records isn't deleted. Each deletion is recorded.",
        ].map((t) => (
          <li key={t} className="flex gap-2">
            <span aria-hidden="true" className="mt-[9px] size-1 shrink-0 rounded-full bg-ink-3" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-small text-ink-2">
        <TextLink to="/legal/privacy#mail" inline>
          How mail is handled
        </TextLink>{" "}
        has the full details. Choosing Continue records that you've read this, and when.
      </p>
    </Dialog>
  );
}
