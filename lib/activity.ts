import { sb } from "./auth.js";

/**
 * Each entity's activity (public.entity_activity): what changed, who changed
 * it, and when. Writes to the tree are compared before and after
 * (describeChange) and told as a few plain lines; Palm, Stable and invites
 * add their own. The pure pieces are exported so they're tested without a
 * network.
 */

export type Actor = { id: string | null; name: string | null; source: "user" | "palm" | "stable" | "system" };
export type FieldChange = { key: string; label: string; from: string | null; to: string | null };
export type ActivityEntry = { kind: string; summary: string; detail?: Record<string, unknown> | null };
export type ActivityRow = {
  id: number;
  asset_id: string;
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  source: Actor["source"];
  kind: string;
  summary: string;
  detail: Record<string, unknown> | null;
};

type Rec = Record<string, any>;

/** The record's own fields, as people call them. */
const FIELDS: Record<string, string> = {
  name: "Legal name",
  type: "Entity type",
  state: "State",
  ein: "EIN",
  address: "Principal office",
  mailingAddress: "Mailing address",
  registeredAgentAddress: "Registered agent's address",
  formationDate: "Formation date",
  registeredAgent: "Registered agent",
  llcType: "Tax classification",
  ownerId: "Owner",
  status: "Status",
  fileNumber: "State file number",
  stateLink: "State record link",
  email: "Email",
  trustees: "Trustees",
  grantors: "Grantors",
  beneficiaries: "Beneficiaries",
  operatingAgreementDate: "Operating agreement date",
  articlesOfOrgDate: "Articles filing date",
  annualReportYear: "Annual report year",
};
/** Changed without showing the before and after. */
const QUIET = new Set(["notes"]);

/** Filing slots (app/entity/model.ts FALLBACK_TITLE). */
const SLOTS: Record<string, string> = {
  articles: "Formation filing",
  einLetter: "EIN Letter",
  w9: "Form W-9",
  operatingAgreement: "Operating agreement",
  trustAgreement: "Trust Agreement",
  trustCertificate: "Certification of Trust",
  trustSchedule: "Schedule A & assignments",
  sElection: "Form 2553 (S election)",
  sElectionAccepted: "CP261 (S election accepted)",
  classElection: "Form 8832 + IRS acceptance",
  annualReport: "Annual report",
  foreignRegistration: "Foreign registration",
  goodStanding: "Certificate of Good Standing",
  ownershipLedger: "Ownership ledger",
  minutes: "Minutes / consents",
};

const ADDRESS_STEPS: Record<string, string> = { state: "the state", irs: "the IRS", banks: "the banks" };

const FILING_STATUS: Record<string, string> = {
  draft: "is a draft",
  submitted: "was submitted",
  processing: "is with the state",
  pending: "is pending",
  action_required: "needs an answer",
  completed: "is complete: the state approved it",
  canceled: "was canceled",
  rejected: "was rejected",
};

