/**
 * Palm's questions ("cases") on an entity: on its formation or EIN filing,
 * or on the business itself (a registered agent change the state won't
 * accept without an address, say). Each is answered here: an address from the
 * entity's record, ready to check and send; anything else typed in. A
 * document Palm wants is uploaded in Palm.
 */

import { useEffect, useState } from "react";
import { isAdmin } from "../auth";
import { confirm, format, Status, TextLink as UiTextLink } from "../ui";
import { stateName } from "../entity-paperwork";
import { type FormationAddress } from "../formation";
import { fromBundle, palmCall } from "../palm";
import { caseAnswer, caseDefaults, type PalmCase } from "../palm-cases";
import { useEntity, usePalmSeed } from "./context";
import type { Asset } from "./model";
import { Button, ErrorLine, Field, Input, Section, Textarea } from "./ui";

// ── Palm's questions on the filing ───────────────────────────────────────

/**
 * Questions Palm has before the state will accept the filing (cases), each
 * answered here: an address from the entity's record, ready to check and
 * send; anything else typed in. A document Palm wants is uploaded in Palm.
 */
export function PalmQuestions({ openCases = 0, title }: { openCases?: number; title?: string }) {
  const { page, asset } = useEntity();
  const [cases, setCases] = useState<PalmCase[] | null>(null);
  const [error, setError] = useState("");
  const mode = page.palmMode;
  const seed = usePalmSeed<{ cases: PalmCase[] }>("cases");

  useEffect(() => {
    if (!mode) return;
    let alive = true;
    // The page's opening read when it just came in; Palm itself otherwise.
    const part = seed(`${page.id}:${mode}`, `${openCases}:${page.palmCasesTick}`);
    (part ? fromBundle(part) : palmCall<{ cases: PalmCase[] }>("cases", { assetId: page.id, mode }))
      .then((r) => alive && (setCases(r.cases ?? []), setError("")))
      .catch((err) => alive && setError((err as Error).message));
    return () => {
      alive = false;
    };
    // A sync with Palm bumps the tick, so this asks again.
  }, [mode, page.id, openCases, page.palmCasesTick]);

  const open = (cases ?? []).filter((c) => c.status === "needs_response" || c.status === "under_review");
  if (!open.length && !error) return null;
  const list = (
    <>
      {error && (
        <div className="px-5 py-3">
          <ErrorLine>{error}</ErrorLine>
        </div>
      )}
      {open.map((c) => (
        <CaseCard key={c.id} c={c} facts={asset} onAnswered={(next) => setCases((list) => list?.map((x) => (x.id === next.id ? next : x)) ?? list)} />
      ))}
    </>
  );
  // On its own (the Compliance tab) it's a card; inside the Formation card it's a section of it.
  if (title) {
    const waiting = open.filter((c) => c.status === "needs_response").length;
    return (
      <Section
        title={title}
        count={waiting || undefined}
        alert={waiting > 0}
        info="Palm opens a case when it can't finish without something only you have — an address the state wants, a document. Answer it here and Palm carries on."
      >
        {list}
      </Section>
    );
  }
  return <div className="mt-4 border-t border-line">{list}</div>;
}

