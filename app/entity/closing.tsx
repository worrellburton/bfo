import { useState } from "react";
import { isAdmin, isPartner } from "../auth";
import { closingSteps, stepsLeft } from "../entity-closing";
import { useEntity } from "./context";
import { fmtDate } from "./model";
import { Button, Dot, ErrorLine, Icon, Section, TextButton, toneText, useTone } from "./ui";

/**
 * Closing the entity down: each step with what to do, a link to where it's
 * done, what BFO drafts for it, and the date it was marked done. Once the
 * steps are done, the entity is marked Dissolved.
 */
export function ClosingCard() {
  const { page, asset } = useEntity();
  const t = useTone();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const closing = asset.closing;
  if (!closing || isPartner()) return null;
  const admin = isAdmin();
  const steps = closingSteps(asset);
  const done = closing.steps ?? {};
  const left = stepsLeft(asset);
  const count = steps.filter((s) => !s.optional).length;
  const finished = !!closing.closedAt;
  const stateDone = steps.some((s) => s.key.startsWith("state:") && done[s.key]);

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
    <Section
      title={finished ? "Dissolved" : "Closing it down"}
      info={`Started ${fmtDate(closing.startedAt)}. Palm can't file a dissolution, so the state filing is done on the state's own site, linked below. Mark each step done as it is.`}
      actions={
        finished ? (
          <Dot tone="muted">Dissolved {fmtDate(closing.closedAt ?? "")}</Dot>
        ) : (
          <span className="flex items-center gap-3">
            <span className={`text-[12px] tabular-nums ${t.muted}`}>
              {count - left.length} of {count} done
            </span>
            {admin && <TextButton onClick={() => void page.cancelClosing()}>Stop</TextButton>}
          </span>
        )
      }
    >
      <ol className={`divide-y ${t.divide}`}>
        {steps.map((s, i) => {
          const at = done[s.key];
          const err = errors[s.key];
          return (
            <li key={s.key} className="flex gap-3 px-5 py-4">
              <button
                type="button"
                disabled={!admin || finished}
                onClick={() => void page.markClosingStep(s.key, !at)}
                aria-label={at ? `Mark "${s.title}" not done` : `Mark "${s.title}" done`}
                aria-pressed={!!at}
                className={`mt-0.5 flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-full border text-[11px] tabular-nums transition-colors disabled:cursor-default ${
                  at
                    ? t.dark ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-300" : "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : t.dark ? "border-white/15 text-gray-400 hover:border-white/40" : "border-gray-300 text-gray-500 hover:border-gray-500"
                }`}
              >
                {at ? <Icon name="check" className="h-3 w-3" strokeWidth={2.5} /> : i + 1}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className={`text-[13.5px] font-medium ${at ? t.soft : t.text}`}>
                    {s.title}
                    {s.optional && <span className={`ml-2 text-[11.5px] font-normal ${t.faint}`}>nothing to file</span>}
                  </p>
                  {at && <span className={`text-[12px] ${toneText("good", t.dark)}`}>Done {fmtDate(at)}</span>}
                </div>
                {!at && (
                  <>
                    <p className={`mt-1 text-[12.5px] leading-relaxed ${t.soft}`}>{s.how}</p>
                    {s.note && <p className={`mt-1 text-[12px] leading-relaxed ${toneText("warn", t.dark)}`}>{s.note}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {s.generate && (
                        <Button icon="sparkle" disabled={!!busy} onClick={() => void run(s.key, () => page.generateClosingDoc(s.generate!))}>
                          {busy === s.key ? "Drafting…" : s.generate === "consent" ? "Draft the consent" : "Draft the IRS letter"}
                        </Button>
                      )}
                      {s.palmEnd && admin && (
                        <Button disabled={!!busy || !stateDone} onClick={() => void run(s.key, () => page.endPalmAgent())} title={stateDone ? undefined : "After the state filing is done"}>
                          {busy === s.key ? "Asking Palm…" : "End Palm's service"}
                        </Button>
                      )}
                      {s.link && (
                        <a href={s.link.url} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 text-[12.5px] font-medium hover:underline ${t.accent}`}>
                          {s.link.label} <Icon name="external" className="h-3 w-3" />
                        </a>
                      )}
                      {admin && !finished && (
                        <TextButton onClick={() => void page.markClosingStep(s.key, true)}>Mark done</TextButton>
                      )}
                    </div>
                    {err && <div className="mt-2"><ErrorLine>{err}</ErrorLine></div>}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {!finished && admin && (
        <div className={`flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 ${t.line}`}>
          <p className={`text-[12.5px] ${t.soft}`}>{left.length ? `${left.length} step${left.length === 1 ? "" : "s"} left.` : "Every step is done."}</p>
          <Button kind={left.length ? "secondary" : "primary"} onClick={() => void page.finishClosing()}>
            Mark dissolved
          </Button>
        </div>
      )}
    </Section>
  );
}
