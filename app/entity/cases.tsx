import { useState } from "react";
import { isAdmin } from "../auth";
import { addressValue, CASE_STATUS, EMPTY_STRUCTURED, isAddressField, parseUsAddress, type CaseField, type PalmCase, type StructuredAddress } from "../palm";
import { US_STATES } from "../formation";
import { useEntity } from "./context";
import { fmtDate } from "./model";
import { Button, Dot, ErrorLine, Field, Input, Section, Select, Switch, TextButton, useTone } from "./ui";

/**
 * What Palm needs before it can go on (a "case"): shown with a form built from
 * Palm's own list of fields. Address fields are prefilled from the entity's
 * record; the answer goes back through the API and the case moves to "Palm is
 * on it" until Palm resolves it.
 */
export function Cases() {
  const { page, asset } = useEntity();
  const t = useTone();
  const cases = page.palmCases;
  if (!page.palmStatus?.configured || !page.palmMode) return null;
  if ((!cases || !cases.length) && !page.palmCasesError) return null;
  // Waiting on us, and what we've answered that Palm is still working on; the rest as a short history.
  const open = (cases ?? []).filter((c) => c.status === "needs_response" || c.status === "under_review");
  const rest = (cases ?? []).filter((c) => c.status !== "needs_response" && c.status !== "under_review").slice(0, 5);
  return (
    <Section
      title="Palm needs"
      count={open.filter((c) => c.status === "needs_response").length || undefined}
      alert={open.some((c) => c.status === "needs_response")}
      info="When Palm can't finish without something only you have, it opens a case and lists what it needs. Answer here and it carries on."
    >
      {page.palmCasesError && <ErrorLine>{page.palmCasesError}</ErrorLine>}
      {open.map((c) => (
        <CaseCard key={c.id} c={c} defaultAddress={parseUsAddress(asset.address)} />
      ))}
      {rest.length > 0 && (
        <ul className={`divide-y ${t.divide}`}>
          {rest.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-[12.5px]">
              <span className={`min-w-0 ${t.soft}`}>{c.summary}</span>
              <Dot tone={c.status === "under_review" ? "warn" : c.status === "resolved" ? "good" : "muted"} className="shrink-0">
                {CASE_STATUS[c.status as keyof typeof CASE_STATUS] ?? c.status}
              </Dot>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function CaseCard({ c, defaultAddress }: { c: PalmCase; defaultAddress: StructuredAddress }) {
  const { page } = useEntity();
  const t = useTone();
  const canAnswer = isAdmin();
  const fields = c.request?.fields ?? [];
  const addressFields = fields.filter(isAddressField);
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const v: Record<string, unknown> = {};
    for (const f of fields) {
      if (isAddressField(f)) v[f.name] = { ...defaultAddress };
      else if (f.type === "boolean") v[f.name] = false;
      else v[f.name] = "";
    }
    return v;
  });
  /** Every address after the first follows the first until unticked. */
  const [sameAsFirst, setSameAsFirst] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(c.status === "under_review");

  const addr = (name: string) => (values[name] as StructuredAddress | undefined) ?? { ...EMPTY_STRUCTURED };
  const setAddr = (name: string, a: StructuredAddress) => setValues((v) => ({ ...v, [name]: a }));

  const missing = fields.filter((f) => {
    if (f.required === false) return false;
    const v = values[f.name];
    if (isAddressField(f)) {
      const a = sameAsFirst && f !== addressFields[0] ? addr(addressFields[0].name) : addr(f.name);
      return !a.street_line_1.trim() || !a.city.trim() || !a.region.trim() || !a.postal_code.trim();
    }
    if (f.type === "boolean") return false;
    return !String(v ?? "").trim();
  });

  async function submit() {
    if (busy || missing.length) return;
    setBusy(true);
    setError("");
    try {
      const out: Record<string, unknown> = {};
      const documents: string[] = [];
      for (const f of fields) {
        if (isAddressField(f)) {
          const a = sameAsFirst && f !== addressFields[0] ? addr(addressFields[0].name) : addr(f.name);
          out[f.name] = addressValue(a);
        } else if (f.type === "number") {
          const n = Number(values[f.name]);
          if (String(values[f.name]).trim()) out[f.name] = Number.isFinite(n) ? n : values[f.name];
        } else if (f.type === "boolean") {
          out[f.name] = !!values[f.name];
        } else if (f.type === "document") {
          const id = String(values[f.name] ?? "").trim();
          if (id) {
            out[f.name] = id;
            documents.push(id);
          }
        } else if (f.type === "list") {
          out[f.name] = String(values[f.name] ?? "").split(/\n|,/).map((s) => s.trim()).filter(Boolean);
        } else if (String(values[f.name] ?? "").trim()) {
          out[f.name] = String(values[f.name]).trim();
        }
      }
      await page.respondCase(c.id, out, documents);
      setSent(true);
    } catch (err) {
      setError((err as Error).message || "Palm didn't take the answer.");
    } finally {
      setBusy(false);
    }
  }

  const addressForm = (name: string, lockRegion?: boolean) => {
    const a = addr(name);
    const set = (patch: Partial<StructuredAddress>) => setAddr(name, { ...a, ...patch });
    return (
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-6">
        <Field label="Street" className="md:col-span-4">
          <Input value={a.street_line_1} onChange={(e) => set({ street_line_1: e.target.value })} autoComplete="address-line1" />
        </Field>
        <Field label="Suite / unit" className="md:col-span-2">
          <Input value={a.street_line_2} onChange={(e) => set({ street_line_2: e.target.value })} autoComplete="address-line2" />
        </Field>
        <Field label="City" className="md:col-span-3">
          <Input value={a.city} onChange={(e) => set({ city: e.target.value })} autoComplete="address-level2" />
        </Field>
        <Field label="State" className="md:col-span-1">
          <Select value={a.region} disabled={lockRegion} onChange={(e) => set({ region: e.target.value })}>
            <option value="">—</option>
            {US_STATES.map(([abbr]) => (
              <option key={abbr} value={abbr}>
                {abbr}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ZIP" className="md:col-span-2">
          <Input value={a.postal_code} inputMode="numeric" onChange={(e) => set({ postal_code: e.target.value })} autoComplete="postal-code" />
        </Field>
      </div>
    );
  };

  const label = (f: CaseField) => f.name.replace(/[_-]+/g, " ").replace(/^\w/, (ch) => ch.toUpperCase());

  return (
    <div className={`border-b px-4 py-4 last:border-b-0 ${t.line}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-[13px] font-medium ${t.text}`}>{c.summary}</p>
          {c.details && <p className={`mt-1 whitespace-pre-wrap text-[12px] ${t.muted}`}>{c.details.replace(/[*_`#>]/g, "")}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Dot tone={sent ? "warn" : "bad"}>{sent ? CASE_STATUS.under_review : CASE_STATUS.needs_response}</Dot>
          {c.due_at && <span className={`text-[11px] ${t.faint}`}>Due {fmtDate(c.due_at.slice(0, 10))}</span>}
        </div>
      </div>

      {sent ? (
        <p className={`mt-3 text-[12.5px] ${t.soft}`}>Sent. Palm picks it up from here and resolves the case when the work is done.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {fields.map((f, i) =>
            isAddressField(f) ? (
              <div key={f.name}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className={`block text-[13px] font-semibold ${t.text}`}>{label(f)}</span>
                    <span className={`block text-[12px] ${t.muted}`}>{f.description}</span>
                  </div>
                  {addressFields.indexOf(f) > 0 && (
                    <label className="flex cursor-pointer items-center gap-2">
                      <Switch on={sameAsFirst} onToggle={() => setSameAsFirst((v) => !v)} label={`Same as ${label(addressFields[0])}`} />
                      <span className={`text-[12px] ${t.soft}`}>Same as {label(addressFields[0]).toLowerCase()}</span>
                    </label>
                  )}
                </div>
                {addressFields.indexOf(f) > 0 && sameAsFirst ? null : addressForm(f.name)}
              </div>
            ) : (
              <Field key={f.name} label={`${label(f)}${f.required === false ? " (optional)" : ""}`} hint={f.description} wide>
                {f.type === "boolean" ? (
                  <div className="flex h-8 items-center max-sm:h-[44px]">
                    <Switch on={!!values[f.name]} onToggle={() => setValues((v) => ({ ...v, [f.name]: !v[f.name] }))} label={label(f)} />
                  </div>
                ) : f.type === "document" ? (
                  <Input value={String(values[f.name] ?? "")} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} placeholder="Palm document id (upload the file to the business in Palm first)" autoFocus={i === 0} />
                ) : (
                  <Input
                    type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
                    value={String(values[f.name] ?? "")}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                    placeholder={f.example != null ? String(f.example) : f.type === "list" ? "One per line, or comma-separated" : undefined}
                    autoFocus={i === 0}
                  />
                )}
              </Field>
            )
          )}
          {error && <ErrorLine>{error}</ErrorLine>}
          <div className="flex items-center gap-3">
            <Button kind="primary" size="md" onClick={() => void submit()} disabled={busy || missing.length > 0 || !canAnswer} title={!canAnswer ? "Only an owner or admin can answer Palm" : undefined}>
              {busy ? "Sending…" : "Send to Palm"}
            </Button>
            {missing.length > 0 && <span className={`text-[12px] ${t.muted}`}>{missing.length === 1 ? `${label(missing[0])} is needed.` : `${missing.length} fields still needed.`}</span>}
            {!canAnswer && <span className={`text-[12px] ${t.muted}`}>Only an owner or admin can answer.</span>}
            {c.parent_type === "business" && <TextButton onClick={() => window.open("https://app.getpalm.com", "_blank", "noopener")}>Open in Palm</TextButton>}
          </div>
        </div>
      )}
    </div>
  );
}