function CaseCard({ c, facts, onAnswered }: { c: PalmCase; facts: Asset; onAnswered: (c: PalmCase) => void }) {
  const { page } = useEntity();
  const [values, setValues] = useState(() => caseDefaults(c, facts));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const waiting = c.status === "under_review";
  const fields = c.request?.fields ?? [];
  const setText = (name: string, text: string) => setValues((v) => ({ ...v, [name]: { kind: "text", text } }));
  const setAddr = (name: string, k: keyof FormationAddress, val: string) =>
    setValues((v) => {
      const cur = v[name];
      return cur?.kind === "address" ? { ...v, [name]: { kind: "address", address: { ...cur.address, [k]: val } } } : v;
    });

  async function send() {
    const answer = caseAnswer(c, values);
    if ("missing" in answer) {
      setError(`Still needed: ${answer.missing.join("; ")}.`);
      return;
    }
    // The answers go on the state's record through Palm: the person attests they're true first.
    const where = stateName(facts.state ?? "") || facts.state || "the state";
    const ok = await confirm({
      title: "Send these answers to Palm?",
      message: `Palm files them with ${where}, and they go on the state’s record. Check that they’re true and complete.`,
      details: Object.entries(answer.fields)
        .slice(0, 5)
        .map(([name, v]) => `${(c.request?.fields ?? []).find((x) => x.name === name)?.description || name}: ${typeof v === "string" ? v : v && typeof v === "object" ? Object.values(v).filter(Boolean).join(", ") : String(v ?? "")}`),
      confirmLabel: "They’re true; send them",
      tone: "commit",
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      const r = await palmCall<{ case: PalmCase }>("case-respond", { assetId: page.id, caseId: c.id, fields: answer.fields, mode: page.palmMode });
      onAnswered(r.case ?? { ...c, status: "under_review" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Status tone={waiting ? "info" : "warning"}>{waiting ? "Answered: Palm is reviewing" : "Palm needs an answer"}</Status>
          <p className="mt-1 text-body text-ink">{c.summary}</p>
          {c.details && <p className="mt-1 max-w-[68ch] text-small text-pretty whitespace-pre-wrap text-ink-2">{c.details.replace(/[*_`#]/g, "")}</p>}
        </div>
        {c.due_at && <span className="shrink-0 text-small text-ink-2">Due {format.date(c.due_at.slice(0, 10), "medium")}</span>}
      </div>
      {!waiting && (
        <>
          {fields.map((f) => {
            const v = values[f.name];
            if (v?.kind === "address") {
              const from = /mail/i.test(f.name) ? "mailing address" : /agent/i.test(f.name) ? "agent's address" : "principal office";
              return (
                <div key={f.name} className="border-t border-line pt-3">
                  <p className="mb-2 text-small text-ink-2">
                    {f.description || f.name}
                    <span className="text-ink-3"> · from BFO’s {from}</span>
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr]">
                    <Input value={v.address.street1} onChange={(e) => setAddr(f.name, "street1", e.target.value)} placeholder="Street" aria-label="Street" />
                    <Input value={v.address.street2} onChange={(e) => setAddr(f.name, "street2", e.target.value)} placeholder="Suite" aria-label="Suite" />
                  </div>
                  <div className="mt-2 grid grid-cols-[2fr_1fr_1fr] gap-2">
                    <Input value={v.address.city} onChange={(e) => setAddr(f.name, "city", e.target.value)} placeholder="City" aria-label="City" />
                    <Input value={v.address.region} onChange={(e) => setAddr(f.name, "region", e.target.value)} placeholder="State" aria-label="State" maxLength={2} />
                    <Input value={v.address.postal} onChange={(e) => setAddr(f.name, "postal", e.target.value)} placeholder="ZIP" aria-label="ZIP" />
                  </div>
                </div>
              );
            }
            if (v?.kind === "document") {
              return (
                <p key={f.name} className="text-small text-ink-2">
                  {f.description || f.name}: upload it in{" "}
                  <UiTextLink to="https://app.getpalm.com" inline>
                    Palm
                  </UiTextLink>
                  .
                </p>
              );
            }
            return (
              <Field key={f.name} label={f.description || f.name} hint={f.example != null ? `For example: ${String(f.example)}` : undefined}>
                {f.type === "object" || f.type === "list" ? (
                  <Textarea value={v?.kind === "text" ? v.text : ""} onChange={(e) => setText(f.name, e.target.value)} rows={3} />
                ) : (
                  <Input type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"} value={v?.kind === "text" ? v.text : ""} onChange={(e) => setText(f.name, e.target.value)} />
                )}
              </Field>
            );
          })}
          {error && <ErrorLine>{error}</ErrorLine>}
          <div className="flex justify-end">
            {!isAdmin() && <p className="mr-3 self-center text-small text-ink-2">An owner or admin sends the answers.</p>}
            <Button kind="primary" disabled={busy || !isAdmin()} onClick={() => void send()}>
              {busy ? "Sending…" : "Send to Palm…"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
