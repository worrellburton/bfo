/**
 * Dissolving the entity: each step with what to do, a link to where it's
 * done, what BFO drafts for it, and the date it was marked done. A company
 * that owns others transfers each interest first; once the steps are done
 * (its books closed among them), it's marked Dissolved.
 */

import { useState } from "react";
import { isAdmin, isPartner } from "../auth";
import { closingSteps, stepsLeft } from "../entity-closing";
import { Button, Card, Checkbox, Status, TextLink, cx, format } from "../ui";
import { useEntity } from "./context";

export function ClosingCard() {
  const { page, asset } = useEntity();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const closing = asset.closing;
  if (!closing || isPartner()) return null;
  const admin = isAdmin();
  const input = { ...asset, owned: page.ownedNow(), ownerName: asset.ownerId ? page.assetNames[asset.ownerId] : null };
  const steps = closingSteps(input);
  const done = closing.steps ?? {};
  const left = stepsLeft({ ...input, closing });
  const count = steps.filter((s) => !s.optional).length;
  const finished = !!closing.closedAt;
  const stateDone = steps.some((s) => s.key.startsWith("state:") && done[s.key]);
  const date = (iso: string) => format.date(iso, "medium");

  async function run(key: string, fn: () => Promise<string | null | void>) {
    setBusy(key);
    setErrors((e) => ({ ...e, [key]: "" }));
    try {
      const why = await fn();
      if (why) setErrors((e) => ({ ...e, [key]: why }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      title={finished ? "Dissolved" : "Dissolving it"}
      info={`Started ${date(closing.startedAt)}. Palm can't file a dissolution, so the state filing is made on the state's own site, linked below. Check each step off as it's done.`}
      action={
        finished ? (
          <Status tone="neutral">Dissolved {date(closing.closedAt ?? "")}</Status>
        ) : admin ? (
          <Button variant="quiet" size="sm" onClick={() => void page.cancelClosing()}>
            Stop
          </Button>
        ) : undefined
      }
      footer={
        !finished && admin ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <p className="text-small text-ink-2">{left.length ? `${count - left.length} of ${count} done` : "Every step is done."}</p>
            <Button variant={left.length ? "secondary" : "primary"} onClick={() => void page.finishClosing()}>
              Mark dissolved
            </Button>
          </div>
        ) : undefined
      }
      flush
    >
      <ol>
        {steps.map((s, i) => {
          const at = done[s.key];
          const err = errors[s.key];
          return (
            <li key={s.key} className={cx("flex gap-3 px-5 py-4 touch:px-4", i > 0 && "border-t border-line")}>
              <div className="pt-[2px]">
                <Checkbox
                  checked={!!at}
                  disabled={!admin || finished}
                  label={<span className="sr-only">{at ? `Mark “${s.title}” not done` : `Mark “${s.title}” done`}</span>}
                  onChange={(v) => void page.markClosingStep(s.key, v)}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className={cx("text-body font-medium", at ? "text-ink-2" : "text-ink")}>
                    {s.title}
                    {s.optional && <span className="ml-2 text-small font-normal text-ink-3">Nothing to file</span>}
                  </p>
                  {at && <span className="text-small text-ink-2">Done {date(at)}</span>}
                </div>
                {!at && (
                  <>
                    <p className="mt-1 max-w-[68ch] text-small text-pretty text-ink-2">{s.how}</p>
                    {s.note && (
                      <p className="mt-1 flex max-w-[68ch] items-start gap-2 text-small text-pretty text-ink">
                        <span aria-hidden="true" className="mt-[5px] size-2 shrink-0 rounded-full bg-warning" />
                        {s.note}
                      </p>
                    )}
                    {(s.generate || (s.palmEnd && admin) || s.link) && (
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                        {s.generate && (
                          <Button size="sm" icon="sparkle" busy={busy === s.key} busyLabel="Drafting…" disabled={!!busy} onClick={() => void run(s.key, () => page.generateClosingDoc(s.generate!))}>
                            {s.generate === "consent" ? "Draft the consent" : "Draft the IRS letter"}
                          </Button>
                        )}
                        {s.palmEnd && admin && (
                          <Button size="sm" busy={busy === s.key} busyLabel="Asking Palm…" disabled={!!busy || !stateDone} disabledReason={stateDone ? undefined : "After the state filing is done"} onClick={() => void run(s.key, () => page.endPalmAgent())}>
                            End Palm’s service
                          </Button>
                        )}
                        {s.link && (
                          <TextLink to={s.link.url} className="text-small">
                            {s.link.label}
                          </TextLink>
                        )}
                      </div>
                    )}
                    {s.palmEnd && admin && !stateDone && <p className="mt-1 text-small text-ink-2">After the state filing is done.</p>}
                    {err && <p className="mt-2 text-small text-negative">{err}</p>}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
