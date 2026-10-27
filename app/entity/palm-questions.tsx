/**
 * Palm's questions ("cases") on an entity: on its formation or EIN filing,
 * or on the business itself (a registered agent change the state won't
 * accept without an address, say). Each is answered here: an address from the
 * entity's record, ready to check and send; anything else typed in. A
 * document Palm wants is uploaded in Palm.
 */

import { useEffect, useState } from "react";
import { isAdmin } from "../auth";
import { type FormationAddress } from "../formation";
import { fromBundle, palmCall } from "../palm";
import { caseAnswer, caseDefaults, type PalmCase } from "../palm-cases";
import { useEntity, usePalmSeed } from "./context";
import { fmtDate, type Asset } from "./model";
import { Button, Dot, ErrorLine, Field, Input, Section, Textarea, useTone } from "./ui";

const linkClass = "relative inline-flex cursor-pointer items-center gap-1 whitespace-nowrap text-[12px] font-medium hover:underline";

function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  const { accent } = useTone();
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${linkClass} ${accent}`}>
      {children}
    </a>
  );
}

// ── Palm's questions on the filing ───────────────────────────────────────

/**
 * Questions Palm has before the state will accept the filing (cases), each
 * answered here: an address from the entity's record, ready to check and
 * send; anything else typed in. A document Palm wants is uploaded in Palm.
 */
export function PalmQuestions({ openCases = 0, title }: { openCases?: number; title?: string }) {
  const { page, asset } = useEntity();
  const t = useTone();
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
      {error && <div className="px-5 py-3"><ErrorLine>{error}</ErrorLine></div>}
      {open.map((c) => (
        <CaseCard key={c.id} c={c} facts={asset} onAnswered={(next) => setCases((list) => list?.map((x) => (x.id === next.id ? next : x)) ?? list)} />
      ))}
    </>
  );
  // On its own (the Compliance tab) it's a card; inside the Formation card it's a section of it.
  if (title) {
    const waiting = open.filter((c) => c.status === "needs_response").length;
    return (
      <Section title={title} count={waiting || undefined} alert={waiting > 0} info="Palm opens a case when it can't finish without something only you have — an address the state wants, a document. Answer it here and Palm carries on.">
        {list}
      </Section>
    );
  }
  return <div className={`border-t ${t.line}`}>{list}</div>;
}

function CaseCard({ c, facts, onAnswered }: { c: PalmCase; facts: Asset; onAnswered: (c: PalmCase) => void }) {
  const { page } = useEntity();
  const t = useTone();
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
    <div className="space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`flex items-center gap-2 text-[13px] font-semibold ${t.text}`}>
            <Dot tone={waiting ? "accent" : "warn"}>{waiting ? "Answered: Palm is reviewing" : "Palm needs an answer"}</Dot>
          </p>
          <p className={`mt-1 text-[13px] ${t.text}`}>{c.summary}</p>
          {c.details && <p className={`mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed ${t.soft}`}>{c.details.replace(/[*_`#]/g, "")}</p>}
        </div>
        {c.due_at && <span className={`shrink-0 text-[12px] ${t.muted}`}>Due {fmtDate(c.due_at.slice(0, 10))}</span>}
      </div>
      {!waiting && (
        <>
          {fields.map((f) => {
            const v = values[f.name];
            if (v?.kind === "address") {
              const from = /mail/i.test(f.name) ? "mailing address" : /agent/i.test(f.name) ? "agent's address" : "principal office";
              return (
                <div key={f.name} className={`rounded-xl border p-3 ${t.line}`}>
                  <p className={`mb-2 text-[12px] ${t.muted}`}>
                    {f.description || f.name}
                    <span className={t.faint}> · from BFO's {from}</span>
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
                <p key={f.name} className={`text-[12.5px] ${t.soft}`}>
                  {f.description || f.name}: upload it in <TextLink href="https://app.getpalm.com">Palm</TextLink>.
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
            <Button kind="primary" disabled={busy || !isAdmin()} onClick={() => void send()}>
              {busy ? "Sending…" : isAdmin() ? "Send to Palm" : "Owner or admin sends"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

