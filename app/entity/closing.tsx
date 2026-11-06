import { useEffect, useState } from "react";
import { Link } from "react-router";
import { authFetch, isAdmin, isPartner } from "../auth";
import { closingBlockers, closingHints, closingSteps, stateFilingFacts, stepsLeft, type LinkedAccount } from "../entity-closing";
import { useEntity } from "./context";
import { fmtDate } from "./model";
import { Button, Dot, ErrorLine, Icon, Section, TextButton, toneText, useTone } from "./ui";

/**
 * Closing the entity down as a checklist, top to bottom. Each step is one
 * tap to mark done; the next one is lit; what BFO can draft (the consent,
 * the IRS letter) or do (end Palm's service) sits on the step; what BFO can
 * already see (the state's record, the linked accounts, what it still owns)
 * is said on the step rather than left to be remembered. Once the steps are
 * done, the entity is marked Dissolved.
 */
export function ClosingCard() {
  const { page, asset } = useEntity();
  const t = useTone();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [drafted, setDrafted] = useState<Record<string, true>>({});
  const [accounts, setAccounts] = useState<LinkedAccount[] | null>(null);
  const [showDone, setShowDone] = useState(false);
  const closing = asset.closing;
  const admin = isAdmin();

  // The linked accounts, once: the bank step says what they hold.
  useEffect(() => {
    if (!closing || closing.closedAt || isPartner()) return;
    let on = true;
    authFetch("/api/plaid/data?report=treasury")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { accounts?: LinkedAccount[] } | null) => on && setAccounts(d?.accounts ?? []))
      .catch(() => on && setAccounts([]));
    return () => {
      on = false;
    };
  }, [closing?.startedAt, closing?.closedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!closing || isPartner()) return null;
  const steps = closingSteps(asset);
  const done = closing.steps ?? {};
  const left = stepsLeft(asset);
  const required = steps.filter((s) => !s.optional);
  const finished = !!closing.closedAt;
  const stateDone = steps.some((s) => s.key.startsWith("state:") && done[s.key]);
  const next = steps.find((s) => !done[s.key] && !s.optional);
  const hints = closingHints({ ...asset, id: page.id }, accounts);
  const blockers = closingBlockers({ ...asset, id: page.id }, page.allAssets as Record<string, { name?: string; ownerId?: string; status?: string }>, accounts);
  const facts = stateFilingFacts(asset);
  const doneCount = required.length - left.length;
  const pct = required.length ? Math.round((doneCount / required.length) * 100) : 0;
  const doneSteps = steps.filter((s) => done[s.key]);

  async function run(key: string, fn: () => Promise<string | null | void>) {
    setBusy(key);
    setErrors((e) => ({ ...e, [key]: "" }));
    try {
      const why = await fn();
      if (why) setErrors((e) => ({ ...e, [key]: why }));
      else setDrafted((d) => ({ ...d, [key]: true }));
    } finally {
      setBusy(null);
    }
  }

  const checkClass = (at: boolean, lit: boolean) =>
    `flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full border text-[11.5px] font-medium tabular-nums transition-colors max-sm:h-[44px] max-sm:w-[44px] ${
      at
        ? t.dark
          ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-300"
          : "border-emerald-300 bg-emerald-50 text-emerald-700"
        : lit
          ? t.dark
            ? "border-white/60 text-white"
            : "border-gray-900 text-gray-900"
          : t.dark
            ? "border-white/15 text-gray-400"
            : "border-gray-300 text-gray-500"
    }`;

  return (
    <Section
      id="closing"
      className="scroll-mt-[calc(3.5rem+env(safe-area-inset-top)+80px)] lg:scroll-mt-20"
      title={finished ? "Dissolved" : "Closing it down"}
      info="Work down the list. Tap a step to mark it done, or undo it. BFO drafts the papers it can and does what it can from here; the state filing is done on the state's own site, linked from its step. Nothing is filed until you do it."
      actions={
        finished ? (
          <Dot tone="muted">Dissolved {fmtDate(closing.closedAt ?? "")}</Dot>
        ) : (
          <span className="flex items-center gap-3">
            <span className={`text-[12px] tabular-nums ${t.muted}`}>
              {doneCount} of {required.length} done
            </span>
            {admin && <TextButton onClick={() => void page.cancelClosing()}>Stop</TextButton>}
          </span>
        )
      }
    >
      {!finished && (
        <div className={`h-1 w-full ${t.dark ? "bg-white/[0.06]" : "bg-gray-100"}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Closing progress">
          <div className={`h-full transition-[width] duration-300 ${t.dark ? "bg-emerald-400/70" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
        </div>
      )}

      {!finished && blockers.length > 0 && (
        <div className={`border-b px-5 py-3 ${t.line} ${t.dark ? "bg-amber-400/[0.06]" : "bg-amber-50/60"}`}>
          <p className={`text-[12px] font-medium ${toneText("warn", t.dark)}`}>Still live, as far as BFO can see</p>
          <ul className="mt-1.5 space-y-1">
            {blockers.map((b, i) => (
              <li key={i} className={`flex flex-wrap items-baseline gap-x-2 text-[12.5px] leading-relaxed ${t.soft}`}>
                <span>{b.text}</span>
                {b.link && (
                  <Link to={b.link.to} className={`text-[12px] font-medium hover:underline ${t.accent}`}>
                    {b.link.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Done steps fold away once there are a few, so the next thing to do is at the top. */}
      {!finished && doneSteps.length > 1 && (
        <button
          type="button"
          onClick={() => setShowDone((v) => !v)}
          aria-expanded={showDone}
          className={`flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-2.5 text-left text-[12.5px] max-sm:min-h-[44px] ${t.muted} ${t.hover}`}
        >
          <span>
            {doneSteps.length} done{showDone ? "" : ", folded away"}
          </span>
          <Icon name={showDone ? "chevronDown" : "chevronRight"} className="h-3 w-3" />
        </button>
      )}

      <ol className={`divide-y ${t.divide}`}>
        {steps.map((s, i) => {
          const at = done[s.key];
          if (at && !finished && doneSteps.length > 1 && !showDone) return null;
          const lit = !finished && next?.key === s.key;
          const err = errors[s.key];
          const hint = hints[s.key];
          const mine = blockers.filter((b) => b.step === s.key);
          const toggle = () => void page.markClosingStep(s.key, !at);
          return (
            <li key={s.key} className={`${lit ? (t.dark ? "bg-white/[0.03]" : "bg-gray-50/80") : ""}`}>
              <div className="flex gap-3 px-5 py-3.5">
                <button
                  type="button"
                  disabled={!admin || finished}
                  onClick={toggle}
                  aria-label={at ? `Mark "${s.title}" not done` : `Mark "${s.title}" done`}
                  aria-pressed={!!at}
                  className={`mt-0.5 cursor-pointer disabled:cursor-default ${checkClass(!!at, lit)}`}
                >
                  {at ? <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.5} /> : i + 1}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    {/* The title is a second, wider target for the same tap. */}
                    <button
                      type="button"
                      disabled={!admin || finished}
                      onClick={toggle}
                      className={`cursor-pointer text-left text-[13.5px] font-medium disabled:cursor-default ${at ? `line-through ${t.faint}` : t.text}`}
                    >
                      {s.title}
                      {s.optional && <span className={`ml-2 text-[11.5px] font-normal no-underline ${t.faint}`}>nothing to file</span>}
                    </button>
                    {at ? (
                      <span className={`text-[12px] ${toneText("good", t.dark)}`}>Done {fmtDate(at)}</span>
                    ) : lit ? (
                      <span className={`text-[11.5px] font-medium uppercase tracking-[0.06em] ${t.muted}`}>Up next</span>
                    ) : null}
                  </div>
                  {!at && (
                    <>
                      <p className={`mt-1 text-[12.5px] leading-relaxed ${t.soft}`}>{s.how}</p>
                      {s.note && <p className={`mt-1 text-[12px] leading-relaxed ${toneText("warn", t.dark)}`}>{s.note}</p>}
                      {hint && (
                        <p className={`mt-1 flex items-start gap-1.5 text-[12px] leading-relaxed ${toneText("good", t.dark)}`}>
                          <Icon name="check" className="mt-[3px] h-3 w-3 shrink-0" strokeWidth={2.25} />
                          <span>BFO sees: {hint}</span>
                        </p>
                      )}
                      {mine.map((b, j) => (
                        <p key={j} className={`mt-1 flex items-start gap-1.5 text-[12px] leading-relaxed ${toneText("warn", t.dark)}`}>
                          <Icon name="info" className="mt-[3px] h-3 w-3 shrink-0" />
                          <span>{b.text}</span>
                        </p>
                      ))}
                      {s.key.startsWith("state:") && facts.length > 0 && <FilingFacts facts={facts} />}
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        {s.generate && (
                          <Button icon="sparkle" kind={lit ? "primary" : "secondary"} disabled={!!busy} onClick={() => void run(s.key, () => page.generateClosingDoc(s.generate!))}>
                            {busy === s.key
                              ? "Drafting…"
                              : drafted[s.key]
                                ? s.generate === "consent"
                                  ? "Draft the consent again"
                                  : "Draft the IRS letter again"
                                : s.generate === "consent"
                                  ? "Draft the consent"
                                  : "Draft the IRS letter"}
                          </Button>
                        )}
                        {s.palmEnd && admin && (
                          <Button
                            kind={lit ? "primary" : "secondary"}
                            disabled={!!busy || !stateDone}
                            onClick={() => void run(s.key, () => page.endPalmAgent())}
                            title={stateDone ? undefined : "After the state filing is done"}
                          >
                            {busy === s.key ? "Asking Palm…" : "End Palm's service"}
                          </Button>
                        )}
                        {s.link && (
                          <a
                            href={s.link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`inline-flex min-h-[28px] items-center gap-1 text-[12.5px] font-medium hover:underline max-sm:min-h-[44px] ${t.accent}`}
                          >
                            {s.link.label} <Icon name="external" className="h-3 w-3" />
                          </a>
                        )}
                        {admin && !finished && (
                          <Button kind="ghost" icon="check" onClick={toggle}>
                            Mark done
                          </Button>
                        )}
                      </div>
                      {drafted[s.key] && !err && <p className={`mt-1.5 text-[12px] ${t.muted}`}>Drafted into Documents and opened. Sign it, then mark this done.</p>}
                      {err && (
                        <div className="mt-2">
                          <ErrorLine>{err}</ErrorLine>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {!finished && admin && (
        <div className={`flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 ${t.line}`}>
          <p className={`text-[12.5px] ${t.soft}`}>{left.length ? `${left.length} step${left.length === 1 ? "" : "s"} left.` : "Every step is done."}</p>
          <Button kind={left.length ? "secondary" : "primary"} size="md" onClick={() => void page.finishClosing()}>
            Mark dissolved
          </Button>
        </div>
      )}
    </Section>
  );
}

/** The facts the state's form asks for, each one tap to copy. */
function FilingFacts({ facts }: { facts: { label: string; value: string }[] }) {
  const t = useTone();
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(f: { label: string; value: string }) {
    try {
      await navigator.clipboard.writeText(f.value);
      setCopied(f.label);
      setTimeout(() => setCopied((c) => (c === f.label ? null : c)), 1500);
    } catch {
      // no clipboard (an old WebView): the value is still on screen to select
    }
  }
  return (
    <dl className={`mt-2 overflow-hidden rounded-lg border text-[12.5px] ${t.dark ? "border-white/10" : "border-gray-200"}`}>
      {facts.map((f) => (
        <div key={f.label} className={`flex items-center gap-3 px-3 py-1.5 ${t.dark ? "odd:bg-white/[0.03]" : "odd:bg-gray-50"}`}>
          <dt className={`w-[9.5rem] shrink-0 ${t.muted}`}>{f.label}</dt>
          <dd className={`min-w-0 flex-1 break-words ${t.text}`}>{f.value}</dd>
          <button
            type="button"
            onClick={() => void copy(f)}
            aria-label={`Copy ${f.label.toLowerCase()}`}
            className={`flex h-[28px] w-[28px] shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors max-sm:h-[40px] max-sm:w-[40px] ${t.dark ? "text-gray-400 hover:bg-white/[0.06] hover:text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"}`}
          >
            <Icon name={copied === f.label ? "check" : "copy"} className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </dl>
  );
}