const text = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const list = (names: string[]) => (names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
const quote = (s: string) => `“${s}”`;

/** "Changed the EIN to 93-1234567", or for several, "Changed the address, EIN and owner". */
export function editSummary(fields: FieldChange[]): string {
  if (fields.length === 1) {
    const f = fields[0];
    if (QUIET.has(f.key)) return `Edited the ${f.label.toLowerCase()}`;
    if (f.to === null) return `Cleared the ${lower(f.label)}`;
    return `${f.from === null ? "Set" : "Changed"} the ${lower(f.label)} to ${f.to}`;
  }
  return `Changed the ${list(fields.map((f) => lower(f.label)))}`;
}
/** "EIN" stays "EIN"; "Legal name" reads "legal name". */
const lower = (label: string) => (/^[A-Z]{2}/.test(label) ? label : label[0].toLowerCase() + label.slice(1));

/**
 * One entity's record before and after a write, told as activity. `names`
 * turns an entity id (an owner) into its name.
 */
export function describeChange(before: Rec | null, after: Rec | null, names: (id: string) => string | null = () => null): ActivityEntry[] {
  if (!before && after) return [{ kind: "created", summary: `Added ${after.name ? quote(after.name) : "the entity"}` }];
  if (before && !after) return [{ kind: "deleted", summary: `Deleted ${before.name ? quote(before.name) : "the entity"}` }];
  if (!before || !after) return [];
  const out: ActivityEntry[] = [];

  // Fields
  const fields: FieldChange[] = [];
  for (const [key, label] of Object.entries(FIELDS).concat([["notes", "Notes"]])) {
    if (same(before[key], after[key])) continue;
    const show = (v: unknown) => (key === "ownerId" && typeof v === "string" ? (names(v) ?? v) : text(v));
    fields.push({ key, label, from: QUIET.has(key) ? null : show(before[key]), to: QUIET.has(key) ? null : show(after[key]) });
  }
  // The agent and file number in each state it's registered in as a foreign entity.
  const foreignOf = (r: Rec): Record<string, Rec> => (r.foreign && typeof r.foreign === "object" ? r.foreign : {});
  for (const code of new Set([...Object.keys(foreignOf(before)), ...Object.keys(foreignOf(after))])) {
    const b = foreignOf(before)[code] ?? {};
    const a = foreignOf(after)[code] ?? {};
    for (const [k, label] of [["agent", "agent"], ["agentAddress", "agent's address"], ["fileNumber", "file number"]] as const) {
      if (!same(b[k], a[k])) fields.push({ key: `foreign.${code}.${k}`, label: `${code} ${label}`, from: text(b[k]), to: text(a[k]) });
    }
  }
  if (fields.length) out.push({ kind: "edit", summary: editSummary(fields), detail: { fields } });

  // Owners
  const owners = (r: Rec) => (Array.isArray(r.members) ? (r.members as Rec[]) : []).filter((m) => m && m.name);
  if (!same(owners(before), owners(after))) {
    const was = new Map(owners(before).map((m) => [m.name as string, m]));
    const now = new Map(owners(after).map((m) => [m.name as string, m]));
    const added = [...now.keys()].filter((n) => !was.has(n));
    const removed = [...was.keys()].filter((n) => !now.has(n));
    const changed = [...now.keys()].filter((n) => was.has(n) && !same(was.get(n), now.get(n)));
    const bits = [
      added.length ? `added ${list(added)}` : "",
      removed.length ? `removed ${list(removed)}` : "",
      changed.length ? `updated ${list(changed)}` : "",
    ].filter(Boolean);
    const shares = owners(after).map((m) => `${m.name}${typeof m.percent === "number" ? ` ${m.percent}%` : ""}`);
    out.push({ kind: "owners", summary: bits.length ? `Owners: ${bits.join("; ")}` : "Reordered the owners", detail: { owners: shares } });
  }

  // Documents
  const docs = (r: Rec): Record<string, Rec> => (r.documents && typeof r.documents === "object" ? r.documents : {});
  const db = docs(before);
  const da = docs(after);
  const uploaded = Object.keys(da).filter((k) => !db[k] && da[k]?.name);
  const deleted = Object.keys(db).filter((k) => !da[k] && db[k]?.name);
  if (uploaded.length) out.push({ kind: "upload", summary: uploaded.length === 1 ? `Uploaded ${quote(da[uploaded[0]].name)}` : `Uploaded ${uploaded.length} documents`, detail: { names: uploaded.map((k) => da[k].name) } });
  if (deleted.length) out.push({ kind: "delete", summary: deleted.length === 1 ? `Deleted ${quote(db[deleted[0]].name)}` : `Deleted ${deleted.length} documents`, detail: { names: deleted.map((k) => db[k].name) } });
  for (const k of Object.keys(da)) {
    if (db[k]?.name && da[k]?.name && db[k].name !== da[k].name) out.push({ kind: "rename", summary: `Renamed ${quote(db[k].name)} to ${quote(da[k].name)}` });
  }

  // Filing slots
  for (const [key, title] of Object.entries(SLOTS)) {
    const b = before[key] as Rec | undefined;
    const a = after[key] as Rec | undefined;
    if (same(b?.fileName, a?.fileName) && same(b?.docId, a?.docId)) continue;
    if (a?.fileName && !b?.fileName) out.push({ kind: "filed", summary: `Filed ${quote(a.fileName)} as the ${lower(title)}` });
    else if (a?.fileName) out.push({ kind: "filed", summary: `Replaced the ${lower(title)} with ${quote(a.fileName)}` });
    else if (b?.fileName) out.push({ kind: "unfiled", summary: `Took ${quote(b.fileName)} off the ${lower(title)}` });
  }

  // The address change's paperwork
  const steps = (r: Rec): Rec => (r.addressUpdates && typeof r.addressUpdates === "object" ? r.addressUpdates : {});
  for (const [step, who] of Object.entries(ADDRESS_STEPS)) {
    const b = steps(before)[step];
    const a = steps(after)[step];
    if (same(b, a)) continue;
    out.push({ kind: "address", summary: a ? `Marked the new address as reported to ${who}` : `Unmarked the new address as reported to ${who}` });
  }

  // Palm
  for (const mode of ["live", "test"]) {
    const pb = (before.palm?.[mode] ?? null) as Rec | null;
    const pa = (after.palm?.[mode] ?? null) as Rec | null;
    const tag = mode === "test" ? " (test)" : "";
    if (pa?.businessId && pb?.businessId !== pa.businessId && !pa.formation) out.push({ kind: "palm", summary: `Linked to Palm${tag}` });
    const fb = pb?.formation as Rec | undefined;
    const fa = pa?.formation as Rec | undefined;
    if (fa && !fb) out.push({ kind: "palm", summary: `Filed the formation with Palm${tag}`, detail: { jurisdiction: fa.jurisdiction ?? null, expedited: fa.expeditedTier ?? null } });
    else if (fa && fb && fa.status !== fb.status) {
      out.push({ kind: "palm", summary: `The formation ${FILING_STATUS[fa.status] ?? `is ${String(fa.status).replace(/_/g, " ")}`}${tag}`, detail: fa.statusReason ? { reason: fa.statusReason } : null });
    }
    if (fa?.ein && fb?.ein?.status !== fa.ein.status && fb) {
      out.push({ kind: "palm", summary: fa.ein.status === "completed" ? `The IRS issued the EIN${fa.ein.number ? ` ${fa.ein.number}` : ""}${tag}` : `EIN application ${String(fa.ein.status).replace(/_/g, " ")}${tag}` });
    }
    if (fa && fb && (fa.openCases ?? 0) > (fb.openCases ?? 0)) out.push({ kind: "palm", summary: `Palm opened a case that needs an answer${tag}` });
  }

  // The state's record, as read through Palm
  const sb0 = before.stateRecord as Rec | undefined;
  const sa = after.stateRecord as Rec | undefined;
  if (sa && !sb0) out.push({ kind: "state", summary: "Read the state's record through Palm" });
  else if (sa && sb0) {
    // Only a value that was there and is now different: a field read for the first time isn't a change.
    const moved = (["status", "standing", "address", "agent"] as const).filter((k) => sb0[k] != null && sa[k] != null && !same(sb0[k], sa[k]));
    const say = (k: string, v: any): string =>
      k === "standing"
        ? `standing ${Object.entries((v ?? {}) as Record<string, string>).map(([part, s]) => `${part === "registration" ? "filings" : part} ${s === "compliant" ? "current" : "behind"}`).join(", ")}`
        : k === "status" ? `status ${v}` : k === "agent" ? `agent ${v}` : `address ${v}`;
    if (moved.length) out.push({ kind: "state", summary: `The state's record changed: ${moved.map((k) => say(k, sa[k])).join("; ")}` });
  }

  // Foreign registrations: reading another state's record
  const fb = (before.foreign ?? {}) as Record<string, Rec>;
  const fa = (after.foreign ?? {}) as Record<string, Rec>;
  for (const code of Object.keys(fa)) {
    if (fa[code]?.record && fa[code].record.checkedAt !== fb[code]?.record?.checkedAt) out.push({ kind: "state", summary: `Read ${code}'s record through Palm` });
  }

  // Checks
  if (after.verification?.checkedAt && after.verification.checkedAt !== before.verification?.checkedAt) {
    const issues = Array.isArray(after.verification.issues) ? after.verification.issues.length : 0;
    out.push({ kind: "check", summary: issues ? `Ran the document check: ${issues} issue${issues === 1 ? "" : "s"}` : "Ran the document check: all clear" });
  }

  // Agreements
  const contracts = (r: Rec): Record<string, Rec> => (r.contracts && typeof r.contracts === "object" ? r.contracts : {});
  const cb = contracts(before);
  const ca = contracts(after);
  for (const [k, c] of Object.entries(ca)) {
    if (!cb[k]) out.push({ kind: "agreement", summary: `Added an agreement with ${c.counterparty || "a counterparty"}` });
    else if (cb[k].status !== c.status && c.status) out.push({ kind: "agreement", summary: `The agreement with ${c.counterparty || "a counterparty"} is now ${c.status}` });
  }
  for (const [k, c] of Object.entries(cb)) if (!ca[k]) out.push({ kind: "agreement", summary: `Removed the agreement with ${c.counterparty || "a counterparty"}` });

  return out;
}

/**
 * Edits by the same person within this window read as one entry: the record
 * is saved field by field, and nobody wants a line per keystroke-save.
 */
export const MERGE_MS = 15 * 60 * 1000;

/** Two edits' fields as one: each field's first "from" and last "to"; any that went back where it started drop out. */
export function mergeFields(older: FieldChange[], newer: FieldChange[]): FieldChange[] {
  const out = new Map(older.map((f) => [f.key, { ...f }]));
  for (const f of newer) {
    const prev = out.get(f.key);
    out.set(f.key, prev ? { ...prev, to: f.to } : { ...f });
  }
  return [...out.values()].filter((f) => QUIET.has(f.key) || f.from !== f.to);
}

// ── Supabase ─────────────────────────────────────────────────────────────

const enc = encodeURIComponent;

/** Record entries for one entity. Never throws: activity is never worth failing a write. */
export async function logActivity(assetId: string, actor: Actor, entries: ActivityEntry[], now = Date.now()): Promise<void> {
  if (!entries.length) return;
  try {
    const rest = [...entries];
    const edit = rest.findIndex((e) => e.kind === "edit");
    if (edit >= 0 && actor.id) {
      const [last] = await sb<ActivityRow[]>(`entity_activity?asset_id=eq.${enc(assetId)}&select=*&order=at.desc&limit=1`);
      if (last && last.kind === "edit" && last.actor_id === actor.id && now - Date.parse(last.at) < MERGE_MS) {
        const fields = mergeFields(((last.detail?.fields ?? []) as FieldChange[]), (rest[edit].detail?.fields ?? []) as FieldChange[]);
        rest.splice(edit, 1);
        if (fields.length) {
          await sb(`entity_activity?id=eq.${last.id}`, { method: "PATCH", body: { summary: editSummary(fields), detail: { fields }, at: new Date(now).toISOString() }, prefer: "return=minimal" });
        } else {
          await sb(`entity_activity?id=eq.${last.id}`, { method: "DELETE", prefer: "return=minimal" });
        }
      }
    }
    if (!rest.length) return;
    await sb("entity_activity", {
      method: "POST",
      body: rest.map((e) => ({ asset_id: assetId, actor_id: actor.id, actor_name: actor.name, source: actor.source, kind: e.kind, summary: e.summary.slice(0, 500), detail: e.detail ?? null })),
      prefer: "return=minimal",
    });
  } catch (err) {
    console.error("activity: couldn't record", assetId, err);
  }
}

export async function readActivity(assetId: string, before?: string, limit = 50): Promise<ActivityRow[]> {
  const cursor = before ? `&at=lt.${enc(before)}` : "";
  return (await sb<ActivityRow[]>(`entity_activity?asset_id=eq.${enc(assetId)}${cursor}&select=*&order=at.desc,id.desc&limit=${Math.min(limit, 200)}`)) ?? [];
}
